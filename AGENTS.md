# Repository Guidelines

## Prompt 路由规则
- 当用户消息以 `/prompts:plan` 开头时，自动引用并读取 `AGENTS.plan.md` 作为本轮补充规则。
- 触发格式：`/prompts:plan <需求或内容>`。
- `<需求或内容>` 视为计划输入，优先输出结构化执行计划（目标、步骤、风险、验收标准），再进入实现。
- 若 `AGENTS.plan.md` 不存在或为空，需明确告知并回退到本文件默认规则。

## 项目结构与模块组织
- 本仓库是 `pnpm` workspace 单体仓（见 `pnpm-workspace.yaml`）。
- `apps/blog`：博客前台（Next.js 15 + React 19），使用 App Router，核心代码位于 `app/`。
- `apps/admin`：管理后台（Vite 6 + React 19），核心代码位于 `src/`，接口调用集中在 `src/services/`。
- `apps/server-go`：Go 后端（Go 1.24.1 + Echo v4 + sqlx + golang-migrate），入口位于 `cmd/server`、`cmd/migrate`，业务分层位于 `internal/`，迁移文件位于 `migrations/`。
- `apps/ai-service`：独立 AI 服务（FastAPI + LiteLLM），应用代码位于 `app/`，测试位于 `tests/`，脚本位于 `scripts/`。
- `packages/*`：前端共享库（`ui`、`utils`、`types`、`hooks`、`editor`）。
- `.agent/plans`：计划与评审清单；`.agent/issues`：问题记录；`.agent/workflows`：任务工作流；`.agent/rules`：补充规则。
- `docs/`、`ops/`、`nginx/`：文档、运维与网关配置。

## 开发、运行与排障入口
- 安装依赖：`pnpm install`。
- 根脚本 `pnpm dev` 与 `pnpm dev:admin` 只启动管理后台（默认 `:5173`），不是全栈启动命令。
- 博客前台：`pnpm dev:blog`（默认 `:3000`）。
- 全栈开发优先使用仓库脚本：
  - `./start.sh`：开发模式，分别启动博客、管理后台、Go 后端、AI 服务。
  - `./start.sh --gateway`：开发网关模式，统一入口 `:7899`。
  - `./start.sh --with-middleware`：额外启动 PostgreSQL / Redis / Elasticsearch。
  - `./start.sh --prod`：按生产网关方式启动。
- 停止服务优先使用 `./stop.sh`；需要同时关闭中间件时使用 `./stop.sh --all`。不要默认手工 `kill` 或直接清理 Docker。
- 生产容器重启入口是 `./restart.sh [backend|ai-service|blog|admin|gateway] [--pull]`。
- 默认端口约定：
  - 博客前台：`3000`
  - 管理后台：`5173`
  - Go 后端：`8080`
  - AI 服务：`8000`
  - 开发/生产网关统一入口：`7899`
- 运行期排障证据优先查看 `logs/`、`.pids/`、`.locks/`，它们是仓库脚本维护的真实状态面。
- `docker-compose.yml` 主要承载本地中间件；`docker-compose.dev.yml` / `docker-compose.prod.yml` 对应不同网关与部署场景，修改前先确认目标文件。

## 构建、检查与测试
- JS/TS 工作区构建：`pnpm build`。
- JS/TS 工作区检查：`pnpm lint`。
- 前端 type-check 需按应用分别执行：
  - `pnpm --filter @aetherblog/blog typecheck`
  - `pnpm --filter @aetherblog/admin typecheck`
- Go 后端：`cd apps/server-go && go build ./...`，测试：`go test ./... -v`。
- AI 服务：`cd apps/ai-service && pip install -r requirements-dev.txt && pytest`。
- 变更应优先执行“受影响面最小且足够证明正确”的验证；涉及前后端契约时，至少补一侧消费者验证。
- 修改容器编排前按目标文件验证：
  - `docker compose -f docker-compose.yml config --quiet`
  - `docker compose -f docker-compose.dev.yml config --quiet`
  - `docker compose -f docker-compose.prod.yml config --quiet`

## 代码风格与命名规范
- TypeScript/React 使用严格模式，优先显式类型、不可变更新与小而清晰的组件边界。
- `apps/blog` 遵循 Next.js App Router 约定；路由文件使用框架保留名（如 `page.tsx`、`layout.tsx`、`route.ts`）。
- `apps/admin` 保持页面、组件、服务、状态分层清晰：
  - 组件/页面：`PascalCase`
  - Hook：`useXxx`
  - Store/Service/Utils：`camelCase` 文件名
