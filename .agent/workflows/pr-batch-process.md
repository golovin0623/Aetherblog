---
description: 自动拉取所有 open PR，分析代码和 AI 审查评论，修复问题后合并推送 (全自动，无需用户确认)
---

此工作流用于批量处理仓库中所有 open PR。流程完全自动化，包括代码分析、冲突解决、审查意见修复和合并推送。

# 准备工作

// turbo
1. 切换到 main 并拉取最新代码：
   ```bash
   git checkout main && git pull origin main
   ```

// turbo
2. 从 macOS keychain 获取 GitHub token 并写入环境：
   ```bash
   GH_TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill 2>/dev/null | grep password | cut -d= -f2)
   echo "Token acquired: ${GH_TOKEN:0:6}..."
   ```

// turbo
3. 创建 PR 处理 helper 脚本到 `/tmp/gh_pr_helper.py`（含 get_token、api_request、merge_pr、close_pr、comment_pr、get_pr 函数）。

---

# 阶段一：拉取并分析所有 Open PR

// turbo
4. 使用 GitHub API 获取所有 open PR 的完整数据（基本信息 + reviews + review_comments + issue_comments + files）：
   ```bash
   python3 /tmp/fetch_pr_details.py   # 输出到 /tmp/pr_full_data.json
   ```

5. **分析 PR 关系与依赖**，识别以下情况：
   - **功能重复 PR**：两个 PR 修改同一安全/功能点（保留更完整的，关闭另一个）
   - **依赖 PR**：如某 PR 是修复另一个 PR 的合并冲突（先处理子 PR）
   - **冲突链**：多个 PR 修改同一文件（按时间顺序排列，逐个合并）
   - **Gemini/Copilot 审查意见**：提取每个 PR 的 HIGH/MEDIUM review comments

6. **确定处理顺序**：
   - 依赖修复 PR 优先处理
   - 同文件冲突链按创建时间 (older first) 排列
   - 无冲突 PR 最后处理

---

# 阶段二：逐个处理 PR（循环执行）

对每个 PR（按确定的顺序）执行以下子流程：

## 2.1 冲突检查与解决

7. 检查 PR mergeability：
   ```bash
   python3 /tmp/gh_pr_helper.py check <PR_NUMBER>
   ```

8. **若 `mergeable: false` (dirty)**：
   - 本地 checkout 该 PR 分支：
     ```bash
     git fetch origin <branch_name>
     git checkout -b <branch_name> origin/<branch_name>
     ```
   - 合并 main 到分支：
     ```bash
     git merge origin/main --no-edit
     ```
   - **分析每个冲突区域**：
     - 若两侧功能等价，保留 main 版本 (`git checkout --theirs <file>`)
     - 若 PR 有独立价值，手动合并保留两侧改动
     - 提交解决结果：`git add -A && git commit -m "merge: resolve conflict with main in <file>"`

9. **若 `mergeable: true`**：直接跳到步骤 10。

## 2.2 应用 Code Review 修复

10. 逐条处理 Gemini Code Assist / Copilot 的 review comments：

    | 优先级 | 常见类型 | 处理方式 |
    |--------|---------|---------|
    | HIGH | 安全头缺失、XSS 风险 | 必须修复 |
    | MEDIUM | 测试覆盖不全、flaky test (`time.sleep`) | 修复 |
    | MEDIUM | 缺少 `data-testid` | 添加 |
    | MEDIUM | 硬编码 URL/文本 | 提取为常量/环境变量 |
    | LOW | i18n 建议 (项目无 i18n) | 标注 TODO，跳过 |

    修复规则：
    - `time.sleep(N)` → Playwright `page.wait_for_function()` / retry loop
    - 硬编码 URL → `os.environ.get("APP_URL", "http://localhost:3000")`
    - `focus:outline-none` → 自定义焦点环样式
    - 安全过滤链缺少 header → 补充 `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`

11. 提交修复：
    ```bash
    git add <changed_files>
    git commit -m "fix: apply review feedback - <summary>"
    ```

## 2.3 推送并等待 mergeability

12. 推送分支：
    ```bash
    git push origin <branch_name>
    ```

// turbo
13. 等待 GitHub 更新 mergeability（约 5 秒）：
    ```bash
    sleep 5 && python3 /tmp/gh_pr_helper.py check <PR_NUMBER>
    ```

## 2.4 合并 PR

14. **若 mergeable: true**：
    ```bash
    python3 /tmp/gh_pr_helper.py merge <PR_NUMBER> merge "<emoji> <title> (#<number>)"
    ```

15. **若 mergeable 仍为 false**：返回步骤 8 重新处理冲突。

## 2.5 处理特殊情况

16. **关闭冗余 PR**（功能被其他 PR 覆盖）：
    ```bash
    python3 /tmp/gh_pr_helper.py comment <PR_NUMBER> "功能已被 #XXX 完整覆盖，关闭此 PR。"
    python3 /tmp/gh_pr_helper.py close <PR_NUMBER>
    ```

17. **处理 Draft PR**（API 无法直接合并）：
    - 拉取该分支到本地，`git merge` 到目标分支，push 目标分支（旁路合并）
    - 关闭 draft PR 并注释说明

---

# 阶段三：最终验证

// turbo
18. 确认所有 PR 已处理：
    ```bash
    # 应输出 "Open PRs remaining: 0"
    curl -sS -H "Authorization: Bearer $GH_TOKEN" \
      "https://api.github.com/repos/<owner>/<repo>/pulls?state=open" \
      | python3 -c "import json,sys; p=json.load(sys.stdin); print(f'Open PRs: {len(p)}')"
    ```

// turbo
19. 更新本地 main 到最新：
    ```bash
    git checkout main && git pull origin main
    git log --oneline -10
    ```

---

# 注意事项

- **GitHub Rate Limit**：未认证 API 有限流限制，必须使用 `git credential fill` 获取 token 认证请求
- **重复优化代码冲突**：多 PR 优化同一函数时，保留 main 上最新的版本（通常已整合前 PR 优化）
- **Draft PR**：无法通过 API 合并，必须本地处理
- **PNG/二进制冲突**：跳过（`[BINARY FILE SKIPPED]`），取其中一侧即可
