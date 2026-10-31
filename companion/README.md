# MineDeck 伙伴模组（第 7 阶段第一步：可行性原型）

PlayerEngine 做"身体"（寻路、挖掘采集、背包、跟随），MineDeck 做"大脑"。这个原型回答一个问题：**不登录 Player2、不调用 `api.player2.game`，只把 PlayerEngine 当库用，能不能通过本机连接指挥伙伴干活**。结论是能，而且不用改 PlayerEngine，见文末「验证记录」。

伙伴是服务端的一个"像玩家一样"的实体（`LivingEntity`，不是 `ServerPlayer`）：不占玩家位，不在 Tab 列表里。所有 LLM 调用以后都放在 MineDeck 里；模组只认 MineDeck 发来的固定动作。

## 目录

```
companion/
  common/            两个版本共用、只用 java.* 的代码：协议、控制端口、配置文件
  neoforge-1.21.1/   NeoForge 1.21.1 版（Gradle + ModDevGradle 2.0.148）
  forge-1.20.1/      Forge 1.20.1 版（Gradle + ModDevGradle Legacy 2.0.148）
  testctl/           模拟 MineDeck 的测试发送端（Go，和 MineDeck 同一个 module，不引用现有代码）
  LICENSE-NOTICE.md  许可说明（会打进 jar 的 META-INF/）
```

## 依赖

编译时从 Modrinth 的 Maven（`https://api.modrinth.com/maven`）取，**不打进 jar，不入库，不分发**。

|  | NeoForge 1.21.1 版 | Forge 1.20.1 版 |
|---|---|---|
| 加载器 | NeoForge 21.1.x（测的 21.1.265） | Forge 47.x（测的 47.4.28） |
| PlayerEngine | `1.21.1-1.4.0`（Modrinth 版本 `1.21.1-1.4.0-NeoForge`） | `1.20.1-1.4.0`（`1.20.1-1.4.0-Forge`） |
| Architectury API | ≥ 13.0.8（测的 13.0.11） | ≥ 9.2.14（测的 9.2.14） |
| JDK | 21 | 17 |

PlayerEngine 没有稳定的 API：1.1.x 到 1.4.0 之间 `Character` 的构造函数多了一个参数，按旧版编的模组在新版上会直接 `NoSuchMethodError`。所以 `mods.toml` 只放行测过的 1.4.x（`[1.21.1-1.4.0,1.21.1-1.5)`），换版本要重新编译、重新测。

## 构建

```bash
cd companion/neoforge-1.21.1 && ./gradlew build     # → build/libs/minedeck-companion-neoforge-1.21.1-0.1.0.jar
cd companion/forge-1.20.1    && ./gradlew build     # → build/libs/minedeck-companion-forge-1.20.1-0.1.0.jar（已转成 SRG 名）
./gradlew --stop                                    # 用完关掉 Gradle 守护进程
```

- `gradle.properties` 里把 Gradle 限制在 `-Xmx3g`；`disableRecompilation = true`，不反编译 Minecraft，第一次构建约 2–3 分钟（主要是下载），之后十几秒。
- 想把下载的东西放到别处，设 `GRADLE_USER_HOME`。
- Windows 上用 `gradlew.bat build`（还没在 Windows 上跑过）。

## 安装

**服务端和每个玩家的客户端都要装这三个**：伙伴模组 + PlayerEngine + Architectury API（版本见上表）。

- 服务端：伙伴的"身体"在服务端。
- 客户端：伙伴是模组新加的实体类型，客户端要认识它、要有渲染器（用原版玩家模型和默认皮肤）。原版客户端其实能进服（PlayerEngine 和本模组的网络通道都是可选的），但伙伴一进入视野，服务器就会发来一个原版不认识的实体类型编号（实测 `typeId=131`），原版解码这个包用的是 `IdMap.byIdOrThrow`，会被断开（读字节码推断，没用真客户端试）。
- 本模组的类直接实现 PlayerEngine 的接口，所以客户端也要有 PlayerEngine。正式版可以把实体拆成"客户端只认外形、服务端才挂 PlayerEngine"，客户端就只要装伙伴模组本身（推断，见「第二步」）。

