# AetherBlog Webhook 部署器

这个目录提供"部署成功才返回 200"的 webhook 方案，解决 GitHub Actions 绿灯但服务器未更新的问题。

## 文件说明

- `deploy.sh`：支持 full / incremental / canary / rollback 四种部署模式。
- `webhook_server.py`：解析 CI 传来的 `{"services": "backend blog"}` JSON，按需触发增量或全量部署。
- `deploy-webhook.service`：systemd 服务模板（**反映生产现状**，不是 PR #459 加固设计）。

## 当前部署形态（必读）

| 维度 | 当前生产 | 备注 |
| --- | --- | --- |
| 运行用户 | `root` | 接受当前姿态，未上 unprivileged user |
| 工作目录 | `/root/Aetherblog/webhook` → 软链接到 `/root/Aetherblog/ops/webhook` | git pull 后自动同步 |
| Python 解释器 | 仓库默认 `/usr/bin/python3`，**当前生产** `systemctl edit` 覆盖为 `/root/.pyenv/versions/3.9.9/bin/python3`（pyenv） | 通过 `Environment=PYTHON_BIN=...` 调整，无需改 ExecStart |
| Python 最低版本 | **3.6** (CentOS 7 / RHEL 7 系统默认就是这个版本) | `webhook_server.py` 顶部注释列了不能用的 3.7+ 语法; 改这个文件时盯一下别误用 `from __future__ import annotations` / 海象运算符 / 内置泛型 |
| 监听地址 | `0.0.0.0:7868` | **公网可见**, 安全靠 HMAC-SHA256 + 32 字节 secret 兜底 |
| WEBHOOK_SECRET | systemd unit 内联 (sed 替换 placeholder) | 不走 EnvironmentFile |
| 自动 git sync | `deploy.sh` 内部 `git fetch + reset --hard FETCH_HEAD` | 不要设 `SKIP_GIT_SYNC=true`, 否则代码永远不下到服务器 |
| systemd 加固指令 | 无 | 不上 `ProtectSystem` / `ProtectHome` / `SystemCallFilter` 等 |

> ⚠️ **PR #459 安全加固的剩余尾巴**: 仓库历史里有一版加固设计 (`User=webhook` + 独立工作目录 + 路径搬迁), 但跟 `PROJECT_DIR=/root/Aetherblog` 默认值有冲突, 没真正端到端验证, 也没下到生产. 当前姿态接受这一现实. 想做加固开单独 PR, 配合仓库迁出 `/root/`、nginx 前置、webhook 用户创建一起处理.

## Repo sync 顺序

代码热更新链路（webhook 路径，PR #525 之后）：

```
GitHub Actions push to main
  → webhook (HTTP POST /deploy)
  → webhook_server.py 在 spawn deploy.sh **之前** 完成 git fetch + reset --hard FETCH_HEAD
    （此时 /root/Aetherblog/ 全量更新, ops/webhook/{deploy.sh, webhook_server.py} 也已写盘）
  → webhook_server.py 通过 env["SKIP_GIT_SYNC"]="true" spawn deploy.sh
  → bash 加载 deploy.sh 时直接读盘上最新版本
  → deploy.sh 内部 sync 被 env 跳过 (作为直接 `bash deploy.sh` 时的 fallback 保留)
  → docker compose pull + 数据库迁移 + up -d
```

### 边界（webhook 路径）

| 改动 | 何时生效 |
| --- | --- |
| `apps/server-go/migrations/*.sql` | 当次部署（镜像里有就跑） |
| `apps/<server-go\|ai-service\|blog\|admin>/**` | 当次部署（CI 重建镜像 → docker pull） |
| `ops/webhook/deploy.sh` | **当次部署**（webhook 层先 sync，bash 加载的就是新版） |
| `ops/webhook/webhook_server.py` | 需要 `systemctl restart deploy-webhook.service` 才生效 |
| `ops/webhook/deploy-webhook.service` | 需要 `cp` 到 `/etc/systemd/system/` + `systemctl daemon-reload + restart` 才生效 |

### Sacrificial first deploy 现象（仅限直接调用 deploy.sh，**不影响 webhook 路径**）

如果你**绕过 webhook 直接 `bash deploy.sh`**（手动跑 / cron 调度等），deploy.sh 的内部 git sync 会被启用。但 deploy.sh 顶部 `exec > >(tee ...)` + `exec 200>$LOCK_FILE` + `flock 200` 与 process substitution 叠加，无法在 sync 之后安全 re-exec 自己（会触发 fd 200 锁混乱 / flock 死锁）。所以代码选择"sync 写盘 + 用旧 in-memory bash 文本跑完本次部署"——**直接调用路径**下，任何 `deploy.sh` 自身的修改都需要"牺牲"一次部署才能生效。

