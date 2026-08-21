# 依赖版本、技术栈、仓库结构

> **何时读：** 准备升级某个依赖；新增 npm 包前确认是否已锁定版本；评估某个新特性是否在当前版本可用；首次接手仓库需要全景图。
>
> **真理源始终是 `go.mod` 与各 `package.json`** —— 本表是**速查 + 升级红线**，PR 升级后请同步。

---

## 1. 仓库结构（详图）

```
AetherBlog/
├── .agent/rules/                # AI 行为规则与设计文档
│   ├── behavior_rules.md       # Agent 行为标准（全责、完成定义）
│   ├── code-design.md           # 文档驱动开发流程
│   ├── code-structure.md        # 包结构与 TS 模板
│   ├── ui_rules.md              # UI 规则
│   ├── nginx-guide.md           # Nginx 配置指南
│   ├── doc-sync-rules.md        # 文档同步规则
│   └── ...
├── .claude/
│   ├── design-system/           # Aether Codex 设计规范
│   │   ├── 00-manifesto.md → 07-migration.md
│   │   ├── README.md
│   │   ├── deprecations.json
│   │   ├── history.md           # Round 3/4/5 升级日志
│   │   └── legacy-cognitive-elegance.md
│   ├── docs/                    # 本目录：分层指针文档
│   ├── skills/                  # 自定义 slash command
│   └── settings.local.json
├── .github/workflows/           # CI/CD
│   ├── ci-cd.yml                # 主管线
│   └── quick-build.yml          # 快速验证
├── apps/
│   ├── blog/                    # Next.js 15 博客前台
│   ├── admin/                   # Vite + React 19 管理后台
│   ├── ai-service/              # Python FastAPI + LiteLLM
│   └── server-go/               # Go + Echo
│       ├── cmd/server/          # 入口（main.go）
│       ├── cmd/migrate/         # 迁移工具
│       ├── internal/
│       │   ├── config/          # 配置（koanf）
│       │   ├── server/          # HTTP server 初始化与路由注册
│       │   ├── handler/         # 26 个 handler 模块
│       │   ├── service/         # 业务逻辑
│       │   ├── repository/      # 数据访问
│       │   ├── model/           # 数据模型
│       │   ├── dto/             # 请求 / 响应 DTO
│       │   ├── middleware/      # JWT、CORS、限流
│       │   └── pkg/             # 共享工具（pagination、response、JWT、image、storage、cryptkey）
│       └── migrations/          # 44 个 SQL 迁移文件
├── docs/                        # 用户级文档
│   ├── architecture.md
│   ├── deployment.md            # 详细部署文档（含 CI/CD 链路）
│   ├── development.md
│   ├── AI_MODULE_PLAN_V2.md
│   ├── INDEX.md
│   ├── ops/                     # 运维操作手册
│   └── qa/                      # QA 与审计报告
├── nginx/
│   ├── nginx.conf               # 生产
│   └── nginx.dev.conf           # 开发
├── ops/                         # 运维脚本
│   ├── webhook/                 # CI/CD webhook 接收 + deploy.sh
│   └── release/                 # preflight.sh
├── packages/                    # pnpm workspace 共享包
│   ├── ui/                      # 共享 UI 组件
│   ├── hooks/                   # 共享 React hooks
│   ├── types/                   # TypeScript 类型
│   ├── utils/                   # 工具函数
│   ├── editor/                  # CodeMirror Markdown 编辑器
│   └── agent-kit/               # 灵境 Agent Chat 协议层（SSE 客户端 + 纯函数）
├── scripts/                     # 构建与工具脚本
│   └── codemod-tokens.mjs       # 设计系统违规扫描
├── 系统需求企划书及详细设计.md   # 主设计文档（~22k 行）
└── CHANGELOG.md
```

---

## 2. 中间件容器（docker-compose.yml）

| 服务 | 镜像 | 容器名 | 端口 |
| --- | --- | --- | --- |
| PostgreSQL | `pgvector/pgvector:pg17` | `aetherblog-postgres` | 5432 |
| Redis | `redis:7-alpine` | `aetherblog-redis` | 6379 |

补充 compose 文件：
- `docker-compose.dev.yml` —— 开发环境
- `docker-compose.prod.yml` —— 含网关的全栈生产

---

## 3. 后端依赖锁定版本

