# INTELLIGENCE UI 统一优化手册

## 目标

INTELLIGENCE 是后台中承载模型配置、智能写作、工作流编排、搜索语义化、成本观测与 AI 数据分析的一级功能域。它需要像 SYSTEM 一样具备统一的设计语言，但不应复刻 SYSTEM 的系统管理面板风格。

本次优化的目标是建立一套可持续复用的 `Intelligence Workbench` 设计体系，让 INTELLIGENCE 内部页面在视觉、操作、状态表达和响应式行为上保持一致，同时保留各自使用场景：

- 灵境：沉浸式对话工作区，明确排除在本轮 INTELLIGENCE 统一 UI 调整之外；除非后续单独提出灵境专项，不修改其 UI、布局或 token。
- 智能编排：工程化流程画布。
- 写作助手：内容运营工作台。
- 模型中心：模型、供应商、凭证配置中心。
- 全局价格：模型成本治理表格。
- 数据分析：AI 调用、成本、成功率观测。
- 搜索配置：语义搜索、索引、降级策略控制台。

## 设计原则

1. 统一的是域内语言，不是页面模板。
2. 保留现有 AetherBlog `ink/bg/aurora/signal/surface` token，不另造割裂主题。
3. INTELLIGENCE 的气质应是“动态工作台 + 信号密度 + 智能闭环”，不是 SYSTEM 的“稳定治理 + 审计配置”。
4. 沉浸式页面允许独立布局；灵境作为独立沉浸体验不纳入本方案的 UI 统一改造范围。
5. 所有新增选择、筛选、操作控件必须使用项目样式化控件或自定义控件，不回退到浏览器原生控件。
6. 页面内不堆叠无意义卡片，不把工作台做成营销式 hero。
7. 移动端必须保持可操作，核心按钮触控区域不小于 44px，筛选/面板优先折叠或横向滚动。

## 视觉语言

### 页面层

统一使用 `IntelligenceShell` 或等价的 scoped class 提供：

- 细网格背景。
- 克制线性 aurora 光场。
- 与亮色/暗色主题同步的 panel、control、border、shadow token。
- `standard`、`workspace`、`embedded` 三种布局语义。

### Header 层

统一使用 `IntelligenceHeader` 表达：

- `INTELLIGENCE · <MODULE>` eyebrow。
- 模块名、说明、当前上下文。
- 当前状态摘要。
- 右侧主操作与筛选器。

Header 不复刻 SYSTEM 的 `AdminModuleHeader` 大卡片结构，而是偏轻量、密集、工作台化。

### 面板层

统一使用 `IntelligencePanel` 表达：

- 标题、说明、图标、操作区。
- 一致的边框、背景、阴影、圆角。
- 用于数据卡片、配置区、状态面板、表格容器。

### 控件层

统一语义：

- `.intelligence-action-button`：次级操作。
- `.intelligence-action-button-primary`：主操作。
- `.intelligence-segmented`：短选项切换。
- `.intelligence-input`：搜索/输入。
- `.intelligence-status-strip`：诊断、降级、缺价格、待重建等状态。

### 指标层

统一使用 `IntelligenceMetric` 或同等 class 表达：

- 小标题。
- 等宽数字。
- 图标与 tone。
- neutral / success / warning / danger / accent。

## 执行步骤

1. 建立手册与验收清单。
2. 新增 `apps/admin/src/components/intelligence/` 组件目录。
3. 在 `apps/admin/src/index.css` 建立 `.intelligence-*` scoped token 和基础样式。
4. 第一批落地页面：
   - `AnalyticsPage`：统一页壳、Header、时间窗口、归档操作。
   - `SearchConfigPage`：统一页壳、Header、保存/重置操作和诊断区容器。
   - `GlobalPricingPage`：统一 workspace frame、Header、指标和筛选区。
   - `AiConfigPage`：接入 workspace frame 和工作台 bar，保留原三栏业务结构。
5. 第二批可继续优化页面：
   - `AIToolsPage`：保留当前工作台结构，将局部按钮和工具卡进一步迁到 shared class。
   - `AgentWorkflowsPage`：保留画布密度，统一 toolbar、Inspector、节点状态。
6. 灵境 / `AetherHubWorkspacePage` 不参与本轮和后续批次的统一 UI 改造，除非用户单独发起灵境专项。
7. 验证类型检查、视觉边界、移动端触控和暗色主题。

## 验收标准清单

### 域内一致性

- [ ] 从侧边栏进入除灵境外的 INTELLIGENCE 页面，能明显感知同属一个功能域。
- [ ] 不同页面保留自身场景，不出现所有页面模板化同质化。
- [ ] Header 的标题、说明、当前状态、操作区排列一致。
- [ ] 主操作、次操作、筛选器、搜索框视觉语义一致。
- [ ] 状态提示统一表达 warning / danger / success / neutral。

### 视觉质量

- [ ] 使用 `--aurora-*`、`--ink-*`、`--bg-*`、`--signal-*` 派生，不硬编码新的主题色体系。
- [ ] 没有大面积紫蓝渐变、营销 hero、装饰光球或与后台场景不符的视觉噪音。
- [ ] 亮色和暗色主题下文本对比度、边框和面板层级清楚。
- [ ] 卡片不套卡片；页面 section 以工作台 panel 或全宽区域表达。
- [ ] 数字、模型 ID、价格、状态码使用等宽/表格数字，方便扫描。

### 交互和响应式

- [ ] 移动端关键操作触控区域不小于 44px。
- [ ] 操作区在小屏不会挤压标题或溢出。
- [ ] 长模型 ID、供应商名称、状态说明不会撑破容器。
- [ ] loading、empty、error、disabled 状态具备一致视觉反馈。
- [ ] 不新增原生 `<select>` 风格控件。

### 技术落地

- [ ] 新组件采用组合式 API，不把业务逻辑耦合进 UI 基础组件。
- [ ] 不改动后端接口、DTO、鉴权或上传逻辑。
- [ ] 不影响 SYSTEM、CONTENT、OVERVIEW 既有视觉。
- [ ] 不覆盖当前工作区已有无关改动。
- [ ] 至少运行 `pnpm --filter @aetherblog/admin typecheck`。

## 本轮优化范围

本轮先完成“可落地的第一批统一”：

- 新增手册和共享组件。
- 接入 `AnalyticsPage`、`SearchConfigPage`、`GlobalPricingPage`、`AiConfigPage`。
- `AetherHub` / 灵境不接入本轮统一样式，不修改 UI、布局或 token。
- 保留 `AIToolsPage` 和 `AgentWorkflowsPage` 现有结构，只让它们继承新的 INTELLIGENCE token 语义。

最终验收由用户根据实际后台体验确认。
