# Music Orb & Gesture Experience

## 目标

把前台与后台播放器从“功能已接通的浮动面板”升级为不抢博客主体、状态清晰、双端一致且可顺滑操控的产品级播放系统。

核心层级固定为：

`Hidden → Compact feedback → Ambient orb → Compact player → Immersive player`

“音乐大厅”是独立导航目标，不与“打开播放器”混用。

## 已确认问题

1. 前台从本地恢复进度时直接建立可见播放会话，导致首页没有主动播放也常驻播放器。
2. PC 使用横跨页面的底部 dock，移动端使用整条 MiniPlayer；二者都长期争夺博客正文的视觉重心并产生页面尾部占位。
3. 移动端没有方向锁定的横滑切歌、下滑收起；展开播放器与小窗之间也没有连续层级。
4. 浮层、滚动层和圆角边界混在同一节点，窄屏下容易出现内容贴边或圆角被裁平。
5. 前后台播放时间线都混在主 Context 中，`timeupdate` 会让不相关页面、列表和管理表单持续重渲染。
6. 后台展开态下滑直接结束播放；队列快照与歌曲编辑、删除、歌单重排不同步；顶部播放动作不感知当前 Tab。

## 竞品依据与取舍

- Apple Music：采用 MiniPlayer / Now Playing 分层；标题区域左右滑切歌；队列拖动排序和左滑移除；完整歌词支持点按跳转。
- Apple HIG：Sheet 使用明确 grabber 和向下收起；核心手势必须有可见按钮替代；Reduced Motion 下移除非必要位移、缩放和持续动画。
- 网易云音乐、QQ 音乐：封面、歌词、氛围和自定义能力集中在用户主动进入的完整播放页，不把沉浸层常驻于浏览页面。
- AetherBlog 是博客而不是音乐 App：借鉴层级、直接操控和反馈质量，不照搬音乐 App 的视觉占有率。

### 查证来源

- Apple《在 iPhone 上使用“音乐”中的迷你播放器和“正在播放”》：<https://support.apple.com/zh-cn/guide/iphone/iph676daac9b/ios>
- Apple《在 Mac 上使用“音乐”迷你播放器》：<https://support.apple.com/zh-cn/guide/music/mus71d7dcfce/mac>
- Apple《在 iPhone 上查看播放队列》：<https://support.apple.com/zh-cn/guide/iphone/ipha4521ef7d/ios>
- Apple《在 iPhone 上显示歌词和演唱》：<https://support.apple.com/zh-cn/guide/iphone/iphb9bf483aa/ios>
- Apple Human Interface Guidelines — Sheets / Accessibility / Modality：<https://developer.apple.com/design/human-interface-guidelines/sheets>、<https://developer.apple.com/design/human-interface-guidelines/accessibility>、<https://developer.apple.com/design/human-interface-guidelines/modality>
- 网易云音乐与 QQ 音乐官方 App Store 产品页（只用于确认当前产品范围与沉浸播放定位，不据此臆测未公开的精确手势）：<https://apps.apple.com/cn/app/id590338362>、<https://apps.apple.com/cn/app/id414603431>
- W3C WCAG 2.2 与 Reduced Motion 技术说明：<https://www.w3.org/TR/WCAG22/>、<https://www.w3.org/WAI/WCAG21/Techniques/css/C39>

## 前台实现

### 状态与可见性

- 仅恢复历史歌曲或进度：保持 Hidden，不显示任何浮层，不自动播放。
- 用户明确播放：先显示 Compact player 作为反馈；无交互后自动收成左侧 Ambient orb。
- 点击 orb：只打开 Compact player。
- 点击封面/“展开播放器”：进入当前页面内 Immersive player。
- 仅点击独立“进入音乐大厅”按钮才导航 `/music`。
- “收起”保留播放并回到 orb；“关闭”停止播放、清空会话并回到 Hidden。
- 删除旧的全宽 desktop dock、移动底条和页面尾部 spacer，避免 layout shift。

### 手势

- 10px 后锁定主轴，轴向优势至少 1.15。
- 横向位移 ≥68px 或速度 ≥550px/s：左滑下一首、右滑上一首。
- 向下位移 ≥92px 或速度 ≥650px/s：小窗收为 orb；沉浸层收回小窗。
- 未达阈值 180–240ms 回弹；每次手势最多切换一首。
- 手势只绑定封面、标题或 grabber，不抢进度条、歌词和队列的纵向滚动。
- 所有手势都有 44×44px 以上按钮和键盘替代。

### 几何与视觉

