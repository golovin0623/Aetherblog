export interface ResonantCoverOptions {
  seed: number;
  width: number;
  height: number;
  particleCount: number;
  orbitCount: number;
  turbulence: number;
}

export interface ResonantCoverStroke {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  energy: number;
  paletteIndex: number;
}

export interface ResonantCoverComposition {
  seed: number;
  center: { x: number; y: number };
  rings: Array<{ radius: number; squash: number; phase: number }>;
  strokes: ResonantCoverStroke[];
}

export interface ResonantCoverPalette {
  background: string;
  primary: string;
  secondary: string;
  accent: string;
}

function normalizeSeed(seed: number): number {
  const normalized = Math.abs(Math.trunc(seed)) % 2_147_483_647;
  return normalized || 1;
}

function mulberry32(seed: number): () => number {
  let state = normalizeSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hashMusicCoverSeed(identity: string): number {
  let hash = 2_166_136_261;
  for (const character of identity.normalize('NFKC')) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return normalizeSeed(hash >>> 0);
}

export function buildResonantCoverComposition(
  options: ResonantCoverOptions
): ResonantCoverComposition {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const orbitCount = Math.max(1, Math.round(options.orbitCount));
  const particleCount = Math.max(1, Math.round(options.particleCount));
  const turbulence = clamp(options.turbulence, 0, 2.5);
  const random = mulberry32(options.seed);
  const center = {
    x: width * (0.38 + random() * 0.24),
    y: height * (0.34 + random() * 0.24),
  };
  const minDimension = Math.min(width, height);
  const rings = Array.from({ length: orbitCount }, (_, index) => ({
    radius: minDimension * (0.09 + ((index + 1) / orbitCount) * 0.46),
    squash: 0.84 + random() * 0.13,
    phase: random() * Math.PI * 2,
  }));
  const strokes: ResonantCoverStroke[] = [];

  for (let index = 0; index < particleCount; index += 1) {
    const ringIndex = Math.floor(random() * rings.length);
    const ring = rings[ringIndex];
    const angle = random() * Math.PI * 2;
    const spread = (random() - 0.5) * minDimension * 0.08 * (0.4 + turbulence);
    const radius = ring.radius + spread;
    const x1 = center.x + Math.cos(angle) * radius;
    const y1 = center.y + Math.sin(angle) * radius * ring.squash;
    const harmonic =
      Math.sin(angle * orbitCount + ring.phase) * 0.55 +
      Math.cos(angle * 2.3 + options.seed * 0.0001) * 0.25;
    const tangent = angle + Math.PI / 2 + harmonic * turbulence * 0.34;
    const distance = minDimension * (0.006 + random() * 0.018);
    const rawX2 = x1 + Math.cos(tangent) * distance;
    const rawY2 = y1 + Math.sin(tangent) * distance;

    strokes.push({
      x1: clamp(x1, 0, width),
      y1: clamp(y1, 0, height),
      x2: clamp(rawX2, 0, width),
      y2: clamp(rawY2, 0, height),
      energy: Number((0.35 + random() * 0.65).toFixed(4)),
      paletteIndex: (ringIndex + index) % 3,
    });
  }

  return {
    seed: normalizeSeed(options.seed),
    center,
    rings,
    strokes,
  };
}

export function sanitizeMusicCoverFileName(title: string): string {
  const safeTitle = title
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safeTitle ? `${safeTitle}-cover.png` : 'music-cover.png';
}

export function isCurrentMusicCoverUploadRequest({
  requestId,
  requestOwnerKey,
  currentRequestId,
  currentOwnerKey,
}: {
  requestId: number;
  requestOwnerKey: string;
  currentRequestId: number;
  currentOwnerKey: string;
}): boolean {
  return requestId === currentRequestId && requestOwnerKey === currentOwnerKey;
}

export function paintResonantCover(
  context: CanvasRenderingContext2D,
  composition: ResonantCoverComposition,
  palette: ResonantCoverPalette,
  width: number,
  height: number
): void {
  context.save();
  context.clearRect(0, 0, width, height);

  const baseGradient = context.createLinearGradient(0, 0, width, height);
  baseGradient.addColorStop(0, palette.background);
  baseGradient.addColorStop(0.58, palette.background);
  baseGradient.addColorStop(1, palette.accent);
  context.fillStyle = baseGradient;
  context.fillRect(0, 0, width, height);

  const halo = context.createRadialGradient(
    composition.center.x,
    composition.center.y,
    0,
    composition.center.x,
    composition.center.y,
    Math.min(width, height) * 0.62
  );
  halo.addColorStop(0, `${palette.primary}52`);
  halo.addColorStop(0.46, `${palette.secondary}22`);
  halo.addColorStop(1, `${palette.background}00`);
  context.fillStyle = halo;
  context.fillRect(0, 0, width, height);

  context.globalCompositeOperation = 'screen';
  for (const ring of composition.rings) {
    context.beginPath();
    context.strokeStyle = `${palette.secondary}20`;
    context.lineWidth = Math.max(1, width / 1_200);
    context.ellipse(
      composition.center.x,
      composition.center.y,
      ring.radius,
      ring.radius * ring.squash,
      ring.phase * 0.08,
      0,
      Math.PI * 2
    );
    context.stroke();
  }

  const colors = [palette.primary, palette.secondary, palette.accent];
  for (const stroke of composition.strokes) {
    context.beginPath();
    context.strokeStyle = `${colors[stroke.paletteIndex] ?? palette.primary}${Math.round(
      28 + stroke.energy * 92
    )
      .toString(16)
      .padStart(2, '0')}`;
    context.lineWidth = Math.max(0.65, stroke.energy * (width / 620));
    context.moveTo(stroke.x1, stroke.y1);
    context.lineTo(stroke.x2, stroke.y2);
    context.stroke();
  }

  context.globalCompositeOperation = 'source-over';
  const vignette = context.createRadialGradient(
    width * 0.5,
    height * 0.46,
    Math.min(width, height) * 0.2,
    width * 0.5,
    height * 0.5,
    Math.min(width, height) * 0.78
  );
  vignette.addColorStop(0, '#00000000');
  vignette.addColorStop(1, '#00000088');
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
  context.restore();
}

export async function renderResonantCoverBlob({
  seed,
  orbitCount,
  turbulence,
  palette,
  size = 1_200,
}: {
  seed: number;
  orbitCount: number;
  turbulence: number;
  palette: ResonantCoverPalette;
  size?: number;
}): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建封面画布');
  const composition = buildResonantCoverComposition({
    seed,
    width: size,
    height: size,
    particleCount: 2_800,
    orbitCount,
    turbulence,
  });
  paintResonantCover(context, composition, palette, size, size);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('封面导出失败'));
    }, 'image/png');
  });
}
