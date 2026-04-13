package service

import (
	"context"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// SiteSettingService 提供对数据库中键值对形式站点配置的读写访问。
type SiteSettingService struct{ repo *repository.SiteSettingRepo }

// NewSiteSettingService 创建一个由给定仓储支持的 SiteSettingService 实例。
func NewSiteSettingService(repo *repository.SiteSettingRepo) *SiteSettingService {
	return &SiteSettingService{repo: repo}
}

// GetAll 返回所有站点配置，结果为 key → value 的映射。
// value 的类型根据 setting_type 自动转换（BOOLEAN 转 bool，其余返回字符串）。
func (s *SiteSettingService) GetAll(ctx context.Context) (map[string]any, error) {
	settings, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	m := make(map[string]any, len(settings))
	for _, ss := range settings {
		m[ss.SettingKey] = settingValue(ss.SettingValue, ss.SettingType)
	}
	return m, nil
}

// GetByGroup 返回指定分组内的所有配置，结果为 key → value 的映射。
func (s *SiteSettingService) GetByGroup(ctx context.Context, group string) (map[string]any, error) {
	settings, err := s.repo.FindByGroup(ctx, group)
	if err != nil {
		return nil, err
	}
	m := make(map[string]any, len(settings))
	for _, ss := range settings {
		m[ss.SettingKey] = settingValue(ss.SettingValue, ss.SettingType)
	}
	return m, nil
}

// GetValue 返回指定键的原始字符串值。
// 键不存在或值为 nil 时返回空字符串。
func (s *SiteSettingService) GetValue(ctx context.Context, key string) (string, error) {
	ss, err := s.repo.FindByKey(ctx, key)
	if err != nil {
		return "", err
	}
	if ss == nil || ss.SettingValue == nil {
		return "", nil
	}
	return *ss.SettingValue, nil
}

// GetByKeyPrefix 返回所有以指定前缀开头的配置项，值以原始字符串形式返回。
// 不依赖 group_name 或 setting_type，适用于跨组读取场景。
func (s *SiteSettingService) GetByKeyPrefix(ctx context.Context, prefix string) (map[string]string, error) {
	settings, err := s.repo.FindByKeyPrefix(ctx, prefix)
	if err != nil {
		return nil, err
	}
	m := make(map[string]string, len(settings))
	for _, ss := range settings {
		if ss.SettingValue != nil {
			m[ss.SettingKey] = *ss.SettingValue
		}
	}
	return m, nil
}

// SetValue 以 Upsert 方式设置单个配置键值对（不存在则插入，存在则更新）。
func (s *SiteSettingService) SetValue(ctx context.Context, key, value string) error {
	return s.repo.Upsert(ctx, key, value)
}

// SetBatch 以 Upsert 方式批量设置多个配置键值对。
func (s *SiteSettingService) SetBatch(ctx context.Context, kv map[string]string) error {
	return s.repo.UpsertBatch(ctx, kv)
}

// settingValue 根据配置的 setting_type 将原始字符串值转换为对应的 Go 类型。
// BOOLEAN 类型：返回 bool（"true"、"1"、"yes" 均视为 true）；
// NUMBER 类型：以字符串形式返回，由前端按需解析；
// 其他类型：直接返回字符串。
func settingValue(v *string, t string) any {
	if v == nil {
		return nil
	}
	switch strings.ToUpper(t) {
	case "BOOLEAN":
		return *v == "true" || *v == "1" || *v == "yes"
	case "NUMBER":
		// 以字符串形式返回，前端按需自行解析数值
		return *v
	default:
		return *v
	}
}
