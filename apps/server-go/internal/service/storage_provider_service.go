package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

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
	objs, nextTok, err := lister.List(ctx, prefix, token, limit)
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
	catalogMap, err := s.lookupCatalog(ctx, providerID, keys)
	if err != nil {
		return nil, err
	}

	listings := make([]ObjectListing, len(objs))
	for i, o := range objs {
		l := ObjectListing{
			Key:          o.Key,
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

// ImportObjects 把指定 keys 反向导入到 media_files catalog。
//
// 对每个 key:
//   1. 在云端 Head 一次确认存在 + 取大小/MIME。
//   2. 写入 media_files (file_path=key, file_url=key, cdn_url=GetURL(key))。
//   3. 跳过已在 catalog 的 key (避免重复)。
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
	existing, err := s.lookupCatalog(ctx, providerID, keys)
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

	existing, err := s.lookupCatalog(ctx, providerID, keys)
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

// lookupCatalog 反查 keys 在 media_files (storage_provider_id=providerID) 的 ID 映射。
func (s *StorageProviderService) lookupCatalog(ctx context.Context, providerID int64, keys []string) (map[string]int64, error) {
	if len(keys) == 0 {
		return map[string]int64{}, nil
	}
	rows, err := s.repo.LookupCatalogByKeys(ctx, providerID, keys)
	if err != nil {
		return nil, err
	}
	return rows, nil
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

// mergeProviderConfigJSON 把前端提交的新 configJson 合并到旧 configJson 上:
//   - 新值非空且看起来不是脱敏占位符 → 用新值。
//   - 新值为空字符串、字段缺失、或形如 "ab****12cd" 的脱敏字符串 → 保留旧值。
//
// 这样 admin 在 UI 上修改 endpoint/region 时不会因为密钥字段是脱敏字符串而被覆盖。
// 客户端要换新 secret,必须显式提交完整明文。
//
// raw 输入解析失败时返回原 newJSON,由上层校验链兜底报错。
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
	for _, k := range secretKeyFields {
		newVal, hasNew := newPayload[k].(string)
		if !hasNew || newVal == "" || isRedactedValue(newVal) {
			// 新值缺失/空/脱敏占位 → 保留旧值
			if oldVal, ok := oldPayload[k].(string); ok && oldVal != "" {
				newPayload[k] = oldVal
			} else {
				delete(newPayload, k)
			}
		}
	}
	out, err := json.Marshal(newPayload)
	if err != nil {
		return newJSON, err
	}
	return string(out), nil
}

// isRedactedValue 判断字符串是否是 redactProviderConfigJSON 生成的脱敏值。
// 简单启发式: 包含 "****" 即视为脱敏。
func isRedactedValue(v string) bool {
	return strings.Contains(v, "****")
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
