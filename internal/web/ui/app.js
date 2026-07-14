/* AutoMCHUB 前端（无框架 SPA） */
"use strict";

/* ---------- Token 与 API ---------- */
(function initToken() {
  const p = new URLSearchParams(location.search);
  const t = p.get("token");
  if (t) {
    localStorage.setItem("amh_token", t);
    history.replaceState(null, "", location.pathname + (location.hash || "#/instances"));
  }
})();
const TOKEN = () => localStorage.getItem("amh_token") || "";

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "X-Token": TOKEN(), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j;
  try { j = await res.json(); } catch { throw new Error(`服务异常 (HTTP ${res.status})`); }
  if (res.status === 401) { showLogin(); throw new Error(j.error || "需要登录"); }
  if (!j.ok) throw new Error(j.error || "未知错误");
  return j.data;
}

/* 局域网访问的密码登录遮罩 */
function showLogin() {
  if ($("#login-mask")) return;
  const d = document.createElement("div");
  d.className = "modal-mask";
  d.id = "login-mask";
  d.innerHTML = `<div class="modal"><h3>${icon("lock")} AutoMCHUB 远程访问</h3>
    <div class="m-body">请输入访问密码（在主机的全局设置中配置）</div>
    <input type="password" id="login-pw" style="width:100%;margin-bottom:16px" autofocus>
    <div class="m-actions"><button class="btn primary" id="login-go">登录</button></div></div>`;
  document.body.appendChild(d);
  const go = async () => {
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: d.querySelector("#login-pw").value }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "登录失败");
      d.remove();
      location.reload();
    } catch (e) { toast(e.message, true); }
  };
  d.querySelector("#login-go").onclick = go;
  d.querySelector("#login-pw").onkeydown = e => { if (e.key === "Enter") go(); };
}

/* ---------- 工具 ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg, isErr = false) {
  const d = document.createElement("div");
  d.className = "toast" + (isErr ? " error" : "");
  d.textContent = msg;
  $("#toasts").appendChild(d);
  const kill = () => { d.classList.add("leaving"); d.addEventListener("animationend", () => d.remove(), { once: true }); setTimeout(() => d.remove(), 400); };
  setTimeout(kill, isErr ? 6500 : 3500);
}
/* 复制到剪贴板：优先 navigator.clipboard；非安全上下文（http 局域网）下其为 undefined，回退 execCommand */
async function copy(text, okMsg = "已复制") {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); toast(okMsg); return; }
  } catch (e) { /* 落到回退 */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand("copy"); ta.remove(); toast(okMsg);
  } catch (e) { toast("复制失败，请手动复制", true); }
}
function fmtBytes(n) {
  if (n <= 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + " " + u[i];
}
function confirmModal({ title, body, okText = "确定", danger = false, extra = "" }) {
  return new Promise(resolve => {
    const root = $("#modal-root");
    const prev = document.activeElement; // 关闭后归还焦点
    root.innerHTML = `<div class="modal-mask"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h3 id="modal-title">${esc(title)}</h3><div class="m-body">${body}</div>${extra}
      <div class="m-actions">
        <button class="btn" data-x="cancel">取消</button>
        <button class="btn ${danger ? "danger" : "primary"}" data-x="ok">${esc(okText)}</button>
      </div></div></div>`;
    const close = val => {
      root.innerHTML = "";
      document.removeEventListener("keydown", onKey);
      if (prev && prev.focus) prev.focus();
      resolve(val);
    };
    const onKey = e => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    root.querySelector(".modal-mask").addEventListener("mousedown", e => { if (e.target === e.currentTarget) close(null); });
    root.querySelector('[data-x="cancel"]').onclick = () => close(null);
    root.querySelector('[data-x="ok"]').onclick = () => {
      const checks = {};
      root.querySelectorAll("input[type=checkbox][data-k]").forEach(c => checks[c.dataset.k] = c.checked);
      close(checks);
    };
    root.querySelector('[data-x="ok"]').focus();
  });
}

/* 核心元数据（启动时从 /api/cores 拉取） */
let CORES = {};
const coreName = id => (CORES[id] && CORES[id].name) || id;
const coreKind = id => (CORES[id] && CORES[id].kind) || "game";

/* 每种核心一种"材料色"，用于体素方块图标 */
const CORE_COLORS = {
  vanilla: "#7ec850", paper: "#e8e4d8", purpur: "#b57edc", leaves: "#57c25e",
  folia: "#35c4b5", fabric: "#c7b88a", neoforge: "#e8863c", forge: "#5a6b8c",
  mohist: "#c0693a", banner: "#d9a441", velocity: "#4fd8e0", waterfall: "#4f9be0",
};
const cubeOf = id => `<div class="cube" style="--c:${CORE_COLORS[id] || "#8fa08e"}"><i></i></div>`;
const eyebrow = t => `<div class="eyebrow">${esc(t)}</div>`;

/* ---------- 内联 SVG 图标 ----------
   对齐 win-ctrls 风格：16 视框、细线 currentColor、圆角端点。icon(name) 返回字符串供模板拼接；
   颜色继承文字色（双主题自动成立），默认尺寸 1em（随字号缩放），故按钮/文本内无需另设色与尺寸。
   界面图标一律走这里，禁止 emoji（用户内容如 MOTD/控制台输出不受限）。 */
const ICON = {
  // 导航 / 主题
  map: '<path d="M2.6 4.3l3.8-1.5 3.2 1.5 3.8-1.5v9.4l-3.8 1.5-3.2-1.5-3.8 1.5z"/><path d="M6.4 2.9v9.4M9.6 4.3v9.4"/>',
  craft: '<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.2"/><path d="M6.2 2.8v10.4M9.8 2.8v10.4M2.8 6.2h10.4M2.8 9.8h10.4"/>',
  compass: '<circle cx="8" cy="8" r="5.8"/><path d="M10.4 5.6L8.7 8.7 5.6 10.4 7.3 7.3z" fill="currentColor" stroke="none"/>',
  gear: '<circle cx="8" cy="8" r="2.3"/><path d="M8 1.6v1.9M8 12.5v1.9M14.4 8h-1.9M3.5 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8L3.5 3.5"/>',
  sun: '<circle cx="8" cy="8" r="3.1"/><path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7L3.5 3.5"/>',
  moon: '<path d="M13 9.6A5.6 5.6 0 016.4 3 5.6 5.6 0 1013 9.6z"/>',
  monitor: '<rect x="2.4" y="3" width="11.2" height="7.4" rx="1"/><path d="M6 13h4M8 10.4V13"/>',
  // 状态 / 数据
  search: '<circle cx="7" cy="7" r="4.3"/><path d="M10.3 10.3l3.2 3.2"/>',
  clock: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.7V8l2.4 1.5"/>',
  player: '<circle cx="8" cy="5.4" r="2.6"/><path d="M3.5 12.9c0-2.5 2-4.2 4.5-4.2s4.5 1.7 4.5 4.2"/>',
  // 动作
  play: '<path d="M6 4l6 4-6 4z" fill="currentColor"/>',
  stop: '<rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.3" fill="currentColor"/>',
  folder: '<path d="M2.4 12.6V4.6h3.4l1.4 1.6h6.4v6.4z"/>',
  bolt: '<path d="M9 2.2L4.2 9.2H7.3L6.6 13.8 11.8 6.6H8.4z" fill="currentColor"/>',
  // 文件夹直达菜单 / 状态
  package: '<path d="M8 1.9l5.4 2.9v6.4L8 14.1 2.6 11.2V4.8z"/><path d="M2.7 4.9L8 7.7l5.3-2.8M8 7.7v6.3"/>',
  plug: '<path d="M6 2.2v2.6M10 2.2v2.6M4.6 4.8h6.8v2.4a3.4 3.4 0 01-6.8 0zM8 10.6v3.2"/>',
  globe: '<circle cx="8" cy="8" r="5.9"/><path d="M2.1 8h11.8M8 2.1c1.7 1.7 2.5 3.8 2.5 5.9S9.7 12.2 8 13.9C6.3 12.2 5.5 10.1 5.5 8S6.3 3.8 8 2.1z"/>',
  doc: '<path d="M4.2 2.3h4.6l3 3v8.4H4.2z"/><path d="M8.6 2.4v3h3M6.2 8.6h3.6M6.2 10.9h3.6"/>',
  warn: '<path d="M8 2.5L14.3 13.2H1.7z"/><path d="M8 6.4v3.2M8 11.4v.01"/>',
  arrowLeft: '<path d="M12.5 8H4M7 4.5L3.5 8 7 11.5"/>',
  arrowRight: '<path d="M3.5 8H12M9 4.5L12.5 8 9 11.5"/>',
  check: '<path d="M3.4 8.4l3 3 6.2-6.6"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 009 2.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5"/>',
  download: '<path d="M8 2.5v7.5M4.7 6.8L8 10l3.3-3.2M3 13h10"/>',
  refresh: '<path d="M12.4 5.5A5 5 0 103.6 5.5"/><path d="M12.8 2.3V5.6H9.5"/>',
  camera: '<path d="M2.6 5.6h2.1l1-1.5h4.6l1 1.5h2.1v7.4h-10.8z"/><circle cx="8" cy="9" r="2.2"/>',
  restore: '<path d="M7.5 4.6 3 8l4.5 3.4zM13 4.6 8.5 8l4.5 3.4z" fill="currentColor"/>',
  save: '<path d="M3.4 2.6h7l3 3v7.8h-10z"/><path d="M5.4 2.6v3.2h4.4V2.6M5.4 13.4V9.2h5.2v4.2"/>',
  coffee: '<path d="M3 5.6h8.5v2.9a3.4 3.4 0 01-3.4 3.4H6.4A3.4 3.4 0 013 8.5z"/><path d="M11.5 6.3h1.2a1.6 1.6 0 010 3.1h-1.2"/><path d="M5.4 2.6v1.4M8 2.6v1.4"/>',
  phone: '<rect x="4.5" y="2.5" width="7" height="11" rx="1.4"/><path d="M7 11.4h2"/>',
  bell: '<path d="M4.6 7a3.4 3.4 0 016.8 0c0 2.4 1 3.4 1.3 3.9H3.3c.3-.5 1.3-1.5 1.3-3.9z"/><path d="M6.7 12.9a1.4 1.4 0 002.6 0"/>',
  info: '<circle cx="8" cy="8" r="5.8"/><path d="M8 7.3v3.5M8 5.2v.01"/>',
  power: '<path d="M8 2.2v5.6"/><path d="M5.1 4.7a4.6 4.6 0 105.8 0"/>',
  arrowUp: '<path d="M8 13V3.4M4.4 7 8 3.4 11.6 7"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.4"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
  chevronDown: '<path d="M4 6.5 8 10.5l4-4"/>',
  link: '<path d="M6.6 9.4 9.4 6.6"/><path d="M7 4.6 8.2 3.4a2.6 2.6 0 013.7 3.7L10.7 8.3"/><path d="M9 11.4 7.8 12.6a2.6 2.6 0 01-3.7-3.7L5.3 7.7"/>',
};
const icon = (name, cls = "") => `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;

/* 浅色 / 深色主题切换（index.html 已在样式生效前预置 data-theme） */
(function initTheme() {
  const btn = $("#theme-btn");
  const root = document.documentElement;
  const sysLight = () => matchMedia("(prefers-color-scheme: light)").matches;
  const pref = () => root.dataset.themePref || "auto";
  const ICONS = { light: icon("sun"), dark: icon("moon"), auto: icon("monitor") };
  const NEXT = { light: "dark", dark: "auto", auto: "light" };
  const LABEL = { light: "浅色", dark: "深色", auto: "跟随系统" };
  const paint = () => { btn.innerHTML = ICONS[pref()] || ICONS.light; btn.title = `主题：${LABEL[pref()]}（点击切换）`; };
  const apply = p => {
    root.dataset.themePref = p;
    localStorage.setItem("amh_theme", p);
    root.dataset.theme = p === "auto" ? (sysLight() ? "light" : "dark") : p;
    paint();
  };
  btn.onclick = () => apply(NEXT[pref()] || "auto");
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (pref() === "auto") apply("auto"); });
  paint();
})();

/* 无边框宿主：系统标题栏已去除，HUD 顶栏充当标题栏。窗口按钮 + 拖动经 WebView2 的 Bind 桥接驱动。
   仅当宿主注入了 hostWin* 函数时启用（浏览器回退时保留系统窗口，什么都不做）。 */
(function initHostChrome() {
  if (typeof window.hostWinClose !== "function") return;
  document.body.classList.add("has-host-chrome");
  const call = fn => { try { window[fn](); } catch (e) {} };
  const maxBtn = $("#wc-max");
  const boxMax = `<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="2" width="8" height="8"/></svg>`;
  const boxRestore = `<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1"><rect x="2.5" y="3.5" width="6" height="6"/><path d="M4.5 3.5V1.5h6v6H8"/></svg>`;
  const refreshMax = async () => { try { maxBtn.innerHTML = (await window.hostWinIsMax()) ? boxRestore : boxMax; } catch (e) {} };
  $("#wc-min").onclick = () => call("hostWinMin");
  $("#wc-close").onclick = () => call("hostWinClose");
  maxBtn.onclick = () => { call("hostWinMaxToggle"); setTimeout(refreshMax, 80); };
  refreshMax();
  // HUD 空白处按下 → 发起原生拖动；双击 → 最大化/还原。交互元素（按钮/链接/输入/控制键）除外。
  const hud = $("#hud");
  const onChrome = e => e.target.closest("button, a, input, select, .win-ctrls");
  hud.addEventListener("mousedown", e => {
    if (e.button !== 0 || onChrome(e)) return;
    e.preventDefault();
    call("hostWinDrag");
  });
  hud.addEventListener("dblclick", e => {
    if (onChrome(e)) return;
    call("hostWinMaxToggle"); setTimeout(refreshMax, 80);
  });
})();

/* 快捷键：1-4 切换物品栏页签；T 或 / 聚焦控制台输入（MC 聊天习惯） */
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
  if (typing) return;
  if (["1", "2", "3", "4"].includes(e.key)) {
    location.hash = ["#/instances", "#/create", "#/tunnels", "#/settings"][+e.key - 1];
  } else if (e.key === "/" || e.key === "t" || e.key === "T") {
    const cmd = $("#cmd-in");
    if (cmd) { e.preventDefault(); cmd.focus(); }
  }
});

/* Minecraft § 色码表 */
const MC_COLORS = { 0:"#000000",1:"#0000AA",2:"#00AA00",3:"#00AAAA",4:"#AA0000",5:"#AA00AA",6:"#FFAA00",7:"#AAAAAA",8:"#555555",9:"#5555FF",a:"#55FF55",b:"#55FFFF",c:"#FF5555",d:"#FF55FF",e:"#FFFF55",f:"#FFFFFF" };

/* 将带 § 色码的 MOTD 渲染进容器（textContent 安全构建）。
   浅色主题下把游戏原亮色压暗以保证对比度（深色容器如 motd-preview 不受影响，
   因为其背景恒为深色，调用时机在页面主题下仍成立——按容器背景取色）。 */
