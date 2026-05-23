# AetherBlog 智能笔记 UI 与交互规格

更新时间: 2026-05-23  
状态: 批准前 UI/UX 规格, 实施前不得替代 `intelligent-notes-module-design.md` 的架构边界

## 1. 设计目标

「智能笔记」的 UI 应该像文章管理一样稳定、可扫描、可批量处理, 但不能让用户感觉自己在写一篇要发布的博客文章。

核心体验:

- 进入快: 从「灵境」下方一眼可见。
- 创建快: 标题可空, 内容可先写, 不被分类/SEO/发布状态打断。
- 找回快: 搜索优先, 最近/置顶/未整理/归档视图直接可用。
- 编辑轻: Markdown 编辑器保留, 但去掉发布系统的压力。
- 可扩展: 右侧信息面板预留来源、反链、AI 状态, 不在首屏堆复杂功能。

## 2. 当前 UI 基线

当前后台已有可复用基线:

- `apps/admin/src/pages/PostsPage.tsx`
  - 搜索关键词同步 URL query。
  - `AdminPagination` 分页。
  - 桌面 table + 移动 card 双视图。
  - 复制、删除、编辑、属性弹窗。
- `apps/admin/src/pages/posts/CreatePostPage.tsx`
  - `@aetherblog/editor` 的 `EditorWithPreview`。
  - 自动保存状态。
  - 桌面 split/edit/preview, 移动端固定 edit。
  - Markdown 工具栏、图片上传、Slash command、AI 面板。
- `apps/admin/src/components/common/CommandPalette.tsx`
  - 已有全局命令入口。
- `apps/admin/src/components/layout/SidebarSearchPalette.tsx`
  - 已有侧边栏搜索面板。

智能笔记应复用这些基础能力, 但在文案、字段和操作层面做减法。

## 3. 导航与入口

侧边栏位置:

```text
INTELLIGENCE
  灵境
  智能笔记
  智能编排
  写作助手
  ...
```

入口要求:

- 图标建议使用 `NotebookTabs`, `BookMarked`, `Files`, `NotebookPen` 中一个, 优先 `NotebookPen`。
- 名称固定为「智能笔记」。
- 路由固定为 `/notes`。
- 位置必须紧跟 `/aetherhub` 后方。
- 移动端侧边栏点击后关闭 drawer, 与现有导航一致。

命令入口:

- 「前往 · 智能笔记」 -> `/notes`。
- 「新建 · 智能笔记」 -> `/notes/new`。
- 「快速记录」 -> 打开 QuickNoteDialog。

侧边栏搜索:

- 第一版至少支持静态入口。
- 第二步再接 notes 搜索结果, 格式建议为 `笔记 · {title}`。

## 4. `/notes` 列表页规格

### 4.1 页面布局

桌面:

```text
Header
  左: 智能笔记 / 当前视图说明 / 结果数量
  右: 快速记录 / 新建笔记

Toolbar
  搜索框
  视图 tabs: 全部 最近 置顶 未整理 已归档
  轻筛选: 文件夹 标签 来源 含待办

Content
  Desktop table
  Mobile cards

Footer
  AdminPagination
```

移动端:

- Header 压缩为两行:
  - 第一行: 标题 + 新建 icon button。
  - 第二行: 搜索框。
- 视图 tabs 横向滚动。
- 筛选入口使用 Bottom Sheet。
- 每张卡最小点击区域不低于 44px。
- 不展示密集表格列。

### 4.2 列表列定义

桌面 table 推荐列:

| 列 | 内容 | 说明 |
| --- | --- | --- |
| 标题 | title + 摘要首行 | 标题为空时展示自动标题 |
| 标签 | 最多 3 个 tag chip | 超出显示 `+N` |
| 文件夹 | folder name | 无文件夹显示「未整理」 |
| 来源 | manual/web/article/chat/import/api | 用 icon + tooltip |
| 更新时间 | relative time | hover 可看绝对时间 |
| 操作 | 编辑、复制、归档、删除 | icon button + tooltip |

不要出现:

- 状态: 已发布/草稿/计划发布。
- 分类: 文章分类。
- 评论数。
- 浏览量。
- SEO 状态。
- 公开/隐藏。
- 密码锁。

### 4.3 视图 tabs

固定视图:

- 全部: `archived=false AND deleted=false`。
- 最近: 最近打开或最近更新排序。
- 置顶: `is_pinned=true AND archived=false`。
- 未整理: `folder_id IS NULL AND archived=false`。
- 已归档: `archived=true AND deleted=false`。

行为:

- 视图变化同步 URL query: `?view=recent`。
- 搜索、筛选、分页也同步 URL query。
- 切换视图时 pageNum 重置为 1。

### 4.4 搜索与筛选

搜索框:

- placeholder: `搜索标题、正文或标签...`
- debounce: 沿用文章页节奏。
- 空搜索清除 query。

筛选:

- 文件夹: 单选。
- 标签: 多选。
- 来源: 单选。
- 含待办: boolean, 匹配 `- [ ]` 或 `- [x]`。

第一版可以后端只实现基础 `keyword/folder/tag/source/archived`, `hasTodo` 可放 Phase 2。

### 4.5 空状态

空状态分三类:

1. 无任何笔记:
   - 主操作: 「新建笔记」
   - 次操作: 「快速记录」
2. 搜索无结果:
   - 主操作: 「清空搜索」
   - 次操作: 「新建包含该关键词的笔记」
3. 当前视图无结果:
   - 例如「未整理」为空, 文案应说明当前视图没有匹配笔记, 不引导用户去发布文章。

## 5. `/notes/new` 与 `/notes/:id/edit` 编辑页规格

