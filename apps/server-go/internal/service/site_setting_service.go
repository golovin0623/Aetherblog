package service

import (
	"context"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/repository"
)

type SiteSettingService struct{ repo *repository.SiteSettingRepo }

func NewSiteSettingService(repo *repository.SiteSettingRepo) *SiteSettingService {
	return &SiteSettingService{repo: repo}
}

// GetAll returns all settings as key → value map.
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

// GetByGroup returns settings in a group as key → value map.
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

// GetValue returns the raw string value for a key.
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

// SetValue upserts a single key-value pair.
func (s *SiteSettingService) SetValue(ctx context.Context, key, value string) error {
	return s.repo.Upsert(ctx, key, value)
}

// SetBatch upserts multiple key-value pairs.
func (s *SiteSettingService) SetBatch(ctx context.Context, kv map[string]string) error {
	return s.repo.UpsertBatch(ctx, kv)
}

// settingValue converts a raw string based on setting type.
func settingValue(v *string, t string) any {
	if v == nil {
		return nil
	}
	switch strings.ToUpper(t) {
	case "BOOLEAN":
		return *v == "true" || *v == "1" || *v == "yes"
	case "NUMBER":
		// Return as string; frontend parses numeric values as needed
		return *v
	default:
		return *v
	}
}
