# 06 · 部署与配置

## 范围

- Dockerfile 关键决策
- docker-compose.prod 集成
- 环境变量矩阵(必填 + 可选 + 安全相关)
- 健康检查与启动 banner
- 日志卷 + tmpfs 与只读文件系统加固
- 凭证轮换脚本(`scripts/rotate_credentials.py`)的运维剧本
- 远程 inspect 与本地启动

---

## 1. Dockerfile

`apps/ai-service/Dockerfile`(29 行):

```dockerfile
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY apps/ai-service/requirements.txt ./
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/ai-service/app ./app

# Create non-root user (UID/GID 1001 与 backend 一致)
RUN mkdir -p /app/logs && \
    addgroup --gid 1001 appgroup && \
    adduser --uid 1001 --gid 1001 --disabled-password --gecos "" appuser && \
    chown -R appuser:appgroup /app && \
    chmod 0775 /app/logs

USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

关键决策:

1. **`python:3.12-slim`** — 不是 alpine(`asyncpg` / `pgvector` / `cryptography` 在 musl 上 wheel 缺失)。slim 比 full 镜像小 700MB+。
2. **`curl` 是唯一额外 OS 包** — 用于 `HEALTHCHECK` 命令(详见 §3)。
3. **复制顺序**:`requirements.txt` 先 → `pip install` 形成稳定的中间层 → 最后复制 `app/` 代码。代码改动不会让依赖层失效,build 加速。
4. **UID/GID 1001 与 backend 一致**(`apps/server-go/Dockerfile` 也用 1001) — 共享 logs volume(`aetherblog_logs`)时不会出现 EACCES。
5. **`/app/logs` 0775**:命名卷从 image 初始化时如果运行容器的 primary group ≠ image 的 appgroup(`docker-compose.yml` 用 `group_add` 注入 docker.sock GID 时会发生),仍然 group-writable。
6. **不做 `RUN pip install` 之后清理 pip cache**:已经用 `--no-cache-dir`,无 cache 可清。
7. **不复制 `tests/` / `scripts/`**:运行时不需要;`scripts/rotate_credentials.py` 是离线运维脚本,通过 `docker compose run --rm ai-service python -m scripts.rotate_credentials` 触发,需要时把 scripts/ 一起 COPY 即可(目前缺这一步,需要运维方补)。

---

## 2. docker-compose.prod 集成

`docker-compose.prod.yml:299-381`(完整 ai-service 块):

### 2.1 镜像 / 网络

```yaml
ai-service:
  image: ${DOCKER_REGISTRY:-}${DOCKER_REGISTRY:+/}aetherblog-ai-service:${VERSION:-latest}
  build:
    context: .
    dockerfile: apps/ai-service/Dockerfile
    platforms:
      - linux/amd64
      - linux/arm64
  container_name: aetherblog-ai-service
  restart: unless-stopped
  expose:
    - "8000"
  # 注意:不暴露 8000 到宿主机,仅通过 Docker 内部网络访问
  networks:
    - aetherblog-network
  depends_on:
    postgres:
      condition: service_healthy
```

> **多架构构建**:linux/amd64 + linux/arm64,适配 Apple Silicon / 国产 ARM 服务器。
> **不向宿主机暴露 8000** — 通过 server-go(`AETHERBLOG_AI_BASE_URL: http://ai-service:8000`)做隔离反代。

### 2.2 环境变量(完整 prod 套)

