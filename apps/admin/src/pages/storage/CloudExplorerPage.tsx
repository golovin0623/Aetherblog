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
  ChevronDown,
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
  FolderOpen,
  HardDrive,
  Import,
  List,
  ListTree,
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
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { AdminCursorPagination } from '@/components/common/AdminPagination';

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
type ObjectViewMode = 'list' | 'tree';

interface ObjectTreeNode {
  id: string;
  type: 'folder' | 'object';
  name: string;
  path: string;
  depth: number;
  size: number;
  objectCount: number;
  orphanCount: number;
  catalogCount: number;
  lastModified?: string;
  object?: ObjectListing;
  children: ObjectTreeNode[];
}

interface MutableObjectTreeNode extends Omit<ObjectTreeNode, 'children'> {
  children: MutableObjectTreeNode[];
  childMap?: Map<string, MutableObjectTreeNode>;
}

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
const EMPTY_OBJECTS: ObjectListing[] = [];

const cloudPanelClass = cn(
  'access-surface surface-leaf surface-admin-panel rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'p-3 shadow-sm sm:p-4'
);

const cloudShellClass = cn(
  'access-surface overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'bg-[var(--bg-leaf)] shadow-[0_18px_48px_-42px_rgba(0,0,0,0.45)]'
);

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

function prefixWithSlash(value: string): string {
  const normalized = normalizePrefix(value);
  return normalized && !normalized.endsWith('/') ? `${normalized}/` : normalized;
}

function getParentPrefix(value: string): string {
  const parts = prefixWithSlash(value).split('/').filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `${parts.join('/')}/` : '';
}

function getRelativeObjectKey(key: string, basePrefix: string): string {
  const normalizedKey = key.replace(/^\/+/, '');
  const normalizedPrefix = prefixWithSlash(basePrefix);
  if (normalizedPrefix && normalizedKey.startsWith(normalizedPrefix)) {
    return normalizedKey.slice(normalizedPrefix.length);
  }
  return normalizedKey;
}

function joinTreePath(basePrefix: string, segments: string[], trailingSlash = false): string {
  const base = prefixWithSlash(basePrefix).replace(/\/$/, '');
  const body = [base, ...segments].filter(Boolean).join('/');
  if (!body) return '';
  return trailingSlash && !body.endsWith('/') ? `${body}/` : body;
}

function newestObjectDate(current: string | undefined, next: string | undefined): string | undefined {
  if (!next) return current;
  if (!current) return next;
  const currentTime = new Date(current).getTime();
  const nextTime = new Date(next).getTime();
  if (Number.isNaN(nextTime)) return current;
  if (Number.isNaN(currentTime)) return next;
  return nextTime > currentTime ? next : current;
}

function applyTreeAggregate(node: MutableObjectTreeNode, item: ObjectListing) {
  node.size += item.size;
  node.objectCount += 1;
  if (item.status === 'ORPHAN') node.orphanCount += 1;
  else node.catalogCount += 1;
  node.lastModified = newestObjectDate(node.lastModified, item.lastModified);
}

function sortTreeNodes(nodes: MutableObjectTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
  nodes.forEach((node) => sortTreeNodes(node.children));
}

