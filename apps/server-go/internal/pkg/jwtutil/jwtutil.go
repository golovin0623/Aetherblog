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
//
// 等价于 ParseTokenWithKeys(tokenStr, []string{secret}) —— 保留此签名以
// 兼容 test 与 fixtures；生产代码路径走 jwtkeys.Store + ParseTokenWithKeys。
func ParseToken(tokenStr, secret string) (*Claims, error) {
	return ParseTokenWithKeys(tokenStr, []string{secret})
}

// ParseTokenWithKeys 按给定的 keys 顺序尝试验证 JWT 签名，任一命中即视为有效。
// 典型用法：keys=[current, previous] —— 热轮换窗口内发放的旧 token 仍可通过。
//
// 实现要点：
//  1. 首先对 "签名不匹配" 与 "token 本身被篡改/过期" 做区分：
//     - HMAC 验签失败 → 尝试下一个 key；
//     - exp/iat/alg/JSON 结构错误 → 立即返回，不消耗剩余候选。
//  2. 强制 HS256，防御 alg:none。
//  3. 空 keys 切片视为参数错误。
func ParseTokenWithKeys(tokenStr string, keys []string) (*Claims, error) {
	if len(keys) == 0 {
		return nil, errors.New("jwtutil: no keys provided")
	}

	var lastSignatureErr error
	for _, key := range keys {
		if key == "" {
			continue
		}
		token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return []byte(key), nil
		})
		if err != nil {
			// 签名不匹配 → 轮到下一个 key；其余类型的错误直接冒出
			// （过期、格式错、alg 错…这些换个 key 也救不回来）。
			if errors.Is(err, jwt.ErrSignatureInvalid) ||
				errors.Is(err, jwt.ErrTokenSignatureInvalid) {
				lastSignatureErr = err
				continue
			}
			return nil, err
		}
		claims, ok := token.Claims.(*Claims)
		if !ok || !token.Valid {
			return nil, errors.New("invalid token")
		}
		return claims, nil
	}

	if lastSignatureErr != nil {
		return nil, lastSignatureErr
	}
	return nil, errors.New("invalid token: no key matched")
}