配置文件 `<服务端目录>/config/minedeck/companion.properties`（和音乐桥接的 `voicebridge.properties` 同一层）。文件不存在时模组生成一份端口关闭的模板：

```properties
enabled=false
port=24480
token=<随机 32 位十六进制>
```

MineDeck 开服前写好 `enabled=true`、一个空闲端口和令牌（至少 16 个字符）。原型只在开服时读一次，改了要重启服务器（正式版照音乐桥接的做法每 2 秒热重读）。

## 用 testctl 试

```bash
go build -o testctl ./companion/testctl          # 在仓库根目录；Windows 加 GOOS=windows
CFG=<服务端目录>/config/minedeck/companion.properties
./testctl -config $CFG send '{"op":"spawn","name":"MineDeck伙伴"}'   # 在世界出生点刷出伙伴
./testctl -config $CFG send '{"op":"collect","item":"oak_log","count":3}'
./testctl -config $CFG send '{"op":"status"}'                        # 位置、血量、当前任务、背包
./testctl -config $CFG demo -item oak_log -count 3                   # 刷出 → 采集 → 看背包 → 移除，一条命令做完
./testctl -config $CFG repl                                          # 标准输入一行一条 JSON 指令，打印收到的所有帧
```

`send` 和 `demo` 会打印收发的每一帧（`→ REQUEST`、`← RESPONSE`、`← EVENT`；加 `-v` 还打印每 2 秒一次的 STATUS）。退出码：0 正常；1 本地错误；2 模组拒绝连接；3 连接中途断开；4 指令失败或 demo 没做成。

出生点附近没有树时，先在服务端控制台放一棵（以伙伴为中心）：

```
execute at @e[type=minedeck_companion:companion,limit=1] run fill ~3 ~-1 ~-3 ~9 ~-1 ~3 minecraft:grass_block
execute at @e[type=minedeck_companion:companion,limit=1] run fill ~3 ~ ~-3 ~9 ~10 ~3 minecraft:air
execute at @e[type=minedeck_companion:companion,limit=1] run place feature minecraft:oak ~6 ~ ~0
```

背包也能用原版命令查：`data get entity @e[type=minedeck_companion:companion,limit=1] Inventory`。

## 协议草案（第 1 版）

做法照音乐桥接（`bridge/voicechat/README.md` 的协议第 1 版）：模组在 `127.0.0.1:<port>` 上监听，MineDeck 来连，**同一时间只接受一个控制连接**；帧格式一样，整数都是小端；不同的是内容用 UTF-8 的 JSON，帧最长 16 KiB。

| 偏移 | 长度 | 内容 |
|---|---|---|
| 0 | 1 | 类型 |
| 1 | 1 | 保留：发送方填 0，接收方忽略 |
| 2 | 2 | 内容长度 N，最大 16384 |
| 4 | N | 内容 |

| 类型 | 名字 | 方向 | 内容 |
|---|---|---|---|
| `0x01` | HELLO | MineDeck → 模组 | 协议版本 2 字节（=1）、令牌长度 1 字节、令牌、客户端名字（剩下的全部） |
| `0x02` | WELCOME | 模组 → MineDeck | 协议版本 2 字节，然后 JSON：`mod`、`minecraft`、`loader`、`playerEngine`、`companions`（现有伙伴，同 STATUS） |
| `0x03` | ERROR | 模组 → MineDeck | 错误码 2 字节、说明。发完就断开。1 令牌不对，2 协议版本不支持，3 已经有一个控制连接，4 协议错误 |
| `0x10` | REQUEST | MineDeck → 模组 | JSON 指令，`{"id":1,"op":"collect",...}`，`id` 由 MineDeck 定，回复里原样带回 |
| `0x11` | RESPONSE | 模组 → MineDeck | 每条指令一条：`{"id":1,"ok":true,...}`，失败时 `{"id":1,"ok":false,"code":"no_companion","error":"…"}` |
| `0x12` | EVENT | 模组 → MineDeck | JSON 事件，见下 |
| `0x20` / `0x21` | PING / PONG | 双向 | 任意内容原样带回。MineDeck 每 2 秒发一次 PING；模组 10 秒没收到任何帧就断开 |
| `0x30` | STATUS | 模组 → MineDeck | 每 2 秒一次：`{"companions":[{uuid,name,dim,x,y,z,health,maxHealth,engineReady,engineTask,task}]}` |
| `0x40` | END | 双向 | 原因。发完就断开 |

