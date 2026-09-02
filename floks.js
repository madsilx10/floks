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
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtraHR0bWp2b2t6dGxjdHRmYmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1Mzg1MDAsImV4cCI6MjEwMzExMzQ4MH0.CE6p0ta8Qi_4dXUGC0IEY0hl3UTSrqOIcjxsHgKyWxE";

// task_key -> poin. Tambahin di sini kalau nemu task baru
const TASKS = {
  follow: 100,
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
      "&code_challenge_method=s256";

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

    // Step 4: Follow callback → floks.fun, intercept session dari Supabase
    // Supabase callback exchange code → session, kita ikutin redirect manual
    const r4 = await fetch(redirectUri, {
      method: "GET",
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*", "Upgrade-Insecure-Requests": "1", Cookie: cookie },
      redirect: "manual",
    });

    const loc4 = r4.headers.get("location") || "";
    console.log(`${label} Step4 ${r4.status} → ${loc4.slice(0, 80)}...`);

    // Supabase exchange code dulu → dapat session
    // URL callback floks berisi ?code= → kita POST ke Supabase token endpoint
    const callbackUrl = loc4 || redirectUri;
    const codeMatch = callbackUrl.match(/[?&]code=([^&]+)/);
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

      const session = await r5.json().catch(() => ({}));
      console.log(`${label} Step5 ${r5.status} → refresh_token=${session.refresh_token ? session.refresh_token.slice(0, 12) + "..." : "TIDAK ADA"}`);

      if (session.refresh_token) {
        console.log(`${label} ✅ Connect berhasil, refresh_token didapat`);
        return session.refresh_token;
      }
    }

    // Fallback: coba follow redirect penuh dan tangkap dari fragment/cookie
    const r4b = await fetch(redirectUri, {
      method: "GET",
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*", "Upgrade-Insecure-Requests": "1", Cookie: cookie },
      redirect: "follow",
    });

    const finalUrl = r4b.url;
    console.log(`${label} Step4b ${r4b.status} → ${finalUrl.slice(0, 80)}...`);

    if (finalUrl.includes("floks.fun")) {
      // Coba ambil dari response body (Supabase kadang embed session di HTML)
      const body = await r4b.text();
      const rtMatch = body.match(/"refresh_token"\s*:\s*"([^"]+)"/);
      if (rtMatch) {
        console.log(`${label} ✅ Connect berhasil, refresh_token dari body`);
        return rtMatch[1];
      }
      console.log(`${label} ⚠️  Connect OK tapi refresh_token tidak tertangkap`);
      return null;
    }

    console.log(`${label} ❌ Gagal, final: ${finalUrl}`);
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
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
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

  const data = await res.json().catch(() => ({}));

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
  return res.status === 201 || res.status === 200;
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

async function processTasks(refreshToken, idx, tokensRef, filepath) {
  const label = `[Akun ${idx}]`;

  try {
    const { accessToken, refreshToken: newRefreshToken, residentId } = await refreshSession(refreshToken);

    // Simpan refresh_token baru SEGERA (rotasi — token lama invalid)
    tokensRef[idx - 1] = newRefreshToken;
    await saveRefreshTokens(filepath, tokensRef);

    console.log(`${label} 🔑 Session OK (resident_id=${residentId})`);

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
  console.log("  1. Jalankan 1 akun");
  console.log("  2. Jalankan semua akun");
  console.log("  3. Range (dari X sampai akhir/Y)");

  const choice = await askQuestion("Masukin pilihan (1/2/3): ");

  if (choice === "1") {
    return await askQuestion(`Nomor akun (1-${total}): `);
  }
  if (choice === "3") {
    return await askQuestion("Range (contoh: 3-end atau 3-7): ");
  }
  return ""; // semua
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

// ── Main: 1 mode, auto connect → task ────────────────────────
async function main() {
  const rangeArg = process.argv[2]; // opsional

  const allAccounts = await loadAccounts("akun.txt");
  console.log(`📋 Total akun: ${allAccounts.length}`);

  const arg = rangeArg ?? await showMenu(allAccounts.length);
  const { start, end } = parseRange(arg, allAccounts.length);
  const accounts = allAccounts.slice(start, end);

  console.log(`▶️  Proses akun ${start + 1} s/d ${Math.min(end, allAccounts.length)}\n`);

  // Load refresh tokens yang sudah ada
  const tokens = await loadRefreshTokens("refresh.txt");
  // Pastikan array cukup panjang
  while (tokens.length < allAccounts.length) tokens.push("");

  let success = 0;
  let fail = 0;

  for (let i = 0; i < accounts.length; i++) {
    const realIdx = start + i + 1;
    const tokenIdx = start + i;
    const { authToken, ct0 } = accounts[i];
    const label = `[Akun ${realIdx}]`;

    let refreshToken = tokens[tokenIdx]?.trim();

    // Kalau belum punya refresh_token → connect dulu
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

    // Klaim task
    const ok = await processTasks(refreshToken, realIdx, tokens, "refresh.txt");
    ok ? success++ : fail++;

    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
  }

  console.log(`\n📊 Hasil: ${success} berhasil, ${fail} gagal dari ${accounts.length} akun`);
}

main();
