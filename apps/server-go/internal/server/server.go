package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/handler"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// echoValidator wraps go-playground/validator for Echo.
type echoValidator struct{ v *validator.Validate }

func (ev *echoValidator) Validate(i any) error { return ev.v.Struct(i) }

// Server holds all dependencies for the HTTP server.
type Server struct {
	Echo     *echo.Echo
	Config   *config.Config
	DB       *sqlx.DB
	Redis    *redis.Client
	cancelBg context.CancelFunc // cancels background goroutines
}

// New creates and configures a new Server instance.
func New(cfg *config.Config) (*Server, error) {
	// Connect to PostgreSQL
	db, err := sqlx.Open("postgres", cfg.Database.DSN())
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(cfg.Database.MaxOpenConns)
	db.SetMaxIdleConns(cfg.Database.MaxIdleConns)

	// Verify connection (non-fatal — allows startup without DB for development)
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer pingCancel()
	if err := db.PingContext(pingCtx); err != nil {
		log.Warn().Err(err).Msg("database connection failed, will retry on first query")
	} else {
		log.Info().Msg("database connected")
	}

	// Connect to Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:         cfg.Redis.Addr(),
		Password:     cfg.Redis.Password,
		DB:           cfg.Redis.DB,
		DialTimeout:  2 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
		MaxRetries:   1,
	})
	redisCtx, redisCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer redisCancel()
	if err := rdb.Ping(redisCtx).Err(); err != nil {
		log.Warn().Err(err).Msg("redis connection failed, continuing without redis")
	} else {
		log.Info().Msg("redis connected")
	}

	// Create Echo instance
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Validator = &echoValidator{v: validator.New()}

	bgCtx, bgCancel := context.WithCancel(context.Background())

	s := &Server{
		Echo:     e,
		Config:   cfg,
		DB:       db,
		Redis:    rdb,
		cancelBg: bgCancel,
	}

	s.setupMiddleware()
	s.setupRoutes(bgCtx)

	return s, nil
}

func (s *Server) setupMiddleware() {
	s.Echo.Use(middleware.Recovery())
	s.Echo.Use(middleware.Trace())
	s.Echo.Use(middleware.CORS(s.Config.CORS.AllowedOrigins))
}

