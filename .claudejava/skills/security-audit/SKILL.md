---
name: security-audit
description: 面向 Java 企业栈（Spring Boot + Maven 多模块 + MyBatis + Vue 2 + C++ 混合服务 + RabbitMQ + WebSocket + PostgreSQL/达梦 + Redis）的全栈白盒安全审计。按 OWASP Top 10 2021 + 等保 2.0 三级 + 信创适配三维度，输出 CVSS 3.1 评分的漏洞报告。触发：用户输入 /security-audit、"做一次安全审计"、"等保整改前摸底"、"信创迁移安全核查"。
---

# Security Audit — Java 企业级全栈安全审计

对 Java 企业项目执行白盒安全审计，覆盖 Java 后端、C++ 服务、Vue 2 前端、中间件、基础设施与合规框架。

---

## 技术栈前置声明

此 skill 面向如下目标栈：

| 层 | 技术 |
|----|------|
| 后端 | Java 8/11/17、Spring Boot 2.x (或 3.x)、Spring Security、MyBatis (含 MyBatis-Plus)、Maven 多模块 |
| 消息 | RabbitMQ (Spring AMQP)、WebSocket (Spring STOMP 或 Java-WebSocket) |
| 存储 | PostgreSQL / 达梦 DM8 / 人大金仓 KingbaseES、Redis (Jedis/Lettuce/Redisson) |
| C++ | 混合模式 —— 既 RabbitMQ 生产/消费，又作为 HTTP 客户端调 Java REST，CMake 构建 |
| 前端 | Vue 2 + JavaScript + Element UI + Vuex + Vue Router + webpack/vue-cli |
| 基础设施 | Docker / docker-compose、Nginx、CI/CD (Jenkins/GitLab CI) |
| 合规 | OWASP Top 10 2021 + 等保 2.0 三级 + 信创适配（麒麟/统信/国密 SM2/SM3/SM4） |

---

## 质量门 (Quality Gates)

以下标准必须全部达到，否则审计不合格需继续补充：

| 门 | 标准 |
|----|------|
| G1 字数 | 报告正文 ≥ 60,000 字（Java 栈规模更大，基线高于 TS 栈） |
| G2 覆盖率 | 已审计源文件数 / 总源文件数 ≥ 95% |
| G3 OWASP | Top 10 每个类别均有独立分析 |
| G4 等保 | 2.0 三级 8.1.1 ~ 8.1.10 每个控制项有对齐结论 |
| G5 信创 | 数据库方言兼容 / JDBC 驱动 / 国密算法 / 操作系统 四项均有结论 |
| G6 可行修复 | 每个 CRITICAL / HIGH 漏洞提供**可编译运行**的 Java/C++/Vue 修复代码 |
| G7 证据链 | 每条 FINDING 含：漏洞代码片段、攻击向量、修复代码、验证步骤 |

---

## 阶段一：范围界定与文件清单 (Scope & Inventory)

**目标**：枚举所有待审计源文件，建立覆盖率基线。

### 1.1 文件发现（并行 Explore 子代理扫描）

```
Java 后端:
  api-module/src/main/java/**/*.java
  service-module/src/main/java/**/*.java
  dao-module/src/main/java/**/*.java
  dao-module/src/main/resources/mapper/**/*.xml     ← MyBatis XML
  common-module/src/main/java/**/*.java
  websocket-module/src/main/java/**/*.java
  mq-module/src/main/java/**/*.java
  boot-module/src/main/java/**/*.java
  boot-module/src/main/resources/application*.yml    ← 配置
  boot-module/src/main/resources/application*.properties
  **/src/main/resources/bootstrap*.yml               ← Nacos/Apollo

C++ 服务:
  cpp-worker/src/**/*.{cpp,cc,cxx,h,hpp}
  cpp-worker/CMakeLists.txt
  cpp-worker/cmake/*.cmake
  cpp-worker/conanfile.txt 或 vcpkg.json            ← 依赖清单

Vue 2 前端:
  web-admin/src/**/*.{js,vue}
  web-admin/src/api/*.js                            ← axios 封装
  web-admin/src/store/**/*.js                       ← Vuex
  web-admin/src/router/index.js
  web-admin/src/utils/*.js
  web-admin/package.json
  web-admin/vue.config.js

基础设施:
  Dockerfile*, docker-compose*.yml, .dockerignore
  nginx/*.conf
  rabbitmq/definitions.json, rabbitmq/rabbitmq.conf
  redis/redis.conf
  postgres/pg_hba.conf, postgres/postgresql.conf
  .env.example, .env.production (仅模板，不应入库真密钥)
  Jenkinsfile, .gitlab-ci.yml, .github/workflows/*.yml

依赖清单:
  pom.xml (parent + 所有 module)
  web-admin/package-lock.json
```

