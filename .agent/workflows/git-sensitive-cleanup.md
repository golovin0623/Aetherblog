---
description: 从 Git 历史中彻底清除敏感文件（如误提交的图片、密钥等）
---

# 🔒 Git 敏感文件清除操作手册

## 📋 适用场景

- 误提交了包含隐私信息的图片到 Git
- 误提交了 API 密钥、密码等敏感信息
- 需要从 Git 历史中彻底删除某些文件（不仅仅是当前版本）

---

## ⚠️ 重要警告

1. **此操作会重写 Git 历史**，所有涉及的 commit hash 都会改变
2. **必须强制推送** (`--force`)，远程仓库历史会被覆盖
3. **团队成员需要重新同步**，执行 `git fetch origin && git reset --hard origin/<branch>`
4. **工作区会被重置**，未提交的修改会丢失，请先 stash 或提交

---

## 🛠️ 操作步骤

### Step 1: 安装 git-filter-repo

```bash
# macOS
brew install git-filter-repo

# 或使用 pip
pip install git-filter-repo
```

### Step 2: 查找需要清理的文件

```bash
# 查看历史中所有图片文件
git log --all --oneline -- "*.png" "*.jpg" "*.jpeg"

# 查看特定目录下的所有文件
git log --all --oneline --name-only -- "apps/server/uploads/**"

# 列出所有曾经添加过的敏感文件（去重）
git log --all --diff-filter=A --name-only --pretty=format: -- "apps/server/uploads/**" | sort -u | grep -v '^$'
```

### Step 3: 备份当前分支（推荐）

```bash
git branch backup-before-filter
```

### Step 4: 记录远程仓库地址

```bash
# filter-repo 会移除 origin 远程，需要提前记录
git remote get-url origin
# 输出示例: https://github.com/username/repo.git
```

### Step 5: 执行清理

#### 方式A: 清理特定文件

```bash
# 清理单个文件
git filter-repo --path 'path/to/sensitive-file.png' --invert-paths --force

# 清理多个文件（一次命令）
git filter-repo \
  --path 'file1.png' \
  --path 'file2.jpg' \
  --invert-paths --force
```

#### 方式B: 使用通配符清理整个目录

```bash
# 清理整个 uploads 目录（推荐）
git filter-repo --path-glob 'apps/server/uploads/*' --invert-paths --force

# 清理所有 PNG 文件（慎用，可能误删）
git filter-repo --path-glob '*.png' --invert-paths --force
```

### Step 6: 重新添加远程仓库

```bash
git remote add origin https://github.com/username/repo.git
```

### Step 7: 验证清理结果

```bash
# 确认历史中已无敏感文件
git log --all --oneline -- "apps/server/uploads/**"
# 应该返回空

# 确认提交历史完整
git log --oneline -10
```

### Step 8: 强制推送到远程

```bash
# 推送所有分支
git push origin --all --force

# 推送所有标签
git push origin --tags --force
```

---

## 🛡️ 预防措施：更新 .gitignore

在 `.gitignore` 中添加以下规则，防止未来误提交：

```gitignore
# User uploads (prevent test uploads from being committed)
apps/server/uploads/
**/uploads/

# Prevent accidental image uploads in wrong locations
packages/**/src/**/*.png
packages/**/src/**/*.jpg
packages/**/src/**/*.jpeg
packages/**/src/**/*.gif
packages/**/src/**/*.webp

# Sensitive files
*.pem
*.key
.env.production
```

---

## 📝 常用 filter-repo 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--path <路径>` | 指定要操作的文件路径 | `--path 'uploads/test.png'` |
| `--path-glob <模式>` | 使用通配符匹配 | `--path-glob 'uploads/*'` |
| `--invert-paths` | 反转选择（删除匹配的文件） | 必须配合 --path 使用 |
| `--force` | 强制执行（跳过安全检查） | 通常需要添加 |

---

## 🔄 团队成员同步方法

其他团队成员在你强制推送后，需要执行：

```bash
# 获取新的远程历史
git fetch origin

# 硬重置到远程分支
git reset --hard origin/main

# 或者更安全的方式：重新克隆
git clone https://github.com/username/repo.git
```

---

## 📌 本次实际操作记录 (2026-01-11)

### 清理的文件

```
apps/server/uploads/2026/01/09/4f040b93-2b8a-487d-b88e-a65a9a154c5c.png
apps/server/uploads/2026/01/09/1e05f6c1-f60f-44fc-8b7d-3ca046b47015.png
apps/server/uploads/2026/01/09/acd983c4-b5f1-42e4-bdd4-b01c7850e7f7.png
apps/server/uploads/2026/01/09/cff03e5c-151f-4578-bde6-e439de793bbd.png
packages/ui/src/components/8a05b-f69f-4c52-858c-502bdb82c375.png
packages/ui/src/components/40b93-2b8a-487d-b88e-a65a9a154c5c.png
```

### 执行的命令

```bash
# 1. 安装工具
brew install git-filter-repo

# 2. 清理 packages 下的图片
git filter-repo --path 'packages/ui/src/components/8a05b-f69f-4c52-858c-502bdb82c375.png' \
                --path 'packages/ui/src/components/40b93-2b8a-487d-b88e-a65a9a154c5c.png' \
                --invert-paths --force

# 3. 清理 uploads 整个目录
git filter-repo --path-glob 'apps/server/uploads/*' --invert-paths --force

# 4. 重新添加远程
git remote add origin https://github.com/golovin0623/Aetherblog.git

# 5. 强制推送
git push origin --all --force
```

---

*Created: 2026-01-11*