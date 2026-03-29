package jwtutil

import (
	"testing"
	"time"
)

func TestGenerateAndParseToken(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateToken(42, "admin", "ADMIN", secret, time.Hour)
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}
	if token == "" {
		t.Fatal("token should not be empty")
	}

	claims, err := ParseToken(token, secret)
	if err != nil {
		t.Fatalf("ParseToken failed: %v", err)
	}
	if claims.Subject != "42" {
		t.Errorf("Subject = %q, want 42", claims.Subject)
	}
	if claims.Username != "admin" {
		t.Errorf("Username = %q, want admin", claims.Username)
	}
	if claims.Role != "ADMIN" {
		t.Errorf("Role = %q, want ADMIN", claims.Role)
	}
}

func TestParseToken_InvalidSecret(t *testing.T) {
	token, _ := GenerateToken(1, "user", "USER", "secret-a", time.Hour)
	_, err := ParseToken(token, "secret-b")
	if err == nil {
		t.Error("expected error for wrong secret")
	}
}

func TestParseToken_Expired(t *testing.T) {
	token, _ := GenerateToken(1, "user", "USER", "secret", -time.Hour)
	_, err := ParseToken(token, "secret")
	if err == nil {
		t.Error("expected error for expired token")
	}
}
