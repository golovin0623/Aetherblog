# CLAUDE.md

> 给 Claude Code 的工作指令。**本文件只放「不读会做错」的稳定铁律**与**子文档导航**；操作手册、API 表、迁移历史、故障速查全部按主题拆到 `.claude/docs/` 子文档，按需 Read。
>
> 版本对齐基线：2026-05-26（branch `feat/knowledge-base` @ `29013307` · migrations 000061 · 35 个后端 handler · Aether Codex Round 5 · Notes 模块 000054 · Knowledge Base RAG 模块 000058+ 已上线含 18 轮安全评审）。
>
> 历史基线: 2026-05-04（migrations 000045 / 26 handler）。如需追溯请看 git log。

---

## 0. 子文档导航 — 何时读哪份

| 触发场景 | 必读文档 |
| --- | --- |
| 启动 / 重启服务 / 改 `.env` / 移动端真机调试 | `.claude/docs/startup-and-env.md` |
| 改 JWT、对象存储、AI 服务、运行时日志、VanBlog 迁入 | `.claude/docs/backend-runtime.md` |
| 新增 / 修改 API 端点；前端找不到后端入口 | `.claude/docs/api-handlers.md` + `apps/server-go/internal/server/server.go`（`setupRoutes`） |
| 写新 migration；排查 `schema_migrations dirty` | `.claude/docs/database-migrations.md` |
| 准备发版；改 Docker / Nginx / CI/CD webhook | `.claude/docs/deployment-cicd.md`（速查） + `docs/deployment.md`（详细） |
| 服务起不来 / 健康检查失败 / 端口冲突 / 构建报错 | `.claude/docs/troubleshooting.md` |
| 升级依赖 / 查依赖版本 / 看仓库结构全景 | `.claude/docs/dependencies-and-stack.md` |
| 任何 UI 工作（组件 / 页面 / 样式） | `.claude/design-system/00-manifesto.md` → `07-migration.md`；活样板 `apps/blog/app/{design,about}/` |
| 设计系统升级历史回溯 | `.claude/design-system/history.md` |
| 处理 legacy（已废弃）颜色 / glass / 渐变 | `.claude/design-system/legacy-cognitive-elegance.md` |

> **原则：** 读最相关的 1-2 份，不要一次性 Read 全部 —— 这个分层就是为了节省上下文。

---

## 1. 项目概览

**AetherBlog** —— AI 增强的现代博客系统，遵循「Cognitive Elegance」→「Aether Codex」演进的设计哲学。

| 层 | 技术 |
| --- | --- |
| Blog 前端 | Next.js 15.1.3 + React 19 + TypeScript 5.7 |
| Admin 前端 | Vite 6 + React 19 + TypeScript 5.7 |
| Backend | Go 1.24.1 + Echo v4 |
| AI 服务 | Python FastAPI + LiteLLM（独立进程） |
| 存储 | PostgreSQL 17（pgvector） + Redis 7 |
| 检索 | tsvector（关键词） + pgvector（语义） |

详细版本与仓库结构 → `.claude/docs/dependencies-and-stack.md`。

---

## 2. 启动一行命令（红线）

```bash
./start.sh --gateway        # 本地默认 / 验证用
./stop.sh [--all]
```

> ⚠️ **本地启动 / 重启验证一律走 `--gateway`** —— 直连模式不会拉起 nginx，无法验证路由 / CORS / SSE 透传等真实链路。
>
> 网关入口：`http://localhost:7899`（`/`→blog · `/admin/`→admin · `/api/`→backend · `/api/v1/ai/`→ai-service）。
>
> `start.sh` 的 `bootstrap_env()` 自动准备 `.env` 与各 `.env.local` —— 接手坏掉的 `.env` 直接 `mv .env .env.bak && ./start.sh --gateway` 重建。

完整启动 / 环境 / 移动端调试 / 远程 inspect → `.claude/docs/startup-and-env.md`。

---

## 3. 关键铁律

### 3.1 前端依赖管理

- 每个 `packages/*` 子目录**必须**在自己的 `package.json` 声明所有依赖 —— 不从根或其他包继承。
- 新增 import 时立即在该包 `package.json` 加依赖，再 `pnpm install`。
- root `pnpm.overrides` 锁定 `@codemirror/state@6.5.4` / `@codemirror/view@6.26.0`（避免多版本冲突）。
- 必需：Node ≥ 20.0.0、pnpm ≥ 9.0.0（`packageManager: pnpm@9.15.0`）。

### 3.2 TypeScript 配置

- 根 `tsconfig.json` 用 project references。
- 每个 `packages/*` **必须**有完整独立的 `tsconfig.json`（模板见 `.agent/rules/code-structure.md` §8.1）。

### 3.3 Workspace 包导入

