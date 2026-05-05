# Docker 镜像版本号逻辑说明

> **SECURITY 政策（2026-05 起）：** Tag 推送 (`v*`) **不再触发** CI 构建或部署。
> Tag 不走 PR review，曾是 `:latest` 覆写与生产 webhook 的授权绕过路径。
> CI 现在只在 `push` 到 `main` / `develop` 时构建镜像，`:latest` 仅在 `main` 上更新。
> 版本化镜像通过 `docker-build.sh --push --version vX.Y.Z` 在受控环境手动构建。
> 见 PR #594。

## 📦 版本号生成规则

### 规则 1: 推送到 main 分支 (无 tag)

**触发方式:**
```bash
git push origin main
```

**版本号逻辑:**
```bash
VERSION=main-${GITHUB_SHA::7}
# 例如: main-a1b2c3d (commit SHA 的前 7 位)
```

**生成的镜像标签（按变更检测，仅构建已变更模块）:**
```
golovin0623/aetherblog-backend:main-a1b2c3d
golovin0623/aetherblog-backend:latest

golovin0623/aetherblog-ai-service:main-a1b2c3d
golovin0623/aetherblog-ai-service:latest

golovin0623/aetherblog-blog:main-a1b2c3d
golovin0623/aetherblog-blog:latest

golovin0623/aetherblog-admin:main-a1b2c3d
golovin0623/aetherblog-admin:latest
```

**示例:**
```bash
# 假设最新的 commit SHA 是: a1b2c3d4e5f6g7h8i9j0
git push origin main

# 生成的版本号: main-a1b2c3d
# 只有变更的模块才会被构建并推送镜像
#   - golovin0623/aetherblog-backend:main-a1b2c3d  (若 apps/server-go/** 有变更)
#   - golovin0623/aetherblog-backend:latest
```

---

### 规则 2: 版本化镜像（手动构建，不再由 CI 触发）

**触发方式:**
```bash
# 在受控环境（拥有 Docker Hub 推送权限的本地或受信构建机）执行
./docker-build.sh --push --version v1.0.0
```

**版本号逻辑:**
```bash
VERSION=v1.0.0   # 由 --version 参数显式提供
```

**生成的镜像标签（按需构建模块）:**
```
golovin0623/aetherblog-backend:v1.0.0
golovin0623/aetherblog-ai-service:v1.0.0
golovin0623/aetherblog-blog:v1.0.0
golovin0623/aetherblog-admin:v1.0.0
```

**为什么不再用 tag 触发 CI？** Tag 推送不经过 PR review，任何拥有写权限的人都能
绕过分支保护规则把 `:latest` 推到注册表并触发生产 webhook。VULN 治理要求把镜像
发布与部署收敛到 `main` 推送（即已 review 的代码）。版本化镜像通过受控环境
本地构建发布；`git tag` 仅用于代码版本标记。

**支持的 version 格式（由调用者维护）:**
- `v1.0.0` - 标准语义化版本
- `v1.0.0-beta.1` - 预发布版本
- `v1.0.0-rc.1` - 候选发布版本

---

### 规则 3: 推送到 develop 分支

**触发方式:**
```bash
git push origin develop
```

**版本号逻辑:**
```bash
VERSION=main-${GITHUB_SHA::7}
# 与 main 分支一致，使用 commit SHA 前 7 位
```

**说明:** `develop` 分支触发增量构建，与 `main` 分支行为相同（变更检测 + 增量部署）。适合在合入 `main` 前进行集成测试。

---

## 🔍 版本号决策流程图

```
开始
  │
  ├─ 是否是 tag 触发? (refs/tags/*)
  │   └─ 是 → CI 不响应（policy: tag 推送不构建镜像、不部署）
  │           版本化镜像走 ./docker-build.sh --push --version vX.Y.Z
  │
  ├─ 是否是 PR 到 main?
  │   ├─ 是 → 仅测试 + lint，不构建镜像，无版本号
  │   └─ 否 ↓
  │
  └─ Push 到 main 或 develop
      → VERSION = {branch}-{commit-sha} (例如: main-a1b2c3d)
        增量构建（只构建变更模块）；:latest 仅在 main 上更新
```

