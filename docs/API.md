# MineDeck 开放 API

MineDeck 的 GUI 与后端通过本地 HTTP API 通信，该 API 同时对外开放，可用任何语言编写扩展（这替代了传统"插件系统"）。

## 认证

- 本机：请求头 `X-Token: <token>`（token 在启动 URL 的 `?token=` 参数中，每次启动随机）
- 局域网模式：`POST /api/login {"password": "..."}` 换取会话 Cookie
- SSE 端点可用查询参数 `?token=` 传递
- **仅本机（loopback）端点**：`/api/pickdir`、`/api/openpath`、`/api/instances/{name}/opendir` 会调起系统对话框 / 资源管理器，`/api/javas/add` 会执行请求中给出的主机路径（`java -version` 探测），均只接受来自本机的请求；局域网会话调用返回 403
- **主机路径仅本机可指定**：局域网会话不能决定文件写到主机哪里——`POST /api/instances` 与 `POST /api/import/modpack` 的 `root` 会被忽略（实例一律建在默认存放根下）；`PUT /api/config` 只要带了 `serversDir` / `backupsDir`（含置空恢复默认）即整次返回 403、不做任何修改，不带这两个键的其余配置仍可远程修改
- **AI 设置的修改类接口仅本机**：`/api/ai/*` 里除 `GET /api/ai/settings` 外都只接受本机请求（含 Key 和接口地址）；局域网会话只能看，调用返回 403
- **免 token 端点**：`GET /bg/{name}` 提供程序旁 `bg/` 目录内的壁纸图片（供前端 CSS `url()` 引用，仅受 Host 校验约束）

## 端点总览

### 应用
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/app` | 版本、内存（`ramMb`/`availRamMb`）、实际监听端口 `port`、`serversRoot`/`backupsRoot`、`autoStart`（开机自启真值，查注册表）、`config`、本机 IP；`lanSet`（是否已设访问密码）、`cfKeySet`（是否已设 CurseForge API Key）、`cfKeyBroken`（已存的 Key 解不开，多半是换了电脑或 Windows 用户，需要重填） |
| PUT | `/api/config` | 局部更新配置（见下方「配置键」；仅传要改的键） |
| POST | `/api/pickdir` | 弹系统文件夹选择框，返回 `{path}`（取消为空）。**仅本机** |
| POST | `/api/openpath` | 在资源管理器打开 `{path}` 目录。**仅本机** |
| GET | `/api/bg` | 列出 `bg/` 目录内壁纸文件名 `{images:[...]}` |
| GET | `/bg/{name}` | 提供单张壁纸图片（免 token，`filepath.Base` 防穿越） |
| POST | `/api/shutdown` | 优雅退出（自动停服） |
| POST | `/api/update/check` · `/api/update/apply` | 检查/应用更新 |
| GET | `/api/cores` | 12 种核心元数据（id/name/tag/desc/kind） |
| GET | `/api/mcversions?core=&snapshots=` | 版本列表；每项 `{id, type, latest, releaseTime?}`，`releaseTime` 为 Mojang 清单的发布时间（ISO 8601），仅 Vanilla / NeoForge 等版本表取自官方清单的核心提供，其余核心省略 |
| GET | `/api/builds?core=&mc=` | 构建列表 |
| GET | `/api/javas` · POST `/api/javas/scan` · POST `/api/javas/add` | Java 管理（`add` **仅本机**） |

**配置键**（`PUT /api/config`，均为可选、只更新所传字段）：
`source`（auto/mirror/official）、`cfApiKey`（**只写**：用 Windows DPAPI 加密存进程序目录的 `secrets.json`，任何响应都不下发——`config` 里的 `cfApiKey` 永远为空；是否已设置看 `GET /api/app` 的 `cfKeySet`；传空串清除）、`webhookUrl`、`updateRepo`、`checkUpdateOnStart`、`serversDir`（实例存放根，空=默认；**仅本机**；改动时旧值并入 `roots`，旧根里的实例照常扫描）、`backupsDir`（备份根；**仅本机**）、`backupKeep`（每实例保留份数 1–1000）、`onboarded`（首启引导完成标记）、`tosAccepted`（用户协议与免责声明已同意标记）、`minimizeToTray`（关窗最小化到托盘）、`autoStart`（开机自启，直写 `HKCU\...\Run`）、`listenLan`、`lanPassword`（明文，服务端存为 bcrypt 哈希；任何响应都不下发该哈希，是否已设密码看 `GET /api/app` 的 `lanSet`）、`chromeColor`（界面标题栏底色，只收 `#rrggbb`，存为小写，其它写法整次返回 400；空串清除。原生窗口里的前端在外观变化时上报，下次启动时宿主把它设为 WebView2 的默认底色，避免冷启动白闪；没有值时按系统浅 / 深色取默认方案的标题栏色）。

