---
name: bug-fix-pipeline
description: 面向 Java 企业栈（Spring Boot + Maven 多模块 + MyBatis + Vue 2 + C++ 混合服务 + RabbitMQ + WebSocket + PostgreSQL/达梦 + Redis）的批量 bug 分诊→计划→修复→验证工作流。当用户提供 bug 清单、安全审计报告、等保整改单、QA 缺陷列表、SonarQube/SpotBugs/Checkstyle 报告时使用此 skill。触发场景："根据这份报告修复"、"按清单逐项处理"、"批量修复"、"走查并修复"、"整改等保问题"，或用户打开 docs/qa/、reports/audit/ 下的审计报告并要求处理。
---

# Bug Fix Pipeline — Java 企业级批量修复工作流

将一份 bug 清单（安全审计报告、等保整改单、QA 缺陷列表、静态扫描结果等）转化为系统化的修复过程。
**核心理念：先全量评估，再统一计划，最后按 Maven 模块边界并行执行。**
不允许"边看边改、一个一个来"，那样会遗漏关联 bug、重复修改同一 mapper、修复方向彼此冲突。

---

## 技术栈前置声明

此 skill 假设项目具备以下结构（若差异较大请先调整本文件中的命令与路径）：

```
project-root/
├── pom.xml                              # parent pom
├── api-module/                          # REST controller + DTO
├── service-module/                      # 业务逻辑 + 事务
├── dao-module/                          # MyBatis mapper + XML
├── common-module/                       # 工具类、常量、异常
├── websocket-module/                    # WebSocket / STOMP endpoint
├── mq-module/                           # RabbitMQ producer/consumer
├── boot-module/                         # Spring Boot 启动 + 配置
├── cpp-worker/                          # C++ 计算/协议服务（CMake）
│   ├── CMakeLists.txt
│   └── src/
└── web-admin/                           # Vue 2 + Element UI + Vuex
    ├── src/
    └── package.json
```

C++ 角色：**混合模式** —— 既做 RabbitMQ 生产者/消费者与 Java 互补，又作为 HTTP 客户端调 Java REST 接口。故审计/修复必须双向考虑：Java→C++ 的消息 schema、C++→Java 的 HTTP 调用与鉴权。

---

## 阶段零：输入识别

1. 用户提供的 bug 清单通常是 Markdown / Excel / SonarQube 导出 JSON。识别每个 bug 条目。
2. 提取关键字段：**编号、标题、严重等级、模块归属（api/service/dao/cpp-worker/web-admin）、涉及文件（含行号）、根因描述、建议修复方案**。
3. 若为等保整改单，额外提取：**等保条款编号（如 8.1.4.3）、测评结论（符合/部分符合/不符合）、整改期限**。
4. 若为信创适配报告，额外提取：**目标环境（达梦 DM8 / 人大金仓 KingbaseES / 麒麟 V10）、兼容性问题类型（SQL 方言 / JDBC 驱动 / 加密算法）**。
5. 统计总数，向用户确认理解无误后进入阶段一。

如果文件过大（> 256KB）或是 Excel/JSON，分段读取或先用 Bash 转成 Markdown，确保所有条目都被识别。

---

## 阶段一：全量分诊 (Triage)

**目标**：为每个 bug 做出"是否需要修复"的判断。不允许跳过判断。

对每一个 bug，评估：

| 判定 | 条件 | 说明 |
|------|------|------|
| **FIX** | 存在真实风险、代码缺陷、合规不符 | 需要编写修复计划 |
| **SKIP** | 风险可接受 / 已有补偿控制 / 误报 / 不在本次范围 | 记录理由，**要写明补偿控制或误报证据** |
| **DEFER** | 需要跨模块重构、DB 迁移、外部依赖升级，不适合批量修复 | 记录原因、前置条件、责任人、计划迭代 |

### 输出物

在 bug 清单所在目录下创建 `fix-plans/` 子目录，生成 `master-checklist.md`：

