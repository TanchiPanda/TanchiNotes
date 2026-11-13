// ===== TanchiNotes · AI 帮写 Worker =====
// 与静态资源一体部署（wrangler.toml: name="tanchinotes", [assets] + [ai]）
// 路由：
//   POST /api/ai          写作助手（提问 / 改写 / 总结 / 翻译）
//   GET  /api/ai/quota    查询剩余额度
//   GET  /api/ai/health   自检（模型 / 绑定 / 限额）

const SUPABASE_JWKS = "https://fckqmlwkujixwztzqqni.supabase.co/auth/v1/.well-known/jwks.json";
const SUPABASE_ISSUER = "https://fckqmlwkujixwztzqqni.supabase.co/auth/v1";

const MODEL = "@cf/zai-org/glm-4.7-flash";
const FALLBACK_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const DAILY_LIMIT = 60;   // 每人每天
const MINUTE_LIMIT = 8;   // 每人每分钟
const MAX_NOTE_CHARS = 8000;
const MAX_INPUT_CHARS = 6000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

function b64decode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function verifySupabaseToken(token) {
  if (!token) throw new Error("no token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(b64decode(parts[0])));

  const resp = await fetch(SUPABASE_JWKS, { cf: { cacheTtl: 3600 } });
  if (!resp.ok) throw new Error("jwks fetch failed");
  const jwks = await resp.json();
  const key = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!key) throw new Error("unknown kid");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
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

// ---------- 额度：优先 KV，未绑定则单实例内存兜底 ----------
const _mem = new Map();

async function bumpQuota(env, sub) {
  const now = Date.now();
  const dayKey = "v:" + sub + ":" + new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  const minuteKey = "m:" + sub + ":" + Math.floor(now / 60000);

  if (env.AI_QUOTA) {
    const [day, minute] = await Promise.all([
      env.AI_QUOTA.get(dayKey),
      env.AI_QUOTA.get(minuteKey),
    ]);
    const dayUsed = parseInt(day || "0", 10);
    const minUsed = parseInt(minute || "0", 10);
    if (dayUsed >= DAILY_LIMIT) return { ok: false, reason: "daily", used: dayUsed, limit: DAILY_LIMIT, mode: "kv" };
    if (minUsed >= MINUTE_LIMIT) return { ok: false, reason: "minute", used: minUsed, limit: MINUTE_LIMIT, mode: "kv" };
    await Promise.all([
      env.AI_QUOTA.put(dayKey, String(dayUsed + 1), { expirationTtl: 172800 }),
      env.AI_QUOTA.put(minuteKey, String(minUsed + 1), { expirationTtl: 120 }),
    ]);
    return { ok: true, used: dayUsed + 1, limit: DAILY_LIMIT, minuteLeft: MINUTE_LIMIT - minUsed - 1, mode: "kv" };
  }

  const d = _mem.get(dayKey) || 0;
  const m = _mem.get(minuteKey) || 0;
  if (d >= DAILY_LIMIT) return { ok: false, reason: "daily", used: d, limit: DAILY_LIMIT, mode: "memory" };
  if (m >= MINUTE_LIMIT) return { ok: false, reason: "minute", used: m, limit: MINUTE_LIMIT, mode: "memory" };
  _mem.set(dayKey, d + 1);
  _mem.set(minuteKey, m + 1);
  return { ok: true, used: d + 1, limit: DAILY_LIMIT, minuteLeft: MINUTE_LIMIT - m - 1, mode: "memory" };
}

async function readQuota(env, sub) {
  const now = Date.now();
  const dayKey = "v:" + sub + ":" + new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  if (env.AI_QUOTA) {
    const v = parseInt((await env.AI_QUOTA.get(dayKey)) || "0", 10);
    return { used: v, limit: DAILY_LIMIT, left: Math.max(0, DAILY_LIMIT - v), mode: "kv" };
  }
  const v = _mem.get(dayKey) || 0;
  return { used: v, limit: DAILY_LIMIT, left: Math.max(0, DAILY_LIMIT - v), mode: "memory" };
}

// ---------- 提示词 ----------
const BASE_SYSTEM =
  "你是「贪吃笔记」里的中文写作助手。用户的笔记使用 Markdown 语法。回答简洁、直接、不啰嗦，不要输出与任务无关的客套话。除 Markdown 外不要使用 HTML。";

const REWRITE_STYLES = {
  polish: "润色：保持原意与信息量不变，让表达更通顺自然，修正语病与标点。",
  concise: "精简：压缩到原长度的 50%~70%，只保留关键信息，不丢事实。",
  expand: "扩写：在原意基础上补充细节与过渡，长度约为原来的 1.5 倍，不要编造事实。",
  formal: "正式化：改成书面、正式的表达，适合文档或对外说明。",
  casual: "口语化：改成自然口语，像在对人讲解，但仍保留专业术语。",
};

function buildMessages(body) {
  const selection = String(body.selection || "").slice(0, MAX_INPUT_CHARS);
  const note = String(body.note || "").slice(0, MAX_NOTE_CHARS);
  const question = String(body.question || "").slice(0, 1000);
  const action = String(body.action || "ask");

  const contextParts = [];
  if (note) contextParts.push("【整篇笔记】\n" + note);
  if (selection) contextParts.push("【当前选中片段】\n" + selection);
  const ctx = contextParts.join("\n\n");

  let task;
  if (action === "ask") {
    task =
      "请回答用户关于笔记的问题。若答案能引用原文，就简短引用；若笔记里没有相关信息，直接说明并给出你的判断。\n\n用户问题：" +
      (question || "这段内容是什么意思？");
  } else if (action === "rewrite") {
    const style = REWRITE_STYLES[body.style] || REWRITE_STYLES.polish;
    task =
      "任务：" + style + "\n只输出改写后的文字本身，不要解释、不要加引号、不要写“改写如下”。保留原有的 Markdown 结构与列表/标题层级。";
  } else if (action === "summary") {
    task = selection
      ? "把【当前选中片段】总结成要点列表（3~6 条），每条一句话。只输出列表，不要开头结尾的说明。"
      : "把【整篇笔记】总结成要点列表（3~8 条），每条一句话。只输出列表。";
  } else if (action === "translate") {
    task =
      body.target === "en"
        ? "把【当前选中片段】（没有选中就用整篇笔记）翻译成英文。只输出译文，保留 Markdown 格式。"
        : "把【当前选中片段】（没有选中就用整篇笔记）翻译成中文。只输出译文，保留 Markdown 格式。";
  } else {
    task = "请就这段笔记给出有用的补充或建议。";
  }

  return [
    { role: "system", content: BASE_SYSTEM },
    { role: "user", content: (ctx ? ctx + "\n\n" : "") + task },
  ];
}

async function runModel(env, messages) {
  const models = [env.AI_MODEL || MODEL, FALLBACK_MODEL].filter(Boolean);
  let lastErr = null;
  for (const model of models) {
    try {
      const out = await env.AI.run(model, {
        messages,
        max_tokens: 1024,
        temperature: 0.4,
      });
      const text =
        (out && (out.response || out.text)) ||
        (out && out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content) ||
        "";
      if (text && String(text).trim()) return { text: String(text).trim(), model };
      lastErr = new Error("empty response from " + model);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("model failed");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // ---------- 自检 ----------
    if (url.pathname === "/api/ai/health") {
      return json({
        ok: true,
        ai: !!env.AI,
        kv: !!env.AI_QUOTA,
        model: env.AI_MODEL || MODEL,
        fallback: FALLBACK_MODEL,
        dailyLimit: DAILY_LIMIT,
        minuteLimit: MINUTE_LIMIT,
      });
    }

    if (!url.pathname.startsWith("/api/ai")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }

    // ---------- 身份：有 Supabase 会话按用户，否则按 IP ----------
    const auth = request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    let sub = null;
    if (token) {
      try {
        const payload = await verifySupabaseToken(token);
        sub = payload.sub;
      } catch (e) {
        sub = null; // token 过期/无效时退回匿名额度，不直接拦人
      }
    }
    const identity = sub
      ? "u:" + sub
      : "ip:" + (request.headers.get("CF-Connecting-IP") || "unknown");
    const signedIn = !!sub;

    if (url.pathname === "/api/ai/quota") {
      return json({ ok: true, signedIn, ...(await readQuota(env, identity)) });
    }

    if (url.pathname !== "/api/ai") return json({ ok: false, error: "not_found" }, 404);
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    if (!env.AI) return json({ ok: false, error: "ai_binding_missing" }, 503);

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: "bad_json" }, 400);
    }

    const quota = await bumpQuota(env, identity);
    if (!quota.ok) {
      return json(
        {
          ok: false,
          error: quota.reason === "daily" ? "daily_limit" : "rate_limited",
          message:
            quota.reason === "daily"
              ? "今天的 AI 额度用完了（" + quota.limit + " 次/天），明天再来"
              : "操作太快了，休息几秒再试",
          ...quota,
        },
        429
      );
    }

    try {
      const messages = buildMessages(body);
      const started = Date.now();
      const { text, model } = await runModel(env, messages);
      return json({
        ok: true,
        signedIn,
        text,
        model,
        ms: Date.now() - started,
        used: quota.used,
        limit: quota.limit,
        left: Math.max(0, quota.limit - quota.used),
        mode: quota.mode,
      });
    } catch (e) {
      return json(
        {
          ok: false,
          error: "model_error",
          message: "模型这次没返回结果，稍后重试",
          detail: String((e && e.message) || e).slice(0, 200),
        },
        502
      );
    }
  },
};
