// Package response 提供统一的 API 响应封装，与 Java 端的 R<T> 记录类完全对齐。
// 所有 HTTP 处理器应通过本包的函数返回响应，以保证响应格式一致性。
package response

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
)

// R 是统一 API 响应结构体，与 Java 端的 R<T> 记录类字段定义完全一致。
// 使用 omitempty 标签，与 Java 的 @JsonInclude(NON_NULL) 行为保持一致。
type R struct {
	// Code 业务状态码（非 HTTP 状态码）
	Code          int    `json:"code"`
	// Message 响应消息，成功时为操作结果描述，失败时为错误说明
	Message       string `json:"message"`
	// Data 响应数据，成功时携带，失败或为空时省略
	Data          any    `json:"data,omitempty"`
	// Timestamp 响应时间戳（毫秒级 Unix 时间）
	Timestamp     int64  `json:"timestamp"`
	// TraceID 链路追踪 ID，用于日志关联，无值时省略
	TraceID       string `json:"traceId,omitempty"`
	// ErrorCategory 错误分类标识，仅在失败响应中携带
	ErrorCategory string `json:"errorCategory,omitempty"`
}

// ResultCode 对应 Java 端的 ResultCode 枚举，包含业务状态码与默认消息。
type ResultCode struct {
	Code    int
	Message string
}

// 预定义的通用结果码变量。
var (
	// Success 操作成功（200）
	Success          = ResultCode{200, "操作成功"}
	// Failure 操作失败（500）
	Failure          = ResultCode{500, "操作失败"}
	// BadRequest 请求参数错误（400）
	BadRequest       = ResultCode{400, "请求参数错误"}
	// Unauthorized 未授权（401）
	Unauthorized     = ResultCode{401, "未授权"}
	// Forbidden 禁止访问（403）
	Forbidden        = ResultCode{403, "禁止访问"}
	// NotFound 资源不存在（404）
	NotFound         = ResultCode{404, "资源不存在"}
	// MethodNotAllowed 方法不允许（405）
	MethodNotAllowed = ResultCode{405, "方法不允许"}
	// TooManyRequests 请求过于频繁（429）
	TooManyRequests  = ResultCode{429, "请求过于频繁"}
	// InternalError 服务器内部错误（500）
	InternalError    = ResultCode{500, "服务器内部错误"}

	// 业务错误码（1xxx 段）
	// ParamMiss 缺少必要参数（1001）
	ParamMiss        = ResultCode{1001, "缺少必要参数"}
	// ParamTypeError 参数类型错误（1002）
	ParamTypeError   = ResultCode{1002, "参数类型错误"}
	// DataNotFound 数据不存在（1003）
	DataNotFound     = ResultCode{1003, "数据不存在"}
	// DataAlreadyExists 数据已存在（1004）
	DataAlreadyExists = ResultCode{1004, "数据已存在"}
	// DataSaveFailed 数据保存失败（1005）
	DataSaveFailed   = ResultCode{1005, "数据保存失败"}

	// 认证错误码（2xxx 段）
	// TokenExpired Token 已过期（2001）
	TokenExpired    = ResultCode{2001, "Token已过期"}
	// TokenInvalid Token 无效（2002）
	TokenInvalid    = ResultCode{2002, "Token无效"}
	// LoginFailed 登录失败（2003）
	LoginFailed     = ResultCode{2003, "登录失败"}
	// AccountDisabled 账户已禁用（2004）
	AccountDisabled = ResultCode{2004, "账户已禁用"}
	// NoPermission 没有权限（2005）
	NoPermission    = ResultCode{2005, "没有权限"}
)

// now 返回当前时间的毫秒级 Unix 时间戳。
func now() int64 {
	return time.Now().UnixMilli()
}

// defaultCategoryForCode 根据业务状态码推导默认的错误分类标识符，
// 便于前端或监控系统对错误类型进行聚合统计。
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
		// 其余 1xxx~2xxx 段均归类为业务错误
		return "business_error"
	case code == TooManyRequests.Code:
		return "too_many_requests"
	case code >= 500:
		return "internal_error"
	default:
		return "unknown_error"
	}
}

// OK 返回携带数据的成功响应（业务码 200）。
func OK(c echo.Context, data any) error {
	return c.JSON(http.StatusOK, R{
		Code:      Success.Code,
		Message:   Success.Message,
		Data:      data,
		Timestamp: now(),
		TraceID:   ctxutil.TraceID(c),
	})
}

