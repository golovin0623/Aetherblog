# 02 · 用户管理 / 默认管理员 / 强制改密 / 应急重置

> 关注问题: `users` 表结构、CRUD 入口、默认 admin 账号、首次登录强制改密语义、密码哈希策略、应急人工干预手段。

---

## 1. 责任范围

1. **用户档案 CRUD**: 注册、查询、更新昵称 / 邮箱 / 头像、修改密码。
2. **登录信息更新**: 每次登录成功后写入 `last_login_at` / `last_login_ip`。
3. **默认管理员账号**: `admin` / `admin123`,`must_change_password=true`,首次登录拿到带 `mcp=true` 的 JWT。
4. **首次改密拦截语义**: 不在登录时拒绝,而是在中间件层把 token 限制在 4 个非业务接口(详见 `05-auth-middleware.md`)。
5. **密码哈希**: bcrypt DefaultCost(成本 10),不可逆。
6. **应急重置**: 当所有人都丢失密码时,直接 SQL 改 `password_hash` 即可恢复。

---

## 2. 关键代码入口

### 2.1 Handler 层

| 端点 | 函数 | 位置 |
| --- | --- | --- |
| `POST /api/v1/auth/login` | `AuthHandler.Login` | `apps/server-go/internal/handler/auth_handler.go:189-256` |
| `POST /api/v1/auth/register`(管理员限定) | `AuthHandler.RegisterUser` | `:258-271` |
| `GET  /api/v1/auth/me` | `AuthHandler.Me` | `:311-326` |
| `POST /api/v1/auth/change-password` | `AuthHandler.ChangePassword` | `:337-380` |
| `PUT  /api/v1/auth/profile` | `AuthHandler.UpdateProfile` | `:382-400` |
| `PUT  /api/v1/auth/avatar` | `AuthHandler.UpdateAvatar` | `:402-432` |

### 2.2 Service 层

| 函数 | 位置 |
| --- | --- |
| `AuthService.Register`(用户名 / 邮箱唯一性 + bcrypt 哈希) | `apps/server-go/internal/service/auth_service.go:91-110` |
| `AuthService.ChangePassword`(bcrypt 重哈希后落库) | `:112-119` |
| `AuthService.UpdateProfile` | `:121-124` |
| `AuthService.UpdateAvatar` | `:126-129` |
| `AuthService.UpdateLoginInfo`(即发即忘) | `:131-134` |
| `AuthService.CheckUserCanLogin`(状态 + 默认 admin 兜底) | `:55-83` |
| `AuthService.ValidatePassword`(bcrypt.CompareHashAndPassword) | `:85-89` |

### 2.3 Repository 层

| 函数 | 位置 |
| --- | --- |
| `UserRepo.FindByUsername` | `apps/server-go/internal/repository/user_repo.go:30-37` |
| `UserRepo.FindByEmail` | `:39-48` |
| `UserRepo.FindByUsernameOrEmail` | `:50-60` |
| `UserRepo.FindByID` | `:62-71` |
| `UserRepo.Create`(强制 role=USER, status=ACTIVE, must_change_password=false) | `:73-84` |
| `UserRepo.UpdateLoginInfo` | `:86-94` |
| `UserRepo.UpdatePassword`(同时清 must_change_password) | `:96-103` |
| `UserRepo.UpdateProfile` | `:105-114` |
| `UserRepo.UpdateAvatar` | `:116-123` |

### 2.4 Model

`apps/server-go/internal/model/user.go:6-21` —— `User` struct 完整字段。

---

## 3. 数据流

### 3.1 注册(管理员代为创建)

```
Admin POST /api/v1/auth/register {username,email,password,nickname}
      Cookie: ab_access_token=<admin JWT>
    │
    v
[middleware] JWTAuthWithStore → RequirePasswordRotated → RequireRole("admin")
              → RateLimitByIP("rate:register", 5/min)
    │
    v
AuthHandler.RegisterUser (auth_handler.go:260)
    ├─ bindAndValidate(dto.RegisterRequest)
    │       └─ validator: username 3-50 / email / password 8-128 + complexity / nickname max 50
    └─ AuthService.Register
            ├─ userRepo.FindByUsername  → 重名拒绝
            ├─ userRepo.FindByEmail     → 重邮箱拒绝
            ├─ bcrypt.GenerateFromPassword(DefaultCost=10)
            └─ userRepo.Create
                    └─ INSERT INTO users (..., role='USER', status='ACTIVE', must_change_password=false)
                       RETURNING *
```

