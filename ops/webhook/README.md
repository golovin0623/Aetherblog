# AetherBlog Webhook 部署器

这个目录提供"部署成功才返回 200"的 webhook 方案，解决 GitHub Actions 绿灯但服务器未更新的问题。

## 文件说明

- `deploy.sh`：支持 full / incremental / canary / rollback 四种部署模式。
- `webhook_server.py`：解析 CI 传来的 `{"services": "backend blog"}` JSON，按需触发增量或全量部署。
- `deploy-webhook.service`：systemd 服务模板（**反映生产现状**，不是 PR #459 加固设计）。

## 当前部署形态（必读）

| 维度 | 当前生产 | 备注 |
| --- | --- | --- |
| 运行用户 | `webhook` (无 shell, 加入 `docker` 组) | 使用无特权用户运行服务；`deploy.sh` 子进程靠 `docker` 组拿到 docker socket 权限 |
| Webhook 代码目录 | `/var/lib/aetherblog/webhook` | 由 ExecStart 加载；**不是**仓库工作树，安装时由 `cp` 同步 |
| 仓库工作树 (`PROJECT_DIR`) | `/var/lib/aetherblog/repo` | `deploy.sh` 在这里 `git fetch + reset --hard FETCH_HEAD`；与 `ProtectHome=true` 兼容 |
| Python 解释器 | 仓库默认 `/usr/bin/python3` | `ProtectHome=true` 后 `/root/.pyenv/...` 不可读；如需自定义版本，装到 `/usr` 或 `/opt` 后 `systemctl edit` 覆盖 `Environment=PYTHON_BIN=...` |
| Python 最低版本 | **3.6** (CentOS 7 / RHEL 7 系统默认就是这个版本) | `webhook_server.py` 顶部注释列了不能用的 3.7+ 语法; 改这个文件时盯一下别误用 `from __future__ import annotations` / 海象运算符 / 内置泛型 |
| 监听地址 | `0.0.0.0:7868` | 仓库 nginx 暂无 `/deploy` 反代 + GitHub Actions 直接 POST 公网 7868；切 127.0.0.1 必须与 nginx 反代 + 改 `DEPLOY_WEBHOOK_URL` 同 PR 落地，不在本 unit 里单方面切换 |
| WEBHOOK_SECRET | `/etc/aetherblog/webhook.env` (`0640 root:webhook`) | 避免密钥出现在 world-readable unit 文件 |
| 部署日志 | `/var/log/aetherblog/deploy.log` | 由 `LogsDirectory=aetherblog` 自动创建并 chown webhook:webhook |
| 部署互斥锁 | `/run/aetherblog/deploy.lock` | 由 `RuntimeDirectory=aetherblog` 自动创建；`webhook_server.py` 与 `deploy.sh` 共享，靠 unit 中的 `LOCK_FILE=` 注入 |
| 请求防挂死 | `WEBHOOK_REQUEST_TIMEOUT=15`, `WEBHOOK_MAX_BODY_BYTES=8192` | 防止公网半开/超大请求占住部署入口 |
| 自动 git sync | `webhook_server.py` 在 spawn `deploy.sh` 之前 `git fetch + reset --hard FETCH_HEAD`；`deploy.sh` 内置 sync 在 webhook 路径下被 `SKIP_GIT_SYNC=true` 跳过 | 直接 `bash deploy.sh` 时仍走 deploy.sh 自带 sync (要求当前用户对 `PROJECT_DIR` 可写) |
| systemd 加固指令 | 已启用 | `NoNewPrivileges` / `ProtectSystem=strict` / `ProtectHome=true` / `RestrictAddressFamilies` / `SystemCallFilter=@system-service` / `MemoryDenyWriteExecute` 等 |

