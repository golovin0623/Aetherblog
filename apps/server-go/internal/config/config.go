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

type Config struct {
	Server   ServerConfig   `koanf:"server"`
	Database DatabaseConfig `koanf:"database"`
	Redis    RedisConfig    `koanf:"redis"`
	JWT      JWTConfig      `koanf:"jwt"`
	Auth     AuthConfig     `koanf:"auth"`
	CORS     CORSConfig     `koanf:"cors"`
	Upload   UploadConfig   `koanf:"upload"`
	Media    MediaConfig    `koanf:"media"`
	Log      LogConfig      `koanf:"log"`
	AI       AIConfig       `koanf:"ai"`
	ES       ESConfig       `koanf:"elasticsearch"`
}

type ServerConfig struct {
	Port int    `koanf:"port"`
	Host string `koanf:"host"`
}

type DatabaseConfig struct {
	Host         string `koanf:"host"`
	Port         int    `koanf:"port"`
	User         string `koanf:"user"`
	Password     string `koanf:"password"`
	DBName       string `koanf:"dbname"`
	SSLMode      string `koanf:"sslmode"`
	MaxOpenConns int    `koanf:"max_open_conns"`
	MaxIdleConns int    `koanf:"max_idle_conns"`
}

func (d *DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.DBName, d.SSLMode,
	)
}

type RedisConfig struct {
	Host     string `koanf:"host"`
	Port     int    `koanf:"port"`
	Password string `koanf:"password"`
	DB       int    `koanf:"db"`
}

func (r *RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

type JWTConfig struct {
	Secret            string        `koanf:"secret"`
	Expiration        time.Duration `koanf:"expiration"`
	RefreshExpiration time.Duration `koanf:"refresh_expiration"`
}

type AuthConfig struct {
	Cookie CookieConfig `koanf:"cookie"`
}

type CookieConfig struct {
	Secure   bool   `koanf:"secure"`
	SameSite string `koanf:"same_site"`
}

type CORSConfig struct {
	AllowedOrigins []string `koanf:"allowed_origins"`
}

type UploadConfig struct {
	Path      string `koanf:"path"`
	URLPrefix string `koanf:"url_prefix"`
}

type MediaConfig struct {
	TrashCleanupDays int `koanf:"trash_cleanup_days"`
}

type LogConfig struct {
	Path  string `koanf:"path"`
	Level string `koanf:"level"`
}

type AIConfig struct {
	BaseURL          string        `koanf:"base_url"`
	ConnectTimeout   time.Duration `koanf:"connect_timeout"`
	ReadTimeout      time.Duration `koanf:"read_timeout"`
	StreamReadTimeout time.Duration `koanf:"stream_read_timeout"`
}

type ESConfig struct {
	URIs []string `koanf:"uris"`
}

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
	// AETHERBLOG_SERVER_PORT=8080 → server.port
	if err := k.Load(env.Provider("AETHERBLOG_", ".", func(s string) string {
		return strings.Replace(
			strings.ToLower(strings.TrimPrefix(s, "AETHERBLOG_")),
			"_", ".", -1,
		)
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
