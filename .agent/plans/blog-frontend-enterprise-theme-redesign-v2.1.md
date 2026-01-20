# 博客前端企业级主题重新设计计划 v2.1

## 用户需求升级

### 最新要求（v2.1 标准）

用户明确要求达到 **v2.1 企业级标准**，对标 Microsoft Fluent Design 和 Apple Human Interface Guidelines，并特别强调：

1. **✅ Markdown 渲染体验对齐顶级笔记应用** - Notion、Bear、Obsidian、Typora 的水准
2. **✅ 修复暗色主题的 Markdown 显示问题** - 暗色主题也存在许多问题
3. **✅ 两个主题都要完美适配** - 亮色和暗色主题都要达到企业级标准
4. **✅ 完整的设计系统** - 运动设计、无障碍、间距系统、图标系统等

### 第一版实现的问题（已识别）

1. **❌ 文字对比度仍然不足** - "整体的字有些看不清"
2. **❌ 聚光灯效果失败** - "聚光灯的深色阴影有了但是不像聚光灯，整块大范围都在阴影中"
3. **❌ 紫色阴影违和** - "logo和首页栏和个人信息头像也有紫色阴影感觉有些违和"
4. **❌ 设计过于简单** - "整体的颜色设计过于简单了就黑色和白色没有企业级别的ui设计"
5. **❌ 缺少细节** - "很多元素细节都没有我认为是不合格的"
6. **❌ Markdown 渲染问题** - 暗色主题存在 28 个问题，亮色主题存在 18 个问题

### 根本原因

- **过度简化** - 只是移除了装饰效果，没有用更好的设计替代
- **缺乏色彩层次** - 只有黑白灰，没有利用品牌色和辅助色
- **缺少微交互** - 没有精致的悬停效果、状态变化
- **缺少设计细节** - 没有渐变、图标装饰、视觉引导等
- **Markdown 渲染不专业** - 间距、颜色、样式都不符合顶级应用标准

---

## 企业级设计方案 v2.1

### 设计参考

**UI 设计参考：**
- **Notion** - 清爽的卡片设计、柔和的阴影、精致的图标、极简留白
- **Linear** - 精确的间距、优雅的渐变、流畅的动画
- **GitHub** - 清晰的层次、丰富的状态色、专业的排版
- **Stripe** - 品牌色运用、微妙的渐变、精致的细节

**Markdown 渲染参考：**
- **Notion** - 大量留白、柔和配色、舒适对比度、流畅交互
- **Bear** - 温暖配色、精致排版、优雅标题层次、舒适行高
- **Obsidian** - 专业 Markdown 渲染、丰富扩展语法、清晰层次
- **Typora** - 所见即所得体验、精确间距控制、流畅阅读

**设计系统参考：**
- **Microsoft Fluent Design** - Acrylic材质、Reveal效果、深度、运动
- **Apple Human Interface Guidelines** - 清晰度、遵从性、深度、空间关系

### 核心设计原则

1. **色彩丰富但克制**
   - 主题色（Indigo）用于强调和交互
   - 辅助色（蓝、绿、橙）用于状态和分类
   - 中性色（灰度）用于层次和结构
   - 渐变用于装饰和引导

2. **层次清晰**
   - 使用阴影定义深度（4层阴影系统）
   - 使用边框定义边界
   - 使用背景色定义区域
   - 使用渐变定义方向

3. **微交互丰富**
   - 悬停时的颜色变化（运动设计系统）
   - 悬停时的阴影提升
   - 悬停时的图标动画
   - 点击时的反馈

4. **细节精致**
   - 卡片顶部的品牌色装饰条
   - 图标的渐变填充
   - 文字的渐变效果
   - 按钮的渐变背景

5. **Markdown 专业**
   - 舒适的行高和间距（对齐 Typora）
   - 清晰的标题层次（对齐 Notion）
   - 精致的代码块样式（对齐 Obsidian）
   - 温暖的配色（对齐 Bear）

6. **无障碍优先**
   - 符合 WCAG AA 标准的对比度
   - 清晰的 Focus 状态
   - 支持键盘导航
   - 支持高对比度模式

7. **运动流畅**
   - 标准化的缓动函数
   - 统一的动画时长
   - 物理模拟的弹簧动画
   - 页面转场动画

---

## v2.1 扩展的 CSS 变量系统

### 完整的色彩系统