> ⚠️ **从 root 模式迁移**: 之前的 `User=root` + `/root/Aetherblog/webhook` 软链方案与本 unit 不再兼容。一次性迁移步骤见下方「服务器安装步骤」第 1-3 步：建 `webhook` 用户、复制 webhook 代码、把仓库迁到 `/var/lib/aetherblog/repo`。完成迁移后旧 `/root/Aetherblog/webhook` 软链可以删除（不要在新 unit 里继续指向 `/root`，`ProtectHome=true` 会拦死）。

## Repo sync 顺序

代码热更新链路（webhook 路径，PR #525 之后）：

```
GitHub Actions push to main
  → webhook (HTTP POST /deploy)
  → webhook_server.py 在 spawn deploy.sh **之前** 完成 git fetch + reset --hard FETCH_HEAD
    （此时 /var/lib/aetherblog/repo/ 全量更新；deploy.sh 仍执行的是
     /var/lib/aetherblog/webhook/deploy.sh —— 该副本不会随 git sync 自动刷新）
  → webhook_server.py 通过 env["SKIP_GIT_SYNC"]="true" spawn /var/lib/aetherblog/webhook/deploy.sh
  → bash 加载该副本; deploy.sh 内部 sync 被跳过 (作为直接 `bash deploy.sh` 时的 fallback 保留)
  → cd $PROJECT_DIR (=/var/lib/aetherblog/repo) → docker compose pull + 数据库迁移 + up -d
```

### 边界（webhook 路径）

| 改动 | 何时生效 |
| --- | --- |
| `apps/server-go/migrations/*.sql` | 当次部署（镜像里有就跑） |
| `apps/<server-go\|ai-service\|blog\|admin>/**` | 当次部署（CI 重建镜像 → docker pull） |
| `ops/webhook/deploy.sh` | **当次部署**（deploy.sh 末尾 `trap EXIT` → `sync_webhook_files_to_runtime` 自动 cp 到 `/var/lib/aetherblog/webhook/`，再 `systemd-run --on-active=2s` 调度 webhook restart；旧 root 模式因软链 ExecStart 直读仓库，改动也是当次生效，无需 cp） |
| `ops/webhook/webhook_server.py` | **当次部署**（同上，`sync_webhook_files_to_runtime` 把副本 cp 过去后，`restart_webhook_if_stale` 比对 mtime > 进程启动时间触发 systemd-run 调度 +2s 重启）|
| `ops/webhook/deploy-webhook.service` | **手工**（unit 文件不在 ExecStart 路径下，无法在 ProtectSystem=strict 沙箱里自己写 `/etc/systemd/system/`）：`sudo cp /var/lib/aetherblog/repo/ops/webhook/deploy-webhook.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart deploy-webhook` |

### Sacrificial first deploy 现象（仅限直接调用 deploy.sh，**不影响 webhook 路径**）

如果你**绕过 webhook 直接 `bash deploy.sh`**（手动跑 / cron 调度等），deploy.sh 的内部 git sync 会被启用。但 deploy.sh 顶部 `exec > >(tee ...)` + `exec 200>$LOCK_FILE` + `flock 200` 与 process substitution 叠加，无法在 sync 之后安全 re-exec 自己（会触发 fd 200 锁混乱 / flock 死锁）。所以代码选择"sync 写盘 + 用旧 in-memory bash 文本跑完本次部署"——**直接调用路径**下，任何 `deploy.sh` 自身的修改都需要"牺牲"一次部署才能生效。

webhook 路径**不受此限制**：
1. webhook_server.py 在 spawn deploy.sh 之前已经完成 git sync，deploy.sh 进程加载的就是磁盘上的新版本（PR #525 的根本动因）。
2. webhook_server.py 自己的改动也是**当次生效**：deploy.sh 末尾 `trap EXIT` → `sync_webhook_files_to_runtime` cp 到 `/var/lib/aetherblog/webhook/` → `restart_webhook_if_stale` 用 `systemd-run --on-active=2s` 调度自动重启（`KillMode=control-group` 不会误伤 transient unit；2s 是为了让本次 webhook 把 200 写完再翻进程）。详细历史与坑见 `deploy.sh` 末尾「Post-deploy hooks 设计原理」注释块。

