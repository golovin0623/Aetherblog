# 02 · 内容管理(文章 / 分类 / 评论 / 编辑器集成)

> **范围**:`apps/admin/src/pages/PostsPage.tsx`、`pages/posts/*`、`pages/CategoriesPage.tsx`、`pages/categories/*`、`pages/CommentsPage.tsx`、`components/PostPropertiesModal.tsx`、`components/posts/PostTableRow.tsx`、`@aetherblog/editor` 在后台的接入。

---

## 1. 范围

后台管理"博客内容"的全部入口都在这一切片:

- 文章列表、增删改查、批量复制、属性面板(`/posts`)
- 经典 Markdown 编辑器(`/posts/new` `/posts/:id/edit`)
- AI 协同写作工作台(`/posts/ai-writing/:id`)
- 分类 / 标签合并视图(`/categories`)
- 评论审核(`/comments`)

不在本切片:媒体库(03)、搜索 profile(06)、AI 工具箱(04)、AI 配置(04)。

---

## 2. 文章列表(`PostsPage.tsx`,1152 行)

### 2.1 入口与路由

- 路径:`/posts`
- 入口:`apps/admin/src/pages/PostsPage.tsx:33`
- 生命周期:`AdminLayout` 子页面;`AuthGuard` 已校验

### 2.2 关键状态与 URL 同步

| 状态 | 来源 | 备注 |
| --- | --- | --- |
| `searchQuery / debouncedSearch` | `useState` + 300ms debounce | URL `?search=` 单一事实源(`PostsPage.tsx:50-180`) |
| `posts / pagination / loading / error` | `useState` | **不走 React Query**,直接 axios + 自管 loading |
| `activeStatus` | `useState<string \| undefined>` | undefined / `'PUBLISHED'` / `'DRAFT'` |
| `filters` | `useState<FilterShape>` | `categoryId / tagId / minViewCount / maxViewCount / startDate / endDate / hidden` |
| `categories / tags` | `useState<Category[] \| Tag[]>` | 挂载后 `Promise.all` 拉一次,不分页 |
| `viewCountPreset / dateRange` | `useMemo` | 派生自 `filters`,**单一来源是 filters**,避免 cascade re-render |
| `confirmDialog` | `useState<{ isOpen, type, post }>` | 共享给"删除 / 复制"两种确认 |
| `selectedPost / isPropertiesModalOpen` | `useState` | 属性面板 modal |
| `activeTagPopover` | `useState<number \| null>` | 行级标签弹窗,点外关闭(`PostsPage.tsx:128-137`) |

### 2.3 数据流

```
PostsPage 挂载
  ├─ effect(activeStatus, debouncedSearch, filters) → fetchPosts()
  │   └─ postService.getList({ pageNum, pageSize: 10, status, keyword, ...filters })
  │        → GET /v1/admin/posts?...
  │   ├─ res.code === 200 → setPosts(list) + setPagination(...)
  │   └─ 其他 → setError(message)
  └─ 一次性 effect → categoryService.getList() / tagService.getList() 填筛选 dropdown
```

