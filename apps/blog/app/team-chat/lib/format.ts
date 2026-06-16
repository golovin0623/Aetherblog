// 团队聊天时间格式化 —— 列表相对时间、消息气泡时间、日期分隔标签、分组间隔判定。
// 集中在此处，供 ConversationList / MessageThread 复用，保证全站时间口径一致。

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 两个 Date 是否落在同一自然日。 */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 消息气泡时间：14:32 */
export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

/** 日期分隔线标签：今天 / 昨天 / M月D日 / YYYY年M月D日 */
export function formatDayLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(d, now)) return '今天';
    if (isSameDay(d, yesterday)) return '昨天';
    if (d.getFullYear() === now.getFullYear()) {
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    }
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return '';
  }
}

/** 会话列表相对时间：今天→14:32，昨天→昨天，本年→M/D，跨年→YY/M/D */
export function formatListTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (isSameDay(d, yesterday)) return '昨天';
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
    return `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
}

/** 两条相邻消息是否落在不同自然日（用于插入日期分隔线）。 */
export function crossesDay(prevIso: string | undefined, iso: string): boolean {
  if (!prevIso) return true;
  try {
    return !isSameDay(new Date(prevIso), new Date(iso));
  } catch {
    return false;
  }
}

/** 相邻同发送者的两条消息是否仍属同一视觉分组（间隔 < 5 分钟）。 */
export function withinGroupGap(prevIso: string, iso: string): boolean {
  try {
    return Math.abs(new Date(iso).getTime() - new Date(prevIso).getTime()) < 5 * 60 * 1000;
  } catch {
    return false;
  }
}

/** 人类可读的附件大小：1.2 MB / 340 KB / 64 B */
export function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