## 部署模式

| 模式 | 触发方式 | 行为 |
|------|---------|------|
| **incremental** | CI 检测到部分模块变更 | 只 pull + restart 变更的服务, `--no-deps` 跳过中间件 |
| **full** | CI 未传 services / 手动触发 | 全量 pull + up -d (含中间件健康检查等待) |
| **canary** | 手动设置 `DEPLOY_MODE=canary` | 指定服务灰度部署 |
| **rollback** | 手动设置 `DEPLOY_MODE=rollback` | 回滚到指定版本 |

## 服务器安装步骤

### 一键脚本（推荐）

仓库根目录下：

```bash
# 全新机器 (从当前 checkout 直接 rsync 过去, 适合 fresh install)
sudo ./ops/bootstrap-webhook.sh

# 从旧 root 模式 /root/Aetherblog 迁移过来
sudo ./ops/bootstrap-webhook.sh --from /root/Aetherblog

# 复用现有 secret (从其它服务器拷过来时)
sudo ./ops/bootstrap-webhook.sh --secret "<32+ hex>"

# 只看会做什么, 不实际执行
sudo ./ops/bootstrap-webhook.sh --dry-run
```

脚本幂等：会检测已存在的用户/目录/secret 文件并跳过对应步骤，重复执行安全。

执行完毕后：
1. 把脚本最后打印的 `WEBHOOK_SECRET` 同步到 GitHub Actions repo secret `DEPLOY_WEBHOOK_SECRET`
2. 设置 GitHub Actions repo secret `DEPLOY_WEBHOOK_URL` = `http://<server-public-ip>:7868/deploy`
3. 推一个 trivial commit 触发 CI, 用 `journalctl -u deploy-webhook -f` 观察自动部署

### 手动步骤（仅供理解 / 调试参考，正常路径走上面的脚本）

> 假设你在仓库 checkout 路径下执行 (例如临时 clone 到 `/tmp/aetherblog-src`)。安装结束后 `PROJECT_DIR` 会接管为 `/var/lib/aetherblog/repo`。下面命令按 root shell 展示; 非 root 手工执行时需要给系统级命令加 `sudo`。

