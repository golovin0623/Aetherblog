# 音乐产品链路审计与精修计划

> 2026-07-12 视觉复核纠正：本文件上一版完成了播放状态、草稿安全、错误恢复和跨端可用性，但“Apple Music 级视觉完成”的结论不成立。移动音乐大厅仍是营销 hero + 重复 transport，移动 Now Playing 仍把巨大空容器给了小型占位图标。视觉结构由 `music-visual-rework-apple-hierarchy.md` 重新审计并接管。

日期：2026-07-12

## 目标

把「媒体库纳入 → 歌曲维护 → 歌单编排 → 公开音乐大厅 → 个人卡片 → 浮动/沉浸播放器」收敛成一个可信、连续、精致的产品系统。优先保证数据不丢、播放不中断、状态可理解，再提升桌面与移动端的层级、触控、动效和视觉密度。

## 本轮证据基线

- 桌面音乐大厅：`assets/music-product-polish-2026-07-12/01-public-music-empty-desktop.png`
- 后台登录阻断：`assets/music-product-polish-2026-07-12/02-admin-entry-desktop.png`
- 手机音乐大厅：`assets/music-product-polish-2026-07-12/03-public-music-mobile.png`
- 手机展开播放器：`assets/music-product-polish-2026-07-12/04-mobile-immersive-player.png`
- 手机皮肤面板：`assets/music-product-polish-2026-07-12/05-mobile-skin-panel.png`
- 桌面沉浸播放器：`assets/music-product-polish-2026-07-12/06-desktop-immersive-player.png`
- 首页个人卡片：`assets/music-product-polish-2026-07-12/07-profile-music-card-desktop.png`

## 最终视觉证据

- 390×844 音乐大厅首屏（主播放键在首屏内）：`assets/music-product-polish-2026-07-12/17-mobile-music-hall-controls-painted-final.png`
- 390×844 手机 Now Playing：`assets/music-product-polish-2026-07-12/20-mobile-now-playing-final.png`
- 手机可恢复播放错误：`assets/music-product-polish-2026-07-12/21-mobile-now-playing-error-final.png`
- 1280×720 桌面沉浸播放器错误态：`assets/music-product-polish-2026-07-12/22-desktop-now-playing-error-final.png`
- 768px 临界断点移动播放器：`assets/music-product-polish-2026-07-12/23-tablet-768-now-playing-final.png`
- 820px 窄桌面播放器可滚达队列：`assets/music-product-polish-2026-07-12/24-tablet-820-player-scroll-final.png`
- 折叠桌面播放器错误重试态：`assets/music-product-polish-2026-07-12/25-desktop-dock-error-final.png`
- 1024×600 短桌面播放器完整控制区：`assets/music-product-polish-2026-07-12/26-desktop-1024x600-final.jpg`
- 手机皮肤模态：`assets/music-product-polish-2026-07-12/10-mobile-skin-panel-final.png`
- 720px 高桌面皮肤浮层：`assets/music-product-polish-2026-07-12/13-desktop-skin-popover-short-viewport-final.png`
- 首页右栏音乐卡与显式资料切换：`assets/music-product-polish-2026-07-12/19-profile-music-card-active-final.png`

后台音乐页需要已登录会话；本轮不能把登录页之外的后台截图当作视觉证据，因此后台结论先以当前源代码、请求契约和测试为证，最终仍需登录态浏览器复验。

## 设计判断

音乐能力的主题不是再做一套独立的“霓虹播放器”，而是把 AetherBlog 已有的玻璃层、衬线标题、极光色和圆润控制收束成一套克制的音乐操作语言：封面/唱片是唯一主视觉；播放状态是唯一强色；管理操作保持中性；任何浮层都必须有清晰的退出、焦点和背景锁定。

## 问题清单

### P0：数据与播放可信度

- [x] 歌曲编辑保存漏传时长，普通元数据编辑可能清空 `durationSeconds`。
- [x] 歌单编辑草稿漏带封面，普通编辑可能清空 `coverMediaFileId`。
- [x] 切换歌单时旧草稿仍可保存到新歌单。
- [x] 歌单或歌曲保存请求返回前继续编辑/切换时，迟到响应可能覆盖新草稿；现以实体 ID + 草稿 revision 双重防护。
- [x] 歌曲草稿在切换歌曲、关闭编辑器或切换管理页签时会静默丢失；现统一进入“放弃未保存修改”确认。
- [x] 全局设置用旧快照整对象即时 PUT，快速操作会互相覆盖；数值输入每次按键都发请求。
- [x] 展示轮播直接修改实际播放下标，会切断暂停/播放会话并重置进度。
- [x] 单曲队列的上一首/下一首不一定真正重播。
- [x] 公共播放器请求和音频加载失败被静默吞掉，用户只看到按钮没有反应，或把服务故障误报成“未开放”。

### P1：跨端操作与可访问性

