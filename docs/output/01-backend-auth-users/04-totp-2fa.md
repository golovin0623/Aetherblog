# 04 · TOTP / 2FA(当前未实现)

> 关注问题: AetherBlog 后端是否提供基于时间的一次性密码(TOTP)或其他二要素认证。
>
> **结论**: **本仓库当前不实现 TOTP / 2FA**。本文档记录"未实现"的事实、可观察证据、以及若要实现该功能时应做的工作。

---

## 1. 现状判定

### 1.1 代码层

通过对 `apps/server-go/internal/` 全目录搜索 `totp` / `TOTP` / `two_factor` / `2fa` 关键字:

```
$ grep -rn "totp\|TOTP\|two_factor\|2fa\|2FA" apps/server-go/internal/
(no output)
```

`apps/server-go/internal/handler/`、`/service/`、`/repository/`、`/model/`、`/middleware/`、`/dto/`、`/pkg/` 全部子目录均**未发现** TOTP / 2FA 相关代码。

### 1.2 数据库 migration 层

```
$ grep -rn "totp\|TOTP\|two_factor" apps/server-go/migrations/
(no output)
```

migrations 0001 ~ 0046 中**没有**任何 `user_totp` / `user_2fa_devices` / `mfa_backup_codes` / `recovery_codes` 之类的表。

### 1.3 Model

`apps/server-go/internal/model/user.go:6-21` 的 `User` 结构体只有以下字段(完整列表):

```
ID, Username, Email, PasswordHash, Nickname, Avatar, Bio,
Role, Status, LastLoginAt, LastLoginIP, MustChangePassword,
CreatedAt, UpdatedAt
```

**没有** `TotpSecret` / `TotpEnabled` / `MfaSecret` / `BackupCodes` 等字段。

### 1.4 依赖层(go.mod)

未发现 `pquerna/otp` / `xlzd/gotp` / `dgryski/dgoogauth` 之类的标准 TOTP 库依赖。基线状态下后端不具备生成 / 验证 TOTP 的能力。

### 1.5 配置层

`apps/server-go/internal/config/config.go` 的 `JWTConfig` / `AuthConfig` / `CookieConfig` 等结构体均**没有** `TOTP` / `MFA` / `TwoFactor` 子配置。

---

## 2. 设计意图(从相关代码注释推断)

虽然没有实现,但仓库其他子模块**留下了若干为未来 MFA 留位的迹象**,值得注意:

### 2.1 `middleware.RequirePasswordRotated` 的注释明确"两阶段拦截思路"

`apps/server-go/internal/middleware/jwt.go:167-193` 的注释把 "限制 token 范围" 的设计模式写得很清晰:

> 鉴权放行登录、签发携带 mcp=true 的 token,由本中间件把 token 关在 "改密+登出+查自身" 的小笼子里。

如果未来要加 MFA,可以**完全复用这套模式**:
- 用户名密码通过后,签发一个带 `mfa_required=true` claim 的"半 token";
- 新增 `RequireMFAVerified()` 中间件 —— 只放行 `/v1/auth/mfa/{verify,setup,backup}`,业务接口一律 403;
- 用户输入 TOTP 验证码后,后端核对成功 → 签发不带 `mfa_required` 的完整 token。

### 2.2 `LoginResponse.MustChangePassword` 字段的存在

`dto/auth.go:49-55` 已经把"用户必须做后续动作才能用全功能"这种语义在 LoginResponse 里建模。同一位置加一个 `MfaChallenge` 字段(返回 `mfaToken` + `availableMethods`)是顺理成章的扩展。

### 2.3 没有 sessions 表 → MFA 实现要重新设计什么

参模块 01 §6.4。当前 Session 状态完全在 Redis,如果 MFA 流程需要"半 token"概念:

- **方案 A**: 复用 JWT,半 token 的 claim 用 `mfa=pending`,放行端点白名单短;
- **方案 B**: 在 Redis 加 `auth:mfa_challenge:<challenge_id>` 暂存 userID + 过期时间(如 5 分钟),客户端拿 `challenge_id` + TOTP 来换 access token。

方案 A 不需要新数据结构,与现有 `mcp` claim 完全同构;方案 B 把 challenge 与 access token 解耦,更易做风控(IP 锁 / 速率限制),但要新增 SessionService 方法。

---

## 3. 与本仓库设计文档的关系

### 3.1 系统需求企划书

CLAUDE.md §6.1 提到"修改 Agent 模式定位 / 实施阶段(Chat / Cowork / Code)→ 同步 `docs/agent/README.md` 与对应 ROADMAP",但**没有** `docs/security/MFA_PLAN.md` 或类似规划文档。本模块作者未在本仓库找到 MFA 的产品规划记录。

### 3.2 安全审计报告(VULN-* 序列)

代码注释里能看到的 VULN- 编号(参 README §6 决策记录):
- VULN-038(Permission ownership 提权链)— 已修
- VULN-047(头像 javascript: scheme XSS)— 已修
- VULN-052(admin group 强制 RequireRole)— 已修
- VULN-152(JWT 历史泄漏 → 引入定时轮换)— 已修
- VULN-IDOR-cluster(深度防御 ownership)— 已修

