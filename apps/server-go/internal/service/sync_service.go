package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"
	"golang.org/x/sync/errgroup"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// SyncAutoEnabledKey 是 site_settings 中存"自动后台备份"开关的 key。
//   - 'true'  → AutoStartIfEnabled() 会自动启动 worker
//   - 'false' → 不自动启动,只响应手动 API 触发
//
// migration 000042 时种入默认值 'false'。
//
// SyncTargetProviderIDKey 单独存备份同步目标 provider ID,避免把"上传主存储"
// (default provider) 和"备份目标"绑死到同一个配置上。
const (
	SyncAutoEnabledKey      = "storage.sync.auto_enabled"
	SyncTargetProviderIDKey = "storage.sync.target_provider_id"
)

// SyncService 是 Phase 4 的同步备份 worker。
//
// 设计借鉴 SearchService.IndexBatchPosts:
//   - atomic.Bool running    标记 worker 是否在跑
//   - DB 状态机              media_sync_jobs.status 推动事件流
//   - errgroup.SetLimit      单批次并发上限
//   - time.Tick rate-limit   每秒处理上限
//
// 启动时 (Start) 立即把残留 RUNNING 行重置为 PENDING (防进程崩溃后幽灵任务),
// 然后按 PollIntervalSec 周期拣 PENDING 批次。Stop 调 cancel 让当前批次结束就退出。
type SyncService struct {
	mediaRepo    *repository.MediaRepo
	syncRepo     *repository.MediaSyncRepo
	providerRepo *repository.StorageProviderRepo
	settingRepo  *repository.SiteSettingRepo
	mediaSvc     *MediaService // 用 mediaSvc.resolveStore 复用 Storage 缓存
	cfg          config.SyncConfig

	running atomic.Bool
	cancel  context.CancelFunc

	// Phase 5: 独立的备份完整性 verify worker
	verifyRunning atomic.Bool
	verifyDesired atomic.Bool
	verifyCancel  atomic.Pointer[context.CancelFunc]
}

// NewSyncService 构造 SyncService。配套调用 Start() 启动 worker。
func NewSyncService(mediaRepo *repository.MediaRepo, syncRepo *repository.MediaSyncRepo, providerRepo *repository.StorageProviderRepo, settingRepo *repository.SiteSettingRepo, mediaSvc *MediaService, cfg config.SyncConfig) *SyncService {
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 3
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 50
	}
	if cfg.RatePerSecond <= 0 {
		cfg.RatePerSecond = 5
	}
	if cfg.MaxAttempt <= 0 {
		cfg.MaxAttempt = 3
	}
	if cfg.PollIntervalSec <= 0 {
		cfg.PollIntervalSec = 10
	}
	return &SyncService{
		mediaRepo:    mediaRepo,
		syncRepo:     syncRepo,
		providerRepo: providerRepo,
		settingRepo:  settingRepo,
		mediaSvc:     mediaSvc,
		cfg:          cfg,
	}
}

// AutoEnabled 报告是否启用自动后台备份。
// 优先级: site_settings 表 storage.sync.auto_enabled > config.SyncConfig.AutoEnabled。
//
// admin 通过 API 修改 site_settings 后,Start() 重新读到最新值;无需重启进程。
func (s *SyncService) AutoEnabled(ctx context.Context) bool {
	if s.settingRepo != nil {
		if row, err := s.settingRepo.FindByKey(ctx, SyncAutoEnabledKey); err == nil && row != nil && row.SettingValue != nil {
			return strings.EqualFold(*row.SettingValue, "true")
		}
	}
	return s.cfg.AutoEnabled
}

// AutoStartIfEnabled 当且仅当 AutoEnabled() 为 true 时启动 worker(idempotent)。
// 由 server.go 启动时调用 + admin API 切换 site_settings 后调用。
func (s *SyncService) AutoStartIfEnabled(ctx context.Context) {
	if s.AutoEnabled(ctx) {
		s.Start(ctx)
	}
}

// SetAutoEnabled 写入 site_settings 并按需启停 worker。
// enabled=true:写入 + 立即启;enabled=false:写入 + Stop()。
func (s *SyncService) SetAutoEnabled(ctx context.Context, enabled bool) error {
	if s.settingRepo == nil {
		return errors.New("site setting repo not configured")
	}
	val := "false"
	if enabled {
		val = "true"
	}
	if err := s.settingRepo.Upsert(ctx, SyncAutoEnabledKey, val); err != nil {
		return err
	}
	if enabled {
		s.Start(ctx)
	} else {
		s.Stop()
	}
	return nil
}

