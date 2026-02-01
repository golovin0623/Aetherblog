---
trigger: always_on
---

## 📦 依赖管理清单

### 前端依赖 (packages.json)

```json
{
  "核心框架": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next": "^15.0.0"
  },
  "构建工具": {
    "vite": "^5.4.0",
    "typescript": "^5.4.0",
    "turbo": "^2.0.0"
  },
  "UI与样式": {
    "tailwindcss": "^4.0.0",
    "@radix-ui/react-*": "latest",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0"
  },
  "动画": {
    "framer-motion": "^11.0.0"
  },
  "状态管理": {
    "zustand": "^4.5.0",
    "@tanstack/react-query": "^5.28.0"
  },
  "编辑器": {
    "@uiw/react-md-editor": "^4.0.0",
    "shiki": "^1.1.0",
    "katex": "^0.16.0",
    "mermaid": "^10.8.0"
  },
  "工具": {
    "date-fns": "^3.3.0",
    "lucide-react": "^0.344.0",
    "sonner": "^1.4.0"
  },
  "HTTP": {
    "axios": "^1.6.0"
  }
}
```

### AI 服务依赖 (requirements.txt)

```text
# Web 框架
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
python-multipart>=0.0.9

# AI 模型与路由
litellm>=1.30.0
openai>=1.14.0
tiktoken>=0.6.0

# RAG & 数据处理
llama-index>=0.10.0
langchain>=0.1.0  # 可选，视具体 Agent 需求

# 数据库
asyncpg>=0.29.0
sqlalchemy>=2.0.0
pgvector>=0.2.0
redis>=5.0.0

# 工具
pydantic>=2.6.0
pydantic-settings>=2.2.0
httpx>=0.27.0
tenacity>=8.2.0
```

### 后端依赖 (pom.xml)

```xml
<!-- 核心框架 -->
<spring-boot.version>4.0.0</spring-boot.version>
<java.version>25</java.version>

<!-- Spring 生态 -->
<spring-cloud.version>2024.0.0</spring-cloud.version>

<!-- 数据库 -->
<postgresql.version>42.7.1</postgresql.version>
<mybatis-plus.version>3.5.5</mybatis-plus.version>

<!-- 安全 -->
<jjwt.version>0.12.5</jjwt.version>

<!-- 工具 -->
<mapstruct.version>1.5.5.Final</mapstruct.version>
<lombok.version>1.18.30</lombok.version>
<hutool.version>5.8.25</hutool.version>

<!-- API文档 -->
<springdoc.version>2.3.0</springdoc.version>

<!-- 云存储 -->
<cos-java-sdk.version>5.6.169</cos-java-sdk.version>
<minio.version>8.5.7</minio.version>
```

---

## 🔧 环境要求

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         开发环境要求                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  必需软件:                                                               │
│  ├─ Node.js          >= 20.0.0 (LTS)                                    │
│  ├─ pnpm             >= 8.15.0                                          │
│  ├─ JDK              == 25 (Eclipse Temurin 推荐)                       │
│  ├─ Python           >= 3.12 (AI Service)                               │
│  ├─ Maven            >= 3.9.0                                           │
│  ├─ Docker           >= 24.0.0                                          │
│  ├─ Docker Compose   >= 2.24.0                                          │
│  └─ Git              >= 2.40.0                                          │
│                                                                         │
│  IDE 推荐:                                                               │
│  ├─ 前端: VS Code + 扩展包                                               │
│  │   ├─ ESLint                                                          │
│  │   ├─ Prettier                                                        │
│  │   ├─ Tailwind CSS IntelliSense                                       │
│  │   ├─ TypeScript Vue Plugin                                           │
│  │   └─ Error Lens                                                      │
│  └─ 后端: IntelliJ IDEA Ultimate                                        │
│      ├─ Spring Boot 插件                                                 │
│      ├─ Lombok 插件                                                      │
│      └─ Database Tools                                                  │
│                                                                         │
│  数据库 (Docker):                                                        │
│  ├─ PostgreSQL 17 + pgvector                                            │
│  ├─ Redis 7.2+                                                          │
│  └─ Elasticsearch 8.x (可选)                                            │
│                                                                         │
│  AI 服务:                                                                │
│  ├─ OpenAI API Key (GPT-4o)                                             │
│  └─ 或其他兼容模型 (DeepSeek, 通义千问等)                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🚨 异常处理流程

### 遇到阻塞问题时

