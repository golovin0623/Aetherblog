# 音乐大厅与 Now Playing 视觉结构重做

日期：2026-07-12

## 纠正结论

上一轮把“播放与管理交互可靠性已经修复”错误地等同于“已经达到 Apple Music 级视觉体验”。用户提供的两张真实手机截图证明该结论不成立：页面把视觉预算交给了 CSS 黑胶、小图标、空容器、重复大按钮和卡片嵌套，而不是封面、歌曲信息、列表和标准播放控制。

## 当前审计证据

- 当前 390×844 音乐大厅：`assets/music-visual-rework-2026-07-12/01-before-hall-mobile.jpg`
- 当前 390×844 Now Playing：`assets/music-visual-rework-2026-07-12/02-before-now-playing-mobile.jpg`
- Apple 官方 iOS 26 Now Playing：`assets/music-visual-rework-2026-07-12/03-reference-apple-now-playing-ios26.jpg`
- Apple Music 官方歌单/Web 内容层级：`assets/music-visual-rework-2026-07-12/04-reference-apple-playlist-web-mobile.jpg`

官方来源：

- https://support.apple.com/en-gb/guide/iphone/iph676daac9b/ios
- https://help.apple.com/assets/69F8EBBDF3B89A4F6E0C704C/69F8EBC43862495245036393/en_US/ecc6b5e1fcd60042aecc5d2127c9203e.png
- https://support.apple.com/en-gb/guide/iphone/iph0138fb328/ios
- https://music.apple.com/cn/playlist/%E4%BB%8A%E6%97%A5%E7%83%AD%E9%97%A8/pl.f4d106fed2bd41149aaacabb233eb5eb
- https://developer.apple.com/design/human-interface-guidelines/buttons
- https://developer.apple.com/design/human-interface-guidelines/layout
- https://developer.apple.com/design/human-interface-guidelines/materials

## 结构性问题

1. 音乐大厅的真实封面被塞进 112px CSS 黑胶的圆心，移动端有效封面直径约 47px；156px 装饰区域几乎没有内容价值。
2. `播放全部` 强制 `expand: true`，把“开始播放”和“打开 Now Playing”错误合并。
3. 页面同时显示 hero CTA、内嵌完整播放器、移动 orb 和主题浮钮，形成多个同权播放入口。
4. 歌曲列表排在 hero、完整播放器和歌词卡之后，核心内容无法在首屏进入。
5. Now Playing 的 `flex-1 + min-h + justify-center` 主舞台制造巨大空白；无封面时只有 56px 图标承担主视觉。
6. 移动主控制把 shuffle 与 prev/play/next 做成四个同权圆按钮；底部又放两个离开播放器的导航胶囊。
7. blog 的本地 `MusicPlaylist` 类型和归一化遗漏 `coverUrl/coverMediaFileId`，歌单身份封面无法稳定进入前台。

## 目标结构

### 音乐大厅

- 歌单身份：歌单封面优先，首曲封面兜底；无真实封面时只显示紧凑诚实的占位，不放大图标。
- 标题：`playlistName` 是真正的页面主标题；简介、曲数和总时长紧随其后。
- 动作：只保留“播放”和“随机播放”两个高频动作；播放不强制展开。
- 内容：歌单头之后立即进入平整歌曲列表，不再嵌完整播放器和歌词卡。
- 播放会话：播放后出现持久 MiniPlayer；点击 MiniPlayer 才打开 Now Playing。

### 移动 Now Playing

- 轻量收起栏，不自动把焦点放在荧光关闭按钮上。
- 有真实封面时使用 1:1 大封面；无封面时收缩占位区，把空间还给歌曲和控制。
- 标题与艺人左对齐；删除装饰性 `NOW PLAYING` 文案。
- 层级固定为：封面 → 标题/艺人 → 进度 → prev/play/next → 音量 → shuffle/歌词/队列。
- 删除主舞台卡片、重复边框和“音乐大厅/歌单页”两个大导航胶囊。

### MiniPlayer

