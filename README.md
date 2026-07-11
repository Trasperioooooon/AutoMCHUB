# AutoMCHUB · Minecraft 一键开服工具

Windows 本地运行的 **MC 多人联机服务器自动部署工具**（单文件 `AutoMCHUB.exe`，约 8 MB，零依赖）。

选好版本点创建，自动完成：**匹配并下载便携式 Java → 下载服务端核心 → 运行安装器 → 同意 EULA → 生成配置与启动脚本 → 图形界面管理开服**。全程使用国内镜像加速（BMCLAPI / 清华 TUNA），官方源自动兜底。

> 本工具只负责本机/局域网开服。异地联机请配合内网穿透工具（樱花穿透等）转发实例端口即可。

---

## ✨ 功能一览

| 能力 | 说明 |
|---|---|
| **十二种服务端核心** | Vanilla 原版 · Paper / Purpur / Leaves / Folia（插件服）· Fabric / NeoForge / Forge（模组服）· Mohist / Banner（模组+插件混合服）· Velocity / Waterfall（群组代理端） |
| **本机 Java 扫描** | 自动发现已安装的 Java（注册表/PATH/常见目录），能复用就不下载 |
| **控制台增强** | GBK/UTF-8 编码切换（老包乱码克星）、WARN/ERROR 着色、日志过滤、命令历史（↑↓） |
| **MOTD 彩色编辑器** | § 色码调色板 + 实时预览，Emoji/中文自动按规范转义 |
| **版本范围** | MC 1.12.2 → 最新（含 26.x 新版本号体系，版本列表实时从官方清单获取，未来版本自动支持） |
| **Java 全自动** | 读取 Mojang 官方 `javaVersion` 元数据精确匹配（8/16/17/21/25...），便携部署于 `runtimes/`，**不碰系统环境变量、不与已装 Java 冲突** |
| **下载三级加速** | BMCLAPI / 清华 TUNA 优先 → Adoptium/官方源 → Mojang 官方运行时，逐源故障转移 + 3 轮重试 + SHA 校验 |
| **安装器加固** | Forge/NeoForge 官方安装器自动附加 `--mirror`（BMCLAPI）、预放置原版 server.jar 跳过其直连 Mojang 的下载、失败自动重试 3 次 |
| **图形界面** | 深色主题 GUI（WebView2 原生窗口，缺失时自动用浏览器打开）：创建向导 / 实时控制台 / 命令下发 / 配置面板 |
| **整合包一键导入** | Modrinth (.mrpack) 拖入即开服（自动识别核心/版本/加载器，跳过纯客户端文件）；CurseForge zip 配 API Key 可用 |
| **内网穿透** | 接入 OpenFrp（基于 OpenFrp OPENAPI）/ 樱花frp / 自定义 frps，frpc 自动下载托管、跟随服务器启动、公网地址一键复制 |
| **运维三件套** | 世界备份/还原（运行中热备）· 崩溃自动重启（退避策略）· 每日定时重启/命令/备份 |
| **玩家管理** | 在线列表（踢出/OP）、白名单/管理员/封禁可视化（停机时直接改名单文件，离线 UUID 自动计算） |
| **资源浏览器** | 实例内直接搜索安装 Modrinth 模组/插件（按核心与版本自动过滤兼容项） |
| **远程管理** | 局域网访问开关 + 密码登录，手机躺床上管服；开放 REST API + Webhook 事件推送（见 docs/API.md） |
| **自动更新** | 检查 GitHub Releases（国内加速镜像兜底），一键换血重启 |
| **常用配置面板** | 正版验证（**默认关**）、允许飞行（默认开）、PVP、难度、游戏模式、白名单、视距、MOTD（中文自动转义）等 17 项开关化，另有全量 `server.properties` 编辑器 |
| **进程托管** | 一键启停、`stop` 优雅关服（30 秒超时强杀）、启动前端口占用预检、程序退出自动停服、Job Object 兜底防止孤儿 java 进程 |
| **安全防呆** | 老版本自动启用 log4shell 官方缓解方案；清除 `JAVA_HOME`/`_JAVA_OPTIONS` 等环境污染；下载文件哈希校验；本地 API 带随机令牌 |

