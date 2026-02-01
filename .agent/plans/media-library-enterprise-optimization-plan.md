# 媒体库深度优化方案 - 企业级全功能实施计划

> **项目目标**: 将AetherBlog媒体库从基础文件存储升级为企业级团队协作平台
> **实施周期**: 6-8周
> **使用场景**: 团队内容管理
> **功能范围**: 文件夹管理 + 智能标签 + 云存储CDN + 图像处理 + 协作权限

---

## 📋 任务路线图 (Roadmap)

```
Week 1-2: 文件夹层级管理 (Foundation)
    ├─ 数据库迁移 (media_folders表)
    ├─ 后端实体/服务/控制器
    ├─ 前端FolderTree组件
    └─ 拖拽移动功能

Week 3: 智能标签系统 (Smart Tagging)
    ├─ 数据库迁移 (media_tags, media_file_tags)
    ├─ 后端标签服务
    ├─ 前端TagManager组件
    └─ AI自动标签 (可选)

Week 4: 云存储与CDN (Cloud Storage)
    ├─ 数据库迁移 (storage_providers)
    ├─ 存储抽象层 (StorageService)
    ├─ S3/MinIO/OSS适配器
    └─ 前端存储配置页面

Week 5: 图像处理 (Image Processing)
    ├─ 数据库迁移 (media_variants)
    ├─ 图像处理服务 (缩略图/格式转换)
    ├─ 异步任务队列
    └─ 前端图片编辑器

Week 6-7: 协作与权限 (Collaboration)
    ├─ 数据库迁移 (folder_permissions, media_shares, media_versions)
    ├─ 权限服务 (ACL检查)
    ├─ 分享服务 (Token生成)
    ├─ 版本控制服务
    └─ 前端权限/分享/版本UI

Week 8: 优化与打磨 (Polish)
    ├─ 性能优化 (Redis缓存, 查询优化)
    ├─ UX完善 (骨架屏, 虚拟滚动)
    ├─ 测试 (单元测试, 集成测试)
    └─ 文档 (API文档, 用户手册)
```

---

## 🎯 核心功能清单

### ✅ Phase 1: 文件夹层级管理 (Week 1-2)
- [ ] 无限层级文件夹嵌套
- [ ] 拖拽移动文件/文件夹
- [ ] 面包屑导航
- [ ] 文件夹统计 (文件数/总大小)
- [ ] 批量移动操作
- [ ] 文件夹颜色/图标自定义

### ✅ Phase 2: 智能标签系统 (Week 3)
- [ ] 多标签支持 (一文件多标签)
- [ ] 标签自动完成输入
- [ ] 按标签筛选
- [ ] 批量打标签
- [ ] AI自动识别标签 (可选)
- [ ] 标签使用统计

### ✅ Phase 3: 云存储与CDN (Week 4)
- [ ] 多存储后端 (LOCAL/S3/MinIO/OSS/COS)
- [ ] 存储提供商配置管理
- [ ] CDN URL自动生成
- [ ] 存储迁移工具
- [ ] 存储配额管理
- [ ] 连接测试功能

### ✅ Phase 4: 图像处理 (Week 5)
- [ ] 自动生成缩略图 (多尺寸)
- [ ] 格式转换 (WebP/AVIF)
- [ ] 智能压缩
- [ ] 在线编辑 (裁剪/旋转/调整)
- [ ] 响应式图片
- [ ] Blurhash占位符

### ✅ Phase 5: 协作与权限 (Week 6-7)
- [ ] 文件夹权限管理 (VIEW/UPLOAD/EDIT/DELETE/ADMIN)
- [ ] 公开分享链接
- [ ] 分享密码保护
- [ ] 分享过期时间
- [ ] 文件版本控制
- [ ] 版本对比与回滚

### ✅ Phase 6: 优化打磨 (Week 8)
- [ ] Redis缓存文件夹树
- [ ] 数据库查询优化
- [ ] 虚拟滚动 (大列表)
- [ ] 骨架屏加载
- [ ] 键盘快捷键
- [ ] API文档 (Swagger)

---

## 🗂️ 数据库架构

### 新增表 (9个)

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `media_folders` | 文件夹层级 | parent_id, path, depth, file_count |
| `media_tags` | 标签定义 | name, slug, category, usage_count |
| `media_file_tags` | 文件-标签关联 | media_file_id, tag_id, source |
| `media_metadata` | 自定义元数据 | media_file_id, meta_key, meta_value |
| `media_variants` | 图像变体 | media_file_id, variant_type, url |
| `folder_permissions` | 文件夹权限 | folder_id, user_id, permission_level |
| `media_shares` | 分享链接 | share_token, expires_at, password_hash |
| `media_versions` | 版本历史 | media_file_id, version_number, file_path |
| `storage_providers` | 存储提供商 | provider_type, config_json, is_default |

### 扩展表 (1个)

**media_files** 新增字段:
- `folder_id` - 所属文件夹
- `storage_provider_id` - 存储提供商
- `current_version` - 当前版本号
- `cdn_url` - CDN加速URL
- `ai_labels` - AI识别标签 (JSONB)
- `blurhash` - 占位符哈希

---

## 🏗️ 技术架构

### 后端架构 (Spring Boot)