- [x] 移动播放器 `aria-modal` 打开后未锁背景滚动；实测背景从 `scrollY=331` 滚到 `751`。
- [x] 移动播放器没有完整的 Esc、初始焦点、焦点圈闭和关闭后焦点归还。
- [x] 皮肤面板没有显式关闭按钮，Esc 无效，焦点停留在背景触发器，背景仍可滚动。
- [x] 桌面沉浸播放器在 1280×720 下 `scrollHeight=870`，主播放键位于 `top=701/bottom=765`，首屏不可见。
- [x] 后台试听舞台把曲库分页当作当前播放队列，计数与上一首/下一首禁用态可能错误。
- [x] 后台当前曲目行显示暂停图标，点击却会从头重播。
- [x] SeekBar 只支持点击和键盘，不支持真正的按住拖动；触控调整缺乏连续反馈。
- [x] 轮播、随机、顺序、循环混在同一播放模式轴，前后台文案和真实行为不一致。
- [x] 640–768px 仍属于移动模态，但皮肤控件被 `sm:` 提前缩小到 32–40px；现统一在 769px 后才切桌面密度。
- [x] 移动浮球的播放失败徽标只有视觉提示，后台播放失败不会主动通知读屏。

### P2：产品层级与精致度

- [x] 手机音乐大厅首屏被大面积 hero 占满，当前歌曲与核心播放控制落到首屏以下。
- [x] “沉浸”在手机上实际只是 66vh bottom sheet，名称与体验承诺不一致。
- [x] 桌面沉浸态空歌词仍占据大面板，主播放器反而被挤出首屏。
- [x] 皮肤自定义缺少明确的当前值、重置和应用反馈；保留系统色彩选择器以维持原生可访问性，外层状态与浮层行为已产品化。
- [x] 浮动播放器/站点浮动控制会压住播放器与皮肤面板，层级不干净。
- [x] 首页个人卡片的资料/音乐切换主要依赖滑动和装饰点，发现性与键盘提示不足。
- [x] “首页展示”配置已无实际消费者，属于误导性管理能力。

## 实施批次

### A. 安全契约

1. 先写回归测试覆盖时长/封面保留、歌单切换草稿、设置更新序列、播放下标与展示轮播分离。
2. 修复所有字段保留与竞态，危险操作 pending 时禁用并提供保存状态。
3. 统一真实播放队列来源和当前行的播放/暂停行为。

### B. 播放核心

1. 将展示轮播与实际播放下标解耦；播放会话存在时不允许展示计时器换音频。
2. 明确 `queueOrder`、`repeatMode`、`presentationRotation` 的独立语义；在不破坏后端兼容的前提下先统一前端解释和文案。
3. 增加音频 `loading/ready/error` 状态、可恢复提示和重试入口。
4. 补全单曲队列、结束、随机、循环和手动切歌边界。

### C. 模态与响应式

1. 建立共享的模态生命周期：锁背景、Esc、初始焦点、焦点圈闭、关闭后归还。
2. 手机展开播放器升级为真正的 Now Playing 体验；若保留 sheet，则改名为“展开播放器”且保证背景不可动。
3. 桌面播放器按可用高度缩放封面和间距，1280×720 首屏必须看见进度、主播放键和关闭键。
4. 浮层打开时隐藏或降层所有无关浮动控制。

### D. 视觉与交互精修

1. 手机首屏优先呈现当前歌曲和播放动作，压缩说明性 hero。
2. 统一 44px 触控区、图标尺寸、焦点环、按下态、禁用态和 loading 反馈。
3. 为进度条加入 pointer scrub、拖动预览与移动端触控行为。
4. 重排空歌词与单曲队列，让空内容不抢占主操作空间。
5. 后台管理改为清晰的媒体库/歌曲/歌单层级，保存状态、批量操作和试听状态保持一致。

## 验收标准

- 编辑歌曲与歌单不会清空未修改字段；连续切换和保存不会串写。
- 任意轮播/暂停/切页操作都不会无故换歌或重置进度。
- 音频不可用时 1 秒内出现明确、可恢复的错误反馈。
- 所有模态背景不可滚动，Esc 可关闭，键盘焦点不逃逸，关闭后回到触发器。
- 390×844 与 1280×720 均能在首屏完成播放/暂停、上一首、下一首、查看进度和关闭播放器。
- 所有图标按钮有唯一可理解的 accessible name，触控目标至少 44×44px。
- 桌面、移动、键盘、触控、reduced-motion 均完成真实浏览器回归。
- blog/admin typecheck、lint、相关 Vitest、构建与 `git diff --check` 全部通过。

## 验证结果与证据边界

- 公共音乐回归门禁：4 个文件、44 个测试通过。
- 管理后台完整 Vitest：6 个文件、51 个测试通过。
- blog/admin TypeScript type-check 通过；本轮涉及的 blog/admin 文件定向 ESLint 零警告。
- blog 生产构建通过；admin 生产构建通过。构建仅保留仓库既有的 Browserslist、MarkdownRenderer 和非音乐图片/大 chunk 警告。
- 真实浏览器完成 390×844、768×900、820×900、1024×600、1280×720、键盘焦点、Esc、焦点归还、触控滚动锁、短视口浮层翻转和播放失败重试验收；768px 皮肤面板关闭、色块、取色与应用控件实测均不小于 44px。
- 当前仓库公开歌单所指向的本地媒体文件缺失，无法完成一首有效音频从头到尾的正向播放验收；本轮以真实 404 验证了错误与恢复路径。
- `/admin/music` 当前没有已登录会话，后台视觉结论只以源码、契约、测试、类型、Lint 和生产构建为证，未伪称完成认证页面 E2E。
- 后端设置接口仍是无版本号的全量 PUT；单页面内竞态已经消除，跨浏览器多管理员同时编辑仍需后端原子 PATCH、ETag 或版本号才能彻底治理。
