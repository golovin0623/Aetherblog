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
func (c *Client) readPump(ctx context.Context) {
	for {
		typ, data, err := c.conn.Read(ctx)
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
				return
			}
		}
	}
}

// UserID 返回连接所属用户 ID。
func (c *Client) UserID() int64 { return c.userID }
