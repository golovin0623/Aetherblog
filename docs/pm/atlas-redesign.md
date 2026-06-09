# Aether 知识图集 / INTELLIGENCE —— 产品诊断与重构方案

> 视角：产品经理（用户旅程 / 信息架构 / 激活漏斗）。
> 基线：branch `codex/atlas-intelligence-redesign`，对照 `apps/admin` + `apps/server-go/internal/knowledge` + `apps/ai-service/.../atlas.py` 现有实现。
> 结论先行：**这不是"功能不够"的问题，是"功能没被组织成一个能力"的问题。** 后端能力是真的、且相当完整；崩的是信息架构、激活路径和叙事主线。

---

## 0. 执行摘要（TL;DR）

你的三句抱怨，对应三个根因，对应一个主干动作：

| 你的原话 | 真正的病 | 证据 |
| --- | --- | --- |
| "不知道如何使用" | **没有引导入口 / 闭环不可见**——核心创造面（Reader）连侧边栏入口都没有，第一步只能在「笔记/媒体/写作」里靠图标摸到 | Reader 6 个页面 0 个侧边栏入口；`/atlas/kps`、`/atlas/graph` 空状态承诺"直接创建"却没有按钮 |
| "功能有了无法应用" | **使用时机没被设计**——冷启动入口藏在别的模块，AI 全靠手点、逐条 accept，无前向交接 | 高亮文本不触发任何 AI；建议要逐条 accept，无批量；关系一次只能建一对 |
| "各自零散无法聚合成核心能力" | **没有产品主干**——灵境/笔记/图集/知识库是 4 座孤岛，14 项扁平菜单，图集自己又被拆成 5 项 | INTELLIGENCE 菜单 14 项；Atlas = 5 个并列入口；KB 与 Atlas 完全不互通；无 onboarding |

**元根因：整个模块是"数据模型优先"而非"任务优先"建的。** 每个界面都以数据库表命名（Carrier / Annotation / KnowledgePoint / TypedRelation / Suggestion），用户被迫从 schema 反推工作流。

**一个主干动作：把 4 座孤岛 + 5 个图集子页，收敛成「一个能力、一个闭环」——「读 → 标 → 联 → 问」，单一入口、内部分页、渐进暴露。** 其余都是这条主干上的战术。

**最高性价比的 6 件事（P0，几天内、近零风险，全是导航/文案/空状态）：**
1. 把 Atlas 5 个侧边栏项折叠成 1 项「知识图集」+ 内部 Tab。
2. 把 **Reader/读物**提为一等可见入口（今天它是隐形的，却是整个价值的起点）。
3. 把 `模型中心/全局价格/搜索配置/数据分析` 移出 INTELLIGENCE（它们是配置/分析，不是知识工作）。
4. 把空状态从"谎言"改成"真 CTA"（`/atlas/kps`、`/atlas/graph` 当前承诺创建却无按钮）。
5. 去术语化 + 删内部代号（`P2-02`、`Phase 3 后期`、`provenance`、`relation density` 全部泄漏到用户文案）。
6. Hub 顶部加 60 秒 onboarding 条：「读 → 标 → 联 → 问」一句话讲清这是什么。

做完这 6 件，INTELLIGENCE 从 14 项噪音降到 ~5 项有意义入口，新用户第一次知道"从哪开始"。

---

## 1. 先认清：你到底已经拥有什么

体检第一步是别误诊。**Atlas 后端不是占位 stub，是一套完整能力。** 优化的前提是承认这一点——你缺的是"用起来"，不是"造出来"。

| 能力 | 状态 | 位置 |
| --- | --- | --- |
| Carrier 摄入（markdown/web/pdf/blog/image/transcript 六类） | ✅ 真实持久化 + 版本化（web 有 SSRF 防护抓取，pdf 有 pypdf 抽取） | `internal/knowledge/service/*_carrier.go` |
| Annotation 增删改 + 鲁棒锚定（W3C 多选择器 + 4 级 re-anchor 回退） | ✅ 完整 | `annotation_handler.go` / `pages/atlas/lib/anchoring.ts` |
| KnowledgePoint 增删改 + 证据链接 | ✅ 完整 | `kp_handler.go` / `kp_service.go` |
| TypedRelation（9 种类型，自环守卫） | ✅ 完整 | `relation_repo.go` |
| 图谱查询 / 导出（json·graphml·md）/ 导入（obsidian·readwise·zotero） | ✅ 完整 | `AtlasGraphPage.tsx` |
| 搜索（tsvector 关键词 + pgvector 语义重排） | ✅ 完整 | `atlasService.search` |
| AI 建议收件箱（生成/列表/accept/reject，指纹去重，单事务原子 accept） | ✅ 完整，**真 LLM（配了路由）或启发式 fallback** | `suggestion_service.go:164`，`ai-service/atlas.py:497` |

