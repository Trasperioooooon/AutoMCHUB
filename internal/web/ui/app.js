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
    <div class="m-body">请输入访问密码（在主机的「设置 → 远程访问」中配置）</div>
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
  d.innerHTML = icon(isErr ? "warn" : "check");
  const t = document.createElement("span");
  t.textContent = msg;
  d.appendChild(t);
  d.title = "点击关闭";
  $("#toasts").appendChild(d);
  let gone = false;
  const kill = () => { if (gone) return; gone = true; d.classList.add("leaving"); d.addEventListener("animationend", () => d.remove(), { once: true }); setTimeout(() => d.remove(), 400); };
  d.onclick = kill;
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
/* 按钮写出后果（如「保留 / 删除服务器」），不读正文也能作答；危险操作默认聚焦「取消」，误按回车不会直接执行 */
function confirmModal({ title, body, okText = "确定", cancelText = "取消", danger = false, extra = "" }) {
  return new Promise(resolve => {
    const root = $("#modal-root");
    const prev = document.activeElement; // 关闭后归还焦点
    root.innerHTML = `<div class="modal-mask"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h3 id="modal-title">${esc(title)}</h3><div class="m-body">${body}</div>${extra}
      <div class="m-actions">
        <button class="btn" data-x="cancel">${esc(cancelText)}</button>
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
    root.querySelector(danger ? '[data-x="cancel"]' : '[data-x="ok"]').focus();
  });
}

/* 核心元数据（启动时从 /api/cores 拉取） */
let CORES = {};
const coreName = id => (CORES[id] && CORES[id].name) || id;
const coreKind = id => (CORES[id] && CORES[id].kind) || "game";

/* 核心头像：首字母 + 低饱和核心色（CSS 里与卡片底色混合，只作辨识，不铺大色块） */
const CORE_COLORS = {
  vanilla: "#5b8c3a", paper: "#6e7189", purpur: "#9b6bc7", leaves: "#3f9e57",
  folia: "#2f9e94", fabric: "#a08a5a", neoforge: "#d0743a", forge: "#4f6a8f",
  mohist: "#b05f36", banner: "#c4942f", velocity: "#2f9fb8", waterfall: "#3f7fc7",
};
const CORE_MARK = {
  vanilla: "V", paper: "P", purpur: "Pu", leaves: "L", folia: "Fl", fabric: "Fa",
  neoforge: "NF", forge: "F", mohist: "M", banner: "B", velocity: "Ve", waterfall: "W",
};
const avatarOf = (id, cls = "") =>
  `<span class="avatar${cls ? " " + cls : ""}" style="--c:${CORE_COLORS[id] || "#7a8aa0"}" aria-hidden="true">${esc(CORE_MARK[id] || String(id || "?").slice(0, 2))}</span>`;

/* 页头：标题 + 可选说明（允许富文本，调用方自负安全）+ 右侧操作区 + 可选面包屑 */
const pageHead = (title, sub = "", actions = "", crumbs = "") =>
  (crumbs ? `<nav class="crumbs" aria-label="位置">${crumbs}</nav>` : "") +
  `<div class="page-head"><div class="ph-text"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>` +
  (actions ? `<div class="ph-actions">${actions}</div>` : "") + `</div>`;

/* ---------- 内联 SVG 图标 ----------
   对齐 win-ctrls 风格：16 视框、细线 currentColor、圆角端点。icon(name) 返回字符串供模板拼接；
   颜色继承文字色（双主题自动成立），默认尺寸 1em（随字号缩放），故按钮/文本内无需另设色与尺寸。
   界面图标一律走这里，禁止 emoji（用户内容如 MOTD/控制台输出不受限）。 */
const ICON = {
  // 导航 / 主题
  server: '<rect x="2.5" y="2.5" width="11" height="4.5" rx="1.2"/><rect x="2.5" y="9" width="11" height="4.5" rx="1.2"/><path d="M5 4.75h.01M5 11.25h.01"/>',
  plusBox: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M8 5.5v5M5.5 8h5"/>',
  palette: '<path d="M8 2.2a5.8 5.8 0 100 11.6c.9 0 1.3-.6 1.1-1.3-.3-.9.2-1.7 1.2-1.7h1.4a2.1 2.1 0 002.1-2.1C13.8 4.8 11.2 2.2 8 2.2z"/><path d="M5.2 7.2h.01M6.8 4.9h.01M9.6 4.9h.01M11.2 7.2h.01" stroke-width="1.8"/>',
  chevronRight: '<path d="M6.2 3.8 10.4 8l-4.2 4.2"/>',
  gear: '<path d="M6.72 3.37L6.87 1.60A6.5 6.5 0 0 1 9.13 1.60L9.28 3.37A4.8 4.8 0 0 1 10.36 3.82L11.73 2.68A6.5 6.5 0 0 1 13.32 4.27L12.18 5.64A4.8 4.8 0 0 1 12.63 6.72L14.4 6.87A6.5 6.5 0 0 1 14.4 9.13L12.63 9.28A4.8 4.8 0 0 1 12.18 10.36L13.32 11.73A6.5 6.5 0 0 1 11.73 13.32L10.36 12.18A4.8 4.8 0 0 1 9.28 12.63L9.13 14.40A6.5 6.5 0 0 1 6.87 14.40L6.72 12.63A4.8 4.8 0 0 1 5.64 12.18L4.27 13.32A6.5 6.5 0 0 1 2.68 11.73L3.82 10.36A4.8 4.8 0 0 1 3.37 9.28L1.6 9.13A6.5 6.5 0 0 1 1.6 6.87L3.37 6.72A4.8 4.8 0 0 1 3.82 5.64L2.68 4.27A6.5 6.5 0 0 1 4.27 2.68L5.64 3.82A4.8 4.8 0 0 1 6.72 3.37Z"/><circle cx="8" cy="8" r="2.1"/>',
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
  more: '<circle cx="3.5" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.15" fill="currentColor" stroke="none"/>',
  trash: '<path d="M2.8 4.4h10.4M6.3 4.4V2.8h3.4v1.6M4.3 4.4l.6 8.8h6.2l.6-8.8"/>',
  // 任务步骤状态
  spinner: '<path d="M8 2.2a5.8 5.8 0 105.8 5.8"/>',
  pending: '<circle cx="8" cy="8" r="2.2"/>',
};
const icon = (name, cls = "") => `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;

/* ---------- 外观：主题模式 / 配色方案 / 强调色 ----------
   index.html 已在样式生效前把三项偏好落到 <html> 的 data 属性；这里负责切换与持久化。
   偏好存 localStorage（每台设备各自记忆，局域网手机可与主机不同）；配色取值见 themes.css。 */
const SCHEMES = [
  { id: "fluent", name: "Fluent", desc: "Windows 11 默认风格" },
  { id: "github", name: "GitHub", desc: "Primer 设计系统" },
  { id: "graphite", name: "石墨", desc: "中性灰阶，Vercel / shadcn 风格" },
  { id: "nord", name: "Nord", desc: "北极冷色调" },
  { id: "catppuccin", name: "Catppuccin", desc: "Latte / Mocha 柔和粉彩" },
  { id: "solarized", name: "Solarized", desc: "经典护眼配色" },
];
const ACCENTS = [
  { id: "blue", name: "蓝", sw: "#2563eb" }, { id: "indigo", name: "靛蓝", sw: "#4f46e5" },
  { id: "violet", name: "紫", sw: "#7c3aed" }, { id: "teal", name: "青", sw: "#0f766e" },
  { id: "green", name: "绿", sw: "#15803d" }, { id: "orange", name: "橙", sw: "#c2410c" },
  { id: "rose", name: "玫红", sw: "#e11d48" }, { id: "graphite", name: "石墨", sw: "#3f3f46" },
];
const MODE_LABEL = { auto: "跟随系统", light: "浅色", dark: "深色" };
const MODE_ICON = { auto: "monitor", light: "sun", dark: "moon" };
let appearanceView = null; // 「设置 → 外观」打开时登记的重绘函数，外观变化（含侧栏快捷切换）后同步选中态
const Appearance = {
  get() {
    const d = document.documentElement.dataset;
    return { mode: d.themePref || "auto", scheme: d.scheme || "fluent", accent: d.accent || "auto" };
  },
  set(patch) {
    const a = { ...this.get(), ...patch };
    const root = document.documentElement;
    root.dataset.themePref = a.mode;
    root.dataset.theme = a.mode === "auto" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : a.mode;
    root.dataset.scheme = a.scheme;
    root.dataset.accent = a.accent;
    try { localStorage.setItem("amh_theme", a.mode); localStorage.setItem("amh_scheme", a.scheme); localStorage.setItem("amh_accent", a.accent); } catch {}
    paintThemeBtn();
    // 卡片上的 MOTD 按明暗取色，切换后重绘
    document.querySelectorAll(".inst-meta[data-motd]").forEach(el => { if (el.dataset.motd) renderMotd(el, el.dataset.motd); });
    if (appearanceView) appearanceView();
  },
};
function paintThemeBtn() {
  const btn = $("#theme-btn");
  const m = Appearance.get().mode;
  btn.innerHTML = icon(MODE_ICON[m]) + `<span>${MODE_LABEL[m]}</span>`;
  btn.title = `外观：${MODE_LABEL[m]}（点击切换；配色方案见「设置 → 外观」）`;
}
(function initTheme() {
  const NEXT = { auto: "light", light: "dark", dark: "auto" };
  $("#theme-btn").onclick = () => Appearance.set({ mode: NEXT[Appearance.get().mode] || "auto" });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (Appearance.get().mode === "auto") Appearance.set({}); });
  paintThemeBtn();
})();

/* 无边框宿主：系统标题栏已去除，由前端顶部标题栏代替。窗口按钮 + 拖动经 WebView2 的 Bind 桥接驱动。
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
  // 标题栏空白处按下 → 发起原生拖动；双击 → 最大化/还原。交互元素（按钮/链接/输入/控制键）除外。
  const bar = $("#titlebar");
  const onChrome = e => e.target.closest("button, a, input, select, .win-ctrls");
  bar.addEventListener("mousedown", e => {
    if (e.button !== 0 || onChrome(e)) return;
    e.preventDefault();
    call("hostWinDrag");
  });
  bar.addEventListener("dblclick", e => {
    if (onChrome(e)) return;
    call("hostWinMaxToggle"); setTimeout(refreshMax, 80);
  });
})();

/* 快捷键：1-4 切换侧栏导航；T 或 / 聚焦控制台输入（MC 聊天习惯） */
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
  if (typing) return;
  if ($("#modal-root").childElementCount || $("#login-mask")) return; // 弹层打开时不在底下切页
  if (["1", "2", "3", "4"].includes(e.key)) {
    const target = ["#/instances", "#/create", "#/tunnels", "#/settings"][+e.key - 1];
    if ((location.hash || "#/instances") === target) navigate(); else location.hash = target;
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
  const baseColor = onDark ? "#AAAAAA" : "#595959";
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

/* ---------- 未保存修改：快照比对 + 吸底保存条 ----------
   read() 返回当前表单的 {键: 值字符串} 快照，与基线逐键比对得出未保存项数。
   saveBar() 产出吸底保存条；wireSaveBar() 绑定状态刷新 / 保存 / 放弃修改，并登记切页守卫 dirtyCheck。
   save() 失败时抛错（由这里统一 toast），成功后以新快照为基线。 */
/* 把一个「未保存项数」来源并入当前视图的切页守卫（切页时 navigate 会清空） */
function addDirtySource(gen, fn) {
  if (stale(gen)) return;
  const prev = dirtyCheck;
  dirtyCheck = prev ? () => prev() + fn() : fn;
}

/* 单个输入框 +「保存」按钮：值没变时按钮置灰，回车即保存；未保存的改动同样受切页守卫保护 */
function bindSaveInput(input, btn, save, gen) {
  let base = input.value;
  const paint = () => { btn.disabled = input.value === base; };
  const go = async () => {
    if (input.value === base) return;
    btn.disabled = true;
    try { await save(input.value); base = input.value; } catch (e) { toast(e.message, true); }
    paint();
  };
  input.addEventListener("input", paint);
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  btn.onclick = go;
  addDirtySource(gen, () => (input.isConnected && input.value !== base ? 1 : 0));
  paint();
}

function saveBar(saveText, note = "") {
  return `<div class="save-bar sticky">
    <span class="sb-state">所有修改已保存</span>${note}
    <span class="grow"></span>
    <button class="btn" data-sb="discard" hidden>放弃修改</button>
    <button class="btn primary" data-sb="save" disabled>${icon("save")} ${esc(saveText)}</button>
  </div>`;
}
function wireSaveBar(root, gen, read, save) {
  const bar = $(".save-bar.sticky", root);
  const saveBtn = $('[data-sb="save"]', bar);
  let base = read();
  const diff = () => {
    const cur = read();
    return [...new Set([...Object.keys(base), ...Object.keys(cur)])].filter(k => (base[k] ?? "") !== (cur[k] ?? "")).length;
  };
  const paint = () => {
    const n = diff();
    bar.classList.toggle("dirty", n > 0);
    $(".sb-state", bar).textContent = n ? `${n} 项修改未保存` : "所有修改已保存";
    saveBtn.disabled = n === 0;
    $('[data-sb="discard"]', bar).hidden = n === 0;
  };
  root.addEventListener("input", paint);
  root.addEventListener("change", paint);
  $('[data-sb="discard"]', bar).onclick = () => { dirtyCheck = null; navigate(); }; // 按服务器上的当前值重绘
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try { await save(); base = read(); } catch (e) { toast(e.message, true); }
    paint();
  };
  addDirtySource(gen, () => (bar.isConnected ? diff() : 0));
  paint();
  return paint; // 程序化改值（不触发 input 事件）后由调用方手动刷新
}

/* 下拉菜单（fixed 定位，点外部 / Esc 关闭，再点触发按钮收起；下方放不下时向上展开）。
   items: {label, icon, onClick, danger?, disabled?, note?} | {sep: true} | {header: "…"} */
function dropMenu(anchor, items) {
  const open = document.querySelector(".dropmenu");
  if (open && open._anchor === anchor) { open._close(); return; }
  document.querySelectorAll(".dropmenu").forEach(x => x._close ? x._close() : x.remove());
  const m = document.createElement("div");
  m.className = "dropmenu";
  m.setAttribute("role", "menu");
  m._anchor = anchor;
  items.forEach(it => {
    if (it.sep) { m.insertAdjacentHTML("beforeend", `<div class="dm-sep"></div>`); return; }
    if (it.header) { m.insertAdjacentHTML("beforeend", `<div class="dm-label">${esc(it.header)}</div>`); return; }
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (it.danger) b.className = "danger";
    b.disabled = !!it.disabled;
    b.innerHTML = `${icon(it.icon || "folder")}<span>${esc(it.label)}</span>`;
    b.onclick = e => { e.stopPropagation(); close(); it.onClick(); };
    m.appendChild(b);
    if (it.note) m.insertAdjacentHTML("beforeend", `<div class="dm-note">${esc(it.note)}</div>`);
  });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
  const h = m.offsetHeight;
  m.style.top = (r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
  const onDoc = e => { if (!m.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = e => { if (e.key === "Escape") { close(); anchor.focus(); } };
  function close() { m.remove(); document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); }
  m._close = close;
  setTimeout(() => { document.addEventListener("click", onDoc); document.addEventListener("keydown", onKey); }, 0);
}

/* server.properties 目录已数据化至 props-catalog.js（window.PROPS_CATALOG，约 60 项，含版本/gamerule 元数据） */

/* ---------- 路由 ---------- */
const Main = () => $("#main");
let consoleES = null; // 当前 SSE 连接
let pollTimer = null;
let prTimer = null;   // 控制台在线玩家延迟刷新定时器（离开视图时清理）
let lastAnimKey = null; // 页级入场动画的身份键（跨页判定用）

/* 视图代号：每次切页 +1。异步渲染在 await 之后先核对代号，过期即放弃（不再挂定时器、不再登记守卫），
   否则快速切页时旧视图的轮询会在 await 返回后才挂上，覆盖新视图的 pollTimer 并永远清不掉。 */
let viewGen = 0;
const stale = gen => gen !== viewGen;
function startPoll(fn, ms, gen) {
  if (stale(gen)) return;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!stale(gen)) fn(); }, ms);
}

/* 未保存修改守卫：表单类视图登记 dirtyCheck（返回未保存项数），切页 / 切 tab / 刷新前先确认 */
let dirtyCheck = null;
let curHash = null;
let guardOpen = false;
window.addEventListener("beforeunload", e => { if (dirtyCheck && dirtyCheck() > 0) { e.preventDefault(); e.returnValue = ""; } });

async function navigate() {
  const hash = location.hash || "#/instances";
  if (guardOpen) { if (curHash) history.replaceState(null, "", curHash); return; }
  const unsaved = dirtyCheck ? dirtyCheck() : 0;
  if (unsaved > 0) {
    if (curHash && hash !== curHash) history.replaceState(null, "", curHash); // 先退回原地址，确认放弃后再前往
    guardOpen = true;
    const ok = await confirmModal({
      title: "放弃未保存的修改？", danger: true,
      body: `当前页面还有 <b>${unsaved}</b> 项修改没有保存，离开后这些修改会丢失。`,
      okText: `放弃 ${unsaved} 项修改`, cancelText: "继续编辑",
    });
    guardOpen = false;
    if (!ok) return;
    if ((location.hash || "#/instances") !== hash) history.replaceState(null, "", hash);
  }
  dirtyCheck = null;
  appearanceView = null;
  curHash = hash;
  viewGen++;
  if (consoleES) { consoleES.close(); consoleES = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (prTimer) { clearTimeout(prTimer); prTimer = null; }
  document.querySelectorAll(".dropmenu").forEach(x => x._close ? x._close() : x.remove());
  const m = hash.match(/^#\/([a-z]+)(?:\/(.+))?$/);
  const view = m ? m[1] : "instances";
  const arg = m && m[2] ? decodeURIComponent(m[2]) : null;
  // 侧栏高亮：详情归「服务器」、部署任务归「新建服务器」，进入子页面时仍知道自己在哪个区
  const navKey = view === "inst" ? "instances" : view === "task" ? "create" : view;
  document.querySelectorAll("#sidebar .nav-item").forEach(a => {
    const on = a.dataset.nav === navKey;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const mainEl = Main();
  // 页级入场动画只在真正跨页时重播：设置分区切换走 set-body 局部动效、详情 tab 走 tab-body 局部动效
  const animKey = view === "inst" && arg ? "inst/" + arg.split("/")[0] : view === "task" ? "task/" + arg : view;
  if (animKey !== lastAnimKey) {
    mainEl.classList.remove("view-enter"); void mainEl.offsetWidth; // 重触发跨页入场
    mainEl.classList.add("view-enter");
  }
  lastAnimKey = animKey;
  if (view === "create") renderCreate();
  else if (view === "inst" && arg) { const sl = arg.indexOf("/"); sl >= 0 ? renderDetail(arg.slice(0, sl), arg.slice(sl + 1)) : renderDetail(arg); }
  else if (view === "settings") renderSettings(arg);
  else if (view === "tunnels") renderTunnels();
  else if (view === "task" && arg) renderTaskPage(arg);
  else renderInstances();
}
window.addEventListener("hashchange", navigate);
/* 点指向当前地址的站内链接（侧栏当前项、面包屑等）：hash 不变不会触发 hashchange，
   手动重绘回到该页起点（如从向导中途回到「新建服务器」入口） */
document.addEventListener("click", e => {
  const a = e.target.closest('a[href^="#/"]');
  if (a && !e.defaultPrevented && a.getAttribute("href") === (location.hash || "#/instances")) { e.preventDefault(); navigate(); }
});

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

/* 「打开文件夹」菜单项：按核心类型列出可用子目录（实例卡「···」与详情页「打开目录」共用） */
function folderItems(info) {
  const isProxy = info.kind === "proxy";
  const hasMods = ["fabric", "forge", "neoforge", "mohist", "banner"].includes(info.core);
  const hasPlugins = ["paper", "purpur", "leaves", "folia", "mohist", "banner", "velocity", "waterfall"].includes(info.core);
  const dirs = [["", "folder", "实例目录"]];
  if (hasMods) dirs.push(["mods", "package", "模组 mods"]);
  if (hasPlugins) dirs.push(["plugins", "plug", "插件 plugins"]);
  if (!isProxy) dirs.push(["world", "globe", "世界存档"], ["logs", "doc", "日志 logs"], ["crash-reports", "warn", "崩溃报告"]);
  else dirs.push(["logs", "doc", "日志 logs"]);
  return dirs.map(([sub, ic, label]) => ({
    icon: ic, label,
    onClick: () => api(`/api/instances/${encodeURIComponent(info.name)}/opendir${sub ? "?sub=" + encodeURIComponent(sub) : ""}`, { method: "POST" })
      .catch(e => toast(e.message, true)),
  }));
}

/* 删除实例：标题点名、按钮写明后果、默认聚焦「保留」。
   注意后端语义：不删文件时只是从内存列表移除，instance.json 还在，下次启动多根扫描会重新发现它——文案如实说明。 */
async function deleteInstance(name) {
  const r = await confirmModal({
    title: `删除服务器「${name}」？`, danger: true, okText: "删除服务器", cancelText: "保留",
    body: "已有的世界备份不受影响，仍保存在备份目录中。",
    extra: `<label class="switch" style="margin-bottom:4px"><input type="checkbox" data-k="files" checked><span class="sw"></span>
        <span class="sw-label">同时删除服务器文件夹（含世界存档，无法恢复）</span></label>
      <div class="hint" style="margin:0 0 16px 48px">关闭则只从列表移除，文件仍在磁盘，下次启动会重新出现。</div>`,
  });
  if (!r) return false;
  try {
    await api(`/api/instances/${encodeURIComponent(name)}?files=${r.files ? 1 : 0}`, { method: "DELETE" });
    toast(`已删除「${name}」`);
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

/* 运行状态：点 + 文字（不能只靠颜色） */
const ST_TEXT = { running: "运行中", starting: "启动中…", stopping: "正在停止…", stopped: "已停止" };
const stPill = st => `<span class="st-pill ${st}"><span class="dot ${st}"></span>${ST_TEXT[st] || esc(st)}</span>`;

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
  const gen = viewGen;
  // 标题与搜索/排序工具栏包进 #inst-chrome：没有实例时整块隐藏（空态自身即整页主体），
  // 常驻 DOM 只切换 hidden，轮询重绘不重建输入框、不丢焦点
  Main().innerHTML = `<div id="inst-chrome" hidden>` +
    pageHead("服务器", "", `<a class="btn primary" href="#/create">${icon("plus")} 新建服务器</a>`) + `
    <div class="toolbar">
      <div class="search-field">${icon("search", "sf-ico")}<input type="text" id="inst-q" placeholder="搜索服务器名称" aria-label="搜索服务器名称"></div>
      <select id="inst-sort" style="width:170px" aria-label="排序方式"><option value="recent">排序：最近创建</option><option value="running">排序：运行中优先</option><option value="name">排序：名称</option></select>
      <span class="grow"></span><span class="sub" id="inst-summary" style="margin:0"></span>
    </div></div>
    <div id="inst-cards">${skeletonCards()}</div>`;
  let lastSig = "", curList = [];
  const cardHTML = i => {
    const proxy = i.kind === "proxy";
    const gb = (i.xmxMb / 1024).toFixed(1) + "G";
    const cfg = proxy ? `Java ${i.javaMajor} · ${gb}` : `Java ${i.javaMajor} · :${i.port} · ${gb}`;
    const href = `#/inst/${encodeURIComponent(i.name)}`;
    // 删除、打开文件夹收进「···」：危险操作不与「启动」同排同尺寸，多一步才够得着
    return `
    <div class="card st-${i.status}" data-name="${esc(i.name)}">
      <div class="inst-head">${avatarOf(i.core)}<a class="inst-name grow" href="${href}">${esc(i.name)}</a>${stPill(i.status)}</div>
      <div class="badges">
        <span class="badge core">${coreName(i.core)}</span>
        <span class="badge">${proxy ? "v" : "MC "}${esc(i.mc)}</span>
        ${proxy ? `<span class="badge">代理端</span>` : ""}
      </div>
      <div class="inst-config">${cfg}</div>
      ${i.status === "running" ? `<div class="inst-stat">${icon("clock")} ${fmtDur(i.uptimeSec)}${!proxy ? ` · ${icon("player")} ${i.onlineCount}/${i.maxPlayers}` : ""}</div>` : ""}
      <div class="inst-meta" data-motd="${esc(i.motd || "")}"></div>
      <div class="inst-actions">
        ${i.status === "stopped" ? `<button class="btn sm primary" data-act="start">${icon("play")} 启动</button>`
          : `<button class="btn sm" data-act="stop" ${i.status === "stopping" ? "disabled" : ""}>${icon("stop")} 停止</button>`}
        <a class="btn sm" href="${href}">管理</a>
        <span class="grow"></span>
        <button class="btn sm icon-only" data-act="more" title="更多操作" aria-label="更多操作" aria-haspopup="menu">${icon("more")}</button>
      </div>
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
      if (act === "more") {
        const busy = info.status !== "stopped";
        dropMenu(b, [
          { header: "打开文件夹" }, ...folderItems(info), { sep: true },
          { icon: "trash", label: "删除服务器…", danger: true, disabled: busy, note: busy ? "需先停止服务器" : "",
            onClick: async () => { if (await deleteInstance(name)) { lastSig = ""; draw(); } } },
        ]);
        return;
      }
      try {
        if (act === "start") { b.disabled = true; await api(`/api/instances/${encodeURIComponent(name)}/start`, { method: "POST" }); toast(`「${name}」正在启动`); }
        else if (act === "stop") { b.disabled = true; await api(`/api/instances/${encodeURIComponent(name)}/stop`, { method: "POST" }); toast(`「${name}」正在停止并保存世界`); }
      } catch (e) { toast(e.message, true); }
      lastSig = ""; draw();
    });
    // 整卡可点：点卡片空白处进入详情（卡内按钮 / 链接各自处理）
    $("#inst-cards").querySelectorAll(".card").forEach(c => c.onclick = e => {
      if (e.target.closest("button, a")) return;
      location.hash = `#/inst/${encodeURIComponent(c.dataset.name)}`;
    });
  };
  const draw = async () => {
    let list;
    try { list = await api("/api/instances"); } catch (e) { if (!stale(gen)) $("#inst-cards").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    if (stale(gen)) return;
    curList = list;
    const running = list.filter(i => i.status === "running").length;
    const online = list.reduce((s, i) => s + (i.onlineCount || 0), 0);
    $("#inst-summary").textContent = list.length ? `共 ${list.length} 台 · 运行中 ${running}${online ? ` · 在线 ${online} 人` : ""}` : "";
    if (!list.length) {
      $("#inst-chrome").hidden = true; // 没有实例时不显示「我的服务器」标题与搜索/排序
      $("#inst-cards").classList.add("page-fill");
      // 一个主行动 + 一个安静的次要入口（两个同权重按钮等于没有主按钮）
      $("#inst-cards").innerHTML = `<div class="empty"><div class="empty-ico">${icon("server")}</div>
        <div class="empty-title">还没有服务器</div>
        一键创建一台推荐配置的服务器，Java 与服务端会自动下载。<br>
        <button class="btn primary" id="quick-start" style="margin-top:14px">${icon("bolt")} 一键开服（Paper 最新正式版）</button><br>
        <a class="quiet-link" href="#/create">或使用向导，自选核心与版本 →</a></div>`;
      $("#quick-start").onclick = quickStart; lastSig = "empty"; return;
    }
    $("#inst-chrome").hidden = false;
    $("#inst-cards").classList.remove("page-fill");
    const sig = list.map(i => `${i.name}:${i.status}:${i.status === "running" ? Math.floor(i.uptimeSec / 60) + "/" + i.onlineCount : ""}`).join("|") + "#" + $("#inst-q").value + "#" + $("#inst-sort").value;
    if (sig === lastSig) return; // 数据无实质变化则跳过重绘，消除周期性闪烁与焦点丢失
    lastSig = sig;
    applyView();
  };
  $("#inst-q").oninput = () => { lastSig = ""; draw(); };
  $("#inst-sort").onchange = () => { lastSig = ""; draw(); };
  await draw();
  startPoll(draw, 3000, gen);
}