### 2.4 调用的 server-go 接口

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/v1/admin/posts` | 列表(分页 + 多条件) |
| GET | `/v1/admin/posts/{id}` | 复制 / 打开属性面板时拉详情 |
| PATCH | `/v1/admin/posts/{id}/properties` | 属性面板提交 |
| DELETE | `/v1/admin/posts/{id}` | 删除 |
| POST | `/v1/admin/posts` | 复制 → 新建草稿 |
| GET | `/v1/admin/categories` `/v1/admin/tags` | 筛选下拉 |

### 2.5 视图组成

桌面端表格:`<table>` 固定列宽,thead 是 sticky;每行单独抽成 `PostTableRow` 并用 `React.memo` 包裹 (`components/posts/PostTableRow.tsx:20`),避免父级 state 变化触发整页表格重渲染。

移动端走"列表卡片"模板(`PostsPage.tsx:923-1021`),每张卡片含:标题、状态徽章、隐藏 / 加密标记、分类、时间、浏览量、标签溢出 chip(`+N`)、操作图标组。

### 2.6 高级筛选

- 折叠面板(`AnimatePresence` height 动画,`PostsPage.tsx:638-710`)
- 4 列 grid:分类 Select / 标签 Select / 浏览量 Preset Select / DateRangePicker
- 控件全部来自 `@aetherblog/ui`(`Select` / `DateRangePicker`),保持 Codex 视觉一致
- 浏览量预设 5 档,值用 `'min:max'` 编码;无界用 `'-'`(`PostsPage.tsx:25-31`)
- 已激活筛选 → "Active chips strip"(`PostsPage.tsx:712-766`):每个 chip 可单独 ✕,以及"全部清空"(`resetAllFilters` 同时清 status tab)

### 2.7 状态切换 segmented

```tsx
{[{key: undefined, label: '全部'}, {key: 'PUBLISHED', label: '已发布'}, {key: 'DRAFT', label: '草稿'}].map(tab => ...)}
```

`framer-motion` 的 `layoutId="activeStatusTab"` 在 active 之间做底块滑动(`PostsPage.tsx:543-549`),`tabSpring` 在 reduced-motion 时退化成 `{ duration: 0 }`。

### 2.8 标签弹窗(行内 popover)

每行的"标签溢出"chip 触发 `activeTagPopover = post.id`;通过 `tagPopoverRef` 检测点击外部关闭。**不是** Radix Popover —— 自实现的简化版,因此打开多个会因 `activeTagPopover` 是单值自动互斥。

### 2.9 设计系统应用点

- 卡片表面:`surface-leaf surface-admin-card`(`PostsPage.tsx:769`)
- AI 协同写作 CTA:`color-mix(in oklch, var(--aurora-1) 8%, transparent)` 边框 + `aurora-1` 文字
- 主 CTA "新建文章":`bg-[var(--color-primary)]` + 0-100% 滑过白光高光带
- chip:`color-mix(in oklch, var(--aurora-1) 8%, transparent)` + 22% border;`tnum` 等数字字体
- 空态:大圆形背景 `aurora-1` 8%,标题 `font-display`,正文 `--ink-muted`
- 分页页码:active 用 `bg-primary text-white shadow-primary/25`(legacy `bg-primary`,这里 admin 的 primary 是近黑)
- 骨架屏:严格遵守 §3.6 的零 spinner 红线,`animate-pulse` 模拟最终布局

### 2.10 已知限制 / 待改进

1. `usePostStore` 在仓库里 / `index.ts` 也导出,但 `PostsPage` **完全不消费**它。是死代码。
2. 列表本地缓存策略缺失:换页/筛选都会发新请求,即使翻回上一页。React Query 替换可以低成本拿到。
3. 属性面板 `setSelectedPost(null)` 没有清,modal close 后 selectedPost 仍持有上次数据(`isPropertiesModalOpen=false` 控制 visibility);切到另一篇文章瞬间会闪上一帧旧数据。

---

## 3. 文章属性面板(`components/PostPropertiesModal.tsx`)

集中编辑非正文属性:标题、摘要、封面、分类、标签、定时发布、隐藏、密码、置顶、发布时间。

- 顶端集成 AI 摘要按钮(`ModelSelector` + `aiService.generateSummary`)
- 自定义日历(`date-fns`)+ 时间分钟微调
- 标签搜索 + 选择 + "新建标签"
- 提交走 `postService.updateProperties` PATCH
- 用 `@aetherblog/ui` 的 `Modal`,继承 surface-overlay 表面

---

## 4. 经典编辑器(`pages/posts/CreatePostPage.tsx`,主体接 `@aetherblog/editor`)

### 4.1 入口

- `/posts/new` → 创建模式
- `/posts/:id/edit` → 编辑模式
- 同一个文件 `pages/posts/CreatePostPage.tsx`(>1500 行,本文档不全展开)

### 4.2 编辑器栈

```
@aetherblog/editor
  ├─ EditorWithPreview        Markdown 编辑 + 预览(可分屏)
  ├─ EditorView               CodeMirror 6 view
  ├─ useEditorCommands        Bold/Italic/H1.../List/Code 等命令
  ├─ useTableCommands         表格插入 / 行列管理
  └─ useImageUpload           粘贴 / 拖拽图片直接上传到 mediaService
