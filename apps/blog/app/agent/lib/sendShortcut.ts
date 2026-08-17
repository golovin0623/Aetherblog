'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 发送快捷键偏好（Enter ⇄ ⌘/Ctrl+Enter）
 *
 * 此前由 Composer 内部维护 + 发送按钮上挂分裂式下拉 —— 拼接结构让发送键
 * 显得笨重。现把偏好抽成独立存储源：Composer 只消费；设置入口移到顶栏
 * 「渲染偏好」面板。两处通过自定义事件同步（同页即时生效），跨标签页由
 * storage 事件兜底。
 */
export type SendShortcut = 'enter' | 'mod-enter';

const STORAGE_KEY = 'aetherblog.blog.agent.sendShortcut';
const SYNC_EVENT = 'aetherblog:agent:send-shortcut';

export const SEND_SHORTCUT_OPTIONS: ReadonlyArray<{
  value: SendShortcut;
  label: string;
  description: string;
}> = [
  { value: 'enter', label: 'Enter', description: 'Enter 发送 · Shift+Enter 换行' },
  { value: 'mod-enter', label: '⌘ Enter', description: '⌘/Ctrl+Enter 发送 · Enter 换行' },
];

export function readSendShortcut(): SendShortcut {
  if (typeof window === 'undefined') return 'enter';
  return window.localStorage.getItem(STORAGE_KEY) === 'mod-enter' ? 'mod-enter' : 'enter';
}

export function writeSendShortcut(value: SendShortcut) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent<SendShortcut>(SYNC_EVENT, { detail: value }));
}

export function useSendShortcut(): [SendShortcut, (value: SendShortcut) => void] {
  const [value, setValue] = useState<SendShortcut>(() => readSendShortcut());

  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent<SendShortcut>).detail;
      if (detail === 'enter' || detail === 'mod-enter') setValue(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setValue(readSendShortcut());
    };
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const set = useCallback((next: SendShortcut) => {
    setValue(next);
    writeSendShortcut(next);
  }, []);

  return [value, set];
}