### 1.2 排除规则

- `target/`, `build/`, `node_modules/`, `dist/`, `.mvn/`
- `**/*Test.java`, `**/test/**` (但 test 配置文件要审，例如 `application-test.yml` 是否含密钥)
- `**/*.d.ts`, `**/generated/`
- 第三方库源码

### 1.3 输出

建立 `FILE_INVENTORY` 表：

| 模块 | 文件数 | 已审计 | 发现数 | 状态 |
|------|--------|--------|--------|------|
| api-module | 42 | 0 | 0 | 待审 |
| service-module | 78 | 0 | 0 | 待审 |
| ... | | | | |

---

## 阶段二：高风险快速扫描 (Quick-Win Scanning)

**目标**：用 `rg`/正则快速发现高风险模式，覆盖三种语言与多种中间件。

### 2.1 Java 侧高危模式

| 搜索目标 | 模式 | 风险等级 | 说明 |
|---------|------|---------|------|
| MyBatis SQL 注入 | `\$\{` in `**/mapper/**/*.xml`、`@Select.*\$\{` | CRITICAL | `${}` 是拼接，`#{}` 才是参数化 |
| JDBC 拼接 | `Statement\b.*execute.*\+`、`createStatement\(\)` | CRITICAL | 应用 PreparedStatement |
| 命令注入 | `Runtime\.getRuntime\(\)\.exec`、`ProcessBuilder\(.*\+` | CRITICAL | 用户输入拼进命令 |
| 反序列化 | `ObjectInputStream\|readObject\|enableDefaultTyping\|JSON\.parseObject\(.*Object\.class\|XStream\.fromXML\|new Yaml\(\)\.load` | CRITICAL | Jackson / fastjson / XStream / SnakeYAML |
| JNDI 注入 | `InitialContext\|lookup\(` + 用户输入、`javax\.naming` | CRITICAL | Log4Shell 类 |
| Log4j2 版本 | `<log4j-core>.*2\.(0|1[0-6])` in pom.xml | CRITICAL | < 2.17.1 存在 Log4Shell / CVE-2021-45105 |
| SpEL 注入 | `SpelExpressionParser\|parseExpression\(.*param\|@Value\(.*#\{` + user | HIGH | Spring EL 动态执行 |
| XXE | `DocumentBuilderFactory\.newInstance\(\)` 后未 `setFeature.*FEATURE_SECURE_PROCESSING` | HIGH | XML 外部实体 |
| SSRF | `RestTemplate\|WebClient\|HttpClient`.*`param\|request\.getParameter` | HIGH | 用户 URL 直接请求 |
| 路径穿越 | `new File\(.*param\|Paths\.get\(.*param\|Files\.(read\|write).*param` | HIGH | 未做规范化+白名单 |
| 开放重定向 | `sendRedirect\(.*param\|return "redirect:" ?\+` | MEDIUM | 钓鱼跳板 |
| 硬编码密钥 | `(?i)(password\|secret\|apikey\|api_key\|token)\s*=\s*["'][^"']{6,}["']` in `*.java`/`*.yml`/`*.properties` | HIGH | |
| MD5/SHA1 | `MessageDigest\.getInstance\("(MD5\|SHA-?1)"\)` | MEDIUM | 弱哈希 |
| DES/RC4/ECB | `Cipher\.getInstance\("(DES\|RC4\|.*ECB)` | HIGH | 弱加密 / 可预测 |
| 弱随机 | `\bnew Random\(\)` + 安全场景、`Math\.random\(\)` | MEDIUM | 应用 SecureRandom |
| CSRF 禁用 | `\.csrf\(\)\.disable\(\)` | HIGH | 记录是否有补偿（Token/SameSite） |
| @PreAuthorize 缺 | controller 类无 `@PreAuthorize\|@Secured` 注解的 `@RequestMapping` | HIGH | 需逐个 handler 校验 |
| Actuator 全暴露 | `management\.endpoints\.web\.exposure\.include\s*=\s*\*` | HIGH | |
| Swagger 生产 | `@EnableSwagger2\|springdoc.*api-docs.enabled.*true` + prod profile | MEDIUM | |
| H2 Console | `spring\.h2\.console\.enabled=true` | HIGH | |
| Druid 监控 | `StatViewServlet` 未配 loginUsername/loginPassword | HIGH | |

