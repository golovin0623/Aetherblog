# @aetherblog/agent-kit

前后台灵境（Agent Chat）共用的**协议层与纯函数**工具包。admin（`@/services/agent`
经 barrel 转发）与 blog（`app/agent/*` 直接 import 包名）共同消费，消除两端
逐行同源但各自漂移的复制粘贴。

## 导出清单

| 模块 | 导出 | 说明 |
| --- | --- | --- |
| `chatStream` | `streamAgentChat`、`ChatStreamRequest`、`ChatStreamHandlers`、`KnowledgeContextMode`、`ChatMessageContentPart`、`AgentRetrievalReceipt/Hit/Warning/Status/HitKind`、`ChatStreamErrorMeta/Usage/ToolCall/ToolResult`、`parseAgentRetrievalReceipt`、`parseChatStreamToolCall/ToolResult/Usage` | `/api/v1/agent/chat` SSE 客户端（fetch + ReadableStream 手撕），事件 retrieval / think / delta / tool_call / tool_result / usage / done / error |
| `citations` | `linkifyCitations`、`parseCitationRank` | 内联引用标记 `[1]` / `【2】` 链接化到检索回执锚点 |
| `cjkMarkdown` | `normalizeCjkInlineMarkdown` | CJK 相邻 `**` 的 CommonMark emphasis 修复预处理 |
| `contextBudget` | `budgetHistory`、`BudgetedHistory`、`CONTEXT_CHAR_BUDGET`、`MESSAGE_CHAR_LIMIT`、`MAX_HISTORY_MESSAGES` | 发送前历史预算裁剪（对齐 ai-service `_enforce_message_limits`） |
| `smooth` | `useSmoothStream`、`StreamAnimationMode` | React hook：SSE 突发 delta 平滑成匀速 typewriter（带 lag 自适应追帧；文件头保留 `'use client'` 供 Next.js 消费） |
| `tokenEstimate` | `estimateTokens`、`estimateMessagesTokens`、`formatTokenCount` | 轻量 token 估算与紧凑显示 |

## 刻意**不**上提的模块（留在各 app）

两端形态已实质分叉，强行合并会制造带条件分支的伪共享抽象：

- **会话持久化** admin `sessions.ts` / `sessionsSync.ts`（IndexedDB + 服务端双写同步、迁移逻辑）vs blog `agentSessions.ts`（localStorage 单写）—— 存储介质与同步协议完全不同。
- **附件** admin `attachments.ts` / `attachmentStore.ts` —— blog 无附件能力。
- **模型 / 资源 / KB 目录** admin `models.ts` / `resources.ts` vs blog `agentModels.ts` / `agentResources.ts` / `agentKbs.ts` —— 请求路径、鉴权与缓存策略按端分叉（admin 走管理端点，blog 走公开端点 + `agentAuth.ts` 访客态）。
- blog `agentAuth.ts` / `sendShortcut.ts` —— blog 专属。

## 约定

- 无运行时依赖；`react` 是 peerDependency（仅 `smooth.ts` 使用）。
- 测试：`pnpm --filter @aetherblog/agent-kit test`（vitest，node 环境）。
- 协议（SSE 事件形态）变更须两端同步验证：admin `AetherHubWorkspacePage` 与 blog `WorkspaceClient` 是仅有的两个流式消费方。
