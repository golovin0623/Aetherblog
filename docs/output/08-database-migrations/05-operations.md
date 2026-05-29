# 05 · Migration 运维操作手册

> 主题:**实操**层面 — 怎么应用 migration、出问题怎么自愈、备份怎么做、回滚怎么走。
>
> 目标读者:接手 Aether 数据库的运维 / 开发 / agent。

---

## 1. golang-migrate 工具链

### 1.1 二进制
- 源码:`apps/server-go/cmd/migrate/main.go`
- 编译:`make build-migrate` 或 `go build -o ./bin/migrate ./apps/server-go/cmd/migrate`
- 命令格式:
  ```
  migrate [-dir DIR] [-dsn DSN] <up | down [N] | version | force VERSION>
  ```

### 1.2 参数解析
- `-dir`:migration 文件目录,默认探测 `./migrations`、`../migrations`、`../../migrations`(绝对化)。
- `-dsn`:`postgres://user:pass@host:port/db?sslmode=disable`;不传时回退环境变量 `DATABASE_DSN`。
- 子命令:
  - `up`:应用所有未跑的 migration。`migrate.ErrNoChange` 不是错误。
  - `down N`:回退 N 步。N ≤ 0 时强制为 1。
  - `version`:打印当前版本与 dirty 标志(`version: 67, dirty: false`)。
  - `force V`:强制把 `schema_migrations` 标到版本 V(并清 dirty)。**仅在 dirty 自愈时使用。**

### 1.3 schema_migrations 表
golang-migrate 自管理:
```sql
CREATE TABLE schema_migrations (
    version BIGINT NOT NULL PRIMARY KEY,
    dirty BOOLEAN NOT NULL
);
```
- `dirty=true` 时所有 `up/down` 操作被拒绝。
- `force` 是唯一能写 dirty 的命令。
- 同一时刻只允许一行(`PRIMARY KEY` 限定 — golang-migrate 实际用 `INSERT ... ON CONFLICT (version)` 维护单行)。

---

## 2. migration 应用流程

### 2.1 本地开发(dev)
```bash
# 拉起 Postgres + Redis(start.sh 已包含)
./start.sh --gateway

# 手动跑 migrate(start.sh 内部已经会跑一次)
DATABASE_DSN='postgres://aether:aether@localhost:5432/aether?sslmode=disable' \
    ./bin/migrate -dir apps/server-go/migrations up

# 验证
DATABASE_DSN='...' ./bin/migrate version
# 期望: version: 67, dirty: false
```

### 2.2 生产部署(自动)
**触发链**: GitHub Actions push → webhook → `ops/webhook/deploy.sh`

`deploy.sh` 在拉取新代码 + docker compose 拉镜像后,**先跑 migration 再切流量**:
```bash
# 简化伪代码
version_out=$(./bin/migrate version 2>&1)
_try_heal_known_dirty "$version_out" || true   # 阶段 1: 部署前已有 dirty 的预探

if ! ./bin/migrate up; then
    echo "WARN: migration up failed; re-probing"
    version_out=$(./bin/migrate version 2>&1)
    if _try_heal_known_dirty "$version_out"; then
        echo "retrying migrate up after dirty-state heal"
        ./bin/migrate up
    else
        exit 1   # 未登记的 dirty 一律中止
    fi
fi
```

### 2.3 dirty self-heal recipe(`deploy.sh` 内置)
| dirty 版本 | 命中条件 | 自愈动作 |
|---|---|---|
| **34** | 输出含 `version: 34, dirty: true` | `migrate force 35` → 让 035/036 接管 post_embeddings 重建 |
| **38** | 输出含 `version: 38, dirty: true` | `migrate force 38` → 让 039 接管 v_published_posts 重建 + summary 加宽 |
| **57** | 输出含 `version: 57, dirty: true` 且 `knowledge_bases` 确认不存在 | `migrate force 56` → 重放 057 media folder 系统目录迁移,再让 058 创建缺失的 KB schema;若表已存在或无法判定则中止 |

**recipe 表只覆盖已登记版本**;新增条目时同时改 `deploy.sh::_try_heal_known_dirty` 与 `02-migration-history.md` §10。当前 v57 recipe 会先探测 `public.knowledge_bases`:只有确认不存在时才自动 `force 56`,存在或无法判定时 fail-closed。

### 2.4 验证 migration 是否成功