- 共享类型与协议变更优先落在 `packages/types/src/`，避免在应用内重复定义。
- Go 代码保持 `handler` / `service` / `repository` / `dto` 分层，不要把跨层逻辑堆进单个包。
- Python 遵循 PEP 8，4 空格缩进，按功能拆分 `apps/ai-service/app` 模块。

## 协作与变更约束
- 新的计划、评审清单、整改方案统一落在 `.agent/plans/`，文件名使用 kebab-case 且具备明确语义。
- 历史问题复盘或专项记录优先放入 `.agent/issues/`，不要把一次性分析散落到仓库根目录。
- 遇到以下任务，优先复用已有工作流文档：
  - 移动端调试：`.agent/workflows/mobile-debug.md`
  - 文档同步/补全：`.agent/workflows/doc-maintenance.md`
  - Git 敏感信息清理：`.agent/workflows/git-sensitive-cleanup.md`
- 修改 API、DTO、返回结构、鉴权或上传逻辑时，必须同时核对：
  - `apps/admin/src/services/`
  - `apps/blog/app/lib/api.ts`
  - `packages/types/src/`
- 修改启动、网关、部署、环境变量相关逻辑时，需同步检查 `README.md`、`.env.example`、`apps/admin/.env.local.example`、`nginx/` 与相关 `docs/` 是否也发生漂移。
- 搜索与审查优先做 diff-scoped 或目标目录 scoped 检查，避免把运行产物或无关目录噪音当成结论依据。

## 测试规范
- Python 测试位于 `apps/ai-service/tests`，框架为 `pytest`。
- 覆盖率门槛定义在 `apps/ai-service/pyproject.toml`：`--cov-fail-under=80`。
- Go 测试位于 `apps/server-go`，使用 `go test ./... -v`。
- 前端当前以 lint + type-check + build 作为 CI 基线；新增复杂逻辑应补充就近测试或至少提供可复现验证步骤。

## 提交与合并请求规范
- 提交信息遵循历史惯例：`feat(scope): ...`、`fix(scope): ...`、`perf(scope): ...`。
- `scope` 建议明确（如 `blog`、`admin`、`security`、`ai`、`core`）。
- PR 至少包含：变更摘要、关联任务、测试证据、UI 改动截图/GIF、配置或迁移说明。

## 安全与配置提示
- 禁止提交真实密钥；本地配置写入 `.env` 或应用级 `.env.local`，示例参考 `.env.example` 与 `apps/admin/.env.local.example`。
- `.env.example`、`docker-compose.yml`、`README.md` 中的占位字段（空 `=` 形式）必须保持空，不得回填默认密码、示例账号或 mock key（VULN-117 历史问题：旧 `env.example` 因含 `aetherblog123` / `change-me-...` 而被淘汰）。
- 文档与规则文件本身是高风险面：`AGENTS.md`、`CLAUDE.md`、`.agent/workflows/*`、`docs/*` 变更时要额外检查是否泄漏本机 IP、绝对路径、默认口令、令牌或内部地址。
- 修改容器编排前，除了校验 `docker compose ... config --quiet`，还要确认改动对应的是开发、中间件还是生产栈，避免误改错文件。

## 📱 移动端调试与 UI 规范

### 真机调试
手机与 Mac 在同一 Wi-Fi 下，推荐使用网关模式（`./start.sh --gateway`）：
- 统一入口：`http://<Mac IP>:7899`（`/` 博客、`/admin/` 管理后台、`/api` 后端）
- 关键配置：`apps/blog/.env.local` 的 `NEXT_PUBLIC_ADMIN_URL=/admin/`（相对路径，避免 localhost 硬编码）
- 备选直连：博客默认 `:3000`，管理后台默认 `:5173`；管理后台直连时需显式监听 `0.0.0.0`
- 远程 DevTools：iOS Safari → 开发菜单 / Android Chrome → `chrome://inspect`

### 移动端 UI 开发约定
- 移动端断点：`useMediaQuery('(max-width: 768px)')`，项目统一标准
- 弹出面板样式：Bottom Sheet（`max-h-[66vh]`、`rounded-t-2xl`、遮罩点击关闭）
- Safe Area：底部操作区使用 `pb-[max(1rem,env(safe-area-inset-bottom))]`
- 按钮触控区域不小于 `44x44px`
- 编辑器默认模式：移动端 `'edit'`，桌面端 `'split'`
- 修改移动端样式时不得影响桌面端布局
