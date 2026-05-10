import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Server, Star, Trash2, Zap, Edit3, Cloud, HardDrive, Loader2, Download, Upload } from 'lucide-react';
import { Button, Select, Toggle } from '@aetherblog/ui';
import {
  storageProviderService,
  CreateStorageProviderRequest,
  StorageProviderExportPayload,
} from '@/services/storageProviderService';
import { storageSyncService } from '@/services/storageSyncService';
import type { StorageProvider, StorageProviderType } from '@aetherblog/types';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

/**
 * 存储提供商设置页面
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @ref 对象存储 rollout - Phase 2: 表单按 provider 类型分字段渲染 + endpoint 预设
 *
 * Phase 2 改造点:
 *   1. 创建/编辑表单按 ProviderType 渲染不同字段集 (而不是裸 JSON 文本框)。
 *   2. 提供 endpoint 预设按钮 (COS/OSS/AWS/R2 等),一键填入正确域名。
 *   3. 编辑时回显的 configJson 已被后端脱敏 (`a****b1234`),空白即保留旧值;
 *      如要换密钥必须显式重填明文 — 此约束在表单 placeholder 提示。
 */

const PROVIDER_TYPES: { value: StorageProviderType; label: string; description: string }[] = [
  { value: 'LOCAL', label: '本地存储', description: '存储在服务器本地文件系统' },
  { value: 'S3', label: 'AWS S3', description: 'Amazon S3 对象存储' },
  { value: 'MINIO', label: 'MinIO', description: '开源 S3 兼容对象存储' },
  { value: 'OSS', label: '阿里云 OSS', description: '阿里云对象存储服务' },
  { value: 'COS', label: '腾讯云 COS', description: '腾讯云对象存储' },
  { value: 'R2', label: 'Cloudflare R2', description: 'Cloudflare 零出口费 S3 兼容存储' },
];

type EndpointPreset = {
  label: string;
  value: string;
  needsAccountId?: boolean;
  allowPrivateEndpoint?: boolean;
};

// 各 provider 的 endpoint 预设(用于一键填入)
const ENDPOINT_PRESETS: Partial<Record<StorageProviderType, EndpointPreset[]>> = {
  COS: [
    { label: '广州 (ap-guangzhou)', value: 'https://cos.ap-guangzhou.myqcloud.com' },
    { label: '上海 (ap-shanghai)', value: 'https://cos.ap-shanghai.myqcloud.com' },
    { label: '北京 (ap-beijing)', value: 'https://cos.ap-beijing.myqcloud.com' },
    { label: '香港 (ap-hongkong)', value: 'https://cos.ap-hongkong.myqcloud.com' },
    { label: '新加坡 (ap-singapore)', value: 'https://cos.ap-singapore.myqcloud.com' },
  ],
  OSS: [
    { label: '杭州 (oss-cn-hangzhou)', value: 'https://oss-cn-hangzhou.aliyuncs.com' },
    { label: '上海 (oss-cn-shanghai)', value: 'https://oss-cn-shanghai.aliyuncs.com' },
    { label: '北京 (oss-cn-beijing)', value: 'https://oss-cn-beijing.aliyuncs.com' },
    { label: '深圳 (oss-cn-shenzhen)', value: 'https://oss-cn-shenzhen.aliyuncs.com' },
  ],
  R2: [
    // R2 不再显示 endpoint preset 按钮 —— 用专门的 accountId 输入框驱动 endpoint 拼装,
    // 避免用户复制带 "<account-id>" 字面量的 URL 直接落库。见 R2AccountIdField。
  ],
  MINIO: [
    { label: '本地默认 (localhost:9000)', value: 'http://localhost:9000', allowPrivateEndpoint: true },
  ],
};

// providerType → 默认 region(只是方便用户起手,后续可改)
const DEFAULT_REGIONS: Partial<Record<StorageProviderType, string>> = {
  S3: 'us-east-1',
  COS: 'ap-guangzhou',
  OSS: 'cn-hangzhou',
  R2: 'auto',
};

/**
 * R2 endpoint 的标准形态:`https://{32 位十六进制 accountId}.r2.cloudflarestorage.com`。
 * 反向解析与正向构造都用这个常量,避免双源不一致。
 *
 * @ref 云储存优化批次 3a — Cloudflare account ID 一键填 endpoint
 */
const R2_ACCOUNT_ENDPOINT_RE = /^https?:\/\/([a-f0-9]{32})\.r2\.cloudflarestorage\.com\/?$/i;

function extractR2AccountId(endpoint: string): string {
  if (!endpoint) return '';
  const m = endpoint.match(R2_ACCOUNT_ENDPOINT_RE);
  return m ? m[1].toLowerCase() : '';
}

function buildR2Endpoint(accountId: string): string {
  const trimmed = accountId.trim().toLowerCase();
  if (!trimmed) return '';
  return `https://${trimmed}.r2.cloudflarestorage.com`;
}

