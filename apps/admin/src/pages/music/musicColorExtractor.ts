/**
 * 客户端轻量图片色彩与环境光晕色阶提取器 (Dominant & Ambient Color Extractor)
 * 适配 Aether Codex 双主题 (Light / Dark) 优雅低饱和度氛围
 */

export interface ExtractedColorPalette {
  primary: string;
  secondary: string;
  ambientGlowLight: string;
  ambientGlowDark: string;
  isDark: boolean;
}

const DEFAULT_PALETTE: ExtractedColorPalette = {
  primary: 'rgb(99, 102, 241)',
  secondary: 'rgb(168, 85, 247)',
  ambientGlowLight: 'radial-gradient(circle at 85% -10%, rgba(99, 102, 241, 0.08) 0%, transparent 60%), radial-gradient(circle at 10% 110%, rgba(168, 85, 247, 0.05) 0%, transparent 50%)',
  ambientGlowDark: 'radial-gradient(circle at 85% -10%, rgba(99, 102, 241, 0.16) 0%, transparent 60%), radial-gradient(circle at 10% 110%, rgba(168, 85, 247, 0.10) 0%, transparent 50%)',
  isDark: true,
};

export async function extractPaletteFromImageUrl(
  imageUrl: string,
  sampleSize = 32
): Promise<ExtractedColorPalette> {
  if (!imageUrl) return DEFAULT_PALETTE;

  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(DEFAULT_PALETTE);
          return;
        }

        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
        const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

        const buckets: { r: number; g: number; b: number; count: number }[] = [];

        for (let i = 0; i < imageData.length; i += 4) {
          const r = imageData[i];
          const g = imageData[i + 1];
          const b = imageData[i + 2];
          const a = imageData[i + 3];

          if (a < 128) continue;

          const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
          if (brightness > 25 && brightness < 235) {
            const qr = Math.round(r / 32) * 32;
            const qg = Math.round(g / 32) * 32;
            const qb = Math.round(b / 32) * 32;

            const existing = buckets.find(
              (b) => b.r === qr && b.g === qg && b.b === qb
            );
            if (existing) {
              existing.count++;
            } else {
              buckets.push({ r: qr, g: qg, b: qb, count: 1 });
            }
          }
        }

        if (buckets.length === 0) {
          resolve(DEFAULT_PALETTE);
          return;
        }

        buckets.sort((a, b) => b.count - a.count);

        const p = buckets[0];
        const s = buckets[1] || {
          r: Math.min(255, p.r + 30),
          g: Math.max(0, p.g - 20),
          b: Math.min(255, p.b + 40),
          count: 1,
        };

        const primaryStr = `rgb(${p.r}, ${p.g}, ${p.b})`;
        const secondaryStr = `rgb(${s.r}, ${s.g}, ${s.b})`;

        const avgBrightness = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;

        // 亮色与暗色模式分别适配低饱和度与柔和透明度
        const ambientGlowLight = `radial-gradient(circle at 85% -10%, rgba(${p.r}, ${p.g}, ${p.b}, 0.08) 0%, transparent 60%), radial-gradient(circle at 10% 110%, rgba(${s.r}, ${s.g}, ${s.b}, 0.05) 0%, transparent 50%)`;
        const ambientGlowDark = `radial-gradient(circle at 85% -10%, rgba(${p.r}, ${p.g}, ${p.b}, 0.18) 0%, transparent 60%), radial-gradient(circle at 10% 110%, rgba(${s.r}, ${s.g}, ${s.b}, 0.12) 0%, transparent 50%)`;

        resolve({
          primary: primaryStr,
          secondary: secondaryStr,
          ambientGlowLight,
          ambientGlowDark,
          isDark: avgBrightness < 128,
        });
      } catch {
        resolve(DEFAULT_PALETTE);
      }
    };

    img.onerror = () => {
      resolve(DEFAULT_PALETTE);
    };
  });
}
