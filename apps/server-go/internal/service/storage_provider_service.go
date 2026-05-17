package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// StorageProviderInvalidator 在 provider 配置变化时清掉对应的 storage client 缓存。
// 由 MediaService 实现。允许这里以接口形式持有,避免循环依赖。
type StorageProviderInvalidator interface {
	InvalidateProvider(providerID int64)
}

// StorageProviderService 管理可配置的存储后端（本地、S3、OSS 等）。
type StorageProviderService struct {
	repo        *repository.StorageProviderRepo
	invalidator StorageProviderInvalidator // 可选;Update/Delete/SetDefault 后清缓存
}

// NewStorageProviderService 创建一个由给定仓储支持的 StorageProviderService 实例。
// invalidator 可为 nil(测试 fixture);生产路径必须传 MediaService。
func NewStorageProviderService(repo *repository.StorageProviderRepo, invalidator StorageProviderInvalidator) *StorageProviderService {
	return &StorageProviderService{repo: repo, invalidator: invalidator}
}

// List 返回所有已注册的存储提供商，按优先级升序排列。
func (s *StorageProviderService) List(ctx context.Context) ([]dto.StorageProviderVO, error) {
	ps, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return toProviderVOs(ps), nil
}

// GetByID 按主键返回存储提供商，不存在时返回 nil。
func (s *StorageProviderService) GetByID(ctx context.Context, id int64) (*dto.StorageProviderVO, error) {
	p, err := s.repo.FindByID(ctx, id)
	if err != nil || p == nil {
		return nil, err
	}
	vo := toProviderVO(*p)
	return &vo, nil
}

// GetDefault 返回当前被标记为默认且已启用的存储提供商，不存在时返回 nil。
func (s *StorageProviderService) GetDefault(ctx context.Context) (*dto.StorageProviderVO, error) {
	p, err := s.repo.FindDefault(ctx)
	if err != nil || p == nil {
		return nil, err
	}
	vo := toProviderVO(*p)
	return &vo, nil
}

// Create 注册一个新的存储提供商。
func (s *StorageProviderService) Create(ctx context.Context, req dto.StorageProviderRequest) (*dto.StorageProviderVO, error) {
	p, err := s.repo.Create(ctx, repository.StorageProviderRequest{
		Name:         req.Name,
		ProviderType: req.ProviderType,
		ConfigJSON:   req.ConfigJSON,
		IsEnabled:    req.IsEnabled,
		Priority:     req.Priority,
	})
	if err != nil {
		return nil, err
	}
	vo := toProviderVO(*p)
	return &vo, nil
}

// Update 修改已有存储提供商的配置信息。
//
// Phase 2 增强:对 secret 字段做"merge 旧值"——若前端提交的 configJson 中 secret/access key
// 等敏感字段已经是脱敏占位符(`a****b1234`)或为空,则保留 DB 中的旧值(防止保存表单时
// 不慎覆盖密钥)。客户端要更新密钥必须填新明文。
func (s *StorageProviderService) Update(ctx context.Context, id int64, req dto.StorageProviderRequest) error {
	merged := req.ConfigJSON
	if old, _ := s.repo.FindByID(ctx, id); old != nil {
		if m, mergeErr := mergeProviderConfigJSON(old.ConfigJSON, req.ConfigJSON); mergeErr == nil {
			merged = m
		}
	}
	if err := s.repo.Update(ctx, id, repository.StorageProviderRequest{
		Name:         req.Name,
		ProviderType: req.ProviderType,
		ConfigJSON:   merged,
		IsEnabled:    req.IsEnabled,
		Priority:     req.Priority,
	}); err != nil {
		return err
	}
	if s.invalidator != nil {
		s.invalidator.InvalidateProvider(id)
	}
	return nil
}

// Delete 永久删除指定存储提供商。
func (s *StorageProviderService) Delete(ctx context.Context, id int64) error {
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	if s.invalidator != nil {
		s.invalidator.InvalidateProvider(id)
	}
	return nil
}