```
⚠️ 任务阻塞报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【任务】[任务ID] [任务名称]
【阻塞类型】技术问题 / 依赖问题 / 文档不明确 / 环境问题

【问题描述】
[详细描述遇到的问题]

【已尝试方案】
1. [方案1] - 结果: ...
2. [方案2] - 结果: ...

【需要支持】
- [ ] 技术指导
- [ ] 文档澄清
- [ ] 依赖解决
- [ ] 环境配置

【影响评估】
- 阻塞时长: [预估]
- 影响范围: [后续哪些任务受影响]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏳ 等待解决...
```

### 文档缺失/不明确时

```
❓ 文档澄清请求 #[序号]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【涉及章节】§X.X [章节名]
【当前任务】[任务ID] [任务名称]

【问题】
[需要澄清的内容]

【当前文档内容】
> [引用现有文档]

【疑问点】
1. [具体问题1]
2. [具体问题2]

【我的理解/假设】
[如果没有澄清，我计划这样处理...]

【请确认或补充】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 📝 代码规范速查

### TypeScript/React 规范

```typescript
// ✅ 文件头注释 (必须)
/**
 * @file PostCard.tsx
 * @description 文章卡片组件
 * @ref §3.2 - 核心组件设计
 * @author AI Assistant
 * @created 2025-01-XX
 */

// ✅ 组件定义
interface PostCardProps {
  /** 文章数据 */
  post: Post;
  /** 卡片变体 */
  variant?: 'default' | 'featured' | 'compact';
}

/**
 * 文章卡片组件
 * 
 * @description 展示文章摘要信息的卡片组件，支持多种样式变体
 * @ref §3.2 - PostCard设计规范
 */
export const PostCard: React.FC<PostCardProps> = ({
  post,
  variant = 'default',
}) => {
  // 实现...
};

// ✅ 命名规范
// - 组件: PascalCase (PostCard, AiAssistant)
// - Hooks: camelCase + use前缀 (usePostList, useAuth)
// - 工具函数: camelCase (formatDate, parseMarkdown)
// - 常量: UPPER_SNAKE_CASE (API_BASE_URL, MAX_RETRY)
// - 类型/接口: PascalCase + 后缀 (PostProps, UserState)
```

### Java/Spring 规范

```java
/**
 * 文章服务实现类
 *
 * @author AI Assistant
 * @since 1.0.0
 * @see §4.3 - 业务服务实现
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PostServiceImpl implements PostService {

    private final PostRepository postRepository;
    private final CacheService cacheService;
    
    /**
     * 获取文章详情
     *
     * @param idOrSlug 文章ID或Slug
     * @return 文章详情
     * @throws BusinessException 当文章不存在时
     * @ref §7.2 - 文章详情接口
     */
    @Override
    @Transactional(readOnly = true)
    public PostDetailResponse getPostDetail(String idOrSlug) {
        // 实现...
    }
}

// ✅ 命名规范
// - 类: PascalCase (PostService, UserController)
// - 方法: camelCase (getPostDetail, createUser)
// - 常量: UPPER_SNAKE_CASE (MAX_PAGE_SIZE)
// - 包: lowercase (com.aetherblog.blog.service)
```

---
## 🌐 API URL 配置规范 (重要!)

### 问题背景
在 Docker 生产环境中，前端应用可能同时运行在：
- **服务端 (SSR)**: Docker 容器内部，可访问 `http://backend:8080`
- **客户端 (浏览器)**: 用户设备，只能访问公网域名

**如果客户端代码使用 Docker 内部地址，会导致**:
- `Mixed Content` 错误 (HTTPS 页面请求 HTTP 资源)
- `ERR_NAME_NOT_RESOLVED` 错误 (浏览器无法解析 Docker 内部域名)

### ✅ 正确做法

#### Next.js (Blog 前端)
```typescript
// app/lib/api.ts - 统一 API 配置
const isServer = typeof window === 'undefined';
const API_BASE_URL = isServer 
  ? (process.env.API_URL || 'http://localhost:8080')
  : '';  // 客户端使用空字符串 = 相对路径

export const API_ENDPOINTS = {
  posts: `${API_BASE_URL}/api/v1/public/posts`,
};
```

#### Vite (Admin 前端)
```typescript
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';  // 默认相对路径
```

### ❌ 禁止做法
```typescript
// ❌ 永远不要在客户端代码中硬编码后端地址
const API = 'http://backend:8080/api';  // 浏览器无法解析
const API = 'http://localhost:8080/api'; // 生产环境无法访问
```
