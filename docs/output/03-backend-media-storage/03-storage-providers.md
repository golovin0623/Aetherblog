# 03 · Storage Provider 抽象层

> 描述:多 Provider 配置(LOCAL / S3 / OSS / COS / MINIO / R2),以及落库加密 / 列表脱敏 / partial PUT 深合并 三层防御。
> 关键文件:`internal/pkg/storage/storage.go` · `local.go` · `s3.go` · `factory.go` · `internal/repository/storage_provider_repo.go` · `internal/service/storage_provider_service.go`。
> 重大变更:
> - **migration 000042** 把 `provider_type` CHECK 加上 `R2` 让 factory.go 与 DB 对齐。
> - **PR #647 批次 2** 把 `mergeProviderConfigJSON` 升级为深合并 + null 等同缺失。

---

## 1. 责任范围

| 子能力 | 说明 |
| --- | --- |
| **Provider CRUD** | List / Get / Create / Update / Delete / SetDefault / Test |
| **Provider 配置加密落库** | 通过 `cryptkey.Keystore` 用 Fernet 加密整段 `config_json`,前缀 `enc:v1:` |
| **secret 脱敏回显** | List / Get 接口前把 `accessKeyId / secretAccessKey / token / password / apiKey / secret` 截成 `AB****CD12` |
| **partial PUT 深合并** | Update 时把脱敏占位 / 空值 / 缺失 / null 字段从旧值继承,**不擦掉前端没改的字段** |
| **Storage 接口抽象** | `Storage.Upload/Get/Delete/GetURL/Type` + 可选 `Lister.List` |
| **多厂商兼容(同一份 S3Storage)** | 通过 `applyProviderDefaults` 补齐 region / endpoint;通过 `isTrustedProviderEndpoint` 白名单 SSRF 防御 |
| **反向导入 + 云端浏览** | Phase 5,管理 admin 在 UI 中浏览 bucket 内容,把孤儿 key 写回 catalog |

---

## 2. 关键代码入口

| 入口 | 文件 / 行 | 备注 |
| --- | --- | --- |
| Provider Handler | `storage_provider_handler.go:38-235` | 8 个常规 endpoint + 3 个 Phase 5 endpoint |
| List | `service.List:34` | 返回脱敏后的 VOs |
| GetDefault | `service.GetDefault:53` | 默认且 enabled |
| Update(深合并 + 缓存清理) | `service.Update:83` | 调 `mergeProviderConfigJSON` + `mediaSvc.InvalidateProvider` |
| Delete(级联清缓存) | `service.Delete:106` | |
| SetDefault(事务) | `repository.SetDefault:192` | 先全部清,再标 1 行 |
| Test 连通性 | `service.Test:406` | LOCAL 直返 true;S3 走 `HeadBucket` |
| **mergeProviderConfigJSON** | `service.go:485` | partial PUT 深合并核心,带 secret 字段保护 + null 等同缺失 |
| **redactProviderConfigJSON** | `service.go:436` | 列表/详情接口出口的脱敏 |
| **deepMergeStringMap** | `service.go:529` | `mergeProviderConfigJSON` 的工具 helper |
| Provider Repo encrypt | `repo.encryptConfig:43` + `repo.requireEncryption:76` | Create/Update 落库前加密 |
| Provider Repo decrypt | `repo.decryptConfig:55` + `repo.applyDecrypt:67` | Find* 取出后透明解密 |
| Legacy 自动迁移 | `repo.MigrateLegacyToEncrypted:219` | 启动时一次性把明文行加密重写 |
| Storage 接口 | `storage.go:11-30` | `Upload/Delete/GetURL/Type/Get` |
| Lister 扩展 | `storage.go:46-48` | `List(ctx, prefix, token, limit)` |
| Local 实现 | `local.go:1-203` | path traversal 防御 + GetSafePath |
| S3 实现 | `s3.go:1-650` | SSRF 防御 + multipart + 5 厂商兼容 |

---

## 3. Provider 类型矩阵

