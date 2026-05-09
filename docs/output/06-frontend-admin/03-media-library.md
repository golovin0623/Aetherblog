# 03 · 媒体库 / 上传 / 文件夹 / 多 provider

> **范围**:`apps/admin/src/pages/MediaPage.tsx`、`pages/media/components/*`、`pages/media/FolderPermissionsPage.tsx`、`services/{mediaService,mediaTagService,folderService,permissionService,versionService,shareService,storageProviderService,storageSyncService}.ts`、`hooks/useMediaKeyboardShortcuts.tsx`。

---

## 1. 范围

媒体库是后台体量最大的单体页面(`MediaPage.tsx` 1163 行 + 19 个子组件 + 8 个相关 service)。本文聚焦:

- 媒体列表、过滤、视图切换、回收站、批量操作
- 上传(retry / abort / phase / 拖拽 / 多文件并发)
- 文件夹树(增删改移、统计刷新、权限子页)
- 标签筛选 / 多 provider 切换
- 与对象存储同步、共享链接、版本历史

不在本切片(放 06):**Cloud Explorer**(`/storage/explorer`)和 **StorageProviderSettings**(`/settings` 内嵌)。

---

## 2. 入口与路由

| 路径 | 入口文件 |
| --- | --- |
| `/media` | `pages/MediaPage.tsx:104` |
| `/media/folder/:folderId/permissions` | `pages/media/FolderPermissionsPage.tsx:31`,通过 `App.tsx:38-51` 的 `FolderPermissionsWrapper` 注入 props |

`AdminLayout` 的 `isAppPage` 检测把 `/media` 列为"自管布局"页面(`AdminLayout.tsx:18-20`),所以 `<main>` 不加默认 padding;由 MediaPage 内部自管 `p-4 lg:p-6`(`MediaPage.tsx:503`)。

---

## 3. 状态拓扑

`MediaPage` 的状态全部 `useState` + `useRef` + React Query:

### 3.1 React Query keys

| Key | queryFn | 触发 invalidate |
| --- | --- | --- |
| `['media', 'list', params]` | `mediaService.getList(params)` | 上传成功 / 删除 / 还原 / 移动 |
| `['media', 'trash', 'count']` | `mediaService.getTrashCount()` | 上述同步 |
| `['folders']`(隐式) | `folderService.getTree()`(在 `FolderTree` 子组件内) | 文件夹增删改移、`refreshStatistics` |

`params` 形状:`{ pageNum, pageSize: 20, fileType, keyword, folderId }`(`MediaPage.tsx:212-218`)。

### 3.2 上传专用 ref 池

```ts
controllersRef = useRef<Map<string, AbortController>>(new Map());
uploadingFilesRef = useRef<UploadingFile[]>([]);
```

为什么用 ref 而不是 state:

- AbortController 不是 React 状态,放 state 会让"setState 还没落到 state 时 cancel 已经触发"出现 race(controller 是 undefined → abort 失效)
- `uploadingFilesRef` 在 useEffect 同步从 state 拷贝,handleRetry 等回调直接从 ref 读最新快照,不用嵌套 setState updater
- 见 `MediaPage.tsx:117-121` 的注释 `@ref PR #646 fix: gemini-code-assist medium`

### 3.3 其他重要 state

```
viewMode: 'grid' | 'list'            // 视图切换
filterType: 'ALL' | MediaType        // 类型胶囊
searchQuery / debouncedSearch        // 文件名搜索
page                                 // 当前页
selectedMedia: number | null         // 详情 drawer 当前文件
selectedIds: Set<number>             // 多选
isViewerOpen + viewingIndex          // 大图浏览器
uploadingFiles: UploadingFile[]      // 上传任务列表(浮窗渲染)
isDragging                           // 拖拽中
currentFolderId                      // 当前文件夹
folderDialogOpen + editingFolder + parentFolderId  // 文件夹对话框
moveDialogOpen + moveTarget + batchMoveIds         // 移动对话框
selectedTagIds: number[]             // 标签筛选
showShortcuts                        // 快捷键面板
trashDialogOpen + syncDialogOpen     // 回收站 / 同步对话框
showMobileFolders                    // 移动端文件夹抽屉
pendingConfirm: PendingConfirm | null  // 统一删除确认 ConfirmModal
folderPanelWidth + isResizing + resizeRef  // 左侧文件夹面板可调宽
```

