// 全局模型价格的 React Query hooks
// ref: §5.1 - AI Service / 全局价格管理

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  aiProviderService,
  type GlobalPricingApplyRequest,
  type GlobalPricingUpsertRequest,
  type PricingCatalogSyncRequest,
} from '@/services/aiProviderService';
import { resolveAiServiceErrorMessage } from '@/pages/ai-config/utils/errorMessage';

export const globalPricingKeys = {
  all: ['ai-global-pricing'] as const,
  list: () => [...globalPricingKeys.all, 'list'] as const,
  coverage: () => [...globalPricingKeys.all, 'coverage'] as const,
};

export function useGlobalPricingList() {
  return useQuery({
    queryKey: globalPricingKeys.list(),
    queryFn: () => aiProviderService.listGlobalPricing(),
    select: (res) => res.data || [],
  });
}

export function useGlobalPricingCoverage() {
  return useQuery({
    queryKey: globalPricingKeys.coverage(),
    queryFn: () => aiProviderService.globalPricingCoverage(),
    select: (res) => res.data || [],
  });
}


export function useEnabledModelIds() {
  return useQuery({
    queryKey: [...globalPricingKeys.all, 'enabled-model-ids'],
    queryFn: () => aiProviderService.listModels(undefined, undefined, true),
    select: (res) => {
      const ids = new Set<string>();
      (res.data || []).forEach((model) => {
        if (model.is_enabled) ids.add(model.model_id);
      });
      return ids;
    },
  });
}

export function useUpsertGlobalPricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      modelId,
      data,
    }: {
      modelId: string;
      data: GlobalPricingUpsertRequest;
    }) => aiProviderService.upsertGlobalPricing(modelId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: globalPricingKeys.all });
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      toast.success('全局价格已保存');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '保存失败'));
    },
  });
}

export function useDeleteGlobalPricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => aiProviderService.deleteGlobalPricing(modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: globalPricingKeys.all });
      toast.success('已移除全局价格');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '删除失败'));
    },
  });
}

export function useApplyGlobalPricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      modelId,
      data,
    }: {
      modelId: string;
      data?: GlobalPricingApplyRequest;
    }) => aiProviderService.applyGlobalPricing(modelId, data ?? {}),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: globalPricingKeys.all });
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      const { updated, skipped, target_count } = res.data || {
        updated: 0,
        skipped: 0,
        target_count: 0,
      };
      toast.success(
        `已批量回填 ${updated} / ${target_count} 个模型` +
          (skipped > 0 ? `（跳过 ${skipped}）` : '')
      );
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '批量回填失败'));
    },
  });
}

export function usePreviewPricingCatalogSync() {
  return useMutation({
    mutationFn: (data: PricingCatalogSyncRequest) =>
      aiProviderService.previewPricingCatalogSync(data),
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '加载价格目录失败'));
    },
  });
}

export function useApplyPricingCatalogSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PricingCatalogSyncRequest) =>
      aiProviderService.applyPricingCatalogSync(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: globalPricingKeys.all });
      const { created, updated, skipped, matched } = res.data || {
        created: 0,
        updated: 0,
        skipped: 0,
        matched: 0,
      };
      toast.success(
        `已同步价格：新增 ${created} · 更新 ${updated}` +
          (skipped > 0 ? ` · 跳过 ${skipped}` : '') +
          `（命中 ${matched}）`
      );
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '同步价格失败'));
    },
  });
}

export function useSyncModelToGlobal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelDbId: number) =>
      aiProviderService.syncModelToGlobalPricing(modelDbId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: globalPricingKeys.all });
      toast.success('已写入全局价格');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '写入全局价格失败'));
    },
  });
}

export function useSyncModelFromGlobal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelDbId: number) =>
      aiProviderService.syncModelFromGlobalPricing(modelDbId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      queryClient.invalidateQueries({ queryKey: globalPricingKeys.all });
      const updated = res.data?.updated ?? 0;
      if (updated > 0) {
        toast.success('已从全局价格回填');
      } else {
        toast.info('没有变化');
      }
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '从全局回填失败'));
    },
  });
}
