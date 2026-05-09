# 05 · `@aetherblog/hooks` 包

> 19 个 React Hook + ThemeProvider/ThemeToggle + 主题 FOUC guard 常量。本文档逐个清点 Hook 契约、ThemeProvider 的圆形动画切换、跨标签页同步与 themeConstants 的 RSC 兼容性。

---

## 范围

- `packages/hooks/package.json`
- `packages/hooks/src/index.ts`(barrel)
- `packages/hooks/src/use*.ts`(19 个 Hook)
- `packages/hooks/src/useTheme.tsx`(459 行 —— Provider + 圆形动画 + 跨标签页同步)
- `packages/hooks/src/themeConstants.ts`(RSC 友好的纯字符串常量)
- `packages/hooks/src/ThemeToggle.tsx`(Sun/Moon/Monitor 切换按钮组件)
- `packages/hooks/src/view-transitions.d.ts`(类型声明)

---

## 1. 包元信息

源:`packages/hooks/package.json`

```json
{
  "name": "@aetherblog/hooks",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "react": "^19.0.0"
  },
  "peerDependencies": {
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.344.0"
  },
  "peerDependenciesMeta": {
    "framer-motion": { "optional": true },
    "lucide-react": { "optional": true }
  }
}
```

**关键决策**:
- `react` 在 `dependencies`(Hook 必须 react)
- `framer-motion` / `lucide-react` 在 `peerDependencies` + `peerDependenciesMeta.optional: true` —— 仅 ThemeToggle 用到这两个,如果消费方不导入 ThemeToggle 就不必装(`packages/ui` 已经声明,blog/admin 经过 ui 间接拿到)
- 没有 tsconfig.json —— 走根 tsconfig 规则

**注意**:`packages/hooks` 没有自己的 tsconfig,但**根 tsconfig.json:13-19 也没把它列入 references**。这是一个轻微遗漏(详见 README.md §6.6)。

---

## 2. Hooks 全景

源:`packages/hooks/src/index.ts`

```ts
export * from './useDebounce';
export * from './useCopyToClipboard';
export * from './useLocalStorage';
export * from './useAsync';
export * from './useThrottle';
export * from './useSessionStorage';
export * from './useMediaQuery';
export * from './useClickOutside';
export * from './useScrollLock';
export * from './useIntersectionObserver';
export * from './useKeyPress';
export * from './useWindowSize';
export * from './usePrevious';
export * from './useToggle';
export * from './useScrollPosition';
export * from './useTheme';        // ThemeProvider + useTheme + Theme 类型
export * from './themeConstants';  // FOUC 常量(无 'use client')
export * from './ThemeToggle';
```

**注意 `themeConstants` 单独导出** —— 见 §5。

---

## 3. 19 个 Hook 契约

每个 Hook 顶部都带 `'use client'`(都用 useState/useEffect/useCallback)。

### 3.1 `useDebounce<T>(value, delay = 300): T`

源:`useDebounce.ts:4-13`

延迟跟踪输入值,直到 `delay` 毫秒内没有新变化才更新输出值。常用于搜索框 throttle 网络请求。

### 3.2 `useThrottle<T>(value, limit = 300): T`

源:`useThrottle.ts:5-21`

每 `limit` 毫秒最多更新一次输出值。

### 3.3 `useCopyToClipboard(): [boolean, (text: string) => Promise<boolean>]`

源:`useCopyToClipboard.ts:32-72`

返回 `[copied, copy]`。`copied` 在复制成功后 2 秒内为 true。

**三层降级**(`useCopyToClipboard.ts:5-30`):
1. `navigator.clipboard.writeText`(secure context 异步)
2. `document.execCommand('copy')`(legacy 同步,HTTP 仍工作)
3. catch 所有异常只 console.warn,不抛出避免 Next.js 红屏

返回类型 `void → boolean`(Round 4 修复,`07-migration.md` Round 4 末尾)。

### 3.4 `useLocalStorage<T>(key, initialValue): [T, (value: T) => void]`

源:`useLocalStorage.ts:4-37`

简化的本地存储 hook。**带跨标签页同步** —— 监听 `storage` 事件自动同步状态。

