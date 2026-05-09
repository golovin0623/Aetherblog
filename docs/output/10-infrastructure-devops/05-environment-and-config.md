# 05 - 环境变量与配置

> 范围:`.env.example`(根)与 `apps/{blog,admin}/.env.local.example` 的字段语义、自动生成规则、本地 vs 生产差异、密钥管理建议。

---

## 1. 环境文件清单

| 文件 | 用途 | 加载位置 |
| --- | --- | --- |
| `.env`(根,gitignored) | 后端 / AI / docker-compose 全局配置 | `start.sh:875-879` `set -a; source .env; set +a` |
| `.env.example`(根,checked in) | 文档 + 模板 | `bootstrap_env` 缺 `.env` 时 `cp` |
| `apps/blog/.env.local`(gitignored) | Next.js 前端 env | Next.js 自动加载 |
| `apps/blog/.env.local.example` | 模板 | `bootstrap_env` 缺时 `cp` |
| `apps/admin/.env.local`(gitignored) | Vite admin env | Vite 自动加载 |
| `apps/admin/.env.local.example` | 模板 | `bootstrap_env` 缺时 `cp` |
| `apps/server-go/config.yaml` | Go 后端默认配置 | 编译时打包到镜像(`apps/server-go/Dockerfile:27`) |
| `/etc/aetherblog/webhook.env`(生产) | webhook secret 隔离 | `deploy-webhook.service:49 EnvironmentFile=` |
| `apps/ai-service/.env`(可选,gitignored) | ai-service 启动时 fallback | `start_ai_service` 在 `.env.example` 存在时 cp |

---

## 2. .env.example 字段全集(171 行)

### 2.1 标签语义

`.env.example:14-22`:

```
[LOCAL DEV]  本机开发默认值,已对齐 docker-compose.yml 中间件容器配置。
             直接 cp 即可跑通 ./start.sh / ./start.sh --gateway。
[PROD]       生产部署 (docker-compose.prod.yml) 必须重写为生产值。
[AUTO-GEN]   start.sh 在 .env 不存在或字段为空时会自动生成,无需手填。
             也可手动用注释里的命令生成。
```

### 2.2 字段分组

#### 网关

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `GATEWAY_PORT` | 7899 | LOCAL DEV | 网关对外端口 |

#### PostgreSQL

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | (空) | AUTO-GEN / PROD | 缺失时 start.sh 生成 base64url 强随机;生产必填,**首次部署后锁定到 PGDATA**,改 .env 无效 |

#### Redis

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `REDIS_HOST` | localhost | LOCAL DEV / PROD | dev 走宿主机端口映射;prod 改回 `redis`(同网络服务名);生产 `bootstrap_env` 把 localhost 删掉让默认接管 |
| `REDIS_PORT` | 6379 | LOCAL DEV | |
| `REDIS_PASSWORD` | (空) | AUTO-GEN / PROD | 缺失时 start.sh 生成强随机;Redis 不持久化口令,可安全轮换 |

#### JWT(REQUIRED)

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `JWT_SECRET` | (空) | AUTO-GEN | `openssl rand -base64 48` 生成,**最小 32 字符**;backend + ai-service 共享 |

#### Auth Cookie

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `AUTH_COOKIE_SECURE` | false | LOCAL DEV / PROD | HTTP 调试必 false;`./start.sh --prod` 自动翻为 true |
| `AUTH_COOKIE_SAME_SITE` | Strict | — | |

#### CORS

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:7899,http://127.0.0.1:7899,http://localhost:5173,http://localhost:3000` | LOCAL DEV / PROD | 生产改为实际域名(含 https://) |