**SQL 校验**:
```sql
-- 1. 当前版本
SELECT version, dirty FROM schema_migrations;
-- 应得 (67, false)

-- 2. 关键表存在
SELECT to_regclass('public.post_embeddings'),
       to_regclass('public.search_profiles'),
       to_regclass('public.jwt_secrets'),
       to_regclass('public.media_sync_jobs'),
       to_regclass('public.knowledge_bases'),
       to_regclass('public.kb_embeddings'),
       to_regclass('public.atlas_carriers'),
       to_regclass('public.atlas_ai_suggestions');
-- 全部非 NULL

-- 3. CHECK 约束最新
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('chk_activity_event_category', 'chk_provider_type', 'chk_media_storage_type', 'chk_ai_model_type');
-- chk_activity_event_category 应包含 'security'
-- chk_provider_type 与 chk_media_storage_type 应包含 'R2'
-- chk_ai_model_type 应包含 'code', 'completion'

-- 4. 关键索引存在
SELECT indexname FROM pg_indexes WHERE tablename = 'post_embeddings';
-- 至少含: idx_post_emb_1536_active, idx_post_emb_3072_active,
--        idx_post_emb_post_status, idx_post_emb_model_status, idx_post_emb_profile_status

-- 5. KB/Atlas 关键约束
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('fk_kb_active_profile', 'chk_kb_files_source', 'uq_atlas_carriers_source_uri');
```

**HTTP 校验**:
```
GET /api/health    →  200 + {"db":"ok","redis":"ok"}
GET /api/v1/admin/search/diagnostics → 当前活跃 profile/model + 索引行数
```

---

## 3. 事故恢复

### 3.1 dirty state(已登记)
```bash
./bin/migrate version
# version: 38, dirty: true

# 命中 recipe → 直接 force + 让后续 migration 接管
./bin/migrate force 38
./bin/migrate up
```

### 3.2 dirty state(未登记)
**红线:不要乱 `force`**。先排查:
```bash
# 1. 看 PostgreSQL 日志,找最后一条失败的 SQL
docker logs aether-postgres 2>&1 | tail -200 | grep -i 'error\|fail'

# 2. 看 schema_migrations 哪个版本卡住
psql -c "SELECT * FROM schema_migrations;"

# 3. 看那条 migration 的 .up.sql 是否有未幂等的 DDL
cat apps/server-go/migrations/<version>_*.up.sql

# 4. 决策:
#    - 若 DDL 已部分执行(如 ADD COLUMN 完成但 CREATE INDEX 失败):
#       手动 DROP 已建的对象 → force <version-1> → up
#    - 若 DDL 全部失败(view 依赖类):
#       手动绕过依赖 → force <version> → 让后续 migration 接管
#    - 若 DDL 状态未知:
#       从备份恢复 + 重跑(详见 §4)
```

### 3.3 部分执行 + 字段已加但索引未建
PG DDL 在事务里看似原子,但 golang-migrate 把单 `.up.sql` 包成一个事务 — `pg_index` 之类系统表可能在事务里看到中间状态。常见症状:`schema_migrations.dirty=true`,某些列已加但索引缺失。

修复:手工清理:
```sql
-- 假设 v34 dirty,部分列已加但索引未建
DROP INDEX IF EXISTS idx_post_emb_1536_active;
ALTER TABLE post_embeddings DROP COLUMN IF EXISTS status;
-- ... 把脏列全 drop

-- 然后 force 33 让 034 重新跑
```

更稳妥:这种场景就是 035/036 自愈机制存在的原因 — 优先在生产用 force + 自愈而非手工 ALTER。

### 3.4 数据丢失场景
- **post_vectors 数据丢失**:000034 数据迁移依赖 `post_vectors` 表;若被人误 DROP,生产部署后 reindex 重新生成即可(`POST /v1/admin/search/reindex`)。
- **post_embeddings 数据丢失**:同上,reindex。
- **categories.post_count 错乱**:重新触发 trigger:
  ```sql
  UPDATE posts SET category_id = category_id WHERE id = (SELECT MIN(id) FROM posts);
  -- AFTER UPDATE trigger 重算
  ```
  或直接:
  ```sql
  UPDATE categories c SET post_count = (
      SELECT COUNT(*) FROM posts WHERE category_id = c.id AND status='PUBLISHED' AND deleted=FALSE
  );
  ```

---

## 4. 备份与回滚

### 4.1 备份策略

