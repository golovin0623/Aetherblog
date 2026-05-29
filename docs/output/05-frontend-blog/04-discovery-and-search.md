# 04 · Discovery & Search · 发现与搜索

> 全站发现链:首页推荐 → /posts 列表 → /timeline 归档 → SearchPanel(⌘K)→ 搜索结果。本文聚焦搜索面板与发现层的协作,以及 tag/category 当前的承载方式。

---

## 1 · 范围

- `apps/blog/app/components/SearchPanel.tsx`(全局搜索)
- `apps/blog/app/components/TimelineTree.tsx`(归档浏览)
- `apps/blog/app/components/ArticleCard.tsx`(category / tags 展示)
- `apps/blog/app/components/MobileNavSwitch.tsx`(首页/时间线切换)
- `apps/blog/app/components/MobileMenu.tsx`(移动端菜单)
- `apps/blog/app/lib/api.ts`(搜索端点声明)

未实现 / 待补充:tag 详情页、category 详情页、search 独立页(目前都靠 SearchPanel + tag chips 跳转)。

---

## 2 · 全局搜索面板 SearchPanel

### 2.1 触发方式

- 桌面端 BlogHeader 右侧搜索按钮(`BlogHeader.tsx:528`)
- 移动端 BlogHeader 右侧 H8×8 圆形按钮(`BlogHeader.tsx:362`)
- MobileMenu drawer 内的 footer 也有 entry
- 全局快捷键:**⌘K / Ctrl+K**(`BlogHeader.tsx:147`)
- 全局快捷键:**`/`** (除非焦点在 input/textarea/contentEditable)

### 2.2 面板模式

当前 `SearchPanel` 已从旧的"输入前缀 4 模式"收敛为两个显式 tab:

| 模式 | UI 文案 | 行为 |
|:---|:---|:---|
| `search` | 文章 | 文章搜索,走 `/api/v1/public/search?mode=hybrid&limit=10` |
| `ask` | 问答 | AI 问答,走 `EventSource('/api/v1/public/search/qa?q=...')` |

`?` 仍是快捷入口,但语义已变为"切到问答并剥离 `?` 前缀",不是旧文档里的 `ai mode chip`。`>` command 模式、`/` tag 模式、旧前缀解析函数和旧模式 chip 在当前 `SearchPanel.tsx` 中已经不存在。后续开发不要再按旧前缀模式接接口。

### 2.3 数据流

```
面板打开
        ↓
GET /api/v1/public/search/features
        ↓
设置 keywordEnabled / semanticEnabled / aiQaEnabled

文章 tab:
用户输入(query)
        ↓ 260ms debounce
        ↓ Abort 上一次搜索
GET /api/v1/public/search?q=...&mode=hybrid&limit=10
        ↓
SearchResultItem 列表(source: keyword / semantic / hybrid)

问答 tab:
用户输入(query 或 ?query)
        ↓ aiQaEnabled gate
        ↓ close 上一次 EventSource
EventSource GET /api/v1/public/search/qa?q=...
        ↓ stream
delta / sources / done / error → aiAnswer
```

**features 探测:** 当前返回值包含 `keywordEnabled`、`semanticEnabled`、`aiQaEnabled`。文章 tab 在 keyword/semantic 都不可用时禁用搜索;问答 tab 只有 `aiQaEnabled === true` 才会建立 EventSource。`semanticEnabled` 还用于 footer 能力提示,提示用户本次搜索是否可能有语义召回参与。

### 2.4 SSE 解析

问答链路是浏览器原生 `EventSource`,不是 POST body:

```ts
const es = new EventSource(`/api/v1/public/search/qa?q=${encodeURIComponent(term)}`);

es.onmessage = (event) => {
  const payload = JSON.parse(event.data);
  switch (payload.type) {
    case 'delta':
      accumulatedAnswer += payload.content ?? '';
      break;
    case 'sources':
      sources = payload.sources ?? [];
      break;
    case 'done':
    case 'error':
      es.close();
      break;
  }
};
```

错误处理原则仍是"已有增量就保留,完全没拿到内容才清空",避免用户看到半截回答后被空状态覆盖。

### 2.5 中断与清理

两个 ref:
- `eventSourceRef` —— 当前问答 SSE。
- `searchAbortRef` —— 当前文章搜索 fetch 的 AbortController。

切换 tab、关闭面板、用户继续输入、组件 unmount 时都要清理旧请求。文章搜索 abort 避免旧结果晚到污染新列表;问答关闭 EventSource 避免后台继续生成。

### 2.6 历史记录

- localStorage `searchHistory` 保存最近搜索词,去重后 LRU 保留。
- 点击历史项会回填 query;在 ask tab 下可直接转问答。
- 清空历史仍保留二次确认,避免误触。

### 2.7 键盘导航

