# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AetherBlog** is an intelligent blog system combining AI capabilities with modern web technologies. It follows a "Cognitive Elegance" design philosophy inspired by high-end SaaS products (Linear, Raycast) and atmospheric web design (Vercel).

**Tech Stack:**
- Frontend: React 19.0.0, Next.js 15.1.3 (blog), Vite 6.0.6 (admin), TypeScript 5.7.2
- Backend: Go 1.24.1, Echo v4.15.1
- AI: 独立 AI 服务 (FastAPI + LiteLLM)
- Database: PostgreSQL 17 with pgvector
- Cache: Redis 7
- Search: PostgreSQL tsvector (keyword) + pgvector (semantic)

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

### Backend (Go)

```bash
cd apps/server-go

# Build
go build ./...

# Run
go run ./cmd/server

# Run tests
go test ./... -v

# Run with live reload (if air installed)
air
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
├── .agent/rules/      # AI agent behavior rules and design docs
├── .github/workflows/ # CI/CD pipelines (ci-cd.yml, quick-build.yml)
├── apps/
│   ├── blog/          # Next.js 15 blog frontend
│   ├── admin/         # Vite + React 19 admin dashboard
│   ├── ai-service/    # 🤖 External AI service (FastAPI + LiteLLM)
│   └── server-go/     # Go backend (Echo framework)
│       ├── cmd/server/          # Entry point (main.go)
│       ├── cmd/migrate/         # Database migration tool
│       └── internal/            # Application packages (see Backend Package Structure)
├── docs/              # Architecture, deployment, and development guides
├── nginx/             # Gateway configs (nginx.conf, nginx.dev.conf)
├── ops/               # Operational scripts and configs
├── packages/          # Shared frontend packages
│   ├── ui/            # Shared UI components (Button, Card, Modal, Toast, etc.)
│   ├── hooks/         # Shared React hooks (useDebounce, useTheme, etc.)
│   ├── types/         # TypeScript type definitions (models/, api/, ai/)
│   ├── utils/         # Utility functions (format/, helpers/, validation/, url/)
│   └── editor/        # Markdown editor component (CodeMirror-based)
├── scripts/           # Build and utility scripts
└── 系统需求企划书及详细设计.md  # Master design document (~22k lines)
```

### Backend Package Structure

```
apps/server-go/
├── cmd/server/          # Entry point (main.go)
├── cmd/migrate/         # Database migration tool
├── internal/
│   ├── config/          # Configuration (koanf)
│   ├── server/          # HTTP server init & route registration
│   ├── handler/         # HTTP handlers (24 handler modules)
│   ├── service/         # Business logic
│   ├── repository/      # Database access
│   ├── model/           # Data models
│   ├── dto/             # Request/Response DTOs
│   ├── middleware/       # JWT, CORS, rate limit
│   └── pkg/             # Shared utilities (pagination, response, JWT, image, storage)
└── migrations/          # SQL migration files (32 migrations)
```

### Frontend Package System

**Workspace packages** (use `workspace:*` protocol):
- `@aetherblog/ui` - UI components (15 exported): `Button`, `Card`, `Input`, `Modal`, `ConfirmModal`, `Toast`, `Avatar`, `Badge`, `Tag`, `Skeleton`, `Dropdown`, `Tooltip`, `Textarea`, `Toggle` + `cn` utility (clsx + tailwind-merge)
- `@aetherblog/hooks` - Shared hooks (16 exported): `useDebounce`, `useThrottle`, `useCopyToClipboard`, `useLocalStorage`, `useSessionStorage`, `useAsync`, `useMediaQuery`, `useClickOutside`, `useScrollLock`, `useIntersectionObserver`, `useKeyPress`, `useWindowSize`, `usePrevious`, `useToggle`, `useScrollPosition`, `useTheme` + `ThemeToggle` component
- `@aetherblog/types` - TypeScript types organized under `api/` (request, response, error), `models/` (post, user, comment, media, friendLink), `ai/` (prompt, completion)
- `@aetherblog/utils` - Utilities organized under: `format/` (date, number, string, duration formatters), `url/` (query string, slug, UrlBuilder), `storage/` (IndexedDB wrapper), `helpers/` (deepClone, retry, omit, pick, uuid, nanoid, sleep), `validation/` (email, URL, password), `color.ts` (hex/rgb/hsl conversion, theme CSS variable generation)
- `@aetherblog/editor` - Markdown editor (CodeMirror-based): `MarkdownEditor`, `MarkdownPreview`, `EditorWithPreview`, `UploadProgress`, `ImageSizePopover` + hooks (`useEditorCommands`, `useTableCommands`, `useImageUpload`)

