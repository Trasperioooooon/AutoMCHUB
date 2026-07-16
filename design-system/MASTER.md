# AutoMCHUB 设计系统 MASTER · v3「现代分层」

> **本文件是唯一事实来源（Single Source of Truth）。**
> 屏幕级偏离写在 `design-system/pages/<screen>.md`，且必须注明偏离理由；没有对应文件 = 该屏幕完全遵循本文件。
> 外部参考（UX 数据库、竞品、文章）只作灵感，**永不覆盖本文件**。
> 来源：`internal/web/ui/app.css` 注释与实现、`docs/UI与体验改进调研报告.md`（§1 暖纸色板 + 附录 A 对比度实测、§4/§5 HMCL 行式控件）、`app.js` 组件实现。
> 标注 **[v3.1 新约定]** 的条目是本轮「屏幕构图重构」新增的规范，非历史转录。

---

## 1. 设计身份

**一句话**：现代桌面管理工具的分层秩序 + 克制的 Minecraft 记忆点。

- **现代分层**（参照 Material 3 / Radix Colors / Primer）：
  - 明度阶梯 `bg → surface → surface-2` 三级清晰分层；浅色 = 暖白卡浮于米色纸底，深色 = 绿调中性阶梯。
  - 单一深度语言：**发丝边框 + 极轻投影**。禁用浮雕、硬描边、多重渐变。
  - 深色降饱和：强调绿收敛为 `#6fd24b`，文本级再柔一档。
- **MC 记忆点**（签名元素，不可移除）：
  1. 底部**物品栏导航**（4 格 + 数字键位角标 + 选中时 MC 式白/墨描边框）；
  2. **体素方块**（`.cube`，颜色 = 核心材料色）；
  3. **经验条**式进度（斑马纹绿条 `.progress-bar`、卡片底部 `.dur` 状态条）；
  4. **材料语义色**（草绿 / 钻石 / 金 / 红石，见 §2.3）;
  5. 状态闪烁用 `steps(2, end)`（游戏式跳帧，仅限 starting/stopping 呼吸灯）。
- **克制原则**：签名元素只在上述 5 处发力，其余一切从平（Chanel 法则：出门前摘掉一件配饰）。

## 2. 色彩令牌

### 2.1 深色（默认，绿调中性阶梯）

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#121715` | 页面底 |
| `--surface` | `#1b211e` | 卡片 / 弹层 |
| `--surface-2` | `#232b27` | 次级面（按钮底等） |
| `--sunken` | `#0d110f` | 凹陷面（输入槽、物品栏格、chips） |
| `--border` / `--border-strong` | `rgba(255,255,255,.09)` / `.17` | 发丝边 / 强边 |
| `--text` / `--muted` | `#e4eae5` / `#9db0a2` | 正文 / 次要 |
| `--accent` | `#6fd24b` | 图形级强调绿（dot、进度、图形） |
| `--accent-text` | `#8fdd72` | 文本级强调绿（更柔） |
| `--accent-solid` / `-hov` | `#367d24` / `#47a231` | 实底按钮（白字过 AA ≈5:1） |
| `--diamond` | `#58c9d8` | 链接 / 信息 |
| `--gold` | `#d9b23f` | 过渡态 / 警示 |
| `--redstone` | `#e0604f` | 错误 / 危险（文本与图形） |
| `--red-solid` / `-hov` | `#a63c2c` / `#b8462f` | 危险实底 |
| `--err-bg` / `--err-text` | `rgba(224,96,79,.12)` / `#f0a294` | 错误容器 |
| `--frame` | `#eef2ee` | 物品栏 MC 选中框（深色=白框） |
| `--hud-bg` | `#161c19` | 顶部 HUD |
| `--hotbar-fade` | `rgba(9,12,10,.85)` | 物品栏底部渐隐 |
| `--term-bg` | `#101412` | 终端容器（**双主题恒深**） |
| `--bg-veil` | `rgba(18,23,21,.88)` | 壁纸蒙版（只露约 12% 图） |
| `--shadow-sm` / `--shadow-md` | `0 1px 2px rgba(0,0,0,.35)` / `0 8px 24px rgba(0,0,0,.3)` | 两档投影，无第三档 |

### 2.2 浅色（暖沙中性：调研报告 §1 方案 B）

暖白卡浮于米色纸底；参照 Radix Sand 与 claude.ai 象牙纸之间，**弃纯白防眩光**（surface 相对亮度 ≈0.955，刻意不触顶）。

