# AI 协同写作工作流系统

## 📖 概述

这是一个全新的 AI 辅助写作系统，将传统的"功能堆砌"升级为"流程编排"，让 AI 真正成为创作伙伴而非工具。

### 核心理念

**从"AI 功能集合" → "AI 写作伙伴"**

- ✅ **阶段化流程**：将创作过程分解为 7 个阶段，每个阶段有专属的 AI 能力
- ✅ **智能工具分类**：区分随行工具、全局工具和工作流钩子
- ✅ **跟随光标交互**：AI 工具栏自动跟随编辑位置，保持安全距离
- ✅ **学习用户偏好**：记录使用习惯，提供个性化建议
- ✅ **可配置流程**：支持自定义阶段、跳过、自由写作模式

---

## 🏗️ 架构设计

### 三层架构

```
┌─────────────────────────────────────────┐
│  1. 工作流引擎层 (Workflow Engine)       │
│     - 阶段状态管理                       │
│     - 上下文持久化                       │
│     - 事件系统                           │
│     - 学习系统                           │
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  2. AI 工具层 (AI Toolkit)              │
│     - 随行工具 (Floating)               │
│     - 全局工具 (Global)                 │
│     - 工作流钩子 (Hook)                 │
│     - 上下文工具 (Context)              │
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  3. UI 组件层 (UI Components)           │
│     - FloatingAiToolbar                 │
│     - WorkflowNavigation                │
│     - StageAssistant (批注系统)         │
│     - BatchOptimization (批量优化)      │
└─────────────────────────────────────────┘
```

### 文件结构

```
apps/admin/src/
├── types/
│   └── writing-workflow.ts          # 类型定义
├── hooks/
│   └── useWritingWorkflow.ts        # 工作流 Hook
├── components/
│   └── ai/
│       ├── FloatingAiToolbar.tsx    # 跟随光标工具栏
│       └── WorkflowNavigation.tsx   # 工作流导航
└── pages/
    └── posts/
        └── AiWritingWorkspacePage.tsx  # 主页面
```

---

## 🎯 写作工作流阶段

### 1. 选题阶段 (Topic Selection)

**目标**：帮助用户找到灵感，确定写作方向

**AI 能力**：
- 基于用户兴趣提供选题建议
- 搜索相关资讯作为参考
- 分析热门话题趋势

**交互形式**：
```tsx
// AI 会话式交互
AI: "今天想写些什么？我可以帮你找到灵感"
User: "最近对 AI 编程助手很感兴趣"
AI: "为你推荐 3 个方向：
    1. AI 编程助手的技术原理
    2. 如何用 AI 提升开发效率
    3. AI 编程的未来趋势
    你更倾向于哪个方向？"
```

### 2. 大纲阶段 (Outline Planning)

**目标**：规划文章结构，明确要点

**AI 能力**：
- 生成文章大纲结构
- 提供观点和论据建议
- 优化逻辑顺序

**产出**：
```typescript
interface OutlineStructure {
  mainTopic: "AI 编程助手的技术原理";
  keyPoints: [
    { title: "引言：AI 如何改变编程", subPoints: [...] },
    { title: "核心技术：Transformer 模型", subPoints: [...] },
    { title: "实战应用：代码生成", subPoints: [...] },
    { title: "未来展望", subPoints: [...] }
  ]
}
```

### 3. 初稿阶段 (Draft Generation)

**目标**：生成初稿或自由创作

**两种模式**：
1. **AI 辅助生成**：基于大纲逐段生成内容
2. **自由创作**：用户手写，AI 随时待命

**随行工具**：
- 扩写：将简短想法扩展为段落
- 续写：在卡壳时提供灵感

### 4. 精修阶段 (Refinement)

**目标**：润色文字，优化表达

**AI 批注系统**：
```typescript
interface Annotation {
  range: { from: 100, to: 150 };
  type: 'style';  // 类型：建议/语法/风格/事实核查
  severity: 'warning';
  message: "这句话可以更简洁";
  suggestion: "建议改为：AI 通过 Transformer 模型理解代码语义";
}
```

**交互**：
- 选中文本 → 浮动工具栏出现
- 点击"润色" → AI 给出建议
- 接受/拒绝建议

### 5. 批量优化 (Batch Optimization)

**目标**：批量应用 AI 建议

**类似代码编辑器的 Quick Fix**：
```tsx
// 显示所有批注
[批注 1] line 12: 语法错误 - "它的" 应为 "它们的"
[批注 2] line 45: 表达建议 - 可以更简洁
[批注 3] line 89: 风格建议 - 语气可以更专业

// 批量操作
[✓] 应用语法修正 (3 处)
[✓] 应用表达优化 (5 处)
[ ] 应用风格调整 (2 处)

[批量应用] [全部拒绝]
```

