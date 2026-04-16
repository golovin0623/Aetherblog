# 06 · Signature Moments · 五个签名时刻

> **完美的产品让人忘记,难忘的产品靠几个瞬间被记住。**
>
> AetherBlog 必须做到这五个场景的"签名级别"。每一个都应该独立于业界其他博客产品,让读者一次难忘。

---

## 1 · 首页 Hero · 极光日晷

### 体验描述

用户打开首页,第一眼看到的是:
- 一片缓慢流动的极光铺满顶部(不是粒子、不是星光,是真正的 aurora)
- 正中偏左,一行 Fraunces Variable 的大标题在**缓慢呼吸**(SOFT 轴 8 秒循环 30 ↔ 80)
- 副标题用 Instrument Serif 斜体,小一号,克制的亮度
- 右下方一颗淡淡的 Aurora Rose 光点,与左上形成视觉对角线
- CTA 按钮是 `variant="aurora"` 的极光描边款,极弱的辉光

### 实现要点

**HTML/JSX 结构(`apps/blog/app/page.tsx`):**

```tsx
<section className="hero relative min-h-[100svh] flex items-center">
  {/* 极光日晷背景,只在此处出现一次 */}
  <div className="hero-aurora" aria-hidden="true" />

  <div className="hero-content relative z-10 px-6 max-w-5xl mx-auto">
    <div className="hero-eyebrow font-mono text-caption uppercase tracking-[0.3em] text-[var(--aurora-1)] mb-6 opacity-70">
      AETHERBLOG · A LUMINOUS CODEX
    </div>
    <h1 className="hero-title font-display text-display leading-none text-[var(--ink-primary)]">
      {siteTitle}
    </h1>
    <p className="hero-lede font-editorial italic text-lede text-[var(--ink-secondary)] mt-8 max-w-2xl">
      {siteDescription}
    </p>
    <div className="hero-actions mt-12 flex gap-4">
      <Button variant="aurora" size="lg">阅读最新文章</Button>
      <Button variant="ghost" size="lg">关于作者</Button>
    </div>
  </div>
</section>
```

**CSS(写在 globals.css 或 hero.css):**

```css
.hero {
  background: var(--bg-void);
}
.hero-aurora {
  position: absolute; inset: 0;
  background: var(--aurora-field);
  animation: aurora-drift 40s var(--ease-in-out) infinite;
  pointer-events: none;
}
.hero-title {
  font-variation-settings: "opsz" 144, "SOFT" 30, "WONK" 1;
  animation: breath 7.2s var(--ease-in-out) infinite;
  letter-spacing: -0.03em;
}

@keyframes breath {
  0%, 100% { font-variation-settings: "opsz" 144, "SOFT" 30, "WONK" 1; }
  50%      { font-variation-settings: "opsz" 144, "SOFT" 80, "WONK" 1; }
}
@keyframes aurora-drift {
  0%, 100% { transform: translate(0, 0) rotate(0); }
  33%      { transform: translate(2%, -1%) rotate(2deg); }
  66%      { transform: translate(-1%, 2%) rotate(-1deg); }
}

@media (prefers-reduced-motion: reduce) {
  .hero-title     { animation: none; font-variation-settings: "opsz" 144, "SOFT" 55, "WONK" 0; }
  .hero-aurora    { animation: none; }
}
```

### 禁忌

- ❌ Hero 里加 particles.js 粒子(与极光冲突)
- ❌ 加 scroll-driven parallax(会和呼吸冲突,保持静态)
- ❌ Hero 之外再铺极光背景(唯一光源原则)

---

## 2 · 文章阅读 · 发光手稿

### 体验描述