```yaml
environment:
  # 基础
  AI_ENV: prod
  AI_HOST: 0.0.0.0
  AI_PORT: 8000
  AI_LOG_LEVEL: ${AI_LOG_LEVEL:-info}
  AI_LOG_PATH: /app/logs
  AI_MOCK_MODE: ${AI_MOCK_MODE:-false}

  # JWT
  AI_JWT_MODE: ${AI_JWT_MODE:-HMAC}
  JWT_SECRET: ${JWT_SECRET:?JWT_SECRET env var is required (min 32 chars)}
  AI_JWT_JWKS_URL: ${AI_JWT_JWKS_URL:-}
  AI_JWT_ISSUER: ${AI_JWT_ISSUER:-}
  AI_JWT_AUDIENCE: ${AI_JWT_AUDIENCE:-}

  # 内部服务通信
  AI_INTERNAL_SERVICE_TOKEN: ${AI_INTERNAL_SERVICE_TOKEN:?AI_INTERNAL_SERVICE_TOKEN env var is required}

  # 凭证加密(必须独立于 JWT_SECRET)
  AI_CREDENTIAL_ENCRYPTION_KEYS: ${AI_CREDENTIAL_ENCRYPTION_KEYS:?AI_CREDENTIAL_ENCRYPTION_KEYS env var is required}

  # Redis(三段式 + 可选完整 URL override)
  REDIS_HOST: ${REDIS_HOST:-redis}
  REDIS_PORT: ${REDIS_PORT:-6379}
  REDIS_PASSWORD: ${REDIS_PASSWORD:-}
  REDIS_URL: ${AI_REDIS_URL:-}

  # PG
  POSTGRES_DSN: postgresql://aetherblog:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD env var is required}@postgres:5432/aetherblog

  # OpenAI / 兼容协议默认凭证(env_fallback 路径)
  OPENAI_API_KEY: ${OPENAI_API_KEY:-}
  OPENAI_BASE_URL: ${OPENAI_BASE_URL:-https://api.openai.com}
  OPENAI_COMPAT_BASE_URL: ${OPENAI_COMPAT_BASE_URL:-}
  OPENAI_COMPAT_API_KEY: ${OPENAI_COMPAT_API_KEY:-}
```

注意 `${X:?msg}` 语法 — 若变量未设直接报错并阻止 compose up。这是 VULN-120 的加固:禁止 JWT_SECRET 等关键 secret 静默回退到空值。

### 2.3 安全加固(VULN-123)

```yaml
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
read_only: true
tmpfs:
  - /tmp:rw,size=64M,mode=1777
```

- `no-new-privileges: true` — 子进程无法 setuid 提权
- `cap_drop: ALL` — 删除所有 Linux capabilities(NET_ADMIN / DAC_OVERRIDE 全无)
- `read_only: true` — 根文件系统只读
- `/tmp` 用 64MB tmpfs(Python 需要它做编译缓存 / temp file)

### 2.4 卷挂载

```yaml
volumes:
  - aetherblog_logs:/app/logs
```

仅 logs 卷 — 与 server-go 共享。`SecretRedactor`(`app/core/logging.py:33-48`)在写入前清洗 `sk-...` / `Bearer ...`,即便共享卷被运维 read-only mount 到日志聚合平台(promtail / fluentd)也不会泄露(VULN-146)。

### 2.5 资源限制

```yaml
deploy:
  resources:
    limits:
      memory: 768M
    reservations:
      memory: 256M
```

`768M` 是按"承载 LiteLLM + asyncpg pool(max 5) + 同时 5 路 stream + chunker 处理 30KB 博文"算的实测值。冷启动 import litellm 就要吃 ~300M(它内嵌很多 provider SDK 的延迟 import 占位)。

---

## 3. 健康检查

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  start_period: 45s
  interval: 10s
  timeout: 5s
  retries: 3
```

`start_period: 45s` 的理由:

> Python 导入 litellm/asyncpg/pgvector + FastAPI lifespan 里 `asyncpg.create_pool(min_size=1)` 首连 + `jwt_keys.start_refresher` 的首次 DB 拉取,整段耗时在慢机上可超过 30s。该窗口内探活失败不计入 retries,避免 CI 部署 preflight 看到 `docker=starting`。

`interval: 10s` 从 30s 缩到 10s(进程起来后 docker 更快翻 healthy)。

### 3.1 健康端点的语义

`app/api/routes/health.py`(17 行):

```python
@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

@router.get("/ready")
async def ready() -> dict[str, str]:
    return {"status": "ready"}
```

> **设计取舍**:`/health` 不真探 DB / Redis / LiteLLM 连通性。理由:健康检查应该轻量,不该让 docker healthcheck 暴露在依赖故障下放大事故面(Redis 抖一下整个容器被杀重启,反而比"AI 端点 503 但容器还在"更糟)。
> **真正的 readiness 信号**通过 startup banner 日志输出 — `redis.preflight_ok` / `jwt_keys.refreshed` / `ai_service.prewarm_done` 三条 INFO 出现就是 ai-service 实际可用了。

---

## 4. 配置加载完整流程

`app/core/config.py:_find_env_file`(`config.py:12-30`):

```python
def _find_env_file() -> str | None:
    try:
        root_env = Path(__file__).resolve().parents[4] / ".env"
        if root_env.exists():
            return str(root_env)
    except IndexError:
        pass

    if Path(".env").exists():
        return ".env"

    return None