**逻辑备份(推荐日常)**:
```bash
docker exec aether-postgres pg_dump \
    -U aether -d aether \
    --format=custom \
    --no-owner --no-privileges \
    --file=/var/backups/aether-$(date +%Y%m%d-%H%M%S).dump
```

恢复:
```bash
docker exec aether-postgres pg_restore \
    -U aether -d aether \
    --clean --if-exists --no-owner \
    /var/backups/aether-20260508-2200.dump
```

**物理备份(WAL + base backup)**:
- 生产建议挂 PITR,但当前部署(单机 docker compose)未启用。
- 切到 managed PostgreSQL(Supabase / Neon / RDS)时再启用。

**migration 前应急备份**:
```bash
# 部署前自动 dump(deploy.sh 已经预留 hook,默认未启用)
docker exec aether-postgres pg_dump -U aether aether \
    | gzip > /var/backups/pre-migrate-$(date +%Y%m%d-%H%M%S).sql.gz
```

### 4.2 单条 migration 回滚

**前置**:确认 `down.sql` 真的可逆(有些 migration `down` 是 no-op,如 037)。

```bash
# 退一步
./bin/migrate down 1

# 退到指定版本(需多次)
./bin/migrate down 5
```

**已知不严格可逆的 migration**:
| 编号 | 不可逆原因 | 回滚前手动操作 |
|---|---|---|
| 000001 | down.sql 是 no-op 注释,**不会** DROP 任何对象 | 手动 DROP TABLE 全部表(基本等于 reset 数据库) |
| 000034 | 非 1536 维 embedding 在 down 时无法迁回 `post_vectors vector(1536)` 列 | 回滚前先确认所有 active embedding 都是 1536d,3072d 数据会丢 |
| 000037 | 纯数据修复,down 是 `SELECT 1`(no-op) | 不需要回滚;如果想"还原指针"得手动 UPDATE site_settings |
| 000041 | 多 chunk 数据(每篇多行)与 `(post_id, model_id) UNIQUE` 冲突;down 不主动 DELETE | 回滚前先 DELETE 多余 chunk(`WHERE chunk_index > 0`) |
| 000045 | "用户主动设 9" 与 "默认值 9" 不可区分,down 会被退回 10 | 事前 dump `SELECT * FROM site_settings WHERE setting_key='post_page_size'` |
| 000046 | 已有 `event_category='security'` 的行会让 CHECK 重建失败 | `DELETE FROM activity_events WHERE event_category='security'` 或迁到 'system' |
| 000051 | roles/teams/content_shares 是权限基础数据,down 会删除授权结构 | 事前导出 `permissions/roles/user_roles/teams/content_shares` |
| 000052 | agent workflow 定义、版本、运行 trace 会被删除 | 事前导出 `agent_*` 表 |
| 000054 | notes / note_embeddings 是用户内容,down 会删除笔记域 | 事前导出 notes 全表或走数据库备份恢复 |
| 000058 | KB 五表 down 级联删除知识库、文件清单、成员、向量 | 不建议 down;用备份恢复或导出 `knowledge_bases/kb_*` |
| 000060 | 非 3072 维 KB embedding 会被删除后才能改回 `vector(3072)` | 确认所有 KB profile 都是 3072 维或接受向量丢失 |
| 000062 | Atlas core down 会删除 carriers/annotations/KP/relations | 不建议 down;先导出 `atlas_*` |
| 000065 | suggestion inbox/ignored 指纹会被删除 | 导出 `atlas_ai_suggestions/atlas_ignored_suggestions` |
| 000067 | KB schema repair down 是 no-op | 单步回退不会删 KB 表;如需真正降级,按 000058-000061 的数据导出/恢复策略处理 |

### 4.3 全量回滚(灾难场景)

**思路**:不用 `migrate down 66`(多张表 down 会删除业务数据),用备份恢复 + force 标版本。

```bash
# 1. 停服务
docker compose stop server-go ai-service

# 2. 从备份恢复
pg_restore --clean --if-exists -U aether -d aether /var/backups/aether-XXXX.dump

# 3. 把 schema_migrations 标到备份当时的版本
psql -c "DELETE FROM schema_migrations;"
psql -c "INSERT INTO schema_migrations(version, dirty) VALUES (45, false);"

# 4. 跑剩余 migration 把 schema 推到最新(若需要)
./bin/migrate up

# 5. 重启服务
docker compose start server-go ai-service
```

