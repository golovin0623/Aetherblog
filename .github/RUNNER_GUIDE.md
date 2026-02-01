# GitHub Actions Runners 说明

## 🏗️ GitHub-hosted Runners (默认,推荐)

### 优点:
- ✅ **完全免费** (公开仓库)
- ✅ **零维护** - GitHub 负责维护和更新
- ✅ **干净环境** - 每次构建都是全新的虚拟机
- ✅ **高速网络** - 直连 GitHub 和 Docker Hub
- ✅ **预装工具** - Docker, Git, Node.js, Java, Python 等

### 配置:
```yaml
jobs:
  build:
    runs-on: ubuntu-latest  # GitHub 提供的 Ubuntu 虚拟机
```

### 虚拟机规格:
- **CPU:** 2 核心
- **内存:** 7 GB RAM
- **存储:** 14 GB SSD
- **操作系统:** Ubuntu 22.04, Windows Server 2022, macOS 12

### 费用 (你的公开仓库免费):
| 仓库类型 | 免费配额 | 超出费用 (Linux) |
|---------|---------|-----------------|
| 公开仓库 | ♾️ 无限制 | 免费 |
| 私有仓库 | 2,000 分钟/月 | $0.008/分钟 |

---

## 🖥️ Self-hosted Runners (自托管)

如果你想使用自己的服务器来构建,可以配置 Self-hosted Runners。

### 适用场景:
- 🔒 需要访问内网资源
- 💾 需要更大的存储空间
- ⚡ 需要更强的 CPU/内存
- 🔐 需要特殊的安全配置
- 💰 私有仓库构建量大,想节省费用

### 优点:
- ✅ 完全控制构建环境
- ✅ 可以使用更强的硬件
- ✅ 可以访问内网资源
- ✅ 私有仓库无构建时间限制

### 缺点:
- ❌ 需要自己维护服务器
- ❌ 需要确保安全性
- ❌ 需要处理环境一致性问题

---

## 🚀 配置 Self-hosted Runner

### 1. 在服务器上安装 Runner

```bash
# 创建 runner 目录
mkdir -p ~/actions-runner && cd ~/actions-runner

# 下载最新版本 (以 Linux x64 为例)
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz

# 解压
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz

# 配置 Runner
./config.sh --url https://github.com/golovin0623/AetherBlog --token YOUR_TOKEN

# 安装为系统服务
sudo ./svc.sh install
sudo ./svc.sh start
```

### 2. 获取 Token

1. 进入 GitHub 仓库
2. Settings → Actions → Runners
3. 点击 "New self-hosted runner"
4. 复制显示的 token

### 3. 修改工作流使用 Self-hosted Runner

```yaml
jobs:
  build:
    runs-on: self-hosted  # 使用自托管 Runner
    # 或指定标签
    runs-on: [self-hosted, linux, x64]
```

### 4. Runner 标签

可以给 Runner 添加自定义标签,用于区分不同的构建环境:

```yaml
jobs:
  build-production:
    runs-on: [self-hosted, production, high-memory]

  build-staging:
    runs-on: [self-hosted, staging]
```

---

## 🔄 混合使用

可以同时使用 GitHub-hosted 和 Self-hosted Runners:

```yaml
jobs:
  # 测试使用 GitHub-hosted (快速,免费)
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test

  # 构建使用 Self-hosted (更强性能)
  build:
    needs: test
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t myapp .

  # 部署使用 Self-hosted (访问内网)
  deploy:
    needs: build
    runs-on: [self-hosted, production]
    steps:
      - run: kubectl apply -f deployment.yaml
```

---

## 📊 性能对比

| 特性 | GitHub-hosted | Self-hosted |
|------|--------------|-------------|
| **设置难度** | ⭐ 零配置 | ⭐⭐⭐ 需要配置 |
| **维护成本** | ⭐ 零维护 | ⭐⭐⭐ 需要维护 |
| **构建速度** | ⭐⭐⭐ 中等 | ⭐⭐⭐⭐⭐ 可定制 |
| **费用 (公开仓库)** | ⭐⭐⭐⭐⭐ 免费 | ⭐⭐⭐ 服务器成本 |
| **费用 (私有仓库)** | ⭐⭐⭐ 有配额 | ⭐⭐⭐⭐⭐ 无限制 |
| **安全性** | ⭐⭐⭐⭐ 隔离环境 | ⭐⭐⭐ 需自行保证 |
| **访问内网** | ❌ 不支持 | ✅ 支持 |

---

## 💡 推荐方案

### 对于 AetherBlog 项目:

**推荐使用 GitHub-hosted Runners (默认配置)**

理由:
1. ✅ 公开仓库,完全免费
2. ✅ 零维护成本
3. ✅ 构建速度足够 (5-10 分钟)
4. ✅ 环境干净,可重复
5. ✅ 高速网络,推送镜像快

**何时考虑 Self-hosted:**
- 构建时间超过 30 分钟
- 需要访问内网资源
- 需要特殊的硬件 (GPU, 大内存)
- 私有仓库构建量非常大

---

## 🔍 查看 Runner 状态

### GitHub 网页:
Settings → Actions → Runners

### GitHub CLI:
```bash
# 列出所有 Runners
gh api repos/golovin0623/AetherBlog/actions/runners

# 查看 Runner 详情
gh api repos/golovin0623/AetherBlog/actions/runners/RUNNER_ID
```

---

## 🛡️ Self-hosted Runner 安全建议

如果使用 Self-hosted Runner,请注意:

1. **不要在公开仓库使用 Self-hosted Runner**
   - 任何人都可以提交 PR 并在你的服务器上执行代码
   - 存在严重安全风险

2. **使用专用服务器**
   - 不要在生产服务器上运行 Runner
   - 使用容器或虚拟机隔离

3. **限制权限**
   - Runner 使用专用用户运行
   - 最小权限原则

4. **定期更新**
   - 保持 Runner 软件最新
   - 及时应用安全补丁

5. **监控日志**
   - 监控 Runner 活动
   - 设置异常告警

---

## 📚 相关资源

- [GitHub Actions Runners 官方文档](https://docs.github.com/en/actions/hosting-your-own-runners)
- [Self-hosted Runner 安全指南](https://docs.github.com/en/actions/hosting-your-own-runners/about-self-hosted-runners#self-hosted-runner-security)
- [GitHub Actions 定价](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
