package service

import (
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

func TestCheckUserCanLogin(t *testing.T) {
	svc := NewAuthService(nil, nil)

	t.Run("active_user_can_login", func(t *testing.T) {
		user := &model.User{Status: "ACTIVE", MustChangePassword: false}
		if err := svc.CheckUserCanLogin(user); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
	})

	t.Run("inactive_user_blocked", func(t *testing.T) {
		user := &model.User{Status: "INACTIVE", MustChangePassword: false}
		if err := svc.CheckUserCanLogin(user); err == nil {
			t.Fatal("expected error for inactive user, got nil")
		}
	})

	// must_change_password=true 在此层**不**拦截 —— 拦下来用户拿不到 JWT，
	// 而 /change-password 端点本身需要 JWT，会形成自服务死锁。
	// 真正的拦截在 middleware.RequirePasswordRotated（见 jwt_test.go）。
	t.Run("must_change_password_user_allowed_at_service_layer", func(t *testing.T) {
		user := &model.User{Status: "ACTIVE", MustChangePassword: true}
		if err := svc.CheckUserCanLogin(user); err != nil {
			t.Fatalf("CheckUserCanLogin 不应在 service 层拦截 must_change_password 用户, got %v", err)
		}
	})

	t.Run("seeded_default_admin_blocked_until_rotated", func(t *testing.T) {
		user := &model.User{
			Username:           "admin",
			Status:             "ACTIVE",
			MustChangePassword: true,
			PasswordHash:       "$2a$10$1B6fti5pzyTwI58rszwobe/Lpbe2GUzhUk7xVlkGe8kpTckIPsdHe",
		}
		if err := svc.CheckUserCanLogin(user); err == nil {
			t.Fatal("expected seeded default admin to be blocked, got nil")
		}
	})
}
