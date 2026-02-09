# Repository Guidelines

## Prompt 路由规则
- 当用户消息以 `/prompts:plan` 开头时，自动引用并读取 `AGENTS.plan.md` 作为本轮补充规则。
- 触发格式：`/prompts:plan <需求或内容>`。
- `<需求或内容>` 视为计划输入，优先输出结构化执行计划（目标、步骤、风险、验收标准），再进入实现。
- 若 `AGENTS.plan.md` 不存在或为空，需明确告知并回退到本文件默认规则。

## 项目结构与模块组织
- 本仓库是 `pnpm` workspace 单体仓（见 `pnpm-workspace.yaml`）。
- `apps/blog`：博客前台（Next.js 15 + React 19）。
- `apps/admin`：管理后台（Vite + React 19）。
- `apps/server`：Java 后端（Spring Boot 多模块 Maven 工程）。
- `apps/ai-service`：独立 AI 服务（FastAPI + LiteLLM）。
- `packages/*`：前端共享库（`ui`、`utils`、`types`、`hooks`、`editor`）。
- `docs/`、`ops/`、`nginx/`：文档与运维/部署配置。

## 构建、测试与开发命令
- 安装依赖：`pnpm install`。
- 启动前端：
  - `pnpm dev` 或 `pnpm dev:admin`（后台默认 `:5173`）
  - `pnpm dev:blog`（前台默认 `:3000`）
- 构建 JS/TS 工作区：`pnpm build`。
- 代码检查：`pnpm lint`。
- Java 后端：`cd apps/server && mvn clean install -DskipTests`，随后 `mvn test`。
- AI 服务：`cd apps/ai-service && pip install -r requirements-dev.txt && pytest`。
- 一键脚本：`./start.sh`、`./stop.sh`。

## 代码风格与命名规范
- TypeScript/React 使用严格模式，优先显式类型与不可变更新。
- Lint 规则：`apps/admin` 使用 ESLint Flat Config，`apps/blog` 使用 `next/core-web-vitals`。
- 命名建议：
  - 组件/页面：`PascalCase`（如 `SearchPanel.tsx`）
  - Hook：`useXxx`（如 `useSmartPolling.ts`）
  - Store/Service/Utils：`camelCase` 文件名（如 `authStore.ts`）
- Python 遵循 PEP 8，4 空格缩进，按功能拆分 `apps/ai-service/app` 模块。

## 测试规范
- Python 测试位于 `apps/ai-service/tests`，框架为 `pytest`。
- 覆盖率门槛定义在 `apps/ai-service/pyproject.toml`：`--cov-fail-under=80`。
- Java 测试位于 `apps/server/**/src/test/java`，使用 `mvn test`。
- 前端当前以 lint + type-check + build 作为 CI 基线，新增复杂逻辑应补充就近测试。

## 提交与合并请求规范
- 提交信息遵循历史惯例：`feat(scope): ...`、`fix(scope): ...`、`perf(scope): ...`。
- `scope` 建议明确（如 `blog`、`admin`、`security`、`ai`、`core`）。
- PR 至少包含：变更摘要、关联任务、测试证据、UI 改动截图/GIF、配置或迁移说明。

## 安全与配置提示
- 禁止提交密钥；本地配置写入 `.env`，示例参考 `env.example`。
- 修改容器编排前建议先验证：`docker compose -f docker-compose.yml config --quiet`。
