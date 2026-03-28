package main

import (
	"net/http"
	"os"
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

	// Setup zerolog
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnixMs
	log.Logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: "15:04:05"}).
		With().Timestamp().Caller().Logger()

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
