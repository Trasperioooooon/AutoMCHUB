// MineDeck 前端仿真后端：静态托管 internal/web/ui，并以内存状态仿真 /api/*，不需要 Windows、Java 或 Go 后端。
// 单独运行：node server.js [端口=27390] [前端目录=../../internal/web/ui]，然后用浏览器打开打印出的地址。
// tests.js / shoot.js 通过 start() 各自启动一份全新的实例（随机空闲端口），互不干扰。
// 数据全是假的：只用来看界面、跑交互回归，不代表后端的真实行为。
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { URL } = require("url");

const UI_DEFAULT = path.resolve(__dirname, "..", "..", "internal", "web", "ui");
const PORT_DEFAULT = 27390; // 避开 MineDeck 自己的默认端口 27333，本机同时开着程序也不冲突

const ok = (res, data) => { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ ok: true, data })); };
const err = (res, code, msg) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ ok: false, error: msg })); };
const readBody = req => new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

// props-catalog.js 在 Node 中求值，取默认值生成一份「已首启」的 server.properties
function catalog(ui) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ui, "props-catalog.js"), "utf8"), ctx);
  return ctx.window.PROPS_CATALOG || [];
}

const CORES = [
  ["vanilla", "Vanilla 原版", "纯净", "Mojang 官方服务端，原汁原味", "game"],
  ["paper", "Paper", "插件", "最流行的高性能插件服务端", "game"],
  ["purpur", "Purpur", "插件+", "Paper 分支，更多可调项与特性", "game"],
  ["leaves", "Leaves", "插件·仿原版", "Paper 分支，修复原版特性（刷铁轨等），国人维护", "game"],
  ["folia", "Folia", "插件·多线程", "Paper 官方多线程分支，适合大量玩家分散场景", "game"],
  ["fabric", "Fabric", "模组·轻量", "轻量模组加载器，启动快、更新快", "game"],
  ["neoforge", "NeoForge", "模组·主流", "1.20.2+ 模组生态主流（Forge 的社区继任者）", "game"],
  ["forge", "Forge", "模组·经典", "经典模组加载器，适合 1.20.1 及更早的整合包", "game"],
  ["mohist", "Mohist", "混合·Forge+插件", "Forge 模组与 Bukkit 插件共存，整合包服首选之一", "hybrid"],
  ["banner", "Banner", "混合·Fabric+插件", "Mohist 团队出品，Fabric 模组与 Bukkit 插件共存", "hybrid"],
  ["velocity", "Velocity", "代理·主流", "PaperMC 出品的现代群组代理端，搭配多后端服使用", "proxy"],
  ["waterfall", "Waterfall", "代理·经典", "BungeeCord 分支（已停更但仍可用），老群组服兼容", "proxy"],
].map(([id, name, tag, desc, kind]) => ({ id, name, tag, desc, kind }));

