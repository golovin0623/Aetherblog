# 06 - 运维 / 监控 / 备份

> 范围:`ops/` 目录全集、容器监控通路、日志聚合、备份机制、preflight 与 post_release_observer 的报告产出。

---

## 1. ops/ 目录树

```
ops/
├── bootstrap-webhook.sh             ← webhook 服务器一键安装(294 行)
├── release/
│   ├── preflight.sh                 ← 部署前后健康验证(257 行)
│   ├── post_release_observer.sh     ← AI 可观测性指标采集(115 行)
│   └── reports/
│       └── 2026-02-13-ai-observability-hourly.csv   ← 历史样本
└── webhook/
    ├── README.md                    ← webhook 部署完整说明(全模块最长文档)
    ├── deploy.sh                    ← 五段式部署(634 行)
    ├── webhook_server.py            ← HMAC 验签(469 行)
    ├── deploy-webhook.service       ← 主 systemd unit(108 行)
    ├── aetherblog-webhook-restart.path     ← 文件监听(17 行)
    ├── aetherblog-webhook-restart.service  ← 自重启 helper(19 行)
    └── test_webhook_server.py       ← unit test
```

`ops/release/preflight.sh` 与 `ops/webhook/deploy.sh` / `webhook_server.py` 在 `04-ci-cd.md` 已展开,本文档聚焦 **运维 / 监控 / 备份** 视角。

---

## 2. 容器监控通路

### 2.1 整体架构

admin 后台 "容器监控" 面板(`/v1/admin/monitor/*`)读取 Docker 统计数据。**默认部署不启用** —— 需要显式 opt-in:

```bash
# 1. .env 加上
DOCKER_SOCKET_PROXY_URL=http://docker-socket-proxy:2375

# 2. compose 启动加 profile
docker-compose -f docker-compose.prod.yml --profile with-monitor up -d
```

不开 profile 时面板显示 "Docker API 不可用"(预期行为)。

### 2.2 docker-socket-proxy 加固

`docker-compose.prod.yml:160-214`:

```yaml
docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:0.3.0
    profiles: [with-monitor]
    environment:
        # 默认全部 0,只放开容器监控真正需要的 GET 子集
        CONTAINERS: 1
        INFO: 1
        # 显式声明禁用一切写操作(默认即 0,留作审计可见性)
        POST: 0
        EXEC: 0
        BUILD: 0
        COMMIT: 0
        VOLUMES: 0
        IMAGES: 0
        NETWORKS: 0
        SYSTEM: 0
        AUTH: 0
        SECRETS: 0
        SERVICES: 0
        SWARM: 0
        TASKS: 0
        NODES: 0
        PLUGINS: 0
        CONFIGS: 0
        DISTRIBUTION: 0
        SESSION: 0
    volumes:
        - /var/run/docker.sock:/var/run/docker.sock:ro
    expose:
        - "2375"           # 不映射宿主端口
    security_opt:
        - no-new-privileges:true
    cap_drop:
        - ALL
    cap_add:
        - CHOWN              # haproxy drop privileges
        - SETUID
        - SETGID
    read_only: true
    tmpfs:
        - /run:rw,size=4M,mode=0755
        - /tmp:rw,size=4M,mode=1777
    deploy.resources.limits.memory: 32M
```

API 表面**收紧到容器监控所需的最小权限**:
- `GET /containers/json`(列容器)
- `GET /containers/*/stats`(实时统计)

其余全部拒绝 → POST=0 杜绝 exec/启停容器,VOLUMES=0 / IMAGES=0 / NETWORKS=0 阻止信息探测。

### 2.3 历史变迁

之前 backend 直接 bind-mount `/var/run/docker.sock:ro`(`docker-compose.prod.yml:266-268` 注释):**:ro 仍授予宿主 root 等价权限**。改为代理后:
- backend 只看到 HTTP API,通过 `aetherblog-network` 访问代理
- 代理只挂 socket 自己(`/var/run/docker.sock:/var/run/docker.sock:ro`)
- backend 不再有任何 docker socket 访问能力

### 2.4 fallback:`DOCKER_ENDPOINT` 直连

`.env.example:166-171`:

```
# DOCKER_ENDPOINT=unix:///var/run/docker.sock
```

可选替代,优先级**高于** `DOCKER_SOCKET_PROXY_URL`。用于 `./start.sh` 本地 dev 时 backend 跑宿主机进程,直接读 host socket(macOS Docker Desktop 通常 `/Users/<you>/.docker/run/docker.sock`)。生产**禁止**这种用法。

