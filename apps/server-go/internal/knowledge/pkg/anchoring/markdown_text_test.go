package anchoring

import "testing"

func TestMarkdownToPlaintext(t *testing.T) {
	cases := []struct{ in, want string }{
		{"# 大改\n\n卡尼曼**《思考》**系统1。", "大改\n\n卡尼曼《思考》系统1。"},
		{"## 系统1\n\n卡尼曼在`直觉`、快速。", "系统1\n\n卡尼曼在直觉、快速。"},
		{"> 引用\n- list 1\n- list 2", "引用\nlist 1\nlist 2"},
		{"[系统2](http://example.com)审慎", "系统2审慎"},
	}
	for _, c := range cases {
		got := MarkdownToPlaintext(c.in)
		if got != c.want {
			t.Errorf("MarkdownToPlaintext(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
