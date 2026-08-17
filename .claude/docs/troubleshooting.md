# 故障速查 — 启动 / 构建 / 健康检查 / 日志

> **何时读：** 启动失败；服务卡 health=starting；docker logs 异常；前端 import 报错；端口被占用；CI/CD preflight 失败。
>
> 解决任何故障**前**先做的事：`docker ps -a` + `docker logs <container>` + `./start.sh --gateway` 重跑一次（很多问题是 `.env` 或残留容器）。

---

## 1. 端口冲突（`port already allocated`）

通常是退出的容器占着端口。

```bash
docker compose down --remove-orphans
./start.sh --gateway
```

如果还在 → `lsof -i :7899`（或对应端口）找占用进程，按需 kill。

---

## 2. Go 构建异常

```bash
cd apps/server-go
go clean -cache && go build ./...
```

如果还是怪：
- `go env GOPATH GOCACHE GOMODCACHE` 确认路径
- `go mod tidy` 清理依赖
- Go 版本必须 ≥ **1.24.1**（`go version`）

---

## 3. 前端 `Failed to resolve import`

**根因：** 该 import 的依赖未在所属 `packages/*` 的 `package.json` 里声明。

**修复：**
1. 查 import 路径（`@aetherblog/ui` / `@aetherblog/hooks` / 第三方）
2. 在该包的 `package.json` 加依赖
3. `pnpm install`
4. 重启 dev server

**注意：** 不要从根 `package.json` 加 —— packages 不继承根依赖。

---

## 4. ai-service 不启动 / preflight 卡 `docker health=starting`

**症状：**
```
[FAIL] [api] ai-service health check failed (docker health=starting)
curl: (7) Failed to connect to localhost port 8000
```
Uvicorn 始终不 bind。

**第一步：**
```bash
docker logs aetherblog-ai-service --tail 200
```

### 历史最常见根因（已修复，但 fork 老版本仍可能踩）

```
ValueError: Invalid Fernet key in AI_CREDENTIAL_ENCRYPTION_KEYS: ...
(key #1 length=43, expected 32 bytes base64url)
```

旧 `deploy.sh` 的 `while IFS='=' read -r k v` 解析器会**静默吃掉** base64 Fernet key 末尾的 `=` padding（44 → 43 字符）。

**三层防御已落地（拉最新代码即可）：**

1. `ops/webhook/deploy.sh` —— 严格 `KEY=VALUE` 解析，用 `${line%%=*}` / `${line#*=}`，**不依赖 IFS tokenizer**。
2. `apps/ai-service/app/core/config.py._pad_b64url` —— 自动补齐缺失的 `=` 到 4 字节边界；与 DB 中已有凭据解密保持一致。
3. `ops/release/preflight.sh` —— **24 × 5s** 重试窗 + `docker inspect Health.Status=healthy` 作为备选通过信号。

### 其它可能根因

- **DB 不通：** ai-service lifespan 会等 asyncpg pool；`docker logs` 里看 `connection refused` → 检查 `POSTGRES_*` env
- **JWT keys 同步失败：** 启动时拉不到 `jwt_secrets` 表 → 跑一遍 backend migration 确保 000033 已应用
- **litellm 慢启动：** 冷启动 + 大 provider 列表确实可能花 30-45s，等 `start_period: 45s` 走完

---

## 5. backend 日志被健康探活刷屏

**症状：** INFO 级 `GET /api/actuator/health 200` 每 3s 刷一次（docker healthcheck + SystemMonitor）。

**已修复（拉最新代码）：** `apps/server-go/internal/middleware/trace.go` 的 `isHealthProbePath()` 把 2xx 探活降到 Debug，4xx/5xx 仍升级 Warn/Error。

**匹配路径：**
- `/api/actuator/health`
- `/api/v1/admin/system/health`
- `/api/v1/admin/system/metrics`
- 任何 `/health`、`/ready` 后缀

如果想看探活日志做调试，把日志级别在线降到 Debug：`PUT /v1/admin/system/log-level` `{"backend":"debug"}`（详见 `backend-runtime.md` §4）。

---

## 6. CI/CD preflight 报错

`ops/release/preflight.sh` 失败会列出**具体失败项**。常见类目：

| 失败项 | 常见根因 |
| --- | --- |
| `services not running` | `docker-compose.prod.yml up -d` 步骤失败 → 看 `docker logs` |
| `migration < 33` | DB 没接 migration → 手动跑 `compose run --rm backend ./migrate up` |
| `gateway /health` 503 | nginx 容器未起 / upstream 全死 |
| `ai-service /health` 超时 | 见 §4 |
| `auth enforcement` 失败 | 公共端点未鉴权或私有端点缺鉴权 → 检查最近的 router 改动 |
| `ai_providers < 60` | seed 未跑 / DB 被清 → 重跑 provider seed |
| `ai_models < 1500` | 同上，model 列表未导入 |
| `backend logs not clean` | 启动期出 ERROR → 看 `docker logs aetherblog-backend` |
| `/app/logs not readable` | 容器只读 FS + tmpfs 挂错路径 → 检查 `docker-compose.prod.yml` volumes |

---

## 6.1 GitHub Actions 突然变红，但没人改过相关代码

**典型症状：** `ai-test` job 的 **Run linting** 步骤爆出成百上千条 error（先例：507 条 / run 32047480619），而 diff 里根本没碰这些文件；把同一个 commit 拉到本地跑 `ruff check .` 却是 `All checks passed!`。

**根因：CI 工具链没钉版本，上游一次例行发版改了默认行为。**

