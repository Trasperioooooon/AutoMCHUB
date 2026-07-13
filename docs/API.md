# AutoMCHUB 开放 API

AutoMCHUB 的 GUI 与后端通过本地 HTTP API 通信，该 API 同时对外开放，可用任何语言编写扩展（这替代了传统"插件系统"）。

## 认证

- 本机：请求头 `X-Token: <token>`（token 在启动 URL 的 `?token=` 参数中，每次启动随机）
- 局域网模式：`POST /api/login {"password": "..."}` 换取会话 Cookie
- SSE 端点可用查询参数 `?token=` 传递
- **仅本机（loopback）端点**：`/api/pickdir`、`/api/openpath` 会调起系统对话框 / 资源管理器，只接受来自本机的请求；局域网会话调用返回 403
- **免 token 端点**：`GET /bg/{name}` 提供程序旁 `bg/` 目录内的壁纸图片（供前端 CSS `url()` 引用，仅受 Host 校验约束）

## 端点总览

### 应用
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/app` | 版本、内存（`ramMb`/`availRamMb`）、实际监听端口 `port`、`serversRoot`/`backupsRoot`、`autoStart`（开机自启真值，查注册表）、`config`、本机 IP |
| PUT | `/api/config` | 局部更新配置（见下方「配置键」；仅传要改的键） |
| POST | `/api/pickdir` | 弹系统文件夹选择框，返回 `{path}`（取消为空）。**仅本机** |
| POST | `/api/openpath` | 在资源管理器打开 `{path}` 目录。**仅本机** |
| GET | `/api/bg` | 列出 `bg/` 目录内壁纸文件名 `{images:[...]}` |
| GET | `/bg/{name}` | 提供单张壁纸图片（免 token，`filepath.Base` 防穿越） |
| POST | `/api/shutdown` | 优雅退出（自动停服） |
| POST | `/api/update/check` · `/api/update/apply` | 检查/应用更新 |
| GET | `/api/cores` | 12 种核心元数据（id/name/tag/desc/kind） |
| GET | `/api/mcversions?core=&snapshots=` | 版本列表 |
| GET | `/api/builds?core=&mc=` | 构建列表 |
| GET | `/api/javas` · POST `/api/javas/scan` · POST `/api/javas/add` | Java 管理 |

**配置键**（`PUT /api/config`，均为可选、只更新所传字段）：
`source`（auto/mirror/official）、`cfApiKey`、`webhookUrl`、`updateRepo`、`checkUpdateOnStart`、`serversDir`（实例存放根，空=默认）、`backupsDir`（备份根）、`backupKeep`（每实例保留份数 1–1000）、`onboarded`（首启引导完成标记）、`minimizeToTray`（关窗最小化到托盘）、`autoStart`（开机自启，直写 `HKCU\...\Run`）、`listenLan`、`lanPassword`（明文，存为 SHA-256）。

### 实例
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/instances` | 实例列表；每项含 `name/core/kind/mc/build/javaMajor/xmxMb/xmsMb/port/status/motd/dir/createdAt/consoleEncoding/onlineCount/uptimeSec/maxPlayers/extraJvm` |
| POST | `/api/instances` | 创建（返回 taskId，轮询 `/api/tasks/{id}`）；body 可含 `difficulty/gamemode/root` 等 |
| POST | `/api/import/modpack` | multipart 导入整合包（file + name/xmxMb/port/eula/onlineMode/allowFlight/root） |
| POST | `/api/instances/{name}/start` \| `/stop` \| `/kill` | 进程控制 |
| POST | `/api/instances/{name}/command` | `{"cmd":"say hi"}` |
| POST | `/api/instances/{name}/opendir?sub=` | 在资源管理器打开实例目录或其白名单子目录（`sub` ∈ mods/plugins/world/logs/crash-reports），**仅本机** |
| GET | `/api/instances/{name}/console` | SSE 控制台流（先回放后实时） |
| GET/PUT | `/api/instances/{name}/properties` | server.properties 读写 |
| PUT | `/api/instances/{name}/settings` | `{xmxMb, xmsMb, consoleEncoding, extraJvm}`（`extraJvm` 为字符串数组，一行一参） |
| GET/PUT | `/api/instances/{name}/policies` | 崩溃重启 + 定时任务 |
| GET/POST | `/api/instances/{name}/backups`；POST `.../backups/restore`；DELETE `.../backups?file=` | 备份（保留份数由全局 `backupKeep` 控制） |
| GET/POST | `/api/instances/{name}/players` | 玩家名单与操作 `{action, player}` |
| GET | `/api/instances/{name}/resources/search?q=` | Modrinth 兼容资源搜索 |
| POST | `/api/instances/{name}/resources/install` | `{projectId}` 安装到 mods/plugins |
| DELETE | `/api/instances/{name}?files=1` | 删除实例 |

`GET /api/tasks/{id}` 快照除进度/日志外，还含 `warnings[]`（结构化告警，如 CurseForge 未解析模组清单 `{kind,title,note,items:[{name,url}]}`），供导入完成页醒目呈现。

### 穿透
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/tunnels` | 列表（每项含运行态 `lastError`——frpc 最近一条失败原因，成功后清空）/ 新增 |
| PUT/DELETE | `/api/tunnels/{id}` | 修改 / 删除 |
| POST | `/api/tunnels/{id}/start` \| `/stop` | 启停 frpc |
| GET | `/api/tunnels/{id}/console` | SSE frpc 日志 |

所有响应统一为 `{"ok": true, "data": ...}` 或 `{"ok": false, "error": "..."}`。

## Webhook 事件

在全局设置配置 URL 后，以下事件将以 JSON POST 推送（失败重试 3 次）：

```json
{ "type": "player.join", "time": "2026-07-12T03:00:00+08:00",
  "data": { "instance": "我的服务器", "player": "Steve" } }
```

事件类型：`instance.start` / `instance.stop` / `instance.crash`、`player.join` / `player.leave`、`backup.done`、`tunnel.up` / `tunnel.down`。
