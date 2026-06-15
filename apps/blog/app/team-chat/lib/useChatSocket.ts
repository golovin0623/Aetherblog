'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEvent } from './types';

/**
 * 团队聊天 WebSocket Hook。
 *
 * 连接 `/api/v1/chat/ws`（同源握手自动携带 ab_access_token Cookie 完成鉴权）。
 * 负责：自动重连（指数退避）、心跳保活、下行事件分发、上行信令（打字 / 已读）。
 *
 * 设计为「连接长存、事件回调」：调用方传入 onEvent，hook 内部维持单条连接，
 * 切换会话不重连，只在 onEvent 中按 conversationId 过滤。
 */

interface Options {
  onEvent: (ev: ChatEvent) => void;
  enabled: boolean;
}

const MAX_BACKOFF = 15_000;
const HEARTBEAT_MS = 25_000;

export function useChatSocket({ onEvent, enabled }: Options) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1_000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const closedRef = useRef(false);
  // onEvent 用 ref 持有，避免回调身份变化触发重连。
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    reconnectTimer.current = null;
    heartbeatTimer.current = null;
  }, []);

  const connect = useCallback(() => {
    if (closedRef.current) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/api/v1/chat/ws`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      backoffRef.current = 1_000;
      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data as string) as ChatEvent;
        onEventRef.current(ev);
      } catch {
        /* 忽略无法解析的帧 */
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    function scheduleReconnect() {
      if (closedRef.current) return;
      const delay = Math.min(backoffRef.current, MAX_BACKOFF);
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
      reconnectTimer.current = setTimeout(connect, delay);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      cleanup();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, connect, cleanup]);

  const sendTyping = useCallback((conversationId: number, typing: boolean) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'typing', conversationId, typing }));
    }
  }, []);

  const sendRead = useCallback((conversationId: number, messageId: number) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'read', conversationId, messageId }));
    }
  }, []);

  return { connected, sendTyping, sendRead };
}