/* ---------- 视图：新建向导 ---------- */
const wiz = { step: 0, core: null, mc: null, build: null, snapshots: false, root: "" };

async function renderCreate() {
  wiz.step = 0; wiz.core = null; wiz.mc = null; wiz.build = null; wiz.root = "";
  Main().innerHTML = pageHead("新建服务器", "选择一种方式开始") + `
    <div class="recipe-grid">
      <div class="core-card" id="mode-new" role="button" tabindex="0"><span class="recipe-ico">${icon("plusBox")}</span><div><div class="cn">从零创建</div><div class="cd">选择核心与版本，自动下载 Java 与服务端</div></div></div>
      <div class="core-card" id="mode-import" role="button" tabindex="0"><span class="recipe-ico">${icon("package")}</span><div><div class="cn">导入整合包</div><div class="cd">支持 Modrinth / CurseForge 整合包，自动识别版本</div></div></div>
    </div>`;
  $("#mode-new").onclick = () => drawWizard();
  $("#mode-import").onclick = () => drawImport();
  // 卡片可用键盘激活（回车 / 空格）
  ["#mode-new", "#mode-import"].forEach(s => { $(s).onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $(s).click(); } }; });
}

/* ---------- 视图：整合包导入 ---------- */
async function drawImport() {
  const app = await api("/api/app").catch(() => ({ ramMb: 8192, availRamMb: 4096, config: {} }));
  const maxMem = Math.max(2048, app.ramMb - 2048);
  const defMem = Math.min(6144, maxMem);
  let imRoot = "";
  Main().innerHTML = pageHead("导入整合包", "支持 Modrinth (.mrpack) 与 CurseForge (zip)。核心、MC 版本与加载器将从整合包自动识别。", "",
    `<a href="#/create">新建服务器</a>${icon("chevronRight")}<span>导入整合包</span>`) + `
    <div class="form-grid">
      <label class="field full"><span>整合包文件</span><input type="file" id="im-file" accept=".mrpack,.zip"><div class="field-err" id="im-file-err"></div></label>
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
    ${app.config.cfApiKey ? "" : `<div class="hint" style="margin-bottom:10px">提示：CurseForge 格式整合包的模组下载需要 API Key（<a href="https://console.curseforge.com/" target="_blank">免费申请</a>后在「设置 → 下载与网络」填写）；Modrinth 格式无需任何配置。</div>`}
    <div class="eula-box">
      <label class="switch"><input type="checkbox" id="im-eula"><span class="sw"></span>
        <span class="sw-label">我已阅读并同意 <a href="https://aka.ms/MinecraftEULA" target="_blank">Minecraft EULA</a></span></label>
      <div class="field-err" id="im-eula-err"></div>
    </div>
    ${wizFoot("im-back", "返回", `<button class="btn primary" id="im-go">${icon("bolt")} 导入并部署</button>`)}`;
  $("#im-back").onclick = () => renderCreate(); // 直接重绘（hash 相同不会触发路由，不能用 location.hash）
  renderMemoryControl($("#im-mem-mount"), { sliderId: "im-mem", min: 2048, max: maxMem, value: defMem, totalMb: app.ramMb, availMb: app.availRamMb, hint: "整合包服建议 6GB 以上" });
  const imUpdateRoot = () => { $("#im-root").value = imRoot || app.serversRoot || "程序目录\\servers"; };
  imUpdateRoot();
  $("#im-browse").onclick = async () => {
    try { const r = await api("/api/pickdir", { method: "POST" }); if (r.path) { imRoot = r.path; imUpdateRoot(); toast("已选择：" + r.path); } }
    catch (e) { toast(e.message, true); }
  };
  // 行内校验（同向导）：错误显示在对应字段下方，改正后即时消失
  const fileErr = msg => { $("#im-file").classList.toggle("invalid", !!msg); $("#im-file-err").innerHTML = msg ? icon("warn") + " " + esc(msg) : ""; };
  const eulaErr = msg => { $(".eula-box").classList.toggle("invalid", !!msg); $("#im-eula-err").innerHTML = msg ? icon("warn") + " " + esc(msg) : ""; };
  $("#im-file").addEventListener("change", () => fileErr(""));
  $("#im-eula").addEventListener("change", () => { if ($("#im-eula").checked) eulaErr(""); });
  $("#im-go").onclick = async () => {
    const f = $("#im-file").files[0];
    if (!f) { fileErr("请先选择整合包文件（.mrpack 或 .zip）"); $("#im-file").focus(); return; }
    if (!$("#im-eula").checked) { eulaErr("导入前需要同意 Minecraft EULA"); $("#im-eula").focus(); return; }
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
  const names = ["选择核心", "选择版本", "选择构建", "基本设置"];
  // 步骤条：圆圈序号 + 连线；已完成打勾且可点回，当前步实底，未到达描边
  Main().innerHTML = pageHead("新建服务器", "选好核心与版本后，Java 与服务端会自动下载并完成配置。") + `
    <div class="steps">${names.map((n, i) => {
      const skipped = i === 2 && wiz.core === "vanilla"; // 原版没有「选择构建」，该步不可点回
      const cls = i === wiz.step ? "cur" : i < wiz.step && !skipped ? "done" : "";
      const tip = cls === "done" ? `title="回到「${n}」"` : skipped ? `title="原版无需选择构建" tabindex="-1"` : `tabindex="-1"`;
      return (i ? `<span class="step-line"></span>` : "") +
        `<button type="button" class="step-pill ${cls}" data-step="${i}" ${tip}><span class="sn">${cls === "done" ? icon("check") : i + 1}</span>${n}</button>`;
    }).join("")}</div>
    <div id="wiz-body">${inner}</div>`;
  document.querySelectorAll(".step-pill.done").forEach(p => p.onclick = () => { wiz.step = +p.dataset.step; drawWizard(); });
}

/* 向导吸底栏：左「返回」、中间回显已选内容、右主按钮；表单步与内容列同宽（w-read） */
const wizFoot = (backId, backText, right, wide = false) =>
  `<div class="wizard-foot${wide ? "" : " w-read"}"><button class="btn" id="${backId}">${icon("arrowLeft")} ${backText}</button>
    <span class="wf-sum" id="wf-sum"></span>${right}</div>`;
function paintWizSum() {
  const el = $("#wf-sum");
  if (!el) return;
  const parts = [];
  if (wiz.core) parts.push(`<b>${esc(coreName(wiz.core))}</b>`);
  if (wiz.step >= 1 && wiz.mc) parts.push(esc(wiz.mc));
  if (wiz.step >= 2 && wiz.build) parts.push("构建 " + esc(wiz.build));
  el.innerHTML = parts.length ? "已选：" + parts.join(" · ") : "";
}

async function drawWizard() {
  if (wiz.step === 0) {
    wizardShell(`<div id="core-grid">${skeletonRows(6)}</div>
      ${wizFoot("wback0", "返回", `<button class="btn primary" id="wnext" disabled>下一步 ${icon("arrowRight")}</button>`, true)}`);
    $("#wback0").onclick = () => renderCreate();
    paintWizSum();
    let cores;
    try { cores = await api("/api/cores"); } catch (e) { $("#core-grid").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    if (!$("#core-grid")) return; // 等待期间已离开本步
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
        ${avatarOf(c.id)}
        <div><div class="cn">${esc(c.name)} <span class="badge">${esc(c.tag)}</span>${c.id === REC ? `<span class="rec-badge">新手推荐</span>` : ""}</div>
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
    $("#core-grid").querySelectorAll(".core-card").forEach(c => {
      c.onclick = () => {
        wiz.core = c.dataset.id;
        $("#core-grid").querySelectorAll(".core-card").forEach(x => x.classList.toggle("sel", x.dataset.id === wiz.core));
        $("#wnext").disabled = false;
        paintWizSum();
      };
      c.ondblclick = () => { wiz.core = c.dataset.id; wiz.step = 1; drawWizard(); }; // 双击 = 选中并下一步
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
      ${wizFoot("wback", "上一步", `<button class="btn primary" id="wnext" disabled>下一步 ${icon("arrowRight")}</button>`)}`);
    $("#wback").onclick = () => { wiz.step = 0; drawWizard(); };
    $("#wnext").onclick = () => { wiz.step = 2; wiz.build = null; drawWizard(); };
    const snapEl = $("#snap-toggle");
    if (snapEl) snapEl.onchange = () => { wiz.snapshots = snapEl.checked; loadVersions(); };
    let all = [];
    const drawList = () => {
      const q = $("#ver-search").value.trim();
      const items = all.filter(v => !q || v.id.includes(q)).slice(0, 300);
      $("#ver-list").innerHTML = items.length ? items.map(v => {
        // 发布日期副行：仅版本表取自 Mojang 清单的核心带 releaseTime（ISO 8601，取日期部分），其余核心不显示
        const date = /^\d{4}-\d{2}-\d{2}/.test(v.releaseTime || "") ? v.releaseTime.slice(0, 10) : "";
        return `
        <div class="ver-item ${wiz.mc === v.id ? "sel" : ""}" data-id="${esc(v.id)}">
          <span>${esc(v.id)}${v.latest ? `<span class="ver-tag">最新</span>` : ""}${date ? `<span class="ver-date">${esc(date)}</span>` : ""}</span><span class="vt">${v.type === "snapshot" ? "快照" : "正式版"}</span>
        </div>`;
      }).join("") : `<div class="ver-item">没有匹配的版本</div>`;
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
        if (!$("#ver-list")) return; // 等待期间已离开本步
        // 合理默认：没选过（或换核心后原选择不在列表里）就预选最新正式版，直接「下一步」即可
        if (!all.some(v => v.id === wiz.mc)) wiz.mc = (all.find(v => v.latest && v.type !== "snapshot") || all.find(v => v.type !== "snapshot") || {}).id || null;
        $("#wnext").disabled = !wiz.mc;
        paintWizSum();
        drawList();
        $("#ver-list .ver-item.sel")?.scrollIntoView({ block: "nearest" });
      } catch (e) { $("#ver-list").innerHTML = `<div class="err-box">${esc(e.message)}<br>可在「设置 → 下载与网络」切换下载源后重试。</div>`; }
    };
    $("#ver-search").oninput = drawList;
    // 委托在列表容器上（drawList 每次重建条目）：单击后刷新底栏回显，双击 = 选中并下一步
    $("#ver-list").addEventListener("click", paintWizSum);
    $("#ver-list").addEventListener("dblclick", e => {
      const it = e.target.closest(".ver-item[data-id]");
      if (it) { wiz.mc = it.dataset.id; wiz.step = 2; wiz.build = null; drawWizard(); }
    });
    await loadVersions();

  } else if (wiz.step === 2) {
    if (wiz.core === "vanilla") { wiz.step = 3; wiz.build = ""; drawWizard(); return; }
    wizardShell(`<div class="sub">为 ${coreKind(wiz.core) === "proxy" ? "" : "MC "}${esc(wiz.mc)} 选择 ${coreName(wiz.core)} 构建（默认推荐最新稳定）</div>
      <div class="ver-list" id="build-list">${skeletonRows(6)}</div>
      ${wizFoot("wback", "上一步", `<button class="btn primary" id="wnext" disabled>下一步 ${icon("arrowRight")}</button>`)}`);
    $("#wback").onclick = () => { wiz.step = 1; drawWizard(); };
    $("#wnext").onclick = () => { wiz.step = 3; drawWizard(); };
    paintWizSum();
    try {
      const builds = await api(`/api/builds?core=${wiz.core}&mc=${encodeURIComponent(wiz.mc)}`);
      if (!$("#build-list")) return; // 等待期间已离开本步
      if (!builds.length) throw new Error(`${wiz.mc} 暂无 ${coreName(wiz.core)} 构建，请换个版本或核心`);
      if (!wiz.build) wiz.build = (builds.find(b => b.recommended) || builds[0]).id;
      paintWizSum();
      $("#build-list").innerHTML = builds.slice(0, 200).map(b => `
        <div class="ver-item ${wiz.build === b.id ? "sel" : ""}" data-id="${esc(b.id)}">
          <span>${esc(b.id)}${b.recommended ? `<span class="ver-tag">推荐</span>` : ""}</span><span class="vt">${esc(b.label || "")}</span>
        </div>`).join("");
      $("#build-list").querySelectorAll(".ver-item").forEach(el => {
        el.onclick = () => {
          wiz.build = el.dataset.id;
          $("#build-list").querySelectorAll(".ver-item").forEach(x => x.classList.toggle("sel", x.dataset.id === wiz.build));
          paintWizSum();
        };
        el.ondblclick = () => { wiz.build = el.dataset.id; wiz.step = 3; drawWizard(); };
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
        <label class="field"><span>实例名称</span><input type="text" id="f-name" value="我的${coreName(wiz.core)}服务器" maxlength="40"><div class="field-err" id="f-name-err"></div></label>
        ${isProxy ? "" : `<label class="field"><span>端口（默认 25565）</span><input type="number" id="f-port" value="25565" min="1" max="65535"><div class="field-err" id="f-port-err"></div></label>`}
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
        <div class="field-err" id="f-eula-err"></div>
      </div>`}
      ${wizFoot("wback", "上一步", `<button class="btn primary" id="wcreate">${icon("bolt")} 开始部署</button>`)}`);
    $("#wback").onclick = () => { wiz.step = wiz.core === "vanilla" ? 1 : 2; drawWizard(); };
    paintWizSum();
    // 行内校验：离开字段时检查，出错后随输入即时复核；提交时全部检查并聚焦第一个出错项（不再用远离字段的 toast）
    const showErr = (input, errId, msg) => { input.classList.toggle("invalid", !!msg); $(errId).innerHTML = msg ? icon("warn") + " " + esc(msg) : ""; return !msg; };
    const checkName = () => showErr($("#f-name"), "#f-name-err", $("#f-name").value.trim() ? "" : "请给服务器起个名字");
    const checkPort = () => {
      if (isProxy) return true;
      const v = Number($("#f-port").value);
      return showErr($("#f-port"), "#f-port-err", Number.isInteger(v) && v >= 1 && v <= 65535 ? "" : "端口需为 1 ~ 65535 的整数，不确定就用 25565");
    };
    const checkEula = () => {
      if (isProxy) return true;
      const ok = $("#f-eula").checked;
      $(".eula-box").classList.toggle("invalid", !ok);
      $("#f-eula-err").innerHTML = ok ? "" : icon("warn") + " 开服前需要同意 Minecraft EULA";
      return ok;
    };
    $("#f-name").addEventListener("blur", checkName);
    $("#f-name").addEventListener("input", () => { if ($("#f-name").classList.contains("invalid")) checkName(); });
    if (!isProxy) {
      $("#f-port").addEventListener("blur", checkPort);
      $("#f-port").addEventListener("input", () => { if ($("#f-port").classList.contains("invalid")) checkPort(); });
      $("#f-eula").addEventListener("change", () => { if ($(".eula-box").classList.contains("invalid")) checkEula(); });
    }
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
      const okName = checkName(), okPort = checkPort(), okEula = checkEula();
      if (!(okName && okPort && okEula)) {
        const first = !okName ? $("#f-name") : !okPort ? $("#f-port") : $("#f-eula");
        first.closest(".field, .eula-box").scrollIntoView({ behavior: "smooth", block: "center" });
        first.focus({ preventScroll: true });
        return;
      }
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
  const gen = viewGen;
  Main().innerHTML = pageHead("正在部署服务器", "自动下载 Java 与服务端核心，全程无需手动配置") + `
    <div id="task-box">加载中…</div>`;
  const icons = { pending: icon("pending"), running: icon("spinner"), done: icon("check"), error: icon("x") };
  let ended = false; // 已结束就不再轮询 / 重复提示（首轮即结束时旧逻辑仍会挂上轮询，成功提示弹两次）
  const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
  const draw = async () => {
    let t;
    try { t = await api(`/api/tasks/${taskId}`); }
    catch (e) { if (stale(gen) || ended) return; ended = true; stopPoll(); $("#task-box").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    if (stale(gen) || ended) return;
    const pct = t.total > 0 ? Math.min(100, t.done / t.total * 100) : 0;
    $("#task-box").innerHTML = `
      <div class="task-steps">${(t.steps || []).map(s =>
        `<div class="task-step ${s.status}"><span class="ts-ico">${icons[s.status] || ""}</span>${esc(s.name)}</div>`).join("")}</div>
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
    if (t.ended) { ended = true; stopPoll(); if (!t.error) toast("服务器创建成功"); }
  };
  // 首次 draw 若因任何原因抛错，也必须启动轮询——否则后续状态永远无法刷新，页面会永久停在「加载中…」。
  try { await draw(); } catch (e) { console.warn("首次任务渲染失败，转由轮询接管：", e); }
  if (!ended) startPoll(draw, 800, gen);
}

/* ---------- 视图：实例详情 ---------- */
/* 详情页头的状态胶囊：点 + 文字，运行中再带时长与在线人数 */
function headStatus(i) {
  const meta = i.status === "running"
    ? `<span class="st-meta">· ${fmtDur(i.uptimeSec)}${i.kind !== "proxy" ? ` · ${i.onlineCount}/${i.maxPlayers} 人` : ""}</span>` : "";
  return `<span class="st-pill ${i.status}"><span class="dot ${i.status}"></span>${ST_TEXT[i.status] || esc(i.status)}${meta}</span>`;
}

async function renderDetail(name, tab = "console") {
  const gen = viewGen;
  let list;
  try { list = await api("/api/instances"); } catch (e) { if (!stale(gen)) Main().innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
  if (stale(gen)) return; // 等待期间已切走：不再建 SSE / 定时器
  const info = list.find(i => i.name === name);
  if (!info) { Main().innerHTML = `<div class="err-box">实例不存在</div>`; return; }
  Main().innerHTML = `<nav class="crumbs" aria-label="位置"><a href="#/instances">服务器</a>${icon("chevronRight")}<span>${esc(name)}</span></nav>
    <div class="detail-head">
      ${avatarOf(info.core, "lg")}
      <h1>${esc(name)}</h1>
      <span id="d-status">${headStatus(info)}</span>
      <span class="badge core">${coreName(info.core)}</span>
      <span class="badge">${info.kind === "proxy" ? "v" : "MC "}${esc(info.mc)}</span>
      <span class="badge">Java ${info.javaMajor}</span>
      <span class="grow"></span>
      <button class="btn primary" id="d-start" ${info.status !== "stopped" ? "disabled" : ""}>${icon("play")} 启动</button>
      <button class="btn" id="d-stop" ${info.status === "stopped" || info.status === "stopping" ? "disabled" : ""}>${icon("stop")} 停止</button>
      <button class="btn" id="d-dir" aria-haspopup="menu">${icon("folder")} 打开目录 ${icon("chevronDown")}</button>
    </div>
    <div class="tabs">${(() => {
      const isProxy = info.kind === "proxy";
      const tabs = [["console", "控制台"]];
      if (!isProxy) tabs.push(["players", "玩家"], ["backups", "备份"]);
      tabs.push(["tasks", "定时任务"]);
      if (info.core !== "vanilla") tabs.push(["res", "资源"]);
      if (!isProxy) tabs.push(["common", "常用设置"], ["raw", "全部配置"]);
      tabs.push(["jvm", "内存 / 启动"]);
      const base = "#/inst/" + encodeURIComponent(name) + "/";
      return tabs.map(([id, label]) => `<a class="tab ${tab === id ? "cur" : ""}" data-t="${id}" href="${base}${id}"${tab === id ? ` aria-current="page"` : ""}>${label}</a>`).join("");
    })()}</div>
    <div id="tab-body" class="sec-enter"></div>`;
  $("#d-dir").onclick = () => dropMenu($("#d-dir"), folderItems(info));
  $("#d-start").onclick = async () => {
    try { $("#d-start").disabled = true; await api(`/api/instances/${encodeURIComponent(name)}/start`, { method: "POST" }); toast("正在启动，首次生成世界可能需要一两分钟"); refreshHead(); }
    catch (e) { toast(e.message, true); $("#d-start").disabled = false; }
  };
  $("#d-stop").onclick = async () => {
    try { $("#d-stop").disabled = true; await api(`/api/instances/${encodeURIComponent(name)}/stop`, { method: "POST" }); toast("正在保存世界并停止"); refreshHead(); }
    catch (e) { toast(e.message, true); $("#d-stop").disabled = false; }
  };
  const refreshHead = async () => {
    try {
      const l = await api("/api/instances");
      if (stale(gen)) return;
      const cur = l.find(i => i.name === name);
      if (!cur) return;
      info.status = cur.status; // 各 tab 读到的状态随之更新
      $("#d-status").innerHTML = headStatus(cur);
      $("#d-start").disabled = cur.status !== "stopped";
      $("#d-stop").disabled = cur.status === "stopped" || cur.status === "stopping";
    } catch {}
  };
  startPoll(refreshHead, 2500, gen);

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
          <label class="hint" style="display:flex;align-items:center;gap:6px;margin:0">保留最近 <input type="number" id="bk-keep" min="1" max="1000" value="${keep}" style="width:72px"> 份</label>
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
      bindSaveInput($("#bk-keep"), $("#bk-keep-save"), async v => {
        const n = Math.max(1, Math.min(1000, Math.round(+v) || 10));
        await api("/api/config", { method: "PUT", body: { backupKeep: n } });
        keep = n; $("#bk-keep").value = n;
        toast(`已设置保留最近 ${n} 份（下次备份时生效）`);
      }, gen);
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
    // 增删定时任务、切换崩溃重启都只是改了草稿：吸底保存条显示未保存项数，离开前会被拦下确认
    body.innerHTML = `<div style="max-width:640px">
      <div class="prop-item" style="margin-bottom:18px">
        <div><div class="pl">崩溃自动重启</div><div class="pd">异常退出后按 10/30/60 秒退避重启；连续 3 次崩溃放弃并提示</div></div>
        <label class="switch"><input type="checkbox" id="pol-crash" ${pol.crashRestart ? "checked" : ""}><span class="sw"></span></label>
      </div>
      <h3 style="margin-bottom:8px">每日定时任务</h3>
      <div id="sched-list"></div>
      <div class="row" style="margin:12px 0 4px;flex-wrap:wrap">
        <select id="sc-type" style="width:130px"><option value="restart">定时重启</option><option value="command">定时命令</option><option value="backup">定时备份</option></select>
        <input type="time" id="sc-at" value="04:00" style="width:130px">
        <input type="text" id="sc-args" placeholder="命令内容（仅定时命令需要），如 say 大家好" style="flex:1;min-width:200px">
        <button class="btn" id="sc-add">${icon("plus")} 添加</button>
      </div>
      <div class="field-err" id="sc-err"></div>
      ${saveBar("保存策略")}</div>`;
    let paintBar = () => {};
    const drawScheds = () => {
      $("#sched-list").innerHTML = scheds.map((s, i) => `
        <div class="java-row"><span class="badge core">${esc(TYPE_NAMES[s.type] || s.type)}</span>
          <span class="jv">每天 ${esc(s.at)}</span>
          <span class="jp">${esc(s.args || "")}</span>
          <span class="grow"></span>
          <button class="btn sm danger" data-i="${i}">移除</button></div>`).join("") ||
        `<div class="sub">暂无定时任务</div>`;
      $("#sched-list").querySelectorAll("[data-i]").forEach(b => b.onclick = () => { scheds.splice(+b.dataset.i, 1); drawScheds(); paintBar(); });
    };
    drawScheds();
    const scErr = msg => { $("#sc-err").innerHTML = msg ? icon("warn") + " " + esc(msg) : ""; };
    $("#sc-add").onclick = () => {
      const s = { type: $("#sc-type").value, at: $("#sc-at").value, args: $("#sc-args").value.trim() };
      if (!s.at) { scErr("请选择执行时间"); $("#sc-at").focus(); return; }
      if (s.type === "command" && !s.args) { scErr("定时命令需要填写命令内容，如 say 大家好"); $("#sc-args").focus(); return; }
      scErr("");
      scheds.push(s);
      $("#sc-args").value = "";
      drawScheds();
      paintBar();
    };
    paintBar = wireSaveBar(body, gen,
      () => ({ crash: String($("#pol-crash").checked), schedules: JSON.stringify(scheds) }),
      async () => {
        await api(`/api/instances/${encodeURIComponent(name)}/policies`, { method: "PUT", body: { crashRestart: $("#pol-crash").checked, schedules: scheds } });
        toast("策略已保存并即时生效");
      });

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
      const notice = (p.key === "white-list" && verGte(mc, "26.3")) ? `<div class="pd" style="color:var(--warning-text)">注意：此版本起白名单默认开启</div>` : "";
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
      ${saveBar("保存设置", running ? `<span class="warn-text">${icon("warn")} 运行中：保存后需重启生效（游戏规则即时生效）</span>` : "")}`;
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
        motdIn.dispatchEvent(new Event("input", { bubbles: true })); // 刷新预览，并让保存条感知到改动
      }
      motdIn.oninput = () => renderMotd(prev, motdIn.value);
      renderMotd(prev, motdIn.value);
    }
    const readProps = () => Object.fromEntries([...body.querySelectorAll("[data-k]")].map(el =>
      [el.dataset.k, el.type === "checkbox" ? (el.checked ? "true" : "false") : el.value]));
    wireSaveBar(body, gen, readProps, async () => {
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
      await api(`/api/instances/${encodeURIComponent(name)}/properties`, { method: "PUT", body: { pairs } });
      toast("已保存 server.properties" + (data.running ? "（重启后生效）" : ""));
    });

  } else if (tab === "raw") {
    let data;
    try { data = await api(`/api/instances/${encodeURIComponent(name)}/properties`); } catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    if (!data.pairs.length) { body.innerHTML = `<div class="sub">配置文件为空 —— 首次启动服务器后，服务端会自动生成全部配置项。</div>`; return; }
    const LABELS = Object.fromEntries((window.PROPS_CATALOG || []).map(p => [p.key, p.label]));
    body.innerHTML = `<div style="max-width:900px"><div class="sub">server.properties 全部键值（高级）。已知项附中文名。</div>
      <table class="raw">${data.pairs.map(p =>
        `<tr><td>${esc(p.key)}</td><td class="raw-cn">${LABELS[p.key] ? esc(LABELS[p.key]) : ""}</td><td><input type="text" data-k="${esc(p.key)}" value="${esc(p.value)}"></td></tr>`).join("")}</table>
      ${saveBar("保存全部", data.running ? `<span class="warn-text">${icon("warn")} 运行中：保存后需重启生效</span>` : "")}</div>`;
    wireSaveBar(body, gen,
      () => Object.fromEntries([...body.querySelectorAll("input[data-k]")].map(el => [el.dataset.k, el.value])),
      async () => {
        const pairs = [...body.querySelectorAll("input[data-k]")].map(el => ({ key: el.dataset.k, value: el.value }));
        await api(`/api/instances/${encodeURIComponent(name)}/properties`, { method: "PUT", body: { pairs } });
        toast("已保存 server.properties" + (data.running ? "（重启后生效）" : ""));
      });

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
        ${saveBar("保存", info.status === "stopped" ? "" : `<span class="warn-text">${icon("warn")} 运行中：保存后需重启生效</span>`)}
      </div>`;
    renderMemoryControl($("#jm-mem-mount"), { sliderId: "jm-mem", min: 1024, max: maxMem, value: Math.min(info.xmxMb, maxMem), totalMb: appInfo.ramMb, availMb: appInfo.availRamMb });
    // 老版本创建时加入的 log4shell 缓解参数（后端保存时也会强制补回）：套用预设 / 清空时原样保留
    const LOG4J_FIX = ["-Dlog4j2.formatMsgNoLookups=true", "-Dlog4j.configurationFile=log4j2_112-116.xml"];
    const jvmFlags = () => $("#jm-jvm").value.split(/\s+/).map(s => s.trim()).filter(Boolean);
    const keptFix = () => { const cur = jvmFlags(); return LOG4J_FIX.filter(f => cur.includes(f)); };
    const paintBar = wireSaveBar(body, gen,
      () => ({ xmx: $("#jm-mem").value, jvm: jvmFlags().join(" ") }), // 只比较参数本身，换行 / 空格差异不算修改
      async () => {
        const flags = jvmFlags();
        await api(`/api/instances/${encodeURIComponent(name)}/settings`, { method: "PUT", body: { xmxMb: +$("#jm-mem").value, xmsMb: 0, extraJvm: flags } });
        // 回显实际保存的参数（老版本被删掉的 log4shell 缓解参数会被后端补回）；回读失败不影响已成功的保存。
        // 回显在 wireSaveBar 重取基线之前完成，补回的参数不会被算成「未保存的修改」
        const saved = await api("/api/instances").then(l => l.find(i => i.name === name)?.extraJvm).catch(() => null);
        if (saved && !stale(gen)) $("#jm-jvm").value = saved.join("\n");
        toast("已保存内存与 JVM 参数" + (saved?.some(a => !flags.includes(a)) ? "（已自动补回 log4shell 漏洞缓解参数）" : ""));
      });
    $("#jm-aikar").onclick = () => {
      const fix = keptFix();
      $("#jm-jvm").value = [...aikarsFlags(+$("#jm-mem").value), ...fix].join("\n");
      paintBar();
      toast(`已填入 Aikar's Flags${fix.length ? "（保留 log4shell 漏洞缓解参数）" : ""}，保存后生效`);
    };
    $("#jm-clear").onclick = () => {
      const fix = keptFix();
      $("#jm-jvm").value = fix.join("\n");
      paintBar();
      if (fix.length) toast("已清空（保留 log4shell 漏洞缓解参数）");
    };
  }
}

/* ---------- 视图：联机穿透 ---------- */
async function renderTunnels() {
  const gen = viewGen;
  let insts = [];
  try { insts = await api("/api/instances"); } catch {}
  if (stale(gen)) return;
  Main().innerHTML = pageHead("内网穿透",
    "把本地服务器映射到公网，异地朋友也能直接连接。基于 <b>OpenFrp OPENAPI</b>，并支持 SakuraFrp 与自建 frps。",
    `<button class="btn primary" id="tn-toggle" aria-expanded="false" aria-controls="tn-form">${icon("plus")} 添加隧道</button>`) + `
    <div id="tun-list">${skeletonRows(4)}</div>
    <div id="tn-form" class="card" hidden style="margin-top:16px;max-width:var(--w-read)">
    <h3 style="margin-bottom:8px">添加隧道</h3>
    <div class="hint" style="margin-bottom:14px;line-height:1.8">
      <b>OpenFrp</b>：到 <a href="https://console.openfrp.net" target="_blank">OpenFrp 控制台</a> 创建 TCP 隧道（本地端口填 MC 端口）→「个人中心」复制用户密钥；<br>
      <b>樱花frp</b>：到 <a href="https://www.natfrp.com" target="_blank">SakuraFrp</a> 创建隧道 → 复制访问密钥与隧道 ID（首次需手动放置其 frpc，按提示操作）；<br>
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
  $("#tn-toggle").onclick = () => {
    const f = $("#tn-form");
    f.hidden = !f.hidden;
    $("#tn-toggle").setAttribute("aria-expanded", String(!f.hidden));
    if (!f.hidden) { f.scrollIntoView({ behavior: "smooth", block: "nearest" }); $("#tn-name").focus({ preventScroll: true }); }
  };

  let logOpen = false;
  const drawList = async () => {
    if (logOpen) return; // 日志展开时暂停列表刷新，避免打断 SSE 显示
    let list;
    try { list = await api("/api/tunnels"); } catch (e) { if (!stale(gen)) $("#tun-list").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    if (stale(gen) || logOpen) return;
    if (!list.length) { $("#tun-list").innerHTML = `<div class="empty"><div class="empty-ico">${icon("globe")}</div><div class="empty-title">还没有隧道</div>点右上角「添加隧道」，开服后就能把本地服务器映射到公网</div>`; return; }
    $("#tun-list").innerHTML = list.map(t => `
      <div class="java-row" style="max-width:980px">
        <span class="dot ${t.running ? "running" : ""}"></span>
        <b style="min-width:110px">${esc(t.name)}</b>
        <span class="badge core">${esc(PROV_NAMES[t.provider] || t.provider)}</span>
        ${t.boundInstance ? `<span class="badge">${icon("link")} ${esc(t.boundInstance)}${t.autoStart ? " · 跟随" : ""}</span>` : ""}
        ${t.publicAddr ? `<span class="jv" style="color:var(--accent-text);font-family:var(--mono)">${esc(t.publicAddr)}</span>
          <button class="btn sm" data-copy="${esc(t.publicAddr)}">${icon("copy")} 复制</button>`
          : t.lastError ? `<span class="jp" style="color:var(--danger-text);display:inline-flex;align-items:center;gap:5px" title="${esc(t.lastError)}">${icon("warn")} ${esc(t.lastError.length > 46 ? t.lastError.slice(0, 46) + "…" : t.lastError)}</span>`
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
  startPoll(drawList, 4000, gen);

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
      // 收起表单并清空密钥类字段，回到列表看新隧道
      $("#tn-form").hidden = true;
      $("#tn-toggle").setAttribute("aria-expanded", "false");
      ["#tn-cred", "#tn-proxy", "#tn-saddr"].forEach(s => { $(s).value = ""; });
      drawList();
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------- 视图：设置 ---------- */
const SETTINGS_SECTIONS = [
  { id: "appearance", label: "外观", icon: "palette" },
  { id: "download", label: "下载与网络", icon: "globe" },
  { id: "storage", label: "存储位置", icon: "folder" },
  { id: "java", label: "Java 运行时", icon: "coffee" },
  { id: "remote", label: "远程访问", icon: "phone" },
  { id: "notify", label: "通知与集成", icon: "bell" },
  { id: "startup", label: "启动与托盘", icon: "monitor" },
  { id: "about", label: "更新与关于", icon: "info" },
];

async function renderSettings(section) {
  const gen = viewGen;
  if (!SETTINGS_SECTIONS.some(s => s.id === section)) section = "appearance";
  // 壳（标题 + 左导航）常驻：切分区只换右侧 body 并播局部入场动效，不整页重建、导航不闪不跳。
  // #set-body 仅存在于设置视图内，可据此判断壳是否已挂载。
  // 不套独立居中容器（旧 .settings-page 令标题与其他页错位、导航随内容横跳），直接落在全站内容列上
  if (!$("#set-body")) {
    Main().innerHTML = pageHead("设置") + `
      <div class="settings-layout">
        <nav class="settings-nav">${SETTINGS_SECTIONS.map(s => `
          <a class="set-nav" data-sec="${s.id}" href="#/settings/${s.id}"><span class="sn-ico">${icon(s.icon)}</span>${s.label}</a>`).join("")}</nav>
        <div class="settings-body" id="set-body"><div class="sub">加载中…</div></div>
      </div>`;
  }
  document.querySelectorAll(".set-nav").forEach(a => a.classList.toggle("cur", a.dataset.sec === section));
  const body = $("#set-body");
  let info;
  try { info = await api("/api/app"); } catch (e) { if (!stale(gen)) body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
  if (stale(gen)) return; // 快速连点分区时，先发后至的旧响应不得覆盖当前分区
  ({ appearance: setAppearance, download: setDownload, storage: setStorage, java: setJava, remote: setRemote, notify: setNotify, startup: setStartup, about: setAbout }[section])(body, info);
  body.classList.remove("sec-enter"); void body.offsetWidth; // 重触发局部入场
  body.classList.add("sec-enter");
}

/* — 外观 — 模式 / 配色方案 / 强调色，点选即时生效（只存在本机）。
   方案卡的预览区带上该方案的 data-scheme/data-theme/data-accent，直接用 themes.css 的令牌渲染缩略界面。 */
function setAppearance(body) {
  let refocus = null; // 重绘后把焦点还给刚点的那一项（键盘操作不丢位置）
  const draw = () => {
    const a = Appearance.get();
    const theme = document.documentElement.dataset.theme;
    body.innerHTML = settingsHead("主题模式", "「跟随系统」会随 Windows 的浅色 / 深色设置自动切换。") +
      `<div class="seg" role="radiogroup" aria-label="主题模式">${["auto", "light", "dark"].map(m =>
        `<button type="button" role="radio" aria-checked="${a.mode === m}" class="${a.mode === m ? "on" : ""}" data-mode="${m}">${icon(MODE_ICON[m])}${MODE_LABEL[m]}</button>`).join("")}</div>` +
      settingsHead("配色方案", "几套业界常用配色，浅色与深色下的文字对比度均已按 WCAG AA 校验。") +
      `<div class="scheme-grid">${SCHEMES.map(s => `
        <button type="button" class="scheme-card ${a.scheme === s.id ? "on" : ""}" data-scheme-pick="${s.id}" aria-pressed="${a.scheme === s.id}">
          <div class="sc-preview" data-scheme="${s.id}" data-theme="${theme}" data-accent="${a.accent}" aria-hidden="true">
            <div class="sc-side"><i></i><i></i><i></i></div>
            <div class="sc-main"><div class="sc-card"><i></i><i></i><b></b></div></div>
          </div>
          <div class="sc-meta"><div><div class="sc-name">${esc(s.name)}</div><div class="sc-desc">${esc(s.desc)}</div></div>${a.scheme === s.id ? icon("check") : ""}</div>
        </button>`).join("")}</div>` +
      settingsHead("强调色", "按钮、选中项与链接使用的颜色；默认跟随配色方案。") +
      `<div class="accent-row" role="radiogroup" aria-label="强调色">
        <button type="button" role="radio" aria-checked="${a.accent === "auto"}" class="acc-swatch acc-auto ${a.accent === "auto" ? "on" : ""}" data-accent-pick="auto">跟随方案</button>
        ${ACCENTS.map(c => `<button type="button" role="radio" aria-checked="${a.accent === c.id}" class="acc-swatch ${a.accent === c.id ? "on" : ""}" style="--sw:${c.sw}" data-accent-pick="${c.id}" title="${c.name}" aria-label="${c.name}">${a.accent === c.id ? icon("check") : ""}</button>`).join("")}
      </div>
      <div class="hint" style="margin-top:20px">想换背景图？在程序所在目录新建 <code>bg</code> 文件夹并放入图片，下次打开时随机选一张作为壁纸。</div>`;
    body.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { refocus = `[data-mode="${b.dataset.mode}"]`; Appearance.set({ mode: b.dataset.mode }); });
    body.querySelectorAll("[data-scheme-pick]").forEach(b => b.onclick = () => { refocus = `[data-scheme-pick="${b.dataset.schemePick}"]`; Appearance.set({ scheme: b.dataset.schemePick }); });
    body.querySelectorAll("[data-accent-pick]").forEach(b => b.onclick = () => { refocus = `[data-accent-pick="${b.dataset.accentPick}"]`; Appearance.set({ accent: b.dataset.accentPick }); });
    if (refocus) { body.querySelector(refocus)?.focus(); refocus = null; }
  };
  appearanceView = draw;
  draw();
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
    settingsHead("CurseForge API Key（选填）", `导入 CurseForge 格式整合包时解析模组直链用，<a href="https://console.curseforge.com/" target="_blank">免费申请</a>；Modrinth 格式整合包无需配置。`) +
    `<div class="row"><input type="password" id="cf-key" value="${esc(info.config.cfApiKey || "")}" placeholder="粘贴 API Key" style="max-width:420px"><button class="btn" id="cf-save">保存</button></div>`;
  $("#src-cards").querySelectorAll(".radio-card").forEach(c => c.onclick = async () => {
    try {
      await api("/api/config", { method: "PUT", body: { source: c.dataset.v } });
      $("#src-cards").querySelectorAll(".radio-card").forEach(x => x.classList.toggle("sel", x === c));
      toast("下载源已切换");
    } catch (e) { toast(e.message, true); }
  });
  bindSaveInput($("#cf-key"), $("#cf-save"), async v => {
    await api("/api/config", { method: "PUT", body: { cfApiKey: v.trim() } });
    toast("CurseForge API Key 已保存");
  }, viewGen);
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
/* 访问地址排序：家用局域网段优先，让默认那张二维码就是手机最可能连得上的地址
   （172.16/12 多为 WSL / Hyper-V 虚拟网卡；169.254 是没拿到 DHCP 的自动地址，垫底） */
const lanIPRank = ip => /^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : /^169\.254\./.test(ip) ? 4 : 3;
function setRemote(body, info) {
  const lanPort = info.port || location.port || "27333"; // 实际监听端口（被占用时会随机化）
  const ips = (info.ips || []).slice().sort((a, b) => lanIPRank(a) - lanIPRank(b));
  body.innerHTML = settingsHead("远程访问（手机 / 平板管理）", "开启后本机 IP 可从局域网访问管理界面（密码保护，改动需重启程序生效）。") +
    `<div class="row" style="margin-bottom:10px;flex-wrap:wrap">
      <label class="switch"><input type="checkbox" id="lan-on" ${info.config.listenLan ? "checked" : ""}><span class="sw"></span><span class="sw-label">允许局域网访问</span></label>
      <input type="password" id="lan-pw" placeholder="${info.lanSet ? "已设置密码（留空则不修改）" : "设置访问密码（必填）"}" style="max-width:260px">
      <button class="btn" id="lan-save">保存</button>
    </div>
    ${!info.config.listenLan ? "" : ips.length ? `<div class="qr-card">
      <div class="qr-box" id="qr-box" role="img"></div>
      <div class="qr-info">
        <div class="ri-title">手机扫码访问</div>
        <div class="ri-sub">用手机相机或浏览器扫一扫，打开后输入访问密码即可管理；手机需与本机连在同一局域网（同一 Wi-Fi / 路由器）。</div>
        <div class="qr-url" id="qr-url"></div>
        ${ips.length > 1 ? `<div class="qr-ips">${ips.map((ip, i) => `<button type="button" class="qr-ip" data-i="${i}">${esc(ip)}</button>`).join("")}</div>
        <div class="hint">本机有多个网络地址：扫码打不开就换一个（家用路由器下通常是 192.168.x.x）。</div>` : ""}
      </div>
    </div>` : `<div class="hint">未检测到本机局域网 IP，请确认已连接网络。</div>`}
    <div class="hint">若无法访问，请以管理员运行一次放行防火墙：<code>netsh advfirewall firewall add rule name="AutoMCHUB" dir=in action=allow protocol=TCP localport=${esc(String(lanPort))}</code></div>`;
  $("#lan-save").onclick = async () => {
    const b = { listenLan: $("#lan-on").checked };
    if ($("#lan-pw").value) b.lanPassword = $("#lan-pw").value;
    try { await api("/api/config", { method: "PUT", body: b }); toast("远程访问设置已保存，重启 AutoMCHUB 后生效"); }
    catch (e) { toast(e.message, true); }
  };
  if (!info.config.listenLan || !ips.length) return;
  // 二维码纯前端生成（qrcode.js），多地址时点选切换
  const show = i => {
    const url = `http://${ips[i]}:${lanPort}`;
    $("#qr-box").innerHTML = QR.svg(url);
    $("#qr-box").setAttribute("aria-label", "访问地址二维码：" + url);
    $("#qr-url").textContent = url;
    body.querySelectorAll(".qr-ip").forEach(b => {
      const on = +b.dataset.i === i;
      b.classList.toggle("cur", on);
      b.setAttribute("aria-pressed", String(on));
    });
  };
  body.querySelectorAll(".qr-ip").forEach(b => b.onclick = () => show(+b.dataset.i));
  show(0);
}

/* — 通知与集成 — */
function setNotify(body, info) {
  body.innerHTML = settingsHead("Webhook 事件推送（选填）", "服务器启停/崩溃、玩家进出、备份完成、隧道上线等事件将 POST 到该地址（JSON），可接入群机器人等。") +
    `<div class="row"><input type="text" id="wh-url" value="${esc(info.config.webhookUrl || "")}" placeholder="https://example.com/hook（留空关闭）" style="max-width:460px"><button class="btn" id="wh-save">保存</button></div>`;
  bindSaveInput($("#wh-url"), $("#wh-save"), async v => {
    await api("/api/config", { method: "PUT", body: { webhookUrl: v.trim() } });
    toast(v.trim() ? "Webhook 已保存，即时生效" : "已关闭 Webhook 推送");
  }, viewGen);
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
      内网穿透基于 <b>OpenFrp OPENAPI</b> 接入（<a href="https://www.openfrp.net" target="_blank">openfrp.net</a>）。<br>
      本软件为开源项目，遵循仓库 LICENSE（MIT）。<br>
      Minecraft 是 Mojang Studios 的商标，本工具与 Mojang / Microsoft / 网易均无隶属或授权关系。<br>
      NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
    </div>
    <div class="set-danger">
      <div><div class="ri-title">退出程序</div><div class="ri-sub">优雅停止所有运行中的服务器（保存世界）后退出</div></div>
      <button class="btn danger" id="quit-app">${icon("power")} 退出 AutoMCHUB</button>
    </div>`;
  bindSaveInput($("#up-repo"), $("#up-save"), async v => {
    await api("/api/config", { method: "PUT", body: { updateRepo: v.trim() } });
    toast("更新仓库已保存");
  }, viewGen);
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

/* 首次运行引导卡（用户协议与免责声明 + 选下载源 + 存放位置说明；
   同意后写 config.onboarded / tosAccepted，二者齐备才不再弹出） */
function showOnboarding(info) {
  const root = $("#modal-root");
  const SRC = { auto: "自动（推荐）— 国内镜像优先，失败自动回退官方源", mirror: "镜像优先 — 国内下载更快", official: "仅官方源 — 网络直连国外" };
  const cur = (info.config && info.config.source) || "auto";
  root.innerHTML = `<div class="modal-mask"><div class="modal onboard">
    <h3>欢迎使用 AutoMCHUB</h3>
    <div class="m-body">
      <div class="ob-sec" style="margin-top:0"><div class="ob-label">用户协议与免责声明</div>
        <div class="ob-terms">
          AutoMCHUB 是开源、非营利的 Minecraft Java 版开服辅助工具：仅从 Mojang、PaperMC 等官方公开渠道下载服务端文件并配置本地运行环境，<b>不包含、不分发游戏客户端，不修改游戏本体，不破解正版验证</b>。
          <ol>
            <li><b>非官方产品</b>：本工具由社区独立开发，与 Mojang Studios、Microsoft 及网易（中国版《我的世界》运营方）均无任何隶属、合作或授权关系。NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT. "Minecraft" 及相关商标归 Mojang / Microsoft 所有。</li>
            <li><b>遵守官方条款</b>：使用本工具搭建与运行服务器，须遵守 <b>Minecraft EULA</b> 与 Microsoft 服务协议；如你使用网易代理的中国版《我的世界》账号或内容，请另行遵守网易的用户协议（两套账号体系互不相通，本工具仅面向国际 Java 版服务端）。</li>
            <li><b>正版建议</b>：建议使用正版 Mojang / Microsoft 账号并开启正版验证联机。是否使用离线模式由你自行决定并自行承担相应后果，本工具不提供任何绕过正版验证的功能。</li>
            <li><b>对外服务责任自负</b>：通过内网穿透等方式向他人开放服务器时，你是该服务器的运营者，须自行遵守所在地法律法规（含网络安全与未成年人保护相关规定），并对服务器内容与运营行为负责。</li>
            <li><b>开源免责</b>：本软件基于 MIT 协议按「现状」提供，不作任何明示或默示担保；因使用或无法使用本软件导致的任何数据丢失、账号问题或其他损失，作者及贡献者不承担责任。</li>
          </ol>
        </div>
        <label class="ob-agree"><input type="checkbox" id="ob-agree"><span>我已阅读并同意上述《用户协议与免责声明》及 <a href="https://aka.ms/MinecraftEULA" target="_blank">Minecraft EULA</a></span></label>
      </div>
      <div class="ob-sec"><div class="ob-label">下载源（之后可在「设置」里随时更改）</div>
        <div id="ob-src">${Object.entries(SRC).map(([v, label]) =>
    `<label class="ob-radio"><input type="radio" name="ob-src" value="${v}" ${v === cur ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div>
      </div>
      <div class="ob-sec"><div class="ob-label">你的服务器将存放在</div>
        <div class="ob-path">${esc(info.serversRoot || "程序目录\\servers")}</div>
        <div class="hint" style="margin-top:6px">每台服务器一个子文件夹。想放到 D 盘等大容量分区，可到「设置 → 存储位置」更改。</div>
      </div>
    </div>
    <div class="m-actions"><button class="btn primary" id="ob-go" disabled>同意并开始使用</button></div>
  </div></div>`;
  const agree = root.querySelector("#ob-agree"), go = root.querySelector("#ob-go");
  agree.onchange = () => { go.disabled = !agree.checked; };
  go.onclick = async () => {
    const sel = root.querySelector('input[name="ob-src"]:checked');
    try { await api("/api/config", { method: "PUT", body: { source: sel ? sel.value : cur, onboarded: true, tosAccepted: true } }); }
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
    const cores = await api("/api/cores").catch(() => []);
    cores.forEach(c => CORES[c.id] = c);
  } catch (e) {
    // 局域网访问（如手机扫码打开）尚未登录：api() 已弹出密码登录遮罩，保留它，不得整页覆盖成「无法连接」
    if ($("#login-mask")) return;
    document.body.innerHTML = `<div style="padding:60px;text-align:center;color:#e5644e">无法连接 AutoMCHUB 后端：${esc(e.message)}<br><br>请通过程序窗口打开本页面。</div>`;
    return;
  }
  navigate();
  applyBackground();
  // 协议为新增项：老用户虽已 onboarded，但未同意过协议（tosAccepted）仍需补一次
  if (!info.config || !info.config.onboarded || !info.config.tosAccepted) showOnboarding(info);
})();
