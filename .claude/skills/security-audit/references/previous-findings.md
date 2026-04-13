# Previous Findings & Audit Progress

**最后更新**: 2026-04-13
**审计状态**: 进行中（Phase 1 发现阶段完成）

---

## 已发现漏洞清单 (28 项)

### 🔴 CRITICAL (4)

| ID | 标题 | 文件 | OWASP |
|----|------|------|-------|
| VULN-001 | Mermaid SVG XSS | `apps/blog/app/components/MarkdownRenderer.tsx:476` | A03 Injection |
| VULN-002 | Shiki 高亮 HTML XSS | `apps/blog/app/components/MarkdownRenderer.tsx:629` | A03 Injection |
| VULN-003 | Docker Socket 挂载 | `docker-compose.prod.yml` | A05 Misconfiguration |
| VULN-004 | Elasticsearch 安全关闭 | `docker-compose.yml:49` | A05 Misconfiguration |

### 🟠 HIGH (7)

| ID | 标题 | 文件 | OWASP |
|----|------|------|-------|
| VULN-005 | JWT Secret 默认为空 | `apps/server-go/internal/config/config.go` | A02 Crypto |
| VULN-006 | Cookie Secure 默认 false | `apps/server-go/internal/config/config.go` | A02 Crypto |
| VULN-007 | PostgreSQL 密码硬编码 | `docker-compose.yml:9, docker-compose.prod.yml:70` | A05 Misconfiguration |
| VULN-008 | Redis 无密码保护 | `docker-compose.yml:26` | A05 Misconfiguration |
| VULN-009 | 容器日志 ID 注入 | `apps/server-go/internal/handler/system_monitor_handler.go:143` | A03 Injection |
| VULN-010 | SSE 流式代理未验证 | `apps/server-go/internal/handler/ai_handler.go` | A08 Integrity |
| VULN-011 | SSRF via AI proxy | `apps/server-go/internal/handler/ai_handler.go` | A10 SSRF |

### 🟡 MEDIUM (10)

| ID | 标题 | 文件 | OWASP |
|----|------|------|-------|
| VULN-012 | CORS 允许源列表过宽 | `apps/server-go/internal/config/config.go` | A05 Misconfiguration |
| VULN-013 | 文件上传 MIME 仅靠扩展名 | `apps/server-go/internal/service/media_service.go` | A04 Insecure Design |
| VULN-014 | Nginx 10G 上传限制 | `nginx/nginx.conf:53` | A05 Misconfiguration |
| VULN-015 | Nginx 无安全响应头 | `nginx/nginx.conf` | A05 Misconfiguration |
| VULN-016 | 日志文件路径处理 | `apps/server-go/internal/service/log_viewer.go` | A01 Access Control |
| VULN-017 | 评论内容 XSS | `apps/server-go/internal/handler/comment_handler.go` | A03 Injection |
| VULN-018 | admin dangerouslySetInnerHTML | `apps/admin/src/components/ai/AIToolsWorkspace.tsx:202` | A03 Injection |
| VULN-019 | localStorage 敏感数据 | `apps/admin/src/ (多处)` | A04 Insecure Design |
| VULN-020 | Python eval() 使用 | `apps/ai-service/eval_type_backport.py:114` | A03 Injection |
| VULN-021 | rehype-sanitize 放行 style/iframe | `apps/blog/app/components/MarkdownRenderer.tsx` | A03 Injection |

### 🔵 LOW (7)

| ID | 标题 | 文件 | OWASP |
|----|------|------|-------|
| VULN-022 | 数据库 SSL 默认 disable | `apps/server-go/internal/config/config.go` | A02 Crypto |
| VULN-023 | bcrypt cost 未校验 | `apps/server-go/internal/service/auth_service.go` | A02 Crypto |
| VULN-024 | 文件名消毒不完整 | `apps/server-go/internal/service/media_service.go` | A03 Injection |
| VULN-025 | Health endpoint 暴露状态 | `apps/server-go/internal/server/server.go` | A05 Misconfiguration |
| VULN-026 | KaTeX CSS 外部 CDN 无 SRI | `apps/blog/app/components/MarkdownRenderer.tsx` | A08 Integrity |
| VULN-027 | Next.js images 允许 localhost | `apps/blog/next.config.ts` | A05 Misconfiguration |
| VULN-028 | go-sqlmock 在间接依赖中 | `apps/server-go/go.mod` | A06 Components |

---

## 已审计文件清单 (~61 文件，~12% 覆盖率)

