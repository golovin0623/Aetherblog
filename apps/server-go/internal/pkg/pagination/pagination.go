// Package pagination 提供从 HTTP 查询字符串中解析分页参数的工具，
// 并封装了生成 SQL OFFSET / LIMIT 值的便捷方法。
package pagination

import (
	"strconv"

	"github.com/labstack/echo/v4"
)

// Params 保存从查询字符串解析得到的分页参数。
type Params struct {
	// PageNum 当前页码，从 1 开始
	PageNum  int
	// PageSize 每页返回的记录数
	PageSize int
}

// Offset 返回对应的 SQL OFFSET 值，即需要跳过的记录数。
func (p Params) Offset() int {
	return (p.PageNum - 1) * p.PageSize
}

// Limit 返回对应的 SQL LIMIT 值，即每次查询返回的最大记录数。
func (p Params) Limit() int {
	return p.PageSize
}

// Parse 从请求的查询字符串中提取 pageNum 和 pageSize 参数，
// 使用默认值：pageNum=1，pageSize=10。
func Parse(c echo.Context) Params {
	return ParseWithDefaults(c, 1, 10)
}

// ParseWithDefaults 从请求的查询字符串中提取 pageNum 和 pageSize 参数，
// 并支持自定义默认值。
// 参数边界约束：
//   - pageNum 最小值为 1
//   - pageSize 最小值为 1，最大值为 100（防止超大翻页导致性能问题）
func ParseWithDefaults(c echo.Context, defaultPage, defaultSize int) Params {
	pageNum := queryInt(c, "pageNum", defaultPage)
	pageSize := queryInt(c, "pageSize", defaultSize)

	// 页码不能小于 1
	if pageNum < 1 {
		pageNum = 1
	}
	// 每页大小不能小于 1
	if pageSize < 1 {
		pageSize = defaultSize
	}
	// 每页大小上限为 100，防止一次查询过多数据
	if pageSize > 100 {
		pageSize = 100
	}

	return Params{PageNum: pageNum, PageSize: pageSize}
}

// queryInt 从 Echo 上下文的查询字符串中读取整数类型参数。
// 若参数缺失或无法解析为整数，则返回 defaultVal。
func queryInt(c echo.Context, key string, defaultVal int) int {
	s := c.QueryParam(key)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return defaultVal
	}
	return v
}
