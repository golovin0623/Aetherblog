# Blog 详情页编辑跳转与 Markdown 发布前验证报告

> 对应 issues：`BDA-010 / BDA-020 / BDA-030 / BDA-040 / BDA-050 / BDA-060`  
> 执行日期：2026-02-12

## 1) 自动化检查

### 1.1 命令与结果

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `pnpm --filter @aetherblog/blog exec tsc --noEmit` | ✅ 通过 | 类型检查通过 |
| `pnpm --filter @aetherblog/blog lint` | ✅ 通过（含既有 warning） | 无新增 error，存在历史 warning |
| `pnpm --filter @aetherblog/blog build` | ✅ 通过（含既有 warning） | 编译通过；静态生成阶段出现历史 `fetch failed (EPERM)` 噪声，但未导致构建失败 |

### 1.2 既有 warning 清单（非本次引入）

1. `@next/next/no-img-element`（多个文件）
2. `react-hooks/exhaustive-deps`（`CommentSection.tsx`）
3. `@next/next/no-page-custom-font`（`layout.tsx`）
4. `@next/next/no-html-link-for-pages`（`page.tsx`）

## 2) 手工回归清单（执行版）

> 本次在当前 CLI 环境无法启动真实浏览器进行端到端可视化回归，以下清单已沉淀为可直接执行步骤。

### 2.1 详情页编辑跳转

- [ ] 打开任意 3 篇文章详情页，点击“编辑此文”，确认命中 `/posts/:id/edit` 且 id 一致
- [ ] 已登录后台态：应直接进入编辑页
- [ ] 未登录后台态：应进入后台登录链路（不应 404/跳错域）
- [ ] `NEXT_PUBLIC_ADMIN_URL` 分别配置为 `/admin/`、`http://localhost:5173`、`https://admin.example.com/base` 验证均可跳转
- [ ] `NEXT_PUBLIC_ADMIN_URL` 为空与非法协议（如 `javascript:`）时，入口应降级为不可用态

### 2.2 Markdown 渲染能力

- [ ] 访问 `/posts/__markdown_audit__`，按 `docs/blog-markdown-regression-sample.md` 的 M-01~M-10 项逐项验收
- [ ] 亮/暗主题切换下，heading 锚点、表格滚动、脚注跳转、任务列表样式行为一致
- [ ] 代码块复制在桌面/移动端均有“成功/失败”反馈，禁用 clipboard 时有可见失败提示
- [ ] Mermaid 与错误公式场景均呈现统一“渲染失败”错误态

## 3) 风险输出

| 风险级别 | 描述 | 影响范围 | 建议 |
| --- | --- | --- | --- |
| Medium | Markdown 仍启用 `rehype-raw`，HTML 透传依赖上游内容可信边界 | 详情页渲染链路 | 后续评估增加白名单 sanitize 或发布前内容审核策略 |
| Medium | 部分回归依赖真实浏览器环境，当前仅完成代码/构建级验证 | 编辑跳转与 Markdown 交互 | 发布前按本报告手工清单完成 PC+移动验收并归档截图 |
| Low | 入口行为改为显式依赖 `NEXT_PUBLIC_ADMIN_URL` 配置 | 管理后台入口 | 在部署文档中保留配置说明并检查环境变量 |

## 4) 结论

1. 自动化基线（lint/type-check/build）均通过，且无新增阻塞错误。
2. 本次实现范围内的关键能力已落盘并可通过 `/posts/__markdown_audit__` 集中回归。
3. 发布前需完成真实浏览器手工回归（PC + 至少 1 种移动设备）并记录证据。