### 4.4 单表数据回滚
不影响 schema 的纯数据问题(如某次错误 prompt 写入):
```sql
BEGIN;

-- 回滚到 SAVEPOINT
SAVEPOINT before_fix;
-- 比如把 ai_task_types.prompt_template 改回某个旧值
UPDATE ai_task_types SET prompt_template = $$...原版...$$ WHERE code = 'summary';

-- 错了就 ROLLBACK TO SAVEPOINT
-- 对了就 COMMIT;

COMMIT;
```

---

## 5. 新增 migration 的标准流程

### 5.1 文件命名
- 必须递增编号 + 描述名:`000047_<short_desc>.up.sql` / `.down.sql`。
- 描述名 snake_case,≤ 30 字符;不在编号上跳号(否则 golang-migrate 视为缺失)。

### 5.2 编写规则
1. **幂等**:`CREATE TABLE IF NOT EXISTS`、`ADD COLUMN IF NOT EXISTS`、`DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT`、INSERT `ON CONFLICT DO NOTHING/UPDATE`。
2. **避免单事务里 DDL+UPDATE 混跑**:DDL 失败会回滚 UPDATE,数据被搭进去(如 000038)。倾向于:单 migration 只做一件事;复杂场景拆分多 migration。
3. **写 down.sql**:即便是 no-op `SELECT 1;`,也要解释为什么不可逆(头部注释)。
4. **CHECK 约束修改**:`DROP CONSTRAINT IF EXISTS chk_xxx; ALTER TABLE ... ADD CONSTRAINT chk_xxx CHECK (...)`,不能 inline `ALTER`。
5. **索引修改**:倾向于 `CREATE INDEX IF NOT EXISTS` + `DROP INDEX IF EXISTS`。
6. **不依赖环境变量**:migration 是 SQL,不能读 env;参数化值通过应用层 BootstrapIfEmpty(参考 `jwt_secrets`)。
7. **大表 ADD COLUMN**:PG 11+ 对 nullable 无 default 加列是 instant DDL;有 default 也是 instant(PG 11 起)。但 `ADD COLUMN ... NOT NULL DEFAULT 0` 在 PG 17 同样 instant — 不会重写表。仍要测 staging 上的实际行为。
8. **视图依赖**:修改列类型前 `DROP VIEW`(参见 000038→000039)。
9. **不可变约定**:已发布 migration 不允许在原文件改字面量、顺序、注释;补丁另起一条。

### 5.3 Schema 文档同步(强制)
新增 migration → 必须更新:
- `docs/architecture.md` 数据库节(若涉及新表 / 重要字段)
- `.claude/docs/database-migrations.md`(新增叙事)
- `docs/output/08-database-migrations/02-migration-history.md`(本仓库)
- `model/<table>.go`(若新增 / 修改字段)
- 若新增表 → 同步 `repository/<table>_repo.go`

### 5.4 测试 migration
```bash
# 1. fresh 装(从空库起)
docker compose down -v && docker compose up -d postgres
./bin/migrate up

# 2. 存量装(有旧数据)
# 先 restore 最近备份,再跑
pg_restore -d aether /var/backups/latest.dump
./bin/migrate up

# 3. up + down 往返(若 down 可逆)
./bin/migrate up
./bin/migrate down 1
./bin/migrate up
```

---

## 6. 常见故障速查

### 6.1 `relation "schema_migrations" does not exist`
- 原因:首次启动数据库,migrate 没跑过。
- 修复:运行 `./bin/migrate up`,首次会自动建 `schema_migrations`。

### 6.2 `Dirty database version XXX. Fix and force version`
- 原因:某条 migration 失败。
- 修复:
  1. 看 PG 日志确认失败 SQL。
  2. 命中 recipe → `migrate force <recipe>`(参见 §3.1)。
  3. 未命中 → 排查 + 手工修复 + force(参见 §3.2)。

### 6.3 `column "xxx" of relation "yyy" already exists`
- 原因:DDL 不幂等。
- 修复:把 `ADD COLUMN xxx` 改 `ADD COLUMN IF NOT EXISTS xxx`,重新提交。

### 6.4 `cannot alter type of a column used by a view or rule (0A000)`
- 原因:`v_published_posts` 等视图引用了被改的列。
- 修复:`DROP VIEW IF EXISTS v_yyy; ALTER TABLE ...; CREATE OR REPLACE VIEW v_yyy AS ...`(参见 000039)。

### 6.5 `pgvector DataError: expected NNNN dimensions, not MMMM`
- 原因:`post_embeddings.embedding` 与 `dim` 列不匹配。
- 修复:应用层校验在 INSERT 前比较;若已落库,DELETE 错误行后 reindex。

