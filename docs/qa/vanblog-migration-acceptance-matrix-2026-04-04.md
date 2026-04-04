# Vanblog数据迁移验收测试矩阵
> 创建日期：2026-04-04

## 测试范围
`apps/admin/src/pages/MigrationPage.tsx` + `POST /v1/admin/vanblog/import`

核心文件：
- `apps/admin/src/pages/MigrationPage.tsx` - 迁移页面（文件上传/dry-run/execute）
- `apps/admin/src/services/postService.ts` - `importVanBlog()` 方法
- `apps/server-go/internal/handler/` - Vanblog 导入处理器
- `apps/server-go/migrations/` - 相关数据库迁移文件

## 1. 导入功能测试
| 用例 | 操作 | 预期结果 | 状态 |
|------|------|---------|------|
| 上传Vanblog导出文件 | 选择JSON文件上传 | 文件解析成功，预览导入数量 | - |
| Dry-run 预览 | 上传文件后点击"Dry-run" | 返回将导入的文章数、分类数、标签数，不写入数据库 | - |
| 执行正式导入 | 在 dry-run 后点击"正式导入" | 文章逐一写入，保留原始分类/标签，toast 提示成功 | - |
| 字段映射验证 | 导入后查看文章详情 | `source_key` 记录原始ID，`legacy_visited_count` 保留访问数 | - |
| 重复导入防护 | 同一文件导入两次 | `source_key` 唯一约束防止重复，返回已跳过数量 | - |
| 导入后文章可见性 | 检查 `is_hidden` 字段 | 默认 false，文章在管理后台可见 | - |

## 2. 数据完整性验证
| 字段 | 预期映射 | 验证方法 |
|------|---------|---------|
| `source_key` | Vanblog 原始文章 ID | `SELECT source_key FROM posts WHERE source_key IS NOT NULL` |
| `legacy_author_name` | 原作者名 | 查询 posts 表对应字段 |
| `legacy_visited_count` | 原访问计数 | 查询 posts 表对应字段 |
| `legacy_copyright` | 版权信息字符串 | 查询 posts 表对应字段 |
| `title` | 标题正确映射 | 在管理后台文章列表验证 |
| `content` | Markdown 正文完整 | 打开文章编辑页验证内容 |
| `slug` | URL 别名（可自动生成） | 博客前台访问 `/posts/:slug` |
| `categories` | 分类关联正确 | 管理后台分类筛选验证 |
| `tags` | 标签关联正确 | 管理后台标签筛选验证 |
| `created_at` | 保留原始创建时间 | 查询 posts 表 `created_at` 字段 |

## 3. 错误场景测试
| 用例 | 操作 | 预期结果 | 状态 |
|------|------|---------|------|
| 未选择文件直接导入 | 不上传文件点击按钮 | Toast 提示"请先选择 VanBlog 导出 JSON 文件" | - |
| 非JSON文件 | 上传 .txt 或 .csv 文件 | 文件选择框拒绝（accept 限制）或解析失败提示 | - |
| 格式错误的JSON | 上传不符合Vanblog格式的JSON | 返回可读的解析错误信息，不崩溃 | - |
| 后端服务不可用 | 停止 server-go 后执行导入 | Toast 显示"导入失败"，页面不崩溃 | - |
| 超大文件 | 上传超过限制的 JSON 文件 | 显示文件大小限制提示 | - |

## 4. UI/UX 体验测试
| 用例 | 操作 | 预期结果 | 状态 |
|------|------|---------|------|
| 导入中防重复提交 | 导入执行中再次点击按钮 | 按钮禁用，loading 状态显示"分析中..."或"导入中..." | - |
| 导入结果展示 | 导入成功后 | 显示导入统计（成功数/跳过数/失败数） | - |
| 重置操作 | 导入完成后重新选择文件 | 可正常选择新文件并重新执行 | - |

## 5. 本地验证命令
```bash
# 前端构建
pnpm --filter @aetherblog/admin build

# 后端测试
cd apps/server-go
go test ./internal/handler/... -v -run TestVanblogImport
go test ./internal/service/... -v -run TestVanblogImport
```

## 6. 抽样校验 SQL
```sql
-- 确认 source_key 有值
SELECT COUNT(*) FROM posts WHERE source_key IS NOT NULL;

-- 确认无重复 source_key
SELECT source_key, COUNT(*) FROM posts
WHERE source_key IS NOT NULL
GROUP BY source_key
HAVING COUNT(*) > 1;

-- 验证 legacy 字段回填情况
SELECT
  SUM(CASE WHEN legacy_visited_count IS NULL THEN 1 ELSE 0 END) AS visited_null,
  SUM(CASE WHEN legacy_author_name IS NULL THEN 1 ELSE 0 END) AS author_null
FROM posts
WHERE source_key IS NOT NULL;
```
