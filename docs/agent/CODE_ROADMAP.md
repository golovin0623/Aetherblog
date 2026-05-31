# Code 模式产品路线（Agent Orchestration Platform）

状态：Canvas-first 全量产品迭代已落地；后续进入 sandbox-worker / 团队协作 / scheduler daemon 硬化
更新时间：2026-05-31
关联文档：[`README.md`](./README.md)（三模式总定位）· [`COWORK_ROADMAP.md`](./COWORK_ROADMAP.md)

---

## 1 · 目标与定位

### 1.1 一句话定位

**Code 是 AetherBlog 最底层的 Agent 编排平台**。它对用户开放原子级原语：**工具（Tools）**、**模型调用（Model Calls）**、**控制流（Branch / Loop）**，让用户像写"剧本"一样定义工作流（fixed），也支持"主代理自由发挥"（autonomous），中间地带还有"主代理在受限工具集内编排"（hybrid）。

### 1.2 与 Chat / Cowork 的本质区别

| 维度 | Chat | Cowork | Code |
| --- | --- | --- | --- |
| 用户控制粒度 | 单次对话 | 高层任务模板 | 节点级原语 |
| 输出可预测性 | 中（模型决定） | 高（任务模板固化） | 用户决定（fixed 高 / autonomous 低） |
| 学习成本 | ★ | ★★ | ★★★★ |
| 重用粒度 | 不重用 | 任务复用 | 工作流模板 + 工具复用 |
| 自定义程度 | 选择 prompt | 选择 task type | 自由编排 |

### 1.3 设计原则

1. **Canvas 优先**：当前 MVP 以后台 `/agent-workflows` 的 React Flow 画布 JSON 为单一真相来源；YAML/JSON 导入导出可以做，但不再作为数据库第一形态。
2. **工具是平等公民**：builtin / HTTP / OpenAPI / MCP / Skill / sandbox code 用同一套 `agent_tools` + `agent_connectors` 注册表，调用契约一致。
3. **一切可回放**：每个 run 在 `workflow_runs` + `workflow_node_logs` 留完整 trace，调试器可在任何节点暂停 / 改输入 / 续跑。
4. **autonomous 模式可被"固化"**：让主 Agent 自由编排一次，把它走过的路径保存成 fixed workflow 模板 —— 这是 Code 模式的杀手特性。
5. **安全是默认值，不是开关**：自定义 Shell 工具默认禁用；HTTP 工具有 URL 白名单；任意工具 require_approval 后默认要用户确认才执行。

### 1.4 非目标（明确不做）

- ❌ **不替代 Cowork 的"高层任务模板"**：两者并存。Cowork 是预制菜单（用户感受是"任务"），Code 是原料库与灶台（用户感受是"管道"）。
- ❌ **不做无沙箱的代码执行**：v1 / v2 都不允许在主机上跑任意 Shell；如要跑用户脚本，等专项 sandbox（Wasm / firejail / Docker-in-Docker）立项。
- ❌ **不做工作流互信任**：用户 A 的 workflow 不能调用用户 B 的 tool（除非 tool 标记为 public）。

### 1.5 2026-05-12 实施偏移

本路线原先把 Canvas 放在后期 Phase 5。当前实现已根据 `.agent/plans/agent-workflow-canvas-module-plan.md` 提前改为 Canvas-first：

- 后台 authoring 入口是 `apps/admin/src/pages/agent-workflows/AgentWorkflowsPage.tsx`，菜单名为「智能体编排」。
- Go 后端新增 `agent_workflows` authoring API、runtime run API、run history/detail/log 查询、published slug invoke、版本快照、run 和 node log 持久化。
- ai-service 新增 `app/workflows/*` deterministic runner，覆盖 input/output/tool/extractor/branch/loop，并在后续迭代接入真实 KB / LLM / Agent / 受限 Code executor。
- `agent_connectors` / `agent_tools` / `agent_variables` / `agent_schedules` / `agent_publications` 已进入迁移边界；真实 MCP adapter、调度器 daemon、sandbox-worker 属于后续阶段。
- 2026-05-30 追加「诚实化」迭代：后台 `/agent-workflows/capabilities` 暴露真实 LLM/工具/sandbox/scheduler/autonomous 状态；前端默认真实运行并提供显式模拟切换；run 持久化 `simulated`，published slug invoke 强制真实运行，避免把模拟成功误读为真实能力。
- 2026-05-31 追加「全量产品闭环」迭代：Go runtime 增加 async execution、stream/cancel/retry/resume/canonicalize、tool/agent/schedule/variable CRUD、版本/模板/导入导出/指标、publication origin/rate/input schema、预算/脱敏/错误分类；ai-service 接真实 KB、LLM Router、Agent v1、HTTP 工具与受限 Code executor；后台画布增加模板、版本回滚、导出、运行控制与工具测试；文章写作页和 AetherHub Chat `/audit <post_id>` 可直接运行 published Article Audit。

