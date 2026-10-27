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
  page.on("request", r => reqs.push({ t: Date.now(), m: r.method(), u: new URL(r.url()).pathname }));
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
    assert((await page.$(".dropmenu")) === null, "Esc 未关闭菜单");
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
    assert(reqs.slice(before).some(r => r.m === "PUT" && r.u === "/api/config"), "回车未保存");
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

  await run("外观：存储了无效方案名时回退到默认 Fluent", async () => {
    await page.evaluate(() => localStorage.setItem("amh_scheme", "bogus"));
    await page.goto(url("#/instances")); await settle();
    assert((await page.evaluate(() => document.documentElement.dataset.scheme)) === "fluent", "未回退");
    await page.evaluate(() => { localStorage.setItem("amh_scheme", "fluent"); localStorage.setItem("amh_accent", "auto"); });
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

  await run("全程无页面报错", async () => { assert(errors.length === 0, errors.slice(0, 3).join(" | ")); });

  await browser.close();
  await mock.close();
  for (const r of results) console.log(r.join("  "));
  const fails = results.filter(r => r[0] === "FAIL").length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
