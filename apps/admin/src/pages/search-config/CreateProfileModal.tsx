import { useState, useEffect, type FormEvent } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@aetherblog/ui';
import { CodexModelPicker } from '@/components/ai/CodexModelPicker';
import { ChunkerKindSelector } from './ChunkerKindSelector';
import { useCreateProfile } from '@/hooks/useSearchProfiles';
import { aiProviderService, type AiModel } from '@/services/aiProviderService';
import { useQuery } from '@tanstack/react-query';
import type { ChunkerKind } from '@/services/searchProfileService';
import { cn } from '@/lib/utils';

interface CreateProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  modelId: string;
  chunkerKind: ChunkerKind;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
}

const DEFAULT_FORM: FormState = {
  code: '',
  name: '',
  description: '',
  modelId: '',
  chunkerKind: 'recursive',
  chunkSizeTokens: 512,
  chunkOverlapTokens: 64,
};

const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * 创建 search profile 的表单 Modal。
 *
 * 字段约束（与 ai-service ``CreateSearchProfileRequest`` pydantic 验证保持一致，
 * 客户端先校验避免不必要的网络往返）：
 *   - code: ``^[a-z0-9][a-z0-9_-]{0,63}$``
 *   - name: 1-120 字符
 *   - description: ≤ 500 字符
 *   - chunkSizeTokens: 64-8192
 *   - chunkOverlapTokens: 0-2048 且 < chunkSizeTokens
 */
export function CreateProfileModal({ isOpen, onClose }: CreateProfileModalProps) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);
  const createMut = useCreateProfile();

  // 取已启用 provider 下的 embedding 模型 —— 同 SearchConfigPage 选模型逻辑
  const providersQuery = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiProviderService.listProviders(true),
    select: (res) => res.data || [],
    staleTime: 30_000,
  });
  const enabledProviders = providersQuery.data;
  const enabledProviderCodes = enabledProviders
    ? new Set(enabledProviders.map((p) => p.code))
    : undefined;

  const embeddingModelsQuery = useQuery({
    queryKey: ['embedding-models', enabledProviderCodes ? Array.from(enabledProviderCodes).sort().join(',') : ''],
    queryFn: () => aiProviderService.listModels(undefined, 'embedding'),
    select: (res) =>
      (res.data || []).filter(
        (m: AiModel) => m.is_enabled && (!enabledProviderCodes || enabledProviderCodes.has(m.provider_code))
      ),
    enabled: providersQuery.isSuccess,
  });
  const embeddingModels = embeddingModelsQuery.data || [];

  // 关闭时重置表单
  useEffect(() => {
    if (!isOpen) {
      setForm(DEFAULT_FORM);
      setError(null);
    }
  }, [isOpen]);

  const onChunkerChange = (kind: ChunkerKind, suggested: number) => {
    setForm((f) => ({
      ...f,
      chunkerKind: kind,
      chunkSizeTokens: suggested,
      // overlap 重新归为 chunkSize/8 经验值，确保 < chunkSize 不撞约束
      chunkOverlapTokens: Math.max(0, Math.min(2048, Math.floor(suggested / 8))),
    }));
  };

  const validate = (): string | null => {
    if (!CODE_RE.test(form.code)) {
      return 'code 只能包含小写字母 / 数字 / -, _，必须以字母或数字开头，最长 64 字符';
    }
    if (!form.name.trim() || form.name.length > 120) {
      return 'name 必填且不超过 120 字符';
    }
    if (form.description && form.description.length > 500) {
      return 'description 不超过 500 字符';
    }
    if (!form.modelId.trim()) {
      return '必须选择 embedding 模型';
    }
    if (form.chunkSizeTokens < 64 || form.chunkSizeTokens > 8192) {
      return 'chunk_size_tokens 范围 64-8192';
    }
    if (form.chunkOverlapTokens < 0 || form.chunkOverlapTokens > 2048) {
      return 'chunk_overlap_tokens 范围 0-2048';
    }
    if (form.chunkOverlapTokens >= form.chunkSizeTokens) {
      return 'chunk_overlap_tokens 必须小于 chunk_size_tokens';
    }
    return null;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    try {
      await createMut.mutateAsync({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        modelId: form.modelId,
        chunkerKind: form.chunkerKind,
        chunkSizeTokens: form.chunkSizeTokens,
        chunkOverlapTokens: form.chunkOverlapTokens,
      });
      toast.success(`Profile "${form.code}" 已创建（status: shadow）`);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || '创建失败';
      setError(msg);
    }
  };

  const inputCls =
    'w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg ' +
    'text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] ' +
    'focus:outline-none focus:border-[var(--aurora-1)]/40 focus:ring-1 focus:ring-[var(--aurora-1)]/40 ' +
    'transition-colors';
  const labelCls = 'text-xs font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="创建 Search Profile" size="lg">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className={labelCls}>code</label>
            <input
              type="text"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="e.g. recursive-256-overlap-32"
              className={inputCls}
              autoFocus
              required
            />
            <p className="text-xs text-[var(--text-muted)]">
              小写字母 / 数字 / - / _，唯一标识此 profile（创建后不可改）
            </p>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="给团队看的中文名"
              className={inputCls}
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className={labelCls}>description (可选)</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
            maxLength={500}
            className={inputCls}
            placeholder="为什么要新建这个 profile？做什么实验？"
          />
        </div>

        <div className="space-y-1.5">
          <label className={labelCls}>embedding 模型</label>
          {embeddingModelsQuery.isLoading ? (
            <div className="h-10 surface-leaf !rounded-lg animate-pulse" />
          ) : (
            <CodexModelPicker
              models={embeddingModels}
              providers={enabledProviders}
              value={embeddingModels.find((m) => m.model_id === form.modelId) ?? null}
              onChange={(m) => setForm((f) => ({ ...f, modelId: m?.model_id ?? '' }))}
              placeholder="选择 embedding 模型"
            />
          )}
        </div>

        <div className="space-y-1.5">
          <label className={labelCls}>chunker 策略</label>
          <ChunkerKindSelector
            value={form.chunkerKind}
            onChange={onChunkerChange}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className={labelCls}>chunk_size_tokens</label>
            <input
              type="number"
              min={64}
              max={8192}
              value={form.chunkSizeTokens}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  chunkSizeTokens: Number.parseInt(e.target.value, 10) || 512,
                }))
              }
              className={inputCls}
              required
            />
            <p className="text-xs text-[var(--text-muted)]">
              64-8192。parent_child 模式下解释为 child 大小（parent = child × 4）
            </p>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>chunk_overlap_tokens</label>
            <input
              type="number"
              min={0}
              max={2048}
              value={form.chunkOverlapTokens}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  chunkOverlapTokens: Number.parseInt(e.target.value, 10) || 0,
                }))
              }
              className={inputCls}
              required
            />
            <p className="text-xs text-[var(--text-muted)]">必须 &lt; chunk_size_tokens</p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onClose}
            disabled={createMut.isPending}
            className={cn(
              'px-4 py-2 rounded-lg text-sm',
              'bg-[var(--bg-input)] border border-[var(--border-subtle)]',
              'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              'transition-colors disabled:opacity-50'
            )}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={createMut.isPending}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm',
              'bg-[var(--aurora-1)] text-white',
              'hover:bg-[color-mix(in_oklch,var(--aurora-1)_85%,white)]',
              'transition-colors disabled:opacity-50',
              'shadow-lg shadow-[var(--aurora-1)]/20'
            )}
          >
            {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            创建（shadow 状态）
          </button>
        </div>
      </form>
    </Modal>
  );
}