### 实例
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/instances` | 实例列表；每项含 `name/core/kind/mc/build/javaMajor/xmxMb/xmsMb/port/status/motd/dir/createdAt/consoleEncoding/onlineCount/uptimeSec/maxPlayers/extraJvm` |
| POST | `/api/instances` | 创建（返回 taskId，轮询 `/api/tasks/{id}`）；body 可含 `difficulty/gamemode/root` 等（`root` 仅本机生效） |
| POST | `/api/import/modpack` | multipart 导入整合包（file + name/xmxMb/port/eula/onlineMode/allowFlight/root；`root` 仅本机生效） |
| POST | `/api/instances/{name}/start` \| `/stop` \| `/kill` | 进程控制 |
| POST | `/api/instances/{name}/command` | `{"cmd":"say hi"}` |
| POST | `/api/instances/{name}/opendir?sub=` | 在资源管理器打开实例目录或其白名单子目录（`sub` ∈ mods/plugins/world/logs/crash-reports），**仅本机** |
| GET | `/api/instances/{name}/console` | SSE 控制台流（先回放后实时） |
| GET/PUT | `/api/instances/{name}/properties` | server.properties 读写 |
| PUT | `/api/instances/{name}/settings` | `{xmxMb, xmsMb, consoleEncoding, extraJvm}`（`extraJvm` 为字符串数组，一行一参，传入即整体替换；MC 1.18.1 以下实例的 log4shell 缓解参数始终保留，缺失时自动补回） |
| GET/PUT | `/api/instances/{name}/policies` | 崩溃重启 + 定时任务 |
| GET/POST | `/api/instances/{name}/backups`；POST `.../backups/restore`；DELETE `.../backups?file=` | 备份（保留份数由全局 `backupKeep` 控制，跨备份根合计）。新备份写当前备份根；列表 / 还原 / 删除也查内置根与改目录前用过的旧根（config.json `backupRoots`），同名文件视为同一份；`file` 只取文件名，须为 `.zip` |
| GET/POST | `/api/instances/{name}/players` | 玩家名单与操作 `{action, player}` |
| GET | `/api/instances/{name}/resources/search?q=` | Modrinth 兼容资源搜索 |
| POST | `/api/instances/{name}/resources/install` | `{projectId}` 安装到 mods/plugins |
| DELETE | `/api/instances/{name}?files=1` | 删除实例 |

`GET /api/tasks/{id}` 快照除进度/日志外，还含 `warnings[]`（结构化告警，如 CurseForge 未解析模组清单 `{kind,title,note,items:[{name,url}]}`），供导入完成页醒目呈现。

### 穿透
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/tunnels` | 列表（每项含运行态 `lastError`——frpc 最近一条失败原因，成功后清空；`credBroken`——凭据解不开，多半是换了电脑或 Windows 用户，这条隧道不能启动，要重填凭据）/ 新增 |
| PUT/DELETE | `/api/tunnels/{id}` | 修改 / 删除 |
| POST | `/api/tunnels/{id}/start` \| `/stop` | 启停 frpc |
| GET | `/api/tunnels/{id}/console` | SSE frpc 日志 |

凭据 `credential` 只写不读：用 Windows DPAPI 加密后存进 `tunnels.json`（`"dpapi:…"`），任何响应都不下发；`PUT` 时留空表示不修改。旧版的明文凭据在启动时自动加密写回。自定义 frps 的 token 不再写进 frpc 的配置文件，而是经环境变量交给 frpc 进程（配置里只有 `{{ .Envs.… }}` 模板）。OpenFrp 和樱花的 frpc 仍然只能从命令行参数接收凭据。

