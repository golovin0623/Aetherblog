# Cowork 模式产品路线（Active Sidekick）

状态：设计冻结（Design Frozen） · 开发未启动
更新时间：2026-05-05
关联文档：[`README.md`](./README.md)（三模式总定位）· [`CODE_ROADMAP.md`](./CODE_ROADMAP.md)

---

## 1 · 目标与定位

### 1.1 一句话定位

**Cowork 是 AetherBlog 的主动型副手** —— 它不再等用户来问，而是按用户预先配置的节奏与主题，**在后台异步运行多工具任务**，把成果以通知 / 草稿 / 图集形式推送回用户。

### 1.2 与 Chat 的本质区别

| 维度 | Chat | Cowork |
| --- | --- | --- |
| 触发方式 | 用户实时打字 | 定时 / 事件 / 一次性预约 |
| 执行时长 | 秒级（一次 LLM 调用） | 分钟级（多工具串联） |
| 工具调用 | 仅注入静态上下文 | 动态调度多工具（KB / Web / 图片生成 / 合成） |
| 输出形态 | SSE 流回当前会话 | 落 `notifications` 表 + 推送 + 草稿 / 图片附件 |
| 用户在场 | 必须在 workspace | 不在线也能跑 |
| 可重复性 | 不持久 | 任务模板可保存复用 |

### 1.3 非目标（明确不做）

- ❌ **不做自由工作流编排**：那是 Code 模式的边界。Cowork 只暴露"高层任务模板"（topic_brief、article_audit、image_compose 等），底层节点编排隐藏。
- ❌ **不做实时多轮对话**：Cowork 的 run 是单向 fire-and-forget，输出落通知，不接受用户中途干预（v1）；中途干预属于 Code 模式的"调试器"功能。
- ❌ **不替代博客发布流程**：即便 Cowork 生成了完整草稿，也只能落到 drafts，发布需要用户手动 confirm。

---

## 2 · 用户画像与场景

### 2.1 核心用户画像

| Persona | 关键诉求 |
| --- | --- |
| **博客作者（高频写作）** | "每天给我一份本周关注主题的速览，最好顺便起好标题" |
| **研究型读者（追主题）** | "持续追踪 AI 安全方向的新论文，有重要更新就推送" |
| **内容运营（站点管理）** | "每周一帮我盘点上周流量 / 评论 / 标签，给优化建议" |
| **业余探索者（创意找灵感）** | "我不知道想写什么，给我推几个跨领域选题 + 配图" |

### 2.2 用户故事（user stories）

#### Story 1 · 工作日早间速览
> **作为** 博客作者
> **我希望** 每个工作日 9:00 自动收到一份"AI 行业近 24 小时关键动态"摘要，包含 5 条要点 + 各自来源链接 + 一段我自己博客近期相关文章的回顾
> **以便** 把零散的浏览成本压缩到 5 分钟之内决定今天写什么

涉及工具：`kb_search`（站内回顾）+ `web_fetch_news`（行业动态）+ 模型综合

#### Story 2 · 主题持续追踪
> **作为** 关注 AI 安全的研究型读者
> **我希望** 给"AI Alignment"这个主题挂一个持续监测任务，arxiv 上有新论文 / 重要博客有新文章时就推送给我
> **以便** 不必每周手动刷一遍各种 RSS

涉及工具：`web_fetch`（指定信息源）+ `kb_semantic_search`（与已读对比去重）+ 模型评估重要性

#### Story 3 · 草稿配图
> **作为** 写完一篇 markdown 草稿的用户
> **我希望** 让 Cowork 根据草稿要点生成 3 张候选封面图
> **以便** 不必离开 workspace 就能挑封面

涉及工具：`kb_get_post`（读草稿）+ `image_generate`（DALL·E / SDXL）+ `notification_with_attachments`

#### Story 4 · 异步主题探索
> **作为** 业余探索者
> **我希望** 给 Cowork 一个开放命题"探讨'写作即思考'这件事的当代研究综述"，让它去搜索、阅读、整理，几个小时后告诉我结论
> **以便** 节省自己长时间深读的时间

涉及工具：`web_search` + `web_fetch` + 多轮 LLM 综合 + `notification`

---

## 3 · 核心能力清单

按优先级 P0/P1/P2 分级 —— Phase 2 MVP 只交付 P0；P1 在 Phase 3；P2 视情况进 Phase 4。

