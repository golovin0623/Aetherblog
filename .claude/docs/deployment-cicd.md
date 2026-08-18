# 部署、CI/CD、Nginx 网关

> **何时读：** 准备发版；调 webhook / preflight 行为；改 Docker 配置；改 Nginx 路由；新加容器安全配置；理解 deploy mode 选择。
>
> 完整运维文档：`docs/deployment.md`（特别是 `#cicd-自动化发布链路` 一节）。本文档是 **Claude 视角的速查**。

---

## 1. 镜像构建

```bash
# 并行构建 + push（推荐）
./docker-build.sh --push --version v1.1.1

# 串行构建（网络不稳时）
./docker-build.sh --push --sequential --version v1.1.1

# 单镜像
./docker-build.sh --only backend --push
./docker-build.sh --only blog --push
./docker-build.sh --only admin --push
```

---

## 2. 生产部署

```bash
# 配置环境
cp .env.example .env
# 编辑 .env

# 拉取并启动
export DOCKER_REGISTRY=golovin0623
export VERSION=v1.1.2
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# 跟踪日志
docker-compose -f docker-compose.prod.yml logs -f
```

### 端口映射

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| Gateway（统一入口） | 7899 | 唯一对外端口 |
| Blog | 7893 | 可选直连 |
| Admin | 7894 | 可选直连 |
| PostgreSQL | 7895 | 可选直连（生产建议关） |
| Backend API | — | 仅容器内网络 |

---

## 3. CI/CD Webhook 自动化（五段式管线）

**生产部署完全由管线驱动 —— 服务器上无任何手动步骤。**

```
GitHub Actions (ci-cd.yml)
   │ build & push multi-arch images
   ▼
HMAC-SHA256 signed POST /deploy
   │
   ▼
webhook_server.py  (ops/webhook/)
   ├─ verify HMAC + parse services allowlist
   ├─ flock /var/lock/aetherblog-deploy.lock + git fetch + reset --hard FETCH_HEAD  ← 代码在此拉取（PR #525）
   ├─ release flock, fork deploy.sh with env["SKIP_GIT_SYNC"]="true"
   ▼
deploy.sh  (ops/webhook/)
   ├─ flock /var/lock/aetherblog-deploy.lock
   ├─ skip internal git sync（已在 webhook 层完成；fallback 路径保留给直接 `bash deploy.sh` 调用）
   ├─ 严格 KEY=VALUE .env 解析（NOT source、NOT IFS='='）
   ├─ compose pull
   ├─ pre-deploy migration（compose run --rm + dirty self-heal table）
   └─ compose up -d   (full / incremental / canary / rollback)
   ▼
ops/release/preflight.sh
   ├─ static: compose config, required cmds
   └─ runtime: services running, migration ≥33, gateway /health,
              ai-service /health (≤120s retry window),
              auth enforcement, ai_providers ≥60, ai_models ≥1500,
              backend logs clean, /app/logs readable
```

任一步失败 → `exit 1` 中止部署 + 日志追加到 `/var/log/aetherblog-deploy.log`。

---

## 4. Deploy 模式（通过 `DEPLOY_MODE` 环境变量）

| 模式 | 行为 |
| --- | --- |
| `full`（默认） | `compose pull` + `up -d` 所有服务 |
| `incremental` | 仅指定的 `DEPLOY_SERVICES`；纯前端发布跳过 migration |
| `canary` | 预定义 `CANARY_SERVICES=backend,ai-service` 的灰度 |
| `rollback` | `ROLLBACK_VERSION=vX.Y.Z` 回滚到指定镜像 tag |

---

## 5. 容器安全加固（所有应用服务）

