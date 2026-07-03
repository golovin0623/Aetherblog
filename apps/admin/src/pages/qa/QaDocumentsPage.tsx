/**
 * QA 文档列表页面 — 上传条目 + 管道状态轮询
 * 参考：docs/features/qa-document-workflow.md §1、§7
 * 模式镜像PostsPage.tsx（表格/分页/过滤器）
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, Upload, X, FileText, ChevronDown, RefreshCw,
  Trash2, Eye, AlertCircle, CheckCircle2, Clock, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { spring, transition } from '@aetherblog/ui';
import { Skeleton } from '@aetherblog/ui';
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { AdminSectionHeader, AdminSectionCount } from '@/components/layout/AdminSectionHeader';
import { AdminPagination } from '@/components/common/AdminPagination';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { qaDocumentService } from '@/services/qaDocumentService';
import type {
  QaDocument,
  QaDocumentStatus,
  SplitGranularity,
} from '@/types/qaDocument';
import { SPLIT_GRANULARITY_LABELS } from '@/types/qaDocument';
import type { PageResult } from '@/types';
import { logger } from '@/lib/logger';

const STATUS_COLOR: Record<QaDocumentStatus, string> = {
  UPLOADED: 'bg-[color-mix(in_oklch,var(--signal-info)_12%,transparent)] text-[var(--signal-info)] border-[color-mix(in_oklch,var(--signal-info)_25%,transparent)]',
  PREPROCESSING: 'bg-[color-mix(in_oklch,var(--aurora-3)_12%,transparent)] text-[var(--aurora-3)] border-[color-mix(in_oklch,var(--aurora-3)_25%,transparent)]',
  SEGMENTED: 'bg-[color-mix(in_oklch,var(--aurora-3)_12%,transparent)] text-[var(--aurora-3)] border-[color-mix(in_oklch,var(--aurora-3)_25%,transparent)]',
  OCR_DONE: 'bg-[color-mix(in_oklch,var(--aurora-2)_12%,transparent)] text-[var(--aurora-2)] border-[color-mix(in_oklch,var(--aurora-2)_25%,transparent)]',
  STRUCTURED: 'bg-[color-mix(in_oklch,var(--aurora-2)_12%,transparent)] text-[var(--aurora-2)] border-[color-mix(in_oklch,var(--aurora-2)_25%,transparent)]',
  REVIEW_READY: 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)] border-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)]',
  ANNOTATED: 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)] border-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)]',
  AGENT_RUNNING: 'bg-[color-mix(in_oklch,var(--aurora-4)_12%,transparent)] text-[var(--aurora-4)] border-[color-mix(in_oklch,var(--aurora-4)_25%,transparent)]',
  PATCH_PROPOSED: 'bg-[color-mix(in_oklch,var(--aurora-4)_12%,transparent)] text-[var(--aurora-4)] border-[color-mix(in_oklch,var(--aurora-4)_25%,transparent)]',
  MERGED: 'bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)] text-[var(--signal-warn)] border-[color-mix(in_oklch,var(--signal-warn)_25%,transparent)]',
  DIFF_READY: 'bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)] text-[var(--signal-warn)] border-[color-mix(in_oklch,var(--signal-warn)_25%,transparent)]',
  APPROVED: 'bg-[color-mix(in_oklch,var(--signal-success)_12%,transparent)] text-[var(--signal-success)] border-[color-mix(in_oklch,var(--signal-success)_25%,transparent)]',
  PUBLISHED: 'bg-[color-mix(in_oklch,var(--signal-success)_20%,transparent)] text-[var(--signal-success)] border-[color-mix(in_oklch,var(--signal-success)_35%,transparent)]',
  FAILED: 'bg-[color-mix(in_oklch,var(--signal-danger)_12%,transparent)] text-[var(--signal-danger)] border-[color-mix(in_oklch,var(--signal-danger)_25%,transparent)]',
};

const STATUS_LABEL: Record<QaDocumentStatus, string> = {
  UPLOADED: '已上传',
  PREPROCESSING: '预处理',
  SEGMENTED: '已分块',
  OCR_DONE: 'OCR 完成',
  STRUCTURED: '已结构化',
  REVIEW_READY: '待校对',
  ANNOTATED: '已标注',
  AGENT_RUNNING: 'AI 修复中',
  PATCH_PROPOSED: '有待合并补丁',
  MERGED: '已合并',
  DIFF_READY: '待审批',
  APPROVED: '已审批',
  PUBLISHED: '已发布',
  FAILED: '失败',
};

/** 表示管道仍在自动运行的状态 */
const PIPELINE_ACTIVE_STATUSES: QaDocumentStatus[] = [
  'PREPROCESSING', 'SEGMENTED', 'OCR_DONE', 'STRUCTURED', 'AGENT_RUNNING',
];

