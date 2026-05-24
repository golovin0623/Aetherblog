// Package service · kb_indexer_client.go — Go 后端向 ai-service 触发 KB 向量化的 HTTP 客户端。
//
// 端点（详见 apps/ai-service/app/api/routes/knowledge_bases.py）：
//   POST /api/v1/kb/{kb_id}/files/{file_id}/index    单文件向量化（同步返回结果摘要）
//   POST /api/v1/kb/{kb_id}/reindex                  全库重建（流式 SSE，可选）
//   GET  /api/v1/kb/{kb_id}/recall                   语义召回（灵境对话路径上不直接调用此端点，
//                                                    而是由 ai-service 内的 agent.py 直接读 PG）
//
// 设计：
//   - 复用 AIClient 的 syncClient / streamClient（节流配置一致）。
//   - 注入 X-Internal-Service token（与 agent_handler 同套机制）。
//   - 返回的 JSON 解码到 KBIndexResult 与 KBIndexError。
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/golovin0623/aetherblog-server/internal/config"
)

// KBIndexerClient 对接 ai-service 的 KB 路由。
type KBIndexerClient struct {
	ai            *AIClient
	internalToken string
}

func NewKBIndexerClient(cfg config.AIConfig) *KBIndexerClient {
	return &KBIndexerClient{
		ai:            NewAIClient(cfg),
		internalToken: cfg.InternalServiceToken,
	}
}

// KBIndexResult 是 ai-service 单文件向量化成功后的响应。
type KBIndexResult struct {
	KBFileID   int64  `json:"kbFileId"`
	ProfileID  int64  `json:"profileId"`
	ChunkCount int    `json:"chunkCount"`
	DocChars   int    `json:"docChars"`
	DocTokens  int    `json:"docTokens"`
	Status     string `json:"status"` // "SUCCEEDED" | "FAILED"
	Error      string `json:"error,omitempty"`
}

// KBIndexPayload 向 ai-service 发送的索引请求体。
//
// 关键决策：Go 端先把媒体字节读出来再 POST，避免 ai-service 反向去拉媒体存储
// （那要 ai-service 知道 storage_provider / 走 backend 反代理 / 等等耦合）。
// Content 按 base64 编码，Mime 提示给 ai-service 决定如何解析（txt/md/html/...）。
type KBIndexPayload struct {
	Filename        string `json:"filename"`
	MimeType        string `json:"mimeType"`
	Content         []byte `json:"contentBytes"` // json 序列化时自动 base64
	TargetProfileID int64  `json:"targetProfileId,omitempty"`
	TargetStatus    string `json:"targetStatus,omitempty"` // 'active' | 'shadow'
}

// IndexFile 触发单文件向量化。同步返回结果（ai-service 内部异步 chunk + embed，
// HTTP 响应携带完整结果）。
func (c *KBIndexerClient) IndexFile(ctx context.Context, kbID, fileID int64, payload KBIndexPayload) (*KBIndexResult, error) {
	if c.internalToken == "" {
		return nil, fmt.Errorf("internal service token not configured")
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	headers := map[string]string{"X-Internal-Service": c.internalToken}
	path := fmt.Sprintf("/api/v1/kb/%d/files/%d/index", kbID, fileID)
	body, status, err := c.ai.DoStream(ctx, http.MethodPost, path, bytes.NewReader(bodyBytes), headers)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	respBytes, _ := io.ReadAll(body)
	if status >= 400 {
		return nil, fmt.Errorf("ai-service kb index failed: HTTP %d body=%s", status, string(respBytes))
	}
	var wrapper struct {
		Code    int           `json:"code"`
		Data    KBIndexResult `json:"data"`
		Message string        `json:"message"`
	}
	if err := json.Unmarshal(respBytes, &wrapper); err != nil {
		return nil, fmt.Errorf("parse kb index response: %w (raw=%s)", err, string(respBytes))
	}
	return &wrapper.Data, nil
}

// ReindexAll 触发整库重建（异步 SSE，本方法只 ack 启动；调用方可订阅 SSE 拉进度）。
// Phase1 仅返回 200 / error，前端通过轮询 kb files 状态体现进度。
func (c *KBIndexerClient) ReindexAll(ctx context.Context, kbID int64) error {
	if c.internalToken == "" {
		return fmt.Errorf("internal service token not configured")
	}
	headers := map[string]string{"X-Internal-Service": c.internalToken}
	path := fmt.Sprintf("/api/v1/kb/%d/reindex", kbID)
	body, status, err := c.ai.DoStream(ctx, http.MethodPost, path, bytes.NewReader([]byte(`{}`)), headers)
	if err != nil {
		return err
	}
	defer body.Close()
	if status >= 400 {
		respBytes, _ := io.ReadAll(body)
		return fmt.Errorf("ai-service kb reindex failed: HTTP %d body=%s", status, string(respBytes))
	}
	return nil
}