```
aetherblog-service/blog-service/
├── entity/
│   ├── MediaFolder.java          (文件夹实体)
│   ├── MediaTag.java              (标签实体)
│   ├── MediaVariant.java          (图像变体)
│   ├── FolderPermission.java      (权限实体)
│   ├── MediaShare.java            (分享实体)
│   ├── MediaVersion.java          (版本实体)
│   └── StorageProvider.java       (存储提供商)
├── repository/
│   ├── MediaFolderRepository.java
│   ├── MediaTagRepository.java
│   └── ... (其他Repository)
├── service/
│   ├── FolderService.java         (文件夹服务)
│   ├── TagService.java            (标签服务)
│   ├── StorageService.java        (存储抽象层)
│   ├── ImageProcessingService.java (图像处理)
│   ├── PermissionService.java     (权限服务)
│   └── ShareService.java          (分享服务)
└── controller/
    ├── FolderController.java
    ├── TagController.java
    └── ... (其他Controller)
```

### 前端架构 (React + TypeScript)

```
apps/admin/src/
├── pages/
│   ├── MediaPage.tsx              (主页面 - 添加文件夹侧边栏)
│   └── media/
│       ├── components/
│       │   ├── FolderTree.tsx     (文件夹树)
│       │   ├── TagManager.tsx     (标签管理器)
│       │   ├── ImageEditor.tsx    (图片编辑器)
│       │   ├── ShareDialog.tsx    (分享对话框)
│       │   └── VersionHistory.tsx (版本历史)
│       └── FolderPermissionsPage.tsx
├── services/
│   ├── mediaService.ts            (扩展: 文件夹/标签API)
│   ├── folderService.ts           (新增)
│   ├── tagService.ts              (新增)
│   └── storageService.ts          (新增)
└── stores/
    └── mediaStore.ts              (Zustand状态管理)

packages/types/src/models/
└── media.ts                       (新增类型定义)
```

---

## 📦 关键依赖

### 后端依赖
```xml
<!-- 图像处理 -->
<dependency>
    <groupId>net.coobird</groupId>
    <artifactId>thumbnailator</artifactId>
    <version>0.4.19</version>
</dependency>

<!-- AWS S3 SDK -->
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>s3</artifactId>
</dependency>

<!-- MinIO SDK -->
<dependency>
    <groupId>io.minio</groupId>
    <artifactId>minio</artifactId>
</dependency>

<!-- Aliyun OSS SDK -->
<dependency>
    <groupId>com.aliyun.oss</groupId>
    <artifactId>aliyun-sdk-oss</artifactId>
</dependency>
```

### 前端依赖
```json
{
  "@dnd-kit/core": "^6.0.0",           // 拖拽功能
  "@dnd-kit/sortable": "^7.0.0",
  "react-image-crop": "^10.0.0",       // 图片裁剪
  "zustand": "^4.0.0"                  // 状态管理
}
```

---

## 🔑 关键文件清单

### 必须创建的文件 (优先级排序)

#### Phase 1: 文件夹管理
1. `apps/server/aetherblog-app/src/main/resources/db/migration/V2_1__add_media_folders.sql`
2. `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/entity/MediaFolder.java`
3. `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/repository/MediaFolderRepository.java`
4. `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/service/FolderService.java`
5. `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/service/impl/FolderServiceImpl.java`
6. `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/controller/FolderController.java`
7. `apps/admin/src/pages/media/components/FolderTree.tsx`
8. `apps/admin/src/services/folderService.ts`
9. `packages/types/src/models/media.ts` (扩展)

#### Phase 2: 智能标签
10. `apps/server/aetherblog-app/src/main/resources/db/migration/V2_2__add_media_tags.sql`
11. `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/entity/MediaTag.java`
12. `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/service/TagService.java`
13. `apps/admin/src/pages/media/components/TagManager.tsx`

#### Phase 3-6: 其他功能
(依次类推...)

### 必须修改的文件

1. `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/entity/MediaFile.java`
   - 添加: `folder_id`, `storage_provider_id`, `cdn_url`, `ai_labels`, `blurhash`

2. `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/service/impl/MediaServiceImpl.java`
   - 修改 `upload()` 方法支持文件夹参数
   - 集成 StorageService
   - 触发异步图像处理

3. `apps/admin/src/pages/MediaPage.tsx`
   - 添加左侧文件夹树
   - 添加面包屑导航
   - 添加文件夹筛选

4. `apps/admin/src/services/mediaService.ts`
   - 添加 `folderId` 参数到上传方法

---

## 当前状态分析

### 现有功能
- ✅ 基础上传/删除/批量操作
- ✅ 按类型筛选 (IMAGE/VIDEO/AUDIO/DOCUMENT)
- ✅ 关键词搜索
- ✅ 网格/列表视图切换
- ✅ 拖拽上传
- ✅ 进度跟踪

### 核心问题
**缺乏企业级文件管理能力** - 所有文件平铺在一个列表中，缺少文件夹组织、智能标签、云存储、图像处理、协作权限等企业必备功能。

### 已确定方案
**企业级全功能方案** - 包含所有5个核心方向，6-8周完整实施，适用于团队内容管理场景。

---

## 📐 详细数据库Schema设计

### V2_1__add_media_folders.sql (Phase 1)