| 项 | 配置 | 关联 VULN |
| --- | --- | --- |
| 不许提权 | `security_opt: [no-new-privileges:true]` | VULN-123 |
| 砍 capability | `cap_drop: [ALL]` | VULN-123 |
| 只读根文件系统 | `read_only: true` + `tmpfs` 挂载可写区 | VULN-123 |
| 强制密钥存在 | `JWT_SECRET:?...` / `AI_CREDENTIAL_ENCRYPTION_KEYS:?...` / `REDIS_PASSWORD:?...` 必须设置；compose 在缺失时 fail-fast | VULN-056 / -119 / -120 |
| ai-service 健康检查 | `start_period: 45s`、`interval: 10s` —— 给冷启动留余量（litellm/asyncpg/pgvector import + asyncpg pool + jwt_keys DB fetch） | — |
| backend 健康检查 | `start_period: 30s`、`interval: 3s` | VULN-150（不要把崩溃循环当"healthy yet"） |
| Docker socket | **默认不挂载**（PR #603）。`:ro` 仍暴露 root 等价的 Docker API，已从 `docker-compose.prod.yml` 移除 socket bind-mount 与 `group_add`、并从 `.env.example` 删除 `DOCKER_GID`。结果：admin "容器监控" 面板在默认部署下不可用。如需恢复，请走 `tecnativa/docker-socket-proxy` 代理（API 白名单到 `/containers/json` + `/containers/*/stats`），**禁止**把宿主 socket 直接 bind-mount 回 backend | VULN-003 |

---

## 6. Nginx 网关路由

### 文件位置

- `nginx/nginx.conf` —— **生产**路由
- `nginx/nginx.dev.conf` —— **开发**路由（同样规则 + hot reload 代理）

### 生产规则速览

| 路径 | 上游 | 关键参数 |
| --- | --- | --- |
| `/api/v1/ai/*` | `ai_service` (FastAPI:8000) | timeout 600s、`X-Accel-Buffering: no`（SSE） |
| **上传 location**（见下） | backend (Go:8080) | `client_max_body_size 10G`、read timeout 3600s、`proxy_request_buffering off` |
| `/admin/` | admin (Vite:5173 / 编译后:80) | — |
| `/api/` | backend (Go:8080) | `client_max_body_size 50m`、read timeout 60s、`limit_req zone=edge_api` |
| `/` | blog (Next.js:3000) | — |

**上传 location 的正则必须写后端真实注册的路径**：

```nginx
location ~ ^/api/(upload|media|file|v1/chat/attachments|v1/admin/media/upload|v1/admin/media/[0-9]+/content|v1/admin/kbs/[0-9]+/files|v1/admin/migrations/vanblog)
```

历史 bug：这里只写了 `^/api/(upload|media|file|v1/chat/attachments)`，而媒体库上传的实际 URL 是 `/api/v1/admin/media/upload`（`media` 在第 4 段），正则一次都没命中 —— 所有媒体上传都掉进通用 `/api` 块的 50MB + 60s 里，症状是"传大 PPT/视频失败、传小文档正常"。改这里前先 `grep -rn "Mount(admin" apps/server-go/internal/server/server.go` 核对真实路径。详见 `.agent/rules/nginx-guide.md` §4.3。

> 上传体积还受**后端** `site_settings.upload_max_size`（MB，硬上限 100MB）约束 —— 网关放行不等于后端接收。两者要一起看：迁移 000088 已把陈旧的 10MB 种子值抬到 100MB。

被 `./start.sh --gateway`（开发）和 `./start.sh --prod`（生产）使用。

### 详细规则与代理头部

见 `.agent/rules/nginx-guide.md`。

---

## 7. CI/CD GitHub Actions

| 工作流 | 用途 |
| --- | --- |
| `ci-cd.yml` | 主管线：build / test / 推 Docker 镜像 |
| `quick-build.yml` | 快速验证构建 |

详细：`.github/CICD_GUIDE.md` + `.github/VERSION_GUIDE.md`。

### 7.0 测试门禁：三套测试各自跑在哪个 job（红线）

| 测试栈 | job | 步骤名 | 命令 | 触发条件（`detect-changes`） |
| --- | --- | --- | --- | --- |
| Go 单测 | `backend-test` | Run tests | `go test ./... -v -count=1` | `backend == true` |
| Python 单测 | `ai-test` | **Run unit tests (pytest)** | `pip install -r requirements-dev.txt` + `python -m pytest tests --ignore=tests/e2e -q` | `ai-service == true` |
| 前端单测 | `frontend-quality` | **Unit tests (vitest)** | `pnpm -r --if-present test` | `frontend == true`（blog 或 admin） |