| 能力 | 描述 | 优先级 |
| --- | --- | --- |
| 定时任务（cron） | 用户配置 cron 表达式，到点自动跑 | P0 |
| 一次性任务 | 用户提交一个长任务，Cowork 后台跑完推送 | P0 |
| 知识库检索工具 | 调用站内 `kb_search` 获取上下文 | P0 |
| 模型综合 | 调用 ai-service LLM，按 task 类型用不同 prompt | P0 |
| 站内通知 inbox | sidebar 加 bell + 列表 + 已读未读 | P0 |
| 任务管理 UI | 创建 / 编辑 / 暂停 / 归档 | P0 |
| 任务执行历史 | 看每次 run 的输入输出 + 错误 | P0 |
| Web 抓取工具 | 给定 URL 抓正文 | P1 |
| Web 搜索工具 | 关键词 / 语义搜索 | P1 |
| 图片生成工具 | 多 provider（OpenAI / SD / 通义万相） | P1 |
| 草稿生成 | 输出可直接落入 `posts` drafts | P1 |
| 事件触发任务 | 当用户写完草稿 / 编辑文章时自动触发 | P1 |
| 邮件推送 | 通过 SMTP 把通知抄送邮箱 | P2 |
| 桌面推送 | Web Push API（支持 PWA 安装后） | P2 |
| 任务模板市场 | 用户共享自己保存的任务配方 | P2 |
| 多代理协作 | 一个任务里多个角色 Agent 协作（researcher / writer / critic） | P2 |
| 预算控制 | 每用户每日 token 配额 + 超额拒绝 | P0（安全相关，必须） |
| 内容安全过滤 | 图片生成 prompt 过滤、抓取链接白名单 | P0（安全相关） |

---

## 4 · 数据模型

> 列出来的 schema 是 Phase 1 的目标 —— 不必一次到位，但建表时要考虑 P1/P2 的预留字段。

### 4.1 `cowork_tasks` —— 任务定义

```sql
CREATE TABLE cowork_tasks (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title           VARCHAR(120) NOT NULL,
  description     TEXT,
  topic_prompt    TEXT NOT NULL,                 -- 给 LLM 的目标描述

  -- 触发策略
  trigger_type    VARCHAR(20) NOT NULL,          -- 'recurring' | 'one_shot' | 'event'
  schedule_cron   VARCHAR(64),                   -- recurring 时填，UTC 解析
  event_filter    JSONB,                         -- event 时填（哪类事件触发）

  -- 执行配置
  task_type       VARCHAR(40) NOT NULL,          -- 'topic_brief' | 'article_audit' | 'image_compose' | 'topic_explore'
  tool_set        TEXT[] NOT NULL DEFAULT '{}',  -- 允许调用的工具白名单
  model_id        VARCHAR(64),                   -- 默认按用户路由，可覆盖
  output_format   VARCHAR(20) NOT NULL,          -- 'notification_md' | 'post_draft' | 'image_set'

  -- 状态
  status          VARCHAR(16) NOT NULL DEFAULT 'active',  -- 'active' | 'paused' | 'archived'
  next_run_at     TIMESTAMPTZ,                            -- 调度器读这个字段
  last_run_at     TIMESTAMPTZ,
  last_run_status VARCHAR(16),

  -- 配额
  max_runs_per_day INT NOT NULL DEFAULT 4,
  max_tokens_per_run INT NOT NULL DEFAULT 8000,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cowork_tasks_user_status ON cowork_tasks(user_id, status);
CREATE INDEX idx_cowork_tasks_next_run    ON cowork_tasks(next_run_at) WHERE status = 'active';
```

### 4.2 `cowork_runs` —— 执行历史

```sql
CREATE TABLE cowork_runs (
  id              BIGSERIAL PRIMARY KEY,
  task_id         BIGINT NOT NULL REFERENCES cowork_tasks(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- 冗余，便于按用户查

  status          VARCHAR(16) NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'failed' | 'cancelled' | 'budget_exceeded'
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INT,

  -- 输入快照（任务可能在 run 之后被编辑，这里固化当时的配置）
  input_snapshot  JSONB NOT NULL,

  -- 工具调用 trace
  tool_calls      JSONB NOT NULL DEFAULT '[]',

  -- LLM 用量
  prompt_tokens   INT,
  completion_tokens INT,
  total_cost_usd  NUMERIC(10, 6),

  -- 输出
  output_md       TEXT,
  output_artifacts JSONB,                        -- {images: [{url, prompt, ...}], drafts: [{post_id, ...}]}

  error_message   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cowork_runs_task ON cowork_runs(task_id, started_at DESC);
CREATE INDEX idx_cowork_runs_user ON cowork_runs(user_id, started_at DESC);
```

### 4.3 `notifications` —— 用户通知 inbox