```bash
# 1) 创建 webhook 系统用户 (无 shell, 不创建 home), 并加入 docker 组
#    deploy.sh 子进程靠 docker 组拿 /var/run/docker.sock 权限
getent group webhook >/dev/null || groupadd --system webhook
id webhook >/dev/null 2>&1 || useradd --system --gid webhook \
  --home-dir /var/lib/aetherblog/webhook --no-create-home \
  --shell /usr/sbin/nologin webhook
usermod -aG docker webhook

# 2) 准备目录骨架
install -d -m 0755 -o root    -g root    /var/lib/aetherblog
install -d -m 0750 -o webhook -g webhook /var/lib/aetherblog/webhook
install -d -m 0750 -o webhook -g webhook /var/lib/aetherblog/repo
install -d -m 0750 -o root    -g webhook /etc/aetherblog
# /var/log/aetherblog: LogsDirectory= 在 systemd 235+ 才有, CentOS 7 systemd 219
# 不识别 → 需要在 install 阶段手动 chown.
install -d -m 0750 -o webhook -g webhook /var/log/aetherblog

# 3) 同步仓库到 PROJECT_DIR
#    - 全新机器: 直接克隆
#    - 已有 /root/Aetherblog 的迁移机器: 用 rsync 把现有仓库搬过去, 保留 .env
#    - 私有仓库 fresh install: 先在 /root/Aetherblog 准备一份有权限的 checkout,
#      或把下面 clone URL 改成 git@github.com:golovin0623/Aetherblog.git / 带认证的 HTTPS。
#      运行时仍需执行 3.1 给 webhook 用户配置 Deploy Key。
if [ ! -d /var/lib/aetherblog/repo/.git ]; then
  if [ -d /root/Aetherblog/.git ]; then
    rsync -aH --exclude='node_modules' --exclude='.next' --exclude='__pycache__' \
      /root/Aetherblog/ /var/lib/aetherblog/repo/
  else
    git clone https://github.com/golovin0623/Aetherblog.git \
      /var/lib/aetherblog/repo
  fi
fi
chown -R webhook:webhook /var/lib/aetherblog/repo

# 3.1) 私有仓库访问: deploy-webhook.service 以 webhook 用户运行,
#      不能复用 /root/.ssh。给 webhook 用户配置只读 GitHub Deploy Key。
sudo install -d -m 0700 -o webhook -g webhook /var/lib/aetherblog/webhook/.ssh
if [ ! -f /var/lib/aetherblog/webhook/.ssh/id_ed25519 ]; then
  sudo -u webhook -H ssh-keygen -t ed25519 \
    -C "aetherblog-deploy-webhook" \
    -f /var/lib/aetherblog/webhook/.ssh/id_ed25519 \
    -N ""
fi
sudo -u webhook -H cat /var/lib/aetherblog/webhook/.ssh/id_ed25519.pub
# 把上面公钥添加到 GitHub 仓库 Settings -> Deploy keys, 不勾选 write access。
sudo -u webhook -H ssh-keyscan github.com | sudo tee -a /var/lib/aetherblog/webhook/.ssh/known_hosts >/dev/null
sudo chown -R webhook:webhook /var/lib/aetherblog/webhook/.ssh
sudo chmod 0700 /var/lib/aetherblog/webhook/.ssh
sudo chmod 0600 /var/lib/aetherblog/webhook/.ssh/id_ed25519
sudo chmod 0644 /var/lib/aetherblog/webhook/.ssh/id_ed25519.pub
sudo chmod 0644 /var/lib/aetherblog/webhook/.ssh/known_hosts

# CentOS 7 自带 Git 可能不支持 `git -C`; 排障与验证统一使用 cd 写法。
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git remote set-url origin git@github.com:golovin0623/Aetherblog.git'
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git fetch --quiet --tags origin main'

# 4) 同步 webhook 代码到 ExecStart 路径
#    只复制 webhook server 启动需要的文件, 仓库元数据和其它无关文件不要进 webhook 目录
install -m 0755 -o webhook -g webhook \
  ops/webhook/webhook_server.py ops/webhook/deploy.sh \
  /var/lib/aetherblog/webhook/

# 5) 生成 secret 并写入 EnvironmentFile
WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "$WEBHOOK_SECRET"   # 同步给 GitHub Actions 的 DEPLOY_WEBHOOK_SECRET

umask 077
cat > /etc/aetherblog/webhook.env <<EOF
WEBHOOK_SECRET=${WEBHOOK_SECRET}
EOF
chmod 0640 /etc/aetherblog/webhook.env
chown root:webhook /etc/aetherblog/webhook.env
unset WEBHOOK_SECRET

# 6) 安装 systemd unit + 自重启 path/service pair, 并启动
#    - 清掉旧 systemctl edit override, 否则 ExecStart 可能被覆盖回 /root/.pyenv 或老路径
#    - aetherblog-webhook-restart.{path,service} 是 root 端的 self-restart helper:
#      User=webhook 跑的 deploy.sh 没有 systemctl restart 权限, 改为 touch
#      /run/aetherblog/restart-webhook 让 path-unit 触发 root service-unit 来 restart
rm -rf /etc/systemd/system/deploy-webhook.service.d
cp ops/webhook/deploy-webhook.service /etc/systemd/system/deploy-webhook.service
cp ops/webhook/aetherblog-webhook-restart.path \
   /etc/systemd/system/aetherblog-webhook-restart.path
cp ops/webhook/aetherblog-webhook-restart.service \
   /etc/systemd/system/aetherblog-webhook-restart.service
systemctl daemon-reload
systemctl enable aetherblog-webhook-restart.path
systemctl start aetherblog-webhook-restart.path
systemctl enable deploy-webhook
systemctl restart deploy-webhook
systemctl status deploy-webhook --no-pager
```

