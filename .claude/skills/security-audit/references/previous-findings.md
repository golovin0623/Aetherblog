# Previous Findings & Audit Progress

**最后更新**: 2026-04-17
**审计状态**: 已完成 v2.0（151 项新发现 + 28 项历史 = 179 项总计）
**最新报告**: `docs/qa/security-audit-report-2026-04-17.md`（约 101,759 字符）
**真实覆盖率**: 511 / 515 源文件 · 99.2%

---

## 累计漏洞清单 (179 项)

### 🔴 CRITICAL (10)

| ID | 标题 | 文件 | OWASP |
|----|------|------|-------|
| VULN-001 | Mermaid SVG XSS | `apps/blog/app/components/MarkdownRenderer.tsx:476` | A03 |
| VULN-002 | Shiki 高亮 HTML XSS | `apps/blog/app/components/MarkdownRenderer.tsx:629` | A03 |
| VULN-003 | Docker Socket 挂载 | `docker-compose.prod.yml` | A05 |
| VULN-004 | Elasticsearch 安全关闭 | `docker-compose.yml:49` | A05 |
| VULN-052 | `/v1/admin/*` 组仅验 JWT 不验角色 | `apps/server-go/internal/server/server.go:181` | A01 |
| VULN-056 | Fernet 密钥与 JWT 密钥同源 | `apps/ai-service/app/services/credential_resolver.py:52-82` | A02 |
| VULN-117 | env.example 残留弱口令默认值 | `env.example:36,51,67,69` | A07 |
| VULN-132 | Webhook 绑 0.0.0.0 + 路径即认证 + root | `ops/webhook/webhook_server.py:9,52,116` | A07 |
| VULN-152 | test_stream.py 提交 ADMIN JWT 到版本库 | `apps/ai-service/test_stream.py:6` | A07 |
| VULN-162 | AI Service 内部 token 启动无强校验 | `apps/ai-service/app/api/deps.py:170-188` | A07 |

### 🟠 HIGH (33)

| ID | 标题 | 文件 | OWASP |
|----|------|------|-------|
| VULN-005 | JWT Secret 默认为空 | `internal/config/config.go` | A02 |
| VULN-006 | Cookie Secure 默认 false | `internal/config/config.go` | A02 |
| VULN-007 | PostgreSQL 密码硬编码 | `docker-compose.yml:9` | A05 |
| VULN-008 | Redis 无密码保护 | `docker-compose.yml:26` | A05 |
| VULN-009 | 容器日志 ID 注入 | `internal/handler/system_monitor_handler.go:143` | A03 |
| VULN-010 | SSE 流式代理未验证 | `internal/handler/ai_handler.go` | A08 |
| VULN-011 | SSRF via AI proxy | `internal/handler/ai_handler.go` | A10 |
| VULN-029 | 帖子 CRUD IDOR | `internal/handler/post_handler.go:162-186` | A01 |
| VULN-030 | SVG 上传 XSS | `internal/service/media_service.go:33` | A03 |
| VULN-031 | 存储 Provider 凭据回显 | `internal/service/storage_provider_service.go:119-130` | A02 |
| VULN-032 | S3 Endpoint SSRF | `internal/pkg/storage/s3.go:40-68` | A10 |
| VULN-033 | VanBlog 导入明文密码 | `internal/handler/migration_handler.go:276-303` | A02 |
| VULN-038 | 文件夹权限 Grant/Revoke IDOR | `internal/handler/permission_handler.go:33-109` | A01 |
| VULN-039 | 文件夹 CRUD IDOR | `internal/handler/folder_handler.go:93-146` | A01 |
| VULN-040 | 媒体文件 CRUD IDOR | `internal/handler/media_handler.go:281-396` | A01 |
| VULN-042 | 版本恢复/删除 IDOR | `internal/handler/version_handler.go:46-76` | A01 |
| VULN-057 | LLM 生产流量 SSRF | `app/services/llm_router.py:357-365` | A10 |
| VULN-058 | URL validator TOCTOU / DNS rebind | `app/utils/url_validator.py:34-53` | A10 |
| VULN-060 | 语义搜索泄露草稿 | `app/services/vector_store.py:20-36` | A01 |
| VULN-061 | /outline Prompt Injection | `app/api/routes/ai.py:809` | LLM01 |
| VULN-062 | Vector Store 投毒面 | `app/api/routes/search.py:151-189` | LLM03 |
| VULN-079 | sanitizeUrl 允许协议相对 URL | `apps/blog/app/lib/sanitizeUrl.ts:66-68` | A01 |
| VULN-080 | AuthorProfileCard 未净化 social link | `apps/blog/app/components/AuthorProfileCard.tsx:96-99` | A03 |
| VULN-118 | Dev Compose 硬编码 + Redis 无认证 | `docker-compose.dev.yml:18,37` | A05 |
| VULN-119 | 生产 Redis 无 auth 回退 | `docker-compose.prod.yml:95-100` | A07 |
| VULN-120 | JWT_SECRET 未强制校验 | `docker-compose.prod.yml:152,202` | A02 |
| VULN-121 | start.sh 硬编码 JWT 默认值 | `start.sh:530-532` | A07 |
| VULN-122 | Postgres 绑 0.0.0.0 | `docker-compose.prod.yml:71-72` | A05 |
| VULN-125 | 生产 Nginx 无边缘限流 | `nginx/nginx.conf` | A04 |
| VULN-134 | Webhook systemd 以 root 启动 | `ops/webhook/deploy-webhook.service:6` | A05 |

