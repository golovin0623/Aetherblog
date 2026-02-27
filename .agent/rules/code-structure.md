# AetherBlog 项目结构规范

> 本文档定义项目目录结构、模块依赖关系和代码组织约束。**开发前必读**。

---

## 1. 项目总体架构

```
AetherBlog/
├── apps/                          # 📱 应用层
│   ├── blog/                      #    └─ 博客前台 (Next.js 15)
│   ├── admin/                     #    └─ 管理后台 (Vite + React 19)
│   └── server/                    #    └─ 后端服务 (Spring Boot 3.4)
│
├── packages/                      # 📦 共享包 (Monorepo)
│   ├── ui/                        #    └─ 通用 UI 组件
│   ├── hooks/                     #    └─ 共享 React Hooks
│   ├── types/                     #    └─ TypeScript 类型定义
│   ├── utils/                     #    └─ 工具函数
│   └── editor/                    #    └─ Markdown 编辑器
│
├── docker-compose.yml             # 🐳 中间件编排
├── pnpm-workspace.yaml            # 📋 pnpm 工作区
└── 系统需求企划书及详细设计.md     # 📚 设计文档
```

---

## 2. 前端架构 (Monorepo)

### 2.1 共享包层 (packages/) - 必须使用

| 包名 | 用途 | 引用方式 |
|:-----|:-----|:---------|
| `@aetherblog/ui` | Button, Card, Modal, Toast 等 UI 组件 | `import { Button } from '@aetherblog/ui'` |
| `@aetherblog/hooks` | useDebounce, useApi 等 Hooks | `import { useDebounce } from '@aetherblog/hooks'` |
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
│   ├── CategoriesPage.tsx         # 分类标签
│   ├── MediaPage.tsx              # 媒体库
│   ├── CommentsPage.tsx           # 评论管理
│   ├── SettingsPage.tsx           # 系统设置
│   ├── auth/                      # 认证页面
│   ├── posts/                     # 文章子模块
│   │   ├── CreatePostPage.tsx     # 创建文章
│   │   └── EditPostPage.tsx       # 编辑文章
│   └── ai-config/                 # 🤖 AI 配置中心
│       ├── AiConfigPage.tsx       # 主页面 (三栏布局)
│       └── components/            # 独有组件 (ProviderSidebar 等)
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
│   └── tagService.ts              # 标签服务
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
│   └── __tests__/                 # 组件测试
└── lib/                           # 前台工具与 API 适配层
```

---

## 3. 后端架构 (Spring Boot Modular Monolith)

### 3.1 模块层次

```
apps/server/
├── aetherblog-app/                # 🚀 应用启动模块
│   └── AetherBlogApplication.java # 唯一启动类
│
├── aetherblog-api/                # 📦 API 接口定义
│   └── dto/                       # DTO 定义
│       ├── request/               # 请求 DTO
│       └── response/              # 响应 DTO
│
├── aetherblog-common/             # 🔧 公共模块
│   ├── common-core/               # 核心工具 (R, 异常, SlugUtils)
│   ├── common-security/           # 安全认证 (JWT, SecurityConfig)
│   ├── common-redis/              # Redis 缓存
│   └── common-log/                # 日志管理
│
├── aetherblog-service/            # 💼 业务服务
│   └── blog-service/              # 博客核心服务
│       ├── controller/            # 控制器
│       ├── service/               # 服务接口
│       │   └── impl/              # 服务实现
│       ├── repository/            # 数据访问
│       ├── entity/                # JPA 实体
│       └── config/                # 模块配置
│
└── aetherblog-ai/                 # 🤖 AI 模块
    ├── ai-core/                   # AI 核心
    ├── ai-agent/                  # AI Agent
    ├── ai-prompt/                 # Prompt 管理
    └── ai-rag/                    # RAG 检索
```

### 3.2 模块依赖规则

```
aetherblog-app
    ↓ 依赖
aetherblog-service (blog-service)
    ↓ 依赖
aetherblog-common (common-*)
    ↓ 依赖
aetherblog-api (DTO 定义)
```

**约束**:
- ❌ common 模块不能依赖 service 模块
- ❌ api 模块不能依赖任何其他模块
- ✅ service 模块可以依赖 common 和 api

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
Controller
    ↓ 调用
Service (接口)
    ↓ 实现
ServiceImpl
    ↓ 调用
Repository (JPA)
    ↓ 操作
Database
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
| 控制器 | PascalCase + Controller | `PostController.java` |
| 服务接口 | PascalCase + Service | `PostService.java` |
| 服务实现 | PascalCase + ServiceImpl | `PostServiceImpl.java` |
| 仓库 | PascalCase + Repository | `PostRepository.java` |
| 实体 | PascalCase | `Post.java` |
| 请求 DTO | PascalCase + Request | `CreatePostRequest.java` |
| 响应 DTO | PascalCase + Response | `PostDetailResponse.java` |

---

## 7. 禁止事项 ⛔

1. **禁止在 apps/ 中重复创建 UI 组件** - 使用 `@aetherblog/ui`
2. **禁止跨模块直接导入** - 使用 workspace 依赖
3. **禁止在 Controller 中写业务逻辑** - 放入 Service
4. **禁止在 common 模块中引用 service 模块**
5. **禁止硬编码配置** - 使用 application.yml
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
