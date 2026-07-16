# MP-02～05：播放面可见性与三态连续形变

## 状态规则

优先级为：

`route/render guard → explicit immersive → no playback → source visible → compact intent → orb`

- `explicit immersive` 是用户点击展开按钮后的明确意图，不被页内卡片可见性压制。
- 卡片播放只建立播放会话，不建立 compact 意图。
- 页内播放面可见时隐藏非模态浮层；重新离开时从 orb 起步。
- 多个播放面同时存在时，只要任意一个实际可见就抑制浮层。

## 可见性滞回

- 进入：播放面进入视区外扩 24px 范围时立即上报可见，提前让浮层自然退场。
- 离开：播放面完全离开外扩范围后延迟约 160ms 再上报不可见，滤掉滚动回弹和边界抖动。
- 卸载：立即注销，防止路由切换留下幽灵可见状态。

## 动效规则

- orb 与 compact 复用一个固定定位的完整 `layout` 外壳，Motion origin 与 bottom inset 固定左下，同时投影位置和尺寸，避免只投影尺寸时顶边瞬移。
- 封面不是两个节点之间的 shared-layout 复制品，而是一个持续挂载的按钮/图像节点；仅使用一次 `layout="position"` 做位置校正，避免父子双重投影和图片漂移。
- compact 内容使用 `popLayout` 退出流，外壳缩小时不会先等待内容淡出；标题与 transport 延后 80ms 轻微淡入。
- 手势收起不再把整张 compact 卡片送出屏幕后重新生成 orb，而是在当前手指位移上直接形变，并用同一阻尼弹簧归零。
- compact 与 mobile immersive 共享表面 layout id；背景遮罩独立淡入。
- 几何使用阻尼 spring；内容使用 120～180ms opacity，避免尺寸和内容同时抢动画主导权。
- Reduced Motion 关闭位移/缩放，保留短透明度变化和明确焦点归还。