```sql
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  source      VARCHAR(24) NOT NULL,             -- 'cowork_run' | 'system' | 'agent_workflow'
  source_ref  BIGINT,                           -- e.g. cowork_runs.id

  title       VARCHAR(200) NOT NULL,
  summary     VARCHAR(400),
  body_md     TEXT,
  artifacts   JSONB,                            -- 与 cowork_runs.output_artifacts 同形

  severity    VARCHAR(8) NOT NULL DEFAULT 'info',  -- 'info' | 'success' | 'warn' | 'danger'

  read_at     TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notif_user        ON notifications(user_id, created_at DESC);
```

### 4.4 `cowork_subscriptions` —— 推送通道偏好（P2）

```sql
CREATE TABLE cowork_subscriptions (
  user_id       BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  in_site_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  email_digest    VARCHAR(16) NOT NULL DEFAULT 'realtime',  -- 'realtime' | 'daily_digest'
  push_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  push_endpoint   TEXT,                                     -- Web Push API endpoint

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 5 · API 设计（外部）

> 路径前缀 `/api/v1/agent/cowork/*`，鉴权同 Agent 主链路（JWT，任意已注册用户）。
> 所有写操作走 Go 后端校验 + RBAC，再透传到 ai-service 执行。

### 5.1 任务 CRUD

```
POST   /api/v1/agent/cowork/tasks
       body: { title, description, topic_prompt, trigger_type, schedule_cron?, task_type, tool_set, output_format }
       resp: { id, ...full record }

GET    /api/v1/agent/cowork/tasks?status=active&limit=20
       resp: { items: [...], total }

GET    /api/v1/agent/cowork/tasks/:id
       resp: { ...full record, last_run: {...} }

PATCH  /api/v1/agent/cowork/tasks/:id
       body: { ...partial update; status='paused' 用于暂停 }

DELETE /api/v1/agent/cowork/tasks/:id     (soft archive)
```

### 5.2 任务运行控制

```
POST   /api/v1/agent/cowork/tasks/:id/runs        (manual trigger)
       resp: { run_id }

GET    /api/v1/agent/cowork/tasks/:id/runs?limit=20
       resp: { items: [{id, status, started_at, ...}], total }

GET    /api/v1/agent/cowork/runs/:id              (run detail，含 tool_calls trace)

POST   /api/v1/agent/cowork/runs/:id/cancel       (only if status='running')
```

### 5.3 通知 inbox

```
GET    /api/v1/agent/notifications?unread_only=true&limit=30
       resp: { items, unread_count, total }

POST   /api/v1/agent/notifications/:id/read
POST   /api/v1/agent/notifications/read-all
DELETE /api/v1/agent/notifications/:id            (archive)
```

### 5.4 推送通道偏好（P2）

```
GET    /api/v1/agent/cowork/subscription
PATCH  /api/v1/agent/cowork/subscription
POST   /api/v1/agent/cowork/subscription/web-push    (注册 Push API endpoint)
```

### 5.5 内部 API（ai-service）

```
POST /internal/cowork/run
     headers: X-Internal-Service, X-Forwarded-User-ID
     body: { run_id, task_snapshot }
     # 同步执行任务（在 worker 进程内调用），完成后写 cowork_runs / notifications
```

---

## 6 · 架构

```
┌──────────────┐                   ┌──────────────┐                ┌────────────────────┐
│  Workspace   │  REST + WebSocket │  Go Backend  │   gRPC / HTTP  │   ai-service       │
│  Inbox UI    │ ◀────────────────▶│  agent_      │ ───────────▶  │   /internal/cowork │
│  Tasks UI    │                   │  cowork.go   │                │   /run             │
└──────────────┘                   └──────┬───────┘                └─────────┬──────────┘
                                          │                                  │
                                          ▼                                  ▼
                                   ┌──────────────┐                 ┌────────────────┐
                                   │  Postgres    │                 │ Tool Orches-   │
                                   │  cowork_*    │                 │ trator         │
                                   │  notifs      │                 │  ┌──────────┐  │
                                   └──────┬───────┘                 │  │ kb_*     │  │
                                          │                         │  │ web_*    │  │
                                          ▼                         │  │ image_*  │  │
                                   ┌──────────────┐                 │  └──────────┘  │
                                   │ Scheduler    │  due tasks      └────────┬───────┘
                                   │ Worker (Go)  │ ───────────▶            │
                                   │ poll 30s     │                          ▼
                                   └──────────────┘                   ┌──────────────┐
                                                                      │  LiteLLM     │
                                                                      │  ai-providers│
                                                                      └──────────────┘
```

### 6.1 关键架构决策

1. **调度器在 Go 后端，不在 ai-service**
   - ai-service 是无状态多副本的，跑长任务会让某副本被卡死；调度器跑在 Go 单实例上，DB 持有真相状态。
   - 调度器是简单的 30s ticker + `SELECT ... WHERE next_run_at <= NOW() AND status='active' FOR UPDATE SKIP LOCKED LIMIT 10`，多 Go 副本并存时也安全。

2. **任务执行在 ai-service**
   - 复用现有 LiteLLM / RAG / 工具编排能力，避免在 Go 重写一套。
   - Go 调度器 → 异步 HTTP POST `/internal/cowork/run` 给 ai-service，ai-service 内部排队执行（有 max concurrent 限制）。

3. **通知通道**
   - Phase 2：前端 30s 长轮询 `/api/v1/agent/notifications?since=<lastSeen>`；够用、不引入 WebSocket 成本。
   - Phase 3+：升级 WebSocket（Echo 已有相关能力）。
   - Phase 4：Web Push API，需要 PWA + service worker。

4. **配额机制**
   - 每个 task 有 `max_runs_per_day` + `max_tokens_per_run`；
   - 全局有 `cowork_user_daily_budget`（系统配置）；
   - 超额时 run 状态置 `budget_exceeded` + 写一条提示通知。

---

## 7 · UI / UX 形态草图

### 7.1 Workspace · 切到 Cowork 模式

```
┌────────────────────────────────────────────────┐
│ [Chat] [▣Cowork] [Code]            ☰ Settings  │
├────────────────────────────────────────────────┤
│ My Tasks                          + New Task   │
│ ┌──────────────────────────────────────────┐   │
│ │ AI Industry Daily Brief    🟢 Active     │   │
│ │ cron: 0 9 * * 1-5                        │   │
│ │ next run: tomorrow 09:00                 │   │
│ │ last run: today 09:00 ✓ (12s, 1.2k tok)  │   │
│ └──────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────┐   │
│ │ AI Safety Topic Tracker     🟡 Paused    │   │
│ │ trigger: weekly                          │   │
│ └──────────────────────────────────────────┘   │
└────────────────────────────────────────────────┘
```

### 7.2 任务详情 / 编辑

简洁单页：标题 / 描述 / 触发器（cron 文本框 + 自然语言提示）/ 任务类型下拉 / 工具勾选 / 输出形式 / 模型选择 / 配额。

### 7.3 通知 inbox

侧栏底部 bell icon → 抽屉 / 弹层显示通知列表，点击通知打开"详情" panel（标题 / 摘要 / 完整 markdown body / 附件预览 / 来源 task 链接）。

---

## 8 · 实施阶段（Milestones）

### Phase 1 — 骨架（约 1 周）
**交付物**：
- DB migrations：`cowork_tasks` / `cowork_runs` / `notifications` 三张表
- Go 后端：`agent_cowork.go` handler，CRUD endpoints（不带执行）
- 前端：Cowork 模式 workspace 页面（任务列表 + 创建 form），但所有"运行"按钮置灰显示 "Coming Soon"
- inbox 占位（空列表）
- ai-service：`/internal/cowork/run` 占位，POST 进来直接返回 `{status: 'not_implemented'}`

**完成标志**：用户可以创建一个 task 草稿，但点击 "Run Now" 弹出"Cowork 引擎将在下个版本上线"。

### Phase 2 — MVP 执行（约 2 周）
**交付物**：
- Go 调度器 worker：30s 轮询 `next_run_at` due 的任务并 dispatch
- ai-service 任务执行器：单一任务类型 `topic_brief`（kb_search → LLM 综合）
- `notifications` 真正写入 + 前端长轮询 inbox
- 配额检查（每用户每日 token 上限）

**完成标志**：用户可以创建一个 cron 任务"每天 9:00 给我一份站内已发布文章的本周 hot tags 摘要"，第二天 9:01 看到 inbox 有新通知。

### Phase 3 — 工具扩展（约 2-3 周）
**交付物**：
- `web_fetch` 工具（headless 抓取或代理 jsdom）
- `image_generate` 工具（接 ai-service 现有图片 provider）
- `topic_explore` 任务类型（多步研究综合）
- 草稿落地：output_format='post_draft' 时把 markdown 写入 posts (status=DRAFT)
- 事件触发任务（用户写完文章 → 触发 `article_audit`）

### Phase 4 — 推送 / 模板 / 协作（约 2 周）
**交付物**：
- WebSocket 替换长轮询
- 邮件通道（SMTP）
- Web Push（PWA 后续，先框架）
- 任务模板市场（用户保存配方 + 公开分享）

### Phase 5 — 多代理 / 高级编排（不限期）
**交付物**：
- 单任务内多角色 Agent（researcher / writer / critic）
- 任务间编排（任务 A 完成触发任务 B）
- 此时 Cowork 与 Code 模式开始有共享底层引擎的需求 → 跨模式重构。

---

## 9 · 风险与未知项

### 9.1 调度器可靠性
- **风险**：Go 进程重启 / 崩溃时 in-memory 状态丢失。
- **缓解**：所有调度状态写 `cowork_tasks.next_run_at`；进程启动时一律从 DB 重建 schedule；`FOR UPDATE SKIP LOCKED` 保证多副本时不重跑。

### 9.2 Token 成本失控
- **风险**：用户配置 cron 5 分钟一次 + 长任务，月底账单爆炸。
- **缓解**：硬限 `max_runs_per_day` + 每日 token budget + 全局速率（admin 后台可调）+ 触发 budget_exceeded 时写通知给用户。

### 9.3 图片生成滥用 / 内容安全
- **风险**：用户把 image_generate 当 NSFW 图片工厂。
- **缓解**：调用前先经 OpenAI Moderations / 自家分类器；prompt 命中黑名单关键词直接拒绝；保留所有生成记录（admin 可审计）。

### 9.4 抓取 Web 内容的合规
- **风险**：抓任意 URL 涉及 robots.txt / 版权 / 防火墙穿透。
- **缓解**：维护抓取白名单（arxiv / GitHub / 用户预先 register 的域名）；对外抓取明示来源；遵守 robots.txt。

### 9.5 通知疲劳
- **风险**：用户配置过多 cron，inbox 爆满 → 干脆不看。
- **缓解**：默认 daily_digest 模式（同主题合并），realtime 须 opt-in；UI 上"今日已有 X 条新通知"统一计数。

### 9.6 任务执行慢导致占用模型 quota
- **风险**：长任务跑 30 分钟，期间用户 Chat 模式被同 provider 速率限流。
- **缓解**：Cowork 任务用独立的 ai-service 副本（`--scale ai-service=8` 中分 2 个标记 `--label=cowork`）；或为 Cowork 走低优先级队列，Chat 优先抢。

---

## 10 · 验收标准（Phase 2 MVP）

完成 Phase 2 必须同时满足：

- [ ] 用户可以在 workspace Cowork 模式创建定时任务，cron 表达式校验通过；
- [ ] 任务到点自动跑，30 分钟内完成（`topic_brief` 类型）；
- [ ] 任务结果以 markdown 形式落 `notifications` 表；
- [ ] 前端 inbox 在 1 分钟内能拿到新通知（长轮询）；
- [ ] 任务历史可查看（最近 20 次 run，含状态、耗时、token 用量）；
- [ ] 单任务超 `max_tokens_per_run` 时被截断且记录 `budget_exceeded`；
- [ ] 在 1000 个并发 active task 的压测下，调度器不漏跑（误差 ≤ 60s）；
- [ ] 文档：`docs/agent/COWORK_ROADMAP.md` 的 Phase 2 段落更新为 Done，附验证报告链接。

---

## 11 · 不在本路线内的相关工作

下面这些虽然与 Cowork 强相关，但出于范围控制不放在本路线内，单独立项：

- 系统级通知中心（用于 Cowork 之外的 system / agent_workflow 类通知）→ 专项立项 `notification-center-v1`
- AI 图片生成多 provider 接入 → 现有 `AI_MODULE_PLAN_V2.md` 已有占位，按其节奏推进
- PWA / Web Push 基础设施 → 专项立项 `pwa-foundation-v1`

---

## 附录 A · 任务类型规范（Phase 2 起逐步落地）

| task_type | 输入 | 工具链 | 输出 |
| --- | --- | --- | --- |
| `topic_brief` | topic_prompt | kb_search → LLM | notification_md |
| `article_audit` | post_id | kb_get_post → grammar_check → LLM | notification_md（建议清单） |
| `topic_explore` | topic_prompt | web_search → web_fetch ×N → LLM 综合 | notification_md + sources |
| `image_compose` | post_id 或 prompt | kb_get_post / null → image_generate ×3 | notification_md + image_set |
| `weekly_digest` | scope (tags) | kb_search → LLM | notification_md |
| `event_article_finish` | post_id | kb_get_post → spell_check → LLM 综合 | notification_md |

新增 task_type 的流程：
1. 在 ai-service 加 `_TASK_RUNNERS[task_type]` 函数；
2. 在 `cowork_tasks.task_type` 枚举里加项；
3. 在前端任务创建表单加入对应配置项；
4. 更新本表。
