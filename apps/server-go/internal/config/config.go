// Package config 负责加载和验证 AetherBlog 应用的配置信息。
// 配置来源为可选的 YAML 文件，以及以 AETHERBLOG_ 为前缀的环境变量。
// 环境变量的优先级高于文件中的配置值。
// 同时兼容少量不带前缀的传统环境变量（如 POSTGRES_PASSWORD、JWT_SECRET），
// 以保证向后兼容性。
package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

// Config 是 AetherBlog 应用的根配置容器。
// 所有子配置节直接对应 YAML 顶层键名。
type Config struct {
	Server   ServerConfig   `koanf:"server"`        // HTTP 服务器绑定地址与端口
	Database DatabaseConfig `koanf:"database"`       // PostgreSQL 连接配置
	Redis    RedisConfig    `koanf:"redis"`          // Redis 连接配置
	JWT      JWTConfig      `koanf:"jwt"`            // JWT 签名密钥及令牌有效期
	Auth     AuthConfig     `koanf:"auth"`           // 认证 Cookie 安全策略
	CORS     CORSConfig     `koanf:"cors"`           // 跨域允许来源列表
	Upload   UploadConfig   `koanf:"upload"`         // 本地文件上传目录及 URL 前缀
	Media    MediaConfig    `koanf:"media"`          // 媒体管理配置（垃圾桶清理）
	Log      LogConfig      `koanf:"log"`            // 日志输出路径及最低级别
	AI       AIConfig       `koanf:"ai"`             // 外部 FastAPI AI 服务配置
	ES       ESConfig       `koanf:"elasticsearch"`  // Elasticsearch 节点地址列表
}

// ServerConfig 存储 HTTP 服务器的绑定配置。
type ServerConfig struct {
	Port int    `koanf:"port"` // Echo 服务器监听的 TCP 端口（默认：8080）
	Host string `koanf:"host"` // 绑定地址（默认："0.0.0.0"）
}

// DatabaseConfig 存储 PostgreSQL 连接参数。
type DatabaseConfig struct {
	Host         string `koanf:"host"`           // PostgreSQL 服务器主机名或 IP
	Port         int    `koanf:"port"`           // PostgreSQL 服务器端口（默认：5432）
	User         string `koanf:"user"`           // 数据库用户名
	Password     string `koanf:"password"`       // 数据库密码
	DBName       string `koanf:"dbname"`         // 数据库名称
	SSLMode      string `koanf:"sslmode"`        // PostgreSQL SSL 模式（disable|require|verify-full）
	MaxOpenConns int    `koanf:"max_open_conns"` // 连接池最大打开连接数
	MaxIdleConns int    `koanf:"max_idle_conns"` // 连接池最大空闲连接数
}

// DSN 根据配置字段构造并返回 PostgreSQL 连接字符串。
func (d *DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.DBName, d.SSLMode,
	)
}

// RedisConfig 存储 Redis 连接参数。
type RedisConfig struct {
	Host     string `koanf:"host"`     // Redis 服务器主机名或 IP
	Port     int    `koanf:"port"`     // Redis 服务器端口（默认：6379）
	Password string `koanf:"password"` // Redis AUTH 密码（空字符串表示无需认证）
	DB       int    `koanf:"db"`       // Redis 逻辑数据库索引（默认：0）
}