function renderMotd(el, text) {
  const onDark = el.classList.contains("motd-preview") ||
    document.documentElement.dataset.theme !== "light";
  const dim = hex => {
    if (onDark) return hex;
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.round(c * 0.55);
    return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map(c => f(c).toString(16).padStart(2, "0")).join("");
  };
  const baseColor = onDark ? "#AAAAAA" : "#5b5647";
  el.innerHTML = "";
  let style = { color: baseColor, bold: false, italic: false, underline: false, strike: false };
  let span = null;
  const newSpan = () => {
    span = document.createElement("span");
    span.style.color = style.color;
    span.style.fontWeight = style.bold ? "700" : "400";
    span.style.fontStyle = style.italic ? "italic" : "normal";
    span.style.textDecoration = (style.underline ? "underline " : "") + (style.strike ? "line-through" : "");
    el.appendChild(span);
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === "§" || ch === "&") && i + 1 < text.length && ch === "§") {
      const c = text[i + 1].toLowerCase();
      i++;
      if (MC_COLORS[c] !== undefined) { style = { color: dim(MC_COLORS[c]), bold: false, italic: false, underline: false, strike: false }; span = null; }
      else if (c === "l") { style.bold = true; span = null; }
      else if (c === "o") { style.italic = true; span = null; }
      else if (c === "n") { style.underline = true; span = null; }
      else if (c === "m") { style.strike = true; span = null; }
      else if (c === "r") { style = { color: baseColor, bold: false, italic: false, underline: false, strike: false }; span = null; }
      continue;
    }
    if (!span) newSpan();
    span.textContent += ch;
  }
  if (!el.childNodes.length) { const d = document.createElement("span"); d.style.color = "#666"; d.textContent = "(预览)"; el.appendChild(d); }
}

/* ---------- 版本比较（支持 1.x.y 与年份版号 26.x 混排） ----------
   逐段解析为整数元组比较：年份版号首段 26 天然大于 1.x 的 1，故 26.x 恒大于 1.x；
   对 1.21-pre1 之类后缀取前导整数（parseInt 容错）。供 properties 版本感知等复用。 */
