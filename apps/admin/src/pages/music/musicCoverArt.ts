// 计算艺术封面 · Resonant Cartography(声场制图)
//
// 渲染分层(全部由 seed 确定性生成,同一身份永远同一张脸):
//   1. 大气层  —— 深色底 + 焦点辉光 + 对角反辉光(非对称氛围,拒绝居中光斑)
//   2. 谐波轨道 —— 倾斜椭圆弧段(带缺口,少数「载波」加重,一条共振环高亮)
//   3. 流丝    —— 沿切向的短曲线,中环带密、核心与边缘留白
//   4. 彗尾    —— 1-3 条重音色长弧,头亮尾隐(每张封面的签名瞬间)
//   5. 核心    —— 小而precise的亮环 + 圆点 + 四向刻度(制图仪式)
//   6. 星尘/颗粒 —— 稀疏亮点 + 胶片颗粒,消除数码平板感
//   7. 渐晕    —— 克制的暗角
//
// 契约:同 seed → 完全相同的 composition;strokes 端点始终在画幅内。

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
  /** 二次曲线控制点(流丝弯曲方向,来自谐波扰动) */
  cx: number;
  cy: number;
  energy: number;
  paletteIndex: number;
}

export interface ResonantCoverArc {
  radius: number;
  squash: number;
  rotation: number;
  start: number;
  span: number;
  width: number;
  alpha: number;
  paletteIndex: number;
  /** 共振载波:更亮更实的少数轨道 */
  emphasis: boolean;
}

export interface ResonantCoverComet {
  radius: number;
  squash: number;
  rotation: number;
  start: number;
  span: number;
  clockwise: boolean;
}