**唯二的真·缺口（且文档已自认）：**
- **image / transcript 没有 OCR / 语音转写**——carrier 的文本层要调用方自己喂（`image_carrier.go:34` / `transcript_carrier.go:31`）。
- **AI 抽取要么真 LLM、要么启发式 stub**，取决于是否配了 Atlas task routing 凭证（`atlas.py:881` 的 gate）。没配凭证时点"生成建议"出来的是句子切分的低质候选——这会让用户觉得"AI 很蠢"，反向劝退。

> 含义：你手里是一台"零件齐全但没装配说明书、且发动机默认怠速"的机器。下面全部是装配与点火，不是再造零件。

---

## 2. 用户视角：核心任务（JTBD）与今天的真实旅程

### 2.1 这个模块到底替用户干的一件事（Job To Be Done）

> **"帮我把读到的东西，变成一张连得起来、能被 AI 调用的个人知识网——而不是又一个躺着不动的收藏夹。"**

拆成动作就是一个**闭环**：

```
   读 (Read)         标 (Mark)          联 (Connect)        问 (Ask)
 带进一篇读物  →   高亮关键句变成   →   把知识点连成图谱  →   用灵境基于
 (笔记/网页/PDF/    知识点(KP)          (手动 / AI 建议)      你的知识网作答
  文章/转录)
        └────────────────────────── 越用越厚 ──────────────────────────┘
```

这就是用户脑子里该有的模型。但**今天的产品没有任何一个界面呈现这个闭环**——它把闭环拆成了 14 个抽屉，让用户自己去猜哪个抽屉接哪个。

### 2.2 激活漏斗：用户在哪一步掉队（今天）

把"新用户第一次到拿到价值"画成漏斗，标出现状断点：

```
发现 Hub ──► 加第一篇读物 ──► 第一条标注 ──► 第一个 KP ──► 第一条关系/图 ──► 第一次 AI 提问
   │              │ ✗✗✗            │ ✓            │ ✓            │ ✗✗            │ ✗✗✗
   │           断点①最致命       Reader 内       Reader 自动     断点③         断点④
   │         入口藏在别的模块     这一跳很顺      跳转 KP 详情    要先有≥2 KP    笔记→问AI
   └─ 14 项扁平菜单，          (Reader 无          (好)           关系下拉      无前向通道
      不知点哪个               侧边栏入口)                        静默为空
```

**断点①（致命）——冷启动在 Atlas 之外、且不可发现。**
- 要拿到第一个 KP，必须去 **笔记编辑器 / 媒体详情 / AI 写作** 里找一个"在 Atlas 中标注"的图标（`CreateNotePage.tsx:264`、`MediaDetail.tsx:233`、`AiWritingWorkspacePage.tsx:439`）。
- 而 Atlas 自己的菜单里 **没有任何"读物/Reader"入口**；`/atlas/kps` 空状态只写"没有匹配的知识点"，**没有任何 CTA**；`/atlas/graph` 空状态写"请在 Reader 里抽离一些 KP 或直接创建"——**"直接创建"这个页面上根本没有按钮**。承诺了创建，却让用户撞墙。

**断点③——关系需要预先存在 ≥2 个 KP，但没人告诉用户先去抽第二个。** KP 详情的关系下拉静默为空，用户以为坏了。

**断点④——"问 AI"对笔记是死路。** 用户在笔记里写完东西，没有任何按钮说"拿这篇问灵境 / 加进知识库"。灵境只能反向 `@` 拉取已经进了 Atlas/KB 的内容。Notes → AI 的前向通道在 UI 里不存在。

### 2.3 "第一个 10 分钟"实拍（重建自代码里的真实文案/空状态）