// 每次 start() 都从这份初始数据开始：4 台服务器（运行中 / 已停止 / 启动中 / 代理端）、2 条隧道、已完成首启
function newState(ui) {
  const state = {
    config: { source: "auto", onboarded: true, tosAccepted: true, backupKeep: 10, listenLan: false, webhookUrl: "", updateRepo: "Trasperioooooon/MineDeck", checkUpdateOnStart: true, minimizeToTray: true, cfApiKey: "" },
    autoStart: false,
    instances: [
      { name: "生存服 · 朋友", core: "paper", kind: "game", mc: "1.21.4", build: "232", javaMajor: 21, xmxMb: 4096, xmsMb: 0, port: 25565, status: "running", motd: "§a生存服 §7· §e一起来玩！", dir: "D:\\MineDeck\\servers\\server-20261020-2130", createdAt: "2026-10-20T21:30:00+08:00", consoleEncoding: "auto", onlineCount: 3, uptimeSec: 7980, maxPlayers: 20, extraJvm: [] },
      { name: "机械动力整合包", core: "forge", kind: "game", mc: "1.20.1", build: "47.3.0", javaMajor: 17, xmxMb: 8192, xmsMb: 0, port: 25566, status: "stopped", motd: "§6Create 机械动力 §f整合包", dir: "D:\\MineDeck\\servers\\create-pack", createdAt: "2026-10-18T10:00:00+08:00", consoleEncoding: "gbk", onlineCount: 0, uptimeSec: 0, maxPlayers: 20, extraJvm: ["-XX:+UseG1GC"] },
      { name: "原版快照测试", core: "vanilla", kind: "game", mc: "26.2", build: "", javaMajor: 25, xmxMb: 2048, xmsMb: 0, port: 25567, status: "starting", motd: "A Minecraft Server", dir: "D:\\MineDeck\\servers\\vanilla-test", createdAt: "2026-10-25T09:00:00+08:00", consoleEncoding: "auto", onlineCount: 0, uptimeSec: 12, maxPlayers: 20, extraJvm: [] },
      { name: "群组代理", core: "velocity", kind: "proxy", mc: "3.4.0", build: "450", javaMajor: 21, xmxMb: 1024, xmsMb: 0, port: 25577, status: "stopped", motd: "", dir: "D:\\MineDeck\\servers\\velocity", createdAt: "2026-10-10T09:00:00+08:00", consoleEncoding: "auto", onlineCount: 0, uptimeSec: 0, maxPlayers: 0, extraJvm: [] },
    ],
    tunnels: [
      { id: "t1", name: "朋友联机", provider: "openfrp", running: true, boundInstance: "生存服 · 朋友", autoStart: true, publicAddr: "cn-sz-bgp-1.openfrp.top:23456", lastError: "" },
      { id: "t2", name: "自建备用线", provider: "custom", running: false, boundInstance: "", autoStart: false, publicAddr: "", lastError: "login to the server failed: authorization failed. With auth = token, the token is incorrect" },
    ],
    props: null,
    empty: false,
    taskStage: 2,
  };
  state.props = catalog(ui).map(p => ({ key: p.key, value: p.key === "motd" ? "§a生存服 §7· §e一起来玩！" : String(p.def ?? "") }));
  return state;
}

const VERSIONS = ["26.2", "26.1", "1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.2", "1.20.1", "1.19.4", "1.19.2", "1.18.2", "1.17.1", "1.16.5", "1.12.2"];
const SNAPS = ["26.3-snapshot-2", "26.3-snapshot-1", "26.2-rc1"];

function sse(res, lines, keep = true) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  for (const l of lines) res.write(`data: ${JSON.stringify(l)}\n\n`);
  if (!keep) res.end();
}

const CONSOLE = [
  "[21:30:02 INFO]: Starting minecraft server version 1.21.4",
  "[21:30:02 INFO]: Loading properties",
  "[21:30:03 INFO]: This server is running Paper version 1.21.4-232-main@a1b2c3d (2026-10-01T12:00:00Z)",
  "[21:30:04 WARN]: Using offline mode! Players will not be authenticated.",
  "[21:30:05 INFO]: Preparing level \"world\"",
  "[21:30:09 INFO]: Done (6.812s)! For help, type \"help\"",
  "[21:42:17 INFO]: Steve joined the game",
  "[21:43:01 INFO]: Alex joined the game",
  "[21:44:30 INFO]: <Steve> 大家好！",
  "> say 欢迎来到生存服",
  "[21:44:35 INFO]: [Server] 欢迎来到生存服",
  "[21:50:12 ERROR]: Could not pass event PlayerInteractEvent to ExamplePlugin v1.0",
  "java.lang.NullPointerException: Cannot invoke \"String.length()\" because \"s\" is null",
  "\tat com.example.Plugin.onInteract(Plugin.java:42)",
  "[22:01:40 INFO]: Notch_CN joined the game",
];