```sql
-- 创建文件夹表
CREATE TABLE media_folders (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    parent_id BIGINT REFERENCES media_folders(id) ON DELETE CASCADE,
    path VARCHAR(1000) NOT NULL,  -- 物化路径: /root/design/icons
    depth INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,

    -- 元数据
    color VARCHAR(20) DEFAULT '#6366f1',
    icon VARCHAR(50) DEFAULT 'Folder',
    cover_image VARCHAR(500),

    -- 权限
    owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',

    -- 统计 (缓存)
    file_count INT NOT NULL DEFAULT 0,
    total_size BIGINT NOT NULL DEFAULT 0,

    -- 时间戳
    created_by BIGINT REFERENCES users(id),
    updated_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_folder_visibility CHECK (visibility IN ('PRIVATE', 'TEAM', 'PUBLIC')),
    CONSTRAINT uq_folder_path UNIQUE (path)
);

CREATE INDEX idx_media_folders_parent ON media_folders(parent_id);
CREATE INDEX idx_media_folders_path ON media_folders(path);
CREATE INDEX idx_media_folders_owner ON media_folders(owner_id);
CREATE INDEX idx_media_folders_visibility ON media_folders(visibility);

-- 扩展 media_files 表
ALTER TABLE media_files
    ADD COLUMN folder_id BIGINT REFERENCES media_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_media_files_folder ON media_files(folder_id);

-- 创建默认根文件夹
INSERT INTO media_folders (id, name, slug, path, depth, sort_order, visibility)
VALUES (1, 'Root', 'root', '/root', 0, 0, 'PRIVATE');
```

### V2_2__add_media_tags.sql (Phase 2)

```sql
-- 创建标签表
CREATE TABLE media_tags (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    slug VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    color VARCHAR(20) DEFAULT '#6366f1',
    category VARCHAR(20) DEFAULT 'CUSTOM',
    usage_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_tag_category CHECK (category IN ('CUSTOM', 'AI_DETECTED', 'SYSTEM'))
);

CREATE INDEX idx_media_tags_slug ON media_tags(slug);
CREATE INDEX idx_media_tags_usage ON media_tags(usage_count DESC);

-- 创建文件-标签关联表
CREATE TABLE media_file_tags (
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    tag_id BIGINT REFERENCES media_tags(id) ON DELETE CASCADE,
    tagged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tagged_by BIGINT REFERENCES users(id),
    source VARCHAR(20) DEFAULT 'MANUAL',

    PRIMARY KEY (media_file_id, tag_id),
    CONSTRAINT chk_tag_source CHECK (source IN ('MANUAL', 'AI_AUTO', 'AI_SUGGESTED'))
);

CREATE INDEX idx_media_file_tags_file ON media_file_tags(media_file_id);
CREATE INDEX idx_media_file_tags_tag ON media_file_tags(tag_id);

-- 创建自定义元数据表
CREATE TABLE media_metadata (
    id BIGSERIAL PRIMARY KEY,
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    meta_key VARCHAR(100) NOT NULL,
    meta_value TEXT,
    meta_type VARCHAR(20) DEFAULT 'STRING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_media_metadata UNIQUE (media_file_id, meta_key),
    CONSTRAINT chk_meta_type CHECK (meta_type IN ('STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'JSON'))
);

CREATE INDEX idx_media_metadata_file ON media_metadata(media_file_id);
CREATE INDEX idx_media_metadata_key ON media_metadata(meta_key);
```

### V2_3__add_storage_providers.sql (Phase 3)

```sql
-- 创建存储提供商表
CREATE TABLE storage_providers (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    provider_type VARCHAR(20) NOT NULL,
    config_json TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_provider_type CHECK (provider_type IN ('LOCAL', 'S3', 'MINIO', 'OSS', 'COS'))
);

CREATE INDEX idx_storage_providers_default ON storage_providers(is_default);
CREATE INDEX idx_storage_providers_enabled ON storage_providers(is_enabled);

-- 扩展 media_files 表
ALTER TABLE media_files
    ADD COLUMN storage_provider_id BIGINT REFERENCES storage_providers(id) ON DELETE SET NULL,
    ADD COLUMN cdn_url VARCHAR(500);

CREATE INDEX idx_media_files_storage_provider ON media_files(storage_provider_id);

-- 插入默认本地存储提供商
INSERT INTO storage_providers (name, provider_type, config_json, is_default, is_enabled)
VALUES ('Local Storage', 'LOCAL', '{"basePath":"./uploads","urlPrefix":"/uploads"}', TRUE, TRUE);
```

### V2_4__add_media_variants.sql (Phase 4)

```sql
-- 创建图像变体表
CREATE TABLE media_variants (
    id BIGSERIAL PRIMARY KEY,
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    variant_type VARCHAR(20) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    width INT,
    height INT,
    format VARCHAR(20),
    quality INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_variant_type CHECK (variant_type IN ('THUMBNAIL', 'SMALL', 'MEDIUM', 'LARGE', 'WEBP', 'AVIF', 'ORIGINAL')),
    CONSTRAINT uq_media_variant UNIQUE (media_file_id, variant_type)
);

CREATE INDEX idx_media_variants_file ON media_variants(media_file_id);
CREATE INDEX idx_media_variants_type ON media_variants(variant_type);

-- 扩展 media_files 表
ALTER TABLE media_files
    ADD COLUMN blurhash VARCHAR(100),
    ADD COLUMN exif_data JSONB,
    ADD COLUMN ai_labels JSONB;

CREATE INDEX idx_media_files_ai_labels ON media_files USING GIN(ai_labels);
```

