# Previous Findings & Audit Progress

> **此文件是审计续接锚点**。跨会话审计时，每个会话结束前必须更新这里；
> 下次会话开始时必须先读取这里才能开始新一轮审计，避免重复审计或漏审。

**最后更新**: {YYYY-MM-DD HH:mm}
**审计状态**: 未开始 / 进行中 ({阶段}) / 已完成
**源报告**: `docs/qa/security-audit-report-{YYYY-MM-DD}.md`

---

## 0. 初始化模板说明（首次使用请删除本节）

首次运行 `/security-audit` 时：
1. 依次执行 SKILL.md 的六个阶段
2. 阶段一完成后填入下方 §3 的 `FILE_INVENTORY`
3. 每发现一个漏洞立刻追加到 §1 对应等级表格
4. 每完成一个文件的审计，在 §2 对应模块下标 ✅
5. 会话结束前更新 §4（进度）与 §5（交接备注）

---

## 1. 已发现漏洞清单

> 按严重等级分表。VULN-ID 全局连续递增。新发现**追加**到已有列表末尾，不重新编号。

### 🔴 CRITICAL ({N} 项)

| VULN-ID | 标题 | 模块 | 文件 | OWASP | 等保 | 状态 |
|---------|------|------|------|-------|------|------|
| VULN-001 | {如：OrderMapper SQL 注入 `${}`} | dao-module | `dao-module/src/main/resources/mapper/OrderMapper.xml:42` | A03 | 8.1.4.2 | 未修复 |
| VULN-002 | {如：Log4j2 2.14.1 Log4Shell} | boot-module | `pom.xml:78` | A06 | 8.1.4.4 | 未修复 |
| ... | | | | | | |

### 🟠 HIGH ({N} 项)

| VULN-ID | 标题 | 模块 | 文件 | OWASP | 等保 | 状态 |
|---------|------|------|------|-------|------|------|
| VULN-00X | ... | ... | ... | ... | ... | ... |

### 🟡 MEDIUM ({N} 项)

| VULN-ID | 标题 | 模块 | 文件 | OWASP | 等保 | 状态 |
|---------|------|------|------|-------|------|------|
| VULN-00X | ... | ... | ... | ... | ... | ... |

### 🔵 LOW ({N} 项)

| VULN-ID | 标题 | 模块 | 文件 | OWASP | 等保 | 状态 |
|---------|------|------|------|-------|------|------|
| VULN-00X | ... | ... | ... | ... | ... | ... |

### ℹ️ INFO ({N} 项)

| VULN-ID | 标题 | 模块 | 文件 | 说明 |
|---------|------|------|------|------|
| VULN-00X | ... | ... | ... | ... |

---

## 2. 已审计文件清单

> 每个模块独立统计。审计完成的文件标 ✅ + 发现数。部分审计标 🟡 + 范围说明。未开始标 ❌。

### Java 后端

#### api-module ({已审计}/{总数})
- ✅ `api-module/src/main/java/com/example/api/controller/OrderController.java` (完整, 2 findings)
- 🟡 `api-module/src/main/java/com/example/api/filter/AuthFilter.java` (前 150 行, 0 findings)
- ❌ `api-module/src/main/java/com/example/api/controller/UserController.java`

#### service-module ({已审计}/{总数})
- ❌ （待审计）

#### dao-module ({已审计}/{总数})
- ✅ `dao-module/src/main/resources/mapper/OrderMapper.xml` (完整, 3 findings)
- ❌ `dao-module/src/main/resources/mapper/UserMapper.xml`

#### common-module ({已审计}/{总数})
- ❌

#### websocket-module ({已审计}/{总数})
- ❌

#### mq-module ({已审计}/{总数})
- ❌

#### boot-module ({已审计}/{总数})
- ❌

### C++ 服务 ({已审计}/{总数})
- ❌ `cpp-worker/src/main.cpp`
- ❌ `cpp-worker/src/rpc/http_client.cpp`
- ❌ `cpp-worker/src/mq/consumer.cpp`
- ❌ `cpp-worker/src/mq/producer.cpp`

### Vue 2 前端 ({已审计}/{总数})
- ❌ `web-admin/src/views/login/index.vue`
- ❌ `web-admin/src/api/user.js`
- ❌ `web-admin/src/store/modules/user.js`
- ❌ `web-admin/src/router/index.js`
- ❌ `web-admin/src/utils/request.js`

### 基础设施 ({已审计}/{总数})
- ❌ `docker-compose.yml`
- ❌ `docker-compose.prod.yml`
- ❌ `Dockerfile`
- ❌ `nginx/nginx.conf`
- ❌ `rabbitmq/definitions.json`
- ❌ `redis/redis.conf`
- ❌ `postgres/pg_hba.conf`

### 配置文件 ({已审计}/{总数})
- ❌ `boot-module/src/main/resources/application.yml`
- ❌ `boot-module/src/main/resources/application-prod.yml`
- ❌ `boot-module/src/main/resources/application-dm.yml` (达梦 profile)

---

## 3. 文件清单 (FILE_INVENTORY)

> 阶段一的输出。总文件数是覆盖率分母。