> 新用户登录 → 侧边栏 INTELLIGENCE 下密密麻麻 14 项 → 点最像主入口的「知识图集」→ 仪表盘一堆 0 和黑话指标（Relation density / KP evidence coverage / orphan KP ratio）→ 想建知识点，点「图集知识点」→ "没有匹配的知识点"，无按钮 → 点「图谱视图」→ "请在 Reader 里抽离…或直接创建"，仍无按钮 → 点「图集建议」→ "Phase 3 后期接入 ai-service 后会有大批量 claim extraction 产出" → **用户合上电脑。**

这一段就是"不知道如何使用"的逐帧回放。问题不在用户笨，在于**产品把数据库表名摆出来，让用户自己装配工作流**。

---

## 3. 北极星：一个能力，一个闭环，三层主干

### 3.1 重构心智：从「4 孤岛 + 5 子页」到「3 层主干」

把 14 项重新归位到用户能理解的**三层**——这就是用户要的"聚合成核心能力"：

```
            ┌─────────────────────────────────────────────────────┐
            │                  你的第二大脑 / 知识中枢               │
            ├──────────────┬───────────────────┬──────────────────┤
   输入层    │  笔记(写)     │  Reader(读&标)     │  知识库(丢文档)   │   ← Capture
   Capture  │  Notes        │  Carrier+Annotation│  KB upload        │
            ├──────────────┴───────────────────┴──────────────────┤
   结构层    │       知识点(KP) → 关系 → 图谱 → AI 建议收件箱         │   ← Structure
   Structure│       (这就是今天被拆成 5 项的 Atlas，应合成 1 个工作台) │
            ├──────────────────────────────────────────────────────┤
   应用层    │   灵境对话(问)   ·   写作助手(用它写)   ·   搜索(找)     │   ← Apply
   Apply    │   AetherHub      ·   AI Writing         ·   Search      │
            └──────────────────────────────────────────────────────┘
   配置层(挪走): 模型中心 · 全局价格 · 搜索配置 · 数据分析 → 归 SYSTEM/配置
```

一句话叙事（应印在 Hub 顶部和 onboarding 里）：
> **读到的丢进 Reader 高亮成知识点 → 连成你的知识图谱 → 灵境基于这张图替你作答和写作。**

### 3.2 信息架构：Before / After

**Before —— INTELLIGENCE（14 项扁平，Atlas 被拆 5 项，混入配置）：**
```
灵境 · 智能笔记 · 知识图集 · 图集搜索 · 图集知识点 · 图谱视图 · 图集建议 ·
知识库 · 智能编排 · 写作助手 · 全局价格 · 数据分析 · 搜索配置 · 模型中心
```

**After —— 按"输入→结构→应用"重组，Atlas 收敛为 1 项带内部 Tab：**
```
INTELLIGENCE（知识工作）
  ├─ 知识图集 ▸           ← 单一入口，进去是带 Tab 的工作台：
  │     [概览] [读物] [知识点] [图谱] [建议] [搜索]
  │              ▲ 新增可见入口，承载 Reader/Carrier，修掉断点①
  ├─ 智能笔记            ← 输入层（也可作为图集"读物"的来源之一）
  ├─ 知识库             ← 输入层（文档 RAG 源）
  ├─ 灵境               ← 应用层（问）
  └─ AI 工具 ▸ 写作助手 / 智能编排   ← 应用层（用）

SYSTEM / 配置（挪出去）
  └─ 模型中心 · 全局价格 · 搜索配置 · 数据分析
```

> 这一步几乎纯导航配置（`Sidebar.tsx:71-87` + 一个 `AtlasLayout` 带 Tab），却把"图集到底是几个东西"从 5 个降到 1 个，认知负荷断崖式下降。

### 3.3 把"知识库 vs 图集"的暧昧关系一次讲清

今天 KB 和 Atlas **在 UI 里零连接**，是两套平行的检索系统——用户合理困惑"我为什么有两个'知识'功能"。给一个清晰的决策分工（写进两个页面的引导文案）：

| | 知识库（KB） | 知识图集（Atlas） |
| --- | --- | --- |
| 何时用 | 一堆参考文档想直接问 AI | 主动精读、想建立**结构化、可溯源**的知识网 |
| 投入 | 低（上传即用） | 高（读、标、联） |
| 产出 | 向量召回的片段 | 知识点 + 类型化关系 + 图谱 |
| 共同点 | **都是喂给「灵境」这同一个大脑的"源"** | |