// Export 把所有 storage_providers 以**明文** configJson 形式导出,供运维迁移到新实例。
//
// 安全提示:返回内容包含 accessKey/secretKey 等敏感字段的明文,前端 UI 在触发前必须给出
// 醒目警告;调用方有责任妥善保管下载文件。后端不做额外加密(目标场景就是跨实例迁移,
// 二次加密反而增加恢复成本)。
func (s *StorageProviderService) Export(ctx context.Context) (*dto.StorageProviderExportPayload, error) {
	ps, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]dto.StorageProviderExportItem, 0, len(ps))
	for _, p := range ps {
		items = append(items, dto.StorageProviderExportItem{
			Name:         p.Name,
			ProviderType: p.ProviderType,
			ConfigJSON:   p.ConfigJSON, // FindAll 已经解密成明文
			IsDefault:    p.IsDefault,
			IsEnabled:    p.IsEnabled,
			Priority:     p.Priority,
		})
	}
	return &dto.StorageProviderExportPayload{
		Version:    1,
		ExportedAt: time.Now().UTC(),
		Providers:  items,
	}, nil
}

// Import 把导出文件批量导入。同名 provider 自动跳过,保护已有配置不被覆盖。
//
// 默认 provider 处理:DB invariant 是「同时只能有 1 条 is_default=true」,所以
// 导入前先扫一遍 payload — 若有 ≥2 条 IsDefault=true 直接 fail-fast 拒绝整次导入,
// 避免静默忽略后续 default 标记导致用户期望落空。
//
// 导入完成后,如果有恰好 1 条 IsDefault=true 且该条实际被新建(没被 skip),则调用
// SetDefault 切换成它;否则保留当前默认 provider 不动。
func (s *StorageProviderService) Import(ctx context.Context, payload dto.StorageProviderExportPayload) (*dto.StorageProviderImportResult, error) {
	if payload.Version != 1 {
		return nil, fmt.Errorf("unsupported export version %d (expected 1)", payload.Version)
	}
	if len(payload.Providers) == 0 {
		return &dto.StorageProviderImportResult{}, nil
	}

	// 预扫描:多于 1 个 IsDefault=true 直接拒绝(DB invariant 同时只能 1 条 default)
	defaultCount := 0
	for _, item := range payload.Providers {
		if item.IsDefault {
			defaultCount++
		}
	}
	if defaultCount > 1 {
		return nil, fmt.Errorf("payload contains %d providers marked isDefault=true; expected at most 1", defaultCount)
	}

	existing, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	existingNames := make(map[string]struct{}, len(existing))
	for _, p := range existing {
		existingNames[p.Name] = struct{}{}
	}

	result := &dto.StorageProviderImportResult{}
	var defaultCandidateID *int64
	var defaultCandidateName string

	for i, item := range payload.Providers {
		// 失败标签:有 name 用 name,否则用 (unnamed #i) 让 UI 能定位到第几条
		label := item.Name
		if label == "" {
			label = fmt.Sprintf("(unnamed #%d)", i)
		}
		if !dto.IsValidStorageProviderType(item.ProviderType) {
			result.FailedNames = append(result.FailedNames, label)
			continue
		}
		if item.Name == "" || item.ConfigJSON == "" {
			result.FailedNames = append(result.FailedNames, label)
			continue
		}
		if _, dup := existingNames[item.Name]; dup {
			result.SkippedNames = append(result.SkippedNames, item.Name)
			continue
		}
		// 校验 configJson 至少是合法 JSON,避免坏数据落库
		var probe map[string]any
		if err := json.Unmarshal([]byte(item.ConfigJSON), &probe); err != nil {
			result.FailedNames = append(result.FailedNames, label)
			continue
		}
		created, err := s.repo.Create(ctx, repository.StorageProviderRequest{
			Name:         item.Name,
			ProviderType: item.ProviderType,
			ConfigJSON:   item.ConfigJSON,
			IsEnabled:    item.IsEnabled,
			Priority:     item.Priority,
		})
		if err != nil {
			result.FailedNames = append(result.FailedNames, label)
			continue
		}
		existingNames[item.Name] = struct{}{}
		result.Imported++
		if item.IsDefault && defaultCandidateID == nil {
			id := created.ID
			defaultCandidateID = &id
			defaultCandidateName = created.Name
		}
	}

	if defaultCandidateID != nil {
		if err := s.repo.SetDefault(ctx, *defaultCandidateID); err == nil {
			result.DefaultSet = defaultCandidateName
			if s.invalidator != nil {
				s.invalidator.InvalidateProvider(*defaultCandidateID)
			}
		}
	}
	return result, nil
}