```typescript
import { Button, Card, cn } from '@aetherblog/ui';
import { useDebounce } from '@aetherblog/hooks';
import type { Post } from '@aetherblog/types';
import { formatDate, slugify } from '@aetherblog/utils';
```

完整导出清单 → `.claude/docs/dependencies-and-stack.md` §5。

### 3.4 设计系统六硬规则（Aether Codex）

> 任何 UI 工作前**先看** `apps/blog/app/design/`（活样板）+ `apps/blog/app/about/`（Apple-grade 落地参考）。完整规范 → `.claude/design-system/`。

1. **不要发明新颜色。** 只组合 `--ink-*` / `--bg-{void,substrate,leaf,raised}` / `--aurora-1..4` / `--signal-{success,warn,danger,info}`。Aurora 着色用 `color-mix(in oklch, var(--aurora-N) X%, transparent)`。
2. **不要手写玻璃效果。** 用 `.surface-leaf`（95% 卡片）/ `.surface-raised`（侧栏 / sticky）/ `.surface-overlay`（modal / auth）/ `.surface-luminous`（每页 ≤1 张签名卡）。`[data-interactive]` 提供 aurora hover stripe。
3. **不要绕过排版阶梯。** 标题 `.font-display`（Fraunces）；italic lede `.font-editorial`（Instrument Serif）；标签 / caption `.font-mono`（Geist Mono）+ `tracking-[0.2em] uppercase`。字号从 `--fs-micro..display`（9 阶）取。
4. **不要写裸 bezier / spring 数值。** 从 `@aetherblog/ui` 导入 `{ spring, transition, variants, stagger }`。短交互 `transition.quick`（260ms）、入场 `spring.soft`、按钮按下 `spring.precise`。
5. **不要在 Codex 已迁移的表面写 `dark:` 变体。** Token 通过 `:root.light` 自动翻转。新颜色须加到 `tokens.css`，不要 inline。
6. **新增组件 / 页面前先看 `/design` 与 `/about`。** 找不到对应模式 → 设计规范该升级，**不是**你该即兴发挥。

### 3.5 共享组件位置

- **必须放 `packages/ui`：** 所有 UI 组件、跨 app 复用的组件。
- **仅放 `apps/`：** 页面、布局、业务专属组件。
- **禁止：** 在 `apps/admin` 或 `apps/blog` 重造 UI 组件；使用浏览器原生 `confirm` / `alert`（用共享 Modal）。

### 3.6 加载体验

- **禁止** spinner（无论全屏或局部）。
- **必须**用与最终布局匹配的骨架屏 + shimmer/pulse；目标零延迟感知。

### 3.7 Legacy token 迁移立场

`--text-*` / `--bg-primary` / `bg-white/5` / `border-white/10` / `status-danger-light` / 品牌渐变等已废弃但**未删除**（sunset 2026-07-17，见 `deprecations.json`）。修改 legacy 组件时须**在同一 commit 迁移到 Codex** —— 不留半 Codex 半 legacy。`pnpm design-system:check` 暴露违规，**红线 = 保持 `0 error`**（warning / info 实时数量跑 `pnpm design-system:report` 查看）。

### 3.8 数据库迁移不可变（最高红线 —— 违反会炸生产）

> 写迁移前**必读** `.claude/docs/database-migrations.md`。golang-migrate **只按整数版本判断是否已应用，对同槽位文件内容/重命名零感知** —— 这是下面所有铁律的物理根源。

