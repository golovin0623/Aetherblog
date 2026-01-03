# AetherBlog UI 设计系统与生成规范

## 1. 设计哲学："认知优雅" (Cognitive Elegance)
- **关键词**: 空灵 (Ethereal)、专业 (Professional)、深度 (Depth)、流畅 (Fluidity)。
- **视觉风格**: 高端 SaaS (Linear, Raycast 风格) 融合 氛围感 Web (Vercel 风格)。
- **核心理念**: 默认暗色模式，丰富的氛围感渐变，毛玻璃拟态，精致的排版。
- **品牌调性**: 低调奢华。避免 "游戏化" 的霓虹感；偏好 "极光" 般的柔和辉光。

## 2. 技术栈约束
- **框架**: React 19 + Vite。
- **样式**: Tailwind CSS v3.4+ (尽量少用 `[]` 任意值，优先使用主题变量)。
- **动画**: Framer Motion (`framer-motion`)。使用 `layout` 属性实现自动布局动画。
- **图标**: Lucide React (`lucide-react`)。默认 `strokeWidth={1.5}` 或 `{2}`。
- **工具**: 必须使用 `cn()` (clsx + tailwind-merge) 进行类名合并。

## 3. 配色方案 (暗色主题)
- **背景色**:
  - 主画布: `#09090b` (Zinc-950) 或 `#0a0a0c`。
  - 第一层级 (卡片): `bg-white/5` 或 `bg-black/40`。
  - 第二层级 (输入框/悬停): `bg-white/10`。
- **边框**: 
  - 关键在于微妙: `border-white/5` 或 `border-white/10`。
- **强调色 (以太渐变)**:
  - 主色: `from-indigo-500 to-purple-600`。
  - 辅色: `text-indigo-400` 或 `bg-indigo-500/10`。
- **文字**:
  - 标题: `text-white` 或 `text-slate-100`。
  - 正文: `text-slate-400` (柔和灰)。
  - 高亮: `text-slate-200`。

## 4. 组件模式 (Component Patterns)

### A. 毛玻璃卡片 (Glass Cards) - 标准容器
\`\`\`tsx
<div className="relative bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden">
  {/* 内部光泽效果 */}
  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
  <div className="relative z-10">
    {/* 内容区域 */}
  </div>
</div>
\`\`\`

### B. 氛围背景 (Ambient Backgrounds) - 页面级
在内容背后使用绝对定位的高斯模糊光斑。
\`\`\`tsx
<div className="absolute inset-0 overflow-hidden pointer-events-none">
  <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse" />
  <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[100px]" />
  <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay"></div>
</div>
\`\`\`

### C. 排版 (Typography)
- **标题 (Headings)**: `tracking-tight font-semibold` (紧凑字距，半粗体)。
- **说明文字 (Captions)**: `text-xs uppercase tracking-wide text-slate-500 font-medium` (全大写，宽字距)。
- **正文 (Body)**: `text-sm text-slate-400 leading-relaxed` (宽松行高)。

## 5. 动画规范 (Framer Motion)
- **高级质感**: 使用 "Spring" (弹簧) 物理效果或自定义贝塞尔曲线。
  \`\`\`tsx
  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
  \`\`\`
- **交错效果 (Stagger)**: 列表项必须使用 stagger 依次入场，增加精致感。
- **悬停交互 (Hover)**: 微妙的上浮 `y: -2` 或缩放 `scale: 1.01`。

## 6. 开发守则 (Do's & Don'ts)
- ✅ **DO**: 使用 `backdrop-blur` 增加深度感。
- ✅ **DO**: 使用 `group` 和 `group-hover` 处理父子交互状态 (如卡片悬停时图标亮起)。
- ❌ **DON'T**: 使用纯黑背景 (`#000000`) 作为卡片背景。
- ❌ **DON'T**: 使用浏览器默认滚动条 (需自定义细滚动条)。
- ❌ **DON'T**: 使用生硬的黑色阴影 (`shadow-black`)。应使用带色阴影 (`shadow-indigo-500/20`)。

## 7. AI 生成 Prompt 模板
> "基于 AetherBlog 设计系统生成一个 React 组件 [组件名]。使用 Tailwind CSS 暗色主题 (#09090b)。实现毛玻璃拟态效果 (\`bg-white/5 backdrop-blur-xl border-white/10\`)。使用 Framer Motion 实现丝滑的入场动画 (spring physics)。主色调使用 Indigo-Purple 渐变。确保使用 Lucide 图标。整体设计需呈现高端、空灵且认知优雅的质感。"
