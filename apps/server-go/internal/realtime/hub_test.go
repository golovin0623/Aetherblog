package realtime

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// newTestClient 构造一个仅用于测试投递的客户端（无真实连接）。
func (h *Hub) newTestClient(userID int64) *Client {
	c := &Client{hub: h, userID: userID, send: make(chan []byte, 8)}
	h.register(c)
	return c
}

func TestHubLocalDeliverTargetsOnly(t *testing.T) {
	h := NewHub(nil) // redis 为 nil → 单实例本机投递
	a := h.newTestClient(1)
	b := h.newTestClient(2)

	h.Publish(context.Background(), []int64{1}, Event{Type: "message", ConversationID: 7})

	select {
	case raw := <-a.send:
		var ev Event
		if err := json.Unmarshal(raw, &ev); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if ev.Type != "message" || ev.ConversationID != 7 {
			t.Fatalf("unexpected event: %+v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("target user 1 did not receive event")
	}

	select {
	case <-b.send:
		t.Fatal("non-target user 2 should not receive event")
	case <-time.After(100 * time.Millisecond):
		// 预期：未投递给非目标用户。
	}
}

func TestHubUnregisterAndOnline(t *testing.T) {
	h := NewHub(nil)
	c := h.newTestClient(42)
	if !h.LocalOnline(42) {
		t.Fatal("expected user 42 online after register")
	}
	h.unregister(c)
	if h.LocalOnline(42) {
		t.Fatal("expected user 42 offline after unregister")
	}
}

func TestHubMultipleConnectionsSameUser(t *testing.T) {
	h := NewHub(nil)
	c1 := h.newTestClient(5)
	c2 := h.newTestClient(5)

	h.Publish(context.Background(), []int64{5}, Event{Type: "typing"})

	for i, c := range []*Client{c1, c2} {
		select {
		case <-c.send:
		case <-time.After(time.Second):
			t.Fatalf("connection %d did not receive fanout", i)
		}
	}
}
