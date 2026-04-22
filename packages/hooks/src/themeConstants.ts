/**
 * 主题相关的纯数据常量 —— server / client 两端共享
 *
 * 此文件故意**不**带 'use client' 指令:常量需要能被 Next.js 的
 * Server Component (RSC) 直接消费,例如 `export const viewport: Viewport`。
 * 若放在 useTheme.tsx ('use client') 里 export,穿越 RSC 边界时会被
 * Next 序列化为 client ref (function proxy),在 server 侧读到的不再是
 * 字符串字面量而是报错信息。
 *
 * 这里只放纯字符串 / 对象字面量,不引入任何 React 运行时。
 */

const THEME_STORAGE_KEY = 'aetherblog-theme';

/**
 * 首帧背景色常量 —— Blog/Admin 两端共享
 *
 * 取值必须和 tokens.css 的 `--bg-primary` 对齐。修改后需同步 apps/admin/index.html
 * 顶部硬编码的 <style> 和 <meta name="theme-color"> (admin 是静态 HTML,无法 import)。
 *
 *   light: Codex bg-void 暖 off-white
 *   dark : tokens --bg-primary dark 值
 */
export const THEME_LIGHT_BG = '#FAF9F6';
export const THEME_DARK_BG = '#0a0a0f';

/**
 * FOUC Guard 内联样式 —— 新标签页跨应用跳转时的首帧防白闪
 *
 * Blog (Next.js) 与 Admin (Vite) 是两个独立的 SPA,用户点击 <a target="_blank">
 * 跨站时,新标签页从零加载 HTML+CSS。如果目标站的 <html>/<body> 背景色只在外部
 * CSS (tokens.css / globals.css) 里定义,那么外部 CSS 解析完成之前,浏览器会用
 * 默认白底绘制首帧 —— 对已在暗黑模式下的用户来说就是一次"闪瞎眼"的白闪。
 *
 * 解法:在 <head> 顶部放一段内联 <style>,提前把 html/body 的背景色和
 * color-scheme 固定住。配合 themeInitScript 同步给 <html> 加 .dark/.light 类,
 * 首帧直接按用户主题着色,外部 CSS 到达后再接管全量样式。
 *
 * 默认(无 class)保留 dark —— 产品定位是"漂浮在夜空中的发光典籍",暗色是主调,
 * 首帧按 dark 兜底;script 同步跑完后若用户选了 light 会立刻覆盖,无反向闪烁。
 *
 * ⚠️ Admin 的 apps/admin/index.html 是静态 HTML,无法直接 import 此常量,
 * 需要手工同步两处值。改动时请同时更新 admin/index.html 顶部的 <style>。
 *
 * @example
 * ```tsx
 * // Next.js layout.tsx
 * <head>
 *   <style dangerouslySetInnerHTML={{ __html: themeFoucGuardStyle }} />
 *   <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
 * </head>
 * ```
 */
export const themeFoucGuardStyle =
  `html{background-color:${THEME_DARK_BG};color-scheme:dark}` +
  `html.light{background-color:${THEME_LIGHT_BG};color-scheme:light}` +
  `html.dark{background-color:${THEME_DARK_BG};color-scheme:dark}` +
  `body{background-color:inherit;margin:0}`;

/**
 * 主题初始化脚本 (用于避免 FOUC)
 *
 * 在 <head> 中内联此脚本,在 CSS 加载前应用主题类名。
 * 与 themeFoucGuardStyle 配合使用(style 在前,script 在后)。
 *
 * @example
 * ```tsx
 * // Next.js 布局文件 layout.tsx
 * <head>
 *   <style dangerouslySetInnerHTML={{ __html: themeFoucGuardStyle }} />
 *   <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
 * </head>
 * ```
 */
export const themeInitScript = `
(function() {
  try {
    var theme = localStorage.getItem('${THEME_STORAGE_KEY}');
    var isDark = theme === 'dark' ||
      (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.add(isDark ? 'dark' : 'light');
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;