/**
 * S3 兼容配置(LOCAL 之外的统一形状)
 *
 * 后端 storage/s3.go 的 S3Config 字段:
 *   bucket, region, endpoint, accessKeyId, secretAccessKey, path, customUrl, options, urlPrefix, allowPrivateEndpoint, forcePathStyle
 */
interface S3LikeConfig {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  path: string;
  customUrl: string;
  options: string;
  urlPrefix: string;
  allowPrivateEndpoint: boolean;
  forcePathStyle: boolean;
}

interface LocalConfig {
  basePath: string;
  urlPrefix: string;
}

const EMPTY_S3_CONFIG: S3LikeConfig = {
  bucket: '',
  region: '',
  endpoint: '',
  accessKeyId: '',
  secretAccessKey: '',
  path: '',
  customUrl: '',
  options: '',
  urlPrefix: '',
  allowPrivateEndpoint: false,
  forcePathStyle: false,
};

const EMPTY_LOCAL_CONFIG: LocalConfig = {
  basePath: './uploads',
  urlPrefix: '/uploads',
};

function safeParseJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const err = error as {
    message?: string;
    msg?: string;
    errorMessage?: string;
    response?: { data?: { message?: string; msg?: string; errorMessage?: string } };
  };
  return (
    err.response?.data?.message ||
    err.response?.data?.msg ||
    err.response?.data?.errorMessage ||
    err.message ||
    err.msg ||
    err.errorMessage ||
    fallback
  );
}