```markdown
# Fix Master Checklist

**总计**: 38 项 | **FIX**: 27 | **SKIP**: 6 | **DEFER**: 5
**生成时间**: 2026-04-17
**源报告**: docs/qa/security-audit-2026-04-10.md

| # | Bug ID | Severity | Priority | Module | Triage | Fix Plan | Reason |
|---|--------|----------|----------|--------|--------|----------|--------|
| 1 | SEC-001 | CRITICAL | P0 | dao | FIX | [plan](./sec-001-sql-injection-order-query.md) | MyBatis ${} 直接拼接 |
| 2 | SEC-002 | HIGH | P0 | boot | FIX | [plan](./sec-002-log4j2-cve.md) | Log4j 2.14 < 2.17.1 (Log4Shell) |
| 3 | SEC-003 | MEDIUM | P2 | web-admin | FIX | [plan](./sec-003-xss-v-html.md) | v-html 渲染用户输入 |
| 4 | SEC-004 | LOW | - | cpp-worker | SKIP | - | strncpy 已限长，补偿控制存在 |
| 5 | SEC-005 | HIGH | P1 | dao | DEFER | - | 达梦适配需 SQL 方言层重构，纳入 v2.1 迭代 |
| ... |
```

**优先级划分（企业语境）**：

| 优先级 | 定义 | 时限 |
|-------|------|------|
| **P0** | CRITICAL / 可直接利用的 HIGH / 等保不符合项 / 阻断上线 | 24h 内 |
| **P1** | HIGH / 影响面广的 MEDIUM / 等保部分符合项 | 3 工作日 |
| **P2** | MEDIUM / 单一模块局部问题 | 本迭代内（≤2 周） |
| **P3** | LOW / INFO / 代码质量改进 | 下一迭代 |

分诊结果必须覆盖 100% 的条目，不允许遗漏。

---

## 阶段二：修复计划 (Fix Plans)

为每个标记为 FIX 的 bug 创建独立的修复计划文件。

### 计划文件模板

```markdown
# SEC-001: OrderMapper.xml 存在 SQL 注入

**Severity**: CRITICAL | **Priority**: P0 | **Complexity**: Low
**Module**: dao-module | **CWE**: CWE-89 | **等保**: 8.1.3.3 (访问控制-SQL注入防护)

## Problem
`dao-module/src/main/resources/mapper/OrderMapper.xml:42-48` 使用 `${orderStatus}` 直接
拼接用户传入的查询条件，绕过 PreparedStatement，存在 SQL 注入风险。

## Root Cause
MyBatis `${}` 是字符串替换（等价于 JDBC Statement），`#{}` 才是参数化绑定
（等价于 PreparedStatement）。历史代码为了让 order by 字段动态化而误用 `${}`。

## Changes Required

### File 1: `dao-module/src/main/resources/mapper/OrderMapper.xml`
- 将 `WHERE status = '${orderStatus}'` 改为 `WHERE status = #{orderStatus}`
- 若确需动态字段（order by column），改用 `<if test>` + 白名单枚举判断

### File 2: `service-module/src/main/java/.../OrderService.java`
- 在入参边界加 `@Pattern(regexp = "^[A-Z_]{1,20}$")` 校验 orderStatus 取值
- 添加单元测试 `OrderServiceTest#testQueryWithMaliciousStatus` 断言注入尝试被拒绝

### File 3: `api-module/.../OrderController.java`
- 接口方法参数补 `@Valid`

## Verification
1. `mvn -pl dao-module,service-module,api-module -am test` 通过
2. 启动后执行: `curl "http://localhost:8080/api/orders?status=' OR 1=1--"` 应返回 400
3. SonarQube 复扫 SEC-001 规则标记为 resolved
4. 核对 OrderMapper 其他 8 个 `${}` 位置（见关联条目 SEC-011..SEC-018）

