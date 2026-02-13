# AI 统计与日志可观测性故障基线（2026-02-13）

## 1. 目标与范围
- 目标：为 AI 统计链路建立统一故障样本与验收口径，作为后续修复/回归/发布准入唯一判据。
- 链路范围：`Admin Dashboard -> Server Stats API -> AI Service Metrics/Usage`。
- 当前基线版本：`baseline-v1`（创建时间：2026-02-13）。

## 2. 四类故障样本清单

| 样本ID | 故障类型 | 触发条件 | 现象 | 证据锚点 |
| --- | --- | --- | --- | --- |
| AIOB-F001 | 请求失败 | `analyticsService.getAiDashboard` 请求 rejected（网络/5xx） | 控制台 error，前端 toast 提示失败，数据回退空看板 | `apps/admin/src/pages/dashboard/DashboardPage.tsx:165` |
| AIOB-F002 | 空数据 | AI 看板返回 `code=200` 且记录为空（低流量或回填缺失） | 看板呈现“看似正常但数值为 0”，易与失败态混淆 | `apps/admin/src/services/analyticsService.ts:156` |
| AIOB-F003 | 静默降级 | AI 看板接口返回非 200 | 前端直接使用 `MOCK_AI_DASHBOARD`，仅 warning，不具备显式故障分层 | `apps/admin/src/pages/dashboard/DashboardPage.tsx:162` |
| AIOB-F004 | 配置错误 | Server/AI service 路由前缀或地址错误（如 base-url/profile 不一致） | 管理端链路可调用但指标不可达或长期为 0 | `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/controller/StatsController.java:85`; `apps/ai-service/app/api/routes/metrics.py:9` |

## 3. 指标口径定义（统一验收）

### 3.1 看板可用率（Dashboard Availability Rate）
- 定义：`成功渲染且非降级态次数 / 看板请求总次数 * 100%`
- 非降级态判定：接口 `code=200` 且未命中 mock/empty fallback。
- 数据来源：前端看板请求埋点 + 服务端接口日志。

### 3.2 日志接口成功率（Log API Success Rate）
- 定义：`/v1/admin/system/logs` 成功响应次数 / 请求总次数 * 100%`
- 成功判定：HTTP 2xx 且业务 `code=200`。
- 数据来源：Server access log + Admin 调用埋点。
- 参考入口：`apps/admin/src/services/systemService.ts:238`。

### 3.3 空数据误判率（False Empty-Data Rate）
- 定义：`被判定“空数据”但经复核为“故障/异常”的次数 / 空数据判定总次数 * 100%`
- 复核依据：traceId、错误类别、后端响应语义（无数据 vs 读取失败）。
- 目标：该指标应趋近 0%，否则说明仍存在静默降级/错误语义混淆。

## 4. 可复测步骤（按样本复跑）

### AIOB-F001 请求失败
1. 启动 Admin，临时断开 Server 或让 `/api/v1/admin/stats/ai-dashboard` 不可达。
2. 打开管理端 Dashboard，观察 AI 看板请求。
3. 预期：前端记录错误日志并出现失败提示，不应伪装为“正常空数据”。

### AIOB-F002 空数据
1. 保持 Server 可用，准备“无 AI 调用记录”的时间窗口（例如新环境）。
2. 调用 AI 看板接口：
   ```bash
   curl -sS 'http://localhost:8080/api/v1/admin/stats/ai-dashboard?days=1&pageNum=1&pageSize=20'
   ```
3. 预期：接口返回明确空数据语义（非失败），并可与故障态区分。

### AIOB-F003 静默降级
1. 让 AI 看板接口返回非 200（例如鉴权失效/后端抛错）。
2. 观察前端是否仍回退 `MOCK_AI_DASHBOARD`。
3. 预期：应被识别为故障并进入可观测降级，而非“静默正常”。

### AIOB-F004 配置错误
1. 检查 Server 与 AI service 的前缀/地址：
   - Server: `/api/v1/admin/stats/ai-dashboard`
   - AI Metrics: `/api/v1/admin/metrics/ai`
2. 人为配置错误（如错误 base-url/profile）后复测。
3. 预期：能明确暴露为配置错误，不应吞错为“零数据”。

## 5. 本轮复跑记录（baseline-v1）
- 复跑时间：2026-02-13
- 复跑方式：静态链路复核 + 编译回归（用于确认故障分型锚点与复测入口可用）
- 执行命令：
  ```bash
  pnpm --filter @aetherblog/admin build
  rg -n "getAiDashboard|MOCK_AI_DASHBOARD|加载失败" apps/admin/src/pages/dashboard/DashboardPage.tsx apps/admin/src/services/analyticsService.ts
  ```
- 结果摘要：
  - Admin 构建通过；
  - 四类故障锚点可定位，存在静默降级与空数据语义混淆风险，基线建立完成，可用于后续修复验收。

## 6. 后续 issue 依赖关系
- AIOB-010（契约审计）基于本基线核对“请求参数/响应语义/错误分类”。
- AIOB-040、AIOB-050 需消解 F003/F002 的“静默降级 + 语义混淆”。
- AIOB-070 回归测试须覆盖 F001~F004 全部样本。
