# 06 · `@aetherblog/types` 与 `@aetherblog/utils` 包

> 共享 TypeScript 模型(API / 领域 / AI)与纯函数工具(format / validate / url / storage / color / helpers)。本文档清点全部导出 + 已发现的 utils 入口冲突。

---

## 范围

- `packages/types/`(14 文件,~600 LOC,纯 TS interface)
- `packages/utils/`(21 文件,~700 LOC)
- `apps/blog/app/components/SiteSettingsProvider.tsx:5` —— utils 的核心消费点之一(`generateColorVars`)

---

## 第一部分 · `@aetherblog/types`

### 1. 包元信息

源:`packages/types/package.json` —— **5 行,极简**:

```json
{
  "name": "@aetherblog/types",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

无 `dependencies` / 无 scripts。**这是一个零运行时依赖的纯类型包**。

`tsconfig.json`:`extends: '../../tsconfig.json'` + `rootDir: 'src'` + `outDir: 'dist'` + `include: ['src/**/*']`(`packages/types/tsconfig.json`,8 行)。

### 2. types 三大命名空间

源:`packages/types/src/index.ts`

```ts
export * from './api';
export * from './models';
export * from './ai';
```

```
packages/types/src/
├── api/
│   ├── error.ts        ApiError + ApiException class
│   ├── request.ts      RequestConfig + RequestOptions
│   └── response.ts     ApiResponse<T> + PageInfo + PagedResponse<T>
│
├── models/
│   ├── post.ts         Post / PostListItem / CreatePostInput / UpdatePostInput / PostStatus / Category / Tag
│   ├── user.ts         User / LoginInput / LoginResult / RegisterInput / UserRole
│   ├── comment.ts      Comment / CreateCommentInput / CommentStatus
│   ├── media.ts        ★ 大头(280 行) Media / MediaFolder / MediaTag / StorageProvider / MediaVariant / FolderPermission / MediaShare / MediaVersion + 各 Request/枚举
│   └── friendLink.ts   FriendLink / CreateFriendLinkInput
│
└── ai/
    ├── prompt.ts       PromptTemplate / PromptVariable / PromptCategory
    └── completion.ts   CompletionRequest / CompletionResponse / StreamingChunk / TokenUsage
```

### 3. api/ 命名空间

#### 3.1 `api/response.ts` —— 后端协议契约

```ts
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
  timestamp: number;
  traceId?: string;
}