// SetDefault 将指定提供商标记为默认存储，并同时清除其他提供商的默认标记。
func (s *StorageProviderService) SetDefault(ctx context.Context, id int64) error {
	if err := s.repo.SetDefault(ctx, id); err != nil {
		return err
	}
	if s.invalidator != nil {
		// 设置 default 影响下次 resolveStore(nil) 的结果,清掉所有缓存最稳妥
		s.invalidator.InvalidateProvider(id)
	}
	return nil
}

// ListObjectsResult 是 ListObjects 的返回值,带 nextToken 分页 + 每条 key 是否在 catalog。
// @ref 对象存储 rollout - Phase 5
type ListObjectsResult struct {
	Objects   []ObjectListing `json:"objects"`
	NextToken string          `json:"nextToken,omitempty"`
}

// ObjectListing 是 ListObjects 单条记录的视图。
type ObjectListing struct {
	Key          string `json:"key"`
	URL          string `json:"url,omitempty"`
	Size         int64  `json:"size"`
	LastModified string `json:"lastModified,omitempty"`
	ETag         string `json:"etag,omitempty"`
	// MediaFileID 非 nil 表示该 key 已在 media_files catalog 中,nil 表示孤儿。
	MediaFileID *int64 `json:"mediaFileId,omitempty"`
	Status      string `json:"status"` // IN_CATALOG / ORPHAN
}

// ListObjects 列出指定 provider 上 prefix 下的对象,带 catalog 状态。
//
// 实现细节: 先调 Storage.List 拿 keys,再用一次 SQL 查 media_files 反查 key→media_id 映射,
// 标记每条 key 是 IN_CATALOG 还是 ORPHAN。
func (s *StorageProviderService) ListObjects(ctx context.Context, providerID int64, prefix, token string, limit int) (*ListObjectsResult, error) {
	p, err := s.repo.FindByID(ctx, providerID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, fmt.Errorf("provider %d not found", providerID)
	}
	st, err := s.openStorage(p)
	if err != nil {
		return nil, err
	}
	lister, ok := st.(storage.Lister)
	if !ok {
		return nil, fmt.Errorf("provider %s does not support listing", p.ProviderType)
	}
	objs, nextTok, err := listVisibleObjects(ctx, lister, prefix, token, limit)
	if err != nil {
		return nil, err
	}
	if len(objs) == 0 {
		return &ListObjectsResult{Objects: nil, NextToken: nextTok}, nil
	}

	keys := make([]string, len(objs))
	for i, o := range objs {
		keys[i] = o.Key
	}
	catalogMap, err := s.lookupCatalog(ctx, providerID, keys, st)
	if err != nil {
		return nil, err
	}

	listings := make([]ObjectListing, len(objs))
	for i, o := range objs {
		l := ObjectListing{
			Key:          o.Key,
			URL:          st.GetURL(o.Key),
			Size:         o.Size,
			LastModified: o.LastModified,
			ETag:         o.ETag,
			Status:       "ORPHAN",
		}
		if mid, ok := catalogMap[o.Key]; ok {
			midCopy := mid
			l.MediaFileID = &midCopy
			l.Status = "IN_CATALOG"
		}
		listings[i] = l
	}
	return &ListObjectsResult{Objects: listings, NextToken: nextTok}, nil
}

const maxVisibleObjectListFetches = 8

func listVisibleObjects(ctx context.Context, lister storage.Lister, prefix, token string, limit int) ([]storage.ObjectInfo, string, error) {
	if limit <= 0 {
		objs, nextTok, err := lister.List(ctx, prefix, token, limit)
		if err != nil {
			return nil, "", err
		}
		return filterListableObjects(objs), nextTok, nil
	}

	objects := make([]storage.ObjectInfo, 0, limit)
	fetchToken := token
	for attempts := 0; len(objects) < limit && attempts < maxVisibleObjectListFetches; attempts++ {
		remaining := limit - len(objects)
		page, nextTok, err := lister.List(ctx, prefix, fetchToken, remaining)
		if err != nil {
			return nil, "", err
		}
		objects = append(objects, filterListableObjects(page)...)
		if nextTok == "" {
			return objects, "", nil
		}
		if nextTok == fetchToken {
			return objects, nextTok, nil
		}
		fetchToken = nextTok
	}
	return objects, fetchToken, nil
}