---

## 3. 日志聚合

### 3.1 容器内日志路径

| 服务 | 容器内路径 | 数据卷 | 共享 |
| --- | --- | --- | --- |
| backend | `/app/logs` | `aetherblog_logs` | 与 ai-service 共享 |
| ai-service | `/app/logs` | `aetherblog_logs` | 与 backend 共享 |
| nginx-gateway | `/var/log/nginx/`(默认) | 无 | 仅容器内 |
| postgres | `/var/log/postgresql/`(默认) | 无 | 仅容器内 |

### 3.2 共享 logs 卷的 owner 设计

backend 与 ai-service 都用 UID 1001 / GID 1001(`apps/server-go/Dockerfile:34` + `apps/ai-service/Dockerfile:19-23`),并 `chmod 0775 /app/logs` 让 group 也可写。

设计原因(`apps/server-go/Dockerfile:32-35` / `apps/ai-service/Dockerfile:15-23` 注释):**named volume 初始化时按 image 主组,但运行时容器主组可能因 `group_add`(老版本挂 docker socket)不同**。0775 让 group 也可写,避免 EACCES。

### 3.3 日志级别在线调整

启动时由 `.env` 注入:
- `AETHERBLOG_LOG_LEVEL`(backend zerolog,默认 info)
- `AI_LOG_LEVEL`(ai-service Python logging,默认 info)

运行时 `PUT /v1/admin/system/log-level` 在线切换(进程重启回到 .env 值)。这条接口会**同步**调整 backend + ai-service(backend 转发到 ai-service)。

### 3.4 日志聚合(待补)

仓库**没有内置日志聚合**(无 Loki / Elasticsearch / OpenTelemetry collector)。`start.sh:50` 提到 `OPTIONAL_MIDDLEWARE_SERVICES=("elasticsearch")`,但当前 `docker-compose.yml` 中**并没有 elasticsearch 服务**,这是**历史遗留代码**。

宿主机日志:
- `logs/startup.log`、`logs/shutdown.log`(start.sh / stop.sh tee 输出)
- `logs/{backend,ai-service,blog,admin}.log`(各服务 nohup 重定向)
- `/var/log/aetherblog/deploy.log`(生产 webhook 部署日志)

---

## 4. 备份

### 4.1 数据库备份

仓库**没有内置 PostgreSQL 备份脚本**。建议外部 cron + `pg_dump`:

```bash
# 示例(本仓库未提供,需运维自备)
docker exec aetherblog-postgres \
    pg_dump -U aetherblog -d aetherblog --format=custom \
    > /backup/aetherblog-$(date +%Y%m%d).pgdump
```

### 4.2 用户上传文件备份

两条路径:

#### 4.2.1 named volume 直接备份

```bash
docker run --rm \
    -v aetherblog_uploads:/data:ro \
    -v $(pwd):/backup \
    alpine tar czf /backup/uploads-$(date +%Y%m%d).tar.gz /data
```

#### 4.2.2 切外部对象存储

`.env.example:117-144` 描述完整流程:

1. admin 后台 `/settings` → "存储管理" tab → 添加云 provider(S3 / COS / OSS / R2 / MinIO)
2. 填 bucket / region / accessKeyId / secretAccessKey,**secretAccessKey 会 Fernet 加密落库**(复用 `AI_CREDENTIAL_ENCRYPTION_KEYS`)
3. 测试连接(HeadBucket)→ 设为默认
4. 之后新上传自动入云

存量文件镜像:
- 媒体页 "备份到云" 按钮 → 立即批量备份未关联文件
- 失败任务可在抽屉里逐条重试,后端 `max_attempt=3` 后自动放弃
- 自动后台备份 `site_settings.storage.sync.auto_enabled = true` 开启(默认关,避免存量切云一次性灌爆 bucket)

### 4.3 反向管理

admin "云端浏览":
- 选 provider 查 bucket 内容
- 已入库的 key 显示 `✓ 已入库`,catalog 之外的显示 `⚠ 孤儿`
- 可批量导入或删除孤儿

### 4.4 启动时密文修复

`.env.example:135-138`:**启动时若检测到 legacy 明文行,自动加密重写为 `enc:v1:` 形态**。没配 `AI_CREDENTIAL_ENCRYPTION_KEYS` 时退化为透传(开发模式),不阻塞 startup。

---

## 5. AI 可观测性 — `post_release_observer.sh`

