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

// ── Konfigurasi Supabase (floks.fun) ─────────────────────────
const SUPABASE_URL = "https://kkhttmjvokztlcttfbcy.supabase.co";

// Fallback kalau auto-scrape gagal (misal jaringan bermasalah pas startup).
// Ini BUKAN sumber utama lagi — di awal main() bakal dicoba refresh otomatis.
let ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtraHR0bWp2b2t6dGxjdHRmYmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1Mzg1MDAsImV4cCI6MjEwMzExNDUwMH0.CE6p0ta8Qi_4dXUGC0IEY0hl3UTSrqOIcjxsHgKyWxE";

// ── Auto-scrape anon key terbaru dari floks.fun ───────────────
// Anon key Supabase memang publik by design → nongol di bundle JS frontend.
// Nama file bundle-nya berubah tiap deploy (hash Vite), jadi kita ambil
// dulu daftar file dari HTML, baru cari pola JWT di masing-masing file.
async function fetchLatestAnonKey() {
  try {
    const htmlRes = await fetch("https://floks.fun/", {
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*" },
    });
    const html = await htmlRes.text();

    // Ambil semua kandidat file JS yang di-reference di HTML
    const srcMatches = [...html.matchAll(/(?:src|href)="(\/[^"]+\.js)"/g)].map((m) => m[1]);
    const uniqueSrcs = [...new Set(srcMatches)];

    if (uniqueSrcs.length === 0) {
      console.log("⚠️  Auto-scrape: ga nemu file .js di HTML floks.fun");
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
        // file ini gagal di-fetch/parse, lanjut coba file berikutnya
        continue;
      }
    }

    console.log("⚠️  Auto-scrape: udah cek semua file .js, ga nemu pola anon key");
    return null;
  } catch (err) {
    console.log(`⚠️  Auto-scrape anon key gagal: ${err.message}`);
    return null;
  }
}

// Update ANON_KEY global kalau scrape berhasil dan hasilnya beda dari yang lama
async function refreshAnonKey(reason = "") {
  const newKey = await fetchLatestAnonKey();
  if (newKey && newKey !== ANON_KEY) {
    ANON_KEY = newKey;
    console.log(`🔄 ANON_KEY di-update otomatis${reason ? ` (${reason})` : ""}`);
    return true;
  }
  if (newKey) return true; // sama kayak yang lama, tetep valid
  return false; // scrape gagal total
}

// Deteksi respons Supabase yang nunjukin anon key invalid/basi
function isInvalidApiKeyError(data) {
  const msg = `${data?.message || ""} ${data?.hint || ""}`.toLowerCase();
  return msg.includes("invalid api key") || msg.includes("anon");
}

// task_key -> poin. Tambahin di sini kalau nemu task baru
const TASKS = {
  follow: 100,
  quote_2095075830: 100,
  tag2_2095075830: 100,
  like_rt_2095075830: 100,
};

// item_key -> harga BP
const ITEMS = {
  water: 150,
  thermometer: 350,
  bulb: 300,
  incubator: 600,
  nest: 100,
};