// ImportObjects 把指定 keys 反向导入到 media_files catalog。
//
// 对每个 key:
//  1. 在云端 Head 一次确认存在 + 取大小/MIME。
//  2. 写入 media_files (file_path=key, file_url=key, cdn_url=GetURL(key))。
//  3. 跳过已在 catalog 的 key (避免重复)。
//
// 返回 (importedCount, skippedKeys, err)。
func (s *StorageProviderService) ImportObjects(ctx context.Context, providerID int64, keys []string, uploaderID *int64) (int, []string, error) {
	if len(keys) == 0 {
		return 0, nil, nil
	}
	p, err := s.repo.FindByID(ctx, providerID)
	if err != nil {
		return 0, nil, err
	}
	if p == nil {
		return 0, nil, fmt.Errorf("provider %d not found", providerID)
	}
	st, err := s.openStorage(p)
	if err != nil {
		return 0, nil, err
	}

	// 已在 catalog 的 key 全部跳过(避免重复行)
	existing, err := s.lookupCatalog(ctx, providerID, keys, st)
	if err != nil {
		return 0, nil, err
	}

	skipped := make([]string, 0)
	imported := 0
	for _, key := range keys {
		if _, ok := existing[key]; ok {
			skipped = append(skipped, key)
			continue
		}
		size, mime, exists, herr := s.headObject(ctx, st, key)
		if herr != nil || !exists {
			skipped = append(skipped, key)
			continue
		}
		filename := filepathBase(key)
		filetype := s.classifyFromMime(mime)
		cdn := st.GetURL(key)
		// 直接 INSERT,不走 mediaSvc(避免触发它的 Upload 路径)
		if err := s.insertImportedMedia(ctx, providerID, p.ProviderType, mime, filetype, filename, key, cdn, size, uploaderID); err != nil {
			skipped = append(skipped, key)
			continue
		}
		imported++
	}
	return imported, skipped, nil
}

// DeleteObjects 删除指定 keys 在 provider 上的对象。
//
// 安全约束:在 catalog 中存在的 key 拒绝删除(必须走 media 删除路径,避免破坏一致性)。
// 返回 (deletedCount, refusedKeys, err)。
func (s *StorageProviderService) DeleteObjects(ctx context.Context, providerID int64, keys []string) (int, []string, error) {
	if len(keys) == 0 {
		return 0, nil, nil
	}
	p, err := s.repo.FindByID(ctx, providerID)
	if err != nil {
		return 0, nil, err
	}
	if p == nil {
		return 0, nil, fmt.Errorf("provider %d not found", providerID)
	}
	st, err := s.openStorage(p)
	if err != nil {
		return 0, nil, err
	}

	existing, err := s.lookupCatalog(ctx, providerID, keys, st)
	if err != nil {
		return 0, nil, err
	}

	refused := make([]string, 0)
	deleted := 0
	for _, key := range keys {
		if _, ok := existing[key]; ok {
			refused = append(refused, key)
			continue
		}
		if err := st.Delete(ctx, key); err != nil {
			refused = append(refused, key)
			continue
		}
		deleted++
	}
	return deleted, refused, nil
}

// openStorage 把 provider 转成 Storage 实例(LOCAL 走 storage.NewLocalStorage,其他走 factory)。
//
// 注意: 这里没用 mediaSvc 的缓存 — 因为 storage_provider_service 不持有 mediaSvc,
// Phase 5 调用频率低(管理员主动操作),每次新建可接受。
func (s *StorageProviderService) openStorage(p *model.StorageProvider) (storage.Storage, error) {
	if p.ProviderType == "LOCAL" {
		// LOCAL provider 的 config 字段(basePath/urlPrefix)从 configJson 解析
		var cfg struct {
			BasePath  string `json:"basePath"`
			URLPrefix string `json:"urlPrefix"`
		}
		if err := json.Unmarshal([]byte(p.ConfigJSON), &cfg); err != nil {
			return nil, fmt.Errorf("parse local config: %w", err)
		}
		if cfg.BasePath == "" {
			cfg.BasePath = "./uploads"
		}
		if cfg.URLPrefix == "" {
			cfg.URLPrefix = "/api/uploads"
		}
		return storage.NewLocalStorage(cfg.BasePath, cfg.URLPrefix), nil
	}
	return storage.NewFromConfig(p.ProviderType, p.ConfigJSON)
}