| 依赖 | 版本 | 备注 |
| --- | --- | --- |
| Go | **1.24.1** | 语言版本 |
| Echo | v4.15.1 | HTTP 框架 |
| lib/pq | v1.12.0 | PostgreSQL 驱动 |
| sqlx | v1.4.0 | DB helper |
| go-redis/v9 | v9.18.0 | Redis 客户端 |
| golang-jwt/jwt/v5 | v5.3.1 | JWT |
| golang-migrate/v4 | v4.19.1 | DB migrations |
| zerolog | v1.35.0 | 结构化日志 |
| validator/v10 | v10.30.1 | 输入校验 |
| golang.org/x/crypto | v0.46.0 | 加密 |
| golang.org/x/sync | v0.19.0 | 并发原语 |
| imaging | v1.6.2 | 图像处理 |
| koanf/v2 | v2.3.4 | 配置 |
| aws-sdk-go-v2 | v1.41.5 | AWS SDK 核心 |
| aws-sdk-go-v2/service/s3 | v1.97.3 | S3-兼容存储 |

**升级红线：** Go 主版本升级前必须验证 `cmd/migrate` 与所有 `internal/pkg/*` 单元测试通过。

---

## 4. 前端关键版本

| 包 | Admin | Blog |
| --- | --- | --- |
| react | 19.0.0 | 19.0.0 |
| next | — | 15.1.3 |
| vite | 6.0.6 | — |
| typescript | 5.7.2 | 5.7.2 |
| tailwindcss | 3.4.17 | 3.4.17 |
| @tanstack/react-query | 5.62.8 | 5.62.8 |
| react-router-dom | 7.1.1 | — |
| zustand | 5.0.2 | — |
| framer-motion | 12.23.0+ | 12.23.0+ |
| recharts | 2.15.0 | — |
| zod | 4.3.5 | — |
| @lobehub/icons | 4.1.0 | — |
| react-hook-form | 7.70.0 | — |
| sonner | 2.0.7 | — |
| virtua | 0.50.1 | — |
| shiki | — | 1.1.0 |
| mermaid | — | 11.12.2 |
| katex | — | 0.16.27 |
| react-markdown | — | 10.1.0 |

### pnpm overrides（root `package.json`）

为避免 CodeMirror 多版本冲突：
```json
"pnpm": {
  "overrides": {
    "@codemirror/state": "6.5.4",
    "@codemirror/view": "6.26.0"
  }
}
```

### 工具链要求

- **Node ≥ 20.0.0**
- **pnpm ≥ 9.0.0**（`packageManager: pnpm@9.15.0`）

---

## 5. Workspace 包导出清单

> 真理源是各包的 `src/index.ts`。本表为高频引用速查。

### `@aetherblog/ui`（17 个组件 + 工具）

`Button` · `Card` · `Input` · `Modal` · `ConfirmModal` · `Toast` · `Avatar` · `Badge` · `Tag` · `Skeleton` · `Dropdown` · `Select` · `DateRangePicker` · `Tooltip` · `Textarea` · `Toggle` · `AetherMark` + `cn` 工具（clsx + tailwind-merge）

> `Select` / `DateRangePicker` 是 PR #568 PostsPage 滤镜重构时从 admin 私有组件提升为共享组件 —— 任何 admin 页用到的「样式化下拉」「日期范围筛选」一律走这两个；`AetherMark` 是 Codex 标识徽。
>
> `Toast` 已于 2026-08 迁移到 Codex token（不再使用 legacy `bg-green-500/20` 等）并扩展 API：`showToast({ message, type, duration, action })` 支持可选 `action`（如「撤销」按钮）；`ToastProvider` 新增 `position`（`'top-right'` 默认 / `'bottom-center'`）。灵境工作台（blog `/agent/workspace`）是首个消费方。

**外加：** Aether Codex 动效预设 `motion`（`ease`、`duration`、`spring`、`transition`、`variants`、`stagger()`、`cssMotion`），从 `@aetherblog/ui` 导入。