**没有看到** "VULN-MFA" / "VULN-WEAK-AUTH" / "无 2FA" 相关的待修条目。这暗示当前阶段团队没有把 MFA 列为已识别的安全债。

---

## 4. 若要实现 TOTP / 2FA,需要补的工作清单

按"最小可用"路径列出:

### 4.1 Migration

```sql
-- migrations/0000XX_user_totp.up.sql
CREATE TABLE user_totp (
    user_id          BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_encrypted BYTEA NOT NULL,            -- 用 cryptkey/fernet 加密 (与 storage_providers.config_json 同套)
    enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_at       TIMESTAMPTZ,
    last_used_at     TIMESTAMPTZ,               -- 防重放: 同一 step 不能用两次
    last_used_step   BIGINT,
    backup_codes     TEXT[],                    -- bcrypt(单次使用)
    backup_codes_remaining INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 Model + Repo

- `model/user_totp.go`: `UserTOTP` struct
- `repository/user_totp_repo.go`: `Find / Create / UpdateSecret / Disable / RecordUse / ConsumeBackupCode`

### 4.3 Service

`service/totp_service.go`:
- `Setup(userID) (*Secret, *QRCodeDataURL, []BackupCode)`
- `Verify(userID, code string) (bool, error)`
- `Enable(userID, firstCode string) error`
- `Disable(userID, currentCode string) error`
- `RegenerateBackupCodes(userID) []BackupCode`

依赖建议: `github.com/pquerna/otp` —— 标准库,RFC 6238 一致。

### 4.4 Handler

`handler/totp_handler.go`,挂在 `/api/v1/auth/totp` 下:
- `POST /setup` —— 生成 secret + QR;响应 `mfaSetupToken`(短期一次性,放在 Redis)
- `POST /enable` —— 凭 `mfaSetupToken` + 当前 TOTP 码 enable
- `POST /disable` —— 凭当前密码 + 当前 TOTP 码 disable
- `POST /verify` —— 登录链路第二步使用

### 4.5 Login 流程改造

`AuthHandler.Login` 在密码通过后:
1. 查 `user_totp.enabled`
2. 若未启用 → 维持现状(直接签 access token)
3. 若已启用 → 不签 access token,只签 `mfa_required=true` 的短 JWT(5 分钟),响应 `{mfaRequired: true, mfaToken: "..."}`
4. 客户端走 `/totp/verify { mfaToken, totpCode }` → 后端验签 mfaToken + 验 TOTP → 签发完整 access token

### 4.6 Middleware

新增 `middleware.RequireMFAVerified()`:
- 原理与 `RequirePasswordRotated` 完全对称
- 若 token 带 `mfa_required=true` → 拦截除 `/v1/auth/totp/verify` 与 `/v1/auth/logout` 外的全部接口

### 4.7 测试

至少:
- TOTP 验证码窗口 ±1 容忍 测试
- 防重放(同一 step 拒绝二次使用)测试
- backup code 单次消费 测试
- enable / disable 端点的反 CSRF / 反暴力破解 限流测试

### 4.8 admin 端 UX

admin 个人设置页加"启用两步验证"卡片:
- 显示 QR 码 + 备用恢复码(下载为 txt)
- 启用后状态卡显示"已启用,最后使用 X 分钟前"

---

## 5. 风险评估(若不实现)

| 风险维度 | 当前状态 | 影响 |
| --- | --- | --- |
| 弱口令穷举 | 已有 `auth:login:fail:*` 限流(15 分钟内 5 次单 IP / 20 次全 IP 锁定) | 中:仍可被慢速分布式爆破 |
| Cookie 窃取(XSS) | HttpOnly + Secure + SameSite=Strict | 低:除非浏览器 / 网络栈漏洞 |
| 钓鱼登录 | 仅密码 | 高:若用户被钓到密码,立即可登录 |
| 物理设备失窃 | 仅密码 | 高:打开浏览器即接管所有 admin 操作 |
| 历史 commit 泄漏密码 | bcrypt 哈希,代价较高 | 中:VULN-152 是 token 泄漏,不是密码泄漏 |

加 MFA 主要解决"钓鱼"和"设备失窃" —— 在博客单作者场景下 ROI 中等,在多作者 / 团队博客场景下 ROI 较高。

---

## 6. 测试覆盖说明

无 —— 因为没有代码可测试。

---

## 7. 跨模块归属

如果未来要实现 MFA:

- **本模块(01-backend-auth-users)** 主导:Login 流程改造、Middleware、TOTP service / repo
- **08-database-migrations** 配合:user_totp 表 migration
- **06-frontend-admin** 配合:个人设置页 + 登录界面第二步 UI
- **加密密钥管理** 复用现有 `pkg/cryptkey/fernet.go`(`AI_CREDENTIAL_ENCRYPTION_KEYS`),不需要新基础设施