function buildObjectTree(objects: ObjectListing[], basePrefix: string): ObjectTreeNode[] {
  const root: MutableObjectTreeNode = {
    id: 'folder:root',
    type: 'folder',
    name: 'bucket 根目录',
    path: prefixWithSlash(basePrefix),
    depth: -1,
    size: 0,
    objectCount: 0,
    orphanCount: 0,
    catalogCount: 0,
    children: [],
    childMap: new Map(),
  };

  objects.forEach((item) => {
    const relativeKey = getRelativeObjectKey(item.key, basePrefix);
    const parts = relativeKey.split('/').filter(Boolean);
    const safeParts = parts.length > 0 ? parts : [getObjectName(item.key)];
    const folderParts = safeParts.slice(0, -1);
    let cursor = root;
    const aggregateTrail: MutableObjectTreeNode[] = [root];

    folderParts.forEach((part, index) => {
      const folderPath = joinTreePath(basePrefix, folderParts.slice(0, index + 1), true);
      let folderNode = cursor.childMap?.get(folderPath);
      if (!folderNode) {
        folderNode = {
          id: `folder:${folderPath}`,
          type: 'folder',
          name: part,
          path: folderPath,
          depth: index,
          size: 0,
          objectCount: 0,
          orphanCount: 0,
          catalogCount: 0,
          children: [],
          childMap: new Map(),
        };
        cursor.childMap?.set(folderPath, folderNode);
        cursor.children.push(folderNode);
      }
      cursor = folderNode;
      aggregateTrail.push(cursor);
    });

    aggregateTrail.forEach((node) => applyTreeAggregate(node, item));
    cursor.children.push({
      id: `object:${item.key}`,
      type: 'object',
      name: safeParts[safeParts.length - 1] || getObjectName(item.key),
      path: item.key,
      depth: folderParts.length,
      size: item.size,
      objectCount: 1,
      orphanCount: item.status === 'ORPHAN' ? 1 : 0,
      catalogCount: item.status === 'IN_CATALOG' ? 1 : 0,
      lastModified: item.lastModified,
      object: item,
      children: [],
    });
  });

  sortTreeNodes(root.children);
  return root.children;
}

function collectExpandedTreePaths(nodes: ObjectTreeNode[]): Set<string> {
  const expanded = new Set<string>();
  const walk = (items: ObjectTreeNode[]) => {
    items.forEach((node) => {
      if (node.type !== 'folder') return;
      expanded.add(node.path);
      walk(node.children);
    });
  };
  walk(nodes);
  return expanded;
}

function flattenTreeNodes(nodes: ObjectTreeNode[], expandedPaths: Set<string>): ObjectTreeNode[] {
  const flattened: ObjectTreeNode[] = [];
  const walk = (items: ObjectTreeNode[]) => {
    items.forEach((node) => {
      flattened.push(node);
      if (node.type === 'folder' && expandedPaths.has(node.path)) {
        walk(node.children);
      }
    });
  };
  walk(nodes);
  return flattened;
}