### V2_5__add_permissions_and_sharing.sql (Phase 5)

```sql
-- 创建文件夹权限表
CREATE TABLE folder_permissions (
    id BIGSERIAL PRIMARY KEY,
    folder_id BIGINT REFERENCES media_folders(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    permission_level VARCHAR(20) NOT NULL,
    granted_by BIGINT REFERENCES users(id),
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,

    CONSTRAINT chk_permission_level CHECK (permission_level IN ('VIEW', 'UPLOAD', 'EDIT', 'DELETE', 'ADMIN')),
    CONSTRAINT uq_folder_user_permission UNIQUE (folder_id, user_id)
);

CREATE INDEX idx_folder_permissions_folder ON folder_permissions(folder_id);
CREATE INDEX idx_folder_permissions_user ON folder_permissions(user_id);

-- 创建分享链接表
CREATE TABLE media_shares (
    id BIGSERIAL PRIMARY KEY,
    share_token VARCHAR(64) NOT NULL UNIQUE,
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    folder_id BIGINT REFERENCES media_folders(id) ON DELETE CASCADE,
    share_type VARCHAR(20) NOT NULL,
    access_type VARCHAR(20) NOT NULL DEFAULT 'VIEW',
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    access_count INT NOT NULL DEFAULT 0,
    max_access_count INT,
    password_hash VARCHAR(255),

    CONSTRAINT chk_share_type CHECK (share_type IN ('FILE', 'FOLDER')),
    CONSTRAINT chk_access_type CHECK (access_type IN ('VIEW', 'DOWNLOAD')),
    CONSTRAINT chk_share_target CHECK (
        (media_file_id IS NOT NULL AND folder_id IS NULL) OR
        (media_file_id IS NULL AND folder_id IS NOT NULL)
    )
);

CREATE INDEX idx_media_shares_token ON media_shares(share_token);
CREATE INDEX idx_media_shares_file ON media_shares(media_file_id);
CREATE INDEX idx_media_shares_folder ON media_shares(folder_id);

-- 创建版本历史表
CREATE TABLE media_versions (
    id BIGSERIAL PRIMARY KEY,
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    change_description TEXT,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_media_version UNIQUE (media_file_id, version_number)
);

CREATE INDEX idx_media_versions_file ON media_versions(media_file_id);
CREATE INDEX idx_media_versions_created ON media_versions(created_at DESC);

-- 扩展 media_files 表
ALTER TABLE media_files
    ADD COLUMN current_version INT NOT NULL DEFAULT 1,
    ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN archived_at TIMESTAMP,
    ADD COLUMN archived_by BIGINT REFERENCES users(id);

CREATE INDEX idx_media_files_archived ON media_files(is_archived);
```

---

## 🚀 Phase 1 详细实施步骤 (Week 1-2)

### 第1天: 数据库迁移

**任务清单**:
- [ ] 创建 `V2_1__add_media_folders.sql`
- [ ] 运行 Flyway 迁移
- [ ] 验证表结构和索引

**验证命令**:
```bash
cd apps/server
mvn flyway:migrate
psql -U postgres -d aetherblog -c "\d media_folders"
```

### 第2-3天: 后端实体层

**任务清单**:
- [ ] 创建 `MediaFolder.java` 实体
- [ ] 创建 `MediaFolderRepository.java`
- [ ] 修改 `MediaFile.java` 添加 `folder` 关联

**关键代码**: [MediaFolder.java](apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/entity/MediaFolder.java)
```java
@Entity
@Table(name = "media_folders")
public class MediaFolder {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;
    private String slug;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    private MediaFolder parent;

    @OneToMany(mappedBy = "parent", cascade = CascadeType.ALL)
    private List<MediaFolder> children = new ArrayList<>();

    private String path;  // 物化路径
    private Integer depth;
    private Integer sortOrder;

    // ... 其他字段
}
```

### 第4-5天: 后端服务层

**任务清单**:
- [ ] 创建 `FolderService.java` 接口
- [ ] 实现 `FolderServiceImpl.java`
- [ ] 实现文件夹CRUD操作
- [ ] 实现文件夹移动逻辑
- [ ] 实现统计更新逻辑

**核心方法**:
```java
public interface FolderService {
    MediaFolder create(CreateFolderRequest request, Long userId);
    MediaFolder update(Long id, UpdateFolderRequest request);
    void delete(Long id);
    MediaFolder getById(Long id);
    List<MediaFolder> getTree(Long userId);
    MediaFolder move(Long folderId, Long newParentId);
    void updateStatistics(Long folderId);
}
```

### 第6-7天: 后端控制器层

**任务清单**:
- [ ] 创建 `FolderController.java`
- [ ] 实现REST API端点
- [ ] 添加参数验证
- [ ] 编写单元测试

**API端点**:
```
GET    /v1/admin/media/folders/tree      获取文件夹树
POST   /v1/admin/media/folders            创建文件夹
PUT    /v1/admin/media/folders/{id}       更新文件夹
DELETE /v1/admin/media/folders/{id}       删除文件夹
POST   /v1/admin/media/folders/{id}/move  移动文件夹
```

### 第8-9天: 前端类型定义

**任务清单**:
- [ ] 扩展 `packages/types/src/models/media.ts`
- [ ] 添加 `MediaFolder` 接口
- [ ] 添加请求/响应类型

