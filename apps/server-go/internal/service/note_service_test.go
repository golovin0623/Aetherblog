package service

import (
	"reflect"
	"testing"
	"time"
)

func TestResolveNoteTitle(t *testing.T) {
	now := time.Date(2026, 5, 23, 9, 30, 0, 0, time.Local)

	tests := []struct {
		name    string
		title   string
		content string
		want    string
	}{
		{
			name:    "uses explicit title",
			title:   "  会议记录  ",
			content: "# 被忽略",
			want:    "会议记录",
		},
		{
			name:    "uses first markdown line",
			title:   "",
			content: "\n# 产品想法\n\n正文",
			want:    "产品想法",
		},
		{
			name:    "falls back to timestamp title",
			title:   "",
			content: "   ",
			want:    "未命名笔记 2026-05-23 09:30",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolveNoteTitle(tt.title, tt.content, now); got != tt.want {
				t.Fatalf("resolveNoteTitle() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizeNoteTags(t *testing.T) {
	got := normalizeNoteTags([]string{" #Go ", "go", "", "#AI", "AI", " 长标签 "}, "正文 #AI 和 #笔记")
	want := []string{"Go", "AI", "长标签", "笔记"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeNoteTags() = %#v, want %#v", got, want)
	}
}

func TestParseNoteLinks(t *testing.T) {
	got := parseNoteLinks("关联 [[项目计划]]、[[ AI 想法 ]]，重复 [[项目计划]]，空 [[]] 忽略。")
	wantTitles := []string{
		"项目计划",
		"AI 想法",
	}

	if len(got) != len(wantTitles) {
		t.Fatalf("parseNoteLinks() length = %d, want %d; got %#v", len(got), len(wantTitles), got)
	}
	for i, want := range wantTitles {
		if got[i].TargetTitle != want || got[i].LinkText != want {
			t.Fatalf("parseNoteLinks()[%d] = %#v, want title/link %q", i, got[i], want)
		}
		if got[i].PositionStart == nil || got[i].PositionEnd == nil {
			t.Fatalf("parseNoteLinks()[%d] did not include positions: %#v", i, got[i])
		}
	}
}
