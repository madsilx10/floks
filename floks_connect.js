import fs from "fs/promises";
import fetch from "node-fetch";

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
      "&redirect_to=https%3A%2F%2Ffloks.fun%2Fcallback" +
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
      body: new URLSearchParams({ approval: "true", consent_flow: "web_consent" }),
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

async function main() {
  const accounts = await loadAccounts("akun.txt");
  console.log(`📋 Total akun: ${accounts.length}\n`);

  let success = 0;
  let fail = 0;

  for (let i = 0; i < accounts.length; i++) {
    const { authToken, ct0 } = accounts[i];
    console.log(`── Akun ${i + 1} auth_token=${authToken.slice(0, 12)}...`);
    const ok = await connectAccount(authToken, ct0, i + 1);
    ok ? success++ : fail++;
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n📊 Hasil: ${success} berhasil, ${fail} gagal dari ${accounts.length} akun`);
}

main();
