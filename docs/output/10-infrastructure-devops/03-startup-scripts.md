# 03 - 启动脚本 / start.sh / stop.sh / restart.sh

> 范围:三个一键脚本的详细行为、`bootstrap_env` 的 .env 自治逻辑、健康检查重试、移动端真机调试支持、--gateway / --prod / 直连三种模式差异。

---

## 1. 文件清单

| 文件 | 行数 | 用途 |
| --- | --- | --- |
| `start.sh` | 1263 | 一键启动(中间件 → backend → ai → blog → admin → gateway) |
| `stop.sh` | 324 | 一键停止(应用,可选 --all 含中间件) |
| `restart.sh` | 110 | 应用容器快速重启(prod 专用,不动中间件) |

---

## 2. start.sh 全景

### 2.1 main 流程

`start.sh:1239-1261`:

```bash
main() {
  acquire_lock           # .locks/start.lock 防并发
  check_dependencies     # docker / node / pnpm / curl / python
  bootstrap_env          # .env / .env.local / 强随机密钥
  start_middleware       # docker compose up -d (postgres + redis,需要 --with-middleware)
  install_deps           # pnpm install(若 node_modules 不存在)
  start_backend          # go build + nohup ./bin/server,wait_for_http :8080
  start_ai_service       # .venv + pip + nohup uvicorn,wait_for_http :8000
  start_blog             # pnpm install + nohup pnpm dev,wait_for_http :3000
  start_admin            # pnpm install + nohup pnpm dev,wait_for_http :5173
  if PROD_MODE:    start_gateway "nginx.conf"
  if GATEWAY_MODE: start_gateway "nginx.dev.conf"
  show_status
  exit 1 if FAILED_SERVICES
}
```

### 2.2 三种模式参数

`start.sh:65-88`:

```bash
./start.sh                     # 直连(默认)
./start.sh --gateway           # 开发网关 dev
./start.sh --prod              # 生产网关
./start.sh --with-middleware   # 同时起 postgres/redis(默认 --no-middleware)
./start.sh --skip-elasticsearch
./start.sh --remove-orphans
```

`start.sh:32-49` 默认值:

```bash
PROD_MODE=false
GATEWAY_MODE=false
START_MIDDLEWARE=false       # 默认不起中间件,因为大多数本机 dev 已经常驻 docker 中间件
HEALTH_RETRIES=3
HEALTH_RETRY_DELAY=5
HTTP_TIMEOUT=5
MIDDLEWARE_RETRIES=3
MIDDLEWARE_RETRY_DELAY=5
MIDDLEWARE_LOG_TAIL=80
```

### 2.3 模式 vs 行为矩阵

| 选项 | start_middleware | start_backend | start_blog | start_admin | start_gateway |
| --- | --- | --- | --- | --- | --- |
| `(无参数)` | 跳过 | ✓ | ✓ | ✓ | 跳过 |
| `--gateway` | 跳过 | ✓ | ✓ | ✓ | nginx.dev.conf |
| `--prod` | 跳过 | ✓ | ✓ | ✓ | nginx.conf(走 docker compose -f prod 拉 gateway,fallback `docker run --network host`) |
| `--with-middleware` | docker compose up -d postgres+redis | ✓ | ... | ... | ... |

注意 `start.sh:1159-1170`:`--prod` 模式下 gateway 启动用 `docker_compose -f docker-compose.prod.yml up -d gateway`,fallback 是 `docker run --network host`(不是 docker compose 网络)。生产实际部署应该 `docker compose -f docker-compose.prod.yml up -d`,start.sh --prod 主要给本机模拟。

---

## 3. bootstrap_env() 详解

`start.sh:362-505`:**首次启动友好** —— 缺 `.env` 自动从 `.env.example` 拷贝,缺密钥自动生成强随机值,**已有非空值不会被覆盖**(保护手填密钥)。

### 3.1 处理流程

