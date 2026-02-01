# Docker 镜像版本号逻辑说明

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

**生成的镜像标签:**
```
golovin0623/aetherblog-backend:main-a1b2c3d
golovin0623/aetherblog-backend:latest

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
# 镜像标签:
#   - golovin0623/aetherblog-backend:main-a1b2c3d
#   - golovin0623/aetherblog-backend:latest
```

---

### 规则 2: 创建版本标签

**触发方式:**
```bash
git tag v1.0.0
git push origin v1.0.0
```

**版本号逻辑:**
```bash
VERSION=${GITHUB_REF#refs/tags/}
# 例如: v1.0.0 (使用 tag 名称)
```

**生成的镜像标签:**
```
golovin0623/aetherblog-backend:v1.0.0
golovin0623/aetherblog-backend:latest

golovin0623/aetherblog-blog:v1.0.0
golovin0623/aetherblog-blog:latest

golovin0623/aetherblog-admin:v1.0.0
golovin0623/aetherblog-admin:latest
```

**支持的 tag 格式:**
- `v1.0.0` - 标准语义化版本
- `v1.0.0-beta.1` - 预发布版本
- `v1.0.0-rc.1` - 候选发布版本
- `hotfix-login` - 自定义标签
- 任何字符串都可以作为 tag

---

### 规则 3: 手动触发 (自定义版本)

**触发方式:**
1. 进入 GitHub Actions 页面
2. 选择 "Build and Push Docker Images" 工作流
3. 点击 "Run workflow"
4. 输入自定义版本号 (例如: `hotfix-login`)

**版本号逻辑:**
```bash
VERSION=${{ github.event.inputs.version }}
# 使用用户输入的版本号
```

**生成的镜像标签:**
```
golovin0623/aetherblog-backend:hotfix-login
golovin0623/aetherblog-backend:latest
```

---

## 🔍 版本号决策流程图

```
开始
  │
  ├─ 是否是 tag 触发? (refs/tags/*)
  │   ├─ 是 → VERSION = tag 名称 (例如: v1.0.0)
  │   └─ 否 ↓
  │
  ├─ 是否是手动触发且有输入版本?
  │   ├─ 是 → VERSION = 用户输入 (例如: hotfix-login)
  │   └─ 否 ↓
  │
  └─ 默认 → VERSION = main-{commit-sha} (例如: main-a1b2c3d)
```

---

## 📊 版本号对照表

| 触发方式 | Git 操作 | 版本号示例 | 镜像标签示例 |
|---------|---------|-----------|-------------|
| **推送到 main** | `git push origin main` | `main-a1b2c3d` | `backend:main-a1b2c3d`<br>`backend:latest` |
| **创建 tag** | `git tag v1.0.0`<br>`git push origin v1.0.0` | `v1.0.0` | `backend:v1.0.0`<br>`backend:latest` |
| **预发布 tag** | `git tag v1.0.0-beta.1`<br>`git push origin v1.0.0-beta.1` | `v1.0.0-beta.1` | `backend:v1.0.0-beta.1`<br>`backend:latest` |
| **热修复 tag** | `git tag hotfix-login`<br>`git push origin hotfix-login` | `hotfix-login` | `backend:hotfix-login`<br>`backend:latest` |
| **手动触发** | GitHub Actions 页面输入 | `custom-version` | `backend:custom-version`<br>`backend:latest` |

---

## 🎯 实际示例

### 示例 1: 日常开发推送

```bash
# 开发完成,推送到 main
git add .
git commit -m "feat: add new feature"
git push origin main

# GitHub Actions 自动构建
# Commit SHA: e79b555a1b2c3d4e5f6g7h8i9j0

# 生成的镜像:
# ✅ golovin0623/aetherblog-backend:main-e79b555
# ✅ golovin0623/aetherblog-backend:latest
# ✅ golovin0623/aetherblog-blog:main-e79b555
# ✅ golovin0623/aetherblog-blog:latest
# ✅ golovin0623/aetherblog-admin:main-e79b555
# ✅ golovin0623/aetherblog-admin:latest
```

### 示例 2: 正式版本发布

```bash
# 准备发布 v1.0.0
git checkout main
git pull origin main

# 创建版本标签
git tag v1.0.0
git push origin v1.0.0

# GitHub Actions 自动构建

# 生成的镜像:
# ✅ golovin0623/aetherblog-backend:v1.0.0
# ✅ golovin0623/aetherblog-backend:latest
# ✅ golovin0623/aetherblog-blog:v1.0.0
# ✅ golovin0623/aetherblog-blog:latest
# ✅ golovin0623/aetherblog-admin:v1.0.0
# ✅ golovin0623/aetherblog-admin:latest
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

# 合并到 main
git checkout main
git merge hotfix/login-bug

# 创建热修复标签
git tag v1.0.1
git push origin v1.0.1

# 生成的镜像:
# ✅ golovin0623/aetherblog-backend:v1.0.1
# ✅ golovin0623/aetherblog-backend:latest
```

### 示例 4: Beta 测试版本

```bash
# 准备 Beta 版本
git tag v2.0.0-beta.1
git push origin v2.0.0-beta.1

# 生成的镜像:
# ✅ golovin0623/aetherblog-backend:v2.0.0-beta.1
# ✅ golovin0623/aetherblog-backend:latest
```

---

## 🔄 latest 标签的行为

**重要:** `latest` 标签会在每次构建时更新,始终指向最新的构建。

```bash
# 第一次推送
git push origin main
# 生成: backend:main-a1b2c3d, backend:latest (指向 main-a1b2c3d)

# 第二次推送
git push origin main
# 生成: backend:main-b2c3d4e, backend:latest (指向 main-b2c3d4e)

# 创建 tag
git tag v1.0.0
git push origin v1.0.0
# 生成: backend:v1.0.0, backend:latest (指向 v1.0.0)
```

**注意:** 如果你想使用固定版本,不要使用 `latest`,而是使用具体的版本号!

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
