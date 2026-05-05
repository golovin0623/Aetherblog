package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// refreshTokenKeyPrefix 是 Redis 中存储 Refresh Token 的键前缀。
	refreshTokenKeyPrefix = "auth:refresh:"
	// userSessionsKeyPrefix 是 Redis 中存储用户所有会话 key 的 Set 键前缀。
	userSessionsKeyPrefix = "auth:user_sessions:"
)

// SessionService 管理 Refresh Token 的签发、轮换与撤销。
// Token 的原始值存储在客户端 Cookie 中，Redis 中只存储其 SHA-256 哈希值，
// 以防止 Redis 数据泄露时 Token 被直接利用。
type SessionService struct {
	redis              *redis.Client
	refreshTokenTTL    time.Duration
	accessTokenMaxAge  int64 // 秒，用于 Access Token Cookie 的 MaxAge
	refreshTokenMaxAge int64 // 秒，用于 Refresh Token Cookie 的 MaxAge
}

// NewSessionService 创建一个由 Redis 支持的 SessionService 实例。
// accessExpiry 和 refreshExpiry 分别控制返回给客户端的 Cookie MaxAge。
func NewSessionService(rdb *redis.Client, accessExpiry, refreshExpiry time.Duration) *SessionService {
	return &SessionService{
		redis:              rdb,
		refreshTokenTTL:    refreshExpiry,
		accessTokenMaxAge:  int64(accessExpiry.Seconds()),
		refreshTokenMaxAge: int64(refreshExpiry.Seconds()),
	}
}

// AccessTokenMaxAge 返回 Access Token Cookie 的 MaxAge（秒）。
func (s *SessionService) AccessTokenMaxAge() int64 { return s.accessTokenMaxAge }

// RefreshTokenMaxAge 返回 Refresh Token Cookie 的 MaxAge（秒）。
func (s *SessionService) RefreshTokenMaxAge() int64 { return s.refreshTokenMaxAge }

// IssueRefreshToken 生成一个随机 Refresh Token，并将其 SHA-256 哈希 → userID 的映射写入 Redis。
// 返回原始 Token（存入客户端 Cookie），Redis 中只保存哈希值。
func (s *SessionService) IssueRefreshToken(ctx context.Context, userID int64) (string, error) {
	token, err := generateRandomToken()
	if err != nil {
		return "", err
	}
	key := buildRefreshKey(token)
	userSetKey := userSessionsKeyPrefix + strconv.FormatInt(userID, 10)
	// 用 MULTI/EXEC 把「写 token、加入会话索引、刷新索引 TTL」绑成一次原子提交，
	// 连接级失败时整批不落库，避免历史实现里 Set 已成功但 SAdd/Expire 失败造成的“游离令牌”。
	if _, err := s.redis.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Set(ctx, key, userID, s.refreshTokenTTL)
		pipe.SAdd(ctx, userSetKey, key)
		pipe.Expire(ctx, userSetKey, s.refreshTokenTTL)
		return nil
	}); err != nil {
		// 命令级错误不会触发 EXEC 回滚（Redis 语义），兜底清理一次刚写入的 key/索引项以兼容这种边缘情况。
		s.redis.Del(ctx, key)
		s.redis.SRem(ctx, userSetKey, key)
		return "", err
	}
	return token, nil
}

// RotateRefreshToken 验证旧 Token，撤销后签发新 Token（单次使用原则）。
// 返回值：(userID, newToken, err)。
// Token 无效或已过期时返回 (0, "", nil)，调用方可据此判断需要重新登录。
func (s *SessionService) RotateRefreshToken(ctx context.Context, refreshToken string) (int64, string, error) {
	if refreshToken == "" {
		return 0, "", nil
	}
	key := buildRefreshKey(refreshToken)
	val, err := s.redis.Get(ctx, key).Result()
	if err == redis.Nil {
		// Token 不存在或已过期
		return 0, "", nil
	}
	if err != nil {
		return 0, "", err
	}

	userID, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("Redis 中存储的 userID 格式无效: %w", err)
	}

	// 撤销旧 Token，防止重放攻击
	s.redis.Del(ctx, key)

	// 签发新 Token
	newToken, err := s.IssueRefreshToken(ctx, userID)
	return userID, newToken, err
}

// RevokeRefreshToken 从 Redis 中删除指定的 Refresh Token，实现登出功能。
// Token 为空时直接返回，不执行任何操作。
func (s *SessionService) RevokeRefreshToken(ctx context.Context, refreshToken string) {
	if refreshToken == "" {
		return
	}
	s.redis.Del(ctx, buildRefreshKey(refreshToken))
}

// RevokeAllUserSessions 撤销指定用户的所有 Refresh Token，用于密码修改后强制所有会话失效。
func (s *SessionService) RevokeAllUserSessions(ctx context.Context, userID int64) error {
	userSetKey := userSessionsKeyPrefix + strconv.FormatInt(userID, 10)
	keys, err := s.redis.SMembers(ctx, userSetKey).Result()
	if err != nil {
		return err
	}
	if len(keys) > 0 {
		s.redis.Del(ctx, keys...)
	}
	s.redis.Del(ctx, userSetKey)
	return nil
}

// buildRefreshKey 对 Token 原始值进行 SHA-256 哈希后构造 Redis 键。
// 这样可确保原始 Token 永远不会出现在 Redis 中，提升安全性。
func buildRefreshKey(token string) string {
	h := sha256.Sum256([]byte(token))
	return refreshTokenKeyPrefix + hex.EncodeToString(h[:])
}

// generateRandomToken 生成 32 字节的密码学安全随机 Token，
// 并以 URL-safe Base64（无填充）格式编码后返回。
func generateRandomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(b), nil
}
