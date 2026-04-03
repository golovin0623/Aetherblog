// ============================================================
// Color Utility Functions
// 主色调衍生变量生成工具 - 供 admin 和 blog 共享
// ============================================================

/**
 * 将 hex 颜色解析为 RGB 分量
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6 && cleaned.length !== 3) return null;
  const full = cleaned.length === 3
    ? cleaned.split('').map(c => c + c).join('')
    : cleaned;
  const num = parseInt(full, 16);
  if (isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * RGB → HSL
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

/**
 * HSL → hex
 */
export function hslToHex(h: number, s: number, l: number): string {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 根据一个主色生成完整的主色调 CSS 变量集（亮色或暗色主题）
 *
 * 生成变量：
 * - --color-primary
 * - --color-primary-hover
 * - --color-primary-light
 * - --color-primary-lighter
 * - --color-accent
 * - --shadow-primary / --shadow-primary-lg
 * - --gradient-primary
 * - --focus-ring
 */
export function generateColorVars(hex: string, isDark: boolean): Record<string, string> {
  const rgb = hexToRgb(hex);
  if (!rgb) return {};
  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);

  if (isDark) {
    return {
      '--color-primary': hex,
      '--color-primary-hover': hslToHex(h, Math.min(s + 5, 100), Math.min(l + 10, 95)),
      '--color-primary-light': hslToHex(h, Math.min(s + 5, 100), Math.min(l + 15, 95)),
      '--color-primary-lighter': hslToHex(h, Math.max(s - 20, 10), Math.min(l + 25, 95)),
      '--color-accent': hslToHex((h + 30) % 360, s, l),
      '--shadow-primary': `0 4px 14px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`,
      '--shadow-primary-lg': `0 10px 30px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`,
      '--gradient-primary': `linear-gradient(135deg, ${hex} 0%, ${hslToHex((h + 30) % 360, s, l)} 100%)`,
      '--focus-ring': `0 0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`,
    };
  } else {
    return {
      '--color-primary': hex,
      '--color-primary-hover': hslToHex(h, s, Math.max(l - 8, 5)),
      '--color-primary-light': hslToHex(h, Math.max(s - 10, 0), Math.min(l + 20, 90)),
      '--color-primary-lighter': hslToHex(h, Math.max(s - 30, 10), Math.min(l + 50, 95)),
      '--color-accent': hslToHex((h + 30) % 360, s, l),
      '--shadow-primary': `0 4px 14px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
      '--shadow-primary-lg': `0 10px 30px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`,
      '--gradient-primary': `linear-gradient(135deg, ${hex} 0%, ${hslToHex((h + 30) % 360, s, l)} 100%)`,
      '--focus-ring': `0 0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`,
    };
  }
}

/**
 * 将颜色变量集生成为 CSS 文本（用于注入 <style> 标签）
 */
export function colorVarsToCSS(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
}
