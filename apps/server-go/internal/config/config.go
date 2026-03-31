// Package config loads and validates AetherBlog application configuration.
// Configuration is sourced from an optional YAML file and environment variables
// (prefix: AETHERBLOG_). Environment variables take precedence over file values.
// A limited set of legacy bare-name env vars (e.g. POSTGRES_PASSWORD, JWT_SECRET)
// is also supported for backward compatibility.
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

// Config is the root configuration container for the AetherBlog application.
// All sub-sections map directly to top-level YAML keys.
type Config struct {
	Server   ServerConfig   `koanf:"server"`        // HTTP server bind address and port
	Database DatabaseConfig `koanf:"database"`       // PostgreSQL connection settings
	Redis    RedisConfig    `koanf:"redis"`          // Redis connection settings
	JWT      JWTConfig      `koanf:"jwt"`            // JWT signing secret and token lifetimes
	Auth     AuthConfig     `koanf:"auth"`           // Auth cookie security settings
	CORS     CORSConfig     `koanf:"cors"`           // CORS allowed origin list
	Upload   UploadConfig   `koanf:"upload"`         // Local file upload directory and URL prefix
	Media    MediaConfig    `koanf:"media"`          // Media management settings (trash cleanup)
	Log      LogConfig      `koanf:"log"`            // Log output path and minimum level
	AI       AIConfig       `koanf:"ai"`             // External FastAPI AI service settings
	ES       ESConfig       `koanf:"elasticsearch"`  // Elasticsearch node URIs
}

// ServerConfig holds HTTP server binding settings.
type ServerConfig struct {
	Port int    `koanf:"port"` // TCP port the Echo server listens on (default: 8080)
	Host string `koanf:"host"` // Bind address (default: "0.0.0.0")
}

// DatabaseConfig holds PostgreSQL connection parameters.
type DatabaseConfig struct {
	Host         string `koanf:"host"`           // PostgreSQL server hostname or IP
	Port         int    `koanf:"port"`           // PostgreSQL server port (default: 5432)
	User         string `koanf:"user"`           // Database user
	Password     string `koanf:"password"`       // Database password
	DBName       string `koanf:"dbname"`         // Database name
	SSLMode      string `koanf:"sslmode"`        // PostgreSQL SSL mode (disable|require|verify-full)
	MaxOpenConns int    `koanf:"max_open_conns"` // Maximum number of open connections in the pool
	MaxIdleConns int    `koanf:"max_idle_conns"` // Maximum number of idle connections in the pool
}

// DSN returns the PostgreSQL connection string built from the config fields.
func (d *DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.DBName, d.SSLMode,
	)
}

// RedisConfig holds Redis connection parameters.
type RedisConfig struct {
	Host     string `koanf:"host"`     // Redis server hostname or IP
	Port     int    `koanf:"port"`     // Redis server port (default: 6379)
	Password string `koanf:"password"` // Redis AUTH password (empty = no auth)
	DB       int    `koanf:"db"`       // Redis logical database index (default: 0)
}

