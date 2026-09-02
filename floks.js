import fs from "fs/promises";
import readline from "readline";

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

// task_key -> poin. Tambahin di sini kalau nemu task baru (misal quote_<tweetId>)
const TASKS = {
  follow: 100,
};

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

async function connectAccount(authToken, ct0, idx) {
  const label = `[Akun ${idx}]`;
  const cookie = buildCookie(authToken, ct0);

  try {
    // Step 1: Supabase authorize → redirect ke X OAuth
    const supabaseUrl =
      "https://kkhttmjvokztlcttfbcy.supabase.co/auth/v1/authorize" +
      "?provider=x" +
      "&redirect_to=https%3A%2F%2Ffloks.fun%2Fcallback%3Fref%3Dmirzaeaj" +
      "&code_challenge=0_pc-aDqtmkhjDyUvjDKlur7f7_8zN25fDp4nfXfgPQ" +
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
      return false;
    }

    // Step 2: GET halaman authorize X
    const r2 = await fetch(location, {
      method: "GET",
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*", "Upgrade-Insecure-Requests": "1", Cookie: cookie },
      redirect: "follow",
    });

    const finalUrl2 = r2.url;
    console.log(`${label} Step2 ${r2.status} → ${finalUrl2.slice(0, 80)}...`);

    // Kalau langsung callback
    if (finalUrl2.includes("floks.fun") && finalUrl2.includes("code=")) {
      console.log(`${label} ✅ Langsung dapat callback`);
      return true;
    }

    // Step 2b: GET api.x.com/2/oauth2/authorize (JSON) buat ambil "code" request-nya
    const authorizeParams = new URL(location).search; // ambil query string dari URL step1
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
      console.log(`${label} ❌ Tidak dapat code request:`, json2b);
      return false;
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
      return false;
    }

    // Step 4: Follow callback → floks.fun
    const r4 = await fetch(redirectUri, {
      method: "GET",
      headers: { ...BASE_HEADERS, Accept: "text/html,*/*", "Upgrade-Insecure-Requests": "1", Cookie: cookie },
      redirect: "follow",
    });

    const finalUrl4 = r4.url;
    console.log(`${label} Step4 ${r4.status} → ${finalUrl4.slice(0, 80)}...`);

    if (finalUrl4.includes("floks.fun")) {
      console.log(`${label} ✅ Berhasil connect!`);
      return true;
    } else {
      console.log(`${label} ❌ Gagal, final: ${finalUrl4}`);
      return false;
    }
  } catch (err) {
    console.log(`${label} ❌ Error: ${err.message}`);
    return false;
  }
}

// ── Task claiming (floks.fun / Supabase) ─────────────────────
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
    refreshToken: data.refresh_token, // token baru — rotasi, WAJIB disimpen ulang
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

async function loadRefreshTokens(filepath) {
  try {
    const content = await fs.readFile(filepath, "utf-8");
    return content.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    console.log(`⚠️  Gagal baca ${filepath}. Buat file ini, satu refresh_token per baris, urutan sejajar sama akun.txt.`);
    return [];
  }
}

async function saveRefreshTokens(filepath, tokens) {
  await fs.writeFile(filepath, tokens.join("\n") + "\n", "utf-8");
}

async function processTasks(refreshToken, idx, tokensRef, filepath) {
  const label = `[Akun ${idx}]`;

  try {
    const { accessToken, refreshToken: newRefreshToken, residentId } = await refreshSession(refreshToken);

    // Simpan refresh_token baru SEGERA (token lama sudah invalid habis dipakai)
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
    console.log(`${label} ❌ Error: ${err.message}`);
    return false;
  }
}

// ── Menu interaktif (muncul kalau dijalanin tanpa argumen) ───
function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function showModeMenu() {
  console.log("\nMau ngapain:");
  console.log("  1. Connect X (OAuth)");
  console.log("  2. Klaim task + cek balance");
  const choice = await askQuestion("Pilih (1/2): ");
  return choice === "2" ? "task" : "connect";
}