---

## 2 · 用户画像与场景

### 2.1 核心用户画像

| Persona | 关键诉求 |
| --- | --- |
| **博客作者（深度玩家）** | "我想给所有草稿都跑一遍'语法 + 事实核查 + 标题候选生成'三步审计" |
| **开发者用户** | "我想接我自己写的 OCR HTTP 服务到 Agent 里，做截图转文字工作流" |
| **研究人员** | "我有一个固定研究流程：抓 5 篇论文 → 各自摘要 → 综合对比 → 出报告，让我能一键跑" |
| **运营人员** | "每周自动从一组源拉新闻 → 清洗 → 翻译 → 落到草稿，全流程可视化每一步" |
| **教学用户** | "想给学生展示一个 Agent 的完整决策路径，每一步可暂停讲解" |

### 2.2 用户故事

#### Story 1 · 固定工作流：草稿审计
> **作为** 博客作者
> **我希望** 创建一个名为 "Article Audit" 的工作流，输入是 post_id，依次跑 grammar_check（自定义 HTTP tool） → fact_check（kb_search + LLM） → title_brainstorm（LLM）三步，输出一份综合 markdown 报告
> **以便** 写完每篇文章都能一键跑一遍质量审计

#### Story 2 · 自治工作流：开放命题
> **作为** 研究人员
> **我希望** 给主 Agent 一个目标"对比 X、Y、Z 三种 RAG chunking 策略的优劣"，让它自己决定调哪些工具、按什么顺序、写多长报告
> **以便** 不必预先想清楚研究路径

伴随能力：执行结束后系统问"要不要把这次的执行轨迹保存为 workflow 模板？"，用户点保存 → 自动生成 YAML，下次可固化复用。

#### Story 3 · 调试 / 单步执行
> **作为** 工作流作者
> **我希望** 在 grammar_check 节点之后暂停，看它的 raw output，编辑后续 LLM prompt，再续跑后面节点
> **以便** 不必为修一个 prompt 重跑整个工作流（节省 LLM 成本）

#### Story 4 · 工具扩展
> **作为** 开发者用户
> **我希望** 注册一个我自己的 HTTP 工具：`POST https://my-ocr.example.com/extract` 接受 base64 图片，返回 text；让任何 workflow 都能调用
> **以便** 不必把 OCR 逻辑塞进 LLM prompt

---

## 3 · 核心能力清单

| 能力 | 描述 | 优先级 |
| --- | --- | --- |
| 工具注册（builtin） | 内置 kb_search / kb_get_post / text_join / echo；web_search 作为默认禁用的受控 MCP 工具 | P0 |
| 工具注册（HTTP / OpenAPI / MCP / Skill） | Connector registry + JSON Schema args + 审批 / 限流 / 超时策略 | P1 |
| 工具注册（Code sandbox） | 只允许独立 sandbox-worker 执行，主进程不得执行任意代码 | P3 |
| Canvas 工作流定义 | React Flow 画布 JSON + Go 校验器 + ai-service Pydantic schema | P0 |
| YAML / JSON 导入导出 | 作为迁移与可读格式，不作为当前数据库第一真相源 | P2 |
| DAG 执行器 | 拓扑排序，支持模板变量、分支、循环、跳过上游未命中节点 | P0 |
| 输入参数 | 工作流的 inputs 段，运行时填 | P0 |
| 输出参数 | 工作流的 outputs 段 | P0 |
| 节点 trace | 每节点写 input / output / duration / tokens | P0 |
| 运行历史 | workflow_runs 表 + UI 列表 | P0 |
| 工作流 CRUD | 用户私有 + 模板共享 | P0 |
| DAG 拓扑（分支并行） | depends_on 多对多，运行时拓扑排序 | P1 |
| 条件分支节点 | `branch:` 节点 + `when` 表达式 | P1 |
| 循环节点 | `for_each:` 数组遍历，单层 | P1 |
| 调试器 | 节点断点 / 暂停 / 续跑 / 修改输入 | P1 |
| autonomous 模式 | 主 Agent 决定下一步调什么工具 | P2 |
| hybrid 模式 | autonomous 但限定工具集 | P2 |
| run 固化 | 把 autonomous 的执行轨迹保存为 fixed YAML | P2 |
| 工作流版本化 | 编辑保留历史版本，可 rollback | P2 |
| Canvas 编辑器 | 节点画布、属性面板、变量、工具目录、trace 面板 | P0 |
| 工具市场 | 用户共享 HTTP 工具配方 | P3 |
| Shell tool 沙箱 | Wasm / Docker / firejail 执行环境 | P3 |
| 多用户协作 workflow | 工作流多 owner / 团队 | P4 |
| 实时执行 SSE | 节点级 trace 通过 SSE 推前端 | P0 |
| 暂停 / 取消运行 | 长跑工作流可中断 | P0 |
| 配额控制 | 单 run 最大节点数 / 最大 token / 最大耗时 | P0（安全） |