// lookupCatalog 反查 keys 在 media_files catalog 中的 ID 映射。
// 同时覆盖两种关系:
//  1. 主文件直接存储在该 provider: storage_provider_id + file_path
//  2. LOCAL 主文件已备份到该 provider: backup_provider_id + backup_url
func (s *StorageProviderService) lookupCatalog(ctx context.Context, providerID int64, keys []string, st storage.Storage) (map[string]int64, error) {
	if len(keys) == 0 {
		return map[string]int64{}, nil
	}
	rows, err := s.repo.LookupCatalogByKeys(ctx, providerID, keys)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return rows, nil
	}

	keyByBackupURL := make(map[string]string, len(keys))
	backupURLs := make([]string, 0, len(keys))
	for _, key := range keys {
		for _, backupURL := range publicURLCandidates(st, key) {
			if _, exists := keyByBackupURL[backupURL]; exists {
				continue
			}
			keyByBackupURL[backupURL] = key
			backupURLs = append(backupURLs, backupURL)
		}
	}
	backupRows, err := s.repo.LookupBackupCatalogByURLs(ctx, providerID, backupURLs)
	if err != nil {
		return nil, err
	}
	for backupURL, mediaID := range backupRows {
		key, ok := keyByBackupURL[backupURL]
		if !ok {
			continue
		}
		if _, alreadyMapped := rows[key]; alreadyMapped {
			continue
		}
		rows[key] = mediaID
	}
	return rows, nil
}

func publicURLCandidates(st storage.Storage, key string) []string {
	if candidateProvider, ok := st.(storage.PublicURLCandidateProvider); ok {
		return candidateProvider.PublicURLCandidates(key)
	}
	publicURL := strings.TrimSpace(st.GetURL(key))
	if publicURL == "" {
		return nil
	}
	return []string{publicURL}
}

func filterListableObjects(objects []storage.ObjectInfo) []storage.ObjectInfo {
	if len(objects) == 0 {
		return objects
	}
	filtered := objects[:0]
	for _, obj := range objects {
		if isDirectoryMarkerObject(obj) {
			continue
		}
		filtered = append(filtered, obj)
	}
	return filtered
}

func isDirectoryMarkerObject(obj storage.ObjectInfo) bool {
	key := strings.TrimSpace(obj.Key)
	if key == "" || key == "/" {
		return true
	}
	return obj.Size == 0 && strings.HasSuffix(key, "/")
}

// headObject 调 Storage 的 HeadObject (S3 实现) 或 LOCAL 兜底(用 Get 判存)
// 返回 size + mime + exists。
func (s *StorageProviderService) headObject(ctx context.Context, st storage.Storage, key string) (int64, string, bool, error) {
	type headable interface {
		HeadObject(ctx context.Context, key string) (int64, string, bool, error)
	}
	if h, ok := st.(headable); ok {
		return h.HeadObject(ctx, key)
	}
	// LOCAL 兜底: Get 一次就知道存不存在(Get 失败视为不存在)
	rc, size, mime, err := st.Get(ctx, key)
	if err != nil {
		return 0, "", false, nil
	}
	rc.Close()
	return size, mime, true, nil
}

// insertImportedMedia 把云端发现的孤儿对象写入 media_files。
func (s *StorageProviderService) insertImportedMedia(ctx context.Context, providerID int64, providerType, mime, filetype, filename, key, cdn string, size int64, uploaderID *int64) error {
	return s.repo.InsertImportedMedia(ctx, repository.ImportedMediaRow{
		Filename:          filename,
		OriginalName:      filename,
		FilePath:          key,
		FileURL:           key,
		FileSize:          size,
		MimeType:          mime,
		FileType:          filetype,
		StorageType:       providerType,
		StorageProviderID: providerID,
		CdnURL:            cdn,
		UploaderID:        uploaderID,
	})
}

