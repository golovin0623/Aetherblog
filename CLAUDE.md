# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AetherBlog** is an intelligent blog system combining AI capabilities with modern web technologies. It follows a "Cognitive Elegance" design philosophy inspired by high-end SaaS products (Linear, Raycast) and atmospheric web design (Vercel).

**Tech Stack:**
- Frontend: React 19, Next.js 15 (blog), Vite (admin)
- Backend: Spring Boot 3.4, JDK 21
- AI: 独立 AI 服务 (FastAPI + LiteLLM)
- Database: PostgreSQL 17 with pgvector
- Cache: Redis 7
- Search: Elasticsearch 8

## Development Commands

### Frontend (pnpm workspace)

```bash
# Install dependencies
pnpm install

# Development
pnpm dev:blog          # Start blog frontend (Next.js) on :3000
pnpm dev:admin         # Start admin dashboard (Vite) on :5173
pnpm dev               # Alias for dev:admin

# Build
pnpm build             # Build all packages
pnpm build:blog        # Build blog only
pnpm build:admin       # Build admin only

# Linting
pnpm lint              # Lint all packages

# Clean
pnpm clean             # Remove all node_modules and build artifacts
```

### Backend (Maven multi-module)

```bash
cd apps/server

# Build (from server directory)
mvn clean install              # Build all modules
mvn clean install -DskipTests  # Build without tests

# Run (only aetherblog-app has executable JAR)
mvn spring-boot:run -pl aetherblog-app

# Run specific module tests
mvn test -pl blog-service
```

### Docker & Infrastructure

```bash
# Start middleware only (PostgreSQL, Redis)
docker compose up -d

# View middleware logs
docker compose logs -f

# Stop middleware
docker compose down
```

### One-Command Startup

```bash
# Development mode (direct port access)
./start.sh

# Development with gateway (test routing, keep hot reload)
./start.sh --gateway

# Production mode (unified gateway entry :7899)
./start.sh --prod

# Stop application services (keep middleware running)
./stop.sh

# Stop everything including middleware
./stop.sh --all
```

**Development mode URLs:**
- Blog: http://localhost:3000
- Admin: http://localhost:5173
- Backend API: http://localhost:8080/api

**Production mode URL:**
- Gateway: http://localhost:7899 (routes to all services)

## Architecture

### Monorepo Structure

```
AetherBlog/
├── apps/
│   ├── blog/          # Next.js 15 blog frontend
│   ├── admin/         # Vite + React 19 admin dashboard
│   ├── ai-service/    # 🤖 External AI service (FastAPI + LiteLLM)
│   └── server/        # Spring Boot backend (multi-module Maven)
│       ├── aetherblog-app/      # 🚀 Executable entry point (main class)
│       ├── aetherblog-api/      # API interfaces, DTOs, VOs
│       ├── aetherblog-common/   # Common modules (POM aggregator)
│       │   ├── common-core/     # Core utilities, R response
│       │   ├── common-security/ # JWT, SecurityConfig
│       │   ├── common-redis/    # Redis configuration
│       │   └── common-log/      # Logging
│       ├── aetherblog-service/  # Business services (POM aggregator)
│       │   └── blog-service/    # Blog core service
│       └── aetherblog-ai/       # AI modules
│           ├── ai-client/       # 🆕 HTTP Client for external AI service
│           ├── ai-core/         # (Deprecated) Spring AI core
│           ├── ai-rag/          # (Deprecated) RAG module
│           ├── ai-agent/        # (Deprecated) Agent module
│           └── ai-prompt/       # (Deprecated) Prompt module
└── packages/          # Shared frontend packages
    ├── ui/            # Shared UI components
    ├── hooks/         # Shared React hooks
    ├── types/         # TypeScript type definitions
    ├── utils/         # Utility functions
    └── editor/        # Markdown editor component
```

### Backend Module Dependencies

```
aetherblog-app (executable JAR)
    ↓
aetherblog-service (blog-service)
    ↓
aetherblog-common (common-*)
    ↓
aetherblog-api (DTOs)
```

**Critical constraints:**
- Only `aetherblog-app` uses `spring-boot-maven-plugin` for executable JAR
- Other modules are library JARs
- `common` modules cannot depend on `service` modules
- `api` module has no dependencies on other internal modules

### Frontend Package System

