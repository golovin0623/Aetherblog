import api from './api';
import type { R } from '@/types';

export interface AiProvider {
  id: number;
  code: string;
  name: string;
  display_name?: string | null;
  api_type: string;
  base_url?: string | null;
  doc_url?: string | null;
  icon?: string | null;
  is_enabled: boolean;
  priority: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  capabilities: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config_schema?: Record<string, any> | null;
}

export interface AiModel {
  id: number;
  provider_id: number;
  provider_code: string;
  model_id: string;
  display_name?: string | null;
  model_type: string;
  context_window?: number | null;
  max_output_tokens?: number | null;
  input_cost_per_1k?: number | null;
  output_cost_per_1k?: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  capabilities: Record<string, any>;
  is_enabled: boolean;
}

export interface AiCredential {
  id: number;
  name?: string | null;
  api_key_hint?: string | null;
  provider_code: string;
  provider_name?: string | null;
  base_url_override?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra_config?: Record<string, any> | null;
  is_default: boolean;
  is_enabled: boolean;
  last_used_at?: string | null;
  last_error?: string | null;
  created_at: string;
}

export interface AiTaskType {
  code: string;
  name: string;
  description?: string | null;
  model_type?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
}

export interface AiRouting {
  task_type: string;
  primary_model: AiModel | null;
  fallback_model: AiModel | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
}

export interface CreateProviderRequest {
  code: string;
  name: string;
  display_name?: string | null;
  api_type?: string;
  base_url?: string | null;
  doc_url?: string | null;
  icon?: string | null;
  is_enabled?: boolean;
  priority?: number;
  capabilities?: Record<string, any>;
  config_schema?: Record<string, any> | null;
}

export interface UpdateProviderRequest {
  name?: string | null;
  display_name?: string | null;
  api_type?: string | null;
  base_url?: string | null;
  doc_url?: string | null;
  icon?: string | null;
  is_enabled?: boolean;
  priority?: number;
  capabilities?: Record<string, any> | null;
  config_schema?: Record<string, any> | null;
}

export interface CreateModelRequest {
  model_id: string;
  display_name?: string | null;
  model_type?: string;
  context_window?: number | null;
  max_output_tokens?: number | null;
  input_cost_per_1k?: number | null;
  output_cost_per_1k?: number | null;
  capabilities?: Record<string, any>;
  is_enabled?: boolean;
}

export interface UpdateModelRequest {
  display_name?: string | null;
  model_type?: string | null;
  context_window?: number | null;
  max_output_tokens?: number | null;
  input_cost_per_1k?: number | null;
  output_cost_per_1k?: number | null;
  capabilities?: Record<string, any> | null;
  is_enabled?: boolean;
}

export interface CreateCredentialRequest {
  provider_code: string;
  api_key: string;
  name?: string | null;
  base_url_override?: string | null;
  is_default?: boolean;
  extra_config?: Record<string, any> | null;
}

export interface RoutingUpdateRequest {
  primary_model_id?: number | null;
  fallback_model_id?: number | null;
  credential_id?: number | null;
  config_override?: Record<string, any> | null;
}

export interface ModelSortItem {
  id: number;
  sort: number;
}

export const aiProviderService = {
  listProviders: (enabledOnly = false): Promise<R<AiProvider[]>> =>
    api.get('/v1/admin/providers', { params: { enabled_only: enabledOnly } }),

  createProvider: (data: CreateProviderRequest): Promise<R<AiProvider>> =>
    api.post('/v1/admin/providers', data),

  updateProvider: (id: number, data: UpdateProviderRequest): Promise<R<AiProvider>> =>
    api.put(`/v1/admin/providers/${id}`, data),

  deleteProvider: (id: number): Promise<R<boolean>> =>
    api.delete(`/v1/admin/providers/${id}`),

  listModels: (providerCode?: string, modelType?: string): Promise<R<AiModel[]>> => {
    if (providerCode) {
      return api.get(`/v1/admin/providers/${providerCode}/models`, { params: { enabled_only: false } });
    }
    return api.get('/v1/admin/providers/models', { params: { model_type: modelType, enabled_only: false } });
  },

  createModel: (providerCode: string, data: CreateModelRequest): Promise<R<AiModel>> =>
    api.post(`/v1/admin/providers/${providerCode}/models`, data),

  updateModel: (id: number, data: UpdateModelRequest): Promise<R<AiModel>> =>
    api.put(`/v1/admin/providers/models/${id}`, data),

  deleteModel: (id: number): Promise<R<boolean>> =>
    api.delete(`/v1/admin/providers/models/${id}`),

  listCredentials: (): Promise<R<AiCredential[]>> =>
    api.get('/v1/admin/providers/credentials'),

  createCredential: (data: CreateCredentialRequest): Promise<R<{ id: number }>> =>
    api.post('/v1/admin/providers/credentials', data),

  deleteCredential: (id: number): Promise<R<boolean>> =>
    api.delete(`/v1/admin/providers/credentials/${id}`),

  testCredential: (id: number, modelId?: string): Promise<R<{ success: boolean; message: string; latency_ms?: number }>> =>
    api.post(`/v1/admin/providers/credentials/${id}/test`, { model_id: modelId || 'claude-haiku-4-5-20251001' }),

  listTasks: (): Promise<R<AiTaskType[]>> =>
    api.get('/v1/admin/providers/tasks'),

  getRouting: (taskType: string): Promise<R<AiRouting | null>> =>
    api.get(`/v1/admin/providers/routing/${taskType}`),

  updateRouting: (taskType: string, data: RoutingUpdateRequest): Promise<R<boolean>> =>
    api.put(`/v1/admin/providers/routing/${taskType}`, data),

  syncRemoteModels: (
    providerCode: string,
    credentialId?: number | null
  ): Promise<R<{ inserted: number; total: number }>> =>
    api.post(`/v1/admin/providers/${providerCode}/models/remote`, {
      credential_id: credentialId ?? null,
    }),

  clearProviderModels: (
    providerCode: string,
    source?: string
  ): Promise<R<{ deleted: number }>> =>
    api.delete(`/v1/admin/providers/${providerCode}/models`, {
      params: { source },
    }),

  batchToggleModels: (
    providerCode: string,
    ids: number[],
    enabled: boolean
  ): Promise<R<{ updated: number }>> =>
    api.put(`/v1/admin/providers/${providerCode}/models/batch-toggle`, {
      ids,
      enabled,
    }),

  updateModelSort: (
    providerCode: string,
    items: ModelSortItem[]
  ): Promise<R<{ updated: number }>> =>
    api.put(`/v1/admin/providers/${providerCode}/models/sort`, { items }),
};
