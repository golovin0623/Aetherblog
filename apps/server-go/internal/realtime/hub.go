// Package realtime 提供基于 WebSocket 的实时消息分发能力。
//
// 设计要点：
//   - Hub 维护「userID -> 本机连接集合」的注册表，向目标用户投递事件。
//   - 跨实例广播走 Redis Pub/Sub：发送方先本机投递，再把带 origin 标记的信封
//     发布到统一频道；订阅循环只投递「非本机来源」的信封，避免重复投递。
//   - Redis 不可用时自动退化为单实例本机投递（仍可用，只是没有跨实例扇出）。
//
// 该包不感知聊天业务语义（成员校验 / 落库），仅负责连接管理与字节投递；
// 入站消息通过 Client.onMessage 回调交还给 handler 处理。
package realtime

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// fanoutChannel 是跨实例广播的 Redis Pub/Sub 频道名。
const fanoutChannel = "chat:fanout"

// Event 是投递给客户端的统一事件信封。
type Event struct {
	Type           string `json:"type"`                     // message | typing | read | presence | ack | error
	ConversationID int64  `json:"conversationId,omitempty"` // 关联会话
	Payload        any    `json:"payload,omitempty"`        // 事件载荷
}

// fanoutEnvelope 是跨实例广播的内部信封。
type fanoutEnvelope struct {
	Origin  string          `json:"o"` // 来源实例 ID，订阅端据此跳过自身
	Targets []int64         `json:"t"` // 目标 user_id 列表
	Data    json.RawMessage `json:"d"` // 已序列化的 Event
}

// Hub 管理 WebSocket 连接注册表并负责事件投递。
type Hub struct {
	mu       sync.RWMutex
	clients  map[int64]map[*Client]struct{}
	redis    *redis.Client
	instance string
}

// NewHub 创建 Hub。redis 可为 nil（退化为单实例）。
func NewHub(rdb *redis.Client) *Hub {
	return &Hub{
		clients:  make(map[int64]map[*Client]struct{}),
		redis:    rdb,
		instance: randomID(),
	}
}

// Run 启动 Redis 订阅循环，随 ctx 取消退出。redis 为 nil 时直接返回。
func (h *Hub) Run(ctx context.Context) {
	if h.redis == nil {
		return
	}
	go func() {
		sub := h.redis.Subscribe(ctx, fanoutChannel)
		defer sub.Close()
		ch := sub.Channel()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				var env fanoutEnvelope
				if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
					continue
				}
				// 本机来源的信封已在 Publish 中本地投递过，跳过避免重复。
				if env.Origin == h.instance {
					continue
				}
				h.localDeliver(env.Targets, env.Data)
			}
		}
	}()
	log.Info().Str("instance", h.instance).Msg("chat realtime hub started (redis fanout)")
}

// register 把客户端登记进注册表。
func (h *Hub) register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.clients[c.userID]
	if set == nil {
		set = make(map[*Client]struct{})
		h.clients[c.userID] = set
	}
	set[c] = struct{}{}
}

// unregister 注销客户端。
func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set := h.clients[c.userID]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(h.clients, c.userID)
		}
	}
}

// LocalOnline 判断某用户在本实例是否有活跃连接。
func (h *Hub) LocalOnline(userID int64) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID]) > 0
}

// localDeliver 把数据写入本机命中目标用户的所有连接（非阻塞，满则丢弃该帧）。
func (h *Hub) localDeliver(targets []int64, data []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, uid := range targets {
		for c := range h.clients[uid] {
			select {
			case c.send <- data:
			default:
				// 发送缓冲满：客户端消费过慢，丢弃此帧避免阻塞整个 Hub。
			}
		}
	}
}

// Publish 向目标用户投递事件：先本机投递，再跨实例广播。
func (h *Hub) Publish(ctx context.Context, targets []int64, ev Event) {
	data, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.localDeliver(targets, data)

	if h.redis == nil {
		return
	}
	env, err := json.Marshal(fanoutEnvelope{Origin: h.instance, Targets: targets, Data: data})
	if err != nil {
		return
	}
	pubCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := h.redis.Publish(pubCtx, fanoutChannel, env).Err(); err != nil {
		// 已本机投递，跨实例失败不致命；记 debug 便于排障。
		log.Debug().Err(err).Msg("chat fanout publish failed")
	}
}

func randomID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "inst-0"
	}
	return hex.EncodeToString(b)
}
