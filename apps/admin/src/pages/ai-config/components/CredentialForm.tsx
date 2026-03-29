// 凭证配置表单组件
// ref: §5.1 - AI Service 架构

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Save, Trash2, Loader2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import type { AiCredential, CreateCredentialRequest } from '@/services/aiProviderService';
import { useCreateCredential, useDeleteCredential } from '../hooks/useCredentials';

interface CredentialFormProps {
  providerCode: string;
  credential?: AiCredential | null;
  providerCapabilities?: Record<string, unknown> | null;
  onSaved?: () => void;
}

type ApiPathMode = 'auto' | 'append_v1' | 'strip_v1';

export default function CredentialForm({
  providerCode,
  credential,
  providerCapabilities,
  onSaved,
}: CredentialFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [name, setName] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [apiPathMode, setApiPathMode] = useState<ApiPathMode>('auto');
  const providerSettings = (providerCapabilities?.settings || {}) as Record<string, unknown>;
  const proxySetting = providerSettings.proxyUrl as
    | { title?: string; placeholder?: string; desc?: string }
    | false
    | undefined;
  const showApiKey = providerSettings.showApiKey !== false;
  const showBaseUrl = proxySetting !== false;
  const apiKeyUrl =
    (providerCapabilities?.apiKeyUrl as string | undefined) ||
    (providerCapabilities?.api_key_url as string | undefined);

  const createMutation = useCreateCredential();
  const deleteMutation = useDeleteCredential();

  // 初始化表单值
  useEffect(() => {
    if (credential) {
      setBaseUrl(credential.base_url_override || '');
      setName(credential.name || '');
      setIsDefault(credential.is_default);
      setApiPathMode((credential.extra_config?.api_path_mode as ApiPathMode) || 'auto');
      // API Key 不回显，只显示 hint
      setApiKey('');
    }
  }, [credential]);

  const handleSave = () => {
    if (showApiKey && !apiKey && !credential) {
      return; // 新创建时必须有 API Key
    }

    const payload: CreateCredentialRequest = {
      provider_code: providerCode,
      api_key: apiKey || '', // 空字符串表示保持原有的
      name: name || null,
      base_url_override: baseUrl || null,
      is_default: isDefault,
      extra_config: {
        api_path_mode: apiPathMode,
      },
    };

    createMutation.mutate(payload, {
      onSuccess: () => {
        setApiKey('');
        onSaved?.();
      },
    });
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    if (!credential) return;
    deleteMutation.mutate(credential.id);
  };

  const isPending = createMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-4">
      {/* API Key */}
      {showApiKey ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            API Key
            {credential?.api_key_hint && (
              <span className="text-xs text-[var(--text-muted)]/60">
                (当前: {credential.api_key_hint})
              </span>
            )}
            {apiKeyUrl && (
              <a
                href={apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline"
              >
                获取密钥
              </a>
            )}
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={credential ? '输入新 Key 以更新，留空保持原有' : 'sk-...'}
              className="w-full pr-10 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-muted)]">
          该服务商无需 API Key
        </div>
      )}

      {/* Base URL Override */}
      {showBaseUrl && (
        <div className="space-y-2">
          <label className="text-sm text-[var(--text-muted)]">
            {proxySetting && typeof proxySetting === 'object' && proxySetting.title
              ? proxySetting.title
              : 'API 代理地址'}
            <span className="text-xs opacity-60 ml-1">(可选)</span>
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              proxySetting && typeof proxySetting === 'object' && proxySetting.placeholder
                ? proxySetting.placeholder
                : 'https://api.example.com/v1'
            }
            className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all"
          />
          {proxySetting && typeof proxySetting === 'object' && proxySetting.desc && (
            <p className="text-xs text-[var(--text-muted)]">{proxySetting.desc}</p>
          )}
        </div>
      )}

      {/* API Path Mode */}
      <div className="space-y-2">
        <label className="text-sm text-[var(--text-muted)]">API 路径策略</label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { label: '自动', value: 'auto' },
              { label: '追加 /v1', value: 'append_v1' },
              { label: 'Claude 无 /v1', value: 'strip_v1' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setApiPathMode(item.value)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                apiPathMode === item.value
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--border-hover)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          OpenAI 兼容建议使用 /v1，Claude/Anthropic 通常不需要 /v1。
        </p>
      </div>

      {/* 名称 */}
      <div className="space-y-2">
        <label className="text-sm text-[var(--text-muted)]">
          凭证名称
          <span className="text-xs opacity-60 ml-1">(可选)</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="生产环境 Key"
          className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all"
        />
      </div>

      {/* 默认凭证 */}
      <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="rounded border-[var(--border-default)]"
        />
        设为默认凭证
      </label>

      {/* 操作按钮 */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={isPending || (showApiKey && !apiKey && !credential)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {createMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          保存
        </button>

        {credential && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-status-danger-border text-status-danger font-medium text-sm hover:bg-status-danger-light transition-colors disabled:opacity-50"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            删除
          </button>
        )}
      </div>

      {/* 安全提示 */}
      <p className="text-xs text-[var(--text-muted)] italic">
        🔒 你的密钥与代理地址等将使用 AES-GCM 加密算法进行加密
      </p>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="删除凭证"
        message="确定删除该凭证吗？删除后将无法恢复。"
        confirmText="删除"
        variant="danger"
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete(); }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