| ProviderType | 实现 | endpoint 必需 | 默认 region | 白名单 host | 用途 |
| --- | --- | --- | --- | --- | --- |
| `LOCAL` | `LocalStorage` | n/a | n/a | n/a | 进程本地磁盘,server.go 启动时构造,`config_json={"basePath","urlPrefix"}` |
| `S3` | `S3Storage` | 否(走 AWS 默认) | `us-east-1` | `s3.amazonaws.com` / `s3.<region>.amazonaws.com` 等 | AWS S3 |
| `MINIO` | `S3Storage` | **是**(必须自填) | `us-east-1`(占位) | 走 `validateEndpoint` 防 SSRF | 自部署 MinIO |
| `R2` | `S3Storage` | **是**(必须自填) | `auto` | `<account>.r2.cloudflarestorage.com` | Cloudflare R2 |
| `COS` | `S3Storage` | 否(自动 `cos.<region>.myqcloud.com`) | `ap-guangzhou` | `cos.<region>.myqcloud.com` | 腾讯云 COS |
| `OSS` | `S3Storage` | 否(自动 `oss-<region>.aliyuncs.com`) | `cn-hangzhou` | `oss-<region>.aliyuncs.com` / `-internal.aliyuncs.com` | 阿里云 OSS |

**设计折衷:**
- 5 个 S3 兼容厂商共用一份 `S3Storage`,只在 `applyProviderDefaults`(`s3.go:165`)补默认值。
- COS / OSS / R2 默认 endpoint 由 region 推算,不依赖 DNS,**SSRF 校验跳过**(`s3.go:140` `isTrustedProviderEndpoint`)— 让单元测试和离线环境也能起 client。
- 自定义 endpoint(MINIO 必填、其他可选)走 `validateEndpoint`(`s3.go:32`)做 DNS resolve 防内网/IMDS 范围。

---

## 4. 数据流(以 Update Provider 配置为例)

前端场景:admin 打开 Provider 编辑表单,只改 bucket,提交 PUT:

```
PUT /api/v1/admin/storage/providers/3
{
  "name": "Aliyun-Prod",
  "providerType": "OSS",
  "configJson": "{\"bucket\":\"new-bucket\",\"accessKeyId\":\"AK****1234\",\"secretAccessKey\":\"sk****abcd\"}",
  "isEnabled": true,
  "priority": 0
}

注意前端提交的是脱敏后值(因为 List 接口返回的就是脱敏值)。
原 DB 中:
  config_json (decrypt): {
    "bucket": "old-bucket",
    "region": "cn-hangzhou",
    "endpoint": "https://oss-cn-hangzhou.aliyuncs.com",
    "accessKeyId": "AKIAOLD123456",
    "secretAccessKey": "super-secret-old"
  }
```

```
StorageProviderHandler.Update (storage_provider_handler.go:96)
  • bindAndValidate(req)
  • call svc.Update(ctx, 3, req)

StorageProviderService.Update (storage_provider_service.go:83)
  ┌───────────────────────────────────────────────────────────────┐
  │ a. old = repo.FindByID(3)                                     │
  │     repo 内会 applyDecrypt → old.ConfigJSON = 旧明文           │
  │                                                               │
  │ b. merged = mergeProviderConfigJSON(old.ConfigJSON, new)      │
  │                                                               │
  │     merge 逻辑:                                                │
  │     1. unmarshal both 为 map[string]any                       │
  │     2. deepMergeStringMap(oldMap, newMap):                     │
  │        • 旧 key "region" 在 newMap 缺失 → 用旧值 cn-hangzhou   │
  │        • 旧 key "endpoint" 缺失 → 用旧值                      │
  │        • 旧 key "bucket" 在 newMap 有 "new-bucket" → 用新值   │
  │     3. secret 字段额外:                                       │
  │        • newMap["accessKeyId"] = "AK****1234" → isRedacted   │
  │            → 回退 oldMap["accessKeyId"] = "AKIAOLD123456"    │
  │        • newMap["secretAccessKey"] = "sk****abcd" → isRedacted│
  │            → 回退 oldMap["secretAccessKey"] = "super-secret-old"│
  │     4. JSON null:遵循"等同缺失"规则,不覆盖旧值              │
  │                                                               │
  │     → merged JSON = {                                         │
  │         "bucket": "new-bucket",          // 真正改了           │
  │         "region": "cn-hangzhou",         // 旧值保留           │
  │         "endpoint": "https://oss-...",   // 旧值保留           │
  │         "accessKeyId": "AKIAOLD123456",  // secret 回退        │
  │         "secretAccessKey": "super-secret-old"                 │
  │       }                                                       │
  │                                                               │
  │ c. repo.Update(ctx, 3, {Name, ProviderType, merged, ...})     │
  │     repo 内 requireEncryption(merged) → enc:v1:xxxx 落库      │
  │                                                               │
  │ d. invalidator.InvalidateProvider(3)                          │
  │     → mediaSvc.storeCache 删 key=3 → 下次 Upload 重建 client │
  └───────────────────────────────────────────────────────────────┘
```

