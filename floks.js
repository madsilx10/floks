import fs from "fs/promises";
import readline from "readline";
import crypto from "crypto";

const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Sec-Ch-Ua": '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  "Sec-Ch-Ua-Mobile": "?1",
  "Sec-Ch-Ua-Platform": '"Android"',
};

function buildCookie(authToken, ct0) {
  return `auth_token=${authToken}; ct0=${ct0}`;
}

// ── Supabase Config (floks.fun) ───────────────────────────────
const SUPABASE_URL = "https://kkhttmjvokztlcttfbcy.supabase.co";

// Fallback if auto-scrape fails (e.g. network issue on startup).
// This is NOT the primary source — at the start of main() an auto-refresh will be attempted.
let ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtraHR0bWp2b2t6dGxjdHRmYmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1Mzg1MDAsImV4cCI6MjEwMzExNDUwMH0.CE6p0ta8Qi_4dXUGC0IEY0hl3UTSrqOIcjxsHgKyWxE";

// ── Auto-scrape latest anon key from floks.fun ───────────────
// Supabase anon key is public by design — it appears in the frontend JS bundle.
// The bundle filename changes each deploy (Vite hash), so we first grab the
// file list from HTML, then search each file for the JWT pattern.
async function fetchLatestAnonKey() {
  try {
    const htmlRes = await fetch("https://floks.fun/", {
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*" },
    });
    const html = await htmlRes.text();

    // Collect all JS file candidates referenced in HTML
    const srcMatches = [...html.matchAll(/(?:src|href)="(\/[^"]+\.js)"/g)].map((m) => m[1]);
    const uniqueSrcs = [...new Set(srcMatches)];

    if (uniqueSrcs.length === 0) {
      console.log("⚠️  Auto-scrape: no .js files found in floks.fun HTML");
      return null;
    }

    const jwtPattern = /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

    for (const src of uniqueSrcs) {
      try {
        const jsUrl = src.startsWith("http") ? src : `https://floks.fun${src}`;
        const jsRes = await fetch(jsUrl, { headers: BASE_HEADERS });
        if (!jsRes.ok) continue;
        const js = await jsRes.text();
        const match = js.match(jwtPattern);
        if (match) return match[0];
      } catch {
        // this file failed to fetch/parse, try next
        continue;
      }
    }

    console.log("⚠️  Auto-scrape: checked all .js files, anon key pattern not found");
    return null;
  } catch (err) {
    console.log(`⚠️  Auto-scrape anon key failed: ${err.message}`);
    return null;
  }
}

// Update global ANON_KEY if scrape succeeded and result differs from current
async function refreshAnonKey(reason = "") {
  const newKey = await fetchLatestAnonKey();
  if (newKey && newKey !== ANON_KEY) {
    ANON_KEY = newKey;
    console.log(`🔄 ANON_KEY auto-updated${reason ? ` (${reason})` : ""}`);
    return true;
  }
  if (newKey) return true; // same as before, still valid
  return false; // scrape completely failed
}

// Detect Supabase responses indicating anon key is invalid/stale
function isInvalidApiKeyError(data) {
  const msg = `${data?.message || ""} ${data?.hint || ""}`.toLowerCase();
  return msg.includes("invalid api key") || msg.includes("anon");
}

// task_key -> points. Add here if you find new tasks
const TASKS = {
  follow: 100,
  quote_2095075830: 100,
  tag2_2095075830: 100,
  like_rt_2095075830: 100,
};

// item_key -> BP price
const ITEMS = {
  water: 150,
  thermometer: 350,
  bulb: 300,
  incubator: 600,
  nest: 100,
};

// ── Load accounts from akun.txt ───────────────────────────────
async function loadAccounts(filepath) {
  const content = await fs.readFile(filepath, "utf-8");
  const blocks = content.trim().split(/\n\n+/);
  const accounts = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      accounts.push({ authToken: lines[0], ct0: lines[1] });
    } else {
      console.warn(`⚠️  Skip invalid block: ${JSON.stringify(block)}`);
    }
  }

  return accounts;
}

// ── Load & save refresh tokens ────────────────────────────────
async function loadRefreshTokens(filepath) {
  try {
    const content = await fs.readFile(filepath, "utf-8");
    return content.split("\n").map((l) => l.trim());
  } catch {
    return [];
  }
}

async function saveRefreshTokens(filepath, tokens) {
  await fs.writeFile(filepath, tokens.join("\n") + "\n", "utf-8");
}

// ── Connect X + auto-capture refresh_token ──────────────────
async function connectAndGetToken(authToken, ct0, idx) {
  const label = `[Akun ${idx}]`;
  const cookie = buildCookie(authToken, ct0);

  // Generate PKCE pair yang valid
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  try {
    // Step 1: Supabase authorize → redirect ke X OAuth
    const supabaseUrl =
      "https://kkhttmjvokztlcttfbcy.supabase.co/auth/v1/authorize" +
      "?provider=x" +
      "&redirect_to=https%3A%2F%2Ffloks.fun%2Fcallback%3Fref%3Dmirzaeaj" +
      `&code_challenge=${codeChallenge}` +
      "&code_challenge_method=s256" +
      "&options%5Bdata%5D%5Bref%5D=mirzaeaj";

    const r1 = await fetch(supabaseUrl, {
      method: "GET",
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*", "Upgrade-Insecure-Requests": "1", Cookie: cookie },
      redirect: "manual",
    });

    const location = r1.headers.get("location") || "";
    console.log(`${label} Step1 ${r1.status} → ${location.slice(0, 80)}...`);

    if (!location.includes("x.com")) {
      console.log(`${label} ❌ Did not redirect to X`);
      return null;
    }

    // Step 2: GET halaman authorize X
    const r2 = await fetch(location, {
      method: "GET",
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*", "Upgrade-Insecure-Requests": "1", Cookie: cookie },
      redirect: "follow",
    });

    const finalUrl2 = r2.url;
    console.log(`${label} Step2 ${r2.status} → ${finalUrl2.slice(0, 80)}...`);

    // Step 2b: GET api.x.com/2/oauth2/authorize (JSON) to get auth_code
    const authorizeParams = new URL(location).search;
    const r2b = await fetch(`https://api.x.com/2/oauth2/authorize${authorizeParams}`, {
      method: "GET",
      headers: {
        ...BASE_HEADERS,
        Accept: "*/*",
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "X-Csrf-Token": ct0,
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Client-Language": "id",
        Origin: "https://x.com",
        Referer: "https://x.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        Cookie: cookie,
      },
    });

    const json2b = await r2b.json();
    const authCode = json2b?.auth_code;
    console.log(`${label} Step2b ${r2b.status} → auth_code=${authCode ? authCode.slice(0, 12) + "..." : "NOT FOUND"}`);

    if (!authCode) {
      console.log(`${label} ❌ Could not get auth_code:`, json2b);
      return null;
    }

    // Step 3: POST approve ke api.x.com/2/oauth2/authorize
    const r3 = await fetch("https://api.x.com/2/oauth2/authorize", {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "X-Csrf-Token": ct0,
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Client-Language": "id",
        Origin: "https://x.com",
        Referer: "https://x.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        Cookie: cookie,
      },
      body: new URLSearchParams({ approval: "true", code: authCode, consent_flow: "web_consent" }),
      redirect: "manual",
    });

    const json3 = await r3.json();
    const redirectUri = json3?.redirect_uri || "";
    console.log(`${label} Step3 ${r3.status} → ${redirectUri.slice(0, 80)}...`);

    if (!redirectUri) {
      console.log(`${label} ❌ Could not get redirect_uri:`, json3);
      return null;
    }

    // Step 4: Hit redirectUri ONCE (one-time use) → intercept loc4
    const r4 = await fetch(redirectUri, {
      method: "GET",
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*", "Upgrade-Insecure-Requests": "1", Cookie: cookie },
      redirect: "manual",
    });

    const loc4 = r4.headers.get("location") || "";
    console.log(`${label} Step4 ${r4.status} → ${loc4.slice(0, 80)}...`);

    // Find ?code= from loc4 (Supabase redirects to floks.fun/callback?code=...)
    // Do NOT look from redirectUri — already consumed
    const codeMatch = loc4.match(/[?&]code=([^&]+)/);
    const pkceCode = codeMatch?.[1];

    if (pkceCode) {
      // Exchange PKCE code → session (dapat refresh_token)
      const r5 = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
        method: "POST",
        headers: {
          ...BASE_HEADERS,
          Accept: "*/*",
          "Content-Type": "application/json;charset=UTF-8",
          Apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          Origin: "https://floks.fun",
          Referer: "https://floks.fun/",
        },
        body: JSON.stringify({
          auth_code: pkceCode,
          code_verifier: codeVerifier,
        }),
      });

      let session = await r5.json().catch(() => ({}));
      console.log(`${label} Step5 ${r5.status} → refresh_token=${session.refresh_token ? session.refresh_token.slice(0, 12) + "..." : "NOT FOUND"}`);

      if (session.refresh_token) {
        console.log(`${label} ✅ Connect successful, refresh_token obtained`);
        return session.refresh_token;
      }

      // Step5 failed → check if caused by stale anon key, if so scrape & retry once
      if (isInvalidApiKeyError(session)) {
        console.log(`${label} 🔍 Anon key may be stale, trying to re-scrape...`);
        const refreshed = await refreshAnonKey("dipicu Step5 gagal");
        if (refreshed) {
          const r5b = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
            method: "POST",
            headers: {
              ...BASE_HEADERS,
              Accept: "*/*",
              "Content-Type": "application/json;charset=UTF-8",
              Apikey: ANON_KEY,
              Authorization: `Bearer ${ANON_KEY}`,
              Origin: "https://floks.fun",
              Referer: "https://floks.fun/",
            },
            body: JSON.stringify({ auth_code: pkceCode, code_verifier: codeVerifier }),
          });
          session = await r5b.json().catch(() => ({}));
          if (session.refresh_token) {
            console.log(`${label} ✅ Connect successful after retry, refresh_token obtained`);
            return session.refresh_token;
          }
        }
      }

      console.log(`${label} ❌ Step5 failed:`, session);
      return null;
    }

    // No ?code= in loc4 → try following loc4 (NOT redirectUri again)
    if (loc4 && !loc4.includes("error=")) {
      const r4b = await fetch(loc4, {
        method: "GET",
        headers: { ...BASE_HEADERS, Accept: "text/html,*/*", "Upgrade-Insecure-Requests": "1", Cookie: cookie },
        redirect: "follow",
      });

      const finalUrl = r4b.url;
      console.log(`${label} Step4b ${r4b.status} → ${finalUrl.slice(0, 80)}...`);

      if (finalUrl.includes("floks.fun")) {
        const body = await r4b.text();
        const rtMatch = body.match(/"refresh_token"\s*:\s*"([^"]+)"/);
        if (rtMatch) {
          console.log(`${label} ✅ Connect successful, refresh_token from body`);
          return rtMatch[1];
        }
      }
    } else if (loc4.includes("error=")) {
      console.log(`${label} ❌ Supabase error in loc4: ${loc4.slice(0, 120)}`);
    }

    console.log(`${label} ⚠️  Connect OK but refresh_token not captured`);
    return null;
  } catch (err) {
    console.log(`${label} ❌ Error: ${err.message}`);
    return null;
  }
}