function verParts(v) { return String(v).split(".").map(s => parseInt(s, 10) || 0); }
function verCmp(a, b) { // a<b → -1 ; a==b → 0 ; a>b → 1
  const pa = verParts(a), pb = verParts(b), n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
const verGte = (mc, ref) => verCmp(mc, ref) >= 0;
const verLt = (mc, ref) => verCmp(mc, ref) < 0;

/* ---------- 行式控件（HMCL 三件套：普通行 / 可展开摘要行 / 行内嵌编辑器） ----------
   rowControl(opts) → HTMLElement，设置页与常用设置共用。
   opts: { title, desc?, key?, needsRestart?, control?（普通行右侧控件 Node）,
           summary?（可展开行收起时摘要 string|Node）, editor?((row)=>Node 惰性构建), open? } */
function rowControl(opts) {
  const row = document.createElement("div");
  row.className = "row-item" + (opts.editor ? " expandable" : "");
  if (opts.key) row.dataset.k = opts.key;
  const head = document.createElement("div");
  head.className = "ri-head";
  const main = document.createElement("div");
  main.className = "ri-main";
  const title = document.createElement("div");
  title.className = "ri-title";
  title.textContent = opts.title;
  if (opts.needsRestart) {
    const tag = document.createElement("span");
    tag.className = "ri-restart"; tag.textContent = "重启生效";
    title.appendChild(tag);
  }
  main.appendChild(title);
  if (opts.desc) {
    const sub = document.createElement("div");
    sub.className = "ri-sub"; sub.textContent = opts.desc;
    main.appendChild(sub);
  }
  if (opts.key) {
    const kk = document.createElement("div");
    kk.className = "ri-key"; kk.textContent = opts.key;
    main.appendChild(kk);
  }
  head.appendChild(main);
  const right = document.createElement("div");
  right.className = "ri-right";
  if (opts.editor) {
    const sum = document.createElement("span");
    sum.className = "ri-summary";
    if (opts.summary instanceof Node) sum.appendChild(opts.summary);
    else sum.textContent = opts.summary ?? "";
    const chev = document.createElement("span");
    chev.className = "ri-chev"; chev.innerHTML = icon("chevronDown");
    right.append(sum, chev);
  } else if (opts.control) {
    right.appendChild(opts.control);
  }
  head.appendChild(right);
  row.appendChild(head);
  if (opts.editor) {
    const ed = document.createElement("div");
    ed.className = "ri-editor";
    row.appendChild(ed);
    let built = false;
    head.addEventListener("click", () => {
      const open = row.classList.toggle("open");
      if (open && !built) { ed.appendChild(opts.editor(row)); built = true; }
    });
    if (opts.open) { row.classList.add("open"); ed.appendChild(opts.editor(row)); built = true; }
  }
  return row;
}

/* 内存分配控件（滑条 + 精确输入框 + 实时物理内存状态条）：向导 / 导入 / JVM 三处共用。
   在 mount 内渲染一个 id=sliderId 的 range，提交端仍按原 id 读取其 value，故调用方无需改提交逻辑。
   o: { sliderId, min, max, value, totalMb, availMb, hint? } */
function renderMemoryControl(mount, o) {
  const min = o.min, max = Math.max(o.min, o.max);
  const totalMb = o.totalMb || 0;
  let availMb = o.availMb;
  if (!availMb || availMb <= 0) availMb = totalMb;      // 后端拿不到可用内存(返回0)时退化为总量
  const usedMb = Math.max(0, totalMb - availMb);
  const g = mb => (mb / 1024).toFixed(1);
  mount.innerHTML = `
    <div class="mem-head"><span>最大内存 -Xmx</span><b class="mem-gb"></b>
      <span class="mem-mb"><input type="number" class="mem-num" min="${min}" max="${max}" step="256"> MB</span></div>
    <input type="range" id="${o.sliderId}" class="mem-range" min="${min}" max="${max}" step="512">
    <div class="mem-bar"><i class="mem-used"></i><i class="mem-alloc"></i></div>
    <div class="mem-stat"></div>
    ${o.hint ? `<div class="hint">${esc(o.hint)}</div>` : ""}`;
  const range = mount.querySelector(".mem-range");
  const num = mount.querySelector(".mem-num");
  const gb = mount.querySelector(".mem-gb");
  const used = mount.querySelector(".mem-used");
  const alloc = mount.querySelector(".mem-alloc");
  const stat = mount.querySelector(".mem-stat");
  const clamp = v => Math.min(max, Math.max(min, Math.round(+v || min)));
  const paint = v => {
    gb.textContent = g(v) + " GB";
    const usedPct = totalMb ? Math.min(100, usedMb / totalMb * 100) : 0;
    const allocPct = totalMb ? Math.min(100 - usedPct, v / totalMb * 100) : 0;
    used.style.width = usedPct + "%";
    alloc.style.left = usedPct + "%";
    alloc.style.width = Math.max(0, allocPct) + "%";
    const over = v > availMb;
    alloc.classList.toggle("over", over);
    let note = "";
    if (over) note = ` <span class="mem-warn">${icon("warn")} 超过当前可用 ${g(availMb)} GB，可能触发频繁 GC 或分配失败</span>`;
    else if (v > 16384) note = ` <span class="mem-warn">${icon("warn")} 过大的堆可能增加 GC 停顿</span>`;
    stat.innerHTML = totalMb
      ? `已用 ${g(usedMb)} GB · 本服分配 <b>${g(v)} GB</b> / 共 ${g(totalMb)} GB${note}`
      : `本服分配 <b>${g(v)} GB</b>`;
  };
  const sync = v => { v = clamp(v); range.value = v; num.value = v; paint(v); };
  range.oninput = () => sync(range.value);
  num.oninput = () => { range.value = clamp(num.value); paint(+range.value); };
  num.onchange = () => sync(num.value);
  sync(o.value);
}

/* server.properties 目录已数据化至 props-catalog.js（window.PROPS_CATALOG，约 60 项，含版本/gamerule 元数据） */

/* ---------- 路由 ---------- */
const Main = () => $("#main");
let consoleES = null; // 当前 SSE 连接
let pollTimer = null;
let prTimer = null;   // 控制台在线玩家延迟刷新定时器（离开视图时清理）

function navigate() {
  if (consoleES) { consoleES.close(); consoleES = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (prTimer) { clearTimeout(prTimer); prTimer = null; }
  const hash = location.hash || "#/instances";
  const m = hash.match(/^#\/([a-z]+)(?:\/(.+))?$/);
  const view = m ? m[1] : "instances";
  const arg = m && m[2] ? decodeURIComponent(m[2]) : null;
  // 底部物品栏高亮：详情归「服务器」、任务页归「合成」，避免进入详情时四格全熄灭失去方位感
  const navKey = view === "inst" ? "instances" : view === "task" ? "create" : view;
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === navKey));
  const mainEl = Main();
  mainEl.classList.remove("center");
  mainEl.classList.remove("view-enter"); void mainEl.offsetWidth; // 重触发跨页淡入
  mainEl.classList.add("view-enter");
  if (view === "create") renderCreate();
  else if (view === "inst" && arg) { const sl = arg.indexOf("/"); sl >= 0 ? renderDetail(arg.slice(0, sl), arg.slice(sl + 1)) : renderDetail(arg); }
  else if (view === "settings") renderSettings(arg);
  else if (view === "tunnels") renderTunnels();
  else if (view === "task" && arg) renderTaskPage(arg);
  else renderInstances();
}
window.addEventListener("hashchange", navigate);

/* 一键开服：Paper 最新正式版 + 推荐设置（空状态入口） */
let quickBusy = false; // 防重入：代理慢时接口耗时较长，避免用户以为「没反应」而重复点击创建出多台
async function quickStart() {
  if (quickBusy) { toast("正在创建，请稍候…"); return; }
  const ok = await confirmModal({ title: "一键开服", okText: "同意并开始", body: "将创建一台 <b>Paper 最新正式版</b> 服务器，采用推荐设置（离线模式、允许飞行、默认端口 25565）。<br>继续即表示同意 <a href='https://aka.ms/MinecraftEULA' target='_blank'>Minecraft EULA</a>。" });
  if (!ok) return;
  quickBusy = true;
  try {
    const app = await api("/api/app");
    const vers = await api("/api/mcversions?core=paper&snapshots=0");
    if (!vers || !vers.length) throw new Error("暂时获取不到 Paper 版本，请改用向导手动创建");
    const mc = (vers.find(v => v.latest) || vers[0]).id;
    const builds = await api(`/api/builds?core=paper&mc=${encodeURIComponent(mc)}`);
    if (!builds || !builds.length) throw new Error("暂时获取不到 Paper 构建，请改用向导手动创建");
    const build = (builds.find(b => b.recommended) || builds[0]).id;
    const mem = Math.max(2048, Math.min(4096, (app.ramMb || 8192) - 2048));
    const r = await api("/api/instances", { method: "POST", body: {
      name: "我的服务器", core: "paper", mc, build, root: "",
      xmxMb: mem, port: 25565, eula: true, onlineMode: false, allowFlight: true,
      difficulty: "easy", gamemode: "survival", motd: "AutoMCHUB 一键开服 · 一起来玩！",
    } });
    toast(`正在部署 Paper ${mc}`);
    location.hash = `#/task/${r.taskId}`;
  } catch (e) { toast(e.message, true); }
  finally { quickBusy = false; }
}

/* ---------- 视图：实例列表 ---------- */
/* 时长秒 → 2h13m / 5m / 45s */
function fmtDur(sec) {
  sec = Math.max(0, sec | 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h${m}m`;
  if (m) return `${m}m`;
  return `${sec}s`;
}

/* 「打开目录」直达菜单：按核心类型列出可用子目录 */
function folderMenu(anchor, info) {
  document.querySelectorAll(".dropmenu").forEach(m => m.remove());
  const isProxy = info.kind === "proxy";
  const hasMods = ["fabric", "forge", "neoforge", "mohist", "banner"].includes(info.core);
  const hasPlugins = ["paper", "purpur", "leaves", "folia", "mohist", "banner", "velocity", "waterfall"].includes(info.core);
  const items = [["", "folder", "实例目录"]];
  if (hasMods) items.push(["mods", "package", "模组 mods"]);
  if (hasPlugins) items.push(["plugins", "plug", "插件 plugins"]);
  if (!isProxy) items.push(["world", "globe", "世界存档"], ["logs", "doc", "日志 logs"], ["crash-reports", "warn", "崩溃报告"]);
  else items.push(["logs", "doc", "日志 logs"]);
  const m = document.createElement("div");
  m.className = "dropmenu";
  m.innerHTML = items.map(([sub, ic, label]) => `<button data-sub="${sub}">${icon(ic)}<span>${label}</span></button>`).join("");
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + "px";
  m.style.top = (r.bottom + 4) + "px";
  m.querySelectorAll("button").forEach(b => b.onclick = async () => {
    m.remove();
    const sub = b.dataset.sub;
    try { await api(`/api/instances/${encodeURIComponent(info.name)}/opendir${sub ? "?sub=" + encodeURIComponent(sub) : ""}`, { method: "POST" }); }
    catch (e) { toast(e.message, true); }
  });
  setTimeout(() => document.addEventListener("click", function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", off); } }), 0);
}

/* 列表骨架占位：首屏加载态（reduced-motion 下由全局关停微光，静态显示凹陷块）。 */
const skeletonCards = (n = 6) => `<div class="cards">` + Array.from({ length: n }, () => `
  <div class="sk-card" aria-hidden="true">
    <div class="sk sk-line" style="width:52%"></div>
    <div class="sk-badges"><span class="sk sk-chip"></span><span class="sk sk-chip" style="width:76px"></span></div>
    <div class="sk sk-line" style="width:64%;height:11px"></div>
    <div class="sk-actions"><span class="sk sk-btn"></span><span class="sk sk-btn" style="width:96px"></span></div>
  </div>`).join("") + `</div>`;

/* 紧凑单列表（版本/构建）行骨架 */
const skeletonRows = (n = 7) => Array.from({ length: n }, () =>
  `<div class="sk-row"><span class="sk" style="width:38%;height:13px"></span><span class="sk" style="width:52px;height:12px"></span></div>`).join("");

async function renderInstances() {
  Main().innerHTML = eyebrow("SERVER LIST") + `<h1>我的服务器</h1>
    <div class="row" style="margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div class="search-field" style="max-width:240px">${icon("search", "sf-ico")}<input type="text" id="inst-q" placeholder="搜索实例名"></div>
      <select id="inst-sort" style="width:170px"><option value="recent">排序：最近创建</option><option value="running">排序：运行中优先</option><option value="name">排序：名称</option></select>
      <span class="grow"></span><span class="sub" id="inst-summary" style="margin:0"></span>
    </div>
    <div id="inst-cards">${skeletonCards()}</div>`;
  let lastSig = "", curList = [];
  const cardHTML = i => {
    const proxy = i.kind === "proxy";
    const gb = (i.xmxMb / 1024).toFixed(1) + "G";
    const cfg = proxy ? `Java ${i.javaMajor} · ${gb}` : `Java ${i.javaMajor} · :${i.port} · ${gb}`;
    return `
    <div class="card st-${i.status}" data-name="${esc(i.name)}">
      <div class="inst-head">${cubeOf(i.core)}<span class="inst-name grow">${esc(i.name)}</span><span class="dot ${i.status}"></span></div>
      <div class="badges">
        <span class="badge core">${coreName(i.core)}</span>
        <span class="badge">${proxy ? "v" : "MC "}${esc(i.mc)}</span>
        ${proxy ? `<span class="badge">代理端</span>` : ""}
      </div>
      <div class="inst-config">${cfg}</div>
      ${i.status === "running" ? `<div class="inst-stat">${icon("clock")} ${fmtDur(i.uptimeSec)}${!proxy ? ` · ${icon("player")} ${i.onlineCount}/${i.maxPlayers}` : ""}</div>` : ""}
      <div class="inst-meta" data-motd="${esc(i.motd || "")}"></div>
      <div class="inst-actions">
        ${i.status === "stopped" ? `<button class="btn sm primary" data-act="start">${icon("play")} 启动</button>` : `<button class="btn sm" data-act="stop">${icon("stop")} 停止</button>`}
        <a class="btn sm" href="#/inst/${encodeURIComponent(i.name)}">控制台 / 设置</a>
        <button class="btn sm" data-act="opendir" title="打开目录" aria-label="打开实例目录">${icon("folder")}</button>
        <button class="btn sm danger" data-act="del">删除</button>
      </div>
      <div class="dur"><i></i></div>
    </div>`;
  };
  const applyView = () => {
    const q = ($("#inst-q").value || "").trim().toLowerCase();
    const sort = $("#inst-sort").value;
    let list = curList.filter(i => !q || i.name.toLowerCase().includes(q));
    if (sort === "name") list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "running") list = list.slice().sort((a, b) => (b.status === "running") - (a.status === "running"));
    if (!list.length) { $("#inst-cards").innerHTML = `<div class="empty" style="padding:40px 0">没有匹配「${esc(q)}」的实例</div>`; return; }
    $("#inst-cards").innerHTML = `<div class="cards">` + list.map(cardHTML).join("") + `</div>`;
    $("#inst-cards").querySelectorAll(".inst-meta").forEach(el => { if (el.dataset.motd) renderMotd(el, el.dataset.motd); });
    $("#inst-cards").querySelectorAll("[data-act]").forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      const name = b.closest(".card").dataset.name, act = b.dataset.act;
      const info = curList.find(x => x.name === name);
      if (act === "opendir") { folderMenu(b, info); return; }
      try {
        if (act === "start") { b.disabled = true; await api(`/api/instances/${encodeURIComponent(name)}/start`, { method: "POST" }); toast(`「${name}」正在启动`); }
        else if (act === "stop") { b.disabled = true; await api(`/api/instances/${encodeURIComponent(name)}/stop`, { method: "POST" }); toast(`「${name}」正在停止并保存世界`); }
        else if (act === "del") {
          const r = await confirmModal({ title: `删除实例「${name}」？`, danger: true, okText: "删除", body: "此操作会将实例从列表移除。", extra: `<label class="switch" style="margin-bottom:16px"><input type="checkbox" data-k="files" checked><span class="sw"></span><span class="sw-label">同时删除服务器文件夹（含地图存档，不可恢复）</span></label>` });
          if (!r) return;
          await api(`/api/instances/${encodeURIComponent(name)}?files=${r.files ? 1 : 0}`, { method: "DELETE" });
          toast(`已删除「${name}」`);
        }
      } catch (e) { toast(e.message, true); }
      lastSig = ""; draw();
    });
    $("#inst-cards").querySelectorAll(".card").forEach(c => c.ondblclick = () => location.hash = `#/inst/${encodeURIComponent(c.dataset.name)}`);
  };
  const draw = async () => {
    let list;
    try { list = await api("/api/instances"); } catch (e) { $("#inst-cards").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    curList = list;
    const running = list.filter(i => i.status === "running").length;
    const online = list.reduce((s, i) => s + (i.onlineCount || 0), 0);
    $("#inst-summary").textContent = list.length ? `共 ${list.length} 台 · 运行中 ${running}${online ? ` · 在线 ${online} 人` : ""}` : "";
    if (!list.length) {
      Main().classList.add("center");
      $("#inst-cards").innerHTML = `<div class="empty"><div class="cube-hero">${cubeOf("vanilla")}</div>这里空空如也<br>一键开一台推荐配置的服务器，或用向导自定义<br><br>
        <button class="btn primary" id="quick-start">${icon("bolt")} 一键开服（Paper 最新正式版）</button>
        <a class="btn" href="#/create" style="margin-left:8px">${icon("craft")} 自定义合成（按 2）</a></div>`;
      $("#quick-start").onclick = quickStart; lastSig = "empty"; return;
    }
    Main().classList.remove("center");
    const sig = list.map(i => `${i.name}:${i.status}:${i.status === "running" ? Math.floor(i.uptimeSec / 60) + "/" + i.onlineCount : ""}`).join("|") + "#" + $("#inst-q").value + "#" + $("#inst-sort").value;
    if (sig === lastSig) return; // 数据无实质变化则跳过重绘，消除周期性闪烁与焦点丢失
    lastSig = sig;
    applyView();
  };
  $("#inst-q").oninput = () => { lastSig = ""; draw(); };
  $("#inst-sort").onchange = () => { lastSig = ""; draw(); };
  await draw();
  pollTimer = setInterval(draw, 3000);
}

/* ---------- 视图：新建向导 ---------- */
const wiz = { step: 0, core: null, mc: null, build: null, snapshots: false, root: "" };

async function renderCreate() {
  wiz.step = 0; wiz.core = null; wiz.mc = null; wiz.build = null; wiz.root = "";
  Main().classList.add("center"); // 模式选择页稀疏，竖向居中消除留白
  Main().innerHTML = eyebrow("CRAFTING") + `<h1>合成新服务器</h1><div class="sub">选择一种方式开始</div>
    <div class="recipe-grid">
      <div class="core-card" id="mode-new"><span class="recipe-ico">${icon("craft")}</span><div><div class="cn">全新合成</div><div class="cd">选择核心与版本，从零搭建服务器</div></div></div>
      <div class="core-card" id="mode-import"><span class="recipe-ico">${icon("package")}</span><div><div class="cn">导入整合包</div><div class="cd">Modrinth (.mrpack) / CurseForge (zip) 整合包一键开服</div></div></div>
    </div>`;
  $("#mode-new").onclick = () => drawWizard();
  $("#mode-import").onclick = () => drawImport();
}

/* ---------- 视图：整合包导入 ---------- */
async function drawImport() {
  Main().classList.remove("center");
  const app = await api("/api/app").catch(() => ({ ramMb: 8192, availRamMb: 4096, config: {} }));
  const maxMem = Math.max(2048, app.ramMb - 2048);
  const defMem = Math.min(6144, maxMem);
  let imRoot = "";
  Main().innerHTML = eyebrow("IMPORT PACK") + `<h1>导入整合包</h1>
    <div class="sub">支持 Modrinth (.mrpack) 与 CurseForge (zip)。核心、MC 版本与加载器将从整合包自动识别。</div>
    <div class="form-grid">
      <label class="field full"><span>整合包文件</span><input type="file" id="im-file" accept=".mrpack,.zip"></label>
      <label class="field"><span>实例名称</span><input type="text" id="im-name" value="我的整合包服务器" maxlength="40"></label>
      <label class="field"><span>端口</span><input type="number" id="im-port" value="25565" min="1" max="65535"></label>
      <div class="field full" id="im-mem-mount"></div>
      <label class="field full"><span>存放位置</span>
        <div class="row" style="gap:8px">
          <input type="text" id="im-root" readonly style="flex:1;cursor:default;background:var(--surface-2)">
          <button type="button" class="btn" id="im-browse">${icon("folder")} 浏览…</button>
        </div></label>
      <div class="field"><label class="switch"><input type="checkbox" id="im-online"><span class="sw"></span>
        <span><span class="sw-label">正版验证</span><div class="sw-desc">默认关闭</div></span></label></div>
      <div class="field"><label class="switch"><input type="checkbox" id="im-flight" checked><span class="sw"></span>
        <span><span class="sw-label">允许飞行</span><div class="sw-desc">整合包强烈建议开启</div></span></label></div>
    </div>
    ${app.config.cfApiKey ? "" : `<div class="hint" style="margin-bottom:10px">提示：CurseForge 格式整合包的模组下载需要 API Key（<a href="https://console.curseforge.com/" target="_blank" style="color:var(--accent)">免费申请</a>后在全局设置填写）；Modrinth 格式无需任何配置。</div>`}
    <div class="eula-box">
      <label class="switch"><input type="checkbox" id="im-eula"><span class="sw"></span>
        <span class="sw-label">我已阅读并同意 <a href="https://aka.ms/MinecraftEULA" target="_blank">Minecraft EULA</a></span></label>
    </div>
    <div class="wizard-foot">
      <button class="btn" id="im-back">${icon("arrowLeft")} 返回</button>
      <button class="btn primary" id="im-go">${icon("bolt")} 导入并部署</button>
    </div>`;
  $("#im-back").onclick = () => renderCreate(); // 直接重绘（hash 相同不会触发路由，不能用 location.hash）
  renderMemoryControl($("#im-mem-mount"), { sliderId: "im-mem", min: 2048, max: maxMem, value: defMem, totalMb: app.ramMb, availMb: app.availRamMb, hint: "整合包服建议 6GB 以上" });
  const imUpdateRoot = () => { $("#im-root").value = imRoot || app.serversRoot || "程序目录\\servers"; };
  imUpdateRoot();
  $("#im-browse").onclick = async () => {
    try { const r = await api("/api/pickdir", { method: "POST" }); if (r.path) { imRoot = r.path; imUpdateRoot(); toast("已选择：" + r.path); } }
    catch (e) { toast(e.message, true); }
  };
  $("#im-go").onclick = async () => {
    const f = $("#im-file").files[0];
    if (!f) { toast("请先选择整合包文件", true); return; }
    if (!$("#im-eula").checked) { toast("需要勾选同意 Minecraft EULA", true); return; }
    $("#im-go").disabled = true;
    $("#im-go").textContent = "上传中…";
    const fd = new FormData();
    fd.append("file", f);
    fd.append("name", $("#im-name").value.trim());
    fd.append("xmxMb", $("#im-mem").value);
    fd.append("port", $("#im-port").value);
    fd.append("eula", "true");
    fd.append("onlineMode", $("#im-online").checked ? "true" : "false");
    fd.append("allowFlight", $("#im-flight").checked ? "true" : "false");
    fd.append("root", imRoot);
    try {
      const res = await fetch("/api/import/modpack", { method: "POST", headers: { "X-Token": TOKEN() }, body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "导入失败");
      toast(`已识别：${j.data.pack.core} ${j.data.pack.mc}（${j.data.pack.files} 个文件）`);
      location.hash = `#/task/${j.data.taskId}`;
    } catch (e) { toast(e.message, true); $("#im-go").disabled = false; $("#im-go").innerHTML = icon("bolt") + " 导入并部署"; }
  };
}

function wizardShell(inner) {
  const names = ["选择核心", "选择版本", "核心构建", "基本设置"];
  Main().innerHTML = eyebrow("CRAFTING") + `<h1>合成新服务器</h1><div class="sub">四步配方：核心 → 版本 → 构建 → 设置</div>
    <div class="steps">${names.map((n, i) =>
      `<span class="step-pill ${i === wiz.step ? "cur" : i < wiz.step ? "done" : ""}">${i + 1}. ${n}</span>`).join("")}</div>
    <div id="wiz-body">${inner}</div>`;
}

async function drawWizard() {
  Main().classList.remove("center"); // 向导内容稠密，取消模式选择页的竖向居中
  if (wiz.step === 0) {
    wizardShell(`<div id="core-grid">${skeletonRows(6)}</div>
      <div class="wizard-foot"><button class="btn" id="wback0">${icon("arrowLeft")} 返回</button><button class="btn primary" id="wnext" disabled>下一步 ${icon("arrowRight")}</button></div>`);
    $("#wback0").onclick = () => renderCreate();
    let cores;
    try { cores = await api("/api/cores"); } catch (e) { $("#core-grid").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    cores.forEach(c => CORES[c.id] = c);
    const CORE_GROUPS = [
      { title: "原版与轻量", ids: ["vanilla"] },
      { title: "插件服（Bukkit / Spigot 系）", ids: ["paper", "purpur", "leaves", "folia"] },
      { title: "模组服（加载器）", ids: ["fabric", "forge", "neoforge"] },
      { title: "混合服（模组 + 插件）", ids: ["mohist", "banner"] },
      { title: "群组代理", ids: ["velocity", "waterfall"] },
    ];
    const REC = "paper";
    const coreCard = c => `
      <div class="core-card ${wiz.core === c.id ? "sel" : ""}" data-id="${c.id}">
        ${cubeOf(c.id)}
        <div><div class="cn">${esc(c.name)} <span class="badge core">${esc(c.tag)}</span>${c.id === REC ? `<span class="rec-badge">新手推荐</span>` : ""}</div>
        <div class="cd">${esc(c.desc)}</div></div>
      </div>`;
    const byId = Object.fromEntries(cores.map(c => [c.id, c]));
    const used = new Set();
    let coreHtml = CORE_GROUPS.map(g => {
      const items = g.ids.map(id => byId[id]).filter(Boolean);
      items.forEach(c => used.add(c.id));
      return items.length ? `<div class="core-group"><div class="cg-title">${g.title}</div><div class="core-grid">${items.map(coreCard).join("")}</div></div>` : "";
    }).join("");
    const rest = cores.filter(c => !used.has(c.id));
    if (rest.length) coreHtml += `<div class="core-group"><div class="cg-title">其它</div><div class="core-grid">${rest.map(coreCard).join("")}</div></div>`;
    $("#core-grid").innerHTML = coreHtml;
    $("#core-grid").querySelectorAll(".core-card").forEach(c => c.onclick = () => {
      wiz.core = c.dataset.id;
      $("#core-grid").querySelectorAll(".core-card").forEach(x => x.classList.toggle("sel", x.dataset.id === wiz.core));
      $("#wnext").disabled = false;
    });
    $("#wnext").onclick = () => { wiz.step = 1; drawWizard(); };
    if (wiz.core) $("#wnext").disabled = false;

  } else if (wiz.step === 1) {
    wizardShell(`
      <div class="row" style="margin-bottom:12px">
        <div class="search-field">${icon("search", "sf-ico")}<input type="text" id="ver-search" placeholder="搜索版本号，如 1.20.1 / 26.2" style="width:280px"></div>
        ${wiz.core === "vanilla" ? `<label class="switch"><input type="checkbox" id="snap-toggle" ${wiz.snapshots ? "checked" : ""}><span class="sw"></span><span class="sw-label">显示快照版</span></label>` : ""}
      </div>
      <div class="ver-list" id="ver-list">${skeletonRows(8)}</div>
      <div class="wizard-foot"><button class="btn" id="wback">${icon("arrowLeft")} 上一步</button><button class="btn primary" id="wnext" ${wiz.mc ? "" : "disabled"}>下一步 ${icon("arrowRight")}</button></div>`);
    $("#wback").onclick = () => { wiz.step = 0; drawWizard(); };
    $("#wnext").onclick = () => { wiz.step = 2; wiz.build = null; drawWizard(); };
    const snapEl = $("#snap-toggle");
    if (snapEl) snapEl.onchange = () => { wiz.snapshots = snapEl.checked; loadVersions(); };
    let all = [];
    const drawList = () => {
      const q = $("#ver-search").value.trim();
      const items = all.filter(v => !q || v.id.includes(q)).slice(0, 300);
      $("#ver-list").innerHTML = items.length ? items.map(v => `
        <div class="ver-item ${wiz.mc === v.id ? "sel" : ""}" data-id="${esc(v.id)}">
          <span>${esc(v.id)}${v.latest ? `<span class="ver-tag">最新</span>` : ""}</span><span class="vt">${v.type === "snapshot" ? "快照" : "正式版"}</span>
        </div>`).join("") : `<div class="ver-item">没有匹配的版本</div>`;
      $("#ver-list").querySelectorAll(".ver-item[data-id]").forEach(el => el.onclick = () => {
        wiz.mc = el.dataset.id;
        $("#ver-list").querySelectorAll(".ver-item").forEach(x => x.classList.toggle("sel", x.dataset.id === wiz.mc));
        $("#wnext").disabled = false;
      });
    };
    const loadVersions = async () => {
      $("#ver-list").innerHTML = skeletonRows(8);
      try {
        all = await api(`/api/mcversions?core=${wiz.core}&snapshots=${wiz.snapshots ? 1 : 0}`);
        drawList();
      } catch (e) { $("#ver-list").innerHTML = `<div class="err-box">${esc(e.message)}<br>可在「全局设置」切换下载源后重试。</div>`; }
    };
    $("#ver-search").oninput = drawList;
    await loadVersions();

  } else if (wiz.step === 2) {
    if (wiz.core === "vanilla") { wiz.step = 3; wiz.build = ""; drawWizard(); return; }
    wizardShell(`<div class="sub">为 ${coreKind(wiz.core) === "proxy" ? "" : "MC "}${esc(wiz.mc)} 选择 ${coreName(wiz.core)} 构建（默认推荐最新稳定）</div>
      <div class="ver-list" id="build-list">${skeletonRows(6)}</div>
      <div class="wizard-foot"><button class="btn" id="wback">${icon("arrowLeft")} 上一步</button><button class="btn primary" id="wnext" disabled>下一步 ${icon("arrowRight")}</button></div>`);
    $("#wback").onclick = () => { wiz.step = 1; drawWizard(); };
    $("#wnext").onclick = () => { wiz.step = 3; drawWizard(); };
    try {
      const builds = await api(`/api/builds?core=${wiz.core}&mc=${encodeURIComponent(wiz.mc)}`);
      if (!builds.length) throw new Error(`${wiz.mc} 暂无 ${coreName(wiz.core)} 构建，请换个版本或核心`);
      if (!wiz.build) wiz.build = (builds.find(b => b.recommended) || builds[0]).id;
      $("#build-list").innerHTML = builds.slice(0, 200).map(b => `
        <div class="ver-item ${wiz.build === b.id ? "sel" : ""}" data-id="${esc(b.id)}">
          <span>${esc(b.id)}${b.recommended ? `<span class="ver-tag">推荐</span>` : ""}</span><span class="vt">${esc(b.label || "")}</span>
        </div>`).join("");
      $("#build-list").querySelectorAll(".ver-item").forEach(el => el.onclick = () => {
        wiz.build = el.dataset.id;
        $("#build-list").querySelectorAll(".ver-item").forEach(x => x.classList.toggle("sel", x.dataset.id === wiz.build));
      });
      $("#wnext").disabled = false;
    } catch (e) { $("#build-list").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }

  } else {
    const isProxy = coreKind(wiz.core) === "proxy";
    const app = await api("/api/app").catch(() => ({ ramMb: 8192, availRamMb: 4096 }));
    const maxMem = Math.max(2048, app.ramMb - 2048);
    const defMem = isProxy ? 1024 : Math.min(4096, maxMem);
    wizardShell(`
      <div class="form-grid">
        <label class="field"><span>实例名称</span><input type="text" id="f-name" value="我的${coreName(wiz.core)}服务器" maxlength="40"></label>
        ${isProxy ? "" : `<label class="field"><span>端口（默认 25565）</span><input type="number" id="f-port" value="25565" min="1" max="65535"></label>`}
        <div class="field full" id="mem-mount"></div>
        <label class="field full"><span>存放位置</span>
          <div class="row" style="gap:8px">
            <input type="text" id="f-root" readonly style="flex:1;cursor:default;background:var(--surface-2)">
            <button type="button" class="btn" id="f-browse">${icon("folder")} 浏览…</button>
          </div>
          <div class="hint" id="f-path"></div>
        </label>
        ${isProxy ? "" : `
        <label class="field full"><span>服务器介绍 MOTD（支持中文与 § 色码）</span><input type="text" id="f-motd" value="AutoMCHUB 开服 · 一起来玩！"></label>
        <div class="field"><label class="switch"><input type="checkbox" id="f-online"><span class="sw"></span>
          <span><span class="sw-label">正版验证（online-mode）</span><div class="sw-desc">默认关闭：离线账户可直接进服</div></span></label></div>
        <div class="field"><label class="switch"><input type="checkbox" id="f-flight" checked><span class="sw"></span>
          <span><span class="sw-label">允许飞行（allow-flight）</span><div class="sw-desc">默认开启：防止模组移动被误踢</div></span></label></div>
        <label class="field"><span>游戏难度</span><select id="f-diff"><option value="peaceful">和平</option><option value="easy" selected>简单</option><option value="normal">普通</option><option value="hard">困难</option></select></label>
        <label class="field"><span>默认游戏模式</span><select id="f-mode"><option value="survival" selected>生存</option><option value="creative">创造</option><option value="adventure">冒险</option><option value="spectator">旁观</option></select></label>
        <div class="hint" style="grid-column:1/-1">更多几十项设置（PVP、视距、白名单、命令方块…）可在创建后的「常用设置」中按分组修改。</div>`}
      </div>
      ${isProxy
        ? `<div class="eula-box">代理端不运行 Minecraft 本体，无需 EULA。其监听端口等配置在首次启动后于实例目录的配置文件中修改。</div>`
        : `<div class="eula-box">
        <label class="switch"><input type="checkbox" id="f-eula"><span class="sw"></span>
          <span class="sw-label">我已阅读并同意 <a href="https://aka.ms/MinecraftEULA" target="_blank">Minecraft 最终用户许可协议 (EULA)</a></span></label>
      </div>`}
      <div class="wizard-foot">
        <button class="btn" id="wback">${icon("arrowLeft")} 上一步</button>
        <button class="btn primary" id="wcreate">${icon("bolt")} 开始部署</button>
      </div>`);
    $("#wback").onclick = () => { wiz.step = wiz.core === "vanilla" ? 1 : 2; drawWizard(); };
    renderMemoryControl($("#mem-mount"), { sliderId: "f-mem", min: 512, max: maxMem, value: defMem, totalMb: app.ramMb, availMb: app.availRamMb, hint: isProxy ? "代理端很省内存，1GB 通常足够" : "模组服建议 4GB 以上；纯净小队游玩 2~4GB 足够" });
    // 存放位置：目标路径跟随实例名，可浏览改到其它盘（中文名会自动生成英文目录）
    const clientSlug = s => { let o = ""; for (const c of (s || "")) { if (/[0-9A-Za-z_-]/.test(c)) o += c; else if (c === " " || c === ".") o += "-"; } o = o.replace(/^[-_]+|[-_]+$/g, ""); return o || "server-（自动）"; };
    const curRoot = () => wiz.root || app.serversRoot || "程序目录\\servers";
    const updateRoot = () => {
      $("#f-root").value = curRoot();
      $("#f-path").innerHTML = `将创建于：<b>${esc(curRoot())}\\${esc(clientSlug($("#f-name").value.trim()))}</b>${wiz.root ? "" : "（可点「浏览」改到其它盘）"}`;
    };
    $("#f-name").oninput = updateRoot;
    $("#f-browse").onclick = async () => {
      try { const r = await api("/api/pickdir", { method: "POST" }); if (r.path) { wiz.root = r.path; updateRoot(); toast("已选择：" + r.path); } }
      catch (e) { toast(e.message, true); }
    };
    updateRoot();
    $("#wcreate").onclick = async () => {
      if (!isProxy && !$("#f-eula").checked) { toast("需要勾选同意 Minecraft EULA 才能开服", true); return; }
      $("#wcreate").disabled = true;
      try {
        const r = await api("/api/instances", {
          method: "POST",
          body: {
            name: $("#f-name").value.trim(),
            core: wiz.core, mc: wiz.mc, build: wiz.build || "",
            root: wiz.root || "",
            xmxMb: +$("#f-mem").value,
            port: isProxy ? 25565 : +$("#f-port").value,
            eula: !isProxy,
            onlineMode: isProxy ? false : $("#f-online").checked,
            allowFlight: isProxy ? false : $("#f-flight").checked,
            motd: isProxy ? "" : $("#f-motd").value.trim(),
            difficulty: isProxy ? "" : $("#f-diff").value,
            gamemode: isProxy ? "" : $("#f-mode").value,
          },
        });
        location.hash = `#/task/${r.taskId}`;
      } catch (e) { toast(e.message, true); $("#wcreate").disabled = false; }
    };
  }
}

/* ---------- 视图：创建任务进度 ---------- */
async function renderTaskPage(taskId) {
  Main().innerHTML = eyebrow("DEPLOYING") + `<h1>正在部署服务器</h1><div class="sub">自动下载 Java 与服务端核心，全程无需手动配置</div>
    <div id="task-box">加载中…</div>`;
  const icons = { pending: "·", running: ">", done: "OK", error: "X" };
  const draw = async () => {
    let t;
    try { t = await api(`/api/tasks/${taskId}`); } catch (e) { $("#task-box").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; clearInterval(pollTimer); return; }
    const pct = t.total > 0 ? Math.min(100, t.done / t.total * 100) : 0;
    $("#task-box").innerHTML = `
      <div class="task-steps">${(t.steps || []).map(s =>
        `<div class="task-step ${s.status}"><span class="ts-ico">${icons[s.status]}</span>${esc(s.name)}</div>`).join("")}</div>
      ${t.label ? `<div class="progress-wrap"><div class="progress-bar"><div style="width:${pct}%"></div></div>
        <div class="progress-text">${esc(t.label)} · ${fmtBytes(t.done)}${t.total > 0 ? " / " + fmtBytes(t.total) : ""}</div></div>` : ""}
      ${t.error ? `<div class="err-box"><b>创建失败：</b>${esc(t.error)}<br><br>可返回重试（已下载的文件有缓存，重试很快）。</div>` : ""}
      ${(t.warnings || []).map(w => `<div class="warn-card">
        <div class="wc-title">${icon("warn")} ${esc(w.title)}</div>
        ${w.note ? `<div class="wc-note">${esc(w.note)}</div>` : ""}
        ${(w.items || []).length ? `<ul class="wc-list">${w.items.map(it =>
          `<li>${/^https?:\/\//i.test(it.url || "") ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.name)}</a>` : esc(it.name)}</li>`).join("")}</ul>` : ""}
      </div>`).join("")}
      <div class="task-log" id="task-log">${(t.log || []).map(esc).join("\n")}</div>
      <div class="save-bar">
        ${t.ended && !t.error ? `<a class="btn primary" href="#/inst/${encodeURIComponent(t.result)}">${icon("check")} 完成，进入控制台</a>` : ""}
        ${t.ended && t.error ? `<a class="btn" href="#/create">${icon("arrowLeft")} 返回重试</a>` : ""}
        ${!t.ended ? `<span class="warn-text">部署中，请勿关闭程序…</span>` : ""}
      </div>`;
    const lg = $("#task-log");
    lg.scrollTop = lg.scrollHeight;
    if (t.ended) { clearInterval(pollTimer); pollTimer = null; if (!t.error) toast("服务器创建成功 🎉"); }
  };
  // 首次 draw 若因任何原因抛错，也必须启动轮询——否则后续状态永远无法刷新，页面会永久停在「加载中…」。
  try { await draw(); } catch (e) { console.warn("首次任务渲染失败，转由轮询接管：", e); }
  pollTimer = setInterval(draw, 800);
}

/* ---------- 视图：实例详情 ---------- */
async function renderDetail(name, tab = "console") {
  // 标签切换时不经过 navigate()，需自行清理上一视图的连接与定时器
  if (consoleES) { consoleES.close(); consoleES = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (prTimer) { clearTimeout(prTimer); prTimer = null; }
  let list;
  try { list = await api("/api/instances"); } catch (e) { Main().innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
  const info = list.find(i => i.name === name);
  if (!info) { Main().innerHTML = `<div class="err-box">实例不存在</div>`; return; }
  Main().innerHTML = eyebrow(`${String(info.core).toUpperCase()} · ${info.mc}`) + `
    <div class="detail-head">
      ${cubeOf(info.core)}
      <span class="dot ${info.status}" id="d-dot"></span>
      <h1 style="margin:0">${esc(name)}</h1>
      <span class="badge core">${coreName(info.core)}</span>
      <span class="badge">${info.kind === "proxy" ? "v" : "MC "}${esc(info.mc)}</span>
      <span class="badge">Java ${info.javaMajor}</span>
      <span class="grow"></span>
      <button class="btn primary" id="d-start" ${info.status !== "stopped" ? "disabled" : ""}>${icon("play")} 启动</button>
      <button class="btn" id="d-stop" ${info.status === "stopped" ? "disabled" : ""}>${icon("stop")} 停止</button>
      <button class="btn" id="d-dir">${icon("folder")} 打开目录</button>
    </div>
    <div class="tabs">${(() => {
      const isProxy = info.kind === "proxy";
      const tabs = [["console", "控制台"]];
      if (!isProxy) tabs.push(["players", "玩家"], ["backups", "备份"]);
      tabs.push(["tasks", "任务"]);
      if (info.core !== "vanilla") tabs.push(["res", "资源"]);
      if (!isProxy) tabs.push(["common", "常用设置"], ["raw", "全部配置"]);
      tabs.push(["jvm", "内存 / 启动"]);
      return tabs.map(([id, label]) => `<span class="tab ${tab === id ? "cur" : ""}" data-t="${id}">${label}</span>`).join("");
    })()}</div>
    <div id="tab-body"></div>`;
  document.querySelectorAll(".tab").forEach(t => t.onclick = () => location.hash = "#/inst/" + encodeURIComponent(name) + "/" + t.dataset.t);
  $("#d-dir").onclick = () => api(`/api/instances/${encodeURIComponent(name)}/opendir`, { method: "POST" }).catch(e => toast(e.message, true));
  $("#d-start").onclick = async () => {
    try { $("#d-start").disabled = true; await api(`/api/instances/${encodeURIComponent(name)}/start`, { method: "POST" }); toast("正在启动，首次生成世界可能需要一两分钟"); refreshHead(); }
    catch (e) { toast(e.message, true); $("#d-start").disabled = false; }
  };
  $("#d-stop").onclick = async () => {
    try { await api(`/api/instances/${encodeURIComponent(name)}/stop`, { method: "POST" }); toast("正在保存世界并停止"); }
    catch (e) { toast(e.message, true); }
  };
  const refreshHead = async () => {
    try {
      const l = await api("/api/instances");
      const cur = l.find(i => i.name === name);
      if (!cur) return;
      $("#d-dot").className = "dot " + cur.status;
      $("#d-start").disabled = cur.status !== "stopped";
      $("#d-stop").disabled = cur.status === "stopped";
    } catch {}
  };
  pollTimer = setInterval(refreshHead, 2500);

  const body = $("#tab-body");
  if (tab === "console") {
    body.innerHTML = `
      <div class="console-bar">
        <div class="search-field">${icon("search", "sf-ico")}<input type="text" id="con-filter" placeholder="过滤日志（如 ERROR / 玩家名）" style="width:280px"></div>
        <label class="switch"><input type="checkbox" id="con-scroll" checked><span class="sw"></span><span class="sw-label">自动滚动</span></label>
        <span class="grow"></span>
        <span class="hint">编码</span>
        <select id="con-enc" style="width:110px">
          ${["auto", "utf-8", "gbk"].map(e => `<option value="${e}" ${info.consoleEncoding === e ? "selected" : ""}>${e}</option>`).join("")}
        </select>
        <button class="btn sm" id="con-fs-dn" title="缩小字号">A-</button>
        <button class="btn sm" id="con-fs-up" title="放大字号">A+</button>
        <button class="btn sm" id="con-copy" title="复制全部" aria-label="复制全部">${icon("copy")}</button>
        <button class="btn sm" id="con-export" title="导出为 txt" aria-label="导出为 txt">${icon("download")}</button>
      </div>
      <div class="console" id="console"></div>
      <div class="console-input">
        <div class="cmd-suggest" id="cmd-suggest"></div>
        <input type="text" id="cmd-in" autocomplete="off" placeholder="输入服务器命令（回车发送，Tab 补全，↑↓ 翻历史），如 op 玩家名 / say 大家好">
        <button class="btn" id="cmd-send">发送</button>
      </div>`;
    const con = $("#console");
    const filterEl = $("#con-filter");
    // 命令补全用：在线玩家名（进出游戏时刷新）
    let onlinePlayers = [];
    const refreshPlayers = () => api(`/api/instances/${encodeURIComponent(name)}/players`)
      .then(pl => { onlinePlayers = pl.online || []; }).catch(() => {});
    const schedulePlayerRefresh = () => { clearTimeout(prTimer); prTimer = setTimeout(refreshPlayers, 600); };
    refreshPlayers();
    // 字号（localStorage 记忆）+ 复制 / 导出
    let conFS = +(localStorage.getItem("amh_con_fs") || 12.5);
    const applyFS = () => { con.style.fontSize = conFS + "px"; };
    applyFS();
    $("#con-fs-dn").onclick = () => { conFS = Math.max(9, conFS - 1); localStorage.setItem("amh_con_fs", conFS); applyFS(); };
    $("#con-fs-up").onclick = () => { conFS = Math.min(22, conFS + 1); localStorage.setItem("amh_con_fs", conFS); applyFS(); };
    const conText = () => [...con.childNodes].map(d => d.textContent).join("\n");
    $("#con-copy").onclick = () => copy(conText(), "已复制控制台内容");
    $("#con-export").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([conText()], { type: "text/plain;charset=utf-8" }));
      a.download = `${name}-console.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const classify = line => {
      if (line.startsWith(">") || line.startsWith("[AutoMCHUB]")) return "cmd-echo";
      if (/ERROR|SEVERE|FATAL|Exception|^\tat |^Caused by/.test(line)) return "lv-err";
      if (/WARN/.test(line)) return "lv-warn";
      return "";
    };
    const push = line => {
      const d = document.createElement("div");
      d.textContent = line;
      const cls = classify(line);
      if (cls) d.className = cls;
      const q = filterEl.value.trim().toLowerCase();
      if (q && !line.toLowerCase().includes(q)) d.style.display = "none";
      con.appendChild(d);
      while (con.childNodes.length > 3000) con.removeChild(con.firstChild);
      if ($("#con-scroll").checked) con.scrollTop = con.scrollHeight;
      if (/ (joined|left) the game/.test(line)) schedulePlayerRefresh();
    };
    filterEl.oninput = () => {
      const q = filterEl.value.trim().toLowerCase();
      con.childNodes.forEach(d => d.style.display = (!q || d.textContent.toLowerCase().includes(q)) ? "" : "none");
    };
    $("#con-enc").onchange = async () => {
      try {
        await api(`/api/instances/${encodeURIComponent(name)}/settings`, { method: "PUT", body: { xmxMb: 0, xmsMb: 0, consoleEncoding: $("#con-enc").value } });
        toast("编码已切换，对之后的新输出生效");
      } catch (e) { toast(e.message, true); }
    };
    consoleES = new EventSource(`/api/instances/${encodeURIComponent(name)}/console?token=${TOKEN()}`);
    consoleES.onmessage = e => push(JSON.parse(e.data));
    consoleES.onerror = () => push("[AutoMCHUB] 控制台连接中断，切换页面可重连");
    const histKey = "amh_hist_" + name;
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem(histKey)) || []; } catch {}
    let histIdx = -1, draft = "";
    const send = async () => {
      const v = $("#cmd-in").value.trim();
      if (!v) return;
      $("#cmd-in").value = "";
      closeSugg();
      if (hist[0] !== v) { hist.unshift(v); hist = hist.slice(0, 50); localStorage.setItem(histKey, JSON.stringify(hist)); }
      histIdx = -1;
      try { await api(`/api/instances/${encodeURIComponent(name)}/command`, { method: "POST", body: { cmd: v } }); }
      catch (e) { toast(e.message, true); }
    };
    $("#cmd-send").onclick = send;

    /* ---- 命令补全（常用命令 + 在线玩家名，Tab / 点击补全） ---- */
    const COMMON_CMDS = [
      "say ", "tell ", "op ", "deop ", "kick ", "ban ", "ban-ip ", "pardon ", "tp ", "give ",
      "gamemode ", "defaultgamemode ", "difficulty ", "time set day", "time set night",
      "weather clear", "weather rain", "whitelist ", "gamerule ", "kill ", "xp ", "effect ",
      "title ", "setworldspawn", "list", "save-all", "save-off", "save-on", "seed", "reload", "stop",
    ];
    const PLAYER_CMDS = new Set(["op", "deop", "kick", "ban", "ban-ip", "pardon", "tp", "kill", "give", "gamemode", "xp", "effect", "tell", "title"]);
    const WL_SUB = ["add", "remove", "on", "off", "list", "reload"];
    const suggEl = $("#cmd-suggest");
    let sugg = [], suggIdx = -1;
    const closeSugg = () => { sugg = []; suggIdx = -1; suggEl.style.display = "none"; suggEl.innerHTML = ""; };
    const computeSugg = val => {
      if (!val) return [];
      const words = val.split(/\s+/).filter(Boolean);
      const trailingSpace = /\s$/.test(val);
      const first = (words[0] || "").toLowerCase();
      const lastSpace = val.lastIndexOf(" ");
      const head = val.slice(0, lastSpace + 1);
      const token = val.slice(lastSpace + 1).toLowerCase();
      const players = t => onlinePlayers.filter(n => n.toLowerCase().startsWith(t)).slice(0, 8).map(n => ({ label: n, insert: head + n }));
      if (words.length <= 1 && !trailingSpace) {
        const p = val.toLowerCase();
        return COMMON_CMDS.filter(c => c.toLowerCase().startsWith(p) && c.trim().toLowerCase() !== p)
          .slice(0, 8).map(c => ({ label: c.trim(), insert: c }));
      }
      if (first === "whitelist") {
        if (words.length === 1 || (words.length === 2 && !trailingSpace)) {
          return WL_SUB.filter(s => s.startsWith(token)).map(s => ({ label: s, insert: head + s + " " }));
        }
        if (words[1] === "add" || words[1] === "remove") return players(token);
        return [];
      }
      if (PLAYER_CMDS.has(first)) return players(token);
      return [];
    };
    const renderSugg = () => {
      if (!sugg.length) { closeSugg(); return; }
      suggEl.innerHTML = sugg.map((s, i) => `<div class="cs-item${i === suggIdx ? " sel" : ""}" data-i="${i}">${esc(s.label)}</div>`).join("");
      suggEl.style.display = "block";
      suggEl.querySelectorAll(".cs-item").forEach(el => { el.onmousedown = ev => { ev.preventDefault(); applySugg(+el.dataset.i); }; });
    };
    const applySugg = i => {
      const s = sugg[i]; if (!s) return;
      const inp = $("#cmd-in");
      inp.value = s.insert; inp.focus();
      updateSugg();
    };
    const updateSugg = () => { sugg = computeSugg($("#cmd-in").value); suggIdx = -1; renderSugg(); };
    $("#cmd-in").oninput = updateSugg;
    $("#cmd-in").onblur = () => setTimeout(closeSugg, 120);
    $("#cmd-in").onkeydown = e => {
      const open = suggEl.style.display === "block" && sugg.length;
      if (open && e.key === "Tab") { e.preventDefault(); applySugg(suggIdx < 0 ? 0 : suggIdx); return; }
      if (open && e.key === "ArrowDown") { e.preventDefault(); suggIdx = (suggIdx + 1) % sugg.length; renderSugg(); return; }
      if (open && e.key === "ArrowUp") { e.preventDefault(); suggIdx = (suggIdx - 1 + sugg.length) % sugg.length; renderSugg(); return; }
      if (open && e.key === "Escape") { e.preventDefault(); closeSugg(); return; }
      if (open && e.key === "Enter" && suggIdx >= 0) { e.preventDefault(); applySugg(suggIdx); return; }
      if (e.key === "Enter") { send(); return; }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (histIdx < hist.length - 1) { if (histIdx === -1) draft = $("#cmd-in").value; histIdx++; $("#cmd-in").value = hist[histIdx]; }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (histIdx > -1) { histIdx--; $("#cmd-in").value = histIdx === -1 ? draft : hist[histIdx]; }
      }
    };

  } else if (tab === "players") {
    const act = async (action, player) => {
      try {
        await api(`/api/instances/${encodeURIComponent(name)}/players`, { method: "POST", body: { action, player } });
        toast(`已执行 ${action} ${player}` + (info.status === "stopped" ? "" : "（名单文件稍后由服务器刷新）"));
        setTimeout(draw, 800);
      } catch (e) { toast(e.message, true); }
    };
    const draw = async () => {
      let pl;
      try { pl = await api(`/api/instances/${encodeURIComponent(name)}/players`); }
      catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
      const section = (title, items, addAction, removeAction, hint) => `
        <div class="p-sec">
          <div class="p-sec-head"><b>${title}</b>（${items.length}）
            <input type="text" data-add="${addAction}" placeholder="输入玩家名，回车添加">
            ${hint ? `<span class="hint">${hint}</span>` : ""}
          </div>
          <div class="badges">${items.map(p =>
            `<span class="badge">${esc(p.name)}<a class="p-x" data-act="${removeAction}" data-p="${esc(p.name)}" title="移除" aria-label="移除">${icon("x")}</a></span>`).join("") || `<span class="sub">空</span>`}</div>
        </div>`;
      body.innerHTML = `<div class="players-grid">
        <div class="p-sec">
          <div class="p-sec-head"><b>在线玩家</b>（${pl.online.length}）<button class="btn sm" id="pl-refresh">${icon("refresh")} 刷新</button></div>
          <div class="badges">${pl.online.map(n => `<span class="badge core">${esc(n)}
            <a class="p-x" data-act="op" data-p="${esc(n)}" title="设为管理员">OP</a>
            <a class="p-x" data-act="kick" data-p="${esc(n)}" title="踢出">踢</a></span>`).join("") || `<span class="sub">暂无玩家在线</span>`}</div>
        </div>
        ${section("白名单", pl.whitelist, "whitelist-add", "whitelist-remove", "需在常用设置开启 white-list 才生效")}
        ${section("管理员 OP", pl.ops, "op", "deop", "")}
        ${section("封禁名单", pl.banned, "ban", "pardon", "")}
      </div>`;
      $("#pl-refresh").onclick = draw;
      body.querySelectorAll("input[data-add]").forEach(inp => inp.onkeydown = e => {
        if (e.key === "Enter" && inp.value.trim()) { act(inp.dataset.add, inp.value.trim()); inp.value = ""; }
      });
      body.querySelectorAll(".p-x").forEach(a => a.onclick = () => act(a.dataset.act, a.dataset.p));
    };
    await draw();

  } else if (tab === "backups") {
    const appInfo = await api("/api/app").catch(() => ({ config: {} }));
    let keep = (appInfo.config && appInfo.config.backupKeep) || 10;
    const draw = async () => {
      let list;
      try { list = await api(`/api/instances/${encodeURIComponent(name)}/backups`); }
      catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
      body.innerHTML = `
        <div class="row" style="margin-bottom:10px;flex-wrap:wrap">
          <input type="text" id="bk-label" placeholder="备份标签（可选，如：打龙前）" style="max-width:240px">
          <button class="btn primary" id="bk-create">${icon("camera")} 立即备份世界</button>
          <span class="grow"></span>
          <label class="hint" style="display:flex;align-items:center;gap:6px;margin:0">保留最近 <input type="number" id="bk-keep" min="1" max="1000" value="${keep}" style="width:64px"> 份</label>
          <button class="btn sm" id="bk-keep-save">保存</button>
        </div>
        <div class="hint" style="margin-bottom:14px">运行中自动热备（save-off → 压缩 → save-on）；备份数超过保留份数时自动滚动删除最旧的；删除实例不影响已有备份。保留份数为全局设置，对所有实例生效。</div>
        <table class="raw">${(list || []).map(b => `
          <tr><td>${esc(b.file)}</td><td>${b.sizeMb.toFixed(1)} MB · ${esc(b.time)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn sm" data-restore="${esc(b.file)}">${icon("restore")} 还原</button>
            <button class="btn sm danger" data-del="${esc(b.file)}">删除</button></td></tr>`).join("") ||
          `<tr><td class="sub">暂无备份</td></tr>`}</table>`;
      $("#bk-create").onclick = async () => {
        $("#bk-create").disabled = true;
        try {
          const r = await api(`/api/instances/${encodeURIComponent(name)}/backups`, { method: "POST", body: { label: $("#bk-label").value.trim() } });
          toast(`备份完成：${r.file}`);
        } catch (e) { toast(e.message, true); }
        draw();
      };
      $("#bk-keep-save").onclick = async () => {
        const n = Math.max(1, Math.min(1000, Math.round(+$("#bk-keep").value) || 10));
        try { await api("/api/config", { method: "PUT", body: { backupKeep: n } }); keep = n; toast(`已设置保留最近 ${n} 份（下次备份时生效）`); }
        catch (e) { toast(e.message, true); }
      };
      body.querySelectorAll("[data-restore]").forEach(b => b.onclick = async () => {
        const r = await confirmModal({
          title: "还原备份？", danger: true, okText: "还原",
          body: `将把世界回滚到 <b>${esc(b.dataset.restore)}</b>。<br>需要服务器处于停止状态；当前世界会先自动备份一份。`,
        });
        if (!r) return;
        try { await api(`/api/instances/${encodeURIComponent(name)}/backups/restore`, { method: "POST", body: { file: b.dataset.restore } }); toast("还原完成"); }
        catch (e) { toast(e.message, true); }
        draw();
      });
      body.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
        const r = await confirmModal({ title: "删除备份？", danger: true, okText: "删除", body: esc(b.dataset.del) });
        if (!r) return;
        try { await api(`/api/instances/${encodeURIComponent(name)}/backups?file=${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); }
        catch (e) { toast(e.message, true); }
        draw();
      });
    };
    await draw();

  } else if (tab === "tasks") {
    let pol;
    try { pol = await api(`/api/instances/${encodeURIComponent(name)}/policies`); }
    catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    let scheds = pol.schedules || [];
    const TYPE_NAMES = { restart: "定时重启", command: "定时命令", backup: "定时备份" };
    body.innerHTML = `
      <div class="prop-item" style="max-width:560px;margin-bottom:18px">
        <div><div class="pl">崩溃自动重启</div><div class="pd">异常退出后按 10/30/60 秒退避重启；连续 3 次崩溃放弃并提示</div></div>
        <label class="switch"><input type="checkbox" id="pol-crash" ${pol.crashRestart ? "checked" : ""}><span class="sw"></span></label>
      </div>
      <h3 style="margin-bottom:8px">每日定时任务</h3>
      <div id="sched-list" style="max-width:640px"></div>
      <div class="row" style="margin:12px 0 18px;flex-wrap:wrap">
        <select id="sc-type" style="width:130px"><option value="restart">定时重启</option><option value="command">定时命令</option><option value="backup">定时备份</option></select>
        <input type="time" id="sc-at" value="04:00" style="width:130px">
        <input type="text" id="sc-args" placeholder="命令内容（仅定时命令需要），如 say 大家好" style="max-width:300px">
        <button class="btn" id="sc-add">${icon("plus")} 添加</button>
      </div>
      <button class="btn primary" id="pol-save">${icon("save")} 保存策略</button>`;
    const drawScheds = () => {
      $("#sched-list").innerHTML = scheds.map((s, i) => `
        <div class="java-row"><span class="badge core">${esc(TYPE_NAMES[s.type] || s.type)}</span>
          <span class="jv">每天 ${esc(s.at)}</span>
          <span class="jp">${esc(s.args || "")}</span>
          <button class="btn sm danger" data-i="${i}">移除</button></div>`).join("") ||
        `<div class="sub">暂无定时任务</div>`;
      $("#sched-list").querySelectorAll("[data-i]").forEach(b => b.onclick = () => { scheds.splice(+b.dataset.i, 1); drawScheds(); });
    };
    drawScheds();
    $("#sc-add").onclick = () => {
      const s = { type: $("#sc-type").value, at: $("#sc-at").value, args: $("#sc-args").value.trim() };
      if (!s.at) { toast("请选择时间", true); return; }
      if (s.type === "command" && !s.args) { toast("定时命令需要填写命令内容", true); return; }
      scheds.push(s);
      $("#sc-args").value = "";
      drawScheds();
    };
    $("#pol-save").onclick = async () => {
      try {
        await api(`/api/instances/${encodeURIComponent(name)}/policies`, { method: "PUT", body: { crashRestart: $("#pol-crash").checked, schedules: scheds } });
        toast("策略已保存并即时生效");
      } catch (e) { toast(e.message, true); }
    };

  } else if (tab === "res") {
    body.innerHTML = `
      <div class="row" style="margin-bottom:12px;flex-wrap:wrap">
        <div class="search-field">${icon("search", "sf-ico")}<input type="text" id="res-q" placeholder="搜索 Modrinth 模组/插件（英文名效果更好）" style="width:340px"></div>
        <button class="btn" id="res-go">${icon("search")} 搜索</button>
        <span class="hint">已按当前核心与版本过滤兼容资源 · 数据来自 Modrinth（免费开放）</span>
      </div>
      <div id="res-list"><div class="sub">输入关键词搜索，或直接点搜索看热门资源</div></div>`;
    const search = async () => {
      $("#res-list").textContent = "搜索中…";
      try {
        const r = await api(`/api/instances/${encodeURIComponent(name)}/resources/search?q=${encodeURIComponent($("#res-q").value.trim())}`);
        $("#res-list").innerHTML = (r.hits || []).map(h => `
          <div class="java-row" style="max-width:880px">
            ${h.icon_url ? `<img src="${esc(h.icon_url)}" width="34" height="34" style="border-radius:7px;flex:none" onerror="this.remove()">` : `<span class="res-noicon">${icon("package")}</span>`}
            <div style="flex:1;min-width:0"><b>${esc(h.title)}</b>
              <div class="jp" style="white-space:normal;max-height:32px;overflow:hidden">${esc(h.description)}</div></div>
            <span class="jv" style="color:var(--muted);display:inline-flex;align-items:center;gap:4px">${h.downloads >= 1e6 ? (h.downloads / 1e6).toFixed(1) + "M" : Math.round(h.downloads / 1e3) + "k"}${icon("download")}</span>
            <button class="btn sm primary" data-rid="${esc(h.project_id)}" data-rt="${esc(h.title)}">${icon("download")} 安装</button>
          </div>`).join("") || `<div class="sub">没有找到兼容 ${esc(info.mc)} 的资源，换个关键词试试</div>`;
        $("#res-list").querySelectorAll("[data-rid]").forEach(b => b.onclick = async () => {
          b.disabled = true;
          b.textContent = "安装中…";
          try {
            const res = await api(`/api/instances/${encodeURIComponent(name)}/resources/install`, { method: "POST", body: { projectId: b.dataset.rid } });
            toast(`已安装 ${b.dataset.rt} → ${res.file}（重启服务器生效）`);
            b.innerHTML = icon("check") + " 已安装";
          } catch (e) { toast(e.message, true); b.disabled = false; b.innerHTML = icon("download") + " 安装"; }
        });
      } catch (e) { $("#res-list").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
    };
    $("#res-go").onclick = search;
    $("#res-q").onkeydown = e => { if (e.key === "Enter") search(); };

  } else if (tab === "common") {
    if (info.kind === "proxy") {
      body.innerHTML = `<div class="sub">代理端的监听端口、后端服务器列表等配置位于实例目录内其自带的配置文件（Velocity: velocity.toml；Waterfall: config.yml），首次启动后自动生成，用「打开目录」按钮编辑即可。</div>`;
      return;
    }
    let data;
    try { data = await api(`/api/instances/${encodeURIComponent(name)}/properties`); } catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    const cur = Object.fromEntries(data.pairs.map(p => [p.key, p.value]));
    const mc = info.mc, running = data.running;
    const GROUPS = ["基础与玩法", "世界生成", "玩家与权限", "性能", "网络与远程管理", "资源包", "安全与杂项"];
    // 按实例版本计算适用项与呈现模式（gamerule 迁移项在新版转为 /gamerule 控件）
    const items = [];
    for (const p of (window.PROPS_CATALOG || [])) {
      if (p.since && verLt(mc, p.since)) continue;                 // 尚未引入
      let mode;
      if (p.type === "gamerule-bool") mode = (p.removed && verGte(mc, p.removed)) ? "gamerule" : "bool";
      else { if (p.removed && verGte(mc, p.removed)) continue; mode = p.type; } // 该版本已移除的属性 → 隐藏
      if (p.key === "level-type" && verLt(mc, "1.16")) mode = "str";  // 旧版世界类型写法不同，转自由文本
      items.push({ ...p, mode });
    }
    const inGroup = g => items.filter(p => p.group === g);
    const fieldHTML = p => {
      const v = cur[p.key] ?? p.def;
      if (p.key === "motd") return `<div class="motd-palette" id="motd-pal"></div>
        <input type="text" data-k="motd" id="motd-in" value="${esc(v ?? "")}" style="width:100%;margin-top:6px"><div class="motd-preview" id="motd-prev"></div>`;
      if (p.mode === "gamerule") return `<label class="switch" title="游戏规则：服务器运行时通过 /gamerule 即时生效"><input type="checkbox" data-gr="${p.gamerule}" ${v === "true" ? "checked" : ""} ${running ? "" : "disabled"}><span class="sw"></span></label>`;
      if (p.mode === "bool") return `<label class="switch"><input type="checkbox" data-k="${p.key}" ${v === "true" ? "checked" : ""}><span class="sw"></span></label>`;
      if (p.mode === "sel") return `<select data-k="${p.key}">${p.opts.map((o, i) => `<option value="${o}" ${v === o ? "selected" : ""}>${esc(p.optNames ? p.optNames[i] : o)}</option>`).join("")}</select>`;
      if (p.mode === "int") return `<input type="number" data-k="${p.key}" value="${esc(v ?? "")}">`;
      return `<input type="text" data-k="${p.key}" value="${esc(v ?? "")}" style="width:200px">`;
    };
    const rowHTML = p => {
      const tags = (p.restart ? `<span class="ri-restart">重启生效</span>` : "") + (p.mode === "gamerule" ? `<span class="gr-tag">游戏规则</span>` : "");
      const notice = (p.key === "white-list" && verGte(mc, "26.3")) ? `<div class="pd" style="color:var(--gold)">注意：此版本起白名单默认开启</div>` : "";
      const grHint = (p.mode === "gamerule" && !running) ? "（服务器启动后可切换）" : "";
      if (p.key === "motd") return `<div class="prop-item wide" data-search="${esc(p.label)} ${p.key}"><div style="flex:1">
        <div class="pl">${esc(p.label)} ${tags}</div><div class="pd">${esc(p.desc || "")}</div><div class="pd" style="font-family:var(--mono)">${p.key}</div>${fieldHTML(p)}</div></div>`;
      return `<div class="prop-item" data-search="${esc(p.label)} ${p.key}"><div>
        <div class="pl">${esc(p.label)} ${tags}</div><div class="pd">${esc(p.desc || "")}${grHint}</div>${notice}<div class="pd" style="font-family:var(--mono)">${p.key}</div></div>${fieldHTML(p)}</div>`;
    };
    body.innerHTML = `
      <div class="common-bar">
        <div class="search-field">${icon("search", "sf-ico")}<input type="text" id="cp-search" placeholder="搜索设置项（中文名 / 键名，如 视距 / rcon）" style="width:320px"></div>
        <div class="cp-chips">${GROUPS.map((g, i) => inGroup(g).length ? `<button class="cp-chip" data-g="${i}">${g}</button>` : "").join("")}</div>
      </div>
      ${data.pairs.length === 0 ? `<div class="warn-text" style="margin-bottom:12px;display:flex;align-items:flex-start;gap:7px;line-height:1.7">${icon("warn")}<span>服务器还未首次启动，部分配置项将在首次启动后由服务端补全；现在设置的值会被保留。</span></div>` : ""}
      <div id="cp-list">${GROUPS.map((g, i) => {
        const gi = inGroup(g);
        return gi.length ? `<div class="cp-group" id="cpg-${i}"><h3 class="cp-gh">${g}<span class="cp-gn">${gi.length}</span></h3>
          <div class="props-grid">${gi.map(rowHTML).join("")}</div></div>` : "";
      }).join("")}</div>
      <div class="save-bar">
        <button class="btn primary" id="props-save">${icon("save")} 保存设置</button>
        ${running ? `<span class="warn-text">${icon("warn")} 运行中：属性类修改需重启生效（游戏规则即时生效）</span>` : ""}
      </div>`;
    body.querySelectorAll(".cp-chip").forEach(c => c.onclick = () => $("#cpg-" + c.dataset.g, body)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    $("#cp-search").oninput = () => {
      const q = $("#cp-search").value.trim().toLowerCase();
      body.querySelectorAll(".cp-group").forEach(g => {
        let any = false;
        g.querySelectorAll(".prop-item").forEach(it => {
          const hit = !q || (it.dataset.search || "").toLowerCase().includes(q);
          it.style.display = hit ? "" : "none"; if (hit) any = true;
        });
        g.style.display = any ? "" : "none";
      });
    };
    // 游戏规则开关：运行时即时发送 /gamerule（不写入 server.properties）
    body.querySelectorAll("[data-gr]").forEach(sw => sw.onchange = async () => {
      const rule = sw.dataset.gr, val = sw.checked;
      try { await api(`/api/instances/${encodeURIComponent(name)}/command`, { method: "POST", body: { cmd: `gamerule ${rule} ${val}` } }); toast(`已设置 gamerule ${rule} ${val}`); }
      catch (e) { toast(e.message, true); sw.checked = !val; }
    });
    // MOTD 编辑器：色码调色板 + 实时预览
    const motdIn = $("#motd-in", body);
    if (motdIn) {
      const pal = $("#motd-pal", body);
      const prev = $("#motd-prev", body);
      const styles = [{ c: "l", t: "粗体" }, { c: "o", t: "斜体" }, { c: "n", t: "下划线" }, { c: "m", t: "删除线" }, { c: "r", t: "重置" }];
      [..."0123456789abcdef"].forEach(c => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pal-btn";
        b.style.background = MC_COLORS[c];
        b.title = "§" + c;
        b.onclick = () => insertCode(c);
        pal.appendChild(b);
      });
      styles.forEach(({ c, t }) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pal-btn txt";
        b.textContent = t;
        b.title = "§" + c;
        b.onclick = () => insertCode(c);
        pal.appendChild(b);
      });
      function insertCode(c) {
        const pos = motdIn.selectionStart ?? motdIn.value.length;
        motdIn.value = motdIn.value.slice(0, pos) + "§" + c + motdIn.value.slice(pos);
        motdIn.focus();
        motdIn.selectionStart = motdIn.selectionEnd = pos + 2;
        renderMotd(prev, motdIn.value);
      }
      motdIn.oninput = () => renderMotd(prev, motdIn.value);
      renderMotd(prev, motdIn.value);
    }
    $("#props-save").onclick = async () => {
      const pairs = [];
      body.querySelectorAll("[data-k]").forEach(el => {
        let val;
        if (el.type === "checkbox") val = el.checked ? "true" : "false";
        else val = el.value;
        if (el.type === "number" || el.type === "text" || el.tagName === "SELECT") {
          if (val === "" && !(el.dataset.k in cur)) return; // 未设置且为空的跳过
        }
        pairs.push({ key: el.dataset.k, value: String(val) });
      });
      try {
        await api(`/api/instances/${encodeURIComponent(name)}/properties`, { method: "PUT", body: { pairs } });
        toast("已保存 server.properties" + (data.running ? "（重启后生效）" : ""));
      } catch (e) { toast(e.message, true); }
    };

  } else if (tab === "raw") {
    let data;
    try { data = await api(`/api/instances/${encodeURIComponent(name)}/properties`); } catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    if (!data.pairs.length) { body.innerHTML = `<div class="sub">配置文件为空 —— 首次启动服务器后，服务端会自动生成全部配置项。</div>`; return; }
    const LABELS = Object.fromEntries((window.PROPS_CATALOG || []).map(p => [p.key, p.label]));
    body.innerHTML = `<div class="sub">server.properties 全部键值（高级）。改完点保存。已知项附中文名。</div>
      <table class="raw">${data.pairs.map(p =>
        `<tr><td>${esc(p.key)}</td><td class="raw-cn">${LABELS[p.key] ? esc(LABELS[p.key]) : ""}</td><td><input type="text" data-k="${esc(p.key)}" value="${esc(p.value)}"></td></tr>`).join("")}</table>
      <div class="save-bar"><button class="btn primary" id="raw-save">${icon("save")} 保存全部</button>
      ${data.running ? `<span class="warn-text">${icon("warn")} 运行中，重启后生效</span>` : ""}</div>`;
    $("#raw-save").onclick = async () => {
      const pairs = [...body.querySelectorAll("input[data-k]")].map(el => ({ key: el.dataset.k, value: el.value }));
      try { await api(`/api/instances/${encodeURIComponent(name)}/properties`, { method: "PUT", body: { pairs } }); toast("已保存"); }
      catch (e) { toast(e.message, true); }
    };

  } else if (tab === "jvm") {
    const appInfo = await api("/api/app").catch(() => ({ ramMb: 8192, availRamMb: 4096 }));
    const maxMem = Math.max(2048, appInfo.ramMb - 2048);
    const aikarsFlags = xmxMb => {
      const big = xmxMb >= 12288;
      return ["-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200",
        "-XX:+UnlockExperimentalVMOptions", "-XX:+DisableExplicitGC", "-XX:+AlwaysPreTouch",
        big ? "-XX:G1NewSizePercent=40" : "-XX:G1NewSizePercent=30",
        big ? "-XX:G1MaxNewSizePercent=50" : "-XX:G1MaxNewSizePercent=40",
        big ? "-XX:G1HeapRegionSize=16M" : "-XX:G1HeapRegionSize=8M",
        big ? "-XX:G1ReservePercent=15" : "-XX:G1ReservePercent=20",
        "-XX:G1HeapWastePercent=5", "-XX:G1MixedGCCountTarget=4",
        big ? "-XX:InitiatingHeapOccupancyPercent=20" : "-XX:InitiatingHeapOccupancyPercent=15",
        "-XX:G1MixedGCLiveThresholdPercent=90", "-XX:G1RSetUpdatingPauseTimePercent=5",
        "-XX:SurvivorRatio=32", "-XX:+PerfDisableSharedMem", "-XX:MaxTenuringThreshold=1",
        "-Dusing.aikars.flags=https://mcflags.emc.gs", "-Daikars.new.flags=true"];
    };
    body.innerHTML = `
      <div style="max-width:640px">
        <div class="field" id="jm-mem-mount"></div>
        <label class="field"><span>自定义 JVM 参数（每行一个或空格分隔；-Xmx/-Xms 由上方内存自动生成，无需在此填写）</span>
          <textarea id="jm-jvm" rows="5" spellcheck="false" placeholder="如：-XX:+UseG1GC">${esc((info.extraJvm || []).join("\n"))}</textarea></label>
        <div class="row" style="margin-bottom:12px;flex-wrap:wrap">
          <button class="btn sm" id="jm-aikar">${icon("bolt")} 套用 Aikar's Flags（G1GC 优化）</button>
          <button class="btn sm" id="jm-clear">清空</button>
        </div>
        <div class="hint" style="margin-bottom:14px">Java ${info.javaMajor}（便携运行时，独立管理，不影响系统）<br>实例目录：${esc(info.dir)}<br>手动启动：双击实例目录中的 run.bat（与此处配置同步）</div>
        <button class="btn primary" id="jm-save">${icon("save")} 保存（重启后生效）</button>
      </div>`;
    renderMemoryControl($("#jm-mem-mount"), { sliderId: "jm-mem", min: 1024, max: maxMem, value: Math.min(info.xmxMb, maxMem), totalMb: appInfo.ramMb, availMb: appInfo.availRamMb });
    $("#jm-aikar").onclick = () => { $("#jm-jvm").value = aikarsFlags(+$("#jm-mem").value).join("\n"); toast("已填入 Aikar's Flags，点保存生效"); };
    $("#jm-clear").onclick = () => { $("#jm-jvm").value = ""; };
    $("#jm-save").onclick = async () => {
      const flags = $("#jm-jvm").value.split(/\s+/).map(s => s.trim()).filter(Boolean);
      try {
        await api(`/api/instances/${encodeURIComponent(name)}/settings`, { method: "PUT", body: { xmxMb: +$("#jm-mem").value, xmsMb: 0, extraJvm: flags } });
        toast("已保存内存与 JVM 参数");
      } catch (e) { toast(e.message, true); }
    };
  }
}

/* ---------- 视图：联机穿透 ---------- */
async function renderTunnels() {
  let insts = [];
  try { insts = await api("/api/instances"); } catch {}
  Main().innerHTML = eyebrow("MULTIPLAYER") + `<h1>联机穿透</h1>
    <div class="sub">把本地服务器映射到公网，异地朋友直接连。基于 <b>OpenFrp OPENAPI</b>，并支持 SakuraFrp 与自建 frps。</div>
    <div id="tun-list">${skeletonRows(4)}</div>
    <button class="btn" id="tn-toggle" style="margin:24px 0 10px">${icon("plus")} 添加隧道…</button>
    <div id="tn-form" hidden>
    <div class="hint" style="margin-bottom:12px;line-height:1.8">
      <b>OpenFrp</b>：到 <a href="https://console.openfrp.net" target="_blank" style="color:var(--accent)">OpenFrp 控制台</a> 创建 TCP 隧道（本地端口填 MC 端口）→「个人中心」复制用户密钥；<br>
      <b>樱花frp</b>：到 <a href="https://www.natfrp.com" target="_blank" style="color:var(--accent)">SakuraFrp</a> 创建隧道 → 复制访问密钥与隧道 ID（首次需手动放置其 frpc，按提示操作）；<br>
      <b>自定义</b>：填自己 frps 服务器的地址、端口与 token。
    </div>
    <div class="form-grid">
      <label class="field"><span>服务商</span><select id="tn-provider">
        <option value="openfrp">OpenFrp（免费公益）</option>
        <option value="natfrp">樱花frp SakuraFrp</option>
        <option value="custom">自定义 frps</option></select></label>
      <label class="field"><span>隧道名称</span><input type="text" id="tn-name" value="我的隧道" maxlength="30"></label>
      <label class="field" data-f="cred"><span id="tn-cred-label">用户密钥（个人中心复制）</span><input type="password" id="tn-cred" placeholder="仅保存在本机"></label>
      <label class="field" data-f="proxy"><span>隧道 ID</span><input type="text" id="tn-proxy" placeholder="如 123456"></label>
      <label class="field" data-f="saddr" hidden><span>frps 服务器地址</span><input type="text" id="tn-saddr" placeholder="1.2.3.4 或 frp.example.com"></label>
      <label class="field" data-f="sport" hidden><span>frps 端口</span><input type="number" id="tn-sport" value="7000"></label>
      <label class="field" data-f="rport" hidden><span>公网远程端口</span><input type="number" id="tn-rport" value="25566"></label>
      <label class="field" data-f="lport" hidden><span>本地端口（MC 服务器端口）</span><input type="number" id="tn-lport" value="25565"></label>
      <label class="field"><span>绑定实例</span><select id="tn-bound"><option value="">不绑定</option>
        ${insts.map(i => `<option value="${esc(i.name)}">${esc(i.name)}（端口 ${i.port}）</option>`).join("")}</select></label>
      <div class="field"><label class="switch"><input type="checkbox" id="tn-auto" checked><span class="sw"></span>
        <span><span class="sw-label">跟随实例启动</span><div class="sw-desc">绑定的服务器启动时自动拉起隧道</div></span></label></div>
    </div>
    <button class="btn primary" id="tn-add">${icon("plus")} 添加隧道</button>
    </div>`;

  const PROV_NAMES = { openfrp: "OpenFrp", natfrp: "樱花frp", custom: "自定义" };
  const provSel = $("#tn-provider");
  const applyFields = () => {
    const p = provSel.value;
    const show = { cred: true, proxy: p !== "custom", saddr: p === "custom", sport: p === "custom", rport: p === "custom", lport: p === "custom" };
    document.querySelectorAll("[data-f]").forEach(el => el.hidden = !show[el.dataset.f]);
    $("#tn-cred-label").textContent = { openfrp: "用户密钥（个人中心复制）", natfrp: "访问密钥", custom: "auth token（frps 未设可留空）" }[p];
  };
  provSel.onchange = applyFields;
  applyFields();
  $("#tn-toggle").onclick = () => { const f = $("#tn-form"); f.hidden = !f.hidden; if (!f.hidden) f.scrollIntoView({ behavior: "smooth", block: "nearest" }); };

  let logOpen = false;
  const drawList = async () => {
    if (logOpen) return; // 日志展开时暂停列表刷新，避免打断 SSE 显示
    let list;
    try { list = await api("/api/tunnels"); } catch (e) { $("#tun-list").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    if (!list.length) { $("#tun-list").innerHTML = `<div class="empty"><div class="empty-ico">${icon("compass", "ico-xl")}</div>还没有隧道<br>在下方添加一条，开服后一键把本地服务器映射到公网</div>`; return; }
    $("#tun-list").innerHTML = list.map(t => `
      <div class="java-row" style="max-width:980px">
        <span class="dot ${t.running ? "running" : ""}"></span>
        <b style="min-width:110px">${esc(t.name)}</b>
        <span class="badge core">${esc(PROV_NAMES[t.provider] || t.provider)}</span>
        ${t.boundInstance ? `<span class="badge">${icon("link")} ${esc(t.boundInstance)}${t.autoStart ? " · 跟随" : ""}</span>` : ""}
        ${t.publicAddr ? `<span class="jv" style="color:var(--accent)">${esc(t.publicAddr)}</span>
          <button class="btn sm" data-copy="${esc(t.publicAddr)}">${icon("copy")} 复制</button>`
          : t.lastError ? `<span class="jp" style="color:var(--redstone);display:inline-flex;align-items:center;gap:5px" title="${esc(t.lastError)}">${icon("warn")} ${esc(t.lastError.length > 46 ? t.lastError.slice(0, 46) + "…" : t.lastError)}</span>`
          : `<span class="jp">${t.running ? "连接中…" : "尚未启动"}</span>`}
        <span class="grow"></span>
        ${t.running ? `<button class="btn sm" data-tstop="${t.id}">${icon("stop")} 停止</button>` : `<button class="btn sm primary" data-tstart="${t.id}">${icon("play")} 启动</button>`}
        <button class="btn sm" data-tlog="${t.id}">日志</button>
        <button class="btn sm danger" data-tdel="${t.id}">删除</button>
      </div>
      <div class="task-log" id="tlog-${t.id}" style="display:none;height:150px;max-width:980px;margin:-2px 0 8px"></div>`).join("");
    $("#tun-list").querySelectorAll("[data-copy]").forEach(b => b.onclick = () => {
      copy(b.dataset.copy, "已复制公网地址：" + b.dataset.copy);
    });
    $("#tun-list").querySelectorAll("[data-tstart]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await api(`/api/tunnels/${b.dataset.tstart}/start`, { method: "POST" }); toast("隧道启动中，公网地址稍后显示在列表"); }
      catch (e) { toast(e.message, true); }
      setTimeout(drawList, 600);
    });
    $("#tun-list").querySelectorAll("[data-tstop]").forEach(b => b.onclick = async () => {
      try { await api(`/api/tunnels/${b.dataset.tstop}/stop`, { method: "POST" }); } catch (e) { toast(e.message, true); }
      setTimeout(drawList, 400);
    });
    $("#tun-list").querySelectorAll("[data-tdel]").forEach(b => b.onclick = async () => {
      const r = await confirmModal({ title: "删除隧道？", danger: true, okText: "删除", body: "仅删除本机配置，服务商侧隧道不受影响。" });
      if (!r) return;
      try { await api(`/api/tunnels/${b.dataset.tdel}`, { method: "DELETE" }); } catch (e) { toast(e.message, true); }
      drawList();
    });
    $("#tun-list").querySelectorAll("[data-tlog]").forEach(b => b.onclick = () => {
      const box = $("#tlog-" + b.dataset.tlog);
      if (box.style.display !== "none") { box.style.display = "none"; logOpen = false; if (consoleES) { consoleES.close(); consoleES = null; } return; }
      document.querySelectorAll(".task-log[id^=tlog-]").forEach(x => x.style.display = "none");
      if (consoleES) { consoleES.close(); consoleES = null; }
      logOpen = true;
      box.style.display = "";
      box.textContent = "";
      consoleES = new EventSource(`/api/tunnels/${b.dataset.tlog}/console?token=${TOKEN()}`);
      consoleES.onmessage = e => {
        box.textContent += JSON.parse(e.data) + "\n";
        box.scrollTop = box.scrollHeight;
      };
    });
  };
  await drawList();
  pollTimer = setInterval(drawList, 4000);

  $("#tn-add").onclick = async () => {
    const p = provSel.value;
    const body = {
      provider: p,
      name: $("#tn-name").value.trim(),
      credential: $("#tn-cred").value.trim(),
      proxyId: $("#tn-proxy").value.trim(),
      serverAddr: $("#tn-saddr").value.trim(),
      serverPort: +$("#tn-sport").value || 0,
      remotePort: +$("#tn-rport").value || 0,
      localPort: +$("#tn-lport").value || 25565,
      boundInstance: $("#tn-bound").value,
      autoStart: $("#tn-auto").checked,
    };
    try {
      await api("/api/tunnels", { method: "POST", body });
      toast("隧道已添加");
      drawList();
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------- 视图：全局设置 ---------- */
const SETTINGS_SECTIONS = [
  { id: "download", label: "下载与网络", icon: "globe" },
  { id: "storage", label: "存储位置", icon: "folder" },
  { id: "java", label: "Java 运行时", icon: "coffee" },
  { id: "remote", label: "远程访问", icon: "phone" },
  { id: "notify", label: "通知与集成", icon: "bell" },
  { id: "startup", label: "启动与托盘", icon: "monitor" },
  { id: "about", label: "更新与关于", icon: "info" },
];

async function renderSettings(section) {
  if (!SETTINGS_SECTIONS.some(s => s.id === section)) section = "download";
  let info;
  try { info = await api("/api/app"); } catch (e) { Main().innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
  Main().innerHTML = `<div class="settings-page">` + eyebrow("OPTIONS") + `<h1>全局设置</h1>
    <div class="settings-layout">
      <nav class="settings-nav">${SETTINGS_SECTIONS.map(s => `
        <a class="set-nav ${s.id === section ? "cur" : ""}" href="#/settings/${s.id}"><span class="sn-ico">${icon(s.icon)}</span>${s.label}</a>`).join("")}</nav>
      <div class="settings-body" id="set-body"><div class="sub">加载中…</div></div>
    </div></div>`;
  const body = $("#set-body");
  ({ download: setDownload, storage: setStorage, java: setJava, remote: setRemote, notify: setNotify, startup: setStartup, about: setAbout }[section])(body, info);
}

/* 分区标题；sub 允许富文本（调用方自负安全，标题走 esc） */
function settingsHead(t, sub) {
  return `<div class="set-sec-head"><h2>${esc(t)}</h2>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}

/* 行式开关（标题 + 副标题 + 右侧开关），data-cfg 携带配置键 */
function switchRow(title, desc, key, on) {
  return `<div class="row-item"><div class="ri-head"><div class="ri-main">
      <div class="ri-title">${esc(title)}</div><div class="ri-sub">${esc(desc)}</div></div>
    <div class="ri-right"><label class="switch"><input type="checkbox" data-cfg="${key}" ${on ? "checked" : ""}><span class="sw"></span></label></div>
  </div></div>`;
}

/* — 启动与托盘 — */
function setStartup(body, info) {
  const c = info.config || {};
  body.innerHTML = settingsHead("启动与托盘", "控制关闭窗口的行为与开机自启。托盘图标在程序运行时始终显示，右键可「打开面板 / 全部停止并退出」，左键点击恢复窗口。") +
    `<div class="row-list">
      ${switchRow("最小化到系统托盘", "开启后点窗口关闭按钮不退出程序，而是收进托盘、服务器继续运行；点托盘图标即可恢复窗口。关闭则保持现状——点关闭即停服退出。", "minimizeToTray", c.minimizeToTray)}
      ${switchRow("开机自动启动", "登录 Windows 后自动在后台（托盘）启动 AutoMCHUB。写入当前用户启动项（HKCU\\…\\Run，免管理员）；程序换目录后重新开关一次即修正路径。", "autoStart", info.autoStart)}
    </div>
    <div class="hint" style="margin-top:12px">开机自启以「静默进托盘」方式启动（附加 -minimized 参数），配合上面的托盘开关体验最佳。</div>`;
  body.querySelectorAll("input[data-cfg]").forEach(inp => inp.onchange = async () => {
    const key = inp.dataset.cfg;
    try {
      await api("/api/config", { method: "PUT", body: { [key]: inp.checked } });
      if (key === "minimizeToTray") c.minimizeToTray = inp.checked; else info.autoStart = inp.checked;
      toast(inp.checked ? "已开启" : "已关闭");
    } catch (e) { toast(e.message, true); inp.checked = !inp.checked; }
  });
}

/* — 下载与网络 — */
function setDownload(body, info) {
  const src = info.config.source || "auto";
  const opts = [
    { v: "auto", t: "自动（推荐）", d: "国内镜像（BMCLAPI / 清华）优先，失败自动切换官方源" },
    { v: "mirror", t: "仅国内镜像", d: "只用 BMCLAPI 与清华镜像（Paper/Purpur 无镜像，仍走官方）" },
    { v: "official", t: "仅官方源", d: "只用 Mojang / Forge / Adoptium 等官方源（海外网络适用）" },
  ];
  body.innerHTML = settingsHead("下载源", "下载 Java 与服务端核心时的线路选择。") +
    `<div class="radio-cards" id="src-cards">${opts.map(o => `
      <div class="radio-card ${src === o.v ? "sel" : ""}" data-v="${o.v}"><div><div class="rt">${o.t}</div><div class="rd">${o.d}</div></div></div>`).join("")}</div>` +
    settingsHead("CurseForge API Key（选填）", `导入 CurseForge 格式整合包时解析模组直链用，<a href="https://console.curseforge.com/" target="_blank" style="color:var(--accent)">免费申请</a>；Modrinth 格式整合包无需配置。`) +
    `<div class="row"><input type="password" id="cf-key" value="${esc(info.config.cfApiKey || "")}" placeholder="粘贴 API Key" style="max-width:420px"><button class="btn" id="cf-save">保存</button></div>`;
  $("#src-cards").querySelectorAll(".radio-card").forEach(c => c.onclick = async () => {
    try {
      await api("/api/config", { method: "PUT", body: { source: c.dataset.v } });
      $("#src-cards").querySelectorAll(".radio-card").forEach(x => x.classList.toggle("sel", x === c));
      toast("下载源已切换");
    } catch (e) { toast(e.message, true); }
  });
  $("#cf-save").onclick = async () => {
    try { await api("/api/config", { method: "PUT", body: { cfApiKey: $("#cf-key").value.trim() } }); toast("CurseForge API Key 已保存"); }
    catch (e) { toast(e.message, true); }
  };
}

/* — 存储位置 — */
function storageRow(title, path, desc, pick) {
  return `<div class="row-item"><div class="ri-head"><div class="ri-main">
      <div class="ri-title">${esc(title)}</div><div class="ri-sub">${esc(desc)}</div><div class="ri-key">${esc(path || "")}</div></div>
    <div class="ri-right">
      <button class="btn sm" data-open="${esc(path || "")}">${icon("folder")} 打开</button>
      <button class="btn sm" data-pick="${pick}">更改…</button>
      <button class="btn sm" data-reset="${pick}" title="恢复默认目录" aria-label="恢复默认目录">${icon("refresh")}</button>
    </div></div></div>`;
}
function setStorage(body, info) {
  const draw = () => {
    body.innerHTML = settingsHead("存储位置", "服务器实例与备份的存放根目录。更改仅对之后新建的实例 / 备份生效，已有实例不会自动搬家。") +
      `<div class="row-list">
        ${storageRow("服务器存放目录", info.serversRoot, "新实例默认创建于此目录下（每个实例一个子文件夹，中文名自动生成英文目录）", "servers")}
        ${storageRow("备份存放目录", info.backupsRoot, "世界热备份的存放位置", "backups")}
        <div class="row-item"><div class="ri-head"><div class="ri-main">
          <div class="ri-title">程序数据目录</div><div class="ri-sub">程序自身、Java 运行时与下载缓存所在（便携，随程序整体迁移）</div><div class="ri-key">${esc(info.base)}</div></div>
          <div class="ri-right"><button class="btn sm" data-open="${esc(info.base)}">${icon("folder")} 打开</button></div></div></div>
      </div>
      <div class="hint" style="margin-top:12px">建议放到大容量分区（如 D 盘）以免占满系统盘；点「更改…」会弹出系统文件夹选择框（仅本机可用，手机远程管理时请在主机操作）。</div>`;
    body.querySelectorAll("[data-open]").forEach(b => b.onclick = () =>
      api("/api/openpath", { method: "POST", body: { path: b.dataset.open } }).catch(e => toast(e.message, true)));
    body.querySelectorAll("[data-pick]").forEach(b => b.onclick = async () => {
      try {
        const r = await api("/api/pickdir", { method: "POST" });
        if (!r.path) return;
        const key = b.dataset.pick === "servers" ? "serversDir" : "backupsDir";
        await api("/api/config", { method: "PUT", body: { [key]: r.path } });
        if (b.dataset.pick === "servers") info.serversRoot = r.path; else info.backupsRoot = r.path;
        toast("已更新目录（对新建生效）");
        draw();
      } catch (e) { toast(e.message, true); }
    });
    body.querySelectorAll("[data-reset]").forEach(b => b.onclick = async () => {
      try {
        const key = b.dataset.reset === "servers" ? "serversDir" : "backupsDir";
        await api("/api/config", { method: "PUT", body: { [key]: "" } });
        const fresh = await api("/api/app");
        info.serversRoot = fresh.serversRoot; info.backupsRoot = fresh.backupsRoot;
        toast("已恢复默认目录");
        draw();
      } catch (e) { toast(e.message, true); }
    });
  };
  draw();
}

/* — Java 运行时 — */
async function setJava(body, info) {
  body.innerHTML = settingsHead("Java 运行时", "创建实例时优先复用本机已装 Java → 便携运行时 → 自动下载。") + `<div class="sub">加载中…</div>`;
  let javas = { portable: [], scanned: [] };
  try { javas = await api("/api/javas"); } catch {}
  body.innerHTML = settingsHead("Java 运行时", "创建实例时优先复用本机已装 Java → 便携运行时 → 自动下载。") +
    `${javas.portable.length ? `<div class="badges" style="margin-bottom:10px">${javas.portable.map(j => `<span class="badge core">便携 Java ${j.major}</span>`).join("")}</div>` : ""}
    <div class="row-list">${javas.scanned.length ? javas.scanned.map(j => `
      <div class="row-item"><div class="ri-head"><div class="ri-main">
        <div class="ri-title">Java ${j.major} <span class="badge">${esc(j.version)}</span></div>
        <div class="ri-key">${esc(j.path)}</div></div></div></div>`).join("")
      : `<div class="sub">尚未发现本机安装的 Java，点击下方扫描</div>`}</div>
    <div class="row" style="margin-top:12px;flex-wrap:wrap">
      <button class="btn" id="java-scan">${icon("refresh")} 重新扫描本机 Java</button>
      <input type="text" id="java-path" placeholder="手动添加：粘贴 java.exe 或 JDK 目录路径" style="max-width:420px">
      <button class="btn" id="java-add">添加</button>
    </div>`;
  $("#java-scan").onclick = async () => {
    $("#java-scan").disabled = true; $("#java-scan").textContent = "扫描中…（约数秒）";
    try { const list = await api("/api/javas/scan", { method: "POST" }); toast(`扫描完成，发现 ${list.length} 个 Java`); setJava(body, info); }
    catch (e) { toast(e.message, true); $("#java-scan").disabled = false; $("#java-scan").innerHTML = icon("refresh") + " 重新扫描本机 Java"; }
  };
  $("#java-add").onclick = async () => {
    const p = $("#java-path").value.trim(); if (!p) return;
    try { const j = await api("/api/javas/add", { method: "POST", body: { path: p } }); toast(`已添加 Java ${j.major}（${j.version}）`); setJava(body, info); }
    catch (e) { toast(e.message, true); }
  };
}

/* — 远程访问 — */
function setRemote(body, info) {
  const lanPort = info.port || location.port || "27333"; // 实际监听端口（被占用时会随机化）
  body.innerHTML = settingsHead("远程访问（手机 / 平板管理）", "开启后本机 IP 可从局域网访问管理界面（密码保护，改动需重启程序生效）。") +
    `<div class="row" style="margin-bottom:10px;flex-wrap:wrap">
      <label class="switch"><input type="checkbox" id="lan-on" ${info.config.listenLan ? "checked" : ""}><span class="sw"></span><span class="sw-label">允许局域网访问</span></label>
      <input type="password" id="lan-pw" placeholder="${info.lanSet ? "已设置密码（留空则不修改）" : "设置访问密码（必填）"}" style="max-width:260px">
      <button class="btn" id="lan-save">保存</button>
    </div>
    ${info.config.listenLan ? `<div class="hint">手机访问：${(info.ips || []).map(ip => `<b style="color:var(--accent-text)">http://${esc(ip)}:${esc(String(lanPort))}</b>`).join(" 或 ")}</div>` : ""}
    <div class="hint">若无法访问，请以管理员运行一次放行防火墙：<code>netsh advfirewall firewall add rule name="AutoMCHUB" dir=in action=allow protocol=TCP localport=${esc(String(lanPort))}</code></div>`;
  $("#lan-save").onclick = async () => {
    const b = { listenLan: $("#lan-on").checked };
    if ($("#lan-pw").value) b.lanPassword = $("#lan-pw").value;
    try { await api("/api/config", { method: "PUT", body: b }); toast("远程访问设置已保存，重启 AutoMCHUB 后生效"); }
    catch (e) { toast(e.message, true); }
  };
}

/* — 通知与集成 — */
function setNotify(body, info) {
  body.innerHTML = settingsHead("Webhook 事件推送（选填）", "服务器启停/崩溃、玩家进出、备份完成、隧道上线等事件将 POST 到该地址（JSON），可接入群机器人等。") +
    `<div class="row"><input type="text" id="wh-url" value="${esc(info.config.webhookUrl || "")}" placeholder="https://example.com/hook（留空关闭）" style="max-width:460px"><button class="btn" id="wh-save">保存</button></div>`;
  $("#wh-save").onclick = async () => {
    try { await api("/api/config", { method: "PUT", body: { webhookUrl: $("#wh-url").value.trim() } }); toast("Webhook 已保存，即时生效"); }
    catch (e) { toast(e.message, true); }
  };
}

/* — 更新与关于 — */
function setAbout(body, info) {
  body.innerHTML = settingsHead("版本与更新", "") +
    `<div class="row-list" style="margin-bottom:14px">
      <div class="row-item"><div class="ri-head"><div class="ri-main"><div class="ri-title">当前版本</div><div class="ri-sub">AutoMCHUB · Windows 本地 Minecraft 开服工具</div></div><div class="ri-right"><span class="badge core">v${esc(info.version)}</span></div></div></div>
    </div>
    <div class="row" style="flex-wrap:wrap;margin-bottom:10px">
      <input type="text" id="up-repo" value="${esc(info.config.updateRepo || "")}" placeholder="GitHub 仓库，如 yourname/AutoMCHUB" style="max-width:300px">
      <button class="btn" id="up-save">保存</button>
      <button class="btn" id="up-check">${icon("search")} 检查更新</button>
      <span id="up-result" class="hint"></span>
    </div>
    <div class="row-list" style="margin-bottom:18px">
      <div class="row-item"><div class="ri-head"><div class="ri-main"><div class="ri-title">启动时静默检查更新</div><div class="ri-sub">程序启动后在后台检查一次新版本（需已填写更新仓库）</div></div>
        <div class="ri-right"><label class="switch"><input type="checkbox" id="up-silent" ${info.config.checkUpdateOnStart ? "checked" : ""}><span class="sw"></span></label></div></div></div>
    </div>` +
    settingsHead("关于", "") +
    `<div class="hint" style="line-height:1.9">
      内网穿透基于 <b>OpenFrp OPENAPI</b> 接入（<a href="https://www.openfrp.net" target="_blank" style="color:var(--accent)">openfrp.net</a>）。<br>
      本软件为开源项目，遵循仓库 LICENSE（MIT）。<br>
      Minecraft 是 Mojang Studios 的商标，本工具与 Mojang / Microsoft 无隶属关系。
    </div>
    <div class="set-danger">
      <div><div class="ri-title">退出程序</div><div class="ri-sub">优雅停止所有运行中的服务器（保存世界）后退出</div></div>
      <button class="btn danger" id="quit-app">${icon("power")} 退出 AutoMCHUB</button>
    </div>`;
  $("#up-save").onclick = async () => {
    try { await api("/api/config", { method: "PUT", body: { updateRepo: $("#up-repo").value.trim() } }); toast("更新仓库已保存"); }
    catch (e) { toast(e.message, true); }
  };
  $("#up-silent").onchange = async () => {
    try { await api("/api/config", { method: "PUT", body: { checkUpdateOnStart: $("#up-silent").checked } }); toast($("#up-silent").checked ? "已开启启动时检查更新" : "已关闭启动时检查更新"); }
    catch (e) { toast(e.message, true); $("#up-silent").checked = !$("#up-silent").checked; }
  };
  $("#up-check").onclick = async () => {
    $("#up-result").textContent = "检查中…";
    try {
      const r = await api("/api/update/check", { method: "POST" });
      if (r.hasUpdate) {
        $("#up-result").innerHTML = `发现新版本 <b style="color:var(--accent-text)">${esc(r.latest.tag)}</b>（当前 v${esc(r.current)}）`;
        const btn = document.createElement("button");
        btn.className = "btn sm primary";
        btn.innerHTML = icon("arrowUp") + " 立即更新并重启";
        btn.onclick = async () => {
          btn.disabled = true;
          try { await api("/api/update/apply", { method: "POST" }); document.body.innerHTML = `<div style="padding:80px;text-align:center;color:var(--muted)">正在更新，程序将自动重启…</div>`; }
          catch (e) { toast(e.message, true); btn.disabled = false; }
        };
        $("#up-result").appendChild(btn);
      } else {
        $("#up-result").textContent = `已是最新（v${r.current}）`;
      }
    } catch (e) { $("#up-result").textContent = e.message; }
  };
  $("#quit-app").onclick = async () => {
    const r = await confirmModal({ title: "退出 AutoMCHUB？", body: "将优雅停止所有运行中的服务器（保存世界）后退出程序。", okText: "退出", danger: true });
    if (!r) return;
    try { await api("/api/shutdown", { method: "POST" }); document.body.innerHTML = `<div style="padding:80px;text-align:center;color:var(--muted)">AutoMCHUB 正在停止服务器并退出，可以关闭此页面了。</div>`; }
    catch (e) { toast(e.message, true); }
  };
}

/* 首次运行引导卡（选下载源 + 存放位置说明；写 config.onboarded 后不再出现） */
function showOnboarding(info) {
  const root = $("#modal-root");
  const SRC = { auto: "自动（推荐）— 国内镜像优先，失败自动回退官方源", mirror: "镜像优先 — 国内下载更快", official: "仅官方源 — 网络直连国外" };
  const cur = (info.config && info.config.source) || "auto";
  root.innerHTML = `<div class="modal-mask"><div class="modal onboard">
    <h3>👋 欢迎使用 AutoMCHUB</h3>
    <div class="m-body">
      开始前先确认两项设置，之后都能在「设置」里随时更改：
      <div class="ob-sec"><div class="ob-label">下载源</div>
        <div id="ob-src">${Object.entries(SRC).map(([v, label]) =>
    `<label class="ob-radio"><input type="radio" name="ob-src" value="${v}" ${v === cur ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div>
      </div>
      <div class="ob-sec"><div class="ob-label">你的服务器将存放在</div>
        <div class="ob-path">${esc(info.serversRoot || "程序目录\\servers")}</div>
        <div class="hint" style="margin-top:6px">每台服务器一个子文件夹。想放到 D 盘等大容量分区，可到「设置 → 存储位置」更改。</div>
      </div>
    </div>
    <div class="m-actions"><button class="btn primary" id="ob-go">开始使用</button></div>
  </div></div>`;
  root.querySelector("#ob-go").onclick = async () => {
    const sel = root.querySelector('input[name="ob-src"]:checked');
    try { await api("/api/config", { method: "PUT", body: { source: sel ? sel.value : cur, onboarded: true } }); }
    catch (e) { toast(e.message, true); }
    root.innerHTML = "";
  };
}

/* 壁纸个性化：程序旁 bg/ 目录有图则随机取一张作低透明度铺底（双主题各自蒙版） */
async function applyBackground() {
  try {
    const bg = await api("/api/bg");
    if (!bg.images || !bg.images.length) return;
    const pick = bg.images[Math.floor(Math.random() * bg.images.length)];
    document.documentElement.style.setProperty("--bg-image", `url("/bg/${encodeURIComponent(pick)}")`);
    document.body.classList.add("has-bg");
  } catch {}
}

/* ---------- 启动 ---------- */
(async function boot() {
  let info;
  try {
    info = await api("/api/app");
    $("#app-ver").textContent = info.version;
    $("#hud-status").textContent = `内存 ${(info.ramMb / 1024).toFixed(0)} GB · 下载源 ${{ auto: "自动", mirror: "镜像", official: "官方" }[info.config.source] || "自动"}`;
    const cores = await api("/api/cores").catch(() => []);
    cores.forEach(c => CORES[c.id] = c);
  } catch (e) {
    document.body.innerHTML = `<div style="padding:60px;text-align:center;color:#e5644e">无法连接 AutoMCHUB 后端：${esc(e.message)}<br><br>请通过程序窗口打开本页面。</div>`;
    return;
  }
  navigate();
  applyBackground();
  if (!info.config || !info.config.onboarded) showOnboarding(info);
})();
