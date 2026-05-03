export interface TagColor {
  bg: string;
  text: string;
  border: string;
  icon: string;
  badge: string;
  shadow: string;
}

export const TAG_PALETTE: TagColor[] = [
  { bg: 'bg-blue-50 dark:bg-blue-500/15', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200/60 dark:border-blue-500/25', icon: 'text-blue-500 dark:text-blue-400', badge: 'bg-blue-100/80 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300', shadow: 'hover:shadow-blue-500/10' },
  { bg: 'bg-violet-50 dark:bg-violet-500/15', text: 'text-violet-700 dark:text-violet-300', border: 'border-violet-200/60 dark:border-violet-500/25', icon: 'text-violet-500 dark:text-violet-400', badge: 'bg-violet-100/80 dark:bg-violet-500/20 text-violet-600 dark:text-violet-300', shadow: 'hover:shadow-violet-500/10' },
  { bg: 'bg-emerald-50 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200/60 dark:border-emerald-500/25', icon: 'text-emerald-500 dark:text-emerald-400', badge: 'bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300', shadow: 'hover:shadow-emerald-500/10' },
  { bg: 'bg-amber-50 dark:bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200/60 dark:border-amber-500/25', icon: 'text-amber-500 dark:text-amber-400', badge: 'bg-amber-100/80 dark:bg-amber-500/20 text-amber-600 dark:text-amber-300', shadow: 'hover:shadow-amber-500/10' },
  { bg: 'bg-pink-50 dark:bg-pink-500/15', text: 'text-pink-700 dark:text-pink-300', border: 'border-pink-200/60 dark:border-pink-500/25', icon: 'text-pink-500 dark:text-pink-400', badge: 'bg-pink-100/80 dark:bg-pink-500/20 text-pink-600 dark:text-pink-300', shadow: 'hover:shadow-pink-500/10' },
  { bg: 'bg-teal-50 dark:bg-teal-500/15', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-200/60 dark:border-teal-500/25', icon: 'text-teal-500 dark:text-teal-400', badge: 'bg-teal-100/80 dark:bg-teal-500/20 text-teal-600 dark:text-teal-300', shadow: 'hover:shadow-teal-500/10' },
  { bg: 'bg-rose-50 dark:bg-rose-500/15', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200/60 dark:border-rose-500/25', icon: 'text-rose-500 dark:text-rose-400', badge: 'bg-rose-100/80 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300', shadow: 'hover:shadow-rose-500/10' },
  { bg: 'bg-indigo-50 dark:bg-indigo-500/15', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200/60 dark:border-indigo-500/25', icon: 'text-indigo-500 dark:text-indigo-400', badge: 'bg-indigo-100/80 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300', shadow: 'hover:shadow-indigo-500/10' },
  { bg: 'bg-sky-50 dark:bg-sky-500/15', text: 'text-sky-700 dark:text-sky-300', border: 'border-sky-200/60 dark:border-sky-500/25', icon: 'text-sky-500 dark:text-sky-400', badge: 'bg-sky-100/80 dark:bg-sky-500/20 text-sky-600 dark:text-sky-300', shadow: 'hover:shadow-sky-500/10' },
  { bg: 'bg-lime-50 dark:bg-lime-500/15', text: 'text-lime-700 dark:text-lime-300', border: 'border-lime-200/60 dark:border-lime-500/25', icon: 'text-lime-500 dark:text-lime-400', badge: 'bg-lime-100/80 dark:bg-lime-500/20 text-lime-600 dark:text-lime-300', shadow: 'hover:shadow-lime-500/10' },
  { bg: 'bg-fuchsia-50 dark:bg-fuchsia-500/15', text: 'text-fuchsia-700 dark:text-fuchsia-300', border: 'border-fuchsia-200/60 dark:border-fuchsia-500/25', icon: 'text-fuchsia-500 dark:text-fuchsia-400', badge: 'bg-fuchsia-100/80 dark:bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-300', shadow: 'hover:shadow-fuchsia-500/10' },
  { bg: 'bg-orange-50 dark:bg-orange-500/15', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200/60 dark:border-orange-500/25', icon: 'text-orange-500 dark:text-orange-400', badge: 'bg-orange-100/80 dark:bg-orange-500/20 text-orange-600 dark:text-orange-300', shadow: 'hover:shadow-orange-500/10' },
];

/* djb2-derived 字符串哈希 —— `getTagColor` / `getTagHex` 共用,
   保证同一 tag 名在两套调色板里映射到同一个槽位。私有于本文件,
   因为它的稳定性合约(同名 → 同 index)对外只通过两个 getter 暴露。 */
const hashTagName = (name: string): number => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

export const getTagColor = (name: string): TagColor => {
  return TAG_PALETTE[hashTagName(name) % TAG_PALETTE.length];
};

/* -------------------------------------------------------------
 * Codex-aligned hex palette —— 给 Aether Codex surface 用.
 *
 * 每个 tag 在 surface-leaf data-interactive 上需要一个 hex 颜色覆盖
 * 局部 --aurora-1, 这样左侧光带和边框辉光会跟随 tag 自身色相 (与
 * FriendCard 里 themeColor 覆盖 aurora 的做法一致). hex 与 TAG_PALETTE
 * 顺序对齐, 保证同一 tag 名在两套 API 下色相一致.
 * ------------------------------------------------------------- */
export const TAG_HEX_PALETTE = [
  '#3B82F6', // blue-500
  '#8B5CF6', // violet-500
  '#10B981', // emerald-500
  '#F59E0B', // amber-500
  '#EC4899', // pink-500
  '#14B8A6', // teal-500
  '#F43F5E', // rose-500
  '#6366F1', // indigo-500
  '#0EA5E9', // sky-500
  '#84CC16', // lime-500
  '#D946EF', // fuchsia-500
  '#F97316', // orange-500
] as const;

export const getTagHex = (name: string): string => {
  return TAG_HEX_PALETTE[hashTagName(name) % TAG_HEX_PALETTE.length];
};
