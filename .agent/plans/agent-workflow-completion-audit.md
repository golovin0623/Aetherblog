# Agent Workflow Completion Audit

日期：2026-05-12
目标：按「明天约 100 个用例验收」口径审计智能体编排模块是否可验收。

## 1. 目标拆解

本轮目标不是单纯“代码能编译”，而是让验收人员可以覆盖以下用户路径：

1. 后台能进入独立的「智能体编排」模块。
2. 用户能看到 workflow 列表、画布、节点 palette、节点属性、变量、工具目录、运行输入、运行历史和 trace。
3. 用户能新增节点、拖动节点、连接边、编辑节点关键属性。
4. 用户能保存画布到后端，后端能校验 definition 并写版本快照。
5. 用户能填写运行输入并触发 runtime run。
6. ai-service 能执行固定 DAG，返回节点级 trace。
7. Go 后端能落库 run 和 node logs，并提供最近运行历史和单次 run 回放。
8. 用户能把 workflow 发布成 slug，并通过 authenticated runtime API 调用。
9. 安全边界不能被绕过：secret 不进前端、Code 节点不在主进程直接执行、外部 LLM/MCP/Skill 默认显式模拟。
10. 文档必须如实反映已完成能力和未完成后续阶段。
11. 验证命令必须覆盖前端类型/构建、Go、ai-service runner、compose 和 diff hygiene。
12. 明天手工验收需要一份可执行用例清单，覆盖正常路径、边界条件、安全边界和文档/验证项。

## 2. Prompt-to-Artifact Checklist

| 验收要求 | Artifact / 证据 | 状态 |
| --- | --- | --- |
| 独立后台入口 `/agent-workflows` | `apps/admin/src/App.tsx`、`apps/admin/src/components/layout/Sidebar.tsx` | 已完成 |
| React Flow 画布、节点 palette、连接边 | `apps/admin/src/pages/agent-workflows/AgentWorkflowsPage.tsx` | 已完成 |
| 节点属性编辑 | Inspector 支持 label / description / tool / agent / extractor / branch / loop / code / output 字段编辑 | 已完成 |
| 运行输入不是硬编码 | Run Inputs 根据 `definition.inputs` 渲染，并按 schema 转换类型 | 已完成 |
| 保存草稿和后端同步 | `agentWorkflowService.createWorkflow/updateWorkflow` + Go CRUD | 已完成 |
| workflow 切换 | active workflow ID、高亮、后端 detail 加载、run history 刷新 | 已完成 |
| 后端 definition 校验 | `apps/server-go/internal/pkg/agentworkflow/definition.go` + 157 个 Go validation 用例片段 | 已完成 |
| DB 表和安全种子工具 | `apps/server-go/migrations/000052_agent_workflow_canvas.*.sql` | 已完成 |
| runtime run 创建与 ai-service 转发 | `AgentWorkflowService.CreateRun` / `executeWorkflow` | 已完成 |
| run history / detail / logs | `GET /api/v1/admin/agent-workflows/:id/runs`、`GET /api/v1/agent/runs/:id`、`GET /api/v1/agent/runs/:id/logs` | 已完成 |
| published agent 发布与 slug invoke | `PUT/DELETE /api/v1/admin/agent-workflows/:id/publication`、`GET /api/v1/agent/published`、`POST /api/v1/agent/published/:slug/invoke` | 已完成 |
| run 查询自动化测试 | `apps/server-go/internal/repository/agent_workflow_repo_test.go`、`apps/server-go/internal/service/agent_workflow_service_test.go` | 已完成 |
| ai-service DAG runner | `apps/ai-service/app/workflows/*`、`apps/ai-service/tests/test_workflow_runner.py` | 已完成 |
| 分支、循环、extractor、模板变量 | ai-service runner + workflow tests | 已完成 |
| Code 节点安全边界 | Go validator 要求 `sandboxRef`；ai-service 默认只模拟或注入 executor | 已完成 |
| 文档同步 | `.agent/plans/agent-workflow-canvas-module-plan.md`、`docs/agent/*`、`docs/output/*` | 已完成 |
| 前端验证 | `pnpm --filter @aetherblog/admin typecheck`、`exec eslint . --quiet`、`build` | 已通过 |
| Go 验证 | `cd apps/server-go && go test ./...` | 已通过 |
| ai-service 验证 | `cd apps/ai-service && .venv/bin/python -m pytest -q --no-cov`，264 passed | 已通过 |
| compose 验证 | `docker compose -f docker-compose.yml config --quiet`、`docker compose -f docker-compose.prod.yml config --quiet` | 已通过 |
| diff hygiene | `git diff --check` | 已通过 |
| 明天手工验收清单 | `.agent/plans/agent-workflow-acceptance-cases.md`，140+ 个检查点 | 已完成 |

## 3. 仍未完成的后续阶段

以下能力已在 schema / 文档中预留，但不应计为当前已完成：

- Scheduler daemon：尚未扫描 `agent_schedules` 并自动 enqueue run。
- 真正的 HTTP / OpenAPI / MCP / Skill adapter：目前只有 registry/schema/默认禁用 seed，真实 adapter 未接入。
- 长跑 run 的 SSE / cancel / resume：当前是同步 run + trace 回写，不是实时流式执行控制。
- 独立 sandbox-worker：Code 节点安全占位已完成，但真实 Python/JS 沙盒执行未接入。
- token/cost 精确预算：表结构预留了 token/cost 字段，真实 LLM adapter 接入前无法计算真实 token。

## 4. 结论

当前已达到 Canvas-first MVP 的 P0 验收口径：可进入、可编辑、可保存、可运行、可回放、可验证。

如果验收范围被定义为完整 Dify-like 平台或 `CODE_ROADMAP` 全量长期路线，则目标尚未完成，剩余项是 scheduler / real adapters / SSE control / sandbox-worker / token budget。

## 5. 2026-05-12 复验记录

- `pnpm --filter @aetherblog/admin typecheck`：通过。
- `pnpm --filter @aetherblog/admin exec eslint . --quiet`：通过。
- `pnpm --filter @aetherblog/admin build`：通过，仅保留 Vite 大 chunk 警告。
- `cd apps/server-go && go test ./...`：通过。
- `cd apps/server-go && go test ./internal/pkg/agentworkflow -json | awk -F'"' '/"Action":"run"/ {count++} END {print count}'`：157。
- `cd apps/ai-service && .venv/bin/python -m pytest -q --no-cov`：264 passed，12 warnings。
- `docker compose -f docker-compose.yml config --quiet`：通过。
- `docker compose -f docker-compose.prod.yml config --quiet`：通过。
- `docker compose -f docker-compose.dev.yml config --quiet`：当前本地 `.env` 缺少必填 `DB_PASSWORD`，因此按预期失败；不是本轮代码回归。
- `git diff --check`：通过。
- Playwright 访问 `http://127.0.0.1:4173/admin/agent-workflows`：通过 mock auth/settings/agent-workflow API 渲染到页面，确认出现「智能体编排」「发布」「RUN INPUTS」「RUN HISTORY」「TRACE」。