| Token | 值 | 备注 |
|---|---|---|
| `--bg` | `#efece2` | 暖米纸底 |
| `--surface` | `#fbfaf5` | 暖白卡（与 claude.ai `#faf9f5` 同族） |
| `--surface-2` | `#f5f3ea` | |
| `--sunken` | `#e6e2d6` | |
| `--border` / `--border-strong` | `rgba(62,55,32,.13)` / `.26` | 暖底发丝 |
| `--text` / `--muted` | `#221f18`（暖黑） / `#625d4e` | |
| `--accent` | `#3e8f2a` | |
| `--accent-text` | `#256a19` | 沙底绿字加深过 AA（≈5:1） |
| `--accent-solid` / `-hov` | `#367d24` / `#2f6d1f` | |
| `--diamond` | `#0e7f8c` | 浅色加深保 AA |
| `--gold` | `#93690f` | 浅色加深保 AA |
| `--redstone` | `#c23a29` | |
| `--red-solid` / `-hov` | `#bb4531` / `#a83c29` | |
| `--err-bg` / `--err-text` | `#f7e8e2` / `#9a2a1c` | |
| `--frame` | `#262b27` | 浅色=墨框 |
| `--hud-bg` | `#fbfaf5` | |
| `--hotbar-fade` | `rgba(231,226,214,.82)` | |
| `--bg-veil` | `rgba(239,236,226,.86)` | |
| `--shadow-sm` / `--shadow-md` | `0 1px 2px rgba(60,50,28,.08)` / `0 8px 24px rgba(60,50,28,.11)` | 暖色投影 |

明度层次铁律：**surface > surface-2 > bg > sunken**（浅色实测 0.955 > 0.894 > 0.838 > 0.761）。

### 2.3 材料语义色使用规则

- **草绿（accent 系）**：唯一品牌色。运行中状态、主行动按钮、选中态、经验条。图形用 `--accent`，小字号文本必须用 `--accent-text`。
- **钻石（diamond）**：链接、信息类标签（如「游戏规则」tag）。
- **金（gold）**：过渡态（starting/stopping）、非阻断警示（「重启生效」「运行中修改」）。
- **红石（redstone）**：错误、危险操作。危险按钮默认为描边幽灵态（`.btn.danger`），实底红仅用于确认弹层内的最终确认键。
- 彩色小字（accent-text / err-text / gold）**只放在 surface 上**（实测 ≥4.5:1）；放 bg 裸底时必须加粗或 ≥18px（大字 AA 3:1 有富余）。

### 2.4 核心材料色（体素方块 `--c`，转录自 app.js CORE_COLORS）

vanilla `#7ec850` · paper `#e8e4d8` · purpur `#b57edc` · leaves `#57c25e` · folia `#35c4b5` · fabric `#c7b88a` · neoforge `#e8863c` · forge `#5a6b8c` · mohist `#c0693a` · banner `#d9a441` · velocity `#4fd8e0` · waterfall `#4f9be0` · 未知核心 `#8fa08e`。

### 2.5 对比度基线（WCAG 相对亮度实测，转录自调研报告附录 A.3）

| 检查对 | 浅色实测 | 达标线 |
|---|---|---|
| text / surface | 15.7:1 | ≥10 |
| text / bg | 13.9:1 | ≥10 |
| muted / surface | 6.2:1 | ≥4.6 |
| muted / bg | 5.5:1 | ≥4.6 |
| accent-text / surface | 4.9:1 | ≥4.5 |
| err-text / surface | 7.3:1 | ≥5 |
| 白字 / accent-solid | 4.0:1 | ≥3.5（14px 粗体按钮字） |

深色侧：`--accent-solid` 实底配白字 ≈5:1；`--accent-text`、`--err-text` 均为「文本级再柔/再亮一档」的达标值。**任何新增配色组合必须先算再用。**

## 3. 字体排印

| 角色 | 字体栈 | 规格 |
|---|---|---|
| 正文 | `"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui` | 14px 基准，antialiased |
| 品牌/数据 `--brand` | `"Cascadia Code", "Cascadia Mono", Consolas` | logo、eyebrow、键位角标、步骤图标 |
| 等宽 `--mono` | `"Cascadia Mono", Consolas` | 控制台、路径、键名、摘要值 |

字阶（全部转录自现实现）：

