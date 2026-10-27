# AutoMCHUB 设计系统 MASTER · v4「常规桌面应用 + 多配色方案」

> **本文件是唯一事实来源（Single Source of Truth）。**
> 屏幕级偏离写在 `design-system/pages/<screen>.md`，且必须注明偏离理由；没有对应文件 = 该屏幕完全遵循本文件。
> 外部参考（uxpeak+ 课程、竞品、文章）只作灵感，**永不覆盖本文件**。
> 来源：`internal/web/ui/themes.css`（配色令牌）、`app.css`（布局与组件）、`app.js`（组件实现）。
> v4 起放弃 v3 的 Minecraft 游戏化外观（底部物品栏、体素方块、经验条、英文眉标、跳帧闪烁），改为常规桌面应用；
> 标注 **[v3.3]** 的交互约定沿用不变。

---

## 1. 设计身份

**一句话**：像一款正常的 Windows 管理工具——中性界面、一个强调色、状态一目了然；配色由用户自选。

- **布局参照**：Windows 11 设置 / WinUI NavigationView（标题栏 + 左侧导航 + 圆角内容层）。
- **配色原则**（依据 uxpeak+《Make Any UI Look Premium》《The Psychology Behind Great UI》）：
  1. **界面保持中性，颜色留给操作**：强调色只用于主行动按钮、选中 / 当前指示、焦点环、链接与进度；同屏只有一个实底主按钮。
  2. **状态用浅色底 + 同色系深字**（`.st-pill`、`.ri-restart` 等），**禁止在饱和色块上叠高饱和图标或文字**。
  3. **卡片平铺**：实底 + 发丝边，不加阴影；阴影只给真正浮起的层（下拉菜单、弹窗、提示、吸底栏）。
  4. **深色模式「越靠前越亮」**：页底最暗，卡片高一阶，浮层再高一阶；深色带一点色相（Nord / Catppuccin / Solarized 等方案自带）。
- **保留的游戏相关元素**只有「内容本身」：MOTD 的 § 色码调色板与预览、控制台输出。

## 2. 配色体系

### 2.1 三个开关（`<html>` 上的 data 属性）

| 属性 | 取值 | 说明 |
|---|---|---|
| `data-theme` | `light` / `dark` | 实际明暗；「跟随系统」由前端解析为二者之一（`data-theme-pref` 记录用户选择 `auto/light/dark`） |
| `data-scheme` | `fluent`（默认）/ `github` / `graphite` / `nord` / `catppuccin` / `solarized` | 配色方案：中性色 + 语义色 + 默认强调色 |
| `data-accent` | `auto`（跟随方案）/ `blue` / `indigo` / `violet` / `teal` / `green` / `orange` / `rose` / `graphite` | 强调色覆盖（Tailwind 调色板取值） |

- 偏好存 `localStorage`（`amh_theme` / `amh_scheme` / `amh_accent`），**每台设备各自记忆**；`index.html` 在样式表生效前写入属性，首帧无闪烁；非法值回退默认。
- `themes.css` 的选择器**不带 `:root`**：任何元素带上这三个属性就按该方案渲染——「设置 → 外观」的方案预览卡正是这样实现的。
- 强调色覆盖块写在方案块之后，同等特异性下后者生效。

### 2.2 方案一览

| 方案 | 来源 | 浅色 | 深色 | 默认强调色 |
|---|---|---|---|---|
| Fluent（默认） | Microsoft Fluent 2 / Windows 11 | Mica 浅灰 `#f3f3f3` + 白卡 | `#202020` + `#2e2e2e` 卡 | 浅 `#005fb8` / 深 `#60cdff`（配黑字，Win11 原生） |
| GitHub | Primer | 白底 + `#d1d9e0` 发丝边 | `#0d1117` | `#0969da` / `#1f6feb`（GitHub 原主按钮为绿，此处统一用蓝） |
| 石墨 | shadcn/ui Zinc（Vercel 风格） | 纯中性灰阶 | `#0b0b0d` | 墨黑 / 近白（反色按钮） |
| Nord | Arctic Ice Studio | Snow Storm | Polar Night | Frost `#88c0d0`（深色配深字） |
| Catppuccin | Latte / Mocha | Latte | Mocha | Mauve |
| Solarized | Ethan Schoonover | base3 | base03 | blue（按钮加深以过 AA） |