**指令**（动作清单是固定的，没有"破坏任意方块""执行任意命令"）：

| `op` | 参数 | 做什么 | 对应 PlayerEngine 指令 |
|---|---|---|---|
| `spawn` | `name`（可选，1–32 字）；位置三选一：`near`（玩家名）、`x`+`z`（+可选 `y`）、都不给就是世界出生点 | 刷出伙伴。原型只管一个，已经有了就回 `already_spawned` | — |
| `despawn` | — | 移除伙伴（背包里的东西一起没了） | — |
| `status` | — | 伙伴的位置、血量、PlayerEngine 当前任务、背包（`inventory`：`slot`、`item`、`count`），以及 MineDeck 这边的当前任务 | — |
| `collect` | `item`（物品 ID，原版可省 `minecraft:`；`log` 这种泛称也行）、`count`（1–2304） | 采集 N 个 | `get <item> <count>` |
| `follow` | `player`（要在线） | 跟随某人，一直跟到被停下或换指令 | `follow <player>` |
| `goto` | `x`、`y`、`z`（整数） | 走到某个位置 | `goto <x> <y> <z>` |
| `give` | `player`、`item`、`count` | 把背包里的东西给某人（没有就先去弄） | `give <player> <item> <count>` |
| `stop` | — | 停下当前任务（PlayerEngine 的 `stop`，包括闲置任务） | `stop` |
| `say` | `text`（1–256 字） | 以伙伴的名字在聊天栏说一句话（全服可见） | — |

`collect`、`follow`、`goto`、`give` 是"任务"：RESPONSE 里带 `task`（`id`、`op`、`command`；`collect` 还有 `item`、`want`、`before`），同时发一个 `task_started` 事件；结束时发 `task_finished`。同一时间只有一个任务，新任务会把旧任务顶掉（旧任务的结果是 `superseded`）。

参数先由模组自己检查：物品名只能有小写字母、数字和 `_ . - : /`，玩家名只能是 1–16 个字母数字下划线，数量 1–2304，坐标是整数，所以拼出来的 PlayerEngine 指令里不会混进空格或 `;`（PlayerEngine 用 `;` 串联多条指令），大模型没法借参数塞进清单外的指令。错误码：`bad_args`（参数不对）、`no_companion`、`already_spawned`、`no_player`（玩家不在线）、`not_ready`（PlayerEngine 控制器还没创建，刚刷出的第一个 tick 之前）、`rejected`（PlayerEngine 不接受，比如物品不存在：`Item does not exist: "notanitem". Did you mean "granite"?`）、`unknown_op`、`internal`。

**事件**：

| `event` | 字段 |
|---|---|
| `spawned` | `companion` |
| `task_started` | `task` |
| `task_finished` | `task`、`result`（`done` / `incomplete` / `failed` / `cancelled` / `superseded`）、`detail`、`seconds`；`collect` 还有 `have`（背包里共有几个）、`gained`（这次多了几个）、`want` |
| `died` | `uuid`、`cause`（死亡信息） |
| `removed` | `uuid`、`reason`（`DISCARDED`、`KILLED`……） |

注意 PlayerEngine 的 `get N` 是"再弄 N 个"（背包里已有的不算），所以 `collect` 按"这次多了几个"判断够不够数：`gained < want` 时结果是 `incomplete`。

**流程**：

```
MineDeck                                         模组
  ── 连接 127.0.0.1:port ────────────────────────►
  ── HELLO(1, 令牌, "MineDeck") ─────────────────►   连上后 5 秒内要发
  ◄─────────────────────────────── WELCOME(JSON) ─   或者 ERROR，然后断开
  ── REQUEST {"id":1,"op":"spawn"} ──────────────►
  ◄──────────────── EVENT spawned / RESPONSE id=1 ─
  ── REQUEST {"id":2,"op":"collect",...} ────────►
  ◄──── EVENT task_started / RESPONSE id=2(task) ─
  ── PING（每 2 秒）─────────────────────────────►
  ◄──────────────────────────────────────── PONG ─
  ◄─────────────────────────── STATUS（每 2 秒）─
  ◄──────────────────────── EVENT task_finished ─   采集够了、失败了、被停下
  ── END("…") ───────────────────────────────────►   然后断开
```