### 2.2 C++ 侧高危模式

| 搜索目标 | 模式 | 风险等级 |
|---------|------|---------|
| 不安全 C 函数 | `\b(strcpy\|strcat\|sprintf[^_]\|gets\|scanf\("%s)` | CRITICAL |
| 格式串注入 | `printf\([^"]*\bparam\|fprintf\([^"]*\bvar` | HIGH |
| 原生指针手动管理 | `\bnew \b.*;` 同作用域无对应 `delete\|unique_ptr\|shared_ptr` | MEDIUM |
| vector 越界 | `\.operator\[\]\|\[.*param` (应用 `.at()`) | MEDIUM |
| 整数溢出 | `size_t .* \* .*param` 无范围检查 | HIGH |
| 线程安全 | `static .*;` 无 mutex 保护、`pthread_create` 无 detach/join | MEDIUM |
| 不安全随机 | `\brand\(\)` | LOW |
| 硬编码密钥 | 同 Java 规则，范围 `cpp-worker/**` | HIGH |

### 2.3 Vue 2 前端高危模式

| 搜索目标 | 模式 | 风险等级 |
|---------|------|---------|
| XSS v-html | `v-html\s*=` | CRITICAL |
| innerHTML | `\.innerHTML\s*=` | CRITICAL |
| eval/Function | `\beval\(\|new Function\(` | CRITICAL |
| 路由 query 直渲 | `\$route\.query\..*` 在 template 中直出 | HIGH |
| localStorage 存 token | `localStorage\.setItem\(.*(token\|jwt\|password)` | MEDIUM |
| 硬编码 API 地址 | `http://[^"'\s]+\.(com\|cn)` | LOW |
| document.write | `document\.write` | HIGH |
| target=_blank 无 noopener | `target=["']_blank["'][^>]*` 无 `rel=["'][^"']*noopener` | MEDIUM |
| axios 无拦截 token | `axios\.create` 未注册 request 拦截器校验 | LOW |

### 2.4 中间件配置高危模式

| 搜索目标 | 文件/模式 | 风险等级 |
|---------|---------|---------|
| RabbitMQ guest 账号 | `guest:guest\|default_user\s*=\s*guest` in rabbitmq.conf/definitions.json | HIGH |
| RabbitMQ 无 TLS | 启动参数无 `listeners.ssl` | MEDIUM |
| Redis 无密码 | `redis\.conf` 无 `requirepass` 或为空 | HIGH |
| Redis 危险命令 | 无 `rename-command FLUSHALL ""`/`CONFIG`/`EVAL` | MEDIUM |
| PG SSL 关闭 | `sslmode=disable` in application.yml | MEDIUM |
| PG pg_hba trust | `trust` 认证方式 | HIGH |
| Nginx 无安全头 | 无 `add_header X-Frame-Options\|CSP\|HSTS` | MEDIUM |
| Nginx 超大 body | `client_max_body_size.*[0-9]+[Gg]` | MEDIUM |
| Docker socket 挂载 | `/var/run/docker\.sock` in compose/run | CRITICAL |
| Docker root | 无 `USER` 指令（非 root 用户） | MEDIUM |
| 特权容器 | `privileged:\s*true` in compose | HIGH |

