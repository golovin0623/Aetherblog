// Package service implements the business logic layer of AetherBlog.
// Each service struct owns its repository/client dependencies and exposes
// domain methods that handlers call. Services must not import the handler package.
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

// login security constants — mirrors Java LoginSecurityService
const (
	loginFailKeyPrefix = "auth:login:fail:"
	loginLockKeyPrefix = "auth:login:lock:"

	maxFailedAttempts = 5
	lockDuration      = 15 * time.Minute
	windowDuration    = 15 * time.Minute
)

// AuthService handles user authentication business logic.
type AuthService struct {
	userRepo *repository.UserRepo
	redis    *redis.Client
}

// NewAuthService creates an AuthService with the given user repository and Redis client.
// Redis is used for login-attempt rate limiting; a nil client disables rate limiting.
func NewAuthService(userRepo *repository.UserRepo, rdb *redis.Client) *AuthService {
	return &AuthService{userRepo: userRepo, redis: rdb}
}

// FindByID returns a user by primary key.
func (s *AuthService) FindByID(ctx context.Context, id int64) (*model.User, error) {
	return s.userRepo.FindByID(ctx, id)
}

// FindByUsernameOrEmail looks up by username or email.
func (s *AuthService) FindByUsernameOrEmail(ctx context.Context, identifier string) (*model.User, error) {
	return s.userRepo.FindByUsernameOrEmail(ctx, identifier)
}

// CheckUserCanLogin returns an error if the user is not active.
func (s *AuthService) CheckUserCanLogin(u *model.User) error {
	if u.Status != "ACTIVE" {
		return errors.New("账号已被禁用或未激活")
	}
	return nil
}

// ValidatePassword compares plain text input against bcrypt hash stored in DB.
func (s *AuthService) ValidatePassword(u *model.User, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil
}

// Register creates a new user. Returns error if username/email already taken.
func (s *AuthService) Register(ctx context.Context, username, email, password, nickname string) (*model.User, error) {
	if existing, _ := s.userRepo.FindByUsername(ctx, username); existing != nil {
		return nil, errors.New("用户名已存在")
	}
	if existing, _ := s.userRepo.FindByEmail(ctx, email); existing != nil {
		return nil, errors.New("邮箱已存在")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	return s.userRepo.Create(ctx, username, email, string(hash), nickname)
}

// ChangePassword hashes the new password and persists it.
func (s *AuthService) ChangePassword(ctx context.Context, id int64, newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	return s.userRepo.UpdatePassword(ctx, id, string(hash))
}

// UpdateProfile updates nickname and email.
func (s *AuthService) UpdateProfile(ctx context.Context, id int64, nickname, email string) (*model.User, error) {
	return s.userRepo.UpdateProfile(ctx, id, nickname, email)
}

// UpdateAvatar sets the avatar URL.
func (s *AuthService) UpdateAvatar(ctx context.Context, id int64, avatarURL string) error {
	return s.userRepo.UpdateAvatar(ctx, id, avatarURL)
}

// UpdateLoginInfo records last login time and IP.
func (s *AuthService) UpdateLoginInfo(ctx context.Context, id int64, ip string) {
	_ = s.userRepo.UpdateLoginInfo(ctx, id, ip)
}

// --- Login security (Redis-based) ---

// AssertLoginAllowed returns an error if the identifier+IP combination is currently locked
// due to too many failed login attempts. Returns nil when Redis is unavailable.
func (s *AuthService) AssertLoginAllowed(ctx context.Context, identifier, ip string) error {
	lockKey := loginLockKeyPrefix + buildSecurityKey(identifier, ip)
	exists, err := s.redis.Exists(ctx, lockKey).Result()
	if err != nil {
		return nil // Redis unavailable — allow login
	}
	if exists > 0 {
		return errors.New("登录尝试过于频繁，请15分钟后重试")
	}
	return nil
}

// RecordFailedAttempt increments the failed-login counter for identifier+IP.
// Once maxFailedAttempts is reached within windowDuration, the key is locked for lockDuration.
func (s *AuthService) RecordFailedAttempt(ctx context.Context, identifier, ip string) {
	suffix := buildSecurityKey(identifier, ip)
	failKey := loginFailKeyPrefix + suffix
	count, err := s.redis.Incr(ctx, failKey).Result()
	if err != nil {
		return
	}
	if count == 1 {
		s.redis.Expire(ctx, failKey, windowDuration)
	}
	if count >= maxFailedAttempts {
		lockKey := loginLockKeyPrefix + suffix
		s.redis.Set(ctx, lockKey, "1", lockDuration)
	}
}

// ClearFailedAttempts removes both the fail-counter and lock keys for identifier+IP
// after a successful login.
func (s *AuthService) ClearFailedAttempts(ctx context.Context, identifier, ip string) {
	suffix := buildSecurityKey(identifier, ip)
	s.redis.Del(ctx, loginFailKeyPrefix+suffix, loginLockKeyPrefix+suffix)
}

func buildSecurityKey(identifier, ip string) string {
	return strings.ToLower(strings.TrimSpace(identifier)) + ":" +
		strings.ToLower(strings.TrimSpace(ip))
}
