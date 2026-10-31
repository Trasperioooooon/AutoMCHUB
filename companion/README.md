# MineDeck 伙伴模组

> 第 7 阶段第二步（正式版）进行中。下面的「协议 v1」已经定稿，MineDeck 一侧照它实现；内置进 MineDeck 的 jar 在 `internal/companion/jar/`（见「打进 MineDeck 的 jar」）。其余各节暂时还是第一步原型的说明，第二步做完一起更新。

PlayerEngine 做"身体"（寻路、挖掘采集、背包、跟随），MineDeck 做"大脑"。这个原型回答一个问题：**不登录 Player2、不调用 `api.player2.game`，只把 PlayerEngine 当库用，能不能通过本机连接指挥伙伴干活**。结论是能，而且不用改 PlayerEngine，见文末「验证记录」。

伙伴是服务端的一个"像玩家一样"的实体（`LivingEntity`，不是 `ServerPlayer`）：不占玩家位，不在 Tab 列表里。所有 LLM 调用以后都放在 MineDeck 里；模组只认 MineDeck 发来的固定动作。

## 目录

```
companion/
  common/            两个版本共用、只用 java.* 的代码：协议、控制端口、配置文件
  neoforge-1.21.1/   NeoForge 1.21.1 版（Gradle + ModDevGradle 2.0.148）
  forge-1.20.1/      Forge 1.20.1 版（Gradle + ModDevGradle Legacy 2.0.148）
  testctl/           模拟 MineDeck 的测试发送端（Go，和 MineDeck 同一个 module，不引用现有代码）
  update-embedded.sh 重新构建两个 jar 并更新 internal/companion/jar/（--check 只检查）
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

## 打进 MineDeck 的 jar

两个加载器的 jar 入库在 `internal/companion/jar/`（Go 包 `companionjar`），用 `go:embed` 打进 MineDeck.exe，同一目录的 `manifest.json` 描述它们。MineDeck 的其他代码只 import 这个包，不改它；jar 更新时只动这个目录。

- `companionjar.Load()` 读出清单并逐项检查（每个 jar 都在，大小、sha256 对得上）；`(*Manifest).Find(加载器, MC 版本)` 找 jar；`Jar.Bytes()` 取内容（再校验一次 sha256）；`RawManifest()` 是清单原文；`FilePrefix`（`minedeck-companion-`）是装进 mods 后所有版本的文件名前缀，用来找出要替换的旧版本。
- 清单（`schema` = 1）：`mod` 是本模组的 ID、版本、许可证、控制连接的协议版本；`jars` 每项是一个 jar：`loader`（`neoforge` / `forge`）、`minecraft`、`loaderVersions`（加载器版本要求）、`testedLoader`、`java`、`file`（内置文件名）、`installName`（装进 mods 的文件名，带版本号）、`size`、`sha256`、`client`（玩家的客户端要不要装本模组）、`dependencies`。
- `dependencies` 每项是一个要另外装的模组（PlayerEngine、Architectury API）：`modId`、`versionRange`（和 jar 里 mods.toml 写的一样）、`side`（`both`：服务端和客户端都要装；`server`：只有服务端要装）、`license`，以及 `modrinth`：`projectId`、`slug`、查版本用的 `loaders` 和 `gameVersions`、`versionPattern`（匹配 Modrinth 的 `version_number`）、`policy` 和 `tested`（实测过的版本：版本 ID、`version_number`、mods.toml 里的版本、文件名、大小、sha1、sha512、下载地址）。
- 版本选择规则 `policy` 现在只有 `tested-first`：先装 `tested` 那个版本，下载后核对大小和 sha512；它下载不到时，才在 Modrinth 上按 `loaders`、`gameVersions` 找 `version_type` 为 release、`version_number` 匹配 `versionPattern` 的版本，取发布最晚的一个，下载后确认 mods.toml 里的版本在 `versionRange` 之内。PlayerEngine 没有稳定的 API，不要自动追新版本。

模组源码改了以后：

```bash
./companion/update-embedded.sh          # 重新构建两个 jar，复制进 internal/companion/jar/，改 manifest.json 的版本、文件名、大小、sha256
./companion/update-embedded.sh --check  # 只检查入库的 jar 和清单是不是最新的（逐字节比较），不一致时退出码 1
go test ./internal/companion/jar        # 清单和 jar 里的 mods.toml 对得上（版本、依赖范围、side），jar 里没有别人的文件
```

构建是可复现的：`build.gradle` 里固定了打包的时间戳和文件顺序，同样的源码、同样大版本的 JDK 构建出的 jar 逐字节相同（入库的 jar 是用 OpenJDK 21.0.12 和 17.0.20 构建的）。依赖的版本范围和 Modrinth 信息是手工维护的，脚本不改它们，改了要和两个工程的 mods.toml、gradle.properties 一起改。

## 安装

**服务端和每个玩家的客户端都要装这三个**：伙伴模组 + PlayerEngine + Architectury API（版本见上表）。

- 服务端：伙伴的"身体"在服务端。
- 客户端：伙伴是模组新加的实体类型，客户端要认识它、要有渲染器（用原版玩家模型和默认皮肤）。原版客户端其实能进服（PlayerEngine 和本模组的网络通道都是可选的），但伙伴一进入视野，服务器就会发来一个原版不认识的实体类型编号（实测 `typeId=131`），原版解码这个包用的是 `IdMap.byIdOrThrow`，会被断开（读字节码推断，没用真客户端试）。
- 本模组的类直接实现 PlayerEngine 的接口，所以客户端也要有 PlayerEngine。正式版可以把实体拆成"客户端只认外形、服务端才挂 PlayerEngine"，客户端就只要装伙伴模组本身（推断，见「第二步」）。

配置文件 `<服务端目录>/config/minedeck/companion.properties` 的全部键见「协议 v1」的「配置文件」。

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

## 协议 v1

MineDeck 和伙伴模组之间的本机连接，第 7 阶段第二步定稿。MineDeck 一侧照这一节实现；模组的实现在 `common/src/main/java/minedeck/companion/net/`，`testctl/` 是照这一节写的测试发送端。

做法照音乐桥接（`bridge/voicechat/README.md` 的协议第 1 版）：模组在本机监听，MineDeck 来连，帧格式相同。不同的是指令、回复、事件都是 UTF-8 的 JSON，而且同一个连接上可以管好几个伙伴。

### 连接

- 模组在 `127.0.0.1:<port>` 上监听，只接受本机连接；端口和令牌写在配置文件里（见下面「配置文件」）。服务器开好（`Done (…)` 之后）才打开端口，关服时先发 END 再关。
- **同一时间只接受一个控制连接**，第二个连接收到 ERROR 3。
- 连接断开、重连都不影响游戏里的伙伴和它们正在做的任务。断开期间的事件丢掉不补：重连后从 WELCOME 拿最新的状态，每个伙伴的 `lastResult` 是它最近一次结束的任务的结果。WELCOME 的 `session` 变了，说明服务器重启过（任务编号从 1 重新数）。
- MineDeck 每次连接前都重读配置文件。刚改完配置时，模组最多要 2.2 秒才读到新内容，这期间连不上、ERROR 1、ERROR 5 都算「模组还没读到」，隔 0.5 秒重试，最多 10 秒。刚断开就重连遇到 ERROR 3 时同样隔 0.5 秒重试。

### 帧

整数都是小端。

| 偏移 | 长度 | 内容 |
|---|---|---|
| 0 | 1 | 类型 |
| 1 | 1 | 保留：发送方填 0，接收方忽略 |
| 2 | 2 | 内容长度 N（0–65535） |
| 4 | N | 内容 |

| 类型 | 名字 | 方向 | 内容 |
|---|---|---|---|
| `0x01` | HELLO | MineDeck → 模组 | 协议版本 u16（MineDeck 支持的最高版本）、令牌长度 u8、令牌、客户端名字（剩下的全部，UTF-8，只用来记日志） |
| `0x02` | WELCOME | 模组 → MineDeck | 协议版本 u16（这次连接用的版本），后面是 JSON |
| `0x03` | ERROR | 模组 → MineDeck | 错误码 u16、说明（UTF-8）。发完就断开，只在握手时用 |
| `0x10` | REQUEST | MineDeck → 模组 | JSON 指令 |
| `0x11` | RESPONSE | 模组 → MineDeck | JSON 回复，每条指令正好一条 |
| `0x12` | EVENT | 模组 → MineDeck | JSON 事件 |
| `0x20` | PING | MineDeck → 模组 | 任意内容，最多 64 字节 |
| `0x21` | PONG | 模组 → MineDeck | 原样带回 PING 的内容 |
| `0x30` | STATUS | 模组 → MineDeck | JSON，每 2 秒一次 |
| `0x40` | END | 双向 | 原因（UTF-8）。发完就断开 |

不认识的帧类型两边都忽略（模组只记一次日志），不断开。

### 握手和版本协商

```
MineDeck                                              模组
  ── 连接 127.0.0.1:port ─────────────────────────────►
  ── HELLO(最高版本, 令牌, "MineDeck 2.7.0") ─────────►   连上后 5 秒内要发
  ◄──────────────────────────── WELCOME(版本, JSON) ─   或者 ERROR(错误码, 说明)，然后断开
  ── REQUEST {"id":1,"op":"spawn",...} ──────────────►
  ◄─────────── EVENT spawned / RESPONSE {"id":1,...} ─   指令引起的事件先到，回复后到
  ── PING（每 2 秒）──────────────────────────────────►
  ◄───────────────────────────────────────────── PONG ─
  ◄────────────────────────────────── STATUS（每 2 秒）─
  ◄──────────────────────────── EVENT task_finished ─   任务做完、失败、被停下
  ── END("MineDeck 退出") ────────────────────────────►   然后断开