#### 内部服务 Token(REQUIRED)

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN` | (空) | AUTO-GEN | 与下面同值;backend 用这个变量名 |
| `AI_INTERNAL_SERVICE_TOKEN` | (空) | AUTO-GEN | ai-service 用这个变量名 |

start.sh 一次性生成同一份 base64 值同时写入两个变量(`start.sh:898-904`)。

#### AI Credential 加密(REQUIRED)

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `AI_CREDENTIAL_ENCRYPTION_KEYS` | (空) | AUTO-GEN | Fernet 密钥(base64url 44 字符含 `=` padding);多 key 逗号分隔 → MultiFernet 零停机轮换;首位加密、全部解密 |

VULN-056:**禁止复用 JWT_SECRET**。生成命令:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

#### AI Service

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | (空) | — | 留空走 mock provider;填入后启用真实 LLM |
| `OPENAI_BASE_URL` | https://api.openai.com | — | |
| `OPENAI_COMPAT_BASE_URL` | (空) | — | 兼容 OpenAI 协议的第三方 |
| `OPENAI_COMPAT_API_KEY` | (空) | — | |
| `AI_MOCK_MODE` | false | — | true 时所有 AI 工具返回桩响应 |
| `AI_JWT_MODE` | HMAC | — | HMAC / JWKS |
| `AI_JWT_JWKS_URL` | (空) | — | JWKS 模式下的远端 |
| `AI_JWT_ISSUER` / `AI_JWT_AUDIENCE` | (空) | — | JWKS claim 校验 |

#### Logging

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `AETHERBLOG_LOG_LEVEL` | info | — | backend(zerolog)`debug/info/warn/error` |
| `AI_LOG_LEVEL` | info | — | ai-service(Python logging)`debug/info/warning/error/critical` |

运行时可经 `PUT /v1/admin/system/log-level` 在线调整(进程重启回到 .env 值)。

#### SSRF Guard

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `AETHERBLOG_SSRF_ALLOW_RESERVED` | (注释) | LOCAL DEV ONLY | Clash/Mihomo fake-ip(198.18/16)代理穿透;生产**严禁开启** |
| `AETHERBLOG_AI_ALLOW_INTERNAL_LLM` | (注释) | — | 允许 RFC1918 + loopback + IPv6 ULA 作为 LLM endpoint(自托管 Ollama / 内网 LiteLLM 代理) |

仍硬拒:
- IMDS(169.254/16)
- CGNAT(100.64/10)
- 0.0.0.0/8
- 广播地址

#### 对象存储

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `AETHERBLOG_SYNC_AUTO_ENABLED` | (注释,默认 false) | — | 自动后台备份开关,site_settings 优先 |
| `AETHERBLOG_SYNC_BATCH_SIZE` | 50 | — | |
| `AETHERBLOG_SYNC_RATE_PER_SECOND` | 5 | — | |
| `AETHERBLOG_SYNC_CONCURRENCY` | 3 | — | |
| `AETHERBLOG_SYNC_MAX_ATTEMPT` | 3 | — | 失败放弃前的重试次数 |
| `AETHERBLOG_SYNC_POLL_INTERVAL_SEC` | 10 | — | ticker 周期 |

实际配置入口在 admin 后台 "存储管理" 标签;`secretAccessKey` 落库前 Fernet 加密(复用 `AI_CREDENTIAL_ENCRYPTION_KEYS`)。

#### Docker Registry

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `DOCKER_REGISTRY` | (注释,默认 golovin0623) | — | 改 fork 时必填 |
| `VERSION` | (注释) | — | 镜像 tag,**禁止 latest**(forbidden-defaults-guard) |

#### 容器监控(可选)

| 字段 | 默认 | 标签 | 说明 |
| --- | --- | --- | --- |
| `DOCKER_SOCKET_PROXY_URL` | (注释,空) | — | `http://docker-socket-proxy:2375`,需配 `--profile with-monitor` |
| `DOCKER_ENDPOINT` | (注释) | — | 替代,`unix:///abs/path` 或 `http(s)://`,优先级高于 PROXY_URL |

---

## 3. 各 app .env.local 模板

### 3.1 `apps/blog/.env.local.example`

```
NEXT_PUBLIC_ADMIN_URL=/admin/    # 网关 / 生产默认
# NEXT_PUBLIC_API_URL=           # 通常不设,客户端走相对 /api,server 端 fallback localhost:8080
# API_URL=                       # 仅 server 端读取,优先级高于 NEXT_PUBLIC_API_URL
```

NEXT_PUBLIC_ADMIN_URL 取值规则(`apps/blog/app/lib/adminUrl.ts`):
- 必须以 `http://` / `https://` 开头,或以 `/` 开头作为相对路径
- 网关 / 生产:`/admin/` 即可由 nginx 路由
- 直连模式:`http://localhost:5173/`(否则跳到 :3000/admin/ 找不到)
- 跨域生产:`https://admin.your-domain.com/`

### 3.2 `apps/admin/.env.local.example`

```
VITE_API_URL=/api
```

开发模式 Vite proxy 把 `/api/*` 转发到 `http://localhost:8080`。
网关 / 生产模式由 nginx 转发到 backend。

### 3.3 ai-service env 来源

`start_ai_service`(`start.sh:937-1043`)按以下优先级:

1. `apps/ai-service/.env`(若存在)
2. `apps/ai-service/.env.example` cp 过来(`start.sh:961-963`)
3. 根 `.env`(`start.sh:980-983` `source $PROJECT_ROOT/.env`)
4. 显式 export(start.sh 内拼 `POSTGRES_DSN`、继承 `AI_INTERNAL_SERVICE_TOKEN` 等)

`docker-compose.prod.yml:312-346` 在容器化部署时直接通过 compose `environment:` 块注入,不依赖 .env 文件。

---

## 4. .env.local 自动生成

