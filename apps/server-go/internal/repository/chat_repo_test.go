package repository

import "testing"

// TestDirectKeyCanonical 验证私聊唯一键与参数顺序无关，且总是 "min:max"。
func TestDirectKeyCanonical(t *testing.T) {
	cases := []struct {
		a, b int64
		want string
	}{
		{3, 7, "3:7"},
		{7, 3, "3:7"},
		{1, 1, "1:1"},
		{100, 2, "2:100"},
	}
	for _, tc := range cases {
		if got := directKey(tc.a, tc.b); got != tc.want {
			t.Errorf("directKey(%d,%d)=%q want %q", tc.a, tc.b, got, tc.want)
		}
	}
	if directKey(3, 7) != directKey(7, 3) {
		t.Error("directKey must be order-independent")
	}
}
