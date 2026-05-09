# 07 · `@aetherblog/editor` 包

> CodeMirror 6 Markdown 编辑器 + Bear 风格 WYSIWYG + Shiki/Mermaid/Katex 预览,只服务 admin 写作场景。本文档拆解组件 / Hook、Bear decoration 装饰器、依赖锁定与与 Codex token 的整合。

---

## 范围

- `packages/editor/package.json`
- `packages/editor/tsconfig.json`
- `packages/editor/src/index.ts`(barrel)
- `packages/editor/src/{MarkdownEditor, MarkdownPreview, EditorWithPreview}.tsx` —— 三个核心组件
- `packages/editor/src/{useEditorCommands, useTableCommands, useImageUpload}.ts` —— 三个核心 Hook
- `packages/editor/src/bearDecorations.ts` —— Bear 风格 WYSIWYG 装饰器
- `packages/editor/src/components/{UploadProgress, ImageSizePopover}.tsx` —— 上传进度 + 图片大小弹窗

---

## 1. 包元信息 + 依赖锁定

源:`packages/editor/package.json`

```json
{
  "name": "@aetherblog/editor",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "dependencies": {
    "@codemirror/commands": "^6.10.1",
    "@codemirror/lang-markdown": "^6.2.0",
    "@codemirror/language": "^6.12.2",
    "@codemirror/language-data": "^6.5.0",
    "@codemirror/state": "^6.5.4",
    "@codemirror/view": "^6.26.0",
    "@lezer/highlight": "^1.2.3",
    "@uiw/react-codemirror": "^4.21.0",
    "dompurify": "^3.2.6",
    "framer-motion": "^11.15.0",
    "katex": "^0.16.9",
    "lucide-react": "^0.469.0",
    "marked": "^12.0.0",
    "mermaid": "^10.9.0",
    "shiki": "^1.1.0"
  }
}
```

### 1.1 关键决策:CodeMirror 版本锁定

根 `package.json:31-36`:
```json
"pnpm": {
  "overrides": {
    "@codemirror/state": "6.5.4",
    "@codemirror/view": "6.26.0"
  }
}
```

`CLAUDE.md` §3.1 红线:**root pnpm.overrides 锁定 `@codemirror/state@6.5.4` / `@codemirror/view@6.26.0`(避免多版本冲突)**。CodeMirror 6 的 state / view 在多个 transitive 依赖中出现(`@uiw/react-codemirror` / `@codemirror/lang-markdown` / `@codemirror/language` / `@codemirror/commands`),**任何一处版本不一致都会报 "Multiple instances of CodeMirror state in same context" 运行时错误**。

### 1.2 大依赖

| 依赖 | 用途 | 大小考虑 |
|:---|:---|:---|
| `@codemirror/state + view + commands + lang-markdown + language + language-data + @lezer/highlight` | 编辑器内核 | 总和约 350KB gzip |
| `@uiw/react-codemirror` | React 包装层 | 12KB gzip |
| `marked` | Markdown → HTML | 18KB gzip |
| `shiki` | 代码语法高亮(VS Code 同款 oniguruma 引擎) | ★ 巨大 ~400KB,有 dynamic import 优化 |
| `mermaid` | 流程图 / 时序图 | ★ 巨大 ~700KB,默认 dynamic import |
| `katex` | 数学公式 | ~280KB |
| `dompurify` | 防 XSS HTML 净化 | 18KB |
| `framer-motion` | 视图模式切换动画 | 与 `@aetherblog/ui` 共享 |
| `lucide-react` | 工具栏图标 | 与 `@aetherblog/ui` 共享 |

`packages/editor` 是 monorepo 中**最重的依赖集合** —— 仅 admin 加载,blog 不引入(blog 端 `apps/blog/app/components/MarkdownRenderer.tsx` 自实现轻量版)。

---

## 2. tsconfig

源:`packages/editor/tsconfig.json`(24 行)

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
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

比 `packages/ui/tsconfig.json` 严格许多 —— `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch` / `forceConsistentCasingInFileNames` 都开。

---

## 3. barrel 导出

源:`packages/editor/src/index.ts`

