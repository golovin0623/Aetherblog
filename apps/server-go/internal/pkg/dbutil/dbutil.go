package dbutil

import "strings"

var likeReplacer = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// EscapeLike 转义 PostgreSQL LIKE/ILIKE 模式中的特殊字符，避免用户输入触发通配符匹配。
func EscapeLike(s string) string {
	return likeReplacer.Replace(s)
}