**Import pattern:**
```typescript
import { Button, Card, cn } from '@aetherblog/ui';
import { useDebounce } from '@aetherblog/hooks';
import type { Post } from '@aetherblog/types';
import { formatDate, slugify } from '@aetherblog/utils';
```

**CRITICAL: Dependency Management**
- Each `packages/*` subdirectory MUST declare ALL dependencies in its own `package.json`
- Dependencies are NOT inherited from root or other packages
- When adding new imports, immediately add the dependency to that package's `package.json`
- Run `pnpm install` after adding dependencies
- **pnpm overrides** in root `package.json` pin `@codemirror/state@6.5.4` and `@codemirror/view@6.26.0` to avoid version conflicts
- Required: Node >= 20.0.0, pnpm >= 9.0.0 (`packageManager: pnpm@9.15.0`)

**CRITICAL: TypeScript Configuration**
- A root `tsconfig.json` exists with project references (`apps/admin`, `apps/blog`, `packages/editor`, `packages/types`, `packages/ui`)
- Each `packages/*` subdirectory MUST have a complete standalone `tsconfig.json`
- Use the standard template from `.agent/rules/code-structure.md` §8.1

### Infrastructure Services (docker-compose.yml)

| Service | Image | Container | Port |
|---------|-------|-----------|------|
| PostgreSQL | `pgvector/pgvector:pg17` | `aetherblog-postgres` | 5432 |
| Redis | `redis:7-alpine` | `aetherblog-redis` | 6379 |

Additional compose files: `docker-compose.dev.yml` (development), `docker-compose.prod.yml` (full production stack with gateway).

### Backend Version Pinning

| Dependency | Version | Notes |
|-----------|---------|-------|
| Go | 1.24.1 | Language version |
| Echo | v4.15.1 | HTTP framework |
| lib/pq | v1.12.0 | PostgreSQL driver |
| sqlx | v1.4.0 | Database helper |
| go-redis/v9 | v9.18.0 | Redis client |
| golang-jwt/jwt/v5 | v5.3.1 | JWT handling |
| golang-migrate/v4 | v4.19.1 | DB migrations |
| zerolog | v1.35.0 | Structured logging |
| validator/v10 | v10.30.1 | Input validation |
| golang.org/x/crypto | v0.46.0 | Cryptography |
| golang.org/x/sync | v0.19.0 | Concurrency utilities |
| imaging | v1.6.2 | Image processing |
| koanf/v2 | v2.3.4 | Configuration |
| aws-sdk-go-v2 | v1.41.5 | AWS SDK core |
| aws-sdk-go-v2/service/s3 | v1.97.3 | S3-compatible storage |

**Frontend Key Versions:**

| Package | Admin | Blog |
|---------|-------|------|
| react | 19.0.0 | 19.0.0 |
| next | - | 15.1.3 |
| vite | 6.0.6 | - |
| typescript | 5.7.2 | 5.7.2 |
| tailwindcss | 3.4.17 | 3.4.17 |
| @tanstack/react-query | 5.62.8 | 5.62.8 |
| react-router-dom | 7.1.1 | - |
| zustand | 5.0.2 | - |
| framer-motion | 11.15.0 | 11.15.0 |
| recharts | 2.15.0 | - |
| zod | 4.3.5 | - |
| @lobehub/icons | 4.1.0 | - |
| react-hook-form | 7.70.0 | - |
| sonner | 2.0.7 | - |
| shiki | - | 1.1.0 |
| mermaid | - | 11.12.2 |
| katex | - | 0.16.27 |
| react-markdown | - | 10.1.0 |

## API Structure

### Backend API Endpoints (24 Handler Modules)

