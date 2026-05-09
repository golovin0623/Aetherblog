# 05 · 鉴权 Middleware 链路 / Context 注入 / 受保护路由白名单

> 关注问题: Echo middleware 在每条路由上的执行顺序、`echo.Context` 中存了什么(`loginUser` / 用户信息提取助手)、哪些路由是公开 / 受 JWT 保护 / 必须 admin。

---

## 1. 责任范围

1. **JWTAuth 系列中间件**: 从请求中抽 token,验签后把 `*jwtutil.LoginUser` 写入 `echo.Context`。
2. **JWTOptional 系列**: 同上,但解析失败不拦截 —— 用于"已登录用户看到额外信息,未登录也能正常浏览"的公开端点。
3. **RequireRole**: 角色白名单,必须挂在 JWTAuth 之后。
4. **RequirePasswordRotated**: 拦截 `mcp=true` 的 token,把默认密码账号关在改密相关端点的小笼子里。
5. **AssertOwnership / SnapshotFromContext**: 让 handler / service 在不挂中间件的情况下做"调用者必须是资源 owner"的校验。
6. **JWT Cookie 命名常量**: `AccessTokenCookie` = `ab_access_token`,`RefreshTokenCookie` = `ab_refresh_token`。
7. **限流中间件(RateLimitByIP / RateLimitByUser)** 与本子模块协同,通过 `GetLoginUser` 拿 UserID 作为限流维度。

---

## 2. 关键代码入口

### 2.1 文件清单

| 文件 | 内容 |
| --- | --- |
| `apps/server-go/internal/middleware/jwt.go` | JWT / 角色 / 密码强制 / Ownership 中间件全部实现(共 226 行) |
| `apps/server-go/internal/middleware/jwt_test.go` | RequirePasswordRotated 三态 + JWTAuthWithKeys 透传 mcp claim |
| `apps/server-go/internal/middleware/cors.go` | CORS,与本模块无直接耦合 |
| `apps/server-go/internal/middleware/ratelimit.go` | 限流;`RateLimitByUser` 通过 `GetLoginUser` 取 userID |
| `apps/server-go/internal/middleware/recovery.go` / `trace.go` | 全局兜底,不参与鉴权决策 |
| `apps/server-go/internal/server/server.go:setupRoutes` | 唯一的中间件挂载源点 |

### 2.2 关键函数与位置

| 函数 | 位置 |
| --- | --- |
| `JWTAuth(secret string)` 单 key 兼容版 | `middleware/jwt.go:30-32` |
| `JWTAuthWithStore(*jwtkeys.Store)` 生产路径 | `middleware/jwt.go:36-38` |
| `JWTAuthWithKeys(keys func() []string)` 通用形式 | `middleware/jwt.go:42-69` |
| `JWTOptional / JWTOptionalWithStore / JWTOptionalWithKeys` | `middleware/jwt.go:73-99` |
| `AssertOwnership(c, ownerID *int64)` | `middleware/jwt.go:111-123` |
| `SnapshotFromContext(c)` 把 LoginUser 转 Service 友好快照 | `middleware/jwt.go:136-145` |
| `RequireRole(roles...)` | `middleware/jwt.go:149-165` |
| `RequirePasswordRotated()` | `middleware/jwt.go:180-193` |
| `GetLoginUser(c)` | `middleware/jwt.go:196-199` |
| `extractToken(c)`(Authorization header → fallback Cookie) | `middleware/jwt.go:204-215` |
| `mustParseID(s)`(safe ParseInt,err → 0) | `middleware/jwt.go:219-225` |

---

## 3. 请求处理时序

### 3.1 全局中间件链(server.go:149-153)

```
                      Echo.Use 顺序
                            │
                            v
   ┌─────────────────────────────────────────┐
   │ middleware.Recovery() — panic 兜底      │
   │ middleware.Trace()    — 请求 ID 注入    │
   │ middleware.CORS(...)  — Origin 白名单   │
   └─────────────────────────────────────────┘
                            │
                            v
                      group / route 私有中间件
```

### 3.2 受保护路由的中间件叠加顺序

以 `/v1/admin/posts` 为例:

```
1. Echo.Use 全局
   Recovery → Trace → CORS
2. group("/v1/admin", authMW, pwdRotated, requireAdmin)
   JWTAuthWithStore                  ← 验 token + 写 LoginUser
   RequirePasswordRotated             ← 拦 mcp=true
   RequireRole("admin")               ← 拦非 admin
3. handler 自己
   PostHandler.MountAdmin → 各 handler
```

**关键不变量**: 顺序不能调换。
- `RequirePasswordRotated` 必须在 `JWTAuthWithStore` 之后,因为它依赖 `LoginUser` 已经在 context;
- `RequireRole` 也必须在 `JWTAuthWithStore` 之后;
- `RateLimitByUser` 应当尽量靠后,以便已登录用户用 `u:<UserID>` 作为限流键(顺序错了会 fallback 到 IP)。

---

## 4. token 提取规则

