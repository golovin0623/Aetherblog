---
description: 自动拉取 GitHub Issues、分析代码、修复问题、三轮验证、提交推送 (全自动，无需用户确认)
---

# 智能 Issues 修复工作流 (Smart Issues Fix)

// turbo-all

全自动批量修复 GitHub 仓库中的 Open Issues。工作流覆盖：分支创建 → Issues 分析 → 代码修复 → **三轮验证** → 提交推送。**全程无需用户确认**，通过严格的自动化验证保证代码质量。

## 前置条件

1. 项目是一个 Git 仓库，且 `origin` 已配置
2. 存在至少 1 个 Open Issue
3. 当前工作区干净（无未提交变更）

---

## 工作流步骤

### 1. 准备工作区

切换到 `main` 分支并拉取最新代码：

```bash
git checkout main && git pull origin main
```

检查工作区是否干净：

```bash
git status --short
```

如果有未提交的变更，先 `git stash` 保存，工作流结束后再恢复。

### 2. 拉取 Open Issues

使用 `read_url_content` 工具读取 GitHub Issues 列表页：
- URL 格式: `https://github.com/{owner}/{repo}/issues?q=is%3Aissue+is%3Aopen`
- 从页面中提取所有 Open Issue 的编号和标题

然后逐一读取每个 Issue 的详情页面，提取：
- Issue 编号
- 问题描述
- 建议的修复方案（如有）
- 涉及的文件/代码位置

### 3. 创建修复分支

根据 Issue 数量和内容，创建一个统一的修复分支：

```bash
git checkout -b fix/issues-batch-YYYYMMDD
```

日期使用当天日期（如 `fix/issues-batch-20260212`）。

### 4. 分析受影响代码

对每个 Issue：
1. 使用 `grep_search` 在代码库中定位相关代码
2. 使用 `view_file` 查看相关文件内容
3. 判断 Issue 是否已经在之前的 PR 中修复（如果已修复则标记跳过）
4. 为需要修复的 Issue 规划具体的代码修改方案

### 5. 实施修复

按优先级和依赖关系依次修复每个 Issue：
1. 使用 `replace_file_content` 或 `multi_replace_file_content` 修改代码
2. 如需新建文件，使用 `write_to_file`
3. 每个修复完成后记录修改内容
4. 遵循项目代码规范（参见 `.agent/rules/` 中的规则文件）

**关键原则**：
- 优先使用最小改动修复问题
- 不引入新的依赖（除非 Issue 明确要求）
- 保留原有代码风格和注释

---

## 6. 三轮验证 (核心环节)

### 第一轮：TypeScript 编译检查

对所有受影响的前端包执行 `tsc --noEmit`：

```bash
pnpm --filter blog exec tsc --noEmit 2>&1
```

```bash
pnpm --filter admin exec tsc --noEmit 2>&1
```

如果有编译错误：
- 分析错误原因，修复代码
- 重新执行编译检查直到通过

### 第二轮：Lint 检查

```bash
pnpm --filter blog exec next lint 2>&1 | tail -30
```

```bash
pnpm --filter admin exec eslint src --ext .ts,.tsx --max-warnings=0 2>&1 | tail -30
```

对于 Python (AI Service) 变更：
```bash
cd apps/ai-service && .venv/bin/python -m ruff check app/ 2>&1 | tail -20
```

对于 Java 后端变更：
```bash
cd apps/server && mvn compile -q 2>&1 | tail -20
```

如果有 lint 错误：优先修复 errors（warnings 可忽略）。

### 第三轮：功能验证

针对每个 Issue 的修复内容进行点对点验证：
- 检查修复代码的逻辑正确性（review 修改的 diff）
- 对安全类修复，验证攻击向量是否被堵住
- 对性能类修复，确认优化方案有效
- 执行受影响模块的测试（如有）：
  ```bash
  cd apps/ai-service && .venv/bin/python -m pytest tests/ -v 2>&1 | tail -30
  ```

**三轮验证全部通过后，方可进入提交步骤。**

---

## 7. 提交代码

查看最终变更概览：

```bash
git add . && git diff --cached --stat
```

生成提交信息并执行提交。提交信息规范：

```text
fix(scope): 修复 N 个代码审查 issues (#最小编号~#最大编号)

1. #编号: 简短描述修复内容
2. #编号: 简短描述修复内容
...

Closes #编号1, Closes #编号2, ...

Co-authored-by: Claude <noreply@anthropic.com>
```

**Co-authored-by 规则**：
- 如果当前 AI 模型是 Claude 系列: `Co-authored-by: Claude <noreply@anthropic.com>`
- 如果当前 AI 模型是 Gemini 系列: `Co-authored-by: Gemini <noreply@google.com>`
- 具体到模型版本时: `Co-authored-by: Claude Sonnet 4 <noreply@anthropic.com>` 或 `Co-authored-by: Gemini 2.5 Pro <noreply@google.com>`

### 8. 推送代码

```bash
git push origin <当前分支名>
```

### 9. 输出报告

修复完成后，向用户汇报：
- 修复的 Issue 列表及对应修改文件
- 三轮验证结果
- 推送的分支名和 PR 创建链接
- 跳过的 Issue（如已修复）及原因

**报告格式示例**：

```markdown
✅ Issues 批量修复完成

| Issue | 修复内容 | 状态 |
|---|---|---|
| #122 | 描述... | ✅ 修复 |
| #123 | 描述... | ⏭️ 已修复 |

验证结果:
- TypeScript 编译: ✅ 零错误
- Lint 检查: ✅ 通过
- 功能验证: ✅ 通过

分支: fix/issues-batch-20260212
创建 PR: https://github.com/{owner}/{repo}/pull/new/fix/issues-batch-20260212
```