- orb：移动端 52px、桌面 48px，左侧安全边距 12–24px；外圈显示进度，播放时仅内部色彩缓慢流动，暂停/Reduced Motion 静止。
- compact：桌面 360–380px；移动端 `calc(100vw - 32px)`，≤360px 改为 12px 边距；外层统一持有圆角、边框、阴影与 `overflow:hidden`。
- 使用系统 `--radius-*` 与音乐语义 token；封面始终 1:1；控制组严格对称。
- 沉浸层移动端使用安全区、圆角 Sheet 和独立内部滚动；不让背景模糊节点自身承担大滚动。

### 性能

- 将稳定控制 Context 与高频 Timeline Context 分离。
- 只有进度条、时间和当前歌词订阅 Timeline；音乐大厅、皮肤控件、主题浮标和页面主体不随 `timeupdate` 更新。
- 进度使用 `transform: scaleX()`，暂停/页面隐藏时停止 orb 动画。

## 后台实现

- 同样拆分稳定控制与 Timeline Context，避免 2575 行管理页随播放时钟重渲染。
- 建立 compact/expanded 手势状态机：展开态下滑只收起；横滑切歌；关闭必须显式执行。
- 修正音乐页圆角变量作用域，页面通用卡片直接消费系统 radius；浮层外壳与滚动容器分层。
- 播放队列携带真实来源；编辑、删除、移除和重排后同步当前队列与索引。
- 顶部播放动作按 Tab 决定：曲库播放当前页、歌单播放选中歌单、展示页不重复提供错误动作。
- 移动端歌曲编辑入口升级为 Bottom Sheet；补充封面预览/选择、歌词校验与歌单脏状态保护，在风险可控的范围内逐项落地。

## 风险

- Safari 的媒体激活要求首次 `audio.play()` 保持在用户点击任务内；状态重构不能把首次播放延迟到 effect。
- 手势不能包围进度条、歌词滚动区或队列滚动区，否则会与原生滚动冲突。
- Context 拆分必须保持消费者 API 清晰，并防止恢复进度、Media Session 与显式关闭行为回归。
- 已有源代码字符串门禁需要改为验证新产品层级，不能保留与 orb 目标相反的旧断言。

## 验收标准

1. 新开首页以及仅有历史记录时完全没有播放器和页面占位。
2. 主动播放后 compact 出现，自动收成左侧 orb；点击 orb 不跳路由。
3. 独立按钮可进入音乐大厅，独立按钮可进入沉浸播放器。
4. 小窗左右滑切歌、下滑收起；短滑回弹；歌词/进度滚动不误触。
5. 320、360、375、390、768、1280、1440 宽度均无横向溢出、圆角裁切或非对称控制。
6. 所有常用控件触控区域 ≥44px；键盘、屏幕阅读器和 Reduced Motion 可用。
7. 播放进度更新不再触发前台非时间线消费者和后台管理主体重渲染。
8. 后台展开态下滑不停止播放；队列能随编辑、删除和重排同步。
9. Blog/Admin typecheck、目标 Vitest、lint/build 的受影响面验证通过。
10. 只提交一个 PR，并按既定评审窗口持续监听；浏览器真实尺寸截图、惯性手势和真机安全区复核需在获得自动化浏览器或设备授权后执行，并与代码级门禁分开记录。

## 实施与验证记录

- 前台已完成 Hidden / Compact / Ambient orb / Immersive 四级表面、显式会话可见性、独立音乐大厅入口、自动收起、双向切歌、下滑收起、歌词定位、队列与 Reduced Motion 适配。
- 后台已完成 compact / expanded 层级、移动 Bottom Sheet、脏状态拦截、封面与歌词维护、真实来源队列同步、编辑/删除/重排协调及异步播放竞态保护。
- 高频时间线订阅已下沉到进度/歌词叶子；队列与歌词行使用稳定 memo 边界；个人卡片轮播只挂载当前卡与唯一相邻卡。
- 无障碍补齐了对话框焦点闭环、背景 inert、44px 触控目标、live region，以及共享 Select 的稳定 ID、listbox ownership 与 active descendant。
- 自动化验证：Reader 6/6 文件、121/121 测试；Admin 7/7 文件、87/87 测试；Select 3/3 测试；Blog/Admin/UI type-check、目标 ESLint、Blog/Admin production build 与 `git diff --check` 全部通过。
- 生产运行时冒烟：Blog `/`、`/music`、`/about`、`/posts` 均返回 200，且首页 SSR 不含可见播放器/orb/旧占位标记；Admin `/admin/`、`/admin/music`、`/admin/dashboard` 均返回 200。
- 尚未执行 Playwright 像素截图、浏览器真实拖拽与真机触控复核，因为本轮没有获得显式浏览器自动化授权；不得把源码门禁或 HTTP 冒烟表述为该项已经完成。