### AI（可选）

AI 是可选功能。没配置时（`enabled` 为 false）MineDeck 不连接任何 AI 服务，不起后台任务，也不下载价格数据。下表标了「联网」的三个接口才会对外连接，而且都要人在设置页里点了才发：取模型列表、测试连接、刷新价格。AI 的设置和 Key 只能由人来改：它们在操作层里是「仅人工」的操作，以后的 AI 功能看不到也调不了。修改类的接口都**仅本机**，局域网会话只能看。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ai/settings` | 返回当前设置和状态，不联网，局域网会话也能看。字段：<br>• `presets`：服务商预设。<br>• `provider`：服务商设置 `preset/protocol/baseUrl/model/maxOutput/effort/eager/fallback`，不含 Key。<br>• `keySet` / `keyBroken`：Key 是否已设置、是否解不开。<br>• `enabled`：是否已启用；`missing`：还差什么，如「填写 Key」。<br>• `quota`：每日额度。<br>• `today` / `month`：今天和本月的用量。<br>• `priceNeeded`：是否配置了要花钱的服务商。<br>• `prices`：价格数据的状态。<br>• `modelPrice`：当前模型的单价。<br>• `customPrices`：自填单价。<br>• `local`：请求是否来自本机。 |
| PUT | `/api/ai/provider` | 改服务商设置，只改传了的字段：<br>• `preset`：传空串表示停用 AI，同时清掉 Key。<br>• `protocol`：`openai` / `anthropic`，只有自定义时可选。<br>• `baseUrl`、`model`、`maxOutput`。<br>• `effort`：Claude 的思考深度 `low/medium/high/xhigh/max`；空串用模型默认。<br>• `key`：**只写**；空串清除。<br>改了服务商、协议或接口地址，旧 Key 自动清掉，要在同一次请求里给新 Key，或者之后重填。返回内容同 `GET /api/ai/settings`。**仅本机** |
| POST | `/api/ai/models` | 取模型列表（**联网**），返回 `[{id, name?, maxOutput?}]`。<br>body `{preset, protocol?, baseUrl?, key?}` 可以是还没保存的服务商和地址。不给 `key` 时，只有服务商、协议和地址都和已保存的一样，才用已存的 Key。<br>服务商那边出错时返回 502。**仅本机** |
| POST | `/api/ai/test` | 测试连接（**联网**）：按已保存的设置发一个最小的流式请求，带一个测试用的工具。返回字段：<br>• `ok`、`latencyMs`（到收到第一个事件）、`totalMs`、`model`。<br>• `tools`：`yes` 能调用工具，`no` 服务商说不支持，`unknown` 模型这次没调用。<br>• `reply`、`usage`、`stop`。<br>• `cost`：估算的费用 `{amount, currency, source}`。`source` 是 `litellm`、`custom` 或 `local`（本机模型，不计费）；查不到价格时没有这一项。<br>• `eager`、`fallback`：Claude 才有，见下文。<br>连不上时仍返回 200，`ok` 为 false，`error` 写明原因。没启用时返回 400。花的 token 不计入每日额度。**仅本机** |
| PUT | `/api/ai/quota` | 每日额度：`{assistant, gamechat}`，只改传了的。单位 token，输入、输出、缓存命中、缓存写入都算，0 表示不限。**仅本机** |
| PUT | `/api/ai/prices` | 整体替换自填单价：`{prices: [{model, currency, input, output, cacheRead?, cacheWrite?}]}`。`currency` 是 `CNY` 或 `USD`，单价按每百万 token 填。最多 100 条，模型不能重复。**仅本机** |
| POST | `/api/ai/prices/refresh` | 马上重新下载公开价格（**联网**）。没配置 AI 或只配了本机模型时返回 400，下载失败返回 502。**仅本机** |

- **Key**：用 Windows DPAPI 加密，存进程序目录的 `secrets.json`，键名是 `ai.key`。任何响应都不返回 Key，操作记录里写成 `***`。`keyBroken` 为 true 表示已存的 Key 解不开，多半是换了电脑或 Windows 用户，需要重填。自定义预设可以不填 Key（有的中转和本机服务不要 Key）。
- **Claude 的两个开关**：`provider.eager` 和 `provider.fallback` 只读，表示流式时工具参数是否边生成边推（`eager_input_streaming`），以及是否开启服务端回退。官方地址默认都开。自定义地址走 Claude 协议时，两项默认都关，测试连接时试一下，能用才打开，结果存进设置。请求被服务商以「不认识的参数」拒绝时也会自动关掉重发。
- **用量**：`today` / `month` 按功能分开给，功能有 `assistant`、`gamechat`、`companion`。每项的字段是 `{requests, input, output, cacheRead, cacheWrite, reasoning, tokens, estimated?, unpriced?, cost?}`：
  - `input` 不含缓存命中和缓存写入；`reasoning` 已经算在 `output` 里。
  - `tokens` 是额度按的数：输入 + 输出 + 缓存命中 + 缓存写入。
  - `estimated` 是其中按字数估算用量的次数（回复中途断开，拿不到用量）。
  - `unpriced` 是查不到价格、只记了 token 的次数。
  - `cost` 是 `{币种: 金额}`，都是估算。人民币和美元分开合计，不做汇率换算。

  按本地时间的自然日和自然月统计。记录存在 `<程序目录>/data/ai/usage.json`，保留 400 天。某项功能当天的 `tokens` 达到额度后，这项功能暂停到第二天 0 点。
- **价格**：公开价格来自 LiteLLM 的 `model_prices_and_context_window.json`（MIT 许可）。下载时整份下载，依次试 ghfast.top、gh-proxy.com，最后直连 GitHub；下载的内容当作不可信数据严格校验，再缓存到 `<程序目录>/data/ai/prices.json`，7 天刷新一次。只有配置了要花钱的服务商才去取。
  - `prices` 的字段是 `{source, updated?, count, fetching?, error?}`。
  - `modelPrice` 的字段是 `{found, local?, source, currency, input, output, cacheRead?, cacheWrite?, tiered?, note?}`，单价按每百万 token。`source` 是 `litellm` 或 `custom`；`tiered` 表示按输入长度分档，显示的是最低一档；国内四家的 `note` 提示「按国际站美元价估算」。查不到价格时 `found` 为 false，只显示 token。
  - 自填单价优先于公开价格，也能补上查不到的模型。

### 操作记录
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ops/log?inst=&src=&op=&limit=` | 操作记录，新的在前；可按实例、来源、操作（前缀匹配，如 `instance.players.`）过滤；`limit` 默认 100、最多 1000。局域网会话也能看 |

