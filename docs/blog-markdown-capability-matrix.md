# Blog 详情页 Markdown 能力矩阵（基线）

> 基线日期：2026-02-12  
> 适用范围：`apps/blog/app/components/MarkdownRenderer.tsx` + `apps/blog/app/globals.css`  
> 用途：作为后续 `BDA-040 / BDA-050 / BDA-060` 的唯一能力边界基线。

## 能力结论总览

| 能力项 | 结论 | 当前证据 | 触发条件与失败表现（部分支持/缺失必填） |
| --- | --- | --- | --- |
| GFM（删除线/列表/引用/代码） | 已支持 | `apps/blog/app/components/MarkdownRenderer.tsx:601`（启用 `remark-gfm`）; `apps/blog/app/globals.css:547`（列表样式） | - |
| 表格 | 已支持 | `apps/blog/app/components/MarkdownRenderer.tsx:530`（table/th/td 组件映射）; `apps/blog/app/globals.css:585`（横向滚动与边框） | - |
| 任务列表 | 部分支持 | `apps/blog/app/globals.css:619`（checkbox 样式）; `apps/blog/app/globals.css:627`（任务列表缩进） | 依赖 GFM 生成 checkbox；当前仅做视觉样式，未补充键盘/读屏可访问性语义，`disabled` 状态下视觉仍可能被误判为可交互。 |
| Mermaid | 部分支持 | `apps/blog/app/components/MarkdownRenderer.tsx:194`（Mermaid 渲染组件）; `apps/blog/app/components/MarkdownRenderer.tsx:233`（错误态） | 仅 fenced code `language-mermaid` 触发；语法错误或运行时异常时显示“图表渲染失败”，不提供行级错误定位。 |
| 数学公式（KaTeX） | 部分支持 | `apps/blog/app/components/MarkdownRenderer.tsx:583`（按需加载 KaTeX CSS）; `apps/blog/app/components/MarkdownRenderer.tsx:602`（`rehype-katex`） | 依赖外部 CDN 注入 CSS；网络受限时公式结构可渲染但样式退化。公式检测基于正则，极端输入可能漏判导致样式未预加载。 |
| HTML（原生标签） | 部分支持 | `apps/blog/app/components/MarkdownRenderer.tsx:602`（`rehype-raw`） | 允许原生 HTML 透传，但当前未额外叠加 sanitize 白名单策略，需依赖上游内容可信边界。 |
| 图片 | 部分支持 | `apps/blog/app/components/MarkdownRenderer.tsx:489`（图片映射，支持 `alt\|size`）; `apps/blog/app/globals.css:611`（响应式样式） | 支持展示与尺寸声明，但仍使用原生 `<img>`，未接入 `next/image` 优化链路（现有 lint 警告可复现）。 |
| 链接 | 部分支持 | `apps/blog/app/components/MarkdownRenderer.tsx:558`（链接映射） | `http(s)` 外链自动新开并附安全属性；非 `http(s)`（如 `mailto:`、`tel:`）按普通链接渲染，未统一策略。 |
| Heading 锚点 | 缺失 | `apps/blog/app/components/MarkdownRenderer.tsx:450`（未重写 h1-h6）; `apps/blog/app/components/MarkdownRenderer.tsx:602`（无 `rehype-slug`） | 标题未生成稳定 `id`，目录跳转与深链接不可用。 |
| 脚注 | 部分支持 | `apps/blog/app/components/MarkdownRenderer.tsx:601`（GFM 启用脚注语法） | 语法可解析，但无脚注区专属样式与回跳可用性增强，长文场景可读性一般。 |

## 当前边界说明

1. 本矩阵仅描述“当前实现事实”，不包含未来方案。
2. “部分支持”条目已记录触发条件和失败表现，可直接转化为回归用例。
3. 新增语法项时，必须先更新本矩阵再改实现，并同步 `issues/*.csv` 的 `refs`。