function countTreeFolders(nodes: ObjectTreeNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.type !== 'folder') return count;
    return count + 1 + countTreeFolders(node.children);
  }, 0);
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
    <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="grid min-w-0 grid-cols-1 items-center gap-3 px-4 py-3 md:min-w-[900px] md:grid-cols-[3rem_minmax(18rem,1fr)_6.5rem_9rem_7rem_12rem]">
          <div className="hidden h-4 w-4 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] md:block" />
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
            <div className="space-y-2">
              <div className="h-4 w-56 rounded bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
              <div className="h-3 w-36 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
            </div>
          </div>
          <div className="h-4 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          <div className="h-4 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          <div className="h-6 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          <div className="ml-auto h-8 w-36 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
        </div>
      ))}
    </div>
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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [objectViewMode, setObjectViewMode] = useState<ObjectViewMode>('list');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: providersResp, isLoading: isProvidersLoading } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => storageProviderService.getAll(),
  });

  const providers = Array.isArray(providersResp?.data) ? providersResp.data : [];
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
    queryKey: ['cloud-objects', providerId, prefix, currentToken, pageSize],
    queryFn: () => storageProviderService.listObjects(providerId!, { prefix, token: currentToken, limit: pageSize }),
    enabled: !!providerId,
  });

  const objects: ObjectListing[] = Array.isArray(objectsResp?.data?.objects)
    ? (objectsResp.data.objects as ObjectListing[])
    : EMPTY_OBJECTS;
  const nextToken = objectsResp?.data?.nextToken || '';
  const orphanObjects = useMemo(() => objects.filter((item) => item.status === 'ORPHAN'), [objects]);
  const catalogObjects = objects.length - orphanObjects.length;
  const totalSize = useMemo(() => objects.reduce((sum, item) => sum + item.size, 0), [objects]);
  const treeNodes = useMemo(() => buildObjectTree(objects, prefix), [objects, prefix]);
  const treeFolderCount = useMemo(() => countTreeFolders(treeNodes), [treeNodes]);
  const expandableTreePaths = useMemo(() => collectExpandedTreePaths(treeNodes), [treeNodes]);
  const allTreeFoldersExpanded =
    expandableTreePaths.size > 0 && Array.from(expandableTreePaths).every((path) => expandedTreePaths.has(path));
  const listRefreshing = isFetching && !isLoading;
  const pageNum = tokenStack.length + 1;
  const rangeStart = objects.length === 0 ? 0 : tokenStack.length * pageSize + 1;
  const rangeEnd = tokenStack.length * pageSize + objects.length;
  const providerLabel = selectedProvider
    ? `${selectedProvider.name} · ${selectedProvider.providerType}`
    : isProvidersLoading
      ? '加载中'
      : '未选择';
  const prefixLabel = prefix || 'bucket 根目录';

  useEffect(() => {
    const visibleOrphanKeys = new Set(orphanObjects.map((item) => item.key));
    setSelectedKeys((prev) => {
      const next = new Set(Array.from(prev).filter((key) => visibleOrphanKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [orphanObjects]);

  useEffect(() => {
    setExpandedTreePaths(new Set(expandableTreePaths));
  }, [expandableTreePaths]);

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

  const handlePageSizeChange = (nextSize: number) => {
    if (!PAGE_SIZE_OPTIONS.includes(nextSize) || nextSize === pageSize) return;
    setPageSize(nextSize);
    resetPagingAndSelection();
  };

  const toggleTreeFolder = (path: string) => {
    setExpandedTreePaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAllTreeFolders = () => {
    setExpandedTreePaths((prev) => {
      const shouldCollapse = expandableTreePaths.size > 0 && Array.from(expandableTreePaths).every((path) => prev.has(path));
      return shouldCollapse ? new Set() : new Set(expandableTreePaths);
    });
  };

  const prefixSegments = useMemo(() => {
    const parts = prefix.split('/').filter(Boolean);
    return parts.map((part, index) => ({
      label: part,
      value: parts.slice(0, index + 1).join('/') + '/',
    }));
  }, [prefix]);
  const parentPrefix = useMemo(() => getParentPrefix(prefix), [prefix]);

  return (
    <div className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          title="云端浏览器"
          description="审计 bucket 对象、识别孤儿文件，并把可保留对象纳入媒体库治理。"
          icon={Cloud}
          currentLabel={listRefreshing ? '同步中' : providerLabel}
          activeSummary={`当前前缀：${prefixLabel} · 第 ${pageNum} 页 · 当前页 ${objects.length} 项 · 容量 ${formatFileSize(totalSize)}`}
          actions={
            <button
              type="button"
              onClick={() => refetch()}
              disabled={!providerId || isFetching}
              className="admin-module-action-button activity-refresh-button"
              data-refreshing={listRefreshing}
              title={listRefreshing ? '正在刷新' : '刷新'}
              aria-label="刷新云端对象"
              aria-busy={listRefreshing}
            >
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {listRefreshing ? '刷新中' : '刷新'}
            </button>
          }
        />

        <div className={cn(cloudPanelClass, 'space-y-4')}>
          <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_minmax(18rem,1.1fr)]">
            <div>
              <label htmlFor="cloud-provider-select" className="mb-1.5 block text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-[var(--ink-muted)]">
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
                className="!h-10 bg-[var(--bg-input)]"
              />
            </div>

            <div>
              <label htmlFor="cloud-prefix-input" className="mb-1.5 block text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Prefix
              </label>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
                  <input
                    id="cloud-prefix-input"
                    type="text"
                    value={prefixInput}
                    onChange={(event) => setPrefixInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') applyPrefix();
                    }}
                    placeholder="2026/05/ 或留空查看当前 bucket"
                    className={cn(
                      'h-10 w-full rounded-lg pl-9 pr-10 text-sm',
                      'border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)]',
                      'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
                      'transition-[border-color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                      'hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]',
                      'focus:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)] focus:outline-none',
                      'focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
                    )}
                  />
                  {prefixInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setPrefixInput('');
                        applyPrefix('');
                      }}
                      className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]"
                      aria-label="清空前缀"
                      title="清空前缀"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Button onClick={() => applyPrefix()} variant="secondary" className="shrink-0 gap-1.5">
                  <Search className="h-4 w-4" />
                  查询
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-secondary)]">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 font-semibold">
              {selectedProvider?.providerType === 'LOCAL' ? <HardDrive className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
              {providerLabel}
            </span>
            <button
              type="button"
              onClick={() => applyPrefix('')}
              className={cn(
                'inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors',
                prefix
                  ? 'text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]'
                  : 'border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] text-[var(--ink-primary)]'
              )}
            >
              bucket 根目录
            </button>
            {prefix && (
              <button
                type="button"
                data-cloud-parent-prefix={parentPrefix}
                onClick={() => applyPrefix(parentPrefix)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs font-semibold text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                返回上一级
              </button>
            )}
            {prefixSegments.map((segment) => (
              <button
                key={segment.value}
                type="button"
                onClick={() => applyPrefix(segment.value)}
                className="inline-flex h-8 items-center rounded-full px-3 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]"
              >
                / {segment.label}
              </button>
            ))}
          </div>
        </div>

        <section className="grid shrink-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          <Metric label="当前页对象" value={objects.length} helper={`${pageSize} 条/页`} icon={<Database className="h-4 w-4" />} />
          <Metric label="孤儿对象" value={orphanObjects.length} helper="可导入或删除" icon={<AlertTriangle className="h-4 w-4" />} tone="warning" />
          <Metric label="已入库" value={catalogObjects} helper="受媒体库保护" icon={<ShieldCheck className="h-4 w-4" />} tone="success" />
          <Metric label="当前页容量" value={formatFileSize(totalSize)} helper={hasSelection ? `已选 ${formatFileSize(selectedSize)}` : '按对象大小汇总'} icon={<HardDrive className="h-4 w-4" />} />
        </section>

        <div className={cn(cloudPanelClass, 'grid shrink-0 items-center gap-3 lg:grid-cols-[1fr_auto]')}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ink-primary)]">
              {hasSelection ? `已选择 ${selectedOrphans.length} 个孤儿对象` : '孤儿对象治理'}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-secondary)] lg:truncate">
              {hasSelection
                ? `合计 ${formatFileSize(selectedSize)}。已入库对象不会进入批量删除，避免绕过媒体库安全流程。`
                : '云端对象分为“已入库”和“孤儿对象”。孤儿对象可导入媒体库或从云端清理，已入库对象请回媒体库处理。'}
            </p>
          </div>
          {hasSelection && (
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Button
                disabled={selectedOrphans.length === 0 || importMutation.isPending}
                onClick={() => importMutation.mutate(selectedOrphans.map((item) => item.key))}
                className="gap-1.5"
              >
                <Import className="h-4 w-4" />
                导入媒体库
              </Button>
              <Button
                variant="secondary"
                disabled={selectedOrphans.length === 0}
                onClick={() => copyText(selectedOrphans.map((item) => item.key).join('\n'), '对象 key')}
                className="gap-1.5"
              >
                <Copy className="h-4 w-4" />
                复制 key
              </Button>
              <Button
                variant="secondary"
                disabled={selectedOrphans.length === 0 || deleteMutation.isPending}
                onClick={() => setDeleteConfirmOpen(true)}
                className="gap-1.5 text-[var(--signal-danger)] hover:text-[var(--signal-danger)]"
              >
                <Trash2 className="h-4 w-4" />
                删除孤儿
              </Button>
            </div>
          )}
        </div>

        <main className={cn(cloudShellClass, 'relative flex min-h-[420px] flex-col')}>
          {listRefreshing && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-[3.65rem] z-20 h-px overflow-hidden bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
            >
              <span className="absolute inset-y-0 w-1/2 animate-pulse rounded-full bg-gradient-to-r from-transparent via-[var(--aurora-1)] to-transparent" />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ink-primary)] text-[var(--bg-void)]">
                {selectedProvider?.providerType === 'LOCAL' ? <HardDrive className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--ink-primary)]">对象清单</p>
                <p className="truncate text-xs text-[var(--ink-muted)]">
                  第 {pageNum} 页 · {prefixLabel}
                  {nextToken ? ' · 可继续翻页' : ' · 当前游标已到末页'}
                </p>
              </div>
            </div>
            <div data-cloud-object-toolbar className="flex flex-wrap items-center justify-end gap-2">
              <span className="inline-flex h-9 min-w-[4.75rem] items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-2.5 text-xs font-semibold text-[var(--ink-muted)]">
                {isLoading
                  ? '加载中'
                  : listRefreshing
                    ? '刷新中'
                    : objectViewMode === 'tree'
                      ? `${objects.length} 项 / ${treeFolderCount} 目录`
                      : `${objects.length} 项`}
              </span>
              <ViewModeSegmented value={objectViewMode} onChange={setObjectViewMode} />
            </div>
          </div>

          <div className="min-w-0">
            {!providerId ? (
              <EmptyState title="请选择一个存储 provider" description="云端浏览器会直接读取 provider 对应 bucket，并与媒体库 catalog 做关联识别。" />
            ) : isLoading ? (
              <div className="overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
                {objectViewMode === 'tree' ? (
                  <ObjectTree
                    nodes={[]}
                    objects={[]}
                    selectedKeys={selectedKeys}
                    expandedPaths={expandedTreePaths}
                    allOrphansSelected={allOrphansSelected}
                    allFoldersExpanded={allTreeFoldersExpanded}
                    parentPrefix={prefix ? parentPrefix : null}
                    onToggleFolder={toggleTreeFolder}
                    onToggleAllFolders={toggleAllTreeFolders}
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
                ) : (
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
                )}
              </div>
            ) : objects.length === 0 ? (
              <EmptyState title="当前前缀下没有对象" description="尝试清空 prefix、切换 provider，或确认对象存储配置中的 path / bucket 是否符合预期。" />
            ) : (
              <div className="overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
                {objectViewMode === 'tree' ? (
                  <ObjectTree
                    nodes={treeNodes}
                    objects={objects}
                    selectedKeys={selectedKeys}
                    expandedPaths={expandedTreePaths}
                    allOrphansSelected={allOrphansSelected}
                    allFoldersExpanded={allTreeFoldersExpanded}
                    parentPrefix={prefix ? parentPrefix : null}
                    onToggleFolder={toggleTreeFolder}
                    onToggleAllFolders={toggleAllTreeFolders}
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
                ) : (
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
                )}
              </div>
            )}
          </div>

          {providerId && (objects.length > 0 || tokenStack.length > 0) && (
            <AdminCursorPagination
              page={pageNum}
              hasPrevious={tokenStack.length > 0}
              hasNext={Boolean(nextToken)}
              onPrevious={handlePrevPage}
              onNext={handleNextPage}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={handlePageSizeChange}
              itemLabel="个"
              pageSizeAriaLabel="每页对象数"
              className="shrink-0"
              summary={
                <>
                  <span>
                    显示 <span className="text-[var(--ink-secondary)]">{rangeStart}-{rangeEnd}</span>
                  </span>
                  <span className="mx-1 text-[var(--ink-subtle)]">·</span>
                  <span>
                    第 <span className="text-[var(--ink-secondary)]">{pageNum}</span> 页
                  </span>
                  <span className="mx-1 text-[var(--ink-subtle)]">·</span>
                  <span className="text-[var(--ink-secondary)]">{nextToken ? '仍有下一页' : '当前末页'}</span>
                </>
              }
            />
          )}
        </main>
      </div>

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