// ── Load akun dari akun.txt ───────────────────────────────────
async function loadAccounts(filepath) {
  const content = await fs.readFile(filepath, "utf-8");
  const blocks = content.trim().split(/\n\n+/);
  const accounts = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      accounts.push({ authToken: lines[0], ct0: lines[1] });
    } else {
      console.warn(`⚠️  Skip block tidak valid: ${JSON.stringify(block)}`);
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

// ── Connect X + auto-capture refresh_token ───────────────────
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
      console.log(`${label} ❌ Tidak redirect ke X`);
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

    // Step 2b: GET api.x.com/2/oauth2/authorize (JSON) buat ambil auth_code
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
    console.log(`${label} Step2b ${r2b.status} → auth_code=${authCode ? authCode.slice(0, 12) + "..." : "TIDAK ADA"}`);

    if (!authCode) {
      console.log(`${label} ❌ Tidak dapat auth_code:`, json2b);
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
      console.log(`${label} ❌ Tidak dapat redirect_uri:`, json3);
      return null;
    }

    // Step 4: Hit redirectUri SEKALI SAJA (one-time use) → intercept loc4
    const r4 = await fetch(redirectUri, {
      method: "GET",
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*", "Upgrade-Insecure-Requests": "1", Cookie: cookie },
      redirect: "manual",
    });

    const loc4 = r4.headers.get("location") || "";
    console.log(`${label} Step4 ${r4.status} → ${loc4.slice(0, 80)}...`);

    // Cari ?code= dari loc4 (Supabase redirect ke floks.fun/callback?code=...)
    // JANGAN cari dari redirectUri — sudah dipakai
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
      console.log(`${label} Step5 ${r5.status} → refresh_token=${session.refresh_token ? session.refresh_token.slice(0, 12) + "..." : "TIDAK ADA"}`);

      if (session.refresh_token) {
        console.log(`${label} ✅ Connect berhasil, refresh_token didapat`);
        return session.refresh_token;
      }

      // Step5 gagal → cek apakah gara-gara anon key basi, kalau iya scrape ulang & retry sekali
      if (isInvalidApiKeyError(session)) {
        console.log(`${label} 🔍 Kemungkinan anon key basi, coba scrape ulang...`);
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
            console.log(`${label} ✅ Connect berhasil setelah retry, refresh_token didapat`);
            return session.refresh_token;
          }
        }
      }

      console.log(`${label} ❌ Step5 gagal:`, session);
      return null;
    }

    // Tidak ada ?code= di loc4 → coba follow loc4 (BUKAN redirectUri lagi)
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
          console.log(`${label} ✅ Connect berhasil, refresh_token dari body`);
          return rtMatch[1];
        }
      }
    } else if (loc4.includes("error=")) {
      console.log(`${label} ❌ Supabase error di loc4: ${loc4.slice(0, 120)}`);
    }

    console.log(`${label} ⚠️  Connect OK tapi refresh_token tidak tertangkap`);
    return null;
  } catch (err) {
    console.log(`${label} ❌ Error: ${err.message}`);
    return null;
  }
}

