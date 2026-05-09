# 01 · 后端 鉴权与用户 模块

> 版本基线: 2026-05-08(migrations 000001 / 000002 / 000011 / 000033 / 000046,后端 26 个 handler)
> 模块路径: `apps/server-go/internal/{handler,service,repository,middleware,model,dto,pkg/{jwtutil,jwtkeys}}`

---

## 1. 模块定位

本模块负责 AetherBlog 后端的全部 **身份核验 / 会话生命周期 / 角色与资源访问控制** 链路,是其他所有业务模块(内容、媒体、AI、Agent)的鉴权前置,核心问题是:

- 谁是请求者(JWT 解析)
- 是否允许进入(`role` / `must_change_password` / `status`)
- 是否拥有目标资源(folder_permissions / ownership 检查)
- 在凭据泄漏时如何降低爆炸半径(JWT 密钥定时轮换 + 双 key 验签)

模块内不包含针对性的 2FA / TOTP 实现 —— 详见 `04-totp-2fa.md`。

---

## 2. 边界与职责

### 2.1 模块包含

| 能力 | 子文档 |
| --- | --- |
| JWT 签发、验签、密钥轮换、Refresh Token 轮换 | `01-jwt-and-sessions.md` |
| 用户 CRUD、强制改密、默认管理员、应急重置 | `02-user-management.md` |
| 角色 / 文件夹权限 / IDOR 拦截 | `03-rbac-permissions.md` |
| TOTP / 2FA(目前未实现) | `04-totp-2fa.md` |
| JWT / RBAC / RequirePasswordRotated / AssertOwnership 中间件链路 | `05-auth-middleware.md` |

### 2.2 模块不包含(在其他模块)

| 关注点 | 实际归属 |
| --- | --- |
| 媒体文件具体上传 / 同步 / 标签 | `03-backend-media-storage` |
| 限流脚本本身的实现细节 | 本模块只引用 `middleware.RateLimitByIP/User`,实现属基础设施 |
| 加密密钥(`AI_CREDENTIAL_ENCRYPTION_KEYS`)解密 | `pkg/cryptkey` 属基础设施 |
| 活动审计 storage layer | `model/analytics.go` + `service.ActivityService`,本模块仅作消费者 |

---

## 3. 架构图(ASCII)

```
                              HTTP Request
                                   |
                                   v
                ┌──────────────────────────────────┐
                │    Echo Router (server.go)       │
                │  /api/v1/auth/* / /v1/admin/*    │
                └─────────────────┬────────────────┘
                                  |
                                  v
                ┌─────────────────────────────────────┐
                │  Middleware Chain (执行顺序由上至下) │
                │                                     │
                │  CORS / Trace / Recovery (全局)     │
                │  └─ JWTAuthWithStore   ──┐          │
                │  └─ RequirePasswordRot. ─┤          │
                │  └─ RequireRole("admin")─┤          │
                │  └─ RateLimitBy(IP|User)─┘          │
                └─────────────────┬───────────────────┘
                                  |
              ┌───────────────────┼─────────────────────┐
              v                   v                     v
    ┌────────────────┐   ┌────────────────┐   ┌──────────────────────┐
    │ AuthHandler    │   │ PermissionHdlr │   │ 业务 Handler          │
    │ (auth_handler) │   │ (permission_   │   │ AssertOwnership(c,…) │
    │                │   │   handler)     │   │ in handler 内部       │
    └───────┬────────┘   └────────┬───────┘   └──────────┬───────────┘
            |                     |                      |
            v                     v                      v
    ┌────────────────┐   ┌────────────────┐   ┌──────────────────────┐
    │ AuthService    │   │ PermissionSvc  │   │ FolderService /      │
    │ SessionService │   │                │   │ Other Services       │
    └───────┬────────┘   └────────┬───────┘   └──────────┬───────────┘
            |                     |                      |
            v                     v                      v
    ┌────────────────┐   ┌────────────────┐   ┌──────────────────────┐
    │ UserRepo       │   │ PermissionRepo │   │ FolderRepo / Others  │
    │ JWTSecretRepo  │   │ (folder_perms) │   │                      │
    └───────┬────────┘   └────────┬───────┘   └──────────┬───────────┘
            |                     |                      |
            v                     v                      v
    ┌─────────────────────────────────────────────────────────────────┐
    │                      存储层(分级)                                │
    │  PostgreSQL                       │   Redis                     │
    │  - users                          │   - auth:refresh:<sha256>   │
    │  - jwt_secrets (current/previous) │   - auth:user_sessions:<id> │
    │  - folder_permissions             │   - auth:login:fail:*       │
    │  - activity_events (审计)         │   - auth:login:lock:*       │
    └─────────────────────────────────────────────────────────────────┘
                                  ^
                                  | (后台 goroutine 直接交互)
                                  |
                  ┌───────────────┴───────────────┐
                  │ jwtkeys.Store                  │
                  │  - StartReloader(60s 同步快照) │
                  │  - StartRotator(7d 自动轮换)   │
                  │  - PurgeExpiredPrevious()      │
                  └────────────────────────────────┘
```