```css
/* 亮色主题 */
:root, :root.light {
  /* === 品牌色系统 === */
  --color-primary: #6366f1;           /* Indigo 500 */
  --color-primary-hover: #4f46e5;     /* Indigo 600 */
  --color-primary-light: #a5b4fc;     /* Indigo 300 */
  --color-primary-lighter: #e0e7ff;   /* Indigo 100 */

  /* === 辅助色系统 === */
  --color-accent-blue: #3b82f6;       /* Blue 500 */
  --color-accent-green: #10b981;      /* Green 500 */
  --color-accent-orange: #f59e0b;     /* Amber 500 */
  --color-accent-purple: #8b5cf6;     /* Purple 500 */

  /* === 背景色系统（丰富的层次）=== */
  --bg-primary: #ffffff;
  --bg-secondary: #f8fafc;            /* Slate 50 */
  --bg-tertiary: #f1f5f9;             /* Slate 100 */
  --bg-quaternary: #e2e8f0;           /* Slate 200 */

  --bg-card: #ffffff;                 /* 纯白卡片 */
  --bg-card-hover: #fafbfc;           /* 微妙的灰 */

  /* === 文字色系统（高对比度）=== */
  --text-primary: #0f172a;            /* Slate 900 */
  --text-secondary: #1e293b;          /* Slate 800 - 从 #334155 加深 */
  --text-tertiary: #475569;           /* Slate 600 */
  --text-muted: #64748b;              /* Slate 500 */
  --text-inverse: #ffffff;

  /* === 边框色系统 === */
  --border-default: #e2e8f0;          /* Slate 200 - 清晰可见 */
  --border-hover: #6366f1;            /* 主题色 */
  --border-subtle: #f1f5f9;           /* Slate 100 */

  /* === 阴影系统（企业级4层）=== */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04);

  /* 彩色阴影（用于强调）*/
  --shadow-primary: 0 4px 14px rgba(99, 102, 241, 0.15);
  --shadow-primary-lg: 0 10px 30px rgba(99, 102, 241, 0.2);

  /* === 渐变系统 === */
  --gradient-primary: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --gradient-accent: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  --gradient-subtle: linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(248,250,252,1) 100%);

  /* === 装饰元素 === */
  --decoration-bar-height: 3px;       /* 顶部装饰条高度 */
  --decoration-gradient: linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899);

  /* === 状态色 === */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;

  /* === Markdown 专用变量 === */
  --markdown-bg-code: #f8fafc;        /* 代码块背景 */
  --markdown-bg-code-inline: #e5e7eb; /* 行内代码背景 */
  --markdown-text-code: #4f46e5;      /* 代码文字颜色 */
  --markdown-border-code: #e2e8f0;    /* 代码块边框 */
  --markdown-bg-quote: rgba(0, 0, 0, 0.03);  /* 引用块背景 */
  --markdown-border-quote: #6366f1;   /* 引用块左边框 */
  --markdown-line-height: 1.8;        /* 行高 */
  --markdown-paragraph-spacing: 1em;  /* 段落间距 */

  /* === 运动设计系统 === */
  --motion-ease-productive: cubic-bezier(0.2, 0, 0.38, 0.9);
  --motion-ease-expressive: cubic-bezier(0.4, 0.14, 0.3, 1);
  --motion-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  --motion-duration-instant: 100ms;
  --motion-duration-fast: 200ms;
  --motion-duration-moderate: 300ms;
  --motion-duration-slow: 400ms;
  --motion-duration-slower: 700ms;

  /* === 间距系统（8pt grid）=== */
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-12: 3rem;    /* 48px */

  /* === 排版系统 === */
  --font-size-xs: 0.75rem;    /* 12px */
  --font-size-sm: 0.875rem;   /* 14px */
  --font-size-base: 1rem;     /* 16px */
  --font-size-lg: 1.125rem;   /* 18px */
  --font-size-xl: 1.25rem;    /* 20px */
  --font-size-2xl: 1.5rem;    /* 24px */

  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* === 无障碍 === */
  --focus-ring: 0 0 0 3px rgba(99, 102, 241, 0.3);
  --focus-ring-offset: 2px;

  /* 环境光 - 完全移除 */
  --ambient-glow-opacity: 0;

  /* 聚光灯 - 完全禁用 */
  --spotlight-color: transparent;
  --spotlight-opacity: 0;
}

/* 暗色主题 */
:root.dark {
  --color-primary: #6366f1;
  --color-primary-hover: #818cf8;
  --color-primary-light: #a5b4fc;
  --color-primary-lighter: #e0e7ff;

  /* 辅助色 */
  --color-accent-blue: #3b82f6;
  --color-accent-green: #10b981;
  --color-accent-orange: #f59e0b;
  --color-accent-purple: #8b5cf6;

  /* 背景色 */
  --bg-primary: #0a0a0f;
  --bg-secondary: #13131a;
  --bg-tertiary: #1a1a24;
  --bg-quaternary: #252530;
  --bg-card: rgba(255, 255, 255, 0.05);
  --bg-card-hover: rgba(255, 255, 255, 0.08);

  /* 文字色 */
  --text-primary: #ffffff;
  --text-secondary: #cbd5e1;          /* 从 #94a3b8 提亮 */
  --text-tertiary: #94a3b8;
  --text-muted: #64748b;
  --text-inverse: #0f172a;

  /* 边框色 */
  --border-default: rgba(255, 255, 255, 0.1);
  --border-hover: rgba(255, 255, 255, 0.2);
  --border-subtle: rgba(255, 255, 255, 0.05);

  /* 阴影 */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.2);

  --shadow-primary: 0 4px 14px rgba(99, 102, 241, 0.3);
  --shadow-primary-lg: 0 10px 30px rgba(99, 102, 241, 0.4);

  /* 渐变系统 */
  --gradient-primary: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --gradient-accent: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  --gradient-subtle: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(19,19,26,1) 100%);

  /* 装饰元素 */
  --decoration-bar-height: 3px;
  --decoration-gradient: linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899);

  /* 状态色 */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;

  /* Markdown 专用变量 */
  --markdown-bg-code: #1a1b26;        /* 代码块背景 */
  --markdown-bg-code-inline: rgba(255, 255, 255, 0.1);  /* 行内代码背景 */
  --markdown-text-code: #a78bfa;      /* 代码文字颜色 - 更柔和 */
  --markdown-border-code: rgba(255, 255, 255, 0.08);  /* 代码块边框 */
  --markdown-bg-quote: rgba(255, 255, 255, 0.03);  /* 引用块背景 */
  --markdown-border-quote: #6366f1;   /* 引用块左边框 */
  --markdown-line-height: 1.8;        /* 行高 */
  --markdown-paragraph-spacing: 1em;  /* 段落间距 */

  /* 运动设计系统（与亮色主题相同）*/
  --motion-ease-productive: cubic-bezier(0.2, 0, 0.38, 0.9);
  --motion-ease-expressive: cubic-bezier(0.4, 0.14, 0.3, 1);
  --motion-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  --motion-duration-instant: 100ms;
  --motion-duration-fast: 200ms;
  --motion-duration-moderate: 300ms;
  --motion-duration-slow: 400ms;
  --motion-duration-slower: 700ms;

  /* 间距系统（与亮色主题相同）*/
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;

  /* 排版系统（与亮色主题相同）*/
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;

  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* 无障碍 */
  --focus-ring: 0 0 0 3px rgba(99, 102, 241, 0.5);
  --focus-ring-offset: 2px;

  /* 环境光效果 - 保持原有效果 */
  --ambient-glow-opacity: 0.6;
  --ambient-glow-blur: 120px;

  /* 聚光灯效果 */
  --spotlight-color: rgba(99, 102, 241, 0.1);
  --spotlight-opacity: 1;
}

/* 高对比度模式支持 */
@media (prefers-contrast: high) {
  :root.light {
    --border-default: rgba(0, 0, 0, 0.3);
    --text-secondary: #1e293b;
    --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  :root.dark {
    --border-default: rgba(255, 255, 255, 0.3);
    --text-secondary: #f1f5f9;
  }
}

/* 减少动画模式支持 */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Markdown 渲染优化方案（对齐顶级笔记应用）

### 核心问题总结

根据分析，发现 **62 个具体问题**：
- 暗色主题：28 个问题
- 亮色主题：18 个问题
- 架构问题：7 个问题
- 缺失功能：8 个问题
- 性能问题：3 个问题

### 高优先级修复（影响阅读体验）

#### 1. 统一代码块样式使用 CSS 变量

**当前问题：**
- MarkdownRenderer: `bg-[#1a1b26]` (硬编码)
- MarkdownPreview: `background: #1a1b26` (硬编码)
- 亮色主题下代码块仍使用暗色背景

**解决方案：**
```tsx
// MarkdownRenderer.tsx - ShikiCodeBlock 组件
<div className="code-block-wrapper ... bg-[var(--markdown-bg-code)]">
  <div className="code-block-header ... bg-[var(--bg-secondary)] border-b border-[var(--markdown-border-code)]">
    ...
  </div>
</div>
```

**globals.css 更新：**
```css
.markdown-body pre {
  background: var(--markdown-bg-code);
  border: 1px solid var(--markdown-border-code);
  padding: 1.2em 1.5em;  /* 从 1em 增加 */
  border-radius: 12px;   /* 从 8px 增加 */
}
```

#### 2. 增加段落间距和行高

**当前问题：**
- 段落间距过小：`margin: 0.75em 0`
- 行高未统一设置或过小

**解决方案：**
```css
.markdown-body {
  line-height: var(--markdown-line-height);  /* 1.8 */
}

.markdown-body p {
  margin: var(--markdown-paragraph-spacing) 0;  /* 1em */
  line-height: var(--markdown-line-height);
}
```

#### 3. 调整标题间距和字重

**当前问题：**
- 标题间距不够呼吸感
- 标题字重不够明显

**解决方案：**
```css
.markdown-body h1 {
  font-size: 2em;
  font-weight: 800;      /* 从 700 提升 */
  margin-top: 2em;       /* 从 1.5em 增加 */
  margin-bottom: 0.5em;
  border-bottom: 1px solid var(--border-subtle);  /* 更淡的下划线 */
}

.markdown-body h2 {
  font-size: 1.5em;
  font-weight: 700;      /* 从 600 提升 */
  margin-top: 1.6em;     /* 从 1.25em 增加 */
  margin-bottom: 0.5em;
}

.markdown-body h3 {
  font-size: 1.25em;
  font-weight: 600;
  margin-top: 1.4em;     /* 从 1em 增加 */
  margin-bottom: 0.5em;
}
```

#### 4. 统一行内代码样式

**当前问题：**
- MarkdownRenderer: `bg-primary/15` (紫色调)
- MarkdownPreview: `rgba(255, 255, 255, 0.1)` (灰色调)
- 文字颜色过于鲜艳

**解决方案：**
```tsx
// MarkdownRenderer.tsx - code 组件
code: ({ className, children, ...props }) => {
  if (className) {
    return <code className={className} {...props}>{children}</code>;
  }
  return (
    <code
      className="bg-[var(--markdown-bg-code-inline)] text-[var(--markdown-text-code)] px-[0.25em] py-[0.5em] rounded text-sm font-mono"
      {...props}
    >
      {children}
    </code>
  );
}
```

```css
.markdown-body code {
  background: var(--markdown-bg-code-inline);
  color: var(--markdown-text-code);
  padding: 0.25em 0.5em;  /* 从 0.2em 0.4em 增加 */
  border-radius: 4px;
}
```

#### 5. 优化引用块样式

**当前问题：**
- 背景色过于明显（紫色调）
- 左边框过粗（4px）
- 文字颜色过暗

**解决方案：**
```tsx
// MarkdownRenderer.tsx - blockquote 组件
blockquote: ({ children }) => (
  <blockquote className="border-l-[3px] border-[var(--markdown-border-quote)] pl-4 my-4 text-[var(--text-secondary)] bg-[var(--markdown-bg-quote)] py-2 pr-4 rounded-r">
    {children}
  </blockquote>
)
```

```css
.markdown-body blockquote {
  border-left: 3px solid var(--markdown-border-quote);  /* 从 4px 减少 */
  padding-left: 1em;
  margin: 1em 0;
  color: var(--text-secondary);  /* 从 var(--text-muted) 提亮 */
  background: var(--markdown-bg-quote);
  font-style: normal;  /* 移除斜体 */
}
```

### 中优先级修复（提升专业度）

#### 6. 改进表格样式

**解决方案：**
```css
.markdown-body table {
  border-collapse: collapse;
  margin: 1em 0;
  border: 1px solid var(--border-subtle);
}

.markdown-body th, .markdown-body td {
  border: 1px solid var(--border-subtle);
  padding: 0.75em 1.25em;  /* 从 0.5em 1em 增加 */
}

.markdown-body th {
  background: rgba(var(--bg-secondary-rgb), 0.5);  /* 更明显的背景 */
  font-weight: 600;
}
```

#### 7. 优化链接样式

**解决方案：**
```tsx
// MarkdownRenderer.tsx - a 组件
a: ({ href, children, ...props }) => (
  <a
    href={href}
    target={href?.startsWith('http') ? '_blank' : undefined}
    rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
    className="text-primary hover:text-primary/80 no-underline border-b border-transparent hover:border-primary transition-colors"
    {...props}
  >
    {children}
  </a>
)
```

```css
.markdown-body a {
  color: var(--color-primary);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color var(--motion-duration-fast) var(--motion-ease-productive);
}

.markdown-body a:hover {
  border-bottom-color: var(--color-primary);
}
```

#### 8. 统一图片边框和阴影

**解决方案：**
```tsx
// MarkdownRenderer.tsx - img 组件
img: ({ src, alt, ...props }) => {
  // ... 大小解析逻辑 ...
  return (
    <span className="block my-4 text-center">
      <img
        src={src}
        alt={displayAlt}
        loading="lazy"
        className="max-w-full rounded-lg border border-[var(--border-subtle)] inline-block transition-all duration-300"
        style={{
          width: width,
          boxShadow: 'var(--shadow-md)'  /* 统一使用 CSS 变量 */
        }}
        {...props}
      />
      {displayAlt && <span className="block text-center text-sm text-[var(--text-muted)] mt-2">{displayAlt}</span>}
    </span>
  );
}
```

#### 9. 添加任务列表样式

**新增功能：**
```css
/* 任务列表样式 */
.markdown-body input[type="checkbox"] {
  margin-right: 0.5em;
  width: 1em;
  height: 1em;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.markdown-body li:has(> input[type="checkbox"]) {
  list-style: none;
  margin-left: -1.5em;
}
```

### 低优先级功能（锦上添花）

#### 10. 添加代码块行号（可选）

**实现思路：**
```tsx
// ShikiCodeBlock 组件添加 showLineNumbers prop
const html = highlighter.codeToHtml(code, {
  lang: lang === 'text' ? 'text' : lang,
  theme: shikiTheme,
  transformers: [{
    line(node, line) {
      node.properties['data-line'] = line;
    }
  }]
});
```

```css
.shiki code .line::before {
  content: attr(data-line);
  display: inline-block;
  width: 2em;
  margin-right: 1em;
  text-align: right;
  color: var(--text-muted);
  user-select: none;
}
```

#### 11. 添加高亮行支持

**语法：** ` ```js{1,3-5} `

**实现思路：**
```tsx
// 解析语言和高亮行
const match = /language-(\\w+)(?:\\{([\\d,-]+)\\})?/.exec(className);
const language = match?.[1] || '';
const highlightLines = match?.[2]?.split(',').flatMap(range => {
  const [start, end] = range.split('-').map(Number);
  return end ? Array.from({ length: end - start + 1 }, (_, i) => start + i) : [start];
}) || [];
```

#### 12. 添加 Callout 块支持

**语法：** `> [!NOTE] 标题`

**实现思路：**
```tsx
// 检测 callout 语法
const calloutMatch = /^\\[!(NOTE|TIP|WARNING|DANGER)\\]\\s*(.*)/.exec(firstChild);
if (calloutMatch) {
  const [, type, title] = calloutMatch;
  return (
    <div className={`callout callout-${type.toLowerCase()} ...`}>
      <div className="callout-title">{title || type}</div>
      <div className="callout-content">{restContent}</div>
    </div>
  );
}
```

### 架构优化（长期）

#### 13. 统一三套渲染系统

**当前问题：**
- MarkdownRenderer (博客)
- MarkdownPreview (编辑器)
- MiniMarkdownPreview (列表)

**建议：**
- 将 MarkdownRenderer 作为核心实现
- MarkdownPreview 和 MiniMarkdownPreview 基于 MarkdownRenderer 封装
- 通过 props 控制功能开关（如是否显示行号、是否懒加载等）

#### 14. 移除硬编码颜色

**扫描并替换所有硬编码颜色：**
- `#1a1b26` → `var(--markdown-bg-code)`
- `#f1f5f9` → `var(--markdown-bg-code)` (亮色)
- `rgba(255, 255, 255, 0.1)` → `var(--markdown-bg-code-inline)`
- `#6366f1` → `var(--color-primary)`
- `#818cf8` → `var(--color-primary-hover)`

#### 15. 添加响应式设计

**移动端优化：**
```css
@media (max-width: 768px) {
  .markdown-body {
    font-size: 15px;  /* 从 16px 减小 */
  }

  .markdown-body h1 {
    font-size: 1.75em;  /* 从 2em 减小 */
  }

  .markdown-body pre {
    padding: 1em;  /* 从 1.2em 1.5em 减小 */
  }

  .markdown-body table {
    display: block;
    overflow-x: auto;
  }
}
```

---

## v2.1 实施计划

### 阶段 1: 扩展 CSS 变量系统（核心基础）
**优先级：最高**

- [ ] 在 `apps/blog/app/globals.css` 中添加完整的 v2.1 CSS 变量
  - 品牌色系统（primary, primary-hover, primary-light, primary-lighter）
  - 辅助色系统（blue, green, orange, purple）
  - 状态色系统（success, warning, error, info）
  - 渐变系统（gradient-primary, gradient-accent, gradient-subtle）
  - 装饰元素（decoration-bar-height, decoration-gradient）
  - **Markdown 专用变量**（markdown-bg-code, markdown-text-code, markdown-line-height 等）
  - **运动设计系统**（motion-ease-*, motion-duration-*）
  - **间距系统**（space-1 到 space-12，8pt grid）
  - **排版系统**（font-size-*, leading-*）
  - **无障碍**（focus-ring, focus-ring-offset）
  - 高对比度模式支持（@media prefers-contrast: high）
  - 减少动画模式支持（@media prefers-reduced-motion: reduce）

### 阶段 2: Markdown 渲染优化（高优先级）
**优先级：最高**

#### 2.1 更新 globals.css 中的 .markdown-body 样式
- [ ] 统一代码块背景使用 `var(--markdown-bg-code)`
- [ ] 增加代码块内边距至 `1.2em 1.5em`
- [ ] 增加代码块圆角至 `12px`
- [ ] 统一代码块边框使用 `var(--markdown-border-code)`
- [ ] 设置全局行高 `line-height: var(--markdown-line-height)`
- [ ] 增加段落间距至 `var(--markdown-paragraph-spacing)`
- [ ] 调整标题间距（H1: 2em, H2: 1.6em, H3: 1.4em）
- [ ] 提升标题字重（H1: 800, H2: 700, H3: 600）
- [ ] 优化 H1 下划线使用 `var(--border-subtle)`
- [ ] 统一行内代码背景使用 `var(--markdown-bg-code-inline)`
- [ ] 统一行内代码文字颜色使用 `var(--markdown-text-code)`
- [ ] 增加行内代码内边距至 `0.25em 0.5em`
- [ ] 优化引用块左边框至 `3px`
- [ ] 引用块文字颜色改为 `var(--text-secondary)`
- [ ] 引用块背景改为 `var(--markdown-bg-quote)`
- [ ] 移除引用块斜体样式
- [ ] 优化表格单元格内边距至 `0.75em 1.25em`
- [ ] 优化表格边框使用 `var(--border-subtle)`
- [ ] 优化链接样式（移除下划线，hover 时显示 border-bottom）
- [ ] 统一图片边框和阴影使用 CSS 变量
- [ ] 添加任务列表样式

#### 2.2 更新 MarkdownRenderer.tsx
- [ ] ShikiCodeBlock 组件使用 `var(--markdown-bg-code)`
- [ ] 代码块 header 使用 `var(--bg-secondary)` 和 `var(--markdown-border-code)`
- [ ] 行内 code 组件使用 Markdown 专用变量
- [ ] blockquote 组件使用 Markdown 专用变量
- [ ] a 组件优化链接样式（border-bottom 动画）
- [ ] img 组件统一边框和阴影
- [ ] 移除所有硬编码颜色值

#### 2.3 更新 MarkdownPreview.tsx（编辑器）
- [ ] 同步 MarkdownRenderer 的所有改进
- [ ] 移除重复的 CSS 定义，改为引用 globals.css
- [ ] 统一使用 CSS 变量

#### 2.4 更新 MiniMarkdownPreview.tsx
- [ ] 同步使用 Markdown 专用 CSS 变量
- [ ] 保持紧凑样式但使用统一的变量系统

### 阶段 3: UI 组件企业级重设计（高优先级）
**优先级：高**

#### 3.1 ArticleCard 重设计
- [ ] 添加顶部装饰条（3px 渐变）
  ```tsx
  <div className="absolute top-0 left-0 right-0 h-[var(--decoration-bar-height)] bg-[var(--decoration-gradient)]" />
  ```
- [ ] 分类标签使用渐变背景
  ```tsx
  <span className="bg-gradient-to-r from-primary to-purple-500 text-white px-3 py-1 rounded-full">
  ```
- [ ] 标题悬停时使用渐变文字
  ```tsx
  <h3 className="group-hover:bg-gradient-to-r group-hover:from-primary group-hover:to-purple-500 group-hover:bg-clip-text group-hover:text-transparent">
  ```
- [ ] 添加彩色阴影 `hover:shadow-[var(--shadow-primary)]`
- [ ] 使用运动设计系统的过渡效果

#### 3.2 FeaturedPost 精致化
- [ ] 添加左侧渐变装饰边
- [ ] 标题使用渐变文字
- [ ] 标签使用柔和的彩色背景
- [ ] 预览区使用微妙的渐变遮罩

#### 3.3 Button 系统渐变化
- [ ] Primary 按钮使用渐变背景
  ```tsx
  className="bg-gradient-to-r from-primary to-purple-500 text-white shadow-[var(--shadow-primary)]"
  ```
- [ ] Secondary 按钮使用渐变边框
- [ ] Ghost 按钮悬停时使用渐变背景

### 阶段 4: 其他博客组件优化（中优先级）
**优先级：中**

- [ ] 检查并修复 BlogHeader.tsx
  - Logo 使用渐变色
  - 导航项悬停时下划线动画（品牌色）
  - 主题切换按钮使用渐变背景
- [ ] 检查并修复 CommentSection.tsx
- [ ] 检查并修复 FriendCard.tsx（动态主题色适配）
- [ ] 检查并修复 AuthorProfileCard.tsx
- [ ] 检查并修复 TableOfContents.tsx
- [ ] 检查并修复 TimelineTree.tsx

### 阶段 5: 添加微交互（中优先级）
**优先级：中**

- [ ] 图标悬停动画（使用 Framer Motion）
- [ ] 卡片悬停提升效果
- [ ] 按钮点击反馈
- [ ] 页面过渡动画
- [ ] 使用运动设计系统的缓动函数和时长

### 阶段 6: 无障碍优化（中优先级）
**优先级：中**

- [ ] 确保所有文字对比度符合 WCAG AA 标准
- [ ] 添加 Focus 状态样式（使用 `--focus-ring`）
- [ ] 测试键盘导航
- [ ] 测试屏幕阅读器
- [ ] 测试高对比度模式

### 阶段 7: 响应式优化（低优先级）
**优先级：低**

- [ ] 添加移动端专用样式
- [ ] 优化 Markdown 在移动端的显示
- [ ] 测试平板和手机端体验

### 阶段 8: 高级 Markdown 功能（可选）
**优先级：最低**

- [ ] 添加代码块行号支持
- [ ] 添加高亮行支持（```js{1,3-5}）
- [ ] 添加代码块文件名显示（```js:filename.js）
- [ ] 添加折叠功能
- [ ] 添加脚注支持
- [ ] 添加高亮文本支持（==text==）
- [ ] 添加 Callout 块支持（> [!NOTE]）

### 阶段 9: 验证与测试（必须）
**优先级：最高**

- [ ] 在亮色主题下测试所有页面
  - 首页
  - 文章列表页
  - 文章详情页（重点测试 Markdown 渲染）
  - 友链页面
- [ ] 在暗色主题下测试所有页面（确保没有回归）
  - 特别关注 Markdown 渲染的 28 个已知问题
- [ ] 测试主题切换的平滑过渡
- [ ] 检查移动端响应式表现
- [ ] 对比度检查（使用浏览器开发工具）
- [ ] 性能测试（Lighthouse）

---

## 关键文件清单

### 需要修改的核心文件

#### 全局样式
- **`apps/blog/app/globals.css`** - 添加 v2.1 完整 CSS 变量系统，优化 Markdown 样式
- `apps/admin/src/index.css` - 同步更新（可选，保持一致性）

#### Markdown 渲染
- **`apps/blog/app/components/MarkdownRenderer.tsx`** - 核心 Markdown 渲染组件，修复所有硬编码颜色
- **`packages/editor/src/MarkdownPreview.tsx`** - 编辑器预览组件，同步改进
- `apps/blog/app/components/MiniMarkdownPreview.tsx` - 列表预览组件

#### 博客页面
- `apps/blog/app/page.tsx` - 首页环境光
- `apps/blog/app/posts/page.tsx` - 文章列表页
- `apps/blog/app/posts/(article)/[slug]/page.tsx` - 文章详情页
- `apps/blog/app/friends/FriendsList.tsx` - 友链页面

#### 博客组件
- **`apps/blog/app/components/ArticleCard.tsx`** - 文章卡片，添加装饰条和渐变
- **`apps/blog/app/components/FeaturedPost.tsx`** - 特色文章，添加渐变装饰
- `apps/blog/app/components/FriendCard.tsx` - 友链卡片
- `apps/blog/app/components/BlogHeader.tsx` - 头部导航
- `apps/blog/app/components/CommentSection.tsx` - 评论区
- `apps/blog/app/components/AuthorProfileCard.tsx` - 作者信息卡片
- `apps/blog/app/components/TableOfContents.tsx` - 目录
- `apps/blog/app/components/TimelineTree.tsx` - 时间线

#### 共享 UI 组件
- `packages/ui/src/Button.tsx` - 按钮系统渐变化
- `packages/ui/src/Card.tsx` - 卡片组件
- `packages/ui/src/components/Input.tsx` - 输入框
- `packages/ui/src/components/Badge.tsx` - 徽章
- `packages/ui/src/components/Skeleton.tsx` - 骨架屏

---

## 预期效果

### 亮色主题将呈现

**UI 设计：**
- 🎨 **丰富的色彩** - 品牌色、辅助色、渐变的和谐运用
- ✨ **精致的细节** - 装饰条、渐变文字、彩色阴影
- 🎯 **清晰的层次** - 4层阴影系统定义深度
- 💎 **流畅的交互** - 丰富的悬停效果和状态变化
- 🏢 **企业级品质** - 参考Notion、Linear、GitHub的设计语言

**Markdown 渲染：**
- 📖 **舒适的阅读体验** - 1.8 行高，充足的段落间距
- 🎨 **清晰的标题层次** - 明显的字重和间距区分
- 💻 **专业的代码块** - 统一的背景色、边框、语法高亮
- 🔗 **优雅的链接样式** - 无下划线，hover 时显示 border-bottom
- 📝 **精致的引用块** - 3px 左边框，柔和的背景色
- 📊 **清晰的表格** - 充足的内边距，明显的边框

### 暗色主题保持

**UI 设计：**
- 🌌 空灵氛围、环境光、聚光灯效果
- 💎 高端SaaS风格

**Markdown 渲染：**
- 修复 28 个已知问题
- 提升文字对比度
- 优化代码块样式
- 统一使用 CSS 变量

### 设计系统完整性

**运动设计：**
- ⚡ 标准化的缓动函数（productive, expressive, spring）
- ⏱️ 统一的动画时长（instant, fast, moderate, slow, slower）
- 🎬 流畅的页面转场

**无障碍：**
- ♿ 符合 WCAG AA 标准的对比度
- 🎯 清晰的 Focus 状态
- ⌨️ 完整的键盘导航支持
- 🔍 高对比度模式支持

**间距系统：**
- 📏 8pt grid 系统
- 📐 统一的间距变量（space-1 到 space-12）
- 📝 标准化的排版系统

---

## 与 Microsoft/Apple 的对比

### 已达到的标准

✅ **色彩系统** - 完整的品牌色、辅助色、状态色系统
✅ **阴影系统** - 4层阴影定义深度
✅ **渐变系统** - 丰富的渐变用于装饰和引导
✅ **运动设计** - 标准化的缓动函数和时长
✅ **间距系统** - 8pt grid 系统
✅ **排版系统** - 完整的字号和行高系统
✅ **无障碍** - Focus 状态、高对比度模式、减少动画模式

### 仍需改进的方面

⚠️ **Acrylic Material** - 可以添加噪点纹理增强玻璃态效果
⚠️ **图标系统** - 需要标准化图标大小和颜色
⚠️ **语义化颜色** - 可以进一步完善颜色的语义化命名

### 超越之处

🌟 **Markdown 渲染** - 对齐顶级笔记应用（Notion、Bear、Obsidian、Typora）
🌟 **主题切换** - 平滑的亮暗主题切换，两个主题都达到企业级标准
🌟 **品牌一致性** - 所有组件统一使用 Aether 品牌色系

---

## 实施注意事项

### CSS 变量命名规范
- 使用语义化命名（如 `--markdown-bg-code` 而非 `--code-bg`）
- 保持与现有变量的命名一致性
- 添加注释说明用途

### 过渡动画
- 所有颜色变化都应该有 `transition` 属性
- 使用运动设计系统的缓动函数和时长
- 确保主题切换时所有元素同步过渡

### 浏览器兼容性
- CSS 变量在所有现代浏览器中都支持
- `backdrop-filter` 在 Safari 中需要 `-webkit-` 前缀（Tailwind 已处理）
- 测试 Firefox 中的渐变效果

### 性能考虑
- 聚光灯效果使用 `onMouseMove`，在低端设备上可能有性能问题
- 如果发现卡顿，可以添加节流（16ms，60fps）
- Markdown 渲染使用按需加载策略（Shiki、KaTeX）

### 可访问性
- 确保所有文字在两种主题下的对比度都符合 WCAG AA 标准（至少 4.5:1）
- 使用浏览器开发工具的对比度检查器验证
- 特别注意 `text-muted` 和 `text-secondary` 的对比度

---

## 回滚策略

如果实施后发现问题，可以快速回滚：

1. **CSS 变量回滚：** 删除新增的 CSS 变量，组件会回退到硬编码值
2. **组件回滚：** 使用 Git 恢复单个组件文件
3. **全量回滚：** `git revert` 整个提交

建议：
- 每个阶段完成后创建一个 Git commit
- Commit message 格式：`feat(theme): [阶段名称] - [具体改动]`
- 例如：`feat(theme): Phase 1 - Add v2.1 CSS variables`
- 例如：`feat(markdown): Phase 2.1 - Optimize markdown rendering in globals.css`

---

## 总结

这个 v2.1 方案是一个**全面的企业级设计系统升级**，包含：

1. **完整的 CSS 变量系统**（60+ 变量）
2. **专业的 Markdown 渲染**（修复 62 个问题）
3. **丰富的 UI 细节**（渐变、装饰条、彩色阴影）
4. **完善的运动设计**（缓动函数、动画时长）
5. **无障碍优先**（Focus 状态、高对比度模式）
6. **响应式设计**（移动端优化）

**目标：** 达到 Microsoft Fluent Design 和 Apple Human Interface Guidelines 的标准，同时在 Markdown 渲染方面对齐 Notion、Bear、Obsidian、Typora 的水准。

**特色：** 亮色和暗色主题都达到企业级标准，平滑的主题切换，统一的品牌色系，专业的阅读体验。
- 🔗 "阅读更多"按钮使用渐变

**实现：**
```tsx
<article className="group relative ...">
  {/* 顶部装饰条 - 品牌色渐变 */}
  <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-primary via-purple-500 to-pink-500" />

  {/* 卡片主体 - 白色背景 + 清晰边框 + 阴影 */}
  <div className="bg-white border border-[var(--border-default)] rounded-xl shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-primary)] transition-all">

    {/* 分类标签 - 渐变背景 */}
    <span className="bg-gradient-to-r from-primary to-purple-500 text-white px-3 py-1 rounded-full text-xs font-medium">
      {category}
    </span>

    {/* 标题 - 悬停时渐变 */}
    <h3 className="group-hover:bg-gradient-to-r group-hover:from-primary group-hover:to-purple-500 group-hover:bg-clip-text group-hover:text-transparent">
      {title}
    </h3>

    {/* 阅读更多按钮 - 渐变背景 */}
    <button className="bg-gradient-to-r from-primary to-purple-500 text-white px-4 py-2 rounded-lg hover:shadow-[var(--shadow-primary)]">
      阅读更多 →
    </button>
  </div>
</article>
```

### 2. FeaturedPost 精致化

**设计要素：**
- 🎨 左侧渐变装饰边
- ✨ 标题使用渐变文字
- 🏷️ 标签使用柔和的彩色背景
- 📖 预览区使用微妙的渐变遮罩

### 3. Header 导航栏

**设计要素：**
- 🎨 Logo 使用渐变色
- 🔘 导航项悬停时下划线动画（品牌色）
- 🌓 主题切换按钮使用渐变背景
- 👤 用户头像使用渐变边框

### 4. 按钮系统

**设计要素：**
```tsx
// Primary - 渐变背景
<button className="bg-gradient-to-r from-primary to-purple-500 text-white shadow-[var(--shadow-primary)]">

// Secondary - 渐变边框
<button className="bg-white border-2 border-transparent bg-clip-padding relative before:absolute before:inset-0 before:bg-gradient-to-r before:from-primary before:to-purple-500 before:-z-10">

// Ghost - 悬停时渐变背景
<button className="hover:bg-gradient-to-r hover:from-primary/10 hover:to-purple-500/10">
```

---

## 实施计划

### 阶段 1: 扩展 CSS 变量系统
- [ ] 添加完整的色彩系统（品牌色、辅助色、状态色）
- [ ] 添加渐变系统
- [ ] 添加4层阴影系统
- [ ] 添加装饰元素变量

### 阶段 2: 重构 ArticleCard
- [ ] 添加顶部装饰条
- [ ] 重新设计分类标签（渐变背景）
- [ ] 添加彩色阴影
- [ ] 优化悬停效果

### 阶段 3: 重构 FeaturedPost
- [ ] 添加左侧渐变装饰
- [ ] 标题使用渐变文字
- [ ] 优化标签样式
- [ ] 添加预览区渐变遮罩

### 阶段 4: 优化导航和按钮
- [ ] Header 导航栏精致化
- [ ] 按钮系统渐变化
- [ ] 主题切换按钮优化

### 阶段 5: 添加微交互
- [ ] 图标悬停动画
- [ ] 卡片悬停提升
- [ ] 按钮点击反馈
- [ ] 页面过渡动画

---

## 预期效果

**亮色主题将呈现：**
- 🎨 **丰富的色彩** - 品牌色、辅助色、渐变的和谐运用
- ✨ **精致的细节** - 装饰条、渐变文字、彩色阴影
- 🎯 **清晰的层次** - 4层阴影系统定义深度
- 💎 **流畅的交互** - 丰富的悬停效果和状态变化
- 🏢 **企业级品质** - 参考Notion、Linear、GitHub的设计语言

**暗色主题保持：**
- 🌌 空灵氛围、环境光、聚光灯效果
- 💎 高端SaaS风格

## 解决方案设计

### 策略 1: CSS 变量扩展（推荐）

**核心思路：** 为主题敏感的效果添加专用 CSS 变量

#### 1.1 扩展 `globals.css` 变量系统

在 `apps/blog/app/globals.css` 中添加新变量：

```css
/* 亮色主题 */
:root, :root.light {
  /* 现有变量... */

  /* 新增：环境光效果 */
  --ambient-glow-opacity: 0.15;        /* 大幅降低透明度，更内敛优雅 */
  --ambient-glow-blur: 100px;          /* 更强的模糊 */

  /* 新增：聚光灯效果 - 反转颜色逻辑（使用深色阴影） */
  --spotlight-color: rgba(0, 0, 0, 0.03);  /* 深色聚光灯创造阴影效果 */
  --spotlight-opacity: 1;              /* 全透明度 */

  /* 新增：高亮线条 */
  --highlight-line: rgba(0, 0, 0, 0.08);

  /* 新增：预览区背景 */
  --preview-bg: rgba(0, 0, 0, 0.03);
}

/* 暗色主题 */
:root.dark {
  /* 现有变量... */

  /* 环境光效果 */
  --ambient-glow-opacity: 0.6;         /* 保持原有效果（允许微调） */
  --ambient-glow-blur: 120px;

  /* 聚光灯效果 */
  --spotlight-color: rgba(99, 102, 241, 0.1);
  --spotlight-opacity: 1;

  /* 高亮线条 */
  --highlight-line: rgba(255, 255, 255, 0.1);

  /* 预览区背景 */
  --preview-bg: rgba(0, 0, 0, 0.2);
}
```

#### 1.2 更新页面组件

**文件：** `apps/blog/app/page.tsx`
```tsx
// 修改前
<div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl opacity-60" />

// 修改后
<div
  className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full"
  style={{
    filter: 'blur(var(--ambient-glow-blur))',
    opacity: 'var(--ambient-glow-opacity)'
  }}
/>
```

**文件：** `apps/blog/app/components/ArticleCard.tsx`
```tsx
// 修改聚光灯效果
<div
  className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
  style={{
    background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, var(--spotlight-color), transparent 40%)`,
    opacity: isHovering ? 'var(--spotlight-opacity)' : 0,
  }}
