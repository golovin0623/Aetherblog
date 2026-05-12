package service

import "testing"

func TestContentPermissionAllowsHierarchy(t *testing.T) {
	tests := []struct {
		granted  string
		required string
		want     bool
	}{
		{granted: "VIEW", required: "VIEW", want: true},
		{granted: "COMMENT", required: "VIEW", want: true},
		{granted: "EDIT", required: "COMMENT", want: true},
		{granted: "MANAGE", required: "EDIT", want: true},
		{granted: "VIEW", required: "EDIT", want: false},
		{granted: "COMMENT", required: "MANAGE", want: false},
	}

	for _, tt := range tests {
		got := contentPermissionAllows(tt.granted, tt.required)
		if got != tt.want {
			t.Fatalf("contentPermissionAllows(%q, %q) = %v, want %v", tt.granted, tt.required, got, tt.want)
		}
	}
}

func TestContentPermissionAllowsRejectsUnknownValues(t *testing.T) {
	if contentPermissionAllows("OWNER", "VIEW") {
		t.Fatal("unknown granted level must not be treated as allowed")
	}
	if contentPermissionAllows("VIEW", "OWNER") {
		t.Fatal("unknown required level must not be treated as allowed")
	}
}

func TestNormalizeRoleCodesDefaultsToUser(t *testing.T) {
	got := normalizeRoleCodes(nil)
	if len(got) != 1 || got[0] != "USER" {
		t.Fatalf("normalizeRoleCodes(nil) = %#v, want [USER]", got)
	}
}

func TestNormalizeRoleCodesDeduplicatesAndUppercases(t *testing.T) {
	got := normalizeRoleCodes([]string{" author ", "AUTHOR", "admin"})
	want := []string{"AUTHOR", "ADMIN"}
	if len(got) != len(want) {
		t.Fatalf("normalizeRoleCodes length = %d, want %d (%#v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normalizeRoleCodes[%d] = %q, want %q; full=%#v", i, got[i], want[i], got)
		}
	}
}