// OKMsg 返回携带数据和自定义消息的成功响应（业务码 200）。
func OKMsg(c echo.Context, data any, message string) error {
	return c.JSON(http.StatusOK, R{
		Code:      Success.Code,
		Message:   message,
		Data:      data,
		Timestamp: now(),
		TraceID:   ctxutil.TraceID(c),
	})
}

// OKEmpty 返回不携带数据的成功响应（业务码 200），适用于删除、更新等操作。
func OKEmpty(c echo.Context) error {
	return c.JSON(http.StatusOK, R{
		Code:      Success.Code,
		Message:   Success.Message,
		Timestamp: now(),
		TraceID:   ctxutil.TraceID(c),
	})
}

// Fail 返回携带自定义消息的失败响应（业务码 500）。
func Fail(c echo.Context, message string) error {
	code := Failure.Code
	return c.JSON(http.StatusOK, R{
		Code:          code,
		Message:       message,
		Timestamp:     now(),
		TraceID:       ctxutil.TraceID(c),
		ErrorCategory: defaultCategoryForCode(code),
	})
}

// FailCode 根据指定的 ResultCode 返回失败响应，使用该结果码的默认消息。
func FailCode(c echo.Context, rc ResultCode) error {
	return c.JSON(httpStatusFor(rc.Code), R{
		Code:          rc.Code,
		Message:       rc.Message,
		Timestamp:     now(),
		TraceID:       ctxutil.TraceID(c),
		ErrorCategory: defaultCategoryForCode(rc.Code),
	})
}

// FailCodeMsg 根据指定的业务状态码和自定义消息返回失败响应。
func FailCodeMsg(c echo.Context, code int, message string) error {
	return c.JSON(httpStatusFor(code), R{
		Code:          code,
		Message:       message,
		Timestamp:     now(),
		TraceID:       ctxutil.TraceID(c),
		ErrorCategory: defaultCategoryForCode(code),
	})
}

// httpStatusFor 将业务状态码映射为对应的 HTTP 状态码。
// 大多数业务错误返回 HTTP 200，与 Java 端保持一致。
func httpStatusFor(code int) int {
	switch code {
	case 200:
		return http.StatusOK
	case 400, 1001, 1002:
		// 参数校验类错误映射为 400 Bad Request
		return http.StatusBadRequest
	case 401, 2001, 2002, 2003:
		// 认证类错误映射为 401 Unauthorized
		return http.StatusUnauthorized
	case 403, 2005:
		// 权限类错误映射为 403 Forbidden
		return http.StatusForbidden
	case 404, 1003:
		// 资源不存在映射为 404 Not Found
		return http.StatusNotFound
	case 429:
		return http.StatusTooManyRequests
	default:
		// Java 端对大多数业务错误返回 HTTP 200，此处保持一致
		return http.StatusOK
	}
}

// FailWith 根据指定的 ResultCode 和自定义消息返回失败响应。
// 适用于需要覆盖 ResultCode 默认消息的场景。
func FailWith(c echo.Context, rc ResultCode, message string) error {
	return c.JSON(httpStatusFor(rc.Code), R{
		Code:          rc.Code,
		Message:       message,
		Timestamp:     now(),
		TraceID:       ctxutil.TraceID(c),
		ErrorCategory: defaultCategoryForCode(rc.Code),
	})
}

// Error 返回 HTTP 500 内部服务器错误响应。
// 注意：错误详情不对外暴露，仅返回通用错误消息，避免泄露服务端信息。
func Error(c echo.Context, err error) error {
	return c.JSON(http.StatusInternalServerError, R{
		Code:          InternalError.Code,
		Message:       InternalError.Message,
		Timestamp:     now(),
		TraceID:       ctxutil.TraceID(c),
		ErrorCategory: "internal_error",
	})
}

// PageResult 是分页查询的响应封装结构体，与 Java 端的 PageResult<T> 完全对应。
type PageResult struct {
	// List 当前页的数据列表
	List     any   `json:"list"`
	// Total 数据总条数
	Total    int64 `json:"total"`
	// PageNum 当前页码
	PageNum  int   `json:"pageNum"`
	// PageSize 每页大小
	PageSize int   `json:"pageSize"`
	// Pages 总页数
	Pages    int64 `json:"pages"`
}

// NewPageResult 根据数据列表、总条数和分页参数构建 PageResult。
// 自动计算总页数（向上取整）。
func NewPageResult(list any, total int64, pageNum, pageSize int) PageResult {
	// 计算总页数，当有余数时向上取整
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
