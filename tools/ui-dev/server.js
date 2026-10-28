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
    config: { source: "auto", onboarded: true, tosAccepted: true, backupKeep: 10, listenLan: false, webhookUrl: "", updateRepo: "Trasperioooooon/MineDeck", checkUpdateOnStart: true, minimizeToTray: true, chromeColor: "" },
    autoStart: false,
    cfKey: "", // 同 web：CurseForge API Key 只写不读，不放进 config，/api/app 只给 cfKeySet
    cfKeyBroken: false,
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
    ai: newAIState(),
    music: newMusicState(), // 第五阶段
  };
  state.props = catalog(ui).map(p => ({ key: p.key, value: p.key === "motd" ? "§a生存服 §7· §e一起来玩！" : String(p.def ?? "") }));
  return state;
}

// 操作记录（同 GET /api/ops/log：新的在前，Key、密码、凭据写成 ***）
const OPLOG = [
  { t: "2026-10-26T04:00:12+08:00", op: "instance.backup.create", src: "schedule", actor: "定时任务", inst: "生存服 · 朋友", args: { at: "04:00", label: "定时" }, ok: true, ms: 8120 },
  { t: "2026-10-25T22:10:03+08:00", op: "instance.whitelist.add", src: "lan", actor: "192.168.1.23", inst: "生存服 · 朋友", args: { player: "Alex" }, ok: true, ms: 4 },
  { t: "2026-10-25T21:58:40+08:00", op: "instance.props.set", src: "ui", actor: "本机", inst: "生存服 · 朋友", args: { pairs: [{ key: "max-players", value: "10" }] }, ok: true, ms: 3 },
  { t: "2026-10-25T21:30:00+08:00", op: "instance.start", src: "schedule", actor: "崩溃自动重启", inst: "机械动力整合包", args: { attempt: 1 }, ok: false, err: "Java 运行时缺失", ms: 1 },
  { t: "2026-10-25T20:02:11+08:00", op: "app.config.set", src: "ui", actor: "本机", args: { cfApiKey: "***" }, ok: true, ms: 2 },
];