```

加载优先级:

1. **项目根 `.env`**(开发环境):`apps/ai-service/app/core/config.py` → parents[4] = 项目根
2. **当前目录 `.env`**(备选):很少用
3. **`None` = 完全靠环境变量**(Docker 容器中):parents[4] 在 `/app` 容器里不存在,fallback 到 None,所有变量从 `docker-compose` 的 `environment:` 段读取

`Settings` 用 `extra="ignore"`(`config.py:42`) — 忽略根 `.env` 中不认识的其它服务配置项,不会因为 admin 把 `BLOG_FOO=bar` 写在共享 .env 而启动失败。

---

## 5. 环境变量矩阵

### 5.1 必填(缺失启动崩)

| 变量 | 来源 | 备注 |
|---|---|---|
| `JWT_SECRET` | `Field(...)` | 与 server-go 共享,签发 / 验签 HS256 |
| `AI_INTERNAL_SERVICE_TOKEN` | `Field(...)` + `_validate_token_strength` | ≥ 32 字符,server-go ↔ ai-service 内部通信 |
| `AI_CREDENTIAL_ENCRYPTION_KEYS` | `Field(...)` + `_validate_encryption_keys` | 逗号分隔 Fernet keys,首个加密新数据,全部尝试解密(MultiFernet) |
| `POSTGRES_DSN` | `Field(...)` + `_normalize_postgres_dsn` | 自动剥除 `postgresql+asyncpg://` 前缀 |

### 5.2 安全相关(改动需谨慎)

| 变量 | 默认值 | 作用 |
|---|---|---|
| `AI_RATE_LIMIT_FAIL_OPEN` | `false` | Redis 故障时:false=503 拒服务 / true=放行;**生产必 false**(VULN-070) |
| `AI_JWT_AUDIENCE` | None | prod 模式下未设会落 WARNING(VULN-067);未来会强制 |
| `AI_JWT_ISSUER` | None | 同上 |
| `AETHERBLOG_AI_ALLOW_INTERNAL_LLM` | `false` | true 时 SSRF 守卫放行 RFC1918 / loopback;**生产必 false** |
| `AETHERBLOG_SSRF_ALLOW_RESERVED` | `false` | true 时放行 RFC2544 / class-E 等"reserved";**生产必 false**,仅 Clash fake-ip 本地开发 |

### 5.3 业务调优

| 变量 | 默认值 | 作用 |
|---|---|---|
| `AI_RATE_LIMIT_USER_PER_MIN` | 10 | 单用户每分钟 LLM 调用数(每个 endpoint 独立) |
| `AI_RATE_LIMIT_GLOBAL_PER_MIN` | 100 | 全局 LLM 调用数 |
| `AI_MAX_INPUT_CHARS` | 120000 | 单请求最大字符数(≈ 40K tokens) |
| `AI_VECTOR_DIM` | 1536 | 默认 embedding 维度(text-embedding-3-small) |
| `AI_SEARCH_THRESHOLD` | 0.6 | 语义搜索的 similarity 阈值 |
| `AI_REINDEX_BATCH` | 200 | reindex 批大小(目前未使用,予未来批处理) |
| `AI_USAGE_LOG_FAILURE_ALERT_THRESHOLD` | 10 | usage_logger 失败累计 N 次触发 ERROR alert |
| `AI_USAGE_LOG_FAILURE_SAMPLE_LIMIT` | 50 | metrics.snapshot 中保留的失败样本数上限 |

### 5.4 模型路由 env_fallback

当数据库 `ai_task_routing` 表为空时使用:

| 变量 | 默认值 | 任务 |
|---|---|---|
| `MODEL_SUMMARY` | `gpt-5-mini` | summary |
| `MODEL_TAGS` | `gpt-5-mini` | tags |
| `MODEL_TITLES` | `gpt-5-mini` | titles |
| `MODEL_POLISH` | `gpt-5-mini` | polish |
| `MODEL_OUTLINE` | `gpt-5-mini` | outline |
| `MODEL_TRANSLATE` | `gpt-5-mini` | translate |
| `MODEL_EMBEDDING` | `text-embedding-3-small` | embedding |
| `AI_DEFAULT_PROVIDER` | `openai` | 默认 provider |
| `OPENAI_API_KEY` | None | env_fallback 凭证(必填以让 fallback 生效) |
| `OPENAI_BASE_URL` | `https://api.openai.com` | 直连 OpenAI |
| `OPENAI_COMPAT_BASE_URL` | None | 备用 OpenAI 兼容中转 |
| `OPENAI_COMPAT_API_KEY` | None | 备用兼容中转 key |