**桥（P1）：** 让 KB 文档能在 Atlas Reader 里打开标注（KB→Atlas 的缺失连接），让两套源在灵境侧统一呈现为"我的知识来源"。

---

## 4. 优化方案（按影响/成本分级）

> 每条：**问题 → 改动 → 影响 → 成本 → 涉及文件**。优先级 = 影响÷成本。

### P0 —— 信息架构与激活（几天，主要是导航/文案/空状态，近零风险）

**P0-1 · Atlas 5 项折叠为 1 项 + 内部 Tab**
- 问题：图集被拆成 5 个同等权重的侧边栏项，用户以为是 5 个功能。
- 改动：侧边栏只留「知识图集」；新建 `AtlasLayout`（顶部 Tab：概览/读物/知识点/图谱/建议/搜索），现有页面塞进对应 Tab。
- 影响：🟢🟢🟢 认知负荷断崖下降，"图集是一个东西"立刻成立。
- 成本：🟢 低（路由 + 布局壳）。
- 文件：`components/layout/Sidebar.tsx:71-87`、新增 `pages/atlas/AtlasLayout.tsx`、`App.tsx:136-147` 路由收拢。

**P0-2 · 把 Reader/读物 提为一等可见入口（修断点①）**
- 问题：整个价值起点（Reader）没有任何 Atlas 内入口，只能从别的模块摸进去。
- 改动：新增「读物」Tab——列出已有 Carrier + 一个醒目「+ 添加读物」（网页快照 / 上传 PDF / 选一篇笔记 / 粘贴文本），直接进 Reader。
- 影响：🟢🟢🟢 这是激活漏斗最致命断点的正解。
- 成本：🟡 中（一个列表页 + 复用现有 `ensure*Carrier` 服务）。
- 文件：新增 `pages/atlas/ReadingsPage.tsx`，复用 `atlasService.ensure*Carrier` / `fetchWebClip`。

**P0-3 · 清理 INTELLIGENCE 噪音项**
- 问题：模型中心/全局价格/搜索配置/数据分析是配置与分析，挤占知识工作菜单。
- 改动：移到 SYSTEM 或新「配置」分组；数据分析归 OVERVIEW/SYSTEM。
- 影响：🟢🟢 菜单从 14→~5 有意义项。
- 成本：🟢 极低（纯 nav 配置）。
- 文件：`components/layout/Sidebar.tsx`。

**P0-4 · 空状态：从"谎言"改"真 CTA"**
- 问题：`/atlas/kps` 空状态无 CTA；`/atlas/graph` 写"直接创建"却无按钮——撞墙。
- 改动：每个空状态都给一个真实下一步按钮：「从一篇读物开始 →」打开 P0-2 的添加读物流。
- 影响：🟢🟢🟢 把死路改成入口。
- 成本：🟢 低。
- 文件：`KnowledgePointsPage.tsx:184`、`AtlasGraphPage.tsx:858`、`SuggestionsPage.tsx:159`。

**P0-5 · 去术语化 + 删内部代号**
- 问题：`P2-02`、`Phase 3 后期`、`provenance`、`relation density`、`orphan KP`、`evidence coverage`、`typed relation` 直接泄漏给用户。
- 改动：用户文案换人话（知识点/关系/出处/证据覆盖率…），内部代号一律删；指标卡加一行 hover 解释。
- 影响：🟢🟢 专业感与可理解性。
- 成本：🟢 低（纯文案）。
- 文件：`KnowledgePointPage.tsx:570`、`SuggestionsPage.tsx:159`、`AtlasPage.tsx` 指标卡。

**P0-6 · Hub 顶部 60 秒 onboarding 条**
- 问题：全产品 0 onboarding / tour / 统一叙事。
- 改动：概览顶部一条「读 → 标 → 联 → 问」四步引导卡，每步可点（首跑高亮"添加读物"）；可关闭、记住状态。
- 影响：🟢🟢🟢 第一次回答"这是什么、从哪开始"。
- 成本：🟡 中。
- 文件：`AtlasPage.tsx` 顶部 + 一个 `localStorage` 标志。

### P1 —— 闭环与 AI 摩擦（数周）

