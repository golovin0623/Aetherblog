package handler

import "testing"

func TestNormalizeReaderRedirect(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		slug string
		want string
	}{
		{
			name: "relative reader path",
			raw:  "/reader/generated-book?mode=admin",
			slug: "generated-book",
			want: "/reader/generated-book?mode=admin",
		},
		{
			name: "absolute reader url",
			raw:  "https://blog.example.com/reader/generated-book",
			slug: "generated-book",
			want: "https://blog.example.com/reader/generated-book",
		},
		{
			name: "missing redirect falls back to slug",
			raw:  "",
			slug: "book with spaces",
			want: "/reader/book%20with%20spaces",
		},
		{
			name: "protocol relative url is rejected",
			raw:  "//evil.example.com/reader/generated-book",
			slug: "generated-book",
			want: "/reader/generated-book",
		},
		{
			name: "non reader path is rejected",
			raw:  "/admin/reading-books",
			slug: "generated-book",
			want: "/reader/generated-book",
		},
		{
			name: "non http scheme is rejected",
			raw:  "javascript:alert(1)",
			slug: "generated-book",
			want: "/reader/generated-book",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeReaderRedirect(tt.raw, tt.slug); got != tt.want {
				t.Fatalf("normalizeReaderRedirect(%q, %q) = %q, want %q", tt.raw, tt.slug, got, tt.want)
			}
		})
	}
}