- `h1` 21px/700，letter-spacing .3px；`h3` 15px；设置分区 `h2` 15px/700
- `.eyebrow` 11px/600，letter-spacing 3px，大写，`--accent-text`，brand 字体 —— 每个页面标题上方的定位词（SERVER LIST / CRAFTING / OPTIONS…）
- `.sub` 13px muted lh1.7 · `.hint` 12px muted lh1.7 · `.badge` 11px · 按钮 13px/600（sm 12px）· 行式控件标题 13px/700、副题 11px · 控制台 12.5px mono（可调 9–22）

**规则**：中文界面不用斜体；数字/路径/键名一律 mono 或 brand；禁止引入任何外部字体。

## 4. 布局与间距

- **应用骨架**：`HUD(顶栏=标题栏) → #main(滚动区) → hotbar(底部物品栏)`，窗口无边框，HUD 空白处可拖动窗口（mousedown 桥接，**不可破坏**）。
- **[v3.1 新约定] 内容宽度两档（令牌化）**：`#main` 内容居中，工作框上限 `--w-wide: 1240px`（`padding: 28px max(34px, calc((100% - var(--w-wide))/2)) 22px`）。屏幕内容据性质二选一，**不混用**：
  - **数据面 → `--w-wide`（1240px）**：实例卡网格、控制台、玩家/属性面、隧道列表、原始 properties 表 —— 桌面工具的数据面应铺满工作宽度，不再被窄栏浪费。
  - **阅读面 → `--w-read`（760px）**：设置正文、向导表单、行式控件、说明性长文 —— 收窄保 60–75 字行长，护读性。
  - 旧 `--content-max: 1080px` 已弃用（尴尬的中间档，正是「浪费桌面宽度」之源）；各屏重构时把 `var(--content-max)` 引用迁到 `--w-wide` 或 `--w-read`，迁完删除该令牌。
  - **底部物品栏永远居中**，是身份元素，与内容宽度档无关。
- **[v3.2 新约定] 页面标题恒锚顶部左上**：`eyebrow + h1` 一律从 `#main` 内容列顶部开始，任何屏幕不得整页竖向居中或另设水平居中容器（旧 `#main.center` 与 `.settings-page` 居中已废除——它们使标题随页跳位）。稀疏主体（创建入口的模式选择卡、空态卡）用 `.page-fill`（`flex:1` + 竖向居中）只居中**标题以下**的内容。
- **[v3.2 新约定] 滚动条槽恒定**：`#main` 置 `scrollbar-gutter: stable`，防止各页内容高低不同导致滚动条时有时无、居中列左右横跳。
- **圆角三档**：`--radius-sm: 6px`（小件：code、tag）· `--radius-md: 9px`（按钮、输入框）· `--radius-lg: 12px`（卡片、容器）· `--radius-pill: 999px`。同层级同档，不混用。
- **[v3.1 新约定] 间距节奏 4px 网格**：组件内间距与外边距取 `4 / 8 / 12 / 16 / 20 / 24 / 28 / 32`。历史遗留的 11/13/15/17px 在各屏幕重构时顺手归一，**不做全局一次性替换**。垂直节奏基准：区块间 24，卡片内段落间 12，标签与控件间 6→8。
- **响应下限**：窗口 1024px 宽起布局不破（工具栏可换行、网格自动降列）；720px 断点服务局域网手机访问（设置导航横排、物品栏缩格）。
- **网格**：实例卡 `repeat(auto-fill, minmax(330px, 1fr))` gap 16；核心卡 minmax(238px,1fr) gap 13；玩家/属性卡 minmax(320px,1fr)。

## 5. 动效令牌

| Token | 值 | 用途 |
|---|---|---|
| `--dur-1` | 90ms | 按压反馈、即时微反馈（**不用于 hover**，见下） |
| `--dur-2` | 160ms | hover 过渡、展开/收起、选中框、页内局部入场（sec-in） |
| `--dur-3` | 240ms | 入场（toast、modal、物品栏 pop、跨页 view-in）、进度条宽度 |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | 入场 / 展开 |
| `--ease-in-out` | `cubic-bezier(.4,0,.2,1)` | 离场 |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | 物品栏浮起、开关滑块等「有弹性的小件」 |

