// 模型管理 Hooks
// ref: §5.1 - AI Service 架构

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  aiProviderService,
  type AiModel,
  type CreateModelRequest,
  type UpdateModelRequest,
  type ModelSortItem,
} from '@/services/aiProviderService';
import type { ModelType } from '../types';
import { resolveAiServiceErrorMessage } from '../utils/errorMessage';

// Query Keys
export const modelKeys = {
  all: ['ai-models'] as const,
  list: (providerCode?: string, modelType?: string) =>
    [...modelKeys.all, { providerCode, modelType }] as const,
  byProvider: (providerCode: string) => [...modelKeys.all, 'provider', providerCode] as const,
};

/**
 * 获取模型列表
 */
export function useModels(providerCode?: string, modelType?: string) {
  return useQuery({
    queryKey: modelKeys.list(providerCode, modelType),
    queryFn: () => aiProviderService.listModels(providerCode, modelType),
    select: (res) => res.data || [],
  });
}

/**
 * 获取指定供应商的模型列表
 */
export function useProviderModels(providerCode: string) {
  return useQuery({
    queryKey: modelKeys.byProvider(providerCode),
    queryFn: () => aiProviderService.listModels(providerCode),
    select: (res) => res.data || [],
    enabled: !!providerCode,
  });
}

/**
 * 创建模型
 */
export function useCreateModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ providerCode, data }: { providerCode: string; data: CreateModelRequest }) =>
      aiProviderService.createModel(providerCode, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: modelKeys.all });
      toast.success('模型已创建');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '创建失败'));
    },
  });
}

/**
 * 更新模型
 */
export function useUpdateModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateModelRequest }) =>
      aiProviderService.updateModel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: modelKeys.all });
      toast.success('模型已更新');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '更新失败'));
    },
  });
}

/**
 * 删除模型
 */
export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => aiProviderService.deleteModel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: modelKeys.all });
      toast.success('模型已删除');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '删除失败'));
    },
  });
}

/**
 * 拉取远程模型列表
 */
export function useSyncRemoteModels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      providerCode,
      credentialId,
    }: {
      providerCode: string;
      credentialId?: number | null;
    }) => aiProviderService.syncRemoteModels(providerCode, credentialId),
    onSuccess: (_, { providerCode }) => {
      queryClient.invalidateQueries({ queryKey: modelKeys.byProvider(providerCode) });
      toast.success('模型列表已拉取');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '拉取失败'));
    },
  });
}

/**
 * 清空模型列表
 */
export function useClearProviderModels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      providerCode,
      source,
    }: {
      providerCode: string;
      source?: string;
    }) => aiProviderService.clearProviderModels(providerCode, source),
    onSuccess: (_, { providerCode }) => {
      queryClient.invalidateQueries({ queryKey: modelKeys.byProvider(providerCode) });
      toast.success('模型列表已清空');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '清空失败'));
    },
  });
}

/**
 * 批量切换模型状态
 */
export function useBatchToggleModels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      providerCode,
      ids,
      enabled,
    }: {
      providerCode: string;
      ids: number[];
      enabled: boolean;
    }) => aiProviderService.batchToggleModels(providerCode, ids, enabled),
    onSuccess: (_, { providerCode, enabled }) => {
      queryClient.invalidateQueries({ queryKey: modelKeys.byProvider(providerCode) });
      toast.success(enabled ? '模型已全部启用' : '模型已全部禁用');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '操作失败'));
    },
  });
}

/**
 * 更新模型排序
 */
export function useUpdateModelSort() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      providerCode,
      items,
    }: {
      providerCode: string;
      items: ModelSortItem[];
    }) => aiProviderService.updateModelSort(providerCode, items),
    onSuccess: (_, { providerCode }) => {
      queryClient.invalidateQueries({ queryKey: modelKeys.byProvider(providerCode) });
      toast.success('排序已更新');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '排序更新失败'));
    },
  });
}

/**
 * 切换模型启用状态
 */
export function useToggleModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      aiProviderService.updateModel(id, { is_enabled: enabled }),
    onSuccess: (_, { enabled }) => {
      queryClient.invalidateQueries({ queryKey: modelKeys.all });
      toast.success(enabled ? '模型已启用' : '模型已禁用');
    },
    onError: (error: Error) => {
      toast.error(error.message || '操作失败');
    },
  });
}

/**
 * 筛选模型的 Hook
 */
export function useFilteredModels(
  models: AiModel[],
  options: {
    modelType?: ModelType | 'all';
    enabledOnly?: boolean;
    search?: string;
  }
) {
  return useMemo(() => {
    let filtered = [...models];

    // 按类型筛选
    if (options.modelType && options.modelType !== 'all') {
      filtered = filtered.filter((m) => m.model_type === options.modelType);
    }

    // 仅启用
    if (options.enabledOnly) {
      filtered = filtered.filter((m) => m.is_enabled);
    }

    // 搜索
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.model_id.toLowerCase().includes(searchLower) ||
          (m.display_name && m.display_name.toLowerCase().includes(searchLower))
      );
    }

    // 分组：启用/未启用
    const enabled = filtered.filter((m) => m.is_enabled);
    const disabled = filtered.filter((m) => !m.is_enabled);

    return { enabled, disabled, all: filtered };
  }, [models, options.modelType, options.enabledOnly, options.search]);
}

/**
 * 按供应商分组模型
 */
export function groupModelsByProvider(models: AiModel[]) {
  const groups: Record<string, AiModel[]> = {};

  models.forEach((model) => {
    const key = model.provider_code || 'unknown';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(model);
  });

  return groups;
}

/**
 * 统计模型类型数量
 */
export function countModelsByType(models: AiModel[]) {
  const counts: Record<string, number> = { all: models.length };

  models.forEach((model) => {
    const type = model.model_type || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
  });

  return counts;
}
