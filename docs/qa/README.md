# QA 文档索引

AetherBlog 质量保障检查矩阵与测试文档中心。

> 最后更新：2026-04-04

---

## 文档状态总览

| 文件名 | 测试范围 | 有效性状态 | 最后审查日期 | 说明 |
|--------|---------|-----------|------------|------|
| [admin-log-preview-acceptance-matrix.md](./admin-log-preview-acceptance-matrix.md) | Dashboard/Monitor 双入口日志预览六类能力 | **仍然有效** | 2026-02-14 | 功能逻辑未变更，验收矩阵和复测清单仍可直接使用 |
| [admin-log-preview-release-guard-2026-02-14.md](./admin-log-preview-release-guard-2026-02-14.md) | 日志预览分层回归与灰度回退 | **已更新** | 2026-04-04 | 后端回归命令已由 Maven/Java（`mvn ... LogViewerServiceTest`）更新为 Go（`go test ./internal/service/...`） |
| [admin-ai-dashboard-degrade-retry-checklist-2026-02-13.md](./admin-ai-dashboard-degrade-retry-checklist-2026-02-13.md) | AI 看板降级、重试与日志状态区分 | **仍然有效** | 2026-02-13 | 前端手工回归步骤与功能描述仍与当前实现吻合 |
| [ai-layered-test-matrix-2026-02-13.md](./ai-layered-test-matrix-2026-02-13.md) | AI 可观测链路分层测试（后端/AI Service/前端） | **已更新** | 2026-04-04 | 后端执行命令已由 Maven/Java（`cd apps/server; mvn ...`）更新为 Go（`cd apps/server-go; go test ./...`） |
| [ai-analytics-contract-audit-2026-02-13.md](./ai-analytics-contract-audit-2026-02-13.md) | AI 统计与日志三端契约审计（Admin/Server/AI Service） | **已更新** | 2026-04-04 | 审计锚点已由 Java 源文件路径（`apps/server/aetherblog-service/.../java/...`）更新为 Go 路径（`apps/server-go/internal/...`） |
| [ai-analytics-observability-baseline-2026-02-13.md](./ai-analytics-observability-baseline-2026-02-13.md) | AI 统计链路四类故障样本与可观测性基线 | **已更新** | 2026-04-04 | 故障锚点已由 Java 源文件（`apps/server/...StatsController.java`）更新为 Go 路径（`apps/server-go/internal/handler/stats_handler.go`） |
| [ai-config-preflight-checklist-2026-02-13.md](./ai-config-preflight-checklist-2026-02-13.md) | AI 服务地址配置与启动自检（预检器） | **已更新** | 2026-04-04 | 已由 Java Spring Boot 的 `AiServicePreflightChecker`/`application-ai.yml` 重写为 Go 服务的 `preflight.go`/`config.yaml` 配置机制 |
| [ai-stats-log-error-semantics-2026-02-13.md](./ai-stats-log-error-semantics-2026-02-13.md) | AI 统计与日志接口错误分层语义（errorCategory） | **仍然有效** | 2026-02-13 | 语义约定（NO_DATA/LOG_READ_FAILURE/参数边界）和回归建议独立于技术栈，仍可用于验收 |
| [ai-usage-log-failure-observability-2026-02-13.md](./ai-usage-log-failure-observability-2026-02-13.md) | AI 埋点失败可观测增强（计数/分类/采样/告警） | **仍然有效** | 2026-02-13 | 面向 `apps/ai-service`（Python/FastAPI），技术栈未变，回归命令仍可用 |
| [ai-usage-log-migration-checklist-2026-02-13.md](./ai-usage-log-migration-checklist-2026-02-13.md) | `ai_usage_logs` 表结构迁移与数据回填校验 | **仍然有效** | 2026-02-13 | SQL 校验语句与幂等性说明面向 PostgreSQL，与后端语言无关，迁移执行命令需更新（Java→Go） |
| [editor-toc-sync-autosave-baseline.md](./editor-toc-sync-autosave-baseline.md) | 编辑器/目录/自动保存体验基线（ETSA-000） | **仍然有效** | 2026-02-13 | 功能完整存在于 `packages/editor` 和 `apps/admin`，基线数据集与阈值定义持续有效 |
| [editor-toc-sync-autosave-release-guard.md](./editor-toc-sync-autosave-release-guard.md) | 编辑器/目录/自动保存分层回归与发布保护（ETSA-080） | **仍然有效** | 2026-02-13 | 前端链路完整，灰度开关说明和阻断级缺陷定义仍准确 |
| [ai-config-center-acceptance-matrix-2026-04-04.md](./ai-config-center-acceptance-matrix-2026-04-04.md) | AI配置中心（供应商/模型/凭证三栏界面） | **新文档** | 2026-04-04 | 面向 `apps/admin/src/pages/ai-config/` |
| [vanblog-migration-acceptance-matrix-2026-04-04.md](./vanblog-migration-acceptance-matrix-2026-04-04.md) | VanBlog数据迁移（dry-run/execute两阶段） | **新文档** | 2026-04-04 | 面向 `apps/admin/src/pages/MigrationPage.tsx` |
| [media-version-history-acceptance-matrix-2026-04-04.md](./media-version-history-acceptance-matrix-2026-04-04.md) | 媒体文件版本管理（查看/恢复/删除历史版本） | **新文档** | 2026-04-04 | 面向 `apps/admin/src/pages/media/components/VersionHistory.tsx` |

