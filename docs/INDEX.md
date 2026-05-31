# 📚 文档中心

AetherBlog 项目文档导航。

> 返回 [项目主页](../README.md)

---

## 📖 核心文档

| 文档 | 说明 |
|------|------|
| [**开发指南**](./development.md) | 本地环境搭建、构建命令、模块说明、调试技巧 |
| [**系统架构**](./architecture.md) | 架构概览、模块划分、技术选型、数据流 |
| [**部署指南**](./deployment.md) | Docker 构建、生产部署、域名配置、运维操作 |
| [**技术摸底沉淀**](./output/README.md) | 11 个模块的代码事实沉淀、横向矩阵与新能力纠偏入口 |

## 🔄 CI/CD

| 文档 | 说明 |
|------|------|
| [**CI & Webhook 自动部署手册**](./ci-webhook-deploy-runbook.md) | 整体架构 · 触发条件 · 自重启链路 · 故障排查 · 历史事故索引（**遇到部署问题先看这份**） |
| [**GitHub Actions 总览**](../.github/CICD_README.md) | 工作流文件说明、快速上手、构建状态 |
| [**CI/CD 配置指南**](../.github/CICD_GUIDE.md) | 详细配置、Secrets 设置、自动部署、故障排查 |
| [**工作流使用说明**](../.github/workflows/README.md) | 各 Workflow 触发方式与操作指南 |

## 🤖 AI 模块

| 文档 | 说明 |
|------|------|
| [AI 模块计划 V2](./AI_MODULE_PLAN_V2.md) | 独立 AI 服务架构设计 |
| [AI 写作工作流](./AI_WRITING_WORKFLOW.md) | 七阶段 AI 写作流程 |
| [Agent 三模式总览](./agent/README.md) | Chat / Cowork / Code 三模式产品定位（必读） |
| [Cowork 模式产品路线](./agent/COWORK_ROADMAP.md) | 主动副手子系统 · 设计冻结 · Phase 1-5 |
| [Code 模式产品路线](./agent/CODE_ROADMAP.md) | Agent 编排平台 · 设计冻结 · Phase 1-5 |

## 📋 设计与报告

| 文档 | 说明 |
|------|------|
| [AetherHub 蓝图 V1](./AETHERHUB_BLUEPRINT_V1.md) | 系统蓝图与设计思路 |
| [Markdown 能力矩阵](./blog-markdown-capability-matrix.md) | 博客 Markdown 功能支持清单 |
| [前端优化报告](./Phase6-Frontend-Optimization-Report.md) | 第六阶段前端性能优化记录 |
| [Search Profiles 后续 PR 执行手册](./SEARCH_PROFILES_FOLLOWUP_PLAN.md) | RAG profile 化 chunking pipeline 的 admin 操作面落地计划（2026-05-03 起执行） |
| [Aether Knowledge 调研报告](./plan/knowledge.md) | 支持标注迁移与知识图谱涌现的多模态个人知识系统技术调研（Carrier × Annotation × KnowledgePoint × TypedRelation 四层架构） |
| [Aether Knowledge 落地手册](./plan/task-aether-knowledge-system.md) | 把调研报告落地的 5 阶段（约 40-52 周）路线图：含基线快照、约束、验收、红线、任务命名规范、完成日志（task-knowledge-* 前缀） |
| [Aether Knowledge 当前实现沉淀](./output/11-aether-knowledge-atlas/README.md) | 当前工作树的 KB/RAG、Atlas、Admin 入口、AI stub 与 000057-000067 迁移事实 |

## 🔧 运维与 QA

| 文档 | 说明 |
|------|------|
| [Docker 清理指南](./DOCKER_CLEANUP_GUIDE.md) | Docker 镜像 / 容器清理操作 |
| [QA 文档索引](./qa/README.md) | QA 文档总览、有效性状态与使用指引 |
| [日志预览验收矩阵](./qa/admin-log-preview-acceptance-matrix.md) | Dashboard/Monitor 双入口日志预览六类能力 |
| [编辑器/目录/保存基线](./qa/editor-toc-sync-autosave-baseline.md) | TOC 同步与自动保存体验基线（ETSA-000） |
| [AI配置中心验收矩阵](./qa/ai-config-center-acceptance-matrix-2026-04-04.md) | 供应商/模型/凭证三栏界面验收（2026-04-04） |
| [VanBlog迁移验收矩阵](./qa/vanblog-migration-acceptance-matrix-2026-04-04.md) | VanBlog数据迁移 dry-run/execute 两阶段验收（2026-04-04） |
| [媒体版本管理验收矩阵](./qa/media-version-history-acceptance-matrix-2026-04-04.md) | 媒体文件版本查看/恢复/删除验收（2026-04-04） |
| [运维脚本](./ops/) | 发布观察与回滚模板 |

## 📝 实现报告

| 文档 | 说明 |
|------|------|
| [实现报告](./IMPLEMENTATION_REPORT.md) | 核心功能实现记录 |
| [AI 模块报告 V2 Phase1](./AI_MODULE_REPORT_V2_PHASE1.md) | AI 模块迁移第一阶段报告 |
| [Phase 1-5 总结](./PHASE_1-5_COMPLETION_SUMMARY.md) | 前五阶段完成摘要 |
