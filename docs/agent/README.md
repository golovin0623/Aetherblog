# Agent 模块 · 三模式产品定位

状态：定位锁定（Chat 已上线 · Cowork 设计冻结 · Code/Agent Workflow Canvas 全量产品迭代已落地）
更新时间：2026-05-31
负责人：AetherBlog 团队

---

## 1 · 为什么写这份文档

`/agent/workspace` 顶部 segmented control 上有三个标签 —— **Chat / Cowork / Code**。在很长一段时间里，这三个标签**只切换 system prompt 的一行文字**，外观看起来像是三种"对话风格"。这是历史包袱，也是误会的根源。

实际上，它们是**三种功能架构截然不同的子产品**：

| 模式 | 一句话定位 | 在线状态 |
| --- | --- | --- |
| **Chat** | 站点内嵌的轻量问答 Agent。基于已有的文章、标签、设置回答用户的问题 | ✅ 已上线 |
| **Cowork** | 主动副手 —— 定时任务 + 通知推送 + 知识合成的异步助理 | 🚧 设计冻结，开发未开始 |
| **Code / Agent Workflow** | 最底层的 Agent 编排平台 —— 工具注册 + 工作流定义 + 自治执行 | ✅ Canvas-first 产品迭代已落地；真实 KB/LLM/Agent/受限 Code、运行治理与内容入口可用 |

**这一份 `README.md`** 是三模式的总入口与定位文档；下面两份子文档分别给出 Cowork 与 Code 的完整产品路线：

- [`COWORK_ROADMAP.md`](./COWORK_ROADMAP.md) — Cowork 模式产品路线
- [`CODE_ROADMAP.md`](./CODE_ROADMAP.md) — Code 模式产品路线

---

## 2 · 三模式定位（必读，不能再误会成 prompt）

### 2.1 Chat —— 同步问答 Agent

- **形态**：单轮 / 多轮同步对话，SSE 流式输出。
- **能力边界**：只读站点知识库（articles / tags），引用 @ 文章 / # 标签注入上下文，调用一次模型就结束。
- **不做什么**：不主动发起任务，不执行写操作，不持久化任何"会话外"的副作用。
- **为什么独立存在**：它是博客访客与作者最常用的入口；体验要求是"开口即答"，不应被 Cowork / Code 的复杂度牵连。

### 2.2 Cowork —— 异步副手

- **形态**：用户预先配置定时 / 触发任务（"每个工作日 9 点给我一份 AI 行业速览"），Cowork 在后台运行、组合多种工具、把成果以 inbox 通知 / 草稿 / 图片集形式推送回用户。
- **核心区别**：从"你问我答"变成"我帮你看着、帮你做、帮你提醒"。无需实时坐在 workspace 前。
- **关键能力**：
  - 定时调度（cron-like）+ 一次性任务 + 事件触发任务；
  - 工具集：知识库检索、Web 抓取、图片生成、合成器；
  - 站内通知 inbox + 可选邮件 / 桌面推送；
  - 任务模板库（用户保存"每周科技综述"这种成功配方）。
- **不做什么**：不自由编排工作流（那是 Code 模式的事），不暴露原子级工具调用。Cowork 给用户的是"高层任务模板"。
- **设计参考**：[`COWORK_ROADMAP.md`](./COWORK_ROADMAP.md)

### 2.3 Code / Agent Workflow —— Agent 编排平台

- **形态**：后台新增独立菜单 **智能体编排**（`/agent-workflows`），以可视化画布作为工作流真相源；Workspace 里的 Code 模式仍保留为未来入口，不再承载首批 authoring UI。
- **核心区别**：从"用预制套餐"变成"自己组装套餐"，开放最底层的 Agent 原语。
- **关键能力**：
  - 工具注册表（builtin + 受控 HTTP / OpenAPI / MCP / Skill connector；代码执行必须走独立 sandbox-worker）；
  - 工作流定义：固定 DAG / 自治模式 / 混合，Canvas JSON 是当前数据库真相源；
  - 工作流执行引擎：节点级 trace、断点暂停、变量替换、分支与循环；
  - 工作流版本化、保存为模板、发布为 slug 并通过 runtime API 复用；
  - 调试器：在任意节点暂停、改输入、续跑。
- **不做什么**：不替代 Cowork 的"高层任务模板" —— Code 是"原料库 + 灶台"，Cowork 是"预制菜单"。两者并存，互不替代。
- **设计参考**：[`CODE_ROADMAP.md`](./CODE_ROADMAP.md)

