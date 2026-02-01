/**
 * 媒体类型
 */

export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'OTHER';

/**
 * 文件夹可见性
 * @ref 媒体库深度优化方案 - Phase 1
 */
export type FolderVisibility = 'PRIVATE' | 'TEAM' | 'PUBLIC';

/**
 * 媒体文件夹
 * @ref 媒体库深度优化方案 - Phase 1
 */
export interface MediaFolder {
  id: number;
  name: string;
  slug: string;
  description?: string;
  parentId?: number;
  path: string;
  depth: number;
  sortOrder: number;
  color: string;
  icon: string;
  coverImage?: string;
  ownerId?: number;
  visibility: FolderVisibility;
  fileCount: number;
  totalSize: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 文件夹树节点 (包含子节点)
 * @ref 媒体库深度优化方案 - Phase 1
 */
export interface FolderTreeNode extends MediaFolder {
  children: FolderTreeNode[];
}

/**
 * 创建文件夹请求
 * @ref 媒体库深度优化方案 - Phase 1
 */
export interface CreateFolderRequest {
  name: string;
  description?: string;
  parentId?: number;
}

/**
 * 更新文件夹请求
 * @ref 媒体库深度优化方案 - Phase 1
 */
export interface UpdateFolderRequest {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
}

/**
 * 移动文件夹请求
 * @ref 媒体库深度优化方案 - Phase 1
 */
export interface MoveFolderRequest {
  targetParentId?: number;
}

export interface Media {
  id: number;
  name: string;
  originalName: string;
  url: string;
  type: MediaType;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  alt?: string;
  folderId?: number; // @ref 媒体库深度优化方案 - Phase 1
  createdAt: string;
}

export interface UploadResult {
  id: number;
  url: string;
  name: string;
}

/**
 * 标签分类
 * @ref 媒体库深度优化方案 - Phase 2
 */
export type TagCategory = 'CUSTOM' | 'AI_DETECTED' | 'SYSTEM';

/**
 * 标签来源
 * @ref 媒体库深度优化方案 - Phase 2
 */
export type TagSource = 'MANUAL' | 'AI_AUTO' | 'AI_SUGGESTED';

/**
 * 媒体标签
 * @ref 媒体库深度优化方案 - Phase 2
 */
export interface MediaTag {
  id: number;
  name: string;
  slug: string;
  description?: string;
  color: string;
  category: TagCategory;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 创建媒体标签请求
 * @ref 媒体库深度优化方案 - Phase 2
 */
export interface CreateMediaTagRequest {
  name: string;
  description?: string;
  color?: string;
  category?: TagCategory;
}

/**
 * 文件-标签关联
 * @ref 媒体库深度优化方案 - Phase 2
 */
export interface MediaFileTag {
  fileId: number;
  tagId: number;
  source: TagSource;
  taggedAt: string;
  taggedBy?: number;
}

/**
 * 存储提供商类型
 * @ref 媒体库深度优化方案 - Phase 3
 */
export type StorageProviderType = 'LOCAL' | 'S3' | 'MINIO' | 'OSS' | 'COS';

/**
 * 存储提供商
 * @ref 媒体库深度优化方案 - Phase 3
 */
export interface StorageProvider {
  id: number;
  name: string;
  providerType: StorageProviderType;
  configJson: string;
  isDefault: boolean;
  isEnabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 图像变体类型
 * @ref 媒体库深度优化方案 - Phase 4
 */
export type VariantType = 'THUMBNAIL' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'WEBP' | 'AVIF' | 'ORIGINAL';

/**
 * 媒体变体
 * @ref 媒体库深度优化方案 - Phase 4
 */
export interface MediaVariant {
  id: number;
  mediaFileId: number;
  variantType: VariantType;
  filePath: string;
  fileUrl: string;
  fileSize: number;
  width?: number;
  height?: number;
  format?: string;
  quality?: number;
  createdAt: string;
}

/**
 * 权限级别
 * @ref 媒体库深度优化方案 - Phase 5
 */
export type PermissionLevel = 'VIEW' | 'UPLOAD' | 'EDIT' | 'DELETE' | 'ADMIN';

/**
 * 文件夹权限
 * @ref 媒体库深度优化方案 - Phase 5
 */
export interface FolderPermission {
  id: number;
  folderId: number;
  userId: number;
  permissionLevel: PermissionLevel;
  grantedBy?: number;
  grantedAt: string;
  expiresAt?: string;
}

/**
 * 分享类型
 * @ref 媒体库深度优化方案 - Phase 5
 */
export type ShareType = 'FILE' | 'FOLDER';

/**
 * 访问类型
 * @ref 媒体库深度优化方案 - Phase 5
 */
export type AccessType = 'VIEW' | 'DOWNLOAD';

/**
 * 媒体分享
 * @ref 媒体库深度优化方案 - Phase 5
 */
export interface MediaShare {
  id: number;
  shareToken: string;
  mediaFileId?: number;
  folderId?: number;
  shareType: ShareType;
  accessType: AccessType;
  createdBy?: number;
  createdAt: string;
  expiresAt?: string;
  accessCount: number;
  maxAccessCount?: number;
  passwordHash?: string;
}

/**
 * 媒体版本
 * @ref 媒体库深度优化方案 - Phase 5
 */
export interface MediaVersion {
  id: number;
  mediaFileId: number;
  versionNumber: number;
  filePath: string;
  fileUrl: string;
  fileSize: number;
  changeDescription?: string;
  createdBy?: number;
  createdAt: string;
}