## Related
SEC-011, SEC-012, SEC-013 均为同一根因，已并入本计划的 "File 1" 扩展清单。
```

### 代码验证（强制）

在写修复计划时，**必须先读取实际代码**确认问题存在：

```bash
# Java mapper
rg -n --type xml '\$\{' dao-module/src/main/resources/mapper/
# Java controller 参数
rg -n '@RequestParam|@PathVariable|@RequestBody' api-module/src/main/java/
# C++ 不安全函数
rg -n 'strcpy|strcat|sprintf[^_]|gets\(' cpp-worker/src/
# Vue 2 危险渲染
rg -n 'v-html|v-bind:innerHTML' web-admin/src/
```

审计报告中的行号可能已过时（代码 rebase 后偏移）。实际代码与报告描述不符时，在计划中**标注差异**并用当前行号替换。

### 合并相关修复

多个 bug 指向同一文件或同一根因（例："全部 mapper 的 `${}` 注入"、"全部 controller 缺 `@Valid`"、"全部 feign 调用缺超时"），合并到同一个计划文件，避免修改冲突。

---

## 阶段三：执行修复 (Fix Execution)

**前置条件**：所有 FIX 条目的计划文件已创建并通过用户确认。

### 批次划分

按优先级从高到低执行：P0 → P1 → P2 → P3。

### 按 Maven 模块边界并行

Maven 多模块是天然的修复并行边界。同时最多 **3 个** 并行 Agent，每个 Agent 独占一个模块：

```
Agent A → dao-module (mapper XML + PO)
Agent B → service-module (@PreAuthorize + 事务)
Agent C → cpp-worker (C++ 内存安全)
```

**禁止**两个 Agent 同时修改：
- 同一 Maven module
- 同一 Vue 2 src/views 子目录
- parent pom（版本升级必须串行）
- common-module（全局工具/常量，变更牵一发动全身）

Agent prompt 必须包含：
1. 完整的问题描述和上下文（直接粘贴计划文件全文）
2. 受影响的具体文件路径和修改方案
3. **不允许 Agent 自行扩展修改范围**（禁止顺手重构、禁止补无关注释）
4. 运行哪些命令验证（模块级 mvn test）

### 批次间验证门（Quality Gates）

每完成一个批次（约 5 个修复），**必须**依次通过以下门：

| 门 | 命令 | 通过标准 |
|----|------|---------|
| G1. 编译 | `mvn clean compile -T 1C` | 0 错误 |
| G2. 单测 | `mvn -pl <改动模块> -am test` | 全绿 + 新增用例覆盖修复点 |
| G3. 集成测试 | `mvn -pl boot-module verify -DskipITs=false` | 全绿（含 Testcontainers PG+Redis+RabbitMQ） |
| G4. 静态扫描 | `mvn spotbugs:check checkstyle:check pmd:check` | 不引入新 HIGH 级别问题 |
| G5. 前端构建 | `cd web-admin && npm run lint && npm run build` | 0 error，新的 warning ≤ 5 |
| G6. C++ 构建 | `cd cpp-worker && cmake --build build && ctest --output-on-failure` | 全绿 |
| G7. C++ 静态 | `clang-tidy -p cpp-worker/build cpp-worker/src/**/*.cpp` | 不引入新警告 |
| G8. Diff 审查 | `git diff --stat` | 改动文件数符合计划预期，无意外文件 |

**任一门失败 → 立即停下，定位根因，不进入下一批次。**

批次完成后更新 `master-checklist.md`，将已完成条目的 Triage 列标记为 `DONE`，追加 commit 哈希。

### 上下文交接（防止丢失进度）

每处理 **10 个计划** 或 **修复 5 个 bug** 后，执行上下文交接：

1. 更新 `master-checklist.md` 的进度列
2. 在 checklist 底部的 **Context Handoff Log** 中记录：

```markdown
## Context Handoff Log

### 2026-04-17 14:32 — Batch 3 complete
- 完成: SEC-001, SEC-011 ~ SEC-015 (mapper SQL 注入批)
- 下一轮: SEC-020 起 (C++ 内存安全批，agent C 接手 cpp-worker)
- 阻塞: 无
- 已知风险: SEC-023 (RabbitMQ 消息签名) 涉及 Java↔C++ 双端协议变更，
  需先与 cpp-worker 组确认 Protobuf schema 版本兼容策略
- 当前 HEAD: abc1234 (fix/batch-3-sql-injection)
```

3. 输出简要进度摘要给用户

这确保即使会话被压缩，也能通过读取 checklist 恢复进度。

---

## 阶段四：验证与核查 (Verification)

每个修复完成后：

1. **代码层**：所有 8 道门（G1-G8）全绿
2. **逻辑层**：根据修复计划中的 Verification 步骤逐条检查
3. **回归层**：
   - Spring Boot：`@SpringBootTest` + Testcontainers 覆盖 PG/Redis/RabbitMQ 交互
   - 前端：手动在 dev 环境操作对应页面的 golden path
   - C++：ASAN/UBSAN 版本跑一遍 `ctest`
4. **契约层**（若改了 Java↔C++ 接口或 MQ schema）：
   - 双端协议文档（Protobuf .proto / AsyncAPI YAML）同步更新
   - `cpp-worker/tests/integration/` 的 MQ/HTTP 对接测试通过
5. **Diff 审查**：检查 Agent 是否引入了多余的变更（无关 import、格式化噪音、注释污染）

如果发现 Agent 的修复引入了新问题（如多余代码块、不该修改的文件、误改测试断言），**立即回滚并重新修复**。不要带伤进入下一批。

### 等保/信创专项验证

| 类型 | 验证方法 |
|------|---------|
| 等保 8.1.2 身份鉴别 | 登录失败 5 次锁定 30 分钟，密码 12 位含大小写数字符号 |
| 等保 8.1.3 访问控制 | 三员分立：超管、安管、审计员账户分离，互不可兼 |
| 等保 8.1.4 安全审计 | 审计日志覆盖登录/授权变更/数据导出，保留 ≥ 180 天 |
| 信创 SQL 方言 | 在达梦 DM8 / 人大金仓 KingbaseES 上跑集成测试，不能依赖 PG 特有函数 |
| 信创 JDBC 驱动 | 驱动类名从 `org.postgresql.Driver` → `dm.jdbc.driver.DmDriver` / `com.kingbase8.Driver` 可通过 profile 切换 |
| 信创 国密 | 敏感字段使用 SM4 加密、接口签名使用 SM2，哈希使用 SM3 |

---

## 阶段五：收尾 (Wrap-up)

1. 更新 `master-checklist.md`，标记所有 DONE 条目
2. 输出最终统计：

```markdown
## Fix Summary

