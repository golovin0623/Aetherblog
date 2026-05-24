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
	echomiddleware "github.com/labstack/echo/v4/middleware"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/handler"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/cryptkey"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtkeys"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// echoValidator 将 go-playground/validator 封装为 Echo 框架所需的校验器接口。
type echoValidator struct{ v *validator.Validate }

// Validate 对传入的结构体执行字段校验。
func (ev *echoValidator) Validate(i any) error { return ev.v.Struct(i) }

// newValidator 创建并注册自定义校验规则的 validator 实例。
func newValidator() *validator.Validate {
	v := validator.New()
	// password_complexity: 至少包含一个大写字母、一个小写字母和一个数字
	v.RegisterValidation("password_complexity", func(fl validator.FieldLevel) bool {
		password := fl.Field().String()
		var hasUpper, hasLower, hasDigit bool
		for _, ch := range password {
			switch {
			case ch >= 'A' && ch <= 'Z':
				hasUpper = true
			case ch >= 'a' && ch <= 'z':
				hasLower = true
			case ch >= '0' && ch <= '9':
				hasDigit = true
			}
		}
		return hasUpper && hasLower && hasDigit
	})
	return v
}

// Server 持有 HTTP 服务器的所有依赖项。
type Server struct {
	Echo     *echo.Echo         // Echo 框架实例
	Config   *config.Config     // 应用配置
	DB       *sqlx.DB           // PostgreSQL 数据库连接池
	Redis    *redis.Client      // Redis 客户端
	JWTKeys  *jwtkeys.Store     // JWT 签名密钥 Store（DB 管理 + 定时轮换）
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
	e.Validator = &echoValidator{v: newValidator()}

	bgCtx, bgCancel := context.WithCancel(context.Background())

	// --- JWT 密钥 Store 初始化（支持定时轮换，见 migration 000033） ---
	// 失败 fatal —— JWT 验证是所有鉴权路径的前置，没有有效 Store 不能启动。
	// bootstrapCtx 超时 10s 给 DB bootstrap + SELECT 一个合理的上限。
	bootstrapCtx, bootstrapCancel := context.WithTimeout(bgCtx, 10*time.Second)
	jwtRepo := repository.NewJWTSecretRepo(db)
	jwtStore, err := jwtkeys.New(bootstrapCtx, jwtRepo, cfg.JWT.Secret)
	bootstrapCancel()
	if err != nil {
		bgCancel()
		return nil, fmt.Errorf("init jwt keystore: %w", err)
	}
	// 启动后台 reloader + rotator。两者都监听 bgCtx，Shutdown 时自动退出。
	jwtStore.StartReloader(bgCtx, cfg.JWT.ReloadInterval)
	jwtStore.StartRotator(bgCtx, cfg.JWT.RotationInterval, cfg.JWT.PreviousGrace)
	log.Info().
		Dur("rotation_interval", cfg.JWT.RotationInterval).
		Dur("previous_grace", cfg.JWT.PreviousGrace).
		Dur("reload_interval", cfg.JWT.ReloadInterval).
		Msg("jwt keystore initialized with scheduled rotation")

	s := &Server{
		Echo:     e,
		Config:   cfg,
		DB:       db,
		Redis:    rdb,
		JWTKeys:  jwtStore,
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

	// --- 共享仓储层 ---
	userRepo := repository.NewUserRepo(s.DB)
	catRepo := repository.NewCategoryRepo(s.DB)
	tagRepo := repository.NewTagRepo(s.DB)
	friendLinkRepo := repository.NewFriendLinkRepo(s.DB)
	siteSettingRepo := repository.NewSiteSettingRepo(s.DB)
	postRepo := repository.NewPostRepo(s.DB)
	noteRepo := repository.NewNoteRepo(s.DB)
	accessRepo := repository.NewAccessRepo(s.DB)
	accessSvc := service.NewAccessService(accessRepo)

	// --- 活动记录服务（提前初始化，供各 handler 注入） ---
	activityRepo := repository.NewActivityRepo(s.DB)
	activitySvc := service.NewActivityService(activityRepo, userRepo)

	// --- 认证模块（敏感端点附加速率限制） ---
	authSvc := service.NewAuthService(userRepo, s.Redis, accessRepo)
	sessionSvc := service.NewSessionService(s.Redis, s.Config.JWT.Expiration, s.Config.JWT.RefreshExpiration)
	authGroup := api.Group("/v1/auth")
	// jwtRepo 在 New() 里也实例化过用于 jwtkeys.Store 启动,这里另起一个新的
	// thin wrapper 实例 —— Repo 无内部状态,实例化是 O(1)。AuthHandler 用它来
	// 暴露 GET /admin/auth/jwt-secret-meta 给管理 UI 拉时间戳元数据。
	jwtSecretRepo := repository.NewJWTSecretRepo(s.DB)
	authHandler := handler.NewAuthHandler(authSvc, sessionSvc, s.Config, activitySvc, s.JWTKeys, jwtSecretRepo)
	// 所有鉴权中间件走 JWT Store 版本，支持 current+previous 双 key 验证。
	authMW := middleware.JWTAuthWithStore(s.JWTKeys)
	// SECURITY: pwdRotated 拦截 must_change_password=true 的 token —— 仅放行登录流程
	// 必需的 /me /change-password /refresh /logout，业务接口（含 admin / agent）一律 403。
	// 必须挂在 authMW 之后，且**绝对不能**挂在改密相关端点上（会造成自服务死锁）。
	pwdRotated := middleware.RequirePasswordRotated()
	// 按路由挂载速率限制
	authGroup.POST("/login", authHandler.Login, middleware.RateLimitByIP(s.Redis, "rate:login", 10, time.Minute))
	authGroup.POST("/register", authHandler.RegisterUser, authMW, pwdRotated, middleware.RequireRole("admin"), middleware.RateLimitByIP(s.Redis, "rate:register", 5, time.Minute))
	authGroup.POST("/refresh", authHandler.Refresh)
	authGroup.POST("/logout", authHandler.Logout)
	authGroup.GET("/me", authHandler.Me, authMW)
	authGroup.POST("/change-password", authHandler.ChangePassword, authMW, middleware.RateLimitByUser(s.Redis, "rate:changepwd", 5, time.Minute))
	authGroup.PUT("/profile", authHandler.UpdateProfile, authMW, pwdRotated)
	authGroup.PUT("/avatar", authHandler.UpdateAvatar, authMW, pwdRotated)

	// --- 管理员路由（JWT 认证 + 角色强校验） ---
	// SECURITY (VULN-052): /v1/admin/* 必须强制 role==admin，否则任何已登录 USER 都能
	// 命中管理端点，导致 IDOR 簇 (VULN-029/037/038/039/040/041/042/044) 与 AI 代理 (VULN-172)
	// 授权失效。此处必须与 handler 层 ownership check 协同，不可单独省略。
	// pwdRotated 在 RequireRole 之前 —— 默认密码账号即便是 admin 也得先改密才能进。
	admin := api.Group("/v1/admin", authMW, pwdRotated, middleware.RequireRole("admin"))

	// --- 身份访问模块（RBAC 自己保护，不强制 legacy ADMIN 角色） ---
	// 这些端点由 permissions 表驱动，允许后续给非 ADMIN 角色授予精确权限。
	accessAdmin := api.Group("/v1/admin", authMW, pwdRotated)
	handler.NewAccessHandler(accessSvc, activitySvc).Mount(accessAdmin, func(permissionCode string) echo.MiddlewareFunc {
		return middleware.RequirePermission(accessSvc, permissionCode)
	})

	// 管理员专用 auth 端点（手动轮换 JWT 密钥等）。
	authHandler.MountAdmin(admin.Group("/auth"))

	settingSvc := service.NewSiteSettingService(siteSettingRepo)
	aiClient := service.NewAIClient(s.Config.AI)
	internalToken := s.Config.AI.InternalServiceToken
	postSvc := service.NewPostService(postRepo, catRepo, tagRepo, s.Redis, aiClient, settingSvc, internalToken)
	postSvc.SetAccessService(accessSvc)
	noteSvc := service.NewNoteService(noteRepo, s.Redis)

	handler.NewCategoryHandler(service.NewCategoryService(catRepo)).MountAdmin(admin.Group("/categories"))
	handler.NewTagHandler(service.NewTagService(tagRepo)).MountAdmin(admin.Group("/tags"))
	handler.NewFriendLinkHandler(service.NewFriendLinkService(friendLinkRepo), activitySvc).MountAdmin(admin.Group("/friend-links"))
	handler.NewSiteSettingHandler(settingSvc, activitySvc).Mount(admin.Group("/settings"))

	// --- 系统监控模块 ---
	systemGroup := admin.Group("/system")
	handler.NewSystemHandler().MountAdmin(systemGroup)
	sysMonitorSvc := service.NewSystemMonitorService(s.Config)
	// 把配置里声明的外部依赖(Redis/Postgres)作为 LinkedTarget 传给容器监控,
	// 这样用户把 REDIS_HOST 指向自管的 redis-server / 外部 IP 时,容器监控
	// 面板也能显示它的 CPU/内存/状态,而不是仅按 aetherblog-* 前缀过滤。
	containerMonitorSvc := service.NewContainerMonitorService(
		s.Config.Monitor.DockerEndpoint,
		service.LinkedTarget{Host: s.Config.Redis.Host, Port: s.Config.Redis.Port, ImageHint: "redis"},
		service.LinkedTarget{Host: s.Config.Database.Host, Port: s.Config.Database.Port, ImageHint: "postgres"},
	)
	logViewerSvc := service.NewLogViewerService(s.Config)
	metricsHistorySvc := service.NewMetricsHistoryService(sysMonitorSvc)
	metricsHistorySvc.Start(bgCtx)
	handler.NewSystemMonitorHandler(
		sysMonitorSvc, containerMonitorSvc, logViewerSvc, metricsHistorySvc,
		s.DB, s.Redis, s.Config,
	).MountAdmin(systemGroup)
	// 运行时日志级别调整 —— 同时控制 backend 与 ai-service。
	// 路由放在 /v1/admin/system/log-level 下,与现有日志查看 API 同源。
	handler.NewLogLevelHandler(s.Config, aiClient).MountAdmin(systemGroup)
	handler.NewPostHandler(postSvc, activitySvc).MountAdmin(admin.Group("/posts"))
	noteHandler := handler.NewNoteHandler(noteSvc)
	noteHandler.MountAdmin(admin.Group("/notes"))
	noteHandler.MountFolders(admin.Group("/note-folders"))
	noteHandler.MountTags(admin.Group("/note-tags"))
	commentRepo := repository.NewCommentRepo(s.DB)
	commentSvc := service.NewCommentService(commentRepo, postRepo)
	handler.NewCommentHandler(commentSvc, activitySvc).MountAdmin(admin.Group("/comments"))

	// --- 公开路由 ---
	public := api.Group("/v1/public")
	handler.NewCategoryHandler(service.NewCategoryService(catRepo)).MountPublic(public.Group("/categories"))
	handler.NewFriendLinkHandler(service.NewFriendLinkService(friendLinkRepo), nil).MountPublic(public.Group("/friend-links"))
	handler.NewSiteHandler(settingSvc, userRepo, catRepo, tagRepo, postRepo).Mount(public.Group("/site"))
	postPublic := public.Group("/posts")
	postHandler := handler.NewPostHandler(postSvc, nil)
	postHandler.MountPublic(postPublic)
	// 文章密码验证速率限制：每 IP 每分钟最多 10 次
	postPublic.POST("/:slug/verify-password", postHandler.VerifyPassword, middleware.RateLimitByIP(s.Redis, "rate:postpwd", 10, time.Minute))

	handler.NewArchiveHandler(postSvc).Mount(public.Group("/archives"))

	// --- 登录用户协作内容路由 ---
	// 内容共享授权由 /v1/admin/content-shares 管理，这里提供被授权用户的实际消费入口。
	collaboration := api.Group("/v1/collaboration", authMW, pwdRotated)
	handler.NewPostHandler(postSvc, nil).MountShared(collaboration.Group("/posts"))

	commentPublic := public.Group("/comments")
	commentHandler := handler.NewCommentHandler(commentSvc, nil)
	commentHandler.MountPublic(commentPublic)
	// 公开评论提交速率限制：每 IP 每分钟最多 5 次
	commentPublic.POST("/post/:postId", commentHandler.Submit, middleware.RateLimitByIP(s.Redis, "rate:comment", 5, time.Minute))

	// --- 公开搜索 API ---
	searchSvc := service.NewSearchService(postRepo, aiClient, settingSvc, s.Redis, internalToken)
	searchHandler := handler.NewSearchHandler(searchSvc)
	searchPublic := public.Group("/search")
	// TODO: 此处的限流值（搜索 30/min、问答 5/min）目前是硬编码，因为限流中间件
	// 在启动阶段就要注册，而那时数据库里的配置还未读出。考虑改为请求时动态读取
	// search 配置（search.anon_search_rate_per_min、search.anon_qa_rate_per_min）
	// 实现可调限流。
	searchPublic.GET("", searchHandler.Search, middleware.RateLimitByIP(s.Redis, "rate:search", 30, time.Minute))
	searchPublic.GET("/features", searchHandler.Features, middleware.RateLimitByIP(s.Redis, "rate:search:features", 60, time.Minute))
	searchPublic.GET("/qa", searchHandler.QA, middleware.RateLimitByIP(s.Redis, "rate:qa", 5, time.Minute))

	// --- 媒体系统 ---
	localStore := storage.NewLocalStorage(s.Config.Upload.Path, "/api/uploads")
	mediaRepo := repository.NewMediaRepo(s.DB)
	folderRepo := repository.NewFolderRepo(s.DB)
	storageProviderRepo := repository.NewStorageProviderRepo(s.DB)
	// 批次 3b:打印 storage 加密密钥来源 —— 让运维一眼看到走的是 STORAGE_ENCRYPTION_KEYS
	// 还是 fallback 到了 AI_CREDENTIAL_ENCRYPTION_KEYS。两个 env 都缺时这条日志走 dev 模式。
	log.Info().
		Str("source", cryptkey.StorageKeystoreSource()).
		Bool("enabled", cryptkey.DefaultForStorage().Enabled()).
		Msg("storage encryption keystore initialized")
	// 启动时自动把 legacy 明文 storage_providers.config_json 加密重写
	// (storage 密钥未配置时这是 no-op,所以 dev 环境不受影响)。
	if migrated, total, err := storageProviderRepo.MigrateLegacyToEncrypted(context.Background()); err != nil {
		log.Warn().Err(err).Msg("storage_providers legacy encryption migration failed")
	} else if migrated > 0 {
		log.Info().Int("migrated", migrated).Int("total", total).Msg("encrypted legacy storage_providers.config_json rows on startup")
	}
	// Phase 1: MediaService 改造 — 注入 providerRepo 让 Upload/Delete 按 default provider 走对应后端。
	mediaSvc := service.NewMediaService(mediaRepo, localStore, storageProviderRepo, s.Config.Upload.Path)
	// 批次 2: 注入 folder_permissions 校验依赖,Upload 时拦截越权写入私有文件夹
	permissionRepo := repository.NewPermissionRepo(s.DB)
	mediaSvc.SetFolderAccess(folderRepo, permissionRepo)
	folderSvc := service.NewFolderService(folderRepo)
	// StorageProviderService 持有 mediaSvc 引用以便在 Update/Delete 后清缓存
	storageProviderSvc := service.NewStorageProviderService(storageProviderRepo, mediaSvc)

	// Phase 4: 同步备份 worker
	mediaSyncRepo := repository.NewMediaSyncRepo(s.DB)
	siteSettingRepoForSync := repository.NewSiteSettingRepo(s.DB)
	syncSvc := service.NewSyncService(mediaRepo, mediaSyncRepo, storageProviderRepo, siteSettingRepoForSync, mediaSvc, s.Config.Sync)
	// 优先级: site_settings.storage.sync.auto_enabled > config.SyncConfig.AutoEnabled
	// admin 在 UI 上切换 site_settings 后(StorageProviderSettings 自动同步开关)立即启停
	syncSvc.AutoStartIfEnabled(context.Background())
	syncSvc.VerifyAutoStartIfEnabled(context.Background()) // Phase 5: 定期备份校验 worker
	syncHandler := handler.NewSyncHandler(syncSvc)

	mediaHandler := handler.NewMediaHandler(mediaSvc, activitySvc)
	mediaHandler.SetBackupScheduler(syncSvc)
	mediaHandler.Mount(admin.Group("/media"))
	handler.NewPublicMediaHandler(mediaSvc).Mount(public.Group("/media"))
	handler.NewUploadAccessHandler(mediaSvc, s.Config.Upload.Path).Mount(api.Group("/uploads"))
	syncHandler.MountMediaRoutes(admin.Group("/media")) // POST /admin/media/:id/sync
	handler.NewFolderHandler(folderSvc).Mount(admin.Group("/media/folders"))
	handler.NewStorageProviderHandler(storageProviderSvc).Mount(admin.Group("/storage/providers"))
	syncHandler.Mount(admin.Group("/storage/sync"))

	// 媒体高级功能：标签、权限、分享、版本管理
	mediaTagRepo := repository.NewMediaTagRepo(s.DB)
	handler.NewMediaTagHandler(service.NewMediaTagService(mediaTagRepo), mediaSvc).Mount(admin.Group("/media"))
	handler.NewPermissionHandler(service.NewPermissionService(permissionRepo), folderSvc).Mount(admin.Group("/media"))
	shareRepo := repository.NewShareRepo(s.DB)
	handler.NewShareHandler(service.NewShareService(shareRepo), mediaSvc).Mount(admin.Group("/media"))
	versionRepo := repository.NewVersionRepo(s.DB)
	versionSvc := service.NewVersionService(versionRepo, mediaRepo)
	handler.NewVersionHandler(versionSvc, mediaSvc).Mount(admin.Group("/media"))
	// 注入版本快照能力 — UploadContent 在覆盖文件前自动写一份历史版本
	mediaHandler.SetVersionDeps(versionSvc, mediaRepo)

	// --- 数据统计与分析 ---
	analyticsRepo := repository.NewAnalyticsRepo(s.DB)
	analyticsSvc := service.NewAnalyticsService(analyticsRepo)
	handler.NewStatsHandler(analyticsSvc).Mount(admin.Group("/stats"))
	handler.NewActivityHandler(activitySvc).Mount(admin.Group("/activities"))
	// SECURITY (VULN-036): /public/visit 每次调用都插入一行 visit_records；
	// 无限流情况下任意访客可以把 DB 灌满或伪造访问量。按 IP 每分钟 60 次。
	handler.NewVisitorHandler(analyticsSvc).Mount(
		public.Group("/visit", middleware.RateLimitByIP(s.Redis, "rate:visit", 60, time.Minute)),
	)

	// --- 数据迁移 ---
	// 新实现走 MigrationRepo 的批量读/写路径，避免旧 handler 的 N+1 查询。
	migrationRepo := repository.NewMigrationRepo(s.DB)
	migrationSvc := service.NewMigrationService(s.DB, migrationRepo)
	handler.NewMigrationHandler(migrationSvc).Mount(admin.Group("/migrations"))

	// --- AI 代理接口 ---
	aiHandler := handler.NewAiHandler(s.Config, activitySvc)
	aiHandler.Mount(admin.Group("/ai"))

	// --- Agent Workflow 编排接口 ---
	agentWorkflowRepo := repository.NewAgentWorkflowRepo(s.DB)
	agentWorkflowSvc := service.NewAgentWorkflowService(agentWorkflowRepo, service.NewAIClient(s.Config.AI), s.Config.AI.InternalServiceToken)
	agentWorkflowHandler := handler.NewAgentWorkflowHandler(agentWorkflowSvc)
	agentWorkflowHandler.MountAdmin(admin.Group("/agent-workflows"))
	agentWorkflowHandler.MountAdminCatalog(admin)

	// --- Agent 对话接口（任意已登录用户可访问，区别于 admin /ai 代理） ---
	// SECURITY: 这里只挂 authMW，不强制 RequireRole("admin")。理由是 /agent 工作台
	// 对所有注册用户开放，但下游 ai-service 仍走 internal-token 通道（在 handler 内
	// 注入 X-Internal-Service），以防止用户拿到的 JWT 直接打到 ai-service。
	//
	// 限流分两桶（PR #573 codex review 反馈）：
	//   · chat（30/min/user）—— POST /chat 是 LLM 真正费 token 的路径，紧。
	//   · picker（120/min/user）—— GET /models /articles /tags 只命中本地 DB，
	//     `@` picker 一边输入一边搜，给 4x 头部空间避免用户还没发消息就 429。
	agentHandler := handler.NewAgentHandler(s.Config, postRepo, tagRepo, activitySvc)
	agentGroup := api.Group("/v1/agent", authMW, pwdRotated)
	agentHandler.Mount(
		agentGroup,
		middleware.RateLimitByUser(s.Redis, "rate:agent:chat", 30, time.Minute),
		middleware.RateLimitByUser(s.Redis, "rate:agent:picker", 120, time.Minute),
	)
	agentWorkflowHandler.MountRuntime(agentGroup)

	// Provider 管理代理路由默认限制请求体为 10MB，避免异常大包占用后端资源。
	const providerProxyBodyLimit = "10M"
	aiHandler.MountProviders(admin.Group("/providers", echomiddleware.BodyLimit(providerProxyBodyLimit)))

	// --- 知识库（KB） ---
	// 端到端流程：
	//   1) Admin /v1/admin/kbs/* 维护 KB 元数据 / 成员 / profile / 文件上传 + 向量化触发
	//   2) Agent /v1/agent/knowledge-bases 给灵境 picker 提供"我可见的 KB"列表
	//   3) ai-service /api/v1/kb/* 执行文档解析、切片、embed、写入 kb_embeddings；
	//      并在 /api/v1/agent/chat 根据 kbIds 召回 chunk 注入到 LLM 上下文。
	kbRepo := repository.NewKBRepo(s.DB)
	kbProfileRepo := repository.NewKBProfileRepo(s.DB)
	kbMemberRepo := repository.NewKBMemberRepo(s.DB)
	kbFileRepo := repository.NewKBFileRepo(s.DB)
	kbIndexer := service.NewKBIndexerClient(s.Config.AI)
	kbSvc := service.NewKBService(s.DB, kbRepo, kbProfileRepo, kbMemberRepo, kbFileRepo,
		mediaSvc, folderSvc, kbIndexer, "")
	kbHandler := handler.NewKBHandler(kbSvc, activitySvc)
	// KB admin 组：所有写路径每用户 60/min（含上传 / 重建 / 创建 / 删除 / profile 切换 / 成员变更）。
	// 读路径走管理员桶不再额外限流（避免 UI 列表/详情高频拉取触发误伤）。
	kbWriteLimit := middleware.RateLimitByUser(s.Redis, "rate:kb:write", 60, time.Minute)
	kbGroup := admin.Group("/kbs", kbWriteLimit)
	kbHandler.Mount(kbGroup)
	handler.NewKBProfileHandler(kbHandler, kbSvc).Mount(kbGroup)
	handler.NewKBMemberHandler(kbHandler, kbSvc).Mount(kbGroup)
	// agent picker（独立挂载到 /v1/agent，复用 picker 桶）
	handler.NewKBAgentHandler(kbSvc).Mount(agentGroup,
		middleware.RateLimitByUser(s.Redis, "rate:agent:picker", 120, time.Minute))

	// --- 搜索管理 ---
	searchAdmin := admin.Group("/search")
	searchAdmin.GET("/config", searchHandler.GetConfig)
	searchAdmin.PATCH("/config", searchHandler.UpdateConfig)
	searchAdmin.GET("/diagnostics", searchHandler.Diagnostics)
	searchAdmin.GET("/stats", searchHandler.GetStats)
	searchAdmin.POST("/reindex", searchHandler.Reindex)
	searchAdmin.POST("/retry-failed", searchHandler.RetryFailed)
	searchAdmin.POST("/cancel", searchHandler.Cancel)
	searchAdmin.GET("/embedding-status", searchHandler.EmbeddingStatus)
	searchAdmin.GET("/posts", searchHandler.ListPostsEmbedding)
	searchAdmin.POST("/index-batch", searchHandler.IndexBatch)
	searchAdmin.GET("/last-batch", searchHandler.LastBatch)
	// Search profile 管理（list / create / activate / deprecate / delete + SSE reindex）
	// 通配代理至 ai-service profiles.py。SSE 流式端点（POST /{code}/reindex/stream）
	// 在 handler 内自动检测 path 后缀切到 DoStream + 行级转发。
	searchAdmin.Any("/profiles", searchHandler.ProxyProfiles)
	searchAdmin.Any("/profiles/*", searchHandler.ProxyProfiles)
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