并行执行上述所有搜索，每一类独立产出 "候选清单"，供阶段三深度复核。

---

## 阶段三：深度代码审计 (Deep Code Review)

**目标**：逐文件审计，按优先级分层。

### 3.1 Priority 1 — 安全关键路径 (必审)

| 类别 | 代表文件 |
|------|---------|
| 认证 & 授权 | `*SecurityConfig.java`、`*AuthenticationFilter.java`、`JwtUtil.java`、`*PermissionAspect.java`、`LoginController.java`、前端 `permission.js`/`router/index.js` |
| 输入边界 | 所有 `@RestController` / `@Controller` 方法参数、`@RequestParam`/`@PathVariable`/`@RequestBody`、WebSocket 的 `@MessageMapping` |
| 数据访问 | 所有 `**/mapper/*Mapper.xml`、`*Mapper.java` 含 `@Select/@Update`、`JdbcTemplate` 用法 |
| 文件操作 | `FileUpload*.java`、`FileDownload*.java`、`*.upload/`、`MultipartFile` 处理 |
| 反序列化 | `ObjectInputStream`、Jackson `ObjectMapper` 配置、fastjson `ParserConfig`、MQ 消息反序列化 |
| 配置 & 密钥 | `application*.yml/properties`、Nacos/Apollo 配置、`bootstrap.yml`、环境变量注入 |
| 密码学 | `*Crypto*.java`、`*Encrypt*.java`、密码哈希、JWT 签名、国密 SM2/SM3/SM4 实现 |
| MQ 边界 | `@RabbitListener` 消费者、`RabbitTemplate` 发送者、消息反序列化、DLX 配置 |
| WS 边界 | `@ServerEndpoint`、`WebSocketConfigurer`、`ChannelInterceptor`、Origin 校验 |
| C++ 通信 | cpp-worker 的 AMQP 消费者、HTTP 客户端、协议解析入口 |

### 3.2 Priority 2 — 业务逻辑 (必审)

- 所有 `@Service` 的权限检查（**水平越权**：service 方法是否校验资源归属；**垂直越权**：管理员接口是否校验角色）
- 所有 mapper 的 SQL 构建（含 `<if test>`、`<foreach>`、`<choose>` 分支）
- Feign/RestTemplate 调用链（超时、重试、熔断、认证头传递）
- 前端 `src/api/*.js` 的接口封装、token 透传、错误信息回显
- Vuex store 的敏感数据存储（是否把 token/个人信息持久化到 localStorage）

### 3.3 Priority 3 — 辅助代码 (抽样 ≥ 50%)

- 工具类 (`*Util.java`)、常量类、DTO、VO
- 纯展示组件 (`components/*.vue`)
- 配置加载器

### 3.4 每个文件的审计检查项

- [ ] 输入验证（Bean Validation `@NotNull/@Pattern/@Size`、自定义校验器、类型收窄）
- [ ] 输出编码（HTML 转义 / SQL 参数化 / 命令参数化 / LDAP 转义 / XPath 转义）
- [ ] 认证检查（Spring Security、`@PreAuthorize`、JWT 验签、会话校验）
- [ ] 授权检查（资源归属校验 —— 是否 `resource.ownerId == currentUser.id`）
- [ ] 错误处理（`@ControllerAdvice`、`@ExceptionHandler` 不泄露堆栈、PostgreSQL 报错不回显）
- [ ] 日志记录（关键安全事件：登录、授权变更、敏感数据访问；脱敏手机号/身份证/卡号）
- [ ] 密钥管理（不硬编码、优先 Nacos/Apollo/Vault、环境变量次之）
- [ ] 事务边界（`@Transactional` 传播、异常回滚、只读标记）
- [ ] 并发安全（共享可变状态、ThreadLocal 泄漏、`@Async` 上下文传递）
- [ ] 资源释放（try-with-resources、Connection/Statement/ResultSet、InputStream）

