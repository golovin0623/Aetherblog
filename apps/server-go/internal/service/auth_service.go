// Package service 实现 AetherBlog 的业务逻辑层。
// 每个 service 结构体持有其所依赖的仓储/客户端，并暴露供 handler 调用的领域方法。
// service 层严禁导入 handler 包，保持单向依赖。
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// 登录安全相关常量，逻辑参照 Java 版 LoginSecurityService 实现。
const (
	loginFailKeyPrefix = "auth:login:fail:" // Redis 失败计数键前缀
	loginLockKeyPrefix = "auth:login:lock:" // Redis 锁定键前缀
	seedAdminUsername  = "admin"
	seedAdminHash      = "$2a$10$1B6fti5pzyTwI58rszwobe/Lpbe2GUzhUk7xVlkGe8kpTckIPsdHe"

	maxFailedAttempts    = 5                // 触发账号锁定所需的连续失败次数（单 IP）
	maxFailedAttemptsAll = 20               // 触发账号锁定所需的连续失败次数（全 IP 汇总）
	lockDuration         = 15 * time.Minute // 账号被锁定的持续时间
	windowDuration       = 15 * time.Minute // 失败计数的时间窗口
)

// AuthService 处理用户认证相关的业务逻辑，包括登录安全防护。
type AuthService struct {
	userRepo   *repository.UserRepo
	accessRepo *repository.AccessRepo
	redis      *redis.Client
}

// NewAuthService 使用给定的用户仓储和 Redis 客户端创建 AuthService。
// Redis 用于登录频率限制；传入 nil 表示禁用频率限制功能。
func NewAuthService(userRepo *repository.UserRepo, rdb *redis.Client, accessRepo ...*repository.AccessRepo) *AuthService {
	s := &AuthService{userRepo: userRepo, redis: rdb}
	if len(accessRepo) > 0 {
		s.accessRepo = accessRepo[0]
	}
	return s
}

// UserAccess 返回用户通过 RBAC 表继承到的角色与权限。
// accessRepo 未注入时降级为 legacy users.role，保证旧测试和无迁移环境可用。
func (s *AuthService) UserAccess(ctx context.Context, userID int64, legacyRole string) ([]string, []string, error) {
	if s.accessRepo == nil {
		if legacyRole == "" {
			return []string{"USER"}, nil, nil
		}
		return []string{legacyRole}, nil, nil
	}
	roles, err := s.accessRepo.GetUserRoleCodes(ctx, userID, legacyRole)
	if err != nil {
		return nil, nil, err
	}
	perms, err := s.accessRepo.GetUserPermissionCodes(ctx, userID, legacyRole)
	if err != nil {
		return nil, nil, err
	}
	return roles, perms, nil
}

// FindByID 通过主键查询用户记录。
func (s *AuthService) FindByID(ctx context.Context, id int64) (*model.User, error) {
	return s.userRepo.FindByID(ctx, id)
}

// FindByUsernameOrEmail 通过用户名或邮箱查询用户记录，支持两种标识符登录。
func (s *AuthService) FindByUsernameOrEmail(ctx context.Context, identifier string) (*model.User, error) {
	return s.userRepo.FindByUsernameOrEmail(ctx, identifier)
}

// CheckUserCanLogin 检查用户账号状态是否允许登录。
// 当账号状态非 ACTIVE 时返回错误，提示账号已被禁用或未激活。
//
// 注意：一般情况下 MustChangePassword 不在此处拦截 —— 拦截下来用户连 JWT 都拿不到，
// 而 /change-password 端点本身需要 JWT 鉴权，会形成自服务死锁。
// 安全兜底改在 middleware.RequirePasswordRotated：登录可正常签发 token，
// 但 token 携带 mcp=true 时除 /me /change-password /refresh /logout 外的
// 接口一律 403。flag 在用户改密成功后由 user_repo.UpdatePassword 自动清零。
//
// 例外：仅当三项同时成立 —— 用户名 == "admin"、must_change_password == true、
// password_hash 完全等于 migrations/000002_seed_data.up.sql 中写入的种子哈希
// （即 admin/admin123 默认凭据）—— 才在此层直接拒绝登录，避免远程攻击者利用
// 已公开的默认凭据获得 JWT 后通过 /change-password 完成账号接管。
// 该例外只覆盖未经初始化的全新部署：部署方需要带外（CLI 工具或直接执行
// SQL `UPDATE users SET password_hash=... WHERE username='admin';`）将种子
// 哈希替换为新的强口令哈希后，本地用户即可走正常的 must_change_password
// 流程登录并完成自助改密。普通 must_change_password 用户（非种子 admin）
// 不受影响。
func (s *AuthService) CheckUserCanLogin(u *model.User) error {
	if u.Status != "ACTIVE" {
		return errors.New("账号已被禁用或未激活")
	}
	if strings.EqualFold(strings.TrimSpace(u.Username), seedAdminUsername) &&
		u.MustChangePassword &&
		u.PasswordHash == seedAdminHash {
		return errors.New("默认管理员密码已禁用，请由部署人员先完成初始化")
	}
	return nil
}

