# 01 · JWT 签发 / 校验 / 轮换 与 Session 模型

> 关注问题: 客户端拿到的 access / refresh 令牌如何被生成、校验、轮换、撤销;签名密钥如何在 DB 中流转。

---

## 1. 责任范围

本子模块覆盖以下能力:

1. **Access Token 签发**: 登录成功 → 用 `jwtkeys.Store.Current()` 签出 HS256 JWT,经 HttpOnly Cookie 与 JSON 响应同时下发。
2. **Access Token 校验**: 中间件按 `[current, previous]` 顺序尝试验签;`mcp` claim 透传到 `LoginUser`。
3. **Refresh Token 签发与轮换**: 32 字节随机串以 SHA-256 存 Redis;每次刷新都"撤销 + 新发"。
4. **JWT 签名密钥定时轮换**: `jwtkeys.Store` 在后台 goroutine 中按 `RotationInterval` 自动 demote current → previous,并清理过期 previous。
5. **管理员手动轮换**: `POST /v1/admin/auth/rotate-jwt-secret` 在密钥泄漏紧急场景下立即生成新 current。

---

## 2. 关键代码入口

### 2.1 Access Token

| 行为 | 位置 |
| --- | --- |
| 自定义 claims 类型 + GenerateToken | `apps/server-go/internal/pkg/jwtutil/jwtutil.go:22-72` |
| ParseToken / ParseTokenWithKeys(双 key 验签) | `apps/server-go/internal/pkg/jwtutil/jwtutil.go:74-129` |
| Login 处理(签发 + 写 Cookie) | `apps/server-go/internal/handler/auth_handler.go:189-256` |
| `generateAccessToken` 透传 mcp claim | `apps/server-go/internal/handler/auth_handler.go:451-460` |
| `writeAuthCookies` / `clearAuthCookies` | `apps/server-go/internal/handler/auth_handler.go:485-522` |

### 2.2 Refresh Token

| 行为 | 位置 |
| --- | --- |
| SessionService 入口 | `apps/server-go/internal/service/session_service.go:23-48` |
| IssueRefreshToken(写 Redis + 用户索引) | `apps/server-go/internal/service/session_service.go:50-73` |
| RotateRefreshToken("一次性"语义) | `apps/server-go/internal/service/session_service.go:75-103` |
| RevokeRefreshToken / RevokeAllUserSessions | `apps/server-go/internal/service/session_service.go:105-126` |
| Refresh handler | `apps/server-go/internal/handler/auth_handler.go:273-309` |
| Logout handler | `apps/server-go/internal/handler/auth_handler.go:328-335` |

### 2.3 JWT 签名密钥

| 行为 | 位置 |
| --- | --- |
| `jwtkeys.Store` 数据结构与构造 | `apps/server-go/internal/pkg/jwtkeys/store.go:31-57` |
| Reload(DB → 内存快照) | `apps/server-go/internal/pkg/jwtkeys/store.go:78-101` |
| Rotate(生成 + 写 DB + 刷新内存) | `apps/server-go/internal/pkg/jwtkeys/store.go:103-117` |
| 后台 reloader / rotator goroutine | `apps/server-go/internal/pkg/jwtkeys/store.go:119-178` |
| `JWTSecretRepo.Rotate`(单事务 demote + insert) | `apps/server-go/internal/repository/jwt_secret_repo.go:99-149` |
| `BootstrapIfEmpty`(启动时 seed) | `apps/server-go/internal/repository/jwt_secret_repo.go:69-97` |
| `PurgeExpiredPrevious`(到期 retire) | `apps/server-go/internal/repository/jwt_secret_repo.go:195-208` |
| 启动接线 | `apps/server-go/internal/server/server.go:113-131` |
| 管理员手动轮换 handler | `apps/server-go/internal/handler/auth_handler.go:148-184` |
| 元数据查询(管理 UI) | `apps/server-go/internal/handler/auth_handler.go:90-138` + `repository/jwt_secret_repo.go:151-193` |

---

## 3. 数据流

### 3.1 登录签发