// ---- AI 接入层（同 GET/PUT /api/ai/*）----
// 预设照抄后端 ai.Presets()（只是填写模板，不预选、不推荐）。改了后端的预设要同步这里。
const AI_PRESETS = [
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "protocol": "openai",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "domestic": true,
    "note": "官方文档写明 deepseek-chat、deepseek-reasoner 已于 2026-07-24 下线，换成 deepseek-v4-flash、deepseek-v4-pro（摘要）。思考模式下工具循环可能要把 reasoning_content 原样传回，这里默认传回（摘要，需实测）。",
    "verified": "摘要"
  },
  {
    "id": "qwen",
    "name": "通义千问（阿里云百炼）",
    "protocol": "openai",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "altUrls": [
      {
        "label": "新加坡",
        "url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
      }
    ],
    "model": "qwen-plus",
    "domestic": true,
    "note": "默认是北京地域；Key 只能配对应地域的地址（摘要）。官方建议改用工作空间专属域名，可以在地址里改。",
    "verified": "摘要"
  },
  {
    "id": "kimi",
    "name": "Kimi（月之暗面）",
    "protocol": "openai",
    "baseUrl": "https://api.moonshot.cn/v1",
    "altUrls": [
      {
        "label": "国际站",
        "url": "https://api.moonshot.ai/v1"
      }
    ],
    "domestic": true,
    "note": "国内站和国际站的 Key 不通用（摘要：第三方文档，官方页面未能抓取）。流式用量可能在 choices[0].usage，两处都读。",
    "verified": "摘要"
  },
  {
    "id": "zhipu",
    "name": "智谱",
    "protocol": "openai",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4/",
    "domestic": true,
    "note": "地址末尾的斜杠原样保留。官方说兼容 OpenAI，但「部分场景仍有差异」（摘要）。",
    "verified": "摘要"
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "protocol": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "note": "国内一般要代理才能连上（推断）。MineDeck 走环境变量 HTTPS_PROXY 里的代理。",
    "verified": "摘要"
  },
  {
    "id": "ollama",
    "name": "Ollama（本机）",
    "protocol": "openai",
    "baseUrl": "http://localhost:11434/v1/",
    "noKey": true,
    "local": true,
    "note": "不用 Key，数据不出本机；模型从本机已下载的里面选。不估算费用。",
    "verified": "核实"
  },
  {
    "id": "claude",
    "name": "Claude",
    "protocol": "anthropic",
    "baseUrl": "https://api.anthropic.com",
    "model": "claude-opus-5-5",
    "note": "支持地区不含中国大陆（摘要），国内一般也连不上（推断）。默认开启服务端回退（拒答时自动换模型，beta）。",
    "verified": "核实"
  },
  {
    "id": "custom",
    "name": "自定义",
    "protocol": "openai",
    "baseUrl": "",
    "note": "任意 OpenAI 兼容的地址，或者走 Claude 协议的中转。注意：中转方能看到全部对话和 Key。",
    "verified": "—"
  }
];
// 几个模型的公开价格（每百万 token，美元；只为显示「当前模型的单价」）
const AI_MODEL_PRICES = {
  "deepseek-v4-flash": { input: 0.3, output: 1.2, cacheRead: 0.006 },
  "qwen-plus": { input: 0.4, output: 1.2, tiered: true },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
const AI_MODELS = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"], qwen: ["qwen-flash", "qwen-plus", "qwen3-max"], kimi: ["kimi-k2.6", "kimi-k3"],
  zhipu: ["glm-4.5", "glm-5.3"], openai: ["gpt-5", "gpt-5.5"], ollama: ["qwen3:8b", "llama3.1"], custom: ["my-model"],
  claude: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5", maxOutput: 128000 }, { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", maxOutput: 128000 }, { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", maxOutput: 128000 }],
};
const AI_LOCAL_MSG = "AI 设置仅支持在本机修改（含 Key 和接口地址）";
const AI_DISABLED = "AI 未启用：先在「设置 → AI」里选择服务商，填好 Key 和模型";
function newAIState() {
  return {
    preset: "", protocol: "", baseUrl: "", model: "", maxOutput: 0, effort: "", key: "", keyBroken: false,
    quota: {}, prices: [], priceUpdated: "", local: true, testFail: false,
    today: { assistant: { requests: 12, tokens: 123456, estimated: 1, cost: { USD: 0.0312 } }, gamechat: { requests: 3, tokens: 5600, cost: { USD: 0.002 } } },
    month: { assistant: { requests: 80, tokens: 1234567, estimated: 2, unpriced: 1, cost: { USD: 0.42, CNY: 1.3 } }, gamechat: { requests: 20, tokens: 45000, cost: { USD: 0.01 } } },
  };
}
function aiMissing(a) {
  const p = AI_PRESETS.find(x => x.id === a.preset);
  if (!p) return "选择服务商";
  if (!a.baseUrl) return "填写接口地址";
  if (!p.noKey && p.id !== "custom") { if (a.keyBroken) return "重新填写 Key（原来的 Key 解不开，可能换了电脑或 Windows 用户）"; if (!a.key) return "填写 Key"; }
  if (!a.model) return "选择模型";
  return "";
}
function aiView(a) {
  const p = AI_PRESETS.find(x => x.id === a.preset);
  const missing = aiMissing(a);
  const official = a.protocol === "anthropic" && /^https:\/\/api\.anthropic\.com\/?(v1\/?)?$/.test(a.baseUrl);
  let modelPrice;
  if (p && a.model) {
    const cp = a.prices.find(c => c.model === a.model);
    const pub = AI_MODEL_PRICES[a.model];
    if (p.local) modelPrice = { found: true, local: true };
    else if (cp) modelPrice = { found: true, source: "custom", currency: cp.currency, input: cp.input, output: cp.output, cacheRead: cp.cacheRead };
    else if (pub && a.priceUpdated) modelPrice = { found: true, source: "litellm", currency: "USD", ...pub, ...(p.domestic ? { note: "按国际站美元价估算，国内站按人民币计费，会有出入" } : {}) };
    else modelPrice = { found: false };
  }
  const priceNeeded = !missing && !(p && p.local);
  return {
    presets: AI_PRESETS, provider: { preset: a.preset, protocol: a.protocol, baseUrl: a.baseUrl, model: a.model, maxOutput: a.maxOutput, effort: a.effort, eager: official, fallback: official },
    keySet: !!a.key && !a.keyBroken, keyBroken: !!a.key && a.keyBroken, enabled: !missing, missing, quota: a.quota, today: a.today, month: a.month,
    priceNeeded, prices: { source: "LiteLLM 公开价格", updated: priceNeeded ? a.priceUpdated : a.priceUpdated, count: a.priceUpdated ? 3203 : 0 },
    modelPrice, customPrices: a.prices, local: a.local,
  };
}
// 同 ai.Service.SetProvider：只改传了的字段；改了服务商、协议或地址，旧 Key 清掉（同一次请求给了新 Key 就用新的）
function aiSetProvider(a, b) {
  if ("preset" in b && b.preset === "") { Object.assign(a, { preset: "", protocol: "", baseUrl: "", model: "", maxOutput: 0, effort: "", key: "", keyBroken: false }); return null; }
  const id = "preset" in b ? b.preset : a.preset;
  const p = AI_PRESETS.find(x => x.id === id);
  if (!p) return id ? `未知的服务商："${id}"` : "先选择服务商";
  const changed = id !== a.preset;
  const n = { ...a, preset: id };
  n.protocol = p.id !== "custom" ? p.protocol : (b.protocol || (changed ? "openai" : a.protocol) || "openai");
  if ("baseUrl" in b) n.baseUrl = String(b.baseUrl).trim(); else if (changed) n.baseUrl = p.baseUrl;
  if (!n.baseUrl && p.id !== "custom") n.baseUrl = p.baseUrl;
  if (!/^https?:\/\/[^/?#\s]+/.test(n.baseUrl) || /[?#]/.test(n.baseUrl)) return "接口地址要以 http:// 或 https:// 开头";
  if ("model" in b) n.model = String(b.model).trim(); else if (changed) n.model = p.model || "";
  if ("effort" in b) n.effort = b.effort;
  if (n.protocol !== "anthropic") n.effort = "";
  let key = "key" in b ? String(b.key).trim() : null;
  if (key !== null && /\s/.test(key)) return "Key 的格式不对（不能有空格，最长 4096 个字符）";
  if (changed || n.protocol !== a.protocol || n.baseUrl !== a.baseUrl) { if (key === null) key = ""; }
  if (key !== null) { n.key = key; n.keyBroken = false; }
  Object.assign(a, n);
  return null;
}
async function aiHandler(state, req, res, p, m) {
  const a = state.ai;
  const local = a.local;
  if (p === "/api/ai/settings" && m === "GET") return ok(res, aiView(a));
  if (!local) return err(res, 403, AI_LOCAL_MSG); // 修改类的都仅本机
  const b = await readBody(req);
  if (p === "/api/ai/provider" && m === "PUT") { const e = aiSetProvider(a, b); return e ? err(res, 400, e) : ok(res, aiView(a)); }
  if (p === "/api/ai/models" && m === "POST") {
    const pr = AI_PRESETS.find(x => x.id === b.preset);
    if (!pr) return err(res, 400, "先选择服务商");
    const base = (b.baseUrl || pr.baseUrl).trim();
    const key = (b.key || "").trim() || (a.preset === pr.id && a.baseUrl === base ? a.key : "");
    if (!key && !pr.noKey && pr.id !== "custom") return err(res, 400, "先填写 Key");
    return ok(res, (AI_MODELS[pr.id] || []).map(x => (typeof x === "string" ? { id: x } : x)));
  }
  if (p === "/api/ai/test" && m === "POST") {
    if (aiMissing(a)) return err(res, 400, AI_DISABLED);
    if (a.testFail) return ok(res, { ok: false, tools: "unknown", error: "Key 不对或已失效（HTTP 401，authentication_error）：invalid x-api-key", latencyMs: 0, totalMs: 0, usage: { input: 0, output: 0 } });
    const pr = AI_PRESETS.find(x => x.id === a.preset);
    return ok(res, { ok: true, latencyMs: 820, totalMs: 1310, model: a.model, tools: "yes", stop: "tool_use", usage: { input: 156, output: 12 },
      cost: pr.local ? { amount: 0, currency: "USD", source: "local" } : { amount: 0.0001, currency: "USD", source: "litellm" } });
  }
  if (p === "/api/ai/quota" && m === "PUT") {
    for (const [k, v] of Object.entries(b)) {
      if (!["assistant", "gamechat"].includes(k)) return err(res, 400, `参数 ${k} 不认识`);
      if (!(v >= 0)) return err(res, 400, "额度要在 0 到 1 万亿 token 之间（0 表示不限）");
      if (v) a.quota[k] = v; else delete a.quota[k];
    }
    return ok(res, aiView(a));
  }
  if (p === "/api/ai/prices" && m === "PUT") {
    if (!Array.isArray(b.prices)) return err(res, 400, "缺少参数 prices");
    a.prices = b.prices;
    return ok(res, aiView(a));
  }
  if (p === "/api/ai/prices/refresh" && m === "POST") {
    if (aiMissing(a)) return err(res, 400, AI_DISABLED);
    if ((AI_PRESETS.find(x => x.id === a.preset) || {}).local) return err(res, 400, "本机模型不花钱，不需要价格数据");
    a.priceUpdated = "2026-10-28";
    return ok(res, aiView(a));
  }
  return err(res, 404, "not found");
}

// ==================== 第五阶段：音乐共享（同 /api/instances/{name}/music*、/api/music/*，以及隧道的「用途」）====================
// 数据形状照抄后端（musicshare.Status、SourcesView、InstallResult、VoiceHostChange）；广播、检查都是假的。
// 场景用 /__mock/state 的 music 字段切换：{ reset, cap: "win11" | "win10", local, systemConfirmed, voiceTunnel, inst: { 名称: {…} } }
const MUSIC_CORES = ["neoforge", "forge", "mohist"];
const MUSIC_CAPS = {
  win11: { os: "Windows 11（10.0.26300）", mode: "process", warn: false },
  win10: { os: "Windows 10（10.0.19045）", mode: "system", warn: true },
};
const MUSIC_WARNING = "这台电脑只能录整机的声音：游戏声音、语音聊天（好友说的话）也会一起播出去，好友会听到自己说话的回声。确认之后才能开始";
const MUSIC_SOURCES = [
  { pid: 4242, exe: "cloudmusic.exe", name: "网易云音乐", playing: true, peak: 0.55, devices: ["扬声器（Realtek）"] },
  { pid: 5120, exe: "QQMusic.exe", name: "QQ音乐", playing: false, peak: 0 },
  { pid: 7788, exe: "msedge.exe", name: "Microsoft Edge", playing: true, peak: 0.18, devices: ["扬声器（Realtek）"] },
];
const MUSIC_DEVICES = [{ id: "{dev-1}", name: "扬声器（Realtek）", default: true }, { id: "{dev-2}", name: "CABLE Input（虚拟声卡）", default: false }];
const MUSIC_LOCAL_START = "音乐广播录的是这台电脑的声音，只能在这台电脑上开始";
const VOICE_TUNNEL = { id: "t-voice", name: "语音线", provider: "natfrp", purpose: "voice", running: true, boundInstance: "机械动力整合包", autoStart: true, publicAddr: "frp-abc.natfrp.cloud:34567", lastError: "", localPort: 0 };
function newMusicState() {
  return {
    cap: "win11", local: true, systemConfirmed: false, device: "",
    // 每台 Forge 系服务器的情况：SVC 装没装、桥接模组装的哪种（""、main、javafml）、SVC 的配置、设置、要重启才生效的改动
    inst: { "机械动力整合包": { svc: true, svcVersion: "1.20.1-2.5.24", bridge: "", voiceFound: true, voicePort: 24454, voiceHost: "", exclude: "", volume: 100, mode: "", exe: "", restart: [], last: null } },
    broadcast: null, // { inst, mode, pid, exe, device, since }
    tunnelBody: null, // 最近一次 POST /api/tunnels 的请求体
  };
}
function musicInst(ms, name) {
  return ms.inst[name] || (ms.inst[name] = { svc: false, svcVersion: "", bridge: "", voiceFound: false, voicePort: 24454, voiceHost: "", exclude: "", volume: 100, mode: "", exe: "", restart: [], last: null });
}
function musicMockState(state, b) {
  if (b.reset) state.music = newMusicState();
  const ms = state.music;
  for (const k of ["cap", "local", "systemConfirmed"]) if (k in b) ms[k] = b[k];
  if (b.inst) for (const [n, v] of Object.entries(b.inst)) Object.assign(musicInst(ms, n), v);
  state.tunnels = state.tunnels.filter(t => t.id !== VOICE_TUNNEL.id);
  if (b.voiceTunnel) state.tunnels.push({ ...VOICE_TUNNEL });
}
// 服务器不在运行了：广播跟着停（同 musicshare 的收尾）
function musicSync(state) {
  const ms = state.music, b = ms.broadcast;
  if (!b) return;
  const i = state.instances.find(x => x.name === b.inst);
  if (!i || i.status !== "running") { ms.broadcast = null; musicInst(ms, b.inst).last = { reason: i && i.status === "stopping" ? "服务器正在停止" : "服务器已停止", at: new Date().toISOString(), error: false }; }
}
function musicStatus(state, i) {
  const ms = state.music, mi = musicInst(ms, i.name), b = ms.broadcast;
  const supported = MUSIC_CORES.includes(i.core);
  const vt = state.tunnels.filter(t => t.purpose === "voice" && t.boundInstance === i.name)
    .map(t => ({ id: t.id, name: t.name, provider: t.provider, running: t.running, autoStart: t.autoStart, publicAddr: t.publicAddr || undefined, lastError: t.lastError || undefined }));
  const addr = (vt.find(t => t.publicAddr) || {}).publicAddr || "";
  const rstate = !vt.length ? "none" : !addr ? "waiting" : !mi.voiceFound ? "pending" : mi.voiceHost === addr ? "same" : !mi.voiceHost ? "pending" : "differ";
  const online = i.status === "running" ? ["Steve", "Alex", "Notch_CN"] : [];
  const ex = mi.exclude.split(/[,，;；\s]+/).filter(Boolean).map(s => s.toLowerCase());
  const voice = online.filter(n => n !== "Notch_CN");
  let view;
  if (b && b.inst === i.name) {
    const dev = MUSIC_DEVICES.find(d => d.id === b.device) || MUSIC_DEVICES[0];
    view = { inst: i.name, phase: "live", since: b.since, mode: b.mode, source: b.mode === "process" ? `${b.exe}（PID ${b.pid}）` : "整机声音：" + dev.name,
      volume: mi.volume, listeners: voice.filter(n => !ex.includes(n.toLowerCase())).length, buffered: 6, rttMs: 1.8, sent: 1234, dropped: 0, silent: 12, modDropped: 0, underruns: 0,
      warning: b.mode === "system" ? "整机录音：游戏声音、语音聊天也会一起播出去" : undefined, input: "float32 2 声道 48000Hz" };
  }
  return {
    inst: i.name, supported, reason: supported ? undefined : "音乐共享要用 Simple Voice Chat 和桥接模组，只支持 NeoForge、Forge 服",
    note: i.core === "mohist" ? "Mohist 上还没测过音乐共享" : undefined, serverStatus: i.status,
    svc: mi.svc ? { installed: true, file: `voicechat-forge-${mi.svcVersion}.jar`, version: mi.svcVersion, loader: "forge" } : { installed: false },
    bridge: { installed: !!mi.bridge, file: mi.bridge ? `minedeck-voicebridge${mi.bridge === "javafml" ? "-javafml" : ""}-0.2.0.jar` : undefined, variant: mi.bridge || undefined,
      current: !!mi.bridge, version: "0.2.0", config: mi.bridge ? { enabled: true, port: 24470, exclude: mi.exclude, selftest: false, bypassGroupIsolation: false } : undefined,
      loaded: i.status === "running" && mi.bridge && !mi.restart.includes("桥接模组") ? true : undefined },
    voice: { found: mi.voiceFound, port: mi.voicePort, voiceHost: mi.voiceHost, path: "config/voicechat/voicechat-server.properties" },
    voicePort: i.status === "running" && mi.voiceFound ? mi.voicePort : undefined,
    remote: { tunnels: vt, addr: addr || undefined, state: rstate, managed: !!addr && mi.voiceHost === addr },
    players: { known: true, voice: voice.filter(n => !ex.includes(n.toLowerCase())), excluded: voice.filter(n => ex.includes(n.toLowerCase())), noVoice: online.includes("Notch_CN") ? ["Notch_CN"] : [], incompatible: [] },
    capability: { ...MUSIC_CAPS[ms.cap], warning: MUSIC_WARNING }, systemConfirmed: ms.systemConfirmed,
    settings: { exclude: mi.exclude, volume: mi.volume, mode: mi.mode || undefined, exe: mi.exe || undefined },
    broadcast: view, elsewhere: b && b.inst !== i.name ? b.inst : undefined, last: !view && mi.last ? mi.last : undefined,
    restart: mi.restart.length ? mi.restart : undefined, local: ms.local,
    guide: "服务器开了「MineDeck 音乐共享」：房主电脑上放的歌，会通过 Simple Voice Chat（简单语音聊天）播给大家。\n" +
      (mi.svc ? `1. 客户端装 Simple Voice Chat，和服务器同一个版本最稳妥：服务器装的是 ${mi.svcVersion}。\n` : "1. 客户端装 Simple Voice Chat，版本和服务器的一样（问房主要）。\n") +
      "2. 进服后按 V 打开语音菜单，点「调整音量」，找到「MineDeck 音乐共享」：拉到 0 就只静音音乐，不影响别人说话。" +
      (mi.voiceHost ? `\n3. 远程连服的朋友：语音走 ${mi.voiceHost}，不用另外设置；连不上语音时告诉房主。` : ""),
  };
}
async function musicHandler(state, req, res, p, m, seg) {
  const ms = state.music;
  musicSync(state);
  if (p === "/api/tunnels" && m === "POST") { ms.tunnelBody = await readBody(req); return ok(res, { id: "t9" }); } // 隧道表单带上了用途、协议没有
  if (p === "/api/music/sources" && m === "GET") {
    if (!ms.local) return err(res, 403, MUSIC_LOCAL_START);
    return ok(res, { capability: { ...MUSIC_CAPS[ms.cap], warning: MUSIC_WARNING }, systemConfirmed: ms.systemConfirmed, sources: MUSIC_SOURCES, devices: MUSIC_DEVICES, device: ms.device });
  }
  if (p === "/api/music/confirm-system" && m === "POST") {
    if (!ms.local) return err(res, 403, "整机录音的提醒要在这台电脑上确认");
    ms.systemConfirmed = true;
    return ok(res, "ok");
  }
  const name = seg[3], sub = seg[5] || "";
  const i = state.instances.find(x => x.name === name);
  if (!i) return err(res, 404, "实例不存在: " + name);
  const mi = musicInst(ms, name);
  const supported = MUSIC_CORES.includes(i.core);
  const b = await readBody(req);
  if (!sub && m === "GET") return ok(res, musicStatus(state, i));
  if (sub === "start" && m === "POST") {
    if (!ms.local) return err(res, 403, MUSIC_LOCAL_START);
    if (!["process", "system"].includes(b.mode)) return err(res, 400, "参数 mode 只能是 process、system 之一");
    if (ms.broadcast) return err(res, 409, ms.broadcast.inst === name ? `已经在给「${name}」广播了` : `正在给「${ms.broadcast.inst}」广播：同一时间只能有一个广播，先停掉它`);
    if (!supported) return err(res, 400, "音乐共享要用 Simple Voice Chat 和桥接模组，只支持 NeoForge、Forge 服");
    if (i.status !== "running") return err(res, 400, "服务器没在运行：先开服，等它启动完成再开始广播");
    if (!mi.bridge) return err(res, 400, "还没装桥接模组：先在检查清单里安装，然后重启服务器");
    if (mi.restart.includes("桥接模组")) return err(res, 400, "桥接模组装好以后还没重启服务器：重启后才能广播");
    if (!mi.svc) return err(res, 400, "mods 里没有 Simple Voice Chat：音乐要靠它推给玩家");
    if (b.mode === "process" && !b.pid) return err(res, 400, "先在列表里选一个正在出声的程序");
    if (b.mode === "system" && !ms.systemConfirmed) return err(res, 409, MUSIC_WARNING);
    if (b.mode === "system" && b.device) ms.device = b.device;
    ms.broadcast = { inst: name, mode: b.mode, pid: b.pid || 0, exe: b.exe || "", device: b.device || ms.device, since: new Date().toISOString() };
    mi.mode = b.mode; if (b.exe) mi.exe = b.exe; mi.last = null;
    return ok(res, musicStatus(state, i).broadcast);
  }
  if (sub === "stop" && m === "POST") {
    if (!ms.broadcast || ms.broadcast.inst !== name) return err(res, 400, `没在给「${name}」广播`);
    ms.broadcast = null;
    mi.last = { reason: "用户停止", at: new Date().toISOString(), error: false };
    return ok(res, "ok");
  }
  if (sub === "settings" && m === "PUT") {
    if ("volume" in b && !(b.volume >= 0 && b.volume <= 200)) return err(res, 400, "参数 volume 应在 0 到 200 之间");
    if ("exclude" in b) {
      const names = String(b.exclude).split(/[,，;；\s]+/).filter(Boolean);
      const bad = names.find(n => /[\\=#!:]/.test(n) || [...n].length > 36);
      if (bad) return err(res, 400, `「${bad}」里有不能用的字符`);
      mi.exclude = names.join(",");
    }
    if ("volume" in b) mi.volume = b.volume;
    return ok(res, "ok");
  }
  if (sub === "install" && m === "POST") {
    if (!supported) return err(res, 400, "音乐共享要用 Simple Voice Chat 和桥接模组，只支持 NeoForge、Forge 服");
    if (!mi.svc) return err(res, 400, "先装 Simple Voice Chat：桥接模组声明了必须有它，没有的话服务器会起不来");
    const v = b.variant || "main", running = i.status !== "stopped";
    if (running && mi.bridge && mi.bridge !== v) return err(res, 409, "服务器运行中不能替换已经装着的桥接模组（文件被服务器占用）：先停服再安装");
    const removed = mi.bridge && mi.bridge !== v ? [`minedeck-voicebridge${mi.bridge === "javafml" ? "-javafml" : ""}-0.2.0.jar`] : undefined;
    const noop = mi.bridge === v;
    mi.bridge = v;
    if (running && !noop && !mi.restart.includes("桥接模组")) mi.restart.push("桥接模组");
    return ok(res, { installed: true, file: `minedeck-voicebridge${v === "javafml" ? "-javafml" : ""}-0.2.0.jar`, variant: v, current: true, version: "0.2.0", removed, restart: running && !noop });
  }
  if (sub === "voicehost" && m === "PUT") {
    const st = musicStatus(state, i);
    let value = String(b.value || "").trim();
    if (b.fromTunnel) { value = st.remote.addr || ""; if (!value) return err(res, 400, "语音隧道还没拿到公网地址：先启动隧道，或者手动填写语音地址"); }
    if (value && !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(value)) return err(res, 400, `语音地址不对：${value}（写成 域名:端口 或 IP:端口）`);
    if (!mi.voiceFound) return err(res, 400, "SVC 的配置还没生成：先开一次服（SVC 第一次启动时生成 config/voicechat/voicechat-server.properties）");
    const before = mi.voiceHost, changed = before !== value, restart = changed && i.status !== "stopped";
    mi.voiceHost = value;
    if (restart && !mi.restart.includes("voice_host")) mi.restart.push("voice_host");
    return ok(res, { before, after: value, changed, restart });
  }
  return err(res, 404, "not found");
}
// ==================== 第五阶段结束 ====================

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
    //   cfKey: 已存的 CurseForge API Key（空串 = 未设置）；cfKeyBroken: true 模拟「Key 解不开」（换了电脑或 Windows 用户）
    //   credBroken: 隧道编号（如 "t2"），模拟这条隧道的凭据解不开；空串还原
    //   ai: { reset: true 回到没配置, local: false 模拟局域网打开（只能看）, keyBroken, testFail, priceUpdated, 以及 preset/baseUrl/model/key 等直接写入 }
    //   music（第五阶段）: { reset, cap: "win11" | "win10", local, systemConfirmed, voiceTunnel: true 多一条语音隧道, inst: { 名称: { svc, bridge, voiceHost, … } } }
    if (p === "/__mock/state" && m === "POST") {
      const b = await readBody(req);
      if ("empty" in b) state.empty = !!b.empty;
      if ("onboarded" in b) { state.config.onboarded = !!b.onboarded; state.config.tosAccepted = !!b.onboarded; }
      if ("taskStage" in b) state.taskStage = b.taskStage;
      if ("listenLan" in b) state.config.listenLan = !!b.listenLan;
      // 模拟老版本实例：保存 JVM 参数时后端强制补回 log4shell 缓解参数（同 inst.UpdateSettings）
      if (b.legacy) { const i = state.instances.find(x => x.name === b.legacy.name); if (i) { i.extraJvm = b.legacy.extraJvm; i.forceFlags = b.legacy.forceFlags; } }
      if ("cfKey" in b) state.cfKey = String(b.cfKey || "");
      if ("cfKeyBroken" in b) state.cfKeyBroken = !!b.cfKeyBroken;
      if ("credBroken" in b) for (const t of state.tunnels) t.credBroken = t.id === b.credBroken;
      if (b.ai) { if (b.ai.reset) state.ai = newAIState(); const { reset, ...rest } = b.ai; Object.assign(state.ai, rest); }
      if (b.music) musicMockState(state, b.music); // 第五阶段
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
      if (p === "/api/app") return ok(res, { version: "2.6.1", base: "D:\\MineDeck", ramMb: 16384, availRamMb: 9216, port: portOf(), serversRoot: "D:\\MineDeck\\servers", backupsRoot: "D:\\MineDeck\\backups", config: state.config, lanSet: false, cfKeySet: !!state.cfKey && !state.cfKeyBroken, cfKeyBroken: state.cfKeyBroken, autoStart: state.autoStart, ips: ["172.22.48.1", "192.168.1.23", "10.0.0.5"] });
      if (p === "/api/bg") return ok(res, { images: [] });
      if (p === "/api/ops/log") {
        const q = u.searchParams, lim = Math.min(+q.get("limit") || 100, 1000);
        return ok(res, OPLOG.filter(r => (!q.get("inst") || r.inst === q.get("inst")) && (!q.get("src") || r.src === q.get("src")) && (!q.get("op") || r.op.startsWith(q.get("op")))).slice(0, lim));
      }
      if (p.startsWith("/api/ai/")) return aiHandler(state, req, res, p, m);
      if (p.startsWith("/api/music/") || (seg[2] === "instances" && seg[4] === "music") || (p === "/api/tunnels" && m === "POST")) return musicHandler(state, req, res, p, m, seg); // 第五阶段
      if (p === "/api/cores") return ok(res, CORES);
      if (p === "/api/config" && m === "PUT") {
        const b = await readBody(req);
        // 同 web.go：chromeColor 只收 #rrggbb（存为小写），格式不对整次拒绝；空串清除
        if ("chromeColor" in b) {
          if (b.chromeColor !== "" && !/^#[0-9a-f]{6}$/i.test(b.chromeColor)) return err(res, 400, "chromeColor 须为 #rrggbb 形式的颜色");
          b.chromeColor = b.chromeColor.toLowerCase();
        }
        if ("autoStart" in b) state.autoStart = !!b.autoStart;
        // 同 web：Key 加密另存、不进 config，传空串清除；响应里永远没有 Key
        if ("cfApiKey" in b) { state.cfKey = String(b.cfApiKey || "").trim(); state.cfKeyBroken = false; delete b.cfApiKey; }
        Object.assign(state.config, b); delete state.config.autoStart; return ok(res, state.config);
      }
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
