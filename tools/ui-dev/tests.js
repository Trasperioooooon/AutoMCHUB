// 交互回归测试：node tests.js [正则]（只跑名字匹配的用例，如 node tests.js 外观）
// 自带一个全新的仿真后端（随机端口），在无头 Chromium 里操作界面并断言。全部通过时退出码为 0。
"use strict";
const { chromium } = require("playwright");
const { start } = require("./server");
const ONLY = process.argv[2] ? new RegExp(process.argv[2]) : null;
let ORIGIN, PORT; // 仿真后端启动后赋值
let n = 0;
const url = hash => ORIGIN + "?n=" + (++n) + hash;
const results = [];

async function run(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

(async () => {
  const mock = await start();
  ({ url: ORIGIN, port: PORT } = mock);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("amh_token", "mock");
    localStorage.setItem("amh_theme", "dark");
    window.hostWinClose = () => {}; window.hostWinMin = () => {}; window.hostWinMaxToggle = () => {};
    window.hostWinDrag = () => {}; window.hostWinIsMax = async () => false;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const reqs = [];
  page.on("request", r => reqs.push({ t: Date.now(), m: r.method(), u: new URL(r.url()).pathname, b: r.method() === "PUT" ? r.postData() || "" : "" }));
  // 某次之后有没有改过某个配置键（PUT /api/config 的请求体里带这个键）——原生窗口还会顺带上报界面底色，不能只看路径
  const putConfig = (since, key) => reqs.slice(since).some(r => r.m === "PUT" && r.u === "/api/config" && key in JSON.parse(r.b || "{}"));
  const settle = (ms = 400) => page.waitForTimeout(ms);
  const inst = encodeURIComponent("生存服 · 朋友");
  await page.goto(ORIGIN);
  await page.evaluate(() => fetch("/__mock/state", { method: "POST", body: JSON.stringify({ empty: false, onboarded: true, taskStage: 2 }) }));

  await run("切页后不残留轮询（快速切换 6 次后，停在隧道页 6 秒内不再请求 /api/instances）", async () => {
    await page.goto(url("#/instances")); await settle(600);
    errors.length = 0;
    // 每次切走都发生在上一视图的首个请求返回之前（mock 很快，故用 evaluate 同步连切）
    await page.evaluate(async () => {
      const hs = ["#/instances", "#/settings/java", "#/inst/" + encodeURIComponent("生存服 · 朋友") + "/console", "#/instances", "#/task/task-1", "#/tunnels"];
      for (const h of hs) { location.hash = h; await new Promise(r => setTimeout(r, 5)); }
    });
    await settle(800);
    const t0 = Date.now();
    await page.waitForTimeout(6000);
    const inWin = reqs.filter(r => r.t >= t0);
    const instReqs = inWin.filter(r => r.u === "/api/instances").length;
    const taskReqs = inWin.filter(r => r.u.startsWith("/api/tasks/")).length;
    const tunReqs = inWin.filter(r => r.u === "/api/tunnels").length;
    assert(instReqs === 0 && taskReqs === 0, `残留轮询：/api/instances ${instReqs} 次、/api/tasks ${taskReqs} 次（隧道页本应只轮询 /api/tunnels）`);
    assert(tunReqs >= 1 && tunReqs <= 2, `/api/tunnels 轮询次数异常：${tunReqs}`);
    assert(errors.length === 0, "页面报错：" + errors.slice(0, 2).join(" | "));
  });

  await run("toast 落在标题栏下方，不遮挡窗口控制键", async () => {
    await page.goto(url("#/instances")); await settle();
    await page.click('.card[data-name="机械动力整合包"] [data-act="start"]');
    await page.waitForSelector(".toast");
    const tb = await page.$eval(".toast", el => el.getBoundingClientRect().top);
    const hb = await page.$eval("#titlebar", el => el.getBoundingClientRect().bottom);
    assert(tb >= hb, `toast 顶 ${tb} < 标题栏底 ${hb}`);
  });

  await run("点击卡片空白处进入详情；点「···」不跳转并弹出菜单", async () => {
    await page.goto(url("#/instances")); await settle();
    await page.click('.card[data-name="机械动力整合包"] [data-act="more"]');
    await settle(150);
    assert((await page.$(".dropmenu")) !== null, "菜单未弹出");
    assert(page.url().includes("#/instances"), "点「···」后发生了跳转");
    await page.keyboard.press("Escape");
    // 菜单离场有 120ms 动画：按下 Esc 立即进入离场（不再可点），动画结束后从页面移除
    assert((await page.$(".dropmenu:not(.leave)")) === null, "Esc 未关闭菜单");
    await page.waitForSelector(".dropmenu", { state: "detached", timeout: 1000 }).catch(() => {});
    assert((await page.$(".dropmenu")) === null, "菜单离场后未移除");
    await page.click('.card[data-name="机械动力整合包"] .inst-config');
    await settle();
    assert(decodeURIComponent(page.url()).includes("#/inst/机械动力整合包"), "点卡片未进入详情：" + page.url());
  });

  await run("运行中的服务器：菜单里的删除不可点并说明原因", async () => {
    await page.goto(url("#/instances")); await settle();
    await page.click('.card[data-name="生存服 · 朋友"] [data-act="more"]');
    await settle(150);
    const dis = await page.$eval(".dropmenu button.danger", b => b.disabled);
    const note = await page.$eval(".dropmenu .dm-note", el => el.textContent);
    assert(dis && note.includes("停止"), `disabled=${dis} note=${note}`);
    await page.keyboard.press("Escape");
  });

  await run("删除确认框默认聚焦「保留」，回车不会删除", async () => {
    await page.goto(url("#/instances")); await settle();
    await page.click('.card[data-name="机械动力整合包"] [data-act="more"]');
    await page.click(".dropmenu button.danger");
    await settle(200);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
    assert(focused === "保留", "默认焦点在：" + focused);
    const before = reqs.length;
    await page.keyboard.press("Enter");
    await settle(200);
    assert(!reqs.slice(before).some(r => r.m === "DELETE"), "回车触发了 DELETE");
  });

  await run("弹窗打开时按 1-4 不会在底下切页", async () => {
    await page.goto(url("#/instances")); await settle();
    await page.click('.card[data-name="机械动力整合包"] [data-act="more"]');
    await page.click(".dropmenu button.danger");
    await settle(150);
    await page.keyboard.press("3");
    await settle(150);
    assert(page.url().includes("#/instances"), "弹窗下切页到了：" + page.url());
    await page.keyboard.press("Escape");
  });

  await run("常用设置：改动后保存条显示未保存项数，切 tab 被拦下；「继续编辑」保留改动与地址", async () => {
    await page.goto(url(`#/inst/${inst}/common`)); await settle();
    assert(await page.$eval('[data-sb="save"]', b => b.disabled), "未改动时保存键应置灰");
    await page.click('.prop-item:has([data-k="hardcore"]) .sw');
    const st = await page.$eval(".sb-state", el => el.textContent);
    assert(st.includes("1 项修改未保存"), "保存条状态：" + st);
    await page.click('.tab[data-t="players"]');
    await settle(200);
    assert((await page.$(".modal")) !== null, "未弹出离开确认");
    await page.click('[data-x="cancel"]');
    await settle(200);
    assert(page.url().endsWith("/common"), "取消后地址变了：" + page.url());
    assert(await page.$eval('[data-k="hardcore"]', el => el.checked), "取消后改动丢失");
    // 再次离开并确认放弃 → 进入玩家页
    await page.click('.tab[data-t="players"]');
    await settle(200);
    await page.click('[data-x="ok"]');
    await settle(400);
    assert(page.url().endsWith("/players"), "确认放弃后未进入玩家页：" + page.url());
    assert((await page.$(".players-grid")) !== null, "玩家页未渲染");
  });

  await run("常用设置：保存后恢复干净状态，再切页不再拦截", async () => {
    await page.goto(url(`#/inst/${inst}/common`)); await settle();
    await page.click('.prop-item:has([data-k="hardcore"]) .sw');
    const before = reqs.length;
    await page.click('[data-sb="save"]');
    await settle(300);
    assert(reqs.slice(before).some(r => r.m === "PUT" && r.u.endsWith("/properties")), "未发送 PUT properties");
    assert((await page.$eval(".sb-state", el => el.textContent)).includes("已保存"), "保存后状态未复位");
    await page.click('.tab[data-t="raw"]');
    await settle(300);
    assert((await page.$(".modal")) === null, "已保存仍被拦截");
    assert(page.url().endsWith("/raw"), "未切到全部配置");
  });

  await run("「放弃修改」按服务器值重绘", async () => {
    await page.goto(url(`#/inst/${inst}/jvm`)); await settle();
    await page.click("#jm-aikar");
    assert((await page.$eval(".sb-state", el => el.textContent)).includes("未保存"), "填入 Aikar 后未标记未保存");
    await page.click('[data-sb="discard"]');
    await settle(400);
    assert((await page.$eval("#jm-jvm", el => el.value)) === "", "放弃后参数未还原");
    assert((await page.$eval(".sb-state", el => el.textContent)).includes("已保存"), "放弃后状态未复位");
  });

  await run("定时任务：增删条目计入未保存，并在离开时拦截", async () => {
    await page.goto(url(`#/inst/${inst}/tasks`)); await settle();
    await page.click('#sched-list [data-i="0"]');
    assert((await page.$eval(".sb-state", el => el.textContent)).includes("1 项"), "删除定时任务后未标记");
    await page.click('#sidebar a[data-nav="settings"]');
    await settle(200);
    assert((await page.$(".modal")) !== null, "离开未拦截");
    await page.click('[data-x="ok"]');
    await settle(300);
  });

  await run("向导中途再点「新建服务器」/按 2 回到入口", async () => {
    await page.goto(url("#/create")); await settle();
    await page.click("#mode-new"); await settle();
    await page.click('.core-card[data-id="paper"]'); await page.click("#wnext"); await settle();
    await page.click('#sidebar a[data-nav="create"]'); await settle();
    assert((await page.$("#mode-new")) !== null, "点「新建服务器」未回到入口");
    await page.click("#mode-new"); await settle();
    await page.keyboard.press("2"); await settle();
    assert((await page.$("#mode-new")) !== null, "按 2 未回到入口");
  });

  await run("向导：双击核心直达选版本；默认预选最新正式版；完成步骤可点回", async () => {
    await page.goto(url("#/create")); await settle();
    await page.click("#mode-new"); await settle();
    await page.dblclick('.core-card[data-id="fabric"]'); await settle();
    assert((await page.$("#ver-list")) !== null, "双击未进入版本步");
    const sel = await page.$eval("#ver-list .ver-item.sel", el => el.dataset.id);
    assert(sel === "26.2", "默认选中：" + sel);
    assert(!(await page.$eval("#wnext", b => b.disabled)), "预选后「下一步」应可点");
    assert((await page.$eval("#wf-sum", el => el.textContent)).includes("Fabric · 26.2"), "底栏回显不对");
    await page.click('.step-pill.done[data-step="0"]'); await settle();
    assert((await page.$("#core-grid .core-card.sel")) !== null, "点回第 1 步后选择丢失");
  });

  await run("向导：名称为空 / 端口非法 / 未同意 EULA 时就地报错，不发请求", async () => {
    await page.goto(url("#/create")); await settle();
    await page.click("#mode-new"); await settle();
    await page.dblclick('.core-card[data-id="paper"]'); await settle();
    await page.click("#wnext"); await settle();
    await page.click("#wnext"); await settle();
    await page.fill("#f-name", "");
    await page.fill("#f-port", "70000");
    const before = reqs.length;
    await page.click("#wcreate"); await settle(200);
    assert(!reqs.slice(before).some(r => r.m === "POST" && r.u === "/api/instances"), "非法输入仍提交了");
    const errs = await page.$$eval(".field-err", els => els.map(e => e.textContent.trim()).filter(Boolean));
    assert(errs.length === 3, "错误条数：" + JSON.stringify(errs));
    assert((await page.$(".toast")) === null || !(await page.$eval(".toast", t => t.classList.contains("error"))), "仍弹了错误 toast");
    await page.fill("#f-name", "测试服");
    await page.fill("#f-port", "25570");
    await page.click(".eula-box .sw");
    await settle(100);
    const left = await page.$$eval(".field-err", els => els.map(e => e.textContent.trim()).filter(Boolean));
    assert(left.length === 0, "改正后错误未消失：" + JSON.stringify(left));
  });

  await run("部署任务首轮即结束时只提示一次成功", async () => {
    await page.evaluate(() => fetch("/__mock/state", { method: "POST", body: JSON.stringify({ taskStage: 4 }) }));
    await page.goto(url("#/task/task-9")); await page.waitForTimeout(2500);
    const toasts = await page.$$eval(".toast", ts => ts.map(t => t.textContent));
    await page.evaluate(() => fetch("/__mock/state", { method: "POST", body: JSON.stringify({ taskStage: 2 }) }));
    assert(toasts.filter(t => t.includes("创建成功")).length === 1, "成功提示次数：" + JSON.stringify(toasts));
  });

  await run("设置单字段：没改时保存键置灰，回车即保存", async () => {
    await page.goto(url("#/settings/download")); await settle();
    assert(await page.$eval("#cf-save", b => b.disabled), "未改动时保存键应置灰");
    await page.fill("#cf-key", "key-" + Date.now());
    assert(!(await page.$eval("#cf-save", b => b.disabled)), "改动后保存键应可点");
    const before = reqs.length;
    await page.press("#cf-key", "Enter"); await settle(300);
    assert(putConfig(before, "cfApiKey"), "回车未保存");
    assert(await page.$eval("#cf-save", b => b.disabled), "保存后应恢复置灰");
  });

  // ---- 外观 ----
  const rootVar = name => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const cssVal = async (sel, name) => {
    const css = await page.evaluate(() => fetch("/themes.css").then(r => r.text()));
    const block = css.split(sel)[1];
    return block && (block.match(new RegExp(name + ":\\s*([^;]+);")) || [])[1];
  };

  await run("外观：切换配色方案即时生效，刷新后保留", async () => {
    await page.goto(url("#/settings/appearance")); await settle();
    await page.click('[data-scheme-pick="nord"]'); await settle(200);
    const ds = await page.evaluate(() => [document.documentElement.dataset.scheme, localStorage.getItem("amh_scheme")]);
    assert(ds[0] === "nord" && ds[1] === "nord", "未生效 / 未持久化：" + ds);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    const want = await cssVal(`[data-scheme="nord"][data-theme="${theme}"]`, "--bg");
    assert((await rootVar("--bg")) === want, `--bg=${await rootVar("--bg")}，应为 ${want}`);
    assert((await page.$$eval(".scheme-card.on", els => els.map(e => e.dataset.schemePick))).join() === "nord", "选中卡不对");
    await page.reload(); await settle();
    assert((await page.evaluate(() => document.documentElement.dataset.scheme)) === "nord", "刷新后丢失");
  });

  await run("外观：强调色覆盖方案自带的强调色，「跟随方案」可还原", async () => {
    await page.goto(url("#/settings/appearance")); await settle();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('[data-accent-pick="violet"]'); await settle(200);
    const v = await cssVal(`[data-accent="violet"][data-theme="${theme}"]`, "--accent-solid");
    assert((await rootVar("--accent-solid")) === v, `覆盖未生效：${await rootVar("--accent-solid")} ≠ ${v}`);
    await page.click('[data-accent-pick="auto"]'); await settle(200);
    const s = await cssVal(`[data-scheme="nord"][data-theme="${theme}"]`, "--accent-solid");
    assert((await rootVar("--accent-solid")) === s, `还原失败：${await rootVar("--accent-solid")} ≠ ${s}`);
  });

  await run("外观：侧栏快捷切换模式时，外观页选中态同步", async () => {
    await page.goto(url("#/settings/appearance")); await settle();
    const before = await page.evaluate(() => document.documentElement.dataset.themePref);
    await page.click("#theme-btn"); await settle(200);
    const after = await page.evaluate(() => document.documentElement.dataset.themePref);
    const on = await page.$eval(".seg button.on", b => b.dataset.mode);
    assert(before !== after && on === after, `before=${before} after=${after} 选中=${on}`);
  });

  await run("外观：存储了无效方案名时回退到默认「方块」", async () => {
    await page.evaluate(() => localStorage.setItem("amh_scheme", "bogus"));
    await page.goto(url("#/instances")); await settle();
    assert((await page.evaluate(() => document.documentElement.dataset.scheme)) === "craft", "未回退");
    await page.evaluate(() => { localStorage.removeItem("amh_scheme"); localStorage.setItem("amh_accent", "auto"); });
  });

  await run("外观：没有记忆时默认方案是「方块」，外观页第一张卡即「方块」且为选中态", async () => {
    await page.evaluate(() => localStorage.removeItem("amh_scheme"));
    await page.goto(url("#/settings/appearance")); await settle();
    assert((await page.evaluate(() => document.documentElement.dataset.scheme)) === "craft", "默认方案不是 craft");
    const first = await page.$eval(".scheme-card", b => [b.dataset.schemePick, b.classList.contains("on"), b.querySelector(".sc-name").textContent]);
    assert(first[0] === "craft" && first[1] && first[2] === "方块", "第一张方案卡：" + first);
    assert((await page.$$(".scheme-card")).length === 7, "方案卡数量不是 7");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    const want = await cssVal(`[data-scheme="craft"][data-theme="${theme}"]`, "--bg");
    assert((await rootVar("--bg")) === want, `--bg=${await rootVar("--bg")}，应为 ${want}`);
  });

  await run("局域网未登录：密码框保留，不被「无法连接」错误页覆盖；真故障仍显示错误页", async () => {
    const reply401 = route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "需要登录" }) });
    await page.route("**/api/app", reply401);
    try {
      await page.goto(url("#/instances")); await settle(600);
      assert((await page.$("#login-mask #login-pw")) !== null, "密码框不在");
      assert(!(await page.textContent("body")).includes("无法连接"), "被错误页覆盖");
    } finally { await page.unroute("**/api/app", reply401); }
    const reply502 = route => route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad Gateway</h1>" });
    await page.route("**/api/app", reply502);
    try {
      await page.goto(url("#/instances")); await settle(600);
      assert((await page.textContent("body")).includes("无法连接"), "后端真故障时未显示错误页");
    } finally { await page.unroute("**/api/app", reply502); }
  });

  await run("远程访问：开启后显示二维码，默认家用网段地址，可切换其它地址", async () => {
    await page.evaluate(() => fetch("/__mock/state", { method: "POST", body: JSON.stringify({ listenLan: true }) }));
    try {
      await page.goto(url("#/settings/remote")); await settle();
      assert((await page.$("#qr-box svg.qr")) !== null, "没有二维码");
      const want = "http://192.168.1.23:" + PORT;
      assert((await page.textContent("#qr-url")) === want, "默认地址应为 192.168.x.x：" + await page.textContent("#qr-url"));
      assert((await page.getAttribute("#qr-box", "aria-label")).endsWith(want), "二维码缺少无障碍标签");
      const ips = await page.$$eval(".qr-ip", bs => bs.map(b => b.textContent));
      assert(ips.join() === "192.168.1.23,10.0.0.5,172.22.48.1", "地址排序不对：" + ips);
      await page.click('.qr-ip[data-i="1"]'); await settle(150);
      assert((await page.textContent("#qr-url")) === "http://10.0.0.5:" + PORT, "切换地址无效");
      assert((await page.$eval(".qr-ip.cur", b => b.textContent + "|" + b.getAttribute("aria-pressed"))) === "10.0.0.5|true", "当前地址按钮状态不对");
    } finally {
      await page.evaluate(() => fetch("/__mock/state", { method: "POST", body: JSON.stringify({ listenLan: false }) }));
    }
  });

  await run("向导：原版的版本列表带发布日期副行，其它核心不显示", async () => {
    await page.goto(url("#/create")); await settle();
    await page.click("#mode-new"); await settle();
    await page.dblclick('.core-card[data-id="vanilla"]'); await settle();
    const first = await page.$eval("#ver-list .ver-item[data-id]", el => [el.dataset.id, el.querySelector(".ver-date")?.textContent]);
    assert(first[0] === "26.2" && first[1] === "2026-10-01", "日期副行不对：" + first);
    await page.goto(url("#/create")); await settle();
    await page.click("#mode-new"); await settle();
    await page.dblclick('.core-card[data-id="paper"]'); await settle();
    assert((await page.$("#ver-list .ver-date")) === null, "无发布时间的核心不应显示日期");
  });

  await run("JVM 参数：老版本的 log4shell 缓解参数在套用预设 / 清空时保留，删掉后保存会被补回并回显", async () => {
    const FIX = ["-Dlog4j2.formatMsgNoLookups=true", "-Dlog4j.configurationFile=log4j2_112-116.xml"];
    await page.evaluate(fix => fetch("/__mock/state", { method: "POST", body: JSON.stringify({ legacy: { name: "机械动力整合包", extraJvm: ["-XX:+UseG1GC", ...fix], forceFlags: fix } }) }), FIX);
    const pk = encodeURIComponent("机械动力整合包");
    await page.goto(url(`#/inst/${pk}/jvm`)); await settle();
    const args = () => page.$eval("#jm-jvm", el => el.value.split(/\s+/).filter(Boolean));
    await page.click("#jm-aikar"); await settle(100);
    let a = await args();
    assert(a[0] === "-XX:+UseG1GC" && a.length > 10 && a.slice(-2).join() === FIX.join(), "套用预设后应为 Aikar 参数 + 缓解参数：" + a.slice(-3));
    await page.click("#jm-clear"); await settle(100);
    assert((await args()).join() === FIX.join(), "清空应只剩缓解参数：" + await args());
    // 手动删光再保存：后端补回，页面回显补回后的参数，且不再标记未保存
    await page.fill("#jm-jvm", "-XX:+UseZGC");
    await page.click('[data-sb="save"]'); await settle(600);
    a = await args();
    assert(a.join() === ["-XX:+UseZGC", ...FIX].join(), "未回显补回后的参数：" + a);
    assert((await page.$eval(".sb-state", el => el.textContent)).includes("已保存"), "回显后仍标记未保存");
    const toasts = await page.$$eval(".toast", ts => ts.map(t => t.textContent).join("|"));
    assert(toasts.includes("已自动补回"), "缺少补回提示：" + toasts);
  });

  // ---- v5：启动画面 / 设置分组列表 / 减少动态 ----
  // 模拟原生 WebView2 宿主：窗口桥接函数 + 每次进程启动生成的 ID（真机由 main.go 用 WebView2 的文档创建脚本注入）
  const hostCtx = async (boot, opts = {}) => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 850 }, locale: "zh-CN", ...opts });
    await c.addInitScript(b => {
      localStorage.setItem("amh_token", "mock");
      if (b.host) { window.hostWinClose = () => {}; window.hostWinMin = () => {}; window.hostWinMaxToggle = () => {}; window.hostWinDrag = () => {}; window.hostWinIsMax = async () => false; }
      if (b.boot) window.__MD_BOOT = b.boot;
    }, boot);
    return c;
  };
  const splashState = p => p.evaluate(() => ({ attr: document.documentElement.dataset.splash || "", el: !!document.getElementById("splash") }));

  await run("启动画面：原生窗口冷启动时播一次、约 1 秒内自动淡出；刷新不再播；局域网浏览器与「减少动态」不播", async () => {
    const c = await hostCtx({ host: true, boot: "boot-1" });
    try {
      const p = await c.newPage();
      p.on("pageerror", e => errors.push(e.message));
      await p.goto(ORIGIN + "#/instances");
      let st = await splashState(p);
      assert(st.attr === "play" && st.el, "冷启动未播放启动画面：" + JSON.stringify(st));
      assert((await p.$$eval("#splash-logo i[style]", els => els.length)) > 100, "像素方块没有画出来");
      await p.waitForFunction(() => !document.getElementById("splash"), null, { timeout: 2000 });
      assert((await p.evaluate(() => document.documentElement.dataset.splash)) === undefined, "淡出后未清除 data-splash");
      await p.reload(); await p.waitForTimeout(150);
      st = await splashState(p);
      assert(!st.attr && !st.el, "刷新后又播了启动画面：" + JSON.stringify(st));
    } finally { await c.close(); }
    for (const [what, boot, opts] of [["局域网浏览器（无宿主函数）", { host: false, boot: "boot-2" }, {}], ["减少动态", { host: true, boot: "boot-3" }, { reducedMotion: "reduce" }]]) {
      const c2 = await hostCtx(boot, opts);
      try {
        const p = await c2.newPage();
        await p.goto(ORIGIN + "#/instances"); await p.waitForTimeout(100);
        const st = await splashState(p);
        assert(!st.attr && !st.el, `${what}不应播放启动画面：` + JSON.stringify(st));
      } finally { await c2.close(); }
    }
  });

  await run("启动画面：点击或按任意键立即跳过，按键不会触发 1–4 快捷键", async () => {
    for (const how of ["click", "key"]) {
      const c = await hostCtx({ host: true, boot: "boot-skip-" + how });
      try {
        const p = await c.newPage();
        await p.goto(ORIGIN + "#/instances");
        await p.waitForSelector("#splash");
        const t0 = Date.now();
        if (how === "click") await p.click("#splash", { force: true }); else await p.keyboard.press("2");
        await p.waitForFunction(() => !document.getElementById("splash"), null, { timeout: 2000 });
        const ms = Date.now() - t0;
        assert(ms < 500, `${how} 跳过太慢：${ms}ms`);
        assert(p.url().endsWith("#/instances"), "跳过用的按键触发了切页：" + p.url());
      } finally { await c.close(); }
    }
  });

  await run("设置：分组列表——下载源单选行点选即时生效（打勾跟随、发 PUT），键盘可选；存储位置为带图标的分组", async () => {
    await page.goto(url("#/settings/download")); await settle();
    const rows = () => page.$$eval("#src-cards .row-item", els => els.map(e => e.dataset.v + ":" + e.getAttribute("aria-checked") + ":" + e.querySelector(".ri-check").classList.contains("on")));
    assert((await rows()).join() === "auto:true:true,mirror:false:false,official:false:false", "初始选中不对：" + await rows());
    let before = reqs.length;
    await page.click('#src-cards .row-item[data-v="mirror"]'); await settle(250);
    assert(putConfig(before, "source"), "点选未保存");
    assert((await rows()).join() === "auto:false:false,mirror:true:true,official:false:false", "点选后选中不对：" + await rows());
    await page.focus('#src-cards .row-item[data-v="official"]');
    before = reqs.length;
    await page.keyboard.press("Enter"); await settle(250);
    assert(putConfig(before, "source") && (await rows())[2] === "official:true:true", "键盘未选中：" + await rows());
    await page.click('#src-cards .row-item[data-v="auto"]'); await settle(250); // 复原
    await page.click('.set-nav[data-sec="storage"]'); await settle();
    const g = await page.$eval("#set-body .group", el => [el.classList.contains("has-ico"), el.querySelectorAll(".row-item").length, el.querySelectorAll(".ri-ico").length]);
    assert(g.join() === "true,3,3", "存储位置分组不对：" + g);
    assert((await page.$eval('.set-nav.cur', a => a.dataset.sec)) === "storage" && (await page.$eval("#set-eyebrow", el => el.textContent)) === "设置/存储位置", "导航当前项或眉标未更新");
    await page.click('.set-nav[data-sec="startup"]'); await settle();
    before = reqs.length;
    await page.click('.row-item:has([data-cfg="minimizeToTray"]) .sw'); await settle(250);
    assert(putConfig(before, "minimizeToTray"), "开关未即时保存");
    await page.click('.row-item:has([data-cfg="minimizeToTray"]) .sw'); await settle(250); // 复原
  });

  await run("状态切换：卡片胶囊换成新状态并播换场，状态行随之展开 / 收起，操作按钮随状态切换", async () => {
    const setStatus = st => page.evaluate(s => fetch("/__mock/state", { method: "POST", body: JSON.stringify({ status: { "机械动力整合包": s } }) }), st);
    try {
      await page.goto(url("#/instances")); await settle(600);
      const card = '.card[data-name="机械动力整合包"]';
      assert(await page.$eval(card + " [data-stat]", el => el.classList.contains("closed")), "已停止的卡片不应显示状态行");
      await setStatus("starting");
      await page.dispatchEvent("#inst-q", "input"); // 触发重绘（等同下一轮轮询）
      await page.waitForSelector(card + " .st-pill.starting");
      const mid = await page.$eval(card, c => ({ out: !!c.querySelector(".st-label.out"), inl: c.querySelector(".st-label:not(.out)").classList.contains("in"), stop: !!c.querySelector('[data-act="stop"]') }));
      assert(mid.out && mid.inl, "胶囊文字没有换场：" + JSON.stringify(mid));
      assert(mid.stop, "启动中应显示「停止」");
      await page.waitForTimeout(400);
      const open = await page.$eval(card + " [data-stat]", el => [el.classList.contains("closed"), !!el.querySelector(".xp.warn.run")]);
      assert(!open[0] && open[1], "启动中状态行未展开：" + open);
      await setStatus("stopped");
      await page.dispatchEvent("#inst-q", "input");
      await page.waitForSelector(card + " .st-pill.stopped");
      await page.waitForTimeout(400);
      assert(await page.$eval(card + " [data-stat]", el => el.classList.contains("closed")), "停止后状态行未收起");
      assert((await page.$(card + ' [data-act="start"]')) !== null, "停止后应显示「启动」");
    } finally { await setStatus("stopped"); }
  });

  await run("冷启动白闪：原生窗口把标题栏底色上报存进配置，换配色后跟着更新；局域网浏览器不上报", async () => {
    const chromeOf = (p, scheme, theme) => p.evaluate(([s, t]) => fetch("/themes.css").then(r => r.text()).then(css =>
      (css.split(`[data-scheme="${s}"][data-theme="${t}"]`)[1].match(/--chrome:\s*([^;]+);/) || [])[1].trim()), [scheme, theme]);
    const cfg = p => p.evaluate(() => fetch("/api/app", { headers: { "X-Token": "mock" } }).then(r => r.json()).then(j => j.data.config.chromeColor));
    await page.evaluate(() => fetch("/api/config", { method: "PUT", headers: { "X-Token": "mock" }, body: JSON.stringify({ chromeColor: "" }) }));
    const c = await hostCtx({ host: true });
    try {
      const p = await c.newPage();
      await p.goto(ORIGIN + "#/settings/appearance"); await p.waitForTimeout(900);
      const theme = await p.evaluate(() => document.documentElement.dataset.theme);
      assert((await cfg(p)) === await chromeOf(p, "craft", theme), `启动后未上报默认方案的标题栏色：${await cfg(p)}`);
      await p.click('[data-scheme-pick="nord"]'); await p.waitForTimeout(800);
      assert((await cfg(p)) === await chromeOf(p, "nord", theme), `换配色后未更新：${await cfg(p)}`);
      const bad = await p.evaluate(() => fetch("/api/config", { method: "PUT", headers: { "X-Token": "mock" }, body: JSON.stringify({ chromeColor: "red" }) }).then(r => r.status));
      assert(bad === 400, "非法颜色应返回 400：" + bad);
      await p.click('[data-scheme-pick="craft"]'); await p.waitForTimeout(800);
    } finally { await c.close(); }
    const lan = await hostCtx({ host: false });
    try {
      const p = await lan.newPage();
      const puts = [];
      p.on("request", r => { if (r.method() === "PUT" && r.url().endsWith("/api/config")) puts.push(r.postData()); });
      await p.goto(ORIGIN + "?scheme=github#/instances"); await p.waitForTimeout(900);
      assert(!puts.some(b => b.includes("chromeColor")), "局域网浏览器不应上报界面底色：" + puts);
    } finally { await lan.close(); }
  });

  await run("减少动态：切页、菜单、弹窗、提示都不播动画（状态直接切换）", async () => {
    const c = await hostCtx({ host: true }, { reducedMotion: "reduce" });
    try {
      const p = await c.newPage();
      p.on("pageerror", e => errors.push(e.message));
      const running = () => p.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length);
      await p.goto(ORIGIN + "#/instances"); await p.waitForTimeout(400);
      await p.click('.card[data-name="机械动力整合包"] [data-act="more"]');
      assert((await running()) === 0, "菜单进场仍有动画");
      await p.click(".dropmenu button.danger");
      assert((await running()) === 0, "弹窗进场仍有动画");
      await p.keyboard.press("Escape");
      assert((await p.$(".modal")) === null, "减少动态下弹窗应立即移除");
      await p.click('#sidebar a[data-nav="settings"]'); await p.waitForTimeout(300);
      await p.click('.set-nav[data-sec="appearance"]'); await p.waitForTimeout(300);
      await p.click('[data-mode="light"]');
      assert((await running()) === 0, "切页 / 键帽滑动仍有动画");
    } finally { await c.close(); }
  });

  await run("CurseForge Key 只写不读：已设置时输入框留空、占位写「已设置」，可清除；解不开时提示重填；导入页提示跟随 cfKeySet", async () => {
    const mockState = b => page.evaluate(x => fetch("/__mock/state", { method: "POST", body: JSON.stringify(x) }), b);
    const appText = () => page.evaluate(() => fetch("/api/app", { headers: { "X-Token": "mock" } }).then(r => r.text()));
    const importHint = async () => {
      await page.goto(url("#/create")); await settle();
      await page.click("#mode-import"); await settle();
      return page.evaluate(() => [...document.querySelectorAll(".hint")].some(h => h.textContent.includes("需要 API Key")));
    };
    const field = () => page.evaluate(() => ({ v: document.querySelector("#cf-key").value, ph: document.querySelector("#cf-key").placeholder,
      clear: !document.querySelector("#cf-clear").hidden, save: !document.querySelector("#cf-save").disabled, sub: document.querySelector("#cf-sub").textContent }));
    await mockState({ cfKey: "", cfKeyBroken: false });
    try {
      assert(await importHint(), "没设置 Key 时导入页应提示需要 API Key");
      await page.goto(url("#/settings/download")); await settle();
      let f = await field();
      assert(f.v === "" && f.ph === "粘贴 API Key" && !f.clear && !f.save, "未设置时：" + JSON.stringify(f));
      const key = "cf-test-key-" + Date.now();
      await page.fill("#cf-key", key);
      const before = reqs.length;
      await page.press("#cf-key", "Enter"); await settle(300);
      assert(putConfig(before, "cfApiKey"), "回车未保存");
      f = await field();
      assert(f.v === "" && f.ph.includes("已设置") && f.clear && !f.save, "保存后输入框应清空、占位写「已设置」、出现「清除」：" + JSON.stringify(f));
      const info = await appText();
      assert(!info.includes(key) && JSON.parse(info).data.cfKeySet === true, "/api/app 不应下发 Key，应给 cfKeySet：" + info);
      await page.reload(); await settle();
      f = await field();
      assert(f.v === "" && f.ph.includes("已设置") && f.clear, "重新打开后：" + JSON.stringify(f));
      assert(!(await importHint()), "已设置 Key 时导入页不应再提示");
      // 清除：危险操作多一步，确认框默认聚焦「取消」
      await page.goto(url("#/settings/download")); await settle();
      await page.click("#cf-clear"); await settle(200);
      assert((await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim())) === "取消", "清除确认框应默认聚焦「取消」");
      const b2 = reqs.length;
      await page.click('.modal [data-x="ok"]'); await settle(300);
      assert(reqs.slice(b2).some(r => r.m === "PUT" && r.u === "/api/config" && JSON.parse(r.b || "{}").cfApiKey === ""), "清除应发 cfApiKey 空串");
      f = await field();
      assert(f.ph === "粘贴 API Key" && !f.clear && JSON.parse(await appText()).data.cfKeySet === false, "清除后：" + JSON.stringify(f));
      // 存着的 Key 解不开（换了电脑或 Windows 用户）
      await mockState({ cfKey: "old", cfKeyBroken: true });
      await page.goto(url("#/settings/download")); await settle();
      f = await field();
      assert(f.sub.includes("无法解开") && f.ph === "粘贴 API Key" && f.clear, "解不开时应提示重填：" + JSON.stringify(f));
    } finally { await mockState({ cfKey: "", cfKeyBroken: false }); }
  });

  await run("隧道：凭据解不开（换了电脑或 Windows 用户）时，这一行说明原因，优先于上次的公网地址", async () => {
    const mockState = b => page.evaluate(x => fetch("/__mock/state", { method: "POST", body: JSON.stringify(x) }), b);
    await mockState({ credBroken: "t1" });
    try {
      await page.goto(url("#/tunnels")); await settle(600);
      const rows = await page.$$eval("#tun-list .java-row", els => els.map(e => e.textContent));
      assert(rows[0].includes("凭据无法解开") && !rows[0].includes("openfrp.top"), "解不开的隧道应显示原因：" + rows[0]);
      assert(!rows[1].includes("凭据无法解开"), "别的隧道不受影响：" + rows[1]);
    } finally { await mockState({ credBroken: "" }); }
  });

  // ---- 设置 → AI（设计文档 §4）：仿真后端的 /api/ai/* 与 ai.Service 同一套规则 ----
  const aiState = b => page.evaluate(x => fetch("/__mock/state", { method: "POST", body: JSON.stringify({ ai: x }) }), b);
  const toastHas = (s, timeout = 2000) => page.waitForFunction(x => [...document.querySelectorAll(".toast")].some(t => t.textContent.includes(x)), s, { timeout }).then(() => true, () => false);
  const aiForm = () => page.evaluate(() => {
    const q = s => document.querySelector(s);
    return { preset: q("#ai-preset").value, opts: [...q("#ai-preset").options].map(o => o.textContent), url: q("#ai-url").value, model: q("#ai-model").value,
      key: q("#ai-key").value, keyPh: q("#ai-key").placeholder, keySub: q("#ai-key-sub").textContent, clear: !q("#ai-key-clear").hidden,
      proto: !q(".ai-proto-row").hidden, effort: !q(".ai-effort-row").hidden, status: q("#ai-status").textContent,
      dirty: !!q(".save-bar.dirty"), test: !q("#ai-test").disabled, priceSrc: q("#ai-price-src").textContent };
  });
  const putBody = (since, path) => { const r = reqs.slice(since).filter(x => x.m === "PUT" && x.u === path).pop(); return r ? JSON.parse(r.b || "{}") : null; };
  const AI_DEEPSEEK = { preset: "deepseek", protocol: "openai", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" };
  const AI_CLAUDE = { preset: "claude", protocol: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" };

  await run("AI：没配置时不预选、不推荐，打开页面只读设置不联网；选预设填好地址和建议模型；Key 只写不读（保存后留空、占位写「已设置」）", async () => {
    await aiState({ reset: true });
    try {
      const t0 = reqs.length;
      await page.goto(url("#/settings/ai")); await settle();
      let f = await aiForm();
      assert(f.preset === "" && f.opts[0] === "未选择" && !f.opts.some(o => o.includes("推荐")), "没配置时不应预选或推荐：" + f.opts);
      assert(f.status.includes("未启用") && !f.test && !f.dirty && f.priceSrc.includes("才会下载"), "没配置时：" + JSON.stringify(f));
      const aiReqs = reqs.slice(t0).filter(r => r.u.startsWith("/api/ai/")).map(r => r.m + " " + r.u);
      assert(aiReqs.length > 0 && aiReqs.every(r => r === "GET /api/ai/settings"), "打开页面只应读设置：" + aiReqs);
      await page.selectOption("#ai-preset", "deepseek"); await settle(150);
      f = await aiForm();
      assert(f.url === "https://api.deepseek.com" && f.model === "deepseek-v4-flash" && !f.proto && !f.effort && f.dirty, "选 DeepSeek 后：" + JSON.stringify(f));
      const key = "sk-ai-test-" + Date.now();
      await page.fill("#ai-key", key);
      const t1 = reqs.length;
      await page.click('[data-sb="save"]'); await settle(300);
      const b = putBody(t1, "/api/ai/provider");
      assert(b && b.key === key && b.preset === "deepseek" && b.baseUrl === "https://api.deepseek.com", "保存应带上新 Key：" + JSON.stringify(b));
      f = await aiForm();
      assert(f.key === "" && f.keyPh.includes("已设置") && f.clear && !f.dirty && f.status.includes("已启用") && f.test, "保存后：" + JSON.stringify(f));
      assert(!f.opts.includes("未选择"), "配过之后不应再有「未选择」（停用走「停用 AI」）");
      const view = await page.evaluate(() => fetch("/api/ai/settings", { headers: { "X-Token": "mock" } }).then(r => r.text()));
      assert(!view.includes(key) && JSON.parse(view).data.keySet === true, "设置接口不应下发 Key：" + view.slice(0, 160));
      await page.reload(); await settle();
      f = await aiForm();
      assert(f.key === "" && f.keyPh.includes("已设置") && f.preset === "deepseek" && !(await page.content()).includes(key), "重新打开后：" + JSON.stringify(f));
    } finally { await aiState({ reset: true }); }
  });

  await run("AI：改了接口地址先提示旧 Key 会清掉，保存后要重填；清除 Key 要确认；停用 AI 清掉服务商设置", async () => {
    await aiState({ reset: true, ...AI_DEEPSEEK, key: "sk-old" });
    try {
      await page.goto(url("#/settings/ai")); await settle();
      let f = await aiForm();
      assert(f.keyPh.includes("已设置") && f.clear, "已设置 Key：" + JSON.stringify(f));
      await page.fill("#ai-url", "https://api.deepseek.com/v1"); await settle(100);
      f = await aiForm();
      assert(f.keySub.includes("原来的 Key 会清掉") && !f.clear && f.keyPh === "粘贴 API Key" && f.dirty, "改地址后应提示：" + JSON.stringify(f));
      await page.click('[data-sb="save"]'); await settle(300);
      f = await aiForm();
      assert(f.status.includes("未启用") && f.status.includes("填写 Key") && f.keyPh === "粘贴 API Key" && !f.clear && !f.test, "保存后旧 Key 应清掉：" + JSON.stringify(f));
      assert(await toastHas("还差：填写 Key"), "应提示还差什么");
      await page.fill("#ai-key", "sk-new"); await page.click('[data-sb="save"]'); await settle(300);
      f = await aiForm();
      assert(f.status.includes("已启用") && f.keyPh.includes("已设置"), "重填后：" + JSON.stringify(f));
      // 清除 Key：危险操作多一步，确认框默认聚焦「取消」
      await page.click("#ai-key-clear"); await settle(200);
      assert((await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim())) === "取消", "清除确认框应默认聚焦「取消」");
      let t1 = reqs.length;
      await page.click('.modal [data-x="ok"]'); await settle(300);
      assert((putBody(t1, "/api/ai/provider") || {}).key === "", "清除应发 key 空串");
      f = await aiForm();
      assert(f.keyPh === "粘贴 API Key" && !f.clear && f.status.includes("未启用"), "清除后：" + JSON.stringify(f));
      // 停用 AI：清掉服务商设置，回到没配置
      await page.click("#ai-off"); await settle(200);
      t1 = reqs.length;
      await page.click('.modal [data-x="ok"]'); await settle(500);
      assert((putBody(t1, "/api/ai/provider") || {}).preset === "", "停用应发 preset 空串");
      f = await aiForm();
      assert(f.preset === "" && f.url === "" && !(await page.$eval("#ai-off-zone", z => !z.hidden)), "停用后：" + JSON.stringify(f));
    } finally { await aiState({ reset: true }); }
  });

  await run("AI：获取模型列表填进可选列表；测试连接只认保存过的设置，显示延迟和能否调用工具；思考深度只对 Claude、协议只对自定义", async () => {
    await aiState({ reset: true });
    try {
      await page.goto(url("#/settings/ai")); await settle();
      await page.selectOption("#ai-preset", "custom"); await settle(100);
      let f = await aiForm();
      assert(f.proto && !f.effort && f.url === "" && f.keySub.includes("中转方能看到"), "自定义：" + JSON.stringify(f));
      await page.selectOption("#ai-proto", "anthropic"); await settle(100);
      assert((await aiForm()).effort, "自定义走 Claude 协议时应显示思考深度");
      await page.selectOption("#ai-preset", "claude"); await settle(100);
      f = await aiForm();
      assert(!f.proto && f.effort && f.url === "https://api.anthropic.com" && f.model === "claude-opus-5-5", "选 Claude 后：" + JSON.stringify(f));
      await page.click("#ai-list");
      assert(await toastHas("先填写 Key"), "没填 Key 时获取模型列表应提示");
      await page.fill("#ai-key", "sk-ant-test");
      await page.click("#ai-list"); await settle(300);
      const opts = await page.$$eval("#ai-models option", os => os.map(o => o.value));
      assert(opts.length === 3 && opts.includes("claude-sonnet-5-5"), "模型列表：" + opts);
      assert((await page.textContent("#ai-model-sub")).includes("取到 3 个模型"), "应提示取到几个模型");
      await page.selectOption("#ai-effort", "high");
      let t0 = reqs.length;
      await page.click('[data-sb="save"]'); await settle(300);
      const b = putBody(t0, "/api/ai/provider");
      assert(b && b.preset === "claude" && b.effort === "high" && b.key === "sk-ant-test" && !("protocol" in b), "保存 Claude：" + JSON.stringify(b));
      // 改了还没保存：不发测试请求，提示先保存
      await page.fill("#ai-model", "claude-sonnet-5-5");
      t0 = reqs.length;
      await page.click("#ai-test");
      assert(await toastHas("先保存服务商设置"), "未保存时应提示先保存");
      assert(!reqs.slice(t0).some(r => r.u === "/api/ai/test"), "未保存时不应发测试请求");
      await page.click('[data-sb="save"]'); await settle(300);
      await page.click("#ai-test"); await settle(300);
      let sub = await page.textContent("#ai-test-sub");
      assert(sub.includes("连接正常") && sub.includes("820 ms") && sub.includes("能调用工具") && sub.includes("168 token"), "测试结果：" + sub);
      await aiState({ testFail: true });
      await page.click("#ai-test"); await settle(300);
      sub = await page.textContent("#ai-test-sub");
      assert(sub.includes("连接失败") && sub.includes("Key 不对"), "测试失败时：" + sub);
    } finally { await aiState({ reset: true }); }
  });

  await run("AI：每日额度按万 token 保存，填错就近提示；自填单价可添加、删除，优先于公开价格；只配本机模型时不取价格", async () => {
    await aiState({ reset: true, ...AI_CLAUDE, key: "sk-ant" });
    try {
      await page.goto(url("#/settings/ai")); await settle();
      const qsub = await page.textContent("#q-sub-assistant");
      assert(qsub.includes("今天已用 12.3 万 token（约 $0.03）") && qsub.includes("约 $0.42 + ¥1.30") && qsub.includes("1 次查不到价格"), "用量：" + qsub);
      let t0 = reqs.length;
      await page.fill("#q-assistant", "5"); await page.press("#q-assistant", "Enter"); await settle(300);
      assert((putBody(t0, "/api/ai/quota") || {}).assistant === 50000, "额度应按万 token 换算");
      assert(await toastHas("每天最多 5 万 token"), "应提示新额度");
      t0 = reqs.length;
      await page.fill("#q-assistant", "-1"); await page.press("#q-assistant", "Enter"); await settle(200);
      assert((await page.textContent("#q-err-assistant")).includes("不小于 0") && await page.$eval("#q-assistant", e => e.classList.contains("invalid")), "填错应就近提示");
      assert(!putBody(t0, "/api/ai/quota"), "填错不应保存");
      await page.fill("#q-assistant", ""); await page.press("#q-assistant", "Enter"); await settle(300);
      assert((putBody(t0, "/api/ai/quota") || {}).assistant === 0 && (await page.textContent("#q-err-assistant")) === "", "清空即不限");
      // 公开价格：手动刷新后显示当前模型的单价
      assert((await page.textContent("#ai-price-src")).includes("还没取到"), "还没取价格时：" + await page.textContent("#ai-price-src"));
      await page.click("#ai-price-refresh"); await settle(300);
      assert((await page.textContent("#ai-price-src")).includes("2026-10-28 更新"), "刷新后：" + await page.textContent("#ai-price-src"));
      assert((await page.textContent("#ai-model-price")).startsWith("公开价格：输入 $4 · 输出 $20"), "公开价格：" + await page.textContent("#ai-model-price"));
      // 自填单价（人民币，不做汇率换算）：缺输出单价时就近提示；填好后优先于公开价格
      await page.selectOption("#cp-cur", "CNY");
      await page.fill("#cp-in", "30");
      await page.click("#cp-add"); await settle(150);
      assert((await page.textContent("#cp-err")).includes("输入和输出单价都要填"), "缺输出单价应就近提示");
      await page.fill("#cp-out", "150");
      t0 = reqs.length;
      await page.click("#cp-add"); await settle(300);
      const pb = putBody(t0, "/api/ai/prices");
      assert(pb && JSON.stringify(pb.prices) === JSON.stringify([{ model: "claude-opus-5-5", currency: "CNY", input: 30, output: 150 }]), "自填单价：" + JSON.stringify(pb));
      assert((await page.textContent("#ai-model-price")).startsWith("自填：输入 ¥30 · 输出 ¥150"), "自填的应优先：" + await page.textContent("#ai-model-price"));
      t0 = reqs.length;
      await page.click('[data-del-price="0"]'); await settle(300);
      assert((putBody(t0, "/api/ai/prices") || {}).prices.length === 0 && !(await page.$("[data-del-price]")), "删除自填单价");
      assert((await page.textContent("#ai-model-price")).startsWith("公开价格"), "删掉后回到公开价格");
      // 只配了 Ollama：不花钱，不取价格，不用 Key
      await aiState({ preset: "ollama", protocol: "openai", baseUrl: "http://localhost:11434/v1/", model: "qwen3:8b", key: "" });
      await page.goto(url("#/settings/ai")); await settle();
      const f = await aiForm();
      assert(f.priceSrc.includes("本机模型不花钱") && await page.$eval("#ai-price-refresh", e => e.disabled), "本机模型不应取价格：" + f.priceSrc);
      assert((await page.textContent("#ai-model-price")).includes("本机模型，不计费") && f.keyPh === "不用 Key" && f.status.includes("已启用"), "本机模型：" + JSON.stringify(f));
    } finally { await aiState({ reset: true }); }
  });

  await run("AI：局域网打开只能看——提示仅本机修改，控件全部禁用，没有保存条和「停用 AI」", async () => {
    await aiState({ reset: true, ...AI_DEEPSEEK, key: "sk-x", local: false });
    try {
      const t0 = reqs.length;
      await page.goto(url("#/settings/ai")); await settle();
      const r = await page.evaluate(() => ({
        warn: [...document.querySelectorAll("#set-body .warn-card")].map(w => w.textContent).join(""),
        live: [...document.querySelectorAll("#set-body input, #set-body select, #set-body button")].filter(e => !e.disabled && !e.hidden).map(e => e.id || e.outerHTML.slice(0, 40)),
        bar: !!document.querySelector("#set-body .save-bar"), off: !!document.querySelector("#ai-off-zone"),
        ph: document.querySelector("#ai-key").placeholder, clear: !document.querySelector("#ai-key-clear").hidden }));
      assert(r.warn.includes("仅支持在本机修改"), "应提示仅本机修改：" + r.warn);
      assert(r.live.length === 0, "局域网下仍能操作：" + r.live);
      assert(!r.bar && !r.off && r.ph === "已设置" && !r.clear, "局域网下：" + JSON.stringify(r));
      assert(!reqs.slice(t0).some(x => x.u.startsWith("/api/ai/") && x.m !== "GET"), "局域网下不应发修改请求");
    } finally { await aiState({ reset: true }); }
  });

  await run("AI：手机宽度（390px）下分区不横向溢出", async () => {
    await aiState({ reset: true, preset: "custom", protocol: "anthropic", baseUrl: "https://relay.example.com", model: "claude-opus-5-5", key: "sk",
      prices: [{ model: "claude-opus-5-5", currency: "CNY", input: 30, output: 150, cacheRead: 3 }] });
    const c = await hostCtx({ host: false }, { viewport: { width: 390, height: 844 } });
    try {
      const p = await c.newPage();
      p.on("pageerror", e => errors.push(e.message));
      await p.goto(ORIGIN + "#/settings/ai"); await p.waitForTimeout(900);
      const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        wide: [...document.querySelectorAll("#set-body *")].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.id || e.className).slice(0, 5) }));
      assert(w.sw <= w.cw && w.wide.length === 0, "横向溢出：" + JSON.stringify(w));
    } finally { await c.close(); await aiState({ reset: true }); }
  });

  // ==================== 第五阶段：音乐共享（music.js）====================
  // 仿真后端的场景见 server.js 的 musicMockState；POST 的请求体单独记一份（上面的 reqs 只记 PUT 的）
  const musicState = b => page.evaluate(x => fetch("/__mock/state", { method: "POST", body: JSON.stringify(x) }).then(r => r.json()).then(j => j.data), b);
  const posts = [];
  page.on("request", r => { if (r.method() === "POST") posts.push({ u: decodeURIComponent(new URL(r.url()).pathname), b: r.postData() || "" }); });
  const postsTo = (since, suffix) => posts.slice(since).filter(x => x.u.endsWith(suffix));
  const PACK = "机械动力整合包";
  const openMusic = async (state, status = "running") => {
    await musicState({ music: { reset: true, ...state }, status: { [PACK]: status } });
    await page.goto(url("#/inst/" + encodeURIComponent(PACK) + "/music")); await settle(900);
  };
  const resetMusic = () => musicState({ music: { reset: true }, status: { [PACK]: "stopped" } });

  await run("音乐共享：只有 Forge 系的服务器有这个标签；检查清单列出 SVC、桥接模组、语音端口、远程语音；点「安装」装上桥接模组", async () => {
    try {
      await page.goto(url("#/inst/" + inst + "/console")); await settle();
      assert(!(await page.$('.tabs [data-t="music"]')), "Paper 服不该有音乐共享标签");
      await openMusic({}, "stopped");
      assert(await page.$('.tabs [data-t="music"].cur'), "Forge 服应有音乐共享标签并选中");
      const check = await page.textContent("#mu-check");
      for (const s of ["核心：Forge 1.20.1", "已装 1.20.1-2.5.24", "桥接模组：还没装", "语音端口：UDP 24454", "没有语音隧道", "voice_host = （空）"])
        assert(check.includes(s), `检查清单里没有「${s}」：${check}`);
      assert(await page.$eval("#mu-start", b => b.disabled) && (await page.textContent("#mu-why")).includes("先装桥接模组"), "没装桥接模组时不能开始");
      const t0 = posts.length;
      await page.click('[data-install="main"]'); await settle(500);
      const ins = postsTo(t0, "/music/install");
      assert(ins.length === 1 && JSON.parse(ins[0].b).variant === "main", "安装请求：" + JSON.stringify(ins));
      assert(await toastHas("已装好桥接模组"), "应提示装好了");
      assert((await page.textContent("#mu-check")).includes("已装 0.2.0 版"), "装好后检查清单没更新：" + await page.textContent("#mu-check"));
      assert((await page.textContent("#mu-why")).includes("先开服"), "装好后还差开服：" + await page.textContent("#mu-why"));
    } finally { await resetMusic(); }
  });

  await run("音乐共享：Win11 选一个正在出声的程序开始广播，选音源时电平跟着刷新；广播中显示听众、不再列音源；停止后回到选音源", async () => {
    try {
      await openMusic({ inst: { [PACK]: { bridge: "main" } } });
      const rows = await page.$$eval("#mu-src [data-pid]", rs => rs.map(r => ({ exe: r.dataset.exe, on: r.getAttribute("aria-checked") === "true", lit: r.querySelectorAll(".xp i.on").length })));
      assert(rows.length === 3 && rows[0].exe === "cloudmusic.exe" && rows[0].on && rows[0].lit > 0, "音源列表：" + JSON.stringify(rows));
      assert(!rows.find(r => r.exe === "QQMusic.exe").lit, "没声音的程序电平应为空");
      const s0 = reqs.length;
      await page.waitForTimeout(2200);
      assert(reqs.slice(s0).filter(r => r.u === "/api/music/sources").length >= 2, "选音源时应每秒刷新电平");
      await page.click('#mu-src [data-exe="msedge.exe"]'); await settle(150);
      assert(await page.$eval('#mu-src [data-exe="msedge.exe"]', r => r.getAttribute("aria-checked") === "true"), "点选后应选中 msedge.exe");
      assert(!(await page.$eval("#mu-start", b => b.disabled)), "都就绪了应能开始");
      const t0 = posts.length;
      await page.click("#mu-start"); await settle(600);
      const st = postsTo(t0, "/music/start");
      assert(st.length === 1 && JSON.stringify(JSON.parse(st[0].b)) === JSON.stringify({ mode: "process", pid: 7788, exe: "msedge.exe" }), "开始广播的请求：" + JSON.stringify(st));
      const live = await page.textContent("#mu-cast");
      assert(live.includes("正在广播") && live.includes("msedge.exe") && live.includes("2 人在听"), "广播中：" + live);
      const s1 = reqs.length;
      await page.waitForTimeout(2200);
      assert(!reqs.slice(s1).some(r => r.u === "/api/music/sources"), "广播中不该再列音源");
      await page.click("#mu-stop"); await settle(600);
      assert(postsTo(t0, "/music/stop").length === 1, "应发停止请求");
      assert(await page.$("#mu-src") && (await page.textContent("#mu-last")).includes("用户停止"), "停止后应回到选音源，并写明上次怎么停的");
    } finally { await resetMusic(); }
  });

  await run("音乐共享：只能录整机时先警告，点「仍然录整机」才开始（默认聚焦取消，取消不开始）；确认过就记住", async () => {
    try {
      await openMusic({ cap: "win10", inst: { [PACK]: { bridge: "main" } } });
      assert((await page.textContent("#mu-cast")).includes("这台电脑只能录整机的声音"), "Win10 应先写明只能录整机");
      assert(!(await page.$("#mu-src")), "整机录音不列程序");
      let t0 = posts.length;
      await page.click("#mu-start"); await settle(250);
      assert((await page.textContent(".modal")).includes("游戏声音、语音聊天"), "应弹出整机录音的警告");
      assert(await page.evaluate(() => document.activeElement.textContent.trim()) === "先不录", "默认应聚焦取消");
      await page.click('.modal [data-x="cancel"]'); await settle(250);
      assert(!postsTo(t0, "/music/start").length && !postsTo(t0, "/confirm-system").length, "取消后不该开始，也不该记下确认");
      await page.click("#mu-start"); await settle(250);
      await page.click('.modal [data-x="ok"]'); await settle(700);
      const cf = postsTo(t0, "/api/music/confirm-system"), st = postsTo(t0, "/music/start");
      assert(cf.length === 1 && st.length === 1 && JSON.parse(st[0].b).mode === "system", "确认后应先记下确认再开始：" + JSON.stringify(st));
      assert((await page.textContent("#mu-cast")).includes("正在录整机声音"), "广播中应一直提示正在录整机");
      await page.click("#mu-stop"); await settle(600);
      t0 = posts.length;
      await page.click("#mu-start"); await settle(600);
      assert(!(await page.$(".modal")) && postsTo(t0, "/music/start").length === 1, "确认过以后不该再问");
      await page.click("#mu-stop"); await settle(400);
    } finally { await resetMusic(); }
  });

  await run("音乐共享：voice_host 和隧道地址不一样时不覆盖，可以改用隧道地址；手动填写、「我在游戏里的名字」写错就近提示；音量即时保存", async () => {
    try {
      await openMusic({ voiceTunnel: true, inst: { [PACK]: { bridge: "main", voiceHost: "my.domain.com:24454" } } });
      let check = await page.textContent("#mu-check");
      assert(check.includes("voice_host 和隧道地址不一样") && check.includes("my.domain.com:24454") && check.includes("frp-abc.natfrp.cloud:34567"), "两个地址不一样时：" + check);
      let t0 = reqs.length;
      await page.click("#mu-vh-tunnel"); await settle(500);
      assert(JSON.stringify(putBody(t0, "/api/instances/" + encodeURIComponent(PACK) + "/music/voicehost")) === JSON.stringify({ fromTunnel: true }), "改用隧道地址的请求");
      assert(await toastHas("重启服务器后生效"), "运行中改的应提示重启后生效");
      check = await page.textContent("#mu-check");
      assert(check.includes("voice_host = frp-abc.natfrp.cloud:34567") && (await page.textContent("#mu-restart")).includes("voice_host"), "改完：" + check);
      // 手动填写：格式不对时报错写在输入框下面
      await page.click("#mu-vh-toggle"); await settle(150);
      await page.fill("#mu-vh", "不是地址!"); await page.press("#mu-vh", "Enter"); await settle(400);
      assert((await page.textContent("#mu-vh-err")).includes("语音地址不对") && await page.$eval("#mu-vh", e => e.classList.contains("invalid")), "手动填写写错应就近提示");
      // 我在游戏里的名字：有不能用的字符时不发请求
      t0 = reqs.length;
      await page.fill("#mu-ex", "Steve:1"); await page.press("#mu-ex", "Enter"); await settle(200);
      assert((await page.textContent("#mu-ex-err")).includes("不能用的字符") && !putBody(t0, "/api/instances/" + encodeURIComponent(PACK) + "/music/settings"), "名字写错应就近提示、不保存");
      await page.fill("#mu-ex", "Steve"); await page.press("#mu-ex", "Enter"); await settle(300);
      assert(JSON.stringify(putBody(t0, "/api/instances/" + encodeURIComponent(PACK) + "/music/settings")) === JSON.stringify({ exclude: "Steve" }) && (await page.textContent("#mu-ex-err")) === "", "名字应保存");
      await page.waitForTimeout(2200);
      assert((await page.textContent("#mu-players")).includes("不再发给他"), "排除名单里的人应单独列出：" + await page.textContent("#mu-players"));
      t0 = reqs.length;
      await page.$eval("#mu-vol", e => { e.value = "150"; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change")); });
      await settle(300);
      assert((putBody(t0, "/api/instances/" + encodeURIComponent(PACK) + "/music/settings") || {}).volume === 150 && (await page.textContent("#mu-vol-v")) === "150%", "音量应即时保存");
    } finally { await resetMusic(); }
  });

  await run("音乐共享：局域网打开不列音源、不给开始（录的是主机的声音），能停止主机上开始的广播", async () => {
    try {
      await openMusic({ inst: { [PACK]: { bridge: "main" } } });
      await page.click("#mu-start"); await settle(500);
      await musicState({ music: { local: false } });
      const s0 = reqs.length;
      await page.goto(url("#/inst/" + encodeURIComponent(PACK) + "/music")); await settle(900);
      assert((await page.textContent("#mu-cast")).includes("正在广播") && await page.$("#mu-stop"), "局域网也能看到正在广播、能停止");
      await page.click("#mu-stop"); await settle(600);
      assert((await page.textContent("#mu-cast")).includes("开始广播只能在主机上操作") && !(await page.$("#mu-start")), "局域网不给开始");
      await page.waitForTimeout(1500);
      assert(!reqs.slice(s0).some(r => r.u === "/api/music/sources"), "局域网不该列音源");
    } finally { await resetMusic(); }
  });

  await run("隧道：用途选「语音」时写明怎么建（SVC 端口取自绑定的服务器），自定义 frps 默认 UDP；请求体带上用途和协议；列表标出语音隧道", async () => {
    try {
      await musicState({ music: { reset: true, voiceTunnel: true } });
      await page.goto(url("#/tunnels")); await settle();
      assert((await page.textContent("#tun-list")).includes("语音"), "列表应标出语音隧道");
      await page.click("#tn-toggle");
      await page.selectOption("#tn-provider", "custom");
      assert(await page.$eval("#tn-voice-tip", e => e.hidden) && await page.$eval("#tn-proto", e => e.value) === "tcp", "默认是游戏隧道、TCP");
      await page.selectOption("#tn-bound", PACK);
      await page.selectOption("#tn-purpose", "voice"); await settle(300);
      const tip = await page.textContent("#tn-voice-tip");
      assert(tip.includes("24454") && tip.includes(PACK) && tip.includes("UDP"), "语音隧道的说明：" + tip);
      assert(await page.$eval("#tn-proto", e => e.value) === "udp" && await page.$eval("#tn-lport", e => e.value) === "24454", "自定义 frps 选语音时应默认 UDP、本地端口填 SVC 的");
      await page.fill("#tn-name", "语音线 2"); await page.fill("#tn-saddr", "1.2.3.4"); await page.fill("#tn-rport", "34567");
      await page.click("#tn-add"); await settle(400);
      const body = (await musicState({})).music.tunnelBody;
      assert(body && body.purpose === "voice" && body.proto === "udp" && body.localPort === 24454 && body.boundInstance === PACK, "添加隧道的请求体：" + JSON.stringify(body));
    } finally { await resetMusic(); }
  });

  await run("音乐共享：手机宽度（390px）下不横向溢出", async () => {
    await musicState({ music: { reset: true, voiceTunnel: true, inst: { [PACK]: { bridge: "main", voiceHost: "my.domain.com:24454" } } }, status: { [PACK]: "running" } });
    const c = await hostCtx({ host: false }, { viewport: { width: 390, height: 844 } });
    try {
      const p = await c.newPage();
      p.on("pageerror", e => errors.push(e.message));
      await p.goto(ORIGIN + "#/inst/" + encodeURIComponent(PACK) + "/music"); await p.waitForTimeout(1200);
      await p.click("#mu-adv-head"); await p.waitForTimeout(200);
      const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        wide: [...document.querySelectorAll("#tab-body *")].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.id || e.className).slice(0, 5) }));
      assert(w.sw <= w.cw && w.wide.length === 0, "横向溢出：" + JSON.stringify(w));
    } finally { await c.close(); await resetMusic(); }
  });
  // ==================== 第五阶段结束 ====================
  // ================================ 第三阶段：应用内 AI 助手 ================================
  // 仿真后端里假的 AI 按用户的话挑回复（见 server.js 的「第三阶段」）；asstState 返回 asst 的状态（executed = 确认后执行过的操作）
  const asstState = b => page.evaluate(x => fetch("/__mock/state", { method: "POST", body: JSON.stringify({ asst: x }) }).then(r => r.json()).then(j => j.data.asst), b);
  const conPage = name => url("#/inst/" + encodeURIComponent(name) + "/console");
  const reply = (s, timeout = 5000) => page.waitForFunction(x => [...document.querySelectorAll("#ap-body .ap-msg.assistant .md")].some(e => e.textContent.includes(x)), s, { timeout });
  const idle = () => page.waitForFunction(() => { const b = document.querySelector("#ap-stop"); return b && b.hidden; }, null, { timeout: 5000 });

  await run("AI 助手：没配置 AI 时报错横幅照样出现（本地规则的结论和怎么修），不带「让 AI 分析」；关掉后这一次不再提示；入口引导去设置，Esc 关闭", async () => {
    await aiState({ reset: true }); await asstState({ reset: true });
    await page.goto(conPage("机械动力整合包")); await settle(700);
    const b = await page.$eval(".diag-banner", e => ({ text: e.textContent, err: e.classList.contains("err") })).catch(() => null);
    assert(b && b.err && b.text.includes("缺少前置模组") && b.text.includes("一共认出 2 个问题"), "横幅：" + JSON.stringify(b));
    assert(!(await page.$('.diag-banner [data-x="ai"]')), "没配置 AI 时不应有「让 AI 分析」");
    await page.click(".db-more summary");
    assert((await page.textContent(".db-more")).includes("怎么修"), "展开后应有修复建议");
    await page.click('.diag-banner [data-x="close"]');
    assert(!(await page.$(".diag-banner")), "关闭后横幅应消失");
    await page.goto(conPage("机械动力整合包")); await settle(700);
    assert(!(await page.$(".diag-banner")), "同一次的问题关掉后不应再出现");
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(conPage("生存服 · 朋友")); await settle(700);
    assert(!(await page.$(".diag-banner")), "没有问题时不应有横幅");
    await page.click("#ai-btn"); await settle(300);
    assert((await page.textContent("#ap-body")).includes("AI 还没配置") && !!(await page.$('#ap-body [data-x="setup"]')), "没配置 AI 时面板应引导去设置");
    await page.keyboard.press("Escape"); await settle(300);
    assert(!(await page.$("#ai-panel")), "Esc 应关闭面板");
  });

  await run("AI 助手：「让 AI 分析」先给发送预览（字数、可展开、隐私信息是占位符，取消就不发），发送后流式回复；读操作不弹确认，写操作确认后按提案参数原样执行", async () => {
    await aiState({ reset: true, ...AI_DEEPSEEK, key: "sk-x" }); await asstState({ reset: true });
    try {
      await page.goto(conPage("机械动力整合包")); await settle(700);
      await page.click('.diag-banner [data-x="ai"]');
      await page.waitForSelector(".modal.ap-pv");
      const pv = await page.evaluate(() => ({ body: document.querySelector(".ap-pv .m-body").textContent, q: document.querySelector(".ap-pv textarea").value,
        pre: document.querySelector(".ap-pv .ap-pre").textContent, open: document.querySelector(".ap-pv-more").open }));
      assert(/将发送约 \d+ 字/.test(pv.body) && pv.q.includes("分析") && !pv.open, "预览：" + JSON.stringify(pv).slice(0, 200));
      assert(pv.pre.includes("<用户目录>") && pv.pre.includes("<局域网IP>") && !/C:\\Users\\|192\.168\./.test(pv.pre), "占位符应原样显示：" + pv.pre.slice(0, 200));
      await page.click(".ap-pv-more summary");
      assert(await page.$eval(".ap-pv-more", d => d.open), "应能展开查看全文");
      await page.click('.modal [data-x="cancel"]'); await settle(300);
      let a = await asstState({});
      assert(a.sessions.length === 0 && !(await page.$("#ai-panel")), "取消后不发送，也不留下空会话：" + a.sessions.length);
      await page.click('.diag-banner [data-x="ai"]');
      await page.waitForSelector(".modal.ap-pv");
      await page.click('.modal [data-x="ok"]');
      await page.waitForSelector("#ai-panel .ap-card.pending", { timeout: 5000 });
      const v = await page.evaluate(() => ({
        title: document.querySelector("#ap-title").textContent,
        chip: (document.querySelector(".ap-msg.user .ap-chip") || {}).textContent || "",
        tools: [...document.querySelectorAll(".ap-tool")].map(t => t.className + "|" + t.textContent.replace(/\s+/g, " ").trim()),
        card: document.querySelector(".ap-card.pending").textContent.replace(/\s+/g, " "),
        usage: document.querySelectorAll(".ap-usage").length,
        sendPrimary: document.querySelector("#ap-send").classList.contains("primary") }));
      assert(v.title.includes("机械动力整合包") && v.chip.includes("附上了") && v.chip.includes("排错资料"), "发送后：" + JSON.stringify(v));
      assert(v.tools.length === 1 && v.tools[0].includes("done") && v.tools[0].includes("查看模组清单"), "读操作应直接执行、不弹确认：" + v.tools);
      assert(v.card.includes("写操作") && v.card.includes("xaerominimap.jar") && v.usage >= 2 && !v.sendPrimary, "确认卡片：" + JSON.stringify(v));
      a = await asstState({});
      assert(a.executed.length === 0, "没确认的写操作不应执行");
      await page.click('.ap-card.pending [data-x="ok"]');
      await reply("已经禁用了");
      a = await asstState({});
      assert(a.executed.length === 1 && JSON.stringify(a.executed[0].args) === JSON.stringify({ inst: "机械动力整合包", file: "xaerominimap.jar", enable: false }), "执行的参数应和提案一致：" + JSON.stringify(a.executed));
      assert((await page.textContent(".ap-card .pc-out")).includes("已确认"), "卡片应显示已确认");
      // 实际发给 AI 的内容可以点开看
      await page.click(".ap-msg.user .ap-chip");
      await page.waitForSelector(".modal .ap-sent");
      assert((await page.textContent(".modal .ap-sent")).includes("<程序目录>"), "应能看到实际发送的内容");
      await page.keyboard.press("Escape"); await settle(250);
      assert(!!(await page.$("#ai-panel")), "Esc 先关弹窗，面板还在");
    } finally { await page.keyboard.press("Escape"); await asstState({ reset: true }); await aiState({ reset: true }); }
  });

  await run("AI 助手：新会话可选关联的服务器；拒绝的理由交还给 AI；危险操作要多勾一次才能确认；AI 回复里的 HTML 原样显示", async () => {
    await aiState({ reset: true, ...AI_DEEPSEEK, key: "sk-x" }); await asstState({ reset: true });
    try {
      await page.goto(url("#/inst/" + inst + "/console")); await settle(500);
      await page.evaluate(() => localStorage.removeItem("amh_ai_sid"));
      await page.click("#ai-btn"); await settle(300);
      await page.click('#ap-body [data-x="new"]'); await settle(200);
      const items = await page.$$eval(".dropmenu button", bs => bs.map(b => b.textContent.trim()));
      assert(items[0] === "生存服 · 朋友（当前）" && items.includes("不关联服务器"), "新会话的菜单：" + items);
      await page.click(".dropmenu button >> nth=0"); await settle(300);
      assert((await page.textContent("#ap-sub")).includes("关联：生存服 · 朋友"), "应关联当前服务器");
      await page.fill("#ap-in", "把人数改成 10"); await page.press("#ap-in", "Enter");
      await page.waitForSelector(".ap-card.pending", { timeout: 5000 });
      assert((await page.$$(".ap-tool.done")).length === 1, "读 server.properties 应直接执行");
      await page.click('.ap-card.pending [data-x="reject"]');
      await page.fill(".ap-card.pending .pc-reason input", "周末人多");
      await page.press(".ap-card.pending .pc-reason input", "Enter");
      await reply("周末人多");
      assert((await page.textContent(".ap-card .pc-out")).includes("已拒绝"), "卡片应显示已拒绝");
      assert((await asstState({})).executed.length === 0, "拒绝的不应执行");
      await idle();
      await page.fill("#ap-in", "重启一下"); await page.press("#ap-in", "Enter");
      await page.waitForSelector(".ap-card.danger.pending", { timeout: 5000 });
      const ok = await page.$eval('.ap-card.danger.pending [data-x="ok"]', b => ({ dis: b.disabled, cls: b.className }));
      assert(ok.dis && ok.cls.includes("danger solid"), "危险操作没勾选时：" + JSON.stringify(ok));
      await page.check('.ap-card.danger.pending [data-k="ack"]');
      assert(!(await page.$eval('.ap-card.danger.pending [data-x="ok"]', b => b.disabled)), "勾选后应能确认");
      await page.click('.ap-card.danger.pending [data-x="ok"]');
      await reply("已经在重启了");
      const ex = (await asstState({})).executed;
      assert(ex.length === 1 && ex[0].op === "instance.restart" && ex[0].ack === true, "危险操作应带上第二次确认：" + JSON.stringify(ex));
      await idle();
      await page.fill("#ap-in", "你好"); await page.press("#ap-in", "Enter");
      await reply("应该原样显示"); await idle();
      const m = await page.evaluate(() => {
        const md = [...document.querySelectorAll(".ap-msg.assistant .md")].pop();
        return { h: !!md.querySelector("h4"), nest: !!md.querySelector("ol li ul li"), table: !!md.querySelector("table td"), pre: !!md.querySelector("pre code"),
          img: md.querySelectorAll("img").length, link: (md.querySelector("a") || {}).href, xss: window.__xss, text: md.textContent };
      });
      assert(m.h && m.nest && m.table && m.pre && m.img === 0 && !m.xss && m.text.includes("<img src=x") && m.link === "https://docs.papermc.io/", "Markdown：" + JSON.stringify(m).slice(0, 300));
    } finally { await page.keyboard.press("Escape"); await asstState({ reset: true }); await aiState({ reset: true }); }
  });

  await run("AI 助手：设置里的「局域网可用 AI 助手」即时生效，局域网打开时关掉就没有入口；会话记录可删除、清空", async () => {
    await aiState({ reset: true, ...AI_DEEPSEEK, key: "sk-x" }); await asstState({ reset: true });
    try {
      await page.goto(url("#/settings/ai")); await settle();
      assert(await page.$eval("#ai-lan", e => e.checked && !e.disabled), "开关默认开");
      const t0 = reqs.length;
      await page.click("#ai-assist-slot .switch .sw"); await settle(300);
      assert((putBody(t0, "/api/ai/assistant") || {}).lan === false, "关掉应发 lan: false");
      assert(await toastHas("局域网登录的设备不能用"), "应提示已关闭");
      await aiState({ local: false }); // 模拟局域网打开
      await page.goto(url("#/instances")); await settle();
      assert(await page.$eval("#ai-btn", b => b.hidden), "关掉后局域网打开的界面里不应有助手入口");
      await asstState({ lan: true });
      await page.goto(url("#/instances")); await settle();
      assert(!(await page.$eval("#ai-btn", b => b.hidden)), "打开后局域网也有入口");
      await aiState({ local: true });
      await page.evaluate(async () => {
        for (const t of ["第一个问题", "第二个问题"]) {
          const r = await fetch("/api/assistant/sessions", { method: "POST", body: JSON.stringify({ inst: "" }) }).then(r => r.json());
          await fetch(`/api/assistant/sessions/${r.data.id}/messages`, { method: "POST", body: JSON.stringify({ text: t }) });
        }
        localStorage.removeItem("amh_ai_sid");
      });
      await page.goto(url("#/instances")); await settle(1500);
      await page.click("#ai-btn"); await settle(400);
      assert((await page.$$(".ap-row")).length === 2, "应列出 2 个会话");
      await page.click(".ap-row [data-del] >> nth=0"); await settle(200);
      await page.click('.modal [data-x="ok"]'); await settle(400);
      assert((await page.$$(".ap-row")).length === 1, "删除后剩 1 个");
      await page.click('#ap-body [data-x="clear"]'); await settle(200);
      await page.click('.modal [data-x="ok"]'); await settle(400);
      assert((await page.textContent("#ap-body")).includes("还没有会话") && await toastHas("已清空 1 个会话"), "清空后应是空状态");
    } finally { await page.keyboard.press("Escape"); await asstState({ reset: true }); await aiState({ reset: true }); }
  });

  await run("AI 助手：手机宽度（390px）下面板占满、不横向溢出；在输入框里按数字键不会切页", async () => {
    await aiState({ reset: true, ...AI_DEEPSEEK, key: "sk-x" }); await asstState({ reset: true });
    const c = await hostCtx({ host: false }, { viewport: { width: 390, height: 844 } });
    try {
      const p = await c.newPage();
      p.on("pageerror", e => errors.push(e.message));
      await p.goto(ORIGIN + "#/instances"); await p.waitForTimeout(800);
      await p.click("#ai-btn"); await p.waitForTimeout(400);
      await p.click('#ap-body [data-x="new"]'); await p.waitForTimeout(200);
      await p.click(".dropmenu button >> text=不关联服务器"); await p.waitForTimeout(400);
      await p.fill("#ap-in", "你好"); await p.press("#ap-in", "Enter");
      await p.waitForFunction(() => [...document.querySelectorAll(".ap-msg.assistant .md")].some(e => e.textContent.includes("原样显示")), null, { timeout: 5000 });
      const w = await p.evaluate(() => {
        const r = document.querySelector("#ai-panel").getBoundingClientRect();
        return { left: r.left, width: r.width, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          wide: [...document.querySelectorAll("#ai-panel *")].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".md-table, .md-pre, .ap-kv"))
            .map(e => e.className || e.tagName).slice(0, 5) };
      });
      assert(w.left === 0 && w.width === 390 && w.sw <= w.cw && w.wide.length === 0, "手机宽度：" + JSON.stringify(w));
      await p.focus("#ap-in"); await p.keyboard.press("2"); await p.waitForTimeout(200);
      assert(p.url().endsWith("#/instances"), "输入框里按 2 不应切页：" + p.url());
    } finally { await c.close(); await asstState({ reset: true }); await aiState({ reset: true }); }
  });
  // ============================== 第三阶段结束 ==============================

  await run("全程无页面报错", async () => { assert(errors.length === 0, errors.slice(0, 3).join(" | ")); });

  await browser.close();
  await mock.close();
  for (const r of results) console.log(r.join("  "));
  const fails = results.filter(r => r[0] === "FAIL").length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
