// ===== 贪吃笔记 · AI 帮写（右侧边栏） =====
// 依赖：sbauth.js 的 sbGetAccessToken()（Supabase 会话）
// 后端：/api/ai（Worker，GLM-4.7-Flash）
(function () {
  "use strict";

  const API = "/api/ai";
  const state = {
    open: false,
    sel: "",
    selStart: 0,
    selEnd: 0,
    ta: null,
    busy: false,
    quota: null,
    mode: "chat", // chat | rewrite | translate
  };

  /* ---------------- 样式 ---------------- */
  const CSS = `
  .aiw-fab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:60;
    display:flex;align-items:center;gap:4px;padding:12px 8px 12px 10px;border:none;cursor:pointer;
    background:hsl(35,25%,90%);color:hsl(30,10%,25%);border-radius:10px 0 0 10px;
    font-size:12px;writing-mode:vertical-rl;letter-spacing:2px;box-shadow:-2px 0 8px rgba(0,0,0,.06);
    transition:background .18s,color .18s;}
  .aiw-fab:hover{background:hsl(35,30%,85%);}
  .aiw-fab .aiw-fab-icon{font-size:16px;writing-mode:horizontal-tb;letter-spacing:0;}
  .aiw-fab.aiw-on{background:hsl(30,10%,25%);color:#fff;}

  .aiw-mask{position:fixed;inset:0;background:rgba(30,25,20,.25);z-index:70;opacity:0;pointer-events:none;transition:opacity .2s;}
  .aiw-mask.show{opacity:1;pointer-events:auto;}

  .aiw-panel{position:fixed;top:0;right:0;height:100dvh;width:380px;max-width:100vw;z-index:80;
    background:hsl(40,25%,98.5%);border-left:1px solid hsl(35,15%,88%);
    box-shadow:-8px 0 24px rgba(0,0,0,.08);display:flex;flex-direction:column;
    transform:translateX(102%);transition:transform .24s cubic-bezier(.22,.61,.36,1);}
  .aiw-panel.open{transform:translateX(0);}

  .aiw-head{display:flex;align-items:center;gap:8px;padding:14px 14px 12px;border-bottom:1px solid hsl(35,15%,90%);}
  .aiw-title{font-size:14px;font-weight:600;}
  .aiw-badge{font-size:10px;color:hsl(30,6%,45%);border:1px solid hsl(35,12%,85%);border-radius:10px;padding:2px 6px;background:#fff;}
  .aiw-close{margin-left:auto;border:none;background:none;font-size:16px;color:hsl(30,6%,45%);cursor:pointer;padding:4px 6px;border-radius:6px;}
  .aiw-close:hover{background:hsl(35,20%,93%);}

  .aiw-selbox{margin:10px 14px 0;padding:8px 10px;border-radius:8px;font-size:11.5px;line-height:1.6;
    background:hsl(45,60%,96%);color:hsl(30,20%,30%);border:1px solid hsl(45,45%,88%);
    max-height:76px;overflow:auto;white-space:pre-wrap;word-break:break-word;}
  .aiw-selbox.empty{background:hsl(40,10%,96%);border-color:hsl(35,12%,90%);color:hsl(30,6%,50%);}

  .aiw-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:10px 14px 0;}
  .aiw-actions button{padding:9px 4px;font-size:12px;border-radius:8px;cursor:pointer;
    border:1px solid hsl(35,14%,87%);background:#fff;color:hsl(30,10%,25%);transition:.15s;}
  .aiw-actions button:hover{border-color:hsl(30,20%,70%);background:hsl(40,25%,99%);}
  .aiw-actions button.aiw-active{background:hsl(30,10%,25%);color:#fff;border-color:hsl(30,10%,25%);}

  .aiw-subrow{display:none;flex-wrap:wrap;gap:6px;padding:8px 14px 0;}
  .aiw-subrow.show{display:flex;}
  .aiw-subrow button{padding:5px 10px;font-size:11.5px;border-radius:14px;cursor:pointer;
    border:1px solid hsl(35,14%,87%);background:#fff;color:hsl(30,10%,30%);}
  .aiw-subrow button:hover{background:hsl(35,25%,94%);}

  .aiw-chat{flex:1;overflow-y:auto;padding:12px 14px 8px;display:flex;flex-direction:column;gap:10px;}
  .aiw-empty{margin:auto;text-align:center;color:hsl(30,6%,55%);font-size:12px;line-height:1.9;}
  .aiw-empty .big{font-size:26px;display:block;margin-bottom:6px;}

  .aiw-msg{font-size:12.5px;line-height:1.7;border-radius:10px;padding:9px 11px;word-break:break-word;}
  .aiw-msg.user{align-self:flex-end;max-width:88%;background:hsl(30,10%,25%);color:#f7f4ef;}
  .aiw-msg.bot{align-self:stretch;background:#fff;border:1px solid hsl(35,14%,89%);}
  .aiw-msg.bot .aiw-text{white-space:pre-wrap;}
  .aiw-msg.bot .aiw-text h1,.aiw-msg.bot .aiw-text h2,.aiw-msg.bot .aiw-text h3{font-size:13px;margin:6px 0 2px;}
  .aiw-msg.bot .aiw-text ul,.aiw-msg.bot .aiw-text ol{padding-left:18px;margin:4px 0;}
  .aiw-msg.bot .aiw-text code{background:hsl(35,20%,94%);padding:1px 4px;border-radius:4px;font-size:11.5px;}
  .aiw-msg.err{background:hsl(0,70%,97%);border-color:hsl(0,55%,88%);color:hsl(0,55%,35%);}

  .aiw-msg-tools{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;}
  .aiw-msg-tools button{font-size:11px;padding:3px 8px;border-radius:6px;cursor:pointer;
    border:1px solid hsl(35,14%,86%);background:hsl(40,30%,99%);color:hsl(30,10%,30%);}
  .aiw-msg-tools button:hover{background:hsl(35,25%,94%);}

  .aiw-loading{display:flex;gap:5px;align-items:center;color:hsl(30,6%,50%);font-size:12px;}
  .aiw-dot{width:5px;height:5px;border-radius:50%;background:hsl(35,20%,60%);animation:aiwPulse 1.1s infinite;}
  .aiw-dot:nth-child(2){animation-delay:.18s}.aiw-dot:nth-child(3){animation-delay:.36s}
  @keyframes aiwPulse{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}

  .aiw-inputwrap{border-top:1px solid hsl(35,15%,90%);padding:10px 14px 6px;display:flex;gap:8px;align-items:flex-end;}
  .aiw-input{flex:1;resize:none;border:1px solid hsl(35,14%,87%);border-radius:8px;padding:8px 10px;
    font-size:12.5px;line-height:1.6;max-height:90px;min-height:36px;font-family:inherit;background:#fff;}
  .aiw-input:focus{outline:none;border-color:hsl(30,20%,70%);}
  .aiw-send{border:none;border-radius:8px;background:hsl(30,10%,25%);color:#fff;padding:9px 12px;font-size:12px;cursor:pointer;}
  .aiw-send:disabled{opacity:.4;cursor:default;}

  .aiw-foot{padding:0 14px 10px;display:flex;justify-content:space-between;font-size:10.5px;color:hsl(30,6%,52%);}
  .aiw-foot b{font-weight:600;color:hsl(30,10%,30%);}

  @media (max-width:640px){
    .aiw-panel{width:100vw;}
    .aiw-fab{top:auto;bottom:90px;transform:none;border-radius:10px 0 0 10px;padding:10px 6px 10px 9px;}
  }
  `;

  /* ---------------- DOM ---------------- */
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function mount() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const fab = el("button", "aiw-fab", '<span class="aiw-fab-icon">✨</span><span>AI 帮写</span>');
    fab.title = "选中文字后提问或改写（Ctrl/⌘ + J 打开）";

    const mask = el("div", "aiw-mask");

    const panel = el("div", "aiw-panel");
    panel.innerHTML = `
      <div class="aiw-head">
        <span class="aiw-title">AI 帮写</span>
        <span class="aiw-badge" id="aiwModel">GLM-4.7-Flash</span>
        <button class="aiw-close" id="aiwClose" title="关闭">✕</button>
      </div>
      <div class="aiw-selbox empty" id="aiwSel">未选中文字 —— 会使用整篇笔记作为上下文</div>
      <div class="aiw-actions">
        <button data-act="ask">💬 提问</button>
        <button data-act="rewrite">✏️ 改写</button>
        <button data-act="summary">📝 总结</button>
        <button data-act="translate">🌐 翻译</button>
      </div>
      <div class="aiw-subrow" id="aiwSubrow"></div>
      <div class="aiw-chat" id="aiwChat"></div>
      <div class="aiw-inputwrap">
        <textarea class="aiw-input" id="aiwInput" rows="1" placeholder="就选中的内容提问，Enter 发送"></textarea>
        <button class="aiw-send" id="aiwSend">发送</button>
      </div>
      <div class="aiw-foot">
        <span>今日额度 <b id="aiwQuota">—</b></span>
        <span id="aiwModeHint">记忆体 · 单实例计数</span>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(mask);
    document.body.appendChild(panel);

    const selBox = panel.querySelector("#aiwSel");
    const chat = panel.querySelector("#aiwChat");
    const subrow = panel.querySelector("#aiwSubrow");
    const input = panel.querySelector("#aiwInput");
    const send = panel.querySelector("#aiwSend");
    const quotaEl = panel.querySelector("#aiwQuota");
    const modeHint = panel.querySelector("#aiwModeHint");

    /* ---------- 开合 ---------- */
    function setOpen(v) {
      state.open = v;
      panel.classList.toggle("open", v);
      fab.classList.toggle("aiw-on", v);
      mask.classList.toggle("show", v && window.innerWidth <= 640);
      if (v) {
        refreshQuota();
        if (!chat.children.length) renderEmpty();
        setTimeout(() => input.focus({ preventScroll: true }), 260);
      }
    }
    fab.onclick = () => setOpen(!state.open);
    panel.querySelector("#aiwClose").onclick = () => setOpen(false);
    mask.onclick = () => setOpen(false);

    /* ---------- 选区捕获 ---------- */
    function editorTextarea() {
      const tas = document.querySelectorAll(".editor-textarea");
      if (!tas.length) return null;
      const focused = document.activeElement;
      if (focused && focused.classList && focused.classList.contains("editor-textarea")) return focused;
      return tas[0];
    }

    function capture() {
      const ta = editorTextarea();
      state.ta = ta;
      if (!ta) return;
      const s = ta.selectionStart, e = ta.selectionEnd;
      const text = ta.value.slice(s, e);
      if (text && text.trim()) {
        // 只保留选区，整篇重新取
        if (text !== state.sel || s !== state.selStart) {
          state.sel = text;
          state.selStart = s;
          state.selEnd = e;
          renderSel();
        }
      } else if (state.sel) {
        state.sel = "";
        state.selStart = state.selEnd = 0;
        renderSel();
      }
    }

    function renderSel() {
      if (state.sel) {
        const one = state.sel.replace(/\s+/g, " ").trim();
        selBox.className = "aiw-selbox";
        selBox.textContent = "已选中 " + state.sel.trim().length + " 字：" + (one.length > 90 ? one.slice(0, 90) + "…" : one);
      } else {
        selBox.className = "aiw-selbox empty";
        selBox.textContent = "未选中文字 —— 会使用整篇笔记作为上下文";
      }
    }

    document.addEventListener("selectionchange", () => {
      const a = document.activeElement;
      if (a && a.classList && a.classList.contains("editor-textarea")) capture();
    });
    document.addEventListener("mouseup", () => setTimeout(capture, 0));
    document.addEventListener("keyup", (e) => {
      if (e.key && /Shift|Arrow|Control|Meta/.test(e.key)) capture();
    });
    document.addEventListener("focusin", (e) => {
      if (e.target.classList && e.target.classList.contains("editor-textarea")) capture();
    });

    /* ---------- 键盘快捷键 ---------- */
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        capture();
        setOpen(!state.open);
      }
      if (e.key === "Escape" && state.open) setOpen(false);
    });

    /* ---------- 额度 ---------- */
    async function refreshQuota() {
      try {
        const token = await getToken();
        const headers = token ? { Authorization: "Bearer " + token } : {};
        const r = await fetch(API + "/quota", { headers });
        const d = await r.json();
        if (d.ok) {
          state.quota = d;
          quotaEl.textContent = d.used + " / " + d.limit;
          const who = d.signedIn ? "账号" : "匿名（按 IP）";
          modeHint.textContent = who + (d.mode === "kv" ? " · KV 计数" : " · 单实例计数");
        }
      } catch (e) { /* 忽略 */ }
    }

    async function getToken() {
      try {
        if (typeof sbGetAccessToken === "function") return await sbGetAccessToken();
      } catch (e) { /* ignore */ }
      return null;
    }

    /* ---------- 消息渲染 ---------- */
    function renderEmpty() {
      chat.innerHTML = `<div class="aiw-empty"><span class="big">✨</span>
        在正文里选中一段文字，然后<br/>提问 · 改写 · 总结 · 翻译<br/>
        <span style="font-size:11px;opacity:.8">Ctrl/⌘ + J 可呼出面板</span></div>`;
    }

    function clearEmpty() {
      const e = chat.querySelector(".aiw-empty");
      if (e) e.remove();
    }

    function scroll() { chat.scrollTop = chat.scrollHeight; }

    function addMsg(kind, html) {
      clearEmpty();
      const m = el("div", "aiw-msg " + kind, html);
      chat.appendChild(m);
      scroll();
      return m;
    }

    function addLoading() {
      clearEmpty();
      const m = el("div", "aiw-msg bot", '<div class="aiw-loading"><span class="aiw-dot"></span><span class="aiw-dot"></span><span class="aiw-dot"></span><span style="margin-left:4px">思考中…</span></div>');
      chat.appendChild(m);
      scroll();
      return m;
    }

    function renderMarkdown(text) {
      try {
        if (window.marked && typeof window.marked.parse === "function") {
          return window.marked.parse(text);
        }
      } catch (e) { /* 回退纯文本 */ }
      return escapeHtml(text);
    }

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function botCard(text, opts) {
      opts = opts || {};
      const m = addMsg("bot", '<div class="aiw-text markdown-body">' + renderMarkdown(text) + "</div>");
      const tools = el("div", "aiw-msg-tools");
      const copyBtn = el("button", "", "复制");
      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(text); copyBtn.textContent = "已复制"; setTimeout(() => (copyBtn.textContent = "复制"), 1200); }
        catch (e) { copyBtn.textContent = "复制失败"; }
      };
      tools.appendChild(copyBtn);
      if (opts.canReplace) {
        const rep = el("button", "", "替换选中");
        rep.onclick = () => {
          if (applyReplace(text)) { rep.textContent = "已替换"; setTimeout(() => (rep.textContent = "替换选中"), 1200); }
          else { rep.textContent = "选区已失效"; }
        };
        tools.appendChild(rep);
      }
      const ins = el("button", "", "插入文末");
      ins.onclick = () => {
        if (insertAtEnd(text)) { ins.textContent = "已插入"; setTimeout(() => (ins.textContent = "插入文末"), 1200); }
      };
      tools.appendChild(ins);
      m.appendChild(tools);
      scroll();
      return m;
    }

    /* ---------- 写入编辑器 ---------- */
    function currentTa() {
      return state.ta && state.ta.isConnected ? state.ta : editorTextarea();
    }

    function applyReplace(text) {
      const ta = currentTa();
      if (!ta) return false;
      const s = state.selStart, e = state.selEnd;
      if (s === e) return false;
      if (ta.value.slice(s, e) !== state.sel) return false; // 内容已变，避免错位
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      const pos = s + text.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      state.sel = text;
      state.selStart = s;
      state.selEnd = pos;
      renderSel();
      return true;
    }

    function insertAtEnd(text) {
      const ta = currentTa();
      if (!ta) return false;
      const v = ta.value.replace(/\s*$/, "");
      ta.value = (v ? v + "\n\n" : "") + text + "\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
      const pos = ta.value.length;
      ta.setSelectionRange(pos, pos);
      return true;
    }

    function noteText() {
      try {
        if (typeof window.getActiveNote === "function") {
          const n = window.getActiveNote();
          if (n && typeof n.content === "string") return n.content;
        }
      } catch (e) { /* ignore */ }
      const ta = currentTa();
      return ta ? ta.value : "";
    }

    /* ---------- 请求 ---------- */
    async function request(payload, userLabel) {
      if (state.busy) return;
      const token = await getToken();
      state.busy = true;
      send.disabled = true;
      if (userLabel) addMsg("user", escapeHtml(userLabel));
      const loading = addLoading();

      try {
        const headers = { "Content-Type": "application/json" };
        if (token) headers.Authorization = "Bearer " + token;
        const r = await fetch(API, {
          method: "POST",
          headers,
          body: JSON.stringify(
            Object.assign({ selection: state.sel, note: noteText() }, payload)
          ),
        });
        let d = null;
        try { d = await r.json(); } catch (e) { d = null; }
        loading.remove();

        if (!r.ok || !d || !d.ok) {
          const msg =
            (d && d.message) ||
            (r.status === 401 ? "登录状态已过期，请重新登录" : "请求失败（" + r.status + "）");
          addMsg("bot err", escapeHtml(msg));
          if (r.status === 401) refreshQuota();
          return;
        }

        if (typeof d.left === "number") {
          quotaEl.textContent = d.used + " / " + d.limit;
        }
        const canReplace = payload.action === "rewrite" || payload.action === "translate";
        botCard(d.text, { canReplace: canReplace && !!state.sel });
      } catch (e) {
        loading.remove();
        addMsg("bot err", "网络异常，稍后重试（" + escapeHtml(String(e.message || e)) + "）");
      } finally {
        state.busy = false;
        send.disabled = false;
      }
    }

    /* ---------- 动作 ---------- */
    const actions = panel.querySelectorAll(".aiw-actions button");
    function setActive(act) {
      actions.forEach((b) => b.classList.toggle("aiw-active", b.dataset.act === act));
    }

    actions.forEach((btn) => {
      btn.onclick = () => {
        capture();
        const act = btn.dataset.act;
        setActive(act);

        if (act === "ask") {
          subrow.classList.remove("show");
          input.focus();
          return;
        }

        if (act === "summary") {
          subrow.classList.remove("show");
          request({ action: "summary" }, state.sel ? "总结选中的 " + state.sel.trim().length + " 字" : "总结整篇笔记");
          return;
        }

        if (act === "rewrite") {
          showSub([
            ["润色", "polish"],
            ["精简", "concise"],
            ["扩写", "expand"],
            ["正式化", "formal"],
            ["口语化", "casual"],
          ], "rewrite");
          return;
        }

        if (act === "translate") {
          showSub([
            ["中译英", "en"],
            ["英译中", "zh"],
          ], "translate");
        }
      };
    });

    function showSub(items, kind) {
      subrow.innerHTML = "";
      items.forEach(([label, val]) => {
        const b = el("button", "", label);
        b.onclick = () => {
          subrow.classList.remove("show");
          if (kind === "rewrite") {
            request({ action: "rewrite", style: val }, "改写：" + label + (state.sel ? "（选中 " + state.sel.trim().length + " 字）" : "（整篇）"));
          } else {
            request({ action: "translate", target: val }, "翻译：" + label);
          }
        };
        subrow.appendChild(b);
      });
      subrow.classList.add("show");
    }

    send.onclick = doAsk;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doAsk(); }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(90, input.scrollHeight) + "px";
    });

    function doAsk() {
      const q = input.value.trim();
      if (!q) { input.focus(); return; }
      input.value = "";
      input.style.height = "auto";
      setActive("ask");
      request({ action: "ask", question: q }, q);
    }

    /* ---------- 对外暴露 ---------- */
    window.AIW = { open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!state.open) };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
