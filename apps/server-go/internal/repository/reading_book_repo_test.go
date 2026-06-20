package repository

import (
	"strings"
	"testing"
)

func TestJoinKBChunksRemovesConfiguredOverlap(t *testing.T) {
	chunks := []string{
		"第一段开头。这里是一段足够长的边界文字，用来模拟向量切片的尾部重叠。",
		"这里是一段足够长的边界文字，用来模拟向量切片的尾部重叠。\n\n第二段正文继续，而且这里也有足够长的重叠边界。",
		"第二段正文继续，而且这里也有足够长的重叠边界。\n\n第三段正文结束。",
	}

	got := joinKBChunks(chunks, true)
	want := strings.Join([]string{
		"第一段开头。这里是一段足够长的边界文字，用来模拟向量切片的尾部重叠。",
		"第二段正文继续，而且这里也有足够长的重叠边界。",
		"第三段正文结束。",
	}, "\n\n")
	if got != want {
		t.Fatalf("joinKBChunks() = %q, want %q", got, want)
	}
}

func TestJoinKBChunksKeepsSmallAccidentalOverlap(t *testing.T) {
	chunks := []string{
		"one",
		"e two",
	}

	got := joinKBChunks(chunks, true)
	want := "one\n\ne two"
	if got != want {
		t.Fatalf("joinKBChunks() = %q, want %q", got, want)
	}
}

func TestKBChunkingConfigUsesOverlapOnlyForOverlappingChunkers(t *testing.T) {
	tests := []struct {
		name string
		cfg  kbChunkingConfig
		want bool
	}{
		{
			name: "recursive overlap",
			cfg:  kbChunkingConfig{ChunkerKind: "recursive", ChunkOverlapTokens: 64},
			want: true,
		},
		{
			name: "qa ignores overlap field",
			cfg:  kbChunkingConfig{ChunkerKind: "qa", ChunkOverlapTokens: 64},
			want: false,
		},
		{
			name: "parent child ignores overlap field",
			cfg:  kbChunkingConfig{ChunkerKind: "parent_child", ChunkOverlapTokens: 64},
			want: false,
		},
		{
			name: "zero overlap",
			cfg:  kbChunkingConfig{ChunkerKind: "fixed", ChunkOverlapTokens: 0},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.cfg.usesOverlap(); got != tt.want {
				t.Fatalf("usesOverlap() = %v, want %v", got, tt.want)
			}
		})
	}
}