### 3.5 `useSessionStorage<T>(key, initialValue): [T, (value: T) => void, () => void]`

源:`useSessionStorage.ts:4-54`

返回 `[storedValue, setValue, removeValue]`。`removeValue` 重置到 `initialValue` + 删除 storage 项。

### 3.6 `useAsync<T, P>(asyncFn): UseAsyncReturn<T, P>`

源:`useAsync.ts:16-45`

```ts
interface UseAsyncReturn<T, P extends unknown[]> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  execute: (...args: P) => Promise<T | null>;
  reset: () => void;
}
```

封装 async 函数的 loading / data / error 状态,`execute` 调用,`reset` 清空。

### 3.7 `useMediaQuery(query): boolean` + 5 个预设

源:`useMediaQuery.ts:4-37`

```ts
export function useMediaQuery(query: string): boolean
export const useIsMobile = () => useMediaQuery('(max-width: 768px)');
export const useIsTablet = () => useMediaQuery('(min-width: 769px) and (max-width: 1024px)');
export const useIsDesktop = () => useMediaQuery('(min-width: 1025px)');
export const usePrefersDarkMode = () => useMediaQuery('(prefers-color-scheme: dark)');
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
```

### 3.8 `useClickOutside<T>(handler): RefObject<T | null>`

源:`useClickOutside.ts:4-26`

监听 `mousedown` + `touchstart`(支持移动端)。把返回的 ref 挂到容器,点击容器外触发 handler。

### 3.9 `useScrollLock(lock = true)`

源:`useScrollLock.ts:4-22`

`document.body.style.overflow = 'hidden'`。Modal 打开时锁滚动,卸载时恢复原 overflow。

### 3.10 `useIntersectionObserver<T>(options): [RefObject, isIntersecting, entry]`

源:`useIntersectionObserver.ts:11-34`

```ts
interface UseIntersectionObserverOptions {
  threshold?: number | number[];
  root?: Element | null;
  rootMargin?: string;
  freezeOnceVisible?: boolean;   // 首次进入视口后停止观察
}
```

懒加载图片 / 懒渲染列表项的标准做法。

### 3.11 `useKeyPress(targetKey): boolean` + `useKeyCombo(keys, callback)`

源:`useKeyPress.ts:4-56`

`useKeyPress('Escape')` 跟踪单键状态。`useKeyCombo(['Meta', 'K'], () => ...)` 跟踪组合键。

### 3.12 `useWindowSize(): { width, height }`

源:`useWindowSize.ts:10-36`

监听 resize,SSR safe(默认 0/0)。

### 3.13 `usePrevious<T>(value): T | undefined`

源:`usePrevious.ts:4-12`

跟踪上一次的值。

### 3.14 `useToggle(initial = false): [boolean, () => void, (v: boolean) => void]`

源:`useToggle.ts:5-17`

`[value, toggle, setTo]`。

### 3.15 `useScrollPosition(): { x, y }` + `useScrollProgress(): number`

源:`useScrollPosition.ts:9-50`

`useScrollPosition` 跟踪当前滚动位置,`useScrollProgress` 返回 0-100 的滚动百分比。两个 Hook 都 `passive: true` 监听。

### 3.16 `useTheme()` + ThemeProvider

详见 §4。

---

## 4. ThemeProvider + useTheme + 主题切换动画

源:`packages/hooks/src/useTheme.tsx`(459 行)

### 4.1 类型

```ts
export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface UseThemeReturn {
  theme: Theme;                               // 用户设置 (含 system)
  resolvedTheme: ResolvedTheme;               // 解析后实际 (light/dark)
  isDark: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;                    // 用上次 setThemeTransitionOrigin 设置的位置
  toggleThemeWithAnimation: (x: number, y: number) => void;
  toggleThemeWithFade: () => void;            // 仅 crossfade,无 clip-path
}
```

### 4.2 ThemeProvider 行为

源:`useTheme.tsx:280-424`