> **代码热更新如何到达 webhook 目录**: `webhook_server.py` 收到 webhook 时先 `git fetch + reset --hard FETCH_HEAD` 到 `/var/lib/aetherblog/repo`，spawn `/var/lib/aetherblog/webhook/deploy.sh`。deploy.sh 末尾 `trap _post_deploy_hooks EXIT` 调用 `sync_webhook_files_to_runtime`，把 repo 下的 `ops/webhook/{deploy.sh,webhook_server.py}` cp 到 `/var/lib/aetherblog/webhook/`，再调 `restart_webhook_if_stale` 用 `systemd-run --on-active=2s` 调度延迟 restart。下次部署起来就是新代码了；deploy.sh / webhook_server.py 改动当次部署即生效，不再需要手动 cp + systemctl restart（详见下表）。

> **从旧 root 模式迁移**: 旧装法把代码软链到 `/root/Aetherblog/webhook`、内联 `WEBHOOK_SECRET` 到 unit。一键脚本支持 `--from /root/Aetherblog`，会自动 rsync 过去 + 清掉旧 systemctl override + 切到 webhook user。完成后旧 `/root/Aetherblog` 改名留底、加个 symlink `ln -sfn /var/lib/aetherblog/repo /root/Aetherblog` 保留 muscle memory。旧 secret 一并到 GitHub Settings → Secrets 轮换。

## GitHub Actions Secrets

| Secret | 值 |
| --- | --- |
| `DEPLOY_WEBHOOK_URL` | 当前直连形态: `http://<server-public-ip>:7868/deploy`; 若已配置 nginx/HTTPS 反代, 用 `https://deploy.example.com/deploy` |
| `DEPLOY_WEBHOOK_SECRET` | 上面生成的 32 字节十六进制 secret |

CI 用 HMAC-SHA256 给请求体签名, 头部 `X-Hub-Signature-256: sha256=<hex>`. 详见 `.github/workflows/ci-cd.yml` 的 deploy job.

## Webhook Secret 轮换

触发条件:

- secret 被贴到聊天、日志、工单或截图里。
- 怀疑 GitHub Actions Secret / systemd unit 被泄露。
- 例行安全轮换。

轮换原则:

- 生成 32 字节随机 secret, hex 后为 64 个字符。
- 同一个新值必须同时更新服务器 systemd 与 GitHub Actions Secret。
- 不要把新 secret 写入仓库、聊天记录或明文运维文档。

```bash
# 1) 在服务器生成新 secret
NEW_SECRET="$(openssl rand -hex 32)"
echo "$NEW_SECRET"

# 2) 更新 /etc/aetherblog/webhook.env 里的 WEBHOOK_SECRET
cp /etc/aetherblog/webhook.env \
  /etc/aetherblog/webhook.env.bak.$(date +%Y%m%d%H%M%S)

cat > /etc/aetherblog/webhook.env <<EOF
WEBHOOK_SECRET=${NEW_SECRET}
EOF
chmod 0640 /etc/aetherblog/webhook.env
chown root:webhook /etc/aetherblog/webhook.env

systemctl restart deploy-webhook.service

# 3) 本机未签名探测: 应快速返回 401 Invalid signature
curl --noproxy '*' -i --max-time 5 -X POST http://127.0.0.1:7868/deploy

# 4) 签名探测: 使用非法服务名, 应返回 400 Invalid services field, 不会触发部署
body='{"services": "__probe__"}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$NEW_SECRET" -hex | awk '{print $NF}')
printf '%s' "$body" | curl --noproxy '*' -i --max-time 5 -X POST \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$sig" \
  --data-binary @- \
  http://127.0.0.1:7868/deploy

# 5) 更新 GitHub Secret 后, 再清理当前 shell 里的敏感变量
# unset NEW_SECRET body sig
```