// classifyFromMime 把 MIME 大类映射到 media_files.file_type。
func (s *StorageProviderService) classifyFromMime(mime string) string {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return "IMAGE"
	case strings.HasPrefix(mime, "video/"):
		return "VIDEO"
	case strings.HasPrefix(mime, "audio/"):
		return "AUDIO"
	case mime == "application/pdf" || strings.Contains(mime, "word") || strings.Contains(mime, "document"):
		return "DOCUMENT"
	default:
		return "OTHER"
	}
}

// filepathBase 简化版 filepath.Base — 取最后一个 "/" 后的部分。
// 不用 path/filepath 因为 import 链已挺长,自写更清晰。
func filepathBase(key string) string {
	idx := -1
	for i := len(key) - 1; i >= 0; i-- {
		if key[i] == '/' {
			idx = i
			break
		}
	}
	if idx < 0 {
		return key
	}
	return key[idx+1:]
}

// Test 验证存储提供商的连通性。
// 本地存储（LOCAL）直接返回成功；S3 兼容存储通过 HeadBucket 验证；
// 其他类型在配置可解析时视为有效。
// 错误场景：提供商不存在、配置解析失败、网络连接失败。
func (s *StorageProviderService) Test(ctx context.Context, id int64) (bool, string) {
	p, err := s.repo.FindByID(ctx, id)
	if err != nil || p == nil {
		return false, "提供商不存在"
	}
	// 本地存储无需网络验证，直接返回成功
	if p.ProviderType == "LOCAL" {
		return true, "本地存储连接正常"
	}
	// 尝试解析配置并创建存储实例以验证连通性
	store, err := storage.NewFromConfig(p.ProviderType, p.ConfigJSON)
	if err != nil {
		return false, "配置解析失败: " + err.Error()
	}
	// S3 兼容存储：通过 HeadBucket 验证连接
	if s3Store, ok := store.(*storage.S3Storage); ok {
		if err := s3Store.TestConnection(ctx); err != nil {
			return false, "连接失败: " + err.Error()
		}
		return true, "S3 存储连接正常"
	}
	return true, "存储配置有效"
}

// --- 内部辅助函数 ---