---

## 4 · 数据模型

### 4.1 `agent_tools` —— 工具注册表

```sql
CREATE TABLE agent_tools (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,  -- NULL 表示系统工具

  code            VARCHAR(80) NOT NULL,                   -- 唯一标识，如 'kb_search' / 'my_ocr'
  display_name    VARCHAR(120) NOT NULL,
  description     TEXT,
  category        VARCHAR(40),                            -- 'kb' | 'web' | 'media' | 'code' | 'custom'

  -- 调用契约
  args_schema     JSONB NOT NULL,                         -- JSON Schema for inputs
  output_schema   JSONB,                                  -- JSON Schema for outputs

  -- 调用方式
  handler_type    VARCHAR(16) NOT NULL,                   -- 'builtin' | 'http' | 'shell'
  handler_config  JSONB NOT NULL,                         -- 'http': {url, method, headers, auth}; 'shell': {command, env}
  
  -- 安全 / 治理
  is_public       BOOLEAN NOT NULL DEFAULT FALSE,         -- 用户可分享给其它用户
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,       -- 调用前要用户人工确认
  rate_limit_per_min INT NOT NULL DEFAULT 60,
  timeout_ms      INT NOT NULL DEFAULT 30000,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, code)                                  -- 系统工具 user_id IS NULL，自带唯一约束
);

CREATE INDEX idx_agent_tools_owner ON agent_tools(user_id, enabled);
CREATE INDEX idx_agent_tools_public ON agent_tools(is_public) WHERE is_public = TRUE;
```

### 4.2 `agent_workflows` —— 工作流定义

```sql
CREATE TABLE agent_workflows (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name            VARCHAR(120) NOT NULL,
  description     TEXT,

  mode            VARCHAR(16) NOT NULL,                   -- 'fixed' | 'autonomous' | 'hybrid'
  definition_yaml TEXT NOT NULL,                          -- 真相源
  definition_ast  JSONB NOT NULL,                         -- 解析后的 AST，便于查询和校验

  is_template     BOOLEAN NOT NULL DEFAULT FALSE,
  is_public       BOOLEAN NOT NULL DEFAULT FALSE,

  version         INT NOT NULL DEFAULT 1,                 -- 每次保存自增（同 id）
  parent_workflow_id BIGINT REFERENCES agent_workflows(id) ON DELETE SET NULL,  -- fork 来源

  -- 累计统计
  run_count       BIGINT NOT NULL DEFAULT 0,
  last_run_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_workflows_owner ON agent_workflows(user_id, updated_at DESC);
CREATE INDEX idx_agent_workflows_public ON agent_workflows(is_public, run_count DESC) WHERE is_public = TRUE;
```

### 4.3 `agent_workflow_versions` —— 版本历史

```sql
CREATE TABLE agent_workflow_versions (
  id              BIGSERIAL PRIMARY KEY,
  workflow_id     BIGINT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
  version         INT NOT NULL,
  definition_yaml TEXT NOT NULL,
  definition_ast  JSONB NOT NULL,
  change_note     VARCHAR(280),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, version)
);
```

