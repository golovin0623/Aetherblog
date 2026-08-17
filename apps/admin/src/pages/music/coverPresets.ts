import type { ResonantCoverPalette } from './musicCoverArt';

// 计算艺术封面预设。抽出为独立模块:封面工作室(懒加载)与列表缩略图(主 chunk)
// 共用同一份调色板,又不会让缩略图把整个工作室拖进首屏包。
export interface CoverPreset {
  id: string;
  name: string;
  tag: string;
  orbits: number;
  turbulence: number;
  palette: ResonantCoverPalette;
}

export const COVER_PRESETS: CoverPreset[] = [
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    tag: '赛博霓虹',
    orbits: 14,
    turbulence: 1.3,
    palette: { background: '#090a0f', primary: '#ff007f', secondary: '#00f0ff', accent: '#ffe600' },
  },
  {
    id: 'nordic',
    name: 'Nordic Minimal',
    tag: '极简北欧',
    orbits: 6,
    turbulence: 0.35,
    palette: { background: '#12141a', primary: '#e2e8f0', secondary: '#64748b', accent: '#38bdf8' },
  },
  {
    id: 'ambient-dusk',
    name: 'Ambient Dusk',
    tag: '落日余晖',
    orbits: 10,
    turbulence: 0.85,
    palette: { background: '#140c1c', primary: '#f43f5e', secondary: '#fb923c', accent: '#c084fc' },
  },
  {
    id: 'abyssal',
    name: 'Abyssal Deep',
    tag: '深海共鸣',
    orbits: 12,
    turbulence: 1.05,
    palette: { background: '#040d1a', primary: '#0ea5e9', secondary: '#10b981', accent: '#6366f1' },
  },
  {
    id: 'retro-vinyl',
    name: 'Retro Vinyl',
    tag: '复古黑胶',
    orbits: 16,
    turbulence: 0.25,
    palette: { background: '#140f0c', primary: '#f59e0b', secondary: '#b45309', accent: '#ef4444' },
  },
  {
    id: 'sakura-lofi',
    name: 'Sakura Pulse',
    tag: '落樱微波',
    orbits: 8,
    turbulence: 0.65,
    palette: { background: '#180e1a', primary: '#f472b6', secondary: '#e879f9', accent: '#fb7185' },
  },
];