webhook 路径**不受此限制**——webhook_server.py 在 spawn deploy.sh 之前已经完成 git sync，deploy.sh 进程加载的就是磁盘上的新版本。这也是 PR #525 把 sync 提前到 webhook 层的根本动因。

## 部署模式

| 模式 | 触发方式 | 行为 |
|------|---------|------|
| **incremental** | CI 检测到部分模块变更 | 只 pull + restart 变更的服务, `--no-deps` 跳过中间件 |
| **full** | CI 未传 services / 手动触发 | 全量 pull + up -d (含中间件健康检查等待) |
| **canary** | 手动设置 `DEPLOY_MODE=canary` | 指定服务灰度部署 |
| **rollback** | 手动设置 `DEPLOY_MODE=rollback` | 回滚到指定版本 |

## 服务器安装步骤

```bash
# 1) 用软链接指向仓库目录 (git pull 后自动更新, 无需手动 cp)
ln -sfn /root/Aetherblog/ops/webhook /root/Aetherblog/webhook
chmod +x /root/Aetherblog/ops/webhook/deploy.sh

# 2) 生成新 secret
WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "$WEBHOOK_SECRET"

# 3) 安装 systemd 服务
cp ops/webhook/deploy-webhook.service /etc/systemd/system/deploy-webhook.service
sed -i "s/WEBHOOK_SECRET=change-me/WEBHOOK_SECRET=${WEBHOOK_SECRET}/" /etc/systemd/system/deploy-webhook.service

# 4) 重载并启动
systemctl daemon-reload
systemctl enable deploy-webhook
systemctl restart deploy-webhook
systemctl status deploy-webhook --no-pager
```

> **从旧方式迁移**: 如果之前是手动 cp 文件到 `/root/Aetherblog/webhook/`,
> 先删掉旧目录再建软链接: `rm -rf /root/Aetherblog/webhook && ln -sfn ...`

## GitHub Actions Secrets

| Secret | 值 |
| --- | --- |
| `DEPLOY_WEBHOOK_URL` | `http://<your-server-ip>:7868/deploy` |
| `DEPLOY_WEBHOOK_SECRET` | 上面生成的 32 字节十六进制 secret |

CI 用 HMAC-SHA256 给请求体签名, 头部 `X-Hub-Signature-256: sha256=<hex>`. 详见 `.github/workflows/ci-cd.yml` 的 deploy job.

## 验证

```bash
# 健康检查 (HMAC 不通过, 应返回 401)
curl -i -X POST http://127.0.0.1:7868/deploy

# 用真 secret 触发增量部署
WEBHOOK_SECRET=<your-secret>
body='{"services": "backend gateway"}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $NF}')
curl -i -X POST -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$sig" \
  --data-raw "$body" \
  http://127.0.0.1:7868/deploy

# 查看 webhook 服务日志
journalctl -u deploy-webhook -n 100 --no-pager

# 查看部署脚本日志
tail -n 100 /var/log/aetherblog-deploy.log
```

## 常见诊断

### "Webhook HTTP status: 500" 反复出现

按顺序排查:

1. **systemd 实际加载的 unit 是不是仓库版本**:
   ```bash
   sudo systemctl cat deploy-webhook.service
   ```
   重点看是否有 `Environment=SKIP_GIT_SYNC=true` 这种禁用同步的 env (生产 unit 不该有, 出现就是历史遗留, 删掉 + daemon-reload + restart).

2. **运行进程加载的代码是不是磁盘上的最新版**:
   ```bash
   sudo ps -eo pid,user,cmd | grep webhook_server.py | grep -v grep
   sudo journalctl -u deploy-webhook.service --since "10 minutes ago" --no-pager
   ```

3. **数据库迁移到底卡在哪**:
   ```bash
   docker exec aetherblog-postgres psql -U aetherblog -d aetherblog \
     -c "SELECT version, dirty FROM schema_migrations;"
   ```
   如果 dirty=true, 看 deploy.sh 的 self-heal 表 (`_try_heal_known_dirty` 函数) 有没有登记当前 dirty 版本的 recipe.

4. **完整部署日志**:
   ```bash
   tail -200 /var/log/aetherblog-deploy.log
   ```
