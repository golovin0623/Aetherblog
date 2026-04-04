# 文档同步规则（Doc Sync Rules）

> 版本：1.0.0 | 创建：2026-04-04 | 此文件由 Phase 6 文档校准固化

本规则定义 AetherBlog 项目中代码与文档的同步规范，**所有 AI 开发 Agent 必须遵守**。

---

## 一、文档所有权映射（Ownership Matrix）

每个代码模块有对应的主文档责任。新增或修改代码时，**必须**同步更新对应文档。

### 1.1 后端模块 → 文档映射

| 代码路径 | 主文档（必须更新） | 次要文档（应更新） |
|---------|-------------------|-------------------|
| `apps/server-go/internal/handler/*.go` | `docs/architecture.md` §API节 | `CLAUDE.md` API表格 |
| `apps/server-go/internal/model/*.go` | `系统需求企划书及详细设计.md` §4.x | `docs/architecture.md` 数据库节 |
| `apps/server-go/migrations/*.sql` | `docs/architecture.md` 数据库节 | `系统需求企划书及详细设计.md` §4.x |
| `apps/server-go/internal/service/*.go` | `系统需求企划书及详细设计.md` §8.x | - |
| `apps/server-go/internal/middleware/*.go` | `CLAUDE.md` 中间件节 | - |
| `apps/server-go/go.mod` | `CLAUDE.md` Backend Version Pinning表 | - |

### 1.2 前端模块 → 文档映射

| 代码路径 | 主文档（必须更新） | 次要文档（应更新） |
|---------|-------------------|-------------------|
| `apps/admin/src/pages/*.tsx` | `docs/architecture.md` 前端节 | `CLAUDE.md` 前端结构节 |
| `apps/blog/app/**/*.tsx` | `docs/architecture.md` 前端节 | `CLAUDE.md` 前端结构节 |
| `packages/ui/src/**` | `CLAUDE.md` @aetherblog/ui组件列表 | `.agent/rules/ui_rules.md` |
| `packages/hooks/src/**` | `CLAUDE.md` @aetherblog/hooks列表 | `.agent/rules/code-structure.md` |
| `packages/types/src/**` | `CLAUDE.md` @aetherblog/types说明 | - |
| `packages/*/package.json` | `CLAUDE.md` 依赖管理节 | - |
| `apps/*/package.json`（主依赖变更） | `CLAUDE.md` 依赖版本表 | - |

### 1.3 基础设施 → 文档映射

| 代码路径 | 主文档（必须更新） | 次要文档（应更新） |
|---------|-------------------|-------------------|
| `nginx/nginx.conf` | `.agent/rules/nginx-guide.md` | `docs/deployment.md` |
| `nginx/nginx.dev.conf` | `.agent/rules/nginx-guide.md` | - |
| `docker-compose*.yml` | `docs/deployment.md` | `CLAUDE.md` Docker节 |
| `.github/workflows/*.yml` | `.github/CICD_GUIDE.md` | `.github/workflows/README.md` |
| `apps/ai-service/**` | `docs/AI_MODULE_PLAN_V2.md` | `CLAUDE.md` AI服务节 |

---

## 二、强制同步触发器（Mandatory Sync Triggers）

以下操作完成后，**在同一个 Agent 会话中必须执行文档更新**，不得留到"以后"：

### 立即同步（Immediate）
- 新增 HTTP endpoint（handler函数）→ `docs/architecture.md` API节
- 新建数据库迁移文件 → `docs/architecture.md` 数据库节 + 更新迁移版本号记录
- 新增共享 UI 组件（packages/ui）→ `CLAUDE.md` 组件列表
- 新增 React Hook（packages/hooks）→ `CLAUDE.md` hooks列表

### 功能完成时同步（On Feature Complete）
- 完整功能模块上线 → `CHANGELOG.md` 新增条目
- Gap Analysis变化 → `系统需求企划书及详细设计.md` §1.6
- 新的页面/路由 → `docs/architecture.md` 前端节