```

### 4.3 关键状态

- `formData`:title / content / summary / coverImage / categoryId / tagIds / status
- `lastSaveStatus`:`{type: 'saving' | 'saved' | 'error' | 'disabled', source: 'auto' | 'manual' | 'publish' | 'system', label, detail, updatedAt}`
- 自动保存通过 fingerprint 比对(`buildDraftFingerprint`)避免同状态重复保存
- `draftBaselineRef`:对比是否有未保存差异,影响"返回"是否弹确认

### 4.4 调用的 server-go 接口

| Method | Path | 触发 |
| --- | --- | --- |
| GET | `/v1/admin/posts/{id}` | 编辑模式 mount |
| POST | `/v1/admin/posts` | 首次保存(创建模式) |
| PUT | `/v1/admin/posts/{id}` | 完整保存 |
| POST | `/v1/admin/posts/{id}/auto-save` | 自动保存 draft |
| PATCH | `/v1/admin/posts/{id}/publish` | 发布 |
| GET | `/v1/admin/system/time` | 定时发布时拉服务端时间避免本地时钟漂移 |
| GET | `/v1/admin/categories` `/v1/admin/tags` | 下拉填充 |
| POST | `/v1/admin/media/upload` | 编辑器内部图片上传 |

### 4.5 AI 集成

- `SelectionAiToolbar`(`pages/posts/components/SelectionAiToolbar.tsx`):选中文本浮起的工具条,可润色 / 翻译 / 总结
- `SlashCommandMenu`(`SlashCommandMenu.tsx`):输入 `/` 触发命令面板,插入 alert block / 标题 / 列表等
- `AiSidePanel`(`AiSidePanel.tsx`):右侧 AI 助手面板,当前 panel handle 通过 ref 暴露给外部
- `AlertBlockDropdownButton`:Aether Codex 自创的"提示块" Markdown 扩展(NOTE / WARN / TIP / DANGER 四档)
- 通过 `useEditorStore.{enableSelectionAi, enableSlashAi}` 全局开关

### 4.6 已知限制

- AI 工具栏的浮起位置在某些字号下偏移(`PostEditor.tsx` 的旧实现已废,`pages/posts/components/PostEditor.tsx` 也是无主)
- 服务端时间(`postService.getServerTime`)只在定时发布触发,但发布失败 fallback 到本地时间没有报警
- `apps/admin/src/pages/posts/AiWritingWorkspacePage.backup.tsx` 是旧版备份(>1300 行),应清理

---

## 5. AI 协同写作(`pages/posts/AiWritingWorkspacePage.tsx`)

独立工作台,是经典编辑器的"重交互"版本。

### 5.1 与经典编辑器的差异

| 维度 | 经典 | AI 协同 |
| --- | --- | --- |
| 路由 | `/posts/new` `/posts/:id/edit` | `/posts/ai-writing/new` `/posts/ai-writing/:id` |
| 布局 | 标准 AdminLayout(顶部工具栏 + 编辑) | 自管全屏(`isAppPage`),无 padding |
| 视图模式 | edit / preview / split | 同 + 移动端自动切 edit |
| AI 触发 | SelectionAiToolbar / SlashCommandMenu | + Ghost text 实时预测(`useAiPrediction`) + 工作流引导(`WorkflowNavigation`) + 历史 Diff(`HistoryPanel` + `DiffView`) + 全局对话面板(`AiChatPanel`) |
| 快捷工作流 | 无 | `useWritingWorkflow` 记录 stage(brainstorm → outline → draft → refine → review) |
| AI 能力 | 通用 | `AI_CAPABILITIES` 数组(目前只 `polish` / `summarize`,扩写已删) |

### 5.2 数据流

```
AiWritingWorkspacePage
  ├─ useHistoryManager         快照管理(local first,关键时刻 PUT 上传)
  ├─ useAiPrediction           ghost text(目前 mock,见 9-design-implementation §5.3)
  ├─ useWritingWorkflow        阶段机
  ├─ FloatingAiToolbar         浮起 AI 操作
  ├─ HistoryPanel + DiffView   时间旅行 / 对比
  └─ AiChatPanel               与 AI 多轮对话
