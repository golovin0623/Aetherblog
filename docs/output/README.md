# AetherBlog · 技术摸底沉淀文档

> **范围:** AetherBlog 项目完成态全模块技术沉淀
> **最新纠偏:** 2026-05-29 / `origin/main` 基线 / migrations 至 000067 / 新增 Aether Knowledge + KB + Atlas 沉淀
> **原始基线:** 2026-05-09 / branch `claude/sad-gould-35d3a6` / migrations 至 000046 / Aether Codex Round 5
> **沉淀规模:** 11 个一级模块 / 87 份 markdown / 29,268 行(当前工作树)
> **变更日志:** [CHANGELOG.md](./CHANGELOG.md)

---

## 1 · 文档分层

四个层面渐进式沉淀,对应用户最初的拆解要求:

```
Layer 1  功能目录          一级目录(01-* ~ 11-*)
Layer 2  总体设计模块       每个模块的 README.md
Layer 3  能力设计           每个模块下的 0X-*.md
Layer 4  迭代变更摘要       CHANGELOG.md
```

---

## 2 · 模块导航

### 后端(Go / Echo · `apps/server-go/`)

| # | 模块 | 关注面 | 文档量 |
| --- | --- | --- | --- |
| 01 | [鉴权与用户](./01-backend-auth-users/) | JWT 双密钥 / Session / RBAC + Ownership + ABAC / **TOTP 未实现** | 6 文 / 1735 行 |
| 02 | [内容](./02-backend-content/) | 文章状态机 / 标签 / 分类 / 评论审核 / 分享归档 / **版本未实现** | 7 文 / 1657 行 |
| 03 | [媒体与存储](./03-backend-media-storage/) | 上传链路 / Folder 5 级权限 / Provider 5 合 1 / Sync DB-only 队列 | 7 文 / 2162 行 |
| 04 | [AI / 搜索 / 系统](./04-backend-ai-search-system/) | AI 网关 / Agent / 关键词+语义 RRF 搜索 / 系统监控 / 中间件 / Global Pricing | 8 文 / 2405 行 |

### 前端(`apps/blog/` + `apps/admin/`)

| # | 模块 | 关注面 | 文档量 |
| --- | --- | --- | --- |
| 05 | [博客 · Next.js 15](./05-frontend-blog/) | App Router / RSC / Markdown 管线 / 文章+问答双模式搜索 / iOS WKWebView | 8 文 / 2499 行 |
| 06 | [后台 · Vite + React 19](./06-frontend-admin/) | Shell / 编辑器 / 媒体库 / AetherHub / KB / Atlas / Global Pricing | 10 文 / 3823 行 |

### AI 服务(Python · FastAPI + LiteLLM · `apps/ai-service/`)

| # | 模块 | 关注面 | 文档量 |
| --- | --- | --- | --- |
| 07 | [AI 服务](./07-ai-service-python/) | LiteLLM / strict profile embedding / KB indexing+recall / Atlas stub / Global Pricing | 7 文 / 2616 行 |

### 数据 / 设计 / 基础设施

| # | 模块 | 关注面 | 文档量 |
| --- | --- | --- | --- |
| 08 | [数据库 · 66 migration](./08-database-migrations/) | PG17 + pgvector / KB embeddings / Atlas schema / notes / RBAC / dirty self-heal | 6 文 / 2513 行 |
| 09 | [设计系统 · 共享包](./09-design-system-shared-packages/) | Aether Codex token / surface / motion / 5 个 packages / legacy 倒计时 | 9 文 / 5128 行 |
| 10 | [基础设施 / DevOps](./10-infrastructure-devops/) | Docker / nginx 网关 / start.sh / GitHub Actions + HMAC webhook / ops | 7 文 / 2603 行 |
| 11 | [Aether Knowledge / Atlas / 知识库](./11-aether-knowledge-atlas/) | KB/RAG 生命周期 / Atlas Carrier+Annotation+KP+Relation / Admin 入口 / 000057-000067 | 7 文 |

---

## 3 · 全局架构速览