### 4.4 `workflow_runs` —— 运行实例

```sql
CREATE TABLE workflow_runs (
  id              BIGSERIAL PRIMARY KEY,
  workflow_id     BIGINT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
  version         INT NOT NULL,                           -- 跑的是哪个版本（即使 workflow 后续被改）
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  status          VARCHAR(16) NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled' | 'budget_exceeded'

  -- 输入与最终输出
  inputs          JSONB NOT NULL,
  outputs         JSONB,

  -- 调试 / 暂停状态
  current_node    VARCHAR(80),                            -- 当前正在跑或暂停在哪里
  paused_reason   VARCHAR(40),                            -- 'breakpoint' | 'requires_approval' | 'manual'

  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  duration_ms     INT,

  -- 资源消耗
  total_node_count INT NOT NULL DEFAULT 0,
  prompt_tokens   INT,
  completion_tokens INT,
  total_cost_usd  NUMERIC(10, 6),

  error_message   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at DESC);
CREATE INDEX idx_workflow_runs_user_status ON workflow_runs(user_id, status, started_at DESC);
```

### 4.5 `workflow_node_logs` —— 节点级 trace

```sql
CREATE TABLE workflow_node_logs (
  id              BIGSERIAL PRIMARY KEY,
  run_id          BIGINT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,

  sequence        INT NOT NULL,                            -- 在 run 内的顺序号
  node_id         VARCHAR(80) NOT NULL,                    -- YAML 里的 id
  node_type       VARCHAR(24) NOT NULL,                    -- 'tool_call' | 'model_call' | 'branch' | 'loop' | 'noop'

  status          VARCHAR(16) NOT NULL,                    -- 'pending' | 'running' | 'success' | 'failed' | 'skipped'

  -- 输入输出
  input           JSONB NOT NULL,
  output          JSONB,

  -- 执行细节
  tool_id         BIGINT REFERENCES agent_tools(id),       -- tool_call 时填
  model_id        VARCHAR(64),                             -- model_call 时填
  prompt_tokens   INT,
  completion_tokens INT,

  duration_ms     INT,
  error_message   TEXT,

  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ
);

CREATE INDEX idx_workflow_node_logs_run ON workflow_node_logs(run_id, sequence);
```

---

## 5 · 工作流定义语言（DSL）

### 5.1 设计原则

- **YAML 1.2 兼容**，无自定义 tag。
- **变量引用**：`{{ <path> }}`，path 是 dotted notation；解析器只支持读取，不支持任意表达式（不 eval）。
- **节点 id 唯一**，引用通过 id（不通过位置）。
- **拓扑通过 `depends_on` 显式声明**（非 fixed-mode 必填，fixed-linear 可省）。

### 5.2 完整 schema 示例（fixed mode）

```yaml
version: 1                              # DSL 版本号，跨版本时迁移工具据此判断
name: "Article Quality Audit"
description: |
  对一篇博客草稿做语法检查 + 事实核查 + 改进建议综合
mode: fixed

inputs:
  - name: post_id
    type: integer
    required: true

# 工具白名单 —— 限定该 workflow 允许调用的工具范围。在 autonomous 模式下尤其重要。
allowed_tools:
  - kb_get_post
  - grammar_check_my
  - kb_search

nodes:
  - id: load
    type: tool_call
    tool: kb_get_post
    args:
      id: "{{ inputs.post_id }}"
    # depends_on 默认为前一个节点（fixed-linear 简写）

  - id: grammar
    type: tool_call
    tool: grammar_check_my             # 用户自定义 HTTP tool
    args:
      text: "{{ load.output.content_markdown }}"
    timeout_ms: 20000

  - id: facts
    type: model_call
    model: claude-haiku-4-5
    prompt: |
      根据下面这段草稿，列出需要事实核查的论断：

      {{ load.output.content_markdown }}
    output_format: json                  # 'text' | 'json' (LLM 强制 JSON 输出)

  - id: synthesize
    type: model_call
    model: claude-opus-4-7
    prompt: |
      草稿：
      {{ load.output.content_markdown }}

      语法报告：
      {{ grammar.output }}

      事实清单：
      {{ facts.output }}

      请给出综合改进建议，markdown 列表，每条 1-2 句。

outputs:
  report: "{{ synthesize.output }}"
  grammar_count: "{{ grammar.output.issue_count }}"
```