```

调用的 server-go 接口与经典编辑器相同,加上 `/v1/admin/ai/*` 流式接口(详见 04)。

---

## 6. 分类 / 标签(`pages/CategoriesPage.tsx`)

### 6.1 视图

- 顶部 segmented "分类 / 标签" 切换 → fetch 不同 endpoint
- 每个 tab 一个 grid:卡片显示 name + slug + postCount,悬停露 编辑 / 删除 actions
- 派生 stats(`useMemo`):total / totalPosts / topName / topCount

### 6.2 调用接口

| Tab | Endpoints |
| --- | --- |
| 分类 | `/v1/admin/categories` GET / POST / PUT `/{id}` / DELETE `/{id}` |
| 标签 | `/v1/admin/tags` GET / POST / PUT `/{id}` / DELETE `/{id}` |

### 6.3 复用的 modal(`pages/categories/CreateItemModal.tsx`)

同一个 modal 兼容创建 / 编辑、分类 / 标签 4 种路径(`type: 'category' | 'tag'`,`initial?: { name, description? }`)。

技巧(`CategoriesPage.tsx:72-107`):

- close 时延迟清空 `editTarget` 让退场动画期间仍显示"编辑"标题
- 用 `editTargetResetTimer` ref 跟踪计时器:任一 open 路径都先取消 pending reset,否则"关闭 A → 200ms 内打开 B"会让旧 timer 把 editTarget 清成 null,新模态被误判为 create

### 6.4 设计系统应用点

- ConfirmModal 来自 `@aetherblog/ui`,用于删除前的二次确认
- 标签卡片配色:`getTagHex(name)` 哈希取色(`lib/tagColor.ts`)→ scope 限定到一行,不影响 token

---

## 7. 评论(`pages/CommentsPage.tsx`)

### 7.1 视图

- segmented "全部 / 待审核 / 已通过 / 垃圾 / 已删除"
- 列表分页(10 条 / 页),`fetchComments` 在 status / page 变化时重拉
- 每条卡片显示:作者头像 + 邮箱、内容、所属文章链接、状态徽章、操作组(通过 / 拒绝 / 标记垃圾 / 还原 / 删除 / 永删 / 回复)
- 回复:本地展开输入区,但**回复 API 当前未实现**,只是把 `replyContent` 输出到 toast(reset 是有的)

### 7.2 调用接口

| 操作 | Method + Path |
| --- | --- |
| 列表 | GET `/v1/admin/comments?status=&pageNum=&pageSize=` |
| 通过 | PATCH `/v1/admin/comments/{id}/approve` |
| 拒绝 | PATCH `/v1/admin/comments/{id}/reject` |
| 标记垃圾 | PATCH `/v1/admin/comments/{id}/spam` |
| 还原 | PATCH `/v1/admin/comments/{id}/restore` |
| 删除 | DELETE `/v1/admin/comments/{id}` |
| 永删 | DELETE `/v1/admin/comments/{id}/permanent` |

### 7.3 状态映射

`statusConfig`(`CommentsPage.tsx:16-21`):

```ts
pending  → 待审核 / Clock / status-warning
approved → 已通过 / Check / status-success
spam     → 垃圾评论 / Flag / status-danger
deleted  → 已删除 / Trash2 / muted
```

`UIStatus`(小写)→ `CommentStatus`(后端 enum)的 toUpperCase 转换在 `fetchComments` 内做。

### 7.4 ⚠ 演示降级反模式

每个 mutation 的 catch 块都写了"降级":

```ts
catch (error) {
  setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.APPROVED } : c));
  toast.success('评论已通过 (演示模式)');
}
```

后果:

- 真实失败(403 / 500 / 网络断)被静默掩盖,用户以为操作成功
- 状态被本地改成"演示数据",刷新后又变回原状,造成"莫名其妙"的体验
- 还有 `mockComments` 兜底,fetch 失败时假装有 4 条评论

建议:全部改成 `toast.error(err.message || '操作失败')` + 不修改状态。

### 7.5 设计系统应用点

- 大量 `text-status-warning / text-status-danger / bg-status-success-light` 等 legacy token,夹杂 `var(--text-muted)` `var(--bg-tertiary)`
- 是 Codex 迁移最未完成的大页之一(参见 `09-design-implementation.md`)

### 7.6 已知限制

- 缺真正的回复 API,UI 已经预留交互
- 没有"批量"操作的入口(后端 `/comments/batch/approve` `/comments/batch` `/comments/batch/permanent` 都已存在,前端没接)
- 分页只走 status tab + pageNum,**搜索没接**(searchQuery 字段定义了但没用)
- "演示模式"toast 是技术债

---

## 8. PostListItem 与 Post 的二元类型

后端返回的列表项是 `PostListItem`(轻量,只含 categoryName / tagNames 字符串)。打开属性面板需要完整 `Post`(关联的 Category 和 Tag 对象、content、password 等)。

`PostsPage` 的做法:

```ts
const handleOpenProperties = useCallback(async (post: PostListItem) => {
  const res = await postService.getById(post.id);  // 拉详情
  if (res.data) {
    setSelectedPost(res.data);  // selectedPost 是 Post(详情)
    setIsPropertiesModalOpen(true);
  }
}, []);
```

`PostPropertiesModal.tsx:34-42` 的 prop 类型也明确写 `post: Post`(详情),与列表的 `PostListItem` 区分。

类型定义在两处:

- `services/postService.ts:4-29`(详情)/ `:31-48`(列表项)
- `types/post.ts:2-26`(详情)/ `:30-47`(列表项)

⚠ 两份定义内容相似但不完全等价:`types/post.ts` 把 `category?: Category` 当对象;`services/postService.ts` 同时支持 `categoryId/categoryName` 字符串和 `category` 对象。这是历史遗留,目前两个定义都被实际用,需要后续合并。

---

## 9. 数据流总览

```
PostsPage (列表)
  ├─ useEffect → postService.getList → R<PageResult<PostListItem>>
  ├─ Hover 行 → 打开属性弹窗 → postService.getById → R<Post> 详情
  ├─ 提交属性弹窗 → postService.updateProperties (PATCH) 局部更新
  ├─ 删除 → postService.delete + ConfirmDialog
  └─ 复制 → postService.getById → postService.create(草稿)

CreatePostPage (经典编辑器)
  ├─ 编辑模式: postService.getById 加载
  ├─ 自动保存: postService.autoSave (POST /auto-save)
  ├─ 完整保存: postService.update (PUT)
  ├─ 发布: postService.publish (PATCH /publish)
  └─ AI 工具: aiService.* (非流式) 或 useStreamResponse (流式)

AiWritingWorkspacePage
  ├─ 同上,加 ghost text 预测、历史快照、AI 对话
  └─ HistoryPanel 内部把 snapshot 存到 localStorage(history-storage.ts)

CategoriesPage
  └─ categoryService / tagService 的 CRUD

CommentsPage
  └─ commentService 的 status 轮转
```

---

## 10. 跨切片依赖

- 文章列表的"高级筛选"用到 `@aetherblog/ui` 的 `Select` / `DateRangePicker`,在所有数据密集页都看到 — 一旦这两个组件改 API,后台四五个页面都要联动。
- AI 协同写作的"目标文章"概念也被 AIToolsPage(04)消费(`useAiToolTarget`),hook 通过 localStorage 持久化跨页面状态。
- 编辑器图片粘贴走 `mediaService.upload`(03),所以编辑器需要的 storage backend 必须先在(06)的"存储管理"配好。

---

## 11. 已知限制 / 待改进汇总

1. ⚠ **演示降级**:`CommentsPage` 每个 mutation 的失败回退都假装成功,误导用户。优先级 P0。
2. ⚠ **`AiWritingWorkspacePage.backup.tsx`**:旧版备份,1300+ 行,已经不被引用,应删。
3. ⚠ **`pages/posts/components/PostEditor.tsx`**:简版 textarea Markdown 编辑器,已被 `@aetherblog/editor` 替代,不再被引用,可删。
4. **`PostListItem` / `Post` 双类型源**:`services/postService.ts` 与 `types/post.ts` 各定义一份,字段大同小异。建议以 `services/postService.ts` 为权威,`types/post.ts` 删除或转为 re-export。
5. **PostsPage 不用 React Query**:多处 useState + useEffect。可平滑迁移到 `useQuery({ queryKey: ['posts', filters], queryFn })`,下一页/换 tab 自动缓存,UX 更顺。
6. **CommentsPage 缺批量 / 搜索**:后端 `/batch/approve` 等已就绪,前端没接;`searchQuery` state 定义了但没引用。
7. **AI 协同写作的 `aiPredictionService` 是 mock**:ghost text 实际不调后端,只是关键词触发模板;后端没有对应 endpoint。要么删该 hook,要么实装。