### 6. 全文检查 (Final Review)

**目标**：查缺补漏，确保质量

**检查项**：
- 语法和拼写错误
- 逻辑连贯性
- 事实准确性（可选）
- 风格一致性

### 7. 发布准备 (Publication)

**目标**：完善元数据

**AI 能力**：
- 生成标题建议（SEO 优化）
- 提取智能标签
- 生成文章摘要
- 推荐封面图（未来）

---

## 🛠️ AI 工具分类

### 1. 随行工具 (Floating Tools)

**特点**：
- 跟随编辑光标
- 针对选中文本
- 快速执行
- 仅在选中时显示

**工具列表**：
| 工具 | 快捷键 | 成本 | 适用阶段 |
|------|--------|------|----------|
| 润色 | ⌘⇧P | 低 | 初稿、精修、自由写作 |
| 扩写 | ⌘⇧E | 中 | 初稿、精修、自由写作 |
| 总结 | - | 低 | 精修、检查、自由写作 |
| 翻译 | - | 低 | 初稿、精修、自由写作 |

### 2. 全局工具 (Global Tools)

**特点**：
- 在侧边栏
- 针对全文
- 需要等待
- 始终可见

**工具列表**：
| 工具 | 成本 | 适用阶段 |
|------|------|----------|
| 生成标题 | 低 | 发布准备、自由写作 |
| 提取标签 | 低 | 发布准备、自由写作 |
| 生成摘要 | 中 | 检查、发布准备、自由写作 |

### 3. 工作流钩子 (Workflow Hooks)

**特点**：
- 嵌入特定阶段
- 引导式对话
- 产出结构化数据
- 可配置流程

**工具列表**：
| 工具 | 阶段 | 产出 |
|------|------|------|
| 选题建议 | 选题阶段 | TopicSuggestion |
| 生成大纲 | 大纲阶段 | OutlineStructure |
| 批量优化 | 批量优化 | BatchOptimizationTask |

---

## 💡 核心功能实现

### 1. 跟随光标的智能工具栏

```tsx
<FloatingAiToolbar
  editorViewRef={editorViewRef}
  currentStage={workflow.context.currentStage}
  availableTools={AI_CAPABILITIES}
  onToolExecute={handleToolExecute}
/>
```

**核心逻辑**：
1. 监听编辑器 `mouseup` / `keyup` 事件
2. 获取选中文本和光标位置
3. 计算工具栏位置（上方 60px，避免遮挡）
4. 边界检测，确保不超出视口
5. 无选中时自动隐藏

**位置计算**：
```typescript
const coords = view.coordsAtPos(from);
let x = coords.left - toolbarWidth / 2;  // 水平居中
let y = coords.top - 60;  // 上方偏移

// 边界检测
if (x < 16) x = 16;
if (y < 16) y = coords.bottom + 8;  // 空间不足时放下方
```

### 2. 工作流状态管理

```tsx
const workflow = useWritingWorkflow({
  postId: postId?.toString(),
  onEvent: (event) => {
    // 监听所有工作流事件
    console.log('Workflow event:', event);
  },
});

// API
workflow.enterStage('outline-planning');     // 进入阶段
workflow.completeStage(outline);             // 完成阶段
workflow.skipStage();                        // 跳过阶段
workflow.addAnnotation({...});               // 添加批注
workflow.recordToolUsage('polish');          // 记录工具使用
```

**持久化**：
```typescript
// 自动保存到 localStorage
localStorage.setItem(`workflow-context-${postId}`, JSON.stringify(context));

// 页面刷新恢复
const cached = localStorage.getItem(`workflow-context-${postId}`);
```

### 3. 学习用户偏好

```typescript
interface WorkflowContext {
  // 学习数据
  preferredWritingStyle?: 'professional' | 'casual' | 'technical';
  topicPreferences?: string[];
  writingHabits?: {
    averageWordCount: number;
    commonStructure: string[];
    favoriteTools: string[];  // 按使用频率排序
  };
}

// 使用
workflow.recordToolUsage('polish');  // 自动更新 favoriteTools
workflow.updatePreferences({ preferredWritingStyle: 'technical' });
```

---

## 🚀 使用指南

### 快速开始

1. **访问页面**
```
/posts/ai-writing/:id
```

2. **启动工作流**
- 进入页面后自动进入"选题阶段"
- 或点击"自由写作模式"跳过工作流

3. **选中文本使用 AI**
- 鼠标选中任意文本
- 浮动工具栏自动出现
- 点击工具或使用快捷键