**关键类型**:
```typescript
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
  visibility: 'PRIVATE' | 'TEAM' | 'PUBLIC';
  fileCount: number;
  totalSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface FolderTreeNode extends MediaFolder {
  children: FolderTreeNode[];
}
```

### 第10-11天: 前端服务层

**任务清单**:
- [ ] 创建 `apps/admin/src/services/folderService.ts`
- [ ] 实现API调用方法
- [ ] 添加错误处理

**关键方法**:
```typescript
export const folderService = {
  getTree: async (): Promise<R<FolderTreeNode[]>> => {
    return apiClient.get('/v1/admin/media/folders/tree');
  },

  create: async (data: CreateFolderRequest): Promise<R<MediaFolder>> => {
    return apiClient.post('/v1/admin/media/folders', data);
  },

  move: async (folderId: number, targetParentId: number): Promise<R<MediaFolder>> => {
    return apiClient.post(`/v1/admin/media/folders/${folderId}/move`, { targetParentId });
  },

  // ... 其他方法
};
```

### 第12-13天: 前端FolderTree组件

**任务清单**:
- [ ] 创建 `apps/admin/src/pages/media/components/FolderTree.tsx`
- [ ] 实现树形结构渲染
- [ ] 添加展开/折叠动画
- [ ] 实现拖拽功能 (@dnd-kit)
- [ ] 添加右键菜单

**组件结构**:
```typescript
export function FolderTree({
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onMoveFolder,
}: FolderTreeProps) {
  const { data: folders } = useQuery({
    queryKey: ['folders', 'tree'],
    queryFn: () => folderService.getTree(),
  });

  return (
    <div className="folder-tree">
      {folders?.map(folder => (
        <FolderNode
          key={folder.id}
          folder={folder}
          selected={selectedFolderId === folder.id}
          onSelect={onSelectFolder}
        />
      ))}
    </div>
  );
}
```

### 第14天: 集成到MediaPage

**任务清单**:
- [ ] 修改 `apps/admin/src/pages/MediaPage.tsx`
- [ ] 添加左侧文件夹树
- [ ] 添加面包屑导航
- [ ] 更新文件列表筛选逻辑
- [ ] 添加"移动到文件夹"功能

**布局调整**:
```typescript
<div className="flex h-full">
  {/* 左侧文件夹树 */}
  <div className="w-64 border-r p-4">
    <FolderTree
      selectedFolderId={currentFolderId}
      onSelectFolder={setCurrentFolderId}
    />
  </div>

  {/* 主内容区 */}
  <div className="flex-1 p-6">
    <Breadcrumb folderId={currentFolderId} />
    {/* 现有内容 */}
  </div>
</div>
```

---

## ✅ 验收标准

### Phase 1 完成标准
- [ ] 可以创建/重命名/删除文件夹
- [ ] 文件夹支持无限层级嵌套
- [ ] 可以拖拽文件到文件夹
- [ ] 可以拖拽文件夹到另一个文件夹
- [ ] 面包屑导航正确显示路径
- [ ] 文件夹统计（文件数/大小）实时更新
- [ ] 所有操作有流畅的动画效果
- [ ] 移动端适配良好

### Phase 2-6 完成标准

#### Phase 2: 智能标签系统
- [ ] 可以创建/编辑/删除标签
- [ ] 文件支持多标签（一个文件可打多个标签）
- [ ] 标签输入支持自动完成
- [ ] 可以按标签筛选文件
- [ ] 批量打标签/取消标签
- [ ] AI自动识别并建议标签（图片）
- [ ] 标签使用统计显示
- [ ] 标签颜色自定义

#### Phase 3: 云存储与CDN
- [ ] 可以配置多个存储提供商
- [ ] 支持S3/MinIO/OSS/COS连接
- [ ] 可以测试存储连接
- [ ] 可以设置默认存储提供商
- [ ] 上传时可选择存储位置
- [ ] CDN URL自动生成
- [ ] 存储配额显示和限制
- [ ] 文件可在不同存储间迁移

#### Phase 4: 图像处理
- [ ] 上传时自动生成缩略图（多尺寸）
- [ ] 支持格式转换（JPEG/PNG/WebP/AVIF）
- [ ] 智能压缩保持质量
- [ ] 在线裁剪/旋转/调整大小
- [ ] 响应式图片URL生成
- [ ] Blurhash占位符生成
- [ ] EXIF数据提取和显示
- [ ] 批量图像处理

#### Phase 5: 协作与权限
- [ ] 可以设置文件夹权限（VIEW/UPLOAD/EDIT/DELETE/ADMIN）
- [ ] 可以邀请用户访问文件夹
- [ ] 可以生成公开分享链接
- [ ] 分享链接支持密码保护
- [ ] 分享链接支持过期时间
- [ ] 文件版本历史记录
- [ ] 可以查看和恢复历史版本
- [ ] 版本对比功能

#### Phase 6: 优化打磨
- [ ] 文件夹树使用Redis缓存
- [ ] 数据库查询优化（N+1问题解决）
- [ ] 大列表使用虚拟滚动
- [ ] 所有加载使用骨架屏
- [ ] 键盘快捷键支持
- [ ] API文档（Swagger）完整
- [ ] 单元测试覆盖率>80%
- [ ] 性能测试通过（10000+文件）

---

## 🚀 Phase 2-6 详细实施步骤

### Phase 2: 智能标签系统 (Week 3)