// ── Task claiming ─────────────────────────────────────────────
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

  // Anon key basi → scrape ulang & retry sekali sebelum nyerah
  if (!res.ok && isInvalidApiKeyError(data)) {
    console.log(`🔍 refreshSession: kemungkinan anon key basi, coba scrape ulang...`);
    const refreshed = await refreshAnonKey("dipicu refreshSession gagal");
    if (refreshed) {
      res = await doRefresh();
      data = await res.json().catch(() => ({}));
    }
  }

  if (!res.ok || !data.access_token) {
    throw new Error(`refresh gagal (${res.status}): ${JSON.stringify(data)}`);
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

// ── Ambil profil X (buat upsert residents) ────────────────────
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

    // settings.json ga ngasih 'name' & avatar, jadi ambil dari endpoint users/by
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

// Pastikan row residents ada (upsert) sebelum claim task
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

// ── Patch referred_by ke residents ───────────────────────────
// referred_by adalah UUID, jadi harus lookup UUID referrer dulu by handle
async function patchReferredBy(accessToken, residentId, refHandle) {
  // 1. Lookup UUID referrer
  const refId = await getResidentIdByHandle(accessToken, refHandle);
  if (!refId) {
    console.log(`   ↳ patchReferredBy: handle "${refHandle}" tidak ditemukan di residents, skip`);
    return false;
  }
  // 2. PATCH kolom referred_by (hanya kalau belum keisi)
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/residents?select=referred_by&id=eq.${residentId}`,
    { method: "GET", headers: taskHeaders(accessToken) }
  );
  const checkData = await checkRes.json().catch(() => []);
  if (checkData?.[0]?.referred_by) return true; // sudah keisi, skip

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

// ── Ambil resident_id by handle ───────────────────────────────
async function getResidentIdByHandle(accessToken, handle) {
  const url = `${SUPABASE_URL}/rest/v1/residents?select=id&handle=eq.${encodeURIComponent(handle)}`;
  const res = await fetch(url, { method: "GET", headers: taskHeaders(accessToken) });
  const data = await res.json().catch(() => []);
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0].id;
}

// ── Chat mode ─────────────────────────────────────────────────
const CHAT_POOL = [
  "wah seru juga nih proyeknya", "kapan launch mainnet?", "udah nyoba fitur barunya belum",
  "gas terus", "komunitas makin rame nih", "semangat terus timnya", "keep building!",
  "udah berapa lama proyek ini jalan?", "roadmap Q4 gimana?", "tokenomics nya menarik",
  "siapa aja yang bakal listing ini?", "airdrop masih jalan kan?", "udah connect wallet belum",
  "ini chain apa yang dipake?", "explorer nya ada ga?", "testnet masih aktif",
  "gw baru join nih, minta info dong", "ada tutorial ga buat newbie?", "discord aktif ga?",
  "tg bot nya keren juga", "whitepaper udah ada?", "audit kapan rilis?",
  "backing siapa aja?", "tim doxxed?", "vesting schedulenya gimana?",
  "supply total berapa?", "initial circulating berapa?", "listing di mana aja rencananya?",
  "staking APR berapa?", "ada liquidity mining ga?", "yield farming ada?",
  "NFT ada juga?", "governance udah aktif?", "snapshot kapan?",
  "claim udah bisa?", "gas fee murah banget", "transaksi cepet juga",
  "block timenya berapa detik?", "TPS berapa?", "finality cepet",
  "evm compatible?", "ada bridge ke ETH?", "cross-chain support?",
  "sdk udah ada?", "api docs lengkap ga?", "developer friendly banget",
  "hackathon ada ga?", "grant program ada?", "ecosystem fund berapa?",
  "ambassador program open?", "referral system keren", "poin system bagus",
  "reward struktur menarik", "farming strategy apa yang bagus?", "worth it di farm",
  "volume makin tinggi", "holder makin banyak", "growing fast",
  "bullish sama proyek ini", "long term hold", "potential banget",
  "underrated project", "hidden gem nih", "alpha dapet dari sini",
  "community solid", "dev aktif", "update rutin bagus",
  "transparansi bagus", "komunikasi timnya ok", "progress report ada tiap minggu",
  "milestone udah tercapai", "on track sesuai roadmap", "ahead of schedule",
  "partnership baru kapan?", "kolaborasi sama siapa lagi?", "ekosistem makin luas",
  "user growth bagus", "metric on-chain positif", "TVL naik terus",
  "liquidity deepening", "slippage kecil", "DEX volume oke",
  "staking rewards udah klaim", "compound tiap berapa?", "auto-compound ada?",
  "lock period berapa lama?", "unstake butuh waktu berapa?", "penalty ada ga?",
  "referral udah aktif?", "berapa level referral?", "passive income oke",
  "farming season kapan mulai?", "event baru kapan?", "campaign lagi jalan",
  "leaderboard ada?", "rank gw berapa ya?", "kompetisi farming seru",
  "hadiah top farmer apa?", "prize pool berapa?", "menarik banget event ini",
  "udah invite teman?", "ajak yang lain masuk", "spread the word",
  "share ke twitter dulu", "retweet dah", "viral in progress",
  "influencer udah support?", "KOL ada yang endorse?", "media coverage bagus",
  "coingecko listing udah?", "coinmarketcap kapan?", "dexscreener udah",
  "chart lagi bagus", "support kuat", "resistance dimana?",
  "FOMO mulai", "accumulate terus", "DCA aja",
  "wallet connect lancar", "metamask compatible", "rabby bisa dipake",
  "mobile friendly", "UI clean", "UX bagus",
  "loading cepet", "ga ada bug", "smooth banget",
  "feedback positif dari community", "rating bagus", "review oke",
  "keep up the good work", "proud of this project", "excited sama future nya",
  "gm everyone", "gn fam", "wagmi",
  "ngga sabar nunggu mainnet", "countdown dimulai", "soon",
  "lets go!", "to the moon", "this is the way",
  "ser nanya dong", "mod ada?", "ada yang bisa bantu?",
  "pertanyaan soal staking", "cara klaim gimana?", "tutorial where",
  "step by step ada?", "video guide ada ga?", "youtube channel?",
  "dokumentasi lengkap", "FAQ udah ada", "support ticket gimana?",
  "response time cepet", "helpful team", "good support",
  "appreciate the transparency", "open source?", "github aktif",
  "commit tiap hari", "code quality bagus", "well documented",
  "security first", "audit passed", "no rug guarantee",
  "tim berpengalaman", "track record bagus", "credible project",
];

function randomChat() {
  return CHAT_POOL[Math.floor(Math.random() * CHAT_POOL.length)];
}

// Kirim 1 pesan chat
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

// Hitung total poin yang udah dikumpulkan dari semua akun
async function getTotalPoints(accessToken, residentId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/residents?select=points&id=eq.${residentId}`,
    { method: "GET", headers: taskHeaders(accessToken) }
  );
  const data = await res.json().catch(() => []);
  return data?.[0]?.points ?? 0;
}