// ValidatePassword 将明文密码与数据库中存储的 bcrypt 哈希进行比对校验。
// 返回 true 表示密码匹配，false 表示密码错误。
func (s *AuthService) ValidatePassword(u *model.User, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil
}

// Register 创建新用户账号。
// 业务规则：用户名和邮箱必须唯一，密码使用 bcrypt DefaultCost 加密存储。
// 错误场景：用户名已存在、邮箱已存在、密码哈希生成失败。
func (s *AuthService) Register(ctx context.Context, username, email, password, nickname string) (*model.User, error) {
	// 检查用户名唯一性
	if existing, _ := s.userRepo.FindByUsername(ctx, username); existing != nil {
		return nil, errors.New("用户名已存在")
	}
	// 检查邮箱唯一性
	if existing, _ := s.userRepo.FindByEmail(ctx, email); existing != nil {
		return nil, errors.New("邮箱已存在")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	return s.userRepo.Create(ctx, username, email, string(hash), nickname)
}

// ChangePassword 对新密码进行 bcrypt 哈希后持久化到数据库。
func (s *AuthService) ChangePassword(ctx context.Context, id int64, newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	return s.userRepo.UpdatePassword(ctx, id, string(hash))
}

// UpdateProfile 更新用户的昵称和邮箱信息。
func (s *AuthService) UpdateProfile(ctx context.Context, id int64, nickname, email string) (*model.User, error) {
	return s.userRepo.UpdateProfile(ctx, id, nickname, email)
}

// UpdateAvatar 更新用户的头像 URL。
func (s *AuthService) UpdateAvatar(ctx context.Context, id int64, avatarURL string) error {
	return s.userRepo.UpdateAvatar(ctx, id, avatarURL)
}

// UpdateLoginInfo 记录用户最后一次登录时间和登录 IP，采用即发即忘模式，失败时静默忽略。
func (s *AuthService) UpdateLoginInfo(ctx context.Context, id int64, ip string) {
	_ = s.userRepo.UpdateLoginInfo(ctx, id, ip)
}

// --- 基于 Redis 的登录安全防护 ---

// AssertLoginAllowed 检查给定的 identifier+IP 组合是否因多次失败而被锁定。
// 已锁定时返回错误提示；当 Redis 不可用时允许登录通过（降级策略）。
func (s *AuthService) AssertLoginAllowed(ctx context.Context, identifier, ip string) error {
	lockKey := loginLockKeyPrefix + buildSecurityKey(identifier, ip)
	userLockKey := loginLockKeyPrefix + "user:" + strings.ToLower(strings.TrimSpace(identifier))
	exists, err := s.redis.Exists(ctx, lockKey, userLockKey).Result()
	if err != nil {
		return nil // Redis 不可用时降级放行，避免影响正常登录
	}
	if exists > 0 {
		return errors.New("登录尝试过于频繁，请15分钟后重试")
	}
	return nil
}

// RecordFailedAttempt 对 identifier+IP 的登录失败计数加一。
// 当计数首次创建时设置 windowDuration 的过期时间。
// 一旦达到 maxFailedAttempts，将设置 lockDuration 的锁定键。
func (s *AuthService) RecordFailedAttempt(ctx context.Context, identifier, ip string) {
	suffix := buildSecurityKey(identifier, ip)
	failKey := loginFailKeyPrefix + suffix
	count, err := s.redis.Incr(ctx, failKey).Result()
	if err != nil {
		return
	}
	// 首次失败时设置时间窗口，使计数在窗口结束后自动清除
	if count == 1 {
		s.redis.Expire(ctx, failKey, windowDuration)
	}
	// 达到上限时设置锁定键
	if count >= maxFailedAttempts {
		lockKey := loginLockKeyPrefix + suffix
		s.redis.Set(ctx, lockKey, "1", lockDuration)
	}

	// 按用户名汇总的全 IP 失败计数
	userSuffix := "user:" + strings.ToLower(strings.TrimSpace(identifier))
	userFailKey := loginFailKeyPrefix + userSuffix
	userCount, err := s.redis.Incr(ctx, userFailKey).Result()
	if err != nil {
		return
	}
	if userCount == 1 {
		s.redis.Expire(ctx, userFailKey, windowDuration)
	}
	if userCount >= maxFailedAttemptsAll {
		userLockKey := loginLockKeyPrefix + userSuffix
		s.redis.Set(ctx, userLockKey, "1", lockDuration)
	}
}

// ClearFailedAttempts 在用户成功登录后清除 identifier+IP 对应的失败计数键和锁定键。
func (s *AuthService) ClearFailedAttempts(ctx context.Context, identifier, ip string) {
	suffix := buildSecurityKey(identifier, ip)
	userSuffix := "user:" + strings.ToLower(strings.TrimSpace(identifier))
	s.redis.Del(ctx, loginFailKeyPrefix+suffix, loginLockKeyPrefix+suffix,
		loginFailKeyPrefix+userSuffix, loginLockKeyPrefix+userSuffix)
}

// buildSecurityKey 构建登录安全 Redis 键的唯一后缀，格式为 "小写标识符:小写IP"。
func buildSecurityKey(identifier, ip string) string {
	return strings.ToLower(strings.TrimSpace(identifier)) + ":" +
		strings.ToLower(strings.TrimSpace(ip))
}
