# Security Audit - 全栈安全审计与漏洞报告

## Description
对 AetherBlog 全栈代码库执行白盒安全审计，按 OWASP Top 10 2021 分类，输出 CVSS 3.1 评分的漏洞报告。

## Trigger
/security-audit

## Quality Gates
- 报告字数 ≥ 50,000 字
- 代码覆盖率 ≥ 98%（源文件审计数/总源文件数）
- OWASP Top 10 每个类别均有分析
- 每个 CRITICAL/HIGH 漏洞含可运行的修复代码

## Instructions

用户输入 `/security-audit` 或涉及安全审计时，严格按以下 6 阶段执行。

---

### 阶段一：范围界定与文件清单 (Scope & Inventory)

**目标**: 枚举所有待审计源文件，建立覆盖率基线。

1. **文件发现** — 使用 Explore 子代理并行扫描各模块：
   ```
   Go 后端:     apps/server-go/internal/**/*.go + cmd/**/*.go
   Python AI:   apps/ai-service/app/**/*.py
   Admin 前端:  apps/admin/src/**/*.{ts,tsx}
   Blog 前端:   apps/blog/app/**/*.{ts,tsx}
   共享包:      packages/*/src/**/*.{ts,tsx}
   基础设施:    nginx/*.conf, docker-compose*.yml, Dockerfile*, env.example
   ```
2. **排除规则**: 排除 `node_modules/`, `*_test.go`, `tests/`, `__pycache__/`, `*.d.ts`, `*.config.*` (保留 next.config.ts)
3. **输出**: 建立 `FILE_INVENTORY` 表（模块 | 文件路径 | 审计状态 | 发现数）

---

### 阶段二：高风险快速扫描 (Quick-Win Scanning)

**目标**: 用 grep/regex 快速发现高风险模式。

并行执行以下搜索（每个搜索独立，可同时进行）：

| 搜索目标 | 模式 | 风险等级 |
|----------|------|---------|
| XSS 向量 | `dangerouslySetInnerHTML\|innerHTML\|v-html\|eval(` | CRITICAL |
| SQL 注入 | `fmt.Sprintf.*SELECT\|fmt.Sprintf.*INSERT\|string concat.*query` | CRITICAL |
| 命令注入 | `exec.Command\|os.system\|subprocess` | CRITICAL |
| 硬编码密钥 | `password.*=.*['\"]\|secret.*=.*['\"]\|apikey\|api_key` | HIGH |
| 路径穿越 | `\.\.\/\|path.Join.*Param\|os.Open.*user` | HIGH |
| SSRF | `http.Get.*Param\|requests.get.*user\|fetch.*user` | HIGH |
| 不安全反序列化 | `JSON.parse\|pickle.load\|yaml.load` | MEDIUM |
| 信息泄露 | `console.log\|fmt.Print\|print(.*token\|print(.*secret` | LOW |

---

### 阶段三：深度代码审计 (Deep Code Review)

**目标**: 逐文件审计，按优先级分层。

**Priority 1 — 安全关键路径** (必审):
- 认证 & 授权: `auth_handler.go`, `jwt.go`, `jwtutil.go`, `authStore.ts`, `api/deps.py`, `core/jwt.py`
- 输入处理: 所有 handler 中的 `c.Param()`, `c.QueryParam()`, `c.Bind()`
- 数据渲染: `MarkdownRenderer.tsx`, `MarkdownPreview.tsx`, 所有 `dangerouslySetInnerHTML`
- 文件操作: `media_handler.go`, `media_service.go`, `storage/local.go`, `storage/s3.go`
- 配置 & 密钥: `config.go`, `config.py`, `.env`, `docker-compose*.yml`

**Priority 2 — 业务逻辑** (必审):
- 所有 repository 文件的 SQL 构建
- 所有 service 文件的权限检查
- AI 代理流量（SSE 转发、provider 配置）
- 前端 API 客户端（token 处理、错误暴露）

**Priority 3 — 辅助代码** (抽样审计):
- 工具类、格式化函数、纯 UI 组件
- 每个模块至少抽样 50%

**每个文件审计检查项**:
- [ ] 输入验证（类型、长度、格式、白名单）
- [ ] 输出编码（HTML 转义、SQL 参数化、命令转义）
- [ ] 认证检查（是否需要登录、角色校验）
- [ ] 授权检查（是否检查资源归属）
- [ ] 错误处理（是否泄露内部信息）
- [ ] 日志记录（是否记录安全事件）
- [ ] 密钥管理（是否硬编码、是否安全存储）

---

### 阶段四：基础设施审计 (Infrastructure Review)

1. **Docker 安全**: 
   - 基础镜像版本、非 root 用户、多阶段构建
   - 敏感挂载（socket, /etc）、特权模式
   - 密钥注入方式（环境变量 vs secrets）
2. **Nginx 安全**:
   - 安全响应头（CSP, HSTS, X-Frame-Options）
   - 上传限制、超时配置
   - 路由暴露面（内部服务是否可从外部访问）
3. **数据库安全**:
   - 连接加密（SSL mode）
   - 认证方式、密码强度
   - 权限最小化
4. **依赖安全**:
   - Go: `go.mod` 已知 CVE
   - Python: `requirements.txt` 已知 CVE
   - Node: `package.json` 已知 CVE
   - 建议集成 `snyk`/`trivy`/`govulncheck`

---

### 阶段五：报告生成 (Report Generation)

**输出路径**: `docs/qa/security-audit-report-{YYYY-MM-DD}.md`

**报告结构** (参照 `references/report-template.md`):
1. Executive Summary（管理层摘要）
2. 审计范围与方法论
3. 漏洞统计仪表板
4. OWASP Top 10 逐类分析
5. 详细漏洞清单（每个漏洞 500-2000 字）
6. 代码覆盖率矩阵
7. 修复优先级路线图
8. 附录（工具、参考、术语）

**FINDING 格式**:
```markdown
### FINDING-{NNN}: {标题}

| 属性 | 值 |
|------|-----|
| 严重等级 | CRITICAL / HIGH / MEDIUM / LOW |
| CVSS 3.1 | {向量字符串} → {分数} |
| OWASP | A0X: {类别名} |
| CWE | CWE-{ID}: {名称} |
| 文件 | `{路径}:{行号}` |

**描述**: ...
**攻击向量**: ...
**影响**: ...
**漏洞代码**:
\`\`\`{lang}
// 当前代码
\`\`\`
**修复方案**:
\`\`\`{lang}
// 修复后代码
\`\`\`
**验证步骤**: ...
```

---

### 阶段六：质量校验 (Quality Validation)

1. **字数检查**: `wc -w docs/qa/security-audit-report-*.md` ≥ 50,000
2. **覆盖率验证**: 已审计文件数 / 总源文件数 ≥ 98%
3. **OWASP 完整性**: 10 个类别均有分析
4. **修复代码质量**: CRITICAL/HIGH 修复代码可编译/可运行
5. **如未达标**: 标记差距，继续补充审计直到达标

---

## 续接说明

如果审计跨多个会话执行：
1. 每个会话结束前更新 `references/previous-findings.md`
2. 下次会话开始时读取该文件恢复上下文
3. 用 FILE_INVENTORY 表跟踪哪些文件已审计
4. 新发现追加到已有列表，编号连续递增

## 参考文件
- `references/report-template.md` — 报告模板
- `references/previous-findings.md` — 历史发现与审计进度