- **[v3.1 新约定] hover 过渡一律 ≥ `--dur-2`（160ms）**，落在交付清单的 150–300ms 区间；`--dur-1` 只用于 `:active` 按压与输入框 focus 光晕。
- 既有具名动画：`hb-pop`（物品栏入场，逐格延迟 .05/.12/.19/.26s）、`frame-in`（MC 选中框缩入）、`view-in`（跨页入场：淡入+8px 抬升，--dur-3）、`sec-in`（页内局部入场：淡入+6px 抬升，--dur-2，用于设置分区 body 与详情 tab-body）、`menu-in` / `modal-in` / `mask-in` / `toast-in/out`、`blink`（`steps(2,end)` 呼吸，仅过渡态）。
- **[v3.2 新约定] 入场动画两级制**：页级 `view-in` 只在真正跨页时重播（`navigate()` 以 animKey 判定；设置分区、详情 tab 属页内切换不触发）；页内切换用 `sec-in` 只动被替换的内容块。设置页壳（标题+左导航）常驻 DOM，切分区只换 `#set-body`。
- **reduced-motion**：全局 media query 一刀切关停所有 animation/transition（已实现，任何新动效自动被覆盖，不得用内联 style 绕过）。
- 所有新过渡**必须引用 `--dur-*` / `--ease-*`**，禁止裸写毫秒数与贝塞尔值。

## 6. 组件目录

| 组件 | 关键规格 | 使用规则 |
|---|---|---|
| `.btn` | surface-2 底 + 强边 + shadow-sm；`primary`=accent-solid 白字；`danger`=幽灵红；`sm` 小号 | 一屏最多一个 primary；danger 永远幽灵态 |
| `.card` 实例卡 | surface + 发丝边 + radius-lg；hover 浮起 2px + shadow-md | 底部 `.dur` 经验条示状态 |
| `.badge` | 11px，sunken 底；`.core` 变体 accent-text 加粗 | 元数据标签，不做按钮 |
| `.dot` | 9px 圆角方点；running=accent+光晕，starting/stopping=gold+blink，stopped=muted 半透明 | 状态点永远伴随文字或 tooltip |
| `.row-item` 行式控件 | HMCL 三件套：普通行（标题+副题+右侧控件）/ 可展开行（收起显摘要 `.ri-summary` mono）/ 行内嵌编辑器（`.ri-editor`）；行高 ≥56px | 设置页与常用设置的唯一形态——**每一行长得一样**是消灭罗列感的关键 |
| `.switch` | 38×21 胶囊；checked=accent-solid 系；输入框视觉隐藏但可聚焦（a11y） | |
| 表单 `label.field` | 标签 12px/600 muted 在上，控件在下；focus = accent 边 + 22% 光晕 | |
| `.tabs` | 幽灵 tab，`cur`=surface+强边+shadow-sm | 详情页内导航 |
| `.step-pill` | 向导步骤丸，`cur`=accent-solid 白字，`done`=accent-text，间以 ▸ | |
| `.cp-chip` | 分组锚点 chips，sunken 底 20px 圆角 | |
| `.ver-list` / `.ver-item` | 单列可滚版本表，sel=accent-solid 白字 | |
| `.dropmenu` | fixed 定位上下文菜单，menu-in 入场 | 「打开目录」直达菜单等 |
| `.modal` / `.toast` | modal 460px（onboard 520px，max-height 88vh 可滚）+ mask 模糊；toast 右上、左侧 3px 强调线、错误=红线 | Esc 关、点遮罩关、焦点归还；onboard 含协议勾选（`.ob-terms` 可滚长文 + `.ob-agree`），未勾选主键 disabled |
| `.empty` 空态 | 虚线框 + 居中 + 主行动按钮 | 空态是行动邀请，不是死路（零状态即主行动）；**[v3.2]** 空态即整页主体时隐藏页头与工具栏（如实例页无实例时隐藏标题/搜索/排序），空态卡用 `.page-fill` 居中 |
| `.err-box` | err-bg 容器 + 红石描边 | 错误必须说明发生了什么 + 下一步 |
| `.console` / `.task-log` / `.motd-preview` | `--term-bg` **双主题恒深**（终端惯例）；浅色下边框加深为 `rgba(22,34,25,.28)` | WARN 金 / ERROR 红 / 命令回显绿 |
| 内存控件 | 滑条 + 精确输入 + 实时物理内存状态条（已用/分配/超配红警） | 向导、导入、JVM 三处共用 |
| `.settings-nav` | 190px 左二级导航，sticky；`cur`=surface+强边 | HMCL 同构 |
| `.win-ctrls` | 46px 宽窗口键，SVG 11×11 viewBox 12；close hover=`#e5484d` 白字 | 仅原生宿主显示 |
| `.progress-bar` | 10px 高，斑马纹绿（6px 交替）= 经验条 | 任务进度专用 |
| `.cube` | 22×25 三面体素，`--c` 材料色，顶面 78% 混白/右面 62% 混黑 | 核心图标专用，不另设 logo |

