package dbutil

import "strings"

// EscapeLike 转义 PostgreSQL ILIKE / LIKE 模式中的特殊字符，避免用户输入触发通配符匹配导致 SQL 注入或性能问题。
func EscapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}