// Mode chat: loop akun 1→N terus sampe target poin terpenuhi
async function runChatMode(allAccounts, tokens, targetPoints, pointsPerChat) {
  const totalAccounts = allAccounts.length;
  let globalPoints = 0; // estimasi poin terkumpul (12 per chat berhasil)
  let totalChatSent = 0;
  let round = 1;

  // Berapa chat yang dibutuhkan
  const chatsNeeded = Math.ceil(targetPoints / pointsPerChat);
  console.log(`\n🎯 Target: ${targetPoints} poin | ${pointsPerChat} poin/chat | ~${chatsNeeded} chat total`);
  console.log(`👥 ${totalAccounts} akun, loop terus sampe target tercapai\n`);

  while (globalPoints < targetPoints) {
    console.log(`\n━━━ Round ${round} ━━━ (estimasi poin: ${globalPoints}/${targetPoints})`);

    for (let i = 0; i < totalAccounts; i++) {
      if (globalPoints >= targetPoints) break;

      const realIdx = i + 1;
      const label = `[Akun ${realIdx}]`;
      let refreshToken = tokens[i]?.trim();

      if (!refreshToken) {
        console.log(`${label} ⏭️  Belum ada token, skip`);
        continue;
      }

      try {
        const { accessToken, refreshToken: newRT, residentId } = await refreshSession(refreshToken);
        tokens[i] = newRT;
        await saveRefreshTokens("refresh.txt", tokens);

        // Jumlah chat per akun per round: random 1–4 biar natural
        const chatCount = 1 + Math.floor(Math.random() * 4);
        console.log(`${label} 💬 Kirim ${chatCount} chat...`);

        for (let c = 0; c < chatCount; c++) {
          if (globalPoints >= targetPoints) break;
          const ok = await sendChat(accessToken, residentId);
          if (ok) {
            globalPoints += pointsPerChat;
            totalChatSent++;
            console.log(`${label} ✅ Chat ${c + 1}/${chatCount} terkirim (+${pointsPerChat}p) → total estimasi: ${globalPoints}p`);
          } else {
            console.log(`${label} ❌ Chat ${c + 1}/${chatCount} gagal`);
          }
          // Jeda antar chat dalam 1 akun: 3–8 detik
          if (c < chatCount - 1) {
            const delay = 3000 + Math.floor(Math.random() * 5000);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      } catch (err) {
        console.log(`${label} ❌ Error: ${err.message}`);
      }

      // Jeda antar akun: 2–5 detik
      const acctDelay = 2000 + Math.floor(Math.random() * 3000);
      await new Promise((r) => setTimeout(r, acctDelay));
    }

    round++;

    // Safety: kalau semua akun udah diproses tapi belum capai target, kasih jeda antar round
    if (globalPoints < targetPoints) {
      const roundDelay = 10000 + Math.floor(Math.random() * 10000);
      console.log(`\n⏳ Jeda antar round: ${(roundDelay / 1000).toFixed(1)}s`);
      await new Promise((r) => setTimeout(r, roundDelay));
    }
  }

  console.log(`\n✅ Target tercapai! Total chat terkirim: ${totalChatSent} | Estimasi poin: ${globalPoints}`);
}

// ── Vote (instant) ─────────────────────────────────────────────
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

// ── Buy item ───────────────────────────────────────────────────
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

// ── Mode: vote semua akun ─────────────────────────────────────
async function processVote(refreshToken, idx, tokensRef, filepath, choice = "instant") {
  const label = `[Akun ${idx}]`;
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

// ── Mode: buy item semua akun ─────────────────────────────────
async function processBuy(refreshToken, idx, tokensRef, filepath, itemKey, price) {
  const label = `[Akun ${idx}]`;
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
  const label = `[Akun ${idx}]`;

  try {
    const { accessToken, refreshToken: newRefreshToken, residentId } = await refreshSession(refreshToken);

    // Simpan refresh_token baru SEGERA (rotasi — token lama invalid)
    tokensRef[idx - 1] = newRefreshToken;
    await saveRefreshTokens(filepath, tokensRef);

    console.log(`${label} 🔑 Session OK (resident_id=${residentId})`);

    // Pastikan row residents ada dulu sebelum claim (fix FK violation)
    const okResident = await ensureResident(accessToken, residentId, xProfile);
    console.log(`${label} ${okResident ? "✅" : "⚠️"} ensureResident`);

    const done = await getDoneTasks(accessToken, residentId);

    for (const [taskKey, points] of Object.entries(TASKS)) {
      if (done.has(taskKey)) {
        console.log(`${label} ⏭️  "${taskKey}" udah selesai`);
        continue;
      }
      const ok = await claimTask(accessToken, residentId, taskKey, points);
      console.log(`${label} ${ok ? "✅" : "❌"} klaim "${taskKey}" (+${points})`);
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

// ── Menu & range parsing ──────────────────────────────────────
function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function showMenu(total) {
  console.log("\nPilih mode:");
  console.log("  1. Connect X + Task");
  console.log("  2. Vote (instant)");
  console.log("  3. Buy Item");
  console.log("  4. Chat (farming poin)");

  const modeChoice = await askQuestion("Masukin mode (1/2/3/4): ");

  if (modeChoice === "2") {
    // Mode vote
    console.log("\nPilih range akun untuk vote:");
    console.log("  1. Semua akun");
    console.log("  2. 1 akun");
    console.log("  3. Range");
    const rc = await askQuestion("Pilihan: ");
    let rangeStr = "";
    if (rc === "2") rangeStr = await askQuestion(`Nomor akun (1-${total}): `);
    else if (rc === "3") rangeStr = await askQuestion("Range (contoh: 3-end atau 3-7): ");
    return { mode: "vote", range: rangeStr };
  }

  if (modeChoice === "4") {
    // Mode chat
    const targetStr = await askQuestion("Target poin yang mau dikumpulkan (default 2500): ");
    const target = parseInt(targetStr, 10) || 2500;
    return { mode: "chat", range: "", targetPoints: target };
  }

  if (modeChoice === "3") {
    // Mode buy
    console.log("\nPilih item:");
    const itemKeys = Object.keys(ITEMS);
    itemKeys.forEach((k, i) => console.log(`  ${i + 1}. ${k} (${ITEMS[k]} BP)`));
    const itemIdx = parseInt(await askQuestion("Nomor item: "), 10) - 1;
    const itemKey = itemKeys[itemIdx];
    if (!itemKey) {
      console.log("❌ Item tidak valid");
      process.exit(1);
    }
    const price = ITEMS[itemKey];
    console.log(`\nPilih range akun untuk buy ${itemKey}:`);
    console.log("  1. Semua akun");
    console.log("  2. 1 akun");
    console.log("  3. Range");
    const rc = await askQuestion("Pilihan: ");
    let rangeStr = "";
    if (rc === "2") rangeStr = await askQuestion(`Nomor akun (1-${total}): `);
    else if (rc === "3") rangeStr = await askQuestion("Range (contoh: 3-end atau 3-7): ");
    return { mode: "buy", range: rangeStr, itemKey, price };
  }

  // Mode default: connect + task
  console.log("\nPilih range akun:");
  console.log("  1. Jalankan 1 akun");
  console.log("  2. Jalankan semua akun");
  console.log("  3. Range (dari X sampai akhir/Y)");
  const rc = await askQuestion("Pilihan (1/2/3): ");
  if (rc === "1") return { mode: "task", range: await askQuestion(`Nomor akun (1-${total}): `) };
  if (rc === "3") return { mode: "task", range: await askQuestion("Range (contoh: 3-end atau 3-7): ") };
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

  console.log(`⚠️  Format tidak dikenali: "${arg}". Jalanin semua.`);
  return { start: 0, end: total };
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log("🔑 Cek anon key terbaru dari floks.fun...");
  const gotFreshKey = await refreshAnonKey("startup");
  console.log(
    gotFreshKey
      ? "✅ Anon key siap dipakai"
      : "⚠️  Auto-scrape gagal, pakai fallback hardcoded (mungkin udah basi)"
  );

  const allAccounts = await loadAccounts("akun.txt");
  console.log(`📋 Total akun: ${allAccounts.length}`);

  const menuResult = await showMenu(allAccounts.length);
  const { mode, range, itemKey, price, targetPoints } = menuResult;

  const { start, end } = parseRange(range, allAccounts.length);
  const accounts = allAccounts.slice(start, end);

  console.log(`▶️  Mode: ${mode} | Akun ${start + 1} s/d ${Math.min(end, allAccounts.length)}\n`);

  // Load refresh tokens
  const tokens = await loadRefreshTokens("refresh.txt");
  while (tokens.length < allAccounts.length) tokens.push("");

  let success = 0;
  let fail = 0;

  // ── Mode: chat ────────────────────────────────────────────
  if (mode === "chat") {
    await runChatMode(allAccounts, tokens, targetPoints, 12);
    return;
  }

  // ── Mode: vote ────────────────────────────────────────────
  if (mode === "vote") {
    for (let i = 0; i < accounts.length; i++) {
      const realIdx = start + i + 1;
      const tokenIdx = start + i;
      let refreshToken = tokens[tokenIdx]?.trim();

      if (!refreshToken) {
        console.log(`[Akun ${realIdx}] ❌ Belum punya token, skip (jalankan mode task dulu)`);
        fail++;
        continue;
      }

      const ok = await processVote(refreshToken, realIdx, tokens, "refresh.txt", "instant");
      ok ? success++ : fail++;
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    }
    console.log(`\n📊 Vote: ${success} berhasil, ${fail} gagal dari ${accounts.length} akun`);
    return;
  }

  // ── Mode: buy ─────────────────────────────────────────────
  if (mode === "buy") {
    for (let i = 0; i < accounts.length; i++) {
      const realIdx = start + i + 1;
      const tokenIdx = start + i;
      let refreshToken = tokens[tokenIdx]?.trim();

      if (!refreshToken) {
        console.log(`[Akun ${realIdx}] ❌ Belum punya token, skip (jalankan mode task dulu)`);
        fail++;
        continue;
      }

      const ok = await processBuy(refreshToken, realIdx, tokens, "refresh.txt", itemKey, price);
      ok ? success++ : fail++;
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    }
    console.log(`\n📊 Buy ${itemKey}: ${success} berhasil, ${fail} gagal dari ${accounts.length} akun`);
    return;
  }

  // ── Mode: connect + task (default) ───────────────────────
  for (let i = 0; i < accounts.length; i++) {
    const realIdx = start + i + 1;
    const tokenIdx = start + i;
    const { authToken, ct0 } = accounts[i];
    const label = `[Akun ${realIdx}]`;

    let refreshToken = tokens[tokenIdx]?.trim();

    if (!refreshToken) {
      console.log(`${label} 🔗 Belum punya token, connect X dulu...`);
      const newToken = await connectAndGetToken(authToken, ct0, realIdx);

      if (!newToken) {
        console.log(`${label} ❌ Connect gagal, skip task`);
        fail++;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      tokens[tokenIdx] = newToken;
      await saveRefreshTokens("refresh.txt", tokens);
      console.log(`${label} 💾 refresh_token tersimpan`);
      refreshToken = newToken;
    } else {
      console.log(`${label} ✔️  Token ada, skip connect`);
    }

    const xProfile = await fetchXProfile(authToken, ct0);
    const ok = await processTasks(refreshToken, realIdx, tokens, "refresh.txt", xProfile);
    ok ? success++ : fail++;

    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
  }

  console.log(`\n📊 Hasil: ${success} berhasil, ${fail} gagal dari ${accounts.length} akun`);
}

main();
