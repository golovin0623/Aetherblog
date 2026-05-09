# AetherBlog · 技术摸底沉淀 · 迭代变更日志

> 本文件以摘要形式记录 `docs/output/` 中每一次文档沉淀的迭代变更。每条记录包含:**触发事件 · 影响范围 · 文档增量 · 关键发现**。
>
> 版本基线:2026-05-08 / branch `claude/sad-gould-35d3a6` / migrations 至 000046 / 26 个后端 handler / Aether Codex Round 5。

---

## 目录结构约定

```
docs/output/
├── CHANGELOG.md                              # 本文件 — 迭代变更摘要
├── README.md                                 # 顶层索引 + 全局架构概览
├── 01-backend-auth-users/                    # 后端 · 鉴权与用户
├── 02-backend-content/                       # 后端 · 内容(文章/标签/分类/评论)
├── 03-backend-media-storage/                 # 后端 · 媒体与存储
├── 04-backend-ai-search-system/              # 后端 · AI/搜索/系统监控等
├── 05-frontend-blog/                         # 前端 · 博客(Next.js 15)
├── 06-frontend-admin/                        # 前端 · 后台(Vite + React 19)
├── 07-ai-service-python/                     # AI 服务(FastAPI + LiteLLM)
├── 08-database-migrations/                   # 数据库 schema + migrations
├── 09-design-system-shared-packages/         # 设计系统 + 共享 packages
└── 10-infrastructure-devops/                 # 基础设施 / DevOps
```

每个模块目录:
- `README.md` —— **总体设计**(模块边界 / 架构图 / 子模块清单 / 横向依赖 / 关键决策)
- `0X-*.md` —— **能力设计**(单个能力的责任 / 入口 / 数据流 / 配置 / 已知限制)

---

## 迭代记录

### Iteration 0 · 2026-05-08 · 骨架初始化

**触发事件:** 用户要求对项目完成态进行系统化的技术摸底与文档沉淀。

**影响范围:** `docs/output/` 整树。

**文档增量:**
- 创建 10 个一级模块目录(01–10)。
- 写入 `CHANGELOG.md`(本文件)与 `README.md`(顶层索引,Iteration 1 后填充正文)。
- 暂未进入正文写作。

**关键发现:**
- 后端 handler 文件 31 个(含 testutil 与 4 个 *_test.go);service 31 个(含 7 个 *_test.go);repo 21 个;model 14 个;middleware 6 个;migration 至 000046。
- AI 服务为独立 Python 进程,目录 `apps/ai-service/`,内含 `app/` `tests/` `scripts/` + `Dockerfile`。
- 前端两端架构:`apps/blog`(Next.js 15 / RSC)、`apps/admin`(Vite + React 19),后台已枚举 11 个 `*Page.tsx` + 10 个二级页面目录。
- 共享包 5 个:`packages/{ui,hooks,types,utils,editor}`,设计系统 8 份规范文档于 `.claude/design-system/`。

**下一步:** Wave 1 — 并行 10 个子代理,各自深耕一个模块完成总体设计 + 能力设计沉淀。

---

### Iteration 1.01 · 2026-05-09 · 后端 · 鉴权与用户(模块 01 完成)

**触发事件:** 子代理 #1 完成 `docs/output/01-backend-auth-users/` 的全部沉淀。

**影响范围:** 模块 01 共 6 个文档,合计 ~1735 行。

**文档增量:**
- `README.md`(291 行) —— 模块定位 / ASCII 架构图 / 7 条关键决策记录(JWT 密钥 DB 化 / RT SHA-256 哈希 / 强制改密 middleware 拦截 / 不引入 sessions 表 / Cookie 路径分离 / ABAC+RBAC 混合 / 密码复杂度后端强制)/ P1-P3 已知问题 / 5 个扩展点。
- `01-jwt-and-sessions.md`(311 行) —— Access/Refresh Token 全链路 / `jwt_secrets` 表 5 状态机 / `jwtkeys.Store` 双 key / Redis key 命名约定。
- `02-user-management.md`(322 行) —— `users` 表 / 注册-改密-改资料-改头像数据流 / 默认 admin 兜底 / 应急 SQL。
- `03-rbac-permissions.md`(329 行) —— RBAC + Ownership + ABAC 三层防御 / `folder_permissions` 五级权限 / VULN-038 / VULN-IDOR 防御链。
- `04-totp-2fa.md`(205 行) —— 明确"**未实现**" + grep 取证 + 最小可用 MFA 实施 checklist。
- `05-auth-middleware.md`(277 行) —— Echo middleware 顺序约束 / context 注入 / 受保护路由 4 级分级清单。

**关键发现(非显然):**
1. **JWT Rotator 缺 leader election(P1)** —— `jwtkeys/store.go:6-9` 注释承认"推荐 pg_try_advisory_lock 或单副本部署",但代码实际未实现 advisory lock。当前靠 docker-compose 单副本兜底,K8s 多副本会触发轮换冲突。
2. **AUTHOR 角色完全无效(P1)** —— DB CHECK 允许 `ADMIN/AUTHOR/USER`,但全后端没有任何 `RequireRole("AUTHOR")` 调用,管理路由一刀切 `RequireRole("admin")`。AUTHOR 是名义存在、代码上"死"的角色。
3. **强制改密 + JWT mcp claim 两阶段闭环巧妙** —— 不在登录服务层拒绝种子默认密码,改在 middleware 层把 token 关进 `/me + /change-password + /refresh + /logout` 四端点小笼子。`AuthService.CheckUserCanLogin` 仅对**完全等于种子哈希**的 admin 直接拒绝,既避免"无法拿 JWT 调改密"的死锁,又堵住公开默认凭据接管 —— 此 pattern 可复用为未来 MFA。

**跨模块溢出建议:**
- Refresh Token 全 Redis 无持久化 → 影响运维备份(归 **10-infrastructure-devops**)。
- 媒体上传时 `PermissionRepo.HasWriteAccess` 与 owner / 系统文件夹兜底叠加规则 → 归 **03-backend-media-storage** 详述。
- 后台 UI 上"轮换 JWT 密钥"按钮 / 首次登录强制改密对话框 → 归 **06-frontend-admin**。
- `pkg/cryptkey/fernet.go`(provider 凭据加密)与本模块共用 `cfg` 但作用域为媒体 → 归 **03-backend-media-storage**。
- `activity_events` 表 schema 与 admin 列表 API → 归 **04-backend-ai-search-system**。

---

### Iteration 1.02 · 2026-05-09 · 后端 · 内容(模块 02 完成)

