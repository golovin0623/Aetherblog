# AetherBlog 项目结构规范

> 本文档定义项目目录结构、模块依赖关系和代码组织约束。**开发前必读**。

---

## 1. 项目总体架构

```
AetherBlog/
├── apps/                          # 📱 应用层
│   ├── blog/                      #    └─ 博客前台 (Next.js 15)
│   ├── admin/                     #    └─ 管理后台 (Vite + React 19)
│   ├── ai-service/                #    └─ AI 服务 (Python FastAPI + LiteLLM) :8000
│   └── server-go/                 #    └─ 后端服务 (Go 1.24 + Echo) :8080
│
├── packages/                      # 📦 共享包 (Monorepo)
│   ├── ui/                        #    └─ 通用 UI 组件 (13个)
│   ├── hooks/                     #    └─ 共享 React Hooks (16个)
│   ├── types/                     #    └─ TypeScript 类型定义
│   ├── utils/                     #    └─ 工具函数
│   └── editor/                    #    └─ Markdown 编辑器
│
├── nginx/                         # 🔀 网关配置 (nginx.conf, nginx.dev.conf)
├── docker-compose.yml             # 🐳 中间件编排
├── pnpm-workspace.yaml            # 📋 pnpm 工作区
└── 系统需求企划书及详细设计.md     # 📚 设计文档
```

---

## 2. 前端架构 (Monorepo)

### 2.1 共享包层 (packages/) - 必须使用

| 包名 | 用途 | 引用方式 |
|:-----|:-----|:---------|
| `@aetherblog/ui` | Button, Card, Input, Modal, ConfirmModal, Toast, Avatar, Badge, Tag, Skeleton, Dropdown, Tooltip, Textarea（13个组件） | `import { Button } from '@aetherblog/ui'` |
| `@aetherblog/hooks` | useDebounce, useThrottle, useCopyToClipboard, useLocalStorage, useSessionStorage, useAsync, useMediaQuery, useClickOutside, useScrollLock, useIntersectionObserver, useKeyPress, useWindowSize, usePrevious, useToggle, useScrollPosition, useTheme, ThemeToggle（16 hooks + 1组件） | `import { useDebounce } from '@aetherblog/hooks'` |
| `@aetherblog/types` | Post, User, Category 等类型 | `import type { Post } from '@aetherblog/types'` |
| `@aetherblog/utils` | cn, formatDate 等工具函数 | `import { cn } from '@aetherblog/utils'` |
| `@aetherblog/editor` | Markdown 编辑器组件 | `import { Editor } from '@aetherblog/editor'` |

### 2.2 应用层目录结构

