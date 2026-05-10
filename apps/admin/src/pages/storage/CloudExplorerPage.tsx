/**
 * @file CloudExplorerPage.tsx
 * @description 云端浏览器 - admin 直接看到云端 bucket 上的对象,识别 catalog 之外的孤儿
 * @ref 对象存储 rollout - Phase 5
 *
 * 核心交互:
 *   1. 选择 provider → 加载 ListObjects(prefix='') 第一页
 *   2. 每行右侧显示状态徽章: ✓ 已入库 / ⚠ 孤儿
 *   3. 选中孤儿后可批量"导入到媒体库"或"从云端删除"
 *   4. 已入库行只能点"在媒体库中查看"(跳到 /media?highlight=ID)
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Cloud, Folder, FileText, Download, Eye, Trash2, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Loader2, HardDrive } from 'lucide-react';
import { storageProviderService } from '@/services/storageProviderService';
import { Button, ConfirmModal, Select, type SelectOption } from '@aetherblog/ui';
import { formatFileSize } from '@/lib/utils';
import { toast } from 'sonner';

interface ObjectListing {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
  mediaFileId?: number;
  status: 'IN_CATALOG' | 'ORPHAN';
}

export default function CloudExplorerPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [providerId, setProviderId] = useState<number | undefined>(undefined);
  const [prefix, setPrefix] = useState('');
  const [currentToken, setCurrentToken] = useState('');
  const [tokenStack, setTokenStack] = useState<string[]>([]); // 用于"上一页"
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: providersResp, isLoading: isProvidersLoading } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => storageProviderService.getAll(),
  });
  const providers = providersResp?.data || [];
  const providerOptions = useMemo<SelectOption[]>(() => {
    return providers.map((p) => ({
      value: String(p.id),
      label: `${p.name} (${p.providerType})${p.isDefault ? ' — 默认' : ''}`,
      description: p.isEnabled ? '已启用' : '已禁用',
      icon: p.providerType === 'LOCAL' ? HardDrive : Cloud,
      disabled: !p.isEnabled,
    }));
  }, [providers]);

  // 默认选中第一个非 LOCAL 的 enabled provider
  useEffect(() => {
    if (!providerId && providers.length > 0) {
      const firstCloud = providers.find((p) => p.providerType !== 'LOCAL' && p.isEnabled);
      if (firstCloud) {
        setProviderId(firstCloud.id);
      }
    }
  }, [providers, providerId]);

  const { data: objectsResp, isLoading, refetch } = useQuery({
    queryKey: ['cloud-objects', providerId, prefix, currentToken],
    queryFn: () => storageProviderService.listObjects(providerId!, { prefix, token: currentToken, limit: 100 }),
    enabled: !!providerId,
  });
  const objects: ObjectListing[] = (objectsResp?.data?.objects || []) as ObjectListing[];
  const nextToken = objectsResp?.data?.nextToken || '';

  // 重置选中和 token 当 provider 或 prefix 变
  const handleProviderChange = (id: number) => {
    setProviderId(id);
    setPrefix('');
    setCurrentToken('');
    setTokenStack([]);
    setSelectedKeys(new Set());
  };

  const importMutation = useMutation({
    mutationFn: (keys: string[]) => storageProviderService.importObjects(providerId!, keys),
    onSuccess: (resp) => {
      const data = resp?.data;
      const imported = data?.imported || 0;
      const skipped = data?.skippedKeys?.length || 0;
      if (imported > 0) {
        toast.success(`成功导入 ${imported} 个文件${skipped > 0 ? `,跳过 ${skipped}` : ''}`);
      } else {
        toast.warning('未导入任何文件,可能是 key 已经在 catalog 或云端不存在');
      }
      queryClient.invalidateQueries({ queryKey: ['cloud-objects'] });
      setSelectedKeys(new Set());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (keys: string[]) => storageProviderService.deleteObjects(providerId!, keys),
    onSuccess: (resp) => {
      const data = resp?.data;
      const deleted = data?.deleted || 0;
      const refused = data?.refusedKeys?.length || 0;
      if (deleted > 0) {
        toast.success(`已删除 ${deleted} 个云端对象${refused > 0 ? `,${refused} 个因在 catalog 中被拒绝` : ''}`);
      } else if (refused > 0) {
        toast.warning(`所有选中 key 都在 catalog 中,被拒绝删除;请走"媒体管理"删除入口`);
      }
      queryClient.invalidateQueries({ queryKey: ['cloud-objects'] });
      setSelectedKeys(new Set());
    },
  });

  const orphanSelected = useMemo(() => {
    const set = new Set<string>();
    objects.forEach((o) => {
      if (selectedKeys.has(o.key) && o.status === 'ORPHAN') set.add(o.key);
    });
    return set;
  }, [objects, selectedKeys]);

  const handleToggleAllOrphan = () => {
    const orphans = objects.filter((o) => o.status === 'ORPHAN').map((o) => o.key);
    if (orphans.every((k) => selectedKeys.has(k))) {
      // 全选状态 → 清空
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        orphans.forEach((k) => next.delete(k));
        return next;
      });
    } else {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        orphans.forEach((k) => next.add(k));
        return next;
      });
    }
  };

  const handleNextPage = () => {
    if (nextToken) {
      setTokenStack((s) => [...s, currentToken]);
      setCurrentToken(nextToken);
    }
  };

  const handlePrevPage = () => {
    if (tokenStack.length > 0) {
      const prev = tokenStack[tokenStack.length - 1];
      setTokenStack((s) => s.slice(0, -1));
      setCurrentToken(prev);
    }
  };

  return (
    <div className="p-4 lg:p-6 h-full flex flex-col gap-4 lg:gap-6 overflow-hidden">
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2 mb-1">
            <Cloud className="w-5 h-5" /> 云端浏览器
          </h1>
          <p className="text-xs lg:text-sm text-[var(--text-secondary)]">直接查看云端 bucket,导入孤儿文件或清理垃圾</p>
        </div>
        <Button onClick={() => refetch()} variant="secondary" className="gap-1.5">
          <RefreshCw className="w-4 h-4" /> 刷新
        </Button>
      </header>

      <div className="flex flex-col lg:flex-row gap-3 shrink-0">
        {/* Provider 选择 */}
        <div className="flex-1">
          <label htmlFor="cloud-provider-select" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">Provider</label>
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
        <div className="flex-1">
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">Prefix (前缀过滤)</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setCurrentToken('');
                  setTokenStack([]);
                  refetch();
                }
              }}
              placeholder="如: 2026/05/ 或留空查整个 bucket"
              className="flex-1 px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
            />
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg surface-leaf">
          <p className="text-sm text-[var(--text-secondary)]">
            选中 {selectedKeys.size} 项{orphanSelected.size !== selectedKeys.size && ` (孤儿 ${orphanSelected.size})`}
          </p>
          <div className="flex-1" />
          <Button
            disabled={orphanSelected.size === 0 || importMutation.isPending}
            onClick={() => importMutation.mutate(Array.from(orphanSelected))}
            className="gap-1.5"
          >
            <Download className="w-4 h-4" /> 导入到媒体库 ({orphanSelected.size})
          </Button>
          <Button
            variant="secondary"
            disabled={orphanSelected.size === 0 || deleteMutation.isPending}
            onClick={() => setDeleteConfirmOpen(true)}
            className="gap-1.5 text-status-danger"
          >
            <Trash2 className="w-4 h-4" /> 从云端删除
          </Button>
        </div>
      )}

      {/* 对象列表 */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-[var(--border-subtle)]">
        {!providerId ? (
          <div className="text-center py-12 text-[var(--text-muted)]">请先选择 provider</div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> 加载中...
          </div>
        ) : objects.length === 0 ? (
          <div className="text-center py-12 text-[var(--text-muted)]">该前缀下没有对象</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-secondary)]/40">
              <tr>
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    onChange={handleToggleAllOrphan}
                    title="全选/取消选中所有孤儿"
                    className="w-4 h-4"
                    checked={(() => {
                      const orphans = objects.filter((o) => o.status === 'ORPHAN');
                      return orphans.length > 0 && orphans.every((o) => selectedKeys.has(o.key));
                    })()}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Key</th>
                <th className="w-28 px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">大小</th>
                <th className="w-44 px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">最后修改</th>
                <th className="w-32 px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">状态</th>
                <th className="w-32 px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {objects.map((o) => (
                <tr key={o.key} className="hover:bg-[var(--bg-card-hover)]">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(o.key)}
                      onChange={() => {
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(o.key)) next.delete(o.key);
                          else next.add(o.key);
                          return next;
                        });
                      }}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[var(--text-primary)] break-all">
                    <div className="flex items-center gap-2">
                      {o.key.endsWith('/') ? <Folder className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                      {o.key}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-[var(--text-secondary)]">{formatFileSize(o.size)}</td>
                  <td className="px-4 py-2 text-xs text-[var(--text-secondary)] font-mono">
                    {o.lastModified ? new Date(o.lastModified).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-2">
                    {o.status === 'IN_CATALOG' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-500/15 text-zinc-300 text-[11px]">
                        <CheckCircle2 className="w-3 h-3" /> 已入库
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 text-[11px]">
                        <AlertTriangle className="w-3 h-3" /> 孤儿
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {o.status === 'IN_CATALOG' && o.mediaFileId && (
                      <button
                        onClick={() => navigate(`/media?highlight=${o.mediaFileId}`)}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Eye className="w-3 h-3" /> 在媒体库查看
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页 */}
      {(tokenStack.length > 0 || nextToken) && (
        <div className="flex items-center justify-end gap-2 shrink-0">
          <Button
            variant="secondary"
            disabled={tokenStack.length === 0}
            onClick={handlePrevPage}
            className="gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> 上一页
          </Button>
          <Button
            variant="secondary"
            disabled={!nextToken}
            onClick={handleNextPage}
            className="gap-1"
          >
            下一页 <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        title="从云端永久删除"
        message={`确定从云端永久删除 ${orphanSelected.size} 个对象? (catalog 中存在的会被拒绝)`}
        confirmText="确定删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          deleteMutation.mutate(Array.from(orphanSelected));
        }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
