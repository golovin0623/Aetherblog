// 凭证管理 Hooks
// ref: §5.1 - AI Service 架构

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  aiProviderService,
  type AiCredential,
  type CreateCredentialRequest,
} from '@/services/aiProviderService';
import type { ConnectionTestResult } from '../types';
import { resolveAiServiceErrorMessage } from '../utils/errorMessage';

// Query Keys
export const credentialKeys = {
  all: ['ai-credentials'] as const,
  list: () => [...credentialKeys.all, 'list'] as const,
  byProvider: (providerCode: string) =>
    [...credentialKeys.all, 'provider', providerCode] as const,
};

/**
 * 获取凭证列表
 */
export function useCredentials() {
  return useQuery({
    queryKey: credentialKeys.list(),
    queryFn: () => aiProviderService.listCredentials(),
    select: (res) => res.data || [],
  });
}

/**
 * 获取指定供应商的凭证
 */
export function useProviderCredentials(providerCode: string) {
  const { data: allCredentials = [], ...rest } = useCredentials();

  const credentials = useMemo(
    () => allCredentials.filter((c) => c.provider_code === providerCode),
    [allCredentials, providerCode]
  );

  return { data: credentials, ...rest };
}

/**
 * 获取供应商的默认凭证
 */
export function useDefaultCredential(providerCode: string) {
  const { data: credentials = [] } = useProviderCredentials(providerCode);

  return useMemo(
    () => credentials.find((c) => c.is_default) || credentials[0],
    [credentials]
  );
}

/**
 * 创建凭证
 */
export function useCreateCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCredentialRequest) => aiProviderService.createCredential(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: credentialKeys.all });
      toast.success('凭证已保存');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '保存失败'));
    },
  });
}

/**
 * 删除凭证
 */
export function useDeleteCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => aiProviderService.deleteCredential(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: credentialKeys.all });
      toast.success('凭证已删除');
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '删除失败'));
    },
  });
}

/**
 * 获取解密后的 API Key
 */
export function useRevealCredential() {
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await aiProviderService.revealCredential(id);
      return res.data;
    },
    onError: (error: unknown) => {
      toast.error(resolveAiServiceErrorMessage(error, '获取密钥失败'));
    },
  });
}

/**
 * 测试凭证连通性
 */
export function useTestCredential() {
  return useMutation({
    mutationFn: async ({
      credentialId,
      modelId,
    }: {
      credentialId: number;
      modelId?: string;
    }): Promise<ConnectionTestResult> => {
      const res = await aiProviderService.testCredential(credentialId, modelId);
      return res.data;
    },
    onSuccess: (result) => {
      if (result.success) {
        const latency = result.latency_ms ? ` (${result.latency_ms.toFixed(0)}ms)` : '';
        toast.success(`连接成功${latency}`);
      } else {
        toast.error(result.message || '连接失败');
      }
    },
    onError: (error: Error) => {
      toast.error(resolveAiServiceErrorMessage(error, '测试失败'));
    },
  });
}

/**
 * 按供应商分组凭证
 */
export function groupCredentialsByProvider(credentials: AiCredential[]) {
  const groups: Record<string, AiCredential[]> = {};

  credentials.forEach((cred) => {
    const key = cred.provider_code;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(cred);
  });

  return groups;
}

/**
 * 检查供应商是否已配置凭证
 */
export function hasCredential(credentials: AiCredential[], providerCode: string) {
  return credentials.some((c) => c.provider_code === providerCode);
}
