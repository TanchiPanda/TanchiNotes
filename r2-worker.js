// ===== R6T5 Hub · TanchiNotes R2 同步 Worker =====
// 部署：wrangler deploy
// wrangler.toml 至少包含：
//   name = "tanchi-sync"
//   main = "worker.js"
//   compatibility_date = "2026-11-01"
//   [[r2_buckets]]
//   bucket_name = "你的-bucket-名"
//   binding = "NOTES_BUCKET"

const SUPABASE_JWKS = "https://fckqmlwkujixwztzqqni.supabase.co/auth/v1/.well-known/jwks.json";
const SUPABASE_ISSUER = "https://fckqmlwkujixwztzqqni.supabase.co/auth/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function b64decode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function verifySupabaseToken(token) {
  if (!token) throw new Error("no token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(b64decode(parts[0])));

  const resp = await fetch(SUPABASE_JWKS);
  if (!resp.ok) throw new Error("jwks fetch failed");
  const jwks = await resp.json();
  const key = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!key) throw new Error("unknown kid: " + header.kid);

  const cryptoKey = await crypto.subtle.importKey(
    "jwk", key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["verify"]
  );
  const data = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const sig = b64decode(parts[2]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, sig, data);
  if (!ok) throw new Error("invalid signature");

  const payload = JSON.parse(new TextDecoder().decode(b64decode(parts[1])));
  if (payload.iss !== SUPABASE_ISSUER) throw new Error("invalid issuer");
  if (payload.exp * 1000 < Date.now()) throw new Error("token expired");
  if (!payload.sub) throw new Error("missing sub");
  return payload;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const auth = request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");

    let payload;
    try {
      payload = await verifySupabaseToken(token);
    } catch (e) {
      return json({ error: "unauthorized: " + e.message }, 401, CORS);
    }
    const userId = payload.sub;

    let key = (url.searchParams.get("key") || "").trim();
    if (!key) {
      return json({ error: "missing key" }, 400, CORS);
    }
    key = key.replace(/^\/+/, "");
    if (!key.startsWith(userId + "/")) {
      return json({ error: "forbidden: key must start with " + userId + "/" }, 403, CORS);
    }

    try {
      if (url.pathname === "/list" && request.method === "GET") {
        const prefix = url.searchParams.get("prefix") || (userId + "/");
        if (!prefix.startsWith(userId + "/")) {
          return json({ error: "forbidden prefix" }, 403, CORS);
        }
        const list = await env.NOTES_BUCKET.list({ prefix, limit: 1000 });
        return json(list, 200, CORS);
      }

      if (url.pathname === "/upload" && request.method === "PUT") {
        const body = await request.arrayBuffer();
        await env.NOTES_BUCKET.put(key, body, {
          httpMetadata: { contentType: "text/markdown; charset=utf-8" },
        });
        return json({ ok: true, key, size: body.byteLength }, 200, CORS);
      }

      if (url.pathname === "/download" && request.method === "GET") {
        const obj = await env.NOTES_BUCKET.get(key);
        if (!obj) return new Response("not found", { status: 404, headers: CORS });
        return new Response(obj.body, {
          headers: {
            ...CORS,
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Length": String(obj.size),
          },
        });
      }

      if (url.pathname === "/delete" && request.method === "DELETE") {
        await env.NOTES_BUCKET.delete(key);
        return json({ ok: true, key }, 200, CORS);
      }

      return json({ error: "not found", path: url.pathname }, 404, CORS);
    } catch (e) {
      return json({ error: "r2 error: " + e.message }, 500, CORS);
    }
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