### 3.5 C++ 专项检查

- [ ] 内存安全：无 raw `new/delete`，统一 smart pointer
- [ ] 缓冲区：所有 `char[]` 拷贝有边界检查，禁用 `strcpy/strcat/sprintf/gets`
- [ ] 整数：`size_t` 乘法前检查溢出（`SIZE_MAX / a >= b`）
- [ ] 异常：RAII 保证资源释放；noexcept 正确标注
- [ ] 并发：mutex 覆盖所有共享可变访问；无数据竞争
- [ ] MQ 消费：消息反序列化失败进入 DLX，不崩溃进程
- [ ] HTTP 客户端：连接超时 / 读超时 / 最大重试限制；CA 证书校验打开
- [ ] 日志：不打印敏感字段；不用 `printf(user_input)` 避免格式串攻击
- [ ] 依赖：conanfile.txt / vcpkg.json 中版本无已知 CVE（OpenSSL/libcurl/protobuf）

### 3.6 MyBatis 专项检查

- [ ] 所有 XML 中 `${}` 用法需有白名单枚举保护（只允许字段名/排序方向）
- [ ] `<foreach collection>` 有上限（避免超大 IN 导致 DoS）
- [ ] `<if test>` 条件使用 OGNL，避免 OGNL 注入（`test="property != null and property == 'x'"` 中 property 勿来自用户）
- [ ] 动态表名场景使用 `@SqlParser` / 插件，不直接拼接
- [ ] 分页：PageHelper / MyBatis-Plus 分页插件，避免 `LIMIT ${offset}`

---

## 阶段四：基础设施与合规审计 (Infra & Compliance Review)

### 4.1 Docker 安全
- 基础镜像：是否使用有漏洞的 `centos:7`、`openjdk:8`（应使用 `eclipse-temurin:17-jre-alpine` 等）
- 非 root 用户：`USER appuser`
- 多阶段构建：减少攻击面
- 敏感挂载：`/var/run/docker.sock`、`/etc`、`/proc` 必须禁止
- 特权模式：`privileged: true` / `cap_add: SYS_ADMIN` 禁止
- 密钥注入：优先 `docker secret`，其次环境变量，禁止 `COPY .env /app`

### 4.2 Nginx 安全
- 安全响应头：CSP、HSTS、X-Frame-Options、X-Content-Type-Options、Referrer-Policy
- 上传限制：`client_max_body_size` ≤ 100M（除非业务必要）
- 超时：`proxy_read_timeout`、`keepalive_timeout` 合理
- 路由暴露：内部服务（actuator、druid、swagger）不应对外暴露
- TLS：仅 TLSv1.2+、`ssl_ciphers` 排除弱套件

### 4.3 RabbitMQ 安全
- 默认 `guest/guest` 必须删除
- 强密码 + Vhost 隔离 + 细粒度权限
- 启用 TLS（AMQPS over 5671）
- 管控面 15672 不对外暴露
- 队列声明：`durable=true`、`auto-delete=false`（生产）、DLX 绑定
- 消息：mandatory + confirm 模式、消费端 manual ack

### 4.4 Redis 安全
- `requirepass` 强密码
- 禁用危险命令：`rename-command FLUSHALL ""`、`CONFIG`、`EVAL`、`DEBUG`
- 启用 TLS（6380）
- 端口不对外暴露
- 序列化：避免 JDK 原生反序列化，使用 Jackson/Protostuff

### 4.5 PostgreSQL / 达梦 / 人大金仓 安全
- `pg_hba.conf` 使用 `scram-sha-256`，禁 `trust`
- `ssl = on`，`ssl_cert_file/ssl_key_file` 配置
- 应用账户非 superuser，权限按表/列最小化
- 行级安全 (RLS) 对多租户场景启用
- 审计插件：PG `pgaudit`、达梦 `V$AUDITLOGS`
- 连接池 (HikariCP) `leak-detection-threshold` 开启