打开一篇文章,用户感受到:
- 页面顶部有一条极细(2px)的极光条,随滚动填充,颜色从 indigo → violet → rose 过渡
- 文章 h1 用 Fraunces Display,带微妙的斜体变体
- 正文是 Instrument Serif · 18px · 1.75 行高,宽度限在 68ch(黄金阅读宽度)
- 第一段的第一个字母 4em 下沉,带极光渐变填充
- h2 前有一个小小的 § 符号(极光色)
- 代码块左边是 2px 极光光条
- blockquote 不再有左边框,改成"左溢出"——文字向左缩进 2em,`""` 引号用 Fraunces 斜体当装饰
- **桌面端 ≥1280px**:左侧 marginalia 区域漂浮显示 TOC + 标签 + 发布日期(Geist Mono 小字)
- 文末有作者卡片 + 上/下篇导航,简洁

### 实现要点

**Layout(`apps/blog/app/posts/(article)/[slug]/page.tsx`):**

```tsx
<ReadingProgress />  {/* 顶部极光条 */}

<article className="article-root relative mx-auto max-w-[1280px] px-4 lg:px-8 pt-28 pb-24">
  {/* marginalia —— 桌面端左侧浮动 */}
  <aside className="marginalia hidden xl:block absolute left-0 top-28 w-48">
    <TableOfContents variant="marginalia" items={toc} />
    <MetaBlock tags={tags} readingTime={readingTime} publishedAt={publishedAt} />
  </aside>

  {/* 正文 —— 居中 68ch */}
  <div className="reading-column mx-auto max-w-[68ch]">
    <ArticleHeader title={title} lede={lede} />
    <div className="markdown-body prose-luminous" dangerouslySetInnerHTML={{ __html: html }} />
    <AuthorProfileCard className="mt-16" />
    <PostNavigation prev={prev} next={next} className="mt-12" />
  </div>
</article>

<CommentSection />
```

**CSS 升级(`apps/blog/app/globals.css` 的 .markdown-body 节):**