> 强烈推荐:**通过 admin UI 在 `ai_providers` / `ai_models` / `ai_credentials` / `ai_task_routing` 表里配置**,而非依赖环境变量。env_fallback 只是新部署冷启动 / 紧急运维的 fallback。

### 5.5 Redis 三段式 vs URL

`Settings._build_redis_url_from_parts`(`config.py:186-220`)优先级:

1. **显式 `REDIS_URL`(非空)** → 直接用,`_merge_redis_password` 负责合入 AUTH(若 URL 没 `@` 才合并)
2. **`REDIS_HOST` 有值** → 由 `_build_redis_url_from_parts` 合成 `redis://[:password@]host:port/0`,password 走 url-encode 兼容特殊字符
3. **全部缺省** → 字段默认值 `redis://localhost:6379/0`(开发用)

历史坑(`docker-compose.prod.yml:328-333` 注释):

> Redis 容器内部端口 6379 + 宿主机映射到 6999, backend 走宿主机 IP + 6999 OK, 但 ai-service 如果只读 REDIS_URL 就容易拼出 `redis:6999` 这种永远不通的组合 — 三段式配置让两边同步。

### 5.6 优雅降级行为

| 缺失 | 启动 | 运行时 |
|---|---|---|
| `JWT_SECRET` | 崩 | — |
| `AI_INTERNAL_SERVICE_TOKEN`(<32 字符) | 崩 | — |
| `AI_CREDENTIAL_ENCRYPTION_KEYS`(invalid) | 崩 | — |
| `POSTGRES_DSN` | 崩 | — |
| Redis 不可达 | warning(`redis.preflight_failed`),启动继续 | rate_limit 端点 503;agent 仍能用(它不挂 rate_limit) |
| `OPENAI_API_KEY` 缺 | 启动 OK | env_fallback 路径返 401(用户 routing 配置缺失时才走) |
| 任意 LLM provider 凭证错 | 启动 OK | 端点 502 + `ai_usage_logs.error_code` 落库 |
| `jwt_secrets` 表不存在 | warning,后台重试 | 验签会 fail-closed 返 401 直到 DB 就绪 |

---

## 6. 凭证轮换运维(`scripts/rotate_credentials.py`)

完整 docstring 在 `apps/ai-service/scripts/rotate_credentials.py:1-39`。

### 6.1 VULN-056 迁移窗口剧本

```bash
# 1. 计算从 JWT_SECRET 派生的旧 key(让 MultiFernet 在过渡期仍能解密已有行)
OLD_KEY=$(python3 -c "from app.services.credential_resolver import _legacy_jwt_derived_key; \
                      import os; print(_legacy_jwt_derived_key(os.environ['JWT_SECRET']).decode())")

# 2. 生成全新主 key
NEW_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

# 3. 配置两把 key,新 key 在前
export AI_CREDENTIAL_ENCRYPTION_KEYS="$NEW_KEY,$OLD_KEY"

# 4. 重启 ai-service,然后跑脚本
python3 -m scripts.rotate_credentials

# 5. 完成后从环境删除旧 key
export AI_CREDENTIAL_ENCRYPTION_KEYS="$NEW_KEY"
# 再重启一次
```

**幂等**:已经用第一把 key 加密的行会被重新包装(新密文、相同明文),不会丢数据。

### 6.2 孤儿 routing 修复

凭证行用过期 key 加密(无法再解密)→ `ai_task_routing.credential_id` 仍指向它 → 路由探针记 `"credential probe failed for ...:"`(InvalidToken 消息为空),admin UI 报"no credential available",reindex 悄悄回退到 env 默认值。

```bash
# 预览模式(不带 flag,只跑 reencrypt 不动 routing)
python3 -m scripts.rotate_credentials

# 自动修复孤儿 routing
python3 -m scripts.rotate_credentials --repair-orphans

# 进一步清除永远无法解密的凭证
python3 -m scripts.rotate_credentials --repair-orphans --delete-dead
```

`_repair_orphan_routings`(`scripts/rotate_credentials.py:52-109`)逻辑:

- 找出所有 `credential_id IN (失败 ID 列表)` 的 routing 行
- 给每行从同 provider 下找一个可用替代凭证(`ORDER BY is_default DESC, id ASC`)
- 找不到 → 把 `credential_id` 设为 `NULL`(外键 ON DELETE SET NULL),resolver 后续回退到 provider 默认值