`ops/release/post_release_observer.sh`(115 行):

### 5.1 用途

按小时采集 AI 关键指标到 CSV,失控时报警。

### 5.2 数据源

```bash
GATEWAY_BASE_URL=http://127.0.0.1:7899
fetch_json $GATEWAY_BASE_URL/api/v1/admin/stats/ai-dashboard?days=1&pageNum=1&pageSize=20
fetch_json $GATEWAY_BASE_URL/api/v1/admin/metrics/ai
```

### 5.3 提取指标

```
total_calls         = .data.overview.totalCalls
error_calls         = .data.overview.errorCalls
metric_requests     = .data.total.requests
usage_failures      = .data.usage_logging.failures_total

error_rate          = error_calls / total_calls
empty_ratio         = (total_calls <= 0) ? 1 : 0
usage_failure_ratio = usage_failures / metric_requests
usage_success_rate  = 1 - usage_failure_ratio
```

### 5.4 阈值告警

```
ALERT_ERROR_RATE_THRESHOLD=0.05            (5% 错误率)
ALERT_EMPTY_RATIO_THRESHOLD=0.20           (20% 空数据)
ALERT_USAGE_LOG_FAILURE_RATIO_THRESHOLD=0.02 (2% usage_logging 失败)
```

任一超阈 → `status=warning`,否则 `healthy`。

### 5.5 输出

`ops/release/reports/<YYYY-MM-DD>-ai-observability-hourly.csv`:

```csv
timestamp,total_calls,error_calls,error_rate,empty_data_ratio,usage_log_failures,usage_log_failure_ratio,usage_log_success_rate,status
```

### 5.6 sample 模式

```bash
./post_release_observer.sh --sample   # 用内置桩数据,不真实请求 API
```

### 5.7 运行方式

仓库**没有内置 cron 配置**,需要运维 systemd timer 或 crontab:

```bash
# 示例(本仓库未提供)
0 * * * * cd /var/lib/aetherblog/repo && \
    AUTH_HEADER="Authorization: Bearer ${ADMIN_TOKEN}" \
    ./ops/release/post_release_observer.sh
```

---

## 6. 容器资源限制

`docker-compose.prod.yml` 各服务 `deploy.resources.limits.memory`:

| 服务 | limit | reservation | 行号 |
| --- | --- | --- | --- |
| gateway | 64M | 32M | 70-74 |
| postgres | 512M | 256M | 105-108 |
| redis | 128M | — | 141-142 |
| docker-socket-proxy | 32M | 16M | 209-214 |
| backend | 128M | 32M | 292-297 |
| ai-service | 768M | 256M | 376-380 |
| blog | 512M | 256M | 414-418 |
| admin | 128M | 64M | 442-446 |

ai-service 768M 是因为 litellm + asyncpg + pgvector 模块加载占内存大。

注意 docker-compose v2 在非 swarm 模式下,`deploy.resources.limits` **被忽略**(只有 swarm 才生效)。本仓库依赖 docker-compose 的 v2 spec 不会强制 limit,需要手动用 `mem_limit` 替代或上 swarm。**实际行为**:这些 limit 只是文档化意图,运行时不强制。

---

## 7. 优雅停机

### 7.1 容器层

docker compose `restart: unless-stopped` 是**默认**(`docker-compose.prod.yml:35` 等),意味着:
- `docker stop` / `docker compose down` 不会自动 restart
- 主机重启后会自动 up(unless 用户显式 stop 过)

### 7.2 应用层 SIGTERM 处理

backend(Go Echo)与 ai-service(uvicorn)都支持 SIGTERM 优雅退出。docker compose `up -d` 重建容器走的就是 SIGTERM → 10s 超时 → SIGKILL 流程。

### 7.3 incremental deploy 的优雅性

`docker compose up -d --no-deps backend gateway`:
- backend 接收 SIGTERM → 处理完 in-flight 请求 → 退出
- 新 backend 启动 → healthy → 加入 nginx upstream
- nginx 通过 `max_fails=3 fail_timeout=10s` 探测,失败时把流量切到新实例

无 zero-downtime 保证(单 host single-replica),但通过 health check + start_period 30s 把窗口缩到 ~5-10s。

---

## 8. 系统时间 / 时区

backend 镜像 `apps/server-go/Dockerfile:21` `apk add tzdata`,但**没有显式设 TZ**。容器默认 UTC。

如果业务依赖 local time,在 `docker-compose.prod.yml` 的 backend `environment:` 加:

