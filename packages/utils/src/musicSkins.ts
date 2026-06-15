// ============================================================
// 音乐大厅皮肤预设
// 单一光源种子(亮 / 暗),其余三色由 oklch 在 CSS 中派生
// (见 packages/ui/src/styles/music-skin.css 的 [data-music-skin="…"])。
// 前台切换器与后台 picker 共用此处常量,杜绝两处硬编码漂移。
// ============================================================

export interface MusicSkinPreset {
  /** 与 music-skin.css 的 [data-music-skin="<id>"] 一一对应 */
  id: string;
  /** 中文显示名 */
  label: string;
  /** 亮主题光源种子(需与 music-skin.css 对齐) */
  seedLight: string;
  /** 暗主题光源种子 */
  seedDark: string;
}

export const MUSIC_SKIN_PRESETS = [
  { id: 'crimson', label: '绯红', seedLight: '#DC3D44', seedDark: '#FF6B6E' },
  { id: 'indigo', label: '靛蓝', seedLight: '#6366F1', seedDark: '#818CF8' },
  { id: 'emerald', label: '翡翠', seedLight: '#0E9F6E', seedDark: '#34D399' },
  { id: 'amber', label: '琥珀', seedLight: '#D97706', seedDark: '#FBBF24' },
  { id: 'magenta', label: '品红', seedLight: '#C026A3', seedDark: '#E879F9' },
] as const satisfies readonly MusicSkinPreset[];

export type MusicHallSkinPresetId = (typeof MUSIC_SKIN_PRESETS)[number]['id'];
export type MusicHallSkinMode = 'preset' | 'custom';

/** 默认预设 —— 保留音乐大厅原有的绯红基调(改为派生 + 明暗翻转) */
export const DEFAULT_MUSIC_SKIN_PRESET: MusicHallSkinPresetId = 'crimson';

export const MUSIC_SKIN_PRESET_IDS = MUSIC_SKIN_PRESETS.map((p) => p.id) as readonly MusicHallSkinPresetId[];

export function isMusicSkinPresetId(value: unknown): value is MusicHallSkinPresetId {
  return typeof value === 'string' && MUSIC_SKIN_PRESET_IDS.includes(value as MusicHallSkinPresetId);
}

export function getMusicSkinPreset(id: string | undefined | null): MusicSkinPreset | undefined {
  if (!id) return undefined;
  return MUSIC_SKIN_PRESETS.find((p) => p.id === id);
}

/** 把皮肤配置归一化为一个有效的 data-music-skin 值('custom' 或合法预设 id,否则回落默认) */
export function resolveMusicSkinValue(mode: string | undefined | null, preset: string | undefined | null): string {
  if (mode === 'custom') return 'custom';
  return isMusicSkinPresetId(preset) ? preset : DEFAULT_MUSIC_SKIN_PRESET;
}