## 🚀 使用

1. 把 `AutoMCHUB.exe` 放进一个**独立文件夹**（所有数据都存在 exe 旁边：`servers/` 实例、`runtimes/` Java、`cache/` 下载缓存）。
2. 双击运行，在窗口中点「新建服务器」→ 选核心 → 选版本 → 选构建 → 勾选 EULA → 创建。
3. 创建完成后点「▶ 启动」，等控制台出现 `Done (...)!` 即开服成功。
4. 局域网玩家用 `你的内网IP:端口` 直连；异地玩家用穿透工具映射同一端口。

常见操作：
- **发命令**：实例 → 控制台 → 底部输入框（`op 玩家名`、`whitelist add 玩家名`、`say 内容`…）
- **改配置**：实例 → 常用设置（开关化）或 全部配置（全量键值）；运行中修改需重启生效
- **调内存**：实例 → 内存/启动 → 滑块
- **手动开服**：每个实例目录内有与 GUI 等效的 `run.bat`
- **命令行模式**：`AutoMCHUB.exe -nogui -port 27333`（仅后台服务，浏览器访问日志中的 URL）

## 🔧 从源码构建

需要 Go 1.24+（Windows）：

```powershell
$env:GOPROXY = 'https://goproxy.cn,direct'   # 国内加速
go build -trimpath -ldflags="-s -w -H windowsgui" -o AutoMCHUB.exe .
```

调试版（带控制台日志）：`go build -o automchub-cli.exe .` 后运行 `automchub-cli.exe -nogui`。

## 🏗️ 架构

```
main.go                 入口：HTTP 服务 + WebView2 窗口/浏览器回退 + 优雅退出
internal/
├── app/     基础目录与全局配置（下载源策略、内存探测）
├── dl/      多源故障转移下载器（重试/看门狗/SHA-1/256/MD5/原子落盘）
├── mcsrc/   六核心版本源：Mojang 清单(BMCLAPI 镜像)、Forge、NeoForge、
│            Fabric Meta、Paper Fill v3、Purpur v2；版本排序基于官方清单
├── java/    便携 Java 三级下载链（TUNA → Adoptium API → Mojang 运行时）
├── inst/    实例：创建流水线、安装器托管、run.bat 生成、server.properties
│            保序读写（\uXXXX 转义）、进程状态机、控制台环形缓冲 + 订阅
├── tasks/   后台任务进度（供前端轮询）
└── web/     REST API + SSE 控制台流 + go:embed 前端（ui/ 深色主题 SPA）
```

关键设计决策见 `docs/MC自动化开服技术实现方案与版本映射表.md`（含实测验证过的版本映射与下载源矩阵）。

## 📋 版本 ↔ Java 对照（自动处理，无需记忆）

| MC 版本 | Java | 服务端可选核心 |
|---|---|---|
| 1.12 – 1.16.5 | 8 | Vanilla / Paper / Purpur(1.14+) / Forge / Fabric(1.14+) |
| 1.17.x | 16 | 同上 |
| 1.18 – 1.20.4 | 17 | 同上 |
| 1.20.5 – 1.21.x | 21 | + NeoForge(1.20.2+) |
| 26.1+（年份版本号） | 25 | Vanilla / Paper / Purpur / Fabric / NeoForge |

*实际以 Mojang 版本元数据的 `javaVersion.majorVersion` 为准，上表仅为离线兜底。*

## ⚠️ 已知边界

- Paper / Purpur 官方 API 无国内镜像（Cloudflare 直连一般可用）；Forge/NeoForge 安装器的部分依赖库下载仍需可访问官方 maven（已用 `--mirror` + 重试缓解）。
- 首次启动某实例时 Windows 防火墙可能弹窗，请选择「允许访问」，否则局域网玩家无法连接。
- 删除 `runtimes/` 会导致已建实例无法启动（重新创建实例即可自动补全）。