## 实现要点

- **伙伴实体**（`CompanionEntity`）：继承 `LivingEntity`，实现 PlayerEngine 的四个接口 `IAutomatone`（拿到内嵌的 Automatone/Baritone）、`IInventoryProvider`（玩家式背包）、`IInteractionManagerProvider`（挖方块、用物品）、`IHungerManagerProvider`（饥饿，PlayerEngine 1.4 默认关闭）。每个 tick：推进挖掘进度、背包物品、PlayerEngine 的 `serverTick()`（任务 + 寻路，它通过 `xxa`/`zza`/`jumping` 驱动移动），再由 `LivingEntity` 自己的 `aiStep → travel` 走起来。手上和身上的装备直接读写背包（和原版 `Player` 一样）。PlayerEngine 不管捡东西，伙伴自己捡起碰到的掉落物。参考的是 PlayerEngine 自己的源码（LGPL），没有参考 Player2NPC（没有许可证）。
- **不碰 Player2**：创建 `PlayerEngineController` 时主人（owner）传 `null`。PlayerEngine 1.4.0 的对话层 `ConversationManager.process` 跳过没有主人的伙伴；心跳只在主人有 Player2 令牌时才发。再把这个伙伴的对话队列 `setEnabled(false)`，双保险。玩家在旁边聊天时，PlayerEngine 仍然会把消息记进日志、放进伙伴的对话队列（最多 11 条），但不会处理，不会联网。
- **`/playerengine relog`**：这条命令（要 OP）会对 `PlayerEngineController.staticAPIServices` 里的每个伙伴发起 Player2 登录（先找本机的 Player2 程序，再走 `api.player2.game` 的设备授权）。这张表只给 PlayerEngine 自己的管理命令用，伙伴创建后马上从表里拿掉，这条命令就碰不到它。
- **只用清单里的指令**：PlayerEngine 1.4.0 还有 `agentic`（让 Player2 的模型规划）、`build_structure`（在 Player2 上搜蓝图，1.4.0 已停用）等会联网的指令，本模组不会发；参数检查保证拼不出它们。
- **强制加载的区块**：PlayerEngine 的 `ChunkLoadingTracker` 用 `setChunkForced` 强制加载伙伴脚下的 4 个区块（会存进存档），伙伴被移除或死掉时它不放开。本模组在伙伴移除时替它放开（实测移除后 `forceload query` 为空）。
- **线程**：网络线程只收发；指令用 `server.execute` 交给服务器主线程执行；STATUS 和 WELCOME 读主线程每秒更新一次的快照。

## 已知问题和限制（原型）