```
                                    ┌────────── nginx :7899 ──────────┐
                                    │  /        → blog (Next.js 15)   │
                                    │  /admin/  → admin (Vite SPA)    │
                                    │  /api/    → server-go :8080     │
       Browser  ────HTTP/SSE───►    │  /api/v1/ai/  → ai-service :8001│
                                    └─────────────────────────────────┘
                                                   │
        ┌──────────────────────────────────────────┴──────────────────────┐
        │                                                                 │
   ┌────▼─────┐    ┌────────────┐    ┌─────────────┐    ┌──────────────┐
   │ blog     │    │ admin      │    │ server-go   │    │ ai-service   │
   │ Next 15  │    │ Vite + R19 │    │ Echo v4     │    │ FastAPI      │
   │ RSC + ISR│    │ Zustand    │    │ API/RBAC    │    │ LiteLLM      │
   └──────────┘    │ Tanstack-Q │    │ KB/Atlas    │    │ KB recall    │
                   └────────────┘    │ 21 repo     │    │ 26 tests     │
                                     └────┬────────┘    └──────┬───────┘
                                          │                    │
        ┌─────────────────────────────────┴────────────────────┴────────┐
        │  PostgreSQL 17 (pgvector / tsvector / 67 migrations)          │
        │  Redis 7  (refresh tokens / rate-limit / preflight)           │
        │  Object Storage (S3 / OSS / COS / R2 / MinIO / 本地)          │
        └────────────────────────────────────────────────────────────────┘
```

数据/服务总线:
- **JWT_SECRET / AI_INTERNAL_SERVICE_TOKEN / AI_CREDENTIAL_ENCRYPTION_KEYS** —— server-go ↔ ai-service 三把跨进程共享 secret(其中 `AI_CREDENTIAL_ENCRYPTION_KEYS` 还兼任对象存储凭据加密)
- **共享日志卷 `aetherblog_logs`(UID/GID 1001)** —— 两侧写入前 SecretRedactor 清洗
- **migration 优先发版** —— ai-service 升级前 server-go 必须 `migrate up` 完

---

## 4 · 横向矩阵 · 安全 / 质量 / 运维

### 4.1 已识别的 P0 / P1 问题(按模块去重)

| 优先级 | 模块 | 问题 | 一句话影响 |
| --- | --- | --- | --- |
| P0 | 06-admin | CommentsPage 演示降级:mutation catch 静默成功 + mockData 兜底 | 生产 403/500 被掩盖,用户以为操作生效但刷新后状态不变 |
| P0 | 09-packages | `packages/utils` 入口冲突(`format.ts` vs `format/`,`helpers.ts` vs `helpers/`) | `formatDuration / deepClone / retry / uuid` 全部不能从 `@aetherblog/utils` 直接 import |
| P0 | 09-packages | `packages/ui` Primitive 仍用 legacy token + `dark:` + 直写色值 | Codex 落地最大卡点,所有调用方继承偏差 |
| P1 | 01-auth | JWT Rotator 缺 leader election | K8s 多副本会触发轮换冲突,docker-compose 单副本兜底 |
| P1 | 01-auth | AUTHOR 角色完全无效 | DB CHECK 允许但代码无 `RequireRole("AUTHOR")` 调用 |
| P1 | 02-content | SCHEDULED 状态半实现 | 没有 worker 把 SCHEDULED 推进到 PUBLISHED,定时发布静默失败 |
| P1 | 02-content | PUBLISHED→DRAFT 不触发 indexing delete | 向量库残留旧索引,公开搜索可能命中已下架 stub |
| P1 | 02-content | SEO 字段死路 | `Post` model 有 SEOTitle/Description/Keywords 但 DTO 都没有,Admin 提交丢弃 |
| P1 | 02-content | `tags.post_count` 永远 0 | 触发器只维护 categories,hot-tags 排序失真 |
| P1 | 02-content | `update_post_counts` 不监听 category_id 变化 | 文章迁移分类时新旧分类计数都不更新 |
| P1 | 03-media | PR #647 修复前的隐性"全员失效" | SQL 大小写不匹配让显式授权用户全部静默拒绝(已修) |
| P1 | 04-ai | 限流值彻底硬编码,`site_settings` 配置 UI 无效 | Admin 改限流配置毫无作用 |
| P1 | 04-ai | `ai_client` 错误归一化太粗(全归 502) | 401/429/TLS/连接拒绝事故复盘困难 |
| P1 | 04-ai | `/v1/admin/ai/*` 无 backend 限流 | 被攻陷的 admin 可任意刷 LLM 烧钱 |
| P1 | 04-ai | search 静默降级 | ai-service 挂时无任何用户提示,UI 不展示 Diagnostics |
| P1 | 05-blog | PageTransition 双层挂载冗余 | template + ClientLayout 都挂同名组件,视觉没崩仅因 `shouldAnimate=false` |
| P1 | 05-blog | Codex 字体规范与实际加载漂移 | layout 加载 Inter/Playfair/Noto Serif SC,与规范要求的 Fraunces/Geist 不符 |
| P1 | 05-blog | tag/category 聚合页仍缺位 | 文章卡片 tag 只能展示,不能形成可分享的发现路径 |
| P1 | 06-admin | 4 套独立 SSE 解析无公共层 | 401 续期与跨域分流安全策略不一致 |
| P1 | 06-admin | 3 个死代码 Zustand store 仍在导出 | `useUIStore` / `usePostStore` / `useSettingsStore` 误导性强 |
| P1 | 09-packages | `anchor-positioning` 已撤回,规范文档未同步 | 新人按文档实施会重蹈 fallback 覆盖 h1 的覆辙 |
| P1 | 10-devops | `docker-compose.dev.yml:20` 用 `DB_PASSWORD` 但 .env.example 没有 | 本地 dev compose 需手动 export,start.sh 没自动处理 |
| P1 | 10-devops | trivy-scan 引用的 image-ref 与 build job tag 不一致 | 扫描可能拉不到镜像,静默失败 |
| P1 | 10-devops | `.github/workflows/README.md` 与 `ops/webhook/README.md` 部署模式冲突 | 旧 root 模式 vs 新 hardened 模式,新运维易被误导 |
| P1 | 11-knowledge | `AtlasPage` 根入口仍写 Phase 0 占位 | reader/KP/graph/suggestions 子路由已存在,主页文案会误导功能状态 |
| P1 | 11-knowledge | Atlas AI 是启发式 stub | suggestion inbox 链路可跑通,但不是 LiteLLM 真实抽取 |
| P1 | 11-knowledge | AetherHub 页面当前未发送 `kbIds` | 服务类型和后端支持 KB 过滤,但当前页面仍只传 articleIds/tagSlugs |

