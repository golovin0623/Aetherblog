// Atlas — Phase 1 P1-09 标注迁移管线（Go 端）
//
// 当 Carrier 的 content_hash 变化（用户编辑了 note / 上传了 PDF 新版本）：
//   1. CarrierRepo.UpdateContent 已写入新 carrier_versions 行
//   2. 本服务遍历该 carrier 下所有未删除标注，跑 anchor() 算法
//   3. 把 (anchor_state, anchor_score) 写回 atlas_annotations
//
// 算法与前端 lib/anchoring.ts 同语义（位置 → prefix 模糊 → 滑窗）。
// 这里**纯 Go 端**实现，不依赖 ai-service。Phase 3 接入向量回退时再扩展。

package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// CarrierVersioningService 提供版本切换后的标注重定位入口。
type CarrierVersioningService struct {
	carriers    *repository.CarrierRepo
	annotations *repository.AnnotationRepo
}

// NewCarrierVersioningService 创建。
func NewCarrierVersioningService(c *repository.CarrierRepo, a *repository.AnnotationRepo) *CarrierVersioningService {
	return &CarrierVersioningService{carriers: c, annotations: a}
}

// MigrationStats 是一次迁移后的统计。写入 carrier_versions.diff_from_prev 作为审计。
type MigrationStats struct {
	CarrierID    int64 `json:"carrierId"`
	Total        int   `json:"total"`
	Anchored     int   `json:"anchored"`
	SoftAnchored int   `json:"softAnchored"`
	Orphan       int   `json:"orphan"`
}

// MigrateAnnotations 在版本切换后跑标注迁移。返回每个状态的计数。
//
// 注意：此函数**会写入 atlas_annotations** 表的 anchor_state / anchor_score。
//
// PR #724 review fix (Codex P1, anchoring.go:56): 过去 `_, _ = ...` 吞掉 per-annotation
// UPDATE 失败，导致 MigrateAnnotations 报告 success 但实际部分标注未持久化；
// 配合后续 hash 推进，标注会永久 stale。现在改为：
//   * 任一 annotation UPDATE 失败 → 收集 firstErr → 返回 (stats, error)
//   * 计数器只在 UPDATE 成功时累加
// 由调用方决定是否重试（见 markdown_carrier.go GetOrCreateForNote 的 retry 语义）。
//
// 调用方约定（PR #724 review fix Codex P1, markdown_carrier.go:104）：
// **必须在推进 carrier.content_hash 之前**先调本函数，因为 relocate() 是幂等的，
// 失败后下次入口检测到 hash 仍未推进 → 自动重新进 migration 分支；
// 反过来若先推 hash 后做 migration，失败后下次跳过 migration，标注永不修复。
func (s *CarrierVersioningService) MigrateAnnotations(ctx context.Context, carrierID int64, newText string) (*MigrationStats, error) {
	annos, err := s.annotations.FindByCarrier(ctx, carrierID)
	if err != nil {
		return nil, fmt.Errorf("加载标注失败: %w", err)
	}

	stats := &MigrationStats{CarrierID: carrierID, Total: len(annos)}
	var firstErr error
	failures := 0
	for i := range annos {
		a := &annos[i]
		state, score := relocate(newText, a.Selectors)
		if _, err := s.annotations.UpdatePartial(ctx, a.ID, nil, nil, &state, &score); err != nil {
			failures++
			if firstErr == nil {
				firstErr = fmt.Errorf("annotation %d update: %w", a.ID, err)
			}
			continue
		}
		switch state {
		case "anchored":
			stats.Anchored++
		case "soft_anchored":
			stats.SoftAnchored++
		case "orphan":
			stats.Orphan++
		}
	}
	if firstErr != nil {
		return stats, fmt.Errorf("%d/%d annotation 迁移失败: %w", failures, stats.Total, firstErr)
	}
	return stats, nil
}

