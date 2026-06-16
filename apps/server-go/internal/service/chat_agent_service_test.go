package service

import (
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// TestChatAgentCanManage 验证管理权限：管理员或创建者本人可管理。
func TestChatAgentCanManage(t *testing.T) {
	s := &ChatAgentService{}
	ownerID := int64(7)
	owner := &model.ChatAgent{CreatedBy: &ownerID}
	orphan := &model.ChatAgent{CreatedBy: nil}

	cases := []struct {
		name  string
		agent *model.ChatAgent
		actor ChatActor
		want  bool
	}{
		{"creator", owner, ChatActor{UserID: 7}, true},
		{"non-creator", owner, ChatActor{UserID: 8}, false},
		{"admin-any", owner, ChatActor{UserID: 99, IsAdmin: true}, true},
		{"orphan-non-admin", orphan, ChatActor{UserID: 7}, false},
		{"orphan-admin", orphan, ChatActor{UserID: 7, IsAdmin: true}, true},
	}
	for _, tc := range cases {
		if got := s.canManage(tc.agent, tc.actor); got != tc.want {
			t.Errorf("%s: canManage=%v want %v", tc.name, got, tc.want)
		}
	}
}

// TestRandomSuffix 验证随机后缀非空且长度稳定（slug 去重依赖）。
func TestRandomSuffix(t *testing.T) {
	a, b := randomSuffix(), randomSuffix()
	if a == "" || b == "" {
		t.Fatal("randomSuffix returned empty")
	}
	if len(a) != 6 {
		t.Errorf("randomSuffix len=%d want 6", len(a))
	}
}
