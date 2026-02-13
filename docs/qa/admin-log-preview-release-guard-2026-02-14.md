# Admin 日志预览分层回归与灰度回退闭环（ALPR-080）

## 适用范围

- 双入口：`Dashboard` 与 `System Monitor` 的日志预览面板。
- 前端核心：`apps/admin/src/pages/dashboard/components/RealtimeLogViewer.tsx`。
- 后端核心：`/v1/admin/system/logs`（兼容 `level+lines`，扩展 `keyword/limit/cursor`）。
- 对应交付：`ALPR-010 ~ ALPR-070` 的状态机、布局、自动刷新、全屏、筛选、导出与契约能力。

## 分层回归矩阵

### 1) 组件交互与状态机分支（前端）

- 状态机分支：覆盖 `idle/loading/healthy/no_data/error/paused`，确认暂停态不会继续请求。
- 交互链路：级别切换、关键字过滤、自动滚动开关、手动刷新、全屏进出、导出按钮禁用态。
- 双入口一致性：同一操作在 Dashboard 与 Monitor 的状态文案、行为和提示保持一致。
- 失败路径：无数据导出、下载失败、日志服务异常时均有明确反馈且可继续操作。

### 2) 服务契约与兼容回归（后端）

- 兼容路径：`level+lines` 老调用可继续返回可解析结构。
- 扩展路径：`keyword/limit/cursor` 生效，分页游标与边界行为可预期。
- 语义一致：`no_data` 与 `error` 分类清晰，`errorCategory` 不缺失。
- 回归命令：`mvn -pl aetherblog-service/blog-service -am -Dtest=LogViewerServiceTest -Dsurefire.failIfNoSpecifiedTests=false test`。

### 3) 性能基线（2000 行日志）

- 基线场景：加载 2000 行后连续执行“级别切换 → 关键字过滤 → 导出最近 500 行 → 全屏切换”。
- 观察口径：交互期间无明显卡顿、无长时间白屏、滚动连续可控。
- 判定建议：若出现明显掉帧或阻塞，优先关闭导出增强与高级筛选能力并走灰度降级。

## 已执行自动化验证（2026-02-14）

- 前端构建：`pnpm --filter @aetherblog/admin build`（通过）。
- 后端契约测试：`LogViewerServiceTest`（5/5 通过）。

## 灰度发布建议

- 建议灰度开关：
  - `log_preview_enhanced_ui_enabled`：控制新信息架构与状态提示。
  - `log_preview_export_actions_enabled`：控制“导出当前/导出最近500”。
  - `log_query_contract_v2_enabled`：控制 `keyword/limit/cursor` 扩展契约。
- 灰度顺序：先 Dashboard 小流量，再 Monitor；异常时优先关闭后两项开关。

## 一键回退预案

1. 先关灰度开关，确认问题是否收敛。
2. 若需代码回滚，可在主分支执行：
   - `git revert --no-edit 8eecf63 c135757 3ccc1ad 0bceeb4 9b6876a e412220 cfe4ca3`
3. 回退后重新执行：
   - `pnpm --filter @aetherblog/admin build`
   - `mvn -pl aetherblog-service/blog-service -am -Dtest=LogViewerServiceTest -Dsurefire.failIfNoSpecifiedTests=false test`

## 发布后观察（24h）

- `/v1/admin/system/logs` 请求失败率与 `errorCategory` 分布。
- Dashboard/Monitor 的日志面板异常反馈量（导出失败、空数据误报、暂停失效）。
- 高负载日志场景下的浏览器卡顿反馈与性能波动。