```

- **令牌**：16–255 字节的可见 ASCII 字符（MineDeck 生成 32 位十六进制就行），和配置文件里的 `token` 逐字节相同才算对。比较是常数时间的；不对时模组等 0.3 秒再回 ERROR 1。
- **版本**：HELLO 里写 MineDeck 支持的最高版本 v。模组支持 1 到 M（这一版 M = 1）：v ≥ 1 时用 min(v, M)，写在 WELCOME 开头；v = 0 回 ERROR 2。MineDeck 不支持模组选的版本时发 END 断开，提示用户更新模组或 MineDeck。只有不兼容的改动（帧格式、已有字段的含义变了）才升版本；加指令、加字段、加事件都不升，见「兼容规则」。
- **心跳**：MineDeck 每 2 秒发一次 PING。模组 10 秒没收到任何帧就发 END（「心跳超时」）断开。模组每 2 秒发一次 STATUS，MineDeck 10 秒没收到任何帧也应断开重连。

| ERROR 错误码 | 意思 |
|---|---|
| 1 | 令牌不对 |
| 2 | 协议版本不支持 |
| 3 | 已经有一个控制连接 |
| 4 | 协议错误（第一帧不是 HELLO、HELLO 格式不对、帧太长） |
| 5 | 控制端口正在关闭（配置里刚改成 `enabled=false`，或者服务器正在关闭） |

**WELCOME 的 JSON**：

```json
{
  "protocol": 1,
  "session": "3f9c0a1b",
  "mod": "0.2.0",
  "loader": "neoforge",
  "minecraft": "1.21.1",
  "playerEngine": "1.21.1-1.4.0",
  "ops": ["spawn", "despawn", "status", "collect", "follow", "goto", "attack", "give", "stop", "say"],
  "events": ["spawned", "adopted", "removed", "died", "task_started", "task_finished", "stuck", "config_applied"],
  "features": ["nodig", "adopt"],
  "limits": {"maxCount": 2304, "maxText": 256, "maxName": 32, "maxZones": 64},
  "config": {
    "maxCompanions": 4,
    "attackDeny": ["minecraft:villager", "minecraft:wandering_trader", "minecraft:iron_golem", "minecraft:snow_golem", "minecraft:allay"],
    "zones": [{"name": "base", "dim": "minecraft:overworld", "min": [-120, -64, -80], "max": [-40, 320, 10]}],
    "problems": []
  },
  "companions": []
}
```

- `session`：每次开服随机生成。
- `ops`、`events`、`features`：这个模组支持的指令、会发的事件、可选能力。v1 的 `features` 有 `nodig`（禁挖区域）和 `adopt`（重启后接管伙伴）。
- `config`：模组现在实际在用的配置（`problems` 是配置文件里写错、没生效的条目）。STATUS 不带它，配置变了发 `config_applied` 事件。
- `companions`：现有的伙伴，格式见「伙伴对象」，不带背包。

### 指令和回复

REQUEST：`{"id": 1, "op": "collect", "companion": 1, ...}`。

- `id`：整数，由 MineDeck 定，RESPONSE 里原样带回。
- `op`：动作名，清单是固定的（下表），没有「破坏任意方块」「放置任意方块」「执行任意命令」这类动作。
- `companion`：伙伴的编号。不写时：只有一个伙伴就是它；一个都没有回 `no_companion`；有好几个回 `ambiguous`。MineDeck 最好总是写上。
- 指令按收到的顺序在服务器主线程上执行，回复也按这个顺序回。可以不等回复连着发好几条。服务器卡的时候回复会晚到，MineDeck 的超时设 15 秒左右。
- 不认识的字段一律忽略。

RESPONSE：成功 `{"id": 1, "ok": true, ...}`；失败 `{"id": 1, "ok": false, "code": "no_player", "error": "玩家不在线：Steve"}`，有的错误还带别的字段（比如 `not_enough` 带 `have`）。`error` 是给人看的中文说明，MineDeck 按 `code` 判断。REQUEST 不是 JSON 对象、缺 `id` 或 `op` 时回 `bad_json`，`id` 取不到就是 `null`。

| `op` | 参数（带 * 的必填） | 做什么 | 成功时回复里有 |
|---|---|---|---|
| `spawn` | `name`（1–32 个字，默认「伙伴」，不能和现有伙伴重名，不分大小写）、`owner`（主人的游戏名，可以不在线）、`tag`（MineDeck 自己的标记，1–64 个 `A-Z a-z 0-9 _ . : -`）；位置三选一：`near`（在线玩家名，出生在他旁边、同一维度）、`x`+`z`（+`y`，+`dim`，默认主世界，`y` 不写就放在地面上）、都不写时在主人旁边（主人不在线就在世界出生点） | 刷出一个伙伴，分配编号 | `companion`（编号）、`info`（伙伴对象） |
| `despawn` | `companion` 或 `"all": true`；`drop`（默认 `false`：背包里的东西一起消失；`true`：掉在地上） | 移除伙伴 | `removed`（编号数组） |
| `status` | `companion`（不写就是全部）、`inventory`（默认 `false`） | 查状态 | `companions`（伙伴对象数组）、`config`（同 WELCOME） |
| `collect` | `item`*、`count`（1–2304，默认 1）、`timeout` | 采集或合成 N 个某物。PlayerEngine 的 `get N` 是「再弄 N 个」，背包里已有的不算 | `task` |
| `follow` | `player`（默认主人）、`timeout`（默认 0，一直跟） | 跟着某人走，直到被停下、被新任务替换、超时或那人下线 | `task` |
| `goto` | `x`*、`z`*、`y`（不写就只管水平位置）、`timeout` | 走到某处，只在伙伴所在的维度里走 | `task` |
| `attack` | `mob`*（生物种类 ID，如 `minecraft:zombie`，原版可省 `minecraft:`）、`count`（1–64）、`duration`（1–1800 秒）、`radius`（1–48 格，默认 16）、`timeout` | 打某种生物：只打以开始时伙伴的位置为中心、`radius` 以内的；打够 `count` 只、或者打满 `duration` 秒就结束（两个都写时先到的算；都不写就是 `count` = 1）。只给 `duration` 时是「守在这里，来一只打一只」 | `task` |
| `give` | `item`*、`count`（默认 1）、`player`（默认主人）、`fetch`（默认 `false`：背包里不够就回 `not_enough`；`true`：不够就先去弄）、`timeout` | 把背包里的东西交给玩家（走到旁边扔给他） | `task` |
| `stop` | `companion` 或 `"all": true` | 停下当前任务（连 PlayerEngine 的闲置动作一起停） | `stopped`（被停下的任务编号数组） |
| `say` | `text`*（1–256 个字）、`to`（玩家名：只发给他一个人） | 以伙伴的名字在聊天栏说一句话 | — |

- 参数先由模组检查：物品名只能是小写字母、数字和 `_ . - : /`，生物种类同样，玩家名只能是 1–20 个字母、数字、`_`、`.`，数量、坐标都是整数（坐标 ±30000000 以内，`y` 在 -2048–2048），所以拼出来的 PlayerEngine 指令里不会混进空格或 `;`（PlayerEngine 用 `;` 串联多条指令），大模型没法借参数塞进清单外的动作。
- **`timeout`**（秒）：任务最多做多久，到了就停下，结果是 `timeout`。默认：`collect` 600，`goto`、`give` 300，`attack` 300（只给 `duration` 时是 `duration` + 30），`follow` 0。0 表示不限（`follow` 以外的任务最少 5 秒），最大 86400。
- **`attack` 永远不打**：玩家、MineDeck 的伙伴、有主人的动物（驯服的狼、猫、马……）、起了名字的生物（用过命名牌的）、拴着绳子的生物，以及配置里 `attack_deny` 列出的种类（默认是村民、流浪商人、铁傀儡、雪傀儡、悦灵）。指定的种类本身在这些里面时回 `forbidden`；同种类里个别不能打的（比如起了名字的僵尸）直接跳过。
- **`say`** 的格式是 `<名字> 文本`，名字是青色的，鼠标悬停显示「MineDeck AI 伙伴」；`to` 私聊时前面加灰色的「（悄悄话）」。这句话不经过原版的聊天系统，服务端控制台里不会出现 `<名字> 文本` 这种和玩家聊天一样的行（免得被当成玩家说的话），只有模组自己记的一行 `伙伴「名字」说：文本`。
- 坐标、血量这类浮点数保留 1 位小数。

**任务**：`collect`、`follow`、`goto`、`attack`、`give` 是任务。每个伙伴同一时间只有一个任务，给它新任务会把旧任务顶掉（旧任务的结果是 `superseded`）。开始时先发 `task_started` 事件，再回 RESPONSE（带 `task`）；结束时发 `task_finished`。任务对象：

```json
{"id": 7, "companion": 1, "op": "collect", "args": {"item": "oak_log", "count": 3}, "timeout": 600, "startedAt": 1793432400000, "command": "get oak_log 3"}
```

`id` 是任务编号（这次开服以来所有伙伴共用一个计数），`args` 是整理过的参数（补上了默认值），`startedAt` 是毫秒时间戳，`command` 是交给 PlayerEngine 的指令（只用来排错，格式不保证，`attack` 没有）。

**错误码**（RESPONSE 的 `code`）：

| `code` | 意思 |
|---|---|
| `bad_json` | REQUEST 不是 JSON 对象，或者缺 `id`、`op` |
| `unknown_op` | 不认识的 `op` |
| `bad_args` | 参数缺了、类型不对、超出范围 |
| `no_companion` | 没有这个编号的伙伴（或者一个伙伴都没有） |
| `ambiguous` | 没写 `companion`，而现在有不止一个伙伴 |
| `not_ready` | 伙伴刚刷出，PlayerEngine 还没准备好（第一个 tick 之前），稍后再试 |
| `limit` | 伙伴数量到上限了（带 `limit`） |
| `name_taken` | 已经有一个同名的伙伴 |
| `no_player` | 玩家不在线（或者不写 `player` 时伙伴没有主人、主人不在线） |
| `not_enough` | `give` 时背包里不够（带 `have`） |
| `forbidden` | 不许做：打玩家、打伙伴、打 `attack_deny` 里的生物 |
| `rejected` | PlayerEngine 不接受这条指令，比如物品不存在（`error` 里是它的原话） |
| `spawn_failed` | 伙伴没能加进世界 |
| `internal` | 模组内部出错（日志里有详情） |

### 事件

EVENT 的 JSON 都有 `event`（事件名），和伙伴有关的都有 `companion`（编号）。

| `event` | 什么时候 | 其他字段 |
|---|---|---|
| `spawned` | `spawn` 刷出了伙伴 | `info`（伙伴对象） |
| `adopted` | 存档里的伙伴被加载、接管了（服务器重启后；一般在 MineDeck 连上之前就接管完了，那时只体现在 WELCOME 里） | `info` |
| `task_started` | 任务开始 | `task` |
| `task_finished` | 任务结束 | `task`、`result`、`detail`（中文说明，可能没有）、`seconds`（用时）、`pos`（结束时伙伴的位置）；`collect` 还有 `have`（背包里共有几个）、`gained`（这次多了几个）、`want`；`attack` 还有 `killed`、`want`（只给 `duration` 时是 `null`）；`give` 还有 `given`（背包里少了几个）、`have` |
| `stuck` | 伙伴卡住了：任务进行中 30 秒几乎没动（`follow` 时离玩家 6 格以内不算，`attack` 时范围里没有目标不算），或者反复想拆、想放禁挖区域里的方块 | `task`（任务编号，没有任务时为 `null`）、`reason`（`no_progress` / `nodig`）、`detail`、`pos`。同一个伙伴同一种原因，动起来之前只报一次 |
| `died` | 伙伴死了（背包里的东西掉在原地） | `uuid`、`name`、`cause`（死亡信息）、`pos`；随后还有一个 `removed` |
| `removed` | 伙伴没了 | `uuid`、`name`、`reason`：`despawn`（MineDeck 移除的）、`died`、`discarded`（被命令或别的模组清掉了）、`lost`（重启后存档里找不到了） |
| `config_applied` | 配置文件改了、重新读进来了 | `config`（同 WELCOME） |

`task_finished` 的 `result`：

| `result` | 意思 |
|---|---|
| `done` | 做完了 |
| `incomplete` | 结束了但没做够：`collect` 多出来的少于 `want`，`attack` 打到的少于 `count`（范围里 15 秒没有目标就算结束） |
| `failed` | 失败：PlayerEngine 报错、找不到路、`follow` 的玩家下线了、伙伴换了维度 |
| `cancelled` | 被停下：`stop`、伙伴被移除或死了 |
| `superseded` | 被新任务顶掉了 |
| `timeout` | 超过了 `timeout` |

`pos`：`{"dim": "minecraft:overworld", "x": 1.5, "y": 64.0, "z": -3.5}`。

### 伙伴对象

```json
{
  "id": 1,
  "uuid": "4e427761-5412-458d-bd14-c95ec392229b",
  "name": "小木",
  "owner": "Steve",
  "ownerUuid": "8667ba71-b85a-4004-af54-457a9734eed7",
  "tag": "persona-1",
  "dim": "minecraft:overworld",
  "x": 32.5, "y": 64.0, "z": -383.5,
  "health": 20.0, "maxHealth": 20.0,
  "state": "busy",
  "task": {"id": 7, "companion": 1, "op": "collect", "args": {"item": "oak_log", "count": 3}, "timeout": 600, "startedAt": 1793432400000, "command": "get oak_log 3"},
  "lastResult": null,
  "engineTask": "<Mine oak_log> "
}
```

- `id`：编号，刷出时由模组分配（从 1 起，用现有伙伴没用的最小的数），存进存档，重启后不变。
- `owner`、`ownerUuid`、`tag`：没有时为 `null`。`ownerUuid` 只有主人刷出伙伴时在线（或者服务器认识这个名字）才有。主人只是 MineDeck 的标记，模组只用它做 `follow`、`give` 的默认玩家和 `spawn` 的默认位置；PlayerEngine 那边伙伴始终没有主人，不会去登录 Player2。
- `state`：`starting`（PlayerEngine 还没准备好）、`idle`、`busy`（有任务）。
- `lastResult`：最近一次结束的任务，和 `task_finished` 的字段一样（没有 `event`、`companion`），多一个 `at`（结束时的毫秒时间戳）；还没做过任务时为 `null`。
- `engineTask`：PlayerEngine 自己的当前任务，只用来排错，格式不保证。
- 背包只在 `status` 带 `"inventory": true` 时才有：`inventory`（`[{"slot": 0, "item": "minecraft:oak_log", "count": 3}]`，0–35 是主背包、36–39 是盔甲、40 是副手）、`selectedSlot`。

STATUS：`{"companions": [伙伴对象…]}`，不带背包。

### 兼容规则

1. 两边都忽略不认识的 JSON 字段、事件名和帧类型。
2. 加新指令、新事件、新的可选参数和字段都不升协议版本。MineDeck 用新指令、新能力之前先看 WELCOME 的 `ops`、`features`。
3. 模组会忽略它不认识的参数，所以以后新加的可选参数，不写时的行为必须和旧版一样（安全的那一边）。
4. `code`、`result`、`reason`、`state` 以后可能加新值。MineDeck 把不认识的 `code` 当成一般失败，不认识的 `result` 当成 `failed`，不认识的 `state` 当成 `busy`，不认识的 `reason` 照原样显示。
5. 已有字段的类型和含义不变：编号是整数，坐标、血量是数字，时间戳是毫秒数。要改就升协议版本。

### 配置文件

`<服务端目录>/config/minedeck/companion.properties`（和音乐桥接的 `voicebridge.properties` 同一层），UTF-8，Java properties 格式（`#` 开头是注释）。文件不存在时模组生成一份端口关闭的模板。MineDeck 开服前写好；服务器运行时也可以改，**每 2 秒读一次，和上次应用的内容逐字节比较**，变了就隔 0.15 秒再读一遍，两次一样才应用（不看修改时间：同一毫秒里连写两次会漏）。MineDeck 写的时候先写临时文件再改名。

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 打不打开控制端口。改成 `false` 时断开当前连接、关掉端口 |
| `port` | `24480` | 1024–65535。改了会断开当前连接，换端口重新监听；端口被占时每 10 秒重试一次 |
| `token` | 随机 32 位十六进制 | 16–255 个可见 ASCII 字符。改了只影响之后的新连接 |
| `max_companions` | `4` | 同时最多几个伙伴，1–16。调低了不会移除现有的，只是不能再刷 |
| `attack_deny` | `minecraft:villager,minecraft:wandering_trader,minecraft:iron_golem,minecraft:snow_golem,minecraft:allay` | `attack` 不许打的生物种类，逗号分隔；写成空的（`attack_deny=`）表示没有额外限制。玩家、伙伴、有主人的、起了名字的、拴着的生物不管这里怎么写都不打 |
| `nodig.<名字>` | 没有 | 禁挖区域，见下 |

