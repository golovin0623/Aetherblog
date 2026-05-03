import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  searchProfileService,
  type CreateProfileRequest,
  type SearchProfile,
} from '@/services/searchProfileService';

const KEY = ['search-profiles'] as const;

/**
 * Search profile 管理用 React Query hooks。
 *
 * 配套的 service 在 ``services/searchProfileService.ts``；UI 入口在
 * ``pages/search-config/ProfileManagementSection.tsx``。激活流程后续 invalidate
 * search-diagnostics / search-stats 以让上层卡片立即反映 active profile 翻转。
 */

export function useSearchProfiles() {
  return useQuery<SearchProfile[]>({
    queryKey: KEY,
    queryFn: async () => (await searchProfileService.list()).data,
    // 列表本身不会高频变化；reindex / activate 触发后由对应 mutation 主动 invalidate
    staleTime: 30_000,
  });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateProfileRequest) => searchProfileService.create(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useActivateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => searchProfileService.activate(code),
    onSuccess: () => {
      // 激活后这三个 query 都需要刷：profile 列表、诊断条、索引统计
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['search-diagnostics'] });
      qc.invalidateQueries({ queryKey: ['search-stats'] });
    },
  });
}

export function useDeprecateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => searchProfileService.deprecate(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => searchProfileService.delete(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
