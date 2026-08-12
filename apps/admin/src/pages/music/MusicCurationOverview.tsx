import { useMemo } from 'react';
import {
  ArrowRight,
  Disc3,
  FileText,
  Heart,
  Image,
  LibraryBig,
  ListMusic,
  Radio,
  Sparkles,
  Tag,
} from 'lucide-react';
import type { MusicLibrarySummary, MusicTrack } from '@aetherblog/types';
import { cn } from '@/lib/utils';
import { CurationSignalChain } from './CurationSignalChain';
import {
  buildTrackCurationState,
  deriveMusicOverviewCounts,
  type MusicCurationStepKey,
} from './musicCuration';

export interface MusicOverviewLibraryFilter {
  favorite?: 'ALL' | 'FAVORITE' | 'NOT_FAVORITE';
  lyricState?: 'ALL' | 'WITH_LYRIC' | 'WITHOUT_LYRIC' | 'NEEDS_REVIEW';
  coverState?: 'ALL' | 'WITH_COVER' | 'WITHOUT_COVER';
  tagState?: 'ALL' | 'WITH_TAGS' | 'WITHOUT_TAGS';
}

interface MusicCurationOverviewProps {
  summary?: MusicLibrarySummary;
  tracks: MusicTrack[];
  loading: boolean;
  onOpenLibrary: (filter?: MusicOverviewLibraryFilter) => void;
  onOpenLyrics: () => void;
  onOpenPlaylists: () => void;
  onOpenDisplay: () => void;
}

const STEP_ORDER: MusicCurationStepKey[] = [
  'metadata',
  'artwork',
  'tags',
  'lyrics',
  'playlist',
  'publication',
];

const STEP_COPY: Record<MusicCurationStepKey, {
  label: string;
  description: string;
}> = {
  metadata: {
    label: '元数据',
    description: '标题与艺术家已脱离原始文件名',
  },
  artwork: {
    label: '封面',
    description: '歌曲拥有替换或媒体缩略图',
  },
  tags: {
    label: '标签',
    description: '已建立风格、场景或版本语义',
  },
  lyrics: {
    label: '歌词',
    description: '歌词已绑定并可继续复核',
  },
  playlist: {
    label: '歌单',
    description: '至少进入一个策展队列',
  },
  publication: {
    label: '发布',
    description: '歌曲处于可展示状态',
  },
};

function percentage(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

function OverviewAction({
  icon,
  eyebrow,
  title,
  value,
  description,
  tone = 'default',
  onClick,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  value: number;
  description: string;
  tone?: 'default' | 'warn' | 'favorite';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group min-h-36 rounded-[var(--radius-lg)] border p-4 text-left transition-[background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] motion-safe:hover:-translate-y-0.5',
        tone === 'warn'
          ? 'border-[color-mix(in_oklch,var(--signal-warn)_20%,transparent)] bg-[color-mix(in_oklch,var(--signal-warn)_5%,var(--bg-leaf))]'
          : tone === 'favorite'
            ? 'border-[color-mix(in_oklch,#ec496f_20%,transparent)] bg-[color-mix(in_oklch,#ec496f_5%,var(--bg-leaf))]'
            : 'border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] hover:bg-[var(--bg-card-hover)]'
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-xl',
          tone === 'warn'
            ? 'bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)] text-[var(--signal-warn)]'
            : tone === 'favorite'
              ? 'bg-[color-mix(in_oklch,#ec496f_12%,transparent)] text-[#ec496f]'
              : 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]'
        )}>
          {icon}
        </span>
        <ArrowRight className="h-4 w-4 text-[var(--ink-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ink-primary)]" />
      </span>
      <span className="mt-4 block text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
        {eyebrow}
      </span>
      <span className="mt-1 flex items-baseline gap-2">
        <span className="tnum text-2xl font-black text-[var(--ink-primary)]">{value}</span>
        <span className="text-sm font-bold text-[var(--ink-secondary)]">{title}</span>
      </span>
      <span className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">{description}</span>
    </button>
  );
}