**P1-1 · 引导式首跑**：onboarding"试试看"加载一篇示例 carrier 或一键网页快照，让用户 2 分钟内走完一遍读→标→联→问。成本🟡。

**P1-2 · 打开 carrier 自动生成建议（可选开关）+ 批量接受**
- 问题：高亮不触发任何 AI；建议要逐条 accept（无批量端点）；inbox 默认空。
- 改动：carrier 首次打开/保存后自动跑一次 claim extract（可关）；收件箱加"全选接受/按类型接受"。
- 影响：🟢🟢🟢 这是"功能有了无法应用"的 AI 侧正解。
- 成本：🟡🟡 中（前端批量 + 后端批量 accept 端点）。
- 文件：`*ReaderPage.tsx` 的 generate 触发、`SuggestionsPage.tsx`、`suggestion_handler.go` 加 batch-accept。

**P1-3 · "建议全部关系"一次性 pass**：今天 `generateRelationSuggestion` 一次只算一对 KP。加一个对某 carrier/某批 KP 的"建议所有关系"。成本🟡🟡。

**P1-4 · 前向交接（forward handoffs）**：补齐缺失的正向通道——笔记页加「加入知识库 / 问灵境」；灵境答案加「存为笔记 / 提为 KP」。让孤岛之间能正向流动，而不只反向 pull。成本🟡🟡。

**P1-5 · KB↔Atlas 打通**：KB 文档可在 Atlas Reader 打开标注；灵境侧把 KB 与 Atlas 统一呈现为"我的知识来源"。成本🟡🟡🟡。

**P1-6 · 修死链与不一致**：web/image/blog/transcript 的 KP→Reader 回链补全；搜索的 annotation 结果加链接；搜索参数 `?q=`/`?keyword=` 统一。成本🟢。
- 文件：`KnowledgePointPage.tsx:933`、`AtlasSearchPage.tsx:237`、`carrierReaderHref.ts`。

### P2 —— 智能纵深（更后）

- **P2-1 多模态自动摄入**：image OCR / transcript STT（补 `image_carrier.go`/`transcript_carrier.go` 的真实抽取）。
- **P2-2 自动建图**：KP 向量召回并入灵境；图谱聚类、缺口提示（"这块知识你只读了一半"）。
- **P2-3 真 LLM 默认可用**：确保 Atlas task routing 凭证在部署里默认配好（否则用户只见启发式 stub，误判"AI 很蠢"）。`migration 000072` 已 seed 路由，但 `atlas-user-guide.md:192` 自认"生产仍需配置 Atlas 路由凭证"。

---

## 5. 怎么知道改对了（成功指标）

**激活（Activation）—— 唯一最重要指标：**
> **新用户在首个会话内到达"第一个 KP"的比例。**
> 进阶 Aha 时刻：**第一次灵境引用了你自己的知识点作答**——那一刻用户才真正"懂了这是什么"。

**漏斗逐级转化（埋点）：**
```
进入知识图集 → 添加首篇读物 → 首条标注 → 首个 KP → 首条关系/看到图 → 首次基于个人知识的 AI 提问
```
P0 主攻"添加首篇读物"那一跳的转化（今天≈0，因为入口隐形）。

**留存/深度：** 周活跃标注数、图谱节点/边增长、"基于个人知识"的灵境提问占比。

---

## 6. 建议的下一步

1. **先评审本方案的北极星与 IA（§3）**——这是其余一切的地基，定了再动手。
2. **P0 六件事可以立刻开干**：几乎全是导航/文案/空状态，风险极低、影响极高，做完产品立刻"看起来像一个能力"。
3. P1 进入真正的闭环与 AI 摩擦优化，需要少量后端（批量 accept、关系 pass、前向交接、KB↔Atlas 桥）。

> 我可以直接开始落地 P0（侧边栏收敛 + Atlas Tab 壳 + 读物入口 + 空状态 CTA + 去术语化 + onboarding 条），按 `--gateway` 起服务自验。要不要我现在就动 P0？

---

## 7. 实施记录（2026-06-09，branch `codex/atlas-intelligence-redesign`）

本轮已落地 **全部 P0 + 大部分高价值/低风险 P1**，全链路 `--gateway` 自验通过。

**已完成：**