#### apps/admin/ (管理后台)
```
src/
├── main.tsx                       # 应用入口
├── App.tsx                        # 根组件 + 路由
├── pages/                         # 页面组件
│   ├── DashboardPage.tsx          # 仪表盘
│   ├── PostsPage.tsx              # 文章管理
│   ├── CreatePostPage.tsx         # 创建文章
│   ├── EditPostPage.tsx           # 编辑文章
│   ├── AiWritingWorkspacePage.tsx # AI 写作工作台
│   ├── CategoriesPage.tsx         # 分类标签
│   ├── CommentsPage.tsx           # 评论管理
│   ├── FriendsPage.tsx            # 友链管理
│   ├── MediaPage.tsx              # 媒体库
│   ├── SettingsPage.tsx           # 系统设置
│   ├── MigrationPage.tsx          # 数据迁移
│   ├── MonitorPage.tsx            # 系统监控
│   ├── AnalyticsPage.tsx          # 统计分析
│   ├── auth/                      # 认证页面
│   ├── posts/                     # 文章编辑子模块
│   │   └── components/            # 编辑器相关组件
│   │       ├── PostEditor.tsx
│   │       ├── AiAssistant.tsx
│   │       ├── AiSidePanel.tsx
│   │       ├── AiToolbar.tsx
│   │       ├── SelectionAiToolbar.tsx
│   │       ├── SlashCommandMenu.tsx
│   │       ├── EditorSettingsPanel.tsx
│   │       └── AlertBlockDropdownButton.tsx
│   ├── ai-config/                 # AI 配置中心 (三栏布局)
│   │   ├── AiConfigPage.tsx       # 主页面
│   │   ├── components/            # 独有组件
│   │   │   ├── ProviderSidebar.tsx
│   │   │   ├── ProviderDetail.tsx
│   │   │   ├── ModelList.tsx
│   │   │   ├── ModelCard.tsx
│   │   │   ├── ProviderIcon.tsx
│   │   │   ├── ProviderIconPickerDialog.tsx
│   │   │   ├── ModelConfigDialog.tsx
│   │   │   ├── ModelSortDialog.tsx
│   │   │   ├── ConnectionTest.tsx
│   │   │   ├── CredentialForm.tsx
│   │   │   └── SortDialog.tsx
│   │   └── hooks/                 # AI 配置专用 Hooks
│   │       ├── useProviders.ts
│   │       ├── useModels.ts
│   │       └── useCredentials.ts
│   ├── ai-tools/                  # AI 工具页面
│   │   ├── AIToolsPage.tsx        # 工具集主页
│   │   ├── ContentRewriter.tsx    # 内容改写
│   │   ├── QA.tsx                 # 问答
│   │   ├── SeoOptimizer.tsx       # SEO 优化
│   │   ├── Summary.tsx            # 摘要生成
│   │   ├── Tagger.tsx             # 智能标签
│   │   └── TextCleaner.tsx        # 文本清洗
│   └── media/                     # 媒体库子模块
│       └── components/            # 媒体库组件
│           ├── MediaGrid.tsx
│           ├── MediaList.tsx
│           ├── VirtualMediaGrid.tsx
│           ├── MediaDetail.tsx
│           ├── FolderTree.tsx
│           ├── FolderDialog.tsx
│           ├── UploadProgress.tsx
│           ├── ShareDialog.tsx
│           ├── TrashDialog.tsx
│           ├── VersionHistory.tsx
│           ├── ImageEditor.tsx
│           ├── KeyboardShortcutsPanel.tsx
│           ├── TagManager.tsx
│           ├── TagFilterBar.tsx
│           └── MoveDialog.tsx
├── components/                    # 业务组件
│   ├── layout/                    # 布局组件
│   │   ├── AdminLayout.tsx        # 后台布局
│   │   ├── Sidebar.tsx            # 侧边栏
│   │   └── Header.tsx             # 顶部栏
│   ├── charts/                    # 图表组件
│   └── common/                    # 通用业务组件
├── services/                      # API 服务层
│   ├── api.ts                     # Axios 实例
│   ├── authService.ts             # 认证服务
│   ├── postService.ts             # 文章服务
│   ├── categoryService.ts         # 分类服务
│   ├── tagService.ts              # 标签服务
│   ├── mediaService.ts            # 媒体服务
│   └── analyticsService.ts        # 统计服务
├── stores/                        # 状态管理 (Zustand)
│   ├── authStore.ts               # 认证状态
│   └── settingsStore.ts           # 设置状态
├── hooks/                         # 应用专用 Hooks
├── types/                         # 应用专用类型
└── lib/                           # 工具库
    └── utils.ts                   # cn() 等工具
```

#### apps/blog/ (博客前台 - Next.js)
```
app/
├── page.tsx                       # 首页
├── layout.tsx                     # 根布局
├── globals.css                    # 全局样式
├── posts/
│   ├── page.tsx                   # 文章列表
│   └── (article)/[slug]/page.tsx  # 文章详情
├── friends/page.tsx               # 友链页
├── timeline/page.tsx              # 时间轴页
├── components/                    # 博客前台业务组件
│   ├── ArticleCard.tsx
│   ├── FeaturedPost.tsx
│   ├── CommentSection.tsx
│   ├── PostNavigation.tsx
│   ├── TableOfContents.tsx
│   ├── MarkdownRenderer.tsx
│   ├── SearchPanel.tsx
│   ├── TimelineTree.tsx
│   ├── AuthorProfileCard.tsx
│   ├── FriendCard.tsx
│   ├── AlertBlock.tsx
│   ├── ScrollToTop.tsx
│   ├── VisitTracker.tsx
│   ├── ViewModeToggle.tsx
│   ├── FloatingThemeToggle.tsx
│   └── __tests__/                 # 组件测试
└── lib/                           # 前台工具与 API 适配层
```