### 5.3 DAG / 分支 / 循环（P1）

```yaml
nodes:
  - id: fetch_a
    type: tool_call
    tool: web_fetch
    args:
      url: "{{ inputs.url_a }}"

  - id: fetch_b
    type: tool_call
    tool: web_fetch
    args:
      url: "{{ inputs.url_b }}"
    depends_on: []                       # 显式平行（不依赖 fetch_a）

  - id: gate
    type: branch
    when: "{{ fetch_a.output.length > 1000 }}"  # mini-DSL，仅支持比较 / 与或非
    then:
      - id: heavy_summarize
        type: model_call
        model: claude-opus-4-7
        prompt: ...
        depends_on: [fetch_a, fetch_b]
    else:
      - id: light_summarize
        type: model_call
        model: claude-haiku-4-5
        prompt: ...
        depends_on: [fetch_a, fetch_b]

  - id: per_item
    type: for_each
    over: "{{ inputs.items }}"
    iterator_var: item
    body:
      - id: process_item
        type: tool_call
        tool: kb_search
        args:
          query: "{{ item }}"
```

### 5.4 autonomous 模式

```yaml
version: 1
name: "Open Research Assistant"
mode: autonomous

inputs:
  - name: question
    type: string

allowed_tools:
  - web_search
  - web_fetch
  - kb_search

agent:
  model: claude-opus-4-7
  max_steps: 25
  max_tokens: 60000
  system_prompt: |
    你是一个研究助理。给你一个问题，自由调用 allowed_tools 中的工具来研究。
    每步先说明计划，再调用工具，最后总结。

outputs:
  answer: "{{ agent.final_message }}"
  trace: "{{ agent.steps }}"
```

执行时 ai-service 内部走 ReAct / OpenAI tool-calling 循环，工具调用走同一套 `agent_tools` 注册表。每一步在 `workflow_node_logs` 里写一条 trace。

### 5.5 hybrid 模式

`mode: hybrid` 是 autonomous 限定到给定子图：用户预先画好"骨架"（必经的几个节点），节点之间允许 agent 自由插入子工作流。本路线 v1 不实现，留给 P2。

---

## 6 · 架构

```
┌─────────────────────────────────────────────────────────┐
│  Workspace · Code Tab                                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────────────┐   │
│  │ YAML Editor│ │ Tool Reg.  │ │ Run / Trace View   │   │
│  └─────┬──────┘ └────┬───────┘ └─────────┬──────────┘   │
│        │ Save        │ CRUD             │ SSE          │
└────────┼─────────────┼──────────────────┼──────────────┘
         │             │                  │
         ▼             ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│  Go Backend · agent_code.go                             │
│   workflows / tools CRUD · run start / cancel / resume  │
│   关键守护：所有写操作 RBAC + budget 校验               │
└────────┬────────────────────────────────────────────────┘
         │  POST /internal/workflow/run
         ▼
┌─────────────────────────────────────────────────────────┐
│  ai-service · Workflow Engine                           │
│   ┌───────────────┐  ┌──────────────┐                   │
│   │ AST 解析器    │  │ 调度器（拓扑）│                  │
│   └───────────────┘  └──────┬───────┘                   │
│                             │                            │
│             ┌───────────────┴───────────────┐            │
│             ▼                               ▼            │
│   ┌──────────────────┐          ┌──────────────────┐    │
│   │ Tool Dispatcher   │          │ Model Dispatcher │    │
│   │  (HTTP / builtin) │          │  (LiteLLM)       │    │
│   └─────────┬────────┘          └────────┬─────────┘    │
│             │                            │               │
│             ▼                            ▼               │
│        外部 HTTP                       LLM Providers     │
│        服务 / 内置                                        │
│                                                           │
│   每一步写 workflow_node_logs（同一 DB，跨服务共享）     │
└─────────────────────────────────────────────────────────┘
```

### 6.1 关键架构决策

1. **解析与调度都在 ai-service**
   - Go 不引入 YAML AST / 拓扑库；Go 只做鉴权 / 透传 / 配额。
   - ai-service 已有 LiteLLM、async runtime，承载 workflow 执行有先天优势。

2. **节点级实时反馈通过 SSE**
   - `GET /api/v1/agent/code/runs/:id/stream` 返回 SSE，前端实时渲染节点状态变化（pending → running → success / failed）。
   - 重连场景：客户端可带 `Last-Event-ID` 续 stream（重新拉 trace）。