```
Client POST /api/v1/auth/login {username, password}
    │
    v
[middleware] CORS → Trace → Recovery
    │
    v
[ratelimit] RateLimitByIP("rate:login", 10/min)
    │
    v
AuthHandler.Login (auth_handler.go:189)
    ├─ AuthService.AssertLoginAllowed(redis EXISTS auth:login:lock:*)
    ├─ AuthService.FindByUsernameOrEmail(userRepo.FindByUsernameOrEmail)
    │       └─ SQL: SELECT * FROM users WHERE username=$1 OR email=$1
    ├─ AuthService.ValidatePassword(bcrypt.CompareHashAndPassword)
    ├─ AuthService.CheckUserCanLogin (status==ACTIVE 且非未轮换种子 admin)
    ├─ AuthService.UpdateLoginInfo(userRepo.UpdateLoginInfo)
    │       └─ SQL: UPDATE users SET last_login_at=$1, last_login_ip=$2 WHERE id=$3
    ├─ generateAccessToken(jwtutil.GenerateToken with jwtKeys.Current(), mcp claim)
    ├─ session.IssueRefreshToken
    │       └─ Redis MULTI:
    │              SET    auth:refresh:<sha256>  <userID>  EX <refreshTTL>
    │              SADD   auth:user_sessions:<userID>  auth:refresh:<sha256>
    │              EXPIRE auth:user_sessions:<userID>  <refreshTTL>
    ├─ writeAuthCookies (Set-Cookie ab_access_token + ab_refresh_token, HttpOnly)
    └─ activitySvc.Create(EventType="user.login", Status="SUCCESS", IP=ip)
```

### 3.2 受保护资源请求(普通账号)

```
Client GET /api/v1/auth/me
    Cookie: ab_access_token=<JWT>   (或 Authorization: Bearer <JWT>)
    │
    v
JWTAuthWithStore middleware (jwt.go:36)
    ├─ extractToken(优先 Authorization: Bearer,fallback Cookie)
    ├─ jwtutil.ParseTokenWithKeys(token, jwtKeys.Verifiers())
    │       ├─ 顺序尝试 [current, previous]
    │       ├─ 强制 alg=HS256 (防 alg:none)
    │       └─ 区分 SignatureInvalid (轮转下一个 key) vs Expired/Format(立即返错)
    ├─ c.Set("loginUser", &LoginUser{UserID, Username, Role, MustChangePassword})
    └─ next(c)
        │
        v
AuthHandler.Me (auth_handler.go:313)
    ├─ middleware.GetLoginUser(c)
    └─ AuthService.FindByID → userRepo.FindByID → SELECT * FROM users WHERE id=$1
```

### 3.3 Refresh 流程(单次使用 + 滚动续期)

```
Client POST /api/v1/auth/refresh  (Cookie: ab_refresh_token=<token>)
    │
    v
AuthHandler.Refresh (auth_handler.go:273)
    ├─ getCookieValue("ab_refresh_token")
    ├─ session.RotateRefreshToken
    │       ├─ Redis GET auth:refresh:<sha256>   → val=userID
    │       ├─ Redis DEL auth:refresh:<sha256>   (旧 token 立即作废,防重放)
    │       └─ session.IssueRefreshToken (新 token 进 Redis + 索引)
    ├─ AuthService.FindByID → 查最新 user 状态
    ├─ AuthService.CheckUserCanLogin (ACTIVE 校验 + 默认密码兜底)
    ├─ generateAccessToken (新 access JWT)
    └─ writeAuthCookies (Set-Cookie 更新两个 cookie)

       关键不变量: 同一个 refresh token 永远只能用一次
```

### 3.4 JWT 签名密钥轮换(后台自动)

```
启动时 (server.go:113-131)
    ├─ jwtRepo := NewJWTSecretRepo(db)
    ├─ jwtkeys.New(ctx, jwtRepo, cfg.JWT.Secret)
    │       ├─ jwtRepo.BootstrapIfEmpty (若表空则用 seed 写一条 current)
    │       └─ Reload (一次性同步快照到内存)
    ├─ jwtStore.StartReloader(ctx, 60s)        ─┐
    └─ jwtStore.StartRotator(ctx, 7d, 48h)     ─┴── 后台 goroutine

Reloader 每 60s tick:
    └─ Reload (SELECT … WHERE status IN ('current','previous')) → 写入 store.{current,previous}

Rotator 每 7d tick:
    ├─ jwtRepo.PurgeExpiredPrevious (UPDATE … status='retired' WHERE retires_at <= NOW())
    ├─ generateSecret(48 bytes)
    ├─ jwtRepo.Rotate (BEGIN; UPDATE previous→retired; UPDATE current→previous(retires_at=now+grace); INSERT new current; COMMIT;)
    └─ Reload
```

### 3.5 管理员手动轮换(VULN-152 应急通道)

```
Admin POST /v1/admin/auth/rotate-jwt-secret
    │
    v
[admin group] JWTAuthWithStore → RequirePasswordRotated → RequireRole("admin")
    │
    v
AuthHandler.RotateJWTSecret (auth_handler.go:148-184)
    ├─ 取 cfg.JWT.PreviousGrace(默认 48h)
    ├─ jwtKeys.Rotate(ctx, grace)        // 同 3.4 的 jwtRepo.Rotate + Reload
    ├─ activitySvc.Create(EventType="security.jwt_rotate", Category="security", Status="SUCCESS")
    └─ 响应 {rotatedAt, previousGraceHours}   // 永不回传 secret_value
```