// Addr returns the "host:port" address string for the Redis client.
func (r *RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

// JWTConfig holds JSON Web Token signing and expiry settings.
type JWTConfig struct {
	Secret            string        `koanf:"secret"`             // HMAC-SHA256 signing secret; must be set in production
	Expiration        time.Duration `koanf:"expiration"`         // Access token validity period (default: 24h)
	RefreshExpiration time.Duration `koanf:"refresh_expiration"` // Refresh token validity period stored in Redis (default: 7*24h)
}

// AuthConfig groups authentication-related settings.
type AuthConfig struct {
	Cookie CookieConfig `koanf:"cookie"` // HTTP cookie security settings for auth tokens
}

// CookieConfig controls the security attributes of auth cookies.
type CookieConfig struct {
	Secure   bool   `koanf:"secure"`    // Set the Secure flag (HTTPS only); enable in production
	SameSite string `koanf:"same_site"` // SameSite policy: "Strict" | "Lax" | "None" (default: "Strict")
}

// CORSConfig lists the origins that are permitted to make cross-origin requests.
type CORSConfig struct {
	AllowedOrigins []string `koanf:"allowed_origins"` // List of allowed origins (e.g. "http://localhost:5173")
}

// UploadConfig configures local file upload storage.
type UploadConfig struct {
	Path      string `koanf:"path"`       // Local filesystem directory for uploaded files (default: "./uploads")
	URLPrefix string `koanf:"url_prefix"` // URL path prefix for serving uploaded files (default: "/uploads")
}

// MediaConfig controls media management behaviour.
type MediaConfig struct {
	TrashCleanupDays int `koanf:"trash_cleanup_days"` // Days before trashed media files are permanently deleted (default: 120)
}

// LogConfig controls application log output.
type LogConfig struct {
	Path  string `koanf:"path"`  // Directory path for log files (default: "./logs")
	Level string `koanf:"level"` // Minimum log level: "debug" | "info" | "warn" | "error" (default: "debug")
}

// AIConfig holds connection settings for the external FastAPI AI service.
type AIConfig struct {
	BaseURL           string        `koanf:"base_url"`           // Base URL of the FastAPI AI service (default: "http://localhost:8000")
	ConnectTimeout    time.Duration `koanf:"connect_timeout"`    // TCP dial timeout for AI service requests (default: 5s)
	ReadTimeout       time.Duration `koanf:"read_timeout"`       // Read timeout for non-streaming AI responses (default: 30s)
	StreamReadTimeout time.Duration `koanf:"stream_read_timeout"` // Read timeout for SSE streaming responses (default: 5m)
}

// ESConfig holds Elasticsearch cluster connection settings.
type ESConfig struct {
	URIs []string `koanf:"uris"` // List of Elasticsearch node URIs (default: ["http://localhost:9200"])
}

// Load reads configuration from the YAML file at path (optional) and then
// overlays environment variables. Returns a fully populated *Config with
// defaults applied for any unset fields.
func Load(path string) (*Config, error) {
	k := koanf.New(".")

	// Load YAML config file (optional)
	if path != "" {
		if err := k.Load(file.Provider(path), yaml.Parser()); err != nil {
			// Config file is optional — env vars can provide everything
			_ = err
		}
	}

	// Load environment variables (prefix: AETHERBLOG_)
	// Uses smart separator: only the first underscore after known top-level keys becomes "."
	// AETHERBLOG_AI_BASE_URL → ai.base_url (not ai.base.url)
	// AETHERBLOG_DATABASE_MAX_OPEN_CONNS → database.max_open_conns
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

	// Override from env directly (backward compat with .env without AETHERBLOG_ prefix)
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

	return cfg, nil
}

// envKeyToKoanf converts a lowercase env key (after prefix removal) to a koanf path.
// It splits only at the first-level section boundary, preserving underscores in field names.
// Example: "ai_base_url" → "ai.base_url", "database_max_open_conns" → "database.max_open_conns"
func envKeyToKoanf(key string) string {
	// Special: auth_cookie_* must be checked before the general "auth" prefix
	// to produce auth.cookie.secure instead of auth.cookie_secure
	if strings.HasPrefix(key, "auth_cookie_") {
		return "auth.cookie." + key[len("auth_cookie_"):]
	}

	// Known top-level config sections
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

// defaultConfig returns a Config pre-populated with safe development defaults.
// Production deployments must override secrets (JWT.Secret, Database.Password, etc.)
// via environment variables or a YAML config file.
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
				Secure:   false,
				SameSite: "Strict",
			},
		},
		CORS: CORSConfig{
			AllowedOrigins: []string{
				"http://localhost:5173",
				"http://127.0.0.1:5173",
				"http://localhost:7894",
				"http://127.0.0.1:7894",
				"http://localhost:7899",
				"http://127.0.0.1:7899",
			},
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
