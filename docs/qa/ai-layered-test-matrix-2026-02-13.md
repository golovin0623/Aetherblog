# AI 可观测链路分层测试矩阵（2026-02-13）

## 覆盖目标
- 路径：正常 / 空数据 / 异常 / 鉴权失败
- 分层：后端服务、AI Service 路由、前端契约回归（编译门禁）

## 用例映射
| 场景 | 后端 | AI Service | 前端 |
| --- | --- | --- | --- |
| 正常 | `StatsServiceTest#testGetAiAnalyticsDashboardAggregatesOverview` | `test_ai_metrics_route_returns_usage_logging_snapshot` | `pnpm --filter @aetherblog/admin build` |
| 空数据 | `LogViewerServiceTest#queryLogsByLevelReturnsNoDataWhenFileMissing` | metrics 快照初始值断言 | Dashboard 类型收敛 + 构建通过 |
| 异常 | `LogViewerServiceTest#queryLogsByLevelReturnsErrorWhenFileUnreadable` | `usage_logger` 失败采样与告警单测 | 构建阶段接口契约检查 |
| 鉴权失败 | 全局异常分类 + 403 映射 | `test_require_admin_rejects_non_admin_user` | 依赖后端返回语义（前端降级态在 AIOB-060 覆盖） |

## 建议执行命令
```bash
# 后端
cd apps/server
mvn -pl aetherblog-service/blog-service -Dtest=StatsServiceTest,LogViewerServiceTest test

# AI Service
cd apps/ai-service
JWT_SECRET=test-secret POSTGRES_DSN=postgresql://localhost:5432/testdb \
python3 -m pytest -o addopts='' tests/test_usage_logger_metrics.py tests/test_metrics_routes.py -q

# 前端契约回归（当前仓库默认门禁）
pnpm --filter @aetherblog/admin build
```