#### apps/ai-service/ (AI 服务 - Python/FastAPI)
```
apps/ai-service/
├── app/
│   ├── main.py                    # FastAPI 入口
│   ├── api/routes/                # 路由 (providers, models, chat 等)
│   └── core/                      # 配置、中间件
├── pyproject.toml                 # 依赖与配置
└── requirements.txt               # 运行时依赖
```
- 端口: 8000
- 支持供应商: OpenAI, Anthropic, Google, Azure, LiteLLM, Custom
- 模型类型: chat, embedding, image, audio, reasoning, tts, stt, realtime, text2video, text2music, code, completion

---

## 3. 后端架构 (Go + Echo)

### 3.1 包结构

```
apps/server-go/
├── cmd/
│   ├── server/                    # 🚀 应用入口 (main.go)
│   └── migrate/                   # 数据库迁移工具
│
├── internal/
│   ├── config/                    # 配置加载
│   ├── handler/                   # HTTP 处理器 (控制器)
│   ├── service/                   # 业务逻辑层
│   ├── repository/                # 数据访问层 (sqlx)
│   ├── model/                     # 数据模型
│   ├── dto/                       # 请求/响应 DTO
│   ├── middleware/                 # JWT、CORS、限流中间件
│   └── pkg/                       # 内部共享工具
│
└── migrations/                    # golang-migrate SQL 迁移文件
    ├── 000001_init_schema.up.sql
    └── ...
```

### 3.2 已实现模块（23个 Handler）

| 模块 | Handler | 说明 |
|:-----|:--------|:-----|
| auth | AuthHandler | 认证（登录/注册/Token刷新）|
| post | PostHandler | 文章 CRUD |
| comment | CommentHandler | 评论管理 |
| media | MediaHandler | 媒体文件管理 |
| folder | FolderHandler | 媒体文件夹管理 |
| permission | PermissionHandler | 权限管理 |
| category | CategoryHandler | 分类管理 |
| tag | TagHandler | 标签管理 |
| ai | AiHandler | AI 功能代理（转发至 ai-service）|
| stats | StatsHandler | 统计数据 |
| system_monitor | SystemMonitorHandler | 系统监控 |
| site | SiteHandler | 站点信息 |
| site_setting | SiteSettingHandler | 站点设置 |
| friend_link | FriendLinkHandler | 友链管理 |
| activity | ActivityHandler | 活动记录 |
| storage_provider | StorageProviderHandler | 存储提供商配置 |
| archive | ArchiveHandler | 文章归档 |
| migration | MigrationHandler | 数据迁移 |
| media_tag | MediaTagHandler | 媒体标签 |
| system | SystemHandler | 系统管理 |
| visitor | VisitorHandler | 访客统计 |
| version | VersionHandler | 版本信息 |

### 3.4 层次依赖规则

```
handler (HTTP 入口)
    ↓ 调用
service (业务逻辑)
    ↓ 调用
repository (数据访问)
    ↓ 操作
Database (PostgreSQL/Redis)
```

**约束**:
- ❌ handler 不能直接调用 repository
- ❌ repository 不能包含业务逻辑
- ✅ 所有外部依赖通过 config 注入

---

## 4. API 路径规范

### 4.1 后端 API 端点

