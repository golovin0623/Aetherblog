package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/server"
)

func main() {
	// Health check mode for Docker healthcheck (scratch image has no curl/wget)
	if len(os.Args) > 1 && os.Args[1] == "-health" {
		resp, err := http.Get("http://localhost:8080/api/actuator/health")
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		os.Exit(0)
	}

	start := time.Now()

	// Setup zerolog — write to stdout (colored) + log file (raw JSON)
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnixMs

	// Console writer (colored) for stdout
	consoleWriter := zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: "15:04:05"}

	// Raw JSON writer to file (zerolog default format is JSON when writing to a plain io.Writer)
	writers := []io.Writer{consoleWriter}
	logDir := os.Getenv("AETHERBLOG_LOG_PATH")
	if logDir == "" {
		logDir = "./logs"
	}
	_ = os.MkdirAll(logDir, 0755)
	logFile, err := os.OpenFile(filepath.Join(logDir, "backend.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		writers = append(writers, logFile)
	}

	log.Logger = zerolog.New(io.MultiWriter(writers...)).
		With().Timestamp().Caller().Str("service", "backend").Logger()

	// Load configuration
	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = "config.yaml"
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}

	// Create and start server
	srv, err := server.New(cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to create server")
	}

	log.Info().
		Dur("startup", time.Since(start)).
		Int("port", cfg.Server.Port).
		Msg("AetherBlog Go server ready")

	if err := srv.Start(); err != nil {
		log.Fatal().Err(err).Msg("server error")
	}
}
