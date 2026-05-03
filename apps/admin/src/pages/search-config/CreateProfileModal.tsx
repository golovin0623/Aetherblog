import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { Loader2, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';
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
  /** code 字段是否被用户手动改过。改过之后停止 auto-suggest,避免覆盖用户意图。 */
  codeTouched: boolean;
}

const DEFAULT_FORM: FormState = {
  code: '',
  name: '',
  description: '',
  modelId: '',
  chunkerKind: 'recursive',
  chunkSizeTokens: 512,
  chunkOverlapTokens: 64,
  codeTouched: false,
};

const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const CHUNK_SIZE_PRESETS = [256, 512, 1024, 2048] as const;

/** 把 model_id 截成 code 安全形态: 取最后一段 / 移除非法字符 / 截到 16 字符。 */
function modelIdToCodeFragment(modelId: string): string {
  const last = modelId.split('/').pop() ?? modelId;
  const safe = last.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  return safe.slice(0, 16);
}

/** 根据当前 form 字段拼一个建议的 code,例如 ``recursive-512-overlap-64``。 */
function suggestCode(form: FormState): string {
  const modelFrag = form.modelId ? modelIdToCodeFragment(form.modelId) : '';
  const parts = [
    form.chunkerKind,
    String(form.chunkSizeTokens),
    'ov',
    String(form.chunkOverlapTokens),
  ];
  if (modelFrag) parts.unshift(modelFrag);
  return parts.join('-').slice(0, 64);
}

/** 从 model.capabilities 解析向量维度,与 CodexModelPicker 同源。 */
function resolveDim(model: AiModel | null | undefined): number | null {
  if (!model) return null;
  const caps = (model.capabilities || {}) as Record<string, unknown>;
  const raw = caps.dim ?? caps.dimension ?? caps.output_dim;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
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

  const onChunkSizeChange = (size: number) => {
    setForm((f) => ({
      ...f,
      chunkSizeTokens: size,
      // overlap 跟随 size 再归一次,但只在用户没手填过 overlap 时生效。简化处理:
      // 当 overlap >= 新 size 时强制下调,否则保留用户值。
      chunkOverlapTokens:
        f.chunkOverlapTokens >= size
          ? Math.max(0, Math.min(2048, Math.floor(size / 8)))
          : f.chunkOverlapTokens,
    }));
  };

  // 当前选中的 embedding 模型(用于显示 dim hint)
  const selectedModel = useMemo(
    () => embeddingModels.find((m) => m.model_id === form.modelId) ?? null,
    [embeddingModels, form.modelId],
  );
  const selectedDim = resolveDim(selectedModel);

  // 实时 code 建议 —— 只要用户没手动改过 code,就持续填充
  const suggested = useMemo(() => suggestCode(form), [form]);
  const effectiveCode = form.codeTouched && form.code ? form.code : suggested;

  const validate = (codeToCheck: string): string | null => {
    if (!CODE_RE.test(codeToCheck)) {
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
    // 用户没手填 code 时回落到 suggested,保证不会卡在"没填 code"上
    const codeToSubmit = (form.codeTouched && form.code ? form.code : suggested).trim();
    const v = validate(codeToSubmit);
    if (v) {
      setError({ message: v });
      return;
    }
    try {
      await createMut.mutateAsync({
        code: codeToSubmit,
        name: form.name.trim(),
        description: form.description.trim() || null,
        modelId: form.modelId,
        chunkerKind: form.chunkerKind,
        chunkSizeTokens: form.chunkSizeTokens,
        chunkOverlapTokens: form.chunkOverlapTokens,
      });
      toast.success(`Profile "${codeToSubmit}" 已创建,status: shadow`, {
        description: '下一步:在主面板选中该 profile,执行全量 reindex 后再激活',
      });
      onClose();
    } catch (err: unknown) {
      // ai-service 现在按 errorCode 返回更细粒度信息(INTERNAL_<EXC_TYPE> / HTTP_409 等),
      // 把它单独显示出来,运维 / 用户可以直接搜文档找解决方法。
      const e2 = err as { message?: string; errorMessage?: string; errorCode?: string };
      setError({
        message: e2.errorMessage || e2.message || '创建失败',
        code: e2.errorCode,
      });
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
              value={effectiveCode}
              onChange={(e) =>
                setForm((f) => ({ ...f, code: e.target.value, codeTouched: true }))
              }
              placeholder={suggested || 'e.g. recursive-512-ov-64'}
              className={inputCls}
              required
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[var(--aurora-1)]/70" />
                {form.codeTouched ? '已手动编辑' : '自动按当前配置生成'}
                <span className="text-[var(--text-muted)]/70"> · 创建后不可改</span>
              </p>
              {form.codeTouched && (
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, code: '', codeTouched: false }))
                  }
                  className="text-xs font-mono text-[var(--aurora-1)] hover:underline"
                >
                  恢复自动生成
                </button>
              )}
            </div>
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
          ) : embeddingModels.length === 0 ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="font-medium">没有可用的 embedding 模型</p>
                <p className="text-xs text-amber-200/80">
                  请先到 <span className="font-mono">AI 配置 → 模型</span> 启用一个
                  embedding 模型(如 <span className="font-mono">text-embedding-3-large</span>
                  或 <span className="font-mono">qwen3-embedding-8b</span>)。
                </p>
                <a
                  href="/admin/ai-config"
                  className="inline-flex items-center gap-1 text-xs font-mono underline-offset-2 hover:underline"
                >
                  打开 AI 配置 <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : (
            <>
              <CodexModelPicker
                models={embeddingModels}
                providers={enabledProviders}
                value={selectedModel}
                onChange={(m) =>
                  setForm((f) => ({ ...f, modelId: m?.model_id ?? '' }))
                }
                placeholder="选择 embedding 模型"
              />
              {selectedModel && (
                <p className="text-xs text-[var(--text-muted)] flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{selectedModel.provider_code}</span>
                  <span>·</span>
                  <span className="font-mono">{selectedModel.model_id}</span>
                  {selectedDim && (
                    <>
                      <span>·</span>
                      <span className="font-mono text-[var(--aurora-1)]">
                        {selectedDim} 维
                      </span>
                    </>
                  )}
                </p>
              )}
            </>
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
                onChunkSizeChange(Number.parseInt(e.target.value, 10) || 512)
              }
              className={inputCls}
              required
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              {CHUNK_SIZE_PRESETS.map((preset) => {
                const active = form.chunkSizeTokens === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onChunkSizeChange(preset)}
                    className={cn(
                      'px-2 py-0.5 rounded-md text-[0.7rem] font-mono transition-colors',
                      active
                        ? 'bg-[var(--aurora-1)] text-white'
                        : 'bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                    )}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              64-8192。parent_child 模式下解释为 child 大小(parent = child × 4)
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
            <p className="text-xs text-[var(--text-muted)]">
              必须 &lt; chunk_size_tokens · 经验值 size/8
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-red-300 break-words">{error.message}</p>
              {error.code && (
                <p className="text-[0.65rem] font-mono uppercase tracking-[0.18em] text-red-400/70">
                  {error.code}
                </p>
              )}
            </div>
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
