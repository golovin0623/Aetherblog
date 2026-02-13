# AI 统计与日志三端契约审计（2026-02-13）

## 1. 审计范围
- Admin（调用方）：`analyticsService`、`systemService`、Dashboard/RealtimeLogViewer。
- Server（聚合方）：`StatsController`、`SystemMonitorController`、`StatsService`。
- AI Service（提供方）：`/api/v1/ai/*`、`/api/v1/admin/metrics/ai`。

## 2. 契约清单（覆盖 100% AI 统计与日志相关接口）

| 链路 | 接口 | 请求参数契约 | 响应结构契约 | 错误语义 |
| --- | --- | --- | --- | --- |
| Admin -> Server | `GET /v1/admin/stats/ai-dashboard` | `days(1~180)`, `pageNum(>=1)`, `pageSize(1~100)`, `taskType?`, `modelId?`, `success?`, `keyword?` | `R<AiAnalyticsDashboard>`，`records` 分页字段固定为 `list/total/pageNum/pageSize/pages` | 业务异常应透出可诊断类别，不应静默回退 |
| Admin -> Server | `GET /v1/admin/system/logs` | `level(ALL/INFO/WARN/ERROR/DEBUG)`, `lines(>0)` | `R<List<String>>` | 读取失败需显式区分“无日志”与“读取失败” |
| Admin -> Server | `GET /v1/admin/system/logs/files` | 无 | `R<List<LogFileInfo>>` | 非 200 需提供可重试语义 |
| Admin -> Server | `GET /api/v1/admin/system/logs/download` | `level` | 文件流下载 | 找不到文件返回 404 |
| Server -> AI Service | `POST /api/v1/ai/{summary|tags|titles|polish|outline|translate}` | `Authorization` + 各任务 request schema | `ApiResponse<T>`（字段：`code/message/success/data/errorCode/errorMessage/requestId`） | 429/超时/5xx 转换为 `AiRateLimitException/AiTimeoutException/AiServiceException` |
| Server -> AI Service | `GET /api/v1/admin/metrics/ai` | 管理权限依赖 `require_admin` | `ApiResponse<dict>` | 鉴权失败应返回可诊断错误，不得吞错 |

## 3. 字段命名与分页语义核对

### 3.1 AI 看板字段一致性
- Admin 类型 `AiDashboardData` 与 Server `AiAnalyticsDashboard` 字段一一对应：
  - `rangeDays`, `overview`, `trend`, `modelDistribution`, `taskDistribution`, `records`。
- 分页字段一致：`pageNum`, `pageSize`, `total`, `pages`, `list`。

### 3.2 默认值与可空策略
- `success` 为可空布尔：`null` 表示不过滤（Admin 传 `undefined`，Server 接收 `null`）。
- `taskType/modelId/keyword` 可空，Server 统一 blank-to-null 处理。
- 参数边界：Server 实施 clamp（`days<=0 -> 7`, `days>180 -> 180`, `pageSize>100 -> 100`）。

## 4. 差异审计与处理结论

| 差异ID | 发现 | 影响 | 处理结论 |
| --- | --- | --- | --- |
| CAD-01 | AI 看板非 200 时前端回退 `MOCK_AI_DASHBOARD` | 容易把故障伪装为空数据 | 结论：在 `AIOB-060` 落地“显式降级+重试+最后成功时间” |
| CAD-02 | 应用日志接口在前端直接 `then(res => res.data)`，缺少业务码分层 | “空结果/失败”语义混淆 | 结论：在 `AIOB-050` 统一错误分类与诊断字段 |
| CAD-03 | 三端响应封装存在双轨：`R<T>`（Server）与 `ApiResponse<T>`（AI） | 对联调排障不友好 | 结论：保留双轨但建立映射文档，后续在 `AIOB-050` 补 `errorCategory/traceId` 透传 |
| CAD-04 | 配置错误（`AI_SERVICE_URL`、profile）可导致链路可达但统计为 0 | 线上静默故障风险 | 结论：在 `AIOB-020` 增加启动期自检与路由可达探测 |

## 5. 回归抽样用例（契约清单驱动）
1. 正常路径：`ai-dashboard` 返回 200 + 非空 records。
2. 空结果路径：`ai-dashboard` 返回 200 + 空 list。
3. 参数非法路径：`days=0/pageSize=999`，验证 clamp 与语义。
4. 鉴权失败路径：移除 token，请求 `ai-dashboard` 与 `metrics/ai`。

> 注：本次完成契约审计与抽样清单沉淀；完整联调执行在 `AIOB-070` 统一回归。

## 6. 审计锚点
- `apps/admin/src/services/analyticsService.ts:156`
- `apps/admin/src/services/systemService.ts:238`
- `apps/admin/src/pages/dashboard/components/RealtimeLogViewer.tsx:60`
- `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/controller/StatsController.java:87`
- `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/controller/SystemMonitorController.java:105`
- `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/service/StatsService.java:89`
- `apps/server/aetherblog-ai/ai-client/src/main/java/com/aetherblog/ai/client/client/AiServiceHttpClient.java:40`
- `apps/ai-service/app/api/routes/ai.py:134`
- `apps/ai-service/app/api/routes/metrics.py:12`
