# 04 · `@aetherblog/ui` 包

> UI Primitive + 动效预设 + 共享样式表 + cn 工具的总集合。本文档清点 17 个组件、其 API、与 motion / surfaces 的关系。

---

## 范围

- `packages/ui/package.json`
- `packages/ui/tsconfig.json`
- `packages/ui/src/index.ts`(barrel)
- `packages/ui/src/Button.tsx` / `Card.tsx` / `motion.ts` / `utils.ts`
- `packages/ui/src/components/`(15 个组件)
- `packages/ui/src/styles/{tokens,surfaces,typography}.css`(详见前几篇)

---

## 1. 包元信息

源:`packages/ui/package.json`

```json
{
  "name": "@aetherblog/ui",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@radix-ui/react-tooltip": "^1.2.8",
    "clsx": "^2.1.1",
    "date-fns": "^4.1.0",
    "framer-motion": "^11.15.0",
    "lucide-react": "^0.469.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "typescript": "^5.7.2"
  }
}
```

**关键决策**:
- `main: ./src/index.ts` —— 不预编译,直接暴露 TS 源码;app 端 Next.js / Vite 自己处理 ts → js
- `react / react-dom` 在 `dependencies` 而非 `peerDependencies` —— pnpm workspace 下两个 app 共享同一份 react 实例,放 deps 不会重复装
- `date-fns ^4.1.0` —— 主要给 DateRangePicker 用
- `lucide-react ^0.469.0` —— 图标库统一
- `@radix-ui/react-tooltip ^1.2.8` —— 唯一一个 Radix 依赖,避免引入 portal / focus-trap 自重做