除登录、两个 SSE 控制台流和壁纸外，上面的接口都经过程序内部的操作层（`internal/ops`）：先判断权限（调用来源 × 风险等级 × 是否仅本机），再按参数说明校验，最后执行。写操作、危险操作和仅人工的操作（读操作不记）每执行一次，就在程序目录的 `logs/ops/<年-月>.jsonl` 追加一行，按月一个文件，保留 12 个月、总共不超过 20 MB：

```json
{"t":"2026-11-02T20:15:03+08:00","op":"instance.props.set","src":"ui","actor":"本机",
 "inst":"生存服","args":{"pairs":[{"key":"max-players","value":"10"}]},"ok":true,"ms":12}
```

- `src` 是来源：`ui`（本机界面）、`api`（本机的其他程序）、`lan`（局域网设备，`actor` 是它的地址）、`schedule`（定时任务和崩溃自动重启，`actor` 写明是哪一种）；`assistant`、`gamechat`、`companion` 留给以后的 AI 功能，AI 发起的写操作要人确认后才执行，记录里带 `proposal`（提案编号）和 `approvedBy`（确认的人）。
- 失败的操作也记，`ok` 为 false，`err` 是错误信息。
- Key、密码、令牌、凭据、Webhook 地址，以及 server.properties 里像密码的项（如 `rcon.password`），在 `args` 里一律写成 `***`（清空时保留空串）。

### 应用内 AI 助手（第三阶段）