**Workspace packages** (use `workspace:*` protocol):
- `@aetherblog/ui` - All UI components (Button, Card, Modal, Toast, etc.)
- `@aetherblog/hooks` - Shared hooks (useDebounce, useApi, etc.)
- `@aetherblog/types` - TypeScript types (Post, User, Category, etc.)
- `@aetherblog/utils` - Utilities (cn, formatDate, etc.)
- `@aetherblog/editor` - Markdown editor

**Import pattern:**
```typescript
import { Button, Card } from '@aetherblog/ui';
import { useDebounce } from '@aetherblog/hooks';
import type { Post } from '@aetherblog/types';
import { cn } from '@aetherblog/utils';
```

**CRITICAL: Dependency Management**
- Each `packages/*` subdirectory MUST declare ALL dependencies in its own `package.json`
- Dependencies are NOT inherited from root or other packages
- When adding new imports, immediately add the dependency to that package's `package.json`
- Run `pnpm install` after adding dependencies

**CRITICAL: TypeScript Configuration**
- Each `packages/*` subdirectory MUST have a complete standalone `tsconfig.json`
- DO NOT use `"extends": "../../tsconfig.json"` (root has no tsconfig)
- Use the standard template from `.agent/rules/code-structure.md` §8.1

## API Structure

### Backend API Endpoints

| Module | Prefix | Example |
|--------|--------|---------|
| Auth | `/v1/auth/*` | `/v1/auth/login` |
| Public | `/v1/public/*` | `/v1/public/posts` |
| Admin | `/v1/admin/*` | `/v1/admin/posts` |
| AI | `/api/v1/ai/*` | `/api/v1/ai/summary` |
| Stats | `/v1/admin/stats/*` | `/v1/admin/stats/dashboard` |

### Frontend Service Layer

Services use axios and follow naming: `{module}Service.ts`
- `authService.ts` - Authentication
- `postService.ts` - Posts
- `categoryService.ts` - Categories
- `tagService.ts` - Tags
- `mediaService.ts` - Media uploads
- `analyticsService.ts` - Statistics

## Design System ("Cognitive Elegance")

### UI Philosophy
- **Keywords:** Ethereal, Professional, Depth, Fluidity
- **Style:** High-end SaaS (Linear, Raycast) + Atmospheric Web (Vercel)
- **Default:** Dark mode with rich ambient gradients
- **Brand:** Understated luxury, avoid "gamified" neon, prefer aurora-like soft glow

### Color Palette (Dark Theme)
- **Background:** `#09090b` (Zinc-950) or `#0a0a0c`
- **Card layer 1:** `bg-white/5` or `bg-black/40`
- **Card layer 2:** `bg-white/10`
- **Borders:** `border-white/5` or `border-white/10` (subtle)
- **Accent:** `from-indigo-500 to-purple-600` (Aether gradient)
- **Text:** Titles `text-white`, body `text-slate-400`, highlight `text-slate-200`

### Component Patterns

**Glass Cards (standard container):**
```tsx
<div className="relative bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden">
  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
  <div className="relative z-10">
    {/* Content */}
  </div>
</div>
```

**Ambient Backgrounds (page-level):**
```tsx
<div className="absolute inset-0 overflow-hidden pointer-events-none">
  <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse" />
  <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[100px]" />
</div>
```

### Animation Standards (Framer Motion)
- Use spring physics or custom bezier: `transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}`
- List items must use stagger animations
- Hover effects: subtle lift `y: -2` or scale `scale: 1.01`

### Loading Experience
- **FORBIDDEN:** Simple spinners (full-screen or partial)
- **REQUIRED:** Skeleton screens matching final layout with shimmer/pulse effect
- **Colors:** `bg-white/5` with subtle borders
- **Goal:** Zero-latency perception, no content jump

### Component Location Rules
**MUST use `packages/ui` for:**
- All UI components (Button, Card, Modal, Toast, Input, etc.)
- Any component used in multiple apps

**apps/ directories only for:**
- Page components
- Layout components
- Business-specific components

**FORBIDDEN:**
- Creating duplicate UI components in `apps/admin` or `apps/blog`
- Using browser native `confirm`/`alert` (use shared Modal)

## Naming Conventions

