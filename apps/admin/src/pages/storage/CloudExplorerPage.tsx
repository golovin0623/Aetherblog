/**
 * @file CloudExplorerPage.tsx
 * @description 云端浏览器 - 面向对象存储治理的管理台。
 *
 * 产品定位:
 *   - 看清当前 provider / prefix 下对象是否已进入媒体库 catalog。
 *   - 对孤儿对象执行导入、复制、打开、删除等治理动作。
 *   - 对已入库对象保持保护态,引导回媒体库完成删除/编辑/备份闭环。
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  Database,
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  HardDrive,
  Import,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { storageProviderService } from '@/services/storageProviderService';
import { Button, ConfirmModal, Select, type SelectOption } from '@aetherblog/ui';
import { cn, formatFileSize } from '@/lib/utils';
import { toast } from 'sonner';

interface ObjectListing {
  key: string;
  url?: string;
  size: number;
  lastModified?: string;
  etag?: string;
  mediaFileId?: number;
  status: 'IN_CATALOG' | 'ORPHAN';
}

type ObjectKind = 'folder' | 'image' | 'video' | 'audio' | 'archive' | 'document' | 'file';

const PAGE_LIMIT = 100;

function normalizePrefix(value: string): string {
  return value.trim().replace(/^\/+/, '');
}

function formatObjectDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getObjectName(key: string): string {
  const trimmed = key.replace(/\/$/, '');
  if (!trimmed) return '/';
  return trimmed.split('/').pop() || trimmed;
}

function getObjectPath(key: string): string {
  const trimmed = key.replace(/\/$/, '');
  const index = trimmed.lastIndexOf('/');
  return index >= 0 ? trimmed.slice(0, index + 1) : '';
}

function getObjectKind(key: string): ObjectKind {
  const lower = key.toLowerCase();
  if (lower.endsWith('/')) return 'folder';
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/.test(lower)) return 'image';
  if (/\.(mp4|mov|webm|avi|mkv|m4v)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|ogg|flac|aac|m4a)$/.test(lower)) return 'audio';
  if (/\.(zip|rar|7z|tar|gz|tgz|bz2)$/.test(lower)) return 'archive';
  if (/\.(pdf|docx?|xlsx?|pptx?|md|txt|csv|json|xml)$/.test(lower)) return 'document';
  return 'file';
}

function ObjectIcon({ kind }: { kind: ObjectKind }) {
  const className = 'w-4 h-4 shrink-0';
  switch (kind) {
    case 'folder':
      return <Folder className={cn(className, 'text-[var(--signal-warn)]')} />;
    case 'image':
      return <FileImage className={cn(className, 'text-[var(--aurora-3)]')} />;
    case 'video':
      return <FileVideo className={cn(className, 'text-[var(--aurora-2)]')} />;
    case 'audio':
      return <FileAudio className={cn(className, 'text-[var(--signal-success)]')} />;
    case 'archive':
      return <FileArchive className={cn(className, 'text-[var(--aurora-1)]')} />;
    case 'document':
      return <FileText className={cn(className, 'text-[var(--signal-info)]')} />;
    default:
      return <File className={cn(className, 'text-[var(--ink-muted)]')} />;
  }
}

function StatusBadge({ item }: { item: ObjectListing }) {
  if (item.status === 'IN_CATALOG') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--signal-success)_28%,transparent)] bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--signal-success)] whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5" />
        已入库
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--signal-warn)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--signal-warn)] whitespace-nowrap">
      <AlertTriangle className="w-3.5 h-3.5" />
      孤儿对象
    </span>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition-colors',
        'text-[var(--ink-secondary)] hover:border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] hover:text-[var(--ink-primary)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]',
        danger && 'hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--signal-danger)]',
        disabled && 'cursor-not-allowed opacity-40 hover:border-transparent hover:bg-transparent hover:text-[var(--ink-secondary)]'
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]">
        <Cloud className="w-6 h-6" />
      </div>
      <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, index) => (
        <tr key={index} className="border-b border-[var(--border-subtle)]">
          <td className="px-4 py-4">
            <div className="h-4 w-4 rounded bg-[var(--bg-secondary)]" />
          </td>
          <td className="px-4 py-4">
            <div className="h-4 w-64 max-w-full rounded bg-[var(--bg-secondary)]" />
          </td>
          <td className="px-4 py-4">
            <div className="h-4 w-16 rounded bg-[var(--bg-secondary)]" />
          </td>
          <td className="px-4 py-4">
            <div className="h-4 w-28 rounded bg-[var(--bg-secondary)]" />
          </td>
          <td className="px-4 py-4">
            <div className="h-6 w-20 rounded-full bg-[var(--bg-secondary)]" />
          </td>
          <td className="px-4 py-4">
            <div className="ml-auto h-8 w-32 rounded-lg bg-[var(--bg-secondary)]" />
          </td>
        </tr>
      ))}
    </>
  );
}

function LoadingCards() {
  return (
    <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] md:hidden">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <div className="h-5 w-5 rounded bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
            <div className="h-9 w-9 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
              <div className="h-3 w-1/2 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
            </div>
          </div>
          <div className="h-9 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]" />
        </div>
      ))}
    </div>
  );
}

export default function CloudExplorerPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [providerId, setProviderId] = useState<number | undefined>(undefined);
  const [prefixInput, setPrefixInput] = useState('');
  const [prefix, setPrefix] = useState('');
  const [currentToken, setCurrentToken] = useState('');
  const [tokenStack, setTokenStack] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: providersResp, isLoading: isProvidersLoading } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => storageProviderService.getAll(),
  });

  const providers = providersResp?.data || [];
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const providerOptions = useMemo<SelectOption[]>(() => {
    return providers.map((provider) => ({
      value: String(provider.id),
      label: `${provider.name} (${provider.providerType})${provider.isDefault ? ' · 默认' : ''}`,
      description: provider.isEnabled ? '可浏览' : '已禁用',
      icon: provider.providerType === 'LOCAL' ? HardDrive : Cloud,
      disabled: !provider.isEnabled,
    }));
  }, [providers]);

  useEffect(() => {
    if (!providerId && providers.length > 0) {
      const firstCloud = providers.find((provider) => provider.providerType !== 'LOCAL' && provider.isEnabled);
      const firstEnabled = providers.find((provider) => provider.isEnabled);
      setProviderId((firstCloud || firstEnabled)?.id);
    }
  }, [providers, providerId]);

  const { data: objectsResp, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['cloud-objects', providerId, prefix, currentToken],
    queryFn: () => storageProviderService.listObjects(providerId!, { prefix, token: currentToken, limit: PAGE_LIMIT }),
    enabled: !!providerId,
  });

  const objects: ObjectListing[] = (objectsResp?.data?.objects || []) as ObjectListing[];
  const nextToken = objectsResp?.data?.nextToken || '';
  const orphanObjects = useMemo(() => objects.filter((item) => item.status === 'ORPHAN'), [objects]);
  const catalogObjects = objects.length - orphanObjects.length;
  const totalSize = useMemo(() => objects.reduce((sum, item) => sum + item.size, 0), [objects]);

  useEffect(() => {
    const visibleOrphanKeys = new Set(orphanObjects.map((item) => item.key));
    setSelectedKeys((prev) => {
      const next = new Set(Array.from(prev).filter((key) => visibleOrphanKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [orphanObjects]);

  const selectedOrphans = useMemo(
    () => orphanObjects.filter((item) => selectedKeys.has(item.key)),
    [orphanObjects, selectedKeys]
  );
  const selectedSize = selectedOrphans.reduce((sum, item) => sum + item.size, 0);
  const allOrphansSelected = orphanObjects.length > 0 && orphanObjects.every((item) => selectedKeys.has(item.key));
  const hasSelection = selectedKeys.size > 0;

  const resetPagingAndSelection = () => {
    setCurrentToken('');
    setTokenStack([]);
    setSelectedKeys(new Set());
  };

  const handleProviderChange = (id: number) => {
    setProviderId(id);
    setPrefix('');
    setPrefixInput('');
    resetPagingAndSelection();
  };

  const applyPrefix = (value = prefixInput) => {
    const normalized = normalizePrefix(value);
    resetPagingAndSelection();
    setPrefixInput(normalized);
    if (normalized === prefix) {
      refetch();
      return;
    }
    setPrefix(normalized);
  };

  const importMutation = useMutation({
    mutationFn: (keys: string[]) => storageProviderService.importObjects(providerId!, keys),
    onSuccess: (resp) => {
      const data = resp?.data;
      const imported = data?.imported || 0;
      const skipped = data?.skippedKeys?.length || 0;
      if (imported > 0) {
        toast.success(`已导入 ${imported} 个对象到媒体库${skipped > 0 ? `, 跳过 ${skipped} 个` : ''}`);
      } else {
        toast.warning('没有对象被导入,可能已入库或云端对象不存在');
      }
      queryClient.invalidateQueries({ queryKey: ['cloud-objects'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      setSelectedKeys(new Set());
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : '导入失败';
      toast.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (keys: string[]) => storageProviderService.deleteObjects(providerId!, keys),
    onSuccess: (resp) => {
      const data = resp?.data;
      const deleted = data?.deleted || 0;
      const refused = data?.refusedKeys?.length || 0;
      if (deleted > 0) {
        toast.success(`已删除 ${deleted} 个云端孤儿对象${refused > 0 ? `, ${refused} 个受保护` : ''}`);
      } else if (refused > 0) {
        toast.warning('选中对象已在媒体库 catalog 中,请走媒体库删除入口');
      }
      queryClient.invalidateQueries({ queryKey: ['cloud-objects'] });
      setSelectedKeys(new Set());
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : '删除失败';
      toast.error(message);
    },
  });

  const copyText = async (value: string, label: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success(`${label}已复制`);
  };

  const toggleObject = (item: ObjectListing) => {
    if (item.status !== 'ORPHAN') return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      return next;
    });
  };

  const toggleAllOrphans = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allOrphansSelected) {
        orphanObjects.forEach((item) => next.delete(item.key));
      } else {
        orphanObjects.forEach((item) => next.add(item.key));
      }
      return next;
    });
  };

  const handleNextPage = () => {
    if (!nextToken) return;
    setTokenStack((stack) => [...stack, currentToken]);
    setCurrentToken(nextToken);
    setSelectedKeys(new Set());
  };

  const handlePrevPage = () => {
    if (tokenStack.length === 0) return;
    const prev = tokenStack[tokenStack.length - 1];
    setTokenStack((stack) => stack.slice(0, -1));
    setCurrentToken(prev);
    setSelectedKeys(new Set());
  };

  const prefixSegments = useMemo(() => {
    const parts = prefix.split('/').filter(Boolean);
    return parts.map((part, index) => ({
      label: part,
      value: parts.slice(0, index + 1).join('/') + '/',
    }));
  }, [prefix]);

  return (
    <div className="flex min-h-full touch-pan-y flex-col px-4 py-4 lg:h-full lg:overflow-hidden lg:px-6 lg:py-5">
      <header className="shrink-0 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]">
                <Cloud className="w-5 h-5" />
              </span>
              <div>
                <h1 className="text-xl font-semibold leading-7 text-[var(--text-primary)] lg:text-2xl">云端浏览器</h1>
                <p className="text-sm leading-6 text-[var(--text-secondary)]">
                  审计 bucket 对象、识别孤儿文件,并把可保留对象纳入媒体库治理。
                </p>
              </div>
            </div>
          </div>
          <Button onClick={() => refetch()} variant="secondary" className="gap-1.5 self-start" disabled={!providerId || isFetching}>
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            刷新
          </Button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_minmax(18rem,1fr)]">
          <div>
            <label htmlFor="cloud-provider-select" className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Provider
            </label>
            <Select
              id="cloud-provider-select"
              ariaLabel="选择存储提供商"
              value={providerId !== undefined ? String(providerId) : ''}
              onValueChange={(next) => {
                if (!next) return;
                handleProviderChange(Number(next));
              }}
              options={providerOptions}
              placeholder="选择存储提供商"
              disabled={isProvidersLoading || providerOptions.length === 0}
              disabledHint={isProvidersLoading ? '加载 provider...' : '暂无存储提供商'}
              className="bg-[var(--bg-input)]"
            />
          </div>

          <div>
            <label htmlFor="cloud-prefix-input" className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Prefix
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  id="cloud-prefix-input"
                  type="text"
                  value={prefixInput}
                  onChange={(event) => setPrefixInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyPrefix();
                  }}
                  placeholder="2026/05/ 或留空查看当前 bucket"
                  className="h-10 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] pl-9 pr-10 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,var(--border-subtle))]"
                />
                {prefixInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setPrefixInput('');
                      applyPrefix('');
                    }}
                    className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
                    aria-label="清空前缀"
                    title="清空前缀"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Button onClick={() => applyPrefix()} variant="secondary" className="shrink-0 gap-1.5">
                <Search className="w-4 h-4" />
                查询
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-2.5 py-1.5">
            {selectedProvider?.providerType === 'LOCAL' ? <HardDrive className="w-3.5 h-3.5" /> : <Cloud className="w-3.5 h-3.5" />}
            {selectedProvider ? `${selectedProvider.name} · ${selectedProvider.providerType}` : '未选择 provider'}
          </span>
          <button
            type="button"
            onClick={() => applyPrefix('')}
            className={cn(
              'rounded-lg px-2.5 py-1.5 transition-colors',
              prefix ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]' : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
            )}
          >
            bucket 根目录
          </button>
          {prefixSegments.map((segment) => (
            <button
              key={segment.value}
              type="button"
              onClick={() => applyPrefix(segment.value)}
              className="rounded-lg px-2.5 py-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
            >
              / {segment.label}
            </button>
          ))}
        </div>
      </header>

      <section className="grid shrink-0 grid-cols-2 gap-2 py-3 sm:gap-3 sm:py-4 xl:grid-cols-4">
        <Metric label="当前页对象" value={objects.length} helper={`${PAGE_LIMIT} 条/页`} icon={<Database className="w-4 h-4" />} />
        <Metric label="孤儿对象" value={orphanObjects.length} helper="可导入或删除" icon={<AlertTriangle className="w-4 h-4" />} tone="warning" />
        <Metric label="已入库" value={catalogObjects} helper="受媒体库保护" icon={<ShieldCheck className="w-4 h-4" />} tone="success" />
        <Metric label="当前页容量" value={formatFileSize(totalSize)} helper={hasSelection ? `已选 ${formatFileSize(selectedSize)}` : '按对象大小汇总'} icon={<HardDrive className="w-4 h-4" />} />
      </section>

      <div className="mb-3 grid shrink-0 items-center gap-3 border-l-2 border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_6%,transparent)] px-3 py-2.5 lg:grid-cols-[1fr_auto] lg:px-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--ink-primary)]">
            {hasSelection ? `已选择 ${selectedOrphans.length} 个孤儿对象` : '勾选孤儿对象后可批量治理'}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-[var(--ink-secondary)] lg:truncate">
            {hasSelection
              ? `合计 ${formatFileSize(selectedSize)}。已入库对象不会进入批量删除,避免绕过媒体库安全流程。`
              : '云端对象分为“已入库”和“孤儿对象”。孤儿对象可导入媒体库或从云端清理,已入库对象请回媒体库处理。'}
          </p>
        </div>
        {hasSelection && (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              disabled={selectedOrphans.length === 0 || importMutation.isPending}
              onClick={() => importMutation.mutate(selectedOrphans.map((item) => item.key))}
              className="gap-1.5"
            >
              <Import className="w-4 h-4" />
              导入媒体库
            </Button>
            <Button
              variant="secondary"
              disabled={selectedOrphans.length === 0}
              onClick={() => copyText(selectedOrphans.map((item) => item.key).join('\n'), '对象 key')}
              className="gap-1.5"
            >
              <Copy className="w-4 h-4" />
              复制 key
            </Button>
            <Button
              variant="secondary"
              disabled={selectedOrphans.length === 0 || deleteMutation.isPending}
              onClick={() => setDeleteConfirmOpen(true)}
              className="gap-1.5 text-[var(--signal-danger)] hover:text-[var(--signal-danger)]"
            >
              <Trash2 className="w-4 h-4" />
              删除孤儿
            </Button>
          </div>
        )}
      </div>

      <main className="min-h-[520px] flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-leaf)] lg:min-h-0">
        {!providerId ? (
          <EmptyState title="请选择一个存储 provider" description="云端浏览器会直接读取 provider 对应 bucket,并与媒体库 catalog 做关联识别。" />
        ) : isLoading ? (
          <div className="h-full overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            <ObjectTable
              objects={[]}
              selectedKeys={selectedKeys}
              allOrphansSelected={allOrphansSelected}
              onToggleAllOrphans={toggleAllOrphans}
              onToggleObject={toggleObject}
              onOpenPrefix={applyPrefix}
              onCopyText={copyText}
              onImport={(item) => importMutation.mutate([item.key])}
              onDelete={(item) => {
                setSelectedKeys(new Set([item.key]));
                setDeleteConfirmOpen(true);
              }}
              onViewMedia={(id) => navigate(`/media?highlight=${id}`)}
              loading
            />
          </div>
        ) : objects.length === 0 ? (
          <EmptyState title="当前前缀下没有对象" description="尝试清空 prefix、切换 provider,或确认对象存储配置中的 path / bucket 是否符合预期。" />
        ) : (
          <div className="h-full overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            <ObjectTable
              objects={objects}
              selectedKeys={selectedKeys}
              allOrphansSelected={allOrphansSelected}
              onToggleAllOrphans={toggleAllOrphans}
              onToggleObject={toggleObject}
              onOpenPrefix={applyPrefix}
              onCopyText={copyText}
              onImport={(item) => importMutation.mutate([item.key])}
              onDelete={(item) => {
                setSelectedKeys(new Set([item.key]));
                setDeleteConfirmOpen(true);
              }}
              onViewMedia={(id) => navigate(`/media?highlight=${id}`)}
              loading={false}
            />
          </div>
        )}
      </main>

      <footer className="mt-3 flex shrink-0 flex-col gap-2 text-xs text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between">
        <span>
          {currentToken ? '当前为后续分页结果' : '当前为第一页'}
          {nextToken ? ' · 仍有下一页' : ' · 已到当前前缀末尾'}
        </span>
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" disabled={tokenStack.length === 0} onClick={handlePrevPage} className="gap-1">
            <ChevronLeft className="w-4 h-4" />
            上一页
          </Button>
          <Button variant="secondary" disabled={!nextToken} onClick={handleNextPage} className="gap-1">
            下一页
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </footer>

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        title="从云端永久删除孤儿对象"
        message={`确定从云端永久删除 ${selectedOrphans.length} 个孤儿对象吗？这不会删除媒体库中的已入库文件,但云端对象删除后无法从 AetherBlog 恢复。`}
        confirmText="永久删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          deleteMutation.mutate(selectedOrphans.map((item) => item.key));
        }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  helper,
  icon,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  helper: string;
  icon: React.ReactNode;
  tone?: 'default' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] text-[var(--signal-success)]'
      : tone === 'warning'
        ? 'bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] text-[var(--signal-warn)]'
        : 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]';

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] px-3 py-2.5 sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-3">
      <span className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9', toneClass)}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--ink-muted)] sm:text-[11px] sm:tracking-[0.12em]">{label}</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-[var(--ink-primary)] tnum sm:text-base">{value}</p>
        <p className="mt-0.5 hidden truncate text-xs text-[var(--ink-secondary)] sm:block">{helper}</p>
      </div>
    </div>
  );
}

function ObjectTable({
  objects,
  selectedKeys,
  allOrphansSelected,
  onToggleAllOrphans,
  onToggleObject,
  onOpenPrefix,
  onCopyText,
  onImport,
  onDelete,
  onViewMedia,
  loading,
}: {
  objects: ObjectListing[];
  selectedKeys: Set<string>;
  allOrphansSelected: boolean;
  onToggleAllOrphans: () => void;
  onToggleObject: (item: ObjectListing) => void;
  onOpenPrefix: (prefix: string) => void;
  onCopyText: (value: string, label: string) => void;
  onImport: (item: ObjectListing) => void;
  onDelete: (item: ObjectListing) => void;
  onViewMedia: (id: number) => void;
  loading: boolean;
}) {
  const allOrphanToggleDisabled = loading || objects.every((item) => item.status !== 'ORPHAN');

  return (
    <div className="h-full">
      <div className="md:hidden">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-4 py-3">
          <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--ink-secondary)]">
            <input
              type="checkbox"
              onChange={onToggleAllOrphans}
              checked={allOrphansSelected}
              disabled={allOrphanToggleDisabled}
              title="选择当前页全部孤儿对象"
              aria-label="选择当前页全部孤儿对象"
              className="h-4 w-4 rounded border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent accent-[var(--aurora-1)] disabled:opacity-40"
            />
            当前页孤儿
          </label>
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            {loading ? '加载中' : `${objects.length} objects`}
          </span>
        </div>

        {loading ? (
          <LoadingCards />
        ) : (
          <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
            {objects.map((item) => {
              const kind = getObjectKind(item.key);
              const selected = selectedKeys.has(item.key);
              const protectedByCatalog = item.status === 'IN_CATALOG';
              const path = getObjectPath(item.key);
              const name = getObjectName(item.key);

              return (
                <article
                  key={item.key}
                  className={cn(
                    'space-y-3 p-4 transition-colors active:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]',
                    selected && 'bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)]'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={protectedByCatalog}
                      onChange={() => onToggleObject(item)}
                      title={protectedByCatalog ? '已入库对象需在媒体库中管理' : '选择孤儿对象'}
                      aria-label={protectedByCatalog ? '已入库对象需在媒体库中管理' : `选择 ${item.key}`}
                      className="mt-1 h-5 w-5 shrink-0 rounded border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent accent-[var(--aurora-1)] disabled:opacity-35"
                    />
                    <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]">
                      <ObjectIcon kind={kind} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-all text-sm font-semibold leading-5 text-[var(--ink-primary)]" title={item.key}>
                            {name}
                          </p>
                          <p className="mt-1 truncate text-xs leading-5 text-[var(--ink-secondary)]" title={item.key}>
                            {path || 'bucket 根目录'}
                          </p>
                        </div>
                        <StatusBadge item={item} />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-2">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">大小</p>
                      <p className="mt-0.5 text-xs font-medium text-[var(--ink-primary)] tnum">{formatFileSize(item.size)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">最后修改</p>
                      <p className="mt-0.5 text-xs font-medium text-[var(--ink-primary)] tnum">{formatObjectDate(item.lastModified)}</p>
                    </div>
                  </div>

                  {item.etag && (
                    <p className="truncate text-[11px] leading-4 text-[var(--ink-muted)]" title={item.etag}>
                      ETag {item.etag.replaceAll('"', '')}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2 border-t border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] pt-2">
                    {kind === 'folder' ? (
                      <button
                        type="button"
                        onClick={() => onOpenPrefix(item.key)}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--aurora-1)] active:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]"
                      >
                        进入前缀
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--ink-muted)]">{protectedByCatalog ? '回媒体库管理' : '可导入或清理'}</span>
                    )}
                    <div className="flex shrink-0 items-center gap-0.5">
                      {item.mediaFileId ? (
                        <IconButton label="在媒体库查看" onClick={() => onViewMedia(item.mediaFileId!)}>
                          <Database className="w-4 h-4" />
                        </IconButton>
                      ) : (
                        <IconButton label="导入到媒体库" onClick={() => onImport(item)}>
                          <Import className="w-4 h-4" />
                        </IconButton>
                      )}
                      <IconButton label="复制 key" onClick={() => onCopyText(item.key, '对象 key')}>
                        <Copy className="w-4 h-4" />
                      </IconButton>
                      <IconButton label="打开对象 URL" onClick={() => item.url && window.open(item.url, '_blank')} disabled={!item.url}>
                        <ExternalLink className="w-4 h-4" />
                      </IconButton>
                      <IconButton label={protectedByCatalog ? '已入库对象不能在这里删除' : '删除云端孤儿对象'} onClick={() => onDelete(item)} disabled={protectedByCatalog} danger>
                        <Trash2 className="w-4 h-4" />
                      </IconButton>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <table className="hidden w-full min-w-[980px] table-fixed border-collapse text-sm md:table">
        <thead className="sticky top-0 z-10 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)]">
          <tr>
            <th className="w-12 px-4 py-3 text-left">
              <input
                type="checkbox"
                onChange={onToggleAllOrphans}
                checked={allOrphansSelected}
                disabled={allOrphanToggleDisabled}
                title="选择当前页全部孤儿对象"
                aria-label="选择当前页全部孤儿对象"
                className="h-4 w-4 rounded border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent accent-[var(--aurora-1)] disabled:opacity-40"
              />
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">对象</th>
            <th className="w-28 px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">大小</th>
            <th className="w-40 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">最后修改</th>
            <th className="w-32 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">状态</th>
            <th className="w-56 px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">操作</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <LoadingRows />
          ) : (
            objects.map((item) => {
              const kind = getObjectKind(item.key);
              const selected = selectedKeys.has(item.key);
              const protectedByCatalog = item.status === 'IN_CATALOG';
              const path = getObjectPath(item.key);
              const name = getObjectName(item.key);

              return (
                <tr
                  key={item.key}
                  className={cn(
                    'border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] transition-colors last:border-b-0',
                    selected ? 'bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]' : 'hover:bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]'
                  )}
                >
                  <td className="px-4 py-3 align-middle">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={protectedByCatalog}
                      onChange={() => onToggleObject(item)}
                      title={protectedByCatalog ? '已入库对象需在媒体库中管理' : '选择孤儿对象'}
                      aria-label={protectedByCatalog ? '已入库对象需在媒体库中管理' : `选择 ${item.key}`}
                      className="h-4 w-4 rounded border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent accent-[var(--aurora-1)] disabled:opacity-35"
                    />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]">
                        <ObjectIcon kind={kind} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-medium leading-5 text-[var(--ink-primary)]" title={item.key}>
                            {name}
                          </p>
                          {kind === 'folder' && (
                            <button
                              type="button"
                              onClick={() => onOpenPrefix(item.key)}
                              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]"
                            >
                              进入
                            </button>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs leading-5 text-[var(--ink-secondary)]" title={item.key}>
                          {path || 'bucket 根目录'}
                        </p>
                        {item.etag && (
                          <p className="mt-0.5 truncate text-[11px] leading-4 text-[var(--ink-muted)]" title={item.etag}>
                            ETag {item.etag.replaceAll('"', '')}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right align-middle text-sm text-[var(--ink-secondary)] tnum">
                    {formatFileSize(item.size)}
                  </td>
                  <td className="px-4 py-3 align-middle text-sm text-[var(--ink-secondary)] tnum">
                    {formatObjectDate(item.lastModified)}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <StatusBadge item={item} />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center justify-end gap-1">
                      {item.mediaFileId ? (
                        <IconButton label="在媒体库查看" onClick={() => onViewMedia(item.mediaFileId!)}>
                          <Database className="w-4 h-4" />
                        </IconButton>
                      ) : (
                        <IconButton label="导入到媒体库" onClick={() => onImport(item)}>
                          <Import className="w-4 h-4" />
                        </IconButton>
                      )}
                      <IconButton label="复制 key" onClick={() => onCopyText(item.key, '对象 key')}>
                        <Copy className="w-4 h-4" />
                      </IconButton>
                      <IconButton label="打开对象 URL" onClick={() => item.url && window.open(item.url, '_blank')} disabled={!item.url}>
                        <ExternalLink className="w-4 h-4" />
                      </IconButton>
                      <IconButton label="复制 URL" onClick={() => item.url && onCopyText(item.url, '对象 URL')} disabled={!item.url}>
                        <Cloud className="w-4 h-4" />
                      </IconButton>
                      <IconButton label={protectedByCatalog ? '已入库对象不能在这里删除' : '删除云端孤儿对象'} onClick={() => onDelete(item)} disabled={protectedByCatalog} danger>
                        <Trash2 className="w-4 h-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