3. **工具调用契约**
   - builtin 工具：ai-service 内置 Python 函数；
   - HTTP 工具：ai-service 用 httpx 调用，遵守 timeout + retries + 用户自定义 headers；
   - shell 工具（P3）：必走沙箱进程 + 资源限制；调用前 require_approval；
   - 三类共用同一个 `tool_dispatcher.invoke(tool_id, args)` 接口，调用方无感。

4. **autonomous 模式底层**
   - LiteLLM `tools=[...]` 参数 + `tool_choice='auto'`；
   - 每个 ReAct step 写一条 `workflow_node_logs`，节点 id 自动生成 `step_1`, `step_2`...
   - 走完 `max_steps` 或模型说 done 才结束。

5. **配额硬上限**
   - 单 run：≤ 200 nodes / ≤ 100k tokens / ≤ 30 min wall-clock；
   - 单用户每日：≤ 100 runs / ≤ 500k tokens；
   - 超额 → run 状态 `budget_exceeded` + 全停 + 通知用户。

---

## 7 · API 设计

### 7.1 工具注册

```
GET    /api/v1/agent/code/tools?scope=mine|public|builtin
POST   /api/v1/agent/code/tools                 (创建用户 HTTP tool)
GET    /api/v1/agent/code/tools/:id
PATCH  /api/v1/agent/code/tools/:id
DELETE /api/v1/agent/code/tools/:id
POST   /api/v1/agent/code/tools/:id/test        (一次性试调，给定 sample args)
```

### 7.2 工作流 CRUD

```
GET    /api/v1/agent/code/workflows?scope=mine|public|template&q=<keyword>
POST   /api/v1/agent/code/workflows
       body: { name, mode, definition_yaml, ... }
       resp: { id, version, definition_ast }     # 服务端校验 YAML 后返回 AST
GET    /api/v1/agent/code/workflows/:id
PATCH  /api/v1/agent/code/workflows/:id          (产生新 version)
DELETE /api/v1/agent/code/workflows/:id
GET    /api/v1/agent/code/workflows/:id/versions
GET    /api/v1/agent/code/workflows/:id/versions/:v
POST   /api/v1/agent/code/workflows/:id/fork    (复制为新 workflow)
```

### 7.3 运行控制

```
POST   /api/v1/agent/code/workflows/:id/runs
       body: { inputs: {...}, breakpoints?: ["node_id_a"] }
       resp: { run_id }

GET    /api/v1/agent/code/runs/:id
GET    /api/v1/agent/code/runs/:id/logs?node_id=&since_seq=
GET    /api/v1/agent/code/runs/:id/stream       # SSE
POST   /api/v1/agent/code/runs/:id/pause
POST   /api/v1/agent/code/runs/:id/resume
       body: { override_inputs?: {<node_id>: {...}} }
POST   /api/v1/agent/code/runs/:id/cancel
```

### 7.4 autonomous → fixed 固化

```
POST   /api/v1/agent/code/runs/:id/canonicalize
       resp: { workflow_id, definition_yaml }
       # 把 autonomous run 的 tool_calls 序列拼成 fixed YAML 草案
```

### 7.5 内部 API（ai-service）

```
POST /internal/workflow/run
     body: { run_id, workflow_ast, inputs, breakpoints, owner_user_id }
     # 同步排队 + 返回；ai-service 内部把 run 推到执行队列
POST /internal/workflow/resume
POST /internal/workflow/cancel
```

---

## 8 · UI / UX 形态

### 8.1 Workspace · 切到 Code 模式

页面分三栏（桌面）：

```
┌─────────────────────────────────────────────────────────┐
│ [Chat] [Cowork] [▣Code]                ☰ Settings       │
├──────────┬───────────────────┬──────────────────────────┤
│ Workflows│ YAML Editor       │ Run Panel                │
│ • Audit  │ ┌──────────────┐  │ ▶ Inputs                 │
│ • Topic  │ │              │  │   post_id: [______]      │
│ • ...    │ │  yaml here   │  │ ▶ Validate               │
│          │ │              │  │ ▶ [Run]  [Run from node] │
│ Tools    │ └──────────────┘  │                          │
│ ─ kb_*   │                   │ Trace                    │
│ ─ web_*  │ [Save]  [Validate]│ ┌──────────────────┐     │
│ ─ my_ocr │                   │ │load    ✓ 1.2s    │     │
│ +Add     │                   │ │grammar ✓ 8.1s    │     │
│          │                   │ │facts   ⏳        │     │
└──────────┴───────────────────┴──────────────────────────┘
```

