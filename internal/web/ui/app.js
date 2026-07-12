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
  d.innerHTML = `<div class="modal"><h3>🔐 AutoMCHUB 远程访问</h3>
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
  setTimeout(() => d.remove(), isErr ? 6500 : 3500);
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
    root.innerHTML = `<div class="modal-mask"><div class="modal">
      <h3>${esc(title)}</h3><div class="m-body">${body}</div>${extra}
      <div class="m-actions">
        <button class="btn" data-x="cancel">取消</button>
        <button class="btn ${danger ? "danger" : "primary"}" data-x="ok">${esc(okText)}</button>
      </div></div></div>`;
    root.querySelector('[data-x="cancel"]').onclick = () => { root.innerHTML = ""; resolve(null); };
    root.querySelector('[data-x="ok"]').onclick = () => {
      const checks = {};
      root.querySelectorAll("input[type=checkbox][data-k]").forEach(c => checks[c.dataset.k] = c.checked);
      root.innerHTML = "";
      resolve(checks);
    };
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

/* 浅色 / 深色主题切换（index.html 已在样式生效前预置 data-theme） */
(function initTheme() {
  const btn = $("#theme-btn");
  const cur = () => document.documentElement.dataset.theme || "dark";
  const paint = () => {
    btn.textContent = cur() === "light" ? "🌙" : "☀️";
    btn.title = cur() === "light" ? "切换到深色" : "切换到浅色";
  };
  btn.onclick = () => {
    document.documentElement.dataset.theme = cur() === "light" ? "dark" : "light";
    localStorage.setItem("amh_theme", document.documentElement.dataset.theme);
    paint();
  };
  paint();
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
  const baseColor = onDark ? "#AAAAAA" : "#565e57";
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

/* server.properties 常用项定义 */
const COMMON_PROPS = [
  { k: "online-mode", t: "bool", label: "正版验证", desc: "关闭后离线账户可进服（局域网常用）" },
  { k: "allow-flight", t: "bool", label: "允许飞行", desc: "防止模组/鞘翅玩家被误踢" },
  { k: "pvp", t: "bool", label: "玩家 PVP", desc: "允许玩家互相攻击" },
  { k: "difficulty", t: "sel", opts: ["peaceful", "easy", "normal", "hard"], optNames: ["和平", "简单", "普通", "困难"], label: "难度" },
  { k: "gamemode", t: "sel", opts: ["survival", "creative", "adventure", "spectator"], optNames: ["生存", "创造", "冒险", "旁观"], label: "默认游戏模式" },
  { k: "max-players", t: "int", label: "最大玩家数" },
  { k: "server-port", t: "int", label: "服务器端口", desc: "修改后需重启，并告知玩家新端口" },
  { k: "motd", t: "str", label: "服务器介绍 (MOTD)", desc: "支持中文，显示在多人游戏列表" },
  { k: "view-distance", t: "int", label: "视距（区块）", desc: "越大越吃配置，局域网建议 8~12" },
  { k: "simulation-distance", t: "int", label: "模拟距离（区块）" },
  { k: "spawn-protection", t: "int", label: "出生点保护半径", desc: "0 为不保护，非管理员可自由破坏" },
  { k: "white-list", t: "bool", label: "白名单", desc: "开启后需 whitelist add 添加玩家" },
  { k: "enable-command-block", t: "bool", label: "命令方块" },
  { k: "spawn-monsters", t: "bool", label: "生成怪物" },
  { k: "hardcore", t: "bool", label: "极限模式", desc: "死亡后变旁观者" },
  { k: "force-gamemode", t: "bool", label: "强制默认模式", desc: "玩家每次进服都重置为默认游戏模式" },
  { k: "level-seed", t: "str", label: "世界种子", desc: "仅对新建世界生效" },
];

/* ---------- 路由 ---------- */
const Main = () => $("#main");
let consoleES = null; // 当前 SSE 连接
let pollTimer = null;

function navigate() {
  if (consoleES) { consoleES.close(); consoleES = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  const hash = location.hash || "#/instances";
  const m = hash.match(/^#\/([a-z]+)(?:\/(.+))?$/);
  const view = m ? m[1] : "instances";
  const arg = m && m[2] ? decodeURIComponent(m[2]) : null;
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === view));
  if (view === "create") renderCreate();
  else if (view === "inst" && arg) renderDetail(arg);
  else if (view === "settings") renderSettings();
  else if (view === "tunnels") renderTunnels();
  else if (view === "task" && arg) renderTaskPage(arg);
  else renderInstances();
}
window.addEventListener("hashchange", navigate);

/* ---------- 视图：实例列表 ---------- */
async function renderInstances() {
  Main().innerHTML = eyebrow("SERVER LIST") + `<h1>我的服务器</h1><div class="sub">双击卡片进入控制台 · 按 2 快速新建 · 每个实例独立存放</div><div id="inst-cards">加载中…</div>`;
  const draw = async () => {
    let list;
    try { list = await api("/api/instances"); } catch (e) { $("#inst-cards").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    if (!list.length) {
      $("#inst-cards").innerHTML = `<div class="empty"><div class="big">⛏</div>这里空空如也<br>去合成你的第一台服务器吧<br><br><a class="btn primary" href="#/create">⚒ 去合成（按 2）</a></div>`;
      return;
    }
    $("#inst-cards").innerHTML = `<div class="cards">` + list.map(i => `
      <div class="card st-${i.status}" data-name="${esc(i.name)}">
        <div class="inst-head">
          ${cubeOf(i.core)}
          <span class="inst-name grow">${esc(i.name)}</span>
          <span class="dot ${i.status}"></span>
        </div>
        <div class="badges">
          <span class="badge core">${coreName(i.core)}</span>
          <span class="badge">${i.kind === "proxy" ? "v" : "MC "}${esc(i.mc)}</span>
          <span class="badge">Java ${i.javaMajor}</span>
          ${i.kind === "proxy" ? `<span class="badge">代理端</span>` : `<span class="badge">端口 ${i.port}</span>`}
          <span class="badge">${(i.xmxMb / 1024).toFixed(1)}G</span>
        </div>
        <div class="inst-meta" data-motd="${esc(i.motd || "")}"></div>
        <div class="inst-actions">
          ${i.status === "stopped"
            ? `<button class="btn sm primary" data-act="start">▶ 启动</button>`
            : `<button class="btn sm" data-act="stop">■ 停止</button>`}
          <a class="btn sm" href="#/inst/${encodeURIComponent(i.name)}">控制台 / 设置</a>
          <button class="btn sm" data-act="opendir" title="打开目录">📁</button>
          <button class="btn sm danger" data-act="del">删除</button>
        </div>
        <div class="dur"><i></i></div>
      </div>`).join("") + `</div>`;
    // MOTD 按 § 色码彩色渲染（与游戏内服务器列表一致）
    $("#inst-cards").querySelectorAll(".inst-meta").forEach(el => {
      if (el.dataset.motd) renderMotd(el, el.dataset.motd);
    });
    $("#inst-cards").querySelectorAll("[data-act]").forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      const name = b.closest(".card").dataset.name;
      const act = b.dataset.act;
      try {
        if (act === "start") { b.disabled = true; await api(`/api/instances/${encodeURIComponent(name)}/start`, { method: "POST" }); toast(`「${name}」正在启动`); }
        else if (act === "stop") { b.disabled = true; await api(`/api/instances/${encodeURIComponent(name)}/stop`, { method: "POST" }); toast(`「${name}」正在停止并保存世界`); }
        else if (act === "opendir") await api(`/api/instances/${encodeURIComponent(name)}/opendir`, { method: "POST" });
        else if (act === "del") {
          const r = await confirmModal({
            title: `删除实例「${name}」？`, danger: true, okText: "删除",
            body: "此操作会将实例从列表移除。",
            extra: `<label class="switch" style="margin-bottom:16px"><input type="checkbox" data-k="files" checked><span class="sw"></span><span class="sw-label">同时删除服务器文件夹（含地图存档，不可恢复）</span></label>`,
          });
          if (!r) return;
          await api(`/api/instances/${encodeURIComponent(name)}?files=${r.files ? 1 : 0}`, { method: "DELETE" });
          toast(`已删除「${name}」`);
        }
      } catch (e) { toast(e.message, true); }
      draw();
    });
    $("#inst-cards").querySelectorAll(".card").forEach(c => c.ondblclick = () => location.hash = `#/inst/${encodeURIComponent(c.dataset.name)}`);
  };
  await draw();
  pollTimer = setInterval(draw, 3000);
}