// TargetProviderID 返回当前配置的备份同步目标 provider ID。
//
// nil 表示尚未显式配置;后续入队会兼容旧逻辑,尝试使用非 LOCAL 的默认 provider。
func (s *SyncService) TargetProviderID(ctx context.Context) (*int64, error) {
	return s.configuredTargetProviderID(ctx)
}

// SetTargetProviderID 写入备份同步目标 provider ID。
func (s *SyncService) SetTargetProviderID(ctx context.Context, providerID *int64) error {
	if s.settingRepo == nil {
		return errors.New("site setting repo not configured")
	}

	value := ""
	if providerID != nil && *providerID > 0 {
		p, err := s.validateTargetProvider(ctx, *providerID)
		if err != nil {
			return err
		}
		value = strconv.FormatInt(p.ID, 10)
	}
	return s.settingRepo.Upsert(ctx, SyncTargetProviderIDKey, value)
}

// IsRunning 当前 worker 是否在执行。
func (s *SyncService) IsRunning() bool { return s.running.Load() }

// Start 启动后台 worker (idempotent: 多次调用只起一次)。
// 进程退出时调用 Stop() 主动停掉当前批次。
func (s *SyncService) Start(ctx context.Context) {
	if !s.running.CompareAndSwap(false, true) {
		return
	}
	// 重置残留 RUNNING (上次进程崩溃留下的幽灵任务)
	if n, err := s.syncRepo.ResetRunningOnStartup(ctx); err != nil {
		log.Warn().Err(err).Msg("sync worker: reset running failed")
	} else if n > 0 {
		log.Info().Int64("n", n).Msg("sync worker: reset stale RUNNING jobs to PENDING")
	}

	// 后台 worker 不能继承 HTTP request context;手动触发接口返回后 request context
	// 会被 Echo 取消,否则刚入队的任务会在首个 tick 前退出。
	workerCtx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go s.loop(workerCtx)
}

// Stop 通知 worker 优雅退出 — 当前批次跑完后停。
func (s *SyncService) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
}