---

## 4. 数据流

```
URL /media → MediaPage 挂载
  ├─ useQuery(['media', 'list', params])
  │    └─ mediaService.getList → GET /v1/admin/media?fileType=&keyword=&folderId=&pageNum=&pageSize=20
  │    → R<PageResult<MediaItem>>
  ├─ useQuery(['media', 'trash', 'count'])
  │    └─ mediaService.getTrashCount → GET /v1/admin/media/trash/count
  └─ FolderTree 子组件 useQuery(['folders'])
       └─ folderService.getTree → GET /v1/admin/media/folders/tree
       → R<FolderTreeNode[]>

用户上传(选文件 / 拖拽)
  ├─ handleUpload(files) 同步预创建 controller 写入 controllersRef(防止 race)
  │    setUploadingFiles([...prev, ...placeholders])
  └─ queued.forEach(startUpload(id, file, currentFolderId, controller))
       └─ mediaService.upload(file, onProgress, { folderId, signal, onAttempt })
            → POST /v1/admin/media/upload (multipart)
            → mediaService 内部 retry/backoff/abort/phase
            → onProgress 回调切 status 'uploading' → 'processing'
            → success → setUploadingFiles 状态 'success' + 1.2s 后清除 + invalidate ['media','list']
            → error → setUploadingFiles 状态 'error' + toast.error
            → aborted → setUploadingFiles 状态 'aborted'

用户删除/还原/批量
  ├─ deleteMutation: DELETE /v1/admin/media/{id}     → 移到回收站
  ├─ batchDeleteMutation: DELETE /v1/admin/media/batch → 批量移到回收站
  ├─ TrashDialog: 还原 / 永删 / 清空回收站

文件夹操作
  ├─ FolderDialog 开关:create/edit
  │    folderService.create / .update
  ├─ MoveDialog: folderService.move 或 mediaService.{moveToFolder,batchMoveToFolder}
  └─ delete: folderService.delete (后端校验文件夹是否空)

权限管理
  └─ /media/folder/:id/permissions 路由
       FolderPermissionsPage useQuery + grant/revoke mutations
       permissionService.{getPermissions, grant, revoke, update}
```

---

## 5. 调用的 server-go 接口

按 service 文件分组:

