// Emoji 面板数据与「最近使用」持久化 —— 设计规范 §4 表情三层体系之第一层。
// 纯字符插入，零后端依赖；最近使用走 localStorage，跨会话保留。

export const EMOJI_CATEGORIES: ReadonlyArray<{ name: string; emojis: readonly string[] }> = [
  {
    name: '常用心情',
    emojis: ['😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤔', '🙄', '😴', '🥱', '😭', '😤', '🥹', '🫠', '🤯', '😇'],
  },
  {
    name: '手势',
    emojis: ['👍', '👎', '👌', '🤝', '👏', '🙏', '💪', '🫶', '✌️', '🤞', '👋', '🤙'],
  },
  {
    name: '心与光',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '✨', '⭐', '🔥', '💫', '🌙'],
  },
  {
    name: '物件',
    emojis: ['☕', '🍜', '🎉', '🎂', '📚', '💻', '🖋️', '📷', '🎧', '🚀', '🌌', '🍵'],
  },
];

/** 悬停快捷条与右键菜单的高频回应集。 */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉'] as const;

const RECENT_KEY = 'aether-chat-recent-emojis';
const RECENT_MAX = 18;

export function getRecentEmojis(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...getRecentEmojis().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 私有模式等场景写失败，忽略 */
  }
  return next;
}