1. **迁移一旦合并就冻结：** 不改内容、不改编号、不重命名、不删除已存在的 `0000XX_*.sql`。生产 `schema_migrations` 记的是整数版本；你改了文件内容，已部署的库**不会重跑**，磁盘文件与真实 schema 当场错位。
2. **撞号 → 取下一个空号，绝不顺移。** 两个分支都用了 `000054` 时，给**新来的**那条取 `000062`（或当前最大号 +1），**禁止**把已存在的 `000054-000058` 整体 +3 顺移 —— commit `8a70196` 正是这么干的，直接引发 v57 dirty + `knowledge_bases` 漏建的生产事故（补救见 000067）。
3. **改不动老迁移就写前向修复迁移。** 老版本有 bug / 漏建 → 新建一条幂等的 forward-fix（`CREATE TABLE IF NOT EXISTS` / `ON CONFLICT` / `pg_constraint` 守卫），让它在新版本号上收敛 schema。范式见 000035/000036、000039、000067。
4. **每条迁移都要幂等 + 单事务安全。** `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `INSERT ... ON CONFLICT`。⚠️ 注意：`CREATE TABLE`（无 IF NOT EXISTS，如 000058）**不幂等**，重跑会 `already exists` 报错 —— 写新表也尽量带 `IF NOT EXISTS`。
5. **dirty 自愈是 fail-closed 的，别指望它兜底。** `ops/webhook/deploy.sh` 只对登记在册的 dirty 版本（当前 v34/v38）自动 `force`，**未登记的一律中止部署**（这是正确的——避免把真故障 heal 成绿部署）。所以「制造一个新 dirty」≠「部署能自己好」，等于要么人工 `force`、要么新增经过验证的自愈条目。

---

## 4. 命名约定

**前端：** Page 组件 `PascalCase + Page`（`DashboardPage.tsx`）；普通组件 `PascalCase`；hooks `use + camelCase`；services `camelCase + Service`；stores `camelCase + Store`；types `PascalCase`。

**后端：** Handler / Service / Repo / Model / DTO 一律 `PascalCase + 后缀`（`PostHandler` / `PostService` / `PostRepo` / `Post` / `CreatePostRequest`）。

---

## 5. Agent 行为标准

> 完整规则：`.agent/rules/behavior_rules.md` / `code-design.md` / `code-structure.md` / `ui_rules.md`。

**全责原则：** 不要把运维负担转给用户。
- ❌ 错：让用户手动重启服务、编译、清缓存。
- ✅ 对：自动调用 `./start.sh` / `docker restart`。
- 仅在 AI 缺权限时（如 sudo 密码）才请求用户。

**完成定义（Definition of Done）：** 「请验证」隐含「服务已成功重启并运行」。**交付即验证。**

**文档驱动开发流程：** 任务锁定 → 检索设计文档 → 评估方案 → 实现（代码注释 `// ref: §X.X`）→ 同步文档 → 提交完成报告。详见 `.agent/rules/code-design.md`，主设计文档 `系统需求企划书及详细设计.md`。

---

## 6. 文档维护规范

### 6.1 强制同步触发器

下表所列操作发生 → **必须**同步对应文档，否则视为未完成交付：

| 操作 | 必须更新 |
| --- | --- |
| 新增 API endpoint | `docs/architecture.md` API 节 + `.claude/docs/api-handlers.md` |
| 修改 DB schema（新建 migration） | `docs/architecture.md` 数据库节 + `.claude/docs/database-migrations.md` |
| 新增 / 修改 `packages/ui` 共享组件 | `.agent/rules/ui_rules.md` + `.claude/docs/dependencies-and-stack.md` §5 |
| 新增 `packages/hooks` Hook | `.agent/rules/code-structure.md` + `.claude/docs/dependencies-and-stack.md` §5 |
| 修改 Docker 配置 | `docs/deployment.md` + `.claude/docs/deployment-cicd.md` |
| 修改 Nginx 配置 | `.agent/rules/nginx-guide.md` + `.claude/docs/deployment-cicd.md` |
| 完成功能里程碑 | `CHANGELOG.md` + `系统需求企划书及详细设计.md` §1.6 Gap Analysis |
| 新增 AI 供应商 / 模型 | `docs/AI_MODULE_PLAN_V2.md` |
| 设计系统升级 | `.claude/design-system/history.md` + 相应规范文件 |
| 升级语言 / 框架版本 | `.claude/docs/dependencies-and-stack.md` |
| 新增运行时机制（鉴权 / 存储 / AI 任务等） | `.claude/docs/backend-runtime.md` |
| 排查到新故障类型并解决 | `.claude/docs/troubleshooting.md` |
| 修改 Agent 模式定位 / 实施阶段（Chat / Cowork / Code） | `docs/agent/README.md` + 对应 `COWORK_ROADMAP.md` 或 `CODE_ROADMAP.md` |

### 6.2 红线

- ❌ 提交「改了代码但未更新对应文档」。
- ❌ `CHANGELOG.md` 落后 HEAD 超过 1 个功能模块。
- ❌ 新增 API endpoint 但 `docs/architecture.md` 与 `.claude/docs/api-handlers.md` 都无记录。
- ✅ PR 描述包含 `📄 文档影响：[已更新 X.md] 或 [无需更新，原因: ...]`。
- ✅ 新功能开发前先查阅 `系统需求企划书及详细设计.md` 对应 §X.X，并在代码注释中引用。

每完成一个功能模块运行 `/doc` 触发文档校准；release 前对照 `docs/architecture.md` ↔ migrations、`go.mod` / `package.json` ↔ 实际依赖、`CHANGELOG.md` ↔ HEAD 对齐检查。

---

## 7. 默认凭据

**Admin 后台：** `admin` / `admin123`（首次登录强制改密）。

应急重置：
```sql
UPDATE users SET password_hash = '$2a$10$8.UnVuG9HHgffUDAlk8q2OuVGkqBKkjJRqdE7z6OcExSqz8tRdByW' WHERE username = 'admin';
-- 密码变成: 123456
```

---

## 8. 自定义 slash 命令

| 命令 | 说明 |
| --- | --- |
| `/doc` | 执行最严苛的质量控制与文档同步流程。 |
