import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Server, Check, Trash2, TestTube, Edit3, Cloud, HardDrive, Loader2 } from 'lucide-react';
import { Button } from '@aetherblog/ui';
import { storageProviderService, CreateStorageProviderRequest } from '@/services/storageProviderService';
import { storageSyncService } from '@/services/storageSyncService';
import type { StorageProvider, StorageProviderType } from '@aetherblog/types';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

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

// 各 provider 的 endpoint 预设(用于一键填入)
const ENDPOINT_PRESETS: Partial<Record<StorageProviderType, { label: string; value: string; needsAccountId?: boolean }[]>> = {
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
    { label: 'Cloudflare R2', value: 'https://<account-id>.r2.cloudflarestorage.com', needsAccountId: true },
  ],
  MINIO: [
    { label: '本地默认 (localhost:9000)', value: 'http://localhost:9000' },
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
 * S3 兼容配置(LOCAL 之外的统一形状)
 *
 * 后端 storage/s3.go 的 S3Config 字段:
 *   bucket, region, endpoint, accessKeyId, secretAccessKey, urlPrefix, forcePathStyle
 */
interface S3LikeConfig {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  urlPrefix: string;
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
  urlPrefix: '',
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

export default function StorageProviderSettings() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StorageProvider | null>(null);

  // 获取所有存储提供商
  const { data: providersResponse, isLoading } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => storageProviderService.getAll(),
  });

  const providers = providersResponse?.data || [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => storageProviderService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] });
      toast.success('删除成功');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '删除失败');
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: number) => storageProviderService.setAsDefault(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] });
      toast.success('已设置为默认存储');
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

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2 mb-1">
            <Cloud className="w-5 h-5 text-[var(--text-muted)]" />
            存储管理
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            配置本地、S3、COS、OSS、MinIO、R2 等存储后端;set-default 后新文件自动入云。
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="w-4 h-4" /> 添加存储提供商
        </Button>
      </div>

      {/* 全局开关:自动后台备份 — Phase 4 */}
      <AutoBackupToggle />

      {/* 提供商列表 */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-12 text-[var(--text-muted)]">加载中...</div>
        ) : providers.length === 0 ? (
          <div className="text-center py-12 surface-leaf rounded-2xl">
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
              testing={testMutation.isPending}
              busyDelete={deleteMutation.isPending}
              busySetDefault={setDefaultMutation.isPending}
            />
          ))
        )}
      </div>

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