- 移动端用 64–68px 条形 MiniPlayer 替换 60px orb：44px 封面、标题/艺人、播放暂停、下一首。
- MiniPlayer 的信息区打开 Now Playing，播放按钮只控制播放，不触发导航。
- 播放会话存在时隐藏全局移动主题浮钮，消除底部控制冲突。

## 验收

- 390×844 音乐大厅首屏能看到歌单身份、两个主动作和至少一首完整歌曲行。
- 点击“播放”保持当前页面和滚动位置，不打开 dialog；播放会话出现 MiniPlayer。
- 点击 MiniPlayer 信息区才打开 Now Playing。
- Now Playing 在 390×844 内同时看见封面/占位、标题、进度、三枚核心控制、音量和底部工具。
- 源码不再包含 `music-mobile-player-stage`、移动 orb 或 `playAll({ expand: true })`。
- 有封面/无封面、长标题、单曲、错误态均完成真实浏览器截图复核。
- 公共音乐专项、blog typecheck、定向 lint、build 和 `git diff --check` 通过。

## 最终实现与浏览器证据

- 最终 390×844 音乐大厅 + MiniPlayer：`assets/music-visual-rework-2026-07-12/21-final-hall-with-miniplayer.png`
- 最终 390×844 Now Playing：`assets/music-visual-rework-2026-07-12/20-final-mobile-polished.png`
- 最终 390×844 歌词视图：`assets/music-visual-rework-2026-07-12/14-final-lyrics-mobile.png`
- 最终 390×844 队列视图：`assets/music-visual-rework-2026-07-12/15-final-queue-mobile.png`
- 最终 800×600 短视口桌面播放器：`assets/music-visual-rework-2026-07-12/16-final-desktop-800x600.png`
- 最终 1440×900 桌面播放器：`assets/music-visual-rework-2026-07-12/19-final-desktop-no-initial-ring.png`

真实浏览器验收结果：

1. 390×844：歌单身份、播放/随机和首曲同屏；开始播放后保持歌单页并出现 64px MiniPlayer。
2. MiniPlayer 只有一个“打开播放器”信息入口，另有独立播放/重试与下一首，未再出现 orb。
3. Now Playing 初始焦点落在 dialog 容器，不再给收起按钮制造常驻高亮环。
4. 歌词与队列是 dialog 内真实 pane；切换后焦点移到 pane 标题，返回键恢复 Now Playing。
5. 768px 显示移动 dialog，769px 显示桌面 dialog；断点两侧无双重播放器。
6. 800×600：桌面内容高度 688px，dialog `overflow-y: auto`、`scrollHeight=720`，封面占位 132×132px；控制区可滚动且不重叠。
7. 1440×900：桌面播放器限制为 1152×768px 并垂直居中；歌词/队列合并为单侧栏 ARIA tabs，方向键与 Home/End 可切换焦点。
8. 无独立歌单封面时固定回退首曲封面，不受 idle carousel 轮换；没有任何封面时显示紧凑、明确的“暂无封面”，不再放大 CSS 黑胶冒充媒体内容。

## 运行数据闭环

- 浏览器复核暴露的播放失败不是 UI 模拟态：媒体 37 存储记录指向 `uploads/2026/06/1781454643287_____-________.mp3`，而当时本地文件缺失，稳定入口因此由 302 落到 404。
- 在用户本机找到原始上传文件，原始文件名与数据库记录一致，两者字节数均为 `8392944`；恢复到记录的目标路径后 SHA-256 一致。
- `GET /api/v1/public/media/37` 现已完成 `302 -> 206 Partial Content`，返回 `Content-Type: audio/mpeg`、`Accept-Ranges: bytes`与正确的 `Content-Range: bytes 0-1023/8392944`。
- 不再根据 title 中的连字符猜测艺人，避免把 `Love - Hate` 之类合法歌名误拆；媒体导入改为从真实 ID3 标签读取 title / artist / album，显式的管理端输入始终优先。
- 当前曲目已用源文件 ID3 数据恢复为歌名“假如让我说下去”、艺人“杨千嬅”、专辑“千嬅盛放”、时长 208 秒；同时提取并恢复音频内嵌的 500×500 真实封面。重启后公开播放数据已返回正确的 `coverUrl`、歌名、艺人、专辑与时长。
