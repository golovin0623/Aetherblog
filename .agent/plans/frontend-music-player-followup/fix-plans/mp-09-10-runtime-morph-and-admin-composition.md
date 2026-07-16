# MP-09～10：真实锚点轨迹与后台浮岛构图

**Severity**: P1 | **Priority**: P1 | **Complexity**: Medium

## Problem

- `apps/blog/app/components/MusicPlayerProvider.tsx` 的 fixed-bottom 浮岛从 52/48px 切到 264px 时使用 `layout="size"`。Framer Motion 只投影尺寸，外壳顶边先瞬移 212–216px；CSS `transform-origin` 在布局投影时会被 Framer 覆盖，无法形成此前宣称的封面锚点。
- 实际封面图片 `.music-playback-orb__artwork` 的 5px→0 inset 仍由独立的 260ms CSS transition 驱动，与外层 spring 不同轴，形成图片追赶外框的卡顿。
- `apps/admin/src/components/music/AdminMusicPlayerProvider.tsx` 的桌面 minimized 只有 184×64px，却同时容纳 44px 封面、两行窄文字与 48px 实心播放按钮；compact 把五个按钮集中在右列，主播放按钮相对 520px 卡片中心右偏约 68px，底部进度轨道进一步放大不平衡。

## Changes Required

### Frontend floating morph

- 外壳改为完整 `layout`，使用 Motion `originX: 0` / `originY: 1`，删除会被覆盖的 CSS transform-origin 伪锚点。
- 唯一封面继续使用完整 layout 投影；实际图片改为 motion 元素，由同一 `FLOATING_MORPH_TRANSITION` 驱动 inset，删除几何 CSS transition。
- 保留同一 shell key、同一封面节点、内容退出完成后再收壳、Reduced Motion 即时完成及“无顶部握把”约束。

### Admin minimized and compact composition

- 桌面 minimized 根宽 360px、可见胶囊 352×60px，胶囊在根边界内左右各留约 4px；44px 圆形封面完整内嵌，上下各留约 8px，禁止任何负向偏移或越过胶囊圆角。
- minimized 播放控制维持 44px 触控区，但只绘制 32px 轻量描边圆环；不复用 48px 实心主按钮。
- desktop compact 使用 `1fr / transport / 1fr` 对称网格：左侧身份信息，中间 prev/play/next，右侧密度与最小化；进度条绝对定位到底部，不参与主行垂直分配。
- expanded 改用 `scrollbar-gutter: stable both-edges`，避免仅右侧预留滚动槽造成视觉中心偏移。

## Verification

1. 先更新 source gate 与 admin state test，在旧实现上得到红灯。
2. 实现后执行 targeted Vitest、完整 reader/music gate、Blog/Admin type-check 与 lint、PostCSS、`git diff --check`。
3. 获得浏览器控制授权后，在真实浏览器逐 rAF 采样：前台 shell 的 left/bottom 全程误差 ≤1px，首帧封面中心无大跳，展开单调到目标、收起回到初始 rect ≤1px。
4. 浏览器几何门禁要求后台 desktop minimized 为 360×64px 根边界/352×60px 可见胶囊、44px 完整内嵌封面、32px 可见播放圆环；compact 主播放键中心与 520px 卡片中心误差 ≤1px，详情态双侧 gutter 对称。
5. 将参考图与同状态实现截图并排比较；旧的“封面外伸 8px”截图只能作为历史问题证据，不得继续作为通过依据。

## Result

- 前台正反向 renderer trace 均保持唯一封面节点，端点中心误差远小于 1px，且没有反向尺寸步或超过 50ms 的长帧。
- 后台 minimized 使用居中的 352×60px 可见胶囊和 44px 内嵌封面；表面统一 `overflow-hidden`，源代码门禁和运行时几何脚本同时拒绝封面越界。
- 后台移动 minimized 的根、表面、内容和小球统一为 52×52px；移动表面不再用 1px 边框侵占内容空间，Chromium 实测小球四边完整包含。
- compact 主 transport 独立锁定几何中心，expanded 使用双侧稳定滚动槽。
- 浏览器门禁把 Playwright 声明为仓库开发依赖，并使用仓库内已跟踪图片响应夹具，不再依赖本机上传目录。
- 用户在本地后台页面完成最终状态复核并确认可以提交。