---

## 4. 涉及的 DB 表与字段

### 4.1 `jwt_secrets`(migration 000033)

```sql
CREATE TABLE jwt_secrets (
    id            BIGSERIAL PRIMARY KEY,
    secret_value  TEXT NOT NULL,          -- 实际 base64 字符串,不外露
    status        VARCHAR(16) NOT NULL    -- 'current' | 'previous' | 'retired'
                  CHECK (status IN ('current','previous','retired')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_at   TIMESTAMPTZ,            -- 被晋升为 current 的时间
    demoted_at    TIMESTAMPTZ,            -- 被降级为 previous 的时间
    retired_at    TIMESTAMPTZ,            -- 被标记为 retired 的时间
    retires_at    TIMESTAMPTZ             -- previous 期间的"计划过期点",rotator 据此清理
);

-- 部分唯一索引: 同一时刻最多一条 current 与一条 previous
CREATE UNIQUE INDEX uq_jwt_secrets_current  ON jwt_secrets(status) WHERE status='current';
CREATE UNIQUE INDEX uq_jwt_secrets_previous ON jwt_secrets(status) WHERE status='previous';
CREATE INDEX idx_jwt_secrets_retires_at ON jwt_secrets(status, retires_at);
```

**关键不变量**: 任意时刻 `(SELECT COUNT(*) FROM jwt_secrets WHERE status='current') = 1`。Rotator 用 `RowsAffected() <= 1` 自检(`jwt_secret_repo.go:131-133`)。

### 4.2 `users` 表(本模块只读取 / 更新登录与密码相关字段)

| 字段 | 在本模块的作用 |
| --- | --- |
| `password_hash` | bcrypt(`$2a$10$...`),DefaultCost = 10 |
| `last_login_at` / `last_login_ip` | 登录成功后写入 |
| `must_change_password` | 影响 access token 的 `mcp` claim;`UpdatePassword` 时自动清零 |
| `status` | `ACTIVE` 才能登录 |

完整 schema 见 `02-user-management.md` §4。

### 4.3 没有 `sessions` 表

所有 Session 元数据都在 Redis,详见 §5。

---

## 5. 配置 / 环境变量 / Redis Key

### 5.1 配置项(`internal/config/config.go:90-113`)

| 字段 | YAML 键 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `JWT.Secret` | `jwt.secret` | (无,必填) | 启动 seed,长度 ≥ 32;若 `jwt_secrets` 表已有 current 行则不会覆盖 |
| `JWT.Expiration` | `jwt.expiration` | `24h` | Access Token 有效期,同步用作 cookie MaxAge |
| `JWT.RefreshExpiration` | `jwt.refresh_expiration` | `168h` (7d) | Refresh Token 在 Redis 的 TTL |
| `JWT.RotationInterval` | `jwt.rotation_interval` | `168h` (7d) | 自动轮换间隔;0 = 禁用 |
| `JWT.PreviousGrace` | `jwt.previous_grace` | `48h` | 旧密钥降级后的"只验不签"窗口 |
| `JWT.ReloadInterval` | `jwt.reload_interval` | `60s` | DB → 内存快照刷新频率 |
| `Auth.Cookie.Secure` | `auth.cookie.secure` | `true` | 是否设置 Secure 标志 |
| `Auth.Cookie.SameSite` | `auth.cookie.same_site` | `Strict` | `Strict` / `Lax` / `None` |

### 5.2 环境变量

- `AETHERBLOG_JWT_SECRET` / 兼容裸 `JWT_SECRET` → `cfg.JWT.Secret`(`config.go:209-213`)
- `AETHERBLOG_JWT_EXPIRATION` 等 koanf 标准映射

### 5.3 Redis Key 命名

| Key 模板 | TTL | 含义 |
| --- | --- | --- |
| `auth:refresh:<sha256(token)>` | `JWT.RefreshExpiration` | Value = userID(int64 文本) |
| `auth:user_sessions:<userID>` | `JWT.RefreshExpiration` | Set,成员是该用户所有活跃 refresh key |
| `auth:login:fail:<username>:<ip>` | `15m` | 单 IP 失败次数 |
| `auth:login:fail:user:<username>` | `15m` | 全 IP 汇总失败次数 |
| `auth:login:lock:<username>:<ip>` | `15m` | 该 IP 被锁定 |
| `auth:login:lock:user:<username>` | `15m` | 整个用户名被锁定(全 IP 汇总超阈) |

---

## 6. 已知限制与待改进

### 6.1 多副本下 Rotator 竞争