// relocate 是简化版的锚定算法（位置 → exact 全文 → prefix 邻域 → 滑窗）。
// 与前端 lib/anchoring.ts 语义一致；服务端用于背景批量迁移。
//
// **UTF-8 安全 (PR #724 review fix)**: 内部全部基于 []rune 操作。
// 前端 W3C TextPositionSelector 的 start/end 是 JS UTF-16 code unit 偏移，对 BMP 字符
// （含所有 CJK）等同于 code point/rune；对 emoji 等 surrogate pair 字符 JS 会计 2 而 Go []rune 计 1。
// PR #725 review fix (Gemini high, anchoring.go:133): 通过 utf16OffsetToRuneIndex 显式做
// UTF-16 → rune 转换，让档1 精确位置匹配对非 BMP 字符也正确。
func relocate(text string, selectorsJSON []byte) (string, float32) {
	var selectors []map[string]any
	if err := json.Unmarshal(selectorsJSON, &selectors); err != nil {
		return "orphan", 0
	}
	var quote map[string]any
	var position map[string]any
	for _, s := range selectors {
		if t, _ := s["type"].(string); t == "TextQuoteSelector" {
			quote = s
		} else if t == "TextPositionSelector" {
			position = s
		}
	}
	if quote == nil {
		return "orphan", 0
	}
	exactStr, _ := quote["exact"].(string)
	prefixStr, _ := quote["prefix"].(string)
	if exactStr == "" {
		return "orphan", 0
	}

	textRunes := []rune(text)
	exact := []rune(exactStr)
	prefix := []rune(prefixStr)

	// 档1: 直接位置命中（rune 边界）
	// PR #725 review fix (Gemini high): position.start/end 是 UTF-16 code unit 偏移，
	// 用 utf16OffsetToRuneIndex 把它们转换为 Go rune slice 索引，让非 BMP 字符也正确锚定。
	if position != nil {
		startUTF16, sok := toInt(position["start"])
		endUTF16, eok := toInt(position["end"])
		start := utf16OffsetToRuneIndex(textRunes, startUTF16)
		end := utf16OffsetToRuneIndex(textRunes, endUTF16)
		if sok && eok && start >= 0 && end <= len(textRunes) && start < end {
			if runesEqual(textRunes[start:end], exact) {
				return "anchored", 1.0
			}
		}
	}

	// 档2: exact substring (rune-level)
	if idx := indexOfRunes(textRunes, exact); idx >= 0 {
		return "anchored", 1.0
	}

	// 档3: prefix 邻域 + 长度匹配
	if len(prefix) >= 5 {
		if pidx := indexOfRunes(textRunes, prefix); pidx >= 0 {
			candStart := pidx + len(prefix)
			candEnd := candStart + len(exact)
			if candEnd <= len(textRunes) {
				sim := similarity(textRunes[candStart:candEnd], exact)
				if sim >= 0.85 {
					if sim >= 1.0 {
						return "anchored", 1.0
					}
					return "soft_anchored", sim
				}
			}
		}
	}

	// 档4: 滑窗 + 编辑距离
	sim, _ := slideWindow(textRunes, exact)
	if sim >= 0.85 {
		return "soft_anchored", sim
	}
	return "orphan", sim
}

func toInt(v any) (int, bool) {
	switch x := v.(type) {
	case float64:
		return int(x), true
	case int:
		return x, true
	case int64:
		return int(x), true
	}
	return 0, false
}

// utf16OffsetToRuneIndex 把 JS UTF-16 code unit 偏移量转换为 Go rune slice 索引。
//
// PR #725 review fix (Gemini high, anchoring.go:133): W3C TextPositionSelector 在 JS 端
// 是 string.slice() 的 UTF-16 code unit 索引。BMP 字符（U+0000..U+FFFF，含所有 CJK）
// 每个占 1 unit = 1 rune；非 BMP 字符（U+10000..U+10FFFF，如 emoji）占 2 surrogate pair
// units = 1 rune。本函数走一遍 rune 累计 UTF-16 长度直到命中目标。
func utf16OffsetToRuneIndex(runes []rune, utf16Offset int) int {
	if utf16Offset <= 0 {
		return 0
	}
	cnt := 0
	for i, r := range runes {
		if cnt >= utf16Offset {
			return i
		}
		if r > 0xFFFF {
			cnt += 2 // surrogate pair
		} else {
			cnt += 1
		}
	}
	return len(runes)
}

// runesEqual 比较两个 rune slice 是否相同。
func runesEqual(a, b []rune) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// indexOfRunes 在 haystack rune slice 里查找 needle 的首次出现位置（rune 单位）。
func indexOfRunes(haystack, needle []rune) int {
	if len(needle) == 0 {
		return 0
	}
	if len(needle) > len(haystack) {
		return -1
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := 0; j < len(needle); j++ {
			if haystack[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// levenshteinRunes 计算两个 rune slice 的编辑距离。
func levenshteinRunes(a, b []rune) int {
	if runesEqual(a, b) {
		return 0
	}
	la, lb := len(a), len(b)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 0
			if a[i-1] != b[j-1] {
				cost = 1
			}
			m := curr[j-1] + 1
			if prev[j]+1 < m {
				m = prev[j] + 1
			}
			if prev[j-1]+cost < m {
				m = prev[j-1] + cost
			}
			curr[j] = m
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}

// similarity 计算两个 rune slice 的相似度（1 - Levenshtein/maxLen）。
func similarity(a, b []rune) float32 {
	if len(a) == 0 && len(b) == 0 {
		return 1
	}
	dist := levenshteinRunes(a, b)
	maxLen := len(a)
	if len(b) > maxLen {
		maxLen = len(b)
	}
	return 1 - float32(dist)/float32(maxLen)
}

// slideWindow 在 text rune slice 里滑动 target 长度窗口，找最大相似度窗口（rune 单位）。
func slideWindow(text, target []rune) (float32, int) {
	winLen := len(target)
	if winLen == 0 || len(text) < winLen {
		return 0, -1
	}
	step := winLen / 8
	if step < 1 {
		step = 1
	}
	var bestSim float32
	bestPos := -1
	for i := 0; i+winLen <= len(text); i += step {
		s := similarity(text[i:i+winLen], target)
		if s > bestSim {
			bestSim = s
			bestPos = i
		}
	}
	return bestSim, bestPos
}