**触发事件:** 子代理 #2 完成 `docs/output/02-backend-content/`。

**影响范围:** 模块 02 共 7 个文档,合计 ~1657 行。

**文档增量:**
- `README.md`(255 行) —— 模块定位 / 文章状态机图 / 子模块清单 / 横向依赖 / 关键决策 / 表全景 / 已知问题 / 扩展点。
- `01-posts.md`(283 行) —— CRUD / 状态机 / 密码保护 / SEO / AI 索引触发 / `parent_text`。
- `02-tags.md`(204 行) —— 标签 CRUD / migration 040 existing-aware prompt。
- `03-categories.md`(208 行) —— 分类树 / `sort_order` / `post_count` 触发器。
- `04-comments.md`(311 行) —— 5 状态审核流 / 嵌套树 / XSS / VULN-043。
- `05-share-and-archive.md`(200 行) —— 归档实现 + 文章分享"未实现"事实声明。
- `06-versioning.md`(196 行) —— 媒体版本备查 + 文章版本"未实现"事实声明。

**关键发现(怪味):**
1. **`SCHEDULED` 状态半实现** —— schema/字段/DTO 都允许未来时间 `publishedAt`,但**没有任何 worker/cron 把 SCHEDULED 推进到 PUBLISHED**。`Publish(id)` 只是即时切换。前端"定时发布"按钮上会沉默失败。
2. **PUBLISHED→DRAFT 不触发 indexing delete** —— `Update`/`UpdateProperties` 仅在 `Status == 'PUBLISHED'` 时调 `triggerIndexing("upsert")`,反向不清理。已发布改回草稿后向量库残留旧索引,公开搜索可能命中已下架 stub。
3. **SEO 字段是死路** —— `Post` model 有 `SEOTitle/Description/Keywords`,但 `CreatePostRequest` 与 `UpdatePostPropertiesRequest` **均无这三个字段**,只有 VanBlog 迁移路径能写入。Admin 即便有 SEO 面板,提交也会被丢弃。
4. **`tags.post_count` 是 stale 列** —— 触发器只维护 `categories.post_count`,tags 永远 0,hot-tags 排序失真。
5. **`update_post_counts` 不监听 category_id 变化** —— 文章迁移分类时,旧分类 post_count 不减、新分类不增。
6. **`is_admin` 评论永远 false** —— Submit 写死 false,登录管理员评论也不会被标记。

**跨模块溢出:**
- `/admin/media/shares/*` 和 `/admin/media/{versions}` 属于媒体模块(已在 02 标注为"对照")。
- 媒体侧 phantom 版本号怪味(`Restore` 第 2 步生成 `maxVer+2` 但不写实体行) —— 提示媒体模块复核。
- AI 索引细节(`/admin/search/index` 端点、`post_embeddings.parent_text`)归 AI/搜索模块。
- `v_published_posts` 视图存在但代码不用 —— schema 遗留清理项。

---

### Iteration 1.03 · 2026-05-09 · 后端 · 媒体与存储(模块 03 完成)

**触发事件:** 子代理 #3 完成 `docs/output/03-backend-media-storage/`。

**影响范围:** 模块 03 共 7 个文档,合计 ~2162 行(本批最厚,因 storage_providers 一份 427 行)。

**文档增量:**
- `README.md`(267 行) —— 模块定位 / 9 个子模块清单 / 架构图 / 5 条关键决策(Provider 抽象 / Folder 双层权限 / Sync DB-only 队列 / Provider 三层防御 / 缩略图策略) / 8 张表关系图 / 7 条 migration 演进 / 7 条已知问题 / 6 个扩展点。
- `01-upload-pipeline.md`(321 行) —— 三层 SVG 防御 / 4 步 MIME 校验链 / `resolveStore` / key 格式 / 远程缩略图异步 / `UpdateContent` 边界。
- `02-folders-and-permissions.md`(277 行) —— folder 物化路径 + `folder_permissions` 5 级权限 + `assertFolderWritable` 7 步短路 + PR #647 P1/P2 修复故事。
- `03-storage-providers.md`(427 行) —— 6 厂商矩阵 / `mergeProviderConfigJSON` 全规则 + 13 测试用例 / cryptkey Fernet 落库 / 列表脱敏 / SSRF 防御 / Phase 5 反向导入。
- `04-media-tags-and-search.md`(235 行) —— `media_file_tags` + `usage_count` / source 三态 / slug 中英差异 / **测试覆盖率 0**。
- `05-sync-jobs.md`(380 行) —— Phase 4 worker 状态机 / FOR UPDATE SKIP LOCKED / 重启自愈 / EnqueueAll / EnqueueOne / Retry / 双状态(`jobs.status` + `media.sync_status`)。
- `06-media-share.md`(255 行) —— bcrypt + 32B token + RFC3339 过期 / VULN-037 / VULN-044 / **指出 `/share/:token` 公共端点完全缺失**。

**关键发现(非显然):**
1. **PR #647 P1 是隐性"全员失效"** —— `permission_repo.go` 早期 SQL 用 `permission_level IN ('write','admin')` 小写,但 migration 000011 的 CHECK 规定大写 `UPLOAD/EDIT/DELETE/ADMIN`,导致显式授权的所有用户**全部静默拒绝**,只有 owner 能上传。owner 自查 OK 不易察觉,直到团队协作才暴露。
2. **Provider 抽象是"折衷型 5 合 1"** —— `factory.go` 不区分 S3/MINIO/COS/OSS/R2,共用一份 `S3Storage`,只在 `applyProviderDefaults` 补默认 region/endpoint,并用 `isTrustedProviderEndpoint` 白名单跳过 SSRF DNS 校验。代价:七牛/又拍这种纯私有协议接不进来,且无法表达厂商专属能力(预签 URL / 内网加速)。
3. **Sync 一致性靠"`target_provider_id` 入队即落定"** —— 批次 2 原规划"切默认 provider 时锁定 in-flight target"调研后撤销。worker 始终读入队时写定的字段,admin 在 worker 处理途中切 default **不污染当前批次,但有"漂移期"**:`media_files.backup_url` 永远是上一次成功的旧目标 URL,直到下一次同步完成才更新。

**跨模块溢出:**
- `/share/:token` 公共端点缺失 → 跨前后端规划(归 **05-frontend-blog** 或公共路由文档)。
- `post.cover_image` 弱关联("删除 media 不清 post.cover_image" broken-link 风险) → 模块 **02** 应交叉记。
- `AI_CREDENTIAL_ENCRYPTION_KEYS` 命名以 `AI_` 开头但 storage_providers 共用同一 keystore → **07-ai-service-python** / **08-database-migrations** 需交叉提示。
- 本模块 README §6 已列 8 张表 schema 演进,后续应以 **08-database-migrations** 为事实唯一来源,做去重/互引。