---

## 📊 版本号对照表

| 触发方式 | Git 操作 | 版本号示例 | 构建策略 | 镜像标签示例 |
|---------|---------|-----------|----------|-------------|
| **推送到 main** | `git push origin main` | `main-a1b2c3d` | 增量（变更模块） | `backend:main-a1b2c3d`<br>`backend:latest` |
| **推送到 develop** | `git push origin develop` | `develop-a1b2c3d` | 增量（变更模块） | `backend:develop-a1b2c3d` |
| **手动版本镜像** | `./docker-build.sh --push --version v1.0.0` | `v1.0.0` | 由参数指定的模块 | `backend:v1.0.0` |
| **PR 到 main** | 提交 PR | — | 不构建镜像，仅测试 | — |
| **推送 tag** | `git push origin v1.0.0` | — | **CI 不响应**（仅作为代码版本标记） | — |

---

## 🎯 实际示例

### 示例 1: 日常开发推送

```bash
# 开发完成,推送到 main
git add .
git commit -m "feat: add new feature"
git push origin main

# GitHub Actions 自动构建（增量：仅构建变更的模块）
# Commit SHA: e79b555a1b2c3d4e5f6g7h8i9j0

# 生成的镜像（假设本次只改了 backend 和 blog）:
# ✅ golovin0623/aetherblog-backend:main-e79b555
# ✅ golovin0623/aetherblog-backend:latest
# ✅ golovin0623/aetherblog-blog:main-e79b555
# ✅ golovin0623/aetherblog-blog:latest
# ⏭️ golovin0623/aetherblog-admin（未变更，跳过）
# ⏭️ golovin0623/aetherblog-ai-service（未变更，跳过）
```

### 示例 2: 正式版本发布（受控环境本地构建）

```bash
# 准备发布 v1.0.0 —— 必须先把代码合到 main 并通过 review
git checkout main
git pull origin main

# 在受控环境（拥有 Docker Hub 推送凭证的本地或受信 runner）构建并推送
./docker-build.sh --push --version v1.0.0

# 打 git tag 作为代码版本标记（不触发 CI 构建/部署）
git tag v1.0.0
git push origin v1.0.0

# 生成的镜像:
# ✅ golovin0623/aetherblog-backend:v1.0.0
# ✅ golovin0623/aetherblog-ai-service:v1.0.0
# ✅ golovin0623/aetherblog-blog:v1.0.0
# ✅ golovin0623/aetherblog-admin:v1.0.0
#
# :latest 由 main 推送时的 CI 维护，与 tag 解耦
```

### 示例 3: 热修复版本

```bash
# 紧急修复 bug
git checkout main
git pull origin main
git checkout -b hotfix/login-bug

# 修复代码
git add .
git commit -m "fix: login bug"

# 走 PR review 合并到 main（CI 自动构建增量镜像 + 更新 :latest）
git push origin hotfix/login-bug
# → 开 PR → review → merge to main

# 受控环境构建版本化镜像
./docker-build.sh --push --version v1.0.1
git tag v1.0.1
git push origin v1.0.1

# 生成的镜像:
# ✅ golovin0623/aetherblog-backend:v1.0.1
# ✅ golovin0623/aetherblog-backend:latest（由 main 推送时的 CI 更新）
```

### 示例 4: Beta 测试版本

```bash
./docker-build.sh --push --version v2.0.0-beta.1
git tag v2.0.0-beta.1
git push origin v2.0.0-beta.1

# 生成的镜像:
# ✅ golovin0623/aetherblog-backend:v2.0.0-beta.1
```

---

## 🔄 latest 标签的行为

