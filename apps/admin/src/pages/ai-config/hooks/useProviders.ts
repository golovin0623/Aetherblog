// 供应商管理 Hooks
// ref: §5.1 - AI Service 架构

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  aiProviderService,
  type AiProvider,
  type CreateProviderRequest,
  type UpdateProviderRequest,
} from '@/services/aiProviderService';
import { resolveAiServiceErrorMessage } from '../utils/errorMessage';

// Query Keys
export const providerKeys = {
  all: ['ai-providers'] as const,
  list: (enabledOnly?: boolean) => [...providerKeys.all, { enabledOnly }] as const,
  detail: (id: number) => [...providerKeys.all, 'detail', id] as const,
};

/**
 * 获取供应商列表
 */
export function useProviders(enabledOnly = false) {
  return useQuery({
    queryKey: providerKeys.list(enabledOnly),
    queryFn: () => aiProviderService.listProviders(enabledOnly),
    select: (res) => res.data || [],
  });
}

/**
 * 创建供应商
 */
export function useCreateProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProviderRequest) => aiProviderService.createProvider(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.all });
      toast.success('供应商已创建');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '创建失败'));
    },
  });
}

/**
 * 更新供应商
 */
export function useUpdateProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateProviderRequest }) =>
      aiProviderService.updateProvider(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.all });
      toast.success('供应商已更新');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '更新失败'));
    },
  });
}

/**
 * 删除供应商
 */
export function useDeleteProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => aiProviderService.deleteProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.all });
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      toast.success('供应商已删除');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '删除失败'));
    },
  });
}

/**
 * 切换供应商启用状态
 */
export function useToggleProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      aiProviderService.updateProvider(id, { is_enabled: enabled }),
    onSuccess: (_, { enabled }) => {
      queryClient.invalidateQueries({ queryKey: providerKeys.all });
      toast.success(enabled ? '供应商已启用' : '供应商已禁用');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '操作失败'));
    },
  });
}

/**
 * 批量更新供应商优先级 (排序)
 */
export function useUpdateProviderPriorities() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (items: Array<{ id: number; priority: number }>) => {
      // 并行更新所有供应商的优先级
      await Promise.all(
        items.map((item) =>
          aiProviderService.updateProvider(item.id, { priority: item.priority })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.all });
      toast.success('排序已更新');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '排序更新失败'));
    },
  });
}

/**
 * 批量切换供应商状态
 */
export function useBatchToggleProviders() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, enabled }: { ids: number[]; enabled: boolean }) =>
      aiProviderService.batchToggleProviders(ids, enabled),
    onSuccess: (_, { enabled }) => {
      queryClient.invalidateQueries({ queryKey: providerKeys.all });
      toast.success(enabled ? '所选供应商已启用' : '所选供应商已禁用');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '批量操作失败'));
    },
  });
}

/**
 * 按启用状态分组供应商
 */
export function groupProvidersByStatus(providers: AiProvider[]) {
  const enabled: AiProvider[] = [];
  const disabled: AiProvider[] = [];

  providers.forEach((p) => {
    if (p.is_enabled) {
      enabled.push(p);
    } else {
      disabled.push(p);
    }
  });

  // 按优先级排序
  enabled.sort((a, b) => a.priority - b.priority);
  disabled.sort((a, b) => a.priority - b.priority);

  return { enabled, disabled };
}