// ── Task claiming ────────────────────────────────────────────
function taskHeaders(accessToken) {
  return {
    ...BASE_HEADERS,
    Accept: "*/*",
    "Content-Type": "application/json",
    Apikey: ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    Origin: "https://floks.fun",
    Referer: "https://floks.fun/",
  };
}

async function refreshSession(refreshToken) {
  const doRefresh = () =>
    fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        Accept: "*/*",
        "Content-Type": "application/json;charset=UTF-8",
        Apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Origin: "https://floks.fun",
        Referer: "https://floks.fun/",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

  let res = await doRefresh();
  let data = await res.json().catch(() => ({}));

  // Stale anon key → re-scrape & retry once before giving up
  if (!res.ok && isInvalidApiKeyError(data)) {
    console.log(`🔍 refreshSession: anon key may be stale, trying to re-scrape...`);
    const refreshed = await refreshAnonKey("triggered by refreshSession failure");
    if (refreshed) {
      res = await doRefresh();
      data = await res.json().catch(() => ({}));
    }
  }

  if (!res.ok || !data.access_token) {
    throw new Error(`refresh failed (${res.status}): ${JSON.stringify(data)}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    residentId: data.user?.id,
  };
}

async function getDoneTasks(accessToken, residentId) {
  const url = `${SUPABASE_URL}/rest/v1/resident_tasks?select=task_key&resident_id=eq.${residentId}`;
  const res = await fetch(url, { method: "GET", headers: taskHeaders(accessToken) });
  const data = await res.json().catch(() => []);
  return new Set((Array.isArray(data) ? data : []).map((t) => t.task_key));
}

async function claimTask(accessToken, residentId, taskKey, points) {
  const url = `${SUPABASE_URL}/rest/v1/resident_tasks?on_conflict=resident_id,task_key`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...taskHeaders(accessToken), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ resident_id: residentId, task_key: taskKey, points }),
  });
  const ok = res.status === 201 || res.status === 200;
  if (!ok) {
    const errBody = await res.text().catch(() => "");
    console.log(`   ↳ status=${res.status} body=${errBody.slice(0, 300)}`);
  }
  return ok;
}

async function getBarnBalance(accessToken, residentId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/barn_balance`, {
    method: "POST",
    headers: taskHeaders(accessToken),
    body: JSON.stringify({ target: residentId }),
  });
  const data = await res.json().catch(() => null);
  return data;
}

// ── Fetch X profile (for resident upsert) ────────────────────
async function fetchXProfile(authToken, ct0) {
  const cookie = buildCookie(authToken, ct0);
  try {
    const res = await fetch(
      "https://api.x.com/1.1/account/settings.json",
      {
        headers: {
          ...BASE_HEADERS,
          Accept: "*/*",
          Authorization: `Bearer ${BEARER_TOKEN}`,
          "X-Csrf-Token": ct0,
          "X-Twitter-Active-User": "yes",
          "X-Twitter-Client-Language": "id",
          Origin: "https://x.com",
          Referer: "https://x.com/",
          Cookie: cookie,
        },
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`   ↳ fetchXProfile status=${res.status} body=${JSON.stringify(data).slice(0, 300)}`);
      return null;
    }
    const screenName = data.screen_name;
    if (!screenName) return null;

    // settings.json doesn't include 'name' & avatar, so fetch from users/show endpoint
    const res2 = await fetch(
      `https://api.x.com/1.1/users/show.json?screen_name=${encodeURIComponent(screenName)}`,
      {
        headers: {
          ...BASE_HEADERS,
          Accept: "*/*",
          Authorization: `Bearer ${BEARER_TOKEN}`,
          "X-Csrf-Token": ct0,
          "X-Twitter-Active-User": "yes",
          "X-Twitter-Client-Language": "id",
          Origin: "https://x.com",
          Referer: "https://x.com/",
          Cookie: cookie,
        },
      }
    );
    const data2 = await res2.json().catch(() => ({}));
    if (!res2.ok) {
      console.log(`   ↳ fetchXProfile(users/show) status=${res2.status} body=${JSON.stringify(data2).slice(0, 300)}`);
      return { handle: screenName, name: screenName, avatar_url: "" };
    }
    return {
      handle: screenName,
      name: data2.name || screenName,
      avatar_url: (data2.profile_image_url_https || "").replace("_normal", "_400x400"),
    };
  } catch (err) {
    console.log(`   ↳ fetchXProfile error: ${err.message}`);
    return null;
  }
}

// Ensure residents row exists (upsert) before claiming task
async function ensureResident(accessToken, residentId, profile) {
  const url = `${SUPABASE_URL}/rest/v1/residents?on_conflict=id`;
  const body = profile ? { id: residentId, ...profile } : { id: residentId };
  const res = await fetch(url, {
    method: "POST",
    headers: { ...taskHeaders(accessToken), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  const ok = res.status === 201 || res.status === 200 || res.status === 204;
  if (!ok) {
    const errBody = await res.text().catch(() => "");
    console.log(`   ↳ ensureResident status=${res.status} body=${errBody.slice(0, 300)}`);
  }
  return ok;
}

// ── Patch referred_by on residents ───────────────────────────
// referred_by is a UUID, so look up the referrer's UUID by handle first
async function patchReferredBy(accessToken, residentId, refHandle) {
  // 1. Lookup referrer UUID
  const refId = await getResidentIdByHandle(accessToken, refHandle);
  if (!refId) {
    console.log(`   ↳ patchReferredBy: handle "${refHandle}" not found in residents, skip`);
    return false;
  }
  // 2. PATCH referred_by column (only if not already set)
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/residents?select=referred_by&id=eq.${residentId}`,
    { method: "GET", headers: taskHeaders(accessToken) }
  );
  const checkData = await checkRes.json().catch(() => []);
  if (checkData?.[0]?.referred_by) return true; // already set, skip

  const url = `${SUPABASE_URL}/rest/v1/residents?id=eq.${residentId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...taskHeaders(accessToken), Prefer: "return=minimal" },
    body: JSON.stringify({ referred_by: refId }),
  });
  const ok = res.status === 200 || res.status === 204;
  if (!ok) {
    const errBody = await res.text().catch(() => "");
    console.log(`   ↳ patchReferredBy status=${res.status} body=${errBody.slice(0, 300)}`);
  }
  return ok;
}

// ── Get resident_id by handle ─────────────────────────────────
async function getResidentIdByHandle(accessToken, handle) {
  const url = `${SUPABASE_URL}/rest/v1/residents?select=id&handle=eq.${encodeURIComponent(handle)}`;
  const res = await fetch(url, { method: "GET", headers: taskHeaders(accessToken) });
  const data = await res.json().catch(() => []);
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0].id;
}

// ── Chat mode ─────────────────────────────────────────────────

// Base pool — varied English messages natural to crypto/Web3 community chats
const CHAT_POOL_BASE = [
  // Project curiosity
  "this project looks interesting", "when is mainnet launch?", "have you tried the new features?",
  "let's go!", "community is growing fast", "keep it up team", "keep building!",
  "how long has this project been running?", "what's the Q4 roadmap?", "tokenomics look solid",
  "which exchanges are planning to list this?", "is the airdrop still live?", "have you connected your wallet?",
  "which chain is this on?", "is there a block explorer?", "is testnet still active?",
  "just joined, looking for info", "any tutorials for beginners?", "is the discord active?",
  "the tg bot is pretty cool", "is the whitepaper out?", "when does the audit drop?",
  "who are the backers?", "is the team doxxed?", "what's the vesting schedule?",
  "what's the total supply?", "what's the initial circulating supply?", "where are you planning to list?",
  "what's the staking APR?", "is there liquidity mining?", "any yield farming?",
  "NFTs too?", "is governance live?", "when is the snapshot?",
  "can we claim now?", "gas fees are super low", "transactions are fast too",
  "what's the block time?", "how many TPS?", "finality is quick",
  "is it EVM compatible?", "is there a bridge to ETH?", "cross-chain support?",
  "is the SDK ready?", "are the API docs complete?", "very developer friendly",
  "any hackathons planned?", "is there a grant program?", "how big is the ecosystem fund?",
  "is the ambassador program open?", "referral system is nice", "points system is well designed",
  "reward structure looks attractive", "what's a good farming strategy?", "worth farming here",
  "volume keeps climbing", "holder count growing", "growing fast",
  "bullish on this project", "long term hold for me", "massive potential",
  "underrated project", "hidden gem right here", "got alpha from here",
  "community is solid", "devs are active", "regular updates are great",
  "transparency is great", "team communication is good", "weekly progress reports are nice",
  "milestone achieved", "on track with the roadmap", "ahead of schedule",
  "when's the next partnership?", "who else are you collaborating with?", "ecosystem is expanding",
  "user growth is impressive", "on-chain metrics are positive", "TVL keeps rising",
  "liquidity is deepening", "slippage is minimal", "DEX volume looks solid",
  "staking rewards claimed", "how often to compound?", "is there auto-compound?",
  "how long is the lock period?", "how long to unstake?", "any penalty?",
  "is referral live?", "how many referral levels?", "passive income looking good",
  "when does farming season start?", "when's the next event?", "campaign is live",
  "is there a leaderboard?", "wonder what my rank is", "farming competition is fun",
  "what's the prize for top farmer?", "what's the prize pool?", "this event is really exciting",
  "have you invited friends?", "bring others in", "spread the word",
  "sharing on twitter now", "just retweeted", "going viral",
  "any influencers supporting?", "any KOLs endorsed?", "media coverage is good",
  "listed on coingecko?", "when coinmarketcap?", "already on dexscreener",
  "chart looks great", "support is strong", "where's resistance?",
  "FOMO kicking in", "keep accumulating", "DCA strategy",
  "wallet connect works smoothly", "metamask compatible", "rabby works too",
  "mobile friendly", "UI is clean", "UX is great",
  "loads fast", "no bugs", "very smooth",
  "positive feedback from community", "good ratings", "reviews are great",
  "keep up the good work", "proud of this project", "excited about the future",
  "gm everyone", "gn fam", "wagmi",
  "can't wait for mainnet", "countdown started", "soon",
  "let's go!", "to the moon", "this is the way",
  "ser can I ask something?", "any mods here?", "anyone who can help?",
  "question about staking", "how do I claim?", "where's the tutorial?",
  "step by step guide?", "any video guide?", "youtube channel?",
  "docs are comprehensive", "FAQ is up", "how do I submit a support ticket?",
  "response time is fast", "helpful team", "good support",
  "appreciate the transparency", "is it open source?", "github is active",
  "daily commits", "code quality is solid", "well documented",
  "security first", "audit passed", "no rug guarantee",
  "experienced team", "great track record", "credible project",
  // Extra casual
  "gm", "gn", "wen moon", "ser", "fren", "ngmi", "wagmi",
  "just aped in", "bought the dip", "diamond hands", "paper hands rekt",
  "hodl gang", "this gonna pump", "accumulating more", "loading bags",
  "price action looking good", "technicals are bullish", "breakout soon?",
  "consolidating now", "healthy correction", "buy the dip",
  "not financial advice but bullish", "NFA but looks good", "DYOR everyone",
  "doing my research", "checked the docs", "read the whitepaper",
  "community call when?", "AMA soon?", "update?",
  "any news today?", "what did I miss?", "catching up on updates",
  "been here since day one", "early supporter", "OG vibes",
  "this is still early", "we're early", "early mover advantage",
  "multichain future", "chain agnostic", "omnichain vision",
  "love the vision", "mission aligned", "values match",
  "long term believer", "fundamentals strong", "building in bear market",
  "bear market builders are the best", "building through the cycle", "cycle aware",
  "we're in accumulation phase", "smart money is loading", "whales accumulating",
  "low mcap gem", "mcap to potential ratio crazy", "room to grow",
  "market cap undervalued", "price discovery phase", "fair value much higher",
  "utility driven token", "real use case", "genuine adoption",
  "not just hype", "substance over hype", "fundamentals over price",
  "team is shipping fast", "product is live", "actual users",
  "real revenue", "sustainable model", "not ponzi",
  "organic growth", "no paid shilling", "grassroots movement",
  "bottom up growth", "community led", "dao vibes",
  "decentralized governance ftw", "community owns the protocol", "power to the people",
  "web3 is the future", "on-chain everything", "trustless system",
  "permissionless access", "censorship resistant", "open access",
  "financial freedom", "bankless", "self custody",
  "not your keys not your coins", "always withdraw to cold wallet", "stay safe out there",
  "opsec is important", "seed phrase security", "hardware wallet recommended",
  "ledger or trezor?", "air gapped signing", "multisig for large amounts",
  "smart contract risk?", "audited code", "bug bounty active?",
  "insurance available?", "risk management", "position sizing matters",
  "never invest more than you can lose", "manage your risk", "stop loss set",
  "take profits along the way", "trim at resistance", "reload at support",
  "patience is a virtue in crypto", "time in market beats timing market", "stay patient",
  "zoom out", "weekly chart looks good", "monthly chart bullish",
  "macro trends favorable", "institutional interest growing", "adoption wave coming",
  "next bull run will be massive", "cycle top far away", "early innings",
  "compare to last cycle", "4 year cycles", "halving impact",
  "bitcoin leads altcoins", "alts follow bitcoin", "rotation happening",
  "sector rotation", "narrative shifting", "new narrative emerging",
  "defi summer 2.0?", "nft revival?", "gaming tokens hot rn",
  "rwa narrative strong", "real world assets", "tokenized treasuries",
  "depin is interesting", "physical infrastructure on chain", "massive opportunity",
  "ai x crypto narrative", "ai tokens pumping", "intersection of ai and blockchain",
  "zkEVM progress", "layer2 wars", "which L2 wins?",
  "ethereum roadmap impressive", "dencun upgrade impact", "blob fees low now",
  "solana ecosystem growing", "solana transactions fast", "firedancer coming",
  "base chain growing", "coinbase l2 smart move", "institutional l2",
  "arbitrum dominant", "optimism superchain", "op stack ecosystem",
  "polygon ecosystem diverse", "zksync era progress", "starknet advancing",
  "linea from consensys", "scroll zkEVM", "taiko decentralized",
  "modular blockchain thesis", "celestia for DA", "eigenlayer restaking",
  "shared security model", "interoperability solutions", "bridges improving",
  "layerzero omnichain", "wormhole v2", "axelar cross chain",
  "ccip from chainlink", "hyperlane permissionless", "IBC expanding beyond cosmos",
  "cosmos ecosystem connected", "osmosis dex growing", "atom value accrual",
  "injective defi hub", "sei for trading", "dydx chain live",
  "aevo perps dex", "synthetix v3", "gmx v2 launched",
  "perpetuals market growing", "on chain derivatives", "delta neutral strategies",
  "basis trading on chain", "funding rate arb", "liquidation bots",
  "mev landscape changing", "flashbots evolving", "mev share interesting",
  "order flow auctions", "intent based trading", "solver networks",
  "account abstraction live", "smart accounts", "ERC-4337 adoption",
  "gasless transactions", "session keys ux", "social recovery wallets",
  "passkey wallets coming", "biometric security", "web2 ux on web3",
  "onboarding improving", "fiat on ramps getting better", "stripe crypto",
  "visa crypto payments", "paypal stablecoin", "stablecoin adoption",
  "usdc growing", "usdt dominance", "algorithmic stablecoins risky",
  "overcollateralized is safe", "dai dai dai", "frax hybrid model",
  "rai reflexer interesting", "liquity zero interest", "crvusd from curve",
  "gho from aave", "pyusd from paypal", "regulatory compliant stablecoins",
  "cbdc coming but not the same", "cbdc vs crypto", "privacy matters",
  "zcash privacy", "monero privacy", "aztec network privacy on eth",
  "tornado cash precedent", "privacy is a right", "regulatory clarity needed",
  "sec vs crypto ongoing", "binance news", "coinbase legal battle",
  "regulatory landscape shifting", "framework coming soon", "lobbying helping",
  "bipartisan support emerging", "crypto voters powerful", "political influence growing",
  "bitcoin etf impact", "eth etf next?", "institutional allocations",
  "pension funds in crypto", "sovereign wealth fund interest", "endowments allocating",
  "michael saylor strategy", "corporate treasury bitcoin", "more companies following",
  "blackrock in crypto", "fidelity digital assets", "traditional finance adapting",
  "jp morgan blockchain work", "goldman tokenization", "wall street here",
  "tradfi meets defi", "convergence happening", "best of both worlds",
  "permissioned defi for institutions", "compliant defi pools", "kyc defi",
  "undercollateralized lending coming", "credit on chain", "credit scoring on chain",
  "on chain identity", "did decentralized identity", "soul bound tokens",
  "reputation systems", "trust without verification", "zero knowledge proofs",
  "zk proofs revolutionary", "zk everywhere", "privacy and scalability via zk",
  "polygon id", "worldcoin controversial but interesting tech", "proof of humanity",
  "gitcoin passport", "quadratic funding", "sybil resistance important",
  "dao tooling improving", "snapshot governance", "tally on chain",
  "compound governance model", "uniswap dao treasury", "nouns dao experiment",
  "protocol owned liquidity", "olympus pro model", "flywheel mechanics",
  "token engineering matters", "mechanism design", "game theory in protocols",
  "bonding curves interesting", "concentrated liquidity uniswap v3", "liquidity management",
  "gamma strategies", "arrakis finance", "range orders useful",
  "lp management getting smarter", "just in time liquidity", "jit bots",
  "impermanent loss manageable", "il calculator", "hedging il strategies",
  "defi composability", "money legos", "protocol integrations",
  "yearn vaults", "convex finance", "curve wars",
  "vote escrow model", "ve tokenomics", "bribes marketplace",
  "votium bribes", "hidden hand platform", "governance mercenaries",
  "real yield narrative", "revenue sharing", "fee switch debate",
  "uniswap fee switch vote", "protocol revenue", "value capture",
  "token buybacks", "burn mechanisms", "deflationary pressure",
  "eip 1559 impact", "ultrasound money eth", "merge was successful",
  "pos ethereum environmental", "energy usage down 99pct", "green crypto",
  "bitcoin energy debate", "stranded energy argument", "renewable mining",
  "miners transitioning", "bitcoin l2 development", "lightning network growing",
  "lightning capacity increasing", "nostr and bitcoin", "bitcoin social layer",
  "ordinals controversy", "brc-20 tokens", "runes protocol",
  "bitcoin defi emerging", "wrapped bitcoin on eth", "tbtc by threshold",
  "cbbtc from coinbase", "lbtc from lombard", "bitcoin yield strategies",
  "babylon bitcoin staking", "bitcoin as collateral", "satoshi vision debate",
  "eth vs btc debate", "both can win", "coexistence possible",
  "multichain is reality", "chain maximalism fading", "pragmatic approach wins",
  "user experience is key", "ux determines adoption", "friction must decrease",
  "one click defi", "simplified interfaces", "abstraction is good",
  "consumer apps on chain", "social fi growing", "farcaster protocol",
  "lens protocol social", "decentralized social media", "censorship resistant comms",
  "content ownership", "creator economy web3", "fan tokens model",
  "gaming guilds evolving", "guild fi model", "play and earn sustainable?",
  "sustainable gaming economy", "game economics matter", "token sink mechanisms",
  "in game economies", "virtual real estate", "metaverse long term play",
  "ar vr integration", "spatial computing", "apple vision pro web3?",
  "mixed reality nfts", "dynamic nfts", "nfts as access passes",
  "token gating content", "exclusive communities", "nft utility beyond art",
  "music nfts", "royal co model", "sound xyz platform",
  "zora protocol", "manifold creator tools", "highlight drops",
  "nft marketplace wars", "blur vs opensea", "royalties debate",
  "creator royalties important", "0 royalty race to bottom", "optional royalties compromise",
  "physical backed nfts", "rwas tokenized", "art tokenization",
  "real estate tokenization", "fractional ownership", "democratizing access",
  "global markets on chain", "24 7 markets", "no market hours",
  "cross border payments instant", "remittance use case real", "stellar and ripple",
  "swift vs crypto rails", "crypto faster and cheaper", "settlement finality",
  "atomic swaps", "htlc contracts", "payment channels",
  "micro payments enabled", "streaming payments", "superfluid protocol",
  "drips network", "sablier streams", "continuous payroll possible",
  "crypto payroll companies", "request finance", "bitwage",
  "crypto taxes simplified", "koinly cointracker", "tax reporting improving",
  "accounting for defi", "cost basis tracking", "fifo vs hifo",
  "portfolio tracking tools", "debank portfolio", "zerion dashboard",
  "zapper fi", "ape board", "nansen analytics",
  "dune analytics insights", "on chain data transparent", "glassnode metrics",
  "santiment signals", "messari research", "the block data",
  "defillama tvl", "token terminal revenue", "crypto fundamentals data",
  "galaxy digital research", "coindesk reporting", "decrypt news",
  "bankless podcast", "unchained podcast", "the chopping block",
  "uncommon core", "epicenter podcast", "zero knowledge podcast",
  "web3 education growing", "freecodecamp crypto", "alchemy university",
  "buildspace projects", "learnweb3 dao", "developer tooling better",
  "hardhat vs foundry", "foundry is great", "forge test coverage",
  "slither static analysis", "certora formal verification", "fuzzing tests",
  "invariant testing", "property based testing", "security culture improving",
  "immunefi bug bounties", "code4rena audits", "sherlock insurance",
  "audit competitions growing", "security researchers rewarded", "responsible disclosure",
  "defi hacks decreasing?", "security improving over time", "lessons learned",
  "multisig treasury management", "gnosis safe standard", "timelock contracts",
  "governance attacks defended", "flash loan governance", "voting weight manipulation",
  "sybil attacks on governance", "quorum requirements", "delegation important",
  "liquid democracy", "representative governance", "bicameral dao structure",
  "working groups in daos", "contributors compensated", "contributor dao",
  "retroactive public goods", "optimism rpgf", "gitcoin grants",
  "public goods funding", "protocol guild", "hypercerts",
  "impact certificates", "funding the commons", "regenerative finance",
  "refi movement", "climate coins", "toucan protocol",
  "moss earth", "carbon markets on chain", "voluntary carbon credits",
  "kyoto markets", "biodiversity credits", "impact investing on chain",
  "positive sum games", "non zero sum economy", "abundance mindset",
  "open source software funding", "oss sustainability", "drips for developers",
  "protocol revenue to devs", "public goods are important", "tragedy of commons solved?",
  "coordination problems solved by crypto", "schelling points", "focal solutions",
  "trust minimized systems", "math over trust", "code is law",
  "immutability valuable", "upgradeability tradeoffs", "proxy patterns",
  "transparent proxies", "uups proxies", "beacon proxies",
  "diamond pattern", "eternal storage", "storage layout",
  "solidity best practices", "assembly optimization", "gas optimization",
  "erc standards matter", "erc-20 erc-721 erc-1155", "erc-4626 vaults",
  "erc-6551 token bound accounts", "nfts with wallets", "composable nfts",
  "erc-7683 cross chain intents", "erc-7579 modular accounts", "standards evolving",
  "eip process", "ethereum magicians forum", "all core devs calls",
  "pectra upgrade", "verkle trees coming", "statelessness roadmap",
  "portal network", "distributed history", "light clients",
  "dvt distributed validators", "obol network", "ssv network",
  "solo staking", "home validators", "rocket pool reth",
  "lido steth", "frax sfrxeth", "stader ethx",
  "restaking with eigenlayer", "avs services", "points farming",
  "eigenpie pendle", "liquid restaking tokens", "lrt wars",
  "pendle yield trading", "fixed yield vs variable", "yield stripping",
  "basis trading", "cash and carry", "neutral strategies",
  "options on chain", "ribbon finance", "dopex protocol",
  "lyra finance", "premia protocol", "hegic options",
  "structured products", "principal protected vaults", "covered calls",
  "wheel strategy", "theta decay", "vega exposure",
  "perpetual futures", "dydx chain", "hyperliquid exchange",
  "aevo perps", "drift protocol solana", "marginfi solana",
  "kamino finance", "meteora dlmm", "raydium concentrated",
  "orca whirlpools", "jupiter aggregator", "jito mev solana",
  "solana mev growing", "sandwich attacks", "frontrunning protection",
  "cow protocol batch auctions", "1inch fusion", "paraswap delta",
  "kyber network", "odos aggregator", "magpie protocol",
  "defi aggregation layer", "intent based swaps", "limit orders defi",
  "stop loss on chain", "trailing stop possible", "advanced order types coming",
  "prediction markets", "polymarket volume", "augur v2",
  "gnosis conditional tokens", "prediction markets accurate?", "wisdom of crowds",
  "futarchy governance", "decision markets", "information aggregation",
  "oracle problem important", "chainlink dominant", "pyth network fast",
  "uma optimistic oracle", "api3 first party", "tellor decentralized",
  "band protocol", "redstone modular oracles", "chronicle protocol",
  "cross chain price feeds", "twap oracles", "vwap calculations",
  "oracle manipulation risk", "price manipulation attacks", "mango markets hack",
  "defi risk management", "protocol risk parameters", "conservative collateral",
  "overcollateralization ratios", "loan to value", "health factors",
  "aave v3 efficiency mode", "compound v3 comet", "euler finance relaunch",
  "morpho optimizing", "fluid lending", "spark protocol",
  "maker endgame plan", "sky rebranding", "subDAO structure",
  "maker surplus buffer", "peg stability module", "dai savings rate",
  "sDAI yield", "tokenized government bonds", "ondo finance",
  "maple finance institutional", "centrifuge real world", "goldfinch protocol",
  "credix credit", "clearpool institutional", "truefi credit",
  "undercollateralized lending risk", "credit risk on chain", "default rates",
  "insurance protocols", "nexus mutual", "insurace protocol",
  "unslashed finance", "cozy finance", "risk harbor",
  "cover protocol v2", "idle finance", "idle tranche",
  "senior junior tranche", "risk tranching", "structured credit",
  "cdos on chain", "clrfund", "streaming quadratic funding",
  "retroqf", "eas attestations", "on chain reputation",
  "worldcoin iris scan", "biometric blockchain", "privacy preserving id",
  "proof of personhood", "one person one vote", "sybil resistance solutions",
  "bright id", "idena network", "proof of work personhood",
  "democratic governance", "token weighted vs one person one vote", "hybrid models",
  "metagovernance", "governance aggregators", "index coop governance",
  "galxe quests", "layer3 quests", "crew3 quests",
  "guild xyz", "guild membership", "token gated discord",
  "collab land integration", "token gating tools", "proof of ownership",
  "airdrops reward loyal users", "retroactive airdrops fair", "sybil filtering",
  "airdrop farming meta", "multi wallet farming", "airdrop checklist",
  "eigenlayer airdrop", "arbitrum dao airdrop", "optimism airdrop rounds",
  "uniswap airdrop history", "ens airdrop", "jito airdrop",
  "upcoming airdrops list", "airdrop season", "farming multiple protocols",
  "diversify airdrop farming", "time investment vs reward", "opportunity cost",
  "gas costs consideration", "mainnet vs testnet activities", "bridge multiple times",
  "provide liquidity strategy", "governance participation", "nft minting activities",
  "social activities matter", "twitter x engagement", "discord activity tracked",
  "on chain activity history", "wallet age matters", "first transactions",
  "mainnet interaction history", "consistent activity", "recent activity matters",
  "volume matters for airdrops", "unique transactions", "diverse interactions",
  "protocol usage frequency", "regular user vs one time", "power user status",
  "whales vs retail in airdrops", "linear vs exponential allocation", "fairness debate",
  "community over speculation", "genuine usage rewarded", "mercenary capital problem",
  "sticky liquidity hard to achieve", "loyalty programs", "ve lock commitment",
  "long term alignment", "incentive alignment", "skin in the game",
  "principal agent problem in crypto", "delegation risks", "representation issues",
  "voter apathy in daos", "low participation problem", "incentivizing governance",
  "governance mining", "voting rewards", "participation incentives",
  "token incentives double edged sword", "inflate to incentivize", "emission schedules",
  "fair launch", "no premine", "community owned from day one",
  "founder vesting aligned", "investor vesting long enough", "team tokens locked",
  "cliff periods important", "linear vesting preferred", "milestone based vesting",
  "token distribution matters", "concentration risk", "whale dominance",
  "protocol owned liquidity better", "less reliance on mercenary lp", "sustainable liquidity",
  "flywheel economics", "virtuous cycle", "network effects compound",
  "winner take most markets", "but multiple winners in crypto", "fragmentation ok",
  "specialization happening", "niche protocols thriving", "focus over scope creep",
  "product market fit first", "then tokenize", "token too early mistake",
  "build first launch token later", "utility before speculation", "real users first",
  "revenue before token", "sustainable business model", "crypto native monetization",
  "fee sharing with token holders", "revenue to stakers", "value accrual clear",
  "token utility clear", "governance utility", "cash flow rights",
  "fee discounts for holders", "access gated by token", "utility drives demand",
  "speculation vs utility", "both exist in crypto", "spectrum of value",
  "store of value narrative", "medium of exchange use case", "unit of account someday",
  "bitcoin digital gold", "eth productive asset", "sol consumer chain",
  "each chain has narrative", "narrative drives price", "price follows narrative",
  "then fundamentals matter", "in long run fundamentals win", "patience required",
  "crypto is patient capital", "10 year horizon", "generational wealth",
  "financial sovereignty", "opt out of broken system", "alternative rails",
  "parallel economy building", "local vs global currency", "bitcoin as reserve",
  "dollarization alternative", "emerging markets use case strongest", "real need there",
  "remittance savings real", "western union disruption", "cross border instant",
  "stablecoins in emerging markets", "usdt popular globally", "dollar access",
  "financial inclusion narrative", "unbanked billions", "mobile first approach",
  "feature phone wallets", "sms based transactions", "simple interfaces for mass",
  "whatsapp of crypto needed", "simple as venmo", "but self custodied",
  "progressive decentralization model", "start custodial become non custodial", "education journey",
  "crypto literacy improving", "mainstream learning", "institutions understand now",
  "vocabulary entering mainstream", "blockchain not crypto distinction", "marketing rebranding",
  "enterprise blockchain vs public", "permissioned chains use cases", "hybrid models",
  "hyperledger fabric enterprise", "r3 corda financial", "quorum jp morgan",
  "private chains limited value", "public chain composability wins", "openness advantage",
  "interop between private and public", "gateway protocols", "on ramp solutions",
  "enterprise meets defi", "rwa on public chains", "best of both",
];

// Generate additional messages by combining templates with modifiers
function generateExtendedPool() {
  const subjects = [
    "this project", "the team", "the protocol", "the community", "the tokenomics",
    "the roadmap", "the tech", "the vision", "the ecosystem", "the DAO",
    "the staking mechanism", "the reward system", "the liquidity", "the governance",
    "the security", "the UX", "the onboarding", "the docs", "the support", "the devs",
  ];
  const positives = [
    "is impressive", "looks solid", "is well designed", "is promising", "is growing fast",
    "is ahead of schedule", "is top tier", "is underrated", "is the real deal", "is legit",
    "has great potential", "has strong fundamentals", "has a clear vision", "has a solid team",
    "is shipping fast", "is building in silence", "is executing well", "is delivering",
    "is undervalued", "is a hidden gem",
  ];
  const questions = [
    "when is the next update?", "any announcements soon?", "what's next on the roadmap?",
    "when is the next AMA?", "any partnerships dropping?", "mainnet ETA?",
    "new features coming?", "any incentive programs?", "grant program details?",
    "when does season 2 start?", "next snapshot when?", "emission schedule?",
    "staking rewards details?", "bridge live yet?", "mobile app coming?",
    "SDK docs updated?", "testnet incentives?", "any upcoming events?",
    "hackathon dates?", "ambassador applications open?",
  ];
  const reactions = [
    "this is huge", "bullish", "very bullish", "extremely bullish", "mega bullish",
    "wagmi", "let's go", "this is it", "game changer", "paradigm shift",
    "mind blown", "incredible", "amazing news", "love to see it", "huge W",
    "based", "this slaps", "certified banger", "tier 1 project", "alpha leak",
  ];

  const generated = [];
  for (const s of subjects) {
    for (const p of positives) {
      generated.push(`${s} ${p}`);
    }
  }
  for (const q of questions) generated.push(q);
  for (const r of reactions) generated.push(r);

  // Numbers 1-50 combined with phrases for variety
  const activities = ["farming", "staking", "holding", "building", "contributing", "voting", "bridging", "swapping"];
  const days = ["day", "week", "month", "year"];
  for (let n = 1; n <= 50; n++) {
    for (const a of activities) {
      generated.push(`${n} ${days[n % days.length]} of ${a} and loving it`);
    }
  }

  // Number of accounts / points phrases
  for (let pts = 100; pts <= 5000; pts += 100) {
    generated.push(`just hit ${pts} points`);
    generated.push(`${pts} points accumulated`);
    generated.push(`${pts} points and counting`);
  }

  // Time based phrases
  for (let h = 1; h <= 24; h++) {
    generated.push(`been here for ${h} hour${h > 1 ? "s" : ""} already`);
  }

  return generated;
}

const CHAT_POOL = [...CHAT_POOL_BASE, ...generateExtendedPool()];

function randomChat() {
  return CHAT_POOL[Math.floor(Math.random() * CHAT_POOL.length)];
}

// Send 1 chat message
async function sendChat(accessToken, residentId) {
  const url = `${SUPABASE_URL}/rest/v1/chat_messages`;
  const body = { resident_id: residentId, body: randomChat(), requested_amount: null };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...taskHeaders(accessToken),
      Prefer: "return=minimal",
      "X-Client-Info": "supabase-js/2.112.4; runtime=web",
    },
    body: JSON.stringify(body),
  });
  const ok = res.status === 201 || res.status === 200;
  if (!ok) {
    const errBody = await res.text().catch(() => "");
    console.log(`   ↳ sendChat status=${res.status} body=${errBody.slice(0, 200)}`);
  }
  return ok;
}