#### Day 1: 数据库迁移
**任务**:
- [ ] 创建 `V2_2__add_media_tags.sql`
- [ ] 运行迁移并验证

**验证**:
```bash
psql -U postgres -d aetherblog -c "\d media_tags"
psql -U postgres -d aetherblog -c "\d media_file_tags"
```

#### Day 2-3: 后端实体和仓储
**任务**:
- [ ] 创建 `MediaTag.java` 实体
- [ ] 创建 `MediaFileTag.java` 实体（关联表）
- [ ] 创建 `MediaMetadata.java` 实体
- [ ] 创建对应的Repository

**关键代码**:
```java
@Entity
@Table(name = "media_tags")
public class MediaTag {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;
    private String slug;
    private String color;
    @Enumerated(EnumType.STRING)
    private TagCategory category; // CUSTOM, AI_DETECTED, SYSTEM
    private Integer usageCount;
}

@Entity
@Table(name = "media_file_tags")
public class MediaFileTag {
    @EmbeddedId
    private MediaFileTagId id;

    @ManyToOne
    @MapsId("mediaFileId")
    private MediaFile mediaFile;

    @ManyToOne
    @MapsId("tagId")
    private MediaTag tag;

    @Enumerated(EnumType.STRING)
    private TagSource source; // MANUAL, AI_AUTO, AI_SUGGESTED
}
```

#### Day 4-5: 后端服务层
**任务**:
- [ ] 创建 `TagService.java` 接口
- [ ] 实现 `TagServiceImpl.java`
- [ ] 实现AI标签建议（集成Spring AI）

**核心方法**:
```java
public interface TagService {
    // 标签CRUD
    MediaTag create(String name, String color);
    List<MediaTag> getAll();
    List<MediaTag> getPopular(int limit);
    void delete(Long id);

    // 文件打标签
    void tagFile(Long fileId, Long tagId, Long userId, TagSource source);
    void untagFile(Long fileId, Long tagId);
    List<MediaTag> getFileTags(Long fileId);
    void batchTag(List<Long> fileIds, Long tagId);

    // AI功能
    List<MediaTag> suggestTags(Long fileId);
    void autoTagFile(Long fileId);
}
```

#### Day 6: 后端控制器
**任务**:
- [ ] 创建 `TagController.java`
- [ ] 实现REST API

**API端点**:
```
GET    /v1/admin/media/tags              获取所有标签
POST   /v1/admin/media/tags              创建标签
DELETE /v1/admin/media/tags/{id}         删除标签
POST   /v1/admin/media/files/{id}/tags   给文件打标签
DELETE /v1/admin/media/files/{id}/tags/{tagId}  取消标签
GET    /v1/admin/media/files/{id}/tags/suggest   AI建议标签
```

#### Day 7: 前端类型和服务
**任务**:
- [ ] 扩展 `packages/types/src/models/media.ts`
- [ ] 创建 `apps/admin/src/services/tagService.ts`

**类型定义**:
```typescript
export interface MediaTag {
  id: number;
  name: string;
  slug: string;
  color: string;
  category: 'CUSTOM' | 'AI_DETECTED' | 'SYSTEM';
  usageCount: number;
}

export interface TagFileRequest {
  fileId: number;
  tagIds: number[];
}
```

---

### Phase 3: 云存储与CDN (Week 4)

#### Day 1: 数据库迁移
**任务**:
- [ ] 创建 `V2_3__add_storage_providers.sql`
- [ ] 插入默认LOCAL存储提供商

#### Day 2-3: 存储抽象层
**任务**:
- [ ] 创建 `StorageService.java` 接口
- [ ] 创建 `StorageProvider.java` 实体
- [ ] 实现 `LocalStorageServiceImpl.java`

**接口设计**:
```java
public interface StorageService {
    UploadResult upload(MultipartFile file, StorageProvider provider, String path);
    InputStream download(String path, StorageProvider provider);
    void delete(String path, StorageProvider provider);
    String getUrl(String path, StorageProvider provider);
    String getCdnUrl(String path, StorageProvider provider);
    boolean testConnection(StorageProvider provider);
}
```

#### Day 4-5: 云存储适配器
**任务**:
- [ ] 实现 `S3StorageServiceImpl.java`
- [ ] 实现 `MinIOStorageServiceImpl.java`
- [ ] 实现 `OSSStorageServiceImpl.java`（阿里云）

**S3示例**:
```java
@Service
@ConditionalOnProperty(name = "storage.s3.enabled", havingValue = "true")
public class S3StorageServiceImpl implements StorageService {
    private final S3Client s3Client;

    @Override
    public UploadResult upload(MultipartFile file, StorageProvider provider, String path) {
        PutObjectRequest request = PutObjectRequest.builder()
            .bucket(getBucket(provider))
            .key(path)
            .build();
        s3Client.putObject(request, RequestBody.fromInputStream(file.getInputStream(), file.getSize()));
        return new UploadResult(path, getCdnUrl(path, provider));
    }
}
```

#### Day 6: 后端控制器
**任务**:
- [ ] 创建 `StorageProviderController.java`
- [ ] 实现配置管理API

**API端点**:
```
GET    /v1/admin/storage/providers           获取所有存储提供商
POST   /v1/admin/storage/providers           创建存储提供商
PUT    /v1/admin/storage/providers/{id}      更新配置
DELETE /v1/admin/storage/providers/{id}      删除
POST   /v1/admin/storage/providers/{id}/test 测试连接
POST   /v1/admin/storage/providers/{id}/set-default 设为默认
```