### 里程碑时同步（On Milestone）
- 版本发布前 → 执行全量文档校准（参考 doc-maintenance.md）
- 重大重构完成 → 更新所有受影响的文档

---

## 三、禁止行为（Forbidden Actions）

以下行为**严格禁止**：

```
❌ 提交"新增API但未更新docs/architecture.md"的代码
❌ 新建数据库迁移但不在文档中记录新表结构
❌ CHANGELOG.md落后当前HEAD超过1个功能模块
❌ 修改Nginx配置但不更新nginx-guide.md
❌ 更新go.mod主要依赖但不同步CLAUDE.md版本表
❌ 在apps/目录创建重复的UI组件（应使用packages/ui）
❌ 在文档中引用不存在的目录或文件（如已删除的.jules/目录）
```

---

## 四、版本同步标准（Version Sync Standard）

### CHANGELOG.md 条目格式
```markdown
## [vX.Y.Z] - YYYY-MM-DD

### 新功能
- 功能名：一句话说明

### 数据库变更
- 00000N_migration_name: 说明变更内容

### AI服务增强
- 说明

### 依赖升级
- 包名: 旧版本 → 新版本
```

### 迁移版本号记录
- 当前最新迁移：**000028**（2026-04-04校准）
- 每次新建迁移后，更新本文件此行的版本号

---

## 五、文档一致性校验清单（Release Checklist）

每次 release 前，使用以下 Checklist 进行验证：

### 后端一致性
- [ ] `CLAUDE.md` API表格 = 实际 handler 文件数量
- [ ] `CLAUDE.md` Backend Version Pinning = `go.mod` 精确版本
- [ ] `docs/architecture.md` 数据库节 = 最新 migration 内容

### 前端一致性
- [ ] `CLAUDE.md` @aetherblog/ui 组件列表 = `packages/ui/src/index.ts` 导出
- [ ] `CLAUDE.md` @aetherblog/hooks 列表 = `packages/hooks/src/index.ts` 导出
- [ ] `docs/architecture.md` 前端节 = 实际页面文件

### AI服务一致性
- [ ] `CLAUDE.md` AI服务能力节 = `apps/ai-service/` 实际端点
- [ ] `docs/AI_MODULE_PLAN_V2.md` 实现状态 = 代码实现

### 基础设施一致性
- [ ] `.agent/rules/nginx-guide.md` = `nginx/nginx.conf` 实际配置
- [ ] `docs/deployment.md` = `docker-compose.prod.yml` 实际配置

### 版本记录
- [ ] `CHANGELOG.md` 包含本次 release 所有变更
- [ ] `系统需求企划书及详细设计.md` §1.6 Gap Analysis 已更新

---

## 六、文档漂移预防机制

### 6.1 代码注释锚点
重要实现应包含设计书引用注释：
```go
// ref: §5.3.1 AI摘要生成接口设计
func (h *AIHandler) Summary(c echo.Context) error {
```

```typescript
// ref: §7.2.3 AI配置中心界面设计
const AiConfigPage: React.FC = () => {
```

### 6.2 MR/PR 文档声明模板
```
## 文档影响声明
- [ ] 已更新 docs/architecture.md（新增了 X 个 API 端点）
- [ ] 已更新 CLAUDE.md（新增了 N 个组件/hooks）
- [ ] 已更新 CHANGELOG.md（新增功能条目）
- [ ] 无需更新文档，原因：___（填写理由）
```

### 6.3 定期校准触发点
以下时机触发全量文档校准（运行 `/doc` 命令）：
- 每完成一个完整功能模块
- 每隔 2 周
- 每次版本发布前

---

## 附录：当前文档状态快照（2026-04-04校准）

| 指标 | 数值 |
|------|------|
| 总文档文件数 | 79 |
| 后端Handler模块数 | 23 |
| 数据库迁移版本 | 000028 |
| Admin前端主页面数 | 14+ |
| 共享UI组件数 | 13 |
| 共享Hook数 | 16 |
| AI供应商支持数 | 6+ |
| AI模型类型数 | 12 |
| 校准执行者 | Claude Agent（全量自动校准）|