## 7. 图标规范

**[v3.1 新约定]**（既有事实：win-ctrls 已是此风格；本轮把全部 emoji 图标迁移过来）

- **一律内联 SVG**，风格对齐 `.win-ctrls`：几何、细线、无装饰。
- 规格：`viewBox="0 0 16 16"`，展示尺寸 14–16px（hotbar 23px）；`fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"`；极简实心形状可用 `fill="currentColor"`。
- **实现**：`app.js` 顶部 `ICON` 路径映射 + `icon(name, cls)` 辅助（返回 SVG 字符串供模板拼接）；`.ico { width:1em }` 使图标随字号缩放、`currentColor` 随文字色继承。静态外壳图标（物品栏 4 格、主题键、登录锁）直接内联于 `index.html` / `initTheme`。按钮内 `icon(x)+文字`；纯图标按钮补 `aria-label`；异步态重绘用 `el.innerHTML = icon(x)+" 文字"`（勿用 textContent，会抹掉 SVG）。
- 颜色永远 `currentColor`，跟随文字色继承，双主题自动成立。
- 高 DPI：优先整数/半像素坐标，避免任意小数导致模糊。
- **emoji 禁令**：界面图标不得使用 emoji（🗺⚒🧭⚙☀️📁▶🔍…全部替换）；例外：用户内容（MOTD、控制台输出）与文案中的语气符号不受限。
- 图标永远伴随文字标签或 `title`/`aria-label`，不做纯图标导航。

## 8. 异步视图三态（每个 async 视图必备）

**[v3.1 新约定]** 加载 / 空 / 错误三态缺一不可：

- **加载**：列表类用骨架占位（sunken 底微光扫过，reduced-motion 下静止）；小区块可用「加载中…」文本，但首屏列表不允许裸文本。
- **空**：`.empty` 形态——说明这是什么 + 一个主行动（参照现有「一键开服」空态）。
- **错误**：`.err-box`——说清发生了什么 + 给出下一步（重试按钮 / 切换下载源指引），不道歉、不含糊。
- 轮询刷新必须做**签名比对跳过重绘**（现 `renderInstances` 的 `lastSig` 模式），避免焦点丢失与闪烁。

## 9. 硬约束（工程红线）

1. 无框架、无构建步骤、无 Tailwind；vanilla HTML/CSS/JS + go:embed。
2. **零外部网络请求**：图标 = 内联 SVG，字体 = 系统字体（Modrinth 资源图标等 API 数据图片除外——那是内容不是 UI）。
3. `app.js` 的 API 调用、hash 路由、状态逻辑不动；重构只触碰渲染层（HTML 模板/CSS/图标）。
4. 无边框拖动（HUD mousedown）与窗口三键必须始终可用；`has-host-chrome` 分支不可破坏。
5. 双主题（+跟随系统三态）都必须过 WCAG AA；terminal 容器双主题恒深。
6. 快捷键保留：1–4 物品栏导航、T 或 / 聚焦控制台、控制台 ↑↓ 历史、Tab 补全、Esc 关弹层。
7. 壁纸机制（`bg/` 目录 + `--bg-veil` 蒙版）不可破坏：卡片必须实底，文字永远落在实色面上。

## 10. 交付检查清单（每屏改完必过）

- [ ] 双主题下所有正文/次要文字对比度 ≥4.5:1（新配色先按 §2.5 公式实测）
- [ ] Tab 可达 + `:focus-visible` 可见（2px accent 外框）
- [ ] `prefers-reduced-motion` 生效（不写内联动画绕过全局关停）
- [ ] 所有可点元素 `cursor: pointer`
- [ ] hover 过渡 150–300ms（用 `--dur-2`/`--dur-3`）
- [ ] 1024px 窗口宽起布局不破、无横向滚动
- [ ] 高 DPI 下图标清晰（SVG 整数坐标）
- [ ] 加载 / 空 / 错误三态齐备
- [ ] 无 emoji 图标残留
- [ ] 无边框拖动、窗口三键、快捷键回归测试