`apps/ai-service` 当时既没有 `[tool.ruff]` 配置，CI 又裸跑 `pip install ruff` —— 于是「检查哪些规则」完全由所安装的 ruff 版本决定。ruff 0.16.0 大幅扩充了内置默认规则集（新增 `I` / `RUF` / `B` / `S` / `UP` / `SIM` / `ASYNC` / `C4` / `DTZ` …），CI 拉到 0.16.3 后存量代码里的风格问题一次性全变成 error。本地之所以是绿的，只是因为本地装的是旧版 ruff。

**诊断顺序（先比工具版本，别 diff 业务代码）：**

```bash
# 1. CI 里工具的实际版本 —— 到 job 日志的 install 步骤看解析到了哪个版本
# 2. 本地对齐同一版本复现（用独立目录，别污染现有环境）
pip install --target /tmp/ruff-repro 'ruff==<CI 里的版本>'
cd apps/ai-service && /tmp/ruff-repro/bin/ruff check . --statistics   # 按规则聚合，一眼看出是哪个规则族新进来的

# 3. 确认当前生效的规则集是不是自己声明的
/tmp/ruff-repro/bin/ruff check . --show-settings | sed -n '/linter.rules.enabled/,/^]/p'
```

**修复：钉死两处**（详见 `.claude/docs/deployment-cicd.md` §7.1）——
规则集钉 `apps/ai-service/pyproject.toml` 的 `[tool.ruff.lint].select`，工具版本钉 `apps/ai-service/requirements-lint.txt` 的 `ruff==`。

> ⚠️ **不要用 `--exit-zero` / 删 lint 步骤 / 大范围 `# noqa` 糊过去** —— 那是把门禁关掉，不是修好。也不要顺手把新暴露的几百条告警混进「修流水线」的 PR 里：清理存量告警是独立工作，单开 PR。

---

## 7. JWT 验签失败 / 登录后 401

可能场景：
- **轮换刚发生，旧 token 仍可用：** `previous_grace`（默认 48h）窗口内应该 OK；超过 → 用户需重新登录
- **手动 rotate 后立即所有人下线：** 这是设计行为（应急响应），用户重新登录拿新 token
- **ai-service 验签失败但 backend 通过：** ai-service 的 `jwt_keys` 同步任务延迟（最多 60s），等一下重试

排查：
```bash
docker exec -it aetherblog-postgres psql -U aetherblog -c "SELECT id, status, created_at FROM jwt_secrets ORDER BY created_at DESC LIMIT 5;"
```
确认 `current` 与 `previous` 都在。

---

## 8. 媒体上传到云失败 / 状态卡 `PENDING`

排查路径：

```bash
# 1. 看 sync_jobs 表
docker exec -it aetherblog-postgres psql -U aetherblog -c \
  "SELECT id, media_id, status, attempts, last_error, updated_at FROM media_sync_jobs ORDER BY updated_at DESC LIMIT 10;"

# 2. 看 backend 日志中的 SyncService 段
docker logs aetherblog-backend --tail 500 | grep -i sync

# 3. 测 storage provider 连通性
# admin /settings → 存储管理 → 该 provider → "测试连接" 按钮
```

常见根因：
- `last_error: signature mismatch` → endpoint / region / accessKey / secretKey 配错
- `last_error: bucket not exists` → bucket 名拼错或未创建
- `last_error: permission denied` → IAM 策略缺 PutObject / GetObject

---

## 9. Codex 设计违规扫描出 error

```bash
pnpm design-system:check    # 列出违规
pnpm design-system:fix      # 自动应用替换映射
pnpm design-system:report   # 生成 Markdown 报告
```

规则定义在 `.claude/design-system/deprecations.json`（sunset 2026-07-17）。
**红线：保持 `0 error`**；warning / info 数量持续递减，实时数据跑 `pnpm design-system:report` 查看。

新增 error 通常是用了 `legacy-glass-classes`（`.glass` / `.glass-card` 等）—— 改用 `.surface-leaf` / `.surface-raised` 对应层级。

---

## 9.1 Admin 列表页一打开就 `ErrorBoundary` 白屏（Go nil slice → `null`）

**现象：** 进入某个后台列表页（如「试卷拆题」`/qa`）瞬间触发全局 `ErrorBoundary`「页面加载失败」，桌面端控制台报 `Cannot read properties of null (reading 'some'/'map')`。**只在该列表为空时复现**（无数据 / 过滤无命中）。

**根因：** Go 的空 `[]T` 是 `nil`，`json.Marshal` 编码成 `null`。handler 直接 `response.OK(c, map{"list": docs})` 且未做 nil 守卫时，前端 `setDocs(res.data.list)` 拿到 `null`，下一次渲染 `docs.some(...)` / `docs.map(...)` 即崩。

**修复（双层）：**
- 后端 handler 返回前收敛：`if docs == nil { docs = []model.X{} }`（参照 `qa_handler.go` 的 `Tree` / `List`）。
- 前端兜底：`setDocs(res.data.list ?? [])`。

**自查：** 新增「返回数组的 list 接口」时，后端务必 nil-guard，前端 setState 务必 `?? []`。

---

## 10. 通用诊断命令清单

```bash
# 容器状态
docker ps -a
docker stats --no-stream

# 单容器深度
docker logs <container> --tail 200 -f
docker exec -it <container> sh
docker inspect <container> | jq '.[0].State.Health'

# 网关健康
curl -i http://localhost:7899/health
curl -i http://localhost:7899/api/v1/admin/system/health   # 需要鉴权

# DB 直连
docker exec -it aetherblog-postgres psql -U aetherblog -d aetherblog

# Redis 直连
docker exec -it aetherblog-redis redis-cli -a aetherblog_dev

# 重启单服务
docker compose -f docker-compose.prod.yml restart backend
```
