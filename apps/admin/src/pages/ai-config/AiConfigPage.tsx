import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus,
  Trash2,
  TestTube,
  Pencil,
  Save,
  X,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  aiProviderService,
  type AiProvider,
  type AiModel,
  type AiRouting,
  type CreateProviderRequest,
  type CreateModelRequest,
  type CreateCredentialRequest,
  type UpdateProviderRequest,
  type UpdateModelRequest,
  type RoutingUpdateRequest,
} from '@/services/aiProviderService';

const TABS = [
  { id: 'providers', label: '供应商' },
  { id: 'models', label: '模型' },
  { id: 'credentials', label: '凭证' },
  { id: 'routing', label: '路由' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PROVIDER_TYPES = [
  { value: 'openai_compat', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'custom', label: '自定义' },
];

const MODEL_TYPES = [
  { value: 'chat', label: 'Chat' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'image', label: 'Image' },
  { value: 'audio', label: 'Audio' },
  { value: 'reasoning', label: 'Reasoning' },
];

function parseJson(input: string, fallback: Record<string, any> = {}) {
  if (!input.trim()) return fallback;
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error('JSON 格式不正确');
  }
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.98 }}
        className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-[var(--bg-overlay)] p-6 shadow-xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function Tabs({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/10 mb-6">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
            active === tab.id
              ? 'bg-white/10 text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ProviderDialog({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: AiProvider | null;
  onClose: () => void;
  onSubmit: (payload: CreateProviderRequest | UpdateProviderRequest) => void;
}) {
  const [form, setForm] = useState({
    code: initial?.code || '',
    name: initial?.name || '',
    display_name: initial?.display_name || '',
    api_type: initial?.api_type || 'openai_compat',
    base_url: initial?.base_url || '',
    doc_url: initial?.doc_url || '',
    icon: initial?.icon || '',
    priority: initial?.priority ?? 0,
    is_enabled: initial?.is_enabled ?? true,
    capabilities: JSON.stringify(initial?.capabilities || {}, null, 2),
    config_schema: JSON.stringify(initial?.config_schema || {}, null, 2),
  });

  const handleSubmit = () => {
    try {
      const payload = {
        ...(mode === 'create' ? { code: form.code } : {}),
        name: form.name,
        display_name: form.display_name || null,
        api_type: form.api_type,
        base_url: form.base_url || null,
        doc_url: form.doc_url || null,
        icon: form.icon || null,
        priority: Number(form.priority || 0),
        is_enabled: form.is_enabled,
        capabilities: parseJson(form.capabilities),
        config_schema: parseJson(form.config_schema),
      } as CreateProviderRequest | UpdateProviderRequest;
      onSubmit(payload);
    } catch (error: any) {
      toast.error(error.message || '保存失败');
    }
  };

  return (
    <Modal title={mode === 'create' ? '新增供应商' : '编辑供应商'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        {mode === 'create' && (
          <label className="space-y-1 text-sm text-[var(--text-muted)]">
            代码
            <input
              value={form.code}
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
              placeholder="openai"
            />
          </label>
        )}
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          名称
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
            placeholder="OpenAI"
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          显示名
          <input
            value={form.display_name}
            onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
            placeholder="OpenAI"
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          API 类型
          <select
            value={form.api_type}
            onChange={(e) => setForm((prev) => ({ ...prev, api_type: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          >
            {PROVIDER_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          Base URL
          <input
            value={form.base_url}
            onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          文档地址
          <input
            value={form.doc_url}
            onChange={(e) => setForm((prev) => ({ ...prev, doc_url: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          图标地址
          <input
            value={form.icon}
            onChange={(e) => setForm((prev) => ({ ...prev, icon: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          优先级
          <input
            type="number"
            value={form.priority}
            onChange={(e) => setForm((prev) => ({ ...prev, priority: Number(e.target.value) }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] mt-2">
          <input
            type="checkbox"
            checked={form.is_enabled}
            onChange={(e) => setForm((prev) => ({ ...prev, is_enabled: e.target.checked }))}
          />
          启用
        </label>
      </div>
      <label className="block mt-4 text-sm text-[var(--text-muted)]">
        能力 (JSON)
        <textarea
          value={form.capabilities}
          onChange={(e) => setForm((prev) => ({ ...prev, capabilities: e.target.value }))}
          className="mt-1 w-full h-28 rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-3 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner resize-none font-mono text-xs"
        />
      </label>
      <label className="block mt-4 text-sm text-[var(--text-muted)]">
        配置 Schema (JSON)
        <textarea
          value={form.config_schema}
          onChange={(e) => setForm((prev) => ({ ...prev, config_schema: e.target.value }))}
          className="mt-1 w-full h-28 rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-3 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner resize-none font-mono text-xs"
        />
      </label>
      <p className="mt-4 text-[10px] text-[var(--text-muted)] italic">
        提示：供应商仅定义平台信息。如需配置 API Key，请保存后前往<b>「凭证」</b>标签页。
      </p>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={handleSubmit}>保存</Button>
      </div>
    </Modal>
  );
}

function ModelDialog({
  mode,
  providers,
  initial,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  providers: AiProvider[];
  initial?: AiModel | null;
  onClose: () => void;
  onSubmit: (providerCode: string, payload: CreateModelRequest | UpdateModelRequest) => void;
}) {
  const [providerCode, setProviderCode] = useState(initial?.provider_code || providers[0]?.code || '');
  const [form, setForm] = useState({
    model_id: initial?.model_id || '',
    display_name: initial?.display_name || '',
    model_type: initial?.model_type || 'chat',
    context_window: initial?.context_window ?? '',
    max_output_tokens: initial?.max_output_tokens ?? '',
    input_cost_per_1k: initial?.input_cost_per_1k ?? '',
    output_cost_per_1k: initial?.output_cost_per_1k ?? '',
    is_enabled: initial?.is_enabled ?? true,
    capabilities: JSON.stringify(initial?.capabilities || {}, null, 2),
  });

  const handleSubmit = () => {
    try {
      const payload = {
        ...(mode === 'create' ? { model_id: form.model_id } : {}),
        display_name: form.display_name || null,
        model_type: form.model_type,
        context_window: form.context_window === '' ? null : Number(form.context_window),
        max_output_tokens: form.max_output_tokens === '' ? null : Number(form.max_output_tokens),
        input_cost_per_1k: form.input_cost_per_1k === '' ? null : Number(form.input_cost_per_1k),
        output_cost_per_1k: form.output_cost_per_1k === '' ? null : Number(form.output_cost_per_1k),
        capabilities: parseJson(form.capabilities),
        is_enabled: form.is_enabled,
      } as CreateModelRequest | UpdateModelRequest;
      onSubmit(providerCode, payload);
    } catch (error: any) {
      toast.error(error.message || '保存失败');
    }
  };

  return (
    <Modal title={mode === 'create' ? '新增模型' : '编辑模型'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          供应商
          <select
            value={providerCode}
            onChange={(e) => setProviderCode(e.target.value)}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
            disabled={mode === 'edit'}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.code}>{provider.display_name || provider.name}</option>
            ))}
          </select>
        </label>
        {mode === 'create' && (
          <label className="space-y-1 text-sm text-[var(--text-muted)]">
            模型 ID
            <input
              value={form.model_id}
              onChange={(e) => setForm((prev) => ({ ...prev, model_id: e.target.value }))}
              className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
              placeholder="gpt-4o-mini"
            />
          </label>
        )}
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          显示名
          <input
            value={form.display_name}
            onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          模型类型
          <select
            value={form.model_type}
            onChange={(e) => setForm((prev) => ({ ...prev, model_type: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          >
            {MODEL_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          上下文窗口
          <input
            type="number"
            value={form.context_window}
            onChange={(e) => setForm((prev) => ({ ...prev, context_window: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          最大输出
          <input
            type="number"
            value={form.max_output_tokens}
            onChange={(e) => setForm((prev) => ({ ...prev, max_output_tokens: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          输入成本/1k
          <input
            type="number"
            step="0.00001"
            value={form.input_cost_per_1k}
            onChange={(e) => setForm((prev) => ({ ...prev, input_cost_per_1k: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          输出成本/1k
          <input
            type="number"
            step="0.00001"
            value={form.output_cost_per_1k}
            onChange={(e) => setForm((prev) => ({ ...prev, output_cost_per_1k: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] mt-2">
          <input
            type="checkbox"
            checked={form.is_enabled}
            onChange={(e) => setForm((prev) => ({ ...prev, is_enabled: e.target.checked }))}
          />
          启用
        </label>
      </div>
      <label className="block mt-4 text-sm text-[var(--text-muted)]">
        能力 (JSON)
        <textarea
          value={form.capabilities}
          onChange={(e) => setForm((prev) => ({ ...prev, capabilities: e.target.value }))}
          className="mt-1 w-full h-28 rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-3 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner resize-none font-mono text-xs"
        />
      </label>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={handleSubmit}>保存</Button>
      </div>
    </Modal>
  );
}

function CredentialDialog({
  providers,
  onClose,
  onSubmit,
  defaultProviderCode,
}: {
  providers: AiProvider[];
  onClose: () => void;
  onSubmit: (payload: CreateCredentialRequest) => void;
  defaultProviderCode?: string;
}) {
  const [form, setForm] = useState({
    provider_code: defaultProviderCode || providers[0]?.code || '',
    api_key: '',
    name: '',
    base_url_override: '',
    is_default: false,
    extra_config: '{}',
  });

  const handleSubmit = () => {
    try {
      const payload: CreateCredentialRequest = {
        provider_code: form.provider_code,
        api_key: form.api_key,
        name: form.name || null,
        base_url_override: form.base_url_override || null,
        is_default: form.is_default,
        extra_config: parseJson(form.extra_config),
      };
      onSubmit(payload);
    } catch (error: any) {
      toast.error(error.message || '保存失败');
    }
  };

  return (
    <Modal title="新增凭证" onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          供应商
          <select
            value={form.provider_code}
            onChange={(e) => setForm((prev) => ({ ...prev, provider_code: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.code}>{provider.display_name || provider.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm text-[var(--text-muted)]">
          名称
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
            placeholder="生产 Key"
          />
        </label>
        <label className="col-span-2 space-y-1 text-sm text-[var(--text-muted)]">
          API Key
          <input
            value={form.api_key}
            onChange={(e) => setForm((prev) => ({ ...prev, api_key: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
            placeholder="sk-..."
          />
        </label>
        <label className="col-span-2 space-y-1 text-sm text-[var(--text-muted)]">
          Base URL 覆盖
          <input
            value={form.base_url_override}
            onChange={(e) => setForm((prev) => ({ ...prev, base_url_override: e.target.value }))}
            className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] mt-2">
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => setForm((prev) => ({ ...prev, is_default: e.target.checked }))}
          />
          设为默认
        </label>
      </div>
      <label className="block mt-4 text-sm text-[var(--text-muted)]">
        扩展配置 (JSON)
        <textarea
          value={form.extra_config}
          onChange={(e) => setForm((prev) => ({ ...prev, extra_config: e.target.value }))}
          className="mt-1 w-full h-24 rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-3 text-[var(--text-primary)] placeholder-white/20 focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner resize-none font-mono text-xs"
        />
      </label>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={handleSubmit}>保存</Button>
      </div>
    </Modal>
  );
}

export default function AiConfigPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('providers');
  const [editingProvider, setEditingProvider] = useState<AiProvider | null>(null);
  const [editingModel, setEditingModel] = useState<AiModel | null>(null);
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [showCredentialDialog, setShowCredentialDialog] = useState(false);
  const [preSelectedProvider, setPreSelectedProvider] = useState<string | undefined>();

  const { data: providersResponse, isLoading: providersLoading } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiProviderService.listProviders(false),
  });

  const providers = providersResponse?.data || [];

  const { data: modelsResponse, isLoading: modelsLoading } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => aiProviderService.listModels(),
  });

  const models = modelsResponse?.data || [];

  const { data: credentialsResponse, isLoading: credentialsLoading } = useQuery({
    queryKey: ['ai-credentials'],
    queryFn: () => aiProviderService.listCredentials(),
  });

  const credentials = credentialsResponse?.data || [];

  const { data: tasksResponse } = useQuery({
    queryKey: ['ai-tasks'],
    queryFn: () => aiProviderService.listTasks(),
  });

  const tasks = tasksResponse?.data || [];

  const { data: routingMap } = useQuery({
    queryKey: ['ai-routing', tasks.map((t) => t.code)],
    enabled: tasks.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        tasks.map(async (task) => {
          const res = await aiProviderService.getRouting(task.code);
          return [task.code, res.data];
        })
      );
      return Object.fromEntries(entries) as Record<string, AiRouting | null>;
    },
  });

  const [routingState, setRoutingState] = useState<Record<string, { primary: string; fallback: string }>>({});

  useEffect(() => {
    if (!tasks.length || !routingMap) return;
    const next: Record<string, { primary: string; fallback: string }> = {};
    tasks.forEach((task) => {
      const routing = routingMap[task.code];
      next[task.code] = {
        primary: routing?.primary_model?.id ? String(routing.primary_model.id) : '',
        fallback: routing?.fallback_model?.id ? String(routing.fallback_model.id) : '',
      };
    });
    setRoutingState(next);
  }, [tasks, routingMap]);

  const providerMutation = useMutation({
    mutationFn: ({ mode, id, payload }: { mode: 'create' | 'edit'; id?: number; payload: CreateProviderRequest | UpdateProviderRequest }) => {
      if (mode === 'create') return aiProviderService.createProvider(payload as CreateProviderRequest);
      return aiProviderService.updateProvider(id!, payload as UpdateProviderRequest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
      toast.success('保存成功');
      setShowProviderDialog(false);
      setEditingProvider(null);
    },
    onError: (error: any) => {
      toast.error(error?.message || '保存失败');
    },
  });

  const deleteProviderMutation = useMutation({
    mutationFn: (id: number) => aiProviderService.deleteProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      toast.success('已删除');
    },
    onError: () => toast.error('删除失败'),
  });

  const modelMutation = useMutation({
    mutationFn: ({ mode, providerCode, id, payload }: { mode: 'create' | 'edit'; providerCode: string; id?: number; payload: CreateModelRequest | UpdateModelRequest }) => {
      if (mode === 'create') return aiProviderService.createModel(providerCode, payload as CreateModelRequest);
      return aiProviderService.updateModel(id!, payload as UpdateModelRequest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      toast.success('保存成功');
      setShowModelDialog(false);
      setEditingModel(null);
    },
    onError: () => toast.error('保存失败'),
  });

  const deleteModelMutation = useMutation({
    mutationFn: (id: number) => aiProviderService.deleteModel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      toast.success('已删除');
    },
    onError: () => toast.error('删除失败'),
  });

  const credentialMutation = useMutation({
    mutationFn: (payload: CreateCredentialRequest) => aiProviderService.createCredential(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-credentials'] });
      toast.success('凭证已保存');
      setShowCredentialDialog(false);
    },
    onError: (error: any) => toast.error(error?.message || '保存失败'),
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: (id: number) => aiProviderService.deleteCredential(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-credentials'] });
      toast.success('已删除');
    },
    onError: () => toast.error('删除失败'),
  });

  const testCredentialMutation = useMutation({
    mutationFn: (id: number) => aiProviderService.testCredential(id),
    onSuccess: (res) => {
      if (res.data.success) toast.success(res.data.message || '连接成功');
      else toast.error(res.data.message || '连接失败');
    },
    onError: () => toast.error('连接失败'),
  });

  const updateRoutingMutation = useMutation({
    mutationFn: ({ taskType, payload }: { taskType: string; payload: RoutingUpdateRequest }) =>
      aiProviderService.updateRouting(taskType, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-routing'] });
      toast.success('路由已更新');
    },
    onError: () => toast.error('更新失败'),
  });

  const groupedModels = useMemo(() => {
    const groups: Record<string, AiModel[]> = {};
    models.forEach((model) => {
      const key = model.provider_code || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(model);
    });
    return groups;
  }, [models]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">AI 配置中心</h1>
            <p className="text-sm text-[var(--text-muted)]">管理模型供应商、模型、凭证和任务路由</p>
          </div>
          <button
            onClick={() => queryClient.invalidateQueries()}
            className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <RefreshCw className="w-4 h-4" />
            刷新数据
          </button>
        </div>

        <Tabs active={activeTab} onChange={setActiveTab} />

        {activeTab === 'providers' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button className="gap-2" onClick={() => setShowProviderDialog(true)}>
                <Plus className="w-4 h-4" /> 新增供应商
              </Button>
            </div>
            {providersLoading ? (
              <div className="text-center py-12 text-[var(--text-muted)]">加载中...</div>
            ) : providers.length === 0 ? (
              <div className="text-center py-12 text-[var(--text-muted)]">暂无供应商</div>
            ) : (
              providers.map((provider) => (
                <motion.div
                  key={provider.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group rounded-3xl border border-white/5 bg-[var(--bg-card)]/40 backdrop-blur-3xl p-6 shadow-xl hover:shadow-2xl hover:border-primary/20 hover:bg-[var(--bg-card)]/60 transition-all duration-500 relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                          {provider.display_name || provider.name}
                        </h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-muted)]">
                          {provider.code}
                        </span>
                        {!provider.is_enabled && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">已禁用</span>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-[var(--text-muted)] space-y-1">
                        <div>类型: {provider.api_type}</div>
                        <div>Base URL: {provider.base_url || '-'}</div>
                        <div>优先级: {provider.priority}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                       <button
                        onClick={() => {
                          setPreSelectedProvider(provider.code);
                          setActiveTab('credentials');
                          setShowCredentialDialog(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary hover:text-white transition-all duration-300"
                      >
                        <Save className="w-3.5 h-3.5" />
                        管理密钥
                      </button>
                      <button
                        onClick={() => {
                          setEditingProvider(provider);
                          setShowProviderDialog(true);
                        }}
                        className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('确定删除该供应商吗？')) {
                            deleteProviderMutation.mutate(provider.id);
                          }
                        }}
                        className="p-2 text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        )}

        {activeTab === 'models' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button className="gap-2" onClick={() => setShowModelDialog(true)} disabled={providers.length === 0}>
                <Plus className="w-4 h-4" /> 新增模型
              </Button>
            </div>
            {modelsLoading ? (
              <div className="text-center py-12 text-[var(--text-muted)]">加载中...</div>
            ) : models.length === 0 ? (
              <div className="text-center py-12 text-[var(--text-muted)]">暂无模型</div>
            ) : (
              models.map((model) => (
                <div key={model.id} className="group rounded-3xl border border-white/5 bg-[var(--bg-card)]/40 backdrop-blur-3xl p-6 shadow-xl hover:shadow-2xl hover:border-primary/20 hover:bg-[var(--bg-card)]/60 transition-all duration-500 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">{model.display_name || model.model_id}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-muted)]">
                          {model.provider_code}
                        </span>
                        {!model.is_enabled && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">已禁用</span>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-[var(--text-muted)] space-y-1">
                        <div>ID: {model.model_id}</div>
                        <div>类型: {model.model_type}</div>
                        <div>上下文: {model.context_window || '-'} / 输出: {model.max_output_tokens || '-'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setEditingModel(model);
                          setShowModelDialog(true);
                        }}
                        className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('确定删除该模型吗？')) {
                            deleteModelMutation.mutate(model.id);
                          }
                        }}
                        className="p-2 text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'credentials' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button className="gap-2" onClick={() => setShowCredentialDialog(true)} disabled={providers.length === 0}>
                <Plus className="w-4 h-4" /> 新增凭证
              </Button>
            </div>
            {credentialsLoading ? (
              <div className="text-center py-12 text-[var(--text-muted)]">加载中...</div>
            ) : credentials.length === 0 ? (
              <div className="text-center py-12 text-[var(--text-muted)]">暂无凭证</div>
            ) : (
              credentials.map((cred) => (
                <div key={cred.id} className="group rounded-3xl border border-white/5 bg-[var(--bg-card)]/40 backdrop-blur-3xl p-6 shadow-xl hover:shadow-2xl hover:border-primary/20 hover:bg-[var(--bg-card)]/60 transition-all duration-500 relative overflow-hidden">
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">{cred.name || cred.provider_name || cred.provider_code}</h3>
                        {cred.is_default && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">默认</span>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-[var(--text-muted)] space-y-1">
                        <div>Provider: {cred.provider_code}</div>
                        <div>Key: {cred.api_key_hint || '***'}</div>
                        <div>Base URL: {cred.base_url_override || '-'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => testCredentialMutation.mutate(cred.id)}
                        className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        <TestTube className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('确定删除该凭证吗？')) {
                            deleteCredentialMutation.mutate(cred.id);
                          }
                        }}
                        className="p-2 text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'routing' && (
          <div className="space-y-4">
            {tasks.length === 0 ? (
              <div className="text-center py-12 text-[var(--text-muted)]">暂无任务类型</div>
            ) : (
              tasks.map((task) => {
                const current = routingState[task.code] || { primary: '', fallback: '' };
                return (
                  <div key={task.code} className="group rounded-3xl border border-white/5 bg-[var(--bg-card)]/40 backdrop-blur-3xl p-6 shadow-xl hover:shadow-2xl hover:border-primary/20 hover:bg-[var(--bg-card)]/60 transition-all duration-500">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold text-[var(--text-primary)]">{task.name}</h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-muted)]">{task.code}</span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-1">{task.description || '无描述'}</p>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <label className="text-xs text-[var(--text-muted)]">
                            主模型
                            <select
                              value={current.primary}
                              onChange={(e) =>
                                setRoutingState((prev) => ({
                                  ...prev,
                                  [task.code]: { ...prev[task.code], primary: e.target.value },
                                }))
                              }
                              className="mt-1 w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
                            >
                              <option value="">未配置</option>
                              {Object.entries(groupedModels).map(([providerCode, list]) => (
                                <optgroup key={providerCode} label={providerCode}>
                                  {list.map((model) => (
                                    <option key={model.id} value={model.id}>
                                      {model.display_name || model.model_id}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs text-[var(--text-muted)]">
                            备用模型
                            <select
                              value={current.fallback}
                              onChange={(e) =>
                                setRoutingState((prev) => ({
                                  ...prev,
                                  [task.code]: { ...prev[task.code], fallback: e.target.value },
                                }))
                              }
                              className="mt-1 w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-[var(--text-primary)] focus:outline-none focus:border-primary/40 focus:bg-[var(--bg-card)]/80 transition-all duration-300 shadow-inner"
                            >
                              <option value="">无</option>
                              {Object.entries(groupedModels).map(([providerCode, list]) => (
                                <optgroup key={providerCode} label={providerCode}>
                                  {list.map((model) => (
                                    <option key={model.id} value={model.id}>
                                      {model.display_name || model.model_id}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                      <Button
                        className="h-10 gap-2"
                        onClick={() => {
                          const primary = current.primary ? Number(current.primary) : null;
                          const fallback = current.fallback ? Number(current.fallback) : null;
                          if (!primary) {
                            toast.error('请选择主模型');
                            return;
                          }
                          updateRoutingMutation.mutate({
                            taskType: task.code,
                            payload: {
                              primary_model_id: primary,
                              fallback_model_id: fallback,
                            },
                          });
                        }}
                      >
                        <Save className="w-4 h-4" />
                        保存
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showProviderDialog && (
          <ProviderDialog
            mode={editingProvider ? 'edit' : 'create'}
            initial={editingProvider}
            onClose={() => {
              setShowProviderDialog(false);
              setEditingProvider(null);
            }}
            onSubmit={(payload) =>
              providerMutation.mutate({
                mode: editingProvider ? 'edit' : 'create',
                id: editingProvider?.id,
                payload,
              })
            }
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showModelDialog && (
          <ModelDialog
            mode={editingModel ? 'edit' : 'create'}
            providers={providers}
            initial={editingModel}
            onClose={() => {
              setShowModelDialog(false);
              setEditingModel(null);
            }}
            onSubmit={(providerCode, payload) =>
              modelMutation.mutate({
                mode: editingModel ? 'edit' : 'create',
                providerCode,
                id: editingModel?.id,
                payload,
              })
            }
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCredentialDialog && (
          <CredentialDialog
            providers={providers}
            defaultProviderCode={preSelectedProvider}
            onClose={() => {
              setShowCredentialDialog(false);
              setPreSelectedProvider(undefined);
            }}
            onSubmit={(payload) => credentialMutation.mutate(payload)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