### 8.2 工具创建

简单表单：name / category / description / args_schema (JSON schema editor) / handler URL / headers / auth (none | basic | bearer) / sample request → "Test it" 按钮一键试调。

### 8.3 Run Trace / 调试器

每个节点一行卡：状态图标 + 名称 + 耗时 + 折叠后的 input/output JSON viewer。点击节点 → 右侧详情 panel：
- 完整 input
- 完整 output
- 耗时分布（如果是 tool_call，显示网络 / 处理时间）
- "Edit & resume from here" 按钮（暂停后可用）

### 8.4 autonomous run 视图

主 Agent 的每一步显示为"思考 → 决策 → 调用 → 观察"四段式卡片，类似 Claude Desktop 的 tool use UI。

---

## 9 · 实施阶段（Milestones）

### Phase 0/1 — Canvas 骨架与可保存画布（已落地）
**交付物**：
- DB migrations：`agent_connectors` / `agent_tools` / `agent_workflows` / `agent_workflow_versions` / `agent_workflow_runs` / `agent_workflow_node_logs` / `agent_variables` / `agent_schedules` / `agent_publications`
- Go 后端：workflow CRUD、tool/agent/schedule catalog、runtime run 入口、版本快照
- 前端：后台独立 `/agent-workflows` 三栏 Canvas UI、节点属性编辑、运行输入表单、变量面板、工具目录、运行历史、保存/试运行按钮
- ai-service：Workflow definition schema + deterministic runner

**完成标志**：用户可以进入「智能体编排」，编辑画布和节点属性、填写运行输入、保存到后端、触发 runtime run，并在 trace / run history 面板看到执行结果或 pending 状态。

### Phase 2 — DAG 执行器 + 内置工具（已落地）
**交付物**：
- ai-service workflow engine：fixed mode DAG 执行（拓扑排序）
- 内置工具：`kb_search`, `kb_get_post`, `text_join`, `echo`
- 节点级 trace 返回 Go，Go 写入 `agent_workflow_node_logs`
- 分支、单层循环、extractor、模板变量解析
- llm / agent / code 节点已接入真实 LLM Router / Agent v1 / 受限表达式 executor；未连接能力会显式失败，避免主进程执行不安全逻辑
- 后台 Run Inputs 已提供「真实 / 模拟」切换；默认真实运行，模拟 run 会在运行历史中显示 `sim` 标记
- capabilities API 已显式标注真实 LLM、真实内置工具、sandbox、scheduler、autonomous 是否可用

**完成标志**：用户能把"Article Audit Agent"这种包含 tool / extractor / agent / branch / loop / output 的 workflow 保存并试运行；真实 KB/LLM/Agent/受限 Code 已接入，MCP/Skill/OpenAPI 和独立 sandbox-worker 未接入时显式失败。

### Phase 3 — DAG + 调试器 + Web 工具（基础治理已落地，后续硬化）
**交付物**：
- DAG 拓扑（depends_on 多对多）+ 平行执行
- branch / for_each 节点
- 暂停 / 续跑 / cancel / retry / canonicalize
- 内置工具：`web_fetch`, `web_search`
- 工作流版本回滚、导入导出、模板、指标、工具测试

### Phase 4 — autonomous 模式 + 固化（MVP 已落地）
**交付物**：
- Agent v1 在 allowedTools 内运行受控工具循环并用 LLM 汇总
- 节点 step 通过 trace / SSE stream 回放
- run → fixed workflow 固化按钮
- 工具/模板市场基础表与 seed 模板

### Phase 5 — Shell sandbox 与协作（不限期）
**交付物**：
- Shell tool sandbox（Wasm or Docker-in-Docker，专项立项）
- 跨用户 / 跨团队 workflow 协作
- 此时 Cowork 与 Code 共享底层引擎，准备做基础设施重构

---

## 10 · 风险与未知项

### 10.1 安全 · 任意 HTTP 工具