/* ---------- 视图：新建向导 ---------- */
const wiz = { step: 0, core: null, mc: null, build: null, snapshots: false };

async function renderCreate() {
  wiz.step = 0; wiz.core = null; wiz.mc = null; wiz.build = null;
  Main().innerHTML = eyebrow("CRAFTING") + `<h1>合成新服务器</h1><div class="sub">两种配方</div>
    <div class="core-grid" style="max-width:720px">
      <div class="core-card" id="mode-new"><div><div class="cn">⚒ 全新合成</div><div class="cd">选择核心与版本，从零搭建服务器</div></div></div>
      <div class="core-card" id="mode-import"><div><div class="cn">📦 导入整合包</div><div class="cd">Modrinth (.mrpack) / CurseForge (zip) 整合包一键开服</div></div></div>
    </div>`;
  $("#mode-new").onclick = () => drawWizard();
  $("#mode-import").onclick = () => drawImport();
}

/* ---------- 视图：整合包导入 ---------- */
async function drawImport() {
  const app = await api("/api/app").catch(() => ({ ramMb: 8192, config: {} }));
  const maxMem = Math.max(2048, Math.min(16384, app.ramMb - 2048));
  const defMem = Math.min(6144, maxMem);
  Main().innerHTML = eyebrow("IMPORT PACK") + `<h1>导入整合包</h1>
    <div class="sub">支持 Modrinth (.mrpack) 与 CurseForge (zip)。核心、MC 版本与加载器将从整合包自动识别。</div>
    <div class="form-grid">
      <label class="field full"><span>整合包文件</span><input type="file" id="im-file" accept=".mrpack,.zip"></label>
      <label class="field"><span>实例名称</span><input type="text" id="im-name" value="我的整合包服务器" maxlength="40"></label>
      <label class="field"><span>端口</span><input type="number" id="im-port" value="25565" min="1" max="65535"></label>
      <label class="field full"><span>最大内存：<b id="im-mem-val">${(defMem / 1024).toFixed(1)} GB</b>（整合包服建议 6GB+）</span>
        <input type="range" id="im-mem" min="2048" max="${maxMem}" step="512" value="${defMem}"></label>
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
      <button class="btn" id="im-back">← 返回</button>
      <button class="btn primary" id="im-go">⚒ 导入并部署</button>
    </div>`;
  $("#im-back").onclick = () => renderCreate(); // 直接重绘（hash 相同不会触发路由，不能用 location.hash）
  $("#im-mem").oninput = () => $("#im-mem-val").textContent = ($("#im-mem").value / 1024).toFixed(1) + " GB";
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
    try {
      const res = await fetch("/api/import/modpack", { method: "POST", headers: { "X-Token": TOKEN() }, body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "导入失败");
      toast(`已识别：${j.data.pack.core} ${j.data.pack.mc}（${j.data.pack.files} 个文件）`);
      location.hash = `#/task/${j.data.taskId}`;
    } catch (e) { toast(e.message, true); $("#im-go").disabled = false; $("#im-go").textContent = "🚀 导入并部署"; }
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
  if (wiz.step === 0) {
    wizardShell(`<div class="core-grid" id="core-grid">加载中…</div>
      <div class="wizard-foot"><button class="btn" id="wback0">← 返回</button><button class="btn primary" id="wnext" disabled>下一步 →</button></div>`);
    $("#wback0").onclick = () => renderCreate();
    let cores;
    try { cores = await api("/api/cores"); } catch (e) { $("#core-grid").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    cores.forEach(c => CORES[c.id] = c);
    $("#core-grid").innerHTML = cores.map(c => `
      <div class="core-card ${wiz.core === c.id ? "sel" : ""}" data-id="${c.id}">
        ${cubeOf(c.id)}
        <div><div class="cn">${esc(c.name)} <span class="badge core">${esc(c.tag)}</span></div>
        <div class="cd">${esc(c.desc)}</div></div>
      </div>`).join("");
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
        <input type="text" id="ver-search" placeholder="搜索版本号，如 1.20.1 / 26.2" style="max-width:280px">
        ${wiz.core === "vanilla" ? `<label class="switch"><input type="checkbox" id="snap-toggle" ${wiz.snapshots ? "checked" : ""}><span class="sw"></span><span class="sw-label">显示快照版</span></label>` : ""}
      </div>
      <div class="ver-list" id="ver-list">正在获取版本列表（镜像源）…</div>
      <div class="wizard-foot"><button class="btn" id="wback">← 上一步</button><button class="btn primary" id="wnext" ${wiz.mc ? "" : "disabled"}>下一步 →</button></div>`);
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
          <span>${esc(v.id)} ${v.latest ? "🌟" : ""}</span><span class="vt">${v.type === "snapshot" ? "快照" : "正式版"}</span>
        </div>`).join("") : `<div class="ver-item">没有匹配的版本</div>`;
      $("#ver-list").querySelectorAll(".ver-item[data-id]").forEach(el => el.onclick = () => {
        wiz.mc = el.dataset.id;
        $("#ver-list").querySelectorAll(".ver-item").forEach(x => x.classList.toggle("sel", x.dataset.id === wiz.mc));
        $("#wnext").disabled = false;
      });
    };
    const loadVersions = async () => {
      $("#ver-list").textContent = "正在获取版本列表…";
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
      <div class="ver-list" id="build-list">正在获取构建列表…</div>
      <div class="wizard-foot"><button class="btn" id="wback">← 上一步</button><button class="btn primary" id="wnext" disabled>下一步 →</button></div>`);
    $("#wback").onclick = () => { wiz.step = 1; drawWizard(); };
    $("#wnext").onclick = () => { wiz.step = 3; drawWizard(); };
    try {
      const builds = await api(`/api/builds?core=${wiz.core}&mc=${encodeURIComponent(wiz.mc)}`);
      if (!builds.length) throw new Error(`${wiz.mc} 暂无 ${coreName(wiz.core)} 构建，请换个版本或核心`);
      if (!wiz.build) wiz.build = (builds.find(b => b.recommended) || builds[0]).id;
      $("#build-list").innerHTML = builds.slice(0, 200).map(b => `
        <div class="ver-item ${wiz.build === b.id ? "sel" : ""}" data-id="${esc(b.id)}">
          <span>${esc(b.id)} ${b.recommended ? "✅ 推荐" : ""}</span><span class="vt">${esc(b.label || "")}</span>
        </div>`).join("");
      $("#build-list").querySelectorAll(".ver-item").forEach(el => el.onclick = () => {
        wiz.build = el.dataset.id;
        $("#build-list").querySelectorAll(".ver-item").forEach(x => x.classList.toggle("sel", x.dataset.id === wiz.build));
      });
      $("#wnext").disabled = false;
    } catch (e) { $("#build-list").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }

  } else {
    const isProxy = coreKind(wiz.core) === "proxy";
    const app = await api("/api/app").catch(() => ({ ramMb: 8192 }));
    const maxMem = Math.max(2048, Math.min(16384, app.ramMb - 2048));
    const defMem = isProxy ? 1024 : Math.min(4096, maxMem);
    wizardShell(`
      <div class="form-grid">
        <label class="field"><span>实例名称</span><input type="text" id="f-name" value="我的${coreName(wiz.core)}服务器" maxlength="40"></label>
        ${isProxy ? "" : `<label class="field"><span>端口（默认 25565）</span><input type="number" id="f-port" value="25565" min="1" max="65535"></label>`}
        <label class="field full"><span>最大内存：<b id="mem-val">${(defMem / 1024).toFixed(1)} GB</b>（本机共 ${(app.ramMb / 1024).toFixed(0)} GB）</span>
          <input type="range" id="f-mem" min="512" max="${maxMem}" step="512" value="${defMem}">
          <div class="hint">${isProxy ? "代理端很省内存，1GB 通常足够" : "模组服建议 4GB 以上；纯净小队游玩 2~4GB 足够"}</div>
        </label>
        ${isProxy ? "" : `
        <label class="field full"><span>服务器介绍 MOTD（支持中文与 § 色码）</span><input type="text" id="f-motd" value="AutoMCHUB 开服 · 一起来玩！"></label>
        <div class="field"><label class="switch"><input type="checkbox" id="f-online"><span class="sw"></span>
          <span><span class="sw-label">正版验证（online-mode）</span><div class="sw-desc">默认关闭：离线账户可直接进服</div></span></label></div>
        <div class="field"><label class="switch"><input type="checkbox" id="f-flight" checked><span class="sw"></span>
          <span><span class="sw-label">允许飞行（allow-flight）</span><div class="sw-desc">默认开启：防止模组移动被误踢</div></span></label></div>`}
      </div>
      ${isProxy
        ? `<div class="eula-box">代理端不运行 Minecraft 本体，无需 EULA。其监听端口等配置在首次启动后于实例目录的配置文件中修改。</div>`
        : `<div class="eula-box">
        <label class="switch"><input type="checkbox" id="f-eula"><span class="sw"></span>
          <span class="sw-label">我已阅读并同意 <a href="https://aka.ms/MinecraftEULA" target="_blank">Minecraft 最终用户许可协议 (EULA)</a></span></label>
      </div>`}
      <div class="wizard-foot">
        <button class="btn" id="wback">← 上一步</button>
        <button class="btn primary" id="wcreate">⚒ 开始部署</button>
      </div>`);
    $("#wback").onclick = () => { wiz.step = wiz.core === "vanilla" ? 1 : 2; drawWizard(); };
    $("#f-mem").oninput = () => $("#mem-val").textContent = ($("#f-mem").value / 1024).toFixed(1) + " GB";
    $("#wcreate").onclick = async () => {
      if (!isProxy && !$("#f-eula").checked) { toast("需要勾选同意 Minecraft EULA 才能开服", true); return; }
      $("#wcreate").disabled = true;
      try {
        const r = await api("/api/instances", {
          method: "POST",
          body: {
            name: $("#f-name").value.trim(),
            core: wiz.core, mc: wiz.mc, build: wiz.build || "",
            xmxMb: +$("#f-mem").value,
            port: isProxy ? 25565 : +$("#f-port").value,
            eula: !isProxy,
            onlineMode: isProxy ? false : $("#f-online").checked,
            allowFlight: isProxy ? false : $("#f-flight").checked,
            motd: isProxy ? "" : $("#f-motd").value.trim(),
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
      <div class="task-steps">${t.steps.map(s =>
        `<div class="task-step ${s.status}"><span class="ts-ico">${icons[s.status]}</span>${esc(s.name)}</div>`).join("")}</div>
      ${t.label ? `<div class="progress-wrap"><div class="progress-bar"><div style="width:${pct}%"></div></div>
        <div class="progress-text">${esc(t.label)} · ${fmtBytes(t.done)}${t.total > 0 ? " / " + fmtBytes(t.total) : ""}</div></div>` : ""}
      ${t.error ? `<div class="err-box"><b>创建失败：</b>${esc(t.error)}<br><br>可返回重试（已下载的文件有缓存，重试很快）。</div>` : ""}
      <div class="task-log" id="task-log">${t.log.map(esc).join("\n")}</div>
      <div class="save-bar">
        ${t.ended && !t.error ? `<a class="btn primary" href="#/inst/${encodeURIComponent(t.result)}">✔ 完成，进入控制台</a>` : ""}
        ${t.ended && t.error ? `<a class="btn" href="#/create">← 返回重试</a>` : ""}
        ${!t.ended ? `<span class="warn-text">部署中，请勿关闭程序…</span>` : ""}
      </div>`;
    const lg = $("#task-log");
    lg.scrollTop = lg.scrollHeight;
    if (t.ended) { clearInterval(pollTimer); pollTimer = null; if (!t.error) toast("服务器创建成功 🎉"); }
  };
  await draw();
  pollTimer = setInterval(draw, 800);
}

/* ---------- 视图：实例详情 ---------- */
async function renderDetail(name, tab = "console") {
  // 标签切换时不经过 navigate()，需自行清理上一视图的连接与定时器
  if (consoleES) { consoleES.close(); consoleES = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
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
      <button class="btn primary" id="d-start" ${info.status !== "stopped" ? "disabled" : ""}>▶ 启动</button>
      <button class="btn" id="d-stop" ${info.status === "stopped" ? "disabled" : ""}>■ 停止</button>
      <button class="btn" id="d-dir">📁 打开目录</button>
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
  document.querySelectorAll(".tab").forEach(t => t.onclick = () => renderDetail(name, t.dataset.t));
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
        <input type="text" id="con-filter" placeholder="🔍 过滤日志（如 ERROR / 玩家名）" style="max-width:280px">
        <label class="switch"><input type="checkbox" id="con-scroll" checked><span class="sw"></span><span class="sw-label">自动滚动</span></label>
        <span class="grow"></span>
        <span class="hint">编码</span>
        <select id="con-enc" style="width:110px">
          ${["auto", "utf-8", "gbk"].map(e => `<option value="${e}" ${info.consoleEncoding === e ? "selected" : ""}>${e}</option>`).join("")}
        </select>
      </div>
      <div class="console" id="console"></div>
      <div class="console-input">
        <input type="text" id="cmd-in" placeholder="输入服务器命令（回车发送，↑↓ 翻历史），如 op 玩家名 / say 大家好">
        <button class="btn" id="cmd-send">发送</button>
      </div>`;
    const con = $("#console");
    const filterEl = $("#con-filter");
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
      if (hist[0] !== v) { hist.unshift(v); hist = hist.slice(0, 50); localStorage.setItem(histKey, JSON.stringify(hist)); }
      histIdx = -1;
      try { await api(`/api/instances/${encodeURIComponent(name)}/command`, { method: "POST", body: { cmd: v } }); }
      catch (e) { toast(e.message, true); }
    };
    $("#cmd-send").onclick = send;
    $("#cmd-in").onkeydown = e => {
      if (e.key === "Enter") send();
      else if (e.key === "ArrowUp") {
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
            `<span class="badge">${esc(p.name)}<a class="p-x" data-act="${removeAction}" data-p="${esc(p.name)}" title="移除">✕</a></span>`).join("") || `<span class="sub">空</span>`}</div>
        </div>`;
      body.innerHTML = `
        <div class="p-sec">
          <div class="p-sec-head"><b>在线玩家</b>（${pl.online.length}）<button class="btn sm" id="pl-refresh">🔄 刷新</button></div>
          <div class="badges">${pl.online.map(n => `<span class="badge core">${esc(n)}
            <a class="p-x" data-act="op" data-p="${esc(n)}" title="设为管理员">OP</a>
            <a class="p-x" data-act="kick" data-p="${esc(n)}" title="踢出">踢</a></span>`).join("") || `<span class="sub">暂无玩家在线</span>`}</div>
        </div>
        ${section("白名单", pl.whitelist, "whitelist-add", "whitelist-remove", "需在常用设置开启 white-list 才生效")}
        ${section("管理员 OP", pl.ops, "op", "deop", "")}
        ${section("封禁名单", pl.banned, "ban", "pardon", "")}`;
      $("#pl-refresh").onclick = draw;
      body.querySelectorAll("input[data-add]").forEach(inp => inp.onkeydown = e => {
        if (e.key === "Enter" && inp.value.trim()) { act(inp.dataset.add, inp.value.trim()); inp.value = ""; }
      });
      body.querySelectorAll(".p-x").forEach(a => a.onclick = () => act(a.dataset.act, a.dataset.p));
    };
    await draw();

  } else if (tab === "backups") {
    const draw = async () => {
      let list;
      try { list = await api(`/api/instances/${encodeURIComponent(name)}/backups`); }
      catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
      body.innerHTML = `
        <div class="row" style="margin-bottom:14px;flex-wrap:wrap">
          <input type="text" id="bk-label" placeholder="备份标签（可选，如：打龙前）" style="max-width:240px">
          <button class="btn primary" id="bk-create">📸 立即备份世界</button>
          <span class="hint">运行中自动热备（save-off → 压缩 → save-on）· 每实例保留最近 10 份 · 删除实例不影响已有备份</span>
        </div>
        <table class="raw">${list.map(b => `
          <tr><td>${esc(b.file)}</td><td>${b.sizeMb.toFixed(1)} MB · ${esc(b.time)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn sm" data-restore="${esc(b.file)}">⏪ 还原</button>
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
        <button class="btn" id="sc-add">＋ 添加</button>
      </div>
      <button class="btn primary" id="pol-save">💾 保存策略</button>`;
    const drawScheds = () => {
      $("#sched-list").innerHTML = scheds.map((s, i) => `
        <div class="java-row"><span class="badge core">${TYPE_NAMES[s.type] || s.type}</span>
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
        <input type="text" id="res-q" placeholder="搜索 Modrinth 模组/插件（英文名效果更好）" style="max-width:340px">
        <button class="btn" id="res-go">🔍 搜索</button>
        <span class="hint">已按当前核心与版本过滤兼容资源 · 数据来自 Modrinth（免费开放）</span>
      </div>
      <div id="res-list"><div class="sub">输入关键词搜索，或直接点搜索看热门资源</div></div>`;
    const search = async () => {
      $("#res-list").textContent = "搜索中…";
      try {
        const r = await api(`/api/instances/${encodeURIComponent(name)}/resources/search?q=${encodeURIComponent($("#res-q").value.trim())}`);
        $("#res-list").innerHTML = r.hits.map(h => `
          <div class="java-row" style="max-width:880px">
            ${h.icon_url ? `<img src="${esc(h.icon_url)}" width="34" height="34" style="border-radius:7px;flex:none" onerror="this.remove()">` : `<span style="font-size:22px">📦</span>`}
            <div style="flex:1;min-width:0"><b>${esc(h.title)}</b>
              <div class="jp" style="white-space:normal;max-height:32px;overflow:hidden">${esc(h.description)}</div></div>
            <span class="jv" style="color:var(--muted)">${h.downloads >= 1e6 ? (h.downloads / 1e6).toFixed(1) + "M" : Math.round(h.downloads / 1e3) + "k"} ↓</span>
            <button class="btn sm primary" data-rid="${esc(h.project_id)}" data-rt="${esc(h.title)}">⬇ 安装</button>
          </div>`).join("") || `<div class="sub">没有找到兼容 ${esc(info.mc)} 的资源，换个关键词试试</div>`;
        $("#res-list").querySelectorAll("[data-rid]").forEach(b => b.onclick = async () => {
          b.disabled = true;
          b.textContent = "安装中…";
          try {
            const res = await api(`/api/instances/${encodeURIComponent(name)}/resources/install`, { method: "POST", body: { projectId: b.dataset.rid } });
            toast(`已安装 ${b.dataset.rt} → ${res.file}（重启服务器生效）`);
            b.textContent = "✔ 已安装";
          } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "⬇ 安装"; }
        });
      } catch (e) { $("#res-list").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
    };
    $("#res-go").onclick = search;
    $("#res-q").onkeydown = e => { if (e.key === "Enter") search(); };

  } else if (tab === "common") {
    if (info.kind === "proxy") {
      body.innerHTML = `<div class="sub">代理端的监听端口、后端服务器列表等配置位于实例目录内其自带的配置文件（Velocity: velocity.toml；Waterfall: config.yml），首次启动后自动生成，用「📁 打开目录」编辑即可。</div>`;
      return;
    }
    let data;
    try { data = await api(`/api/instances/${encodeURIComponent(name)}/properties`); } catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    const cur = Object.fromEntries(data.pairs.map(p => [p.key, p.value]));
    body.innerHTML = `
      ${data.pairs.length === 0 ? `<div class="sub">⚠ 服务器还未首次启动，部分配置项将在首次启动后由服务端补全；现在设置的值会被保留。</div>` : ""}
      <div class="props-grid">${COMMON_PROPS.map(p => {
        const v = cur[p.k];
        if (p.k === "motd") {
          return `<div class="prop-item wide"><div style="flex:1">
            <div class="pl">${p.label}</div><div class="pd">${p.desc || ""}</div><div class="pd" style="font-family:var(--mono)">motd</div>
            <div class="motd-palette" id="motd-pal"></div>
            <input type="text" data-k="motd" id="motd-in" value="${esc(v ?? "")}" style="width:100%;margin-top:6px">
            <div class="motd-preview" id="motd-prev"></div>
          </div></div>`;
        }
        let ctrl;
        if (p.t === "bool") {
          ctrl = `<label class="switch"><input type="checkbox" data-k="${p.k}" ${v === "true" ? "checked" : ""}><span class="sw"></span></label>`;
        } else if (p.t === "sel") {
          ctrl = `<select data-k="${p.k}">${p.opts.map((o, i) =>
            `<option value="${o}" ${v === o ? "selected" : ""}>${p.optNames ? p.optNames[i] : o}</option>`).join("")}</select>`;
        } else if (p.t === "int") {
          ctrl = `<input type="number" data-k="${p.k}" value="${esc(v ?? "")}">`;
        } else {
          ctrl = `<input type="text" data-k="${p.k}" value="${esc(v ?? "")}" style="width:200px">`;
        }
        return `<div class="prop-item"><div><div class="pl">${p.label}</div>${p.desc ? `<div class="pd">${p.desc}</div>` : ""}<div class="pd" style="font-family:var(--mono)">${p.k}</div></div>${ctrl}</div>`;
      }).join("")}</div>
      <div class="save-bar">
        <button class="btn primary" id="props-save">💾 保存设置</button>
        ${data.running ? `<span class="warn-text">⚠ 服务器运行中，大部分修改需重启后生效</span>` : ""}
      </div>`;
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
    body.innerHTML = `<div class="sub">server.properties 全部键值（高级）。改完点保存。</div>
      <table class="raw">${data.pairs.map(p =>
        `<tr><td>${esc(p.key)}</td><td><input type="text" data-k="${esc(p.key)}" value="${esc(p.value)}"></td></tr>`).join("")}</table>
      <div class="save-bar"><button class="btn primary" id="raw-save">💾 保存全部</button>
      ${data.running ? `<span class="warn-text">⚠ 运行中，重启后生效</span>` : ""}</div>`;
    $("#raw-save").onclick = async () => {
      const pairs = [...body.querySelectorAll("input[data-k]")].map(el => ({ key: el.dataset.k, value: el.value }));
      try { await api(`/api/instances/${encodeURIComponent(name)}/properties`, { method: "PUT", body: { pairs } }); toast("已保存"); }
      catch (e) { toast(e.message, true); }
    };

  } else if (tab === "jvm") {
    const appInfo = await api("/api/app").catch(() => ({ ramMb: 8192 }));
    const maxMem = Math.max(2048, Math.min(16384, appInfo.ramMb - 2048));
    body.innerHTML = `
      <div style="max-width:560px">
        <label class="field"><span>最大内存 -Xmx：<b id="jm-val">${(info.xmxMb / 1024).toFixed(1)} GB</b></span>
          <input type="range" id="jm-mem" min="1024" max="${maxMem}" step="512" value="${Math.min(info.xmxMb, maxMem)}"></label>
        <div class="hint" style="margin-bottom:14px">Java ${info.javaMajor}（便携运行时，由 AutoMCHUB 独立管理，不影响系统）<br>实例目录：${esc(info.dir)}<br>手动启动：双击实例目录中的 run.bat（与此处配置同步）</div>
        <button class="btn primary" id="jm-save">💾 保存（重启后生效）</button>
      </div>`;
    $("#jm-mem").oninput = () => $("#jm-val").textContent = ($("#jm-mem").value / 1024).toFixed(1) + " GB";
    $("#jm-save").onclick = async () => {
      try {
        await api(`/api/instances/${encodeURIComponent(name)}/settings`, { method: "PUT", body: { xmxMb: +$("#jm-mem").value, xmsMb: 0 } });
        toast("已保存内存设置");
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
    <div id="tun-list">加载中…</div>
    <h3 style="margin:26px 0 8px">＋ 添加隧道</h3>
    <div class="hint" style="margin-bottom:12px;line-height:1.8">
      <b>OpenFrp</b>：到 <a href="https://console.openfrp.net" target="_blank" style="color:var(--accent)">OpenFrp 控制台</a> 创建 TCP 隧道（本地端口填 MC 端口）→「个人中心」复制用户密钥；<br>
      <b>樱花frp</b>：到 <a href="https://www.natfrp.com" target="_blank" style="color:var(--accent)">SakuraFrp</a> 创建隧道 → 复制访问密钥与隧道 ID（首次需手动放置其 frpc，按提示操作）；<br>
      <b>自定义</b>：填自己 frps 服务器的地址、端口与 token。
    </div>
    <div class="form-grid" style="max-width:880px">
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
    <button class="btn primary" id="tn-add">＋ 添加隧道</button>`;

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

  let logOpen = false;
  const drawList = async () => {
    if (logOpen) return; // 日志展开时暂停列表刷新，避免打断 SSE 显示
    let list;
    try { list = await api("/api/tunnels"); } catch (e) { $("#tun-list").innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    if (!list.length) { $("#tun-list").innerHTML = `<div class="empty" style="padding:34px 0">还没有隧道 —— 在下方添加一条，开服后一键映射到公网</div>`; return; }
    $("#tun-list").innerHTML = list.map(t => `
      <div class="java-row" style="max-width:980px">
        <span class="dot ${t.running ? "running" : ""}"></span>
        <b style="min-width:110px">${esc(t.name)}</b>
        <span class="badge core">${PROV_NAMES[t.provider] || t.provider}</span>
        ${t.boundInstance ? `<span class="badge">↔ ${esc(t.boundInstance)}${t.autoStart ? " · 跟随" : ""}</span>` : ""}
        ${t.publicAddr ? `<span class="jv" style="color:var(--accent)">${esc(t.publicAddr)}</span>
          <button class="btn sm" data-copy="${esc(t.publicAddr)}">📋 复制</button>` : `<span class="jp">尚未获取公网地址</span>`}
        <span class="grow"></span>
        ${t.running ? `<button class="btn sm" data-tstop="${t.id}">■ 停止</button>` : `<button class="btn sm primary" data-tstart="${t.id}">▶ 启动</button>`}
        <button class="btn sm" data-tlog="${t.id}">日志</button>
        <button class="btn sm danger" data-tdel="${t.id}">删除</button>
      </div>
      <div class="task-log" id="tlog-${t.id}" style="display:none;height:150px;max-width:980px;margin:-2px 0 8px"></div>`).join("");
    $("#tun-list").querySelectorAll("[data-copy]").forEach(b => b.onclick = () => {
      navigator.clipboard.writeText(b.dataset.copy).then(() => toast("已复制公网地址：" + b.dataset.copy));
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
async function renderSettings() {
  let info;
  try { info = await api("/api/app"); } catch (e) { Main().innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
  const src = info.config.source || "auto";
  const opts = [
    { v: "auto", t: "自动（推荐）", d: "国内镜像（BMCLAPI / 清华）优先，失败自动切换官方源" },
    { v: "mirror", t: "仅国内镜像", d: "只用 BMCLAPI 与清华镜像（Paper/Purpur 无镜像，仍走官方）" },
    { v: "official", t: "仅官方源", d: "只用 Mojang / Forge / Adoptium 等官方源（海外网络适用）" },
  ];
  let javas = { portable: [], scanned: [] };
  try { javas = await api("/api/javas"); } catch {}
  Main().innerHTML = eyebrow("OPTIONS") + `<h1>全局设置</h1><div class="sub">数据目录：${esc(info.base)}</div>
    <h3 style="margin-bottom:10px">下载源</h3>
    <div class="radio-cards" id="src-cards">${opts.map(o => `
      <div class="radio-card ${src === o.v ? "sel" : ""}" data-v="${o.v}">
        <div><div class="rt">${o.t}</div><div class="rd">${o.d}</div></div>
      </div>`).join("")}</div>
    <h3 style="margin:26px 0 6px">CurseForge API Key（选填）</h3>
    <div class="sub">导入 CurseForge 格式整合包时解析模组直链用，<a href="https://console.curseforge.com/" target="_blank" style="color:var(--accent)">免费申请</a>；Modrinth 格式整合包无需配置。</div>
    <div class="row" style="margin-bottom:8px">
      <input type="password" id="cf-key" value="${esc(info.config.cfApiKey || "")}" placeholder="粘贴 API Key" style="max-width:420px">
      <button class="btn" id="cf-save">保存</button>
    </div>
    <h3 style="margin:26px 0 6px">Java 管理</h3>
    <div class="sub">创建实例时优先复用本机已装 Java → 便携运行时 → 自动下载。</div>
    ${javas.portable.length ? `<div class="badges" style="margin-bottom:8px">${javas.portable.map(j => `<span class="badge core">便携 Java ${j.major}</span>`).join("")}</div>` : ""}
    <div id="java-list">${javas.scanned.length ? javas.scanned.map(j => `
      <div class="java-row"><span class="badge core">Java ${j.major}</span><span class="jv">${esc(j.version)}</span><span class="jp">${esc(j.path)}</span></div>`).join("")
      : `<div class="sub">尚未发现本机安装的 Java，点击下方扫描</div>`}</div>
    <div class="row" style="margin-top:10px;flex-wrap:wrap">
      <button class="btn" id="java-scan">🔄 重新扫描本机 Java</button>
      <input type="text" id="java-path" placeholder="手动添加：粘贴 java.exe 或 JDK 目录路径" style="max-width:420px">
      <button class="btn" id="java-add">添加</button>
    </div>
    <h3 style="margin:26px 0 6px">远程访问（手机管理）</h3>
    <div class="sub">开启后本机 IP 可从局域网访问管理界面（密码保护，改动需重启程序生效）。</div>
    <div class="row" style="margin-bottom:8px;flex-wrap:wrap">
      <label class="switch"><input type="checkbox" id="lan-on" ${info.config.listenLan ? "checked" : ""}><span class="sw"></span><span class="sw-label">允许局域网访问</span></label>
      <input type="password" id="lan-pw" placeholder="${info.lanSet ? "已设置密码（留空则不修改）" : "设置访问密码（必填）"}" style="max-width:260px">
      <button class="btn" id="lan-save">保存</button>
    </div>
    <div class="hint">${info.config.listenLan ? `手机访问：${(info.ips || []).map(ip => `http://${ip}:27333`).join(" 或 ")}<br>` : ""}若无法访问，请以管理员运行一次放行防火墙：<code>netsh advfirewall firewall add rule name="AutoMCHUB" dir=in action=allow protocol=TCP localport=27333</code></div>
    <h3 style="margin:26px 0 6px">Webhook 事件推送（选填）</h3>
    <div class="sub">服务器启停/崩溃、玩家进出、备份完成、隧道上线等事件将 POST 到该地址（JSON），可接入群机器人等。</div>
    <div class="row" style="margin-bottom:8px">
      <input type="text" id="wh-url" value="${esc(info.config.webhookUrl || "")}" placeholder="https://example.com/hook（留空关闭）" style="max-width:420px">
      <button class="btn" id="wh-save">保存</button>
    </div>
    <h3 style="margin:26px 0 6px">自动更新</h3>
    <div class="row" style="margin-bottom:8px;flex-wrap:wrap">
      <input type="text" id="up-repo" value="${esc(info.config.updateRepo || "")}" placeholder="GitHub 仓库，如 yourname/AutoMCHUB" style="max-width:300px">
      <button class="btn" id="up-save">保存</button>
      <button class="btn" id="up-check">🔎 检查更新</button>
      <span id="up-result" class="hint"></span>
    </div>
    <div class="hint" style="margin-top:20px">基于 OpenFrp OPENAPI 提供穿透接入 · 开源软件，遵循仓库 LICENSE</div>
    <div style="margin-top:26px"><button class="btn danger" id="quit-app">⏻ 退出 AutoMCHUB（自动停止所有服务器）</button></div>`;
  $("#quit-app").onclick = async () => {
    const r = await confirmModal({ title: "退出 AutoMCHUB？", body: "将优雅停止所有运行中的服务器（保存世界）后退出程序。", okText: "退出", danger: true });
    if (!r) return;
    try {
      await api("/api/shutdown", { method: "POST" });
      document.body.innerHTML = `<div style="padding:80px;text-align:center;color:#8aa392">AutoMCHUB 正在停止服务器并退出，可以关闭此页面了。</div>`;
    } catch (e) { toast(e.message, true); }
  };
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
  $("#lan-save").onclick = async () => {
    const body = { listenLan: $("#lan-on").checked };
    if ($("#lan-pw").value) body.lanPassword = $("#lan-pw").value;
    try { await api("/api/config", { method: "PUT", body }); toast("远程访问设置已保存，重启 AutoMCHUB 后生效"); }
    catch (e) { toast(e.message, true); }
  };
  $("#wh-save").onclick = async () => {
    try { await api("/api/config", { method: "PUT", body: { webhookUrl: $("#wh-url").value.trim() } }); toast("Webhook 已保存，即时生效"); }
    catch (e) { toast(e.message, true); }
  };
  $("#up-save").onclick = async () => {
    try { await api("/api/config", { method: "PUT", body: { updateRepo: $("#up-repo").value.trim() } }); toast("更新仓库已保存"); }
    catch (e) { toast(e.message, true); }
  };
  $("#up-check").onclick = async () => {
    $("#up-result").textContent = "检查中…";
    try {
      const r = await api("/api/update/check", { method: "POST" });
      if (r.hasUpdate) {
        $("#up-result").innerHTML = `发现新版本 <b style="color:var(--accent)">${esc(r.latest.tag)}</b>（当前 v${esc(r.current)}）`;
        const btn = document.createElement("button");
        btn.className = "btn sm primary";
        btn.textContent = "⬆ 立即更新并重启";
        btn.onclick = async () => {
          btn.disabled = true;
          try { await api("/api/update/apply", { method: "POST" }); document.body.innerHTML = `<div style="padding:80px;text-align:center;color:#8aa392">正在更新，程序将自动重启…</div>`; }
          catch (e) { toast(e.message, true); btn.disabled = false; }
        };
        $("#up-result").appendChild(btn);
      } else {
        $("#up-result").textContent = `已是最新（v${r.current}）`;
      }
    } catch (e) { $("#up-result").textContent = e.message; }
  };
  $("#java-scan").onclick = async () => {
    $("#java-scan").disabled = true;
    $("#java-scan").textContent = "扫描中…（约数秒）";
    try { const list = await api("/api/javas/scan", { method: "POST" }); toast(`扫描完成，发现 ${list.length} 个 Java`); renderSettings(); }
    catch (e) { toast(e.message, true); $("#java-scan").disabled = false; $("#java-scan").textContent = "🔄 重新扫描本机 Java"; }
  };
  $("#java-add").onclick = async () => {
    const p = $("#java-path").value.trim();
    if (!p) return;
    try { const j = await api("/api/javas/add", { method: "POST", body: { path: p } }); toast(`已添加 Java ${j.major}（${j.version}）`); renderSettings(); }
    catch (e) { toast(e.message, true); }
  };
}

/* ---------- 启动 ---------- */
(async function boot() {
  try {
    const info = await api("/api/app");
    $("#app-ver").textContent = info.version;
    $("#hud-status").textContent = `内存 ${(info.ramMb / 1024).toFixed(0)} GB · 下载源 ${{ auto: "自动", mirror: "镜像", official: "官方" }[info.config.source] || "自动"}`;
    const cores = await api("/api/cores").catch(() => []);
    cores.forEach(c => CORES[c.id] = c);
  } catch (e) {
    document.body.innerHTML = `<div style="padding:60px;text-align:center;color:#e5644e">无法连接 AutoMCHUB 后端：${esc(e.message)}<br><br>请通过程序窗口打开本页面。</div>`;
    return;
  }
  navigate();
})();