// Addr 返回 Redis 客户端所需的 "host:port" 地址字符串。
func (r *RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

// JWTConfig 存储 JSON Web Token 的签名密钥及过期时间配置。
type JWTConfig struct {
	Secret            string        `koanf:"secret"`              // HMAC-SHA256 签名密钥；生产环境必须配置
	Expiration        time.Duration `koanf:"expiration"`          // 访问令牌有效期（默认：24h）
	RefreshExpiration time.Duration `koanf:"refresh_expiration"`  // 刷新令牌有效期，存储于 Redis（默认：7*24h）
}

// AuthConfig 汇聚认证相关配置。
type AuthConfig struct {
	Cookie CookieConfig `koanf:"cookie"` // 认证令牌 HTTP Cookie 安全属性
}

// CookieConfig 控制认证 Cookie 的安全属性。
type CookieConfig struct {
	Secure   bool   `koanf:"secure"`    // 是否设置 Secure 标志（仅 HTTPS）；生产环境应启用
	SameSite string `koanf:"same_site"` // SameSite 策略："Strict" | "Lax" | "None"（默认："Strict"）
}

// CORSConfig 列出允许发起跨域请求的来源地址。
type CORSConfig struct {
	AllowedOrigins []string `koanf:"allowed_origins"` // 允许的来源列表（如 "http://localhost:5173"）
}

// UploadConfig 配置本地文件上传存储。
type UploadConfig struct {
	Path      string `koanf:"path"`       // 上传文件在本地文件系统中的存储目录（默认："./uploads"）
	URLPrefix string `koanf:"url_prefix"` // 提供上传文件访问的 URL 路径前缀（默认："/uploads"）
}

// MediaConfig 控制媒体管理行为。
type MediaConfig struct {
	TrashCleanupDays int `koanf:"trash_cleanup_days"` // 移入垃圾桶的媒体文件在永久删除前的保留天数（默认：120）
}

// LogConfig 控制应用日志输出。
type LogConfig struct {
	Path  string `koanf:"path"`  // 日志文件存储目录（默认："./logs"）
	Level string `koanf:"level"` // 最低日志级别："debug" | "info" | "warn" | "error"（默认："debug"）
}

// AIConfig 存储外部 FastAPI AI 服务的连接配置。
type AIConfig struct {
	BaseURL           string        `koanf:"base_url"`            // FastAPI AI 服务的基础 URL（默认："http://localhost:8000"）
	ConnectTimeout    time.Duration `koanf:"connect_timeout"`     // AI 服务请求的 TCP 连接超时时间（默认：5s）
	ReadTimeout       time.Duration `koanf:"read_timeout"`        // 非流式 AI 响应的读取超时时间（默认：30s）
	StreamReadTimeout time.Duration `koanf:"stream_read_timeout"` // SSE 流式响应的读取超时时间（默认：5m）
}

// ESConfig 存储 Elasticsearch 集群连接配置。
type ESConfig struct {
	URIs []string `koanf:"uris"` // Elasticsearch 节点 URI 列表（默认：["http://localhost:9200"]）
}

// Load 从指定路径的 YAML 文件（可选）加载配置，并覆盖应用环境变量。
// 返回一个已填充默认值的 *Config，未设置的字段使用默认值。
func Load(path string) (*Config, error) {
	k := koanf.New(".")

	// 加载 YAML 配置文件（可选）
	if path != "" {
		if err := k.Load(file.Provider(path), yaml.Parser()); err != nil {
			// 配置文件是可选的——环境变量可以提供所有配置
			_ = err
		}
	}

	// 加载带 AETHERBLOG_ 前缀的环境变量
	// 使用智能分隔符：仅在已知顶层键之后的第一个下划线处替换为 "."
	// 示例：AETHERBLOG_AI_BASE_URL → ai.base_url（而非 ai.base.url）
	//       AETHERBLOG_DATABASE_MAX_OPEN_CONNS → database.max_open_conns
	if err := k.Load(env.Provider("AETHERBLOG_", ".", func(s string) string {
		key := strings.ToLower(strings.TrimPrefix(s, "AETHERBLOG_"))
		return envKeyToKoanf(key)
	}), nil); err != nil {
		return nil, fmt.Errorf("loading env: %w", err)
	}

	cfg := defaultConfig()
	if err := k.Unmarshal("", cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	// 从无前缀环境变量覆盖（兼容不带 AETHERBLOG_ 前缀的 .env 文件）
	if err := k.Load(env.Provider("", ".", func(s string) string {
		switch s {
		case "JWT_SECRET":
			return "jwt.secret"
		case "CORS_ALLOWED_ORIGINS":
			return "cors.allowed_origins"
		case "UPLOAD_PATH":
			return "upload.path"
		case "LOG_PATH":
			return "log.path"
		case "REDIS_HOST":
			return "redis.host"
		case "REDIS_PORT":
			return "redis.port"
		case "REDIS_PASSWORD":
			return "redis.password"
		case "POSTGRES_PASSWORD":
			return "database.password"
		default:
			return ""
		}
	}), nil); err != nil {
		_ = err
	}
	_ = k.Unmarshal("", cfg)

	// 安全验证：JWT 密钥不能为空且长度不低于 32 字符
	if cfg.JWT.Secret == "" {
		return nil, fmt.Errorf("FATAL: jwt.secret must not be empty — set JWT_SECRET environment variable")
	}
	if len(cfg.JWT.Secret) < 32 {
		return nil, fmt.Errorf("FATAL: jwt.secret must be at least 32 characters (got %d)", len(cfg.JWT.Secret))
	}

	return cfg, nil
}

// envKeyToKoanf 将去除前缀后的小写环境变量键名转换为 koanf 路径。
// 仅在第一级配置节的边界处分割，保留字段名中的下划线。
// 示例："ai_base_url" → "ai.base_url"，"database_max_open_conns" → "database.max_open_conns"
func envKeyToKoanf(key string) string {
	// 特殊处理：auth_cookie_* 必须在通用 "auth" 前缀之前检查，
	// 以确保生成 auth.cookie.secure 而非 auth.cookie_secure
	if strings.HasPrefix(key, "auth_cookie_") {
		return "auth.cookie." + key[len("auth_cookie_"):]
	}

	// 已知的顶层配置节
	prefixes := []string{
		"server", "database", "redis", "jwt", "auth",
		"cors", "upload", "media", "log", "ai", "elasticsearch",
	}
	for _, p := range prefixes {
		if strings.HasPrefix(key, p+"_") {
			return p + "." + key[len(p)+1:]
		}
	}

	return strings.ReplaceAll(key, "_", ".")
}

// defaultConfig 返回一个预填充了安全开发默认值的 Config。
// 生产部署必须通过环境变量或 YAML 配置文件覆盖敏感信息
// （如 JWT.Secret、Database.Password 等）。
func defaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Port: 8080,
			Host: "0.0.0.0",
		},
		Database: DatabaseConfig{
			Host:         "localhost",
			Port:         5432,
			User:         "aetherblog",
			Password:     "aetherblog123",
			DBName:       "aetherblog",
			SSLMode:      "disable",
			MaxOpenConns: 20,
			MaxIdleConns: 5,
		},
		Redis: RedisConfig{
			Host: "localhost",
			Port: 6379,
			DB:   0,
		},
		JWT: JWTConfig{
			Expiration:        24 * time.Hour,
			RefreshExpiration: 7 * 24 * time.Hour,
		},
		Auth: AuthConfig{
			Cookie: CookieConfig{
				Secure:   true,
				SameSite: "Strict",
			},
		},
		CORS: CORSConfig{
			AllowedOrigins: []string{}, // Production must set via CORS_ALLOWED_ORIGINS env var
		},
		Upload: UploadConfig{
			Path:      "./uploads",
			URLPrefix: "/uploads",
		},
		Media: MediaConfig{
			TrashCleanupDays: 120,
		},
		Log: LogConfig{
			Path:  "./logs",
			Level: "debug",
		},
		AI: AIConfig{
			BaseURL:           "http://localhost:8000",
			ConnectTimeout:    5 * time.Second,
			ReadTimeout:       30 * time.Second,
			StreamReadTimeout: 5 * time.Minute,
		},
		ES: ESConfig{
			URIs: []string{"http://localhost:9200"},
		},
	}
}
