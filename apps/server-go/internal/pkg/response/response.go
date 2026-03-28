package response

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// R is the unified API response wrapper, matching the Java R<T> record exactly.
// Fields use omitempty to match @JsonInclude(NON_NULL).
type R struct {
	Code          int    `json:"code"`
	Message       string `json:"message"`
	Data          any    `json:"data,omitempty"`
	Timestamp     int64  `json:"timestamp"`
	TraceID       string `json:"traceId,omitempty"`
	ErrorCategory string `json:"errorCategory,omitempty"`
}

// ResultCode mirrors the Java ResultCode enum.
type ResultCode struct {
	Code    int
	Message string
}

var (
	Success          = ResultCode{200, "操作成功"}
	Failure          = ResultCode{500, "操作失败"}
	BadRequest       = ResultCode{400, "请求参数错误"}
	Unauthorized     = ResultCode{401, "未授权"}
	Forbidden        = ResultCode{403, "禁止访问"}
	NotFound         = ResultCode{404, "资源不存在"}
	MethodNotAllowed = ResultCode{405, "方法不允许"}
	TooManyRequests  = ResultCode{429, "请求过于频繁"}
	InternalError    = ResultCode{500, "服务器内部错误"}

	// Business errors 1xxx
	ParamMiss        = ResultCode{1001, "缺少必要参数"}
	ParamTypeError   = ResultCode{1002, "参数类型错误"}
	DataNotFound     = ResultCode{1003, "数据不存在"}
	DataAlreadyExists = ResultCode{1004, "数据已存在"}
	DataSaveFailed   = ResultCode{1005, "数据保存失败"}

	// Auth errors 2xxx
	TokenExpired    = ResultCode{2001, "Token已过期"}
	TokenInvalid    = ResultCode{2002, "Token无效"}
	LoginFailed     = ResultCode{2003, "登录失败"}
	AccountDisabled = ResultCode{2004, "账户已禁用"}
	NoPermission    = ResultCode{2005, "没有权限"}
)

func now() int64 {
	return time.Now().UnixMilli()
}

func defaultCategoryForCode(code int) string {
	switch {
	case code == BadRequest.Code || code == ParamMiss.Code || code == ParamTypeError.Code:
		return "validation_error"
	case code == Unauthorized.Code || code == TokenExpired.Code || code == TokenInvalid.Code:
		return "unauthorized"
	case code == Forbidden.Code || code == NoPermission.Code:
		return "forbidden"
	case code == NotFound.Code || code == DataNotFound.Code:
		return "not_found"
	case code >= 1000 && code < 3000:
		return "business_error"
	case code == TooManyRequests.Code:
		return "too_many_requests"
	case code >= 500:
		return "internal_error"
	default:
		return "unknown_error"
	}
}

// OK returns a success response with data.
func OK(c echo.Context, data any) error {
	return c.JSON(http.StatusOK, R{
		Code:      Success.Code,
		Message:   Success.Message,
		Data:      data,
		Timestamp: now(),
	})
}

// OKMsg returns a success response with data and custom message.
func OKMsg(c echo.Context, data any, message string) error {
	return c.JSON(http.StatusOK, R{
		Code:      Success.Code,
		Message:   message,
		Data:      data,
		Timestamp: now(),
	})
}

// OKEmpty returns a success response without data.
func OKEmpty(c echo.Context) error {
	return c.JSON(http.StatusOK, R{
		Code:      Success.Code,
		Message:   Success.Message,
		Timestamp: now(),
	})
}

// Fail returns a failure response with a message.
func Fail(c echo.Context, message string) error {
	code := Failure.Code
	return c.JSON(http.StatusOK, R{
		Code:          code,
		Message:       message,
		Timestamp:     now(),
		ErrorCategory: defaultCategoryForCode(code),
	})
}

// FailCode returns a failure response with a specific ResultCode.
func FailCode(c echo.Context, rc ResultCode) error {
	return c.JSON(httpStatusFor(rc.Code), R{
		Code:          rc.Code,
		Message:       rc.Message,
		Timestamp:     now(),
		ErrorCategory: defaultCategoryForCode(rc.Code),
	})
}

// FailCodeMsg returns a failure response with a specific code and custom message.
func FailCodeMsg(c echo.Context, code int, message string) error {
	return c.JSON(httpStatusFor(code), R{
		Code:          code,
		Message:       message,
		Timestamp:     now(),
		ErrorCategory: defaultCategoryForCode(code),
	})
}

// httpStatusFor maps internal codes to HTTP status codes.
func httpStatusFor(code int) int {
	switch code {
	case 200:
		return http.StatusOK
	case 400, 1001, 1002:
		return http.StatusBadRequest
	case 401, 2001, 2002, 2003:
		return http.StatusUnauthorized
	case 403, 2005:
		return http.StatusForbidden
	case 404, 1003:
		return http.StatusNotFound
	case 429:
		return http.StatusTooManyRequests
	default:
		return http.StatusOK // Java returns 200 for most business errors
	}
}

// FailWith returns a failure response with a specific ResultCode and custom message.
func FailWith(c echo.Context, rc ResultCode, message string) error {
	return c.JSON(httpStatusFor(rc.Code), R{
		Code:          rc.Code,
		Message:       message,
		Timestamp:     now(),
		ErrorCategory: defaultCategoryForCode(rc.Code),
	})
}

// Error returns a 500 internal error response.
func Error(c echo.Context, err error) error {
	return c.JSON(http.StatusInternalServerError, R{
		Code:          InternalError.Code,
		Message:       InternalError.Message,
		Timestamp:     now(),
		ErrorCategory: "internal_error",
	})
}

// PageResult is the paginated response wrapper matching Java PageResult<T>.
type PageResult struct {
	List     any   `json:"list"`
	Total    int64 `json:"total"`
	PageNum  int   `json:"pageNum"`
	PageSize int   `json:"pageSize"`
	Pages    int64 `json:"pages"`
}

func NewPageResult(list any, total int64, pageNum, pageSize int) PageResult {
	pages := total / int64(pageSize)
	if total%int64(pageSize) != 0 {
		pages++
	}
	return PageResult{
		List:     list,
		Total:    total,
		PageNum:  pageNum,
		PageSize: pageSize,
		Pages:    pages,
	}
}