export interface PageInfo {
  page: number;
  size: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PagedResponse<T> extends ApiResponse<T[]> {
  page: PageInfo;
}
```

`ApiResponse<T>` 的 4 字段(code / message / data / timestamp)与 Echo Backend 的 `pkg/response/response.go` 一一对应。

#### 3.2 `api/error.ts` —— 异常基类

```ts
export interface ApiError {
  code: number;
  message: string;
  details?: Record<string, string[]>;
  traceId?: string;
}

export class ApiException extends Error {
  code: number;
  details?: Record<string, string[]>;
  constructor(error: ApiError) { ... }
}
```

`ApiException` 是包内唯一一个 **运行时类**(其余全是 interface)。

#### 3.3 `api/request.ts` —— 请求配置

```ts
export interface RequestConfig {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  withCredentials?: boolean;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | boolean>;
}
```

### 4. models/ 命名空间

#### 4.1 `models/post.ts`(70 行)

```ts
export type PostStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  summary?: string;
  coverImage?: string;
  status: PostStatus;
  category?: Category;
  tags: Tag[];
  viewCount: number;
  commentCount: number;
  likeCount: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PostListItem { /* 列表展示用,字段精简 */ }
export interface CreatePostInput { /* 写入用 */ }
export interface UpdatePostInput extends Partial<CreatePostInput> { id: number; }

// 前向声明
export interface Category { id: number; name: string; slug: string; description?: string; icon?: string; parentId?: number; sortOrder: number; }
export interface Tag { id: number; name: string; slug: string; color?: string; }
```

#### 4.2 `models/user.ts`(38 行)

```ts
export type UserRole = 'ADMIN' | 'AUTHOR' | 'READER';

export interface User {
  id: number;
  username: string;
  nickname: string;
  email: string;
  avatar?: string;
  bio?: string;
  roles: UserRole[];
  createdAt: string;
  updatedAt: string;
}

export interface LoginInput { username: string; password: string; rememberMe?: boolean; }
export interface LoginResult { accessToken: string; refreshToken?: string; expiresIn: number; user: User; }
export interface RegisterInput { username: string; email: string; password: string; nickname?: string; }
```

#### 4.3 `models/comment.ts`(30 行)

```ts
export type CommentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SPAM';

export interface Comment {
  id: number;
  postId: number;
  parentId?: number;
  nickname: string;
  email?: string;
  website?: string;
  avatar?: string;
  content: string;
  status: CommentStatus;
  ip?: string;
  createdAt: string;
  children?: Comment[];   // 递归嵌套
}

export interface CreateCommentInput { postId: number; parentId?: number; nickname: string; email?: string; website?: string; content: string; }
```

#### 4.4 `models/media.ts`(281 行 —— **最大文件**)

包含媒体库 6 个 Phase 的全部类型:
- **Phase 1 文件夹**:`MediaFolder` / `FolderTreeNode` / `FolderVisibility` / `CreateFolderRequest` / `UpdateFolderRequest` / `MoveFolderRequest`
- **Phase 1 存储**:`StorageType` / `Media`(扩展 `storageType` / `storageProviderId` / `cdnUrl`)
- **Phase 2 标签**:`MediaTag` / `MediaFileTag` / `TagCategory` / `TagSource` / `CreateMediaTagRequest`
- **Phase 3 提供商**:`StorageProvider` / `StorageProviderType`(LOCAL / S3 / MINIO / OSS / COS / R2)
- **Phase 4 变体**:`MediaVariant` / `VariantType`(THUMBNAIL / SMALL / MEDIUM / LARGE / WEBP / AVIF / ORIGINAL)
- **Phase 4 同步**:`SyncStatus`(NONE / PENDING / SYNCING / SYNCED / FAILED) + `Media.backupProviderId / backupUrl / backupAt`
- **Phase 5 权限**:`FolderPermission` / `PermissionLevel`(VIEW / UPLOAD / EDIT / DELETE / ADMIN)
- **Phase 5 分享**:`MediaShare` / `ShareType` / `AccessType`
- **Phase 5 版本**:`MediaVersion`

每个类型的 JSDoc 都标注 `@ref 媒体库深度优化方案 - Phase N`,便于追溯设计文档。

#### 4.5 `models/friendLink.ts`(32 行)

```ts
export interface FriendLink {
  id: number;
  name: string;
  url: string;
  logo?: string;
  description?: string;
  email?: string;
  rssUrl?: string;
  themeColor?: string;     // 默认 #6366f1 —— FriendCard 用 inline style 覆盖 --aurora-1
  isOnline?: boolean;
  sortOrder: number;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}
```

`themeColor` 是 Codex 的精彩用法:`apps/blog/app/components/FriendCard.tsx` 把 `surface-leaf + data-interactive` 的 `--aurora-1` 局部 inline 覆盖为友链品牌色,**让 hover stripe 渲染为友链品牌色而非站点统一 aurora**(参考 `07-migration.md` Round 4 phase 4)。

### 5. ai/ 命名空间

#### 5.1 `ai/completion.ts`(31 行)

```ts
export interface CompletionRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream?: boolean;
}

export interface CompletionResponse {
  id: string;
  content: string;
  finishReason: 'stop' | 'length' | 'error';
  usage: TokenUsage;
}

