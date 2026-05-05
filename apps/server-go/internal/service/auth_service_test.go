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

	t.Run("must_change_password_user_blocked", func(t *testing.T) {
		user := &model.User{Status: "ACTIVE", MustChangePassword: true}
		if err := svc.CheckUserCanLogin(user); err == nil {
			t.Fatal("expected error when must_change_password is true, got nil")
		}
	})
}
