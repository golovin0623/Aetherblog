// Package jwtutil 提供 JWT（JSON Web Token）的签发与解析工具函数，
// 使用 HS256 对称签名算法，适用于用户身份认证场景。
package jwtutil

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// generateJTI generates a cryptographically random JWT ID.
func generateJTI() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Claims 是 JWT 的自定义载荷结构体。
// Subject 字段存储用户 ID（字符串形式），并内嵌标准注册声明（RegisteredClaims）。
type Claims struct {
	// Username 是登录用户名
	Username string `json:"username"`
	// Role 是用户角色（如 ADMIN、USER）
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// LoginUser 保存从已验证 JWT 中提取的用户信息，用于请求上下文传递。
type LoginUser struct {
	// UserID 是用户的数字主键
	UserID   int64
	// Username 是用户名
	Username string
	// Role 是用户角色
	Role     string
}

// GenerateToken 使用 HS256 算法创建并签名一个 JWT 令牌。
// userID 会被格式化为字符串存入 Subject 字段，expiration 指定令牌有效期。
// 返回签名后的 JWT 字符串，出错时返回错误。
func GenerateToken(userID int64, username, role, secret string, expiration time.Duration) (string, error) {
	claims := Claims{
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			// Subject 存储用户 ID 的字符串表示
			Subject:   fmt.Sprintf("%d", userID),
			Issuer:    "aetherblog-api",
			Audience:  jwt.ClaimStrings{"aetherblog-web"},
			ID:        generateJTI(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiration)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseToken 验证并解析 JWT 字符串，返回其中的自定义载荷。
// 若签名不合法、令牌已过期或格式错误，均会返回相应错误。
func ParseToken(tokenStr, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		// 强制检查签名算法必须为 HMAC 系列，防止 alg:none 攻击
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	// 断言载荷类型并验证令牌有效性
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