**音乐域动效：** `musicMotion`（`ease.glide/fling/emphasis/recede`、`spring.orbSnap/rebound/reanchor/islandEnter/sheetZoom`、`duration.reduced/pane/veil/dialog/swap/islandEnter/islandExit/morph/contentIn/contentOut/contentDelay`、`island.enterScale/exitScale/handoffScale/sheetZoomFrom`）—— 播放器浮岛与沉浸台的实机调优物理参数,2026-08-16 从 `MusicPlayerProvider` 收编,2026-08-21 补齐移动端三态编排(`emphasis`/`recede`/`islandEnter`/`sheetZoom`/`island.*`,同时移除随 `layoutId` 一并失效的 `spring.sheet` 与 `duration.zoom`);音乐播放器组件内禁止再写裸 spring/bezier 数值(见 `.claude/design-system/04-motion.md` §音乐域)。CSS 侧的对应令牌在 `packages/ui/src/styles/music-skin.css`（`--music-morph-{dur,ease}` / `--music-content-{dur,out-dur,delay}` / `--music-ease-{emphasis,recede}`）—— 浮岛三态形变走 CSS 几何过渡,无法从 TS 导入,两侧各存一份并在注释中互指。

### `@aetherblog/hooks`（16 个 hooks + 1 个组件）

`useDebounce` · `useThrottle` · `useCopyToClipboard` · `useLocalStorage` · `useSessionStorage` · `useAsync` · `useMediaQuery` · `useClickOutside` · `useScrollLock` · `useIntersectionObserver` · `useKeyPress` · `useWindowSize` · `usePrevious` · `useToggle` · `useScrollPosition` · `useTheme` + `ThemeToggle` 组件

### `@aetherblog/types`

按子目录分组：

- `api/` —— request、response、error
- `models/` —— post、user、comment、media、friendLink
- `ai/` —— prompt、completion

### `@aetherblog/utils`

按子目录分组：

- `format/` —— date、number、string、duration formatter
- `url/` —— query string、slug、UrlBuilder
- `storage/` —— IndexedDB wrapper
- `helpers/` —— deepClone、retry、omit、pick、uuid、nanoid、sleep
- `validation/` —— email、URL、password
- `color.ts` —— hex/rgb/hsl 转换、theme CSS 变量生成

### `@aetherblog/editor`

CodeMirror 版 Markdown 编辑器：

- 组件：`MarkdownEditor`、`MarkdownPreview`、`MarkdownStreamPreview`（AI 流式专用轻渲染器：marked+DOMPurify、无 shiki/KaTeX/mermaid、内置未闭合围栏稳定化 `stabilizeStreamingFences`）、`EditorWithPreview`、`UploadProgress`、`ImageSizePopover`
- Hooks：`useEditorCommands`、`useTableCommands`、`useImageUpload`

### `@aetherblog/agent-kit`

灵境（Agent Chat）前后台共用的协议层与纯函数（2026-08 从 admin `src/services/agent/` 与 blog `app/agent/lib/` 的漂移副本收敛而来；admin 经 `@/services/agent` barrel 转发，blog 直接 import 包名）：

- `chatStream.ts` —— `streamAgentChat` SSE 客户端（事件 retrieval/think/delta/tool_call/tool_result/usage/done/error）+ 全部请求/事件类型（`ChatStreamRequest`、`KnowledgeContextMode`、`AgentRetrievalReceipt` 等）+ 防御性 parser（`parseAgentRetrievalReceipt`、`parseChatStreamToolCall/ToolResult/Usage`）
- `citations.ts` —— `linkifyCitations`、`parseCitationRank`
- `cjkMarkdown.ts` —— `normalizeCjkInlineMarkdown`
- `contextBudget.ts` —— `budgetHistory` + 预算常量
- `smooth.ts` —— `useSmoothStream`、`StreamAnimationMode`（React hook，带 `'use client'`）
- `tokenEstimate.ts` —— `estimateTokens`、`estimateMessagesTokens`、`formatTokenCount`

**刻意不上提**（两端形态已实质分叉，见包 README）：admin `sessions/sessionsSync/attachments/attachmentStore/models/resources`；blog `agentSessions/agentModels/agentKbs/agentResources/agentAuth/sendShortcut`。

### Import 模板

```typescript
import { Button, Card, cn } from '@aetherblog/ui';
import { useDebounce } from '@aetherblog/hooks';
import type { Post } from '@aetherblog/types';
import { formatDate, slugify } from '@aetherblog/utils';
import { motion as motionPresets } from '@aetherblog/ui';
```

---

## 6. AI 服务字体加载

| 字体 | 用途 | 加载方式 |
| --- | --- | --- |
| Fraunces | display（SOFT/WONK/opsz axes） | blog: `next/font` / admin: CDN `<link>` |
| Instrument Serif | editorial italic lede | 同上 |
| Geist | UI sans | 同上 |
| Geist Mono | mono / 标签 / caption | 同上 |
| LXGW WenKai | 中文正文 | 同上 |