function ViewModeSegmented({
  value,
  onChange,
}: {
  value: ObjectViewMode;
  onChange: (value: ObjectViewMode) => void;
}) {
  const options = [
    { value: 'list' as const, label: '列表', icon: List },
    { value: 'tree' as const, label: '树状', icon: ListTree },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="对象清单视图"
      className="inline-flex h-9 items-center rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-1"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]',
              active
                ? 'bg-[var(--bg-leaf)] text-[var(--ink-primary)] shadow-[0_8px_18px_-16px_rgba(0,0,0,0.45)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function TreeLoadingRows() {
  return (
    <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="grid min-w-0 grid-cols-1 items-center gap-3 px-4 py-3 md:min-w-[900px] md:grid-cols-[3rem_minmax(18rem,1fr)_6.5rem_9rem_7rem_12rem]">
          <div className="hidden h-4 w-4 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] md:block" />
          <div className="flex items-center gap-3" style={{ paddingLeft: `${(index % 3) * 18}px` }}>
            <div className="h-7 w-7 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
            <div className="h-8 w-8 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
            <div className="space-y-2">
              <div className="h-4 w-56 rounded bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
              <div className="h-3 w-36 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
            </div>
          </div>
          <div className="h-4 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          <div className="h-4 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          <div className="h-6 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          <div className="ml-auto h-8 w-36 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
        </div>
      ))}
    </div>
  );
}