`enabled`、`port`、`token` 写错（端口不是数字、令牌太短）时不开端口，原因写进日志。其余的键写错只是那一项不生效（用默认值或跳过那个区域），原因写进日志和 `config.problems`。

**禁挖区域**：

```properties
nodig.base=minecraft:overworld -120 -64 -80 -40 320 10
nodig.farm=minecraft:overworld 200,60,200 260,90,260
```

- `<名字>`：1–32 个字母、数字、`_`、`-`。
- 值：维度 ID，然后是两个角的方块坐标 x y z（整数，包含两端，两个角谁先谁后都行），用空格或逗号隔开。维度写完整的 ID：`minecraft:overworld`、`minecraft:the_nether`、`minecraft:the_end`，模组的维度照写。
- 最多 64 个，改了马上生效（发 `config_applied`）。
- 效果：伙伴不拆、也不放区域里的方块，包括往区域里倒水倒岩浆、点火、锄地这类「对方块用物品」的动作；对区域里的方块，除了开关门、活板门、栅栏门，不做别的右键交互（按钮、拉杆、箱子……）。可以从区域里走过。`collect` 不会去拿区域里的方块；寻路要穿过区域、得拆区域里的方块时，伙伴改走不拆不放的路（绕过去），绕不过去就报 `stuck`（`reason` 是 `nodig`）。做法见「实现要点」。

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