// Get total points collected for an account
async function getTotalPoints(accessToken, residentId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/residents?select=points&id=eq.${residentId}`,
    { method: "GET", headers: taskHeaders(accessToken) }
  );
  const data = await res.json().catch(() => []);
  return data?.[0]?.points ?? 0;
}

// Chat mode: loop accounts start→end repeatedly until EACH account reaches target points
async function runChatMode(allAccounts, tokens, targetPoints, pointsPerChat, start, end, chatsPerAcct = 1) {
  const totalAccounts = end - start;
  let totalChatSent = 0;
  let round = 1;

  // Track points PER ACCOUNT (bukan global)
  const accountPoints = new Array(totalAccounts).fill(0);

  // Cache sessions per account so we don't refresh every single chat
  const sessions = new Array(totalAccounts).fill(null);

  const chatsNeeded = Math.ceil(targetPoints / pointsPerChat);
  console.log(`\n🎯 Target per akun: ${targetPoints} pts | ${pointsPerChat} pts/chat | ~${chatsNeeded} chats/akun`);
  console.log(`👥 ${totalAccounts} accounts (${start + 1}–${Math.min(end, allAccounts.length)}), ${chatsPerAcct} chat/akun/round, urutan random\n`);

  // remaining[i] = sisa chat akun i di round ini
  let remaining = new Array(totalAccounts).fill(chatsPerAcct);

  console.log(`━━━ Round ${round} ━━━`);

  // Lanjut selama masih ada akun yang belum capai target dan punya token
  while (accountPoints.some((pts, i) => pts < targetPoints && tokens[start + i]?.trim())) {
    // Akun yang masih punya jatah chat, punya token, dan BELUM capai target per akun
    const available = remaining
      .map((left, i) => ({ i, left }))
      .filter(({ i, left }) => left > 0 && tokens[start + i]?.trim() && accountPoints[i] < targetPoints);

    // Semua akun habis jatahnya di round ini → mulai round baru
    if (available.length === 0) {
      round++;
      remaining = new Array(totalAccounts).fill(chatsPerAcct);
      sessions.fill(null); // reset session cache tiap round baru

      const roundDelay = 3000 + Math.floor(Math.random() * 2000);
      // Tampilkan progress per akun
      const summary = accountPoints
        .map((p, i) => `Akun${start + i + 1}: ${p}/${targetPoints}pts${p >= targetPoints ? " ✅" : ""}`)
        .join(" | ");
      console.log(`\n📊 Progress: ${summary}`);
      console.log(`⏳ Round ${round} dalam ${(roundDelay / 1000).toFixed(1)}s...`);
      await new Promise((r) => setTimeout(r, roundDelay));
      console.log(`\n━━━ Round ${round} ━━━`);
      continue;
    }

    // Pilih akun secara random dari yang masih available
    const { i } = available[Math.floor(Math.random() * available.length)];
    const realIdx = start + i + 1;
    const label = `[Account ${realIdx}]`;

    try {
      // Refresh session kalau belum ada di cache
      if (!sessions[i]) {
        const refreshToken = tokens[start + i].trim();
        const sess = await refreshSession(refreshToken);
        sessions[i] = { accessToken: sess.accessToken, residentId: sess.residentId };
        tokens[start + i] = sess.refreshToken;
        await saveRefreshTokens("refresh.txt", tokens);
      }

      const { accessToken, residentId } = sessions[i];
      const ok = await sendChat(accessToken, residentId);

      if (ok) {
        accountPoints[i] += pointsPerChat;
        totalChatSent++;
        remaining[i]--;
        console.log(`${label} ✅ Chat sent (+${pointsPerChat}p) → akun: ${accountPoints[i]}/${targetPoints}p`);
        if (accountPoints[i] >= targetPoints) {
          console.log(`${label} 🎯 Target akun tercapai!`);
        }
      } else {
        console.log(`${label} ❌ Chat failed`);
        sessions[i] = null; // reset session biar refresh ulang next pick
        remaining[i]--;
      }
    } catch (err) {
      console.log(`${label} ❌ Error: ${err.message}`);
      sessions[i] = null;
      remaining[i]--;
    }

    // 5s CD per chat (server enforced)
    const stillRunning = accountPoints.some((pts, i) => pts < targetPoints && tokens[start + i]?.trim());
    if (stillRunning) {
      await new Promise((r) => setTimeout(r, 5500 + Math.floor(Math.random() * 1000)));
    }
  }

  console.log(`\n✅ Semua akun selesai! Total chats terkirim: ${totalChatSent}`);
  accountPoints.forEach((pts, i) => {
    console.log(`  [Account ${start + i + 1}] ${pts} pts dari chat`);
  });
}

// ── Vote (instant) ────────────────────────────────────────────
async function vote(accessToken, residentId, choice = "instant") {
  const url = `${SUPABASE_URL}/rest/v1/votes`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...taskHeaders(accessToken), Prefer: "return=minimal" },
    body: JSON.stringify({ resident_id: residentId, choice }),
  });
  const ok = res.status === 201 || res.status === 200;
  if (!ok) {
    const errBody = await res.text().catch(() => "");
    console.log(`   ↳ vote status=${res.status} body=${errBody.slice(0, 300)}`);
  }
  return ok;
}

// ── Buy item ──────────────────────────────────────────────────
async function buyItem(accessToken, residentId, itemKey, price) {
  const url = `${SUPABASE_URL}/rest/v1/resident_items`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...taskHeaders(accessToken), Prefer: "return=minimal" },
    body: JSON.stringify({ resident_id: residentId, item_key: itemKey, price }),
  });
  const ok = res.status === 201 || res.status === 200;
  if (!ok) {
    const errBody = await res.text().catch(() => "");
    console.log(`   ↳ buyItem(${itemKey}) status=${res.status} body=${errBody.slice(0, 300)}`);
  }
  return ok;
}

// ── Mode: vote all accounts ──────────────────────────────────
async function processVote(refreshToken, idx, tokensRef, filepath, choice = "instant") {
  const label = `[Account ${idx}]`;
  try {
    const { accessToken, refreshToken: newRefreshToken, residentId } = await refreshSession(refreshToken);
    tokensRef[idx - 1] = newRefreshToken;
    await saveRefreshTokens(filepath, tokensRef);
    console.log(`${label} 🔑 Session OK (resident_id=${residentId})`);

    const ok = await vote(accessToken, residentId, choice);
    console.log(`${label} ${ok ? "✅" : "❌"} vote "${choice}"`);
    return ok;
  } catch (err) {
    console.log(`${label} ❌ processVote error: ${err.message}`);
    return false;
  }
}

// ── Mode: buy item all accounts ───────────────────────────────
async function processBuy(refreshToken, idx, tokensRef, filepath, itemKey, price) {
  const label = `[Account ${idx}]`;
  try {
    const { accessToken, refreshToken: newRefreshToken, residentId } = await refreshSession(refreshToken);
    tokensRef[idx - 1] = newRefreshToken;
    await saveRefreshTokens(filepath, tokensRef);
    console.log(`${label} 🔑 Session OK (resident_id=${residentId})`);

    const ok = await buyItem(accessToken, residentId, itemKey, price);
    console.log(`${label} ${ok ? "✅" : "❌"} buy "${itemKey}" (${price} BP)`);
    return ok;
  } catch (err) {
    console.log(`${label} ❌ processBuy error: ${err.message}`);
    return false;
  }
}

async function processTasks(refreshToken, idx, tokensRef, filepath, xProfile) {
  const label = `[Account ${idx}]`;

  try {
    const { accessToken, refreshToken: newRefreshToken, residentId } = await refreshSession(refreshToken);

    // Save new refresh_token IMMEDIATELY (rotation — old token is invalid)
    tokensRef[idx - 1] = newRefreshToken;
    await saveRefreshTokens(filepath, tokensRef);

    console.log(`${label} 🔑 Session OK (resident_id=${residentId})`);

    // Ensure residents row exists before claiming (prevent FK violation)
    const okResident = await ensureResident(accessToken, residentId, xProfile);
    console.log(`${label} ${okResident ? "✅" : "⚠️"} ensureResident`);

    const done = await getDoneTasks(accessToken, residentId);

    for (const [taskKey, points] of Object.entries(TASKS)) {
      if (done.has(taskKey)) {
        console.log(`${label} ⏭️  "${taskKey}" already done`);
        continue;
      }
      const ok = await claimTask(accessToken, residentId, taskKey, points);
      console.log(`${label} ${ok ? "✅" : "❌"} claim "${taskKey}" (+${points})`);
      await new Promise((r) => setTimeout(r, 1000));
    }

    const balance = await getBarnBalance(accessToken, residentId);
    console.log(`${label} 💰 Balance: ${balance}`);

    return true;
  } catch (err) {
    console.log(`${label} ❌ processTasks error: ${err.message}`);
    return false;
  }
}

// ── Double or Nothing ─────────────────────────────────────────
async function playDoubleOrNothing(accessToken) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/play_double_or_nothing`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...taskHeaders(accessToken),
      "Content-Profile": "public",
    },
    body: JSON.stringify({}),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    console.log(`   ↳ playDoubleOrNothing status=${res.status} (body parse failed)`);
    return null;
  }

  if (!res.ok) {
    const msg = data?.message || data?.hint || JSON.stringify(data);
    console.log(`   ↳ playDoubleOrNothing ${res.status}: ${msg.slice(0, 300)}`);
    return null;
  }

  // RPC returns [] on some error states (e.g. balance too low)
  if (!Array.isArray(data) || data.length === 0) {
    console.log(`   ↳ playDoubleOrNothing unexpected response: ${JSON.stringify(data).slice(0, 300)}`);
    return null;
  }

  return data[0]; // { outcome, delta, new_balance }
}