func (s *Server) setupRoutes(bgCtx context.Context) {
	// All routes under /api to match Java's context-path
	api := s.Echo.Group("/api")

	// Health check (matches Spring Boot Actuator path)
	api.GET("/actuator/health", s.healthHandler)

	// Static file serving for uploads
	api.Static("/uploads", s.Config.Upload.Path)

	// --- Shared repos ---
	userRepo := repository.NewUserRepo(s.DB)
	catRepo := repository.NewCategoryRepo(s.DB)
	tagRepo := repository.NewTagRepo(s.DB)
	friendLinkRepo := repository.NewFriendLinkRepo(s.DB)
	siteSettingRepo := repository.NewSiteSettingRepo(s.DB)
	postRepo := repository.NewPostRepo(s.DB)

	// --- Auth (with rate limiting on sensitive endpoints) ---
	authSvc := service.NewAuthService(userRepo, s.Redis)
	sessionSvc := service.NewSessionService(s.Redis, s.Config.JWT.Expiration, s.Config.JWT.RefreshExpiration)
	authGroup := api.Group("/v1/auth")
	authHandler := handler.NewAuthHandler(authSvc, sessionSvc, s.Config)
	// Mount with per-route rate limiting
	authGroup.POST("/login", authHandler.Login, middleware.RateLimitByIP(s.Redis, "rate:login", 10, time.Minute))
	authGroup.POST("/register", authHandler.RegisterUser, middleware.RateLimitByIP(s.Redis, "rate:register", 5, time.Minute))
	authGroup.POST("/refresh", authHandler.Refresh)
	authGroup.POST("/logout", authHandler.Logout)
	authGroup.GET("/me", authHandler.Me, middleware.JWTAuth(s.Config.JWT.Secret))
	authGroup.POST("/change-password", authHandler.ChangePassword, middleware.JWTAuth(s.Config.JWT.Secret), middleware.RateLimitByUser(s.Redis, "rate:changepwd", 5, time.Minute))
	authGroup.PUT("/profile", authHandler.UpdateProfile, middleware.JWTAuth(s.Config.JWT.Secret))
	authGroup.PUT("/avatar", authHandler.UpdateAvatar, middleware.JWTAuth(s.Config.JWT.Secret))

	// --- Admin routes (JWT-protected) ---
	adminJWT := middleware.JWTAuth(s.Config.JWT.Secret)
	admin := api.Group("/v1/admin", adminJWT)

	postSvc := service.NewPostService(postRepo, catRepo, tagRepo, s.Redis)

	handler.NewCategoryHandler(service.NewCategoryService(catRepo)).MountAdmin(admin.Group("/categories"))
	handler.NewTagHandler(service.NewTagService(tagRepo)).MountAdmin(admin.Group("/tags"))
	handler.NewFriendLinkHandler(service.NewFriendLinkService(friendLinkRepo)).MountAdmin(admin.Group("/friend-links"))
	handler.NewSiteSettingHandler(service.NewSiteSettingService(siteSettingRepo)).Mount(admin.Group("/settings"))
	// --- System monitoring ---
	systemGroup := admin.Group("/system")
	handler.NewSystemHandler().MountAdmin(systemGroup)
	sysMonitorSvc := service.NewSystemMonitorService(s.Config)
	containerMonitorSvc := service.NewContainerMonitorService()
	logViewerSvc := service.NewLogViewerService(s.Config)
	metricsHistorySvc := service.NewMetricsHistoryService(sysMonitorSvc)
	metricsHistorySvc.Start(bgCtx)
	handler.NewSystemMonitorHandler(
		sysMonitorSvc, containerMonitorSvc, logViewerSvc, metricsHistorySvc,
		s.DB, s.Redis, s.Config,
	).MountAdmin(systemGroup)
	handler.NewPostHandler(postSvc).MountAdmin(admin.Group("/posts"))
	commentRepo := repository.NewCommentRepo(s.DB)
	commentSvc := service.NewCommentService(commentRepo, postRepo)
	handler.NewCommentHandler(commentSvc).MountAdmin(admin.Group("/comments"))

	// --- Public routes ---
	public := api.Group("/v1/public")
	settingSvc := service.NewSiteSettingService(siteSettingRepo)
	handler.NewCategoryHandler(service.NewCategoryService(catRepo)).MountPublic(public.Group("/categories"))
	handler.NewFriendLinkHandler(service.NewFriendLinkService(friendLinkRepo)).MountPublic(public.Group("/friend-links"))
	handler.NewSiteHandler(settingSvc, userRepo, catRepo, tagRepo, postRepo).Mount(public.Group("/site"))
	postPublic := public.Group("/posts")
	postHandler := handler.NewPostHandler(postSvc)
	postHandler.MountPublic(postPublic)
	// Rate limit password verification: 10 attempts per minute per IP
	postPublic.POST("/:slug/verify-password", postHandler.VerifyPassword, middleware.RateLimitByIP(s.Redis, "rate:postpwd", 10, time.Minute))

	handler.NewArchiveHandler(postSvc).Mount(public.Group("/archives"))

	commentPublic := public.Group("/comments")
	commentHandler := handler.NewCommentHandler(commentSvc)
	commentHandler.MountPublic(commentPublic)
	// Rate limit public comment submission: 5 per minute per IP
	commentPublic.POST("/post/:postId", commentHandler.Submit, middleware.RateLimitByIP(s.Redis, "rate:comment", 5, time.Minute))

	// --- Media system ---
	localStore := storage.NewLocalStorage(s.Config.Upload.Path, "/api/uploads")
	mediaRepo := repository.NewMediaRepo(s.DB)
	folderRepo := repository.NewFolderRepo(s.DB)
	storageProviderRepo := repository.NewStorageProviderRepo(s.DB)
	mediaSvc := service.NewMediaService(mediaRepo, localStore, s.Config.Upload.Path)
	folderSvc := service.NewFolderService(folderRepo)
	storageProviderSvc := service.NewStorageProviderService(storageProviderRepo)
	handler.NewMediaHandler(mediaSvc).Mount(admin.Group("/media"))
	handler.NewFolderHandler(folderSvc).Mount(admin.Group("/media/folders"))
	handler.NewStorageProviderHandler(storageProviderSvc).Mount(admin.Group("/storage/providers"))

	// Media advanced: tags, permissions, shares, versions
	mediaTagRepo := repository.NewMediaTagRepo(s.DB)
	handler.NewMediaTagHandler(service.NewMediaTagService(mediaTagRepo)).Mount(admin.Group("/media"))
	permissionRepo := repository.NewPermissionRepo(s.DB)
	handler.NewPermissionHandler(service.NewPermissionService(permissionRepo)).Mount(admin.Group("/media"))
	shareRepo := repository.NewShareRepo(s.DB)
	handler.NewShareHandler(service.NewShareService(shareRepo)).Mount(admin.Group("/media"))
	versionRepo := repository.NewVersionRepo(s.DB)
	handler.NewVersionHandler(service.NewVersionService(versionRepo, mediaRepo)).Mount(admin.Group("/media"))

	// --- Analytics ---
	analyticsRepo := repository.NewAnalyticsRepo(s.DB)
	activityRepo := repository.NewActivityRepo(s.DB)
	analyticsSvc := service.NewAnalyticsService(analyticsRepo)
	activitySvc := service.NewActivityService(activityRepo, userRepo)
	handler.NewStatsHandler(analyticsSvc).Mount(admin.Group("/stats"))
	handler.NewActivityHandler(activitySvc).Mount(admin.Group("/activities"))
	handler.NewVisitorHandler(analyticsSvc).Mount(public.Group("/visit"))

	// --- Migrations ---
	handler.NewMigrationHandler(s.DB, catRepo, tagRepo, postRepo).Mount(admin.Group("/migrations"))

	// --- AI Proxy ---
	aiHandler := handler.NewAiHandler(s.Config)
	aiHandler.Mount(admin.Group("/ai"))
	aiHandler.MountProviders(admin.Group("/providers"))
}

