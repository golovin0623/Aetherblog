package service

import (
	"encoding/json"
	"strings"
	"testing"
)

// Phase 2 的 secret-preserving merge 是个安全敏感的纯函数,这里用单元测试穷举边界。

func TestMergeProviderConfigJSON_KeepsSecretWhenRedacted(t *testing.T) {
	old := `{"bucket":"old-bucket","accessKeyId":"AKIAOLD123456","secretAccessKey":"super-secret-old"}`
	new := `{"bucket":"new-bucket","accessKeyId":"AK****3456","secretAccessKey":"su****-old"}`
	merged, err := mergeProviderConfigJSON(old, new)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(merged), &got); err != nil {
		t.Fatalf("unmarshal merged: %v", err)
	}
	if got["bucket"] != "new-bucket" {
		t.Errorf("bucket should be updated to new-bucket, got %v", got["bucket"])
	}
	if got["accessKeyId"] != "AKIAOLD123456" {
		t.Errorf("accessKeyId should keep old value, got %v", got["accessKeyId"])
	}
	if got["secretAccessKey"] != "super-secret-old" {
		t.Errorf("secretAccessKey should keep old value, got %v", got["secretAccessKey"])
	}
}

func TestMergeProviderConfigJSON_OverwritesWhenNewExplicit(t *testing.T) {
	old := `{"accessKeyId":"AKIAOLD","secretAccessKey":"super-secret-old"}`
	new := `{"accessKeyId":"AKIANEW","secretAccessKey":"super-secret-new"}`
	merged, _ := mergeProviderConfigJSON(old, new)
	if !strings.Contains(merged, "AKIANEW") || !strings.Contains(merged, "super-secret-new") {
		t.Errorf("explicit new secrets should overwrite old ones, got: %s", merged)
	}
}

func TestMergeProviderConfigJSON_KeepsOldWhenEmptyNew(t *testing.T) {
	old := `{"accessKeyId":"AKIAOLD","secretAccessKey":"super-secret-old"}`
	new := `{"accessKeyId":"","secretAccessKey":""}`
	merged, _ := mergeProviderConfigJSON(old, new)
	if !strings.Contains(merged, "AKIAOLD") {
		t.Errorf("empty new value should keep old secret, got: %s", merged)
	}
}

func TestMergeProviderConfigJSON_KeepsOldWhenFieldMissing(t *testing.T) {
	old := `{"accessKeyId":"AKIAOLD","secretAccessKey":"super-secret-old","bucket":"b"}`
	new := `{"bucket":"new"}`
	merged, _ := mergeProviderConfigJSON(old, new)
	var got map[string]any
	json.Unmarshal([]byte(merged), &got)
	if got["accessKeyId"] != "AKIAOLD" {
		t.Errorf("missing field in new should keep old, got: %v", got["accessKeyId"])
	}
	if got["bucket"] != "new" {
		t.Errorf("bucket should be updated, got: %v", got["bucket"])
	}
}

func TestIsRedactedValue(t *testing.T) {
	cases := []struct {
		v    string
		want bool
	}{
		{"AB****CD12", true},
		{"****", true},
		{"plaintext_secret", false},
		{"", false},
		{"AKIAIOSFODNN7EXAMPLE", false},
		{"real****secret", false},
		{"AB****CD123", false},
	}
	for _, c := range cases {
		if got := isRedactedValue(c.v); got != c.want {
			t.Errorf("isRedactedValue(%q) = %v, want %v", c.v, got, c.want)
		}
	}
}

func TestRedactProviderConfigJSON_HidesSecrets(t *testing.T) {
	raw := `{"accessKeyId":"AKIAIOSFODNN7EXAMPLE","secretAccessKey":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY","bucket":"mybucket"}`
	red := redactProviderConfigJSON(raw)
	if strings.Contains(red, "AKIAIOSFODNN7EXAMPLE") {
		t.Errorf("redact should hide accessKeyId, got: %s", red)
	}
	if strings.Contains(red, "wJalrXUtnFEMI") {
		t.Errorf("redact should hide secretAccessKey, got: %s", red)
	}
	if !strings.Contains(red, "mybucket") {
		t.Errorf("redact should preserve non-sensitive bucket, got: %s", red)
	}
	if !strings.Contains(red, "****") {
		t.Errorf("redacted output should contain mask marker, got: %s", red)
	}
}
