package middleware

import (
	"net/http"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
)

// CORS 返回一个跨域资源共享（CORS）中间件，并按照传入的允许来源列表进行配置。
//
// 允许的 HTTP 方法：GET、POST、PUT、PATCH、DELETE、OPTIONS。
// 允许的请求头：Origin、Content-Type、Accept、Authorization、X-Requested-With。
// 允许携带凭证（Cookie、Authorization 头等），预检请求缓存时间为 3600 秒。
func CORS(allowedOrigins []string) echo.MiddlewareFunc {
	return echomw.CORSWithConfig(echomw.CORSConfig{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowHeaders:     []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization, echo.HeaderXRequestedWith},
		AllowCredentials: true,
		MaxAge:           3600,
	})
}