`jwtkeys.Store.StartRotator` 注释提到 "推荐 leader election via pg_try_advisory_lock,或在 docker-compose 单副本部署场景下直接裸跑"(`store.go:6-9`)。**当前未实现 advisory lock** —— 多副本同时 tick 会导致两个事务同时 demote → unique 索引冲突 → 一边失败但密钥已部分轮换。

短期靠"backend 容器单副本"兜底,要上 K8s / 多副本必须补 leader election。

### 6.2 JWT 验签密钥仅 2 把(current + previous)

按设计 `Verifiers()` 只返回 `[current, previous]`,意味着 grace window 内若发生**第二次**轮换,第一次 demote 的 previous 立刻变 retired,所有用它签的 access token 立即失效(用户掉线)。短期内连续两次手动轮换是危险操作,文档应明确"建议两次手动轮换间隔 ≥ PreviousGrace"。

### 6.3 Refresh Token 索引一致性边界

`IssueRefreshToken` 用 `TxPipelined` 包住三条 Redis 命令(`session_service.go:60-71`),但 Redis pipeline 不支持原子回滚 —— 命令级错误不触发 EXEC 回滚。代码用"刚写入则手动 DEL"做兜底,但这只是"尽力而为",连接断在第 2 条与第 3 条之间会留下"游离 token + 不完整索引"。实际影响有限(单个 token 多 64 字节),但若关心审计精确性,需要把"用户主动登出全部"改为"轮询 SCAN match auth:refresh:* 找 userID 匹配项"做兜底清理。

### 6.4 没有"当前会话列表" API

用户无法在管理界面看自己的活跃 refresh token / 登录设备。Redis 里有 `auth:user_sessions:<id>` Set 可以列举,但目前没有 handler 暴露;若需要,需新增:
- `GET /v1/auth/sessions` 返回当前用户活跃 token 数 + 各 token 的最后使用时间(还要在 Redis 中加 last_used_at 字段)
- `DELETE /v1/auth/sessions/:id` 撤销指定会话

### 6.5 `UpdateLoginInfo` 失败被静默吞掉

`AuthService.UpdateLoginInfo` 把 error 直接 `_=` 忽略(`auth_service.go:131-134`)。DB 抖动期间登录会成功但审计字段没更新,运维很难发现。建议改成 warn 级日志。

### 6.6 `WriteAuthCookies` 的 path 与跨域

`ab_refresh_token` 的 path 设为 `/api/v1/auth`(`auth_handler.go:489-490`),意味着 nginx 反向代理时**必须保留这一段路径**,否则浏览器不会回带 cookie,导致刷新流程失败。这是部署上的隐式约束,在 nginx 模板里有体现但代码侧无显式校验。

---

## 7. 测试覆盖说明

### 7.1 `pkg/jwtutil/jwtutil_test.go`

覆盖以下核心场景:

- `TestGenerateAndParseToken` —— 普通 token 往返(`jwtutil_test.go:8-42`)
- `TestGenerateAndParseToken_MustChangePassword` —— `mcp=true` claim 透传(`:44-59`)
- `TestParseToken_InvalidSecret` —— 单 key 错误时拒绝(`:61-69`)
- `TestParseToken_Expired` —— 过期 token 拒绝(`:71-79`)
- `TestParseTokenWithKeys_AcceptsPrevious` —— 多 key 顺序验证,previous 被接受(`:81-101`)
- `TestParseTokenWithKeys_RejectsUnknown` —— retired 密钥签的 token 一律拒绝(`:103-113`)
- `TestParseTokenWithKeys_EmptyKeys` —— 参数错误兜底(`:115-121`)

### 7.2 `middleware/jwt_test.go`

- `TestRequirePasswordRotated` —— 三态(未登录 401 / 普通账号放行 / mcp=true 403)(`jwt_test.go:21-93`)
- `TestJWTAuthWithKeys_PopulatesMustChangePasswordClaim` —— `mcp` claim 从 token 透传到 `LoginUser`(`:97-142`)

### 7.3 `handler/auth_handler_test.go`

只覆盖了管理员元数据相关 helper(无完整登录链路集成测试):

- `TestAuthHandler_GetJWTSecretMeta_ReturnsErrorWhenRepoMissing`(`:15-35`)
- `TestRotationIntervalDays_*`、`TestPreviousGraceHours_DefaultsToFortyEightWhenUnset`、`TestFormatNullableTime_*`(`:37-72`)

### 7.4 没有覆盖

- `SessionService` 的 `IssueRefreshToken` / `RotateRefreshToken` —— 依赖 Redis,需要 miniredis 或集成测试。
- `jwtkeys.Store` 的 `Rotate` / `Reload` —— 依赖 Postgres,需要 testcontainer 或 sqlmock。
- `AuthHandler.Login` / `Refresh` / `Logout` 的端到端 happy path。

补充测试是 P2 优先级,不影响生产,但回归保护薄弱。
