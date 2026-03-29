package pagination

import (
	"strconv"

	"github.com/labstack/echo/v4"
)

// Params holds pagination parameters parsed from query string.
type Params struct {
	PageNum  int
	PageSize int
}

// Offset returns the SQL OFFSET value.
func (p Params) Offset() int {
	return (p.PageNum - 1) * p.PageSize
}

// Limit returns the SQL LIMIT value.
func (p Params) Limit() int {
	return p.PageSize
}

// Parse extracts pageNum and pageSize from the query string with defaults.
func Parse(c echo.Context) Params {
	return ParseWithDefaults(c, 1, 10)
}

// ParseWithDefaults extracts pageNum and pageSize with custom defaults.
func ParseWithDefaults(c echo.Context, defaultPage, defaultSize int) Params {
	pageNum := queryInt(c, "pageNum", defaultPage)
	pageSize := queryInt(c, "pageSize", defaultSize)

	if pageNum < 1 {
		pageNum = 1
	}
	if pageSize < 1 {
		pageSize = defaultSize
	}
	if pageSize > 100 {
		pageSize = 100
	}

	return Params{PageNum: pageNum, PageSize: pageSize}
}

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
