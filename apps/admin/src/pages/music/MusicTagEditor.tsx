import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Hash, Loader2, Plus, Search, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import type { MusicTagSummary } from '@aetherblog/types';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { mediaTagService } from '@/services/mediaTagService';

interface MusicTagEditorProps {
  fileId: number;
  initialTags?: MusicTagSummary[];
  onTagsChange?: (tags: MusicTagSummary[]) => void;
}

const MUSIC_TAG_COLORS = [
  '#7868e6',
  '#ec496f',
  '#4cc9d8',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
] as const;

function colorForTagName(name: string): string {
  let hash = 0;
  for (const character of name.normalize('NFKC')) {
    hash = (Math.imul(hash, 31) + (character.codePointAt(0) ?? 0)) | 0;
  }
  return MUSIC_TAG_COLORS[Math.abs(hash) % MUSIC_TAG_COLORS.length];
}

export function MusicTagEditor({
  fileId,
  initialTags = [],
  onTagsChange,
}: MusicTagEditorProps) {
  const queryClient = useQueryClient();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedTags, setSelectedTags] = useState<MusicTagSummary[]>(initialTags);
  const deferredKeyword = useDeferredValue(searchKeyword.trim().toLocaleLowerCase());

  const tagsQuery = useQuery({
    queryKey: ['media-tags'],
    queryFn: () => mediaTagService.getAll(),
    staleTime: 60_000,
  });
  const fileTagsQuery = useQuery({
    queryKey: ['media-file-tags', fileId],
    queryFn: () => mediaTagService.getFileTags(fileId),
    enabled: fileId > 0,
  });

  useEffect(() => {
    if (fileTagsQuery.data?.data) {
      setSelectedTags(fileTagsQuery.data.data);
    } else if (!fileTagsQuery.isFetched) {
      setSelectedTags(initialTags);
    }
  }, [fileTagsQuery.data, fileTagsQuery.isFetched, initialTags]);

  const allTags = tagsQuery.data?.data ?? [];
  const selectedTagIds = useMemo(
    () => new Set(selectedTags.map((tag) => tag.id)),
    [selectedTags]
  );
  const filteredTags = useMemo(() => {
    const sorted = [...allTags].sort((left, right) => {
      const selectedDelta = Number(selectedTagIds.has(right.id)) - Number(selectedTagIds.has(left.id));
      if (selectedDelta !== 0) return selectedDelta;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
    if (!deferredKeyword) return sorted;
    return sorted.filter((tag) => tag.name.toLocaleLowerCase().includes(deferredKeyword));
  }, [allTags, deferredKeyword, selectedTagIds]);

  const publishTags = (next: MusicTagSummary[]) => {
    setSelectedTags(next);
    onTagsChange?.(next);
  };

  const toggleMutation = useMutation({
    mutationFn: async ({
      tag,
      attach,
    }: {
      tag: MusicTagSummary;
      attach: boolean;
      previous: MusicTagSummary[];
    }) => {
      if (attach) {
        await mediaTagService.tagFile(fileId, [tag.id]);
      } else {
        await mediaTagService.untagFile(fileId, tag.id);
      }
      return { tag, attach };
    },
    onMutate: ({ tag, attach, previous }) => {
      const next = attach
        ? [...previous.filter((item) => item.id !== tag.id), tag]
        : previous.filter((item) => item.id !== tag.id);
      publishTags(next);
    },
    onError: (error, variables) => {
      publishTags(variables.previous);
      toast.error(extractApiErrorMessage(error, '更新歌曲标签失败'));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-file-tags', fileId] });
      queryClient.invalidateQueries({ queryKey: ['media-tags'] });
      queryClient.invalidateQueries({ queryKey: ['music-tracks'] });
      queryClient.invalidateQueries({ queryKey: ['music-summary'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const created = await mediaTagService.create({
        name,
        color: colorForTagName(name),
        category: 'CUSTOM',
      });
      await mediaTagService.tagFile(fileId, [created.data.id]);
      return created.data;
    },
    onSuccess: (tag) => {
      const next = [...selectedTags.filter((item) => item.id !== tag.id), tag];
      publishTags(next);
      setNewTagName('');
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ['media-tags'] });
      queryClient.invalidateQueries({ queryKey: ['media-file-tags', fileId] });
      queryClient.invalidateQueries({ queryKey: ['music-tracks'] });
      queryClient.invalidateQueries({ queryKey: ['music-summary'] });
      toast.success(`已创建并添加标签：${tag.name}`);
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '创建标签失败')),
  });

  const createTag = () => {
    const name = newTagName.trim();
    if (!name || createMutation.isPending) return;
    const existing = allTags.find(
      (tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (existing) {
      if (!selectedTagIds.has(existing.id)) {
        toggleMutation.mutate({
          tag: existing,
          attach: true,
          previous: selectedTags,
        });
      }
      setNewTagName('');
      setCreating(false);
      return;
    }
    createMutation.mutate(name);
  };

  return (
    <section className="rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_2%,transparent)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-black text-[var(--ink-primary)]">
            <Tag className="h-3.5 w-3.5 text-[var(--aurora-1)]" />
            音乐标签
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            与媒体库共用同一标签真源；添加和移除会立即保存。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((value) => !value)}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
        >
          {creating ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {creating ? '取消' : '新建'}
        </button>
      </div>

      {creating && (
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <div className="relative">
            <Hash className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  createTag();
                }
              }}
              className="h-11 w-full rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] pl-9 pr-3 text-sm text-[var(--ink-primary)] outline-none focus:border-[var(--aurora-1)]"
              placeholder="例如：夜航、现场、爵士"
              aria-label="新标签名称"
            />
          </div>
          <button
            type="button"
            onClick={createTag}
            disabled={!newTagName.trim() || createMutation.isPending}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] px-3 text-xs font-black text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] disabled:opacity-50"
          >
            {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            创建
          </button>
        </div>
      )}

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
        <input
          value={searchKeyword}
          onChange={(event) => setSearchKeyword(event.target.value)}
          className="h-10 w-full rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_9%,transparent)] bg-[var(--bg-leaf)] pl-9 pr-3 text-xs text-[var(--ink-primary)] outline-none focus:border-[var(--aurora-1)]"
          placeholder="搜索已有标签"
          aria-label="搜索音乐标签"
        />
      </div>

      <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
        {tagsQuery.isLoading ? (
          <span className="inline-flex min-h-11 items-center gap-2 text-xs text-[var(--ink-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在载入标签
          </span>
        ) : filteredTags.length === 0 ? (
          <p className="py-2 text-xs text-[var(--ink-muted)]">
            {deferredKeyword ? '没有匹配标签，可直接新建。' : '还没有媒体标签。'}
          </p>
        ) : (
          filteredTags.map((tag) => {
            const selected = selectedTagIds.has(tag.id);
            const pending = toggleMutation.isPending
              && toggleMutation.variables?.tag.id === tag.id;
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleMutation.mutate({
                  tag,
                  attach: !selected,
                  previous: selectedTags,
                })}
                aria-pressed={selected}
                disabled={pending}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-[background-color,border-color,color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]',
                  selected
                    ? 'text-[var(--ink-primary)]'
                    : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]',
                  pending && 'opacity-55'
                )}
                style={selected ? {
                  borderColor: `${tag.color}88`,
                  backgroundColor: `${tag.color}18`,
                } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
                {selected ? <Check className="h-3 w-3" /> : null}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
