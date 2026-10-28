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

  await run("全程无页面报错", async () => { assert(errors.length === 0, errors.slice(0, 3).join(" | ")); });

  await browser.close();
  await mock.close();
  for (const r of results) console.log(r.join("  "));
  const fails = results.filter(r => r[0] === "FAIL").length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