`bootstrap_env`(`start.sh:481-489`):

```bash
local app
for app in blog admin; do
    local target="$PROJECT_ROOT/apps/$app/.env.local"
    local template="$PROJECT_ROOT/apps/$app/.env.local.example"
    if [ ! -f "$target" ] && [ -f "$template" ]; then
        cp "$template" "$target"
        echo "✅ 已为 $app 创建 .env.local"
    fi
done
```

---

## 5. 多环境差异

### 5.1 本地 dev(`./start.sh`)

```
.env 默认值 + start.sh bootstrap 生成强随机密钥
中间件由 docker-compose.yml 起(--with-middleware),或用户已常驻
应用进程跑宿主机
PostgreSQL/Redis 用容器映射端口,REDIS_HOST=localhost
AUTH_COOKIE_SECURE=false(HTTP 调试)
```

### 5.2 本地 gateway dev(`./start.sh --gateway`)

```
同上 + nginx:alpine 容器加载 nginx.dev.conf
nginx 通过 host.docker.internal 反代到宿主机进程
浏览器访问 http://localhost:7899
```

### 5.3 本地 prod 模拟(`./start.sh --prod`)

```
bootstrap_env PROD_MODE=true:
  - require_prod_secure_field POSTGRES_PASSWORD ≠ aetherblog123
  - bootstrap_prod_secure_field REDIS_PASSWORD ≠ aetherblog_dev → 静默替换强随机
  - bootstrap_prod_secure_field AUTH_COOKIE_SECURE ≠ false → 改为 true
  - 删除 REDIS_HOST=localhost
应用进程仍跑宿主机
gateway 容器加载 nginx.conf(生产配置)
```

### 5.4 真生产(`docker-compose -f docker-compose.prod.yml up -d`)

```
全部应用容器化,镜像走 ${DOCKER_REGISTRY}/aetherblog-*:${VERSION}
.env 是 single source of truth,所有变量经 compose interpolation 注入容器
强校验 ${VAR:?...}:JWT_SECRET / POSTGRES_PASSWORD / REDIS_PASSWORD / AI_INTERNAL_SERVICE_TOKEN /
        AI_CREDENTIAL_ENCRYPTION_KEYS 缺失即 compose config 失败
REDIS_HOST=redis(compose 服务名)
NEXT_PUBLIC_API_URL=/api(build arg 烤进客户端 bundle)
```

---

## 6. 密钥管理建议

### 6.1 最小密钥集

生产部署必须**手动设置或由 bootstrap 生成**:

```
POSTGRES_PASSWORD                 ← FATAL 引导手动 ALTER ROLE
REDIS_PASSWORD                    ← bootstrap 静默替换 OK
JWT_SECRET                        ← min 32 chars,backend + ai-service 共享
AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN
AI_INTERNAL_SERVICE_TOKEN         ← 与上同值
AI_CREDENTIAL_ENCRYPTION_KEYS     ← Fernet,首位主 key + 末位 legacy(VULN-056 兼容)
```

CI 阶段(`config-validate`)用 dummy 值校验 compose 渲染:

`ci-cd.yml:262-269`:

```yaml
POSTGRES_PASSWORD: ci-validate-dummy
DB_PASSWORD: ci-validate-dummy
REDIS_PASSWORD: ci-validate-dummy
JWT_SECRET: ci-validate-dummy
AI_INTERNAL_SERVICE_TOKEN: ci-validate-dummy-token-minimum-32chars
AI_CREDENTIAL_ENCRYPTION_KEYS: RyzpKxpEEIQQfvVYPjcrwgOpmRtvhMhqsobGQHTr1WI=  # 真 Fernet key
```

### 6.2 密钥轮换

| 字段 | 轮换 SOP |
| --- | --- |
| `POSTGRES_PASSWORD` | 1. `ALTER ROLE aetherblog WITH PASSWORD '<new>'`<br>2. 改 .env<br>3. restart backend / ai-service / 内置 redis 容器 |
| `REDIS_PASSWORD` | 1. 改 .env<br>2. `docker compose restart redis backend ai-service` |
| `JWT_SECRET` | 1. 改 .env<br>2. **AI_CREDENTIAL_ENCRYPTION_KEYS 末位 legacy 必须保留** 让旧密文可解<br>3. restart 进程<br>4. 旧 JWT 在 `AETHERBLOG_JWT_PREVIOUS_GRACE`(48h)内仍可验证 |
| `AI_INTERNAL_SERVICE_TOKEN` | 1. 生成新值<br>2. 改 .env(两个变量同值)<br>3. restart backend 与 ai-service |
| `AI_CREDENTIAL_ENCRYPTION_KEYS` | 1. 生成新 Fernet key<br>2. 加到 .env 首位(原首位下移)<br>3. restart<br>4. `docker exec aetherblog-ai-service python -m scripts.rotate_credentials --repair-orphans`<br>5. 移除末位旧 key + 设 `AI_LEGACY_KEY_FALLBACK=false` |
| `DEPLOY_WEBHOOK_SECRET` | 见 `ops/webhook/README.md#webhook-secret-轮换`,核心是 `/etc/aetherblog/webhook.env` + GitHub repo secret 同步 |