| 模块 | 前缀 | 示例 |
|:-----|:-----|:-----|
| 认证 | `/v1/auth/*` | `/v1/auth/login` |
| 公共 | `/v1/public/*` | `/v1/public/posts` |
| 管理 | `/v1/admin/*` | `/v1/admin/posts` |
| AI | `/v1/admin/ai/*` | `/v1/admin/ai/summary` |
| 统计 | `/v1/admin/stats/*` | `/v1/admin/stats/dashboard` |

### 4.2 前端 Service 命名

```typescript
// 命名规则: {模块}Service.ts
authService.ts      // 认证
postService.ts      // 文章
categoryService.ts  // 分类
tagService.ts       // 标签
mediaService.ts     // 媒体
analyticsService.ts // 统计
```

---

## 5. 数据流约束

### 5.1 前端数据流
```
Page/Component
    ↓ 调用
Service (axios)
    ↓ 请求
/api 代理
    ↓ 转发
Backend API
```

### 5.2 后端数据流
```
Handler (HTTP 入口, Echo context)
    ↓ 调用
Service (业务逻辑)
    ↓ 调用
Repository (sqlx 数据访问)
    ↓ 操作
Database (PostgreSQL / Redis)
```

---

## 6. 命名规范

### 6.1 前端
| 类型 | 规范 | 示例 |
|:-----|:-----|:-----|
| 页面组件 | PascalCase + Page | `DashboardPage.tsx` |
| 普通组件 | PascalCase | `PostCard.tsx` |
| Hooks | camelCase + use | `useDebounce.ts` |
| Service | camelCase + Service | `postService.ts` |
| Store | camelCase + Store | `authStore.ts` |
| 类型 | PascalCase | `Post`, `CreatePostRequest` |

### 6.2 后端
| 类型 | 规范 | 示例 |
|:-----|:-----|:-----|
| Handler | PascalCase + Handler | `PostHandler` |
| Service | PascalCase + Service | `PostService` |
| Repository | PascalCase + Repo | `PostRepo` |
| 模型 | PascalCase | `Post` |
| 请求 DTO | PascalCase + Request | `CreatePostRequest` |
| 响应 DTO | PascalCase + Response | `PostDetailResponse` |

---

## 7. 禁止事项 ⛔

1. **禁止在 apps/ 中重复创建 UI 组件** - 使用 `@aetherblog/ui`
2. **禁止跨模块直接导入** - 使用 workspace 依赖
3. **禁止在 Handler 中写业务逻辑** - 放入 Service
4. **禁止在 Repository 中包含业务逻辑**
5. **禁止硬编码配置** - 使用环境变量/config 包
6. **禁止使用浏览器原生 confirm/alert** - 使用共享 Modal 组件

---

## 8. 配置文件规范

### 8.1 tsconfig.json 规范

**packages/ 下的子包：**
- ❌ **禁止** 使用 `"extends": "../../tsconfig.json"` 引用根目录配置（根目录没有 tsconfig.json）
- ✅ **必须** 使用完整独立的 tsconfig 配置

