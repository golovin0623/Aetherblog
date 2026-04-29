# AetherBlog Webhook 部署器

这个目录提供"部署成功才返回 200"的 webhook 方案，解决 GitHub Actions 绿灯但服务器未更新的问题。

## 文件说明

- `deploy.sh`：支持 full / incremental / canary / rollback 四种部署模式。
- `webhook_server.py`：解析 CI 传来的 `{"services": "backend blog"}` JSON，按需触发增量或全量部署。
- `deploy-webhook.service`：systemd 服务模板。

## Repo sync 顺序（重要）

`webhook_server.py` 在 invoke `deploy.sh` **之前**就完成 `git fetch + git reset --hard FETCH_HEAD`，并通过 `SKIP_GIT_SYNC=true` 关闭 `deploy.sh` 自带的 sync 逻辑。

- **为什么不在 `deploy.sh` 里 sync？** 历史上确实在那里做。`deploy.sh` 顶部有 `exec > >(tee ...)` + `exec 200>$LOCK_FILE` + `flock 200`，叠加 process substitution 后无法在 sync 之后安全 re-exec 自己（双 tee / fd200 锁混乱 / flock 死锁）。为了规避死锁，旧逻辑会"sync 写盘 + 用旧 in-memory bash 文本跑完本次部署"——任何 `deploy.sh` 自身的修改都需要"牺牲"一次部署才能生效。这是反复出现 bug 的根因（PR #521 v38 dirty heal 上线后第一次 incremental 部署就吞掉了新 heal）。
- **现在的边界**：`deploy.sh` 改动 → 立即生效。`webhook_server.py` 改动 → 需要 `systemctl restart deploy-webhook.service`（罕见，安全敏感，值得手动 review）。
- **直接调用 `deploy.sh`（非 webhook 路径）**：`deploy.sh` 内部 sync 仍保留作为 fallback，行为不变。

## 部署模式

| 模式 | 触发方式 | 行为 |
|------|---------|------|
| **incremental** | CI 检测到部分模块变更 | 只 pull + restart 变更的服务，`--no-deps` 跳过中间件 |
| **full** | CI 未传 services / 手动触发 | 全量 pull + up -d（含中间件健康检查等待） |
| **canary** | 手动设置 `DEPLOY_MODE=canary` | 指定服务灰度部署 |
| **rollback** | 手动设置 `DEPLOY_MODE=rollback` | 回滚到指定版本 |

## 服务器安装步骤

```bash
# 1) 用软链接指向仓库目录（git pull 后自动更新，无需手动 cp）
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

> **从旧方式迁移**：如果之前是手动 cp 文件到 `/root/Aetherblog/webhook/`，
> 先删掉旧目录再建软链接：`rm -rf /root/Aetherblog/webhook && ln -sfn ...`

## GitHub Secret

把下列 URL 写到仓库 `DEPLOY_WEBHOOK_URL`：

```text
http://<your-server-ip>:7868/deploy/<WEBHOOK_SECRET>
```

## 验证

```bash
# 增量部署（只重启 backend，不动中间件）
curl -i -X POST -H "Content-Type: application/json" \
  -d '{"services": "backend gateway"}' \
  "http://127.0.0.1:7868/deploy/<WEBHOOK_SECRET>"

# 全量部署（不传 services 则回退 full 模式）
curl -i -X POST "http://127.0.0.1:7868/deploy/<WEBHOOK_SECRET>"

# 错误 secret（应返回 403）
curl -i -X POST "http://127.0.0.1:7868/deploy/wrong"

# 查看 webhook 服务日志
journalctl -u deploy-webhook -n 100 --no-pager

# 查看部署脚本日志
tail -n 100 /var/log/aetherblog-deploy.log
```
