# AI 埋点失败可观测增强检查（2026-02-13）

## 1. 变更目标
- 将 `ai_usage_log_failed` 从单纯 warning 升级为“计数 + 分类 + 采样 + 阈值告警”。
- 保持业务请求不被埋点写库失败阻断，并显式记录降级事件。
- 在 `/api/v1/admin/metrics/ai` 中暴露 `usage_logging` 结构，供后台诊断使用。

## 2. 关键行为
- 失败计数：`usage_logging.failures_total`
- 降级成功计数（业务成功但埋点失败）：`usage_logging.degraded_success_total`
- 错误分类：`usage_logging.error_categories`
- 阈值告警：达到 `AI_USAGE_LOG_FAILURE_ALERT_THRESHOLD` 的倍数触发一次告警事件
- 采样明细：保留最近 `AI_USAGE_LOG_FAILURE_SAMPLE_LIMIT` 条样本（含 `request_id`、`error_category`）

## 3. 配置项
- `AI_USAGE_LOG_FAILURE_ALERT_THRESHOLD`（默认 `10`）
- `AI_USAGE_LOG_FAILURE_SAMPLE_LIMIT`（默认 `50`）

## 4. 回归建议
1. 人为制造 `ai_usage_logs` 不可写（如收紧写权限）后调用 `/api/v1/ai/summary`。
2. 观察业务响应仍返回成功（降级语义成立）。
3. 调用 `/api/v1/admin/metrics/ai`，确认 `usage_logging` 中：
   - `failures_total` 增长；
   - `degraded_success_total` 增长；
   - `samples` 包含 `request_id` 与 `error_category`。
4. 连续触发至阈值倍数，确认出现 `ai_usage_log_failed.alert` 日志。

## 5. 本地验证
```bash
cd apps/ai-service
JWT_SECRET=test-secret POSTGRES_DSN=postgresql://localhost:5432/testdb \
python3 -m pytest -o addopts='' tests/test_usage_logger_metrics.py -q
```