/>

// 修改顶部高亮线条
<div
  className="absolute top-0 left-0 right-0 h-px z-10"
  style={{
    background: `linear-gradient(to right, transparent, var(--highlight-line), transparent)`
  }}
/>
```

**文件：** `apps/blog/app/components/FeaturedPost.tsx`
```tsx
// 修改右侧预览区背景
<div className="hidden lg:block lg:col-span-2 overflow-hidden relative bg-[var(--preview-bg)]">
```

#### 1.3 重构 `packages/ui` 组件

**原则：** 参考 `Modal.tsx` 的实现模式

**文件：** `packages/ui/src/Button.tsx`
```tsx
// 修改前
variants: {
  primary: 'bg-primary text-white hover:bg-primary/90',
  secondary: 'bg-white/10 text-white hover:bg-white/20',
  ghost: 'text-gray-400 hover:text-white hover:bg-white/5',
}

// 修改后
variants: {
  primary: 'bg-primary text-white hover:bg-primary/90',
  secondary: 'bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-default)]',
  ghost: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]',
}
```

**文件：** `packages/ui/src/Card.tsx`
```tsx
// 修改前
'bg-white/5 backdrop-blur-sm border border-white/10'

// 修改后
'bg-[var(--bg-card)] backdrop-blur-sm border border-[var(--border-default)]'
```

**文件：** `packages/ui/src/components/Input.tsx`
```tsx
// 修改前
'bg-white/5 border border-white/10 text-white placeholder:text-gray-500'