---

## 3 · 三模式之间的关系

```
                    用户感知层级（从轻到重）
   ┌──────────┐    ┌──────────────┐    ┌──────────────────┐
   │  Chat    │ →  │   Cowork     │ →  │      Code        │
   │ "问一句" │    │ "托管一件事" │    │ "编排一类事"     │
   └──────────┘    └──────────────┘    └──────────────────┘
        │                  │                      │
        │                  │                      │
   同步 LLM 调用      异步任务 + 推送        工作流引擎 + 工具注册
```

- **Chat 是入口**：90% 的访客只用 Chat。
- **Cowork 是高频复用层**：用户发现自己每天都在重复某种任务，把它"托管"给 Cowork。
- **Code 是创造层**：高级用户给 Cowork 创造新的"任务模板"，或为 Chat 扩展工具能力。

三者共享：
- 同一套用户身份 / 鉴权；
- 同一套 AI provider 路由（`ai_models` + `ai_credentials`）；
- 同一份知识库（`posts` + `pgvector`）；
- 同一套通知通道（一旦 Cowork 把 `notifications` 表建好，Code 模式的工作流也可以推通知）。

---

## 4 · 当前状态与开放计划

| 模块 | 状态 | 时间 |
| --- | --- | --- |
| Chat | ✅ 已上线 | 2026-04 |
| Cowork — 设计文档 | ✅ 完成（本批） | 2026-05-05 |
| Cowork — Phase 1 骨架（DB + API stub + 锁定 UI） | ⏸ 暂缓 | 视优先级 |
| Cowork — Phase 2 MVP 执行（调度器 + 一种工具 + 通知） | ⏸ 暂缓 | Phase 1 完成后启动 |
| Code — 设计文档 | ✅ 完成并按 Canvas-first 修订 | 2026-05-12 |
| Agent Workflow — Phase 0/1 Canvas 骨架 | ✅ MVP 可验收 | 后台 `/agent-workflows`、Go CRUD、迁移、工具目录、发布入口 |
| Agent Workflow — Phase 2 DAG 执行器 | ✅ 可用 MVP | ai-service deterministic runner、真实 KB/LLM/Agent/受限 Code、分支/循环/trace；未接入 executor 会显式失败 |
| Agent Workflow — Phase 2.1 诚实化 | ✅ 已落地 | 后台 capabilities API、运行模式切换、run `simulated` 持久标记、静态绿盾改为状态驱动徽标 |
| Agent Workflow — Phase 3+ 治理 / Schedule / Sandbox | ✅ 基础边界已落地，待硬化 | tool/agent/schedule/variable CRUD、publication origin/rate/input schema、预算、审批暂停、模板、版本、导入导出、canonicalize；独立 sandbox-worker / 动态 scheduler daemon / 团队协作待专项 |
| Agent Workflow — 内容业务入口 | ✅ 已落地 | 文章 AI 写作页 Article Audit、AetherHub Chat `/audit <post_id>` 调用 published workflow |

**Workspace UI 当前处理**：
- ModeSwitch 上 Cowork / Code 两个按钮加 `Soon` 徽标；
- 点击不切换 mode，而是弹出说明卡（含定位简述 + 链接到本目录文档）；
- `agent_mode` 字段保留但 Workspace 实际请求时强制按 `chat` 走，避免误用。

---

## 5 · 文档维护规则

本目录下的三份文档位置：

```
docs/agent/
├── README.md            ← 本文（三模式总定位，必读）
├── COWORK_ROADMAP.md    ← Cowork 模式产品路线
└── CODE_ROADMAP.md      ← Code 模式产品路线
```

更新触发：
- 当 Cowork / Code 模式的实施阶段推进（Phase 1 → 2 → 3）时，**必须**同步对应文档的"实施状态"段落。
- 当模式定位调整（例如 Cowork 决定纳入"自由工作流编排"能力）时，**必须**先修 README，再连带修两份子文档，避免定位漂移。
- 红线：禁止在不更新文档的情况下，直接动 `_MODE_SYSTEM_PROMPTS` 或 ModeSwitch 的 OPTIONS 数组。

CLAUDE.md §6.1 已加触发器条目：「修改 Agent 模式定位 / 实施阶段 → 必须更新 docs/agent/*.md」。