- 只管一个伙伴；配置只在开服时读一次；伙伴会随存档保存（重启后自动被接管），但任务不会恢复。
- 移动速度属性 0.33 是按 PlayerEngine 的输入幅度（0.3）折算的，实测 `goto` 22 格用了 5 秒，和玩家走路差不多；没逐 tick 对比。
- 只在原版地形上试过；整合包里的模组方块（寻路会不会卡住、模组冲突）要放进好友的整合包里再试。
- PlayerEngine 1.4.0 会在服务端目录的 `playerengine/` 下写自己的文件：`server_player2.json`（Player2 相关的服务端设置）、`playerengine_settings.json`、`settings.txt`（Automatone 设置）、`configs/`、`data/`（每次启动扫一遍所有物品建的索引，只有原版物品时约 2 MB，整合包会更大）。
- 专用服务器每次启动都会打一行 ERROR：`Attempted to load class net/minecraft/client/multiplayer/MultiPlayerGameMode for invalid dist DEDICATED_SERVER`（PlayerEngine 的 mixin，不影响运行）。MineDeck 的本地排错规则「客户端模组放进了服务端」会被它误触发，正式版要加例外。
- 有原版客户端进服时，PlayerEngine 会打一段 `Payload playerengine:sync_server_player2 may not be sent to the client!` 的 WARN（它自己吞掉了）。
- 控制台输出的中文在非 UTF-8 的终端里是问号，看 `logs/latest.log`。Forge 1.20.1 用 JDK 17 时 `latest.log` 按系统默认编码写，Linux 的 POSIX 环境下也是问号，要加 `-Dfile.encoding=UTF-8`（Windows 中文系统上是 GBK，推断）。
- 方块是用 `level.removeBlock` 直接拆的（PlayerEngine 的 `LivingEntityInteractionManager.tryBreakBlock`），不发 `BlockEvent.BreakEvent`，领地保护模组拦不住它（读源码，未实测）。PlayerEngine 1.4.0 自带「尊重玩家建筑」（`respectStructuresEnabled`，默认开）：记下真玩家放的方块，寻路时拆它们的代价乘 500，只是更不愿意拆、不是禁止，而且只记装上 PlayerEngine 之后放的方块（读源码）。正式版的"禁挖区域"要自己做。
- 收到不是 JSON 的指令时回的错误码是 `internal`，正式版改成 `bad_json`。

## 验证记录

2026-10-28 / 31 在云端容器里用真的无头专用服务器测（`-Xmx2G`，`online-mode=false`，固定种子，出生点旁边用上面的命令放一棵橡树）。测试服、日志都没有入库。

|  | NeoForge 1.21.1 | Forge 1.20.1 |
|---|---|---|
| 环境 | NeoForge 21.1.265 + Architectury 13.0.11 + PlayerEngine 1.21.1-1.4.0，JDK 21 | Forge 47.4.28 + Architectury 9.2.14 + PlayerEngine 1.20.1-1.4.0，JDK 17 |
| 启动 | 新世界 18.7 秒 | 新世界 46.9 秒（第二次起 16 秒） |
| 刷出 → `collect oak_log 3` | `done`，10.4 秒，背包 3 个 `minecraft:oak_log`；`data get entity` 也是 `[{count: 3, Slot: 0b, id: "minecraft:oak_log"}]` | `done`，10.1 秒，同样 3 个 |
| `goto` 22 格 | 5.0 秒 | 5.1 秒 |
| 采集中途 `stop` | `cancelled`，伙伴停下 | 同 |
| `follow`（原版机器人在线） | 走到玩家旁边，PlayerEngine 任务是 `<Going to player Tester>` | 同 |
| `give` 1 个原木、`say` | `done`（2.4 秒），伙伴背包 3 → 2；聊天栏出现 `<MineDeck伙伴> 东西给你了` | `done`（1.7 秒），同 |
| `despawn` / `kill` | 移除后 `forceload query`：没有强制加载的区块 | 同 |
| 玩家位、Tab 列表 | 伙伴在的时候 `list` 是 0 个玩家；原版机器人看到的 Tab 列表只有它自己 | 同 |
| 原版客户端 | 能进服；伙伴进入视野时服务器发来 `typeId=131` 的实体（原版没有这个编号） | 同（`typeId=124`） |
| 联网 | 只有原版 authlib 的一次 DNS 查询；玩家聊天叫伙伴、OP 打 `/playerengine relog`，都没有任何连接 | 另外只有 Forge 自己的更新检查（`files.minecraftforge.net`） |
| 错误指令 | 不存在的物品 → `rejected`；`oak_log;attack Tester` → `bad_args`；数量 0 → `bad_args`；不在线的玩家 → `no_player` | — |

联网是这样查的：服务端 JVM 的 HTTP(S) 代理指到一个只记录、一律拒绝的本机代理（`-Dhttps.proxyHost` 等，`http.nonProxyHosts` 置空），同时用 `strace -e trace=connect` 记下 JVM 的每一次 `connect()`。

对照：伙伴还在 `staticAPIServices` 里的旧版本，OP 打 `/playerengine relog` 时日志出现 `Starting web device flow`，代理记到两次 `CONNECT api.player2.game:443`；拿掉以后就没有了。
