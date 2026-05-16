export type SystemRoleCode = 'ADMIN' | 'AUTHOR' | 'USER';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BANNED';

export interface Permission {
  id: number;
  code: string;
  module: string;
  action: string;
  name: string;
  description?: string;
}

export interface Role {
  id: number;
  code: SystemRoleCode | string;
  name: string;
  description?: string;
  isSystem: boolean;
  sortOrder: number;
  permissions: Permission[];
}

export interface ManagedUser {
  id: number;
  username: string;
  email: string;
  nickname?: string;
  avatar?: string;
  bio?: string;
  role: SystemRoleCode | string;
  roles: string[];
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateManagedUserRequest {
  username: string;
  email: string;
  password: string;
  nickname?: string;
  roleCodes?: string[];
  status?: UserStatus;
  mustChangePassword?: boolean;
}

export interface UpdateManagedUserRequest {
  email?: string;
  nickname?: string;
  bio?: string;
  status?: UserStatus;
  roleCodes?: string[];
  mustChangePassword?: boolean;
}

export interface Team {
  id: number;
  name: string;
  slug: string;
  description?: string;
  ownerId?: number;
  visibility: 'PRIVATE' | 'INTERNAL' | 'PUBLIC';
  memberCount: number;
  createdBy?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  teamId: number;
  userId: number;
  username: string;
  nickname?: string;
  email: string;
  memberRole: 'OWNER' | 'MANAGER' | 'MEMBER' | 'VIEWER';
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  addedBy?: number;
  joinedAt: string;
}

export interface CreateTeamRequest {
  name: string;
  slug: string;
  description?: string;
  ownerId?: number;
  visibility?: Team['visibility'];
}

export type SharedResourceType = 'POST' | 'MEDIA_FILE' | 'MEDIA_FOLDER';
export type SharePrincipalType = 'USER' | 'TEAM' | 'ROLE';
export type ContentPermissionLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'MANAGE';

export interface ContentShare {
  id: number;
  resourceType: SharedResourceType;
  resourceId: number;
  principalType: SharePrincipalType;
  principalId: number;
  permissionLevel: ContentPermissionLevel;
  grantedBy?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareableResource {
  resourceType: SharedResourceType;
  id: number;
  title: string;
  subtitle?: string;
  status?: string;
  updatedAt?: string;
}

export interface CreateContentShareRequest {
  resourceType: SharedResourceType;
  resourceId: number;
  principalType: SharePrincipalType;
  principalId: number;
  permissionLevel: ContentPermissionLevel;
  expiresAt?: string;
}

export interface BatchCreateContentSharesRequest {
  resourceType: SharedResourceType;
  resourceIds?: number[];
  resourceSearch?: string;
  selectAllMatching?: boolean;
  principalType: SharePrincipalType;
  principalId: number;
  permissionLevel: ContentPermissionLevel;
  expiresAt?: string;
}

export interface BatchCreateContentSharesResult {
  total: number;
  shares: ContentShare[];
}