```ts
export { MarkdownEditor } from './MarkdownEditor';
export { MarkdownPreview, markdownPreviewStyles } from './MarkdownPreview';
export { EditorWithPreview } from './EditorWithPreview';
export { useEditorCommands } from './useEditorCommands';
export { useTableCommands } from './useTableCommands';
export { useImageUpload } from './useImageUpload';
export { EditorView } from '@codemirror/view';   // ★ re-export 给消费方传 ref

// 组件
export { UploadProgress, ImageSizePopover } from './components';

// 类型
export type { MarkdownEditorProps } from './MarkdownEditor';
export type { MarkdownPreviewProps } from './MarkdownPreview';
export type { EditorWithPreviewProps, ViewMode } from './EditorWithPreview';
export type { EditorCommands, ImageInfo } from './useEditorCommands';
export type { TableCommands, TableInfo } from './useTableCommands';
export type { UseImageUploadOptions, UseImageUploadReturn, UploadFunction, UploadResult } from './useImageUpload';
export type { UploadItem, UploadProgressProps, ImageSizePopoverProps } from './components';
```

**注意 re-export `EditorView` from `@codemirror/view`** —— 让消费方写 `import { MarkdownEditor, EditorView } from '@aetherblog/editor'`,不必再独立装 CodeMirror。

---

## 4. MarkdownEditor(`MarkdownEditor.tsx`,332 行)

### 4.1 API

源:`MarkdownEditor.tsx:11-43`

```ts
export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  className?: string;
  readOnly?: boolean;
  plain?: boolean;             // 去除外框样式
  style?: React.CSSProperties;
  showLineNumbers?: boolean;
  contentCentered?: boolean;
  fontSize?: number;           // 编辑器内字体大小 (px)
  editorViewRef?: React.MutableRefObject<EditorView | null>;   // 暴露 EditorView 给外部命令
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  isDragging?: boolean;
  theme?: 'light' | 'dark';
  additionalExtensions?: Extension[];   // 注入自定义 CodeMirror 扩展
  bearMode?: boolean;          // 启用 Bear 风格 WYSIWYG
}
```

### 4.2 与 Codex token 整合

源:`MarkdownEditor.tsx:88-143`(`HighlightStyle.define([...])`)

CodeMirror 高亮样式**全部走 Codex token**:

```ts
const markdownHighlightStyle = HighlightStyle.define([
  // 标题 —— 墨色主色
  { tag: tags.heading1, color: 'var(--ink-primary)', fontWeight: '800', fontSize: '1.6em' },
  { tag: tags.heading2, color: 'var(--ink-primary)', fontWeight: '700', fontSize: '1.4em' },
  // ...
  { tag: tags.strong, fontWeight: '700', color: 'var(--ink-primary)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--ink-secondary)' },
  { tag: tags.strikethrough, color: 'var(--ink-muted)' },
  { tag: tags.link, color: 'var(--aurora-1, var(--color-primary))' },
  { tag: tags.url, color: 'var(--ink-muted)', fontFamily: monoFont },
  // 行内代码
  { tag: tags.monospace, fontFamily: monoFont, color: 'var(--aurora-1, var(--color-primary))' },
  // Markdown 标记符号 —— 极度淡化(Bear/iA Writer 风)
  { tag: tags.processingInstruction, color: 'var(--ink-muted)' },
  // ...
  // 代码块语法 —— signal + aurora 混搭
  { tag: tags.keyword, color: 'var(--aurora-3, var(--color-primary))' },
  { tag: tags.string, color: 'var(--signal-success)' },
  { tag: tags.number, color: 'var(--signal-warn)' },
  { tag: tags.comment, color: 'var(--ink-muted)', fontStyle: 'italic' },
  { tag: tags.variableName, color: 'var(--signal-info)' },
  { tag: tags.propertyName, color: 'var(--signal-danger)' },
  // ...
]);
```

`fallback` 写法:`var(--aurora-1, var(--color-primary))` —— legacy `--color-primary` 作为兜底。

### 4.3 EditorView theme

源:`MarkdownEditor.tsx:170-280`