**标准 packages/ 子包 tsconfig.json 模板：**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"]
}
```

### 8.2 其他配置约束

| 配置 | 位置 | 说明 |
|:-----|:-----|:-----|
| `package.json` | 每个包独立 | 必须有 `main`, `types`, `exports` |
| `tsconfig.json` | 每个包独立 | 不能依赖根目录配置 |
| `tailwind.config` | 仅 apps/ | packages/ 不需要 |
| `vite.config` | 仅 apps/ | packages/ 作为源码直接引用 |

### 8.3 编辑 packages/ 时的检查清单
- [ ] tsconfig.json 是独立配置，不 extends 根目录
- [ ] package.json 有正确的 main/types/exports
- [ ] index.ts 导出路径与实际文件位置匹配

---

## 9. 依赖管理规范 (Monorepo)

### 9.1 packages/ 子包依赖声明原则

> ⚠️ **强制规则**：每个 packages/ 子包必须在自己的 package.json 中**显式声明所有使用的依赖**

**禁止的做法 ❌**
```json
// packages/editor/package.json
{
  "dependencies": {
    // 缺少 marked 依赖，但代码中使用了 import { marked } from 'marked'
    // 这会报错 "Failed to resolve import"
  }
}
```

**正确的做法 ✅**
```json
// packages/editor/package.json
{
  "dependencies": {
    "@codemirror/lang-markdown": "^6.2.0",
    "@uiw/react-codemirror": "^4.21.0",
    "marked": "^12.0.0",    // 显式声明
    "lucide-react": "^0.469.0"  // 显式声明
  }
}
```

### 9.2 依赖类型说明

| 类型 | 用途 | 示例 |
|:-----|:-----|:-----|
| `dependencies` | 运行时依赖 | marked, axios, lodash |
| `peerDependencies` | 宿主环境提供 | react, react-dom |
| `devDependencies` | 开发时依赖 | typescript, @types/* |

### 9.3 新增 import 时的检查流程

当在 packages/ 子包中添加新的 import 时：
1. 检查 package.json 是否已有该依赖
2. 如果没有，**立即添加**到 dependencies
3. 运行 `pnpm install` 安装
4. 确认安装成功后再继续开发

### 9.4 常见隐式依赖陷阱

❌ 以下依赖**不会**自动传递，必须显式声明：
- 根目录的依赖
- 其他 packages/ 子包的依赖
- apps/ 的依赖

✅ 只有 `workspace:*` 引用的包会正确链接

---

## 10. 2026-02-08 结构同步记录 (v1.2.1)

### 10.1 Admin `src/` 结构快照
```text
src/
├── components/
├── hooks/
├── lib/
├── pages/
│   ├── ai-config/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── utils/
│   ├── media/
│   │   └── components/
│   └── ...
├── services/
├── stores/
└── types/
```

### 10.2 本次结构结论
- 未新增目录层级。
- 已将媒体模块多处深层相对路径导入改为 `@/services/*`。

### 10.3 CHANGELOG
- Changed: 目录树无新增；完成导入路径规范化（别名统一）。

---

## 11. 2026-02-27 结构同步记录 (v1.2.2)

### 11.1 Blog 结构与路径规范更新
- `apps/blog` 实际采用根级 `app/` 目录而非 `src/app/`，文档已按真实结构修正。
- `apps/blog/tsconfig.json` 别名更新为 `@/* -> ./*`，用于统一前台模块导入。

### 11.2 本次结构结论
- 未新增目录层级。
- 已将 `apps/blog/app/posts/(article)/[slug]/page.tsx` 的深层相对路径导入替换为 `@/app/*`。

### 11.3 CHANGELOG
- Changed: Blog 结构树与 alias 规则同步到仓库现状。
- Fixed: 消除文章详情页 `../../../` 深层相对导入偏差。

---

## 12. 2026-04-04 结构同步记录 (v1.2.3)

### 12.1 本次更新内容
- 新增 `apps/ai-service/` 至项目总体架构树（Python FastAPI + LiteLLM，端口 8000）。
- 新增 `nginx/` 目录至项目总体架构树。
- 共享包导出清单精确化：`@aetherblog/ui` 13个组件，`@aetherblog/hooks` 16个hook+1组件。
- Admin `pages/` 目录树扩充：新增 `ai-tools/`（6个工具页）、`posts/components/`（8个编辑器组件）、`media/components/`（15个组件）的完整列表。
- Blog `components/` 目录：补充15+个实际组件文件名。
- 后端模块补充：新增 §3.2 已实现模块列表（23个 Handler）。
- 修正 §5.2 后端数据流：移除 Java/JPA 残留描述，改为 Go/sqlx 正确表述。

### 12.2 CHANGELOG
- Added: `apps/ai-service/` 结构说明。
- Added: 后端 24 个 Handler 模块列表（含 ShareHandler、SearchHandler）。
- Changed: 共享包导出精确列举（UI 15个，Hooks 16个）。
- Changed: Admin `pages/` 目录树精确化（ai-tools, posts/components, media/components）。
- Fixed: 后端数据流描述移除 Java/JPA 遗留，改为 Go/sqlx。