function handler(state, ui, portOf) {
  return async (req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    const m = req.method;
    // ---- 仿真控制端点：测试与截图脚本切换场景用，POST 的 JSON 可含 ----
    //   empty: true 时服务器列表为空；onboarded: false 时弹首启引导；listenLan: 远程访问开关（开启后设置页显示二维码）
    //   taskStage: 部署任务进行到第几步（0–4，4 = 完成），"error" = 第 2 步失败
    //   legacy: { name, extraJvm, forceFlags } 把某台服务器设成「老版本」，保存 JVM 参数时补回 forceFlags
    //   status: { 名称: running | starting | stopping | stopped } 直接改某台服务器的运行状态（看状态切换的动效用）
    if (p === "/__mock/state" && m === "POST") {
      const b = await readBody(req);
      if ("empty" in b) state.empty = !!b.empty;
      if ("onboarded" in b) { state.config.onboarded = !!b.onboarded; state.config.tosAccepted = !!b.onboarded; }
      if ("taskStage" in b) state.taskStage = b.taskStage;
      if ("listenLan" in b) state.config.listenLan = !!b.listenLan;
      // 模拟老版本实例：保存 JVM 参数时后端强制补回 log4shell 缓解参数（同 inst.UpdateSettings）
      if (b.legacy) { const i = state.instances.find(x => x.name === b.legacy.name); if (i) { i.extraJvm = b.legacy.extraJvm; i.forceFlags = b.legacy.forceFlags; } }
      if (b.status) for (const [n, st] of Object.entries(b.status)) { const i = state.instances.find(x => x.name === n); if (i) { i.status = st; i.uptimeSec = st === "stopped" ? 0 : st === "starting" ? 9 : i.uptimeSec; i.onlineCount = st === "running" ? i.onlineCount : 0; } }
      return ok(res, state);
    }
    // ---- 静态 ----
    if (!p.startsWith("/api/") && !p.startsWith("/bg/")) {
      const f = p === "/" ? "index.html" : p.slice(1);
      const fp = path.resolve(ui, path.normalize(f));
      if (!fp.startsWith(ui + path.sep) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end("not found"); }
      const type = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain", ".woff2": "font/woff2" }[path.extname(fp)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type + (/^(text|application)\//.test(type) ? "; charset=utf-8" : ""), "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(fp));
    }
    const insts = () => state.empty ? [] : state.instances;
    const seg = p.split("/").map(decodeURIComponent); // ["", "api", "instances", name, sub...]
    try {
      if (p === "/api/app") return ok(res, { version: "2.6.1", base: "D:\\MineDeck", ramMb: 16384, availRamMb: 9216, port: portOf(), serversRoot: "D:\\MineDeck\\servers", backupsRoot: "D:\\MineDeck\\backups", config: state.config, lanSet: false, autoStart: state.autoStart, ips: ["172.22.48.1", "192.168.1.23", "10.0.0.5"] });
      if (p === "/api/bg") return ok(res, { images: [] });
      if (p === "/api/cores") return ok(res, CORES);
      if (p === "/api/config" && m === "PUT") { const b = await readBody(req); if ("autoStart" in b) state.autoStart = !!b.autoStart; Object.assign(state.config, b); delete state.config.autoStart; return ok(res, state.config); }
      if (p === "/api/mcversions") {
        const snaps = u.searchParams.get("snapshots") === "1";
        const list = [...(snaps ? SNAPS.map(id => ({ id, type: "snapshot", latest: false })) : []), ...VERSIONS.map((id, i) => ({ id, type: "release", latest: i === 0, ...(u.searchParams.get("core") === "vanilla" ? { releaseTime: new Date(Date.UTC(2026, 9, 1) - i * 47 * 864e5).toISOString().replace(".000Z", "+00:00") } : {}) }))];
        return ok(res, list);
      }
      if (p === "/api/builds") return ok(res, [232, 231, 230, 229, 228, 225, 220].map((n, i) => ({ id: String(n), label: `2026-10-${String(20 - i * 2).padStart(2, "0")}`, recommended: i === 0 })));
      if (p === "/api/javas") return ok(res, { portable: [{ major: 21 }, { major: 17 }], scanned: [{ major: 21, version: "21.0.4", path: "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.4.7-hotspot\\bin\\java.exe" }, { major: 8, version: "1.8.0_421", path: "C:\\Program Files\\Java\\jre1.8.0_421\\bin\\java.exe" }] });
      if (p === "/api/javas/scan") return ok(res, [1, 2]);
      if (p === "/api/pickdir") return ok(res, { path: "E:\\MCServers" });
      if (p === "/api/update/check") return ok(res, { hasUpdate: false, current: "2.6.1" });
      if (p.startsWith("/api/tasks/")) {
        const st = state.taskStage;
        const names = ["下载 Java 21 运行时", "下载 Paper 1.21.4 核心", "同意 EULA 并生成配置", "生成启动脚本"];
        const steps = names.map((name, i) => ({ name, status: st === "error" ? (i < 1 ? "done" : i === 1 ? "error" : "pending") : i < st ? "done" : i === st ? "running" : "pending" }));
        const ended = st === "error" || st >= names.length;
        return ok(res, { steps, label: ended ? "" : "下载 paper-1.21.4-232.jar", done: 31457280, total: 52428800, error: st === "error" ? "下载 paper-1.21.4-232.jar 失败：所有下载源均不可用（BMCLAPI 超时、官方源 403）" : "", warnings: [], log: ["[1/4] 检测到本机 Java 21，复用", "[2/4] 正在从 api.papermc.io 下载核心…", "  已下载 30.0 MB / 50.0 MB"], ended, result: "生存服 · 朋友" });
      }
      if (p === "/api/instances" && m === "GET") return ok(res, insts());
      if (p === "/api/instances" && m === "POST") return ok(res, { taskId: "task-1" });
      if (p === "/api/tunnels" && m === "GET") return ok(res, state.tunnels);
      if (p.startsWith("/api/tunnels/") && p.endsWith("/console")) return sse(res, ["[frpc] login to server success", "[frpc] proxy added: [mc]", "[frpc] start proxy success"]);
      if (p.startsWith("/api/tunnels")) return ok(res, {});
      if (seg[2] === "instances" && seg[3]) {
        const name = seg[3], sub = seg[4] || "";
        const i = state.instances.find(x => x.name === name);
        if (!i) return err(res, 404, "实例不存在");
        if (sub === "settings" && m === "PUT") {
          const b = await readBody(req);
          if (Array.isArray(b.extraJvm)) i.extraJvm = [...b.extraJvm, ...(i.forceFlags || []).filter(f => !b.extraJvm.includes(f))]; // 已有的原位保留，缺的追加
          if (b.xmxMb > 0) i.xmxMb = b.xmxMb;
          return ok(res, {});
        }
        if (sub === "console") return sse(res, i.status === "stopped" ? ["[MineDeck] 服务器未运行，点击「启动」开服"] : CONSOLE);
        if (sub === "players" && m === "GET") return ok(res, { online: i.status === "running" ? ["Steve", "Alex", "Notch_CN"] : [], whitelist: [{ name: "Steve" }, { name: "Alex" }], ops: [{ name: "Steve" }], banned: [{ name: "Griefer233" }] });
        if (sub === "backups" && m === "GET") return ok(res, [
          { file: "2026-10-26_04-00_auto.zip", sizeMb: 412.3, time: "2026-10-26 04:00" },
          { file: "2026-10-25_22-10_打龙前.zip", sizeMb: 405.8, time: "2026-10-25 22:10" },
          { file: "2026-10-25_04-00_auto.zip", sizeMb: 398.1, time: "2026-10-25 04:00" },
        ]);
        if (sub === "policies" && m === "GET") return ok(res, { crashRestart: true, schedules: [{ type: "restart", at: "04:00", args: "" }, { type: "command", at: "20:00", args: "say 今晚 8 点打龙集合！" }] });
        if (sub === "properties" && m === "GET") return ok(res, { pairs: state.props, running: i.status === "running" });
        if (sub === "resources" && seg[5] === "search") return ok(res, { hits: [
          { project_id: "a1", title: "EssentialsX", description: "The essential plugin suite for Minecraft servers.", icon_url: "", downloads: 12500000 },
          { project_id: "a2", title: "LuckPerms", description: "A permissions plugin for Minecraft servers.", icon_url: "", downloads: 8300000 },
          { project_id: "a3", title: "Chunky", description: "Pre-generates chunks, quickly and efficiently.", icon_url: "", downloads: 2100000 },
        ] });
        return ok(res, { file: "x.jar" });
      }
      return ok(res, {});
    } catch (e) { return err(res, 500, String(e)); }
  };
}

// 启动一份全新的仿真后端。port=0 表示随机空闲端口。返回 { port, url, close() }。
function start({ port = 0, ui = UI_DEFAULT } = {}) {
  ui = path.resolve(ui);
  const state = newState(ui);
  const server = http.createServer(handler(state, ui, () => server.address().port));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const p = server.address().port;
      resolve({ port: p, url: `http://127.0.0.1:${p}/`, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) });
    });
  });
}

module.exports = { start };

if (require.main === module) {
  const port = +(process.argv[2] || PORT_DEFAULT);
  start({ port, ui: process.argv[3] || UI_DEFAULT })
    .then(m => console.log(`仿真后端已启动：${m.url}（Ctrl+C 退出）`))
    .catch(e => { console.error(e.code === "EADDRINUSE" ? `端口 ${port} 已被占用，换一个：node server.js <端口>` : e); process.exit(1); });
}