- ↑/↓ 切换文章结果激活项。
- Enter 在 search tab 打开当前激活文章;在 ask tab 触发问答。
- Escape 关闭面板。
- ⌘K / Ctrl+K 切换面板开关。
- 激活项使用 `scrollIntoView({ block: 'nearest' })` 防止滚出可视区。

### 2.8 `SearchResultItem` 卡片

每条结果含:
- **标题** + **highlight**(后端返回的高亮片段 / 摘要)
- **category icon** + **publishedAt**(`formatDate` UTC 格式化)
- **source 徽标**:`keyword` → "关键词匹配",`semantic` → "语义匹配",`hybrid` → "综合匹配"

后端 `/search?mode=hybrid` 是关键词 + 语义混合,score 字段已经 normalize。前端不重排 —— 信任后端的 ranking。

---

## 3 · TimelineTree —— 归档浏览

**路由:** `/timeline`,RSC + ISR 300s。

**数据模型:**

```ts
interface YearData {
  year: number;
  totalPosts: number;
  months: Array<{ month: number; posts: ArchivePost[] }>;
}
```

**展开/折叠状态:**(`TimelineTree.tsx:35-40`)
- `expandedYears` / `expandedMonths` / `expandedPostsMonths` —— 都用 sessionStorage 持久化(关闭 tab 即清)。
- `lastClickedPost` —— 用于从详情页返回时高亮该文章 + 渐隐动画。

**默认显示策略:**
- 每个月默认显示前 10 篇文章,超过的需点击 "展开剩余 N 篇"。
- 这避免一次渲染数百个 motion.div 让滚动卡顿。

**"正在阅读"状态:** `TableOfContents` 类似的 IntersectionObserver,用 `requestAnimationFrame` 节流。

---

## 4 · 标签 / 分类的承载方式

### 4.1 现状

- 文章卡片(`ArticleCard.tsx:159`)显示前 3 个 tag,超出显示 `+N`。Tag 是 `font-mono text-[11px]` 风格的 `#tag-name`。
- 文章详情页 tags chips 在标题元数据下方(`posts/[slug]/page.tsx:240`)。
- **没有独立 `/tags/[slug]` 或 `/categories/[slug]` 路由。** Click tag 不会跳转,纯展示。

### 4.2 缺失的能力

- 按 tag 过滤文章 —— 后端有 `tag` 数据但前端没有列表页。
- 按 category 过滤 —— 同上。
- 搜索面板已经没有 tag 前缀模式;tag/category 发现仍需要独立聚合页承载。

这是一处可拓展的发现层缺口。设计上应该:
1. 后端补 `GET /api/v1/public/tags/{slug}/posts` / `GET /api/v1/public/categories/{slug}/posts`(可能已存在,需查)。
2. 前端新增 `app/tags/[slug]/page.tsx` 与 `app/categories/[slug]/page.tsx`,RSC + ISR。
3. ArticleCard 的 tag chip 加 `Link` 包装。
4. SearchPanel 可以在文章 tab 结果中引导到 tag/category 聚合页,但不建议恢复旧 `/foo` 前缀模式。

---

## 5 · 首页/时间线切换

### 5.1 桌面端 segmented control

`BlogHeader.tsx:373-437`,iOS 21 风格的两段胶囊,`首页 ↔ 时间线`,带亮暗双胶囊滑动动画。

实现要点:
- `motion.div`(滑块本体)的 left 在 `'3px' | 'calc(50% - 3px)'` 之间切换。
- 内部 `linear-gradient` + `box-shadow` 模拟 iOS 真实质感。
- 亮暗主题用 opacity 切换两个 div,而非动态改 background。

### 5.2 移动端 MobileNavSwitch

`apps/blog/app/components/MobileNavSwitch.tsx`(简单 segmented control 移动版),`<MobileNavSwitch />` 渲染在 BlogHeader 右侧 md:hidden 区域(`BlogHeader.tsx:367`)。

### 5.3 来源记忆

`sessionStorage.blogNavSource`(`BlogHeader.tsx:73,87`)记录用户最后一次主动选择的是 `posts` 还是 `timeline`。文章详情页根据这个值高亮对应 segment,让"返回"路径符合心理模型。

---

## 6 · MobileMenu

**入口:** `apps/blog/app/components/MobileMenu.tsx:47`(memo 包裹)

**结构:**
- 汉堡按钮 → `setIsOpen(true)` → Portal 渲染 drawer 到 body。
- drawer 内显示:作者卡(头像/昵称/bio)、6 个一级链接、admin 入口(若可用)、社交链接、主题切换。

**乐观更新:** 与桌面端 BlogHeader 一致,点击立即 `setActivePage`,然后 `router.push`。