`EditorView.theme({...}, { dark: theme === 'dark' })` 注入**完整运行时 CSS**:

- `&` 根:`fontSize`、`fontFamily: var(--font-sans, ui-sans-serif), ...`、`color: var(--ink-primary)`、`backgroundColor: var(--bg-leaf)` 或 `transparent`
- `.cm-content`:padding 16/24px,`caretColor: var(--aurora-1)`
- `.cm-cursor`:`borderLeftColor: var(--aurora-1)`,加粗到 2px
- `.cm-selectionBackground`:`color-mix(in oklch, var(--aurora-1) 22%, transparent)` 聚焦,失焦 14%
- `.cm-activeLine`:`color-mix(in oklch, var(--aurora-1) 4%, transparent)` —— iA Writer 风极淡
- `.cm-gutters`:`color: var(--ink-muted)`,`fontFamily: monoFont`,opacity 0.55
- `.cm-activeLineGutter`:`color: var(--aurora-1)`
- `.cm-matchingBracket`:`color-mix(in oklch, var(--aurora-1) 15%, transparent)` + 描边
- `.cm-searchMatch`:`rgb(from var(--signal-warn) r g b / 0.25)`
- `.cm-scroller::-webkit-scrollbar-thumb`:`rgb(from var(--ink-muted) r g b / 0.3)`

**最完整的 Codex 整合范例** —— 整个 CodeMirror 实例从光标到滚动条都说 Codex 方言。

### 4.4 Bear 风格 WYSIWYG(可选)

`bearMode: true` 时挂载 `createBearDecorations(theme)` —— 详见 §6。

### 4.5 已知偏差

`MarkdownEditor.tsx:289` 外框样式:
```tsx
className={`h-full relative ${!plain ? (theme === 'light' ? 'rounded-lg border border-slate-200 bg-white' : 'rounded-lg border border-white/10 bg-white/5') : ''} ${className}`}
```
- ❌ `border-slate-200 / border-white/10 bg-white/5` 是 legacy
- ❌ 没有用 `surface-leaf` —— 应改

`MarkdownEditor.tsx:319` 拖拽覆盖层:
```tsx
className="... bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary"
```
- ❌ `bg-primary` / `border-primary` —— legacy alias

---

## 5. MarkdownPreview(`MarkdownPreview.tsx`,1071 行 —— 最长文件)

### 5.1 API

```ts
export interface MarkdownPreviewProps {
  content: string;
  className?: string;
  theme?: 'light' | 'dark';
  fontSize?: number;
  // ... 其他选项
}
```

### 5.2 渲染管线

```
markdown 字符串
    ↓ marked.js + nestedFencesExtension(自定义围栏扩展)
    ↓ Renderer 自定义(链接 / 图片 / 代码块 / blockquote alert)
HTML 字符串
    ↓ DOMPurify.sanitize(防 XSS)
干净 HTML
    ↓ Shiki(动态 import,按需加载语言)
带语法高亮的 HTML
    ↓ Mermaid.js(`<pre class="mermaid">` → SVG)
    ↓ KaTeX($...$ → 数学渲染)
最终 HTML 注入 dangerouslySetInnerHTML
```

### 5.3 nestedFencesExtension(自定义围栏)

源:`MarkdownPreview.tsx:14-83`

标准 CommonMark:**外层围栏的反引号数量必须多于内层** —— `\`\`\`\`\`markdown` 可以包含 `\`\`\`` 块,因为 5 > 3。Marked 默认不正确处理,需自定义 tokenizer。

### 5.4 markdownPreviewStyles 导出

源:`MarkdownPreview.tsx`(700-1071 行)

`export const markdownPreviewStyles: string` —— 一个完整的 CSS 字符串,被 `EditorWithPreview` 用 `<style>` 注入(避免 CSS module 编译问题)。

**已知偏差**(`MarkdownPreview.tsx:701-757`):alert variant CSS 变量(`--alert-info-bg`、`--alert-warning-bg` 等)用硬编码 `rgba(59, 130, 246, 0.1)` 等,**未走 Codex `--signal-*`**。