为满足对比度，少数取值在官方色板基础上做了加深 / 提亮（如 Solarized 深色正文用 base2、Nord 浅色状态字加深）。这些调整值直接写在 `themes.css` 对应的方案块里，由下方的对比度测试兜底。

### 2.3 令牌清单（每个方案 × 浅深都必须定义）

| 类别 | 令牌 | 用途 |
|---|---|---|
| 层级 | `--chrome` / `--bg` / `--surface` / `--surface-2` / `--overlay` / `--sunken` | 标题栏与侧栏 / 内容层 / 卡片 / 次级填充 / 浮层 / 凹陷井 |
| 交互 | `--hover` | 透明底元素（导航项、菜单项、行）的悬停叠色 |
| 线条 | `--border` / `--border-strong` | 发丝边 / 控件描边 |
| 文字 | `--text` / `--muted` / `--faint` | 正文 / 次要 / 装饰（不承载必须读的信息） |
| 强调 | `--accent` / `--accent-text` / `--accent-solid` / `--accent-solid-hov` / `--on-accent` / `--accent-subtle` | 图形级 / 文字级 / 主按钮底 / 主按钮悬停 / 主按钮上的字 / 选中浅底 |
| 语义 | `--success*` / `--warning*` / `--danger*`（各含 `-text`、`-subtle`），`--danger-solid(-hov)` / `--on-danger` | 状态字、状态浅底、危险实底按钮 |
| 终端 | `--term-bg` / `--term-fg` / `--term-cmd` / `--term-warn` / `--term-err` | 控制台、部署日志、MOTD 预览（双主题恒深） |

阴影 `--shadow-sm/md/lg` 与遮罩 `--scrim` 只按明暗区分，定义在 `app.css`。二维码的 `--qr-dark` / `--qr-light`（`#18181b` / `#fff`）不随方案与明暗变化，也定义在 `app.css`：深模块配白底，任何配色下都扫得出。**组件样式一律引用令牌，不写死色值**（窗口关闭键的系统红 `#c42b1c` 除外）。

### 2.4 对比度基线（WCAG AA）

| 检查对 | 下限 |
|---|---|
| `--text` 叠在 bg / surface / chrome / overlay / surface-2 上 | 4.5（目标 7） |
| `--muted`、`--accent-text` 叠在 bg / surface / chrome / overlay 上 | 4.5 |
| `--text` 叠在 chrome 上的 `--accent-subtle`、`--hover`（当前 / 悬停导航项） | 4.5 |
| `--muted` 叠在 surface 上的 `--accent-subtle`（选中行里的次要字，如版本类型与发布日期） | 4.5 |
| 三种状态字叠在 surface / bg 及各自浅底上 | 4.5 |
| `--on-accent` 叠在 accent-solid(-hov) 上；`--on-danger` 叠在 danger-solid(-hov) 上 | 4.5 |
| 终端四色叠在 `--term-bg` 上 | 4.5 |
| `--accent` 叠在 surface / bg 上（焦点环、进度、指示条） | 3 |

**自动校验**：`go test ./internal/themes/`（纯 Go，任何平台可跑）解析 `themes.css`，对 6 方案 × 2 模式 × 8 强调色共 1428 组逐一计算。**改任何配色都必须先跑通它。**

## 3. 字体排印

| 角色 | 字体栈 | 规格 |
|---|---|---|
| 正文 `--font` | `"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui` | 14px，行高 1.5 |
| 等宽 `--mono` | `"Cascadia Mono", Consolas, "SF Mono", Menlo` | 控制台、路径、键名、版本号、数据 |

字阶：页标题 `h1` 24px/600；分区标题 `h2` 16px/600；`h3` 15px/600；正文 14px；`.sub` 13px muted；`.hint`、徽标、次要信息 12px；按钮 13px/600（`sm` 12px）。中文不用斜体；禁止引入外部字体。

## 4. 布局与间距

