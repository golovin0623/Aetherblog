import { describe, expect, it } from 'vitest';
import { extractPaletteFromImageUrl } from './musicColorExtractor';

describe('musicColorExtractor', () => {
  it('returns dual-theme fallback palettes on empty or invalid url', async () => {
    const palette = await extractPaletteFromImageUrl('');
    expect(palette.primary).toBeDefined();
    expect(palette.secondary).toBeDefined();
    expect(palette.ambientGlowLight).toContain('radial-gradient');
    expect(palette.ambientGlowDark).toContain('radial-gradient');
  });
});