4. **阶段切换**
- 左侧导航显示当前进度
- 点击已完成或下一阶段可跳转
- 底部提示显示当前阶段信息

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| ⌘K | 唤起 AI 面板 |
| ⌘⇧P | 润色选中文本 |
| ⌘⇧E | 扩写选中内容 |
| Esc | 关闭工具栏/面板 |

### 配置工作流

```tsx
const workflow = useWritingWorkflow({
  config: {
    // 启用的阶段
    enabledStages: [
      'topic-selection',
      'outline-planning',
      'draft-generation',
      'refinement',
      'publication',
    ],

    // 工具可见性
    toolVisibility: {
      'polish': true,
      'translate': false,  // 隐藏翻译工具
    },

    // 自动保存间隔
    autoSaveInterval: 30,  // 秒

    // 模型偏好
    aiModelPreference: {
      floatingTools: 'gpt-4o-mini',      // 随行工具用便宜模型
      globalTools: 'gpt-4o',             // 全局工具用高质量模型
      hookTools: 'claude-3.5-sonnet',    // 工作流钩子用推理能力强的模型
    },
  },
});
```

---

## 🔧 扩展开发

### 添加新的 AI 工具

```typescript
// 1. 定义工具
const newTool: AiCapability = {
  id: 'fact-check',
  label: '事实核查',
  description: '检查内容的准确性',
  type: 'floating',
  icon: 'shield-check',
  applicableStages: ['final-review'],
  requiresSelection: true,
  cost: 'high',
};

// 2. 添加到工具列表
AI_CAPABILITIES.push(newTool);

// 3. 实现处理逻辑
async function handleToolExecute(toolId: string, text: string) {
  if (toolId === 'fact-check') {
    const result = await aiService.factCheck({ text });
    // 处理结果...
  }
}
```

### 添加新的工作流阶段

```typescript
// 1. 扩展类型
type WritingStage =
  | 'topic-selection'
  | ... existing stages ...
  | 'peer-review';  // 新阶段

// 2. 配置阶段
const STAGE_CONFIG: StageConfig = {
  id: 'peer-review',
  label: '同行评审',
  description: 'AI 模拟专业人士评审',
  icon: 'users',
  aiCapabilities: ['peer-review-ai'],
  canSkip: true,
  autoNext: false,
};

// 3. 添加到流程
config.enabledStages.push('peer-review');
```

### 自定义工作流编排

```typescript
// 创建自定义工作流
const blogWorkflow = [
  'topic-selection',
  'outline-planning',
  'draft-generation',
  'publication',
];

const academicWorkflow = [
  'topic-selection',
  'literature-review',  // 自定义阶段
  'outline-planning',
  'draft-generation',
  'peer-review',        // 自定义阶段
  'final-review',
  'publication',
];

// 根据文章类型选择
const workflow = useWritingWorkflow({
  config: {
    enabledStages: postType === 'academic' ? academicWorkflow : blogWorkflow,
  },
});
```

---

## 📊 与现有系统的对比

### 旧系统问题
1. ❌ 3 个 AI 入口，功能重复
2. ❌ 结果处理不统一
3. ❌ 缺少流式输出
4. ❌ 无差异对比
5. ❌ 被动触发，无智能建议

### 新系统优势
1. ✅ 分类明确：随行/全局/工作流
2. ✅ 统一交互：预览 → 确认 → 应用
3. ✅ 支持流式输出和取消
4. ✅ 批注系统和批量优化
5. ✅ 阶段化智能建议

---

## 🎨 设计原则

### 1. 渐进式呈现
- 无选中时：隐藏工具栏
- 选中短文本：显示精简工具栏
- 展开后：显示完整工具列表

### 2. 最小化干扰
- 工具栏跟随光标但保持距离
- 边界智能检测，避免遮挡
- 点击外部自动收起

### 3. 上下文感知
- 不同阶段显示不同工具
- 学习用户习惯，排序工具
- 智能推荐下一步操作

### 4. 可预测性
- 所有操作可撤销
- 显示成本估算
- 流式输出显示进度

---

## 🔮 未来规划

### Phase 1: 基础工作流 (已完成)
- [x] 工作流引擎
- [x] 跟随光标工具栏
- [x] 阶段导航

### Phase 2: 对话式 AI (下一步)
- [ ] 选题阶段的 AI 对话
- [ ] 大纲阶段的结构建议
- [ ] 资讯搜索集成

### Phase 3: 高级功能
- [ ] 批注系统
- [ ] 批量优化
- [ ] 版本对比
- [ ] 流式输出

### Phase 4: 智能化
- [ ] 学习用户偏好
- [ ] 个性化建议
- [ ] 主动提示
- [ ] 智能模型选择

### Phase 5: 协作
- [ ] 团队工作流
- [ ] 评审系统
- [ ] 知识库集成

---

## 📝 License

MIT
