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

// echoValidator 将 go-playground/validator 封装为 Echo 框架所需的校验器接口。
type echoValidator struct{ v *validator.Validate }

// Validate 对传入的结构体执行字段校验。
func (ev *echoValidator) Validate(i any) error { return ev.v.Struct(i) }

// Server 持有 HTTP 服务器的所有依赖项。
type Server struct {
	Echo     *echo.Echo         // Echo 框架实例
	Config   *config.Config     // 应用配置
	DB       *sqlx.DB           // PostgreSQL 数据库连接池
	Redis    *redis.Client      // Redis 客户端
	cancelBg context.CancelFunc // 用于取消后台 goroutine 的函数
}

// New 创建并配置一个新的 Server 实例，初始化数据库、Redis 及路由。
func New(cfg *config.Config) (*Server, error) {
	// 连接 PostgreSQL
	db, err := sqlx.Open("postgres", cfg.Database.DSN())
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(cfg.Database.MaxOpenConns)
	db.SetMaxIdleConns(cfg.Database.MaxIdleConns)

	// 验证数据库连接（非致命错误——允许在无数据库的开发环境中启动）
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer pingCancel()
	if err := db.PingContext(pingCtx); err != nil {
		log.Warn().Err(err).Msg("database connection failed, will retry on first query")
	} else {
		log.Info().Msg("database connected")
	}

	// 连接 Redis
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

	// 创建 Echo 实例
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

// setupMiddleware 注册全局中间件：Panic 恢复、请求追踪、跨域处理。
func (s *Server) setupMiddleware() {
	s.Echo.Use(middleware.Recovery())
	s.Echo.Use(middleware.Trace())
	s.Echo.Use(middleware.CORS(s.Config.CORS.AllowedOrigins))
}

// setupRoutes 注册所有路由，包括公开接口、管理员接口及 AI 代理接口。
func (s *Server) setupRoutes(bgCtx context.Context) {
	// 所有路由挂载在 /api 下，与 Java 版本的 context-path 保持一致
	api := s.Echo.Group("/api")

	// 健康检查（兼容 Spring Boot Actuator 路径）
	api.GET("/actuator/health", s.healthHandler)

	// 静态文件服务：提供上传文件的访问
	api.Static("/uploads", s.Config.Upload.Path)

	// --- 共享仓储层 ---
	userRepo := repository.NewUserRepo(s.DB)
	catRepo := repository.NewCategoryRepo(s.DB)
	tagRepo := repository.NewTagRepo(s.DB)
	friendLinkRepo := repository.NewFriendLinkRepo(s.DB)
	siteSettingRepo := repository.NewSiteSettingRepo(s.DB)
	postRepo := repository.NewPostRepo(s.DB)

	// --- 认证模块（敏感端点附加速率限制） ---
	authSvc := service.NewAuthService(userRepo, s.Redis)
	sessionSvc := service.NewSessionService(s.Redis, s.Config.JWT.Expiration, s.Config.JWT.RefreshExpiration)
	authGroup := api.Group("/v1/auth")
	authHandler := handler.NewAuthHandler(authSvc, sessionSvc, s.Config)
	// 按路由挂载速率限制
	authGroup.POST("/login", authHandler.Login, middleware.RateLimitByIP(s.Redis, "rate:login", 10, time.Minute))
	authGroup.POST("/register", authHandler.RegisterUser, middleware.RateLimitByIP(s.Redis, "rate:register", 5, time.Minute))
	authGroup.POST("/refresh", authHandler.Refresh)
	authGroup.POST("/logout", authHandler.Logout)
	authGroup.GET("/me", authHandler.Me, middleware.JWTAuth(s.Config.JWT.Secret))
	authGroup.POST("/change-password", authHandler.ChangePassword, middleware.JWTAuth(s.Config.JWT.Secret), middleware.RateLimitByUser(s.Redis, "rate:changepwd", 5, time.Minute))
	authGroup.PUT("/profile", authHandler.UpdateProfile, middleware.JWTAuth(s.Config.JWT.Secret))
	authGroup.PUT("/avatar", authHandler.UpdateAvatar, middleware.JWTAuth(s.Config.JWT.Secret))

	// --- 管理员路由（JWT 认证保护） ---
	adminJWT := middleware.JWTAuth(s.Config.JWT.Secret)
	admin := api.Group("/v1/admin", adminJWT)

	settingSvc := service.NewSiteSettingService(siteSettingRepo)
	aiClient := service.NewAIClient(s.Config.AI)
	internalToken := s.Config.AI.InternalServiceToken
	postSvc := service.NewPostService(postRepo, catRepo, tagRepo, s.Redis, aiClient, settingSvc, internalToken)

	handler.NewCategoryHandler(service.NewCategoryService(catRepo)).MountAdmin(admin.Group("/categories"))
	handler.NewTagHandler(service.NewTagService(tagRepo)).MountAdmin(admin.Group("/tags"))
	handler.NewFriendLinkHandler(service.NewFriendLinkService(friendLinkRepo)).MountAdmin(admin.Group("/friend-links"))
	handler.NewSiteSettingHandler(settingSvc).Mount(admin.Group("/settings"))

	// --- 系统监控模块 ---
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

	// --- 公开路由 ---
	public := api.Group("/v1/public")
	handler.NewCategoryHandler(service.NewCategoryService(catRepo)).MountPublic(public.Group("/categories"))
	handler.NewFriendLinkHandler(service.NewFriendLinkService(friendLinkRepo)).MountPublic(public.Group("/friend-links"))
	handler.NewSiteHandler(settingSvc, userRepo, catRepo, tagRepo, postRepo).Mount(public.Group("/site"))
	postPublic := public.Group("/posts")
	postHandler := handler.NewPostHandler(postSvc)
	postHandler.MountPublic(postPublic)
	// 文章密码验证速率限制：每 IP 每分钟最多 10 次
	postPublic.POST("/:slug/verify-password", postHandler.VerifyPassword, middleware.RateLimitByIP(s.Redis, "rate:postpwd", 10, time.Minute))

	handler.NewArchiveHandler(postSvc).Mount(public.Group("/archives"))

	commentPublic := public.Group("/comments")
	commentHandler := handler.NewCommentHandler(commentSvc)
	commentHandler.MountPublic(commentPublic)
	// 公开评论提交速率限制：每 IP 每分钟最多 5 次
	commentPublic.POST("/post/:postId", commentHandler.Submit, middleware.RateLimitByIP(s.Redis, "rate:comment", 5, time.Minute))

	// --- 公开搜索 API ---
	searchSvc := service.NewSearchService(postRepo, aiClient, settingSvc, s.Redis, internalToken)
	searchHandler := handler.NewSearchHandler(searchSvc)
	searchPublic := public.Group("/search")
	// TODO: These rate limits (30/min for search, 5/min for QA) are hardcoded because
	// rate limit middleware is initialized at startup before config values from the database
	// are available. Consider implementing dynamic rate limiting that reads from search config
	// (search.anon_search_rate_per_min, search.anon_qa_rate_per_min) at request time.
	searchPublic.GET("", searchHandler.Search, middleware.RateLimitByIP(s.Redis, "rate:search", 30, time.Minute))
	searchPublic.GET("/features", searchHandler.Features, middleware.RateLimitByIP(s.Redis, "rate:search:features", 60, time.Minute))
	searchPublic.GET("/qa", searchHandler.QA, middleware.RateLimitByIP(s.Redis, "rate:qa", 5, time.Minute))

	// --- 媒体系统 ---
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

	// 媒体高级功能：标签、权限、分享、版本管理
	mediaTagRepo := repository.NewMediaTagRepo(s.DB)
	handler.NewMediaTagHandler(service.NewMediaTagService(mediaTagRepo)).Mount(admin.Group("/media"))
	permissionRepo := repository.NewPermissionRepo(s.DB)
	handler.NewPermissionHandler(service.NewPermissionService(permissionRepo)).Mount(admin.Group("/media"))
	shareRepo := repository.NewShareRepo(s.DB)
	handler.NewShareHandler(service.NewShareService(shareRepo)).Mount(admin.Group("/media"))
	versionRepo := repository.NewVersionRepo(s.DB)
	handler.NewVersionHandler(service.NewVersionService(versionRepo, mediaRepo)).Mount(admin.Group("/media"))

	// --- 数据统计与分析 ---
	analyticsRepo := repository.NewAnalyticsRepo(s.DB)
	activityRepo := repository.NewActivityRepo(s.DB)
	analyticsSvc := service.NewAnalyticsService(analyticsRepo)
	activitySvc := service.NewActivityService(activityRepo, userRepo)
	handler.NewStatsHandler(analyticsSvc).Mount(admin.Group("/stats"))
	handler.NewActivityHandler(activitySvc).Mount(admin.Group("/activities"))
	handler.NewVisitorHandler(analyticsSvc).Mount(public.Group("/visit"))

	// --- 数据迁移 ---
	handler.NewMigrationHandler(s.DB, catRepo, tagRepo, postRepo).Mount(admin.Group("/migrations"))

	// --- AI 代理接口 ---
	aiHandler := handler.NewAiHandler(s.Config)
	aiHandler.Mount(admin.Group("/ai"))
	aiHandler.MountProviders(admin.Group("/providers"))

	// --- 搜索管理 ---
	searchAdmin := admin.Group("/search")
	searchAdmin.GET("/config", searchHandler.GetConfig)
	searchAdmin.PATCH("/config", searchHandler.UpdateConfig)
	searchAdmin.GET("/stats", searchHandler.GetStats)
	searchAdmin.POST("/reindex", searchHandler.Reindex)
	searchAdmin.POST("/retry-failed", searchHandler.RetryFailed)
	searchAdmin.GET("/embedding-status", searchHandler.EmbeddingStatus)
}

// healthHandler 处理健康检查请求，依次检测数据库和 Redis 连通性并返回状态。
func (s *Server) healthHandler(c echo.Context) error {
	// 检测数据库连通性
	dbStatus := "UP"
	if err := s.DB.Ping(); err != nil {
		dbStatus = "DOWN"
	}

	// 检测 Redis 连通性
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

// Start 启动 HTTP 监听并阻塞，直到收到系统信号后优雅关闭服务器。
func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%d", s.Config.Server.Host, s.Config.Server.Port)

	// 监听系统退出信号，实现优雅关闭
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

	// 取消后台 goroutine（如指标历史收集器等）
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