### 5.1 编辑页结构

桌面:

```text
TopBar
  返回 / 保存状态 / 自动保存状态 / 保存按钮

Main
  左侧: Markdown EditorWithPreview
  右侧: NoteInfoPanel
```

移动端:

- 默认 edit 模式。
- 顶部只保留返回、保存状态、保存按钮、更多菜单。
- 信息面板从底部 Bottom Sheet 打开。
- 工具栏保持触控区 44px。

### 5.2 标题与保存

标题输入:

- placeholder: `未命名笔记`
- 可为空。
- 失焦或保存时不强制弹错。

创建规则:

1. title 非空: 直接使用 title。
2. title 为空且正文首行非空: 服务端生成首行标题。
3. 两者都空: 允许快速创建空壳时使用 `未命名笔记 YYYY-MM-DD HH:mm`。

保存按钮:

- 文案: 「保存」
- 不使用「发布」。
- 保存成功不跳到文章页。
- 新建成功后进入 `/notes/:id/edit`。

自动保存:

- Redis key 前缀应为 `note:draft:`。
- 状态文案:
  - `已保存`
  - `保存中`
  - `自动保存成功`
  - `自动保存失败`
- 不出现「草稿发布」语义。

### 5.3 编辑器能力

保留:

- Markdown 编辑。
- split/edit/preview。
- 图片插入。
- 表格工具。
- 基础 Markdown 工具栏。
- Slash command 的非文章命令。

首版建议移除或隐藏:

- 文章 AI 写作入口。
- 发布校验。
- 分类必填。
- SEO 生成。
- 文章摘要模型选择。
- 公开可见性切换。

可保留但改名:

- 目录/TOC -> 可保留为「大纲」。
- AI 侧栏 -> 若保留, 只作为「笔记助手」占位, 不承诺索引召回。

## 6. NoteInfoPanel 规格

右侧信息面板分组:

```text
基础
  文件夹
  标签
  置顶
  收藏
  归档

来源
  来源类型
  来源标题
  来源 URL

关联
  出链
  反链

AI
  索引状态
  最近索引时间
  后续能力占位
```

首版默认展开:

- 基础。

默认折叠:

- 来源。
- 关联。
- AI。

交互要求:

- 标签可直接输入创建。
- 文件夹可为空。
- 来源 URL 不触发抓取。
- 反链为空时展示轻量空状态, 不引导创建图谱。
- AI 状态只显示底座状态, 不显示不可用按钮。

## 7. QuickNoteDialog 规格

目标:

- 适合快速记录一段话、一个链接、一条待办。
- 不要求完整标题、文件夹、标签。

桌面:

- 居中 modal, 宽度 560-680px。
- 输入区 autofocus。
- 支持 `Cmd/Ctrl + Enter` 保存。
- 支持 `Esc` 关闭。

移动端:

- Bottom Sheet。
- `max-h-[66vh]`。
- 底部按钮区使用 safe area: `pb-[max(1rem,env(safe-area-inset-bottom))]`。

字段:

- 标题: 可选。
- 内容: 主输入。
- 标签: 可选, 支持从正文 `#tag` 自动提取。
- 文件夹: 可选。

按钮:

- 主按钮: 「保存」
- 次按钮: 「保存并继续」
- 取消: icon 或文字均可, 但触控区不小于 44px。

保存后:

- 「保存」关闭弹窗并 toast。
- 「保存并继续」清空输入, 保留文件夹和标签。
- 新建结果不跳转, 除非用户点击 toast 中的「打开」。

## 8. 文案规范

必须使用:

- 智能笔记
- 笔记
- 保存
- 归档
- 快速记录
- 文件夹
- 标签
- 来源
- 关联
- 反向链接

不得使用:

- 发布
- 上架
- 公开
- 首页展示
- SEO
- 评论
- 阅读量
- 密码访问
- 文章分类

状态文案:

| 状态 | 文案 |
| --- | --- |
| saving | 保存中 |
| saved | 已保存 |
| autosaved | 自动保存成功 |
| failed | 保存失败 |
| archived | 已归档 |
| deleted | 已删除 |

## 9. 响应式与可访问性

响应式:

- 移动端断点沿用项目标准 `max-width: 768px`。
- 移动端编辑默认 `edit`。
- 桌面默认 `split`。
- 筛选和信息面板在移动端使用 Bottom Sheet。

可访问性:

- icon button 必须有 `aria-label` 或 tooltip。
- 搜索框支持 `Enter` 触发立即搜索。
- Dialog 初始焦点落在主输入区。
- 删除/归档等破坏性操作必须确认。
- 键盘路径: CommandPalette -> 新建笔记 -> 保存。

布局稳定性:

- 列表行高度尽量固定, 摘要最多两行。
- tag chip 最多显示 3 个, 防止撑破行。
- 标题长词需要截断或换行, 不允许覆盖操作按钮。
- 移动端卡片操作区固定在底部或右上, 不随摘要长度漂移。

## 10. 实施后视觉验收

批准实现后, UI 需要额外做以下人工或浏览器检查:

- 桌面 `/notes`: 1440px 宽度, 表格无横向溢出。
- 移动 `/notes`: 390px 宽度, 卡片文字不压住按钮。
- 桌面 `/notes/new`: split/edit/preview 切换正常。
- 移动 `/notes/new`: 默认 edit, 工具栏不遮挡输入区。
- QuickNoteDialog 桌面 modal 和移动 Bottom Sheet 均可保存。
- 空状态、加载状态、错误状态都有明确主操作。
- 深色/浅色主题下 tag、folder、source chip 对比度可读。

建议使用浏览器截图验证后再汇报, 但只有在批准并实现代码后执行。
