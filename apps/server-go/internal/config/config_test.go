package config

import (
	"testing"
	"time"
)

func TestDefaultAIStreamReadTimeoutCoversProfileReindex(t *testing.T) {
	cfg := defaultConfig()
	if cfg.AI.StreamReadTimeout != 30*time.Minute {
		t.Fatalf("StreamReadTimeout = %s, want 30m", cfg.AI.StreamReadTimeout)
	}
}

func TestAIStreamReadTimeoutEnvOverrideParsesDuration(t *testing.T) {
	t.Setenv("JWT_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN", "0123456789abcdef0123456789abcdef")
	t.Setenv("AETHERBLOG_AI_STREAM_READ_TIMEOUT", "45m")

	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.AI.StreamReadTimeout != 45*time.Minute {
		t.Fatalf("StreamReadTimeout = %s, want 45m", cfg.AI.StreamReadTimeout)
	}
}
