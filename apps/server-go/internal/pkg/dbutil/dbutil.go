package dbutil

import "strings"

// EscapeLike 转义 PostgreSQL LIKE/ILIKE 模式中的特殊字符，避免用户输入触发通配符匹配。
func EscapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}
