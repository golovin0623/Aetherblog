---
description: 自动分析代码变更，生成符合规范的中文提交信息并执行提交
---

# 智能代码提交工作流 (Smart Commit)

此工作流用于自动化 Git 提交过程。它会分析当前工作区的变更，生成符合 [Conventional Commits](https://www.conventionalcommits.org/) 规范的**中文**提交信息，并在用户确认后执行提交。

## 前置条件

1. 项目是一个 Git 仓库
2. 有未提交的代码变更（已暂存或未暂存）

## 工作流步骤

### 1. 检查工作区状态

// turbo
```bash
git status --short
```

### 2. 分析变更内容

查看所有变更（包括未暂存的）：

// turbo
```bash
git diff HEAD
```

基于上述 `git status` 和 `git diff` 的输出，**生成提交信息**。

**提交信息生成规范：**
1.  **格式**：遵循 Angular 提交规范
    ```text
    type(scope): subject
    
    body
    ```
2.  **Type (类型)**：
    - `feat`: 新功能
    - `fix`: 修复 Bug
    - `docs`: 文档变更
    - `style`: 代码格式（不影响功能，如空格、分号）
    - `refactor`: 代码重构（不修 Bug 不增功能）
    - `perf`: 性能优化
    - `test`: 测试相关
    - `build`: 构建系统或外部依赖变更 (e.g. Maven, npm)
    - `ci`: CI 配置文件变更 (e.g. GitHub Actions)
    - `chore`: 其他杂项
3.  **Scope (范围)**：变更影响的模块（如 `admin`, `blog`, `server`, `ci`, `deps` 等）。
4.  **Language (语言)**：**必须使用中文**。
5.  **Subject (标题)**：简短描述变更内容（不超过 50 字）。
6.  **Body (正文)**：详细描述修改原因和具体变更点，分点列出。

**示例：**
```text
feat(admin): 新增文章 AI 自动摘要功能

1. 在文章编辑器工具栏添加 "AI 摘要" 按钮
2. 集成后端 /api/ai/summarize 接口
3. 优化摘要生成的 Loading 状态显示
```

### 3. [关键!] 生成提案并请求确认

**STOP!** 在此步骤暂停。

根据分析结果，构建以下命令，并向用户展示具体要执行的命令和提交信息：

```bash
git add . && git commit -m "生成的提交信息..."
```

**必须**请求用户审核提交信息：
1. 检查 `type` 和 `scope` 是否准确。
2. 检查描述是否清晰包含了所有核心变更。

**仅当用户回复 "确认"、"批准"、"OK" 或 "/approve" 时，才继续执行步骤 4。**
如果用户要求修改，请根据用户反馈调整提交信息，并再次请求确认。

### 4. 执行提交

用户确认后，执行提交命令：

```bash
git add . && git commit -m "经过确认的提交信息"
```

### 5. (可选) 询问是否推送

提交成功后，询问用户是否需要立即推送到远程仓库：

```bash
git push
```
