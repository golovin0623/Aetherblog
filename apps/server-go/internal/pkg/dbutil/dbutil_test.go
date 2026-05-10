package dbutil

import "testing"

func TestEscapeLike(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"normal", "normal"},
		{"100%", "100\\%"},
		{"user_name", "user\\_name"},
		{"a\\b", "a\\\\b"},
		{"%_\\", "\\%\\_\\\\"},
	}

	for _, tt := range tests {
		actual := EscapeLike(tt.input)
		if actual != tt.expected {
			t.Errorf("EscapeLike(%q) = %q, expected %q", tt.input, actual, tt.expected)
		}
	}
}