### Go 后端 (已审计 ~20/103)
- ✅ `internal/config/config.go` (305 行, 完整)
- ✅ `internal/server/server.go` (完整)
- ✅ `internal/middleware/jwt.go` (完整)
- ✅ `internal/middleware/cors.go` (完整)
- ✅ `internal/middleware/ratelimit.go` (完整)
- ✅ `internal/middleware/recovery.go` (完整)
- ✅ `internal/middleware/trace.go` (完整)
- ✅ `internal/handler/auth_handler.go` (完整)
- ✅ `internal/handler/ai_handler.go` (前 200 行)
- ✅ `internal/handler/system_monitor_handler.go` (前 250 行)
- ✅ `internal/handler/comment_handler.go` (前 230 行)
- ✅ `internal/repository/post_repo.go` (前 200 行)
- ✅ `internal/repository/media_repo.go` (前 120 行)
- ✅ `internal/service/log_viewer.go` (前 200 行)
- ✅ `internal/service/media_service.go` (部分)
- ✅ `internal/service/auth_service.go` (部分)
- ✅ `internal/pkg/jwtutil/jwtutil.go` (完整)
- ✅ `internal/pkg/storage/local.go` (完整)

### Python AI 服务 (已审计 ~8/40)
- ✅ `app/main.py` (100 行, 完整)
- ✅ `app/core/config.py` (115 行, 完整)
- ✅ `app/core/jwt.py` (80 行, 完整)
- ✅ `app/api/deps.py` (190 行, 完整)
- ✅ `app/api/routes/ai.py` (前 200 行)
- ✅ `app/services/llm_router.py` (前 180 行)
- ✅ `eval_type_backport.py` (部分)

### Admin 前端 (已审计 ~5/194)
- ✅ `src/services/api.ts` (完整)
- ✅ `src/stores/authStore.ts` (完整)
- ✅ `src/components/ai/AIToolsWorkspace.tsx` (部分)

### Blog 前端 (已审计 ~4/59)
- ✅ `app/components/MarkdownRenderer.tsx` (关键段落)
- ✅ `app/lib/api.ts` (50 行, 完整)
- ✅ `next.config.ts` (80 行, 完整)

### 基础设施 (已审计 ~6/10)
- ✅ `nginx/nginx.conf` (290 行, 完整)
- ✅ `docker-compose.yml` (80 行, 完整)
- ✅ `docker-compose.prod.yml` (前 250 行)
- ✅ `docker-compose.dev.yml` (部分)
- ✅ `env.example` (100 行, 完整)

### 共享包 (已审计 ~2/85)
- ✅ `packages/editor/src/MarkdownPreview.tsx` (关键段落)

---

## 未审计高优先级文件

### Go 后端 (剩余 ~83 文件)
- ❌ `internal/handler/post_handler.go`
- ❌ `internal/handler/media_handler.go`
- ❌ `internal/handler/stats_handler.go`
- ❌ `internal/handler/tag_handler.go`
- ❌ `internal/handler/category_handler.go`
- ❌ `internal/handler/site_handler.go`
- ❌ `internal/handler/site_setting_handler.go`
- ❌ `internal/handler/friend_link_handler.go`
- ❌ `internal/handler/activity_handler.go`
- ❌ `internal/handler/media_tag_handler.go`
- ❌ `internal/handler/version_handler.go`
- ❌ `internal/handler/storage_provider_handler.go`
- ❌ `internal/handler/share_handler.go`
- ❌ `internal/handler/migration_handler.go`
- ❌ `internal/handler/folder_handler.go`
- ❌ `internal/handler/permission_handler.go`
- ❌ `internal/handler/visitor_handler.go`
- ❌ `internal/handler/archive_handler.go`
- ❌ 所有其余 service 文件 (~17)
- ❌ 所有其余 repository 文件 (~11)
- ❌ `internal/model/*.go` (~10)
- ❌ `internal/dto/*.go` (~8)

### Python AI 服务 (剩余 ~32 文件)
- ❌ `app/api/routes/providers.py`
- ❌ `app/api/routes/prompts.py`
- ❌ `app/api/routes/tasks.py`
- ❌ `app/api/routes/search.py`
- ❌ `app/api/routes/metrics.py`
- ❌ `app/services/credential_resolver.py`
- ❌ `app/services/provider_registry.py`
- ❌ `app/services/vector_store.py`
- ❌ `app/services/model_router.py`

### Admin 前端 (剩余 ~189 文件)
- ❌ 所有 pages 组件 (~14 页面)
- ❌ 所有 services (~6 文件)
- ❌ 所有 stores (~4 文件)
- ❌ 所有 components (~165 文件)

### Blog 前端 (剩余 ~55 文件)
- ❌ 所有页面组件 (~6 页面)
- ❌ 所有 components (~15+ 文件)

### 共享包 (剩余 ~83 文件)
- ❌ `packages/ui/src/*.tsx`
- ❌ `packages/hooks/src/*.ts`
- ❌ `packages/utils/src/**/*.ts`
- ❌ `packages/types/src/**/*.ts`
- ❌ `packages/editor/src/*.tsx` (除 MarkdownPreview)
