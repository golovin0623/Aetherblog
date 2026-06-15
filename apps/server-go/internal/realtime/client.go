package realtime

import (
	"context"
	"time"

	"github.com/coder/websocket"
	"github.com/rs/zerolog/log"
)

const (
	// sendBuffer 是每个连接的出站缓冲深度，满则丢弃帧（见 localDeliver）。
	sendBuffer = 64
	// readLimit 限制单条入站帧大小（字节），防御超大帧。附件走 HTTP 上传，WS 只传小信令。
	readLimit = 32 * 1024
	// writeTimeout 是单次写超时。
	writeTimeout = 10 * time.Second
	// readTimeout 是单次读超时。客户端每 25s 发一次 ping，35s 内无任何帧即判定静默死连接，
	// 主动关闭以回收 goroutine（防御未发 Close 帧的异常断连导致的连接/协程泄漏）。
	readTimeout = 35 * time.Second
)

// Client 表示一条已认证的 WebSocket 连接。
type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	userID    int64
	send      chan []byte
	onMessage func(ctx context.Context, raw []byte)
}

// NewClient 基于已升级的连接创建客户端。onMessage 处理入站信令（typing 等），可为 nil。
func (h *Hub) NewClient(conn *websocket.Conn, userID int64, onMessage func(ctx context.Context, raw []byte)) *Client {
	conn.SetReadLimit(readLimit)
	return &Client{
		hub:       h,
		conn:      conn,
		userID:    userID,
		send:      make(chan []byte, sendBuffer),
		onMessage: onMessage,
	}
}

// Serve 注册连接并阻塞运行读写循环，直到连接关闭或 ctx 取消。
func (c *Client) Serve(ctx context.Context) {
	c.hub.register(c)
	defer c.hub.unregister(c)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	go c.writePump(ctx)
	c.readPump(ctx)
	c.conn.Close(websocket.StatusNormalClosure, "")
}

// readPump 循环读取入站帧并交给 onMessage 回调。
// 每次读取带 readTimeout —— 心跳（25s）正常时不会触发；静默断连超过 35s 即报错返回，
// 触发上层清理，避免连接与 goroutine 永久泄漏。
func (c *Client) readPump(ctx context.Context) {
	for {
		readCtx, cancel := context.WithTimeout(ctx, readTimeout)
		typ, data, err := c.conn.Read(readCtx)
		cancel()
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		if c.onMessage != nil {
			c.onMessage(ctx, data)
		}
	}
}

// writePump 把出站缓冲中的数据写入连接。
func (c *Client) writePump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-c.send:
			if !ok {
				return
			}
			wctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := c.conn.Write(wctx, websocket.MessageText, data)
			cancel()
			if err != nil {
				log.Debug().Err(err).Int64("user", c.userID).Msg("chat ws write failed")
				// 显式关闭连接，强制 readPump 退出，避免半死连接迟迟不释放。
				c.conn.Close(websocket.StatusAbnormalClosure, "write failed")
				return
			}
		}
	}
}

// UserID 返回连接所属用户 ID。
func (c *Client) UserID() int64 { return c.userID }