**事故修复故事:** 这条链是 PR #647 批次 2 修的;批次 2 之前 `mergeProviderConfigJSON` 只 merge `secretKeyFields` 列表里的字段,**非 secret 字段一律跟随 newPayload** —— 上面例子里 `region/endpoint` 会被擦掉,导致 OSS 客户端启动时找不到 endpoint。生产已经触发过一次"换 bucket 名后整个 OSS 客户端连不上"的故障。

---

## 5. mergeProviderConfigJSON 全规则

> 源代码:`storage_provider_service.go:485-517`
> 测试:`storage_provider_service_test.go:11-181`(13 个测试用例)

### 5.1 字段类型分桶

| 桶 | 处理 | 说明 |
| --- | --- | --- |
| **secret 字段** | 单独 second pass | accessKeyId / secretAccessKey / accessKey / secretKey / password / token / apiKey / api_key / secret |
| **顶层非 secret** | deepMergeStringMap 一层 | 缺失 / null 回退旧值;`map[string]any` 嵌套递归一层 |
| **嵌套 map** | 同上递归一层 | 例 `options:{addressingStyle, virtualHost}` |
| **非 map 嵌套(数组等)** | 整体覆盖 | 不递归 |

### 5.2 secret 字段判定规则

| newVal 状态 | 行为 |
| --- | --- |
| 缺失(map 没有这个 key) | 回退 oldVal |
| 空字符串 `""` | 回退 oldVal |
| 脱敏占位 `****` 或 `[2 char]****[4 char]` | 回退 oldVal |
| 真实新值(不是脱敏占位) | **覆盖** oldVal |

`isRedactedValue`(`service.go:551`)只匹配 `redactProviderConfigJSON` 实际生成的两种形态 —— 防"任意包含 `****` 的真实 secret 被误判保留"。

### 5.3 null 等同缺失(PR #647 修复)

`deepMergeStringMap`(`service.go:529-546`)在判 `present || newVal != nil`:

```go
newVal, present := newMap[k]
if !present || newVal == nil {
    newMap[k] = oldVal
    continue
}
```

`json.Unmarshal` 把 `"region":null` 解析为 `present=true, newVal=nil`,这里把它等同"缺失"处理,与文档承诺一致。

### 5.4 测试覆盖矩阵

| 测试名 | 验证 |
| --- | --- |
| `TestMergeProviderConfigJSON_KeepsSecretWhenRedacted` | 脱敏占位回退旧值 |
| `_OverwritesWhenNewExplicit` | 真实新值覆盖 |
| `_KeepsOldWhenEmptyNew` | 空字符串回退 |
| `_KeepsOldWhenFieldMissing` | 缺失回退 |
| `_DeepMergeNonSecretField` | bucket 改了,region/endpoint 保留 |
| `_DeepMergeNestedOptions` | 嵌套一层合并 |
| `_OverwriteWhenBothPresent` | 双方都明确写时新值覆盖 |
| `_NullPreservesOldValue` | 顶层 null 等同缺失 |
| `_NullInsideNestedOptions` | 嵌套 null 等同缺失 |
| `TestIsRedactedValue` | 7 个边界 case |
| `TestRedactProviderConfigJSON_HidesSecrets` | redact 出口测试 |