function ObjectTree({
  nodes,
  objects,
  selectedKeys,
  expandedPaths,
  allOrphansSelected,
  allFoldersExpanded,
  parentPrefix,
  onToggleFolder,
  onToggleAllFolders,
  onToggleAllOrphans,
  onToggleObject,
  onOpenPrefix,
  onCopyText,
  onImport,
  onDelete,
  onViewMedia,
  loading,
}: {
  nodes: ObjectTreeNode[];
  objects: ObjectListing[];
  selectedKeys: Set<string>;
  expandedPaths: Set<string>;
  allOrphansSelected: boolean;
  allFoldersExpanded: boolean;
  parentPrefix: string | null;
  onToggleFolder: (path: string) => void;
  onToggleAllFolders: () => void;
  onToggleAllOrphans: () => void;
  onToggleObject: (item: ObjectListing) => void;
  onOpenPrefix: (prefix: string) => void;
  onCopyText: (value: string, label: string) => void;
  onImport: (item: ObjectListing) => void;
  onDelete: (item: ObjectListing) => void;
  onViewMedia: (id: number) => void;
  loading: boolean;
}) {
  const flattened = useMemo(() => flattenTreeNodes(nodes, expandedPaths), [nodes, expandedPaths]);
  const allOrphanToggleDisabled = loading || objects.every((item) => item.status !== 'ORPHAN');
  const folderToggleDisabled = loading || nodes.every((node) => node.type !== 'folder');

  return (
    <div className="min-w-0">
      <div
        data-cloud-tree-header
        className="sticky top-0 z-10 grid min-h-14 min-w-0 grid-cols-1 items-center gap-2 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)] md:min-w-[900px] md:grid-cols-[3rem_minmax(18rem,1fr)_6.5rem_9rem_7rem_12rem] md:gap-3"
      >
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            onChange={onToggleAllOrphans}
            checked={allOrphansSelected}
            disabled={allOrphanToggleDisabled}
            title="选择当前页全部孤儿对象"
            aria-label="选择当前页全部孤儿对象"
            className="h-4 w-4 rounded border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent accent-[var(--aurora-1)] disabled:opacity-40"
          />
          <span className="md:hidden">当前页孤儿</span>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0">对象层级</span>
            <button
              type="button"
              onClick={onToggleAllFolders}
              disabled={folderToggleDisabled}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-2.5 text-xs font-semibold normal-case tracking-normal text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] hover:text-[var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ListTree className="h-3.5 w-3.5" />
              {allFoldersExpanded ? '全部折叠' : '全部展开'}
            </button>
            {parentPrefix !== null && (
              <button
                type="button"
                data-cloud-parent-prefix-tree={parentPrefix}
                onClick={() => onOpenPrefix(parentPrefix)}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-2.5 text-xs font-semibold normal-case tracking-normal text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] hover:text-[var(--ink-primary)]"
                aria-label="返回上一级目录"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                返回上一级
              </button>
            )}
          </div>
          <span className="hidden shrink-0 md:inline-flex">数量</span>
        </div>
        <span className="hidden text-right md:block">大小</span>
        <span className="hidden md:block">最后修改</span>
        <span className="hidden md:block">状态</span>
        <span className="hidden text-right md:block">操作</span>
      </div>

      {loading ? (
        <TreeLoadingRows />
      ) : (
        <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
          {flattened.map((node) =>
            node.type === 'folder' ? (
              <TreeFolderRow
                key={node.id}
                node={node}
                expanded={expandedPaths.has(node.path)}
                onToggleFolder={onToggleFolder}
                onOpenPrefix={onOpenPrefix}
                onCopyText={onCopyText}
              />
            ) : (
              <TreeObjectRow
                key={node.id}
                node={node}
                selected={node.object ? selectedKeys.has(node.object.key) : false}
                onToggleObject={onToggleObject}
                onOpenPrefix={onOpenPrefix}
                onCopyText={onCopyText}
                onImport={onImport}
                onDelete={onDelete}
                onViewMedia={onViewMedia}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function TreeFolderRow({
  node,
  expanded,
  onToggleFolder,
  onOpenPrefix,
  onCopyText,
}: {
  node: ObjectTreeNode;
  expanded: boolean;
  onToggleFolder: (path: string) => void;
  onOpenPrefix: (prefix: string) => void;
  onCopyText: (value: string, label: string) => void;
}) {
  return (
    <div
      data-cloud-tree-folder-path={node.path}
      className="grid min-w-0 grid-cols-1 items-center gap-2 bg-[color-mix(in_oklch,var(--signal-warn)_4%,transparent)] px-4 py-3 md:min-w-[900px] md:grid-cols-[3rem_minmax(18rem,1fr)_6.5rem_9rem_7rem_12rem] md:gap-3"
    >
      <div className="hidden items-center md:flex">
        <span className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: `${node.depth * 18}px` }}>
            <button
              type="button"
              onClick={() => onToggleFolder(node.path)}
              aria-label={expanded ? '收起目录' : '展开目录'}
              title={expanded ? '收起目录' : '展开目录'}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)] text-[var(--signal-warn)]">
              {expanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--ink-primary)]" title={node.path}>
                {node.name}
              </p>
              <p className="mt-0.5 truncate text-xs leading-5 text-[var(--ink-secondary)]" title={node.path}>
                {node.path}
              </p>
            </div>
          </div>
          <TreeQuantityBadge count={node.objectCount} className="hidden shrink-0 md:inline-flex" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden" style={{ paddingLeft: `${node.depth * 18 + 36}px` }}>
          <TreeQuantityBadge count={node.objectCount} />
          <TreeStatusBadges node={node} />
        </div>
      </div>
      <span className="hidden text-right text-sm font-medium text-[var(--ink-secondary)] tnum md:block">{formatFileSize(node.size)}</span>
      <span className="hidden text-sm text-[var(--ink-secondary)] tnum md:block">{formatObjectDate(node.lastModified)}</span>
      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-1.5">
        <TreeStatusBadges node={node} />
      </div>
      <div className="flex items-center justify-start gap-1.5 pl-9 md:justify-end md:pl-0">
        <button
          type="button"
          data-cloud-tree-enter-prefix={node.path}
          onClick={() => onOpenPrefix(node.path)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] px-2.5 text-xs font-semibold text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          进入
        </button>
        <IconButton label="复制目录前缀" onClick={() => onCopyText(node.path, '目录前缀')}>
          <Copy className="w-4 h-4" />
        </IconButton>
      </div>
    </div>
  );
}

function TreeQuantityBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      data-cloud-tree-folder-count
      className={cn(
        'items-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink-secondary)] tnum',
        className || 'inline-flex'
      )}
    >
      {count} 项
    </span>
  );
}

