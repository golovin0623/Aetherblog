/**
 * @文件 MediaList.tsx
 * @description 媒体列表视图组件 - 优化交互逻辑
 * @ref §3.2.4 - 媒体管理模块
 */

import { Image, Video, Music, FileText, Download, Trash2, Eye, Link2, FolderInput } from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { MediaItem, MediaType, getMediaUrl } from '@/services/mediaService';
import { format } from 'date-fns';
import { StorageStatusIcon } from './StorageStatusIcon';

interface MediaListProps {
  items: MediaItem[];
  selectedId: number | null;
  selectedIds: Set<number>;
  onSelect: (id: number) => void;
  onToggleSelect: (id: number) => void;
  onPreview: (id: number) => void;
  onDelete: (id: number) => void;
  onCopyUrl: (url: string) => void;
  onDownload: (url: string, filename: string) => void;
  onMove?: (id: number, name: string) => void;
}

const typeIcons: Record<MediaType, typeof Image> = {
  IMAGE: Image,
  VIDEO: Video,
  AUDIO: Music,
  DOCUMENT: FileText,
  OTHER: FileText,
};

const typeLabels: Record<MediaType, string> = {
  IMAGE: '图片',
  VIDEO: '视频',
  AUDIO: '音频',
  DOCUMENT: '文档',
  OTHER: '其他',
};

/**
 * 媒体列表视图组件
 */