| 模块 | 技术栈 | 总文件数 | 已审计 | 覆盖率 |
|------|--------|---------|--------|--------|
| api-module | Spring MVC | {N} | {N} | {%} |
| service-module | Spring / MyBatis | {N} | {N} | {%} |
| dao-module | MyBatis XML | {N} | {N} | {%} |
| common-module | Java Util | {N} | {N} | {%} |
| websocket-module | Spring STOMP | {N} | {N} | {%} |
| mq-module | Spring AMQP | {N} | {N} | {%} |
| boot-module | Spring Boot | {N} | {N} | {%} |
| cpp-worker | C++17 / CMake | {N} | {N} | {%} |
| web-admin | Vue 2 / Element UI | {N} | {N} | {%} |
| 基础设施 | Docker / Nginx / MQ / Redis / PG | {N} | {N} | {%} |
| **合计** | | **{N}** | **{N}** | **{%}** |

---

## 4. 审计进度

### 4.1 阶段进度
| 阶段 | 状态 | 会话 | 完成时间 |
|------|------|------|---------|
| 阶段一 范围界定 | 已完成 / 进行中 / 未开始 | session-{N} | {YYYY-MM-DD} |
| 阶段二 快速扫描 | ... | ... | ... |
| 阶段三 深度审计 | 进行中（api/service 已完成，dao/ws/mq 进行中） | session-{N} | - |
| 阶段四 基础设施 & 合规 | 未开始 | - | - |
| 阶段五 报告生成 | 未开始 | - | - |
| 阶段六 质量校验 | 未开始 | - | - |

### 4.2 合规维度进度
| 维度 | 进度 |
|------|------|
| OWASP Top 10 | A01 {%} / A02 {%} / A03 {%} / A04 {%} / A05 {%} / A06 {%} / A07 {%} / A08 {%} / A09 {%} / A10 {%} |
| 等保 2.0 三级 | 8.1.2 {%} / 8.1.3 {%} / 8.1.4 {%} / 8.1.5 {%} |
| 信创适配 | 数据库 {%} / OS {%} / CPU {%} / 国密 {%} / 中间件 {%} |

---

## 5. 会话交接备注

> 每个会话结束前记录。格式：日期 + 本轮成果 + 下轮起点 + 阻塞项。

### 2026-XX-XX session-1 结束
- **本轮成果**:
  - 完成阶段一：FILE_INVENTORY 建立，总计 {N} 源文件
  - 完成阶段二：扫描出候选风险点 {N} 处
  - 阶段三深度审计覆盖 api-module 全部 + dao-module 50%
- **下轮起点**: dao-module 剩余 mapper XML + service-module
- **阻塞项**:
  - cpp-worker 无 CMakeLists.txt 注释，需向 C++ 团队确认依赖版本（OpenSSL/libcurl/rabbitmq-c）
  - 达梦 profile 配置文件仅在运维机器，未在代码仓库
- **已确认可跳过**:
  - `test/` 目录（排除范围）
  - 自动生成代码 `mybatis-generator/target/`

### 2026-XX-XX session-2 结束
- **本轮成果**: ...
- **下轮起点**: ...
- **阻塞项**: ...

---

## 6. 未审计高优先级文件清单

> 按 SKILL.md §3.1 Priority 1 的顺序列出剩余待审文件。

### Java 后端（安全关键路径）
- ❌ `api-module/.../LoginController.java`（**P1 必审**）
- ❌ `api-module/.../filter/JwtAuthenticationFilter.java`（**P1 必审**）
- ❌ `boot-module/.../config/SecurityConfig.java`（**P1 必审**）
- ❌ `boot-module/.../config/CorsConfig.java`（**P1 必审**）
- ❌ `common-module/.../crypto/JwtUtil.java`（**P1 必审**）
- ❌ `common-module/.../crypto/AesUtil.java`（**P1 必审**）
- ❌ `dao-module/src/main/resources/mapper/UserMapper.xml`（**P1 必审**）
- ❌ `mq-module/.../OrderMessageListener.java`（**P1 必审**）
- ❌ `mq-module/.../config/RabbitMqConfig.java`（**P1 必审**）
- ❌ `websocket-module/.../WebSocketHandler.java`（**P1 必审**）
- ❌ `websocket-module/.../config/WebSocketConfig.java`（**P1 必审**）
- ... （补全业务模块控制器）

### C++ 服务
- ❌ `cpp-worker/src/rpc/http_client.cpp`（**P1 必审** — 是否校验 CA 证书？）
- ❌ `cpp-worker/src/mq/consumer.cpp`（**P1 必审** — 消息反序列化安全？）
- ❌ `cpp-worker/src/mq/producer.cpp`（**P1 必审** — 签名/加密？）
- ❌ `cpp-worker/src/protocol/parser.cpp`（**P1 必审** — 缓冲区溢出？）
- ❌ `cpp-worker/CMakeLists.txt`（**P1 必审** — 依赖版本 / 编译选项）

### Vue 2 前端
- ❌ `web-admin/src/views/login/index.vue`（**P1 必审**）
- ❌ `web-admin/src/utils/request.js`（**P1 必审** — axios 拦截器）
- ❌ `web-admin/src/store/modules/user.js`（**P1 必审** — Vuex token 存储）
- ❌ `web-admin/src/permission.js`（**P1 必审** — 路由守卫）
- ❌ `web-admin/src/views/system/User.vue`（**P1 必审** — 含 v-html？）

### 基础设施（全部必审）
- ❌ `docker-compose.prod.yml`
- ❌ `Dockerfile`
- ❌ `nginx/nginx.conf`
- ❌ `rabbitmq/definitions.json`
- ❌ `redis/redis.conf`
- ❌ `postgres/pg_hba.conf`
- ❌ `boot-module/src/main/resources/application-prod.yml`