export default function StorageProviderSettings() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StorageProvider | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    payload: StorageProviderExportPayload;
  } | null>(null);

  // 获取所有存储提供商
  const { data: providersResponse, isLoading } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => storageProviderService.getAll(),
  });

  const providers = providersResponse?.data || [];

  const { data: targetProviderResponse, isLoading: isTargetProviderLoading } = useQuery({
    queryKey: ['storage-sync-target-provider'],
    queryFn: () => storageSyncService.getTargetProvider(),
  });
  const backupTargetProviderId = targetProviderResponse?.data?.targetProviderId ?? null;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => storageProviderService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] });
      toast.success('删除成功');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, '删除失败'));
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: number) => storageProviderService.setAsDefault(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] });
      toast.success('已设置为主存储');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, '设置主存储失败'));
    },
  });

  const setBackupTargetMutation = useMutation({
    mutationFn: (id: number | null) => storageSyncService.setTargetProvider(id),
    onSuccess: (_resp, id) => {
      queryClient.invalidateQueries({ queryKey: ['storage-sync-target-provider'] });
      queryClient.invalidateQueries({ queryKey: ['storage-sync-status'] });
      if (id) {
        const target = providers.find((p) => p.id === id);
        toast.success(`已设置备份目标:${target?.name || `Provider #${id}`}`);
      } else {
        toast.success('已清空备份目标配置');
      }
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, '设置备份目标失败'));
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => storageProviderService.testConnection(id),
    onSuccess: (response) => {
      if (response.data.success) {
        toast.success(response.data.message || '连接测试成功');
      } else {
        toast.error(response.data.message || '连接测试失败');
      }
    },
  });

  const handleDelete = (id: number) => {
    if (confirm('确定要删除这个存储提供商吗？删除后该 provider 上的历史文件无法删除原始 key。')) {
      deleteMutation.mutate(id);
    }
  };

  const handleExport = () => {
    if (exporting) return;
    if (providers.length === 0) {
      toast.error('暂无可导出的存储配置');
      return;
    }
    setExportConfirmOpen(true);
  };

  const executeExport = async () => {
    if (exporting) return;
    setExportConfirmOpen(false);
    setExporting(true);
    try {
      const resp = await storageProviderService.exportConfig();
      const payload = resp.data;
      if (!payload) {
        throw new Error('空响应');
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `aetherblog-storage-providers-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${payload.providers?.length ?? 0} 条存储配置`);
    } catch (err) {
      const msg = getApiErrorMessage(err, '导出失败');
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 重置 input value 以便重复选择同一文件
    if (importInputRef.current) importInputRef.current.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      let payload: StorageProviderExportPayload;
      try {
        payload = JSON.parse(text);
      } catch {
        toast.error('文件不是合法的 JSON');
        return;
      }
      if (!payload || payload.version !== 1 || !Array.isArray(payload.providers)) {
        toast.error('文件格式不匹配 (期望 version=1 且 providers 为数组)');
        return;
      }
      if (payload.providers.length === 0) {
        toast.error('文件中没有 provider 记录');
        return;
      }
      setPendingImport({ fileName: file.name, payload });
    } catch (err) {
      const msg = getApiErrorMessage(err, '读取导入文件失败');
      toast.error(msg);
    }
  };

  const executeImport = async () => {
    if (!pendingImport || importing) return;
    const payload = pendingImport.payload;
    setPendingImport(null);
    setImporting(true);
    try {
      const resp = await storageProviderService.importConfig(payload);
      const result = resp.data;
      const parts: string[] = [];
      parts.push(`导入完成:新建 ${result?.imported ?? 0} 条`);
      if (result?.skippedNames?.length) {
        parts.push(`跳过 ${result.skippedNames.length} 条(同名)`);
      }
      if (result?.failedNames?.length) {
        parts.push(`失败 ${result.failedNames.length} 条`);
      }
      if (result?.defaultSet) {
        parts.push(`主存储已切换为「${result.defaultSet}」`);
      }
      toast.success(parts.join(' · '));
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] });
    } catch (err) {
      const msg = getApiErrorMessage(err, '导入失败');
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      {/* 头部 */}
      <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2 mb-1">
            <Cloud className="w-5 h-5 text-[var(--text-muted)] shrink-0" />
            <span>存储管理</span>
          </h2>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">
            主存储决定新上传文件落点;备份目标决定后台同步复制到哪里,两者可以相反配置。
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            className="gap-2"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            导入配置
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleExport}
            disabled={exporting || providers.length === 0}
            className="gap-2"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            导出配置
          </Button>
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="w-4 h-4" /> 添加存储提供商
          </Button>
        </div>
      </div>

      {/* 主存储 / 备份目标路由策略 */}
      <StorageRoutingPanel
        providers={providers}
        targetProviderId={backupTargetProviderId}
        isLoading={isTargetProviderLoading}
        isPending={setBackupTargetMutation.isPending}
        onSetTarget={(id) => setBackupTargetMutation.mutate(id)}
      />

      {/* 全局开关:自动后台备份 — Phase 4 */}
      <AutoBackupToggle />

      {/* 全局开关:定期备份完整性校验 — Phase 5 */}
      <VerifyToggle />

      {/* 提供商列表 */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-12 text-[var(--text-muted)]">加载中...</div>
        ) : providers.length === 0 ? (
          <div className="text-center py-12 surface-leaf surface-admin-panel rounded-2xl">
            <Server className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
            <p className="text-[var(--text-muted)]">暂无存储提供商</p>
          </div>
        ) : (
          providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onEdit={() => setEditing(provider)}
              onDelete={() => handleDelete(provider.id)}
              onTest={() => testMutation.mutate(provider.id)}
              onSetDefault={() => setDefaultMutation.mutate(provider.id)}
              onSetBackupTarget={() => setBackupTargetMutation.mutate(provider.id)}
              backupTargetId={backupTargetProviderId}
              testing={testMutation.isPending}
              busyDelete={deleteMutation.isPending}
              busySetDefault={setDefaultMutation.isPending}
              busySetBackupTarget={setBackupTargetMutation.isPending}
            />
          ))
        )}
      </div>

      <ConfirmDialog
        isOpen={exportConfirmOpen}
        title="导出存储配置"
        message="导出文件会包含所有存储提供商的明文密钥(accessKey / secretKey 等),仅用于跨实例迁移。请妥善保管下载文件,不要提交到代码仓库或分享给无关人员。"
        confirmText="继续导出"
        cancelText="取消"
        variant="warning"
        onConfirm={executeExport}
        onCancel={() => setExportConfirmOpen(false)}
      />

      <ConfirmDialog
        isOpen={!!pendingImport}
        title="导入存储配置"
        message={`即将从「${pendingImport?.fileName ?? ''}」导入 ${pendingImport?.payload.providers.length ?? 0} 条存储配置。同名 provider 会被自动跳过,不会覆盖已有配置。`}
        confirmText="确认导入"
        cancelText="取消"
        variant="info"
        onConfirm={executeImport}
        onCancel={() => setPendingImport(null)}
      />

      {/* 创建/编辑对话框 */}
      <AnimatePresence>
        {(creating || editing) && (
          <ProviderDialog
            mode={editing ? 'edit' : 'create'}
            existing={editing}
            onClose={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSuccess={() => {
              setCreating(false);
              setEditing(null);
              queryClient.invalidateQueries({ queryKey: ['storage-providers'] });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StorageRoutingPanel({
  providers,
  targetProviderId,
  isLoading,
  isPending,
  onSetTarget,
}: {
  providers: StorageProvider[];
  targetProviderId: number | null;
  isLoading: boolean;
  isPending: boolean;
  onSetTarget: (id: number | null) => void;
}) {
  const primary = providers.find((p) => p.isDefault) ?? null;
  const explicitTarget = providers.find((p) => p.id === targetProviderId) ?? null;
  const fallbackTarget = !targetProviderId ? providers.find((p) => p.isDefault && p.providerType !== 'LOCAL') ?? null : null;
  const effectiveTarget = explicitTarget ?? fallbackTarget;
  const enabledProviders = providers.filter((p) => p.isEnabled);
  const targetOptions = [
    {
      value: '',
      label: '自动:非本地主存储',
      description: fallbackTarget ? `当前会使用 ${fallbackTarget.name}` : '未配置时需要手动选择备份目标',
      icon: Cloud,
    },
    ...enabledProviders.map((provider) => ({
      value: String(provider.id),
      label: `${provider.name} (${provider.providerType})${provider.isDefault ? ' - 主存储' : ''}`,
      description: provider.isDefault ? '当前上传主存储' : `优先级 ${provider.priority}`,
      icon: provider.providerType === 'LOCAL' ? HardDrive : Cloud,
    })),
  ];

  return (
    <div className="surface-leaf surface-admin-item rounded-xl p-4 mb-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid gap-3 sm:grid-cols-2 lg:flex-1">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/25 px-3 py-2.5">
            <p className="text-[11px] text-[var(--text-muted)] mb-1">主存储 / 上传落点</p>
            <div className="flex items-center gap-2 min-w-0">
              {primary?.providerType === 'LOCAL' ? (
                <HardDrive className="w-4 h-4 text-primary shrink-0" />
              ) : (
                <Cloud className="w-4 h-4 text-primary shrink-0" />
              )}
              <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                {primary ? `${primary.name} (${primary.providerType})` : '未配置'}
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/25 px-3 py-2.5">
            <p className="text-[11px] text-[var(--text-muted)] mb-1">备份同步目标</p>
            <div className="flex items-center gap-2 min-w-0">
              {effectiveTarget?.providerType === 'LOCAL' ? (
                <HardDrive className="w-4 h-4 text-status-success shrink-0" />
              ) : (
                <Cloud className="w-4 h-4 text-status-success shrink-0" />
              )}
              <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                {effectiveTarget
                  ? `${effectiveTarget.name} (${effectiveTarget.providerType})${explicitTarget ? '' : ' · 兼容默认'}`
                  : '未配置'}
              </span>
            </div>
          </div>
        </div>

        <div className="w-full lg:w-72">
          <label htmlFor="storage-sync-target-provider" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
            选择备份目标
          </label>
          <Select
            id="storage-sync-target-provider"
            ariaLabel="选择备份目标"
            value={targetProviderId ? String(targetProviderId) : ''}
            onValueChange={(next) => onSetTarget(next ? Number(next) : null)}
            options={targetOptions}
            disabled={isLoading || isPending}
            disabledHint={isPending ? '正在保存...' : '加载中...'}
            size="md"
            fullWidth
            prefix={isPending ? <Loader2 className="animate-spin" /> : <Cloud />}
          />
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
            可以选择云 provider 备份本地文件,也可以选择 LOCAL 作为云主存储的本地备份。
          </p>
        </div>
      </div>
    </div>
  );
}

// ProviderCard 列表中的单个 provider 行
function ProviderCard({
  provider,
  onEdit,
  onDelete,
  onTest,
  onSetDefault,
  onSetBackupTarget,
  backupTargetId,
  testing,
  busyDelete,
  busySetDefault,
  busySetBackupTarget,
}: {
  provider: StorageProvider;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onSetDefault: () => void;
  onSetBackupTarget: () => void;
  backupTargetId: number | null;
  testing: boolean;
  busyDelete: boolean;
  busySetDefault: boolean;
  busySetBackupTarget: boolean;
}) {
  const TypeIcon = provider.providerType === 'LOCAL' ? HardDrive : Cloud;
  const isBackupTarget = backupTargetId === provider.id;
  const summary = useMemo(() => {
    try {
      const cfg = JSON.parse(provider.configJson) as Record<string, unknown>;
      if (provider.providerType === 'LOCAL') {
        return `路径 ${cfg.basePath || './uploads'}`;
      }
      const bucket = (cfg.bucket as string) || '-';
      const region = (cfg.region as string) || '-';
      const path = (cfg.path as string) || '';
      const customUrl = (cfg.customUrl as string) || (cfg.urlPrefix as string) || '';
      return `bucket: ${bucket} · region: ${region}${path ? ` · path: ${path}` : ''}${customUrl ? ` · URL: ${customUrl}` : ''}`;
    } catch {
      return '配置解析失败';
    }
  }, [provider.configJson, provider.providerType]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface-leaf surface-admin-item rounded-2xl p-4 sm:p-5"
      data-interactive
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeIcon className="w-5 h-5 text-primary shrink-0" />
            <h3 className="text-base font-semibold text-[var(--text-primary)] break-all">{provider.name}</h3>
            <span className="px-2 py-0.5 bg-primary/15 text-primary text-xs font-medium rounded-full font-mono">
              {provider.providerType}
            </span>
            {provider.isDefault && (
              <span className="px-2 py-0.5 bg-[color:color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)] text-xs font-medium rounded-full">
                主存储
              </span>
            )}
            {isBackupTarget && (
              <span className="px-2 py-0.5 bg-status-success/15 text-status-success text-xs font-medium rounded-full">
                备份目标
              </span>
            )}
            {!provider.isEnabled && (
              <span className="px-2 py-0.5 bg-status-danger/20 text-status-danger text-xs font-medium rounded-full">
                已禁用
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-2 break-all">{summary}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">优先级: {provider.priority}</p>
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 -mx-1 sm:mx-0 self-start flex-wrap">
          <button
            onClick={onTest}
            disabled={testing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-primary hover:bg-primary/10 active:bg-primary/15 rounded-lg transition-colors disabled:opacity-50 touch-manipulation"
            title="测试连接"
            aria-label="测试连接"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>测试</span>
          </button>
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-primary hover:bg-primary/10 active:bg-primary/15 rounded-lg transition-colors touch-manipulation"
            title="编辑配置"
            aria-label="编辑配置"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>编辑</span>
          </button>
          {!provider.isDefault && (
            <button
              onClick={onSetDefault}
              disabled={busySetDefault}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-status-success hover:bg-status-success/10 active:bg-status-success/15 rounded-lg transition-colors disabled:opacity-50 touch-manipulation"
              title="设为主存储"
              aria-label="设为主存储"
            >
              <Star className="w-3.5 h-3.5" />
              <span>设主存储</span>
            </button>
          )}
          {!isBackupTarget && (
            <button
              onClick={onSetBackupTarget}
              disabled={!provider.isEnabled || busySetBackupTarget}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-primary hover:bg-primary/10 active:bg-primary/15 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
              title={provider.isEnabled ? '设为备份目标' : '已禁用 provider 不能作为备份目标'}
              aria-label="设为备份目标"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>设备份</span>
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={provider.isDefault || isBackupTarget || busyDelete}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-status-danger hover:bg-status-danger/10 active:bg-status-danger/15 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            title={
              provider.isDefault
                ? '主存储 provider 不可删除,请先切换'
                : isBackupTarget
                  ? '备份目标 provider 不可删除,请先切换'
                  : '删除'
            }
            aria-label="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ProviderDialog 创建 + 编辑共用对话框
function ProviderDialog({
  mode,
  existing,
  onClose,
  onSuccess,
}: {
  mode: 'create' | 'edit';
  existing: StorageProvider | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [providerType, setProviderType] = useState<StorageProviderType>(existing?.providerType || 'LOCAL');
  const [isEnabled, setIsEnabled] = useState(existing?.isEnabled ?? true);
  const [priority, setPriority] = useState(existing?.priority ?? 0);

  const initialS3 = useMemo(() => {
    if (existing && existing.providerType !== 'LOCAL') {
      return safeParseJson<S3LikeConfig>(existing.configJson, EMPTY_S3_CONFIG);
    }
    return EMPTY_S3_CONFIG;
  }, [existing]);
  const initialLocal = useMemo(() => {
    if (existing && existing.providerType === 'LOCAL') {
      return safeParseJson<LocalConfig>(existing.configJson, EMPTY_LOCAL_CONFIG);
    }
    return EMPTY_LOCAL_CONFIG;
  }, [existing]);

  const [s3Cfg, setS3Cfg] = useState<S3LikeConfig>(initialS3);
  const [localCfg, setLocalCfg] = useState<LocalConfig>(initialLocal);

  // 切 type 时根据需要重置默认 region
  const handleTypeChange = (type: StorageProviderType) => {
    setProviderType(type);
    setS3Cfg((prev) => ({
      ...prev,
      region: type !== 'LOCAL' && DEFAULT_REGIONS[type] && !prev.region ? DEFAULT_REGIONS[type] || '' : prev.region,
      forcePathStyle: type === 'R2' || type === 'MINIO' ? true : prev.forcePathStyle,
    }));
  };

  const buildConfigJson = (): string => {
    if (providerType === 'LOCAL') {
      return JSON.stringify(localCfg);
    }
    return JSON.stringify(s3Cfg);
  };

  const validate = (): string | null => {
    if (!name.trim()) return '名称不能为空';
    if (providerType === 'LOCAL') {
      if (!localCfg.basePath) return '本地存储 basePath 不能为空';
      return null;
    }
    if (!s3Cfg.bucket) return 'bucket 不能为空';
    if (!s3Cfg.region) return 'region 不能为空';
    if ((providerType === 'MINIO' || providerType === 'R2') && !s3Cfg.endpoint) {
      return `${providerType} endpoint 不能为空`;
    }
    if (providerType === 'R2' && !s3Cfg.customUrl && !s3Cfg.urlPrefix) {
      return 'R2 必须配置 customUrl 或 urlPrefix(公网访问域名,如 https://pub-xxxx.r2.dev)';
    }
    return null;
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateStorageProviderRequest) => storageProviderService.create(data),
    onSuccess: () => {
      toast.success('创建成功');
      onSuccess();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, '创建失败'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CreateStorageProviderRequest }) => storageProviderService.update(id, data),
    onSuccess: () => {
      toast.success('保存成功');
      onSuccess();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, '保存失败'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    const payload: CreateStorageProviderRequest = {
      name: name.trim(),
      providerType,
      configJson: buildConfigJson(),
      isEnabled,
      priority,
    };
    if (mode === 'edit' && existing) {
      updateMutation.mutate({ id: existing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const presets = ENDPOINT_PRESETS[providerType] || [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="surface-overlay rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-w-2xl w-full max-h-[92vh] sm:max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] mb-1">
          {mode === 'edit' ? '编辑存储提供商' : '添加存储提供商'}
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-4 sm:mb-5 leading-relaxed">
          {mode === 'edit' ? (
            <>密钥字段已脱敏显示（如 <code className="font-mono">AB****CD12</code>）。<strong>留原值不动密钥不会被覆盖</strong>;改密钥请直接清空再粘贴新明文。</>
          ) : (
            '所有 S3 兼容存储(MinIO/COS/OSS/R2)共用同一组字段;选好类型后用预设按钮一键填 endpoint。'
          )}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 名称 */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如: 主云存储 (COS-HK)"
              required
              className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {/* 类型 */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">存储类型</label>
            <select
              value={providerType}
              onChange={(e) => handleTypeChange(e.target.value as StorageProviderType)}
              className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none"
              disabled={mode === 'edit'} // 编辑时禁止改类型(避免 schema 不一致)
            >
              {PROVIDER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} — {t.description}
                </option>
              ))}
            </select>
            {mode === 'edit' && (
              <p className="text-xs text-[var(--text-muted)] mt-1">编辑时类型已锁定,需换类型请新建一个 provider。</p>
            )}
          </div>

          {/* 字段集 */}
          {providerType === 'LOCAL' ? (
            <LocalFields cfg={localCfg} onChange={setLocalCfg} />
          ) : (
            <S3Fields cfg={s3Cfg} onChange={setS3Cfg} presets={presets} providerType={providerType} />
          )}

          {/* 开关 + 优先级 */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm text-[var(--text-secondary)]">启用</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-secondary)]">优先级:</span>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value || '0', 10))}
                className="w-20 px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] text-sm"
              />
            </label>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2">
            <Button type="button" onClick={onClose} variant="secondary" className="flex-1">
              取消
            </Button>
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? '处理中...' : mode === 'edit' ? '保存修改' : '创建'}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

/**
 * AutoBackupToggle — 全局自动后台备份开关。
 *
 * @ref 对象存储 rollout - Phase 4 / 遗留 2
 * 后端落到 site_settings.storage.sync.auto_enabled。切换后立即启停 worker。
 */
function AutoBackupToggle() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['storage-sync-auto-enabled'],
    queryFn: () => storageSyncService.getAutoEnabled(),
  });
  const enabled = data?.data?.autoEnabled ?? false;

  const setMutation = useMutation({
    mutationFn: (v: boolean) => storageSyncService.setAutoEnabled(v),
    onSuccess: (resp) => {
      const next = resp?.data?.autoEnabled;
      toast.success(next ? '已启用自动后台备份(worker 已启动)' : '已停用自动后台备份');
      queryClient.invalidateQueries({ queryKey: ['storage-sync-auto-enabled'] });
      queryClient.invalidateQueries({ queryKey: ['storage-sync-status'] });
    },
    onError: (e) => {
      toast.error(getApiErrorMessage(e, '切换失败'));
    },
  });

  return (
    <div className="surface-leaf surface-admin-item rounded-xl p-4 mb-4 flex items-start gap-3 sm:items-center sm:justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">自动后台备份</p>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          打开后,worker 会按周期(默认 10s 拣一批)自动把未与备份目标一致的文件复制过去。
          关闭时仅响应"立即备份"按钮 — 适合首次切换目标时人工触发,避免意外费用。
        </p>
      </div>
      <div className="shrink-0 inline-flex items-center gap-2">
        {setMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />}
        <Toggle
          checked={enabled}
          disabled={isLoading || setMutation.isPending}
          onChange={(next) => setMutation.mutate(next)}
        />
      </div>
    </div>
  );
}

/**
 * VerifyToggle — 定期备份完整性校验开关 (Phase 5)。
 *
 * 后端落到 site_settings.storage.verify.auto_enabled,
 * 切换后立即启停 verify worker (独立于主 sync worker)。
 *
 * 提供"立即扫描一轮"按钮,供 admin 手动触发(无需打开自动模式)。
 */
function VerifyToggle() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['storage-sync-verify-enabled'],
    queryFn: () => storageSyncService.getVerifyEnabled(),
  });
  const enabled = data?.data?.autoEnabled ?? false;
  const intervalSec = data?.data?.intervalSeconds ?? 86400;
  const running = data?.data?.running ?? false;

  const setMutation = useMutation({
    mutationFn: (v: boolean) => storageSyncService.setVerifyEnabled(v),
    onSuccess: (resp) => {
      const next = resp?.data?.autoEnabled;
      toast.success(next ? '已启用定期校验(verify worker 已启动)' : '已停用定期校验');
      queryClient.invalidateQueries({ queryKey: ['storage-sync-verify-enabled'] });
    },
    onError: (e) => {
      toast.error(getApiErrorMessage(e, '切换失败'));
    },
  });

  const verifyAllMutation = useMutation({
    mutationFn: () => storageSyncService.verifyAll(),
    onSuccess: (resp) => {
      const checked = resp?.data?.checked ?? 0;
      if (checked === 0) {
        toast.info('当前没有到期需要校验的备份记录');
      } else {
        toast.success(`本轮校验完成,检查了 ${checked} 条记录`);
      }
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
    },
    onError: (e) => {
      toast.error(getApiErrorMessage(e, '触发校验失败'));
    },
  });

  // 间隔展示(秒 → 友好单位)
  const intervalLabel = (() => {
    if (intervalSec >= 86400 && intervalSec % 86400 === 0) return `${intervalSec / 86400} 天`;
    if (intervalSec >= 3600 && intervalSec % 3600 === 0) return `${intervalSec / 3600} 小时`;
    if (intervalSec >= 60 && intervalSec % 60 === 0) return `${intervalSec / 60} 分钟`;
    return `${intervalSec} 秒`;
  })();

  return (
    <div className="surface-leaf surface-admin-item rounded-xl p-4 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
          定期备份完整性校验
          {running && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-status-success/15 text-status-success text-[10px] font-medium">
              <Loader2 className="w-2.5 h-2.5 animate-spin" /> Worker 运行中
            </span>
          )}
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          打开后,worker 每 {intervalLabel} 扫一遍 SYNCED 记录,HEAD 检查云端对象是否还在。
          云端对象已被外部删除的记录会被标记为「云端缺失」,可在媒体详情页一键重新备份。
        </p>
      </div>
      <div className="shrink-0 inline-flex items-center gap-2">
        <button
          onClick={() => verifyAllMutation.mutate()}
          disabled={verifyAllMutation.isPending}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
          title="立即扫描一轮(不打开自动模式也能触发)"
        >
          {verifyAllMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          立即扫描
        </button>
        {setMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />}
        <Toggle
          checked={enabled}
          disabled={isLoading || setMutation.isPending}
          onChange={(next) => setMutation.mutate(next)}
        />
      </div>
    </div>
  );
}

function LocalFields({ cfg, onChange }: { cfg: LocalConfig; onChange: (v: LocalConfig) => void }) {
  return (
    <div className="space-y-3 p-4 bg-[var(--bg-input)]/30 rounded-lg border border-[var(--border-subtle)]">
      <div>
        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">basePath (本地存储根目录)</label>
        <input
          type="text"
          value={cfg.basePath}
          onChange={(e) => onChange({ ...cfg, basePath: e.target.value })}
          placeholder="./uploads"
          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono focus:border-primary/50 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">urlPrefix (访问 URL 前缀)</label>
        <input
          type="text"
          value={cfg.urlPrefix}
          onChange={(e) => onChange({ ...cfg, urlPrefix: e.target.value })}
          placeholder="/uploads"
          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono focus:border-primary/50 focus:outline-none"
        />
      </div>
    </div>
  );
}

function S3Fields({
  cfg,
  onChange,
  presets,
  providerType,
}: {
  cfg: S3LikeConfig;
  onChange: (v: S3LikeConfig) => void;
  presets: EndpointPreset[];
  providerType: StorageProviderType;
}) {
  const endpointLabel =
    providerType === 'COS'
      ? 'endpoint (留空按 region 自动生成 COS endpoint)'
      : providerType === 'OSS'
        ? 'endpoint (留空按 region 自动生成 OSS endpoint)'
        : providerType === 'S3'
          ? 'endpoint (留空走默认 AWS S3)'
          : 'endpoint';
  const endpointPlaceholder =
    providerType === 'COS'
      ? 'https://cos.ap-shanghai.myqcloud.com'
      : providerType === 'OSS'
        ? 'https://oss-cn-shanghai.aliyuncs.com'
        : providerType === 'R2'
          ? '上方填入 account ID 后自动拼接,如自定义 worker 域名可手填'
          : 'https://example.com';

  return (
    <div className="space-y-3 p-4 bg-[var(--bg-input)]/30 rounded-lg border border-[var(--border-subtle)]">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">bucket *</label>
          <input
            type="text"
            value={cfg.bucket}
            onChange={(e) => onChange({ ...cfg, bucket: e.target.value })}
            placeholder="my-bucket"
            className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">region *</label>
          <input
            type="text"
            value={cfg.region}
            onChange={(e) => onChange({ ...cfg, region: e.target.value })}
            placeholder={DEFAULT_REGIONS[providerType] || 'us-east-1'}
            className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
          />
        </div>
      </div>

      {/* R2:Cloudflare Account ID → 自动拼接 endpoint */}
      {providerType === 'R2' && (
        <R2AccountIdField cfg={cfg} onChange={onChange} />
      )}

      {/* endpoint + 预设 */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">{endpointLabel}</label>
        <input
          type="text"
          value={cfg.endpoint}
          onChange={(e) => onChange({ ...cfg, endpoint: e.target.value })}
          placeholder={endpointPlaceholder}
          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
        />
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="text-xs text-[var(--text-muted)] py-1">预设:</span>
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...cfg,
                    endpoint: p.value,
                    allowPrivateEndpoint: p.allowPrivateEndpoint ?? cfg.allowPrivateEndpoint,
                  })
                }
                className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {p.label}
                {p.needsAccountId && <span className="ml-1 opacity-60">(填 account-id)</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 凭证 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">accessKeyId *</label>
          <input
            type="text"
            autoComplete="off"
            value={cfg.accessKeyId}
            onChange={(e) => onChange({ ...cfg, accessKeyId: e.target.value })}
            placeholder="AKIDxxxx... 或 AKIAxxxx..."
            className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">secretAccessKey *</label>
          <input
            type="password"
            autoComplete="new-password"
            value={cfg.secretAccessKey}
            onChange={(e) => onChange({ ...cfg, secretAccessKey: e.target.value })}
            placeholder="编辑模式下空白即保留旧值"
            className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
          />
        </div>
      </div>

      {/* 图床路径与自定义域名 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">path (对象路径前缀)</label>
          <input
            type="text"
            value={cfg.path}
            onChange={(e) => onChange({ ...cfg, path: e.target.value })}
            placeholder="assets/"
            className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">options (URL 查询参数)</label>
          <input
            type="text"
            value={cfg.options}
            onChange={(e) => onChange({ ...cfg, options: e.target.value })}
            placeholder="?variant=public"
            className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
          customUrl (图床/自定义域名;优先于 urlPrefix)
          {providerType === 'R2' && <span className="text-status-danger ml-1">R2 必填其一</span>}
        </label>
        <input
          type="text"
          value={cfg.customUrl}
          onChange={(e) => onChange({ ...cfg, customUrl: e.target.value })}
          placeholder={providerType === 'COS' ? 'https://cdn.example.com' : 'https://cdn.example.com'}
          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
        />
      </div>

      {/* CDN URL 前缀 */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
          urlPrefix (兼容旧 CDN 字段;留空时按 bucket+endpoint 自动拼接)
          {providerType === 'R2' && <span className="text-status-danger ml-1">R2 必填其一</span>}
        </label>
        <input
          type="text"
          value={cfg.urlPrefix}
          onChange={(e) => onChange({ ...cfg, urlPrefix: e.target.value })}
          placeholder={
            providerType === 'R2'
              ? 'https://pub-xxxx.r2.dev 或自定义域名'
              : providerType === 'COS'
                ? 'https://your-cdn.example.com (可选,新配置建议用 customUrl)'
                : '可选'
          }
          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
        />
      </div>

      {/* forcePathStyle */}
      <label className="flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          checked={cfg.forcePathStyle}
          onChange={(e) => onChange({ ...cfg, forcePathStyle: e.target.checked })}
          className="w-4 h-4"
        />
        <span className="text-sm text-[var(--text-secondary)]">forcePathStyle</span>
        <span className="text-xs text-[var(--text-muted)]">(MinIO/R2 必须开启)</span>
      </label>

      {providerType === 'MINIO' && (
        <label className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            checked={cfg.allowPrivateEndpoint}
            onChange={(e) => onChange({ ...cfg, allowPrivateEndpoint: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm text-[var(--text-secondary)]">allowPrivateEndpoint</span>
          <span className="text-xs text-[var(--text-muted)]">(允许 localhost/内网 endpoint)</span>
        </label>
      )}
    </div>
  );
}

/**
 * R2AccountIdField:R2 模式专用的 Cloudflare Account ID 输入框,自动驱动 endpoint 拼装。
 *
 * 双向同步规则:
 * - accountId 反向解析自 cfg.endpoint(`https://{32 位 hex}.r2.cloudflarestorage.com`)
 * - 用户编辑 accountId → 自动重写 cfg.endpoint;若 region 为空则一并填入 'auto'
 * - cfg.endpoint 已是非标 URL(自定义 worker / 透明代理) → accountId 显示空,不影响 endpoint
 *
 * @ref 云储存优化批次 3a — 消除"复制 <account-id> 字面量到 endpoint" 卡点
 */
function R2AccountIdField({
  cfg,
  onChange,
}: {
  cfg: S3LikeConfig;
  onChange: (v: S3LikeConfig) => void;
}) {
  const accountId = extractR2AccountId(cfg.endpoint);
  // 已是非标 endpoint(空 / 自定义 worker / 等)→ 显示警告,但不阻塞用户继续手填 endpoint
  const endpointHasValue = cfg.endpoint.trim() !== '';
  const endpointParsed = endpointHasValue && accountId !== '';
  const endpointUnparsed = endpointHasValue && !endpointParsed;

  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
        Cloudflare Account ID *
        <span className="ml-2 text-[var(--text-muted)] font-normal">
          (自动拼接 endpoint;Cloudflare Dashboard → R2 → 右上角"Use R2 with APIs")
        </span>
      </label>
      <input
        type="text"
        value={accountId}
        onChange={(e) => {
          const next = e.target.value.trim();
          onChange({
            ...cfg,
            endpoint: buildR2Endpoint(next),
            // R2 默认 region = 'auto' —— 用户不必再手填
            region: cfg.region || 'auto',
          });
        }}
        placeholder="1234567890abcdef1234567890abcdef"
        className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
        autoComplete="off"
        spellCheck={false}
      />
      {endpointParsed && (
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          endpoint 已自动设置:<span className="font-mono text-status-success">{cfg.endpoint}</span>
        </p>
      )}
      {endpointUnparsed && (
        <p className="mt-1 text-[11px] text-status-warning">
          检测到非标 endpoint(自定义 worker / 透明代理);保持手填即可,此输入框不影响。
        </p>
      )}
    </div>
  );
}