export function MusicCurationOverview({
  summary,
  tracks,
  loading,
  onOpenLibrary,
  onOpenLyrics,
  onOpenPlaylists,
  onOpenDisplay,
}: MusicCurationOverviewProps) {
  const states = useMemo(
    () => tracks.map(buildTrackCurationState),
    [tracks]
  );
  const stepCompletion = useMemo(() => {
    const counts = new Map<MusicCurationStepKey, number>(
      STEP_ORDER.map((key) => [key, 0])
    );
    for (const state of states) {
      for (const step of state.steps) {
        if (step.complete) counts.set(step.key, (counts.get(step.key) ?? 0) + 1);
      }
    }
    return counts;
  }, [states]);
  const averageScore = states.length > 0
    ? Math.round(states.reduce((total, state) => total + state.score, 0) / states.length)
    : 0;
  const signalState = {
    score: averageScore,
    steps: STEP_ORDER.map((key) => ({
      key,
      label: STEP_COPY[key].label,
      complete: percentage(stepCompletion.get(key) ?? 0, tracks.length) >= 80,
    })),
    missing: STEP_ORDER.filter(
      (key) => percentage(stepCompletion.get(key) ?? 0, tracks.length) < 80
    ),
  };
  const {
    trackCount,
    missingLyrics,
    missingCovers,
    untaggedTracks,
    favoriteTracks,
  } = useMemo(
    () => deriveMusicOverviewCounts(tracks, summary),
    [summary, tracks]
  );

  return (
    <div className="space-y-4">
      <section className="surface-leaf relative isolate overflow-hidden rounded-[var(--radius-xl)] border border-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)]">
        <div
          className="pointer-events-none absolute -right-20 -top-40 h-[560px] w-[560px] rounded-full opacity-70"
          style={{
            background: [
              'radial-gradient(circle, transparent 0 16%, color-mix(in oklch, var(--aurora-1) 18%, transparent) 16.4% 16.8%, transparent 17.2% 28%)',
              'radial-gradient(circle, transparent 0 34%, color-mix(in oklch, #4cc9d8 18%, transparent) 34.3% 34.7%, transparent 35.1% 46%)',
              'radial-gradient(circle, transparent 0 52%, color-mix(in oklch, #ec496f 14%, transparent) 52.3% 52.7%, transparent 53.1%)',
            ].join(','),
          }}
          aria-hidden="true"
        />
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-8">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--aurora-1)]">
              <Sparkles className="h-3.5 w-3.5" />
              Curatorial signal
            </p>
            <h2 className="mt-3 max-w-3xl text-2xl font-black leading-tight tracking-[-0.03em] text-[var(--ink-primary)] sm:text-4xl">
              把音频文件推进为完整的音乐作品
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-secondary)]">
              策展信号链把元数据、封面、标签、歌词、歌单和发布状态放到同一条生产线上。缺口可直接下钻，不再依赖逐首打开检查。
            </p>
            <div className="mt-6 max-w-2xl">
              <CurationSignalChain state={signalState} />
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpenLibrary()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--ink-primary)] px-4 text-sm font-black text-[var(--bg-void)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
              >
                <LibraryBig className="h-4 w-4" />
                进入歌曲库
              </button>
              <button
                type="button"
                onClick={onOpenLyrics}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_11%,transparent)] px-4 text-sm font-black text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_17%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
              >
                <FileText className="h-4 w-4" />
                打开歌词工作台
              </button>
            </div>
          </div>

          <div className="relative flex min-h-64 items-center justify-center">
            <div className="relative flex h-56 w-56 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)] bg-[radial-gradient(circle,color-mix(in_oklch,var(--aurora-1)_12%,var(--bg-leaf)),var(--bg-leaf)_58%,color-mix(in_oklch,var(--ink-primary)_4%,var(--bg-leaf)))] shadow-[0_32px_90px_-56px_color-mix(in_oklch,var(--aurora-1)_70%,transparent)]">
              <div className="absolute inset-4 rounded-full border border-dashed border-[color-mix(in_oklch,#4cc9d8_28%,transparent)] motion-safe:animate-[spin_28s_linear_infinite] motion-reduce:animate-none" />
              <div className="absolute inset-10 rounded-full border border-[color-mix(in_oklch,#ec496f_22%,transparent)]" />
              <div className="text-center">
                <p className="tnum text-5xl font-black tracking-[-0.06em] text-[var(--ink-primary)]">
                  {loading ? '—' : averageScore}
                  {!loading ? <span className="ml-1 text-lg text-[var(--ink-muted)]">%</span> : null}
                </p>
                <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  整体策展完成度
                </p>
                <p className="mt-1 text-xs text-[var(--ink-secondary)]">{trackCount} 首歌曲</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewAction
          icon={<FileText className="h-5 w-5" />}
          eyebrow="Lyrics gap"
          title="首缺歌词"
          value={missingLyrics}
          description="进入曲库查看未绑定歌词的歌曲"
          tone={missingLyrics > 0 ? 'warn' : 'default'}
          onClick={() => onOpenLibrary({ lyricState: 'WITHOUT_LYRIC' })}
        />
        <OverviewAction
          icon={<Image className="h-5 w-5" />}
          eyebrow="Artwork gap"
          title="首缺封面"
          value={missingCovers}
          description="直接上传、媒体库选择或生成封面"
          tone={missingCovers > 0 ? 'warn' : 'default'}
          onClick={() => onOpenLibrary({ coverState: 'WITHOUT_COVER' })}
        />
        <OverviewAction
          icon={<Tag className="h-5 w-5" />}
          eyebrow="Semantic gap"
          title="首无标签"
          value={untaggedTracks}
          description="补充风格、场景和版本语义"
          tone={untaggedTracks > 0 ? 'warn' : 'default'}
          onClick={() => onOpenLibrary({ tagState: 'WITHOUT_TAGS' })}
        />
        <OverviewAction
          icon={<Heart className="h-5 w-5" />}
          eyebrow="Curator picks"
          title="首已喜爱"
          value={favoriteTracks}
          description="打开策展人收藏视图"
          tone="favorite"
          onClick={() => onOpenLibrary({ favorite: 'FAVORITE' })}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="surface-leaf rounded-[var(--radius-lg)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-[var(--ink-primary)]">信号链健康度</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                以全部曲库歌曲计算；80% 以上视为该环节稳定。
              </p>
            </div>
            <Disc3 className="h-5 w-5 text-[var(--aurora-1)]" />
          </div>
          <div className="mt-5 space-y-4">
            {STEP_ORDER.map((key) => {
              const count = stepCompletion.get(key) ?? 0;
              const progress = percentage(count, tracks.length);
              return (
                <div key={key}>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-black text-[var(--ink-primary)]">{STEP_COPY[key].label}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">{STEP_COPY[key].description}</p>
                    </div>
                    <span className="tnum shrink-0 text-xs font-black text-[var(--ink-secondary)]">
                      {count}/{tracks.length || 0} · {progress}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                    <span
                      className="block h-full origin-left rounded-full bg-[linear-gradient(90deg,var(--aurora-1),#4cc9d8)] transition-transform duration-500 motion-reduce:transition-none"
                      style={{ transform: `scaleX(${progress / 100})` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="surface-leaf rounded-[var(--radius-lg)] p-4 sm:p-5">
          <p className="text-sm font-black text-[var(--ink-primary)]">策展路径</p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            从资产整理到公开播放，每个入口只承担一个明确任务。
          </p>
          <div className="mt-4 space-y-2">
            {[
              {
                icon: <LibraryBig className="h-4 w-4" />,
                label: '歌曲库',
                description: '元数据、标签、收藏与封面',
                onClick: () => onOpenLibrary(),
              },
              {
                icon: <FileText className="h-4 w-4" />,
                label: '歌词工作台',
                description: '上传、修正、审核与绑定',
                onClick: onOpenLyrics,
              },
              {
                icon: <ListMusic className="h-4 w-4" />,
                label: '歌单策展',
                description: '编排顺序、封面与发布候选',
                onClick: onOpenPlaylists,
              },
              {
                icon: <Radio className="h-4 w-4" />,
                label: '展示与播放',
                description: '公开入口、皮肤与播放策略',
                onClick: onOpenDisplay,
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className="group flex min-h-16 w-full items-center gap-3 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] px-3 text-left hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-leaf)] text-[var(--aurora-1)]">
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black text-[var(--ink-primary)]">{item.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--ink-muted)]">{item.description}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-[var(--ink-muted)] transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