**Focus trap:** drawer 打开时 focus 锁在 panel 内(用 `FOCUSABLE_SELECTOR` 列表),Escape 关闭。

---

## 7 · 与 server-go 的接口

| 路径 | 用途 | 调用方 |
|:---|:---|:---|
| `GET /api/v1/public/search?q={term}&mode=hybrid&limit=10` | 关键词 + 语义混合搜索 | SearchPanel |
| `EventSource /api/v1/public/search/qa?q={term}` | AI 问答 SSE | SearchPanel |
| `GET /api/v1/public/search/features` | 探测 keywordEnabled / semanticEnabled / aiQaEnabled | SearchPanel |
| `GET /api/v1/public/posts?pageSize=100` | 时间轴 + 首页 | timeline / page.tsx |
| `GET /api/v1/public/posts?pageNum&pageSize` | /posts 列表 | posts/page.tsx |
| `GET /api/v1/public/archives` | (未使用,timeline 不读这个端点) | — |

### 响应形状(从代码反推)

`/search` 响应:
```json
{
  "code": 200,
  "data": {
    "items": [
      {
        "id": "1",
        "title": "...",
        "slug": "...",
        "highlight": "...",          // 或 "summary"
        "category": "Tech",
        "publishedAt": "2026-...",
        "score": 0.85,
        "source": "keyword" | "semantic" | "hybrid"
      }
    ]
  }
}
```

`/search/qa` SSE 事件:
```
data: {"type":"delta","content":"…"}
data: {"type":"sources","sources":[{"title":"…","slug":"…"}]}
data: {"type":"done"}
data: {"type":"error","message":"…"}
```

`/search/features`:
```json
{ "code": 200, "data": { "keywordEnabled": true, "semanticEnabled": true, "aiQaEnabled": false } }
```

---

## 8 · 设计系统应用

| Codex 元素 | 在哪 | 文件:line |
|:---|:---|:---|
| `surface-overlay` | SearchPanel 主容器 | `SearchPanel.tsx:454` |
| tablist | 文章/问答双模式 | `SearchPanel.tsx:611` |
| `ai-stream` | AI 回答文字 + 流式 cursor | SearchPanel 问答区 |
| `ink-cursor` | AI 流式光标(末尾闪烁的小极光块) | SearchPanel 问答区 |
| `bg-primary/10 text-primary border-primary/20` | 热门搜索 chip / 能力提示 | SearchPanel 面板内 |
| 历史 chip | `bg-[var(--bg-secondary)] border-[var(--border-subtle)]` | SearchPanel 面板内 |
| 键盘提示 `<kbd>` | `bg-[var(--bg-card)]` 圆角 | SearchPanel footer |

字体:result title 用默认 sans;publishedAt / source 标签用 `font-mono` 系。

---

## 9 · 性能注意点

- **260ms 防抖** —— 平衡输入响应与 backend QPS。短于 200ms 会触发过多请求,长于 500ms 用户感觉延迟。
- **`AbortController` 中断在飞 fetch** —— 否则用户连续输入会让旧结果在新结果之后到达,污染 UI。
- **`React.memo(SearchResultItem)`** —— 激活项变化只重渲染前后两条。
- **EventSource 仅在 `aiQaEnabled === true` 时建立** —— 避免无效连接。
- **历史/热门用 `useCallback` + `data-term` data attr** —— 避免每次渲染创建新 onClick 闭包。
- **iOS 黑屏 hack:** `motion.div initial={{ x: '-50%' }}` —— translateX(-50%) 是为了让 framer-motion 自带的 transform 不冲掉 CSS 居中。

---

## 10 · 已知限制

1. **没有"按 tag 浏览"**:tag 是首要发现维度,但前端无聚合页,可能流失大量长尾流量。
2. **search 没有独立路由 `/search?q=`**:深链接友好性弱,无法分享搜索结果。可加一条 `app/search/page.tsx` 接 ?q,server-side 拉初始结果再 hydrate。
3. **TRENDING_SEARCHES 是硬编码**:热门词与 backend 实际热门搜索不挂钩。可接 `/search/trending` 类端点。
4. **问答没有显式来源失败状态**:SSE 失败时只隐藏或保留已有回答,用户无法区分"没有答案"和"QA 服务不可用"。
5. **timeline 拉 `pageSize=100` 上限**:站点超过 100 篇文章后第 101 篇起就丢了。需要补无限滚或后端 cursor。
6. **`DEFAULT_VISIBLE_POSTS = 10`**(`TimelineTree.tsx:32`)硬编码,大型站点单月可能有 30+ 文章,目前每月只能看到前 10 加 expand。
7. **`useLocalStorage` 在 SSR 下无值**:friends 视图、search history、timeline 展开状态 —— 都靠"hasMounted"切换,有一帧 flicker。整体交互可接受,但 hydration 警告需关注。