---

## 4. 子模块清单

| 文档 | 关注问题 | 关键代码入口 |
| --- | --- | --- |
| [01-jwt-and-sessions.md](./01-jwt-and-sessions.md) | Access/Refresh Token 怎么签、怎么验、怎么轮换 | `pkg/jwtutil/jwtutil.go`, `pkg/jwtkeys/store.go`, `service/session_service.go` |
| [02-user-management.md](./02-user-management.md) | 用户表如何被读写 / 默认 admin / 强制改密 | `repository/user_repo.go`, `service/auth_service.go`, `migrations/000002_seed_data.up.sql` |
| [03-rbac-permissions.md](./03-rbac-permissions.md) | 角色枚举 / 资源权限 / VULN-038 ownership 链 | `middleware/jwt.go`(RequireRole/AssertOwnership), `handler/permission_handler.go`, `migrations/000011` |
| [04-totp-2fa.md](./04-totp-2fa.md) | TOTP 现状 = 未实现,但保留位置说明 | (无对应代码) |
| [05-auth-middleware.md](./05-auth-middleware.md) | Echo middleware 编排顺序 / context 注入 | `middleware/jwt.go`, `server/server.go:setupRoutes` |

---

## 5. 横向依赖

### 5.1 被本模块调用

```
AuthHandler ──> AuthService ──> UserRepo (postgres users)
            ──> SessionService ──> Redis (auth:*)
            ──> jwtkeys.Store ──> JWTSecretRepo ──> postgres jwt_secrets
            ──> ActivityService (审计落盘)

PermissionHandler ──> PermissionService ──> PermissionRepo (postgres folder_permissions)
                  ──> FolderService.GetOwnerID ──> FolderRepo

middleware.JWTAuthWithStore ──> jwtkeys.Store.Verifiers() ──> jwtutil.ParseTokenWithKeys
middleware.RequirePasswordRotated ──> 仅查 LoginUser.MustChangePassword,无外部依赖
middleware.AssertOwnership ──> 仅查 LoginUser.UserID + LoginUser.Role,无外部依赖
```

### 5.2 调用本模块

| 调用方 | 调用形式 |
| --- | --- |
| 全部 `/api/v1/admin/*` 路由 | 挂 `JWTAuthWithStore + RequirePasswordRotated + RequireRole("admin")` |
| `/api/v1/auth/{me,profile,avatar,change-password}` | 挂 `JWTAuthWithStore`(部分加 pwdRotated) |
| `/api/v1/agent/*`(Agent 工作台) | 挂 `JWTAuthWithStore + RequirePasswordRotated`,但**不**挂 RequireRole |
| 媒体上传 / 文件夹操作 / 各业务 service | handler 层手动调 `middleware.AssertOwnership` 或 `PermissionRepo.HasWriteAccess` |
| 限流(`RateLimitByUser`) | 通过 `middleware.GetLoginUser(c)` 取 UserID 作为限流维度 |