async function showMenu(total) {
  console.log("\nPilih mode:");
  console.log("  1. Jalankan 1 akun");
  console.log("  2. Jalankan semua akun");
  console.log("  3. Range (dari X sampai akhir/Y)");

  const choice = await askQuestion("Masukin pilihan (1/2/3): ");

  if (choice === "1") {
    const idx = await askQuestion(`Nomor akun (1-${total}): `);
    return idx;
  }
  if (choice === "3") {
    const range = await askQuestion("Range (contoh: 3-end atau 3-7): ");
    return range;
  }
  // default / choice === "2"
  return "";
}

// ── Parsing argumen CLI ──────────────────────────────────────
// node floks.js                  → munculin menu interaktif (pilih mode dulu)
// node floks.js connect 5        → connect X, cuma akun nomor 5
// node floks.js connect 3-end    → connect X, dari akun 3 sampai akhir
// node floks.js task             → klaim task + cek balance, semua akun
// node floks.js task 3-7         → klaim task akun 3 sampai 7
// node floks.js 5                → (kompatibel lama) connect, akun nomor 5
function parseRange(arg, total) {
  if (!arg) return { start: 0, end: total }; // semua

  if (/^\d+$/.test(arg)) {
    // 1 akun spesifik
    const idx = parseInt(arg, 10);
    return { start: idx - 1, end: idx };
  }

  const match = arg.match(/^(\d+)-(end|\d+)$/i);
  if (match) {
    const start = parseInt(match[1], 10) - 1;
    const end = match[2].toLowerCase() === "end" ? total : parseInt(match[2], 10);
    return { start, end };
  }

  console.log(`⚠️  Format argumen tidak dikenali: "${arg}". Jalanin semua akun.`);
  return { start: 0, end: total };
}

async function runConnect(arg) {
  const allAccounts = await loadAccounts("akun.txt");
  console.log(`📋 Total akun: ${allAccounts.length}`);

  if (!arg) arg = await showMenu(allAccounts.length);
  const { start, end } = parseRange(arg, allAccounts.length);
  const accounts = allAccounts.slice(start, end);

  console.log(`▶️  Connect X: ${arg || "semua"} → akun ${start + 1} s/d ${Math.min(end, allAccounts.length)}\n`);

  let success = 0;
  let fail = 0;

  for (let i = 0; i < accounts.length; i++) {
    const { authToken, ct0 } = accounts[i];
    const realIdx = start + i + 1;
    console.log(`── Akun ${realIdx} auth_token=${authToken.slice(0, 12)}...`);
    const ok = await connectAccount(authToken, ct0, realIdx);
    ok ? success++ : fail++;
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n📊 Hasil: ${success} berhasil, ${fail} gagal dari ${accounts.length} akun diproses`);
}

async function runTasks(arg) {
  const tokens = await loadRefreshTokens("refresh.txt");
  console.log(`📋 Total refresh_token: ${tokens.length}`);
  if (tokens.length === 0) return;

  if (!arg) arg = await showMenu(tokens.length);
  const { start, end } = parseRange(arg, tokens.length);

  console.log(`▶️  Klaim task: ${arg || "semua"} → akun ${start + 1} s/d ${Math.min(end, tokens.length)}\n`);

  let success = 0;
  let fail = 0;

  for (let i = start; i < Math.min(end, tokens.length); i++) {
    const realIdx = i + 1;
    const ok = await processTasks(tokens[i], realIdx, tokens, "refresh.txt");
    ok ? success++ : fail++;
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
  }

  console.log(`\n📊 Hasil: ${success} berhasil, ${fail} gagal`);
}

async function main() {
  let modeArg = process.argv[2];
  let rangeArg = process.argv[3];
  let mode;

  if (modeArg === "connect" || modeArg === "task") {
    mode = modeArg;
  } else {
    // kompatibel format lama: node floks.js 3-end  → default connect
    rangeArg = modeArg;
    mode = await showModeMenu();
  }

  if (mode === "task") {
    await runTasks(rangeArg);
  } else {
    await runConnect(rangeArg);
  }
}

main();