- **骨架**：`#titlebar`（40px，无边框窗口的拖动区 + 窗口三键）→ `#shell` = `#sidebar`（232px）+ `#main`（内容层：`--bg`、左上 8px 圆角 + 发丝边）。标题栏空白处按下即拖动窗口、双击最大化（`has-host-chrome` 分支，**不可破坏**）。
- **侧栏**：服务器 / 新建服务器 / 内网穿透，底部设置；页脚为外观快捷切换（跟随系统 → 浅色 → 深色）与版本号。当前项 = `--accent-subtle` 底 + 左侧 3px 强调条 + 正文色文字。
- **页头**：`pageHead(title, sub, actions, crumbs)`——标题左上、说明在下、主操作在右；详情等子页面上方加面包屑。不再使用英文眉标。
- **内容宽度两档**：数据面 `--w-wide: 1240px`（卡片网格、控制台、属性、原始表）；阅读面 `--w-read: 760px`（表单、设置正文、向导）。
- **`#main` 的直接子元素不收缩**（`flex-shrink: 0`）：它是纵向 flex 滚动容器，否则带 overflow 的子元素（如标签栏）会被压成 0 高。
- **圆角**：`--radius-sm 4px`（徽标、小件）· `--radius-md 6px`（按钮、输入框、导航项）· `--radius-lg 8px`（卡片、菜单）· `--radius-xl 12px`（弹窗）。
- **间距**：4px 网格（4 / 8 / 12 / 16 / 20 / 24 / 28 / 32）；字段之间 16px，标签与控件 6px，分区之间 28px。
- **响应式**：≤960px 侧栏收成 60px 图标栏（标签进 `title`）；≤640px（局域网手机访问）变为底部标签栏，内容层去圆角。1024px 宽起各页无横向滚动。

## 5. 动效令牌

| Token | 值 | 用途 |
|---|---|---|
| `--dur-1` | 90ms | 按压反馈、输入框 focus 光晕 |
| `--dur-2` | 160ms | hover、展开 / 收起、选中态、页内局部入场（`sec-in`） |
| `--dur-3` | 240ms | 入场（toast、modal、跨页 `view-in`）、进度条宽度 |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | 入场 / 展开 |
| `--ease-in-out` | `cubic-bezier(.4,0,.2,1)` | 离场、呼吸 |

- hover 过渡 ≥ `--dur-2`；所有过渡引用令牌，不裸写毫秒数与贝塞尔值。
- 具名动画：`view-in`（淡入 + 6px 抬升）、`sec-in`、`menu-in`、`modal-in` / `mask-in`、`toast-in/out`、`pulse`（启动中 / 停止中状态点的平滑呼吸）、`spin`（部署中步骤）、`sk-shim`（骨架）。
- **[v3.2] 入场两级制**：页级 `view-in` 只在真正跨页时重播；设置分区、详情标签页只动被替换的内容块。
- `prefers-reduced-motion` 全局关停所有动画与过渡。

## 6. 组件目录