function TreeStatusBadges({ node }: { node: ObjectTreeNode }) {
  return (
    <>
      {node.orphanCount > 0 && (
        <span className="inline-flex items-center rounded-full border border-[color-mix(in_oklch,var(--signal-warn)_28%,transparent)] bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--signal-warn)]">
          {node.orphanCount} 孤儿
        </span>
      )}
      {node.catalogCount > 0 && (
        <span className="inline-flex items-center rounded-full border border-[color-mix(in_oklch,var(--signal-success)_24%,transparent)] bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--signal-success)]">
          {node.catalogCount} 入库
        </span>
      )}
    </>
  );
}

function TreeObjectRow({
  node,
  selected,
  onToggleObject,
  onOpenPrefix,
  onCopyText,
  onImport,
  onDelete,
  onViewMedia,
}: {
  node: ObjectTreeNode;
  selected: boolean;
  onToggleObject: (item: ObjectListing) => void;
  onOpenPrefix: (prefix: string) => void;
  onCopyText: (value: string, label: string) => void;
  onImport: (item: ObjectListing) => void;
  onDelete: (item: ObjectListing) => void;
  onViewMedia: (id: number) => void;
}) {
  const item = node.object;
  if (!item) return null;

  const kind = getObjectKind(item.key);
  const protectedByCatalog = item.status === 'IN_CATALOG';
  const path = getObjectPath(item.key);

  return (
    <div
      data-cloud-tree-object-path={item.key}
      className={cn(
        'grid min-w-0 grid-cols-1 items-center gap-2 px-4 py-3 transition-colors md:min-w-[900px] md:grid-cols-[3rem_minmax(18rem,1fr)_6.5rem_9rem_7rem_12rem] md:gap-3',
        selected ? 'bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]' : 'hover:bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]'
      )}
    >
      <div className="flex items-center">
        <input
          type="checkbox"
          checked={selected}
          disabled={protectedByCatalog}
          onChange={() => onToggleObject(item)}
          title={protectedByCatalog ? '已入库对象需在媒体库中管理' : '选择孤儿对象'}
          aria-label={protectedByCatalog ? '已入库对象需在媒体库中管理' : `选择 ${item.key}`}
          className="h-4 w-4 shrink-0 rounded border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent accent-[var(--aurora-1)] disabled:opacity-35"
        />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-3" style={{ paddingLeft: `${node.depth * 18}px` }}>
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]">
            <ObjectIcon kind={kind} />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium leading-5 text-[var(--ink-primary)]" title={item.key}>
                {node.name}
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
      </div>
      <span className="pl-9 text-left text-sm text-[var(--ink-secondary)] tnum md:pl-0 md:text-right">{formatFileSize(item.size)}</span>
      <span className="pl-9 text-sm text-[var(--ink-secondary)] tnum md:pl-0">{formatObjectDate(item.lastModified)}</span>
      <div className="pl-9 md:pl-0">
        <StatusBadge item={item} />
      </div>
      <div className="flex items-center justify-start gap-1 pl-9 md:justify-end md:pl-0">
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
    <div className="min-w-0">
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

      <div className="hidden min-w-[900px] text-sm md:block">
        <div
          data-cloud-list-header
          className="sticky top-0 z-10 grid min-h-14 min-w-0 grid-cols-1 items-center gap-2 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)] md:min-w-[900px] md:grid-cols-[3rem_minmax(18rem,1fr)_6.5rem_9rem_7rem_12rem] md:gap-3"
        >
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              onChange={onToggleAllOrphans}
              checked={allOrphansSelected}
              disabled={allOrphanToggleDisabled}
              title="选择当前页全部孤儿对象"
              aria-label="选择当前页全部孤儿对象"
              className="h-4 w-4 rounded border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent accent-[var(--aurora-1)] disabled:opacity-40"
            />
          </div>
          <span>对象</span>
          <span className="text-right">大小</span>
          <span>最后修改</span>
          <span>状态</span>
          <span className="text-right">操作</span>
        </div>

        {loading ? (
          <LoadingRows />
        ) : (
          <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
            {objects.map((item) => {
              const kind = getObjectKind(item.key);
              const selected = selectedKeys.has(item.key);
              const protectedByCatalog = item.status === 'IN_CATALOG';
              const path = getObjectPath(item.key);
              const name = getObjectName(item.key);

              return (
                <div
                  key={item.key}
                  data-cloud-list-row
                  className={cn(
                    'grid min-w-0 grid-cols-1 items-center gap-2 px-4 py-3 transition-colors md:min-w-[900px] md:grid-cols-[3rem_minmax(18rem,1fr)_6.5rem_9rem_7rem_12rem] md:gap-3',
                    selected ? 'bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]' : 'hover:bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]'
                  )}
                >
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={protectedByCatalog}
                      onChange={() => onToggleObject(item)}
                      title={protectedByCatalog ? '已入库对象需在媒体库中管理' : '选择孤儿对象'}
                      aria-label={protectedByCatalog ? '已入库对象需在媒体库中管理' : `选择 ${item.key}`}
                      className="h-4 w-4 rounded border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent accent-[var(--aurora-1)] disabled:opacity-35"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]">
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
                  </div>
                  <span className="text-right text-sm text-[var(--ink-secondary)] tnum">{formatFileSize(item.size)}</span>
                  <span className="text-sm text-[var(--ink-secondary)] tnum">{formatObjectDate(item.lastModified)}</span>
                  <div>
                    <StatusBadge item={item} />
                  </div>
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