- **初始化**:`useState<Theme>('system')` + `useState<ResolvedTheme>('light')`,挂载后从 localStorage 读取真实 stored,避免 SSR hydration mismatch
- **跨标签页同步**:监听 `storage` 事件 key === `'aetherblog-theme'`,Blog 改主题 → Admin 自动同步,反之亦然(`useTheme.tsx:305-320`)
- **DOM 应用**:`applyTheme(resolvedTheme)` 加 `document.documentElement.classList.add('dark' | 'light')`,同时 `style.colorScheme = resolvedTheme`
- **强制暗黑模式跳过**:若 `documentElement.dataset.forceDark === 'true'`,后续 applyTheme 不覆盖

### 4.3 圆形遮罩主题切换(`performCircularTransition`)

源:`useTheme.tsx:91-214`

完整流程:

1. **检测可用性** —— `document.startViewTransition` 必须存在,且 `prefers-reduced-motion` 不为 reduce
2. **计算最大半径** —— `Math.hypot(Math.max(x, w-x), Math.max(y, h-y))` 到屏幕四角的最远距
3. **Safari 特别优化**(`useTheme.tsx:108-122`):
   - `totalDuration = 300ms`(其他 350ms)
   - `easing = 'ease-out'`(其他 `cubic-bezier(0.4, 0, 0.2, 1)`)
   - 注入临时 `<style>`:`will-change: clip-path` + `contain: layout` + 暂停其他 CSS animations(`animation-play-state: paused !important`)
4. **设置方向** —— `documentElement.dataset.themeTransition = 'to-light' | 'to-dark'`(决定 z-index)
5. **safety net** —— `setTimeout(cleanupTimer, totalDuration + 200)` 强制清理样式
6. **`transition.ready` 后** 用 `documentElement.animate({ clipPath: [from, to] }, animOpts)` 驱动:
   - root 层(全视口最大半径)
   - mobile-menu-drawer 层(局部视口,自身最大对角线)
7. `pseudoElement` = `::view-transition-new(root)`(暗→亮,扩张)或 `::view-transition-old(root)`(亮→暗,收缩,带 `fill: 'forwards'`)
8. 等待 `transition.finished`
9. **finally 清理** —— 移除临时样式 + delete dataset

**多层动画的关键**(`useTheme.tsx:81-89` 注释):侧边栏与遮罩也要同步做动画以保留 backdrop-filter;**各层扩张速度(dr/dt)必须完全一致**,防止多圈重影割裂。

### 4.4 ThemeToggle 组件

源:`packages/hooks/src/ThemeToggle.tsx`(268 行)

```ts
export interface ThemeToggleProps {
  size?: 'sm' | 'md' | 'lg';
  showSystem?: boolean;     // 显示三选下拉
  className?: string;
  labels?: Partial<ThemeToggleLabels>;   // i18n 注入
}
```

**两种模式**:
- 简单模式(默认):点击切换 light↔dark,Sun/Moon 图标 + `whileHover={{ scale: 1.1, rotate: 15 }}`
- 三选模式(`showSystem`):点击展开下拉,Sun/Moon/Monitor 三选,持久化用户偏好

**i18n**:`labels` prop 局部覆盖默认中文文案(`DEFAULT_LABELS` 在 `ThemeToggle.tsx:37-47`),屏幕阅读器 aria-label 也跟着走。

**已知偏差**:`ThemeToggle.tsx:143, 160` 用 `text-[var(--text-secondary)]`(legacy),应迁到 `var(--ink-secondary)`。

---

## 5. themeConstants —— RSC 友好的纯字符串

源:`packages/hooks/src/themeConstants.ts`(102 行)