```css
.markdown-preview {
  --alert-info-bg: rgba(59, 130, 246, 0.1);
  --alert-info-border: #3b82f6;
  --alert-warning-bg: rgba(245, 158, 11, 0.1);
  --alert-warning-border: #f59e0b;
  --alert-danger-bg: rgba(239, 68, 68, 0.1);
  --alert-danger-border: #ef4444;
  --alert-tip-bg: rgba(34, 197, 94, 0.1);
  --alert-tip-border: #22c55e;
}
```

应迁:
```css
--alert-info-bg: color-mix(in oklch, var(--signal-info) 10%, transparent);
--alert-info-border: var(--signal-info);
/* ... */
```

---

## 6. EditorWithPreview(`EditorWithPreview.tsx`,630 行)

### 6.1 API

```ts
export type ViewMode = 'edit' | 'preview' | 'split';

export interface EditorWithPreviewProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  viewMode?: ViewMode;             // 受控
  onViewModeChange?: (mode: ViewMode) => void;
  hideToolbar?: boolean;
  isSyncScroll?: boolean;          // 分屏滚动同步
  fontSize?: number;
  editorFontSize?: number;         // 覆盖
  previewFontSize?: number;        // 覆盖
  showLineNumbers?: boolean;
  editorViewRef?: React.MutableRefObject<EditorView | null>;
  // ... drop / drag / paste handlers
  isDragging?: boolean;
  theme?: 'light' | 'dark';
  additionalExtensions?: Extension[];
  useCrossfade?: boolean;          // 移动端原地淡入淡出代替左右滑动
  mobileTapY?: number;             // 移动端触发切换的 Y 坐标(锚点定位)
  bearMode?: boolean;
}
```

### 6.2 关键能力

源:`EditorWithPreview.tsx:108-260`

**跨模式切换时保留精确滚动位置**(基于真实 DOM 行元素定位,支持可变行高):

- 切到编辑模式:遍历 `.cm-line` DOM 找视口顶部 + 40px 处的真实行号 → 计算出 cmContent 上的 `offsetTop` → 调整 scrollTop
- 切到预览模式:在预览面板找最接近的 `[data-source-line]` 元素(MarkdownPreview 给每个 token 加了源行号属性)→ 同样算出 offsetTop

**因为标题等行高不同**,简单地用"行号 × 平均行高"算偏移会在长文中漂移很远 —— 所以必须遍历真实 DOM。

### 6.3 工具栏

EditorWithPreview 自带工具栏(可隐藏 `hideToolbar`),按钮触发 `useEditorCommands` 的方法。具体按钮 admin 端通过 `additionalExtensions` 注入。

### 6.4 同步滚动(`isSyncScroll`)

分屏模式下 `editorScrollRef` 与 `previewScrollRef` 通过 `[data-source-line]` 定位相互同步,用 `isSyncingRef` 防递归。

---

## 7. useEditorCommands(`useEditorCommands.ts`,334 行)

### 7.1 API

```ts
export interface ImageInfo {
  from: number;
  to: number;
  url: string;
  alt: string;
  size?: string;
}

export interface EditorCommands {
  insertText(text: string): void;
  wrapSelection(prefix: string, suffix: string): void;
  toggleWrap(prefix: string, suffix: string): void;        // 智能切换(已包裹则去掉)
  insertAtLineStart(prefix: string): void;
  toggleLineStart(prefix: string): void;
  getSelection(): string;
  focus(): void;
  undo(): void;
  redo(): void;
  insertImage(url: string, alt?: string, size?: string): void;
  updateImageSize(imageInfo: ImageInfo, newSize: string | null): void;
  getImageAtCursor(): ImageInfo | null;
  getCursorPosition(): number;
}

export function useEditorCommands(
  editorViewRef: React.RefObject<EditorView | null>
): EditorCommands;
```

### 7.2 安全(`useEditorCommands.ts:14-23`)

`insertImage` 校验 URL:
```ts
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'data:'].includes(parsed.protocol);
  } catch {
    // 相对路径也允许
    return url.startsWith('/') || url.startsWith('./') || url.startsWith('../');
  }
}
```

接受 http/https/data + 相对路径,**拒绝 javascript: / vbscript:**。