### 4.2 跨模块耦合 · 必须同步改的"对子"

| 触发改动 | 必须同步 | 文件锚点 |
| --- | --- | --- |
| 新加 SSE 路由 | nginx `proxy_buffering off` + `proxy_read_timeout 600s` | [10/02-nginx-gateway.md](./10-infrastructure-devops/02-nginx-gateway.md) |
| 新加 dirty migration 状态 | `ops/webhook/deploy.sh::_try_heal_known_dirty` | [08/05-operations.md](./08-database-migrations/05-operations.md) |
| 改 `_build_stream_result_payload` | admin `useStreamResponse.ts` + 三套 SSE 测试 | [07/04-streaming-and-tools.md](./07-ai-service-python/04-streaming-and-tools.md) |
| 改 admin nginx CSP | gateway `nginx.conf:39` CSP | [10/02-nginx-gateway.md](./10-infrastructure-devops/02-nginx-gateway.md)(PR #459 历史事故) |
| 改 `@aetherblog/types/models` | `apps/server-go/internal/models/*.go` | 手工同步,无 OpenAPI |
| 升级 ai-service | server-go 必须先 migrate up | [07/06-deployment-and-config.md](./07-ai-service-python/06-deployment-and-config.md) |
| 改 `posts` 列类型 | `DROP VIEW v_published_posts → ALTER → CREATE OR REPLACE VIEW → 重做 UPDATE` | [08/02-migration-history.md](./08-database-migrations/02-migration-history.md) |
| 轮换 `AI_CREDENTIAL_ENCRYPTION_KEYS` | server-go + ai-service 串行,跑 `--repair-orphans`,移 legacy,设 `AI_LEGACY_KEY_FALLBACK=false` | [10/05-environment-and-config.md](./10-infrastructure-devops/05-environment-and-config.md) |
| 改 KB 上传类型/大小 | Go 上传白名单 + ai-service base64/10MB 校验 + Admin 上传提示一起改 | [11/01-knowledge-base.md](./11-aether-knowledge-atlas/01-knowledge-base.md) |
| 改 Agent chat body | Go `filterBodyKBIDs`、Python `AgentChatRequest.kbIds`、Admin AetherHub request 同步 | [11/04-ai-suggestions-and-recall.md](./11-aether-knowledge-atlas/04-ai-suggestions-and-recall.md) |
| 改 Atlas relation type | Go model/DTO、`packages/types`、migration CHECK、ai-service stub 同步 | [11/03-knowledge-points-relations.md](./11-aether-knowledge-atlas/03-knowledge-points-relations.md) |
| 改全局模型价格 | `ai_global_pricing`、ai-service global_pricing、Admin `/ai-config/pricing`、Go analytics 成本口径同步 | [07/README](./07-ai-service-python/README.md) |

---

## 5 · 阅读路径建议

### 路径 A · 新人 onboarding(2 小时)
1. [本 README](./README.md) §3 全局架构速览
2. [01/README](./01-backend-auth-users/README.md) 看鉴权链路
3. [05/README](./05-frontend-blog/README.md) + [06/README](./06-frontend-admin/README.md) 看前后端分工
4. [11/README](./11-aether-knowledge-atlas/README.md) 看近期新增 KB / Atlas / Knowledge 能力
5. [10/03-startup-scripts.md](./10-infrastructure-devops/03-startup-scripts.md) 学会 `./start.sh --gateway` 启动

### 路径 B · 加新功能(读对应 3 份)
- 后端写新 endpoint → [04/07-middleware.md](./04-backend-ai-search-system/07-middleware.md) + 对应业务模块 README + [08/05-operations.md](./08-database-migrations/05-operations.md)
- 加 UI → [09/01-aether-codex-tokens.md](./09-design-system-shared-packages/01-aether-codex-tokens.md) + [09/02-surfaces-and-typography.md](./09-design-system-shared-packages/02-surfaces-and-typography.md) + 对应前端模块 README
- 接新 AI 供应商 → [07/02-litellm-and-providers.md](./07-ai-service-python/02-litellm-and-providers.md) + [04/01-ai-gateway.md](./04-backend-ai-search-system/01-ai-gateway.md)
- 加知识能力 → [11/README](./11-aether-knowledge-atlas/README.md) + [08/01-schema-overview.md](./08-database-migrations/01-schema-overview.md) + [06/README](./06-frontend-admin/README.md)

### 路径 C · 排查事故
- 服务起不来 → [10/03-startup-scripts.md](./10-infrastructure-devops/03-startup-scripts.md) §健康检查
- migration dirty → [08/05-operations.md](./08-database-migrations/05-operations.md) §dirty self-heal
- AI 调用失败 → [04/01-ai-gateway.md](./04-backend-ai-search-system/01-ai-gateway.md) §错误归一化坑 + [07/04-streaming-and-tools.md](./07-ai-service-python/04-streaming-and-tools.md) §首字节重试
- 搜索结果异常 → [04/03-search.md](./04-backend-ai-search-system/03-search.md) §Diagnostics + [05/04-discovery-and-search.md](./05-frontend-blog/04-discovery-and-search.md)

### 路径 D · 安全审计
- 直接读 §4.1 P0/P1 表
- 重点章节:[01/03-rbac-permissions.md](./01-backend-auth-users/03-rbac-permissions.md) / [03/02-folders-and-permissions.md](./03-backend-media-storage/02-folders-and-permissions.md) / [04/07-middleware.md](./04-backend-ai-search-system/07-middleware.md) / [10/04-ci-cd.md](./10-infrastructure-devops/04-ci-cd.md)

---

## 6 · 沉淀方法论

本目录最初由"10 个并行子代理 + 主代理协调"的工作流产出;2026-05-29 的纠偏轮次追加 4 个定向子代理审计 KB/Atlas、AI/search、Admin/blog、migration/ops 四个面:
1. **主代理** 完成项目侦察,搭建目录骨架,初始化 CHANGELOG。
2. **10 个并行子代理** 各自负责一个一级模块,深度阅读源码后写出该模块的 `README.md`(总体设计) + 4-9 份能力设计文档,并回报本模块 1-3 条非显然发现 + 跨模块溢出建议。
3. **主代理** 收齐 10 份回报后,把每条都摘要到 [CHANGELOG.md](./CHANGELOG.md) 的 Iteration 1.0X 段,最后写本顶层 README 完成横向矩阵聚合。
4. **纠偏轮次** 以当前源码为事实源,新增 11 模块并修正旧入口文档中最容易误导开发的基线、路由、搜索、AI service、migration 口径。

每份文档独立可读;遇到跨模块议题在 §4.2 表里追溯到对子。

---

## 7 · 后续维护建议

- 任何 PR 涉及"§4.2 必须同步改的对子"时,在 PR 描述里勾选触发条目并附上 docs/output/* 锚点。
- 新增能力后:
  - 更新对应模块的 `README.md`(总体设计)+ 新建或更新 `0X-*.md`(能力设计)。
  - 在 [CHANGELOG.md](./CHANGELOG.md) 追加 `Iteration 2.x` 段,记录变更摘要。
- 每季度跑一次"P0/P1 清单巡检",把已修复条目划掉,新增条目入表。
- 新增大模块时(11+),遵循同样的四层结构 + CHANGELOG 摘要纪律。
