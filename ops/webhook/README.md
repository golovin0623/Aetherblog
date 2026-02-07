# AetherBlog Webhook 部署器

这个目录提供“部署成功才返回 200”的 webhook 方案，解决 GitHub Actions 绿灯但服务器未更新的问题。

## 文件说明

- `deploy.sh`：串行执行 `docker compose pull` + `up -d`，失败会退出非 0。
- `webhook_server.py`：同步执行 `deploy.sh`，按真实结果返回 200/500。
- `deploy-webhook.service`：systemd 服务模板（路径已固定为 `/root/Aetherblog/webhook`）。

## 服务器安装步骤

```bash
# 1) 把脚本复制到服务器项目目录
mkdir -p /root/Aetherblog/webhook
cp ops/webhook/deploy.sh /root/Aetherblog/webhook/
cp ops/webhook/webhook_server.py /root/Aetherblog/webhook/
chmod +x /root/Aetherblog/webhook/deploy.sh

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

## GitHub Secret

把下列 URL 写到仓库 `DEPLOY_WEBHOOK_URL`：

```text
http://<your-server-ip>:7868/deploy/<WEBHOOK_SECRET>
```

## 验证

```bash
# 正确 secret（应返回 200）
curl -i -X POST "http://127.0.0.1:7868/deploy/<WEBHOOK_SECRET>"

# 错误 secret（应返回 403）
curl -i -X POST "http://127.0.0.1:7868/deploy/wrong"

# 查看 webhook 服务日志
journalctl -u deploy-webhook -n 100 --no-pager

# 查看部署脚本日志
tail -n 100 /var/log/aetherblog-deploy.log
```