```
1) .env 不存在?
   - PROD_MODE=true   → FATAL,要求手动建强 .env
   - 否则             → cp .env.example .env

2) PROD_MODE=false 时:
   - POSTGRES_PASSWORD 空 → 检查 postgres 数据卷是否存在
       存在 → 用 docker-compose 历史默认 aetherblog123(避免与 PGDATA 分叉)
       不存在 → gen_url_safe_secret(base64url,无 / + =)
   - REDIS_PASSWORD 空 → gen_url_safe_secret(redis 不持久化口令,可安全轮换)

3) 通用密钥(任何模式):
   - JWT_SECRET 空 → openssl rand -base64 48
   - AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN 与 AI_INTERNAL_SERVICE_TOKEN 任一空 → 生成同一份值

4) AI_CREDENTIAL_ENCRYPTION_KEYS:
   - 计算 _legacy_jwt_derived_key = urlsafe_b64encode(sha256(JWT_SECRET))
   - 现值空 → 新生成 Fernet key + 把 legacy 拼到末位
   - 现值非空 + 不含 legacy + AI_LEGACY_KEY_FALLBACK != false → 把 legacy 追加到末位
   - 现值非空 + 已含 legacy → 跳过

5) PROD_MODE=true:
   - require_prod_secure_field POSTGRES_PASSWORD ≠ aetherblog123  (不静默改写,FATAL 引导手动 ALTER ROLE)
   - bootstrap_prod_secure_field REDIS_PASSWORD ≠ aetherblog_dev  (静默替换为强随机)
   - bootstrap_prod_secure_field AUTH_COOKIE_SECURE ≠ false       (改为 true)
   - 删除 REDIS_HOST=localhost(让各运行环境默认值接管)

6) apps/{blog,admin}/.env.local 缺失 → cp .env.local.example

7) export POSTGRES_PASSWORD / REDIS_PASSWORD 到当前 shell
```

### 3.2 关键行为细节

#### `gen_url_safe_secret()`(`start.sh:170-176`)

```bash
openssl rand -base64 48 | tr -d '\n' | tr '+/' '-_' | tr -d '='
```