对话本身不改任何东西，所以会话接口不走操作层；AI 调用的工具都经过操作层：读操作直接执行，写操作和危险操作生成提案，人确认后才执行（见下一节）。局域网会话要主机开着「局域网可用 AI 助手」（默认开）才能用，而且只看得见、只能处理局域网开的会话；本机都看得见。看、删会话不要求 AI 配好（停用 AI 后也能清空历史）；开会话、发消息、生成发送预览要求 AI 配好，没配好返回 400。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/assistant` | 状态：`enabled`（AI 配好了）、`allowed`（这个请求能用助手）、`local`、`lan`（「局域网可用 AI 助手」开关）、`missing`、`preset`、`model`、`quota {used, limit}`（助手今天的用量和每日额度，单位 token，`limit` 为 0 表示不限） |
| GET | `/api/assistant/sessions` | 会话列表，最近动过的在前：`[{id, title, inst, updated, origin: local/lan, actor, busy?, waiting?}]` |
| POST | `/api/assistant/sessions` | 开新会话 `{inst}`（可以不关联实例），返回会话。系统提示和工具清单此时定下，之后不变 |
| DELETE | `/api/assistant/sessions` | 清空：本机清空全部，局域网只清空局域网开的。返回 `{deleted}` |
| GET / DELETE | `/api/assistant/sessions/{id}` | 取会话 / 删掉（正在进行的回复停掉，没处理的提案作废） |
| POST | `/api/assistant/sessions/{id}/messages` | 发消息 `{text, attach}`：在后台开始回复，立刻返回，结果经事件推送。<br>• `attach` 为 true 时附上之前预览过的排错资料（30 分钟内有效，过期返回 409）；只附资料时 `text` 可以空。<br>• 正在回复时返回 409，额度用完返回 429，消息超过 2 万字返回 400。<br>• 有确认卡片没处理就发新消息时，没处理的提案作废，结果一起交还给 AI |
| POST | `/api/assistant/sessions/{id}/context` | 生成发送预览（「让 AI 分析」）：按关联的实例打包排错资料（实例信息、本地规则的结论、本次启动以来精简过的控制台、本次启动之后的崩溃报告和 hs_err 摘要、相关模组，约 2 万 token 以内），脱敏后返回 `{lead, text, chars, tokens}`。`lead` 是默认的提问，`text` 是将要发送的全文。会话没关联实例时返回 400 |
| POST | `/api/assistant/sessions/{id}/stop` | 停止正在进行的回复（已经执行的工具不撤回） |
| POST | `/api/assistant/sessions/{id}/continue` | 上次的回复没完成（停止、出错、空回复），或者确认卡片都处理完了：接着回复。没有要继续的返回 409 |
| GET | `/api/assistant/sessions/{id}/events` | SSE（可用 `?token=`）：先推 `{"type":"session","session":…}`（完整的会话），之后是增量：<br>• `item`：新增或更新一条（按 `id` 替换）；<br>• `delta`：回复的文字片段 `{id, text}`；`tool_start`、`thinking`：正在调用工具、正在思考；<br>• `state`：`busy/waiting/needReply/stale/long/attach/title/quota`；<br>• `retry`：服务商出错，正在重试；`remove`：撤掉一条（没有内容的空回复）。<br>客户端跟不上时连接被断开，重连后重新拿一份完整的 |
| GET | `/api/assistant/sessions/{id}/sent?item=&tool=` | 实际发给 AI 的内容 `{text}`：用户的话（脱敏后、带上排错资料的），或者某次工具调用交还给 AI 的内容 |
| PUT | `/api/ai/assistant` | 「局域网可用 AI 助手」开关 `{lan}`，返回同 `GET /api/ai/settings`。**仅本机**，仅人工 |

- **会话**：`{id, title, inst, created, updated, origin, actor, model, preset, items[], busy, waiting, needReply, stale?, long?, attach?, quota}`。`waiting` 表示有确认卡片在等；`stale` 不为空表示 AI 设置改过（换了服务商、协议或地址，或者 Claude 换了模型），这个会话不能接着用；`long` 表示会话很长了，建议开新会话；`attach` 是打包好、等着发送的排错资料的字数。`GET /api/ai/settings` 多了 `lanAssistant` 字段。
- **会话里的一条**（`items[]`）：`{id, kind: user/assistant/notice, t, text, attach?, masked?, withdrawn?, tools?, usage?, cost?, model?, partial?, level?}`。
  - `masked`：用户的话里的隐私信息发送前被替换了。`withdrawn`：这句没得到回复，已从对话里撤回。
  - `partial`：回复没说完就停了（不在历史里）。`notice` 是提示（已停止、请求失败、空回复等），`level` 为 info / warn / error。
  - `tools[]`：`{id, name, op, title, level: R/W/D, args, status, error?, proposal?}`。`status` 是 running、done、error、skipped、pending（等确认）、confirmed、failed、rejected、expired、invalid、canceled（没处理就发了新消息）。`proposal` 是确认卡片要显示的内容，处理完后多了 `outcome`、`reason`、`by`、`error`。
- **发给 AI 之前一律脱敏**：程序目录、用户目录、路径里的 Windows 用户名、计算机名、局域网 IP（含本机各网卡的地址）换成 `<程序目录>`、`<用户目录>`、`<用户名>`、`<计算机名>`、`<局域网IP>`；Key、访问密码哈希、MineDeck 令牌、长得像 Key 的长串、配置里像密码的值写成 `***`；玩家名保留。工具结果外面加「以下是数据」的边界标记，超过 16 KB 截断并注明。新建实例时要人勾的 `eula` 和主机路径 `root` 不在 AI 能填的参数里。
- **会话保存**：存在 `<程序目录>/data/ai/sessions/<id>.json`，只留最近 20 个；重启后读回，接着聊时发给 AI 的历史逐字节不变。读回时还在等确认的提案按过期处理。
- 一轮最多调 8 次工具。空回复（Claude 空的 `end_turn`、OpenAI 兼容只给了思考内容）不进历史，提示换个说法再问。

### 提案：AI 提出的写操作（第三阶段）

AI 调用写操作或危险操作时，操作层不执行，而是生成提案，5 分钟内有效。提案里存着规范化后的参数和预览 `plan`：一句话说明 `summary`、改动清单 `changes [{what, before, after}]`、危险操作的警告 `warning`、文本文件的逐行对比 `diff`。人确认后按存下的参数原样执行；执行前先检查前置条件（预览时记下的文件指纹、实例状态等），变了就作废。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ops/proposals?session=` | 还在等确认的提案，只列这个请求能处理的：`[{id, op, title, level, args, plan, consent?, caller, created, expires}]` |
| POST | `/api/ops/proposals/{id}/confirm` | 确认并执行，返回执行结果。body `{ack, consent}`：<br>• 危险操作要 `ack: true`（第二次确认），缺了返回 400；<br>• 带 `consent` 的提案（如新建实例的 EULA）要 `consent: true`，同意只能由人在确认时给出；<br>• 提案不存在或已处理返回 404，过期 410，前置条件变了 409（提案作废）。<br>只有人能确认；「仅本机」的操作只能在本机确认 |
| POST | `/api/ops/proposals/{id}/reject` | 拒绝 `{reason}`，理由可以不填，会交还给 AI |