#### Day 7: 前端配置页面
**任务**:
- [ ] 创建 `apps/admin/src/pages/settings/StorageProviderSettings.tsx`
- [ ] 实现配置表单（S3/MinIO/OSS）

---

### Phase 4: 图像处理 (Week 5)

#### Day 1: 数据库迁移
**任务**:
- [ ] 创建 `V2_4__add_media_variants.sql`
- [ ] 扩展media_files表（blurhash, exif_data, ai_labels）

#### Day 2-3: 图像处理服务
**任务**:
- [ ] 添加Thumbnailator依赖
- [ ] 创建 `ImageProcessingService.java`
- [ ] 实现缩略图生成

**核心方法**:
```java
public interface ImageProcessingService {
    // 缩略图生成
    MediaVariant generateThumbnail(MediaFile file, int width, int height);
    List<MediaVariant> generateAllVariants(MediaFile file);

    // 格式转换
    MediaVariant convertFormat(MediaFile file, ImageFormat format, int quality);

    // 优化
    MediaVariant optimize(MediaFile file, OptimizationPreset preset);

    // 元数据
    ExifData extractExif(MediaFile file);
    String generateBlurhash(MediaFile file);
}
```

**实现示例**:
```java
@Service
public class ImageProcessingServiceImpl implements ImageProcessingService {
    @Override
    public MediaVariant generateThumbnail(MediaFile file, int width, int height) {
        BufferedImage thumbnail = Thumbnails.of(new File(file.getFilePath()))
            .size(width, height)
            .asBufferedImage();

        String variantPath = generateVariantPath(file, "thumbnail", width, height);
        ImageIO.write(thumbnail, "jpg", new File(variantPath));

        return createVariant(file, VariantType.THUMBNAIL, variantPath, width, height);
    }
}
```

#### Day 4: 异步任务队列
**任务**:
- [ ] 配置Spring @Async
- [ ] 创建异步任务执行器
- [ ] 修改MediaService在上传后触发异步处理

```java
@Async
public CompletableFuture<List<MediaVariant>> generateAllVariantsAsync(MediaFile file) {
    List<MediaVariant> variants = new ArrayList<>();
    variants.add(generateThumbnail(file, 150, 150));
    variants.add(generateThumbnail(file, 400, 400));
    variants.add(generateThumbnail(file, 800, 800));
    variants.add(convertFormat(file, ImageFormat.WEBP, 85));
    return CompletableFuture.completedFuture(variants);
}
```

#### Day 5-7: 前端图片编辑器
**任务**:
- [ ] 安装react-image-crop依赖
- [ ] 创建 `apps/admin/src/pages/media/components/ImageEditor.tsx`
- [ ] 实现裁剪/旋转/调整大小

---

### Phase 5: 协作与权限 (Week 6-7)

#### Week 6 Day 1-2: 数据库迁移
**任务**:
- [ ] 创建 `V2_5__add_permissions_and_sharing.sql`
- [ ] 创建folder_permissions, media_shares, media_versions表

#### Week 6 Day 3-5: 权限服务
**任务**:
- [ ] 创建 `PermissionService.java`
- [ ] 实现ACL权限检查
- [ ] 实现权限继承逻辑

**核心方法**:
```java
public interface PermissionService {
    boolean hasPermission(Long folderId, Long userId, PermissionLevel level);
    void grantPermission(Long folderId, Long userId, PermissionLevel level, Long grantedBy);
    void revokePermission(Long folderId, Long userId);
    List<FolderPermission> getFolderPermissions(Long folderId);
    PermissionLevel getEffectivePermission(Long folderId, Long userId);
}
```

#### Week 6 Day 6-7: 分享服务
**任务**:
- [ ] 创建 `ShareService.java`
- [ ] 实现Token生成（UUID + 加密）
- [ ] 实现密码保护

```java
public interface ShareService {
    MediaShare createFileShare(Long fileId, ShareConfig config);
    MediaShare createFolderShare(Long folderId, ShareConfig config);
    MediaShare getByToken(String token);
    boolean validateAccess(String token, String password);
    void incrementAccessCount(String token);
    void revokeShare(String token);
}
```

#### Week 7 Day 1-3: 版本控制服务
**任务**:
- [ ] 创建 `VersionService.java`
- [ ] 实现文件版本保存
- [ ] 实现版本恢复

```java
public interface VersionService {
    MediaVersion createVersion(MediaFile file, MultipartFile newFile, String description);
    List<MediaVersion> getVersionHistory(Long fileId);
    MediaFile restoreVersion(Long fileId, int versionNumber);
    void deleteVersion(Long versionId);
}
```

#### Week 7 Day 4-7: 前端UI
**任务**:
- [ ] 创建 `FolderPermissionsPage.tsx`
- [ ] 创建 `ShareDialog.tsx`
- [ ] 创建 `VersionHistory.tsx`
- [ ] 集成到MediaPage和MediaDetail

---

### Phase 6: 优化打磨 (Week 8)

#### Day 1-2: 性能优化
**任务**:
- [ ] 配置Redis缓存
- [ ] 缓存文件夹树（TTL 5分钟）
- [ ] 优化数据库查询（添加@EntityGraph避免N+1）
- [ ] 添加数据库连接池监控