// redactProviderConfigJSON 把 S3/MinIO/COS/OSS 等配置里的密钥字段脱敏后再回显。
// SECURITY (VULN-031): 不脱敏的话任意合法 admin JWT 都能通过列表/默认接口拉出
// 整个密钥库（accessKeyId + secretAccessKey + token）的明文。保留前后 4 位
// 给运维肉眼核对，真正的密文不回显到前端。
func redactProviderConfigJSON(raw string) string {
	if raw == "" {
		return raw
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return "{}"
	}
	for _, k := range secretKeyFields {
		v, ok := payload[k].(string)
		if !ok || v == "" {
			continue
		}
		if len(v) <= 8 {
			payload[k] = "****"
		} else {
			payload[k] = v[:2] + "****" + v[len(v)-4:]
		}
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(out)
}

// secretKeyFields 是 provider config JSON 中的敏感字段名集合。
// redactProviderConfigJSON 与 mergeProviderConfigJSON 共用同一份列表。
var secretKeyFields = []string{
	"accessKeyId", "secretAccessKey", "accessKey", "secretKey",
	"password", "token", "apiKey", "api_key", "secret",
}

// mergeProviderConfigJSON 把前端提交的新 configJson 深合并到旧 configJson 上。
//
// 合并规则(自上而下):
//  1. 旧 payload 里存在但新 payload 里不存在的字段 → 保留旧值(深合并核心:前端 partial PUT
//     不应该让 region/endpoint/options 等没改的字段悄悄消失)。
//  2. nested object(如 options:{...})递归一层做同样的合并 —— 双方都是 map[string]any 时
//     按字段合并;否则新值整体覆盖旧值。
//  3. secret 字段(accessKeyId/secretAccessKey/...): 新值缺失 / 空字符串 / 形如 "ab****12cd"
//     的脱敏占位 → 回退旧值(redactProviderConfigJSON 会脱敏返回给前端,所以前端再次提交时
//     看到的就是 "****",必须有这条规则保护原始密钥不被覆盖)。
//  4. 显式 null:被 json.Unmarshal 解析为 nil interface,会进入"缺失"分支被旧值覆盖。
//     若想清空字段必须提交空字符串(对 secret 仍受规则 3 保护)。
//
// 任一侧 JSON 解析失败时返回原 newJSON,由上层校验链兜底报错。
//
// @ref 云储存优化批次 2 — partial PUT 不应丢字段
func mergeProviderConfigJSON(oldJSON, newJSON string) (string, error) {
	if oldJSON == "" {
		return newJSON, nil
	}
	if newJSON == "" {
		return oldJSON, nil
	}
	var oldPayload map[string]any
	if err := json.Unmarshal([]byte(oldJSON), &oldPayload); err != nil {
		return newJSON, err
	}
	var newPayload map[string]any
	if err := json.Unmarshal([]byte(newJSON), &newPayload); err != nil {
		return newJSON, err
	}
	merged := deepMergeStringMap(oldPayload, newPayload)
	// secret 字段额外处理:脱敏占位 / 空 / 缺失 → 回退旧值
	for _, k := range secretKeyFields {
		newVal, hasNew := merged[k].(string)
		if !hasNew || newVal == "" || isRedactedValue(newVal) {
			if oldVal, ok := oldPayload[k].(string); ok && oldVal != "" {
				merged[k] = oldVal
			} else {
				delete(merged, k)
			}
		}
	}
	out, err := json.Marshal(merged)
	if err != nil {
		return newJSON, err
	}
	return string(out), nil
}

// deepMergeStringMap 一层递归深合并:newMap 缺失的 key 从 oldMap 继承;
// 双方都是嵌套 map 时再合并一次,否则 newMap 的值覆盖 oldMap。
//
// JSON null 处理:json.Unmarshal 会把 null 解析为 nil,present 为 true。
// 这里把"显式 null"也当作"缺失"处理,以符合文档承诺(显式 null 被旧值覆盖,
// 想清空非 secret 字段必须提交空字符串 "")。
//
// 不深拷贝:返回的 map 与 newMap 共享底层引用,只对缺失字段补值。
//
// @ref PR #647 fix: gemini-code-assist medium — null 覆盖旧值与文档矛盾
func deepMergeStringMap(oldMap, newMap map[string]any) map[string]any {
	if newMap == nil {
		return oldMap
	}
	for k, oldVal := range oldMap {
		newVal, present := newMap[k]
		if !present || newVal == nil {
			newMap[k] = oldVal
			continue
		}
		oldNested, oldOK := oldVal.(map[string]any)
		newNested, newOK := newVal.(map[string]any)
		if oldOK && newOK {
			newMap[k] = deepMergeStringMap(oldNested, newNested)
		}
	}
	return newMap
}

// isRedactedValue 判断字符串是否是 redactProviderConfigJSON 生成的脱敏值。
// redactProviderConfigJSON 只会产生两种形态:"****" 或 "ab****cdef"。
// 不把任意包含 "****" 的真实 secret 当占位符,避免误保留旧密钥。
func isRedactedValue(v string) bool {
	return v == "****" || (len(v) == 10 && strings.HasPrefix(v[2:], "****"))
}

// toProviderVO 将 StorageProvider 模型转换为视图对象。
func toProviderVO(p model.StorageProvider) dto.StorageProviderVO {
	return dto.StorageProviderVO{
		ID:           p.ID,
		Name:         p.Name,
		ProviderType: p.ProviderType,
		ConfigJSON:   redactProviderConfigJSON(p.ConfigJSON),
		IsDefault:    p.IsDefault,
		IsEnabled:    p.IsEnabled,
		Priority:     p.Priority,
		CreatedAt:    p.CreatedAt,
	}
}

// toProviderVOs 批量将 StorageProvider 模型列表转换为视图对象列表。
func toProviderVOs(ps []model.StorageProvider) []dto.StorageProviderVO {
	vos := make([]dto.StorageProviderVO, len(ps))
	for i, p := range ps {
		vos[i] = toProviderVO(p)
	}
	return vos
}
