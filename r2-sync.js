// ===== R2 Markdown 同步模块（TanchiNotes）=====
// 依赖：sbauth.js（Supabase 国际节点）已加载
// 文件名格式：<userId>.us.<noteId>.md
// 增量同步：本地 updatedAt 比 R2 新就上传；R2 有本地没有的就下载合并

const R2_WORKER_URL = "https://tanchi-sync.r6t5.dpdns.org"; // 改成你的 Worker 域名
const R2_SYNC_ENABLED = "tanchiR2SyncEnabled";
const R2_NODE_TAG = "us"; // 国际节点

let r2Syncing = false;

function r2IsEnabled() {
  return localStorage.getItem(R2_SYNC_ENABLED) === "1";
}
function r2SetEnabled(on) {
  localStorage.setItem(R2_SYNC_ENABLED, on ? "1" : "0");
}

async function r2GetAccessToken() {
  try {
    var client = await sbInit();
    var { data } = await client.auth.getSession();
    if (data && data.session && data.session.access_token) {
      return data.session.access_token;
    }
  } catch (e) {}
  return null;
}

function r2GetUserId() {
  var u = sbGetUser();
  return (u && u.id) || "";
}

function noteToMarkdown(note) {
  var tags = (note.tagIds || []).join(",");
  var fm = "---\n"
    + "id: " + (note.id || "") + "\n"
    + "title: " + JSON.stringify(note.title || "") + "\n"
    + "createdAt: " + (note.createdAt || "") + "\n"
    + "updatedAt: " + (note.updatedAt || "") + "\n"
    + "tags: " + tags + "\n"
    + "---\n\n";
  return fm + (note.content || "") + "\n";
}

function markdownToNote(md) {
  try {
    var m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return null;
    var meta = {};
    m[1].split("\n").forEach(function (line) {
      var idx = line.indexOf(": ");
      if (idx > 0) {
        var k = line.slice(0, idx).trim();
        var v = line.slice(idx + 2).trim();
        if (k === "title") { try { v = JSON.parse(v); } catch (e) {} }
        meta[k] = v;
      }
    });
    var content = m[2] || "";
    content = content.replace(/\n$/, "");
    return {
      id: meta.id || ("note_" + Date.now()),
      title: meta.title || "",
      content: content,
      tagIds: meta.tags ? meta.tags.split(",").filter(Boolean) : [],
      createdAt: parseInt(meta.createdAt || "0", 10) || Date.now(),
      updatedAt: parseInt(meta.updatedAt || "0", 10) || Date.now(),
    };
  } catch (e) {
    return null;
  }
}

function r2Key(noteId) {
  return r2GetUserId() + "." + R2_NODE_TAG + "." + noteId + ".md";
}

async function r2Call(path, method, key, body) {
  var token = await r2GetAccessToken();
  if (!token) throw new Error("未登录 R6T5 Hub 账号");
  if (!r2GetUserId()) throw new Error("无用户 ID");
  var url = R2_WORKER_URL + path + "?key=" + encodeURIComponent(key);
  var opts = {
    method: method,
    headers: { "Authorization": "Bearer " + token },
  };
  if (body != null) {
    opts.headers["Content-Type"] = "text/markdown; charset=utf-8";
    opts.body = body;
  }
  var resp = await fetch(url, opts);
  if (!resp.ok) {
    var txt = await resp.text();
    throw new Error("HTTP " + resp.status + ": " + txt.slice(0, 200));
  }
  return resp;
}

async function r2List() {
  var token = await r2GetAccessToken();
  var url = R2_WORKER_URL + "/list?prefix=" + encodeURIComponent(r2GetUserId() + "/");
  var resp = await fetch(url, { headers: { "Authorization": "Bearer " + token } });
  if (!resp.ok) throw new Error("list failed: " + resp.status);
  var data = await resp.json();
  return (data.objects || []).map(function (o) { return o.key; });
}

async function r2Sync(onStatus) {
  if (r2Syncing) return;
  r2Syncing = true;
  try {
    if (!r2IsEnabled()) { if (onStatus) onStatus("R2 同步未开启"); return; }
    if (!r2GetUserId()) { if (onStatus) onStatus("请先登录 R6T5 Hub 账号"); return; }

    if (onStatus) onStatus("📡 正在连接 R2…");
    var remoteKeys = await r2List();
    var remoteMap = {};
    remoteKeys.forEach(function (k) {
      var m = k.match(/^[^.]+\.[^.]+\.(.+)\.md$/);
      if (m) remoteMap[m[1]] = k;
    });

    var notes = load(STORAGE_KEYS.NOTES, []);
    var localMap = {};
    notes.forEach(function (n) { localMap[n.id] = n; });

    var uploaded = 0, downloaded = 0, skipped = 0;

    for (var i = 0; i < notes.length; i++) {
      var note = notes[i];
      var key = r2Key(note.id);
      var md = noteToMarkdown(note);
      try {
        await r2Call("/upload", "PUT", key, md);
        uploaded++;
        if (onStatus) onStatus("📤 已上传 " + (note.title || note.id));
      } catch (e) {
        skipped++;
        if (onStatus) onStatus("⚠️ 上传失败 " + (note.title || note.id) + ": " + e.message);
      }
    }

    for (var noteId in remoteMap) {
      if (localMap[noteId]) continue;
      try {
        var key2 = remoteMap[noteId];
        var resp2 = await r2Call("/download", "GET", key2);
        var md2 = await resp2.text();
        var note2 = markdownToNote(md2);
        if (note2) {
          notes.unshift(note2);
          downloaded++;
          if (onStatus) onStatus("📥 已下载 " + (note2.title || noteId));
        }
      } catch (e) {
        if (onStatus) onStatus("⚠️ 下载失败 " + noteId + ": " + e.message);
      }
    }

    if (downloaded > 0) {
      save(STORAGE_KEYS.NOTES, notes);
    }

    if (onStatus) onStatus("✅ 同步完成：上传 " + uploaded + "，下载 " + downloaded + "，失败 " + skipped);
  } catch (e) {
    if (onStatus) onStatus("⚠️ R2 同步失败：" + e.message);
  } finally {
    r2Syncing = false;
  }
}

let r2PushTimer = null;
function r2SyncDebounced() {
  if (!r2IsEnabled() || !r2GetUserId()) return;
  clearTimeout(r2PushTimer);
  r2PushTimer = setTimeout(function () { r2Sync(); }, 3000);
}