**Redis缓存示例**:
```java
@Cacheable(value = "folderTree", key = "#userId")
public List<FolderTreeNode> getTree(Long userId) {
    // 查询逻辑
}

@CacheEvict(value = "folderTree", allEntries = true)
public MediaFolder create(CreateFolderRequest request, Long userId) {
    // 创建逻辑
}
```

#### Day 3-4: 前端性能优化
**任务**:
- [ ] 安装react-window实现虚拟滚动
- [ ] 所有列表页面添加骨架屏
- [ ] 图片懒加载
- [ ] 代码分割（动态import）

**虚拟滚动示例**:
```typescript
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={600}
  itemCount={items.length}
  itemSize={120}
  width="100%"
>
  {({ index, style }) => (
    <div style={style}>
      <MediaCard item={items[index]} />
    </div>
  )}
</FixedSizeList>
```

#### Day 5: 键盘快捷键
**任务**:
- [ ] 安装react-hotkeys-hook
- [ ] 实现常用快捷键

**快捷键列表**:
```
Ctrl/Cmd + U  - 上传文件
Ctrl/Cmd + N  - 新建文件夹
Ctrl/Cmd + A  - 全选
Delete        - 删除选中
Ctrl/Cmd + F  - 搜索
Escape        - 取消选择/关闭对话框
```

#### Day 6: 测试
**任务**:
- [ ] 编写单元测试（JUnit + Mockito）
- [ ] 编写前端测试（Vitest + React Testing Library）
- [ ] 性能测试（JMeter - 10000+文件）

#### Day 7: 文档
**任务**:
- [ ] 配置Swagger/OpenAPI
- [ ] 编写API文档
- [ ] 编写用户手册
- [ ] 编写部署文档

---

## 🎨 UI/UX 设计规范

### 文件夹树样式 (Cognitive Elegance)

```tsx
// 文件夹项样式
<div className={cn(
  "group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all",
  "hover:bg-white/5 hover:backdrop-blur-sm",
  selected && "bg-primary/10 border border-primary/30"
)}>
  {/* 展开/折叠图标 */}
  <ChevronRight className={cn(
    "w-4 h-4 transition-transform",
    expanded && "rotate-90"
  )} />

  {/* 文件夹图标 */}
  <Folder className="w-5 h-5" style={{ color: folder.color }} />

  {/* 文件夹名称 */}
  <span className="flex-1 text-sm text-[var(--text-primary)] truncate">
    {folder.name}
  </span>

  {/* 文件数量徽章 */}
  <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-full">
    {folder.fileCount}
  </span>
</div>
```

### 拖拽反馈

```tsx
// 拖拽中的样式
<div className={cn(
  "opacity-50 scale-95 transition-all",
  isDragging && "cursor-grabbing"
)}>
  {/* 内容 */}
</div>

// 拖拽目标高亮
<div className={cn(
  "border-2 border-dashed transition-all",
  isOver && "border-primary bg-primary/5"
)}>
  {/* 内容 */}
</div>
```

---

## 🔧 开发工具与命令

### 后端开发
```bash
# 运行数据库迁移
cd apps/server
mvn flyway:migrate

# 运行后端服务
mvn spring-boot:run -pl aetherblog-app

# 运行测试
mvn test -pl blog-service
```

### 前端开发
```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev:admin

# 类型检查
pnpm --filter @aetherblog/types tsc --noEmit

# 构建
pnpm build:admin
```

### 数据库操作
```bash
# 连接数据库
psql -U postgres -d aetherblog

# 查看表结构
\d media_folders

# 查看索引
\di media_folders*

# 查询文件夹树
SELECT id, name, parent_id, path, depth FROM media_folders ORDER BY path;
```

---

## 📚 参考资源

### 现有代码参考
- **Category实体**: `apps/server/.../entity/Category.java` - 父子层级关系
- **CategoriesPage**: `apps/admin/src/pages/CategoriesPage.tsx` - CRUD UI模式
- **MediaPage**: `apps/admin/src/pages/MediaPage.tsx` - 网格/列表视图
- **MediaGrid**: `apps/admin/src/pages/media/components/MediaGrid.tsx` - 拖拽上传

### 技术文档
- [Spring Data JPA](https://spring.io/projects/spring-data-jpa)
- [React Query](https://tanstack.com/query/latest)
- [dnd-kit](https://docs.dndkit.com/)
- [Framer Motion](https://www.framer.com/motion/)

---

## 🚨 风险与注意事项

### 数据迁移风险
- **现有文件**: 所有现有文件的 `folder_id` 为 NULL，需要决定是否迁移到根文件夹
- **回滚策略**: 每个迁移都应该有对应的回滚SQL

### 性能风险
- **深层嵌套**: 文件夹深度超过10层可能影响查询性能
- **大量文件**: 单个文件夹超过1000个文件需要分页加载
- **统计更新**: 文件夹统计更新应该异步执行

### 安全风险
- **权限检查**: 所有文件夹操作必须检查用户权限
- **路径遍历**: 防止通过 `../` 等方式访问未授权文件夹
- **SQL注入**: 使用参数化查询，避免拼接SQL

---

## 📝 下一步行动

**立即开始 Phase 1 实施**:
1. 创建数据库迁移文件
2. 实现后端实体和服务
3. 开发前端组件
4. 集成测试

**准备就绪，等待您的批准！**