### 5.1 `mediaService`(`services/mediaService.ts`)

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/v1/admin/media` | 列表(支持 fileType / keyword / folderId / pageNum / pageSize) |
| GET | `/v1/admin/media/{id}` | 详情 |
| POST | `/v1/admin/media/upload` | 上传(multipart,带 retry/abort) |
| PUT | `/v1/admin/media/{id}` | 修改 altText / originalName |
| DELETE | `/v1/admin/media/{id}` | 移到回收站 |
| DELETE | `/v1/admin/media/batch` | 批量移到回收站(body 是 ID 数组) |
| GET | `/v1/admin/media/stats` | 存储统计 |
| POST | `/v1/admin/media/{id}/move` | 移到指定文件夹 |
| POST | `/v1/admin/media/batch-move` | 批量移动 |
| POST | `/v1/admin/media/{id}/content` | 上传编辑后的图片(替换源文件 + 写新版本) |
| GET | `/v1/admin/media/trash` | 回收站列表 |
| GET | `/v1/admin/media/trash/count` | 回收站数量 |
| POST | `/v1/admin/media/{id}/restore` | 单文件恢复 |
| POST | `/v1/admin/media/trash/batch-restore` | 批量恢复 |
| DELETE | `/v1/admin/media/{id}/permanent?deleteCloud=true\|false` | 单文件永删 |
| DELETE | `/v1/admin/media/trash/batch-permanent?deleteCloud=...` | 批量永删 |
| DELETE | `/v1/admin/media/trash/empty` | 清空回收站 |

### 5.2 `folderService`、`mediaTagService`、`permissionService`、`versionService`、`shareService`、`storageSyncService`

参见 §08-state-and-services.md 的"服务表"。媒体库消费的 endpoint 集中在:

- `/v1/admin/media/folders/*`(tree / CRUD / move / refresh-stats)
- `/v1/admin/media/folders/{id}/permissions`(列表 + 授予 + 撤销)
- `/v1/admin/media/files/{id}/versions`(版本列表 + 恢复)
- `/v1/admin/media/shares/file/{id}`、`/folder/{id}`(创建分享)
- `/v1/admin/media/tags`、`/files/{id}/tags`、`/tags/batch`(标签)
- `/v1/admin/storage/sync/*`(`SyncDialog` 触发后台备份)

---

## 6. 上传子系统(关键复杂度)

### 6.1 上传一次的 UploadOnceConfig(`mediaService.ts:145-176`)

```ts
async function uploadOnce<T>({ url, formData, onProgress, signal }) {
  const response = await axios.post<R<T>>(url, formData, {
    withCredentials: true,
    signal,
    onUploadProgress: (event) => {
      if (!event.total) {
        if (event.loaded > 0) onProgress?.(99, 'processing');
        return;
      }
      const ratio = Math.min(1, event.loaded / event.total);
      const percent = Math.min(99, Math.round(ratio * 100));
      const phase = ratio >= 1 ? 'processing' : 'uploading';
      // 同 percent 不重复回调,减少 setState
      onProgress?.(percent, phase);
    }
  });
  onProgress?.(100, 'processing');
  return response.data.data;
}
```

两阶段进度:
- `uploading` 0-99%:字节正在 PUT
- `processing` 99-100%:字节发完,等后端入库 + 缩略图 + 同步队列响应
- 响应到达时强制 `100%, processing`,UI 显示"完成中"再切 success

### 6.2 retry 策略(`mediaService.ts:177-196`)

```
maxAttempts = maxRetries + 1   // 默认 maxRetries=2 → 3 次
for (attempt = 1; attempt <= maxAttempts; attempt++):
  try uploadOnce
  catch err:
    if isUploadAborted(err)         throw err
    if attempt >= max               throw lastErr
    if !isRetriableError(err)       throw lastErr
    onAttempt?.(attempt + 1, err)   告诉 UI 切回 'uploading' + 重置 progress
    await sleep(backoffMs)          指数退避 + 抖动
```

`isRetriableError`(`mediaService.ts:107-119`):
- `axios.isCancel` / `AbortError` / `UploadAbortedError` 都不重试
- 非 axios error(说明是 callback 里抛的编程错)不重试
- `5xx` / `408` / `425` / `429` 重试
- 其他 4xx 不重试

`backoffMs`(`:121-125`):`250 * 2^(attempt-1)` ± 20% 抖动,最小 120ms。

### 6.3 abort 通路

- 用户点 X(单文件)→ `handleCancelUpload(id)` → `controller.abort()`(`MediaPage.tsx:404-414`)
- 用户全部取消 → `handleCancelAll` 遍历 `controllersRef` 全部 abort(`MediaPage.tsx:430-434`)
- abort 抛 `UploadAbortedError`(`mediaService.ts:88-93`),`isUploadAborted` 判别(检查 `err.name === 'AbortError'` / `axios.isCancel` / 类型 / `err.code === 'ERR_CANCELED'`)
- catch 分支识别 aborted → 切 status 'aborted',文案"已取消"
- "重试" 按钮(`handleRetryUpload`)只对 `status: 'error' | 'aborted'` 生效

### 6.4 拖拽 / 文件 input

```
<div onDragOver onDragLeave onDrop> 包整个 MediaPage
  └─ onDrop: handleUpload(e.dataTransfer.files)

<input type="file" multiple ref={fileInputRef} hidden>
  ├─ <button onClick={fileInputRef.current?.click()}>上传按钮</button>
  └─ onChange: handleUpload(e.target.files)
```

**没有 mime 校验**,后端兜底过滤。`onDragLeave` 简单 `setIsDragging(false)`,在子元素冒泡时偶尔会闪(已知瑕疵)。

### 6.5 进度浮窗 `UploadProgress`

`pages/media/components/UploadProgress.tsx`(本次未读,但通过 props 推断):
- 接收 `uploadingFiles[]`、`onCancel(id)`、`onRetry(id)`、`onClearCompleted()`、`onCancelAll()`
- 浮在右下角,success 后 1.2s 自动淡出
- "清除已完成" 把 success/error/aborted 项从列表移除,但保持 uploading/processing/queued

---

## 7. 文件夹树(`pages/media/components/FolderTree.tsx`)

### 7.1 视图

- 左侧 panel,默认 288px,可拖拽 256-520px 调宽(`MediaPage.tsx:159-183`)
- 顶部 "文件夹" 标题 + ➕ 创建根文件夹
- 树形,用户点行选中 → `setCurrentFolderId(id)` → 主区按 folderId 重新拉列表
- 行内展开 / 折叠 / 重命名 / 删除 / 移动 / 权限链接

### 7.2 数据来源

`folderService.getTree()` → `FolderTreeNode[]`(`packages/types`)。后端返回完整树,前端不分页。

### 7.3 移动端

桌面隐藏,移动端用 `Folder` 按钮触发 `showMobileFolders=true`,打开抽屉(`MediaPage.tsx:516-522`)。

---

## 8. 标签筛选(`pages/media/components/TagFilterBar.tsx` + `mediaTagService`)

媒体标签独立于文章标签(后端有 `media_tags` 表)。

- TagFilterBar 顶端 chip 列,选中后把 `selectedTagIds` 传给列表 query(待补:`MediaPage` 当前 `params` 没把 `selectedTagIds` 传给后端 — 这是个 TODO)
- TagManager modal 在媒体详情中可手动给文件打 / 取消标签
- 批量打标签:`mediaTagService.batchTag(fileIds, tagId)`

⚠ 已发现的问题:`selectedTagIds` 状态在 MediaPage 维护,但**列表 query 没消费**它。需要在 `getList` 端加 `tagIds` 参数,后端 handler 也要支持。

---

## 9. 多 provider 切换

### 9.1 Provider 上下文

媒体库本身不直接切换 provider。**Provider 选择在 storage settings**(详见 06)。

但媒体库会消费 provider 信息:
- `MediaItem.storageType` / `storageProviderId` / `cdnUrl` / `backupProviderId` / `backupUrl` / `backupAt` / `syncStatus`(`mediaService.ts:9-30`)
- `getMediaUrl(input)`(`:210-219`):传 string → 解析本地 `/uploads` → `/api/uploads`;传 MediaItem → 优先 cdnUrl,空时回 fileUrl
- `StorageBadge`(`pages/media/components/StorageBadge.tsx`):每个 MediaItem 旁显示来源 provider
- `SyncDialog`:把所有未同步文件入队备份(`storageSyncService.start(targetProviderId?)`)

### 9.2 上传到哪个 provider?

- 后端默认走 `default` provider(`/v1/admin/storage/providers/default`),admin 在 storage settings 切换默认值
- 前端 `mediaService.upload` 没传 provider,完全交给后端;若要"上传到指定 provider" 需要扩协议

### 9.3 同步与孤儿

- `SyncDialog` 触发 worker 把已上传到 LOCAL 的文件复制到云;`syncStatus` 反映 `NONE / PENDING / SYNCING / SYNCED / FAILED`
- "孤儿"(catalog 里没有但云端存在的对象)由 `CloudExplorerPage` 处理(详见 06)

---

## 10. 媒体详情 drawer(`pages/media/components/MediaDetail.tsx`)

点击列表项 → `setSelectedMedia(id)`。详情面板:

- 大图 / 视频预览
- altText / originalName 表单(在线 PUT)
- 复制 URL / 下载 / 移到文件夹
- TagManager(打 / 取消标签)
- VersionHistory 子区:`versionService.getHistory(id)` → 显示版本时间线 + "恢复到此版本"
- ShareDialog 子区:`shareService.createFileShare(id, config)` → 生成短链(public / password,可设有效期 / 最大访问数)
- ImageEditor:点 "编辑" → 进入裁剪 / 旋转,保存调 `mediaService.uploadEdited(id, formData)` 写新版本

---

## 11. 大图浏览器 `MediaViewer`

- `setIsViewerOpen(true)` + `viewingIndex` → 打开 lightbox
- 左右切换、缩放、键盘 ←→
- 退出 → `setIsViewerOpen(false)`

---

## 12. 文件夹权限页(`pages/media/FolderPermissionsPage.tsx`)

### 12.1 入口

- 路径:`/media/folder/:folderId/permissions`
- 由 `FolderPermissionsWrapper`(`App.tsx:38-51`)解析 `folderId` 转 number 后注入

### 12.2 权限层级

```
VIEW   只查看
UPLOAD 可上传新文件
EDIT   可编辑文件
DELETE 可删除文件
ADMIN  完全控制(包括二次授权)
```

### 12.3 数据流

```
useQuery(['folder-permissions', folderId])
  └─ permissionService.getPermissions(folderId)
     → GET /v1/admin/media/folders/{folderId}/permissions
     → R<FolderPermission[]>

grantMutation:
  permissionService.grant(folderId, { userId, permissionLevel, expiresAt })
   → POST /v1/admin/media/folders/{folderId}/permissions

revokeMutation:
  permissionService.revoke(permissionId)
   → DELETE /v1/admin/media/permissions/{id}
```

### 12.4 UI 组成

- 顶部"授予权限"按钮 → 展开内联表单(userId 输入 + 权限选择 + 过期时间 picker)
- 列表卡片:user avatar + nickname + 权限徽章 + expires-in / 撤销

⚠ `userId` 是手输 number,**没有用户搜索 / autocomplete** —— 实际使用极不方便。建议接 `/v1/admin/users/search` 类似端点。

---

## 13. 快捷键(`hooks/useMediaKeyboardShortcuts.tsx`)

| 键 | 动作 |
| --- | --- |
| `⌘U` | 上传(打开文件 picker) |
| `⌘N` | 新建文件夹 |
| `⌘A` | 全选当前页 |
| `⌫` / `Del` | 批量删除选中 |
| `/` | 聚焦搜索框 |
| `Esc` | 取消详情 / 取消多选 |
| `⌘/` | 显示快捷键面板 |

`enabled` 由 viewer / dialog 状态控制(`MediaPage.tsx:208`),避免冲突。

---

## 14. 设计系统应用点

- 文件夹左侧 panel:`surface-leaf surface-admin-panel !rounded-2xl`,带 aurora-1 圆点装饰
- 类型胶囊 active:`bg-[var(--aurora-1)] text-white shadow` —— 偏离 Codex(应该用 `--color-primary`,因为 admin 主色就是近黑;这里特意用了 aurora-1 让"图片 / 视频 / 音频" 类型在视觉上更鲜明)
- 视图切换按钮同样用 `--aurora-1`
- 删除徽章:`bg-status-danger`(legacy)
- 上传按钮:`bg-primary hover:bg-primary/90 shadow-primary/20`(legacy 主色,与 PostsPage CTA 同源)
- 上传浮窗 / 同步对话框 / 移动对话框:`@aetherblog/ui` 的 `ConfirmModal` / 自管 surface-overlay

⚠ 文件夹 panel 的 `surface-admin-panel` 是 admin 自定义的派生表面 class,在 `index.css` 内定义;严格遵循 Codex 应该用 `surface-raised`。

---

## 15. 已知限制 / 待改进

1. ⚠ **`selectedTagIds` 不参与列表查询**:状态定义、UI 已就绪,但 `MediaListParams` 和后端都没接 `tagIds`。该补齐。
2. ⚠ **mime 校验缺失**:后端是兜底,但前端弹错的瞬间用户已经看到"上传中" → 体验差。
3. ⚠ **拖拽闪烁**:`onDragLeave` 在子元素冒泡时会被错误触发,造成蓝色高亮闪烁。可以加 `dragCounter` 计数。
4. ⚠ **`FolderPermissionsWrapper` 用 ID 当文件夹名**:见 01 文档。
5. ⚠ **`provider` 切换缺位**:上传时无法选目标 provider,只能改默认 provider 后再传。
6. ⚠ **批量移到文件夹的对话框** `MoveDialog` 直接传 `name=文件夹 ${folderId}`(`MediaPage.tsx:491`),应通过 folder service 取真名。
7. ⚠ **回收站项无搜索**:回收站对话框默认拉前 24 条,没有 keyword / fileType 过滤。
8. ⚠ **`pendingConfirm` 的 union 类型**(`MediaPage.tsx:66-69`):`trash-file` / `delete-folder` / `batch-trash`。`ConfirmModal` 的文案 / 回调通过 switch-case 分发,但代码在 `MediaPage.tsx` 末尾,**未读到的部分有 ~40 行 switch**;扩 union 时容易漏分支。
9. ⚠ **大量行内 className**:1100+ 行 JSX,样式与逻辑混在一起,看 diff 很困难。可以抽 `MediaPage.tsx` 的 header / filter bar / folder panel 为独立子组件。