### 7.3 用法范例

```tsx
const editorViewRef = useRef<EditorView | null>(null);
const commands = useEditorCommands(editorViewRef);

// 工具栏按钮
<Button onClick={() => commands.toggleWrap('**', '**')}>Bold</Button>
<Button onClick={() => commands.insertAtLineStart('# ')}>H1</Button>
<Button onClick={() => commands.insertImage(uploadedUrl, alt, '50%')}>Insert Image</Button>
```

---

## 8. useTableCommands(`useTableCommands.ts`,416 行)

### 8.1 API

```ts
export type TableAlignment = 'left' | 'center' | 'right' | 'none';

export interface TableInfo {
  isInTable: boolean;
  currentRowIndex: number;       // 0 = 表头, 1 = 分隔行, 2+ = 数据行
  currentColumnIndex: number;
  rowCount: number;
  columnCount: number;
  alignments: TableAlignment[];
  tableBounds?: { top, bottom, left, right };       // 视口坐标系
  rowPositions?: number[];
  columnPositions?: number[];
}

export interface TableCommands {
  getTableInfo(): TableInfo;
  insertRowAbove(): void;
  insertRowBelow(): void;
  insertColumnLeft(): void;
  insertColumnRight(): void;
  deleteRow(): void;
  // ... 更多
}
```

整套 Markdown 表格的智能编辑:从光标位置反查表格结构 → 精确插入 / 删除行列 → 自动对齐分隔符更新。**比纯文本 Markdown 表格高效得多**。

---

## 9. useImageUpload(`useImageUpload.ts`,292 行)

### 9.1 API

```ts
export interface UploadResult {
  url: string;
  cdnUrl?: string;
  originalName: string;
  width?: number;
  height?: number;
}

export type UploadFunction = (
  file: File,
  onProgress?: (percent: number) => void
) => Promise<UploadResult>;

export interface UseImageUploadOptions {
  uploadFn: UploadFunction;
  acceptTypes?: string[];          // 默认 image/jpeg|png|gif|webp|svg+xml
  maxSize?: number;                // 默认 20MB
  onUploadComplete?: (result, file) => void;
  onUploadError?: (error, file) => void;
}

export interface UseImageUploadReturn {
  uploads: UploadItem[];
  isUploading: boolean;
  uploadFiles(files: File[]): Promise<UploadResult[]>;
  handleDrop(e: React.DragEvent): void;
  handleDragOver(e: React.DragEvent): void;
  handleDragLeave(e: React.DragEvent): void;
  handlePaste(e: React.ClipboardEvent): void;
  isDragging: boolean;
  removeUpload(id: string): void;
  retryUpload(id: string): void;
  clearCompleted(): void;
}
```

### 9.2 cdnUrl 优先(对象存储 rollout Phase 3)

源:`useImageUpload.ts:13-17` 注释:

> cdnUrl 是后端 Phase 1 之后落库的字段:LOCAL=/api/uploads/...,S3/COS=云端公开 URL。调用方应**优先**使用 cdnUrl,留 url 兼容历史返回。

---

## 10. components/{UploadProgress, ImageSizePopover}

### 10.1 UploadProgress

源:`packages/editor/src/components/UploadProgress.tsx`

```ts
export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  url?: string;
  error?: string;
}

export interface UploadProgressProps {
  uploads: UploadItem[];
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  onClearCompleted?: () => void;
}
```

显示上传进度 UI。**Blob URL 生命周期由 useEffect 管理**(`UploadProgress.tsx:32-43`):
```tsx
useEffect(() => {
  if (upload.file.type.startsWith('image/')) {
    const url = URL.createObjectURL(upload.file);
    setPreviewUrl(url);
    return () => { URL.revokeObjectURL(url); };
  }
}, [upload.file]);
```
防止 Blob URL 内存泄漏。

**已知偏差**:用 `bg-white/5`、`text-gray-300/500`、`text-green-500` 等(legacy)。

### 10.2 ImageSizePopover

源:`packages/editor/src/components/ImageSizePopover.tsx`

