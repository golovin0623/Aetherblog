import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { Dices, Loader2, RefreshCcw, Sparkles, X, Sliders } from 'lucide-react';
import { toast } from 'sonner';
import { acquireOverlayScrollLock } from '@/lib/overlayScrollLock';
import { cn } from '@/lib/utils';
import { solidButtonClass, textButtonClass } from './musicUi';
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

// 预设已抽至 ./coverPresets(与列表缩略图 ResonantThumb 共用同一份调色板);
// 此处 re-export 维持既有对外 API。
export { COVER_PRESETS, type CoverPreset } from './coverPresets';
import { COVER_PRESETS } from './coverPresets';

// 预设块的实时迷你画布 —— 用当前种子渲染,点选前就能看到「这颗种子在那套配方下的样子」
function PresetThumb({ seed, orbits, turbulence, palette }: {
  seed: number;
  orbits: number;
  turbulence: number;
  palette: ResonantCoverPalette;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const px = 96;
    canvas.width = px;
    canvas.height = px;
    const composition = buildResonantCoverComposition({
      seed,
      width: px,
      height: px,
      particleCount: 300,
      orbitCount: Math.min(orbits, 8),
      turbulence,
    });
    paintResonantCover(context, composition, palette, px, px);
  }, [orbits, palette, seed, turbulence]);
  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}

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
              <span>1200 × 1200 · PNG 母带</span>
              <span className="font-mono text-white/70">
                {COVER_PRESETS.find((preset) => preset.id === activePresetId)?.tag ?? '自定义和声'}
              </span>
            </div>
          </div>
        </div>

        {/* 右侧：专业计算艺术控制台 (Studio Parameter Console) */}
        <div className="flex flex-col justify-between overflow-y-auto bg-[var(--bg-leaf)] p-5 sm:p-6 text-[var(--ink-primary)]">
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
              <div>
                <h2 id="generative-cover-title" className="font-display text-lg font-bold tracking-tight text-[var(--ink-primary)]">
                  计算艺术封面工坊
                </h2>
                <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                  确定性种子驱动 —— 同一首歌,永远同一张脸
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
              <div className="mb-2.5 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">风格配方</span>
                <span className="text-[10px] text-[var(--ink-muted)]">点选即换调色与声场</span>
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
                      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]">
                        <PresetThumb
                          seed={seed}
                          orbits={preset.orbits}
                          turbulence={preset.turbulence}
                          palette={preset.palette}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold leading-tight text-[var(--ink-primary)]">{preset.tag}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--ink-muted)]">{preset.name}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 核心参数微调 */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  <Sliders className="w-3.5 h-3.5 text-[var(--aurora-1)]" />
                  声场参数
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
                  className="music-range"
                  style={{ '--range-fill': `${((orbitCount - 4) / 14) * 100}%` } as CSSProperties}
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
                  className="music-range"
                  style={{ '--range-fill': `${((turbulence - 0.1) / 1.7) * 100}%` } as CSSProperties}
                />
              </div>

              {/* 三色调色板微控 */}
              <div className="pt-1">
                <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">三色和声</span>
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
              className={textButtonClass()}
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              重置
            </button>
            <button
              type="button"
              onClick={() => void applyCover()}
              disabled={applying}
              className={cn(solidButtonClass(), 'flex-1')}
            >
              {applying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {applying ? '正在导出母带…' : '应用为专辑封面'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