> **关键观察**: Register 端点强制走 `RequireRole("admin")`,本系统**不开放**普通用户自助注册。这是博客场景常见取舍 —— 注册端点存在是为了让 admin 在 UI 里加作者账号。

### 3.2 登录 + 强制改密语义闭环

```
1) admin (默认密码) → POST /api/v1/auth/login
    ├─ ValidatePassword(admin123)        ✅
    ├─ CheckUserCanLogin
    │     └─ 仅当 password_hash == 种子哈希时拒绝(auth_service.go:73-83)
    │        否则放行(即便 must_change_password=true)
    └─ generateAccessToken
          └─ Claims.MustChangePassword = true → JWT 带 mcp=true claim

2) admin → GET /v1/admin/posts (业务接口)
    ├─ JWTAuthWithStore  → LoginUser{MustChangePassword: true}
    ├─ RequirePasswordRotated → 403 "请先完成首次登录改密后再访问该接口"

3) admin → POST /api/v1/auth/change-password {currentPassword, newPassword}
    ├─ JWTAuthWithStore  ✅(/change-password 不挂 RequirePasswordRotated)
    ├─ AuthHandler.ChangePassword (auth_handler.go:340)
    │     ├─ ValidatePassword(currentPassword)
    │     ├─ 新旧密码不同
    │     ├─ AuthService.ChangePassword
    │     │     └─ bcrypt(new) → userRepo.UpdatePassword
    │     │            └─ UPDATE users SET password_hash=?, must_change_password=false ...
    │     ├─ session.RevokeAllUserSessions(userID)
    │     │     ├─ SMEMBERS auth:user_sessions:<userID>
    │     │     ├─ DEL <每个 refresh key>
    │     │     └─ DEL auth:user_sessions:<userID>
    │     ├─ session.RevokeRefreshToken(当前 cookie)  // 双保险
    │     └─ clearAuthCookies                          // 强制重新登录

4) admin → POST /api/v1/auth/login (新密码)
    └─ generateAccessToken → mcp=false → 完整业务权限恢复
```

### 3.3 修改个人资料

```
PUT /api/v1/auth/profile {nickname, email}
    │
    v
[middleware] JWTAuthWithStore → RequirePasswordRotated
    │
    v
AuthHandler.UpdateProfile (auth_handler.go:384)
    ├─ bindAndValidate(dto.UpdateProfileRequest)
    └─ AuthService.UpdateProfile → userRepo.UpdateProfile
            └─ UPDATE users SET nickname=$1, email=$2, updated_at=NOW() WHERE id=$3 RETURNING *
```

> **观察**: `UpdateProfile` 没有重新校验邮箱唯一性 —— 若两个用户都改成同一邮箱,DB unique constraint 会抛错,但 handler 直接 `response.Error(c, err)` 返回 500,体验粗糙。

### 3.4 修改头像(VULN-047 防 XSS)

```
PUT /api/v1/auth/avatar {avatarUrl}
    │
    v
AuthHandler.UpdateAvatar (auth_handler.go:404-432)
    ├─ bindAndValidate(dto.UpdateAvatarRequest)
    │       └─ validator: required, uri, max=2048
    │       (注: dto 用 `uri` 而不是 `url`,因为允许同源相对路径如 /uploads/avatars/x.jpg)
    │
    ├─ scheme 拦截(handler 内显式)
    │       allowed:
    │              startsWith http://  ✅
    │              startsWith https:// ✅
    │              "/" 开头但不是 "//" 开头(同源绝对路径) ✅
    │       拒绝:
    │              javascript:alert(...)  ❌
    │              data:text/html,...     ❌
    │              //evil.com/x.jpg       ❌
    │
    └─ AuthService.UpdateAvatar → userRepo.UpdateAvatar
```