async function processDoubleOrNothing(refreshToken, idx, tokensRef, filepath, rounds) {
  const label = `[Account ${idx}]`;
  try {
    const { accessToken, refreshToken: newRT, residentId } = await refreshSession(refreshToken);
    tokensRef[idx - 1] = newRT;
    await saveRefreshTokens(filepath, tokensRef);
    console.log(`${label} 🔑 Session OK (resident_id=${residentId})`);

    let wins = 0, losses = 0, totalDelta = 0;
    for (let r = 0; r < rounds; r++) {
      const result = await playDoubleOrNothing(accessToken);
      if (!result) {
        console.log(`${label} ❌ Round ${r + 1} failed`);
        continue;
      }
      const isWin = result.outcome === "win";
      const emoji = isWin ? "🎲✅" : "🎲❌";
      const sign = result.delta >= 0 ? "+" : "";
      console.log(`${label} ${emoji} Round ${r + 1}: ${result.outcome.toUpperCase()} | ${sign}${result.delta} | balance: ${result.new_balance}`);
      isWin ? wins++ : losses++;
      totalDelta += result.delta;

      if (r < rounds - 1) {
        const delay = 1500 + Math.floor(Math.random() * 2000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    const sign = totalDelta >= 0 ? "+" : "";
    console.log(`${label} 📊 ${rounds} rounds → ${wins}W / ${losses}L | net: ${sign}${totalDelta}`);
    return true;
  } catch (err) {
    console.log(`${label} ❌ processDoubleOrNothing error: ${err.message}`);
    return false;
  }
}

// ── Menu & range parsing ─────────────────────────────────────
function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function showMenu(total) {
  console.log("\nSelect mode:");
  console.log("  1. Connect X + Task");
  console.log("  2. Vote (instant)");
  console.log("  3. Buy Item");
  console.log("  4. Chat (point farming)");
  console.log("  5. Double or Nothing");
  console.log("  6. Connect X Only");

  const modeChoice = await askQuestion("Enter mode (1/2/3/4/5/6): ");

  if (modeChoice === "2") {
    // Vote mode
    console.log("\nSelect account range for vote:");
    console.log("  1. All accounts");
    console.log("  2. Single account");
    console.log("  3. Range");
    const rc = await askQuestion("Choice: ");
    let rangeStr = "";
    if (rc === "2") rangeStr = await askQuestion(`Account number (1-${total}): `);
    else if (rc === "3") rangeStr = await askQuestion("Range (e.g. 3-end or 3-7): ");
    return { mode: "vote", range: rangeStr };
  }

  if (modeChoice === "6") {
    // Connect X Only — get refresh token without claiming tasks
    console.log("\nSelect account range for Connect X Only:");
    console.log("  1. All accounts");
    console.log("  2. Single account");
    console.log("  3. Range (e.g. 3-end or 3-7)");
    const rc = await askQuestion("Choice: ");
    let rangeStr = "";
    if (rc === "2") rangeStr = await askQuestion(`Account number (1-${total}): `);
    else if (rc === "3") rangeStr = await askQuestion("Range (e.g. 3-end or 3-7): ");
    return { mode: "connect", range: rangeStr };
  }

  if (modeChoice === "5") {
    // Double or Nothing mode — 1 play per account, restart script to play again
    console.log("\nSelect account range for Double or Nothing:");
    console.log("  1. All accounts");
    console.log("  2. Single account");
    console.log("  3. Range (e.g. 3-end or 3-7)");
    const rc = await askQuestion("Choice: ");
    let rangeStr = "";
    if (rc === "2") rangeStr = await askQuestion(`Account number (1-${total}): `);
    else if (rc === "3") rangeStr = await askQuestion("Range (e.g. 3-end or 3-7): ");
    return { mode: "double", range: rangeStr };
  }

  if (modeChoice === "4") {
    // Chat mode — with account range selection
    const targetStr = await askQuestion("Target points to collect (default 2500): ");
    const target = parseInt(targetStr, 10) || 2500;

    const chatsPerAcctStr = await askQuestion("Chats per account per round (default 1): ");
    const chatsPerAcct = Math.max(1, parseInt(chatsPerAcctStr, 10) || 1);

    console.log("\nSelect account range for chat:");
    console.log("  1. All accounts");
    console.log("  2. Single account");
    console.log("  3. Range (e.g. 3-end or 3-7)");
    const rc = await askQuestion("Choice: ");
    let rangeStr = "";
    if (rc === "2") rangeStr = await askQuestion(`Account number (1-${total}): `);
    else if (rc === "3") rangeStr = await askQuestion("Range (e.g. 3-end or 3-7): ");
    return { mode: "chat", range: rangeStr, targetPoints: target, chatsPerAcct };
  }

  if (modeChoice === "3") {
    // Buy mode
    console.log("\nSelect item:");
    const itemKeys = Object.keys(ITEMS);
    itemKeys.forEach((k, i) => console.log(`  ${i + 1}. ${k} (${ITEMS[k]} BP)`));
    const itemIdx = parseInt(await askQuestion("Item number: "), 10) - 1;
    const itemKey = itemKeys[itemIdx];
    if (!itemKey) {
      console.log("❌ Invalid item");
      process.exit(1);
    }
    const price = ITEMS[itemKey];
    console.log(`\nSelect account range for buy ${itemKey}:`);
    console.log("  1. All accounts");
    console.log("  2. Single account");
    console.log("  3. Range");
    const rc = await askQuestion("Choice: ");
    let rangeStr = "";
    if (rc === "2") rangeStr = await askQuestion(`Account number (1-${total}): `);
    else if (rc === "3") rangeStr = await askQuestion("Range (e.g. 3-end or 3-7): ");
    return { mode: "buy", range: rangeStr, itemKey, price };
  }

  // Default mode: connect + task
  console.log("\nSelect account range:");
  console.log("  1. Single account");
  console.log("  2. All accounts");
  console.log("  3. Range (from X to end/Y)");
  const rc = await askQuestion("Choice (1/2/3): ");
  if (rc === "1") return { mode: "task", range: await askQuestion(`Account number (1-${total}): `) };
  if (rc === "3") return { mode: "task", range: await askQuestion("Range (e.g. 3-end or 3-7): ") };
  return { mode: "task", range: "" };
}

function parseRange(arg, total) {
  if (!arg) return { start: 0, end: total };

  if (/^\d+$/.test(arg)) {
    const idx = parseInt(arg, 10);
    return { start: idx - 1, end: idx };
  }

  const match = arg.match(/^(\d+)-(end|\d+)$/i);
  if (match) {
    const start = parseInt(match[1], 10) - 1;
    const end = match[2].toLowerCase() === "end" ? total : parseInt(match[2], 10);
    return { start, end };
  }

  console.log(`⚠️  Unrecognized format: "${arg}". Running all.`);
  return { start: 0, end: total };
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log("🔑 Checking latest anon key from floks.fun...");
  const gotFreshKey = await refreshAnonKey("startup");
  console.log(
    gotFreshKey
      ? "✅ Anon key ready"
      : "⚠️  Auto-scrape failed, using hardcoded fallback (may be stale)"
  );

  const allAccounts = await loadAccounts("akun.txt");
  console.log(`📋 Total accounts: ${allAccounts.length}`);

  const menuResult = await showMenu(allAccounts.length);
  const { mode, range, itemKey, price, targetPoints } = menuResult;

  const { start, end } = parseRange(range, allAccounts.length);
  const accounts = allAccounts.slice(start, end);

  console.log(`▶️  Mode: ${mode} | Accounts ${start + 1} to ${Math.min(end, allAccounts.length)}\n`);

  // Load refresh tokens
  const tokens = await loadRefreshTokens("refresh.txt");
  while (tokens.length < allAccounts.length) tokens.push("");

  let success = 0;
  let fail = 0;

  // ── Mode: chat ────────────────────────────────────────────
  if (mode === "chat") {
    await runChatMode(allAccounts, tokens, targetPoints, 12, start, end, menuResult.chatsPerAcct ?? 1);
    return;
  }

  // ── Mode: connect X only ──────────────────────────────────
  if (mode === "connect") {
    for (let i = 0; i < accounts.length; i++) {
      const realIdx = start + i + 1;
      const tokenIdx = start + i;
      const { authToken, ct0 } = accounts[i];
      const label = `[Account ${realIdx}]`;

      const existing = tokens[tokenIdx]?.trim();
      if (existing) {
        console.log(`${label} ✔️  Token already exists, skip`);
        success++;
        continue;
      }

      console.log(`${label} 🔗 Connecting X...`);
      const newToken = await connectAndGetToken(authToken, ct0, realIdx);
      if (!newToken) {
        console.log(`${label} ❌ Connect failed`);
        fail++;
      } else {
        tokens[tokenIdx] = newToken;
        await saveRefreshTokens("refresh.txt", tokens);
        console.log(`${label} ✅ Connected, refresh_token saved`);
        success++;
      }
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1500));
    }
    console.log(`\n📊 Connect Only: ${success} success, ${fail} failed out of ${accounts.length} accounts`);
    return;
  }

  // ── Mode: double or nothing ───────────────────────────────
  if (mode === "double") {
    console.log(`🎲 Double or Nothing | 1x per account\n`);
    for (let i = 0; i < accounts.length; i++) {
      const realIdx = start + i + 1;
      const tokenIdx = start + i;
      const refreshToken = tokens[tokenIdx]?.trim();

      if (!refreshToken) {
        console.log(`[Account ${realIdx}] ❌ No token yet, skip (run task mode first)`);
        fail++;
        continue;
      }

      const ok = await processDoubleOrNothing(refreshToken, realIdx, tokens, "refresh.txt", 1);
      ok ? success++ : fail++;
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    }
    console.log(`\n📊 Double or Nothing: ${success} success, ${fail} failed out of ${accounts.length} accounts`);
    return;
  }

  // ── Mode: vote ────────────────────────────────────────────
  if (mode === "vote") {
    for (let i = 0; i < accounts.length; i++) {
      const realIdx = start + i + 1;
      const tokenIdx = start + i;
      let refreshToken = tokens[tokenIdx]?.trim();

      if (!refreshToken) {
        console.log(`[Account ${realIdx}] ❌ No token yet, skip (run task mode first)`);
        fail++;
        continue;
      }

      const ok = await processVote(refreshToken, realIdx, tokens, "refresh.txt", "instant");
      ok ? success++ : fail++;
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    }
    console.log(`\n📊 Vote: ${success} success, ${fail} failed out of ${accounts.length} accounts`);
    return;
  }

  // ── Mode: buy ─────────────────────────────────────────────
  if (mode === "buy") {
    for (let i = 0; i < accounts.length; i++) {
      const realIdx = start + i + 1;
      const tokenIdx = start + i;
      let refreshToken = tokens[tokenIdx]?.trim();

      if (!refreshToken) {
        console.log(`[Account ${realIdx}] ❌ No token yet, skip (run task mode first)`);
        fail++;
        continue;
      }

      const ok = await processBuy(refreshToken, realIdx, tokens, "refresh.txt", itemKey, price);
      ok ? success++ : fail++;
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    }
    console.log(`\n📊 Buy ${itemKey}: ${success} success, ${fail} failed out of ${accounts.length} accounts`);
    return;
  }

  // ── Mode: connect + task (default) ───────────────────────
  for (let i = 0; i < accounts.length; i++) {
    const realIdx = start + i + 1;
    const tokenIdx = start + i;
    const { authToken, ct0 } = accounts[i];
    const label = `[Account ${realIdx}]`;

    let refreshToken = tokens[tokenIdx]?.trim();

    if (!refreshToken) {
      console.log(`${label} 🔗 No token yet, connecting X first...`);
      const newToken = await connectAndGetToken(authToken, ct0, realIdx);

      if (!newToken) {
        console.log(`${label} ❌ Connect failed, skip task`);
        fail++;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      tokens[tokenIdx] = newToken;
      await saveRefreshTokens("refresh.txt", tokens);
      console.log(`${label} 💾 refresh_token saved`);
      refreshToken = newToken;
    } else {
      console.log(`${label} ✔️  Token exists, skip connect`);
    }

    const xProfile = await fetchXProfile(authToken, ct0);
    const ok = await processTasks(refreshToken, realIdx, tokens, "refresh.txt", xProfile);
    ok ? success++ : fail++;

    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
  }

  console.log(`\n📊 Result: ${success} success, ${fail} failed out of ${accounts.length} accounts`);
}

main();
