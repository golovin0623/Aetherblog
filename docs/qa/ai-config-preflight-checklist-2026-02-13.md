# AI 配置链与路由可达性自检说明（2026-02-13）

## 1. 本次变更
- 新增 Go 服务启动期 AI 预检逻辑（位于 `apps/server-go/internal/pkg/ai/preflight.go`），启动时执行 AI 服务预检：
  - 校验环境变量 `AI_SERVICE_URL` 是否为空/协议是否正确/是否错误包含 API 前缀；
  - 主动探活 `${AI_SERVICE_URL}/health`，记录延迟与状态。
- 新增预检配置项（`config.yaml`）：
  - `ai.preflight_enabled`（默认 `true`）
  - `ai.preflight_fail_fast`（默认 `false`）
  - `ai.preflight_timeout_ms`（默认 `3000`）
- 系统健康列表新增 `AI Service` 条目，支持监控页直接观察可达性状态。

## 2. 运行语义
- `ai.preflight_enabled=true` 且探活成功：启动日志输出 `AI preflight passed`。
- `ai.preflight_enabled=true` 且探活失败：
  - `ai.preflight_fail_fast=false`：记录 error，服务继续启动；
  - `ai.preflight_fail_fast=true`：启动失败并阻断发布。
- `ai.preflight_enabled=false`：预检跳过，健康状态显示 warning。

## 3. 配置优先级
1. 环境变量（`AI_SERVICE_URL` / `AI_PREFLIGHT_*`）
2. `config.yaml` 默认值

> 约束：`AI_SERVICE_URL` 仅允许主机根地址（如 `http://localhost:8000`），不得包含 `/api/v1/ai` 或 `/api/v1/admin`。

## 4. 预检清单（dev / staging）
1. 正常配置：
   - `AI_SERVICE_URL=http://localhost:8000`
   - 预期：`/v1/admin/system/health` 中 `AI Service=up`。
2. 错误前缀配置：
   - `AI_SERVICE_URL=http://localhost:8000/api/v1/ai`
   - 预期：预检失败并输出”AI_SERVICE_URL 不能包含 API 前缀”。
3. 不可达配置：
   - `AI_SERVICE_URL=http://127.0.0.1:65534`
   - 预期：探活失败，`ai.preflight_fail_fast=true` 时启动阻断。

## 5. 回归命令
```bash
cd apps/server-go
go build ./...
go test ./internal/pkg/ai/... -v
```

> 注：后端引用已由 Java/Maven → Go 1.24.1/Echo v4 更新（2026-04-04）