```ts
export interface ImageSizePopoverProps {
  imageInfo: { from, to, url, alt, currentSize? };
  anchorPosition: { x: number; y: number };
  onSelect: (size: string | null) => void;
  onClose: () => void;
}
```

预设大小:`null(原始) / 20%-100%`(每 10% 一档)。`useEditorCommands.updateImageSize(imageInfo, newSize)` 接收选中值。

---

## 11. bearDecorations(`bearDecorations.ts`,517 行)

### 11.1 设计目标

源:`bearDecorations.ts:1-10`(注释)

> 核心原理:使用 CodeMirror 的 ViewPlugin + Decoration 系统,在光标不在某行时**隐藏 Markdown 标记符号**(`#`、`**`、`*`、`~~`、`` ` `` 等),并为代码块、引用块、分割线、自定义高亮块等提供内联渲染效果。
>
> @ref Bear App 的 WYSIWYG Markdown 编辑体验。

### 11.2 Alert Block 配置

源:`bearDecorations.ts:23-90` —— 5 种 alert block(info / note / warning / danger / tip):

```ts
const ALERT_CONFIG: Record<string, { label, color, bg, border, svg }> = {
  info: {
    label: '信息',
    color: 'var(--signal-info)',
    bg: 'rgb(from var(--signal-info) r g b / 0.08)',
    border: 'var(--signal-info)',
    svg: '<svg>...</svg>',
  },
  note: { color: 'var(--ink-muted)', ... },
  warning: { color: 'var(--signal-warn)', ... },
  danger: { color: 'var(--signal-danger)', ... },
  tip: { color: 'var(--signal-success)', ... },
};
```

**全部走 Codex `--signal-*` token + `--ink-muted`**,跟随主题切换。

### 11.3 隐藏 Markdown 标记的策略

ViewPlugin 监听光标位置:
- 光标**在某行内** → 显示原始 Markdown(`# Title` 完整)
- 光标**不在某行内** → 隐藏 markdown 标记(只显示渲染后的样子,但实际文本仍是 Markdown)

这是 Bear / Typora WYSIWYG 体验的核心 —— **既保持 Markdown 源码的简单,又获得所见即所得的视觉**。

---

## 12. 关键代码引用

| 文件 | 行号 | 内容 |
|:---|---:|:---|
| `packages/editor/package.json` | 全文 | 依赖清单 + react peer + 17 个运行时依赖 |
| `package.json`(root) | 31-36 | pnpm.overrides @codemirror/state@6.5.4 / view@6.26.0 |
| `packages/editor/src/index.ts` | 1-18 | barrel + EditorView re-export |
| `packages/editor/src/MarkdownEditor.tsx` | 11-43 | MarkdownEditorProps |
| `packages/editor/src/MarkdownEditor.tsx` | 88-143 | Markdown 高亮 HighlightStyle(全 Codex token) |
| `packages/editor/src/MarkdownEditor.tsx` | 170-280 | EditorView.theme(光标 / 选区 / activeLine / 滚动条 / 匹配括号 / 搜索) |
| `packages/editor/src/MarkdownEditor.tsx` | 289 | 外框样式(legacy 待迁) |
| `packages/editor/src/MarkdownPreview.tsx` | 14-83 | nestedFencesExtension |
| `packages/editor/src/MarkdownPreview.tsx` | 700-1071 | markdownPreviewStyles 长 CSS 字符串 |
| `packages/editor/src/EditorWithPreview.tsx` | 9-53 | EditorWithPreviewProps |
| `packages/editor/src/EditorWithPreview.tsx` | 108-260 | 跨模式滚动锚点保留 |
| `packages/editor/src/useEditorCommands.ts` | 14-23 | isValidUrl(http/https/data + 相对路径) |
| `packages/editor/src/useEditorCommands.ts` | 25-61 | EditorCommands 接口 + ImageInfo |
| `packages/editor/src/useTableCommands.ts` | 11-50 | TableCommands 接口 + TableInfo |
| `packages/editor/src/useImageUpload.ts` | 13-17 | cdnUrl 优先注释 |
| `packages/editor/src/useImageUpload.ts` | 30-66 | UseImageUploadOptions / Return |
| `packages/editor/src/components/UploadProgress.tsx` | 32-43 | Blob URL useEffect 生命周期 |
| `packages/editor/src/bearDecorations.ts` | 23-90 | ALERT_CONFIG(5 种 alert + Codex signal) |

---

## 13. 引用的子文档与原始规范

- `CLAUDE.md` §3.1 红线 —— @codemirror/state / view 锁定原因
- `.claude/docs/dependencies-and-stack.md` —— 整体依赖清单
- 媒体库深度优化方案 / 对象存储 rollout —— `useImageUpload.cdnUrl` 来源
- `.claude/design-system/05-components.md` —— editor 不在 UI Primitive 范畴(因 admin 专用)

---

## 14. 使用方与扩展点

### 14.1 谁消费 `@aetherblog/editor`

- **admin**:`apps/admin/src/pages/posts/CreatePostPage.tsx` / `EditPostPage.tsx` / `AiWritingWorkspacePage.tsx`
- **blog**:**不消费** —— blog 端用 `apps/blog/app/components/MarkdownRenderer.tsx` 自实现轻量渲染器(只读)。理由:editor 包巨大(~2MB gzip 全量),只读场景没必要

### 14.2 加新工具栏命令

1. 在 `useEditorCommands.ts` 的 `EditorCommands` 接口加方法(如 `insertHr()`)
2. 在实现处用 `editorViewRef.current.dispatch({ changes: ... })` 操作 EditorView
3. admin 工具栏按钮调 `commands.insertHr()`

### 14.3 加新 Bear 装饰

修改 `bearDecorations.ts`:
1. 在 `ALERT_CONFIG` 加新 type
2. 在 ViewPlugin 中加对应的 Decoration 生成逻辑
3. 同步 `MarkdownPreview` 的渲染规则(如果需要)

### 14.4 升级 CodeMirror

**禁止单独升级** —— 因为根 `pnpm.overrides` 锁定了 state 与 view 版本。要升级:
1. 同时升级所有 `@codemirror/*` 依赖到兼容版本
2. 改 `pnpm.overrides` 中的两条
3. 跑回归测试(光标移动、撤销重做、IME 中文输入、复制粘贴)
4. 改 `.claude/docs/dependencies-and-stack.md`

---

## 15. 已知限制

1. **整包巨大** —— shiki + mermaid + katex 三巨头全部装在 dependencies(默认全量加载)。admin bundle 中 editor 占 50%+,首屏 LCP 受影响。优化建议:把 mermaid / katex / shiki 改成 dynamic import(MarkdownPreview 内部已部分这么做,但仍未完全)。
2. **MarkdownPreview.markdownPreviewStyles 用大量 hex / rgba 直接色** —— alert 块(`MarkdownPreview.tsx:701-757`)未走 Codex `--signal-*`。是 P1 待迁。
3. **MarkdownEditor.tsx:289 外框** —— `border-slate-200 / border-white/10 bg-white/5` 是 legacy。应迁到 `surface-leaf`。
4. **MarkdownEditor.tsx:319 拖拽覆盖层** —— `bg-primary/10 border-primary` 用 legacy alias。应迁到 `--aurora-1`。
5. **UploadProgress.tsx 大量 Tailwind 直接色** —— `bg-white/5 / text-gray-300 / text-green-500` 等。应迁到 `surface-leaf` + `var(--ink-muted)` + `var(--signal-success)`。
6. **`@aetherblog/editor` 不依赖 `@aetherblog/ui`** —— 内部用了一些与 ui 类似的组件(Loader2 spinner、按钮等),没有复用 Button / Modal。理由:避免循环依赖,但代价是组件视觉不完全统一(如 UploadProgress 状态色与 Toast 不一致)。
7. **CodeMirror 版本是硬锁定** —— pnpm.overrides 强制所有 transitive 也用 6.5.4 / 6.26.0,任何依赖升级都需要联动。
8. **`bearMode` 只在 admin 编辑器启用,blog MarkdownRenderer 不复用** —— 两套独立的 markdown → HTML 实现需要长期同步特性集(alert blocks、自定义围栏等)。
