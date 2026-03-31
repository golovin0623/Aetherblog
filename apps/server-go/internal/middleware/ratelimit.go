package middleware

import (
	"context"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// rateLimitScript 是一段原子性的 Lua 脚本，用于实现"计数 + 首次设置过期时间"的限流逻辑。
//
// 执行流程：
//  1. 对指定 key 执行 INCR，使计数加 1。
//  2. 若计数为 1（即首次写入），则设置该 key 的过期时间（TTL）。
//  3. 若当前计数超过限制上限，返回剩余 TTL 的负值，表示已触发限流。
//  4. 否则返回当前计数值。
//
// 由于 Lua 脚本在 Redis 中原子执行，不存在竞态条件。
var rateLimitScript = redis.NewScript(`
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])
local current = redis.call("INCR", key)
if current == 1 then
    redis.call("EXPIRE", key, ttl)
end
if current > limit then
    return redis.call("TTL", key) * -1  -- 返回负值表示超出限制，绝对值为剩余 TTL
end
return current
`)

// RateLimitByIP 返回一个基于客户端真实 IP 进行限流的中间件。
//
// 在给定的时间窗口 window 内，同一 IP 最多允许发起 count 次请求。
// keyPrefix 应对每个路由保持唯一，例如 "rate:login"，用于在 Redis 中区分不同接口的限流计数器。
func RateLimitByIP(rdb *redis.Client, keyPrefix string, count int, window time.Duration) echo.MiddlewareFunc {
	return rateLimitMiddleware(rdb, keyPrefix, count, window, func(c echo.Context) string {
		// 使用客户端真实 IP 作为限流维度
		return c.RealIP()
	})
}

// RateLimitByUser 返回一个基于已认证用户 ID 进行限流的中间件。
//
// 若请求已携带有效登录信息，则以 "u:<userID>" 作为限流键；
// 否则退回到以客户端真实 IP 作为限流键。
func RateLimitByUser(rdb *redis.Client, keyPrefix string, count int, window time.Duration) echo.MiddlewareFunc {
	return rateLimitMiddleware(rdb, keyPrefix, count, window, func(c echo.Context) string {
		if u := GetLoginUser(c); u != nil {
			// 已登录用户：以用户 ID 作为限流维度，避免共享 IP 误伤
			return "u:" + strconv.FormatInt(u.UserID, 10)
		}
		// 未登录用户：退回到 IP 维度
		return c.RealIP()
	})
}

// rateLimitMiddleware 是限流中间件的通用实现，由 RateLimitByIP 和 RateLimitByUser 共同调用。
//
// 参数说明：
//   - rdb：Redis 客户端，若为 nil 则跳过限流。
//   - keyPrefix：Redis key 前缀，用于区分不同接口的限流计数器。
//   - count：时间窗口内允许的最大请求次数。
//   - window：限流时间窗口长度。
//   - keyFn：从请求上下文中提取限流维度标识的函数（如 IP 或用户 ID）。
func rateLimitMiddleware(
	rdb *redis.Client,
	keyPrefix string,
	count int,
	window time.Duration,
	keyFn func(echo.Context) string,
) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// Redis 不可用时跳过限流，避免因缓存故障影响正常请求
			if rdb == nil {
				return next(c)
			}

			// 拼接完整的 Redis key，格式为 "<前缀>:<维度标识>"
			key := keyPrefix + ":" + keyFn(c)

			// 为 Lua 脚本调用设置 1 秒超时，防止 Redis 阻塞影响响应时间
			ctx, cancel := context.WithTimeout(c.Request().Context(), time.Second)
			defer cancel()

			// 执行原子限流脚本：返回正数表示当前计数，返回负数表示超出限制
			result, err := rateLimitScript.Run(ctx, rdb, []string{key}, count, int(window.Seconds())).Int64()
			if err != nil {
				// Redis 执行出错时放行请求，以可用性优先
				return next(c)
			}

			// 结果为负值表示已超过请求频率上限
			if result < 0 {
				return response.FailWith(c, response.TooManyRequests, "请求过于频繁，请稍后再试")
			}
			return next(c)
		}
	}
}