- **风险**：用户注册的 HTTP tool 可以指向 metadata server (169.254.169.254)、内网服务等 → SSRF。
- **缓解**：
  - URL 默认只允许 https:// 公网域名；
  - 解析 DNS 后过滤 RFC1918 / 169.254 / loopback；
  - 提供 admin 配置的全局黑白名单；
  - http handler 走独立子网，不暴露 metadata 服务。

### 10.2 安全 · YAML / 表达式注入

- **风险**：`{{ ... }}` 模板被恶意构造，例如 `{{ open('/etc/passwd').read() }}`。
- **缓解**：变量解析器只接受 path lookup（dotted），不调任何 builtin；表达式只在 `branch.when` 接受，且使用受限 mini-DSL（仅比较 + AND/OR/NOT）。

### 10.3 长跑工作流的资源

- **风险**：单 workflow 包 500 个节点，全靠 LLM 调用 → 占用 ai-service 长时间。
- **缓解**：硬上限 200 nodes / 30min / 100k tokens；超额停止；工作流执行用独立子进程池，不影响 Chat 实时流。

### 10.4 autonomous 模式的不可预测性

- **风险**：主 Agent 卡在循环里反复调一个工具，token 烧光也不停。
- **缓解**：max_steps 硬上限；连续 3 次相同 tool call + 相同 args 视为死循环 → 强制结束并提示。

### 10.5 工作流版本与运行的对应

- **风险**：用户保存 v3 后，正在跑 v2 的 run 能否安全完成？
- **缓解**：`workflow_runs.version` 锁定运行的版本；run 用 `agent_workflow_versions` 里冻结的 AST，编辑当前版本不影响进行中的 run。

### 10.6 fork & template 的清晰心智模型

- **风险**：fork / template / version 三者关系易混淆。
- **设计**：
  - `version` 是同一 workflow 的演化历史；
  - `fork` 创建新 workflow（新 id），`parent_workflow_id` 指向源；
  - `template` 是标记位（可被任意人发现 + fork），不是独立类型。

---

## 11 · 验收标准（Phase 2 MVP）

- [x] 用户能建工具、建 workflow、保存为新版本；
- [x] fixed mode 线性 workflow 能跑通，前端可通过 trace / stream 看节点 trace；
- [x] HTTP tool timeout / retry / 错误能被 trace 与 errorCategory 记录；
- [x] 运行历史可查看（最近 50 次 run）；
- [x] 单 run maxNodes / maxTokens / maxDuration / maxCost 进入 run 预算字段；maxNodes 已在创建时硬校验，token/cost 由 LLM usage 回填后继续精算；
- [x] 文档：本路线 Phase 2 段落更新为 Done，验证证据见 PR 描述。

---

## 12 · 与 Cowork 的接口预留

Cowork 的 `cowork_tasks.task_type` 在 P3+ 可以扩展支持 `workflow_run` 类型 —— 即"用一个 Code workflow 作为 cowork 任务"。届时：
- Cowork 配置 form 加"选择 workflow"下拉；
- 调度器到点把 workflow 推到 `workflow_runs` 表，inputs 由 task 配置传；
- 执行结束后 cowork 把 workflow 的 outputs 转成 notification。

这把 Cowork 从"预制菜单"扩成"可选预制菜单 / 自带菜单"，是两模式协同的关键接口点。

---

## 附录 A · 内置工具清单（Phase 2 起逐步落地）

| code | category | args | 说明 |
| --- | --- | --- | --- |
| `kb_search` | kb | query, limit, semantic? | 站内文章关键词 + 语义搜索 |
| `kb_get_post` | kb | id | 按 id 取文章正文 + meta |
| `kb_list_tags` | kb | – | 标签清单 |
| `kb_search_by_tag` | kb | tag, limit | 标签下文章列表 |
| `model_call` | llm | model, prompt, system?, output_format? | LiteLLM 通用调用 |
| `web_search` | web | query, top_k | Tavily / SerpAPI |
| `web_fetch` | web | url | 抓取 + 提取主体（reader mode） |
| `image_generate` | media | prompt, aspect, count | 通过 ai-service 现有 image provider |
| `notification_emit` | system | title, body_md, severity | 让 workflow 推送一条 inbox |

新增内置工具流程：
1. 在 ai-service `tools/builtin_*.py` 实现；
2. 注册到 `agent_tools` seed migration（`user_id IS NULL`）；
3. 更新本附录。