| 项 | 状态 | 关键产出 |
| --- | --- | --- |
| P0-1 IA 收敛 | ✅ | `AtlasLayout.tsx`（Tab 壳）+ `App.tsx` 路由嵌套；Reader/KP 详情保持深页 |
| P0-2 读物入口 | ✅ | 后端 `GET /atlas/carriers`（`CarrierRepo.List`+`CarrierHandler.List`）+ `atlasService.listCarriers` + `ReadingsPage.tsx` + `AddReadingDialog.tsx`（网页快照/粘贴文本冷启动） |
| P0-3 Sidebar 清噪 | ✅ | INTELLIGENCE 14→6；新 `PLATFORM` 组；数据分析归 OVERVIEW |
| P0-4 空状态真 CTA | ✅ | KP 列表 / 图谱 / 建议三处空态改为「添加读物 / 导入 / 去生成建议」 |
| P0-5 去术语化 | ✅ | `atlasLabels.ts` 统一枚举翻译；清除 P2-02 / Phase 3 / 红线 C3-1 / provenance / relation density 等黑话 |
| P0-6 onboarding | ✅ | 概览顶部「读→标→联→问」可关闭引导条（首步加读物、末步跳灵境） |
| P1 批量采纳 | ✅ | 建议收件箱「全部采纳」（KP 先于关系、串行避免事务竞争） |
| P1 死链修复 | ✅ | 证据回链扩展到 web/blog/transcript/image；搜索「标注」结果可跳 Reader |
| P1 闭环可达 | ✅ | 概览 + KP 详情新增「问灵境」入口（Atlas→灵境此前无任何链接） |

**验证：** admin `typecheck` 0 error · `build` 通过 · `go build`/`vet`/handler 单测通过 · `design-system:check` 0 error · `./start.sh --gateway` 全服务健康；`GET /atlas/carriers` 鉴权后 200、39 条载体、scope/type/limit 过滤正确。

**仍待办（需跨模块改动或成本控制，留作下一轮）：**

- **「建议全部关系」一次性 pass**：当前 `generateRelationSuggestion` 一次只算一对 KP。需后端按 carrier/批 KP 聚合 + 成本上限（O(n²) 要可控），不宜半成品上线。
- **KB ↔ Atlas 桥**：让 KB 文档可在 Atlas Reader 打开标注，并在灵境侧统一呈现「我的知识来源」。
- **Notes → KB / 灵境 前向交接**：笔记页加「加入知识库 / 问灵境」；灵境答案「存为笔记 / 提为知识点」（触及 Notes/AetherHub 模块）。
- **P2 多模态**：image OCR / transcript STT 真实抽取；KP 向量召回并入灵境；图谱智能（聚类 / 缺口提示）。
- **真 LLM 默认可用**：确保 Atlas task routing 凭证在部署默认配好，否则用户只见启发式 stub（`migration 000072` 已 seed 路由，`atlas-user-guide.md:192` 自认生产仍需配置凭证）。

---

### 附：本方案的证据索引（便于落地核对）

- 侧边栏 14 项 / Atlas 拆 5 项：`apps/admin/src/components/layout/Sidebar.tsx:71-87`
- Atlas 路由全集（含 6 个无入口 Reader）：`apps/admin/src/App.tsx:136-147`
- 空状态"谎言"：`KnowledgePointsPage.tsx:184`、`AtlasGraphPage.tsx:858`、`SuggestionsPage.tsx:159`
- 术语/代号泄漏：`KnowledgePointPage.tsx:570`、`AtlasPage.tsx`（指标卡）
- 冷启动入口在别的模块：`pages/notes/CreateNotePage.tsx:264`、`pages/media/components/MediaDetail.tsx:233`、`pages/posts/AiWritingWorkspacePage.tsx:439`
- KP→Reader 回链仅 note/pdf 可解析：`KnowledgePointPage.tsx:933`
- AI 真/假取决于配置：`apps/ai-service/app/api/routes/atlas.py:497,718,881`
- 无自动触发、逐条 accept、关系逐对：`suggestion_handler.go`、`*ReaderPage.tsx`（button-only）
- 多模态缺口：`internal/knowledge/service/image_carrier.go:34`、`transcript_carrier.go:31`
- KB↔Atlas 无连接、4 孤岛、无 onboarding：`AetherHubWorkspacePage.tsx:802-803,3860,4035`、KB/Notes 页无前向 handoff