---

## 6. 加密落库(cryptkey.Keystore)

> 源:`internal/pkg/cryptkey/keystore.go` + `fernet.go` + `internal/repository/storage_provider_repo.go:18-64`

### 6.1 启动模式

| `AI_CREDENTIAL_ENCRYPTION_KEYS` env | Keystore 状态 | 写库 | 读库 |
| --- | --- | --- | --- |
| 空 / 未设置 | `enabled=false`(透传) | 明文 | 明文 |
| 单个 key | enabled,单 fernet | enc:v1:xxxx | 解密 |
| 多 key 逗号分隔 | enabled,MultiFernet | 用 **第一个** key 加密 | 任一 key 能解出即可 |
| 任一 key 解析失败 | 启动报错中止 | n/a | n/a |

### 6.2 落库格式

```
config_json = "enc:v1:gAAAAAB......="  (Fernet token,带 "enc:v1:" 前缀)
```

`requireEncryption`(`storage_provider_repo.go:76`)在 Create/Update 边界拒绝接收**已经带前缀**的 JSON 串 —— 防止上层错误地重复加密。

### 6.3 容错策略

`decryptConfig`(`storage_provider_repo.go:55`)解密失败时:
- 不阻塞列表加载
- log warning
- **返回原始 stored 字符串**(密文)给上层 → admin 在 UI 看到乱码 → 手动修复

设计动机:一行坏数据不能让整个 storage_providers 列表加载失败。

### 6.4 Legacy 迁移

`MigrateLegacyToEncrypted`(`storage_provider_repo.go:219`)在 server.go 启动时调用一次(`server.go:288`):

```go
// 启动时自动把 legacy 明文 storage_providers.config_json 加密重写
// (AI_CREDENTIAL_ENCRYPTION_KEYS 未配置时这是 no-op,所以 dev 环境不受影响)。
if migrated, total, err := storageProviderRepo.MigrateLegacyToEncrypted(...); err != nil {
    log.Warn().Err(err).Msg("storage_providers legacy encryption migration failed")
}
```

幂等:已加密的行因 `EncryptString` 检测到前缀直接返回原值,跳过。

---

## 7. SSRF 防御(S3 endpoint)

> 源:`internal/pkg/storage/s3.go:32-77` `validateEndpoint` / `parseEndpoint`

| 检查项 | 拦截 |
| --- | --- |
| 空 endpoint | 放行(走 AWS 默认) |
| scheme | 必须 `http` 或 `https` |
| Hostname | 必须有 |
| DNS resolve | `net.LookupIP(host)` |
| IP 范围检查 | 拒绝 loopback / private / link-local / unspecified / 169.254.169.254(IMDS) / IPv4 broadcast |

**绕过条件:** `isTrustedProviderEndpoint`(`s3.go:223`)中的 host 完全匹配 COS/OSS/R2/AWS S3 的官方域名时跳过 DNS 校验 —— 离线 / 单元测试环境也能起 client。

**已知盲点:** DNS rebinding 攻击需要网络层封堵作为纵深防御 —— 此函数只在**创建客户端时**做一次 resolve,不在运行时重查。

---

## 8. Phase 5:云端浏览 + 反向导入

> 路由前缀: `/api/v1/admin/storage/providers/:id/objects` 与 `/import`、`DELETE /objects`

### 8.1 ListObjects(`service.go:150`)

```
GET /providers/3/objects?prefix=2026/05/&token=&limit=100

调用链:
  StorageProviderService.ListObjects
    → openStorage(p)         // 不走 mediaSvc cache,新建 client
    → lister, ok := st.(storage.Lister)  // LOCAL/S3 都实现
    → lister.List(ctx, prefix, token, limit)
    → lookupCatalog(ctx, providerID, keys)  // 一次 SQL 反查 media_files
    → 标记每条 IN_CATALOG / ORPHAN

返回:
{
  "objects": [
    {"key":"2026/05/x.jpg", "size":1234, "lastModified":"...", "status":"IN_CATALOG", "mediaFileId":42},
    {"key":"2026/05/orphan.png", "size":5678, "status":"ORPHAN"}
  ],
  "nextToken": "..."
}
```