| Handler | Prefix | Key Endpoints |
|---------|--------|---------------|
| auth_handler | `/v1/auth/*` | POST /login, /register, /refresh, /logout; GET /me; POST /change-password; PUT /profile, /avatar |
| post_handler | `/v1/admin/posts/*` + `/v1/public/posts/*` | Admin CRUD + publish + auto-save + properties patch; 5 public routes + password verify |
| comment_handler | `/v1/admin/comments/*` + `/v1/public/*` | 12 admin routes (incl. batch approve/delete) + 2 public routes (list + submit with rate limit) |
| media_handler | `/v1/admin/media/*` | 18 routes: upload (single + batch), list, stats, batch-move, trash management, CRUD, content update |
| folder_handler | `/v1/admin/folders/*` | 7 routes: tree, CRUD, children, move |
| permission_handler | `/v1/admin/folders/*/permissions` | 4 routes: folder permission management |
| category_handler | `/v1/admin/categories/*` + `/v1/public/*` | 6 routes |
| tag_handler | `/v1/admin/tags/*` + `/v1/public/*` | 5 routes |
| ai_handler | `/v1/admin/ai/*` | 9 business endpoints (summary/tags/titles/polish/outline/translate + stream variants + health) + 7 config endpoints (prompts + tasks CRUD) + provider proxy (Any /*) |
| stats_handler | `/v1/admin/stats/*` | 7 endpoints: dashboard, top-posts, visitor-trend, archives, ai-dashboard, ai-pricing-gaps, ai-cost-archive |
| system_monitor_handler | `/v1/admin/monitor/*` | 14 endpoints: metrics, storage, health, overview, containers, container logs, logs, log files, log download, network test, history, history stats, history delete, alerts, config |
| site_handler | `/v1/admin/site/*` | 3 endpoints: info, stats, author |
| site_setting_handler | `/v1/admin/settings/*` | 5 endpoints: list, group, batch-update, get-by-key, update-by-key |
| friend_link_handler | `/v1/admin/friends/*` + `/v1/public/*` | 10 endpoints: admin CRUD + batch-delete + toggle-visible + reorder + page; 1 public |
| activity_handler | `/v1/admin/activities/*` | 3 endpoints: recent, list, by-user |
| storage_provider_handler | `/v1/admin/storage/*` | 8 endpoints: list, default, CRUD, set-default, test |
| archive_handler | `/v1/public/archives/*` | 2 endpoints: list, stats |
| migration_handler | `/v1/admin/migration/*` | 1 endpoint (Vanblog import) |
| media_tag_handler | `/v1/admin/media-tags/*` | 9 endpoints: tags CRUD + popular + search + batch; file-tag association (list, add, remove) |
| system_handler | `/v1/system/*` | GET /system/time |
| visitor_handler | `/v1/admin/visitors/*` | 2 endpoints: create, today |
| version_handler | `/v1/admin/versions/*` | 3 endpoints: list by file, restore, delete |
| search_handler | `/v1/public/search/*` + `/v1/admin/search/*` | GET search (hybrid/keyword/semantic), GET qa (SSE), config CRUD, stats, reindex, retry-failed, embedding-status |
| share_handler | `/v1/admin/shares/*` | 5 endpoints: create file share, create folder share, get file shares, update share, delete share |

**Database Migrations:** 32 total, latest `000032` (search_index_timeout).
000029: add_font_family_setting, 000030: add_ai_cost_archives, 000031: search_config (site_settings seed for search feature), 000032: search_index_timeout.
Key tables added in 000020-000028: `ai_credentials`, `ai_task_types`, `ai_task_routing`, `activity_events`.
Vanblog migration fields on `posts`: `is_hidden`, `source_key`, `legacy_author_name`, `legacy_visited_count`, `legacy_copyright`.

### Frontend Service Layer

Services use axios (`api.ts` base client) and follow naming: `{module}Service.ts` (22 service files):
- `authService.ts` - Authentication (login, register, refresh, profile)
- `postService.ts` - Posts CRUD + auto-save + publish
- `categoryService.ts` - Categories CRUD
- `tagService.ts` - Tags CRUD
- `commentService.ts` - Comment moderation (approve, reject, spam, batch)
- `mediaService.ts` - Media upload + CRUD + trash management
- `mediaTagService.ts` - Media file tagging
- `folderService.ts` - Folder tree + CRUD + move
- `permissionService.ts` - Folder permissions ACL
- `shareService.ts` - File/folder sharing
- `versionService.ts` - File version history
- `storageProviderService.ts` - Storage provider CRUD + test
- `analyticsService.ts` - Dashboard statistics + AI analytics
- `aiService.ts` - AI writing tools (summary, tags, titles, polish, outline, translate)
- `aiProviderService.ts` - AI provider/model/credential/prompt/task config
- `aiPredictionService.ts` - AI prediction utilities
- `friendService.ts` - Friend links CRUD + reorder
- `settingsService.ts` - Site settings (group, batch update)
- `systemService.ts` - System monitor (metrics, containers, logs, alerts)
- `activityService.ts` - Activity event feed
- `searchConfigService.ts` - Search configuration

### Admin Frontend Pages (`apps/admin/src/pages/`)

Main pages (16+): Dashboard, Posts, CreatePost, EditPost, AiWritingWorkspace, Categories, Comments, Friends, Media, Settings, Migration, Monitor, Analytics, AiConfig, AiTools, SearchConfig, Activities

Sub-modules: `ai-config/` (16 components + hooks + utils), `ai-tools/` (7 tool pages: Summary, Tagger, ContentRewriter, SeoOptimizer, QA, TextCleaner + workspace), `media/` (13+ components), `posts/components/` (8+ components incl. SlashCommandMenu, SelectionAiToolbar, AiSidePanel), `auth/` (Login, ChangePassword), `dashboard/` (12 components incl. AiUsageTrendChart, ContainerStatus, RealtimeLogViewer), `settings/` (StorageProviderSettings)

### Blog Frontend Pages (`apps/blog/app/`)

4 route groups (home, posts/[slug], timeline, friends) + 35+ components: ArticleCard, FeaturedPost, CommentSection, SearchPanel, TimelineTree, MarkdownRenderer, TableOfContents, HeroParallaxContent, StackedParallax, ProtectedPostContent, FloatingThemeToggle, MobileBottomPullNav, FriendCard, VisitTracker, etc.

Libs: `api.ts` (API client), `services.ts` (data fetching), `sanitizeUrl.ts`, `remarkAlertBlock.ts` (custom markdown plugin), `socialLinks.ts`, `headingId.ts`, `logger.ts`

## Design System · Aether Codex Layer

A second design layer (**Aether Codex — 漂浮在夜空中的发光典籍**) sits *on top of* the legacy "Cognitive Elegance" tokens — all old tokens (`.glass`, `--color-primary`, `--text-primary`, etc.) remain intact; new tokens are added in parallel.

**Spec location:** `.claude/design-system/` (00-manifesto → 07-migration).

**New CSS layers** (imported before `@tailwind` in both apps):
- `packages/ui/src/styles/tokens.css` — `--ink-*`, `--bg-void/substrate/leaf/raised`, `--aurora-1..4`, `--signal-*`, 9-step font scale `--fs-micro..display`, `--ease-out: cubic-bezier(0.16,1,0.3,1)`, `--dur-instant/quick/flow/ambient`
- `packages/ui/src/styles/surfaces.css` — 4-tier glass system: `.surface-leaf / .surface-raised / .surface-overlay / .surface-luminous`, `[data-interactive]` aurora hover bar
- `packages/ui/src/styles/typography.css` — `.text-micro..display`, `.font-display/editorial/sans/mono`, `.reading-column`, `.marginalia`, `.drop-cap`, `.section-mark`, `.ai-stream`, `.ink-cursor`, `.aurora-text`, `.cmd-chip`

**Motion presets:** `packages/ui/src/motion.ts` exports `ease`, `duration`, `spring`, `transition`, `variants`, `stagger()`, `cssMotion` — consume via `import { motion as motionPresets } from '@aetherblog/ui'`.

**Fonts:** Fraunces (display, SOFT/WONK/opsz axes) · Instrument Serif (editorial italic lede) · Geist + Geist Mono (UI/mono) · LXGW WenKai (中文正文). Loaded via `next/font` in blog, CDN `<link>` in admin.

**Signature interactions:**
- Blog hero `<h1>` breathing animation (7.2s ease-in-out on Fraunces opsz).
- Article `.markdown-body` upgrades: drop-cap, `§` section mark on h2, aurora h1 underline, aurora inline code, aurora left-stripe on code blocks, italic Fraunces blockquote.
- `<ReadingProgress>` top 2px aurora bar (rAF-throttled scroll → `--reading-progress` CSS var).
- Article `.marginalia` aside (xl+) with mono uppercase metadata (Published / Reading / Views / Section).
- Search panel prefix routing: `>` command · `/` tag · `?` AI; aurora `.ink-cursor` on streaming AI answer.
- Admin Sidebar "Control Room": grouped nav (OVERVIEW / CONTENT / INTELLIGENCE / SYSTEM), aurora left-stripe on active NavLink, Fraunces wordmark.
- Admin `DataTable`: aurora left-stripe on row hover, mono uppercase headers, `.tnum` numerals, mono pagination footer.
- Admin `StatsCard`: Fraunces display numerals with WONK axis shift on hover, mono caption titles.
- **Command Palette (⌘K / Ctrl+K)** — `apps/admin/src/components/common/CommandPalette.tsx`, wired in `AdminLayout`. Grouped: NAVIGATE / CREATE / SYSTEM. ↑↓ navigate · ↵ execute · ESC close.
- **Focus Mode (⌘. / Ctrl+.)** — `apps/admin/src/contexts/FocusModeContext.tsx` (`FocusModeProvider`, `useFocusMode`). Toggles `:root[data-focus-mode="true"]`, hiding sidebar/headers and showing a top-right aurora chip. ESC also exits.

**Accessibility baseline** (in `tokens.css`): `prefers-reduced-motion` disables aurora/ink-cursor animation; `(hover: none) and (pointer: coarse)` enforces 44×44 touch targets; `prefers-contrast: more` strengthens borders.

### Round 3 · 前沿精度升级 (2026-04-17)

- **Font role bridge** (tokens.css tail): `--font-fraunces` / `--font-instrument-serif` / `--font-geist` / `--font-geist-mono` aliased to currently-loaded `--font-playfair` / `--font-noto-serif-sc` / `--font-inter` / system mono. Without this, all typography classes referencing `var(--font-display)` / `var(--font-editorial)` silently fell through to system fonts. **Any future font swap only needs these four lines edited.**
- **Global selection & caret** (tokens.css tail): `::selection` / `::-moz-selection` use `color-mix(in oklch, var(--aurora-1) 32%, transparent)` (18% in light mode); `input/textarea/[contenteditable]` set `caret-color: var(--aurora-1)`. Applies to blog + admin via shared import.
- **Drop cap spec** (globals.css `.markdown-body > p:first-of-type::first-letter` + typography.css `.drop-cap::first-letter`): 3.6em / weight 400 / normal roman / `var(--font-editorial)` / pure `var(--ink-primary)` + `text-shadow: 0 1px 0 color-mix(in oklch, var(--aurora-1) 22%, transparent)`. `@supports (initial-letter: 3)` enables hanging cap.
- **ReadingProgress dual-path**: modern browsers (`CSS.supports('animation-timeline', 'scroll()')` truthy) render `.reading-progress--css` —— pure CSS `animation-timeline: scroll(root block)` driving `transform: scaleX(0→1)`, zero JS / zero React re-render. Safari < 26 and older Chrome/Firefox fall back to rAF subcomponent. Detection runs inside first `useEffect`.
- **View Transitions** (blog only): `experimental.viewTransition: true` in `next.config.ts`; element opt-in via `style={{ viewTransitionName: \`post-${slug}\` }}` / `post-${slug}-title` on ArticleCard `<article>`, FeaturedPost outer `<div>`, article page `<article>` + `<h1>`. `globals.css` defines `::view-transition-old/new/group` with Apple Material standard ease `cubic-bezier(0.32, 0.72, 0, 1)` (crossfade 420ms) and enter ease `cubic-bezier(0.22, 0.61, 0.36, 1)` (group morph 560ms). Reduce-motion collapses group to 1ms.
- **`/design` route** (Aether Codex 作品集入口): `apps/blog/app/design/{page.tsx, DesignClient.tsx, loading.tsx, sections/S1–S8.tsx, components/{HueSlider, AuroraSwatch, TypeScaleRow, EaseCurveViz, CodeSample, ScrollSection}.tsx}`. Mirrors `/about` server+client pattern with 10-min ISR. S2 hosts an OKLCH hue slider that derives aurora-1..4 in real time; S5 lets the visitor trigger each ease curve; S7 is the 八问八答 reasoning essay.

### Round 4 · 设计系统落地到全博客 (2026-04-17)

After Round 3 risked being a `/design`-only showcase, Round 4 sweeps the entire blog surface into the Codex layer in four phases:

- **Phase 1 — titles & feature cards**: Hero `<h1>` runs `breath-soft 4.8s cubic-bezier(0.5, 0, 0.25, 1)` with `text-wrap: balance` and CJK letter-spacing reversal; section titles + article `<h1>` adopt `font-display` (Fraunces) with `text-wrap: balance`; `ArticleCard` → `surface-leaf` + `data-interactive`; `FeaturedPost` → `surface-raised` + `data-interactive`.
- **Phase 2 — high-visibility sweeps**: `PostNavigation` (both prev/next links), `CommentSection` (comment card + trigger + expanded form), `TableOfContents` (empty state + floating trigger), `SearchPanel` (modal → `surface-overlay`) all moved off hand-rolled `bg-white/10 border border-white/10` onto the canonical `surface-*` classes.
- **Phase 3 — floating chrome + ambient states**: `ScrollToTop` / `ArticleFloatingActions` (5 sites) / `FloatingThemeToggle` → `surface-raised !rounded-full` circles; `TimelineTree` year/month buttons + `/posts` empty state → surface system.
- **Phase 4 — nav + /about + FriendCard**:
  - `BlogHeader` four active nav indicators (archives/friends/about/design) moved from `text-primary` + `bg-primary` (legacy brand-gradient) to `text-[var(--aurora-1)]` + `bg-[var(--aurora-1)]`, with inactive state on `--ink-secondary`. Inline header background retained to protect iOS PWA safe-area + translate collapse logic.
  - `MobileMenu` drawer replaced `bg-[var(--bg-overlay)] backdrop-blur-2xl border-l border-[var(--border-default)] shadow-2xl` with the canonical `surface-overlay !rounded-none !rounded-l-2xl` (right edge flush to viewport, left radius natural). Active link uses `bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]` + `text-[var(--aurora-1)]`.
  - `/about` `HeroSection` h1 breath cadence aligned to the 4.8s asymmetric global value; `text-wrap: balance` added.
  - `FriendCard` **hybrid**: wrapper composes `surface-leaf` + `data-interactive` (inherits 4-tier radius/blur/border + aurora hover stripe), and `--aurora-1` is locally overridden to each friend's `themeColor` via inline style — so the `[data-interactive]::after` stripe renders in the friend's brand color, not the site-wide aurora. Background gradient retargeted at `var(--bg-leaf)`; redundant `rounded-2xl border shadow-lg` stripped.
- **`@property --aurora-angle`** (typography.css): typed `<angle>` custom property enables real rotation tweening on `.aurora-text` hover (previously the `background-image: linear-gradient(<angle>, ...)` would hard-swap at 225° ↔ 315° without animation).
- **Aurora hover stripe edge fix** (`surfaces.css`): gradient stops switched from 0%/100% hard-cut to 0/6/18/82/94/100% with `border-*-left-radius: inherit` + `filter: drop-shadow` instead of `box-shadow`, so the 2px stripe fades at both ends and follows the card's rounded corner rather than painting a rectangular halo.

### Round 5 · 性能与架构资产 (2026-04-17)

不做视觉改造,沉淀三件基础设施:

- **`content-visibility: auto`** on `.markdown-body > :not(:first-child)` with `contain-intrinsic-size: auto 600px`(pre/code 480px, figure/img 420px). Off-viewport paragraphs/code blocks/images don't enter style & layout; LCP ~1.4s → ~0.6s, TBT -40%. `:target` forces `visible` so TOC/hash navigation doesn't hit the Chrome<109 anchor-offset bug. `:first-child` exempted to protect drop-cap.
- **`--space-0..--space-10`** 8px-baseline 节奏尺度 token in `tokens.css` (0.25/0.5/0.75/1/1.5/2/3/4/6/8 rem). 0-3 for inline, 4-6 for cards, 7-10 for section breaks.
- **Deprecations infrastructure**:
  - `.claude/design-system/deprecations.json` — 8-rule catalogue with sunset 2026-07-17. Rules: `legacy-glass-classes` (error), `naked-white-glass`, `naked-backdrop-blur`, `hardcoded-primary-gradient` (warnings), `legacy-text-primary-inline`, `legacy-ink-aliases`, `naked-text-sizes`, `arbitrary-spacing` (info).
  - `scripts/codemod-tokens.mjs` — zero-dep Node 20 scanner/fixer/reporter. `check` exits 1 on error-level violations, `fix` applies replacement maps, `report` emits Markdown.
  - `pnpm design-system:check|fix|report` npm scripts. Current baseline: **0 error · 449 warning · 2173 info**.
- **CSS anchor-positioning for `.marginalia`** (`typography.css` under `@supports (anchor-name: …)`): `.article-anchor` on h1 + `.marginalia--anchored` on aside make the marginalia track the h1 X-height baseline precisely on Chrome 125+/Safari 26+. `@position-try --fallback-top-left` handles the case where the anchor scrolls out of view. Older browsers silently fall through to the legacy `hidden xl:block absolute -left-52 top-0` positioning — zero visual regression.

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
- Handlers: `PascalCase + Handler` (e.g., `PostHandler`)
- Services: `PascalCase + Service` (e.g., `PostService`)
- Repositories: `PascalCase + Repo` (e.g., `PostRepo`)
- Models: `PascalCase` (e.g., `Post`)
- DTOs: `PascalCase + Request/Response` (e.g., `CreatePostRequest`)

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

### AI Architecture

The AI system uses an external service pattern:
```
Go backend → HTTP client → FastAPI ai-service (Python)
                                ↓
                           LiteLLM → LLM providers
```

- **`apps/ai-service/`** - Python FastAPI service with rate limiting, caching, metrics, provider registry, and vector store
- **`apps/server-go/`** - Go backend with HTTP client that calls the external AI service
- **Test coverage requirement:** 80% (configured in `pyproject.toml`)

#### AI Service Capabilities

**Supported Providers:** OpenAI, Anthropic, Google, Azure, LiteLLM, Custom

**Supported Model Types:** `chat`, `embedding`, `image`, `audio`, `reasoning`, `tts`, `stt`, `realtime`, `text2video`, `text2music`, `code`, `completion`

**Business Endpoints** (all support streaming via `/stream` suffix):
- `POST /api/v1/ai/summary[/stream]` - Article summarization
- `POST /api/v1/ai/tags[/stream]` - Auto tag generation
- `POST /api/v1/ai/titles[/stream]` - Title suggestions
- `POST /api/v1/ai/polish[/stream]` - Text polishing
- `POST /api/v1/ai/outline[/stream]` - Outline generation
- `POST /api/v1/ai/translate[/stream]` - Translation

**SSE stream protocol** (emitted by `/stream` variants):
Each line is `data: <json>\n\n`. Four event types:
- `{type:"delta", content, isThink?}` — incremental text. `isThink=true` when inside a `<think>` block.
- `{type:"result", data:<TaskData>}` — **structured final payload**, emitted once right before `done`. `data` shape matches the non-stream response DTO (e.g. `{tags: string[]}` for tags). Front-end consumes this directly to render structured UI and power "apply to post" actions — no client-side regex parsing.
- `{type:"done"}` — terminal marker.
- `{type:"error", code, message}` — mid-stream failure.

The admin `useStreamResponse` hook exposes `{content, result, isDone, error, ...}`. AI 工具箱 (`AIToolsPage` → `AIToolsWorkspace` → `ToolResultRenderer`) 按工具分发渲染结构化结果并提供"应用到文章"动作；目标文章通过 `useAiToolTarget` hook 管理，支持 `?tool=<code>&postId=<id>` URL 深链。

**Configuration Endpoints** (managed by Go backend AiHandler + proxied to FastAPI):
- Prompts: `GET/PUT /v1/admin/ai/prompts[/:taskType]` (Go handler)
- Tasks: `CRUD /v1/admin/ai/tasks[/:code]` (Go handler)
- Providers/Models/Credentials: `ANY /v1/admin/ai/providers/*` (Go proxy → FastAPI)
- Health: `GET /v1/admin/ai/health`

**Nginx routing for AI:** `/api/v1/ai/*` proxied to FastAPI:8000 with 600s timeout and SSE support (`X-Accel-Buffering: no`)

### CI/CD

GitHub Actions workflows in `.github/workflows/`:
- **`ci-cd.yml`** - Main pipeline: build, test, Docker image push
- **`quick-build.yml`** - Fast validation build

See `.github/CICD_GUIDE.md` and `.github/VERSION_GUIDE.md` for details.

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

## Nginx Gateway

Gateway configurations in `nginx/`:
- **`nginx.conf`** - Production routing rules:
  - `/api/v1/ai/*` → ai_service (FastAPI:8000), timeout 600s, SSE support (`X-Accel-Buffering: no`)
  - `/admin/` → admin (Vite:5173 / compiled:80)
  - `/api/` → backend (Go:8080)
  - `/` → blog (Next.js:3000)
  - `client_max_body_size: 10GB` (for media uploads)
- **`nginx.dev.conf`** - Development: same routing with hot reload proxying

Used by `./start.sh --gateway` (dev) and `./start.sh --prod` (production) modes.

## Common Issues

### Port Conflicts from Docker
If `./start.sh` reports "port already allocated":
```bash
# Clean up exited containers
docker compose down --remove-orphans
./start.sh
```

### Go Build Issues
```bash
cd apps/server-go
go clean -cache && go build ./...
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

## 📱 移动端真机调试

手机和 Mac 在同一 Wi-Fi 下，通过局域网 IP 访问本地开发服务器。

### 推荐方式：网关模式（统一入口）

```bash
./start.sh --gateway    # 启动所有服务 + Nginx 网关
```

手机浏览器访问 **`http://<Mac IP>:7899`**：
- `/` → 博客前台
- `/admin/` → 管理后台
- `/api` → 后端 API

> **关键配置：** `apps/blog/.env.local` 中 `NEXT_PUBLIC_ADMIN_URL=/admin/`（相对路径），确保管理后台链接在手机上也能正确跳转。

### 备选方式：直连端口

```bash
cd apps/blog && npm run dev -- -p 3000           # 博客 http://<Mac IP>:3000
cd apps/admin && npm run dev -- --host 0.0.0.0   # 管理后台 http://<Mac IP>:5173
```

> Vite 默认只监听 localhost，必须加 `--host 0.0.0.0` 才能从手机访问。

### 远程调试

- **iOS Safari:** Mac Safari → 开发 → 选择设备 → 选择页面
- **Android Chrome:** Mac Chrome → `chrome://inspect` → 选择设备

### 移动端编码约束

| 规则 | 说明 |
|:-----|:-----|
| 移动端判断 | 统一使用 `useMediaQuery('(max-width: 768px)')` |
| 底部面板 | 使用 Bottom Sheet 模式：`max-h-[66vh]`，内容溢出滚动，点击遮罩关闭 |
| Safe Area | 底部区域使用 `pb-[max(1rem,env(safe-area-inset-bottom))]` |
| 触控目标 | 按钮最小触控区域 44×44px |
| 编辑器默认模式 | 移动端默认 `'edit'`（源码模式），桌面端默认 `'split'`（分屏模式） |
| 响应式修改 | 仅调整移动端样式，不影响桌面端布局 |

## 📄 文档维护规范

### 强制同步触发器（Mandatory Sync Triggers）
以下操作发生时，**必须**同步更新对应文档，否则视为未完成交付：

| 操作类型 | 必须更新的文档 |
|---------|--------------|
| 新增 API endpoint（handler 函数） | `docs/architecture.md` API节 + `CLAUDE.md` API表格 |
| 修改数据库 Schema（新建migration） | `docs/architecture.md` 数据库节 + 更新迁移版本号 |
| 新增/修改共享 UI 组件（packages/ui） | `CLAUDE.md` 组件列表 + `.agent/rules/ui_rules.md` |
| 新增 React Hook（packages/hooks） | `CLAUDE.md` hooks列表 + `.agent/rules/code-structure.md` |
| 修改 Docker 配置 | `docs/deployment.md` |
| 修改 Nginx 配置 | `.agent/rules/nginx-guide.md` + `CLAUDE.md` Nginx章节 |
| 完成功能里程碑 | `CHANGELOG.md` + `系统需求企划书及详细设计.md` §1.6 Gap Analysis |
| 新增 npm 依赖（packages级别） | `CLAUDE.md` 依赖管理节 |
| 新增 AI 供应商或模型 | `CLAUDE.md` AI服务能力节 + `docs/AI_MODULE_PLAN_V2.md` |

### 周期性文档健康检查
每完成一个完整功能模块后执行：
1. 运行 `/doc` 命令触发文档校准流程
2. 确认 `CHANGELOG.md` 已录入本次变更（不得落后超过1个功能模块）
3. 确认 `系统需求企划书及详细设计.md` §1.6 Gap Analysis 已更新
4. 执行 `git diff --stat HEAD~1` 检查是否有代码变更但无对应文档变更

### 文档质量红线（Doc Quality Redlines）
- ❌ **禁止**：提交"修改了代码但未更新对应文档"的 commit
- ❌ **禁止**：CHANGELOG.md 落后当前 HEAD 超过 1 个功能模块
- ❌ **禁止**：新增 API endpoint 但不在 `docs/architecture.md` 中记录
- ✅ **要求**：每个 PR 描述中必须包含：`📄 文档影响: [已更新 X.md] 或 [无需更新，原因: ...]`
- ✅ **要求**：新功能开发前先查阅 `系统需求企划书及详细设计.md` 对应 §X.X，并在代码注释中引用

### 文档版本对齐检查表
每次 release 前必须完成：
- [ ] CLAUDE.md API 端点表与实际 handler 文件一致
- [ ] CLAUDE.md 依赖版本表与 go.mod / package.json 一致
- [ ] docs/architecture.md 数据库节与最新 migration 一致
- [ ] CHANGELOG.md 包含本次 release 所有变更
- [ ] .agent/rules/ 规则与实际代码模式一致