---

## 4. 涉及的 DB 表与字段

### 4.1 `users` 表(migration 000001)

```sql
CREATE TABLE users (
    id                   BIGSERIAL PRIMARY KEY,
    username             VARCHAR(50)  NOT NULL UNIQUE,
    email                VARCHAR(100) NOT NULL UNIQUE,
    password_hash        VARCHAR(255) NOT NULL,         -- bcrypt $2a$10$...
    nickname             VARCHAR(50),
    avatar               VARCHAR(500),
    bio                  TEXT,
    role                 VARCHAR(20)  NOT NULL DEFAULT 'USER',
    status               VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    last_login_at        TIMESTAMP,
    last_login_ip        VARCHAR(50),
    must_change_password BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_users_role   CHECK (role   IN ('ADMIN', 'AUTHOR', 'USER')),
    CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'BANNED'))
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email    ON users(email);
CREATE INDEX idx_users_status   ON users(status);
```

### 4.2 默认管理员种子(migration 000002)

```sql
-- 密码: admin123,bcrypt cost 10
INSERT INTO users (username, email, password_hash, nickname, role, status, must_change_password)
VALUES (
    'admin',
    'admin@aetherblog.local',
    '$2a$10$1B6fti5pzyTwI58rszwobe/Lpbe2GUzhUk7xVlkGe8kpTckIPsdHe',
    '管理员',
    'ADMIN',
    'ACTIVE',
    TRUE
) ON CONFLICT (username) DO NOTHING;
```

### 4.3 隐式不变量

| 不变量 | 维护点 |
| --- | --- |
| 至少一名 ADMIN 始终存在 | **未在 DB 层强制**;UI 应避免 admin 把自己降级 |
| `password_hash` 永远是 bcrypt 格式 | 仅 `service.AuthService.Register/ChangePassword` 会写入,bcrypt 是唯一路径 |
| `must_change_password` 在改密后清零 | `userRepo.UpdatePassword` 单条 UPDATE 同时改两个字段(`user_repo.go:96-103`) |
| `email` 全局唯一 | DB unique constraint;但 handler 没有重复校验,依赖 DB 抛错 → 500 |
| `username` 全局唯一 | 同上,DB unique constraint |

---

## 5. 配置 / 环境变量

### 5.1 与本子模块直接相关

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `auth.cookie.secure` | `true` | 写 `Set-Cookie` 时是否加 `Secure` 标志 |
| `auth.cookie.same_site` | `Strict` | Cookie 的 `SameSite` 模式 |
| `database.user` / `database.password` | `aetherblog` / `aetherblog123` | 这只是 PG 连接凭据,不是应用账号 |

### 5.2 间接影响(JWT / Session 详见模块 01)

`JWT.Expiration` / `JWT.RefreshExpiration` 影响 access / refresh cookie 的 MaxAge。

### 5.3 没有专属 Redis Key

用户档案不在 Redis 缓存(每次都直接 SELECT)。登录失败计数 key 见模块 01 §5.3。

---

## 6. 已知限制与待改进

### 6.1 没有"用户列表"管理 API

后端**没有**任何 `GET /v1/admin/users` / `PATCH /v1/admin/users/:id` 路由。当前 admin 后台无法在 UI 里看用户列表 / 修改他人 role / 禁用账号 —— 全部要走数据库直连。这是有意识的最小化(博客场景通常 admin 自己一个人),但与"角色字段是 ADMIN/AUTHOR/USER 三种"的设计存在脱节。

待改进路径: 新增 `UserHandler` 挂在 `admin.Group("/users")` 下,提供 List / UpdateRole / UpdateStatus,并强制审计 `event_category="user"` 落 `activity_events` 表。

### 6.2 注册端点强制 admin,但默认 admin 是 ADMIN role —— 容易混