export interface StreamingChunk {
  id: string;
  delta: string;
  finishReason?: 'stop' | 'length' | 'error';
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

`StreamingChunk` 是 SSE 流式响应的契约 —— admin 的 AiWritingWorkspace 用 ink-bleed `<span class="delta">` 渲染。

#### 5.2 `ai/prompt.ts`(31 行)

```ts
export type PromptCategory =
  | 'TEXT_CLEANING'
  | 'REWRITING'
  | 'SUMMARIZATION'
  | 'TAGGING'
  | 'SEO'
  | 'QA'
  | 'CUSTOM';

export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  template: string;
  variables: PromptVariable[];
  category: PromptCategory;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVariable {
  name: string;
  description?: string;
  required: boolean;
  defaultValue?: string;
}
```

---

## 第二部分 · `@aetherblog/utils`

### 6. 包元信息 + 关键的 入口冲突

源:`packages/utils/package.json`

```json
{
  "name": "@aetherblog/utils",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "date-fns": "^4.1.0"
  }
}
```

仅依赖 `date-fns` —— 给 `format.ts` 和 `format/duration.ts` 用。

### 6.1 重复入口冲突(已知问题)

源:`packages/utils/src/index.ts`

```ts
export * from './format';      // ← 解析为 format.ts(单文件,优先)
export * from './validation';  // ← 子目录(format/ 同时存在)
export * from './helpers';     // ← 解析为 helpers.ts(单文件,优先)
export * from './storage';
export * from './url';
export * from './color';
```

实际目录结构:

```
packages/utils/src/
├── format.ts              ← 18 行,基础函数(formatDate, formatRelativeTime, formatNumber, formatFileSize)
├── format/                ← 目录,精细拆分
│   ├── index.ts           ← export * from './number / string / duration'
│   ├── duration.ts        ← formatDuration / formatTime / estimateReadingTime
│   ├── number.ts          ← formatNumber / formatCurrency / formatPercent / formatCompact / padZero / clamp
│   └── string.ts          ← truncate / capitalize / toCamelCase / toKebabCase / toSnakeCase / stripHtml / escapeHtml / randomString
├── helpers.ts             ← 58 行,基础(debounce, throttle, sleep, generateId, cn)
├── helpers/               ← 目录
│   ├── index.ts           ← export * from './deepClone / retry / omit / pick / uniqueId / sleep'
│   ├── deepClone.ts       ← deepClone (含循环引用 WeakSet 保护)
│   ├── retry.ts           ← retry(fn, { maxAttempts, delay, backoff, onRetry })
│   ├── omit.ts / pick.ts  ← Object property 操作
│   ├── uniqueId.ts        ← uniqueId / uuid / nanoid (★ 安全 VULN-096:CSPRNG 而非 Math.random)
│   └── sleep.ts           ← 重复(helpers.ts 也有)
├── storage/index.ts       ← export * from './indexedDB'
├── storage/indexedDB.ts   ← IndexedDBWrapper(get/put/delete/getAll/clear)
├── url/                   ← 完整目录
│   ├── index.ts
│   ├── queryString.ts     ← parseQueryString / stringifyQueryString / updateQueryString
│   ├── slugify.ts         ← slugify / generateSlug
│   └── urlBuilder.ts      ← UrlBuilder class + urlBuilder() 工厂(★ 安全 VULN-089:拒绝 '..' 与 '/' 分段)
├── validation/            ← 完整目录
│   ├── index.ts
│   ├── email.ts           ← isValidEmail / validateEmail
│   ├── url.ts             ← isValidUrl(★ 安全 VULN-090:仅 http/https 协议)/ validateUrl / isHttps / ensureHttps
│   └── password.ts        ← validatePassword / getPasswordStrengthColor
└── color.ts               ← hexToRgb / rgbToHsl / hslToHex / generateColorVars / colorVarsToCSS
```

**入口解析的实际结果**:`export * from './format'` 解析为 `format.ts`(因为 Node ESM resolution 的 file > directory 优先级);`format/` 目录下的 `duration.ts / number.ts / string.ts` 的导出**没有从根 barrel 暴露**。

实测影响:**消费方调用 `import { formatDuration } from '@aetherblog/utils'` 会失败** —— 因为只有 `format.ts` 被导出,而 `formatDuration` 在 `format/duration.ts`。需要走 `import { formatDuration } from '@aetherblog/utils/format/duration'`(且 `exports."."` 不允许)或修复 index.ts。

**helpers 同理** —— `deepClone / retry / omit / pick / uuid / nanoid` 不可从 `@aetherblog/utils` 直接导入。

> 这是 [README.md §6.5](./README.md) 列出的已知问题之一,需要修复。

### 7. utils 各文件清点

#### 7.1 `format.ts`(18 行,被 root barrel 导出)

```ts
import { format, formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function formatDate(date: Date | string, pattern = 'yyyy-MM-dd'): string;
export function formatRelativeTime(date: Date | string): string;
export function formatNumber(num: number): string;
export function formatFileSize(bytes: number): string;
```

中文 locale,与 admin / blog 一致。

#### 7.2 `format/` 目录(被 index.ts 顶级 export 但实际不可访问)

- `format/duration.ts` —— `formatDuration / formatTime / estimateReadingTime`
- `format/number.ts` —— `formatNumber / formatCurrency / formatPercent / formatCompact / padZero / clamp`
- `format/string.ts` —— `truncate / capitalize / toCamelCase / toKebabCase / toSnakeCase / stripHtml / escapeHtml / randomString`

`estimateReadingTime`(`duration.ts:45-55`)按中文 400 字 / 分钟 + 英文 200 词 / 分钟混合计算。

#### 7.3 `helpers.ts`(58 行,被 root barrel 导出)

```ts
export function debounce<T>(fn: T, delay: number): (...args: Parameters<T>) => void;
export function throttle<T>(fn: T, limit: number): (...args: Parameters<T>) => void;
export function sleep(ms: number): Promise<void>;
export function generateId(): string;
export function cn(...inputs: (string | undefined | null | boolean)[]): string;
```

**`cn` 简化版** —— 只做 join,不做 tailwind-merge。`packages/ui/src/utils.ts:4-6` 才是完整版。消费方应优先用 ui 的 cn。

#### 7.4 `helpers/` 目录(同样不可访问)

- `helpers/deepClone.ts` —— `deepClone<T>` 带 WeakSet 循环引用保护,处理 Date / Map / Set / 普通对象
- `helpers/retry.ts` —— `retry(fn, { maxAttempts, delay, backoff, onRetry })` 指数退避
- `helpers/omit.ts` / `pick.ts` —— object property 操作
- `helpers/uniqueId.ts` —— `uniqueId / uuid / nanoid` ★ **SECURITY VULN-096**:用 CSPRNG 而非 `Math.random`(`uniqueId.ts:7-43`)。`uuid` 优先 `crypto.randomUUID`,降级到 `crypto.getRandomValues` 手工构建 v4
- `helpers/sleep.ts` —— 与 helpers.ts 中重复

#### 7.5 `storage/indexedDB.ts`(100 行)

`IndexedDBWrapper` 类:

```ts
interface DBConfig {
  name: string;
  version: number;
  stores: { name: string; keyPath: string; indexes?: { name: string; keyPath: string; unique?: boolean }[] }[];
}

class IndexedDBWrapper {
  open(): Promise<IDBDatabase>;
  get<T>(storeName, key): Promise<T | undefined>;
  put<T>(storeName, value): Promise<IDBValidKey>;
  delete(storeName, key): Promise<void>;
  getAll<T>(storeName): Promise<T[]>;
  clear(storeName): Promise<void>;
}
```

封装 IndexedDB 的 onsuccess / onerror 回调成 Promise。

#### 7.6 `url/` 目录

##### `url/slugify.ts`
```ts
export function slugify(text: string): string;          // 中英文混合
export function generateSlug(title: string, suffix?: string): string;
```
正则 `[^\w一-龥-]` 保留 ASCII + 中文 + 连字符,其他全部移除。

##### `url/queryString.ts`
```ts
export function parseQueryString(qs: string): Record<string, string>;
export function stringifyQueryString(params: Record<string, ...>): string;
export function updateQueryString(url: string, updates: Record<string, ...>): string;
```

##### `url/urlBuilder.ts`
```ts
export class UrlBuilder {
  path(...segments): this;     // ★ VULN-089: 拒绝 '..' / '/' / '.'
  query(key, value): this;
  queries(params): this;
  hash(fragment): this;
  build(): string;
}
export function urlBuilder(baseUrl: string): UrlBuilder;
```

历史实现允许 path traversal,fix 见 `urlBuilder.ts:16-25`。

#### 7.7 `validation/` 目录

##### `validation/email.ts`
```ts
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean;
export function validateEmail(email: string): { valid: boolean; message: string };
```

##### `validation/url.ts`
```ts
// ★ VULN-090: 仅 http/https,旧实现接受 javascript: / data:text/html
export function isValidUrl(url: string): boolean;
export function validateUrl(url: string): { valid: boolean; message: string };
export function isHttps(url: string): boolean;
export function ensureHttps(url: string): string;
```

##### `validation/password.ts`
```ts
export type PasswordStrength = 'weak' | 'medium' | 'strong' | 'very-strong';
export function validatePassword(password: string, minLength = 8): {
  valid: boolean;
  strength: PasswordStrength;
  score: number;
  suggestions: string[];
};
export function getPasswordStrengthColor(strength: PasswordStrength): string;
```

`getPasswordStrengthColor` 返回硬编码 hex(`#ef4444 / #f59e0b / #22c55e / #059669`) —— 不走 `--signal-*`,因为这是绑死红黄绿语义。

#### 7.8 `color.ts`(122 行) —— 主题派生引擎

源:`packages/utils/src/color.ts`

```ts
export function hexToRgb(hex: string): { r, g, b } | null;
export function rgbToHsl(r, g, b): [h, s, l];
export function hslToHex(h, s, l): string;

export function generateColorVars(hex: string, isDark: boolean): Record<string, string>;
export function colorVarsToCSS(vars: Record<string, string>): string;
```

`generateColorVars` 给定主色 hex + isDark,生成完整变量集:
- `--color-primary` / `-hover` / `-light` / `-lighter` / `-accent`
- `--shadow-primary` / `-lg`
- `--gradient-primary`
- `--focus-ring`

亮 / 暗主题分别按 HSL 调整 lightness / saturation。

`colorVarsToCSS` 把 Record 转 CSS 文本,适合注入 `<style>`。

**消费点**:`apps/blog/app/components/SiteSettingsProvider.tsx:5` 导入并在用户改主色时同步注入到 `<head>`。

---

## 8. 关键代码引用

| 文件 | 行号 | 内容 |
|:---|---:|:---|
| `packages/types/src/index.ts` | 1-3 | api / models / ai 三大命名空间 |
| `packages/types/src/api/response.ts` | 5-23 | ApiResponse / PageInfo / PagedResponse |
| `packages/types/src/api/error.ts` | 12-22 | ApiException 运行时类 |
| `packages/types/src/models/post.ts` | 7-23 | Post 接口 |
| `packages/types/src/models/post.ts` | 54-69 | Category / Tag |
| `packages/types/src/models/user.ts` | 4-30 | User / LoginInput / LoginResult |
| `packages/types/src/models/comment.ts` | 5-29 | Comment 含 children 递归 |
| `packages/types/src/models/media.ts` | 78-109 | StorageType + Media + cdnUrl + 同步状态 |
| `packages/types/src/models/media.ts` | 117-143 | MediaTag + TagCategory + MediaFileTag |
| `packages/types/src/models/media.ts` | 219-280 | FolderPermission / MediaShare / MediaVersion(Phase 5) |
| `packages/types/src/models/friendLink.ts` | 5-22 | FriendLink 含 themeColor |
| `packages/types/src/ai/completion.ts` | 5-30 | CompletionRequest / Response / StreamingChunk |
| `packages/utils/src/index.ts` | 1-6 | 6 个 export 区块(format / validation / helpers / storage / url / color) |
| `packages/utils/src/format.ts` | 1-22 | 4 个基础格式化(date / relative / number / fileSize) |
| `packages/utils/src/helpers.ts` | 4-57 | debounce / throttle / sleep / generateId / cn(简化版) |
| `packages/utils/src/helpers/uniqueId.ts` | 7-43 | uuid / nanoid CSPRNG 实现(VULN-096) |
| `packages/utils/src/url/urlBuilder.ts` | 16-25 | path() 拒绝 '..' / '/' / '.'(VULN-089) |
| `packages/utils/src/validation/url.ts` | 12-19 | 仅 http/https 协议(VULN-090) |
| `packages/utils/src/color.ts` | 84-114 | generateColorVars(主题派生引擎) |

---

## 9. 引用的子文档与原始规范

- `.agent/rules/code-structure.md` —— 类型 / 工具的命名约定
- `.claude/docs/dependencies-and-stack.md` §5 —— 各 packages barrel
- 媒体库深度优化方案 / 对象存储 rollout —— `models/media.ts` 各 Phase 引用
- `CLAUDE.md` §3.3 —— 导入约定 `import { formatDate, slugify } from '@aetherblog/utils'`
- `CLAUDE.md` §6 §3.2 —— 工具的安全 P0 已修复(VULN-084 / 089 / 090 / 096)

---

## 10. 使用方与扩展点

### 10.1 谁消费 `@aetherblog/types`

- **blog**:`@aetherblog/types` → `Post / PostListItem / Comment / FriendLink / User`
- **admin**:大量页面用 `Post / Media / MediaFolder / StorageProvider / User / Comment`
- **后端 server-go**:不直接消费,但 `apps/server-go/internal/models` 与 types 一一对应

### 10.2 谁消费 `@aetherblog/utils`

- **blog**:`SiteSettingsProvider` 用 `generateColorVars / colorVarsToCSS`
- **admin**:多处用 `formatDate / formatRelativeTime / formatFileSize / slugify`
- **packages/editor**:**未导入**(editor 包独立)
- **packages/ui**:**未导入**(ui 不能反向依赖 utils)

### 10.3 加新 type

按域分配:
- API 契约 → `packages/types/src/api/`(配 response 形状或 request 形状)
- 领域模型 → `packages/types/src/models/`
- AI 域 → `packages/types/src/ai/`

各自子 `index.ts` 加 `export *`。**禁止**直接在 `packages/types/src/index.ts` 写 inline type。

### 10.4 加新 util

新 util 放对应子目录(format / helpers / url / validation / storage),并:
1. 改对应子目录的 `index.ts` 加 `export *`
2. **若加在 `format/` 目录,需要先修复 root index.ts 的入口冲突**(否则不可访问)

修复方案:`packages/utils/src/index.ts` 把 `export * from './format'` 改为 `export * from './format/index'` 或显式列举每个子模块。或者把 `format.ts` 的内容合并进 `format/index.ts`,删除 `format.ts`。

### 10.5 utils 不要混入业务

`@aetherblog/utils` 只放**纯函数 / 类**,不放业务知识。例如 `validatePost(post)` 这种业务校验应在 app 内或 backend,不在 utils。

---

## 11. 已知限制

1. **`packages/utils/src/index.ts` 的入口冲突(P1)** —— `format.ts` / `format/` 与 `helpers.ts` / `helpers/` 并存,前者覆盖后者。`formatDuration / formatTime / estimateReadingTime / formatCurrency / formatPercent / formatCompact / padZero / clamp / truncate / capitalize / toCamelCase / toKebabCase / toSnakeCase / stripHtml / escapeHtml / randomString / deepClone / retry / omit / pick / uuid / nanoid` 全部**不可从 `@aetherblog/utils` 直接 import**。修复见 §10.4。
2. **`color.ts` 仍输出 legacy `--color-primary` / `--text-*` 命名空间** —— 不走 codex `--ink-*`。但因为它本职是给 admin 后台主色派生用,**保留** legacy 接口 ABI(SiteSettingsProvider 与之绑定)。
3. **`getPasswordStrengthColor` 用硬编码 hex** —— `#ef4444 / #f59e0b / #22c55e / #059669`,不走 `--signal-*`。理由:这是密码强度的红黄绿语义,跨主题文化通用。
4. **`packages/utils` 不在根 tsconfig.json:13-19 references** —— TS project mode 不跟踪。
5. **`packages/types` 没有 OpenAPI 自动生成** —— 后端 Go struct 与前端 type 是手工同步。新加字段时**必须**同时改两边。
6. **`MediaFolder.path` 是 LTREE 路径**(`/parentSlug/childSlug/...`)—— 类型只是 string,实际有强格式约束(详见 `08-database-migrations` 文档)。
7. **`models/media.ts` 281 行单文件** —— 偏大,后续可考虑按 Phase 拆 6 个子文件。
8. **`StreamingChunk.delta`** —— 后端可能在一个 chunk 中发多句,前端需要根据 `04-motion.md` 的 ink-bleed 策略**按句切分**,不能把整个 chunk 包成一个 `<span class="delta">`。