const GRANULARITY_OPTIONS: Array<{ value: SplitGranularity; label: string }> = [
  { value: 'COARSE', label: SPLIT_GRANULARITY_LABELS.COARSE },
  { value: 'STANDARD', label: SPLIT_GRANULARITY_LABELS.STANDARD },
  { value: 'FINE', label: SPLIT_GRANULARITY_LABELS.FINE },
  { value: 'ULTRA_FINE', label: SPLIT_GRANULARITY_LABELS.ULTRA_FINE },
];

const PAGE_SIZE = 10;
const POLL_INTERVAL_MS = 5000;

function StatusChip({ status }: { status: QaDocumentStatus }) {
  const isRunning = PIPELINE_ACTIVE_STATUSES.includes(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-mono',
        STATUS_COLOR[status]
      )}
    >
      {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === 'PUBLISHED' && <CheckCircle2 className="h-3 w-3" />}
      {status === 'FAILED' && <AlertCircle className="h-3 w-3" />}
      {!isRunning && status !== 'PUBLISHED' && status !== 'FAILED' && (
        <Clock className="h-3 w-3" />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function QaDocumentsPage() {
  const navigate = useNavigate();

  // 列表状态
  const [docs, setDocs] = useState<QaDocument[]>([]);
  const [pagination, setPagination] = useState<PageResult<QaDocument> | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<QaDocumentStatus | undefined>(undefined);

  // 上传对话框状态
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadGranularity, setUploadGranularity] = useState<SplitGranularity>('STANDARD');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 删除对话框
  const [deleteDoc, setDeleteDoc] = useState<QaDocument | null>(null);

  // 是否有任何行处于自动管道状态（以启用轮询）
  const hasPipelineActive = docs.some((d) => PIPELINE_ACTIVE_STATUSES.includes(d.status));

  const fetchDocs = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      setError(null);
      const res = await qaDocumentService.getList({
        pageNum: page,
        pageSize: PAGE_SIZE,
        status: statusFilter,
        keyword: keyword || undefined,
      });
      if (res.code === 200 && res.data) {
        // 后端空列表可能返回 list: null（Go nil slice），直接 setDocs(null) 会让
        // 后续 docs.some/map 崩溃整页 —— 兜底成空数组。
        setDocs(res.data.list ?? []);
        setPagination(res.data);
      } else {
        setError(res.message || '获取列表失败');
      }
    } catch (err) {
      logger.error('QA docs fetch error:', err);
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, keyword]);

  useEffect(() => {
    setPageNum(1);
    fetchDocs(1);
  }, [fetchDocs]);

  // 轮询管道更新
  useEffect(() => {
    if (!hasPipelineActive) return;
    const id = setInterval(() => fetchDocs(pageNum), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasPipelineActive, fetchDocs, pageNum]);

  const handlePageChange = (page: number) => {
    setPageNum(page);
    fetchDocs(page);
  };

  // 上传
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadFile(f);
    if (!uploadTitle) setUploadTitle(f.name.replace(/\.[^.]+$/, ''));
    setUploadError(null);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    try {
      await qaDocumentService.upload(uploadFile, {
        title: uploadTitle || uploadFile.name,
        granularity: uploadGranularity,
        onProgress: setUploadProgress,
      });
      setUploadOpen(false);
      setUploadFile(null);
      setUploadTitle('');
      setUploadGranularity('STANDARD');
      setUploadProgress(0);
      fetchDocs(1);
    } catch (err) {
      logger.error('Upload error:', err);
      setUploadError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    try {
      await qaDocumentService.delete(deleteDoc.id);
      setDeleteDoc(null);
      fetchDocs(pageNum);
    } catch (err) {
      logger.error('Delete error:', err);
    }
  };

  const isInitialLoading = loading && docs.length === 0;
  const totalPages = pagination?.pages || 1;

  return (
    <div className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] p-4 md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">

        <AdminModuleHeader
          title="试卷拆题"
          description="上传试卷 PDF / 图片，自动 OCR 拆题、AI 校对、审批发布入库。"
          icon={FileText}
          currentLabel={statusFilter ? STATUS_LABEL[statusFilter] : '全部'}
          activeSummary={`共 ${pagination?.total ?? 0} 份文档，第 ${pageNum}/${totalPages} 页`}
          actions={
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="admin-module-action-button"
              aria-label="上传试卷"
            >
              <Upload className="h-4 w-4" />
              <span>上传试卷</span>
            </button>
          }
        />

        {/* Filters */}
        <div className="surface-leaf rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-3 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Keyword search */}
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                type="text"
                placeholder="搜索文档标题"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className={cn(
                  'h-10 w-full rounded-lg pl-9 pr-3 text-sm',
                  'border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)]',
                  'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
                  'focus:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)] focus:outline-none',
                  'transition-[border-color,box-shadow] duration-[var(--dur-quick)]'
                )}
              />
            </div>

            {/* Status filter */}
            <div className="flex flex-wrap items-center gap-1">
              {([undefined, 'REVIEW_READY', 'PATCH_PROPOSED', 'DIFF_READY', 'PUBLISHED', 'FAILED'] as const).map((s) => (
                <button
                  key={s ?? 'ALL'}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'h-8 rounded-full px-3 text-xs font-medium transition-colors',
                    statusFilter === s
                      ? 'bg-[var(--aurora-1)] text-white'
                      : 'text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]'
                  )}
                >
                  {s ? STATUS_LABEL[s] : '全部'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => fetchDocs(pageNum)}
              disabled={loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-3 text-sm text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="surface-leaf overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] shadow-sm">
          <AdminSectionHeader
            icon={<FileText className="h-4 w-4" />}
            title="文档列表"
            description="点击行进入详情，REVIEW_READY 状态可进入校对"
            aside={
              <AdminSectionCount>
                {isInitialLoading ? '加载中' : `${docs.length}/${pagination?.total ?? 0}`}
              </AdminSectionCount>
            }
          />

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                <tr>
                  <th className="px-4 py-3 text-left">标题</th>
                  <th className="px-4 py-3 text-left w-36">状态</th>
                  <th className="px-4 py-3 text-left w-24">粒度</th>
                  <th className="px-4 py-3 text-left w-16">版本</th>
                  <th className="px-4 py-3 text-left w-36">更新时间</th>
                  <th className="px-4 py-3 text-right w-28">操作</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="wait">
                  {isInitialLoading ? (
                    Array.from({ length: PAGE_SIZE }).map((_, i) => (
                      <tr key={`skel-${i}`} className="border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] last:border-b-0">
                        <td className="px-4 py-3"><Skeleton className="h-4 w-3/4" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-12" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-8" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3"><div className="flex justify-end gap-1"><Skeleton className="h-8 w-8 rounded-lg" /><Skeleton className="h-8 w-8 rounded-lg" /></div></td>
                      </tr>
                    ))
                  ) : error ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-[var(--signal-danger)]">
                        <AlertCircle className="mx-auto mb-2 h-8 w-8" />
                        {error}
                      </td>
                    </tr>
                  ) : docs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-20 text-center text-[var(--ink-muted)]">
                        <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
                        <p className="font-display text-base text-[var(--ink-primary)]">暂无试卷</p>
                        <p className="mt-1 text-sm">上传 PDF 或图片开始智能拆题流程</p>
                        <button
                          type="button"
                          onClick={() => setUploadOpen(true)}
                          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--aurora-1)] px-4 py-2 text-sm font-medium text-white"
                        >
                          <Upload className="h-4 w-4" />
                          上传试卷
                        </button>
                      </td>
                    </tr>
                  ) : (
                    docs.map((doc) => (
                      <motion.tr
                        key={doc.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={transition.quick}
                        className="cursor-pointer border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] last:border-b-0 hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]"
                        onClick={() => navigate(`/qa/${doc.id}`)}
                      >
                        <td className="px-4 py-3 font-medium text-[var(--ink-primary)]">
                          <span className="line-clamp-1">{doc.title}</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusChip status={doc.status} />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[var(--ink-muted)]">
                          {SPLIT_GRANULARITY_LABELS[doc.splitGranularity]}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[var(--ink-muted)]">
                          v{doc.currentVersion}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--ink-muted)]">
                          {new Date(doc.updatedAt).toLocaleString('zh-CN')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {doc.status === 'REVIEW_READY' && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); navigate(`/qa/${doc.id}/proofread`); }}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]"
                                title="进入校对"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDeleteDoc(doc); }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] hover:text-[var(--signal-danger)]"
                              title="删除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          <AdminPagination
            page={pageNum}
            total={pagination?.total ?? 0}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            pageSizeOptions={[10, 20, 50]}
            onPageChange={handlePageChange}
            onPageSizeChange={() => {}}
            itemLabel="份"
            loading={loading && docs.length > 0}
            summaryLoading={isInitialLoading}
            pageSizeAriaLabel="每页文档数"
          />
        </div>
      </div>

      {/* Upload Dialog */}
      <AnimatePresence>
        {uploadOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.quick}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setUploadOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={spring.soft}
              className="surface-overlay w-full max-w-md rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] p-6 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-lg text-[var(--ink-primary)]">上传试卷</h2>
                <button
                  type="button"
                  onClick={() => setUploadOpen(false)}
                  className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* File drop zone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors',
                    uploadFile
                      ? 'border-[var(--aurora-1)] bg-[color-mix(in_oklch,var(--aurora-1)_6%,transparent)]'
                      : 'border-[color-mix(in_oklch,var(--ink-primary)_15%,transparent)] hover:border-[var(--aurora-1)]'
                  )}
                >
                  <Upload className="mx-auto mb-2 h-8 w-8 text-[var(--ink-muted)]" />
                  {uploadFile ? (
                    <p className="text-sm font-medium text-[var(--ink-primary)]">{uploadFile.name}</p>
                  ) : (
                    <>
                      <p className="text-sm text-[var(--ink-primary)]">点击选择文件</p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">支持 PDF / PNG / JPG</p>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>

                {/* Title */}
                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    文档标题
                  </label>
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="自动从文件名获取"
                    className={cn(
                      'h-10 w-full rounded-lg px-3 text-sm',
                      'border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)]',
                      'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
                      'focus:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)] focus:outline-none'
                    )}
                  />
                </div>

                {/* Granularity */}
                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    拆分粒度
                  </label>
                  <div className="flex gap-2">
                    {GRANULARITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setUploadGranularity(opt.value)}
                        className={cn(
                          'flex-1 rounded-lg border py-2 text-xs font-medium transition-colors',
                          uploadGranularity === opt.value
                            ? 'border-[var(--aurora-1)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]'
                            : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Progress */}
                {uploading && (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-[var(--ink-muted)]">
                      <span>上传中</span>
                      <span className="font-mono">{uploadProgress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                      <div
                        className="h-full rounded-full bg-[var(--aurora-1)] transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {uploadError && (
                  <p className="text-sm text-[var(--signal-danger)]">
                    <AlertCircle className="mr-1 inline h-4 w-4" />
                    {uploadError}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setUploadOpen(false)}
                    disabled={uploading}
                    className="flex-1 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] py-2.5 text-sm text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleUpload}
                    disabled={!uploadFile || uploading}
                    className="flex-1 rounded-lg bg-[var(--aurora-1)] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {uploading ? (
                      <><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />上传中</>
                    ) : '开始上传'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!deleteDoc}
        title="确认删除这份试卷？"
        message={`删除「${deleteDoc?.title}」后将无法恢复。`}
        confirmText="确认删除"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteDoc(null)}
      />
    </div>
  );
}