### 6.6 `CHECK constraint chk_xxx violated`
- 原因:CHECK 没跟上业务字面量。
- 修复:在 migration 里 `DROP CONSTRAINT + ADD CONSTRAINT`(参见 000004 / 000021 / 000042 / 000046)。

### 6.7 `duplicate key value violates unique constraint uq_search_profiles_one_active`
- 原因:试图同时 promote 两个 profile 到 active。
- 修复:先把旧 active 翻 deprecated,再 promote 新行。**事务内** 完成,partial UNIQUE 自动检测。

### 6.8 deploy.sh 自愈失败
- 现象:`deploy.sh` 报 `force XXX` 后再次 `up` 失败。
- 原因:可能 force 的目标版本不正确,或后续 migration 也撞了新 bug。
- 修复:停止部署,手动登录 DB 排查;考虑回退到上一版镜像,从备份恢复。

---

## 7. 审计与可观测性

### 7.1 migration 应用记录
golang-migrate 不保留历史(只有 `schema_migrations` 当前一行)。要审计何时跑过哪条:
- `deploy.sh` 写日志(systemd journal)。
- `activity_events` 写自定义事件 `system.migration.applied`(目前未实装,可作扩展)。

### 7.2 schema 漂移检测
```sql
-- 比对当前 schema 与最新 migration 期望的关键约束
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname='public'
ORDER BY tablename, indexname;

-- 与 03-extensions-and-indexes.md §10 的清单对照
```

### 7.3 备份文件归档
- 本地 `/var/backups/aether-*.dump` 保留 30 天。
- 云 S3 / R2 同步 90 天(目前手动,未接入 cron)。

---

## 8. Runbook 简化版

```
[正常部署]
  GitHub Actions push → webhook → deploy.sh
    └─ docker compose pull
    └─ docker compose stop server-go ai-service
    └─ migrate version 探 dirty
    └─ migrate up (自愈 if dirty)
    └─ docker compose up -d server-go ai-service
    └─ preflight (HTTP /health)

[migration 失败]
  1. 看 PG 日志找 SQL 错误
  2. 命中 recipe → force + retry up
  3. 未命中 → 停部署 + 手工排查 + 必要时备份恢复

[紧急回滚]
  1. 切回上一版镜像(deploy.sh 已支持 PREV_TAG)
  2. 若 schema 已变 → 从备份恢复 → force 标版本
  3. 重启服务
```

---

## 9. 命令速查卡

```bash
# 编译
make build-migrate
go build -o ./bin/migrate ./apps/server-go/cmd/migrate

# 跑全部
DATABASE_DSN='postgres://aether:aether@localhost:5432/aether?sslmode=disable' \
    ./bin/migrate -dir apps/server-go/migrations up

# 当前版本
./bin/migrate -dsn "$DSN" version
# 应得: version: 67, dirty: false

# 退 1 步
./bin/migrate -dsn "$DSN" down 1

# 退 N 步
./bin/migrate -dsn "$DSN" down 5

# dirty 自愈
./bin/migrate -dsn "$DSN" force 38   # 仅在登记的 recipe 上用
./bin/migrate -dsn "$DSN" up

# 备份(custom 格式,可选择性恢复)
docker exec aether-postgres pg_dump -U aether -d aether \
    --format=custom --no-owner --no-privileges \
    --file=/var/backups/aether-$(date +%Y%m%d-%H%M%S).dump

# 恢复
docker exec aether-postgres pg_restore -U aether -d aether \
    --clean --if-exists --no-owner \
    /var/backups/aether-YYYYMMDD-HHMMSS.dump
```

---

## 10. 与 CI / Runtime 的契合

- **CI**(`.github/workflows/`):PR 阶段编译 `cmd/migrate` + 跑 `golangci-lint`;**不在 CI 里跑 `migrate up`**(无测试库)。
- **本地 `start.sh`**:启动时 `migrate up` 自动跑;失败会卡住后续 server-go 启动(被 healthcheck 拦截)。
- **生产 webhook deploy.sh**:见 §2.2。
- **Python ai-service**:**不持有 migration** — 只读已存在的表,任何 schema 修改一律走 server-go 的 migrations。
- **admin 前端 SearchConfigPage**:依赖 `search_profiles` / `site_settings.search.*` 暴露的 API,新增字段需要先在 server-go DTO + handler 层暴露,migration 只负责存储。