---

### Iteration 1.04 · 2026-05-09 · 数据库与迁移(模块 08 完成)

**触发事件:** 子代理 #8 完成 `docs/output/08-database-migrations/`。

**影响范围:** 模块 08 共 6 个文档,合计 ~2513 行(本批因 02/04 两份历史 SQL 链路最厚)。

**文档增量:**
- `README.md`(246 行) —— 技术栈 / 7 主题分组 / ER 视图 ASCII / 索引策略概览 / 扩展决策 / 已知问题 / 扩展点 / 与其他模块对接面。
- `01-schema-overview.md`(432 行) —— 全表清单 9 节分组(用户鉴权 / 内容 / 评论 / 媒体 / AI 模型 / AI 检索 / 统计审计 / 配置 / 工具视图);字段 / CHECK / 索引 / Go model 引用全列。
- `02-migration-history.md`(490 行) —— 46 条 migration 按 9 主题(用户鉴权 / 内容 + VanBlog / AI 模型 / 媒体 / Prompt 演进 / 检索蓝绿协议 / 搜索配置 / 安全审计 / 自愈机制) + "演进观察"总结。
- `03-extensions-and-indexes.md`(343 行) —— pgvector 0.7+ 类型与算子族 / partial HNSW / tsvector simple / GIN / 部分唯一索引 / DESC 复合索引 / 反范式缓存列 / 18 张表全索引清单。
- `04-data-flows.md`(543 行) —— 9 大 SQL 链路:文章发布+embedding / 关键词+语义双通路 / RAG QA / 媒体上传+folder 权限+sync worker / activity 审计 / AI 埋点归档 / 蓝绿换模型与 profile / JWT 轮换 / VanBlog 导入。
- `05-operations.md`(459 行) —— migrate 工具命令 / 部署期 dirty self-heal recipe(v34→force 35,v38→force 38) / 事故恢复 / 已知不可逆 migration 表 / 备份回滚 / 新增 migration 标准流程 / 故障速查 / Runbook。

**关键发现(非显然):**
1. **`v_published_posts` 视图是隐藏的"列类型修改地雷"** —— `SELECT p.*` 让 PG 拒绝任何 `posts` 列类型 ALTER。000038 的 `summary` 加宽因此整事务回滚,连带 7 条 prompt 重写丢失;000039 必须 `DROP VIEW → ALTER → CREATE OR REPLACE VIEW → 重做 UPDATE`。后续修改 posts 列类型必须沿用此模式。
2. **partial UNIQUE 索引被反复用作"至多 1 行某状态"语义机** —— `jwt_secrets` 的 current/previous;`search_profiles.uq_search_profiles_one_active ON ((1)) WHERE status='active'`。把状态机不变量推到 PG 层,事务 INSERT 冲突即语义错,比 trigger / 应用层校验更不可绕。
3. **多条 dirty 修复 migration 共生设计** —— 000035 + 000036 + `deploy.sh::_try_heal_known_dirty` 三者捆绑。035 单独无效(被 v34 dirty 卡死),036 与 035 语义等价但放新版本号专门让"force 35 后能跳过" —— migration 不可变 × 生产实际 dirty 之间的妥协。

**跨模块溢出:**
- model 中 JSONB 列(`AITaskType.config_schema`、`ActivityEvent.metadata`)被有意从 sqlx 扫描排除,业务侧走 raw query → server-go 文档应交叉提示。
- ai-service Python 必须按 dim cast `::vector(1536)` 或 `::halfvec(3072)` 才走 partial HNSW → **07-ai-service-python** 应记录。
- admin SearchConfigPage 消费 `site_settings.search.*`,reindex SSE 端点走蓝绿协议 → **06-frontend-admin** 应交叉。
- `ops/webhook/deploy.sh` dirty self-heal 表硬编码,新增条目必须同步 deploy.sh + 本模块 02 §9 / 05 §2.3 → **10-infrastructure-devops** 应交叉。
- CI 不跑 `migrate up`(无测试 DB),只编译 `cmd/migrate` → **10-infrastructure-devops** CI 章应记录。

---

### Iteration 1.05 · 2026-05-09 · 前端 · 博客 Next.js(模块 05 完成)

**触发事件:** 子代理 #5 完成 `docs/output/05-frontend-blog/`。

**影响范围:** 模块 05 共 8 个文档,合计 ~2400 行(02-pages-tour 最厚 428 行)。

**文档增量:**
- `README.md` —— 模块定位 / 路由树 / 渲染策略矩阵 / 数据获取链路 / Aether Codex 落地总览 / 关键决策 / 已知问题 / 扩展点。
- `01-routing-and-layout.md` —— layout / template / providers / ClientLayout / PageTransition 三层壳协作 + FOUC 双件套。
- `02-pages-tour.md`(428 行) —— 9 条公开路由 + Agent 三页(login/landing/workspace)逐页职责与契约。
- `03-content-rendering.md` —— MarkdownRenderer 完整管线(remark / rehype / Shiki / KaTeX / Mermaid / sanitize / headingId)。
- `04-discovery-and-search.md` —— SearchPanel 4 模式 + TimelineTree + tag/category 缺位分析。
- `05-design-implementation.md` —— Codex token / surface / 字体 / motion / 签名时刻在 blog 的落地与妥协。
- `06-data-fetching-and-caching.md` —— services.ts 端点矩阵 + ISR 表 + React Query 配置 + metadata 生成。
- `07-app-shell-and-perf.md` —— next.config / PWA / 字体 / 骨架屏 / iOS WKWebView 适配 / 安全 headers。

**关键发现(非显然):**
1. **PageTransition 双层挂载冗余** —— `apps/blog/app/template.tsx:9` 与 `apps/blog/app/components/ClientLayout.tsx:54` 各挂一次同名组件。template 因路由变化必然 remount,ClientLayout 那一层实际等价于"被框架重建的子树",视觉没崩是因为多数情况 `shouldAnimate=false`。建议只保留 template 层。
2. **Codex 字体规范与实际加载漂移** —— 设计规范要求 Display=Fraunces / Sans=Geist / Mono=Geist Mono,但 `apps/blog/app/layout.tsx:27-29` 实际加载 Inter / Playfair Display / Noto Serif SC,`tailwind.config.ts:49` mono 写死 'JetBrains Mono'。fallback 链让 `.font-display` 仍能渲染,但 Fraunces variable 三轴变形(SOFT/WONK/opsz)无法呈现。属历史落地早于规范升级的妥协。
3. **`>` / `/` 搜索前缀 UI 已铺、backend 未配套** —— `SearchPanel.tsx:36` 解析了 4 模式 + 渲染了 cmd-chip 提示,但 `performSearch:259` 始终发 `mode=hybrid`,tag/command 模式与 default 等价。是误导用户的预留钩子。整个发现层还缺 `/tags/[slug]` 路由,tag chip 不可点。