- 局域网会话只能处理局域网开的助手会话里的提案，而且主机要开着「局域网可用 AI 助手」；本机会话的提案只能在本机处理（403）。
- 操作记录里，提案的每个节点各记一条，用 `event` 区分：`propose`（提出）、`reject`（拒绝，`approvedBy` 是拒绝的人，`reason` 是理由）、`void`（过期或作废，`reason` 写明原因）。确认后执行的那条没有 `event`，带 `proposal`（提案编号）和 `approvedBy`（确认的人）。

### 排错和修复（第三阶段）

AI 助手用的读写能力，网页也能直接调。人调用时，写操作直接执行，不出提案。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/instances/{name}/diag` | 本地规则排错，不联网：检查最近一次启动以来的控制台，返回 `{status, findings[], crashed, exit, lines}`。<br>每个 finding 是 `{rule, title, summary, details[], fixes[], evidence[], mods[], files[], severity: error/warn}`。`rule` 是 13 类之一：`missing-deps`、`client-only`、`wrong-loader`、`duplicate-mods`、`incompatible-mods`、`mixin`、`java-version`、`port-in-use`、`out-of-memory`、`watchdog`、`eula`、`client-mismatch`、`broken-config`；另有 `jvm-option`（JVM 参数不被支持，归在 Java 一类）和 `crash`（异常退出但没认出原因）。<br>界面的报错横幅据此显示，没配置 AI 也照样有 |
| GET | `/api/instances/{name}/console/tail?lines=&level=&q=&since=` | 控制台最近的输出（内存里最多 3000 行）。`lines` 默认 100；`level` 为 `warn` / `error` 时只看这一级及更严重的；`q` 是关键字；`since=start` 只看最近一次启动以来的 |
| GET | `/api/instances/{name}/logs?file=&lines=&q=` | 读 `logs/latest.log`（`file=debug` 时读 `debug.log`）末尾 `lines` 行，默认 200。给了 `q` 就改成搜索，最多 50 处，每处带前后 2 行。GBK 编码的日志自动转码 |
| GET | `/api/instances/{name}/crash-reports?file=&full=` | 不给 `file` 时列出 `crash-reports/` 里的崩溃报告和 `hs_err_pid*.log`：`{reports: [{name, kind: crash/jvm, size, modified, thisStart}]}`，新的在前。给了 `file` 返回摘要（开头、Description、第一个异常、加载器标出的可疑模组、Java 版本和内存）；`full=1` 返回原文的前 16 KB |
| GET | `/api/instances/{name}/mods?q=&detail=` | 解析 mods 目录（插件服是 plugins）里的 jar：`{dir, count, disabled, mods[]}`。给了 `q` 或 `detail=1` 时，每项带上加载器、依赖、mixin 配置等 |
| POST | `/api/instances/{name}/mods/toggle` | `{file, enable}`：把 jar 改名成 `.jar.disabled` 来禁用，改回来就是启用；不删文件，重启后生效 |
| GET | `/api/instances/{name}/config?path=&start=&lines=` | 读 `config/`、`defaultconfigs/`、`<世界>/serverconfig/`、`plugins/<插件>/` 下的配置文件，1 MB 以内，按行分页。`path` 为空时列出能读的目录，是目录时列出里面的文件 |
| PUT | `/api/instances/{name}/config` | 改配置文件 `{path, mode, edits?, content?}`：<br>• `edit`（默认）：`edits: [{find, replace}]` 逐处替换，原文要一字不差且只出现一次；<br>• `replace`：用 `content` 整体替换，文件不存在时新建；<br>• `reset`：备份后删掉，让模组重新生成默认配置；<br>• `undo`：恢复成上一次的备份。<br>改之前自动备份到 `<实例>/.minedeck/config-backups/`，每个文件留 20 份。读和比对按 UTF-8、`\n` 换行，写回时保持原文件的编码（UTF-8、带 BOM 的 UTF-8 或 GBK）和换行。内容里有脱敏占位符（`***`、`<用户名>` 等）时拒绝写入 |
| PUT | `/api/instances/{name}/java` | `{major, path?}`：给实例换 Java，下次启动生效。本机或 MineDeck 已经有这个版本就直接换，返回 `{java}`；没有就在后台下载便携版，返回 `{taskId}`（进度见 `/api/tasks/{id}`） |
| POST | `/api/instances/{name}/restart` | 重启：先保存世界并停止（最多等 40 秒），再启动。服务器没在运行时返回 400。危险操作 |
| GET | `/api/ports/{port}?proto=` | 端口占用：`{port, tcp?, udp?, instances?}`。每个协议是 `{free, owners?: [{pid, process, instance?, minedeck?}], note?}`；`instances` 是配置了这个端口的实例。`proto` 为 `tcp` / `udp`，空串两种都查 |

所有响应统一为 `{"ok": true, "data": ...}` 或 `{"ok": false, "error": "..."}`。

## Webhook 事件

在全局设置配置 URL 后，以下事件将以 JSON POST 推送（失败重试 3 次）：

```json
{ "type": "player.join", "time": "2026-07-12T03:00:00+08:00",
  "data": { "instance": "我的服务器", "player": "Steve" } }
```

事件类型：`instance.start` / `instance.stop` / `instance.crash`、`player.join` / `player.leave`、`backup.done`、`tunnel.up` / `tunnel.down`。