---

## 7. 日志运维

### 7.1 关键日志事件

| 事件 | 级别 | 含义 / 应对 |
|---|---|---|
| `redis.preflight_ok` | INFO | 启动时 Redis 可达,记录脱敏后的 URL |
| `redis.preflight_failed` | ERROR | 启动 Redis 不通;`category` 字段是 `auth/timeout/connection/response/unknown`;按 `hint` 字段操作 |
| `jwt_keys.refreshed` | INFO | 60s 一次,`active_keys: <数量>` |
| `jwt_keys.refresh_failed` | WARNING | DB 抖动 |
| `jwt_keys.startup_skipped` | WARNING | 首次拉取失败,后台重试中 |
| `ai_service.prewarm_done` | INFO | 核心服务全部预热完毕 |
| `ai_service.prewarm_failed` | WARNING | 某个 service 预热失败,但保留 lazy 兜底 |
| `embed.start_env_fallback` | WARNING | embedding 任务用 env_fallback,routing 表里没配 |
| `rate_limit.redis_error_fail_closed` | ERROR | Redis 故障 + fail_open=false → 端点 503 |
| `llm_router.chat_request` | INFO | 每次 LLM 调用前的脱敏审计 |
| `llm_router.chat_response` | INFO | 每次响应字符数 + 截断的 snippet |
| `llm_router.chat_primary_failed_using_fallback` | WARNING | primary 失败,fallback 救场 |
| `ai.summary_output_oversize_truncated` | WARNING | 模型超字数被软上限截断 |
| `ai.cache_payload_invalid` | WARNING | Redis 里取到的数据 schema 与新代码不匹配 |
| `ai_usage_log_failed.alert` | ERROR | usage_logger 累计失败达阈值 |
| `agent.fallback_to_first_enabled_model` | INFO | agent 路由表全空,落到任意启用的 chat 模型 |
| `search_profile.activated` | INFO | profile 蓝绿切换完成 |
| `reindex_stream.fatal` | WARNING | profile reindex 流的致命错误(DB 连接挂等) |

### 7.2 运行时日志级别调整

```bash
# Go 后端代理
curl -X PUT https://blog.example.com/api/v1/admin/system/log-level \
  -H "Authorization: Bearer <admin_jwt>" \
  -d '{"level": "debug"}'

# 直接打 ai-service(需要 X-Internal-Service)
curl -X PUT http://ai-service:8000/api/v1/admin/log-level \
  -H "X-Internal-Service: <token>" \
  -d '{"level": "debug"}'
```

不持久化 — 容器重启回到 `AI_LOG_LEVEL` 环境值。审计日志会用新阈值本身记录这次变更(以 INFO 为下限,避免在 ERROR 阈值下静默丢失)。

### 7.3 日志 fallback chain

`setup_logging`(`app/core/logging.py:88-131`):

1. **stdout** — 主 sink,始终存在
2. **`AI_LOG_PATH/ai-service.log`** — `/app/logs/ai-service.log` 默认
3. **`/tmp/ai-service.log`** — 当 `AI_LOG_PATH` 不可写时(典型:共享 `aetherblog_logs` Docker 卷被旧版镜像以另一个 UID 创建)
4. **仅 stdout** — 极端情况

只在真正发生 fallback 时记录一次 `log_file.fallback` INFO,不像旧实现每次启动都打 WARNING 噪声。

---

## 8. server-go 侧的对端配置

`apps/server-go/internal/config/config.go:168-170`(AIConfig 字段):

| 变量 | Go 默认 | 备注 |
|---|---|---|
| `AETHERBLOG_AI_BASE_URL` | `http://ai-service:8000` | server-go 转发的目标 |
| `AETHERBLOG_AI_CONNECT_TIMEOUT` | `5s` | TCP 连接超时 |
| `AETHERBLOG_AI_READ_TIMEOUT` | `5m` | 同步接口读取超时 |
| `AETHERBLOG_AI_STREAM_READ_TIMEOUT` | `30m` | SSE 接口读取超时，覆盖 Search Profile reindex 长任务 |
| `AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN` | (要求与 ai-service 一致) | `X-Internal-Service` 头 |

> nginx 侧 `proxy_read_timeout=600s` 是空闲读超时；profile reindex 会持续推 progress 帧，不应触发空闲超时。server-go 侧 `AETHERBLOG_AI_STREAM_READ_TIMEOUT` 是整条 SSE 的总读取超时，默认 30min。详见 `docs/deployment.md` 与 `.claude/docs/deployment-cicd.md`。