> **历史欠账（2026-08 修复）：** 加粗的两步此前**不存在** —— `ai-test` 只有 `py_compile` + `ruff` + import 自检，`frontend-quality` 只有 lint + typecheck。结果是 `apps/ai-service/tests/`（644 例）与 admin / agent-kit 的 vitest 用例（515 例）**从未在 CI 执行过**，`pyproject.toml` 里的 `--cov-fail-under` 覆盖率门槛也从未生效。写了测试 ≠ 测试在跑，接手时先确认 job 里真有对应步骤。

**三条红线：**

1. **不许降级为非阻断。** 这三步都不许加 `|| true` / `continue-on-error: true`。（本仓库有意非阻断的只有 `gitleaks` / `trivy-scan` / `govulncheck` / `pnpm audit` 四个观测型步骤，它们都在注释里写明了原因与转正条件。）
2. **pytest 步骤刻意不注入 secret env。** `apps/ai-service/tests/conftest.py` 用 `os.environ.setdefault` 兜底 `JWT_SECRET` / `AI_INTERNAL_SERVICE_TOKEN` / `AI_CREDENTIAL_ENCRYPTION_KEYS` / `POSTGRES_DSN`，`setdefault` **不会覆盖外部已有值**；而 `tests/test_deps.py` 用字面量 `"test-secret"` 签 JWT。一旦照抄同 job「Verify app can start」步骤的 `JWT_SECRET: ci-test-secret`，4 个 `test_deps` 用例当场签名校验失败。该步骤只设 `AI_ENV=test` / `AI_MOCK_MODE=true`。
3. **vitest 用 `--if-present` 而非裸 `pnpm -r test`。** `blog` / `ui` / `hooks` / `types` / `utils` / `editor` 没有 `test` script，裸 `-r test` 会整段失败。新包只要在自己 `package.json` 加 `"test": "vitest run"` 就自动纳入门禁；覆盖率门槛（pytest 侧）写在 `apps/ai-service/pyproject.toml` 的 `[tool.pytest.ini_options].addopts`，不在 workflow 里重复。

`tests/e2e` 依赖外部 provider / 真实 DB，明确排除在单测门禁之外。

### 7.1 Lint 工具链必须钉版本（红线）

`ai-test` job 的 **Run linting** 步骤跑 `ruff check .`，检查范围由两处**共同**决定，缺一不可：

| 钉什么 | 钉在哪 | 不钉的后果 |
| --- | --- | --- |
| **规则集** | `apps/ai-service/pyproject.toml` → `[tool.ruff.lint].select` | 范围 = 所装 ruff 版本的**内置默认集**，即门禁由上游定义 |
| **工具版本** | `apps/ai-service/requirements-lint.txt`（`ruff==x.y.z`，精确 `==`） | 上游发版即换规则集 |

> **事故先例（run 32047480619）：** 两处都没钉 —— 无 `[tool.ruff]` 配置 + CI 裸跑 `pip install ruff`。ruff 0.16.0 大幅扩充内置默认集（新增 `I` / `RUF` / `B` / `S` / `UP` / `SIM` / `ASYNC` / `C4` / `DTZ` …），CI 于 2026-08-17 拉到 0.16.3，**零代码变更的 main 分支当场爆出 507 条 error**。
>
> 这类故障的特征是「谁都没改代码，流水线自己红了」，排查时先比对 CI 里工具的实际版本，别去 diff 业务代码。

**升级 ruff 的正确姿势：** 改 `requirements-lint.txt` 版本号 → 本地 `cd apps/ai-service && pip install -r requirements-lint.txt && ruff check .` → 新告警在**同一个 PR**里清理干净或显式调整 `select`。禁止把清理工作留给下一个人的 CI。

**同一原则适用于所有 CI 工具链**：任何 `pip install <tool>` / `go install ...@latest` / `npx <tool>` 只要其输出参与红绿判定，就必须钉版本。（例外：`govulncheck` 有意用 `@latest` 且已 `|| echo "::warning::"` 降级为非阻断。）
