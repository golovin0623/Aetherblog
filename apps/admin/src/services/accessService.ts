import api from './api';
import type { R, PageResult } from '@/types';
import type {
  BatchCreateContentSharesRequest,
  BatchCreateContentSharesResult,
  ContentShare,
  CreateContentShareRequest,
  CreateManagedUserRequest,
  CreateTeamRequest,
  ManagedUser,
  Permission,
  Role,
  ShareableResource,
  Team,
  TeamMember,
  UpdateManagedUserRequest,
} from '@aetherblog/types';

export interface UserQueryParams {
  search?: string;
  role?: string;
  status?: string;
  pageNum?: number;
  pageSize?: number;
}

export interface UpsertTeamMemberRequest {
  userId: number;
  memberRole: TeamMember['memberRole'];
  status?: TeamMember['status'];
}

export interface ContentShareQueryParams {
  resourceType?: string;
  resourceId?: number;
  principalType?: string;
  principalId?: number;
}

export interface ShareableResourceQueryParams {
  resourceType: string;
  search?: string;
  limit?: number;
}

export const accessService = {
  listUsers: (params?: UserQueryParams): Promise<R<PageResult<ManagedUser>>> =>
    api.get<R<PageResult<ManagedUser>>>('/v1/admin/users', { params }),

  createUser: (data: CreateManagedUserRequest): Promise<R<ManagedUser>> =>
    api.post<R<ManagedUser>>('/v1/admin/users', data),

  updateUser: (id: number, data: UpdateManagedUserRequest): Promise<R<ManagedUser>> =>
    api.put<R<ManagedUser>>(`/v1/admin/users/${id}`, data),

  assignRoles: (id: number, roleCodes: string[]): Promise<R<ManagedUser>> =>
    api.put<R<ManagedUser>>(`/v1/admin/users/${id}/roles`, { roleCodes }),

  resetPassword: (id: number, data: { password: string; mustChangePassword: boolean }): Promise<R<void>> =>
    api.post<R<void>>(`/v1/admin/users/${id}/reset-password`, data),

  listRoles: (): Promise<R<Role[]>> =>
    api.get<R<Role[]>>('/v1/admin/roles'),

  updateRolePermissions: (roleId: number, permissionCodes: string[]): Promise<R<Role>> =>
    api.put<R<Role>>(`/v1/admin/roles/${roleId}/permissions`, { permissionCodes }),

  listPermissions: (): Promise<R<Permission[]>> =>
    api.get<R<Permission[]>>('/v1/admin/permissions'),

  listTeams: (): Promise<R<Team[]>> =>
    api.get<R<Team[]>>('/v1/admin/teams'),

  createTeam: (data: CreateTeamRequest): Promise<R<Team>> =>
    api.post<R<Team>>('/v1/admin/teams', data),

  updateTeam: (id: number, data: Partial<CreateTeamRequest>): Promise<R<Team>> =>
    api.put<R<Team>>(`/v1/admin/teams/${id}`, data),

  listTeamMembers: (teamId: number): Promise<R<TeamMember[]>> =>
    api.get<R<TeamMember[]>>(`/v1/admin/teams/${teamId}/members`),

  upsertTeamMember: (teamId: number, data: UpsertTeamMemberRequest): Promise<R<TeamMember>> =>
    api.post<R<TeamMember>>(`/v1/admin/teams/${teamId}/members`, data),

  removeTeamMember: (teamId: number, userId: number): Promise<R<void>> =>
    api.delete<R<void>>(`/v1/admin/teams/${teamId}/members/${userId}`),

  listContentShares: (params?: ContentShareQueryParams): Promise<R<ContentShare[]>> =>
    api.get<R<ContentShare[]>>('/v1/admin/content-shares', { params }),

  listShareableResources: (params: ShareableResourceQueryParams): Promise<R<ShareableResource[]>> =>
    api.get<R<ShareableResource[]>>('/v1/admin/content-shares/resources', { params }),

  createContentShare: (data: CreateContentShareRequest): Promise<R<ContentShare>> =>
    api.post<R<ContentShare>>('/v1/admin/content-shares', data),

  createContentSharesBatch: (data: BatchCreateContentSharesRequest): Promise<R<BatchCreateContentSharesResult>> =>
    api.post<R<BatchCreateContentSharesResult>>('/v1/admin/content-shares/batch', data),

  deleteContentShare: (id: number): Promise<R<void>> =>
    api.delete<R<void>>(`/v1/admin/content-shares/${id}`),
};