---

## 6. 关键决策记录

### 6.1 JWT 密钥从环境变量 → 数据库管理 + 定时轮换

**决策**: 启动时 `cfg.JWT.Secret` 仅作 seed,落入 `jwt_secrets` 表;实际签名 / 验签密钥由 `jwtkeys.Store` 的内存快照提供,后台 goroutine 每 7 天自动轮换。

**触发原因**: VULN-152 历史 commit 已把一次性 admin JWT 写进 git,即便手动轮换 `JWT_SECRET` 也只是延后下一次泄漏。把密钥提升为"DB 管理 + 双 key 验签 + 强制 grace window"的资源后,泄漏后只需 `POST /v1/admin/auth/rotate-jwt-secret` 即可计划外轮换,无需重启。

**位置**:
- 决策文档: `apps/server-go/migrations/000033_jwt_secrets.up.sql:1-23`
- 代码实现: `apps/server-go/internal/pkg/jwtkeys/store.go:1-14`

### 6.2 Refresh Token 存 SHA-256 哈希,不存原值

**决策**: Cookie 中是原始 64 字符 token,Redis 中只保存其 SHA-256(`auth:refresh:<hex>` → `userID`)。

**理由**: Redis 数据(快照、内存 dump、第三方 mc-tooling)如果泄露,攻击者拿到的也只是哈希,无法直接重放为合法 cookie。

**位置**: `apps/server-go/internal/service/session_service.go:128-133`(`buildRefreshKey`)

### 6.3 `must_change_password` 拦截放在 middleware 层而不是登录服务层

**决策**: 默认密码账号(seed admin / 管理员重置)仍能正常登录拿到 JWT(token 中带 `mcp=true` claim),但 `RequirePasswordRotated` 中间件把这种 token 关在 `/me` / `/change-password` / `/refresh` / `/logout` 四个端点之内,业务接口一律 403。

**理由**: 在登录端点直接拒绝会造成"无法拿到 JWT → 无法调用需要 JWT 的 `/change-password`"的自服务死锁,只能通过运维直接 SQL 改库,与产品声称的"首次登录强制改密"语义直接矛盾。

**例外**: `AuthService.CheckUserCanLogin` 仍硬拒绝**完全等于种子哈希**的 admin 账号(`auth_service.go:73-83`),避免攻击者利用公开默认凭据走通"登录 + 改密"接管账号。

**位置**:
- 决策文档: `apps/server-go/internal/middleware/jwt.go:167-193`
- 服务层兜底: `apps/server-go/internal/service/auth_service.go:55-83`

### 6.4 不引入 `sessions` 表,Refresh Token 全部走 Redis

**决策**: 没有 PG `sessions` 表;Refresh Token 元数据(`token_hash → userID`)及 per-user 索引(`auth:user_sessions:<id>` Set)全部存 Redis。

**取舍**: 牺牲了"用户在管理界面看自己有哪些活跃会话"的能力,但避免了写一份重复的会话 CRUD,也避免了 PG/Redis 双写一致性问题。

**位置**: `apps/server-go/internal/service/session_service.go:1-21`

### 6.5 Cookie 路径分离 + HttpOnly + 默认 SameSite=Strict

**决策**:
- `ab_access_token` Cookie path = `/api`(让 SSR 同域请求可发出)
- `ab_refresh_token` Cookie path = `/api/v1/auth`(只在 refresh / login / logout 端点可见,缩小暴露面)
- 默认 `Secure=true`、`SameSite=Strict`(可由 `auth.cookie.same_site` 配置覆盖)
- 全部 `HttpOnly` —— JS 不可读

