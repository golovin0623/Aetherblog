# MP-07～08：封面锚点形变与双端浮岛留白

## Problem

- 前台 orb 与 compact 已经复用一个封面节点，但封面仍保持 52px，外壳从左下角展开；用户看到的是两个对象同时运动，而不是一张封面自然生成卡片。
- compact → orb 时内容和外壳同时收缩，缺少“内容先内聚、封面最后收圆”的逆向层级。
- 前台 compact 顶/侧使用 12px，底部工具行仅留下约 4px；后台 compact 虽然使用统一 `p-3`，但 12px 外边距和 8px 行距让顶部过紧，错误提示又使用另一组外边距。

## Changes Required

### `apps/blog/app/components/MusicPlayerProvider.tsx`

- 外壳变形原点改为 orb 封面中心，固定 bottom/left 锚点不变。
- 同一个封面节点从 orb 的 52px 圆形连续过渡到 compact 的 64px 系统圆角封面；不得重新挂载第二张图片。
- compact 使用 16px 四边 padding、64px header 网格和固定终态高度，确保正向/逆向使用相同几何终点。
- 父外壳与唯一封面节点共用同一个设计系统 motion preset，不允许分别使用两套 stiffness/damping。
- compact 使用固定终态高度，而不是仅设置 `min-height`；内容退出期间外壳尺寸必须保持不变。
- collapsing 阶段由 `AnimatePresence.onExitComplete` 完成回调推进：先退出标题/进度/transport，再切换外壳密度；禁止用 `setTimeout` 猜测动画结束时间；Reduced Motion 立即完成。

### `apps/blog/app/globals.css`

- 封面内层 inset、圆角、阴影沿同一曲线变化；Reduced Motion 关闭非必要过渡。

### `apps/admin/src/components/music/AdminMusicPlayerProvider.tsx`

- compact/expanded 在移动端保留 16px 四边 padding，桌面宽卡提升为设计系统 `--space-5`（24px）节奏。
- 错误提示与当前密度使用同一响应式左右/底部边界。
- 所有密度都不得重新添加顶边握把、横向胶囊或独立拖动条；拖拽热区保留在卡片表面，密度切换只使用已有图标按钮。

## Verification

1. 新增源代码门禁，先在旧实现上失败，再实现至通过。
2. Reader/music Vitest 配置全量通过。
3. Admin music-player 单元测试全量通过。
4. Blog/Admin type-check 与 lint 通过。
5. PostCSS 与 `git diff --check` 通过。
6. 真机验证 orb → compact → orb：封面尺寸和圆角正反向一致，compact 内容收起顺序清楚，前后台卡片四边留白对称。