// loop 是 worker 主循环。
func (s *SyncService) loop(ctx context.Context) {
	defer s.running.Store(false)

	tick := time.NewTicker(time.Duration(s.cfg.PollIntervalSec) * time.Second)
	defer tick.Stop()

	for {
		if err := s.processBatch(ctx); err != nil {
			log.Warn().Err(err).Msg("sync worker: batch failed")
		}

		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// processBatch 拣一批 PENDING job 并并发处理。
func (s *SyncService) processBatch(ctx context.Context) error {
	jobs, err := s.syncRepo.FindPendingBatch(ctx, s.cfg.BatchSize)
	if err != nil {
		return fmt.Errorf("find pending batch: %w", err)
	}
	if len(jobs) == 0 {
		return nil
	}

	// 限速: 每秒最多处理 RatePerSecond 个 job (token bucket 简化版)
	rateTick := time.NewTicker(time.Second / time.Duration(s.cfg.RatePerSecond))
	defer rateTick.Stop()

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(s.cfg.Concurrency)
	for _, j := range jobs {
		job := j
		select {
		case <-gctx.Done():
			return gctx.Err()
		case <-rateTick.C:
		}
		g.Go(func() error {
			s.processJob(gctx, &job)
			return nil // 单任务失败不传染整批
		})
	}
	return g.Wait()
}

// processJob 处理单个 job: 读源 → 写目标 → 标记成功/失败。
func (s *SyncService) processJob(ctx context.Context, job *model.MediaSyncJob) {
	media, err := s.mediaRepo.FindByID(ctx, job.MediaID)
	if err != nil {
		s.failJob(ctx, job, fmt.Sprintf("find media: %v", err))
		return
	}
	if media == nil {
		s.failJob(ctx, job, "media not found")
		return
	}
	if media.Deleted {
		s.failJob(ctx, job, "media is in trash")
		return
	}
	// 源 store: 主文件所在 provider
	srcStore, srcProvider, err := s.mediaSvc.resolveStoreForMedia(ctx, media)
	if err != nil {
		s.failJob(ctx, job, fmt.Sprintf("resolve source store: %v", err))
		return
	}
	// 目标 store: target_provider_id
	target := job.TargetProviderID
	dstStore, targetProvider, err := s.mediaSvc.resolveStore(ctx, &target)
	if err != nil {
		s.failJob(ctx, job, fmt.Sprintf("resolve target store: %v", err))
		return
	}
	if (srcProvider == nil && targetProvider != nil && strings.EqualFold(targetProvider.ProviderType, "LOCAL")) ||
		(srcProvider != nil && targetProvider != nil &&
			((srcProvider.ID == targetProvider.ID) ||
				(strings.EqualFold(srcProvider.ProviderType, "LOCAL") && strings.EqualFold(targetProvider.ProviderType, "LOCAL")))) {
		s.failJob(ctx, job, "该文件已经位于所选备份目标,无需同步")
		return
	}

	// 读源
	rc, size, mime, err := srcStore.Get(ctx, media.FilePath)
	if err != nil {
		s.failJob(ctx, job, fmt.Sprintf("get source object: %v", err))
		return
	}
	defer rc.Close()

	// 写目标 — 使用与主文件相同的 key 路径,方便排查
	if size <= 0 {
		size = media.FileSize
	}
	if mime == "" && media.MimeType != nil {
		mime = *media.MimeType
	}

	backupURL, err := dstStore.Upload(ctx, media.FilePath, io.LimitReader(rc, size), size, mime)
	if err != nil {
		s.failJob(ctx, job, fmt.Sprintf("upload to target: %v", err))
		return
	}

	if err := s.syncRepo.MarkJobSucceeded(ctx, job.ID, job.MediaID, job.TargetProviderID, backupURL); err != nil {
		log.Warn().Err(err).Int64("job_id", job.ID).Msg("sync worker: mark succeeded failed")
	}
}

// failJob 写失败状态;触发 attempt 自增,达上限后真正落 FAILED。
func (s *SyncService) failJob(ctx context.Context, job *model.MediaSyncJob, msg string) {
	if err := s.syncRepo.MarkJobFailed(ctx, job.ID, job.MediaID, msg, s.cfg.MaxAttempt); err != nil {
		log.Warn().Err(err).Int64("job_id", job.ID).Str("reason", msg).Msg("sync worker: mark failed write failed")
	}
}

// EnqueueAll 立即把所有未与目标 provider 同步的非删除文件入队 + 启动 worker。
//
// targetProviderID == nil 时优先使用已配置的备份目标;未配置则兼容旧逻辑使用非 LOCAL default provider。
func (s *SyncService) EnqueueAll(ctx context.Context, targetProviderID *int64) (int64, error) {
	target, err := s.resolveTargetProvider(ctx, targetProviderID)
	if err != nil {
		return 0, err
	}
	n, err := s.syncRepo.EnqueueAllUnsynced(ctx, target)
	if err != nil {
		return 0, err
	}
	s.Start(ctx)
	return n, nil
}

// EnqueueOne 单条入队 + 启动 worker。供前端"立即同步该文件"按钮使用。
func (s *SyncService) EnqueueOne(ctx context.Context, mediaID int64, targetProviderID *int64) error {
	target, err := s.resolveTargetProvider(ctx, targetProviderID)
	if err != nil {
		return err
	}
	media, err := s.mediaRepo.FindByID(ctx, mediaID)
	if err != nil {
		return fmt.Errorf("find media: %w", err)
	}
	if media == nil {
		return fmt.Errorf("media %d not found", mediaID)
	}
	if media.Deleted {
		return errors.New("media is in trash")
	}
	if media.StorageProviderID != nil && *media.StorageProviderID == target {
		return errors.New("该文件已经位于所选备份目标,无需同步")
	}
	if _, err := s.syncRepo.EnqueueOne(ctx, mediaID, target); err != nil {
		return err
	}
	// 主文件状态置 PENDING(给前端立即可见)
	if _, err := s.mediaRepo.SetSyncStatus(ctx, mediaID, "PENDING", ""); err != nil {
		log.Warn().Err(err).Int64("media_id", mediaID).Msg("update sync_status to PENDING failed")
	}
	s.Start(ctx)
	return nil
}

// Status 当前 worker 状态摘要。
type SyncStatusSnapshot struct {
	Running   bool                        `json:"running"`
	Counts    repository.SyncStatusCounts `json:"counts"`
	UpdatedAt time.Time                   `json:"updatedAt"`
}

// GetStatus 返回 worker 实时摘要。
func (s *SyncService) GetStatus(ctx context.Context) (*SyncStatusSnapshot, error) {
	c, err := s.syncRepo.CountByStatus(ctx)
	if err != nil {
		return nil, err
	}
	return &SyncStatusSnapshot{
		Running:   s.running.Load(),
		Counts:    *c,
		UpdatedAt: time.Now(),
	}, nil
}

// ListFailed 列出最近失败的 job 供前端"重试"列表使用。
func (s *SyncService) ListFailed(ctx context.Context, limit int) ([]model.MediaSyncJob, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.syncRepo.ListFailed(ctx, limit)
}

// RetryFailed 把指定 job 重新置 PENDING 并启动 worker。
func (s *SyncService) RetryFailed(ctx context.Context, jobIDs []int64) error {
	if err := s.syncRepo.RetryFailed(ctx, jobIDs); err != nil {
		return err
	}
	s.Start(ctx)
	return nil
}

// configuredTargetProviderID 从 site_settings 读取显式配置的备份目标 provider ID。
func (s *SyncService) configuredTargetProviderID(ctx context.Context) (*int64, error) {
	if s.settingRepo == nil {
		return nil, nil
	}
	row, err := s.settingRepo.FindByKey(ctx, SyncTargetProviderIDKey)
	if err != nil {
		return nil, err
	}
	if row == nil || row.SettingValue == nil {
		return nil, nil
	}
	raw := strings.TrimSpace(*row.SettingValue)
	if raw == "" || raw == "0" {
		return nil, nil
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return nil, fmt.Errorf("invalid backup target provider id %q", raw)
	}
	return &id, nil
}

func (s *SyncService) validateTargetProvider(ctx context.Context, providerID int64) (*model.StorageProvider, error) {
	p, err := s.providerRepo.FindByID(ctx, providerID)
	if err != nil {
		return nil, fmt.Errorf("find target provider: %w", err)
	}
	if p == nil {
		return nil, fmt.Errorf("target provider %d not found", providerID)
	}
	if !p.IsEnabled {
		return nil, fmt.Errorf("备份目标 provider %d 已禁用", providerID)
	}
	return p, nil
}

// resolveTargetProvider 把可空的 providerID 解析成具体备份目标。
func (s *SyncService) resolveTargetProvider(ctx context.Context, targetProviderID *int64) (int64, error) {
	if targetProviderID != nil && *targetProviderID > 0 {
		p, err := s.validateTargetProvider(ctx, *targetProviderID)
		if err != nil {
			return 0, err
		}
		return p.ID, nil
	}

	configured, err := s.configuredTargetProviderID(ctx)
	if err != nil {
		return 0, err
	}
	if configured != nil {
		p, err := s.validateTargetProvider(ctx, *configured)
		if err != nil {
			return 0, err
		}
		return p.ID, nil
	}

	def, err := s.providerRepo.FindDefault(ctx)
	if err != nil {
		return 0, fmt.Errorf("find default provider: %w", err)
	}
	if def == nil {
		return 0, fmt.Errorf("未配置备份目标 provider")
	}
	if def.ProviderType == "LOCAL" {
		return 0, fmt.Errorf("未配置备份目标 provider,请先在存储管理中选择备份目标")
	}
	return def.ID, nil
}

// 确保依赖类型可见(避免循环 import)
var _ storage.Storage = (*storage.LocalStorage)(nil)

// ============================================================================
// Phase 5: 删除云端备份 + 定期校验
// ============================================================================

// VerifyAutoEnabledKey / VerifyIntervalKey 是 site_settings 中存校验配置的 key。
//
//	storage.verify.auto_enabled       'true'/'false' 是否启用定期校验 worker
//	storage.verify.interval_seconds   '86400'        校验间隔秒 (默认一天)
//
// migration 000048 时种入默认值。
const (
	VerifyAutoEnabledKey        = "storage.verify.auto_enabled"
	VerifyIntervalKey           = "storage.verify.interval_seconds"
	defaultVerifyIntervalSec    = 86400 // 一天
	verifyBatchSize             = 50
	verifyWorkerPollIntervalSec = 60 // worker 拣表间隔(找 due 的记录)
)

// RemoveBackup 删除云端备份对象,但保留本地主文件。
//
// 流程 (顺序敏感):
//  1. 加载 media → 必须存在,sync_status 必须是 SYNCED 或 MISSING (允许从 MISSING 清掉残留 catalog 行)
//  2. 用 backup_provider_id 解析 storage,删 backup_url 对应 key
//     · 删除失败但是 NotFound 系错误 → 视作"云端已不在",当成清理 catalog 的副作用接受
//     · 网络/凭据等瞬时错误 → 返回错误,catalog 不动 (避免 catalog 漏指针 + 云端残留)
//  3. ClearBackup 清 sync_status=NONE + 全部 backup_*
//
// 不动 file_path / storage_provider_id / file_url —— 主文件保留。
func (s *SyncService) RemoveBackup(ctx context.Context, mediaID int64) error {
	media, err := s.mediaRepo.FindByID(ctx, mediaID)
	if err != nil {
		return fmt.Errorf("find media: %w", err)
	}
	if media == nil {
		return fmt.Errorf("media %d not found", mediaID)
	}
	if media.BackupProviderID == nil || media.BackupURL == nil || *media.BackupURL == "" {
		// 没有备份痕迹,直接清 catalog 即可(幂等)
		if _, err := s.mediaRepo.ClearBackup(ctx, mediaID); err != nil {
			return fmt.Errorf("clear backup row: %w", err)
		}
		return nil
	}
	// 用 backup_provider_id 解析对应 storage
	bp := *media.BackupProviderID
	store, _, err := s.mediaSvc.resolveStore(ctx, &bp)
	if err != nil {
		return fmt.Errorf("resolve backup store: %w", err)
	}
	backupKey, err := backupStorageKey(store, media.FilePath, media.BackupURL)
	if err != nil {
		return fmt.Errorf("resolve backup key: %w", err)
	}
	if backupTargetMatchesPrimary(media, backupKey) {
		return errors.New("backup target matches primary media object; refusing to remove backup")
	}
	if err := store.Delete(ctx, backupKey); err != nil {
		// 容忍 NotFound (云端已不存在视作删除成功)
		if !isNotFoundLike(err) {
			return fmt.Errorf("delete remote backup: %w", err)
		}
	}
	if _, err := s.mediaRepo.ClearBackup(ctx, mediaID); err != nil {
		return fmt.Errorf("clear backup row: %w", err)
	}
	return nil
}

// isNotFoundLike 粗暴判断 error 是否表示"对象不存在"。供 RemoveBackup 容忍幂等删除场景。
func isNotFoundLike(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") ||
		strings.Contains(msg, "nosuchkey") ||
		strings.Contains(msg, "no such file") ||
		(containsStandalone404(msg) && (strings.Contains(msg, "status") || strings.Contains(msg, "http") || strings.Contains(msg, "code")))
}

func containsStandalone404(msg string) bool {
	start := 0
	for {
		i := strings.Index(msg[start:], "404")
		if i < 0 {
			return false
		}
		i += start
		beforeOK := i == 0 || !isASCIIDigit(msg[i-1])
		after := i + len("404")
		afterOK := after >= len(msg) || !isASCIIDigit(msg[after])
		if beforeOK && afterOK {
			return true
		}
		start = after
	}
}

func isASCIIDigit(b byte) bool {
	return b >= '0' && b <= '9'
}

func backupTargetMatchesPrimary(media *model.MediaFile, backupKey string) bool {
	if media == nil || media.BackupProviderID == nil {
		return false
	}
	if media.StorageProviderID != nil && *media.BackupProviderID == *media.StorageProviderID && backupKey == media.FilePath {
		return true
	}
	backupURL := normalizeMediaURL(strDeref(media.BackupURL))
	if backupURL == "" {
		return false
	}
	if normalizeMediaURL(media.FileURL) == backupURL {
		return true
	}
	return media.CdnURL != nil && normalizeMediaURL(*media.CdnURL) == backupURL
}

func normalizeMediaURL(v string) string {
	return strings.TrimRight(strings.TrimSpace(v), "/")
}

func backupStorageKey(store storage.Storage, filePath string, backupURL *string) (string, error) {
	rawBackupURL := strings.TrimSpace(strDeref(backupURL))
	if rawBackupURL == "" {
		return filePath, nil
	}
	if resolver, ok := store.(storage.PublicURLKeyResolver); ok {
		key, err := resolver.KeyFromURL(rawBackupURL)
		if err != nil {
			return "", err
		}
		return key, nil
	}
	if normalizeMediaURL(store.GetURL(filePath)) == normalizeMediaURL(rawBackupURL) {
		return filePath, nil
	}
	return "", errors.New("backup_url does not match current file_path and storage backend cannot resolve it")
}

// VerifyAutoEnabled 报告是否启用定期备份校验。
func (s *SyncService) VerifyAutoEnabled(ctx context.Context) bool {
	if s.settingRepo == nil {
		return false
	}
	row, err := s.settingRepo.FindByKey(ctx, VerifyAutoEnabledKey)
	if err != nil || row == nil || row.SettingValue == nil {
		return false
	}
	return strings.EqualFold(*row.SettingValue, "true")
}

// VerifyIntervalSec 读取校验间隔(秒);异常或未配置时返回默认值。
func (s *SyncService) VerifyIntervalSec(ctx context.Context) int {
	if s.settingRepo == nil {
		return defaultVerifyIntervalSec
	}
	row, err := s.settingRepo.FindByKey(ctx, VerifyIntervalKey)
	if err != nil || row == nil || row.SettingValue == nil {
		return defaultVerifyIntervalSec
	}
	var n int
	if _, err := fmt.Sscanf(*row.SettingValue, "%d", &n); err != nil || n < 60 {
		return defaultVerifyIntervalSec
	}
	return n
}

// SetVerifyAutoEnabled 写入 site_settings + 立即启停 verify worker。
func (s *SyncService) SetVerifyAutoEnabled(ctx context.Context, enabled bool) error {
	if s.settingRepo == nil {
		return errors.New("site setting repo not configured")
	}
	val := "false"
	if enabled {
		val = "true"
	}
	if err := s.settingRepo.Upsert(ctx, VerifyAutoEnabledKey, val); err != nil {
		return err
	}
	if enabled {
		s.StartVerifyWorker(ctx)
	} else {
		s.StopVerifyWorker()
	}
	return nil
}

// StartVerifyWorker 启动后台 verify worker (idempotent)。
func (s *SyncService) StartVerifyWorker(ctx context.Context) {
	s.verifyDesired.Store(true)
	if s.verifyRunning.CompareAndSwap(false, true) {
		workerCtx, cancel := context.WithCancel(context.Background())
		s.verifyCancel.Store(&cancel)
		go s.verifyLoop(workerCtx)
	}
}

// StopVerifyWorker 通知 verify worker 退出。
func (s *SyncService) StopVerifyWorker() {
	s.verifyDesired.Store(false)
	if cancel := s.verifyCancel.Load(); cancel != nil {
		(*cancel)()
	}
}

// VerifyAutoStartIfEnabled 在 server 启动时被调用 —— 只有用户开了开关才启动 worker。
func (s *SyncService) VerifyAutoStartIfEnabled(ctx context.Context) {
	if s.VerifyAutoEnabled(ctx) {
		s.StartVerifyWorker(ctx)
	}
}

// verifyLoop 校验 worker 主循环。
func (s *SyncService) verifyLoop(ctx context.Context) {
	defer func() {
		if s.finishVerifyLoop() {
			s.StartVerifyWorker(context.Background())
		}
	}()
	tick := time.NewTicker(time.Duration(verifyWorkerPollIntervalSec) * time.Second)
	defer tick.Stop()

	for {
		// 立即跑一次,然后才睡
		for {
			processed, err := s.VerifyOverdue(ctx, verifyBatchSize)
			if err != nil {
				log.Warn().Err(err).Int("checked", processed).Msg("verify worker: batch failed")
				break
			}
			if processed > 0 {
				log.Info().Int("checked", processed).Msg("verify worker: batch done")
			}
			if processed < verifyBatchSize {
				break
			}
			select {
			case <-ctx.Done():
				return
			default:
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (s *SyncService) finishVerifyLoop() bool {
	s.verifyRunning.Store(false)
	return s.verifyDesired.Load()
}

// VerifyOverdue 拣一批"到期需要校验"的 SYNCED 记录,逐条 HEAD 检查云端是否还在。
// 返回本次实际处理数量。
//
// 调度策略:
//
//	staleBefore = NOW() - VerifyIntervalSec(从 settings 取)
//	仅检查 last_verified_at IS NULL 或更早的记录
func (s *SyncService) VerifyOverdue(ctx context.Context, limit int) (int, error) {
	intervalSec := s.VerifyIntervalSec(ctx)
	staleBefore := time.Now().Add(-time.Duration(intervalSec) * time.Second)
	targets, err := s.mediaRepo.FindBackedUpForVerification(ctx, staleBefore, limit)
	if err != nil {
		return 0, fmt.Errorf("find verify targets: %w", err)
	}
	if len(targets) == 0 {
		return 0, nil
	}

	processed := 0
	var firstErr error
	for _, t := range targets {
		select {
		case <-ctx.Done():
			return processed, ctx.Err()
		default:
		}
		if err := s.verifyOne(ctx, &t, true); err != nil {
			log.Warn().Err(err).Int64("media_id", t.ID).Msg("verify: target failed")
			if firstErr == nil {
				firstErr = err
			}
		}
		processed++
	}
	return processed, firstErr
}

// VerifyOne 校验单条记录(供 admin 手动触发)。
// 不要求 sync_status=SYNCED;允许校验任意有 backup_provider_id 的行。
func (s *SyncService) VerifyOne(ctx context.Context, mediaID int64) error {
	media, err := s.mediaRepo.FindByID(ctx, mediaID)
	if err != nil {
		return fmt.Errorf("find media: %w", err)
	}
	if media == nil {
		return fmt.Errorf("media %d not found", mediaID)
	}
	if media.BackupProviderID == nil || media.BackupURL == nil {
		return errors.New("media has no backup to verify")
	}
	t := repository.BackupVerifyTarget{
		ID:               media.ID,
		FilePath:         media.FilePath,
		BackupProviderID: media.BackupProviderID,
		BackupURL:        media.BackupURL,
	}
	return s.verifyOne(ctx, &t, false)
}

// verifyOne 内部:对单个目标做 HEAD 检查 + 写状态。
func (s *SyncService) verifyOne(ctx context.Context, t *repository.BackupVerifyTarget, markUnsupportedVerified bool) error {
	if t.BackupProviderID == nil {
		return errors.New("media has no backup provider")
	}
	store, _, err := s.mediaSvc.resolveStore(ctx, t.BackupProviderID)
	if err != nil {
		return fmt.Errorf("resolve backup store: %w", err)
	}
	existser, ok := store.(storage.Existser)
	if !ok {
		// provider 不支持 Exists。后台 worker 标记为已校验,避免同一批记录反复被拣起;
		// 手动校验则返回明确错误,让 admin 知道这次没有真实 HEAD 检查。
		log.Debug().Int64("media_id", t.ID).Msg("verify: storage backend has no Existser, skipping")
		if markUnsupportedVerified {
			if err := s.mediaRepo.MarkBackupVerified(ctx, t.ID, time.Now()); err != nil {
				return fmt.Errorf("mark unsupported backend verified: %w", err)
			}
			return nil
		}
		return errors.New("storage backend does not support backup existence checks")
	}
	backupKey, err := backupStorageKey(store, t.FilePath, t.BackupURL)
	if err != nil {
		return fmt.Errorf("resolve backup key: %w", err)
	}
	exists, err := existser.Exists(ctx, backupKey)
	if err != nil {
		// 瞬时错误 —— 不改状态,等下轮再试
		return fmt.Errorf("check backup existence: %w", err)
	}
	now := time.Now()
	if exists {
		if err := s.restoreBackupVerified(ctx, t.ID, now); err != nil {
			return fmt.Errorf("mark backup verified: %w", err)
		}
		return nil
	}
	if err := s.mediaRepo.MarkBackupMissing(ctx, t.ID, now, "REMOTE_GONE: object not found at backup_url"); err != nil {
		return fmt.Errorf("mark backup missing: %w", err)
	}
	log.Info().Int64("media_id", t.ID).Str("backup_url", strDeref(t.BackupURL)).Msg("verify: marked MISSING (object gone)")
	return nil
}

func (s *SyncService) restoreBackupVerified(ctx context.Context, mediaID int64, at time.Time) error {
	return s.mediaRepo.MarkBackupVerified(ctx, mediaID, at)
}

// IsVerifyRunning 当前 verify worker 是否在执行(供 admin 状态摘要)。
func (s *SyncService) IsVerifyRunning() bool { return s.verifyRunning.Load() }

// strDeref 安全解引 *string,nil 返回空串 (供日志用)。
func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
