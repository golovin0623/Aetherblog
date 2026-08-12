import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Dices, Loader2, RefreshCcw, Sparkles, X, Sliders } from 'lucide-react';
import { toast } from 'sonner';
import { acquireOverlayScrollLock } from '@/lib/overlayScrollLock';
import { cn } from '@/lib/utils';
import {
  buildResonantCoverComposition,
  hashMusicCoverSeed,
  paintResonantCover,
  renderResonantCoverBlob,
  sanitizeMusicCoverFileName,
  type ResonantCoverPalette,
} from './musicCoverArt';

interface GenerativeCoverStudioProps {
  title: string;
  onClose: () => void;
  onApply: (blob: Blob, fileName: string) => Promise<boolean>;
}

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

const DEFAULT_PALETTE: ResonantCoverPalette = {
  background: '#0d0f14',
  primary: '#ec496f',
  secondary: '#4cc9d8',
  accent: '#7868e6',
};

export default function GenerativeCoverStudio({
  title,
  onClose,
  onApply,
}: GenerativeCoverStudioProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const applyingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [seed, setSeed] = useState(() => hashMusicCoverSeed(title || 'AetherBlog Music'));
  const [orbitCount, setOrbitCount] = useState(9);
  const [turbulence, setTurbulence] = useState(0.8);
  const [palette, setPalette] = useState<ResonantCoverPalette>(DEFAULT_PALETTE);
  const [applying, setApplying] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const deferredSeed = useDeferredValue(seed);
  const deferredOrbitCount = useDeferredValue(orbitCount);
  const deferredTurbulence = useDeferredValue(turbulence);
  const deferredPalette = useDeferredValue(palette);

  applyingRef.current = applying;
  onCloseRef.current = onClose;

  const previewComposition = useMemo(
    () =>
      buildResonantCoverComposition({
        seed: deferredSeed,
        width: 720,
        height: 720,
        particleCount: 1_400,
        orbitCount: deferredOrbitCount,
        turbulence: deferredTurbulence,
      }),
    [deferredOrbitCount, deferredSeed, deferredTurbulence]
  );

  useEffect(() => acquireOverlayScrollLock(), []);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !applyingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      const returnFocus = returnFocusRef.current;
      window.requestAnimationFrame(() => returnFocus?.focus({ preventScroll: true }));
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const frame = window.requestAnimationFrame(() => {
      paintResonantCover(
        context,
        previewComposition,
        deferredPalette,
        canvas.width,
        canvas.height
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deferredPalette, previewComposition]);

  const randomizeSeed = () => {
    const random = window.crypto?.getRandomValues?.(new Uint32Array(1))[0];
    setSeed((random ?? Date.now()) % 2_147_483_647 || 1);
    setActivePresetId(null);
  };

  const applyCover = async () => {
    if (applying) return;
    setApplying(true);
    try {
      const blob = await renderResonantCoverBlob({
        seed,
        orbitCount,
        turbulence,
        palette,
      });
      const applied = await onApply(blob, sanitizeMusicCoverFileName(title));
      if (applied) onClose();
    } catch {
      toast.error('生成封面失败，请稍后重试');
    } finally {
      setApplying(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 sm:p-6 backdrop-blur-md animate-in fade-in duration-200"
      role="presentation"
    >
      <button
        type="button"
        aria-label="关闭生成式封面工坊"
        className="absolute inset-0 cursor-default"
        onClick={() => {
          if (!applying) onClose();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generative-cover-title"
        tabIndex={-1}
        className="relative z-10 grid max-h-[92dvh] w-full max-w-5xl grid-cols-1 overflow-hidden rounded-2xl bg-[var(--bg-void)] border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] shadow-[0_30px_90px_-20px_rgba(0,0,0,0.4)] outline-none min-[820px]:grid-cols-[1.15fr_380px]"
      >
        {/* 左侧：暗室画廊展台 (Algorithmic Art Canvas Exhibition Stage) */}
        <div className="relative flex flex-col items-center justify-center overflow-hidden bg-[#0a0c10] p-6 sm:p-10 border-b min-[820px]:border-b-0 min-[820px]:border-r border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]">
          {/* 细腻环境光晕背景 */}
          <div
            className="pointer-events-none absolute inset-0 opacity-40 blur-3xl transition-all duration-700"
            style={{
              background: `radial-gradient(circle at 40% 30%, ${palette.primary} 0%, transparent 60%), radial-gradient(circle at 80% 80%, ${palette.secondary} 0%, transparent 50%)`
            }}
          />

          <div className="relative z-10 w-full max-w-[420px] space-y-4">
            <div className="flex items-center justify-between text-xs tracking-wider">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: palette.primary }} />
                <span className="font-mono font-bold uppercase text-white/50 text-[11px]">Resonant Cartography</span>
              </div>
              <span className="tnum font-mono text-[11px] text-white/40">#{seed}</span>
            </div>

            {/* 画布容器带黑胶微反光内阴影 */}
            <div className="group relative aspect-square w-full overflow-hidden rounded-2xl shadow-[0_24px_60px_-15px_rgba(0,0,0,0.9)] ring-1 ring-white/10">
              <canvas
                ref={canvasRef}
                width={720}
                height={720}
                className="h-full w-full object-cover transition-transform duration-500 ease-out"
                aria-label="计算艺术封面画幅"
              />
              <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10 rounded-2xl" />
            </div>

            <div className="flex items-center justify-between text-xs text-white/60">
              <span>1200 × 1200 方形母带画幅</span>
              <span className="font-mono text-white/70">P5.js · Chaos Harmonic</span>
            </div>
          </div>
        </div>

        {/* 右侧：专业计算艺术控制台 (Studio Parameter Console) */}
        <div className="flex flex-col justify-between overflow-y-auto bg-[var(--bg-leaf)] p-5 sm:p-6 text-[var(--ink-primary)]">
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
              <div>
                <h2 id="generative-cover-title" className="text-base font-black tracking-tight text-[var(--ink-primary)]">
                  计算艺术封面工坊
                </h2>
                <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                  基于确定性哈希与物理流场生成的原创封面
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={applying}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)] transition-colors"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 灵感配方预设色卡 */}
            <div>
              <div className="mb-2.5 flex items-center justify-between text-xs font-bold text-[var(--ink-secondary)]">
                <span>风格配方 (Presets)</span>
                <span className="text-[10px] text-[var(--ink-muted)] font-normal">一键套用大师配色</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {COVER_PRESETS.map((preset) => {
                  const isActive = activePresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setActivePresetId(preset.id);
                        setOrbitCount(preset.orbits);
                        setTurbulence(preset.turbulence);
                        setPalette(preset.palette);
                      }}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl p-2 text-left border transition-all duration-200',
                        isActive
                          ? 'border-[var(--aurora-1)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] shadow-sm'
                          : 'border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-[var(--bg-substrate)]'
                      )}
                    >
                      <div className="flex -space-x-1 shrink-0">
                        <span className="h-3.5 w-3.5 rounded-full border border-black/20 shadow-sm" style={{ backgroundColor: preset.palette.primary }} />
                        <span className="h-3.5 w-3.5 rounded-full border border-black/20 shadow-sm" style={{ backgroundColor: preset.palette.secondary }} />
                        <span className="h-3.5 w-3.5 rounded-full border border-black/20 shadow-sm" style={{ backgroundColor: preset.palette.accent }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold leading-none text-[var(--ink-primary)]">{preset.tag}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 核心参数微调 */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[var(--ink-secondary)] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[var(--aurora-1)]" />
                  声场生成参数
                </label>
                <button
                  type="button"
                  onClick={randomizeSeed}
                  className="flex items-center gap-1 text-xs font-semibold text-[var(--aurora-1)] hover:underline"
                >
                  <Dices className="w-3.5 h-3.5" />
                  随机种子
                </button>
              </div>

              {/* 谐波轨道 */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-[var(--ink-muted)]">
                  <span>谐波轨道密度 (Orbits)</span>
                  <span className="font-mono font-bold text-[var(--ink-primary)]">{orbitCount}</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={18}
                  step={1}
                  value={orbitCount}
                  onChange={(e) => {
                    setOrbitCount(Number(e.target.value));
                    setActivePresetId(null);
                  }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] accent-[var(--aurora-1)]"
                />
              </div>

              {/* 流场扰动 */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-[var(--ink-muted)]">
                  <span>流场引力扰动 (Turbulence)</span>
                  <span className="font-mono font-bold text-[var(--ink-primary)]">{turbulence.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1.8}
                  step={0.05}
                  value={turbulence}
                  onChange={(e) => {
                    setTurbulence(Number(e.target.value));
                    setActivePresetId(null);
                  }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] accent-[var(--aurora-1)]"
                />
              </div>

              {/* 三色调色板微控 */}
              <div className="pt-1">
                <span className="mb-2 block text-xs text-[var(--ink-muted)]">三色和声色彩微调</span>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['primary', '主色'],
                      ['secondary', '副色'],
                      ['accent', '重音'],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex flex-col items-center gap-1.5 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] p-2 text-center cursor-pointer hover:border-[color-mix(in_oklch,var(--ink-primary)_16%,transparent)] transition-colors"
                    >
                      <input
                        type="color"
                        value={palette[key]}
                        onChange={(e) => {
                          setPalette((prev) => ({ ...prev, [key]: e.target.value }));
                          setActivePresetId(null);
                        }}
                        className="h-7 w-7 cursor-pointer appearance-none rounded-full border-0 bg-transparent"
                      />
                      <span className="text-[10px] font-bold text-[var(--ink-secondary)]">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 底部动作栏 */}
          <div className="mt-8 pt-4 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setOrbitCount(9);
                setTurbulence(0.8);
                setPalette(DEFAULT_PALETTE);
                setSeed(hashMusicCoverSeed(title || 'AetherBlog Music'));
                setActivePresetId(null);
              }}
              disabled={applying}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)] transition-colors disabled:opacity-50"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              重置
            </button>
            <button
              type="button"
              onClick={() => void applyCover()}
              disabled={applying}
              className="flex-1 flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--aurora-1)] text-xs font-bold text-white shadow-md hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {applying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {applying ? '正在导出高清画幅并上传...' : '应用为专辑封面'}
              {!applying && <Check className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