### 4.6 依赖安全（SCA）
- Maven: `mvn dependency-check:check`（OWASP Dependency-Check）、`mvn versions:display-dependency-updates`
- 前端: `npm audit --production`
- C++: conan/vcpkg 依赖的 OpenSSL/curl/protobuf 版本对比 CVE
- 重点盯防：Log4j2 < 2.17.1、Spring4Shell (CVE-2022-22965)、fastjson 1.2.x autotype、SnakeYAML < 2.0、Jackson < 2.14.x

### 4.7 等保 2.0 三级对齐（必测）

| 控制项 | 核查要点 |
|-------|---------|
| 8.1.1 安全物理环境 | 不在代码审计范围（转测评机构） |
| 8.1.2 安全通信网络 | TLS 1.2+、VPN、网络分区、IP 白名单、国密 TLCP/GMSSL |
| 8.1.3 安全区域边界 | 前置 WAF/IDS、访问控制策略、边界防护设备 |
| 8.1.4 安全计算环境 | 身份鉴别（密码复杂度、登录失败锁定、多因素）、访问控制（最小权限、三员分立）、安全审计（日志覆盖+保留≥180天+防篡改）、入侵防范、恶意代码防范、数据完整性（签名）、数据保密性（传输+存储加密）、数据备份恢复、剩余信息保护、个人信息保护 |
| 8.1.5 安全管理中心 | 系统管理员/安全管理员/审计员分立、集中日志、统一身份 |
| 8.1.6~8.1.10 管理类 | 制度、机构、人员、建设、运维（管理审计，代码侧提供凭证） |

**代码层面必须落地的等保要求**：
- [ ] 密码策略：长度 ≥ 8（三级建议 ≥ 12），大小写 + 数字 + 特殊字符
- [ ] 登录失败：连续 5 次锁定 ≥ 30 分钟（Spring Security `LoginAttemptService` 自实现或 `MaxLoginAttemptsFilter`）
- [ ] 会话：空闲 ≥ 10 分钟超时，`max-sessions=1`（单点登录）
- [ ] 审计日志：记录登录、授权变更、敏感操作、数据导出，含操作人/时间/IP/结果
- [ ] 日志保留：≥ 180 天，归档到异地（MinIO/S3/国产对象存储）
- [ ] 日志防篡改：单向写入 + 签名链（WORM 存储 / 区块链存证）
- [ ] 三员分立：`ROLE_SYSADMIN` / `ROLE_SECADMIN` / `ROLE_AUDITOR` 角色，代码中互斥校验
- [ ] 敏感数据加密：身份证、手机号、银行卡、密码传输前端 SM2 加密，存储 SM4 加密
- [ ] 剩余信息保护：登出清空 `HttpSession`、清空前端 Vuex/localStorage
- [ ] 个人信息保护：展示脱敏（中间星号）、导出需二次鉴权 + 日志

### 4.8 信创适配审计

| 维度 | 核查要点 |
|------|---------|
| 国产数据库 | 达梦 DM8 / 人大金仓 KingbaseES / 瀚高 HighGo / openGauss - JDBC 驱动可通过 profile 切换、SQL 方言兼容（禁用 PG 特有函数）、分页语法 |
| 操作系统 | 麒麟 Kylin V10 / 统信 UOS / 欧拉 openEuler - 镜像构建脚本、systemd 单元、SELinux 策略 |
| CPU 架构 | 鲲鹏 (arm64) / 飞腾 (arm64) / 龙芯 (loongarch64) / 海光 (x86_64) - 构建产物多架构、Docker buildx、C++ 交叉编译 |
| 中间件 | 东方通 TongWeb / 宝兰德 BES / 金蝶 Apusic - 替换 Tomcat 的兼容性 |
| 国密 | SM2（非对称）、SM3（哈希）、SM4（对称）、TLCP/GMSSL（TLS 替代）- 证书、签名、加密、存储均需支持 |
| JDK | 龙井 JDK / OpenJDK 国产发行版 / 毕昇 JDK - 字节码兼容、GC 行为差异 |
| 浏览器 | 奇安信浏览器 / 红莲花 / 360 安全浏览器 - Vue 2 已停更，Polyfill 需核对 |