---

## 9. 本地启动

仓库根:

```bash
./start.sh --gateway     # 自动起 nginx + server-go + ai-service + admin + blog
./stop.sh
```

仅本地 ai-service 单独跑(`apps/ai-service/README.md`):

```bash
cd apps/ai-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # 仓库根 .env 也行
uvicorn app.main:app --reload
```

默认 URL `http://localhost:8000`:
- `GET /health`
- `POST /api/v1/ai/summary`(等)
- `GET /api/v1/search/semantic`

dev 模式下 `/docs`(Swagger UI)和 `/openapi.json` 自动可用(`AI_ENV=dev`)。

> **本地启动 / 重启验证一律走 `--gateway`**(CLAUDE.md 红线)— 直连模式不会拉起 nginx,无法验证路由 / CORS / SSE 透传等真实链路。

---

## 10. 常见部署故障速查

| 症状 | 可能原因 | 排查 |
|---|---|---|
| `docker compose up` 立即崩 | `JWT_SECRET` / `AI_INTERNAL_SERVICE_TOKEN` / `AI_CREDENTIAL_ENCRYPTION_KEYS` 之一未设 | 看 compose 输出 `error: env var ... is required` |
| 启动 OK 但 `/health` 一直 `starting` | start_period 内未起来 | `docker logs aetherblog-ai-service`,找 `redis.preflight_*` / `jwt_keys.startup_*` |
| 所有 AI 端点 503 | Redis 不可达,fail_closed 生效 | `rate_limit.redis_error_fail_closed` ERROR;检查 `REDIS_HOST` / `REDIS_PASSWORD` |
| AI 端点正常但语义搜索全空 | embedding routing 走 env_fallback | `embed.start_env_fallback` WARNING;到 admin → 搜索配置 → 配 active embedding 路由 |
| 凭证保存后 reveal 失败 | `AI_CREDENTIAL_ENCRYPTION_KEYS` 已轮换但旧 key 不在列表里 | 看 `Failed to decrypt credential ...` WARNING;运行 `scripts/rotate_credentials.py --repair-orphans` |
| profile 切换后语义搜索瞬间空 | active profile 翻转但 chunks 还是 shadow | `search_profile.activated` 后查 `post_embeddings` 该 profile 行 status |
| LLM 调用 504 | provider 慢 + Go `AETHERBLOG_AI_READ_TIMEOUT` 太短 | nginx 侧 `proxy_read_timeout` + Go `ReadTimeout` + ai-service `_TASK_DEFAULT_MAX_TOKENS` 一并查 |
| LLM 调用 502 + auth 错 | provider api_key 失效 / api_base 不通 | admin → AI 配置 → 凭证测试;看 `ai_credentials.last_error` |
| `/api/v1/ai/*` 用 mock 响应 | `AI_MOCK_MODE=true` 没关 | docker-compose 环境检查 `AI_MOCK_MODE: false` |
| OOM 重启 | 大批量 reindex 同时跑 + `_chunk_concurrency=5` 太高 | `vector_store.upsert_post_embedding`:`asyncio.Semaphore(5)`;扩 deploy.resources.limits.memory 或减并发 |

---

## 11. 跨模块运维提醒

- **migration 与 ai-service 必须同步发版**:升级 ai-service 容器前,server-go 的 migrate 必须先跑完 — 否则 ai-service 看到的 schema 与代码不一致(典型:000034 / 000041 schema 差异让 `/admin/search/stats` 直接 500;已有 `test_index_stats_fallback.py` 锁住兼容,但其它端点不一定有)
- **JWT_SECRET 修改要全栈重启**:server-go + ai-service 必须同时重启(否则一边签的 token 另一边验不过)
- **凭证加密 key 轮换要文档化**:`AI_CREDENTIAL_ENCRYPTION_KEYS` 变更必须配套跑 `scripts/rotate_credentials.py`,流程见 §6
- **CORS 收紧导致 admin 报错**:开发新的 admin 子域名时记得加到 `app/main.py:209-213` 的 `allow_origins`(故意没用 wildcard,VULN-068)
- **logs 卷与 backend 共享时的权限**:UID/GID 1001 必须与 `apps/server-go/Dockerfile` 一致;不一致会让一边写不进 logs(典型:用 root 跑 backend、用 1001 跑 ai-service)