为什么必须 url-safe:`POSTGRES_PASSWORD` 后续会被拼进 `postgresql+asyncpg://user:pass@…` DSN,`/` 在 URL userinfo 段是分隔符,`+` 也是保留字符,标准 base64 会让 asyncpg 把 DSN 解析坏(codex review on PR #613)。

#### `docker_compose_project_name()`(`start.sh:184-208`)

不是硬编码 `aetherblog_postgres_data`,而是动态解析:

1. 优先用 `COMPOSE_PROJECT_NAME` env
2. 其次 `docker compose -f docker-compose.yml config --format json` 取 `.name`
3. 最后 fallback 到 `basename($PROJECT_ROOT)` normalize

避免用户改了项目名 / `-p custom-name` / 用 worktree(目录名变)时漏判数据卷存在性。

#### `_ensure_ai_credential_keys()`(`start.sh:231-301`)

**VULN-056 升级 fallback** —— 老版本用 `_legacy_jwt_derived_key(JWT_SECRET) = urlsafe_b64encode(sha256(JWT_SECRET))` 加密 ai_credentials。VULN-056 修复后这把派生 key 不再写入生产代码路径,只剩 `scripts/rotate_credentials.py` 在迁移窗口手动挂上。

`bootstrap_env` 的智能行为:**自动把 legacy 派生 key 拼到 `AI_CREDENTIAL_ENCRYPTION_KEYS` 末位**,Fernet `MultiFernet` 用首位加密、全部 keys 解密 → 旧密文不会突然 InvalidToken。

opt-out:`AI_LEGACY_KEY_FALLBACK=false` 让用户在 `rotate_credentials.py` 跑完后阻止下次启动再次追加。

#### `require_prod_secure_field` vs `bootstrap_prod_secure_field`(`start.sh:303-356`)

两套语义:
- **require_prod_secure_field**(POSTGRES_PASSWORD):**有持久化绑定** 的字段,改 .env 静默替换会与既存 PGDATA 分叉。改成 FATAL 引导运维手动 `ALTER ROLE`。
- **bootstrap_prod_secure_field**(REDIS_PASSWORD / AUTH_COOKIE_SECURE):**无持久化** 或 **运行时直接读** 的字段,可以安全静默替换为强值。

### 3.3 host shell 与 .env 的优先级修正

`start.sh:497-502`:

```bash
local _pg_pw _rd_pw
_pg_pw=$(get_env_field POSTGRES_PASSWORD | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
_rd_pw=$(get_env_field REDIS_PASSWORD ...)
[ -n "$_pg_pw" ] && export POSTGRES_PASSWORD="$_pg_pw"
[ -n "$_rd_pw" ] && export REDIS_PASSWORD="$_rd_pw"
```

为什么:**docker-compose interpolation 优先级是 host shell > .env**。多 project 共用 dev shell 时若 host 已 export `POSTGRES_PASSWORD`,`docker compose up` 用 host 值起 postgres,而 `start_backend` 后面 `source .env` 又拿到 .env 值,造成 backend 用 .env 口令连容器(host 口令),失败 28P01(codex P2 review on PR #613)。强制把 .env 值 push 回 host env 拉齐两条路径。

---

## 4. 健康检查机制

### 4.1 wait_for_http(`start.sh:727-755`)

```bash
wait_for_http URL NAME LOG_FILE [RETRIES=3] [DELAY=5]:
    for attempt in 1..retries:
        code=curl -s -o /dev/null -w "%{http_code}" --max-time 5 URL
        if code starts with 2 or 3: return 0
        echo failed (HTTP $code) attempt $attempt/$retries
        sleep delay
    return 1 + tail 20 lines from LOG_FILE
```

### 4.2 wait_for_process(`start.sh:702-724`)

```bash
wait_for_process PID NAME LOG_FILE:
    for attempt in 1..retries:
        ps -p $pid > /dev/null && return 0
        sleep 2
    return 1 + tail 20 lines
```

### 4.3 wait_for_middleware(`start.sh:561-673`)

更复杂:遍历 docker-compose 服务列表,每个服务:
- `docker_compose ps -q` 取 cid
- `docker inspect -f .State.Status` 必须 `running`
- `docker inspect -f .State.Health.Status` 必须 `healthy`(若有 healthcheck)
- 失败重试,最后 tail logs

`OPTIONAL_MIDDLEWARE_SERVICES=("elasticsearch")`(`start.sh:50`):elasticsearch 不就绪不视为致命,只 warn。

### 4.4 健康检查 URL 表

| 服务 | URL | 文件:行 |
| --- | --- | --- |
| backend | `http://localhost:8080/api/actuator/health` | start.sh:922 |
| ai-service | `http://localhost:8000/health` | start.sh:1034 |
| blog | `http://localhost:3000` | start.sh:1084 |
| admin | `http://localhost:5173` | start.sh:1134 |
| gateway | `http://localhost:7899/health` | start.sh:1185 |

---

## 5. JWT_SECRET 强校验

`start.sh:881-895` 与 `start.sh:996-1006`(backend 与 ai-service 各自一遍):

```bash
if [ -z "${JWT_SECRET:-}" ]; then
    echo FATAL: JWT_SECRET 未设置
    record_failure
    return
fi
if [ "${#JWT_SECRET}" -lt 32 ]; then
    echo FATAL: JWT_SECRET 长度不足 32 (实际 ${#JWT_SECRET})
    record_failure
    return
fi
```

**VULN-121** 修复:历史上某分支 fallback 到固定 dev 字符串,导致开发与生产共用已知密钥。

`AI_CREDENTIAL_ENCRYPTION_KEYS` 同款强校验(`start.sh:1009-1015`)。

---

## 6. PID / Lock 管理

### 6.1 目录结构

`start.sh:17-22`:

```
$PROJECT_ROOT/
├── logs/         ← startup.log / shutdown.log / 各服务日志
├── .pids/        ← backend.pid / ai-service.pid / blog.pid / admin.pid
└── .locks/       ← start.lock 防 start 并发,stop.lock 同款
```

### 6.2 acquire_lock(`start.sh:676-699`)

mkdir-based 锁:
1. `mkdir $LOCK_PATH` 原子成功 → 写入 PID + `trap rm EXIT`
2. 失败 + 旧 PID 仍存活 → 报错退出
3. 失败 + 旧 PID 已死 → 抢占重建

### 6.3 read_pid(`start.sh:514-523`)

只信纯数字 PID,防止 `cat | echo` 的非数字内容污染。

---

## 7. 启动每个服务的细节

### 7.1 start_backend(`start.sh:853-934`)

```bash
1. 检查 PID 文件,已运行则跳过
2. source .env (set -a / set +a 自动 export)
3. 强校验 JWT_SECRET ≥ 32
4. 自动生成 internal service token(若 .env 缺)
5. go build -o bin/server ./cmd/server
6. nohup bin/server > logs/backend.log &
7. wait_for_process + wait_for_http
```

### 7.2 start_ai_service(`start.sh:937-1043`)

```bash
1. PID 检查
2. 确保 .venv 存在
3. 检查 .venv/bin/uvicorn + import eval_type_backport,不全则 pip install -r requirements.txt
4. source .env
5. 拼 POSTGRES_DSN(若未提供):postgresql+asyncpg://user:pass@host:port/db
6. 强校验 JWT_SECRET + AI_CREDENTIAL_ENCRYPTION_KEYS
7. 继承 internal service token
8. nohup .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
9. wait_for_process + wait_for_http
```

### 7.3 start_blog / start_admin(`start.sh:1046-1143`)

```bash
1. PID 检查
2. source .env(将 NEXT_PUBLIC_* / VITE_* 注入)
3. pnpm install --silent
4. nohup pnpm dev > logs/<name>.log &
5. wait_for_process + wait_for_http
```

### 7.4 start_gateway(`start.sh:1145-1191`)

```bash
1. ensure_docker_running()
2. docker stop+rm 旧 aetherblog-gateway
3. PROD_MODE:
     docker_compose -f docker-compose.prod.yml up -d gateway
     fallback: docker run -d --network host nginx:alpine
   GATEWAY_MODE:
     docker run -d -p 7899:80 \
       -v ./nginx/${config_file}:/etc/nginx/conf.d/default.conf:ro \
       --add-host=host.docker.internal:host-gateway \
       nginx:alpine
4. wait_for_http :7899/health
```

注意 `--add-host=host.docker.internal:host-gateway`:Linux Docker 需要这个让容器解析到宿主机(macOS / Windows Docker Desktop 默认就有)。

---

## 8. stop.sh 详解

### 8.1 用法

`stop.sh:7-9`:

```bash
./stop.sh           # 停应用,保留中间件
./stop.sh --all     # 同时停中间件
./stop.sh --force   # 忽略进程身份校验/全局清理 next dev / vite
```

### 8.2 主流程

`stop.sh:255-322`:

```
[1/6] 停 backend  → stop_service backend "$PROJECT_ROOT/apps/server-go" → fallback stop_by_port 8080
[2/6] 停 ai       → stop_service ai-service ... → fallback :8000
[3/6] 停 blog     → ... → fallback :3000
[4/6] 停 admin    → ... → fallback :5173
[5/6] 清理 Node   → 仅在 --force 下 pkill -f "next dev" / pkill -f "vite"
[6/6] 停 gateway  → docker stop+rm aetherblog-gateway
[7/7] 若 --all     → docker_compose down (中间件)
```

### 8.3 进程身份校验(`stop.sh:111-131`)

`should_stop_cmd cmd pattern name pid`:
- `--force` 模式直接 OK
- 命令行包含 pattern → OK
- 进程 cwd 包含 pattern → OK(用 `lsof -p $pid -a -d cwd -Fn` 或 `pwdx`)
- 否则 skip,警告 "进程与预期不匹配"

防止误杀同名但跑在其他目录的进程(多 worktree dev 场景)。

### 8.4 stop_by_port(`stop.sh:189-213`)

PID 文件不存在或 stale 时,用 `lsof -ti :$port` 取占用进程,逐个 should_stop_cmd 校验后 kill。

### 8.5 stop_pid(`stop.sh:133-151`)

`SIGTERM` + 5s 等待 → 仍存活则 `SIGKILL`(`kill -9`)。

---

## 9. restart.sh 详解(prod 专用)

### 9.1 用法

`restart.sh:6-10`:

```bash
./restart.sh                    # 重启所有应用容器
./restart.sh backend            # 只重启后端
./restart.sh blog admin         # 重启指定
./restart.sh --pull             # 拉最新镜像后重启
```

### 9.2 主流程

`restart.sh:34-99`:

```
[1/3] 检查 PostgreSQL 状态
       未运行 → docker compose up -d postgres + 等 pg_isready
[2/3] --pull 时 docker compose pull 目标服务
[3/3] 对每个目标:
       已 running 且无 --pull → docker restart <container>(秒级)
       否则                  → docker compose up -d --no-deps <svc>
```

`--no-deps` 是关键:不动 postgres / redis,纯应用层热重启。

`docker restart` 与 `docker compose up -d --no-deps` 区别:
- `docker restart`:容器内进程优雅重启,镜像不变,~2-3s
- `up -d --no-deps`:停旧容器 + 起新容器(可能拉新镜像),~10-30s

### 9.3 服务列表

`restart.sh:23`:

```bash
APP_SERVICES=(backend ai-service blog admin gateway)
```

无参数时全部重启,这是日常运维最常用命令。

---

## 10. 移动端真机调试支持

参考 `.claude/docs/startup-and-env.md`:

```bash
./start.sh --gateway
# 手机访问 http://<Mac-IP>:7899
```

关键依赖:
- `apps/blog/.env.local`:`NEXT_PUBLIC_ADMIN_URL=/admin/`(**相对路径**),否则手机会跳到 `http://localhost:5173/`
- `nginx.dev.conf` 走 `host.docker.internal`,容器内可达宿主机 :3000 / :5173 / :8080 / :8000
- Vite admin 默认仅监听 localhost,**直连模式**手机访问需 `pnpm dev -- --host 0.0.0.0`(start.sh 没强制加,直连模式手机访问 admin 5173 不通)
- Next.js 默认 `0.0.0.0`(`apps/blog/Dockerfile:73 ENV HOSTNAME=0.0.0.0`),手机直连 :3000 OK

---

## 11. 启动失败处理

### 11.1 record_failure(`start.sh:507-511`)

```bash
record_failure() { FAILED_SERVICES+=("$name"); }
```

每个 start_* 函数失败时调用,主流程末尾:

`start.sh:1258-1260`:

```bash
if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    exit 1
fi
```

### 11.2 show_status(`start.sh:1193-1236`)

打印所有入口 URL + 日志路径:

```
🌐 统一入口 (网关): http://localhost:7899
    └─ /        → 博客前台
    └─ /admin/  → 管理后台
    └─ /api     → 后端 API

📌 直接访问端口 (可选):
  📝 博客前台: http://localhost:3000
  ⚙️  管理后台: http://localhost:5173
  🔧 后端 API: http://localhost:8080
  🤖 AI 服务: http://localhost:8000

  📁 日志目录: $LOG_DIR
  📄 启动日志: $LOG_FILE
```

如果有 `FAILED_SERVICES`,会以红色警告列出。

---

## 12. 已知限制

1. **`start.sh` 不会自动起 Docker Desktop on Linux**(`start.sh:766-771`)只支持 macOS `open -a Docker`,Linux 用户必须手动启 daemon。
2. **direct mode admin 不监听 0.0.0.0**:Vite 默认 localhost only,手机访问 5173 需手动 `pnpm dev -- --host 0.0.0.0`,start.sh 没传 `--host`。
3. **`--prod` 模式与 `docker-compose.prod.yml` 行为不一致**:start.sh --prod 把 backend / ai / blog / admin 跑成宿主机进程(.venv / pnpm dev),只把 gateway 容器化;真正生产是全容器化。所以 `--prod` 名实不符,实际是 "本机模拟生产网关",不能完全信任为生产前烟测。
4. **stop.sh 中间件 stop 用 `docker_compose down`** 而不是 `docker compose -f docker-compose.dev.yml down`,如果你用 `--gateway` 起的(用 dev compose),stop 走默认 compose 会漏掉 dev 网关容器。当前 dev 网关是 docker run 起的,所以巧合不漏,但是脆弱。
5. **`bootstrap_env` 在 worktree 下可能误判数据卷**:`docker_compose_project_name()` 默认 fallback 到 `basename($PROJECT_ROOT)`,worktree 目录通常是 `worktrees/sad-gould-35d3a6` 这种,与主 worktree 的项目名不同 → 不同 worktree 间数据卷被独立判断,行为符合预期但需要注意 PG 卷不会跨 worktree 共享(可能是好事)。
6. **`HEALTH_RETRIES=3` × `HEALTH_RETRY_DELAY=5` 给的总等待 15s** 对慢机或 ai-service 冷启动可能不够。环境变量可覆盖(`HEALTH_RETRIES=10 ./start.sh --gateway`),但默认值偏低。
7. **`start.sh` 串行启动**:5 个服务串行,每个等 health 通过才下一个,完整启动 ~1-2 分钟。理论上 backend / ai / blog / admin 可并行,但当前实现严格串行。
