# Editor/TOC/Autosave 分层回归与发布保护（ETSA-080）

## 适用范围

- ETSA-010：CodeMirror 选区可见性
- ETSA-020：预览 `data-source-line` 映射稳定性
- ETSA-030：TOC 导航统一执行器
- ETSA-040：分屏同步滚动插值算法
- ETSA-050：目录动画时间线与 reduced-motion
- ETSA-060：自动保存状态条与统一状态机
- ETSA-070：博客详情页目录体验

## 分层回归矩阵

### 1) 组件层（低成本快速阻断）

- `packages/editor/src/MarkdownEditor.tsx`：检查 `focus/blur` 下 `.cm-selectionLayer` 与 `::selection` 样式链。
- `packages/editor/src/MarkdownPreview.tsx`：检查 `heading/paragraph` 的 `data-source-line` 去歧义策略。
- `packages/editor/src/EditorWithPreview.tsx`：检查双向同步节流、惯性抑制和清理函数。
- `apps/blog/app/components/TableOfContents.tsx`：检查 heading-id 复用与 active tracking。

### 2) 页面层（核心链路）

- `apps/admin/src/pages/posts/CreatePostPage.tsx`：TOC 点击、split 同步、自动保存状态条。
- `apps/blog/app/posts/(article)/[slug]/page.tsx`：桌面侧栏目录、移动抽屉目录与平滑滚动。

### 3) 场景层（手工回归）

- 主题：`light/dark`
- 视图：`edit/split/preview`
- 文档：长文、重复标题、代码块密集
- 网络：正常 / 慢网 / 断网

## 灰度开关建议

- `toc_nav_unified_enabled`：统一 TOC 导航执行器。
- `split_sync_interpolation_enabled`：分屏锚点插值同步算法。
- `toc_motion_timeline_enabled`：目录单时间线动画。
- `autosave_status_bar_enabled`：自动保存状态条。
- `blog_toc_mobile_drawer_enabled`：博客移动端目录抽屉。

> 若当前没有配置中心，可先在前端本地常量层实现开关映射并保留默认开启。

## 快速回滚点

1. 导航异常：关闭 `toc_nav_unified_enabled`，回退旧目录跳转路径。
2. 同步抖动：关闭 `split_sync_interpolation_enabled`，退回比例同步方案。
3. 动画卡顿：关闭 `toc_motion_timeline_enabled`，保留静态目录。
4. 保存状态误导：关闭 `autosave_status_bar_enabled`，恢复 toast 反馈。
5. 移动端目录问题：关闭 `blog_toc_mobile_drawer_enabled`，仅保留桌面目录。

## 阻断级缺陷定义（Blocker）

- TOC 点击无法定位或错误定位到非目标标题。
- split 模式累计误差持续 > 3 行且影响阅读。
- 自动保存 UI 显示成功但请求实际失败。
- 移动端目录抽屉导致页面无法滚动或无法关闭。

## 发布前检查清单

- 已执行 `pnpm --filter @aetherblog/admin lint`（允许既有 warnings）。
- 已执行 `pnpm --filter @aetherblog/blog lint`（允许既有 warnings）。
- 已按 `docs/qa/editor-toc-sync-autosave-baseline.md` 完成核心场景手工复测。
- 已验证至少一个灰度开关关闭后的降级路径可用。

## 发布后 24h 观察

- TOC 点击成功率、跳转耗时与异常日志量。
- split 模式滚动同步投诉和性能尖峰（长任务）。
- 自动保存失败率与“保存状态误导”反馈。
- 移动端目录抽屉打开/关闭成功率与返回行为。