见 [03-typography.md · 编辑级文章排印](./03-typography.md#编辑级文章排印) 全套。

**阅读进度条组件(`apps/blog/app/components/ReadingProgress.tsx`):**

```tsx
'use client';
import { useEffect, useState } from 'react';

export function ReadingProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = document.documentElement;
        const p = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
        setProgress(Math.min(1, Math.max(0, p)));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className="reading-progress"
      style={{ '--reading-progress': progress } as React.CSSProperties}
      aria-hidden
    />
  );
}
```

CSS 见 [04-motion.md · 阅读进度极光条](./04-motion.md#4--阅读进度极光条)。

### marginalia 样式

```css
.marginalia {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--ink-muted);
  line-height: var(--lh-normal);
}
.marginalia .toc-item {
  padding: 0.25em 0;
  border-left: 1px solid transparent;
  padding-left: 0.75em;
  transition: all var(--dur-quick) var(--ease-out);
}
.marginalia .toc-item[data-active="true"] {
  border-left-color: var(--aurora-1);
  color: var(--ink-primary);
}
```

### 禁忌

- ❌ 文章宽度 > 80ch
- ❌ 正文字号桌面 < 17px
- ❌ 首字下沉用非 Fraunces(其他衬线不好看)
- ❌ 在文章里铺第二片极光背景

---

## 3 · 命令面板 · ⌘K

### 体验描述

用户任何页面按 ⌘K:
- 屏幕中心浮出一个 `.surface-overlay` 面板(带极光辉光边)
- 一个输入框,光标是闪烁的极光方块(而不是 `|`)
- 输入框支持四种**前缀路由**:
  - `>` → 导航模式(跳转文章/分类)
  - `?` → AI 问答模式(触发 SSE 问答)
  - `/` → 命令模式(切换主题/锁定/登出)
  - 默认 → 混合搜索(已有后端,tsvector + pgvector)
- 前缀输入后,左侧出现"模式 chip":`[NAV]` / `[ASK]` / `[CMD]` / `[SEARCH]`
- 结果列表用 fade-up stagger 进入,hover 项左侧极光点
- AI 问答结果流式渲染,末尾是"墨水光标"
- Esc 关闭,动画反向 scaleIn

### 实现要点

**组件位置:**
- blog:升级现有 `apps/blog/app/components/SearchPanel.tsx`
- admin:新建 `apps/admin/src/components/common/CommandPalette.tsx`(复用大部分 UI)

**模式识别函数:**

```ts
type CommandMode = 'nav' | 'ask' | 'cmd' | 'search';

function parseMode(q: string): { mode: CommandMode; query: string } {
  if (q.startsWith('>')) return { mode: 'nav',   query: q.slice(1).trim() };
  if (q.startsWith('?')) return { mode: 'ask',   query: q.slice(1).trim() };
  if (q.startsWith('/')) return { mode: 'cmd',   query: q.slice(1).trim() };
  return { mode: 'search', query: q.trim() };
}
```

**Chip 样式:**

```css
.cmd-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.2em 0.5em;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--aurora-1) 15%, transparent);
  color: var(--aurora-1);
  border: 1px solid color-mix(in oklch, var(--aurora-1) 30%, transparent);
}
```

**墨水光标:**

```css
.ink-cursor {
  display: inline-block;
  width: 0.4em;
  height: 1em;
  vertical-align: text-bottom;
  background: var(--aurora-1);
  animation: ink-blink 800ms var(--ease-in-out) infinite;
  box-shadow: 0 0 4px var(--aurora-1);
}
@keyframes ink-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.2; }
}
```

### 禁忌

- ❌ 命令面板用 `.surface-leaf`(应该 overlay)
- ❌ AI 流式输出用普通 `|` 光标
- ❌ 结果列表超过 2 屏(应该触顶提示"更精确地搜索")

---

## 4 · Admin 控制室 · 专注模式

### 体验描述

博客是编辑的、诗意的;admin 是精密的、键盘优先的。同套 token,不同气质。

- Sidebar 用 `.surface-raised`,激活项**左侧 2px 极光线**(不是整块底色)
- 表格行 hover 左侧极光线 + 极弱底色,数字列启用 tnum
- 顶部全站 `⌘K` 打开命令面板
- `⌘.` 进入专注模式:sidebar + header 淡出,主区域饱和度 +10%,极光亮度 +20%
- StatsCard 数字用 Fraunces Variable,hover 时 WONK 轴 0→1,"歪一下再回来"
- 编辑页有 `⌘S` 保存、`⌘P` 预览、`⌘Enter` 发布等一整套键盘命令

### 实现要点

**专注模式 Context(`apps/admin/src/contexts/FocusModeContext.tsx`):**

```tsx
'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

type Ctx = { focused: boolean; toggle: () => void };
const FocusModeContext = createContext<Ctx>({ focused: false, toggle: () => {} });

export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  useHotkeys('meta+.,ctrl+.', () => setFocused(f => !f), { preventDefault: true });

  useEffect(() => {
    document.documentElement.dataset.focusMode = focused ? 'on' : 'off';
  }, [focused]);

  return (
    <FocusModeContext.Provider value={{ focused, toggle: () => setFocused(f => !f) }}>
      {children}
    </FocusModeContext.Provider>
  );
}
export const useFocusMode = () => useContext(FocusModeContext);
```

**全局 CSS:**

```css
html[data-focus-mode="on"] .admin-sidebar,
html[data-focus-mode="on"] .admin-header {
  opacity: 0.2;
  transition: opacity var(--dur-flow) var(--ease-out);
  pointer-events: none;
}
html[data-focus-mode="on"] .admin-sidebar:hover,
html[data-focus-mode="on"] .admin-header:hover {
  opacity: 1;
  pointer-events: auto;
}
html[data-focus-mode="on"] .admin-main::before {
  /* 极光更亮 */
  opacity: 1.2;
}
```

**SSG(Sidebar Signature):**

```css
.sidebar-item {
  position: relative;
  padding: 0.6rem 1rem;
  color: var(--ink-muted);
  transition: color var(--dur-quick) var(--ease-out);
}
.sidebar-item::before {
  content: '';
  position: absolute; left: 0; top: 50%;
  width: 2px; height: 0;
  background: var(--aurora-1);
  transform: translateY(-50%);
  transition: height var(--dur-quick) var(--ease-out);
  border-radius: 2px;
}
.sidebar-item:hover,
.sidebar-item[data-active="true"] {
  color: var(--ink-primary);
}
.sidebar-item[data-active="true"]::before {
  height: 60%;
  box-shadow: 0 0 6px var(--aurora-1);
}
```

### 禁忌

- ❌ Admin 用博客的装饰性元素(§ 章节标记、首字下沉)
- ❌ Sidebar 激活项加"整块高亮底色"
- ❌ 表格行加 `shadow-md` 等视觉噪声

---

## 5 · AI 工坊 · Ink Bleed

### 体验描述

在 admin 的 AI 工作台(`apps/admin/src/pages/posts/AiWritingWorkspacePage.tsx`)中,流式 AI 输出的文字**像墨水一滴一滴渗入纸张**,而不是机器般地一行一行 push 出来。

- 每个新到达的字符/词块透明度 0 → 1,带 2px 上浮,有极轻模糊→清晰过渡
- 整体文字用 Instrument Serif(让 AI 输出看起来"有人味")
- 流式末尾有一个墨水方块光标(与命令面板一致)
- "思考中"(think 块)用不同字号 + `text-muted`,`<details>` 折叠

### 实现要点

**CSS 全局 @keyframes(写入 `packages/ui/src/styles/typography.css`):**

```css
@keyframes ink-bleed {
  from {
    opacity: 0;
    transform: translateY(2px);
    filter: blur(1.5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

.ai-stream {
  font-family: var(--font-editorial);
  font-size: var(--fs-reading);
  line-height: var(--lh-relaxed);
  color: var(--ink-primary);
}
.ai-stream .delta {
  display: inline-block;
  animation: ink-bleed 220ms var(--ease-out) both;
  will-change: opacity, transform, filter;
}
.ai-stream .think-block {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--ink-muted);
  opacity: 0.6;
  padding: 0.5em 1em;
  border-left: 2px solid var(--ink-subtle);
  margin: 0.5em 0;
}
```

**React 渲染策略(摘要):**

```tsx
function AIStream({ content }: { content: string }) {
  // 简化示意:把 content 按句切分,每句包 <span.delta>
  const chunks = useMemo(() => content.split(/(?<=[。！?.!?]\s)/), [content]);
  return (
    <div className="ai-stream">
      {chunks.map((c, i) => (
        <span key={i} className="delta" style={{ animationDelay: `${i * 40}ms` }}>
          {c}
        </span>
      ))}
      <span className="ink-cursor" aria-hidden />
    </div>
  );
}
```

### 禁忌

- ❌ 流式用 `typewriter.js` / 打字机效果(是不同隐喻)
- ❌ 每个字符都单独动画(性能差,按句/按块分片)
- ❌ 结束后光标仍在闪(流完应收起)

---

## 五个时刻之间的关系

| 时刻 | 主字体 | 主 surface | 主动效 |
|:---|:---|:---|:---|
| Hero | Fraunces | — | 呼吸 + 极光漂移 |
| 文章阅读 | Instrument Serif + Fraunces | — | 阅读进度极光条 |
| 命令面板 | Geist / Mono | overlay | scaleIn + 墨水光标 |
| Admin 控制室 | Geist / Mono / Fraunces(数字) | raised | WONK 扭 + 专注模式淡出 |
| AI 工坊 | Instrument Serif | leaf | ink bleed |

五个时刻各有主字体、主 surface、主动效 —— 形成可辨识的"指纹"。

---

## 验收标准

发布前每个时刻都必须过以下验收:

- [ ] 在 16ms/帧下动画流畅(Chrome DevTools Performance)
- [ ] `prefers-reduced-motion` 下所有动画禁用,布局仍成立
- [ ] 移动端(≤640px)体验降级合理,不是破坏性的
- [ ] 暗/亮双主题下都美观
- [ ] 键盘可完全操作(尤其命令面板)
- [ ] 颜色对比度 ≥ AA
