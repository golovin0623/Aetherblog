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
	refreshTokenKeyPrefix = "auth:refresh:"
)

// SessionService manages Refresh Token issuance, rotation and revocation.
type SessionService struct {
	redis              *redis.Client
	refreshTokenTTL    time.Duration
	accessTokenMaxAge  int64 // seconds
	refreshTokenMaxAge int64 // seconds
}

// NewSessionService creates a SessionService backed by Redis.
// accessExpiry and refreshExpiry control the cookie MaxAge returned to the client.
func NewSessionService(rdb *redis.Client, accessExpiry, refreshExpiry time.Duration) *SessionService {
	return &SessionService{
		redis:              rdb,
		refreshTokenTTL:    refreshExpiry,
		accessTokenMaxAge:  int64(accessExpiry.Seconds()),
		refreshTokenMaxAge: int64(refreshExpiry.Seconds()),
	}
}

// AccessTokenMaxAge returns the access-token cookie MaxAge in seconds.
func (s *SessionService) AccessTokenMaxAge() int64 { return s.accessTokenMaxAge }

// RefreshTokenMaxAge returns the refresh-token cookie MaxAge in seconds.
func (s *SessionService) RefreshTokenMaxAge() int64 { return s.refreshTokenMaxAge }

// IssueRefreshToken generates a random token, stores its SHA-256 hash → userID in Redis.
func (s *SessionService) IssueRefreshToken(ctx context.Context, userID int64) (string, error) {
	token, err := generateRandomToken()
	if err != nil {
		return "", err
	}
	key := buildRefreshKey(token)
	return token, s.redis.Set(ctx, key, userID, s.refreshTokenTTL).Err()
}

// RotateRefreshToken validates, revokes old token and issues a new one.
// Returns (userID, newToken, err). Returns (0,"",nil) when token is invalid/expired.
func (s *SessionService) RotateRefreshToken(ctx context.Context, refreshToken string) (int64, string, error) {
	if refreshToken == "" {
		return 0, "", nil
	}
	key := buildRefreshKey(refreshToken)
	val, err := s.redis.Get(ctx, key).Result()
	if err == redis.Nil {
		return 0, "", nil
	}
	if err != nil {
		return 0, "", err
	}

	userID, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("invalid stored userID: %w", err)
	}

	// Revoke old token
	s.redis.Del(ctx, key)

	// Issue new one
	newToken, err := s.IssueRefreshToken(ctx, userID)
	return userID, newToken, err
}

// RevokeRefreshToken deletes the token from Redis.
func (s *SessionService) RevokeRefreshToken(ctx context.Context, refreshToken string) {
	if refreshToken == "" {
		return
	}
	s.redis.Del(ctx, buildRefreshKey(refreshToken))
}

// buildRefreshKey returns the Redis key for a refresh token by SHA-256 hashing
// the token value, preventing the raw token from ever being stored in Redis.
func buildRefreshKey(token string) string {
	h := sha256.Sum256([]byte(token))
	return refreshTokenKeyPrefix + hex.EncodeToString(h[:])
}

// generateRandomToken generates a cryptographically secure 32-byte random token
// encoded as URL-safe base64 (no padding).
func generateRandomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(b), nil
}