### 4.9 数据安全与隐私合规
- 《个人信息保护法》(PIPL)：敏感个人信息（金融账户、医疗健康、生物识别、14岁以下未成年人）需单独同意
- 《数据安全法》：数据分级分类、重要数据出境评估
- 《密码法》：商用密码使用备案（涉及国家安全）
- GDPR（若涉及欧盟用户）：数据主体权利（访问/删除/携带）、DPA、DPO
- 匿名化 / 去标识化：日志、分析数据脱敏

---

## 阶段五：报告生成 (Report Generation)

**输出路径**: `docs/qa/security-audit-report-{YYYY-MM-DD}.md`

**报告结构**（参照 `references/report-template.md`）：
1. Executive Summary（管理层摘要）
2. 审计范围与方法论
3. 漏洞统计仪表板
4. OWASP Top 10 2021 逐类分析
5. **等保 2.0 三级对齐专章**
6. **信创适配专章**
7. 详细漏洞清单（FINDING）
8. 代码覆盖率矩阵
9. 修复优先级路线图
10. 安全加固建议
11. 附录

**FINDING 格式**：

```markdown
### FINDING-{NNN}: {标题}

| 属性 | 值 |
|------|-----|
| 严重等级 | CRITICAL / HIGH / MEDIUM / LOW |
| CVSS 3.1 | {向量字符串} → {分数} |
| OWASP | A0X: {类别名} |
| CWE | CWE-{ID}: {名称} |
| 等保 | 8.1.X.Y {控制项名} |
| 文件 | `{模块}/{相对路径}:{行号}` |

**描述**: ...
**攻击向量**: ...
**影响**: ...
**漏洞代码**:
\`\`\`java
// 当前代码
\`\`\`
**修复方案**:
\`\`\`java
// 修复后代码（必须可编译运行）
\`\`\`
**验证步骤**:
1. `mvn -pl {module} -am test -Dtest={TestClass}`
2. 运行 {攻击向量命令} 应被拒绝
3. SonarQube/SpotBugs 复扫该规则 resolved
```

---

## 阶段六：质量校验 (Quality Validation)

1. **字数**：`wc -w docs/qa/security-audit-report-*.md` ≥ 60,000
2. **覆盖率**：已审计文件数 / 总源文件数 ≥ 95%
3. **OWASP 完整性**：10 个类别均有分析（即使 "未发现" 也需说明检查方法）
4. **等保完整性**：8.1.1 ~ 8.1.10 全部有结论
5. **信创完整性**：数据库 / 操作系统 / CPU / 国密 / JDK 五项均有结论
6. **修复代码质量**：每个 CRITICAL / HIGH 的修复代码必须可编译运行
   - Java 修复：片段应能放入现有类，依赖齐全
   - C++ 修复：含 include、namespace、CMake 集成
   - Vue 修复：含 template + script + 必要的 import
7. **证据链完整**：FINDING 的"攻击向量"须可复现（含具体 curl / SQL 负载）
8. **如未达标**：标记差距，继续补充审计直到达标，**不允许草草收场**

---

## 续接说明（多会话审计）

Java 企业项目通常文件数 500~2000，单会话难以完成。跨会话续接流程：

1. 每个会话结束前更新 `references/previous-findings.md`：
   - 已发现漏洞清单（含 VULN-ID、标题、文件、等保对齐、OWASP 类别）
   - 已审计文件清单（模块级进度百分比）
   - 未审计高优先级文件
2. 下次会话开始时**先读取** `previous-findings.md` 恢复上下文
3. 用 `FILE_INVENTORY` 表跟踪文件审计状态
4. 新发现追加到已有列表，VULN-ID 连续递增
5. 每个会话至少推进一个模块的审计完成度 ≥ 20%

---

## 参考文件
- `references/report-template.md` — 报告模板
- `references/previous-findings.md` — 历史发现与审计进度