`tsconfig.json`(`packages/ui/tsconfig.json`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

---

## 2. barrel 导出全景

源:`packages/ui/src/index.ts`

```ts
// 根目录组件
export * from './Button';
export * from './Card';

// components 子目录组件
export * from './components/Input';
export * from './components/Modal';
export * from './components/ConfirmModal';
export * from './components/Toast';
export * from './components/Avatar';
export * from './components/Badge';
export * from './components/Tag';
export * from './components/Skeleton';
export * from './components/Dropdown';
export * from './components/Select';
export * from './components/DateRangePicker';
export * from './components/Tooltip';
export * from './components/Textarea';
export * from './components/Toggle';
export * from './components/AetherMark';

// 工具函数
export * from './utils';

// 动效预设 —— ease / duration / spring / transition / variants / stagger / cssMotion
export * from './motion';
```

15 个 components/ 子目录组件 + 2 个根目录组件(Button / Card) = 17 个 UI Primitive。`utils` 暴露 `cn`(`packages/ui/src/utils.ts:4-6`)。`motion` 暴露动效预设。

**注意**:`Tooltip` 走 Radix Primitive(`@radix-ui/react-tooltip`),其余 15 个组件全部自实现。

---

## 3. Button(`packages/ui/src/Button.tsx`)

### 3.1 当前 API

```ts
interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}
```

### 3.2 当前实现摘要

源:`packages/ui/src/Button.tsx:16-22, 41-58`

```tsx
const variants = {
  primary: 'bg-black text-white hover:bg-black/90 ... dark:bg-white dark:text-black dark:hover:bg-white/90',
  secondary: 'bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-default)]',
  ghost: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-primary/10',
  danger: 'bg-red-500 text-white hover:bg-red-600',
  dark: 'bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90',
};

<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.98 }}
  ...
  className={cn(
    'inline-flex items-center justify-center rounded-xl font-bold',
    'transition-colors duration-200',
    variants[variant],
    sizes[size],
    ...
  )}
>
  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
  {children}
</motion.button>
```

### 3.3 已知偏差(P1 红线)

源:对照 `.claude/design-system/05-components.md:30-58`、`07-migration.md` Stage 1

1. ❌ 仍在写 `dark:` 变体(`primary` / `dark` 两 variant) —— 违反硬规则 5
2. ❌ 用 legacy `--text-primary` / `--text-secondary` / `--bg-card`(`secondary` / `ghost`) —— 应迁到 `--ink-*`
3. ❌ `danger` 用 `bg-red-500` Tailwind 直接色 —— 应迁到 `--signal-danger`
4. ❌ `whileTap={{ scale: 0.98 }}` + 缺 transition —— 规范要求 `whileTap={{ scale: 0.97 }}` + `spring.precise`(`05-components.md:54-56`)
5. ❌ 缺 `aurora` variant —— 规范在 `05-components.md:39, 47-51` 要求新增,带极光描边款
6. ❌ `transition-colors duration-200` —— 应改为 `duration-quick ease-aether`(260ms)
7. ❌ `rounded-xl` 但 `--radius-md` 是 12px(token 对齐应该是 `rounded-md`)

### 3.4 规范侧的目标 API

```tsx
<Button variant="primary" size="md">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="danger">Danger</Button>
<Button variant="aurora">Aurora</Button>      {/* 新增 */}
<Button variant="dark">Dark</Button>
```

变体规则(`05-components.md:43-52`):

| variant | 背景 | 文字 | 边框 | Hover |
|:---|:---|:---|:---|:---|
| primary | `--ink-primary` | `--bg-void` | 无 | 降低 10% alpha |
| secondary | `--bg-leaf` | `--ink-primary` | `--ink-primary` 10% | 极光边 |
| ghost | 透明 | `--ink-secondary` | 无 | `--bg-leaf` 底 |
| danger | `--signal-danger` | white | 无 | 亮 10% |
| **aurora** | 透明 | `--aurora-1` | 1px 极光 | 填充极光 10% |
| dark | black | white | 无 | - |

迁移列在 [08-legacy-and-migration.md](./08-legacy-and-migration.md) Stage 1。

---

## 4. Card(`packages/ui/src/Card.tsx`)

### 4.1 当前 API(45 行)

```tsx
<Card hover>
  <Card.Header>
    <Card.Title>标题</Card.Title>
  </Card.Header>
  <Card.Content>内容</Card.Content>
</Card>
```

源:`Card.tsx:9-22`

```tsx
export function Card({ children, className, hover }: CardProps) {
  return (
    <div
      className={cn(
        'p-6 rounded-xl',
        'bg-[var(--bg-card)] backdrop-blur-sm border border-[var(--border-default)]',
        hover && 'hover:border-[var(--border-hover)] transition-all cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  );
}
```

### 4.2 已知偏差(P0 红线)

1. ❌ 无 `variant` prop —— 规范要求 `variant?: 'leaf' | 'raised' | 'overlay' | 'luminous'`(`05-components.md:66-79`)
2. ❌ 直接写 `bg-[var(--bg-card)] backdrop-blur-sm border` —— 规范明令禁止裸 backdrop-blur,应用 `.surface-*`(`02-surfaces.md:233`)
3. ❌ 用 legacy `--bg-card` / `--border-default` —— 应迁到 surface 系统
4. ❌ Card.Title 内联 `text-lg font-medium text-[var(--text-primary)]` —— 应改为 `text-h4` 语义类
5. ❌ Card.Content 用 `text-[var(--text-secondary)]` —— legacy alias

### 4.3 规范侧的目标 API

```tsx
<Card variant="leaf" padding="md">
  <Card.Header>
    <Card.Title>标题</Card.Title>
  </Card.Header>
  <Card.Content>内容</Card.Content>
</Card>

<Card variant="raised">...</Card>
<Card variant="overlay">...</Card>
<Card variant="luminous">...</Card>  {/* 稀有 */}

<Card variant="leaf" interactive>...</Card>  {/* hover 极光边 + 左侧光带 */}
```

实现摘要(规范侧):
```tsx
const SURFACE_CLASS = {
  leaf: 'surface-leaf',
  raised: 'surface-raised',
  overlay: 'surface-overlay',
  luminous: 'surface-luminous',
};

export function Card({ variant = 'leaf', interactive, padding = 'md', className, children, ...rest }) {
  return (
    <div
      data-interactive={interactive || undefined}
      className={cn(paddings[padding], SURFACE_CLASS[variant], className)}
      {...rest}
    >
      {children}
    </div>
  );
}
```

`padding` 档位:`none | sm | md | lg`(0 / 1rem / 1.5rem / 2rem)。

---

## 5. components/ 子目录组件清单

### 5.1 Input(`components/Input.tsx`,52 行)

```ts
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(...);
```

实现:`bg-[var(--bg-card)] border border-[var(--border-default)] text-[var(--text-primary)] focus:ring-primary/50 ...` —— **legacy token,需迁 ink-* + surface-leaf**。

### 5.2 Textarea(`components/Textarea.tsx`,36 行)

API 同 Input。同样用 legacy token。

### 5.3 Modal(`components/Modal.tsx`,139 行)

```ts
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  hideBackdrop?: boolean;
  zIndex?: number;
}
```

实现:`createPortal` + `framer-motion AnimatePresence` + 背景遮罩 `bg-black/70 backdrop-blur-md` + Esc / 外部点击关闭。**body overflow: hidden 锁定**。

### 5.4 ConfirmModal(`components/ConfirmModal.tsx`,156 行)

```ts
interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  secondaryText?: string;       // 三选场景
  onSecondary?: () => void;
  variant?: 'danger' | 'warning' | 'info';
  zIndex?: number;
  onConfirm: () => void;
  onCancel: () => void;
}
```

替代浏览器原生 `confirm()`。`05-components.md:382` 明确禁止使用原生 confirm/alert。

**已知偏差**:variantStyles 用 `bg-red-500/20 text-red-400` 等 Tailwind 直接色,需迁 `--signal-*`。

### 5.5 Toast + ToastProvider(`components/Toast.tsx`,86 行)

```ts
interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  onClose?: () => void;
}

export function ToastProvider({ children }: { children: React.ReactNode })
export function useToast(): { toasts, showToast, removeToast }
```

`useToast()` Context API。**已知偏差**:用 `bg-green-500/20 border-green-500 text-green-400` 等 Tailwind 直接色,需迁 `--signal-*`。

### 5.6 Avatar(`components/Avatar.tsx`,65 行)

```ts
interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}
```

**安全**(`Avatar.tsx:13-24` 注释,VULN-084):拒绝 `javascript:` / `vbscript:` / `data:image/svg+xml` URL。仅允许 http(s) 绝对、同源相对、非 SVG 的 data: URI。

`fallback` 在加载失败或无 src 时显示文本(取首两字符大写)。

### 5.7 Badge(`components/Badge.tsx`,37 行)

```ts
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md';
  className?: string;
}
```

**已知偏差**:variant primary/success/warning/error 用 `bg-primary/20`、`bg-green-500/20` 等。需迁 `--signal-*` 与 `--aurora-1`。

### 5.8 Tag(`components/Tag.tsx`,37 行)

```ts
interface TagProps {
  children: React.ReactNode;
  color?: string;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
}
```

**已知偏差**:`style={{ backgroundColor: ${color}20, color: color || '#8b5cf6' }}` —— 默认 `#8b5cf6` 是硬编码 hex,违反硬规则 1。应该 fallback 到 `var(--aurora-1)`。

### 5.9 Skeleton + SkeletonText(`components/Skeleton.tsx`,69 行)

```ts
interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

export function Skeleton(props): JSX.Element
export function SkeletonText({ lines = 3 }): JSX.Element
```

替代 spinner。背景色用 legacy `--bg-card`,需迁。

**`05-components.md:255-291` 规范侧要求** shimmer-sweep 用 `color-mix(in oklch, var(--aurora-1) 10%, transparent)` —— 当前 Tailwind `animate-shimmer` 是否对齐尚需 codex 走查。

### 5.10 Dropdown(`components/Dropdown.tsx`,110 行)

```ts
interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}
```

`createPortal` + 浮动定位计算(`useLayoutEffect` 读 `getBoundingClientRect`)+ 点击外部 / scroll / resize 关闭。**未直接用 surface-raised 类**,需要走查。

### 5.11 Select(`components/Select.tsx`,363 行)

```ts
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onValueChange: (next: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  disabledHint?: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
  prefix?: React.ReactNode;
  ariaLabel?: string;
  id?: string;
}
```

Aether Codex 自绘下拉,取代原生 `<select>`:
- trigger 与 Input 同尺寸 / 圆角 / border
- popover 走 `.surface-overlay`,portal 到 body
- 键盘:Up/Down 高亮 / Enter 选中 / Esc 关闭 / Home/End 跳首尾
- 触发器宽度 = popover 宽度

### 5.12 DateRangePicker(`components/DateRangePicker.tsx`,649 行 —— 最大组件)

Aether Codex 自绘日期范围选择器 —— 取代两个原生 `<input type="date">`:
- trigger 与 Select 同尺寸 / 圆角
- popover 走 `.surface-overlay`,portal 到 body
- 左侧 8 个常用预设(今天 / 昨天 / 最近 7 天 / 最近 30 天 / 本月 / 上月 / 本年 / 全部时间)
- 右侧单月日历,hover 时实时预览 range

依赖 `date-fns` 的 `format / parseISO / startOfMonth / endOfMonth / startOfWeek / endOfWeek / eachDayOfInterval / addMonths / subMonths / isSameMonth / isSameDay / isAfter / isBefore / startOfYear / startOfDay / subDays / isValid` + `zhCN` locale。

### 5.13 Tooltip(`components/Tooltip.tsx`,53 行)

```ts
interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';   // 兼容旧 API
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  delay?: number;
  contentClassName?: string;
  arrowClassName?: string;
}
```

唯一基于 `@radix-ui/react-tooltip` 的组件 —— TooltipPrimitive Provider + Root + Trigger + Portal + Content + Arrow 全套。

### 5.14 Toggle(`components/Toggle.tsx`,56 行)

```ts
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';   // 36×20 / 44×24 px
  className?: string;
}
```

`framer-motion` 驱动 thumb 位移。`bg-primary` checked 状态 —— 需要走查 codex 兼容性。

### 5.15 AetherMark(`components/AetherMark.tsx`,130 行)

```ts
export interface AetherMarkProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  withGlow?: boolean;
  title?: string;
}
```

**站标 SVG 组件** —— 用 `var(--aurora-1)` / `--aurora-2` / `--aurora-3` 渐变填充。`withGlow` 加 `box-shadow`。`useId()` 生成稳定 gradient id 避免多实例冲突。是少数已经走 Codex token 的组件之一。

### 5.16 ConfirmModal vs Modal 区分

- **Modal** —— 通用容器,需要 Esc / Backdrop 关闭、`createPortal` 投射、`zIndex` 配置
- **ConfirmModal** —— 业务级"确认操作"对话框,带 variant(danger / warning / info),代替 `window.confirm()`

---

## 6. utils:`cn`(`packages/ui/src/utils.ts`)

源(全文 7 行):

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

合并 className 的标准方案:
- `clsx` 处理条件类(`{ 'foo': isOk }`、`['foo', cond && 'bar']`)
- `tailwind-merge` 解决冲突(`cn('p-2', 'p-4')` → `'p-4'`,后者覆盖前者)

**所有 ui 组件用 `import { cn } from './utils'`** —— 不要再 import clsx / tailwind-merge。

`packages/utils/src/helpers.ts:52-57` 也有一份 `cn` —— **简化版,只做 join 不做 merge**。两份**功能不重叠**,但消费方应优先用 `@aetherblog/ui` 的 cn(完整版)。

---

## 7. motion 预设

`@aetherblog/ui` 的根 barrel 导出 `motion.ts` —— `import { spring, transition, variants, stagger, ease, duration, cssMotion } from '@aetherblog/ui'`。详见 [03-motion-system.md](./03-motion-system.md)。

---

## 8. 与 cn / surfaces / motion 的关系

```
组件文件
├── import { cn } from './utils'          ── 合并 className
├── import { motion } from 'framer-motion' ── 动画
├── import { transition, variants, spring } from '../motion'   ── 动效预设
└── className 中带 surface-leaf/raised/overlay/luminous       ── 玻璃层级
                                          + data-interactive  ── 极光 hover stripe
                                          + text-h*  / .font-* / .reading-column  ── 排印
                                          + var(--ink-*) / --aurora-* / --signal-*  ── 颜色
```

四者**配合无重复职责**:
- cn 给类合并
- motion 给运动语义
- surfaces 给容器形态
- typography 给文字形态

---

## 9. 关键代码引用

| 文件 | 行号 | 内容 |
|:---|---:|:---|
| `packages/ui/package.json` | 全文 | 依赖清单 + main = ./src/index.ts(不预编译) |
| `packages/ui/src/index.ts` | 1-28 | 17 组件 + utils + motion barrel |
| `packages/ui/src/Button.tsx` | 16-22 | variants(待迁) |
| `packages/ui/src/Button.tsx` | 41-58 | motion.button + cn |
| `packages/ui/src/Card.tsx` | 9-22 | 当前实现(待迁) |
| `packages/ui/src/Card.tsx` | 24-44 | Card.Header / Title / Content |
| `packages/ui/src/utils.ts` | 4-6 | cn(clsx + tailwind-merge) |
| `packages/ui/src/components/Modal.tsx` | 9-23 | ModalProps |
| `packages/ui/src/components/ConfirmModal.tsx` | 7-24 | ConfirmModalProps |
| `packages/ui/src/components/Toast.tsx` | 4-9, 50-60 | ToastProps + ToastProvider |
| `packages/ui/src/components/Select.tsx` | 20-54 | SelectProps + SelectOption |
| `packages/ui/src/components/DateRangePicker.tsx` | 1-32 | API + date-fns 依赖 |
| `packages/ui/src/components/Avatar.tsx` | 13-24 | isSafeAvatarSrc(VULN-084) |
| `packages/ui/src/components/AetherMark.tsx` | 11-50 | AetherMarkProps + SVG |

---

## 10. 引用的子文档与原始规范

- `.claude/design-system/05-components.md` —— 17 个组件的视觉规范权威
- `.claude/design-system/02-surfaces.md` —— Card / Modal / Tooltip / Dropdown 应该用哪一层
- `.claude/design-system/04-motion.md` —— 各组件动画的规约
- `.claude/design-system/07-migration.md` Stage 1 —— Primitive 迁移顺序

---

## 11. 使用方与扩展点

### 11.1 谁消费 `@aetherblog/ui`

- **blog**:几乎全部组件页面(`apps/blog/app/components/CommentSection.tsx:6` 等示例)
- **admin**:Sidebar / DataTable / 各 Dialog / 表单页 / Dashboard

### 11.2 加新组件

按 `.agent/rules/ui_rules.md`:**跨 app 复用 → 必须放 `packages/ui`**。流程:

1. 阅读 `.claude/design-system/05-components.md` 看是否已有同类模式
2. 在 `packages/ui/src/components/<Name>.tsx` 实现
3. 走 `surface-*` + token + motion 预设
4. 在 `packages/ui/src/index.ts` 加 `export * from './components/<Name>';`
5. 同步 `.agent/rules/ui_rules.md` 与 `.claude/docs/dependencies-and-stack.md` §5

### 11.3 业务组件不要放这里

`05-components.md` 明确:DataTable / StatsCard / ArticleCard 这种**业务组件**放 `apps/<app>/components/` 而非 packages/ui。判断:**只有一个页面用 → app 内 / ≥2 处用 → packages/ui**。

### 11.4 重构 Button.tsx 与 Card.tsx 的优先级

P0(red line)。当前两者违反多条硬规则,且作为 Primitive 影响每一个消费方。重构走 `07-migration.md` Stage 1 的步骤,见 [08-legacy-and-migration.md](./08-legacy-and-migration.md) §3。

---

## 12. 已知限制

1. **大量组件仍引用 legacy token**(`--text-* / --bg-card / --border-default / --color-primary` / Tailwind 直接色)。`pnpm design-system:check` 会标 warning。
2. **Button.tsx 缺 `aurora` variant + `spring.precise` transition + `dark:` 仍在用** —— Codex P0 红线项。
3. **Card.tsx 完全没有 `variant` prop** —— `surface-leaf` 系统接不上,所有 Card 视觉都是 legacy。
4. **Toast / Badge / Tag / ConfirmModal 的 variant 用 Tailwind 颜色** —— 需迁 `--signal-*`。
5. **Skeleton 的 `wave` 动画**(`animate-shimmer`)依赖 Tailwind config —— 跨 app 一致性需要走查 `apps/blog` 与 `apps/admin` 的 tailwind.config。
6. **Tooltip 的内容样式没有 `surface-raised` 类**(规范 `05-components.md:135-139` 要求) —— Radix 自带的 Content 需要在 className 中显式加 `.surface-raised`。
7. **Dropdown / Modal 的 backdrop** —— `bg-black/70 backdrop-blur-md` 不是 Codex 规范的 `surface-overlay` 描边,需要走查。
8. **Toggle 用 `bg-primary`** —— `bg-primary` 在 Tailwind 中 alias 到 `--color-primary`(legacy)。新 codex 应该是 `bg-[var(--aurora-1)]`。