```ts
const THEME_STORAGE_KEY = 'aetherblog-theme';

export const THEME_LIGHT_BG = '#FAF9F6';   // Codex bg-void 暖 off-white
export const THEME_DARK_BG = '#0a0a0f';

export const themeFoucGuardStyle =
  `html{background-color:${THEME_DARK_BG};color-scheme:dark}` +
  `html.light{background-color:${THEME_LIGHT_BG};color-scheme:light}` +
  `html.dark{background-color:${THEME_DARK_BG};color-scheme:dark}` +
  `body{background-color:inherit;margin:0}`;

export const themeInitScript = `
(function() {
  try {
    var theme = localStorage.getItem('${THEME_STORAGE_KEY}');
    var isDark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.add(isDark ? 'dark' : 'light');
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;
```

### 5.1 为什么单独拆出

`themeConstants.ts:1-11` 注释:

> 此文件故意**不**带 'use client' 指令:常量需要能被 Next.js 的 Server Component (RSC) 直接消费,例如 `export const viewport: Viewport`。若放在 useTheme.tsx ('use client') 里 export,穿越 RSC 边界时会被 Next 序列化为 client ref (function proxy),在 server 侧读到的不再是字符串字面量而是报错信息。

这里只放纯字符串 / 对象字面量,**不引入任何 React 运行时**。

### 5.2 FOUC Guard 防护

`themeConstants.ts:30-58` 注释:

跨应用跳转时,新标签页从零加载 HTML+CSS。如果目标站背景色只在外部 CSS(tokens.css / globals.css)定义,外部 CSS 解析完成之前浏览器用默认白底绘制首帧 —— 暗黑模式下就是"闪瞎眼"的白闪。

**解法**:

1. 在 `<head>` 顶部放 `themeFoucGuardStyle` 内联 `<style>` 把 html/body 背景色固定
2. 紧接着 `themeInitScript` 内联 `<script>` 同步给 `<html>` 加 `.dark` / `.light` 类
3. 首帧直接按用户主题着色,外部 CSS 到达后接管全量样式

```tsx
// Next.js layout.tsx
<head>
  <style dangerouslySetInnerHTML={{ __html: themeFoucGuardStyle }} />
  <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
</head>
```

### 5.3 admin index.html 的同步约束

`themeConstants.ts:42-43` 警告:**Admin 的 `apps/admin/index.html` 是静态 HTML,无法直接 import 此常量**,需要手工同步两处值。改 `THEME_LIGHT_BG` / `THEME_DARK_BG` 时务必同步 admin/index.html 顶部的 `<style>`。

### 5.4 跨应用导航约定

`themeConstants.ts:60-72`:**Blog ↔ Admin 之间的 `<a>` 一律不带 `target="_blank"`**。FOUC guard 只保护"目标 HTML 开始解析以后",管不到浏览器 spawn 新 tab 那一瞬间画的 about:blank 白底。同标签页导航受 browser paint holding 保护,无白帧。

---

## 6. view-transitions.d.ts

源:`packages/hooks/src/view-transitions.d.ts`(未读但存在)

补声明 `Document.prototype.startViewTransition` 等 View Transitions API,因为 TS 5.7 lib 默认不带这些类型。让 `useTheme.tsx:99` 的 `document.startViewTransition` 能被 IDE 识别。

---

## 7. 关键代码引用

| 文件 | 行号 | 内容 |
|:---|---:|:---|
| `packages/hooks/package.json` | 全文 | react deps + framer/lucide peer optional |
| `packages/hooks/src/index.ts` | 1-22 | 19 Hook + ThemeProvider/useTheme + ThemeToggle + themeConstants barrel |
| `packages/hooks/src/useTheme.tsx` | 91-214 | performCircularTransition 圆形遮罩切换 |
| `packages/hooks/src/useTheme.tsx` | 280-424 | ThemeProvider 实现 |
| `packages/hooks/src/useTheme.tsx` | 305-320 | 跨标签页同步(`storage` 事件) |
| `packages/hooks/src/themeConstants.ts` | 1-11 | RSC 兼容性说明 |
| `packages/hooks/src/themeConstants.ts` | 24-25 | THEME_LIGHT_BG / THEME_DARK_BG |
| `packages/hooks/src/themeConstants.ts` | 54-58 | themeFoucGuardStyle |
| `packages/hooks/src/themeConstants.ts` | 90-101 | themeInitScript |
| `packages/hooks/src/ThemeToggle.tsx` | 37-47 | DEFAULT_LABELS i18n |
| `packages/hooks/src/ThemeToggle.tsx` | 110-167 | 简单模式(Sun/Moon) |
| `packages/hooks/src/ThemeToggle.tsx` | 168-263 | 三选下拉(showSystem) |
| `packages/hooks/src/useDebounce.ts` | 1-13 | useDebounce |
| `packages/hooks/src/useCopyToClipboard.ts` | 5-30 | 三层降级(clipboard / execCommand / warn) |
| `packages/hooks/src/useMediaQuery.ts` | 32-36 | useIsMobile / useIsTablet / useIsDesktop / usePrefersDarkMode / usePrefersReducedMotion |

---

## 8. 引用的子文档与原始规范

- `.agent/rules/code-structure.md` —— Hook 命名约定(`use + camelCase`)
- `.claude/docs/dependencies-and-stack.md` §5 —— hooks barrel
- `.claude/design-system/04-motion.md` —— ThemeToggle 内的 framer-motion 用法
- `CLAUDE.md` §3.3 —— hooks 导入约定 `import { useDebounce } from '@aetherblog/hooks'`

---

## 9. 使用方与扩展点

### 9.1 谁消费 `@aetherblog/hooks`

- **blog**:`apps/blog/app/components/MobileMenu.tsx:11` (`useTheme`)、`MarkdownRenderer.tsx:16` (`useTheme`)、`BlogHeader.tsx:8` (`ThemeToggle`)、`FloatingThemeToggle.tsx:5` (`useTheme`)、`CommentSection.tsx:7` (`useIntersectionObserver`)
- **admin**:大量页面用 `useDebounce / useCopyToClipboard / useLocalStorage / useTheme`
- **`packages/editor`**:**未导入** —— editor 包独立运行
- **`packages/ui`**:**未导入** —— ui 不能反向依赖 hooks

### 9.2 加新 Hook 流程

1. 在 `packages/hooks/src/<useName>.ts` 写 Hook
2. 顶部 `'use client'` 指令(若内部用 useState / useEffect)
3. **导出命名**:`export function useXxx(...)`(default export 可加可不加)
4. 在 `packages/hooks/src/index.ts` 加 `export * from './useName';`
5. 同步 `.agent/rules/code-structure.md` Hook 清单与 `.claude/docs/dependencies-and-stack.md` §5

### 9.3 单独拆出非 client 模块

如果 Hook 文件中有"纯字符串 / 配置 / 类型"需要被 RSC server 端消费,**必须**拆到独立文件且不带 `'use client'`(参考 themeConstants.ts 的拆分)。否则 Next.js Server Component 会把它序列化成 client ref,运行时报错。

### 9.4 ThemeProvider 必须包裹根元素

```tsx
// apps/blog/app/layout.tsx
<ThemeProvider>
  {children}
</ThemeProvider>
```

`useTheme()` 必须在 Provider 内调用,否则 `useTheme.tsx:447-450` 会抛出 `useTheme must be used within a ThemeProvider`。

---

## 10. 已知限制

1. **`packages/hooks` 没有 tsconfig.json,且根 `tsconfig.json:13-19` 也没列入 references** —— TS project mode 不会跟踪它,但 IDE 能跳转(因 `exports."."` 直接指向 `./src/index.ts` 源码)。
2. **`useLocalStorage` 没有 SSR 安全的初始化** —— `useState(() => ...)` 在服务端返回 `initialValue`,客户端挂载后再读 localStorage,会有 hydration flash。`useTheme` 用 `mounted` 状态绕开,但 `useLocalStorage` 自己没做。
3. **`useScrollPosition / useScrollProgress` 没有 throttle** —— scroll 频率高,大量 setState 会浪费;消费方应自己用 `useThrottle` 包一下。
4. **`ThemeToggle.tsx` 仍用 legacy `--text-secondary`** —— P1 级偏差。
5. **`performCircularTransition` 的 mobile-menu-drawer 选择是硬编码** —— `useTheme.tsx:191-200` 写死 `.mobile-menu-drawer`,只对 blog 有效;admin 没有同名元素就不会执行多层动画。
6. **`themeInitScript` 默认 fallback 到 `dark`**(`themeConstants.ts:99`)—— 产品定位是"漂浮在夜空中的发光典籍",暗色是主调。但用户首次访问时若系统偏好 light,首帧会先 dark 一帧再切换,有微弱反向闪烁。
7. **跨标签页同步无防抖** —— Blog 改一次主题,Admin 标签页立即同步,极短时间内多次切换会有 race condition。
8. **`useKeyCombo` 用 Set 跟踪,可能漏 keyup**(浏览器在 modifier key 释放前先释放普通键时,Set 不会清空) —— 复杂场景不如 `react-hotkeys-hook`。