export function MediaList({
  items,
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onPreview,
  onDelete,
  onCopyUrl,
  onDownload,
  onMove,
}: MediaListProps) {
  return (
    <div className="overflow-hidden rounded-xl">
      {/* 桌面端表格视图 */}
      <div className="media-neutral-pane hidden overflow-x-auto rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] md:block">
      <table className="min-w-[880px] w-full text-left border-collapse table-fixed">
        <thead>
          <tr className="border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]">
            <th className="w-12 px-4 py-3">
              {/* 全选逻辑 */}
              <div className="h-5 w-5 rounded border-2 border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]" />
            </th>
            <th className="w-auto min-w-[260px] px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              文件名
            </th>
            <th className="w-32 whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              类型
            </th>
            <th className="w-32 whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              大小
            </th>
            <th className="w-48 whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              上传时间
            </th>
            <th className="sticky right-0 z-10 w-48 whitespace-nowrap border-l border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)] shadow-[-18px_0_24px_-24px_var(--ink-primary)]">
              操作
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
          {items.map((item) => {
            const Icon = typeIcons[item.fileType] || FileText;
            const isSidebarSelected = selectedId === item.id;
            const isBatchSelected = selectedIds.has(item.id);
            const fullUrl = getMediaUrl(item);
            const stickyActionClass = cn(
              'sticky right-0 z-10 border-l border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] shadow-[-18px_0_24px_-24px_var(--ink-primary)]',
              isSidebarSelected && 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,var(--bg-leaf))]',
              isBatchSelected && 'bg-[color-mix(in_oklch,var(--aurora-1)_6%,var(--bg-leaf))]',
              !isSidebarSelected && !isBatchSelected && 'group-hover:bg-[color-mix(in_oklch,var(--ink-primary)_4%,var(--bg-leaf))]'
            );

            return (
              <tr
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={cn(
                  'group cursor-pointer transition-all duration-200',
                  isSidebarSelected
                    ? 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]'
                    : 'hover:bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]',
                  isBatchSelected && 'bg-[color-mix(in_oklch,var(--aurora-1)_6%,transparent)]'
                )}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isBatchSelected}
                    onChange={() => onToggleSelect(item.id)}
                    aria-label={`选择 ${item.originalName}`}
                    className="h-5 w-5 rounded border-2 border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent text-primary focus:ring-primary/30"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]">
                      {item.fileType === 'IMAGE' ? (
                        <img src={fullUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Icon className="h-4 w-4 text-[var(--ink-muted)]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--ink-primary)]" title={item.originalName}>
                        {item.originalName}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-[var(--ink-secondary)]">
                      {typeLabels[item.fileType] || item.fileType}
                    </span>
                    {/* iCloud 风格存储/备份状态 */}
                    {item.storageType && (
                      <StorageStatusIcon
                        storageType={item.storageType}
                        syncStatus={item.syncStatus}
                        size="sm"
                      />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-[var(--ink-secondary)]">
                  {formatFileSize(item.fileSize)}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--ink-secondary)]">
                  {format(new Date(item.createdAt), 'yyyy-MM-dd HH:mm')}
                </td>
                <td className={cn('px-3 py-3', stickyActionClass)} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1.5 transition-opacity">
                    <button
                      onClick={() => onPreview(item.id)}
                      className="rounded-lg p-1.5 text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]"
                      title="预览"
                      aria-label={`预览 ${item.originalName}`}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onCopyUrl(fullUrl)}
                      className="rounded-lg p-1.5 text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]"
                      title="复制链接"
                      aria-label={`复制 ${item.originalName} 链接`}
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDownload(fullUrl, item.originalName)}
                      className="rounded-lg p-1.5 text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]"
                      title="下载"
                      aria-label={`下载 ${item.originalName}`}
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    {onMove && (
                      <button
                        onClick={() => onMove(item.id, item.originalName)}
                        className="rounded-lg p-1.5 text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]"
                        title="移动到文件夹"
                        aria-label={`移动 ${item.originalName}`}
                      >
                        <FolderInput className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(item.id)}
                      className="rounded-lg p-1.5 text-[var(--ink-secondary)] transition-colors hover:bg-status-danger-light hover:text-status-danger"
                      title="删除"
                      aria-label={`删除 ${item.originalName}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* 移动端卡片视图 —— 使用 Codex token,明/暗主题自动切换 */}
      <div className="media-neutral-pane surface-leaf divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] overflow-hidden !rounded-xl md:hidden">
        {items.map((item) => {
          const Icon = typeIcons[item.fileType] || FileText;
          const isSelected = selectedId === item.id || selectedIds.has(item.id);
          const fullUrl = getMediaUrl(item);

          return (
            <div
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                'relative space-y-2.5 p-3.5 transition-colors',
                'active:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]',
                isSelected && 'bg-[color-mix(in_oklch,var(--aurora-1)_6%,transparent)]'
              )}
            >
              <div className="flex items-start gap-3">
                {/* 缩略图 */}
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] shadow-inner">
                  {item.fileType === 'IMAGE' ? (
                    <img src={fullUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="h-5 w-5 text-[var(--ink-muted)]" />
                  )}
                </div>

                {/* 基本信息 */}
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 break-all text-sm font-medium leading-relaxed text-[var(--ink-primary)]">
                      {item.originalName}
                    </h3>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleSelect(item.id);
                      }}
                      aria-label={`选择 ${item.originalName}`}
                      className="mt-1 h-5 w-5 shrink-0 rounded border-2 border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] bg-transparent text-primary focus:ring-primary/30"
                    />
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] font-medium text-[var(--ink-muted)]">
                    <span className="rounded border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-1.5 py-0.5 uppercase tracking-tight text-[var(--ink-muted)]">
                      {typeLabels[item.fileType] || item.fileType}
                    </span>
                    <span className="h-2 w-px bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" />
                    <span>{formatFileSize(item.fileSize)}</span>
                    {item.storageType && (
                      <>
                        <span className="h-2 w-px bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" />
                        <StorageStatusIcon
                          storageType={item.storageType}
                          syncStatus={item.syncStatus}
                          size="sm"
                          showLabel
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 操作区 */}
              <div className="flex items-center justify-between pt-1 border-t border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
                <span className="font-mono text-[10px] text-[var(--ink-secondary)]">
                  {format(new Date(item.createdAt), 'yyyy-MM-dd HH:mm')}
                </span>

                <div className="flex items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onPreview(item.id); }}
                    className="p-2 text-[var(--ink-muted)] active:text-[var(--ink-primary)]"
                    aria-label={`预览 ${item.originalName}`}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onCopyUrl(fullUrl); }}
                    className="p-2 text-[var(--ink-muted)] active:text-[var(--ink-primary)]"
                    aria-label={`复制 ${item.originalName} 链接`}
                  >
                    <Link2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDownload(fullUrl, item.originalName); }}
                    className="p-2 text-[var(--ink-muted)] active:text-[var(--ink-primary)]"
                    aria-label={`下载 ${item.originalName}`}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  {onMove && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onMove(item.id, item.originalName); }}
                      className="p-2 text-[var(--ink-muted)] active:text-[var(--ink-primary)]"
                      aria-label={`移动 ${item.originalName}`}
                    >
                      <FolderInput className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                    className="p-2 text-[var(--ink-muted)] active:text-status-danger"
                    aria-label={`删除 ${item.originalName}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