### 6.3 secret 不应该出现的位置

按 ci-cd.yml `gitleaks` job + `forbidden-defaults-guard` job 防御:

- 任何 `*.env.example` / `docker-compose*.yml` 中的 `VERSION=latest`(VULN-143)
- `change-me-to-a-secure-random-string` / `sk-proj-mock-key-for-testing` / `default-secret-for-dev-only-change-in-prod`(VULN-117)
- 任何 git diff 中的 secret 字面值(`gitleaks-action`)

历史:`aetherblog123` 是 dev DB 默认值,在 `docker-compose.yml` / `Makefile` / `config.yaml` / 旧 `start.sh` 散布 → **不加入 forbidden 列表**,由 VULN-118 P1 单独清理。

---

## 7. config.yaml(后端非 env)

`apps/server-go/config.yaml`(不在本模块范围,但与 env 联动):
- 本仓库 backend 用 viper 加载,优先级 env > config.yaml > 内置默认
- env 变量名是 `AETHERBLOG_<SECTION>_<KEY>` 大写下划线,如 `AETHERBLOG_DATABASE_HOST`、`AETHERBLOG_AUTH_COOKIE_SECURE`
- 在 prod compose 中显式 mapping(`docker-compose.prod.yml:236-262` 等)

---

## 8. 已知限制 / 配置陷阱

1. **`POSTGRES_PASSWORD` 持久化绑定** — 一旦 PGDATA 用某口令初始化,改 .env 无效。这就是 `bootstrap_env` 在 fresh install 才生成强随机的根本原因(`start.sh:386-413`),已存在卷时退回老默认 `aetherblog123` 保护升级路径。轮换必须 `ALTER ROLE` 同步。
2. **`REDIS_HOST` 不能写死在 .env** — start.sh --prod 把 backend / ai-service 跑成宿主机进程时 host DNS 解析不到容器 `redis`,需要 localhost + 端口映射;docker-compose.prod.yml 容器化部署需要 `redis`(compose 网络 DNS)。**同一 .env 不可能同时满足**。`bootstrap_env` 在 prod 模式删除 `REDIS_HOST=localhost` 让默认接管(Go 配置 yaml 默认 `localhost`,compose 默认 `redis`)。
3. **`AI_CREDENTIAL_ENCRYPTION_KEYS` legacy fallback 是临时的** — `start.sh:231-301` 自动追加 `_legacy_jwt_derived_key(JWT_SECRET)` 到末位让旧密文可解,VULN-056 升级路径。完成迁移后必须 `--repair-orphans` + 移除末位 + 设 `AI_LEGACY_KEY_FALLBACK=false`。
4. **`DOCKER_REGISTRY` 默认硬编码 `golovin0623`** — `docker-build.sh:33` 与 `docker-compose.prod.yml:221`(`${DOCKER_REGISTRY:-}`)默认空。fork 用户必须在 `.env` 加 `DOCKER_REGISTRY=<your-namespace>`。
5. **`.env.example` 没有 `DB_PASSWORD` 字段** — 但 `docker-compose.dev.yml:20` 的 postgres 用 `${DB_PASSWORD:?...}`(不是 `POSTGRES_PASSWORD`)。dev compose 启动需要 `DB_PASSWORD` env,默认 `start.sh` 没设这个变量;实际本地起 dev 网关需要手动 `export DB_PASSWORD=$POSTGRES_PASSWORD` 或类似。**这是文档/实现脱节**。
6. **`.dockerignore` 排除 `**/.env`** — VULN-151 防止 `apps/ai-service/.env` 被误打进镜像。但 `apps/admin/.env.local.example` 在白名单(`!apps/admin/.env.local.example`),其他 .env.local.example 没显式白名单(全 wildcards 已 `!.env.example` 但不覆盖 .env.local.example)。**实际不影响 build**(builder 不需要 .env.local.example)。
7. **server-go config.yaml 在镜像中** — 改 yaml 必须重建镜像。运行时配置应改 env 变量 `AETHERBLOG_*` 覆盖。
8. **AI provider 密钥不在 .env** — UI 配置后落库 `ai_credentials` 表,Fernet 加密 `secretAccessKey`。`OPENAI_API_KEY` 在 .env 是兜底默认 provider 用的,优先级低于数据库配置。