// ProviderCard 列表中的单个 provider 行
function ProviderCard({
  provider,
  onEdit,
  onDelete,
  onTest,
  onSetDefault,
  testing,
  busyDelete,
  busySetDefault,
}: {
  provider: StorageProvider;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onSetDefault: () => void;
  testing: boolean;
  busyDelete: boolean;
  busySetDefault: boolean;
}) {
  const TypeIcon = provider.providerType === 'LOCAL' ? HardDrive : Cloud;
  const summary = useMemo(() => {
    try {
      const cfg = JSON.parse(provider.configJson) as Record<string, unknown>;
      if (provider.providerType === 'LOCAL') {
        return `路径 ${cfg.basePath || './uploads'}`;
      }
      const bucket = (cfg.bucket as string) || '-';
      const region = (cfg.region as string) || '-';
      return `bucket: ${bucket} · region: ${region}`;
    } catch {
      return '配置解析失败';
    }
  }, [provider.configJson, provider.providerType]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface-leaf rounded-2xl p-5"
      data-interactive
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <TypeIcon className="w-5 h-5 text-primary" />
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{provider.name}</h3>
            <span className="px-2 py-0.5 bg-primary/15 text-primary text-xs font-medium rounded-full font-mono">
              {provider.providerType}
            </span>
            {provider.isDefault && (
              <span className="px-2 py-0.5 bg-[color:color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)] text-xs font-medium rounded-full">
                默认
              </span>
            )}
            {!provider.isEnabled && (
              <span className="px-2 py-0.5 bg-status-danger/20 text-status-danger text-xs font-medium rounded-full">
                已禁用
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-2">{summary}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">优先级: {provider.priority}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onTest}
            disabled={testing}
            className="p-2 text-[var(--text-secondary)] hover:text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
            title="测试连接"
          >
            <TestTube className="w-4 h-4" />
          </button>
          <button
            onClick={onEdit}
            className="p-2 text-[var(--text-secondary)] hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
            title="编辑配置"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          {!provider.isDefault && (
            <button
              onClick={onSetDefault}
              disabled={busySetDefault}
              className="p-2 text-[var(--text-secondary)] hover:text-status-success hover:bg-status-success/10 rounded-lg transition-colors disabled:opacity-50"
              title="设为默认"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={provider.isDefault || busyDelete}
            className="p-2 text-[var(--text-secondary)] hover:text-status-danger hover:bg-status-danger/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={provider.isDefault ? '默认 provider 不可删除,请先切换' : '删除'}
          >
            <Trash2 className="w-4 h-4" />
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
    if (type !== 'LOCAL' && DEFAULT_REGIONS[type] && !s3Cfg.region) {
      setS3Cfg({ ...s3Cfg, region: DEFAULT_REGIONS[type] || '' });
    }
    if (type === 'R2') {
      // R2 必须 forcePathStyle=true
      setS3Cfg({ ...s3Cfg, forcePathStyle: true });
    }
    if (type === 'MINIO') {
      // MinIO 通常 forcePathStyle=true
      setS3Cfg({ ...s3Cfg, forcePathStyle: true });
    }
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
    if (providerType === 'R2' && !s3Cfg.urlPrefix) {
      return 'R2 必须配置 urlPrefix(公网访问域名,如 https://pub-xxxx.r2.dev)';
    }
    return null;
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateStorageProviderRequest) => storageProviderService.create(data),
    onSuccess: () => {
      toast.success('创建成功');
      onSuccess();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '创建失败');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CreateStorageProviderRequest }) => storageProviderService.update(id, data),
    onSuccess: () => {
      toast.success('保存成功');
      onSuccess();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '保存失败');
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
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="surface-overlay rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-[var(--text-primary)] mb-1">
          {mode === 'edit' ? '编辑存储提供商' : '添加存储提供商'}
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-5">
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
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2">
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
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? '处理中...' : mode === 'edit' ? '保存修改' : '创建'}
            </Button>
            <Button type="button" onClick={onClose} variant="secondary" className="flex-1">
              取消
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      toast.error(e.response?.data?.msg || '切换失败');
    },
  });

  return (
    <div className="surface-leaf rounded-xl p-4 mb-4 flex items-center justify-between">
      <div className="flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">自动后台备份</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          打开后,worker 会按周期(默认 10s 拣一批)自动把未与默认 provider 同步的文件备份到云。<br/>
          关闭时仅响应"立即备份"按钮 — 适合首次切云时人工触发,避免意外费用。
        </p>
      </div>
      <button
        type="button"
        disabled={isLoading || setMutation.isPending}
        onClick={() => setMutation.mutate(!enabled)}
        className="ml-4 shrink-0 inline-flex items-center gap-2"
        aria-pressed={enabled}
      >
        {setMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />}
        <span
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-primary' : 'bg-[var(--bg-input)]'
          } ${(isLoading || setMutation.isPending) && 'opacity-60'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </span>
      </button>
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
  presets: { label: string; value: string; needsAccountId?: boolean }[];
  providerType: StorageProviderType;
}) {
  return (
    <div className="space-y-3 p-4 bg-[var(--bg-input)]/30 rounded-lg border border-[var(--border-subtle)]">
      <div className="grid grid-cols-2 gap-3">
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

      {/* endpoint + 预设 */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">endpoint (留空走默认 AWS S3)</label>
        <input
          type="text"
          value={cfg.endpoint}
          onChange={(e) => onChange({ ...cfg, endpoint: e.target.value })}
          placeholder="https://cos.ap-guangzhou.myqcloud.com"
          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
        />
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="text-xs text-[var(--text-muted)] py-1">预设:</span>
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => onChange({ ...cfg, endpoint: p.value })}
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
      <div className="grid grid-cols-2 gap-3">
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

      {/* CDN URL 前缀 */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
          urlPrefix (CDN 域名;留空时按 bucket+endpoint 自动拼接)
          {providerType === 'R2' && <span className="text-status-danger ml-1">R2 必填</span>}
        </label>
        <input
          type="text"
          value={cfg.urlPrefix}
          onChange={(e) => onChange({ ...cfg, urlPrefix: e.target.value })}
          placeholder={
            providerType === 'R2'
              ? 'https://pub-xxxx.r2.dev 或自定义域名'
              : providerType === 'COS'
                ? 'https://your-cdn.example.com (可选)'
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
    </div>
  );
}