### 🟡 MEDIUM (78)

完整列表见 `docs/qa/security-audit-report-2026-04-17.md` §4；涵盖 IDOR 剩余项（VULN-037/041/044）、CORS、CSP 放水、容器硬化、CI/CD 供应链、RAG 注入、Fernet 静默解密、环境默认值、webhook 部署链次要项、依赖 CVE 等。

### 🔵 LOW (58)

完整列表见 `docs/qa/security-audit-report-2026-04-17.md` §4；涵盖 autocomplete 属性缺失、console 日志泄漏、弱随机数、UrlBuilder 未编码、server_tokens、HSTS、info disclosure 等。

---

## 已审计文件清单（511 / 515 · 99.2%）

### Go 后端 (103 / 103 · 100.0%)

全部 handler（24）、service（24）、repository（12）、model、dto、pkg/{pagination, response, image, storage, jwtutil, ctxutil}、middleware（6）、server、config、cmd。

### Python AI 服务 (40 / 40 · 100.0%)

全部 `app/api/routes/`、`app/services/`、`app/core/`、`app/utils/`、`app/models/`、`app/schemas/`、`eval_type_backport.py`、`test_stream.py`、`requirements*.txt`、`pyproject.toml`。

### Admin 前端 (190 / 194 · 97.9%)

全部 pages、services、stores、hooks、contexts、components（含 ai/、auth/、charts/、common/、history/、layout/、posts/、settings/、skeletons/）、libs、utils。未触达 4 个 pure-CSS wrapper 文件（无代码逻辑）。

### Blog 前端 (59 / 59 · 100.0%)

全部路由（home、posts/[slug]、timeline、friends、design、about）、components（35+）、lib（api、sanitizeUrl、remarkAlertBlock、socialLinks、headingId、logger、services、adminUrl）。

### 共享包 (85 / 85 · 100.0%)

全部 `packages/{ui,hooks,utils,types,editor}/src/**`，含 motion.ts、bearDecorations.ts、useTheme.tsx、tokens.css、surfaces.css、typography.css。

### 基础设施 (34 / 34 · 100.0%)

Dockerfile×4（backend、ai-service、blog、admin）、compose×4、nginx×3、ops/webhook×3、ops/release×2、env 模板×3、CI workflow×2、shell 脚本×5、`.dockerignore`、`.gitignore`、`go.mod`、`requirements.txt`、`requirements-dev.txt`、`pyproject.toml`、root `package.json`、`.github/setup-secrets.sh`。

---

## 质量门达成情况

- ✅ 字符数：101,759（≥ 50,000 要求，2.0× 余量）
- ✅ 覆盖率：99.2%（≥ 98% 要求）
- ✅ OWASP Top 10 每类均有分析（10 / 10）
- ✅ 所有 CRITICAL 与 HIGH 包含可运行修复代码
- ✅ 前次审计（2026-04-15）的盲点已全部补齐（migration、permission、version、share、storage_provider、provider_registry、webhook_server 等）

---

## 下次审计触发条件

1. 新增 AI provider 接入；
2. 多租户启用；
3. Go/Python/React 大版本升级；
4. Kubernetes 或 Envoy 基础设施迁移；
5. 安全事件后 72 小时内；
6. 周期性复审（下次建议时间：**2026-10-17**）。