`Register` 端点既允许新建普通 USER,也允许 admin 内部加作者(AUTHOR);但 `userRepo.Create` 把所有新用户硬编码成 `'USER'` 角色(`user_repo.go:78`)。即便 admin 想加另一个 ADMIN,也要先 Register 再 SQL 改 role。

待改进: `dto.RegisterRequest` 加可选 `Role` 字段,后端用 `validator:"oneof=USER AUTHOR ADMIN"` 限制并默认 USER。

### 6.3 邮箱 / 用户名冲突返回 500

参 §3.3。`UpdateProfile` / `Register` 都没显式拦截 unique constraint 错误,DB 层报错后 handler 直接 `response.Error(c, err)` → 500 + 内部错误信息可能被 Echo 默认错误处理器泄漏。

### 6.4 默认 admin 兜底有边界

`CheckUserCanLogin` 只识别 **完全等于** seed 哈希 `$2a$10$1B6fti5pzyTwI58rszwobe/Lpbe2GUzhUk7xVlkGe8kpTckIPsdHe` 的情况(`auth_service.go:77-79`)。如果运维用 SQL 改成新弱口令(如 `123456`)但忘了清 `must_change_password=false`,该账号能登录但仍被 `RequirePasswordRotated` 关进笼子,**直到** admin 自己用 `change-password` 流程更新密码。这是预期行为,但文档应该明确告诉运维"重置密码后建议同时更新 must_change_password"。

### 6.5 头像 URL 校验只在 Handler 层

参 README §8 P1。任何未来直接调 `AuthService.UpdateAvatar`(批量 import / SSO 同步)的代码都会绕过 scheme 白名单。建议把校验下沉到 service 层。

### 6.6 没有"用户分布 / 注册时间趋势"统计

`activity_events` 表里能用 `event_type='user.login'` 取到登录历史,但**注册事件没有审计落库**(`AuthHandler.RegisterUser` 末尾未调 `activitySvc.Create`)。新增用户的运维可见性目前仅靠 DB 直查 `created_at`。

### 6.7 `UpdateLoginInfo` 静默失败

参模块 01 §6.5。

---

## 7. 应急重置 SOP

CLAUDE.md §7 已经记录:

```sql
UPDATE users
   SET password_hash = '$2a$10$8.UnVuG9HHgffUDAlk8q2OuVGkqBKkjJRqdE7z6OcExSqz8tRdByW',
       must_change_password = TRUE,
       updated_at = NOW()
 WHERE username = 'admin';
-- 密码变成: 123456 (临时),登录后必须立即改密
```

> 操作建议: 重置后**立即**告知用户 / 自己,登录后第一件事走 `/change-password`。临时哈希在 git history 已知 → 攻击者拿到这条记录可重放。

---

## 8. 测试覆盖说明

### 8.1 `service/auth_service_test.go`

只覆盖 `CheckUserCanLogin` 四态:

- `active_user_can_login`(`auth_service_test.go:12-17`)
- `inactive_user_blocked`(`:19-24`)
- `must_change_password_user_allowed_at_service_layer` —— 关键: service 层不拦,留给 middleware 拦(`:29-34`)
- `seeded_default_admin_blocked_until_rotated` —— admin + 种子哈希被硬拦(`:36-46`)

`Register` / `ChangePassword` / `UpdateProfile` / `UpdateAvatar` 等核心写路径**没有 service 层测试**,因为它们都要碰 PG。

### 8.2 `handler/auth_handler_test.go`

只覆盖 helper(`rotationIntervalDays` / `previousGraceHours` / `formatNullableTime` / `GetJWTSecretMeta` 的 nil-repo 兜底),没有覆盖业务 handler。

### 8.3 没有覆盖

- `AuthHandler.Login` 的 happy / 频率限制 / 默认 admin 拒绝路径
- `AuthHandler.RegisterUser` 的 admin-only 与 username/email 冲突
- `AuthHandler.ChangePassword` 的旧密码校验 / 新旧相同拒绝 / 会话清理
- `AuthHandler.UpdateAvatar` 的 javascript: scheme 拦截

补这部分集成测试的 ROI 较高 —— 现在所有改密语义全靠手工回归。