- **总计**: 38 条 | **修复**: 27 | **跳过**: 6 | **延后**: 5
- **涉及模块**: dao, service, api, web-admin, cpp-worker, boot
- **文件变更**: 42 个，+856 / -234 行
- **新增测试**: 19 个单测 + 6 个集成测试
- **Quality Gates**: G1-G8 全绿
- **等保对齐**: 8.1.2/8.1.3/8.1.4 全部符合
- **信创兼容**: 达梦 DM8 / 麒麟 V10 集成测试通过
```

3. 列出所有 DEFER 条目及其前置条件、建议迭代、责任人，供用户后续处理
4. **所有变更未提交**，以 patch 形式等待用户审查（除非用户明确授权提交）
5. 若本轮修复涉及 API/MQ schema 变更，生成**升级说明文档** (`docs/upgrade/from-v{old}-to-v{new}.md`)

---

## 关键原则

### 不要急于修复
先理解全貌，再动手。全量分诊 + 全量计划完成后才开始写代码。
企业代码库动辄数十万行、百余个模块，提前修复会导致：
- 遗漏关联 bug（同一 mapper 的 10 处 `${}` 只改了 1 处）
- 重复修改同一文件（Agent A 和 Agent B 都动了 `OrderMapper.xml`）
- 修复方向与整体不一致（同类问题 A 用白名单、B 用转义）

### 验证实际代码
报告中的代码片段、行号、甚至文件路径可能已过时（代码 rebase、重命名、拆包）。
修复前必须用 `rg` 或 Read 工具读取**当前代码**确认问题。

### 控制修改范围
只修报告中提到的问题。不要顺手重构、不要添加注释、不要"改进"周边代码。
Agent 的修复如果超出计划范围（例如顺手把 Lombok 换成手写 getter），回滚多余部分。
在 Java 企业代码中，超范围改动极易引发意外：
- 破坏历史兼容（反射调用、动态代理、MQ 消息类序列化）
- 触发未预期的 `@Transactional` 传播行为
- 改变 Spring Bean 创建顺序

### 保持可追溯
每个修复都能追溯到：**哪个 bug → 哪个计划文件 → 哪个 commit → 哪个 Quality Gate 报告**。
`master-checklist.md` 是唯一的 source of truth。

### 优雅降级到 DEFER
如果某个修复复杂度超出预期（需要数据库迁移、跨模块重构、外部系统协议变更），
标记为 DEFER 而不是强行修复。在 checklist 中记录：
- 根因描述
- 前置条件（需要哪些准备工作）
- 建议迭代与责任人
- 临时补偿控制（如 WAF 规则、限流、功能降级）

### Java↔C++ 双端修复的协同
当修复涉及 Java 和 C++ 两端（MQ 消息 schema、HTTP 接口字段），遵循：
1. **先定协议** → 更新 Protobuf `.proto` 或 AsyncAPI YAML
2. **先改消费方**（兼容新旧两版）→ 再改生产方（只发新版）
3. **灰度期不少于 2 个发布周期**
4. checklist 中这类 bug 标注 `[双端]` 前缀

### 等保/合规修复的凭证留存
等保整改的每一项修复必须留存**测评可见的凭证**：
- 代码变更截图 / commit 链接
- 配置变更前后对比
- 整改后的复测记录（日志、截图、测评工具输出）

凭证归档到 `docs/audit/compliance-evidence/{年月}/SEC-XXX/`，不要只依赖 git 历史。