func (s *Server) healthHandler(c echo.Context) error {
	// Check database
	dbStatus := "UP"
	if err := s.DB.Ping(); err != nil {
		dbStatus = "DOWN"
	}

	// Check Redis
	redisStatus := "UP"
	ctx, cancel := context.WithTimeout(c.Request().Context(), 2*time.Second)
	defer cancel()
	if err := s.Redis.Ping(ctx).Err(); err != nil {
		redisStatus = "DOWN"
	}

	status := "UP"
	if dbStatus == "DOWN" {
		status = "DOWN"
	}

	return response.OK(c, map[string]any{
		"status": status,
		"components": map[string]any{
			"db":    map[string]string{"status": dbStatus},
			"redis": map[string]string{"status": redisStatus},
		},
	})
}

// Start begins listening and blocks until shutdown signal.
func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%d", s.Config.Server.Host, s.Config.Server.Port)

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("addr", addr).Msg("server starting")
		if err := s.Echo.Start(addr); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server failed")
		}
	}()

	<-quit
	log.Info().Msg("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Cancel background goroutines (metrics history collector, etc.)
	if s.cancelBg != nil {
		s.cancelBg()
	}

	if err := s.Echo.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("server forced to shutdown")
	}

	s.DB.Close()
	s.Redis.Close()

	log.Info().Msg("server stopped")
	return nil
}
