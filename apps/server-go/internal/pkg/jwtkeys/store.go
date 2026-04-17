// Package jwtkeys 把 JWT 签名密钥从"启动时锁定的单一字符串"升级为"DB 管理、
// 支持热轮换的双 key 集合"。
//
// 设计关键点：
//  1. 仅内存快照对外可见（Current / Verifiers），避免每次验签打 DB。
//  2. Reload 每 ReloadInterval 刷新一次快照 —— 多实例部署时，非 leader 实例
//     用此机制感知 leader rotator 的写入。
//  3. Rotate 在单一实例内触发（推荐：leader election via pg_try_advisory_lock，
//     或在 docker-compose 的 backend 容器单副本部署场景下直接裸跑）。
//     Rotate 返回新 current，调用方可立即写入日志/审计。
//  4. current 用于签名；current + previous 都是验签候选。
//     previous 的有效窗口 = PreviousGrace；到点后 rotator 自动 retire。
//     推荐 PreviousGrace ≥ JWT.Expiration，保证已发放 access token 在 grace
//     结束前仍能验签（避免用户被踢下线）。
package jwtkeys

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// Store 是线程安全的 JWT 密钥集合，current + 最多一个 previous。
type Store struct {
	repo *repository.JWTSecretRepo

	mu       sync.RWMutex
	current  string
	previous string // 允许为空（启动后第一次轮换前）
}

// New 构造 Store，完成：
//  1. 若 DB 为空，用 seed 初始化 current；
//  2. 从 DB 同步一次到内存。
//
// seed 必须非空 —— 调用方（server.go）通常传 cfg.JWT.Secret。
func New(ctx context.Context, repo *repository.JWTSecretRepo, seed string) (*Store, error) {
	if seed == "" {
		return nil, errors.New("jwtkeys: seed must not be empty")
	}
	if err := repo.BootstrapIfEmpty(ctx, seed); err != nil {
		return nil, fmt.Errorf("jwtkeys: bootstrap: %w", err)
	}
	s := &Store{repo: repo}
	if err := s.Reload(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

// Current 返回用于签名的密钥；调用方应在每次签发 token 时取一次，
// 不要缓存 —— 轮换发生时不触发其它地方的显式通知。
func (s *Store) Current() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.current
}

// Verifiers 返回验签候选，顺序固定：[current, previous?]。
// 验证逻辑按顺序尝试解析，任一成功即可。
func (s *Store) Verifiers() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.previous == "" {
		return []string{s.current}
	}
	return []string{s.current, s.previous}
}

// Reload 从 DB 同步一次 active keys 到内存。
func (s *Store) Reload(ctx context.Context) error {
	rows, err := s.repo.ListActive(ctx)
	if err != nil {
		return fmt.Errorf("jwtkeys: reload: %w", err)
	}
	var cur, prev string
	for _, r := range rows {
		switch r.Status {
		case repository.JWTSecretCurrent:
			cur = r.SecretValue
		case repository.JWTSecretPrevious:
			prev = r.SecretValue
		}
	}
	if cur == "" {
		return fmt.Errorf("jwtkeys: no current row in DB (table corrupted?)")
	}
	s.mu.Lock()
	s.current = cur
	s.previous = prev
	s.mu.Unlock()
	return nil
}

// Rotate 生成新密钥、写入 DB、刷新内存。返回新 current。grace 是 previous 的
// 保留时长。典型调用方：定时 rotator goroutine；也可由管理端手动触发。
func (s *Store) Rotate(ctx context.Context, grace time.Duration) (string, error) {
	newSecret, err := generateSecret(48) // 48 bytes → 64 chars base64 → 足够强
	if err != nil {
		return "", fmt.Errorf("jwtkeys: generate: %w", err)
	}
	if _, err := s.repo.Rotate(ctx, newSecret, grace); err != nil {
		return "", err
	}
	if err := s.Reload(ctx); err != nil {
		return "", err
	}
	return newSecret, nil
}

// StartReloader 启动后台 goroutine，按 interval 轮询 DB 同步内存快照。
// 多实例部署下由非 leader 副本感知 leader 写入；单实例部署下主要起兜底作用
// （例如管理员手动修改 jwt_secrets 表）。
func (s *Store) StartReloader(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.Reload(ctx); err != nil {
					log.Warn().Err(err).Msg("jwtkeys: reloader failed")
				}
			}
		}
	}()
}

// StartRotator 启动后台 goroutine，按 interval 定时轮换密钥，并在每次 tick
// 先清理已过 grace window 的 previous 行。推荐 interval ≥ 24h。
//
// 首次 tick 在 interval 之后，不是启动立即 rotate —— 避免每次重启都打乱
// 已发放 token 的生命周期。
func (s *Store) StartRotator(ctx context.Context, interval, grace time.Duration) {
	if interval <= 0 {
		log.Warn().Msg("jwtkeys: rotation disabled (interval <= 0)")
		return
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if n, err := s.repo.PurgeExpiredPrevious(ctx); err != nil {
					log.Warn().Err(err).Msg("jwtkeys: purge expired previous failed")
				} else if n > 0 {
					log.Info().Int64("rows", n).Msg("jwtkeys: purged expired previous secrets")
				}
				newSecret, err := s.Rotate(ctx, grace)
				if err != nil {
					log.Error().Err(err).Msg("jwtkeys: scheduled rotation failed")
					continue
				}
				log.Info().
					Int("secret_len", len(newSecret)).
					Dur("next_rotation_in", interval).
					Dur("previous_grace", grace).
					Msg("jwtkeys: rotated JWT signing secret")
			}
		}
	}()
}

// generateSecret 返回 base64url 编码的加密安全随机字符串。
func generateSecret(byteLen int) (string, error) {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