**位置**: `apps/server-go/internal/handler/auth_handler.go:485-522`

### 6.6 文件夹权限独立于角色(RBAC + ABAC 混合)

**决策**: 角色只决定能否进入 `/v1/admin/*` 群组(粗粒度);具体能否操作某个文件夹由 `folder_permissions` 表定义(细粒度)。两者**不可互换**(参 jwt.go:101-123 注释 "深度防御,与 RequireRole 在 group 层互补")。

**位置**: `apps/server-go/internal/middleware/jwt.go:111-123` + `apps/server-go/migrations/000011_add_permissions_and_sharing.up.sql:5-19`

### 6.7 强制密码复杂度由后端 validator 规则保障

**决策**: 注册和改密都通过 `password_complexity` validator(大小写字母 + 数字),不允许前端绕开。

**位置**: `apps/server-go/internal/server/server.go:38-55` + `apps/server-go/internal/dto/auth.go:13,20`

---

## 7. 技术栈与库版本

| 关注点 | 库 | 备注 |
| --- | --- | --- |
| HTTP 框架 | `github.com/labstack/echo/v4` | 全后端统一 |
| JWT | `github.com/golang-jwt/jwt/v5` | HS256,显式拒绝其他 alg(防 alg:none) |
| 密码哈希 | `golang.org/x/crypto/bcrypt` | `DefaultCost`(当前 = 10) |
| 配置 | `github.com/knadh/koanf` | YAML + AETHERBLOG_ 前缀环境变量 + 兼容裸 `JWT_SECRET` 等 |
| 校验器 | `github.com/go-playground/validator/v10` | 注册了自定义 `password_complexity` |
| Redis | `github.com/redis/go-redis/v9` | 用 Lua 脚本做原子限流 |
| Postgres | `github.com/jmoiron/sqlx` + `lib/pq` | sqlx,无 ORM |
| 日志 | `github.com/rs/zerolog` | 结构化 JSON 日志 |
| 加解密(媒体凭据) | `pkg/cryptkey/fernet.go` | 和本模块无直接交集,但同一份 cfg 流过 |

---

## 8. 已知问题清单

> 用 `Pn` 标注严重度: P1 = 影响安全 / 数据,P2 = 影响可用性 / 体验,P3 = 美化/重构机会。

### P1

