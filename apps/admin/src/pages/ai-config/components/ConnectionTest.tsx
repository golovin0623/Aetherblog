// 连通性测试组件
// ref: §5.1 - AI Service 架构

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Zap } from 'lucide-react';
import type { AiModel } from '@/services/aiProviderService';
import { useTestCredential } from '../hooks/useCredentials';
import type { ConnectionTestResult } from '../types';

interface ConnectionTestProps {
  credentialId: number | null;
  models: AiModel[];
  defaultModelId?: string;
}

export default function ConnectionTest({
  credentialId,
  models,
  defaultModelId,
}: ConnectionTestProps) {
  const [selectedModelId, setSelectedModelId] = useState(
    defaultModelId || models.find((m) => m.model_type === 'chat')?.model_id || ''
  );
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  const testMutation = useTestCredential();
  const chatModels = models.filter((m) => m.model_type === 'chat' && m.is_enabled);

  useEffect(() => {
    if (defaultModelId) {
      setSelectedModelId(defaultModelId);
      return;
    }
    if (selectedModelId && chatModels.some((m) => m.model_id === selectedModelId)) {
      return;
    }
    setSelectedModelId(chatModels[0]?.model_id || '');
  }, [defaultModelId, chatModels, selectedModelId]);

  const handleTest = () => {
    if (!credentialId) return;
    setResult(null);
    testMutation.mutate(
      { credentialId, modelId: selectedModelId },
      {
        onSuccess: (res) => setResult(res),
      }
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm text-[var(--text-muted)]">连通性检查</label>
      </div>

      <div className="flex items-center gap-3">
        {/* 模型选择 */}
        <select
          value={selectedModelId}
          onChange={(e) => setSelectedModelId(e.target.value)}
          className="flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40 transition-all"
        >
          <option value="">选择测试模型</option>
          {chatModels.length > 0 ? (
            chatModels.map((model) => (
              <option key={model.id} value={model.model_id}>
                {model.display_name || model.model_id}
              </option>
            ))
          ) : (
            <option value="gpt-5-mini">gpt-5-mini (默认)</option>
          )}
        </select>

        {/* 测试按钮 */}
        <button
          onClick={handleTest}
          disabled={!credentialId || testMutation.isPending}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
            credentialId
              ? 'bg-primary/10 text-primary hover:bg-primary/20'
              : 'bg-[var(--bg-card)] text-[var(--text-muted)] cursor-not-allowed'
          }`}
        >
          {testMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          检查
        </button>
      </div>

      {/* 测试结果 */}
      {result && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${
            result.success
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          <span className="flex-1">{result.message}</span>
          {result.success && result.latency_ms && (
            <span className="text-xs opacity-75">
              {result.latency_ms.toFixed(0)}ms
            </span>
          )}
        </div>
      )}

      {/* 提示信息 */}
      {!credentialId && (
        <p className="text-xs text-[var(--text-muted)] italic">
          请先保存 API Key 后再进行连通性测试
        </p>
      )}
    </div>
  );
}