| 组件 | 规格 | 使用规则 |
|---|---|---|
| `.btn` | 32px 高，surface 底 + `--border-strong` 描边；`primary` = accent-solid + on-accent；`danger` = 红字描边；`sm` 28px；`icon-only` | 一屏最多一个 primary；危险入口在列表里是描边红字，确认弹窗里的最终键才是实底红 |
| `.card` 实例卡 | surface + 发丝边，无阴影；悬停只加深边框；纵向 flex，操作行贴底 | 整卡可点进详情；操作：启动 / 停止、管理、「···」（打开文件夹、删除） |
| `.avatar` | 36px（`lg` 44px）圆角方块，核心首字母；底色 = 核心色 16% 混入卡片底，字色 = 核心色 58% 混入正文色 | 取代体素方块；颜色只作辨识，不铺大色块 |
| `.badge` | 22px，正文色 7% 叠底 + muted 字；`.core` 用正文色加粗 | 元数据标签，不做按钮 |
| `.st-pill` | 胶囊：状态点 + 文字；运行中 = success 浅底，启动中 / 停止中 = warning 浅底，已停止 = 中性 | 状态永远「点 + 文字」；详情页头带运行时长与在线人数 |
| `.ver-tag` / `.rec-badge` / `.gr-tag` | accent-subtle 底 + accent-text | 「最新」「推荐」「新手推荐」「游戏规则」等提示性标签 |
| `.tabs` / `.tab` | 下划线式，当前项 2px 强调色下划线；标签是 `<a>` | 详情页内导航（切换走 hash，受未保存守卫保护） |
| `.steps` | 圆圈序号 + 连线；当前步实底，已完成打勾可点回，未到达描边 | 新建向导 |
| `.ver-item` | 行式列表，选中 = accent-subtle 底 + 左侧 3px 强调条，文字保持正文色；有 `releaseTime` 时版本号下加 `.ver-date` 日期副行（等宽 11px muted） | 版本 / 构建选择 |
| `.core-card` / `.radio-card` / `.scheme-card` | 选中 = 强调色描边 + 1px 外环 + 6% 强调色叠底 | 单选卡片 |
| `.row-item` | Windows 11 设置式卡片行：标题 + 说明 + 右侧控件，≥60px | 设置页与常用设置 |
| `.qr-card` | 左码右文：`.qr-box` 168px，恒用 `--qr-light` 底，SVG 自带 4 模块静区（`qrcode.js` 纯前端生成）；多个本机地址时 `.qr-ip` 按钮切换，当前项 = accent-subtle 底 + 强调色边框 | 「设置 → 远程访问」；二维码不随主题反色 |
| `.switch` | 40×20 胶囊，关闭 = muted 描边，开启 = accent-solid 底 + on-accent 圆点 | 开关即时生效（见 §11） |
| `.seg` | 分段控件，选中段 = overlay 底 + 描边 + 小阴影 | 主题模式等 2–4 选 1 |
| `.dropmenu` | overlay 底 + `--shadow-md`；分组标题 / 分隔线 / 危险项 / 禁用项 + 原因 | `dropMenu(anchor, items)` 生成；点外部 / Esc 关闭 |
| `.modal` / `.toast` | modal：overlay 底、12px 圆角、`--shadow-lg`；toast：标题栏下方右侧，带成功 / 错误图标，可点击关闭 | 危险确认框：标题点名对象、按钮写出后果、默认聚焦取消 |
| `.empty` | 居中：强调色浅底图标 + 标题 + 一句说明 + 一个主行动 | 次要入口用 `.quiet-link` |
| `.err-box` / `.warn-card` | danger / warning 浅底 + 同色描边 | 错误要说清发生了什么 + 下一步 |
| `.save-bar.sticky` / `.wizard-foot` | overlay 底吸底条，有未保存修改时强调色描边 | 见 §11 |
| `.console` / `.task-log` / `.motd-preview` | 终端令牌，双主题恒深 | WARN = `--term-warn`，ERROR = `--term-err`，命令回显 = `--term-cmd` |
| `.progress-bar` | 6px，强调色填充 | 部署进度 |

## 7. 图标规范

- **一律内联 SVG**：`viewBox="0 0 16 16"`，`stroke="currentColor"`、`stroke-width="1.3"`、圆角端点；极简实心形状可用 `fill="currentColor"`。实现见 `app.js` 的 `ICON` 映射与 `icon(name, cls)`；侧栏与标题栏图标直接内联在 `index.html`。
- 颜色继承文字色；导航当前项、空态图标等用 `--accent`。
- 形状要能区分：例如「设置」用带齿的齿轮，不能和「浅色」的太阳图标混淆。
- 不用 emoji 作界面图标或标题装饰（用户内容如 MOTD、控制台输出除外）。
- 纯图标按钮必须有 `aria-label` 或 `title`；图标栏模式下侧栏标签进 `title`。
- Logo：强调色圆角方块上两台服务器的简笔（`.logo-mark`），随强调色变化；浏览器标签页图标为固定的 Fluent 蓝版本。

## 8. 异步视图三态

