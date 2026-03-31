package jwtutil

import (
	"testing"
	"time"
)

// TestGenerateAndParseToken 验证正常情况下 JWT 的签发与解析流程：
// 生成令牌后能够成功解析，且各字段值与原始输入一致。
func TestGenerateAndParseToken(t *testing.T) {
	secret := "test-secret"
	// 使用用户 ID=42、用户名 admin、角色 ADMIN 生成一小时有效期的令牌
	token, err := GenerateToken(42, "admin", "ADMIN", secret, time.Hour)
	if err != nil {
		t.Fatalf("GenerateToken 失败: %v", err)
	}
	if token == "" {
		t.Fatal("生成的令牌不应为空字符串")
	}

	// 使用相同密钥解析令牌
	claims, err := ParseToken(token, secret)
	if err != nil {
		t.Fatalf("ParseToken 失败: %v", err)
	}
	// 验证 Subject（用户 ID）
	if claims.Subject != "42" {
		t.Errorf("Subject = %q, 期望值为 42", claims.Subject)
	}
	// 验证用户名
	if claims.Username != "admin" {
		t.Errorf("Username = %q, 期望值为 admin", claims.Username)
	}
	// 验证角色
	if claims.Role != "ADMIN" {
		t.Errorf("Role = %q, 期望值为 ADMIN", claims.Role)
	}
}

// TestParseToken_InvalidSecret 验证使用错误密钥解析令牌时应返回错误。
func TestParseToken_InvalidSecret(t *testing.T) {
	// 使用 secret-a 签名，用 secret-b 解析，应当验签失败
	token, _ := GenerateToken(1, "user", "USER", "secret-a", time.Hour)
	_, err := ParseToken(token, "secret-b")
	if err == nil {
		t.Error("期望因密钥不匹配而返回错误，但实际未返回错误")
	}
}

// TestParseToken_Expired 验证解析已过期令牌时应返回错误。
func TestParseToken_Expired(t *testing.T) {
	// 传入负数有效期（-1 小时）使令牌在生成时即已过期
	token, _ := GenerateToken(1, "user", "USER", "secret", -time.Hour)
	_, err := ParseToken(token, "secret")
	if err == nil {
		t.Error("期望因令牌已过期而返回错误，但实际未返回错误")
	}
}