第 5 步前, 在 GitHub 仓库页面更新同一个值:

```
Settings → Secrets and variables → Actions
→ DEPLOY_WEBHOOK_SECRET → Update
```

如果当前机器已登录 `gh`, 也可以用命令更新:

```bash
printf '%s' "$NEW_SECRET" | gh secret set DEPLOY_WEBHOOK_SECRET \
  --repo golovin0623/Aetherblog \
  --body-file -
```

同时确认 `DEPLOY_WEBHOOK_URL` 仍与当前入口匹配: 默认直连为
`http://<server-public-ip>:7868/deploy`; 若已落地 nginx/HTTPS 反代, 才使用
`https://<your-domain>/deploy`。不要填 `:7869`, 不要填 gateway/blog 域名,
也不要把 secret 放进 URL 路径。

GitHub 更新完成并确认后, 再清理当前 shell 里的敏感变量:

```bash
unset NEW_SECRET body sig
```

## 验证

```bash
# 健康检查 (HMAC 不通过, 应返回 401)
curl --noproxy '*' -i -X POST http://127.0.0.1:7868/deploy

# 用真 secret 触发增量部署
WEBHOOK_SECRET=<64-hex-secret>
body='{"services": "backend gateway"}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $NF}')
printf '%s' "$body" | curl --noproxy '*' -i -X POST \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$sig" \
  --data-binary @- \
  http://127.0.0.1:7868/deploy

# 查看 webhook 服务日志
journalctl -u deploy-webhook -n 100 --no-pager

# 查看部署脚本日志 (LogsDirectory=aetherblog 创建的目录)
tail -n 100 /var/log/aetherblog/deploy.log
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

3. **repo sync 失败是不是 webhook 用户没有私有仓库权限**:
   ```bash
   sudo systemctl show deploy-webhook.service -p User -p Environment
   sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git remote -v'
   # 可选: 观察 GitHub SSH 认证输出; GitHub 不提供 shell, 这条可能非 0, 不作为最终判定。
   sudo -u webhook -H ssh -T git@github.com || true
   sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git fetch --quiet --tags origin main'
   ```
   如果 CI 返回 `Repo sync failed: Permission denied (publickey)`, 但 root
   下手动 fetch 成功, 说明 SSH key 配到了 `/root/.ssh`。当前 unit 使用
   `User=webhook` 且 `ProtectHome=true`, 必须把只读 deploy key 放到
   `/var/lib/aetherblog/webhook/.ssh/` 并授权给 `webhook:webhook`。CentOS 7
   老 Git 不支持 `git -C`, 所以这里用 `sh -lc 'cd ... && git ...'`。

4. **本机 curl 卡住且没有 journal 日志**:
   ```bash
   env | grep -i proxy || true
   curl --noproxy '*' -i --max-time 5 -X POST http://127.0.0.1:7868/deploy
   ```
   如果这里没有快速返回 `401 Invalid signature`, 说明 webhook 进程可能被半开请求
   占住, 或当前 shell 的代理环境变量把 `127.0.0.1` 请求绕走了。先用
   `--noproxy '*'` 排除代理；仍不返回时再 `systemctl restart deploy-webhook.service`
   恢复入口, 并确认 `webhook_server.py` 已包含线程 server + 请求体超时保护。

5. **数据库迁移到底卡在哪**:
   ```bash
   docker exec aetherblog-postgres psql -U aetherblog -d aetherblog \
     -c "SELECT version, dirty FROM schema_migrations;"
   ```
   如果 dirty=true, 看 deploy.sh 的 self-heal 表 (`_try_heal_known_dirty` 函数) 有没有登记当前 dirty 版本的 recipe.

5. **完整部署日志**:
   ```bash
   tail -200 /var/log/aetherblog/deploy.log
   ```