- **加载 / 空 / 错误三态缺一不可**：列表首屏用骨架；空态给一个主行动；错误用 `.err-box` 并给出下一步。
- 轮询刷新做**签名比对**，数据无变化不重绘（`renderInstances` 的 `lastSig`），避免闪烁与丢焦点。
- **[v3.3] 视图代号**：每次切页 `viewGen++`；异步渲染在每个 `await` 之后用 `stale(gen)` 判断，过期即放弃；轮询一律经 `startPoll(fn, ms, gen)` 挂载。

## 9. 硬约束（工程红线）

1. 无框架、无构建步骤；vanilla HTML / CSS / JS，经 `go:embed` 打包进单文件 exe。后端语言保持 Go。
2. 零外部网络请求：图标内联，字体用系统字体（Modrinth 资源图标等内容图片除外）。
3. 无边框拖动（标题栏 mousedown）与窗口三键必须始终可用。
4. 所有配色组合必须通过 `go test ./internal/themes/`；终端容器双主题恒深。
5. 快捷键：1–4 切换侧栏导航；T 或 / 聚焦控制台；控制台 ↑↓ 翻历史、Tab 补全；Esc 关闭弹层。弹层打开时 1–4 不响应。
6. 壁纸机制（程序旁 `bg/` 目录）不可破坏：标题栏、侧栏与内容层改为半透明蒙版，卡片保持实底。

## 10. 交付检查清单（每屏改完必过）

- [ ] 6 套方案 × 浅 / 深各截图过目，无踩色、无边框消失；`go test ./internal/themes/` 通过
- [ ] 新增颜色全部走令牌，没有写死色值
- [ ] Tab 可达，`:focus-visible` 可见；纯图标按钮有可读名称
- [ ] `prefers-reduced-motion` 生效；hover 过渡 150–300ms
- [ ] 1024 / 900 / 390 宽度无横向滚动
- [ ] 加载 / 空 / 错误三态齐备
- [ ] 无边框拖动、窗口三键、快捷键回归通过
- [ ] **[v3.3]** 多字段表单有吸底保存条并登记切页守卫；单字段保存键「未改置灰 + 回车保存」
- [ ] **[v3.3]** 表单错误就近显示在字段下方，没有用 toast
- [ ] **[v3.3]** 异步渲染的 await 之后有 `stale(gen)` 判断，轮询经 `startPoll` 挂载

## 11. 交互约定（v3.3「交互正常化」，沿用）

依据 uxpeak+《High-Converting Forms & Flows》《Junior vs Senior UI Decisions》《The Onboarding Playbook》相关章节整理。

1. **保存语义二分，不混用**：
   - 开关、单选卡、外观选项 → **即时生效**；
   - 带「保存」按钮的单字段（CurseForge Key、Webhook、更新仓库、备份保留份数）→ `bindSaveInput`：值没变时按钮置灰，回车即保存；
   - 多字段表单页（常用设置、全部配置、内存 / 启动、定时任务）→ 吸底保存条 `saveBar()` + `wireSaveBar()`：干净时显示「所有修改已保存」，有改动时高亮并给出「N 项修改未保存 · 放弃修改 · 保存」。
   - 例外：常用设置里的「游戏规则」开关在运行中即时下发 `/gamerule`，以「游戏规则」标签区分，不计入未保存。
2. **未保存守卫**：未保存来源经 `addDirtySource` 并入 `dirtyCheck`；切页 / 切标签 / 刷新前确认「放弃未保存的修改？」（继续编辑 / 放弃 N 项修改）。选「继续编辑」时地址退回原页、改动保留。
3. **行内校验**：错误显示在字段下方（`.field-err` + `.invalid`），离开字段时检查，出错后随输入即时复核；提交时全部检查，滚动并聚焦第一个错误。表单校验不用 toast。
4. **危险操作多一步**：删除等收进「···」菜单；运行中不可删时置灰并写明原因。
5. **整卡可点**：实例卡单击空白处进入详情；名称是链接，键盘可达。
6. **导航可回起点**：点指向当前地址的站内链接（侧栏当前项、面包屑）或按对应数字键，重绘该页起点。
7. **向导**：底栏吸底并回显已选内容；已完成步骤可点回；单击选中、双击选中并进入下一步；版本默认预选最新正式版。
8. **空态只给一个主行动**：次要入口用安静的文字链接。