**跨模块溢出:**
- `/api/v1/public/search/qa` SSE 事件契约(delta/sources/done/error)与 `/search/features` 探测端点 → **04-backend-ai-search-system** 应明确。
- Agent SSE 协议(`/api/v1/agent/chat` 5 类事件) → **04-backend** + **07-ai-service-python** 应交叉记录。
- `archives` 端点存废决策 → 后端是否仍维护需在 **04** 或 **08** 表态。
- `@aetherblog/ui` 已导出 `{spring, transition, variants}` 但 blog 多数组件仍 inline 写 bezier/spring 数值 → **09-design-system-shared-packages** 应记规范落差。
- nginx 网关 `/`→blog / `/api/`→backend / `/api/v1/ai/`→ai-service 与 Next.js `Cache-Control: no-cache` 的相互作用 → **10-infrastructure-devops** 应配套描述。

---

### Iteration 1.06 · 2026-05-09 · 基础设施 · DevOps(模块 10 完成)

**触发事件:** 子代理 #10 完成 `docs/output/10-infrastructure-devops/`。

**影响范围:** 模块 10 共 7 个文档,合计 ~2603 行(04-ci-cd 最厚 532 行)。

**文档增量:**
- `README.md`(238 行) —— 全景 ASCII / 本地 vs 生产拓扑 / 端口分布 / 网关入口 / 关键决策 / 扩展点 / 关键文件索引。
- `01-docker.md`(301 行) —— 三 compose 差异 / 4 个 Dockerfile 多阶段构建 / 加固模板 / 健康检查 / 镜像缓存策略。
- `02-nginx-gateway.md`(329 行) —— 路由表 / SSE 透传配方 / 限流 / CSP / HSTS map / `add_header` 不继承坑。
- `03-startup-scripts.md`(479 行) —— `start.sh` 主流程 / `bootstrap_env` 内幕 / 健康检查 / stop.sh 与 restart.sh 差异 / 移动端调试。
- `04-ci-cd.md`(532 行) —— GitHub Actions job 拓扑 / HMAC webhook / deploy.sh 五段式 / preflight / 安全防御汇总。
- `05-environment-and-config.md`(333 行) —— `.env.example` 全字段 / 各 app `.env.local` / 密钥轮换 SOP / 多环境差异。
- `06-ops-and-monitoring.md`(391 行) —— ops/ 结构 / 容器监控代理 / 日志聚合 / 备份机制 / `post_release_observer.sh` / 防火墙建议。

**关键发现(非显然):**
1. **`docker-compose.dev.yml:20` 用 `${DB_PASSWORD:?...}` 而非 `${POSTGRES_PASSWORD:?...}`** —— VULN-118 修复时引入字段名不一致,`.env.example` 没有 `DB_PASSWORD` 字段。本地 `--gateway` 起 dev compose 需要手动 `export DB_PASSWORD`,`start.sh` 没自动处理。文档/实现脱节,容易踩坑。
2. **trivy-scan 引用的镜像 tag 与 build job 推送的 tag 不一致** —— `ci-cd.yml:173` 用 `image-ref: ...:${github.sha}`,但 build job 推的是 `branch-{sha}` 形式 → trivy 实际可能拉不到镜像导致扫描静默失败。
3. **`.github/workflows/README.md` + `CICD_GUIDE.md` 与 `ops/webhook/README.md` 描述的部署模式严重冲突** —— 前者还在讲 `/root/Aetherblog/webhook` 软链 + 内联 `WEBHOOK_SECRET` 旧 root 模式,后者已切到 `User=webhook` + `/var/lib/aetherblog/webhook` hardened 模式。新运维会被旧文档误导。
4. **`docker-hub-cleanup.sh:10` REPOSITORIES 缺 `aetherblog-ai-service`** —— 跑清理会留 ai-service 镜像;`docker-build.sh:33` 默认 `REGISTRY=golovin0623` 硬编码,fork 用户必须改源码或传 env。

