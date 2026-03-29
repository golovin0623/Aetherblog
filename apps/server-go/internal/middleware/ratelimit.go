package middleware

import (
	"context"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// Lua script: atomic increment + set-expiry-if-new.
// Returns current count after increment.
var rateLimitScript = redis.NewScript(`
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])
local current = redis.call("INCR", key)
if current == 1 then
    redis.call("EXPIRE", key, ttl)
end
if current > limit then
    return redis.call("TTL", key) * -1  -- negative = over limit, value = remaining TTL
end
return current
`)

// RateLimitByIP returns a middleware that limits requests to `count` per `window` per remote IP.
// keyPrefix should be unique per route, e.g. "rate:login".
func RateLimitByIP(rdb *redis.Client, keyPrefix string, count int, window time.Duration) echo.MiddlewareFunc {
	return rateLimitMiddleware(rdb, keyPrefix, count, window, func(c echo.Context) string {
		return c.RealIP()
	})
}

// RateLimitByUser limits by authenticated user ID.
func RateLimitByUser(rdb *redis.Client, keyPrefix string, count int, window time.Duration) echo.MiddlewareFunc {
	return rateLimitMiddleware(rdb, keyPrefix, count, window, func(c echo.Context) string {
		if u := GetLoginUser(c); u != nil {
			return "u:" + strconv.FormatInt(u.UserID, 10)
		}
		return c.RealIP()
	})
}

func rateLimitMiddleware(
	rdb *redis.Client,
	keyPrefix string,
	count int,
	window time.Duration,
	keyFn func(echo.Context) string,
) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if rdb == nil {
				return next(c) // Redis unavailable — skip rate limiting
			}

			key := keyPrefix + ":" + keyFn(c)
			ctx, cancel := context.WithTimeout(c.Request().Context(), time.Second)
			defer cancel()

			result, err := rateLimitScript.Run(ctx, rdb, []string{key}, count, int(window.Seconds())).Int64()
			if err != nil {
				// Redis error — allow the request
				return next(c)
			}

			if result < 0 {
				return response.FailWith(c, response.TooManyRequests, "请求过于频繁，请稍后再试")
			}
			return next(c)
		}
	}
}