### 8.2 ImportObjects(`service.go:210`)

把云端"孤儿对象"(catalog 里没有的 key)写回 `media_files`:

1. 校验 keys 不为空(`max=200` per call);
2. lookupCatalog 跳过已存在;
3. 对每个孤儿 key:
   - `headObject` 取 size / mime / exists;
   - 不存在或失败 → skip(进 `skipped` 列表);
   - 调 `repo.InsertImportedMedia`(`storage_provider_repo.go:310`)写一条 `media_files`,**uploader_id 取当前 admin**,`storage_provider_id = providerID`,`cdn_url = st.GetURL(key)`。
4. 不走 `MediaService.Upload` —— 避免触发 folder 校验 / MIME 白名单 / 缩略图生成等业务逻辑。

### 8.3 DeleteObjects(`service.go:261`)

删云端 ORPHAN:

- 安全约束:`existing := lookupCatalog` 中的 key 拒绝删除 —— 必须走 `media` 删除路径(否则破坏 catalog 一致性);
- 失败的 key 记入 `refusedKeys`。

---

## 9. 数据库表 + 字段 + 索引

### 9.1 `storage_providers`(migration 000009 + 000042)

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| `id` | BIGSERIAL PK | |
| `name` | VARCHAR(100) NOT NULL UNIQUE | UI 显示名 |
| `provider_type` | VARCHAR(20) NOT NULL | CHECK ∈ {LOCAL, S3, MINIO, OSS, COS, **R2**}(R2 由 042 加入) |
| `config_json` | TEXT NOT NULL | 加密后 `enc:v1:xxxx` 形态(legacy 行可能是明文) |
| `is_default` | BOOLEAN default false | 同时只能一行为 true(SetDefault 走事务) |
| `is_enabled` | BOOLEAN default true | |
| `priority` | INT default 0 | 数值越小越优先,目前实际只用 default 标志 |
| `created_at` / `updated_at` | TIMESTAMP | |

**索引:**
- `idx_storage_providers_default` (is_default)
- `idx_storage_providers_enabled` (is_enabled)

### 9.2 LOCAL Provider config_json 形态

```json
{
  "basePath": "./uploads",
  "urlPrefix": "/uploads"
}
```

注意:实际 server.go 用的是 hardcoded `/api/uploads`(`server.go:282`),`urlPrefix` 字段在 `openStorage` 路径才被读(`storage_provider_service.go:316`)。**未启动时配的 `urlPrefix` 无效**。

### 9.3 S3 Provider config_json 形态

完整字段见 `internal/pkg/storage/s3.go:80-103`:

```json
{
  "bucket": "my-bucket",
  "region": "cn-hangzhou",
  "endpoint": "",
  "accessKeyId": "AK...",
  "secretAccessKey": "...",
  "urlPrefix": "https://cdn.example.com",
  "path": "media/",
  "customUrl": "https://images.example.com",
  "options": "?variant=public",
  "allowPrivateEndpoint": false,
  "forcePathStyle": false
}
```

| 字段 | 用途 |
| --- | --- |
| `bucket` | 必需 |
| `region` | 区域 |
| `endpoint` | 留空走默认;MINIO/R2 必填 |
| `accessKeyId` / `secretAccessKey` | 凭据,加密落库 + 列表脱敏 |
| `urlPrefix` | CDN URL 前缀,优先级低于 `customUrl` |
| `path` | 对象 key 根前缀,如 `assets/` |
| `customUrl` | 自定义图床域名,优先于 `urlPrefix` |
| `options` | 追加 query string,如 `?variant=public` |
| `allowPrivateEndpoint` | 允许 MINIO 用内网 endpoint(SSRF 校验跳过) |
| `forcePathStyle` | MINIO 必须 true,使用 path-style URL |

---

## 10. 配置 / 环境变量