- **JWT 密钥多实例 leader 竞争未实现**: `StartRotator` 注释提到 "推荐 leader election via pg_try_advisory_lock,或在单副本部署场景下直接裸跑"(`jwtkeys/store.go:6-9`)。**当前代码没有 advisory lock**,多副本同时跑时会出现"两个 rotator 同时 demote → 两个新 current 行竞争 unique 索引"的失败。短期靠 docker-compose 单副本兜底;一旦上 K8s / 多副本就要补。
- **`folder_permissions.permission_level` 在 model 注释里仍写 "read/write/admin"**(`model/folder_permission.go:11`),但 DB CHECK 实际枚举是 `VIEW/UPLOAD/EDIT/DELETE/ADMIN`(migration 000011 + dto/media.go)。注释会误导后来人写错代码 —— `PermissionRepo.HasWriteAccess` 已经踩过这个坑(PR #647 P1 修复)。
- **`User.Role` DB CHECK 是大写 `ADMIN/AUTHOR/USER`**(migration 000001:35)、`AssertOwnership` 与 `RequireRole` 都做 `strings.ToLower` 比较;但**没有跨层 normalize**,如果未来某条 INSERT 用小写,DB 会直接 reject。这是可观察的"约束保险丝"。
- **`UpdateAvatar` 仅在 handler 层校验 scheme**(`auth_handler.go:418-426`),Service 层 `UpdateAvatar` 不再二次校验。新的入口(管理 admin UI、未来批量 import)直接走 service 时会绕过 XSS 拦截。

### P2

- **Refresh Token 只有 Redis 一份存储**: Redis 重启 / FLUSHALL → 全员强制重登。已在文档 6.4 明确取舍,但还是值得在备份策略里反映。
- **`MaxFailedAttempts` 等阈值硬编码**(`auth_service.go:27-31`),无法运维侧动态调整。生产场景如果遇到登录风暴需要紧急放宽,只能改代码 + 重启。
- **强制改密拦截没有审计事件**: `RequirePasswordRotated` 返回 403 时只走 `response.FailWith`,没有 `activity_events` 落盘,因此运维无法在审计日志里看到"哪个账号反复试图绕过改密"。
- **登录 IP 提取走 `c.RealIP()`**: Echo 默认信任 `X-Forwarded-For`,在 nginx → backend 链路下没问题;但如果中间多了一层未清理 `X-Forwarded-For` 的代理,攻击者可以伪造 IP 触发 `auth:login:fail:user:<x>` 之外的 IP 桶,绕过单 IP 限流(总桶 `:user:` 仍可拦)。

### P3

- `model/folder_permission.go` 的字段注释和实际枚举不一致(同上);
- `auth_handler_test.go` 覆盖只到 helper 函数,Login / Refresh / ChangePassword 等核心路径无 handler-level 集成测试,完全靠 service 层 + middleware 层测试拼起来。
- `dto/auth.go:34` 注释提到 "管理后台头像上传是 `/uploads/avatars/...` 相对路径",和 `auth_handler.go:418-426` 的拦截白名单基本对应,但 admin 端是否走"上传到本地 → 更新 avatar URL"的两步,需要在 admin 端文档(模块 06)交叉验证。

---

## 9. 扩展点

### 9.1 接入 SSO / OIDC

入口: `Login` handler 现在直接读 `dto.LoginRequest`(用户名+密码)。要接 SSO,需要:
1. 增加 `POST /api/v1/auth/sso/start` 与 `POST /api/v1/auth/sso/callback` 路由(`server.go:setupRoutes` authGroup);
2. callback 内拿到外部 IdP 用户标识后,通过 `userRepo.FindByEmail` / `userRepo.Create` 走 just-in-time provisioning;
3. 复用 `generateAccessToken` + `IssueRefreshToken` 完成本地会话化。

注意必须保留 `JWTAuthWithStore` 中间件链,因为下游路由全部依赖 `LoginUser` 上下文。

### 9.2 添加 TOTP / WebAuthn

详见 `04-totp-2fa.md`。最小实现是新 migration 加 `user_totp` 表 + Login 流程拆成两阶段(`/login/start` 返回 `mfaToken`,`/login/verify` 拿 mfaToken + TOTP 换 access token)。

### 9.3 多实例部署的 JWT rotator leader election

在 `jwtkeys.Store.StartRotator` 之前包一层:

```go
acquired, _ := db.Exec("SELECT pg_try_advisory_lock($1)", rotatorLockKey)
if acquired { go rotator() } else { /* 跟随模式,只 reload */ }
```

需要在每个 tick 里重新 try lock + 释放,避免节点宕机后锁无人释放。

### 9.4 Refresh Token 持久化迁移

如果未来要支持"用户登出全部设备"且无法接受 Redis 数据丢失的体验:
1. 加 migration 创建 `user_sessions` 表(token_hash, user_id, last_used_at, ua, ip, expires_at);
2. `IssueRefreshToken` 双写 PG + Redis,Redis 充当读缓存;
3. `RotateRefreshToken` 走"软删除 + 新建" 而非 `DEL`,保留审计轨迹。

### 9.5 Cookie SameSite=None 跨域支持

如果博客前端和 admin 后台部署在不同顶级域名(目前都通过 nginx 网关做 reverse proxy 同源),需要把 `auth.cookie.same_site` 配为 `None` 并强制 `Secure=true`。代码已支持(`auth_handler.go:511-520`),只需运维侧改配置。