---

## 有效性说明

### 状态定义

| 状态 | 含义 |
|------|------|
| **仍然有效** | 测试用例描述的功能存在且未重大变更，可直接用于验收 |
| **需要更新** | 功能逻辑仍有效，但部分引用路径/命令因后端从 Java 迁移至 Go 而过时 |
| **已过时** | 对应功能已被重构或废弃（当前无此状态文档） |
| **新文档** | 本次新增，覆盖尚无 QA 文档的功能模块 |

### 重要注意事项

**后端技术栈迁移影响（2026-02-13 文档）：**
多份 2026-02-13 日期的文档原本引用了 Java/Maven 构建链路（`apps/server/`、`mvn ...`、`.java` 文件路径）。当前项目后端已迁移至 Go（`apps/server-go/`），上述5份标记为"已更新"的文档已于 2026-04-04 完成替换：
- `mvn ... test` → `go test ./...`
- `apps/server/aetherblog-service/.../java/...` → `apps/server-go/internal/...`

---

## 使用说明

### 按场景查阅

| 场景 | 推荐文档 |
|------|---------|
| 发布前日志预览功能验收 | `admin-log-preview-acceptance-matrix.md` + `admin-log-preview-release-guard-2026-02-14.md` |
| AI 看板降级与重试回归 | `admin-ai-dashboard-degrade-retry-checklist-2026-02-13.md` |
| AI 统计链路端到端回归 | `ai-layered-test-matrix-2026-02-13.md` |
| AI 接口契约审计 | `ai-analytics-contract-audit-2026-02-13.md` |
| AI 可观测性故障排查 | `ai-analytics-observability-baseline-2026-02-13.md` |
| AI 配置启动自检 | `ai-config-preflight-checklist-2026-02-13.md` |
| AI 接口错误语义验证 | `ai-stats-log-error-semantics-2026-02-13.md` |
| AI 埋点失败可观测 | `ai-usage-log-failure-observability-2026-02-13.md` |
| 数据库迁移后校验 | `ai-usage-log-migration-checklist-2026-02-13.md` |
| 编辑器/目录/自动保存发布验收 | `editor-toc-sync-autosave-baseline.md` + `editor-toc-sync-autosave-release-guard.md` |
| AI 配置中心功能验收 | `ai-config-center-acceptance-matrix-2026-04-04.md` |
| VanBlog 数据迁移验收 | `vanblog-migration-acceptance-matrix-2026-04-04.md` |
| 媒体版本管理功能验收 | `media-version-history-acceptance-matrix-2026-04-04.md` |

---

## 缺失的测试文档清单

以下功能模块目前尚无对应的 QA 测试文档，建议后续补充：

| 功能模块 | 相关路径 | 优先级 |
|---------|---------|-------|
| AI 写作工具（摘要/标签/标题/改写/大纲/翻译） | `apps/admin/src/pages/ai-tools/` | 高 |
| 媒体库核心功能（上传/搜索/标签/文件夹/回收站） | `apps/admin/src/pages/media/` | 高 |
| 文章管理（创建/编辑/发布/隐藏/删除） | `apps/admin/src/pages/posts/` | 高 |
| 博客前台文章页面（渲染/SEO/分享/评论） | `apps/blog/app/posts/` | 中 |
| 用户认证与权限（登录/JWT刷新/权限守卫） | `apps/server-go/internal/middleware/` | 高 |
| 统计看板总览（Dashboard指标/趋势图） | `apps/admin/src/pages/dashboard/` | 中 |
| 分类与标签管理 | `apps/admin/src/pages/categories/`, `apps/admin/src/pages/tags/` | 低 |
| 媒体文件夹权限管理 | `apps/admin/src/pages/media/FolderPermissionsPage.tsx` | 低 |