| 变量 | 默认 | 影响 |
| --- | --- | --- |
| `AI_CREDENTIAL_ENCRYPTION_KEYS`(env) | 空 | 启用 cryptkey;名字虽含 `AI_`,但储存 provider 与 AI 模块共用同一 keystore 单例 |
| `multipartThreshold` 常量 | 16 MB | `s3.go:22`,小于走 PutObject |
| `multipartPartSize` 常量 | 8 MB | `s3.go:23`,multipart 单片大小 |
| `multipartConcurrency` 常量 | 4 | `s3.go:24`,multipart 并发 |
| `s3.go:351` `validateS3Key` 长度上限 | 1024 | S3 key 最大长度 |

**没有 .env 项**:Provider 配置全部通过 admin UI 写库,不走环境变量。

---

## 11. 与其他模块耦合

| 模块 | 关系 |
| --- | --- |
| **MediaService**(§01) | `mediaSvc` 通过 `StorageProviderInvalidator` 接口被 service.Update/Delete/SetDefault 调用清缓存 |
| **SyncService**(§05) | 用 `mediaSvc.resolveStore` 拿源/目标 client;target_provider_id 必须非 LOCAL |
| **AI 模块** | 共用 `cryptkey.Keystore`(`AI_CREDENTIAL_ENCRYPTION_KEYS`),AI provider 的 secret 也走同样路径 |
| **post / Agent** | 不直接接触 storage_providers |
| **Admin UI Settings** | StorageProviderSettings 表单触发 PUT 时利用 `redactProviderConfigJSON` 出口 + `mergeProviderConfigJSON` 入口 |

---

## 12. 已知限制

1. **删除 Provider 不清理 catalog 中的 `media_files.storage_provider_id`** — `ON DELETE SET NULL` 让记录变孤儿,文件还在云上,无清理工具。
2. **`Test` 端点对 LOCAL 直返成功** — 不实际写一个临时文件验证 basePath 可写,容易误判。
3. **migration 000042 之前** `provider_type IN ('LOCAL', 'S3', 'MINIO', 'OSS', 'COS')` 不含 R2,但 `factory.go` 一直接受 R2 字符串 → admin 创建 R2 provider 必失败,DB violates check constraint。042 修复。
4. **Legacy 解密失败的行被静默 fallback 到密文** — admin 看到乱码 secret,但前端没明确提示"该行加密失败",需要看后端日志。
5. **`Test`(HeadBucket)需要 access key 已经写入 client** — 如果 admin 在 UI 中"先存配置不带凭据 → 再点 Test",连接失败信息可能不够直观(不会说"缺凭据")。
6. **Phase 5 `ListObjects` 不走缓存** — 每次新建 S3 client(`service.go:300` `openStorage` 注释)。低频管理操作可接受,但同时打开多个 admin 标签页频繁刷会创建多个 client。
7. **secretKeyFields 列表硬编码** — 新增厂商若有别的 secret 字段名(如 `subscription_token`)默认不脱敏,需要手动加进去。
8. **Test 端点对非 S3 / LOCAL 的 provider** 返回固定的 "存储配置有效" — 未实际验证(因为 factory 只支持 S3 系)。

---

## 13. 测试覆盖说明

`storage_provider_service_test.go` 196 行,覆盖:

| 测试 | 数量 |
| --- | --- |
| `TestMergeProviderConfigJSON_*` | 9 个用例 |
| `TestIsRedactedValue` | 7 个边界 |
| `TestRedactProviderConfigJSON_HidesSecrets` | 1 |

**未覆盖:**
- `applyProviderDefaults` 的 5 厂商分支
- `validateEndpoint` SSRF 防御(单测会触发真实 DNS)
- `validateS3Key` 边界(`/foo`、`..`、超长)
- `S3Storage.Upload` 单 PUT vs multipart 切换
- `MigrateLegacyToEncrypted` 启动迁移
- `ListObjects` / `ImportObjects` / `DeleteObjects`
- `cryptkey.Keystore` 集成(单元测试在 `internal/pkg/cryptkey/fernet_test.go`)