**跨模块溢出:**
- `/api/v1/agent` SSE 路径在 nginx 配 600s read timeout,后端新加 SSE 路由需同步更新 nginx → **04-backend** 应交叉。
- `deploy.sh::_try_heal_known_dirty` 表硬编码,新 dirty 状态需更新该表 → **08-database-migrations** 已交叉。
- AI Provider 凭证 Fernet 复用 `AI_CREDENTIAL_ENCRYPTION_KEYS`,该密钥也加密对象存储 `secretAccessKey`;轮换需串行 `--repair-orphans` + 移除 legacy + 设 `AI_LEGACY_KEY_FALLBACK=false` → 跨 **03-media-storage** + **07-ai-service-python** 联动。
- `apps/admin/nginx.conf:26` 与 gateway `nginx.conf:39` 的 CSP **必须同步**(PR #459 历史事故漏同步导致字体被拦) → **06-frontend-admin** 应记。

---

### Iteration 1.07 · 2026-05-09 · AI 服务 Python(模块 07 完成)

**触发事件:** 子代理 #7 完成 `docs/output/07-ai-service-python/`。

**影响范围:** 模块 07 共 7 个文档,合计 ~2616 行(04-streaming-and-tools 最厚 497 行)。

**文档增量:**
- `README.md`(191 行) —— 服务定位 / 与 server-go 协议 / 进程拓扑 / 关键决策 / 扩展点。
- `01-architecture.md`(322 行) —— 目录分层 / `main.py` lifespan(JWT key refresher / Redis preflight / 核心服务预热)/ 中间件链 / 全局异常处理 / 依赖注入 / 19+ 端点全景。
- `02-litellm-and-providers.md`(388 行) —— LiteLLM 单点接入 / 模型路由四层优先级 / provider 矩阵 / SSRF 守卫 / temperature 锁(GPT-5/o1/o3 家族) / fallback ↔ override 互斥 / price 双轨。
- `03-prompts-and-workflows.md`(426 行) —— task type / routing 数据模型 / `_build_messages` 三层降级 / migration 000038/000040 演进 / `existing_tags` 结构化解析 / prompt 注入防御(`<user_content>` 容器)。
- `04-streaming-and-tools.md`(497 行) —— SSE 帧契约 / `_stream_with_think_detection` 通用包装 / 首字节前透明重试 / think-block guard 算法 / 错误归一化 / agent / RAG QA / profile reindex 三套 SSE 协议 / tool calling 当前未启用。
- `05-tests-and-quality.md`(302 行) —— 26 个 test 文件矩阵 / 80% 覆盖门 / `support.py` FakePool/FakeConn / 各 service mock 模式 / 已知盲点。
- `06-deployment-and-config.md`(490 行) —— Dockerfile / docker-compose.prod / 环境变量矩阵(必填/安全/调优/env_fallback/Redis 三段式) / 健康检查 / 凭证轮换剧本 / 日志事件目录 / 跨模块运维提醒。

**关键发现(非显然):**
1. **provider 抽象的折衷:故意没造 provider 类** —— `from litellm import acompletion, aembedding` 是整个项目唯一一处 LLM SDK import(`app/services/llm_router.py:22`)。`_prefix_model_for_litellm` 用模型名前缀路由 —— OpenAI / Anthropic / 国产中转(智谱 / DeepSeek / 通义 / 月之暗面 / 火山方舟)**全部走 `api_type="openai_compat"` 单条代码路径**,只有 `RemoteModelFetcher` 的 `/v1/models` 拉清单需要 OpenAI / Anthropic 二选一。"少抽象 = 少维护"是显著工程取舍。
2. **prompt 演进有三层防线,但只有 migration 是真正生效那层** —— 代码里 `_TASK_FALLBACK_SYSTEM_PROMPT`(`llm_router.py:70-105`)是兜底硬编码,实际生效要靠 migration 000038 + 000040。关键是 `_parse_tags_structured`(`ai.py:196-326`)做了**四层降级**(严格 JSON / fenced JSON / 最外层 `{...}` 子串 / 旧扁平数组分桶) —— 这是允许"prompt 严格化"与"老中转模型不支持 JSON mode"共存的关键。
3. **流式可靠性的两个非显然机制** —— ① `_stream_with_think_detection` 在**首字节前**有 1 次 600ms 透明重试(覆盖冷启动 LiteLLM / TLS 抖动 / DB pool 第一次拿连接的 200ms 抖动 —— "第一次点 AI 工具失败、第二次成功"的根因);② think-block 检测维护 `guard = len("</reasoning>") + 4` 字节尾窗,不让 `<think>` 标签横跨 chunk 边界被误识别。流式 `result` 事件 payload **完全对齐**对应非流式端点的 `*Data` schema,前端 `useStreamResponse` 不需要分辨流/同步两套契约。

**跨模块溢出:**
- migration 与 ai-service 必须同步发版,server-go 先 migrate 完才能升 ai-service → **08-database-migrations** + **10-infrastructure-devops** 应交叉。
- JWT_SECRET / AI_INTERNAL_SERVICE_TOKEN / AI_CREDENTIAL_ENCRYPTION_KEYS 是跨进程共享 secret;凭证 key **必须独立**于 JWT_SECRET(VULN-056) → **05-environment** 应交叉。
- agent 路径下 server-go 给所有用户注入 `X-Internal-Service`,ai-service 单侧无法区分 admin/普通,所以 agent **完全禁用 modelId override**(VULN PR #614) → **04-backend-ai-search-system** 应交叉。
- CORS 故意不放 `X-Internal-Service`,即便 origin 扩张浏览器也无法触发内部 endpoint —— 与 server-go 的内部 token 校验是**两道独立防线**,不能合并 → **02-nginx-gateway** 应记。
- 共享日志卷 `aetherblog_logs` 的 UID/GID 必须 1001(与 server-go 一致),`SecretRedactor` 在写入前清洗 → **10-infrastructure-devops** 应记。
- `_build_stream_result_payload` 改动须同步 admin `useStreamResponse.ts` + 三套 SSE 测试 → **06-frontend-admin** 应记契约。

---

### Iteration 1.08 · 2026-05-09 · 后端 · AI/搜索/系统(模块 04 完成)

**触发事件:** 子代理 #4 完成 `docs/output/04-backend-ai-search-system/`。

**影响范围:** 模块 04 共 8 个文档,合计 ~2405 行(06-misc-handlers 最厚 347 行)。

**文档增量:**
- `README.md`(209 行) —— 模块定位 / 子能力清单 / 架构图 / 限流棋盘 / 横向依赖 / 6 条已知问题 / 7 条扩展点。
- `01-ai-gateway.md`(265 行) —— `ai_handler` 13 端点 + `ai_client` 双 client + provider 通配代理 + SSE 白名单。
- `02-agent-and-jobs.md`(261 行) —— `/v1/agent/*` 4 端点 + 跨 search_handler 的「长任务三件套 + cancel + lastBatch」并发模型。
- `03-search.md`(322 行) —— 关键词 + 语义 + RRF + search_profiles 蓝绿切换 + migration 041/044。
- `04-analytics-and-stats.md`(340 行) —— Dashboard 软失败聚合 + `buildPricedLogsCTE` 350 行 SQL + activity_events 审计表。
- `05-system-monitor.md`(320 行) —— 15 端点 + 平台特化采集 + 24h 内存窗口 + Docker socket 安全。
- `06-misc-handlers.md`(347 行) —— friend_link / site_setting / site / visitor / migration / version / log_level。
- `07-middleware.md`(341 行) —— Recovery / Trace / CORS / RateLimit Lua 脚本 + 限流棋盘。

**关键发现(非显然):**
1. **限流值彻底硬编码、`site_settings` 未生效** —— `server.go:273-279` 把搜索 30/min、QA 5/min 写死在中间件注册时;DB 里 `search.anon_search_rate_per_min` 与 `search.anon_qa_rate_per_min` 配置项**完全无效**,管理员 UI 改它毫无作用。原因:限流中间件在启动期注册,此时 DB 还没读。
2. **`ai_client` 错误归一化太粗** —— `service/ai_client.go:79-114` 只分三档(canceled→499 / timeout→504 / 其他→502)。供应商 401(key 失效)、429(供应商限流)、TLS 握手失败、连接拒绝、读响应中断全归到 502 + "AI 服务不可用"。出问题只能翻 Python 日志。
3. **search 静默降级到关键词,用户无感知** —— `SearchService.Search` 在 hybrid 模式下,若 ai-service 挂 / `aiClient==nil` / `active_embedding_model` 未设,`semErr` 仅 `log.Warn` 后降级到 keyword-only。前端 UI 看不到任何提示。`Diagnostics` 端点能解释但前端没强制展示。
4. **奖励发现:`/v1/admin/ai/*` 端点没有任何 backend 侧限流** —— 只靠 `RequireRole("admin")`,被攻陷的 admin 账号可任意刷 LLM 烧钱,backend 不限制。

**跨模块溢出:**
- JWT 双 key 校验 + `RequirePasswordRotated` + `AssertOwnership` 是本模块所有 admin 端点的前置 → 与 **01-backend-auth-users** 已交叉。
- `postRepo.SearchPublished` **未过滤 `password IS NOT NULL`** —— public search 存在密码保护文章 title 泄露风险 → **02-backend-content** 需补 SQL 过滤。
- 所有 LLM 调用、search_profile reindex SSE、prompt CRUD 真实落库都在 Python 侧;两侧 `INTERNAL_SERVICE_TOKEN` 必须严格一致且 ≥32 字符 → **07-ai-service-python** 已交叉。
- 046 (`activity_event_category_security`)、041 (`search_profiles`)、044 (`parent_text`) 与本模块强耦合 → **08-database-migrations** 应单独标注。
- nginx 必须正确设 `X-Real-IP` / `X-Forwarded-For`(限流维度依赖此),`/api/v1/ai/` location 必须 `proxy_buffering off` + `proxy_read_timeout 600s` → **10-infrastructure-devops** 已交叉。

---

### Iteration 1.09 · 2026-05-09 · 设计系统 · 共享包(模块 09 完成)

**触发事件:** 子代理 #9 完成 `docs/output/09-design-system-shared-packages/`。

**影响范围:** 模块 09 共 9 个文档,合计 ~5128 行(本批最厚,因含全 token / 全组件 / legacy 演进史)。

**文档增量:**
- `README.md`(320 行) —— 设计系统演进史 / 六硬规则速览 / packages 全景 / 横向依赖图 / 关键决策。
- `01-aether-codex-tokens.md`(565 行) —— `--ink / --bg / --aurora / --signal / --fs / --space` 命名空间 + OKLCH 派生 + light/dark 切换。
- `02-surfaces-and-typography.md`(744 行) —— surface 四层 + 字体角色 + 编辑级排印工具类。
- `03-motion-system.md`(600 行) —— `motion.ts` 全部导出 + `[data-interactive]` aurora 几何方案。
- `04-package-ui.md`(644 行) —— 17 组件清单 + Button/Card 已知偏差对照表。
- `05-package-hooks.md`(442 行) —— 19 个 Hook + ThemeProvider 圆形动画 + RSC 友好的 themeConstants。
- `06-package-types-and-utils.md`(630 行) —— 共享类型 + utils 入口冲突剖析。
- `07-package-editor.md`(694 行) —— CodeMirror + Bear WYSIWYG + Codex token 整合。
- `08-legacy-and-migration.md`(489 行) —— legacy 全集 + `deprecations.json` 8 条规则 + sunset 倒计时。

**关键发现(非显然):**
1. **`packages/utils` 入口冲突(P1)** —— `format.ts` 与 `format/` 目录、`helpers.ts` 与 `helpers/` 目录并存,Node ESM resolution 优先选单文件,导致 `formatDuration / formatCurrency / truncate / deepClone / retry / uuid / nanoid` 等**全部不能从 `@aetherblog/utils` 直接 import**(但目录里的实现并不少)。需要修 `packages/utils/src/index.ts`。
2. **`packages/ui` 自身的 P0 红线** —— Button.tsx / Card.tsx / Toast.tsx / ConfirmModal.tsx / Badge / Tag / Toggle / Skeleton / Input / Textarea **全都还在用 legacy token + `dark:` 变体 + Tailwind 直接色**。所有 Primitive 都是规范偏差源头,是 Codex 落地最大卡点。
3. **`anchor-positioning` 已撤回但规范 `02-surfaces.md` / `06-signature-moments.md` 还在描述它** —— `typography.css:128-141` 注释明说撤回(Chrome/Safari 某些视口下 fallback 把 marginalia 推到文章内覆盖 h1),但设计文档没同步,新人按文档实施会重蹈覆辙。

**跨模块溢出:**
- `apps/blog/app/globals.css:53-101` 与 `apps/admin/src/index.css:1-60` 内仍维护一份 legacy token —— 删除前需要确认 Tailwind `bg-primary / text-primary` alias 不再被 admin 长尾 dialog 引用(deprecations 第 4 条 info 级) → **05-frontend-blog** + **06-frontend-admin** 已交叉。
- `@aetherblog/types/ai/completion.ts` 的 `StreamingChunk.delta` 是 SSE 协议契约;前端按句切分包 `<span class="delta">` 触发 ink-bleed —— 一个 chunk 内可能含多句,前端不能整 chunk 包成一个 delta → **04-backend-ai-search-system** + **07-ai-service-python** 应记。
- `@aetherblog/types/models` 与后端 `internal/models` 一一对应,**手工同步**(无 OpenAPI 生成),新加字段必须双边改 → **02-backend-content** 已记。

---

### Iteration 1.10 · 2026-05-09 · 前端 · 后台 Vite(模块 06 完成)

**触发事件:** 子代理 #6 完成 `docs/output/06-frontend-admin/`。

**影响范围:** 模块 06 共 10 个文档,合计 ~3823 行(本批因 admin 体量最大,接近 4000 行)。

**文档增量:**
- `README.md` —— 模块定位 / 路由树 / Provider 链 / 7 个 store 拓扑 / 26 个 service / 鉴权链路 / Codex 落地评估 / 关键决策 / 已知问题。
- `01-shell-routing-layout.md` —— `App.tsx` / `AdminLayout` / `Sidebar`(574 行) / `AuthGuard` / `CommandPalette` / `FocusModeContext`。
- `02-content-management.md` —— Posts / Categories / Comments / 经典编辑器 / AI 协同写作契约层。
- `03-media-library.md` —— `MediaPage`(1163 行)的上传 retry/abort/phase 子系统 / 文件夹树 / 权限页 / 回收站 / share/version 子模块。
- `04-ai-tools-and-config.md` —— `AIToolsPage` / `AiTestPage` / `AiConfigPage`(LobeChat 风格) + SSE 协议 + 流式协议表。
- `05-analytics-and-monitor.md` —— Dashboard / Analytics / Monitor / Activities + `systemService` 完整接口。
- `06-storage-and-search-config.md` —— `StorageProviderSettings` / `CloudExplorerPage` / `SearchConfigPage`(1542 行) + Profile reindex SSE。
- `07-settings-and-system.md` —— `SettingsPage`(8 类设置) / `MigrationPage` 5 步向导 / `FriendsPage` / `AetherHub` 独立壳。
- `08-state-and-services.md` —— Zustand 7 store 死代码盘点 / axios 拦截器 / 4 套独立 SSE 实现对比 / 错误归一。
- `09-design-implementation.md` —— Codex 六硬规则违规速查 + admin 数据密集页折衷策略。

**关键发现(非显然):**
1. **3 个死代码 Zustand store 仍在导出** —— `useUIStore` / `usePostStore` / `useSettingsStore` 全部无活跃消费方。`usePostStore` 与 PostsPage 的 useState 完全分离;`useSettingsStore` 与设置页 react-query 流重叠;`useUIStore` 的 sidebar/theme 字段已被 `useSidebarStore` + ThemeProvider 取代。`stores/index.ts` 仍作公开 API 导出,误导性强。
2. **4 套独立 SSE 解析实现,无公共层** —— `useStreamResponse`(309 行)/ `useReindexStream`(231 行)/ `migrationService.streamImport` / `services/agent/chat.ts` 各自实现 `\n\n` 拆帧 + `data:` 前缀剥离 + JSON.parse + 401 续期(只有第一个做)。事件类型不一致但解析逻辑高度相似,可抽 `parseSSE(body, eventTypes, onEvent)` util。`useStreamResponse` 还是唯一做了同源/跨域分流(VULN-085)的实现,其他三套要么 `credentials: 'include'` 要么没考虑跨域 —— 安全策略不一致。
3. **CommentsPage 的"演示降级"是 P0 隐患** —— 每个 mutation(approve/reject/spam/restore/delete/permanent)的 catch 都改成本地 setState 假装成功 + `toast.success("...(演示模式)")`。生产环境 403/500/网络断会被静默掩盖,用户以为成功但刷新后状态不变。`mockComments` 还有兜底假数据。

**跨模块溢出:**
- `R<T>` vs `AiServiceResponse<T>` 双协议 → 后端整理 ai-service 直连时建议统一到 `R<T>`,前端可删 `AiServiceResponse<T>` + `resolveAiServiceErrorMessage` → **04-backend** + **07-ai-service-python** 应交叉。
- 设计系统缺 admin 数据密集页规范 → 建议补 `apps/admin/app/design/` 或 `.claude/design-system/admin-density.md` → **09-design-system** 应记。
- 存储/搜索/AI 三配置流的依赖链(Search Profile → AI Config → Storage Provider)缺向导 → 建议补"首次配置向导" → **10-infrastructure-devops** 部署 SOP 章应交叉。
- Spinner/confirm/`dark:` 红线清理 P0/P1 列表已成形,建议作独立批量 PR → **09-design-system** 应记。

---

### Iteration 2 · 2026-05-09 · Wave 2 整合

**触发事件:** 10 个子代理全部沉淀完成,主代理整合 + 顶层 README + 横向矩阵。

**影响范围:** 顶层 [README.md](./README.md) 全文重写。

**文档增量:**
- §1 文档分层(四层渐进结构示意)。
- §2 模块导航(按"后端 / 前端 / AI / 数据-设计-基础设施"分组,每条配文档量)。
- §3 全局架构速览(ASCII 网关拓扑 + 数据/服务总线 + JWT/AI_INTERNAL_SERVICE_TOKEN/AI_CREDENTIAL_ENCRYPTION_KEYS 三共享 secret 强调)。
- §4.1 已识别的 P0/P1 问题表 —— 按模块去重后共 24 条,3 个 P0(CommentsPage 演示降级 / utils 入口冲突 / packages/ui Primitive 还在用 legacy)+ 21 个 P1。
- §4.2 跨模块耦合"对子"表 —— 8 组必须同步改的关键耦合(SSE 路由 ↔ nginx,migration ↔ deploy.sh,SSE payload ↔ admin hook,admin nginx CSP ↔ gateway CSP,@types ↔ Go models,migrate ↔ ai-service 升级顺序,posts 列类型 ↔ v_published_posts 视图,凭据轮换三件套)。
- §5 阅读路径建议(新人 / 加功能 / 排查事故 / 安全审计 4 条路径,每条挑 3-5 份必读)。
- §6 沉淀方法论(主代理 + 10 并行子代理工作流复盘)。
- §7 后续维护建议(PR 触发对子提示 / 新增能力同步 README + CHANGELOG / 每季度 P0/P1 巡检)。

**数据沉淀总量:**
- 10 个一级模块目录(01–10 全覆盖)。
- 76 份 markdown(10 份 README.md + 66 份能力设计)。
- 27,141 行总沉淀(最厚:09 设计系统 5128 行 / 06 admin 3823 行 / 最薄:02 内容 1657 行)。

**关键产出洞察:**
- **3 类问题已浮出水面:**(1) "看似可用、实际未实现" 的半成品(SCHEDULED 状态、TOTP、SEO 字段、文章版本、文章分享、`>`/`/` 搜索前缀);(2) "命名/规范偏差" 的死代码与漂移(3 个死 store / 字体规范 / packages/ui Primitive);(3) "跨进程协议" 的隐性脆弱(ai_client 错误归一化太粗 / search 静默降级 / SSE 解析 4 套散装)。
- **8 组跨模块耦合"对子"** 是后续 PR 必须警觉的同步点 —— 已在 §4.2 锚定。
- **"全责原则"违反集中在 admin** —— 演示降级 + 死代码 + 4 套 SSE,与项目 CLAUDE.md §5 直接抵触。

**下一步(Wave 3):** 校核覆盖盲区,确认手册级文档已完整。

---

### Iteration 3 · 2026-05-09 · Wave 3 覆盖盲区校核(收尾)

**触发事件:** 主代理对 10 模块沉淀做交叉审计,确认无重大盲区。

**审计结果:**

| 维度 | 数量 | 覆盖状态 |
| --- | --- | --- |
| 后端 handler(`internal/handler/*.go`) | 27 个 | 全部映射到 01–04 模块 |
| 后端 DTO(`internal/dto/*.go`) | 9 个 | 全部按业务域映射 |
| 后端工具包(`internal/pkg/*`) | 8 个 | 通过消费方模块交叉引用(cryptkey/storage→03;jwtkeys/jwtutil/ctxutil→01;imgproc→03;pagination/response→跨模块) |
| 后端 config / repository / service / model | 各 1 / 21 / 22 / 14 | 全部按业务域映射 |
| 后端 migration | 46 条 | 模块 08 全量列出 + 02/04 引用关键条目 |
| 中间件 | 6 个 | 模块 04 §07-middleware.md 全部覆盖 |
| Admin 页面 | 11 顶层 + 14 子目录 | 模块 06 全部覆盖 |
| Blog 路由 | 9 公开路由 + agent 三页 | 模块 05 全部覆盖 |
| AI 服务端点 | 19+ 个 | 模块 07 §01-architecture.md 列全 |
| 共享包 | 5 个(ui / hooks / types / utils / editor) | 模块 09 各 1 文 |
| 设计系统规范 | 8 + history + legacy + deprecations.json | 模块 09 全 8 章对应 |
| Docker / Nginx / 脚本 / GitHub Actions | 全部 | 模块 10 全部覆盖 |

**未独立成章但已交叉引用的边缘内容:**
- `apps/server-go/internal/pkg/*` 8 个工具包 —— 在消费方模块出现,无独立章节(可接受,深度不足以单独成文)。
- 顶层 `AGENTS.md` / `AGENTS.plan.md` / `ISSUES.md` / `系统需求企划书及详细设计.md` —— 项目元/规划文档,非技术沉淀范围。
- `.agent/rules/*` —— Agent 协作规则,非项目本身。
- `.claude/docs/*` —— 预存的工作手册,本目录是其上位补充而非替代。

**最终交付指标:**
- 文件数:**77 份 markdown**(10 模块 README + 65 能力设计 + 顶层 README + CHANGELOG)。
- 行数:**27,710 行**(本次 Wave 1+2+3 累计)。
- 模块均匀度:最薄 02 内容(1657 行) / 最厚 09 设计系统(5128 行)—— 反映各模块代码体量与子能力数量差异,符合预期。
- P0/P1 问题清单:**3 个 P0 + 21 个 P1** 已编入顶层 README §4.1。
- 跨模块耦合"对子":**8 组** 编入顶层 README §4.2,后续 PR 必查。

**结束条件已满足:** 项目从"四层渐进结构(功能目录 → 总体设计 → 能力设计 → 迭代变更)"完整拆解、交叉审计、横向矩阵聚合,至此沉淀完成。后续维护按本目录 §7 节规则进行。

---

### Iteration 4 · 2026-05-09 · 工作流元化为 Skill 文档

**触发事件:** 用户要求把整个摸底沉淀过程严格、细致、无偏差缺漏地输出为一份可复用的 Claude Code skill,并加入优化想法。

**影响范围:** 新建 [`.claude/skills/project-audit-pipeline/SKILL.md`](../../.claude/skills/project-audit-pipeline/SKILL.md)。

**文档增量(SKILL.md 16 章):**
- §0 适用场景 + 触发短语
- §1 核心理念(四层渐进 + 主代理/子代理 + 横向矩阵 + 全程纪律)
- §2 Phase 0 准备(必读上下文 + 工具加载)
- §3 Phase 1 项目侦察 + 模块拆分启发式(3-12 模块判定规则 + 全栈 web 应用 10 模块默认模板)
- §4 Phase 2 骨架搭建(CHANGELOG Iter 0 + 占位 README)
- §5 Phase 3 Wave 1 派遣(**完整可拷贝 prompt 模板**)
- §6 Phase 4 Wave 2 整合(CHANGELOG 增量条目模板 + 顶层 README §1-§7 模板 + P0/P1 萃取规则 + 对子萃取规则 + ASCII 图最小要素)
- §7 Phase 5 Wave 3 校核(覆盖审计命令 + 收尾 Iter 3 模板)
- §8 文档模板(模块 README / 能力设计 / P0/P1 表 / 对子表 全部可拷贝)
- §9 质量门(文件级 / 模块级 / 全局级三层检查清单 + 一键自查 bash)
- §10 反模式与陷阱(8 反模式 + 7 陷阱)
- §11 优化建议(P0 必上 3 条 + P1 强烈建议 3 条 + P2 可选 8 条,**每条都标注收益**)
- §12 适配到其他项目(单服务后端 / 纯前端 / SDK / 数据算法 4 类调整指南)
- §13 最小示例 + 典型耗时(30-50 分钟挂钟,主代理实际 10-15 分钟)
- §14 反向不做什么(避免与其他 skill 职责混淆)
- §15 Done Definition(6 条硬条件)
- §16 末尾产出形态承诺

**特别值得标记的 11 条优化建议(§11):**

P0 必上:
1. **Context Pack** —— 主代理在 Phase 1 末尾组装公共上下文块,Wave 1 prompt 顶部插入(降低 prompt 编写错误)。
2. **Glossary 术语表** —— 5-15 行的术语统一,直接消除文档术语漂移。
3. **"已实现 vs 半实现"强制章节** —— 每个能力文档必填,避免遗漏死路。

P1 强烈建议:
4. **YAML 结构化回报** —— 子代理回报 YAML 而非自由文本,主代理机械合并到 CHANGELOG / P0/P1 表。
5. **阶段化代理(Tiered)** —— Wave 0 surveyor / Wave 1 documenter / Wave 2 integrator / Wave 3 auditor,主代理上下文消耗大幅降低。
6. **强制行号 lint** —— 抽查 `path:line` 引用密度,低于阈值要求重做。

P2 可选:
7. 代理失败重派 + 拆模块策略
8. TodoWrite 进度可视化
9. 跨模块链接 lint(broken anchor 检测)
10. "对子表"双向落盘(源 + 目标模块都加引用)
11. 事实基线锁定(commit hash 入 Iter 0)+ 测试覆盖率反查 + 自动 Mermaid 依赖图

**关键产出洞察:**
- 本 skill 的最大价值**不是任何单份文档**,而是"主代理 + N 子代理 + 横向矩阵"这个工作流模式 —— 让"读不完的项目"从"找时间慢慢看"变成"30 分钟内拿到地图"。
- §5.1 子代理 prompt 模板和 §8 文档模板是直接可拷贝的资产,新项目可复用 80% 以上。
- §11 的 P0/P1/P2 优化是从本次实践真实痛点中萃取(主代理写 CHANGELOG 太手工 → YAML 结构化;术语漂移 → 术语表;主代理上下文消耗 → 阶段化代理),**不是空泛建议**。

**结束条件:** 项目摸底沉淀工作流已完整文档化为可复用 skill,后续团队任意成员可直接调用 `project-audit-pipeline` 复制本次效果或在本 skill 上继续演进。