`extractToken`(`jwt.go:204-215`):

```
优先级 1: Authorization: Bearer <token>
优先级 2: Cookie ab_access_token
找不到: 返回空串 → JWTAuthWithStore 立即 401
```

> **设计取舍**: 同时支持 Authorization 头和 Cookie 是为了:
> - 浏览器走 Cookie(HttpOnly,JS 不可访问,XSS 防御)
> - SSE / mobile / 第三方客户端走 Authorization 头
>
> 但**没有 CSRF token**,因为 SameSite=Strict 已经覆盖大多数 CSRF 场景。一旦改成 SameSite=Lax 或 None,需要补 CSRF 校验。

---

## 5. echo.Context 中存的内容

### 5.1 `loginUser` 键

```go
const ContextKeyLoginUser = "loginUser"     // jwt.go:22

c.Set(ContextKeyLoginUser, &jwtutil.LoginUser{
    UserID:             ...,
    Username:           ...,
    Role:               ...,
    MustChangePassword: ...,    // 透传 JWT mcp claim
})
```

读取入口: **统一**通过 `middleware.GetLoginUser(c)` —— 不要直接 `c.Get("loginUser")`,因为 GetLoginUser 已经做了类型断言 + nil 兜底。

### 5.2 `LoginUserSnapshot` 结构(给 service 层用)

```go
// middleware/jwt.go:129-145
type LoginUserSnapshot struct {
    UserID  int64
    IsAdmin bool
}
```

**用途**: service 层不应导入 echo / JWT 包,所以 handler 在调 service 前用 `middleware.SnapshotFromContext(c)` 把 `LoginUser` 转成只含基础类型的 snapshot 传下去。

**当前调用方**: 搜索 `SnapshotFromContext` 在仓库内的引用基本只有定义点 —— 这个 helper 是给后来的 handler 用的"工具",目前还没有大量使用。

### 5.3 没有别的鉴权相关 key

- 没有 `requestID` —— 那是 trace.go 的事
- 没有 session 对象 —— 因为 SessionService 是无 Echo 依赖的

---

## 6. 受保护路由全清单

> 路径基于 `server.go:setupRoutes`(`apps/server-go/internal/server/server.go:156-390`)。
>
> 标记说明:
> - 🟢 公开:无任何鉴权中间件
> - 🟡 限流公开:仅有 RateLimitByIP
> - 🔵 半保护:JWTAuthWithStore(也可能 + pwdRotated)
> - 🔴 强保护:JWTAuthWithStore + RequirePasswordRotated + RequireRole("admin")

### 6.1 公开端点(🟢 / 🟡)

| 路径 | 中间件 | 说明 |
| --- | --- | --- |
| `GET /api/actuator/health` | 🟢 | 健康检查 |
| `GET /api/uploads/*` | 🟢(Echo Static) | 媒体文件直接读取 |
| `POST /api/v1/auth/login` | 🟡 RateLimitByIP("rate:login", 10/min) | 登录 |
| `POST /api/v1/auth/refresh` | 🟢 | Refresh Token 流程,无 JWT(冷启动) |
| `POST /api/v1/auth/logout` | 🟢 | 注销 |
| `GET  /api/v1/public/categories/*` | 🟢 | 分类树 |
| `GET  /api/v1/public/friend-links` | 🟢 | 友链 |
| `GET  /api/v1/public/site/*` | 🟢 | 站点设置 |
| `GET  /api/v1/public/posts/*` | 🟢 | 文章 |
| `POST /api/v1/public/posts/:slug/verify-password` | 🟡 RateLimitByIP("rate:postpwd", 10/min) | 加密文章解锁 |
| `GET  /api/v1/public/archives/*` | 🟢 | 归档 |
| `*    /api/v1/public/comments/*` | 🟢 / 🟡(POST 限 5/min) | 评论 |
| `GET  /api/v1/public/search` | 🟡 RateLimitByIP("rate:search", 30/min) | 公开搜索 |
| `GET  /api/v1/public/search/qa` | 🟡 RateLimitByIP("rate:qa", 5/min) | 问答 |
| `POST /api/v1/public/visit` | 🟡 RateLimitByIP("rate:visit", 60/min) | VULN-036 防灌库 |

### 6.2 半保护(🔵)

| 路径 | 中间件 | 说明 |
| --- | --- | --- |
| `GET  /api/v1/auth/me` | JWTAuthWithStore | 查自身 —— 默认密码账号也能调 |
| `POST /api/v1/auth/change-password` | JWTAuthWithStore + RateLimitByUser("rate:changepwd", 5/min) | 改密 —— 默认密码账号必须能调 |
| `PUT  /api/v1/auth/profile` | JWTAuthWithStore + RequirePasswordRotated | 改资料 —— 必须先改密 |
| `PUT  /api/v1/auth/avatar` | JWTAuthWithStore + RequirePasswordRotated | 改头像 |
| `POST /api/v1/auth/register` | JWTAuthWithStore + pwdRotated + RequireRole("admin") + RateLimitByIP(5/min) | 管理员代为注册 |
| `*    /api/v1/agent/*` | JWTAuthWithStore + RequirePasswordRotated + RateLimitByUser | Agent 工作台,任意已登录用户可访问 |