**重要:** `latest` 标签**只**由 `main` 分支的推送触发的 CI 维护，每次推送时更新到最新的 main 构建。
版本化镜像（`docker-build.sh --version vX.Y.Z`）**不会**移动 `:latest`，避免手动构建覆盖
受 review 的 main 镜像。

```bash
# 第一次推送
git push origin main
# 生成: backend:main-a1b2c3d, backend:latest (指向 main-a1b2c3d)

# 第二次推送
git push origin main
# 生成: backend:main-b2c3d4e, backend:latest (指向 main-b2c3d4e)

# 受控环境构建版本镜像（不动 :latest）
./docker-build.sh --push --version v1.0.0
# 生成: backend:v1.0.0  ← :latest 仍指向 main 最新
```

**注意:** 生产环境用具体版本号（`v1.0.0`），不要用 `:latest`！

---

## 📝 查看镜像版本

### 方式 1: 在 Docker Hub 查看

访问: https://hub.docker.com/r/golovin0623/aetherblog-backend/tags

### 方式 2: 使用 Docker CLI

```bash
# 列出所有版本
docker search golovin0623/aetherblog-backend

# 拉取特定版本
docker pull golovin0623/aetherblog-backend:v1.0.0
docker pull golovin0623/aetherblog-backend:main-a1b2c3d
docker pull golovin0623/aetherblog-backend:latest
```

### 方式 3: 查看本地镜像

```bash
# 列出本地镜像
docker images | grep aetherblog

# 查看镜像详情
docker inspect golovin0623/aetherblog-backend:v1.0.0
```

---

## 💡 最佳实践

### 1. 生产环境使用固定版本号

❌ **不推荐:**
```yaml
# docker-compose.prod.yml
services:
  backend:
    image: golovin0623/aetherblog-backend:latest  # 不稳定!
```

✅ **推荐:**
```yaml
# docker-compose.prod.yml
services:
  backend:
    image: golovin0623/aetherblog-backend:v1.0.0  # 固定版本
```

### 2. 使用语义化版本号

```bash
# 主版本.次版本.修订号
v1.0.0  # 初始版本
v1.1.0  # 新增功能
v1.1.1  # Bug 修复
v2.0.0  # 重大更新

# 预发布版本
v1.0.0-alpha.1  # Alpha 测试
v1.0.0-beta.1   # Beta 测试
v1.0.0-rc.1     # 候选发布
```

### 3. 开发环境可以使用 latest

```yaml
# docker-compose.dev.yml
services:
  backend:
    image: golovin0623/aetherblog-backend:latest  # 开发环境 OK
```

### 4. 保留版本历史

```bash
# 查看所有 tag
git tag -l

# 查看 tag 对应的 commit
git show v1.0.0

# 删除错误的 tag
git tag -d v1.0.0  # 本地删除
git push origin :refs/tags/v1.0.0  # 远程删除
```

---

## 🔍 故障排查

### 问题 1: 不知道当前使用的是哪个版本

```bash
# 查看容器使用的镜像版本
docker ps --format "table {{.Names}}\t{{.Image}}"

# 查看镜像的构建时间和标签
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}"
```

### 问题 2: latest 标签指向错误的版本

```bash
# 拉取最新的 latest
docker pull golovin0623/aetherblog-backend:latest

# 或使用具体版本号
docker pull golovin0623/aetherblog-backend:v1.0.0
```

### 问题 3: 想要回滚到之前的版本

```bash
# 查看所有可用版本
docker search golovin0623/aetherblog-backend

# 拉取旧版本
docker pull golovin0623/aetherblog-backend:v1.0.0

# 更新 docker-compose.yml
# image: golovin0623/aetherblog-backend:v1.0.0

# 重启服务
docker-compose up -d
```

---

## 📚 相关文档

- [语义化版本规范](https://semver.org/lang/zh-CN/)
- [Docker 镜像标签最佳实践](https://docs.docker.com/develop/dev-best-practices/)
- [GitHub Actions 环境变量](https://docs.github.com/en/actions/learn-github-actions/variables)
