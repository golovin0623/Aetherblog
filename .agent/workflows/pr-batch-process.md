---
description: 批量处理 open PR 的辅助流程（需人工确认，禁止自动推送/合并）
---

此工作流用于**辅助**批量处理仓库中所有 open PR。默认只做信息收集、分析与建议，不自动执行写操作（push/merge/close）。

# 准备工作

// turbo
1. 切换到 main 并拉取最新代码：
   ```bash
   git checkout main && git pull origin main
   ```

2. 如需调用 GitHub API，优先使用 `gh auth status` 已登录会话；**禁止**从本机凭据链路打印或回显 token。

3. 创建只读 helper 脚本到 `/tmp/gh_pr_helper.py`（仅允许 get_pr/list_pr/check 等只读函数）。

---

# 阶段一：拉取并分析所有 Open PR

// turbo
4. 使用 GitHub API 获取所有 open PR 的完整数据（基本信息 + reviews + review_comments + issue_comments + files）：
   ```bash
   python3 /tmp/fetch_pr_details.py   # 输出到 /tmp/pr_full_data.json
   ```

5. 分析 PR 关系与依赖，输出处理顺序建议（依赖优先、冲突链按创建时间）。

---

# 阶段二：逐个处理 PR（人工确认后执行）

对每个 PR（按建议顺序）执行以下子流程：

## 2.1 冲突检查与本地复现

6. 检查 PR mergeability：
   ```bash
   python3 /tmp/gh_pr_helper.py check <PR_NUMBER>
   ```

7. 若需要本地检出分支，**禁止**把 PR 元数据（尤其分支名）直接拼接进 shell 命令 —— 含单引号的合法分支名（如 `feat/o'reilly`）会闭合外层引号、在任何 `check-ref-format` 校验之前就注入命令。改为使用官方 `gh pr checkout`，它会自动处理 fork 远端、分支追踪、同名本地分支冲突，并完全规避注入面：
   ```bash
   gh pr checkout "<PR_NUMBER>"
   ```

8. 如出现冲突，仅做本地修复建议；是否提交由用户明确确认后再执行。

## 2.2 应用 Code Review 修复

9. 整理 Gemini/Copilot 评论并生成修复建议清单（HIGH/MEDIUM 优先）。

10. 只有在用户明确确认后，才允许执行以下写操作。注意：`/tmp/gh_pr_helper.py` 已被限制为只读（仅 `get_pr/list_pr/check`），所有写操作必须改走官方 `gh` CLI（已认证会话），**不要**为此扩展 helper 加回写函数：
- `git add`
- `git commit`
- `git push`
- PR 写操作走 `gh` CLI：`gh pr merge` / `gh pr close` / `gh pr comment`（每条命令仍需显式人工确认）

---

# 阶段三：最终验证

// turbo
11. 再次查询 open PR 列表并输出处理结果汇总（含未处理原因）。

---

# 强制安全约束

- **禁止**“全自动、无需确认”处理 PR。
- **禁止**回显、截断展示或记录任何 token。
- **禁止**将未校验的 PR 元数据（尤其分支名）直接拼接进 shell 命令。
- 所有潜在写操作（commit/push/merge/close）必须有显式人工确认，且与 `.agent/rules/behavior_rules.md` 保持一致。