### 6.3 强保护(🔴 admin only)

挂在 `admin := api.Group("/v1/admin", authMW, pwdRotated, RequireRole("admin"))` 下的全部子路由。

```
/v1/admin
├─ /auth                  (auth_handler.MountAdmin)
│   ├─ GET  /jwt-secret-meta
│   └─ POST /rotate-jwt-secret
├─ /categories /tags /friend-links /settings  (内容管理)
├─ /system                (system_handler / system_monitor_handler / log_level_handler)
├─ /posts                 (post_handler)
├─ /comments              (comment_handler)
├─ /media                 (media_handler / sync_handler / folder_handler / permission_handler 等)
├─ /storage               (storage_provider_handler, sync_handler.Mount)
├─ /stats /activities     (analytics)
├─ /migrations            (data migration)
├─ /ai /providers         (AI 代理 / provider 管理)
└─ /search                (搜索管理 + profiles 代理)
```

### 6.4 关键路由白名单设计原则

| 设计 | 体现位置 |
| --- | --- |
| 改密相关端点(`/me`、`/change-password`、`/refresh`、`/logout`)**不**挂 RequirePasswordRotated | `server.go:194-201`;`jwt.go:179` 注释 |
| `/v1/admin/*` group 强制 RequireRole("admin")(VULN-052) | `server.go:204-208` |
| `/v1/agent/*` **不**挂 RequireRole —— 任何登录用户可用 | `server.go:351-366` 与该处注释 |
| 公开 `/v1/public/visit` 必须限流 —— 避免 VULN-036 灌库 | `server.go:335-339` |

---

## 7. 配置 / 环境变量

本子模块**没有专属配置项**。所有行为由调用方通过 middleware 函数参数注入(roles 列表、限流计数、key prefix 等)。

唯一与 middleware 间接相关的全局配置:
- `cfg.JWT.*` 决定 JWT Store 的轮换 / Reload 节奏(参模块 01)
- `cfg.Auth.Cookie.*` 决定写 cookie 时的 Secure / SameSite 标志,middleware 不直接读

---

## 8. 已知限制与待改进

### 8.1 P1: `AssertOwnership` / `RequireRole` 没有单元测试

参模块 03 §10。`AssertOwnership` 的 4 态(未登录 / admin / owner / 非 owner)与 `RequireRole` 的 case-insensitive 行为目前完全靠手工保护。

### 8.2 P2: token 提取顺序无法配置

`extractToken` 硬编码 "Authorization 优先,Cookie 兜底"。如果未来要支持纯 Cookie 模式(防止 admin 后台某些攻击场景误把 token 拷到 LocalStorage),需要改源码。

### 8.3 P2: 没有 CSRF token

参 §4 取舍说明。一旦放宽 SameSite,需要补 CSRF。

### 8.4 P2: `LoginUserSnapshot` 利用率低

参 §5.2。Snapshot helper 是为了 service 层不依赖 echo / jwt,但目前各 service 直接接收 `userID, isAdmin` 等单字段,Snapshot 没成为统一约定。建议把现有 service 重构成接收 `*LoginUserSnapshot` 单参数,提高一致性。

### 8.5 P3: `RequireRole` 角色字符串没枚举类型

接受任意字符串,case-insensitive 比较。如果改成 `RequireRole(model.RoleAdmin, model.RoleAuthor)` 形式(`model/user.go` 加 `type Role string` 枚举),编译期就能拦截手误。

### 8.6 P3: `JWTOptional` 几乎没人用

公开路由(`/v1/public/*`)目前都是无 token 直接走,没有"已登录用户看到额外字段"的差异化。`JWTOptional` 长期闲置,代码审查时容易被误删。

---

## 9. 测试覆盖说明

### 9.1 已覆盖

`middleware/jwt_test.go`:
- `TestRequirePasswordRotated` 三态(`jwt_test.go:21-93`)
  - 未登录 → 401
  - mcp=false → 放行
  - mcp=true → 403 且下游 handler 不被调用
- `TestJWTAuthWithKeys_PopulatesMustChangePasswordClaim`(`:97-142`)
  - JWT 解析后 mcp claim 透传到 LoginUser,UserID/Username/Role 也正确

### 9.2 未覆盖

- `JWTAuth` / `JWTAuthWithStore`:无 token / 错误 token / 空 keys / Authorization vs Cookie 优先级
- `JWTOptional*`:无 token 时不拦截、错误 token 时不拦截
- `RequireRole`:case-insensitive、多角色 OR、未登录、role 不在白名单
- `AssertOwnership`:四态 + admin 大小写
- `SnapshotFromContext`:nil LoginUser、admin 大小写

补这部分单元测试 ROI 高 —— 中间件是所有受保护路由的公共闸门,一处出错全站受影响。