export interface ResonantCoverDust {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

export interface ResonantCoverComposition {
  seed: number;
  center: { x: number; y: number };
  /** 轨道系整体倾角 */
  baseRotation: number;
  rings: Array<{ radius: number; squash: number; phase: number }>;
  arcs: ResonantCoverArc[];
  strokes: ResonantCoverStroke[];
  comets: ResonantCoverComet[];
  dust: ResonantCoverDust[];
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

/** 椭圆参数点(带整体旋转) */
function ellipsePoint(
  cx: number,
  cy: number,
  radius: number,
  squash: number,
  rotation: number,
  theta: number
): { x: number; y: number } {
  const px = Math.cos(theta) * radius;
  const py = Math.sin(theta) * radius * squash;
  return {
    x: cx + px * Math.cos(rotation) - py * Math.sin(rotation),
    y: cy + px * Math.sin(rotation) + py * Math.cos(rotation),
  };
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
  const minDimension = Math.min(width, height);

  // 焦点落在三分线附近,拒绝死板居中
  const center = {
    x: width * (0.36 + random() * 0.26),
    y: height * (0.34 + random() * 0.26),
  };
  // 轨道系整体倾角 ±33°
  const baseRotation = (random() - 0.5) * (Math.PI / 2.7);

  // 轨道半径:内紧外疏的指数间距(真实共振系的呼吸感)
  const rings = Array.from({ length: orbitCount }, (_, index) => {
    const t = (index + 1) / orbitCount;
    return {
      radius: minDimension * (0.1 + 0.52 * Math.pow(t, 1.32)),
      squash: 0.8 + random() * 0.16,
      phase: random() * Math.PI * 2,
    };
  });

  // 谐波弧段:每条轨道 1-3 段,留出呼吸缺口;少数「载波」加重;
  // 随机选一条「正在共振」的轨道高亮
  const emphasisRing = Math.floor(random() * rings.length);
  const arcs: ResonantCoverArc[] = [];
  rings.forEach((ring, ringIndex) => {
    const segmentCount = 1 + Math.floor(random() * 3);
    const isEmphasis = ringIndex === emphasisRing;
    for (let s = 0; s < segmentCount; s += 1) {
      const span = (0.28 + random() * 0.9) * Math.PI * (isEmphasis && s === 0 ? 1.35 : 1);
      arcs.push({
        radius: ring.radius,
        squash: ring.squash,
        rotation: baseRotation + (random() - 0.5) * 0.08,
        start: random() * Math.PI * 2,
        span: Math.min(span, Math.PI * 1.7),
        width: isEmphasis && s === 0 ? 1.7 : 0.55 + random() * 0.9,
        alpha: (isEmphasis && s === 0 ? 0.85 : 0.16 + random() * 0.3) * (1 - (ringIndex / rings.length) * 0.35),
        paletteIndex: random() < 0.62 ? 0 : 1,
        emphasis: isEmphasis && s === 0,
      });
    }
  });

  // 流丝:严格沿轨道切向的微弧 —— 曲率精确贴合椭圆(黑胶沟槽 / 星轨长曝光的质感),
  // 角向用「旋臂」密度调制制造聚簇与留白,拒绝均匀铺满的贴图感。
  const strokes: ResonantCoverStroke[] = [];
  const armCount = 2 + Math.floor(random() * 3);
  const armPhase = random() * Math.PI * 2;
  const radialJitter = minDimension * 0.032 * (0.6 + turbulence * 0.5);
  let attempts = 0;
  const maxAttempts = particleCount * 7;
  while (strokes.length < particleCount && attempts < maxAttempts) {
    attempts += 1;
    // 40% 的流丝聚向共振环邻域 —— 形成一条明确的「活跃带」,而非均匀铺满
    const nearEmphasis = random() < 0.4;
    const ringIndex = nearEmphasis
      ? Math.min(rings.length - 1, Math.max(0, emphasisRing + Math.floor(random() * 3) - 1))
      : Math.floor(random() * rings.length);
    const ring = rings[ringIndex];
    const theta = random() * Math.PI * 2;
    // 旋臂调制:角向密度随谐波起伏,保留少量本底密度
    const armWave = 0.5 + 0.5 * Math.sin(theta * armCount + armPhase + ring.radius * 0.012);
    const armDensity = 0.18 + 0.82 * Math.pow(armWave, 1.7);
    if (random() > armDensity) continue;
    // 半径贴轨道,少量近高斯抖动 —— 碎屑在共振带里
    const radius = ring.radius + (random() + random() - 1) * radialJitter;
    if (radius < minDimension * 0.075) continue;
    // 长度:多数短促,少数拖出长尾
    const longTail = random() < 0.1;
    const arcLength = minDimension * (0.008 + random() * (longTail ? 0.085 : 0.024));
    const delta = arcLength / Math.max(radius, 1);
    // 主方向统一,极少数逆行(打破完美秩序但不破坏流向)
    const direction = random() < 0.9 ? 1 : -1;
    const t1 = theta + delta * direction;
    const tm = theta + (delta / 2) * direction;
    const p0 = ellipsePoint(center.x, center.y, radius, ring.squash, baseRotation, theta);
    const p1 = ellipsePoint(center.x, center.y, radius, ring.squash, baseRotation, t1);
    const pm = ellipsePoint(center.x, center.y, radius, ring.squash, baseRotation, tm);
    // 二次曲线穿过椭圆中点 → 微弧与轨道曲率完全一致
    const cx = 2 * pm.x - (p0.x + p1.x) / 2;
    const cy = 2 * pm.y - (p0.y + p1.y) / 2;

    strokes.push({
      x1: clamp(p0.x, 0, width),
      y1: clamp(p0.y, 0, height),
      x2: clamp(p1.x, 0, width),
      y2: clamp(p1.y, 0, height),
      cx,
      cy,
      energy: Number((longTail ? 0.55 + random() * 0.45 : 0.22 + random() * 0.6).toFixed(4)),
      paletteIndex: random() < 0.55 ? 1 : random() < 0.85 ? 0 : 2,
    });
  }

  // 彗尾:1-3 条重音长弧
  const cometCount = 1 + Math.floor(random() * 2.4);
  const comets: ResonantCoverComet[] = Array.from({ length: cometCount }, () => {
    const ring = rings[Math.floor(rings.length * (0.3 + random() * 0.6))] ?? rings[rings.length - 1];
    return {
      radius: ring.radius * (0.94 + random() * 0.1),
      squash: ring.squash,
      rotation: baseRotation,
      start: random() * Math.PI * 2,
      span: (0.45 + random() * 0.5) * Math.PI,
      clockwise: random() < 0.5,
    };
  });

  // 星尘:沿轨道散布为主,少量自由漂浮
  const dustCount = Math.max(8, Math.round(particleCount / 5));
  const dust: ResonantCoverDust[] = Array.from({ length: dustCount }, () => {
    if (random() < 0.72) {
      const ring = rings[Math.floor(random() * rings.length)];
      const jitter = minDimension * 0.02 * (random() - 0.5);
      const point = ellipsePoint(
        center.x,
        center.y,
        ring.radius + jitter,
        ring.squash,
        baseRotation,
        random() * Math.PI * 2
      );
      return {
        x: clamp(point.x, 0, width),
        y: clamp(point.y, 0, height),
        r: 0.4 + random() * 0.9,
        alpha: 0.12 + random() * 0.4,
      };
    }
    return {
      x: random() * width,
      y: random() * height,
      r: 0.3 + random() * 0.7,
      alpha: 0.05 + random() * 0.22,
    };
  });

  return {
    seed: normalizeSeed(options.seed),
    center,
    baseRotation,
    rings,
    arcs,
    strokes,
    comets,
    dust,
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

/* ----------------------------------------------------------------
 * 绘制
 * ---------------------------------------------------------------- */

function hexToRgb(hex: string): [number, number, number] {
  let value = hex.replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const parsed = Number.parseInt(value.slice(0, 6), 16);
  if (Number.isNaN(parsed)) return [244, 239, 230];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

/** 把颜色向白提亮(核心亮环用) */
function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = clamp(amount, 0, 1);
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`;
}

export function paintResonantCover(
  context: CanvasRenderingContext2D,
  composition: ResonantCoverComposition,
  palette: ResonantCoverPalette,
  width: number,
  height: number
): void {
  const { center, baseRotation } = composition;
  const minDimension = Math.min(width, height);
  // 线宽以 720 画幅为基准缩放,任何尺寸下保持同一笔触气质
  const unit = minDimension / 720;
  // 绘制期确定性随机(颗粒/微扰),与 composition 同 seed 派生
  const random = mulberry32(composition.seed ^ 0x5f356495);

  context.save();
  context.clearRect(0, 0, width, height);

  /* 1 · 大气层:近黑的底,焦点处只留一小团克制的暖光 */
  context.fillStyle = palette.background;
  context.fillRect(0, 0, width, height);

  context.globalCompositeOperation = 'screen';
  const focalGlow = context.createRadialGradient(
    center.x, center.y, 0,
    center.x, center.y, minDimension * 0.3
  );
  focalGlow.addColorStop(0, rgba(palette.primary, 0.17));
  focalGlow.addColorStop(0.55, rgba(palette.primary, 0.05));
  focalGlow.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = focalGlow;
  context.fillRect(0, 0, width, height);

  /* 2 · 谐波轨道弧段 */
  const orbitColors = [palette.primary, palette.secondary];
  for (const arc of composition.arcs) {
    const color = orbitColors[arc.paletteIndex] ?? palette.primary;
    context.beginPath();
    context.strokeStyle = arc.emphasis
      ? rgba(lighten(color, 0.55), Math.min(1, arc.alpha + 0.1))
      : rgba(color, arc.alpha);
    context.lineWidth = Math.max(0.5, arc.width * unit * (arc.emphasis ? 1.25 : 1));
    context.lineCap = 'round';
    context.ellipse(
      center.x, center.y,
      arc.radius, arc.radius * arc.squash,
      arc.rotation,
      arc.start, arc.start + arc.span
    );
    context.stroke();
    // 载波辉光底:一条柔光衬在主线下,让共振环成为画面的光源之一
    if (arc.emphasis) {
      context.beginPath();
      context.strokeStyle = rgba(color, 0.14);
      context.lineWidth = Math.max(2, 7 * unit);
      context.ellipse(
        center.x, center.y,
        arc.radius, arc.radius * arc.squash,
        arc.rotation,
        arc.start, arc.start + arc.span
      );
      context.stroke();
    }
    // 载波的双线:平行细线,制图感
    if (arc.emphasis) {
      context.beginPath();
      context.strokeStyle = rgba(color, arc.alpha * 0.4);
      context.lineWidth = Math.max(0.4, 0.6 * unit);
      const offset = 4.5 * unit;
      context.ellipse(
        center.x, center.y,
        arc.radius + offset, (arc.radius + offset) * arc.squash,
        arc.rotation,
        arc.start + 0.06, arc.start + arc.span - 0.06
      );
      context.stroke();
    }
  }

  /* 3 · 流丝(二次曲线,能量决定亮度与粗细) */
  const strokeColors = [palette.primary, palette.secondary, palette.accent];
  for (const stroke of composition.strokes) {
    const color = strokeColors[stroke.paletteIndex] ?? palette.secondary;
    context.beginPath();
    context.strokeStyle = rgba(color, 0.04 + Math.pow(stroke.energy, 1.9) * 0.55);
    context.lineWidth = Math.max(0.35, stroke.energy * 1.05 * unit);
    context.lineCap = 'round';
    context.moveTo(stroke.x1, stroke.y1);
    context.quadraticCurveTo(stroke.cx, stroke.cy, stroke.x2, stroke.y2);
    context.stroke();
  }

  /* 4 · 星尘 */
  for (const grain of composition.dust) {
    context.beginPath();
    context.fillStyle = rgba(lighten(palette.secondary, 0.5), grain.alpha);
    context.arc(grain.x, grain.y, grain.r * unit, 0, Math.PI * 2);
    context.fill();
  }

  /* 5 · 彗尾:头亮尾隐的长弧(辉光底 + 锐利主线) */
  for (const comet of composition.comets) {
    const segments = 46;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < segments; i += 1) {
        const t0 = i / segments;
        const t1 = (i + 1) / segments;
        const dir = comet.clockwise ? 1 : -1;
        const a0 = comet.start + comet.span * t0 * dir;
        const a1 = comet.start + comet.span * t1 * dir;
        const fade = Math.pow(t0, 1.6); // 尾部渐隐,头部凝实
        context.beginPath();
        if (pass === 0) {
          context.strokeStyle = rgba(palette.accent, 0.16 * fade);
          context.lineWidth = Math.max(2, (2 + 7 * fade) * unit);
        } else {
          context.strokeStyle = rgba(lighten(palette.accent, 0.25), 0.92 * fade);
          context.lineWidth = Math.max(0.6, (0.6 + 2.1 * fade) * unit);
        }
        context.lineCap = 'round';
        context.ellipse(
          center.x, center.y,
          comet.radius, comet.radius * comet.squash,
          comet.rotation,
          Math.min(a0, a1), Math.max(a0, a1)
        );
        context.stroke();
      }
    }
    // 彗头:一点凝聚的光
    const headAngle = comet.start + comet.span * (comet.clockwise ? 1 : -1);
    const head = ellipsePoint(center.x, center.y, comet.radius, comet.squash, comet.rotation, headAngle);
    const headGlow = context.createRadialGradient(head.x, head.y, 0, head.x, head.y, 9 * unit);
    headGlow.addColorStop(0, rgba(lighten(palette.accent, 0.55), 0.95));
    headGlow.addColorStop(0.35, rgba(palette.accent, 0.5));
    headGlow.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = headGlow;
    context.fillRect(head.x - 9 * unit, head.y - 9 * unit, 18 * unit, 18 * unit);
  }

  /* 6 · 核心:小而精密 —— 亮环 + 圆点 + 四向刻度 */
  context.globalCompositeOperation = 'source-over';
  const coreR = 11 * unit;
  // 分离暗圈:把核心从辉光里衬出来
  context.beginPath();
  context.strokeStyle = rgba(palette.background, 0.55);
  context.lineWidth = Math.max(1.4, 3.2 * unit);
  context.arc(center.x, center.y, coreR, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.strokeStyle = rgba(lighten(palette.primary, 0.78), 0.95);
  context.lineWidth = Math.max(0.7, 1.25 * unit);
  context.arc(center.x, center.y, coreR, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.fillStyle = lighten(palette.primary, 0.85);
  context.arc(center.x, center.y, 2.2 * unit, 0, Math.PI * 2);
  context.fill();
  for (let i = 0; i < 4; i += 1) {
    const tickAngle = baseRotation + (Math.PI / 2) * i;
    const inner = coreR + 2.5 * unit;
    const outer = coreR + 6.5 * unit;
    context.beginPath();
    context.strokeStyle = rgba(lighten(palette.primary, 0.7), 0.7);
    context.lineWidth = Math.max(0.5, 0.9 * unit);
    context.moveTo(center.x + Math.cos(tickAngle) * inner, center.y + Math.sin(tickAngle) * inner);
    context.lineTo(center.x + Math.cos(tickAngle) * outer, center.y + Math.sin(tickAngle) * outer);
    context.stroke();
  }

  /* 7 · 胶片颗粒(消除数码平板;小尺寸缩略自动稀疏) */
  context.globalCompositeOperation = 'source-over';
  const grainCount = Math.round((width * height) / 830);
  for (let i = 0; i < grainCount; i += 1) {
    const gx = random() * width;
    const gy = random() * height;
    const bright = random() > 0.45;
    context.fillStyle = bright
      ? `rgba(255,255,255,${0.012 + random() * 0.03})`
      : `rgba(0,0,0,${0.02 + random() * 0.035})`;
    context.fillRect(gx, gy, 1, 1);
  }

  /* 8 · 渐晕:克制,略偏向焦点对侧 */
  const vignette = context.createRadialGradient(
    width * 0.5, height * 0.48,
    minDimension * 0.34,
    width * 0.5, height * 0.52,
    minDimension * 0.85
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
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