### Frontend
- Page components: `PascalCase + Page` (e.g., `DashboardPage.tsx`)
- Components: `PascalCase` (e.g., `PostCard.tsx`)
- Hooks: `camelCase + use` (e.g., `useDebounce.ts`)
- Services: `camelCase + Service` (e.g., `postService.ts`)
- Stores: `camelCase + Store` (e.g., `authStore.ts`)
- Types: `PascalCase` (e.g., `Post`, `CreatePostRequest`)

### Backend
- Controllers: `PascalCase + Controller` (e.g., `PostController.java`)
- Service interfaces: `PascalCase + Service` (e.g., `PostService.java`)
- Service implementations: `PascalCase + ServiceImpl` (e.g., `PostServiceImpl.java`)
- Repositories: `PascalCase + Repository` (e.g., `PostRepository.java`)
- Entities: `PascalCase` (e.g., `Post.java`)
- Request DTOs: `PascalCase + Request` (e.g., `CreatePostRequest.java`)
- Response DTOs: `PascalCase + Response` (e.g., `PostDetailResponse.java`)

## Development Workflow Principles

### Agent Behavior Standards (from `.agent/rules/behavior_rules.md`)

**Full Ownership Principle:**
- DO NOT transfer operational burden to users
- ❌ Wrong: Ask user to manually restart services, compile, clear cache
- ✅ Right: Automatically call `./start.sh` or `docker restart` when needed
- Only request user help when AI lacks permissions (e.g., sudo password)

**Definition of Done:**
- Delivery means verification
- Before notifying user, ensure environment is ready
- "Please verify" implies services are already successfully restarted and running

### Document-Driven Development

This project follows a strict document-driven workflow defined in `.agent/rules/code-design.md`. When working on features:

1. **Task Locking:** Identify relevant design document sections (§X.X)
2. **Document Retrieval:** Extract design requirements, data structures, API definitions
3. **Solution Evaluation:** If proposing optimizations, must submit formal optimization request
4. **Implementation:** Code must reference design docs with `// ref: §X.X` comments
5. **Documentation Sync:** Update design docs when approved changes are made
6. **Completion Report:** Provide detailed task completion summary

Reference the detailed design document: `系统需求企划书及详细设计.md`

## Docker Deployment

### Build Images
```bash
# Parallel build and push (recommended)
./docker-build.sh --push --version v1.1.1

# Sequential build (unstable network)
./docker-build.sh --push --sequential --version v1.1.1

# Build single image
./docker-build.sh --only backend --push
./docker-build.sh --only blog --push
./docker-build.sh --only admin --push
```

### Production Deployment
```bash
# Configure environment
cp .env.example .env
# Edit .env with your settings

# Pull and start
export DOCKER_REGISTRY=golovin0623
export VERSION=v1.1.2
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

### Port Mapping (Production)
- Gateway (unified entry): 7899
- Blog frontend: 7893 (optional direct access)
- Admin dashboard: 7894 (optional direct access)
- PostgreSQL: 7895
- Backend API: Internal only (container network)

## Common Issues

### Port Conflicts from Docker
If `./start.sh` reports "port already allocated":
```bash
# Clean up exited containers
docker compose down --remove-orphans
./start.sh
```

### Maven Build Issues
```bash
cd apps/server
./mvnw clean install -DskipTests
```

### Frontend Package Errors
If seeing "Failed to resolve import":
1. Check if dependency is declared in that package's `package.json`
2. Add missing dependency
3. Run `pnpm install`

## Environment Variables

See `.env.example` for all configuration options:
- `GATEWAY_PORT` - Unified gateway port (default: 7899)
- `POSTGRES_PASSWORD` - Database password
- `REDIS_HOST`, `REDIS_PORT` - Redis connection
- `OPENAI_API_KEY` - AI functionality

## Default Credentials

**Admin Dashboard:**
- Username: `admin`
- Password: `admin123` (must change on first login)

To reset password manually:
```sql
UPDATE users SET password_hash = '$2a$10$8.UnVuG9HHgffUDAlk8q2OuVGkqBKkjJRqdE7z6OcExSqz8tRdByW' WHERE username = 'admin';
-- Password becomes: 123456
```

## Custom Slash Commands (Skills)

| Command | Description |
|---------|-------------|
| `/doc` | 执行最严苛的质量控制与文档同步流程，确保代码、文档与设计一致性。 |
