# AI 统计与日志接口错误分层语义检查（2026-02-13）

## 1. 变更范围
- `R` 响应结构新增 `errorCategory` 字段，失败响应统一携带错误分类。
- `GlobalExceptionHandler` 对业务/校验/资源不存在/系统异常统一映射分类。
- `LogViewerService` 增加 `queryLogsByLevel` 语义结果：`OK / NO_DATA / ERROR`。
- `SystemMonitorController#/logs` 在不改变日志列表数据结构前提下，补充空结果与读取失败区分语义。
- `StatsService#getAiAnalyticsDashboard` 参数边界统一归一化（days/pageNum/pageSize）。

## 2. 语义约定
- 空结果（日志不存在/空文件）：HTTP 200，`errorCategory` 分别为 `LOG_FILE_NOT_FOUND` / `LOG_FILE_EMPTY`。
- 读取失败：HTTP 500，`errorCategory=LOG_READ_FAILURE`。
- 全局异常分类：`business_error`、`validation_error`、`resource_not_found`、`internal_error`。

## 3. 参数边界
- `days <= 0` 回退 `7`，`days > 180` 截断到 `180`。
- `pageNum <= 0` 回退 `1`，`pageNum > 10000` 截断到 `10000`。
- `pageSize <= 0` 回退 `20`，`pageSize > 100` 截断到 `100`。
- `lines <= 0` 回退 `2000`，`lines > 5000` 截断到 `5000`。

## 4. 回归建议
1. `GET /v1/admin/system/logs?level=ERROR&lines=0`：验证自动归一化与稳定返回。
2. 将日志目录置空后调用 `/v1/admin/system/logs`：验证 `NO_DATA + LOG_FILE_NOT_FOUND`。
3. 通过权限/文件句柄故障模拟读取失败：验证 `500 + LOG_READ_FAILURE`。
4. `GET /v1/admin/stats/ai-dashboard?days=-1&pageNum=0&pageSize=1000`：验证边界参数稳定。