```yaml
TZ: Asia/Shanghai
```

ai-service 类似(Python `datetime` 默认 UTC)。

---

## 9. 端口防火墙建议(VULN-122 回退后)

`docker-compose.prod.yml:90-93,127-128,402,433` 把以下端口绑定到 `0.0.0.0`:

| 端口 | 服务 | 风险 | 建议防火墙 |
| --- | --- | --- | --- |
| 7899 | gateway | 公网入口,无可避免 | 允许 |
| 7893 | blog 直连 | 跳过网关,绕开 CSP / 限流 / cookie 设置 | iptables only |
| 7894 | admin 直连 | 同上,且暴露 admin SPA | iptables only / 内网 |
| 7895 | postgres | 远程 DBA;有强密码,但缺安全更新就有 CVE 风险 | iptables only(白名单 DBA IP)|
| 6379 | redis | 有 requirepass,但无 ACL 隔离 | iptables only |
| 7868 | webhook | HMAC 兜底,但仍可被扫描 | iptables only(GitHub IP 段)/ nginx 反代 |

注释里 explicit:**"运维侧必须通过 host 防火墙 + pg_hba.conf 限制来源 IP;若部署拓扑是单机自用,推荐改为 `127.0.0.1:${POSTGRES_PORT:-7895}:5432`"**(`docker-compose.prod.yml:91-92`)。

---

## 10. preflight 报告

`ops/release/preflight.sh` 输出格式(stdout):

```
[INFO] preflight started at 2026-05-08T10:30:00+08:00
[PASS] [env]       command available: docker
[PASS] [env]       command available: curl
[PASS] [compose]   docker compose config valid (docker-compose.prod.yml)
[PASS] [runtime]   docker daemon reachable
[PASS] [runtime]   service running: postgres
[PASS] [runtime]   service running: backend
...
[FAIL] [migration] ai_models count too low: 1543 (< 1591)
...
[INFO] preflight summary: pass=12 fail=1 skip=2
[ERROR] preflight failed
```

执行:
- 部署前 `--no-runtime`(deploy.sh:198)
- 部署后**完整模式**(deploy.sh:620-628 trap 之后)

`PREFLIGHT_BLOCK=true`(默认)失败 exit 1;`PREFLIGHT_BLOCK=false` 仅 warn,继续。

---

## 11. 已知限制

1. **没有内置 PostgreSQL 备份脚本** — 运维必须自行 cron + pg_dump,且没有 PITR 配置。
2. **`.dockerignore` 排除 `*.md`**(`apps/blog/Dockerfile` 等不影响,因为 README.md 白名单),但 builder 看不到 md 文件,**理论上没问题**。
3. **start.sh:50 `OPTIONAL_MIDDLEWARE_SERVICES=("elasticsearch")` 是 dead code** — 当前 compose 文件没有 elasticsearch 服务,但代码仍然处理 `--skip-elasticsearch` 等逻辑。无害但混乱。
4. **`deploy.resources.limits` 在 docker-compose 模式下被忽略** — 本仓库不跑 swarm,所有 memory limit 是 wishful thinking,需要改用 `mem_limit:` 或在 `command:` 里用 cgroup v2 manual 配置。
5. **没有 OpenTelemetry / structured logging shipping** — 日志只在容器卷里,没有 export 到外部 SIEM / Loki / Datadog。
6. **post_release_observer.sh 不阻断部署** — 只生成 CSV 报告,运维需要主动看 / 拉报警系统。当前 reports/ 只有 1 个示例 CSV 文件(2026-02-13)。
7. **docker-hub-cleanup.sh 缺 ai-service**(`docker-hub-cleanup.sh:10`)— 跑这脚本会留 ai-service 镜像未删,Docker Hub 容量回收不彻底。
8. **没有自动化的 secret 轮换 SOP** — 6.2 节列的轮换流程都是手工 SOP,没有 systemd timer 自动定期跑。
9. **gateway 容器 logs 不持久化** — 只在容器内 `/var/log/nginx/`,容器删除即丢。生产建议改 compose 加 `aetherblog_gateway_logs:/var/log/nginx`。
10. **docker compose `name: aetherblog`(prod)与默认 compose 项目名不同** — 如果跑了 `docker-compose -f docker-compose.yml up`(默认 project name = 目录名),再跑 `docker-compose -f docker-compose.prod.yml up`(name=aetherblog),两组卷会分叉。需要明确 project name 一致性。
