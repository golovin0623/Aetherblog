# 06 · 数据库迁移与运维耦合

## 1 · 责任范围

本文件记录 Aether Knowledge / KB / Atlas 相关 migration 与部署脚本耦合点。它补齐旧 `docs/output/08-database-migrations` 仍停在 000046 的漂移。

---

## 2 · Migration 时间轴

| 编号 | 文件 | 作用 |
| --- | --- | --- |
| 000057 | `media_folder_is_system` | 给 `media_folders` 增加 `is_system` / `undeletable`,seed `/root/_system_kb` |
| 000058 | `knowledge_bases` | 建 KB 主表、profile、member、file、embedding,seed SYSTEM_POSTS |
| 000059 | `kb_default_profiles` | 给 SYSTEM_POSTS seed 默认 active profile |
| 000060 | `kb_embedding_unconstrained` | 将 `kb_embeddings.embedding` 改为不锁维度 `vector` |
| 000061 | `kb_embedding_hnsw` | 按 768/1024/1536/3072 维创建 partial HNSW |
| 000062 | `atlas_core` | 建 Atlas Carrier、Version、Annotation、KP、Relation 核心表 |
| 000063 | `atlas_permissions` | seed `content.atlas.read/write/admin` 并授给 ADMIN |
| 000064 | `atlas_kp_links` | 建 annotation-KP 和 relation-evidence 多对多,给 KP uuid 默认值 |
| 000065 | `atlas_ai_suggestions` | 建 AI suggestion inbox 与 ignored fingerprint |
| 000066 | `atlas_carrier_unique_source_uri` | 给 carrier source_uri 加唯一约束 |
| 000067 | `kb_schema_repair` | 幂等补齐历史重编号/跳号导致缺失的 KB 最终 schema |

---

## 3 · 关键迁移说明

### 3.1 000057: 系统目录是 KB 的地基

000057 不是单纯给媒体文件夹加字段。它解决的是 KB 文件“复用媒体能力但不污染媒体 UI”的问题:

- `is_system`:媒体 UI 默认过滤。
- `undeletable`:系统目录和 root 防误删。
- `/root/_system_kb`:所有 CUSTOM KB 文件归档根目录。

它还包含生产漂移防护:补 `uq_folder_path`,按 `path='/root'` 找 root,不再硬编码 root id=1,见 `apps/server-go/migrations/000057_media_folder_is_system.up.sql:23-66`。

### 3.2 000058-000061: KB schema 与向量索引

000058 建五张表并 seed SYSTEM_POSTS。000059 给 SYSTEM_POSTS 挂默认 active profile。000060 修复 `vector(3072)` 锁维度问题。000061 建 partial HNSW。000067 是前向幂等修复,用于补齐历史重编号/ledger 跳过 058 时缺失的 KB schema。

运维要点:

- `kb_embeddings.embedding` 不锁维度,真实维度在 `embedding_dim`。
- 3072 维走 `halfvec(3072)` HNSW,1536/1024/768 走 `vector(N)` HNSW。
- >4000 维没有 HNSW,大库会慢。

### 3.3 000062-000066: Atlas schema

000062 建 5 张核心表并预留 KP embedding。000063 seed 权限码。000064 建 evidence link。000065 建 suggestion inbox。000066 修 carrier 并发懒创建唯一性。

注意:000066 假设历史没有重复 `source_uri`;如果生产已经手工写入重复 carrier,必须先去重再执行。

### 3.4 000067: KB schema repair

000067 不新增业务语义,而是把 000058-000061 收敛后的 KB 表、索引、FK 和 SYSTEM_POSTS 默认 profile 用幂等 SQL 重新声明一遍。缺表环境会被补齐;正常环境应全部 no-op。它的 down 是 no-op,避免单步回退误删整套知识库数据。

---

## 4 · deploy.sh dirty self-heal

当前 `ops/webhook/deploy.sh::_try_heal_known_dirty` 覆盖 v34、v38、v57:

- v34 dirty -> force 35,让 036 接管 post_embeddings 修复。
- v38 dirty -> force 38,让 039 接管 view 依赖下的 summary 加宽。
- v57 dirty -> 先探测 `knowledge_bases`;只有确认不存在时才 force 56,让具备漂移防护的 000057 原地重放并让 058/067 收敛 KB schema。

v57 recipe 的注释说明见 `ops/webhook/deploy.sh:264-355`。它是 KB/Atlas 部署链的关键保护:000058 依赖 `_system_kb` 和 `media_folders` 系统字段,如果 v57 卡 dirty,后续 KB schema 无法安全继续。存在或无法判定 `knowledge_bases` 时拒绝自动自愈,防止非幂等 000058 反复失败。

---

## 5 · 文档同步要求

每当新增 Aether Knowledge 相关 migration,必须同步:

- `docs/output/08-database-migrations/01-schema-overview.md`
- `docs/output/08-database-migrations/02-migration-history.md`
- `docs/output/08-database-migrations/05-operations.md`
- `docs/output/10-infrastructure-devops/04-ci-cd.md`
- `ops/webhook/README.md`
- `docs/ci-webhook-deploy-runbook.md`

如果新增 dirty self-heal recipe,还必须改 `ops/webhook/deploy.sh` 并在以上文档登记原因、force 目标和“为什么可安全重放”。

---

## 6 · 运维风险

| 优先级 | 风险 | 影响 | 建议 |
| --- | --- | --- | --- |
| P1 | 文档仍写 migrations 至 000046 | 新人会漏跑 000057-000067 的 KB/Atlas schema | 更新顶层 README 和 DB 模块 README |
| P1 | 000057 root/path 漂移 | 部署卡 dirty,后续 KB migration 全部被阻断 | 保留 v57 dirty self-heal,不要改成 force 57 |
| P1 | `atlas_carriers.source_uri` 加 UNIQUE 前已有重复 | 000066 执行失败 | 生产前做重复检查 |
| P2 | HNSW 索引只覆盖常见维度 | 小众 embedding 模型大库性能差 | 在 profile UI 提示推荐维度 |

---

## 7 · 测试覆盖说明

当前 CI 主要编译 `cmd/migrate`,不对真实数据库跑全量 `migrate up`。这意味着 migration 漂移只能在部署时暴露。建议新增最小 Docker PG migration smoke,至少覆盖 000057-000067 的 fresh apply。