// 修改后
'bg-[var(--bg-card)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]'
```

**文件：** `packages/ui/src/components/Badge.tsx`
```tsx
// 修改前
variantStyles = {
  default: 'bg-gray-500/20 text-gray-300',
  primary: 'bg-primary/20 text-primary',
}

// 修改后
variantStyles = {
  default: 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
  primary: 'bg-primary/20 text-primary',
}
```

**文件：** `packages/ui/src/components/Skeleton.tsx`
```tsx
// 修改前
'bg-white/10'

// 修改后
'bg-[var(--bg-card)]'
```

### 策略 2: 玻璃态效果优化

**问题：** 当前玻璃态在亮色主题下对比度不足

**解决方案：** 调整 `backdrop-blur` 和背景透明度

在 `globals.css` 中添加：
```css
:root, :root.light {
  --glass-bg: rgba(255, 255, 255, 0.7);
  --glass-blur: 12px;
}

:root.dark {
  --glass-bg: rgba(255, 255, 255, 0.05);
  --glass-blur: 24px;
}
```

更新组件：
```tsx
// 替换所有 backdrop-blur-md/xl 的组件
className="bg-[var(--glass-bg)]"
style={{ backdropFilter: 'blur(var(--glass-blur))' }}
```

---

## 实施计划

### 阶段 1: 核心变量扩展（优先级：高）
- [ ] 扩展 `apps/blog/app/globals.css` 添加新的主题变量
- [ ] 同步更新 `apps/admin/src/index.css`（保持一致性）

### 阶段 2: 博客页面组件修复（优先级：高）
- [ ] 修复首页环境光效果 (`app/page.tsx`)
- [ ] 修复文章列表页 (`app/posts/page.tsx`)
- [ ] 修复 `ArticleCard.tsx` 聚光灯和高亮线条
- [ ] 修复 `FeaturedPost.tsx` 预览区背景和高亮线条
- [ ] 修复友链页面 (`app/friends/FriendsList.tsx`)
- [ ] 修复文章详情页 (`app/posts/(article)/[slug]/page.tsx`)

### 阶段 3: 共享组件全面重构（优先级：高）
- [ ] 重构 `packages/ui/src/Button.tsx`
- [ ] 重构 `packages/ui/src/Card.tsx`
- [ ] 重构 `packages/ui/src/components/Input.tsx`
- [ ] 重构 `packages/ui/src/components/Badge.tsx`
- [ ] 重构 `packages/ui/src/components/Skeleton.tsx`
- [ ] 检查并重构其他 `packages/ui` 组件（Toast, Dropdown 等）

### 阶段 4: 其他博客组件（优先级：中）
- [ ] 检查并修复 `BlogHeader.tsx`
- [ ] 检查并修复 `CommentSection.tsx`
- [ ] 检查并修复 `FriendCard.tsx`
- [ ] 检查并修复 `AuthorProfileCard.tsx`
- [ ] 检查并修复 `TableOfContents.tsx`
- [ ] 检查并修复 `TimelineTree.tsx`

### 阶段 5: 暗色主题微调（优先级：低）
- [ ] 在测试过程中，如发现暗色主题可优化之处，进行小幅度改进
- [ ] 确保所有微调不破坏现有的视觉风格
- [ ] 记录所有暗色主题的调整以便回滚

### 阶段 6: 验证与测试（优先级：高）
- [ ] 在亮色主题下测试所有页面
- [ ] 在暗色主题下测试所有页面（确保没有回归）
- [ ] 测试主题切换的平滑过渡
- [ ] 检查移动端响应式表现

---

## 关键文件清单

### 需要修改的文件

#### 全局样式
- `apps/blog/app/globals.css` - 添加新的 CSS 变量
- `apps/admin/src/index.css` - 同步更新（可选）

#### 博客页面
- `apps/blog/app/page.tsx` - 首页环境光
- `apps/blog/app/posts/page.tsx` - 文章列表页环境光
- `apps/blog/app/posts/(article)/[slug]/page.tsx` - 文章详情页
- `apps/blog/app/friends/FriendsList.tsx` - 友链页面

#### 博客组件
- `apps/blog/app/components/ArticleCard.tsx` - 聚光灯、高亮线条
- `apps/blog/app/components/FeaturedPost.tsx` - 预览区背景、高亮线条
- `apps/blog/app/components/FriendCard.tsx` - 动态主题色
- `apps/blog/app/components/AuthorProfileCard.tsx` - 玻璃态卡片
- `apps/blog/app/components/BlogHeader.tsx` - 头部聚光灯
- `apps/blog/app/components/CommentSection.tsx` - 评论区样式
- `apps/blog/app/components/TableOfContents.tsx` - 目录样式
- `apps/blog/app/components/TimelineTree.tsx` - 时间线样式

#### 共享 UI 组件
- `packages/ui/src/Button.tsx`
- `packages/ui/src/Card.tsx`
- `packages/ui/src/components/Input.tsx`
- `packages/ui/src/components/Badge.tsx`
- `packages/ui/src/components/Skeleton.tsx`

---

## 验证方案

### 手动测试清单

**亮色主题：**
1. 首页 (`/`)
   - [ ] 环境光效果柔和，不刺眼
   - [ ] Hero 区域文字清晰可读
   - [ ] 按钮对比度足够
   - [ ] ArticleCard 卡片层次分明

2. 文章列表 (`/posts`)
   - [ ] 环境光效果适中
   - [ ] 卡片悬停效果自然
   - [ ] 聚光灯效果不过于突兀
   - [ ] 分页按钮可见性良好

3. 文章详情 (`/posts/[slug]`)
   - [ ] 内容区域背景舒适
   - [ ] 代码块对比度足够
   - [ ] 目录导航清晰
   - [ ] 评论区样式协调

4. 友链页面 (`/friends`)
   - [ ] FriendCard 动态主题色适配
   - [ ] 卡片悬停效果自然

**暗色主题（回归测试）：**
- [ ] 所有页面保持原有视觉效果
- [ ] 没有出现新的样式问题

**主题切换：**
- [ ] 切换过渡平滑（0.3s ease）
- [ ] 没有闪烁或跳动
- [ ] 所有元素同步切换

### 自动化测试（可选）

如果项目有视觉回归测试工具（如 Percy, Chromatic），可以：
1. 截取所有页面的亮色/暗色主题截图
2. 对比修改前后的差异
3. 确保暗色主题没有回归

---

## 风险评估

### 低风险
- ✅ 添加新的 CSS 变量不会影响现有功能
- ✅ 修改组件样式是纯视觉层面的改动

### 中风险
- ⚠️ `packages/ui` 组件被多个应用使用，需要确保 Admin 应用不受影响
  - **缓解措施：** Admin 应用也使用相同的 CSS 变量系统，理论上兼容

### 需要注意
- 🔍 FriendCard 使用动态 `themeColor` prop，需要确保在亮色主题下颜色对比度足够
- 🔍 某些组件可能在其他页面（如 `/timeline`, `/about`）中使用，需要全面测试

---

## 预期效果

### 亮色主题优化后
- 环境光效果更加内敛，符合"优雅"定位
- 玻璃态卡片层次分明，对比度适中
- 聚光灯效果柔和，不破坏整体氛围
- 所有文字清晰可读，符合无障碍标准

### 暗色主题
- 保持现有的高端 SaaS 风格
- 没有任何视觉回归

### 整体体验
- 两种主题都体现"Cognitive Elegance"设计哲学
- 主题切换流畅自然
- 用户可以根据环境光线自由选择主题

---

## 后续优化建议

1. **考虑添加"自动主题"功能**
   - 根据时间自动切换（如晚上 8 点后自动暗色）
   - 已有 `system` 模式，可以扩展

2. **考虑添加主题预设**
   - 除了亮色/暗色，可以添加"高对比度"模式
   - 为视力障碍用户提供更好的可访问性

3. **性能优化**
   - 当前聚光灯效果使用 `onMouseMove`，可能在低端设备上有性能问题
   - 可以考虑使用 `requestAnimationFrame` 节流

4. **设计系统文档**
   - 创建 Storybook 展示所有组件在两种主题下的表现
   - 方便未来开发新组件时保持一致性

---

## 用户选择定制方案

根据你的选择，以下是关键实施细节：

### 1. 环境光效果：大幅降低透明度
- **亮色主题：** `--ambient-glow-opacity: 0.15`（从 0.6 降低 75%）
- **视觉效果：** 环境光将变得非常内敛，几乎融入背景，只在仔细观察时才能察觉
- **设计理念：** 符合"Cognitive Elegance"中的"understated luxury"（低调奢华）

### 2. 聚光灯效果：反转颜色逻辑
- **亮色主题：** 使用 `rgba(0, 0, 0, 0.03)` 深色聚光灯
- **视觉效果：** 鼠标悬停时产生微妙的阴影效果，而非光晕
- **设计理念：** 创造"凹陷"感而非"发光"感，更符合亮色主题的物理直觉
- **实现细节：**
  ```tsx
  // ArticleCard.tsx 中的聚光灯
  <div
    style={{
      background: `radial-gradient(600px circle at ${x}px ${y}px, var(--spotlight-color), transparent 40%)`,
      opacity: isHovering ? 'var(--spotlight-opacity)' : 0,
    }}
  />
  ```

### 3. 共享组件：全面重构
- **范围：** 所有 `packages/ui` 组件
- **原则：** 参考 `Modal.tsx` 的实现模式
- **关键改动：**
  - `bg-white/10` → `bg-[var(--bg-card)]`
  - `text-white` → `text-[var(--text-primary)]`
  - `border-white/10` → `border-[var(--border-default)]`
- **测试策略：**
  - 在博客应用中测试每个重构的组件
  - 在管理后台中验证兼容性
  - 确保两个应用都能正常工作

### 4. 暗色主题：允许微调
- **策略：** 在实施过程中，如果发现暗色主题有改进空间，可以进行小幅度优化
- **约束：**
  - 微调幅度不超过 10%（如透明度从 0.6 调整到 0.55）
  - 不改变核心视觉风格
  - 所有改动都要记录，便于回滚
- **可能的微调点：**
  - 环境光模糊半径（可能从 120px 调整到 140px 以获得更柔和的效果）
  - 聚光灯颜色（可能微调 indigo 的色相以更匹配品牌色）
  - 玻璃态背景透明度（可能从 0.05 调整到 0.06 以增强层次感）

### 5. 特殊处理：FriendCard 动态主题色
- **问题：** FriendCard 使用 `themeColor` prop 动态生成渐变
- **解决方案：**
  ```tsx
  // 根据主题调整透明度
  const isDark = resolvedTheme === 'dark';
  const bgOpacity = isDark ? '15' : '08';  // 16进制透明度
  const hoverOpacity = isDark ? '25' : '12';

  background: `linear-gradient(145deg, ${themeColor}${bgOpacity}, var(--bg-card))`
  ```
- **确保：** 在亮色主题下，动态颜色的对比度足够

---

## 实施注意事项

### CSS 变量命名规范
- 使用语义化命名（如 `--spotlight-color` 而非 `--hover-glow-rgba`）
- 保持与现有变量的命名一致性
- 添加注释说明用途

### 过渡动画
- 所有颜色变化都应该有 `transition` 属性
- 推荐过渡时间：`0.3s ease` 或 `0.6s cubic-bezier(0.22, 1, 0.36, 1)`
- 确保主题切换时所有元素同步过渡

### 浏览器兼容性
- CSS 变量在所有现代浏览器中都支持
- `backdrop-filter` 在 Safari 中需要 `-webkit-` 前缀（Tailwind 已处理）
- 测试 Firefox 中的聚光灯效果（可能需要调整渐变参数）

### 性能考虑
- 聚光灯效果使用 `onMouseMove`，在低端设备上可能有性能问题
- 如果发现卡顿，可以添加节流：
  ```tsx
  const throttledMouseMove = useCallback(
    throttle((e) => handleMouseMove(e), 16), // 60fps
    []
  );
  ```

### 可访问性
- 确保所有文字在两种主题下的对比度都符合 WCAG AA 标准（至少 4.5:1）
- 使用浏览器开发工具的对比度检查器验证
- 特别注意 `text-muted` 颜色的对比度

---

## 预期成果展示

### 亮色主题优化前后对比

**优化前：**
- 环境光过于明显，紫色光晕在白色背景上显得突兀
- 聚光灯效果使用亮色，在亮色背景上"发光"感不自然
- 卡片边框和文字对比度不足
- 整体感觉"廉价"，缺乏高端感

**优化后：**
- 环境光透明度降低 75%，几乎不可见，只在特定角度能察觉
- 聚光灯反转为深色，产生微妙的阴影效果，符合物理直觉
- 卡片使用 CSS 变量，边框和文字清晰可见
- 整体呈现"understated luxury"（低调奢华）的气质

### 暗色主题微调（如有）

**可能的改进：**
- 环境光模糊半径微调，使光晕更柔和
- 聚光灯颜色微调，更匹配品牌色
- 玻璃态透明度微调，增强层次感

**保持不变：**
- 核心视觉风格
- 颜色方案
- 动画效果

---

## 回滚策略

如果实施后发现问题，可以快速回滚：

1. **CSS 变量回滚：** 删除新增的 CSS 变量，组件会回退到硬编码值
2. **组件回滚：** 使用 Git 恢复单个组件文件
3. **全量回滚：** `git revert` 整个提交

建议：
- 每个阶段完成后创建一个 Git commit
- Commit message 格式：`feat(theme): [阶段名称] - [具体改动]`
- 例如：`feat(theme): Phase 1 - Add CSS variables for light theme`
