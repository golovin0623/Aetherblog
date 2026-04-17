# Security Audit Report Template — Java 企业栈

> 本模板用于 Spring Boot + MyBatis + Vue 2 + C++ + RabbitMQ + WebSocket + PostgreSQL/达梦 + Redis 的企业项目安全审计。
> 使用时替换所有 `{占位符}`，保留章节结构。

---

# {项目中文名} 安全审计报告

**审计日期**: {YYYY-MM-DD}
**审计版本**: v{X.Y.Z}（commit: `{git rev-parse --short HEAD}`）
**审计人**: AI Security Auditor (Claude) + {人工复核人}
**审计类型**: 白盒代码审计 (Static Analysis)
**分类框架**: OWASP Top 10 2021 + 网络安全等级保护 2.0 三级 + 信创适配
**评分体系**: CVSS 3.1
**测评对象**: {项目部署环境，如 "生产环境 / UAT / 测评环境"}

---

## 1. Executive Summary

### 1.1 审计概述
{1-2 段：项目简介、本次审计的触发原因（新上线/等保测评/信创迁移/定期巡检）、审计目标、覆盖范围概述}

### 1.2 关键发现
| 严重等级 | 数量 | 已修复 | 待修复 | 风险评估 |
|----------|------|--------|--------|---------|
| 🔴 CRITICAL | {N} | {N} | {N} | {说明} |
| 🟠 HIGH | {N} | {N} | {N} | {说明} |
| 🟡 MEDIUM | {N} | {N} | {N} | {说明} |
| 🔵 LOW | {N} | {N} | {N} | {说明} |
| ℹ️ INFO | {N} | - | - | {说明} |
| **合计** | **{N}** | **{N}** | **{N}** | |

### 1.3 合规评定
| 框架 | 结论 | 关键不符合项 |
|------|------|-------------|
| OWASP Top 10 2021 | {符合 / 部分符合 / 不符合} | {简述} |
| 等保 2.0 三级 | {符合 / 部分符合 / 不符合} | {未满足的控制项编号} |
| 信创适配 | {完全兼容 / 部分兼容 / 需改造} | {具体问题} |

### 1.4 整体风险评级
**整体风险等级**: {CRITICAL / HIGH / MEDIUM / LOW}
**核心发现**: {1-2 句话概括最重要的发现，面向决策层}
**最短整改周期**: {N} 天（仅考虑 P0 + P1）

---

## 2. 审计范围与方法论

### 2.1 审计范围
| 模块 | 技术栈 | 文件数 | 已审计 | 覆盖率 |
|------|--------|--------|--------|--------|
| api-module | Spring Web / Spring Security | {N} | {N} | {%} |
| service-module | Spring / MyBatis-Plus | {N} | {N} | {%} |
| dao-module | MyBatis XML + Mapper | {N} | {N} | {%} |
| websocket-module | Spring STOMP / Java-WebSocket | {N} | {N} | {%} |
| mq-module | Spring AMQP / RabbitMQ | {N} | {N} | {%} |
| common-module | Java 工具 / 常量 | {N} | {N} | {%} |
| boot-module | Spring Boot 启动 + 配置 | {N} | {N} | {%} |
| cpp-worker | C++17 / CMake / libcurl / librabbitmq | {N} | {N} | {%} |
| web-admin | Vue 2 / Element UI / Vuex | {N} | {N} | {%} |
| 基础设施 | Docker / Nginx / RabbitMQ / Redis / PostgreSQL | {N} | {N} | {%} |
| **合计** | | **{N}** | **{N}** | **{%}** |

### 2.2 审计方法
1. 静态代码分析（逐文件审读）
2. 模式匹配扫描（rg/regex 高风险模式 —— Java/C++/Vue/MyBatis/配置 文件）
3. 配置审计（application.yml、Dockerfile、Nginx、RabbitMQ、Redis、PG）
4. 依赖分析（Maven `dependency-check`、npm `audit`、conan/vcpkg CVE 对比）
5. 架构安全评估（数据流、信任边界、MQ/WS/HTTP 三通道协同、Java↔C++ 双端契约）
6. 合规对齐（OWASP 十类 + 等保 2.0 三级十项控制 + 信创五维）

### 2.3 排除范围
- 运行时动态分析 / 黑盒渗透测试（建议另行委托）
- 第三方闭源依赖的内部代码（仅扫描已知 CVE）
- 物理安全 / 社会工程学 / 供应链信任评估
- 业务逻辑漏洞的完整穷举（如涉及金额计算，建议专项 QA）

### 2.4 审计工具
| 工具 | 用途 |
|------|------|
| Claude AI | 白盒代码审读 / 架构分析 / 修复代码生成 |
| ripgrep (rg) | 模式匹配扫描 |
| SpotBugs + FindSecBugs | Java 静态分析 |
| Checkstyle / PMD | Java 代码规范 |
| OWASP Dependency-Check | Maven 依赖 CVE |
| npm audit | 前端依赖 CVE |
| clang-tidy / cppcheck | C++ 静态分析 |
| AddressSanitizer / UBSan | C++ 运行时检测（参考） |
| Hadolint | Dockerfile lint |
| Trivy | 容器镜像 CVE |

---

## 3. 漏洞统计仪表板

### 3.1 按模块分布
| 模块 | CRITICAL | HIGH | MEDIUM | LOW | INFO | 合计 |
|------|----------|------|--------|-----|------|------|
| api-module | {N} | {N} | {N} | {N} | {N} | {N} |
| service-module | {N} | {N} | {N} | {N} | {N} | {N} |
| dao-module | {N} | {N} | {N} | {N} | {N} | {N} |
| ... | | | | | | |

### 3.2 按 OWASP 类别分布
| 类别 | 数量 | 占比 |
|------|------|------|
| A01 访问控制缺陷 | {N} | {%} |
| A02 加密失败 | {N} | {%} |
| A03 注入 | {N} | {%} |
| A04 不安全设计 | {N} | {%} |
| A05 安全配置错误 | {N} | {%} |
| A06 易受攻击和过时的组件 | {N} | {%} |
| A07 认证和授权失败 | {N} | {%} |
| A08 软件和数据完整性失败 | {N} | {%} |
| A09 安全日志和监控失败 | {N} | {%} |
| A10 SSRF | {N} | {%} |

### 3.3 按等保 2.0 三级控制项分布
| 控制项 | 不符合数 | 部分符合数 |
|-------|---------|-----------|
| 8.1.2 安全通信网络 | {N} | {N} |
| 8.1.3 安全区域边界 | {N} | {N} |
| 8.1.4 安全计算环境 | {N} | {N} |
| 8.1.5 安全管理中心 | {N} | {N} |

---

## 4. OWASP Top 10 2021 分类分析

### 4.1 A01:2021 — Broken Access Control
**分析方法**: {grep 搜索 + 逐 controller/service 权限检查 + 资源归属校验}
**核心发现**: {总结几点}
**相关 FINDING**: FINDING-{XXX}, FINDING-{YYY}

### 4.2 A02:2021 — Cryptographic Failures
**分析方法**: {MessageDigest/Cipher/SecureRandom/TLS/国密 SM2/SM3/SM4 覆盖检查}
**核心发现**: {总结}
**相关 FINDING**: ...

### 4.3 A03:2021 — Injection
**分析方法**: {MyBatis XML `${}` / JDBC 拼接 / 命令 / LDAP / XPath / SpEL / XXE / JNDI / Log4Shell}
**核心发现**: {总结}
**相关 FINDING**: ...

### 4.4 A04:2021 — Insecure Design
**分析方法**: {架构层面评估：信任边界、默认安全、速率限制、业务逻辑}
**核心发现**: {总结}
**相关 FINDING**: ...

### 4.5 A05:2021 — Security Misconfiguration
**分析方法**: {application.yml + Dockerfile + Nginx + RabbitMQ + Redis + PG pg_hba + actuator + swagger + H2 console + druid}
**核心发现**: {总结}
**相关 FINDING**: ...

### 4.6 A06:2021 — Vulnerable and Outdated Components
**分析方法**: {Maven dependency-check + npm audit + conan/vcpkg CVE}
**核心发现**: {总结 —— 特别关注 Log4j2、Spring、fastjson、SnakeYAML、OpenSSL}
**相关 FINDING**: ...

### 4.7 A07:2021 — Identification and Authentication Failures
**分析方法**: {Spring Security 配置 + JWT 实现 + 密码策略 + 登录失败处理 + 会话管理 + MFA}
**核心发现**: {总结}
**相关 FINDING**: ...

### 4.8 A08:2021 — Software and Data Integrity Failures
**分析方法**: {反序列化 + MQ 消息完整性 + 更新包签名 + CI/CD 完整性}
**核心发现**: {总结 —— ObjectInputStream / Jackson / fastjson / XStream / SnakeYAML}
**相关 FINDING**: ...

### 4.9 A09:2021 — Security Logging and Monitoring Failures
**分析方法**: {日志覆盖面 + 日志保留 + 日志防篡改 + 监控告警 + 关键事件留痕}
**核心发现**: {总结}
**相关 FINDING**: ...

### 4.10 A10:2021 — Server-Side Request Forgery (SSRF)
**分析方法**: {RestTemplate / WebClient / HttpClient / URL.openConnection + C++ libcurl 用户可控 URL 扫描}
**核心发现**: {总结}
**相关 FINDING**: ...

---

## 5. 等保 2.0 三级专章

### 5.1 8.1.2 安全通信网络
| 控制点 | 要求 | 当前状态 | 结论 | 证据 |
|--------|------|---------|------|------|
| 8.1.2.1 网络架构 | 主干网络带宽满足、业务高峰期可用性 | {实测} | 符合/部分/不符合 | {截图/配置} |
| 8.1.2.2 通信传输 | 采用校验技术或密码技术保证数据完整性 | {评估} | ... | ... |
| 8.1.2.3 可信验证 | 基于可信根对通信设备进行可信验证 | {评估} | ... | ... |

### 5.2 8.1.3 安全区域边界
{同上表格形式 —— 访问控制 / 入侵防范 / 恶意代码防范 / 安全审计 / 可信验证}

### 5.3 8.1.4 安全计算环境（**代码审计核心章节**）

#### 5.3.1 身份鉴别
| 要求 | 现状 | 结论 | 整改建议 |
|------|------|------|---------|
| 应对登录用户进行身份标识和鉴别，身份标识具有唯一性，鉴别信息具有复杂度要求并定期更换 | {描述密码策略：长度/复杂度/有效期} | ... | ... |
| 应具有登录失败处理功能 | {描述：锁定次数/锁定时长/告警} | ... | ... |
| 远程管理时应采取必要措施防止鉴别信息在网络传输过程中被窃听 | {TLS 版本 / HTTPS 强制} | ... | ... |
| 应采用口令、密码技术、生物技术等两种或两种以上组合的鉴别技术对用户进行身份鉴别 | {MFA 实现情况} | ... | ... |

#### 5.3.2 访问控制
| 要求 | 现状 | 结论 | 整改建议 |
|------|------|------|---------|
| 应对登录用户分配账户和权限 | ... | ... | ... |
| 应重命名或删除默认账户，修改默认账户的默认口令 | {是否保留 admin/admin、guest} | ... | ... |
| 应及时删除或停用多余的、过期的账户 | ... | ... | ... |
| 应授予管理用户所需的最小权限，实现管理用户的权限分离 | {三员分立情况} | ... | ... |
| 应由授权主体配置访问控制策略 | ... | ... | ... |
| 访问控制的粒度应达到主体为用户级或进程级，客体为文件、数据库表级 | ... | ... | ... |
| 应对重要主体和客体设置安全标记 | ... | ... | ... |

#### 5.3.3 安全审计
| 要求 | 现状 | 结论 | 整改建议 |
|------|------|------|---------|
| 应启用安全审计功能，审计覆盖到每个用户，对重要的用户行为和重要安全事件进行审计 | {日志覆盖范围} | ... | ... |
| 审计记录应包括事件日期和时间、用户、事件类型、事件是否成功及其他与审计相关的信息 | {日志字段} | ... | ... |
| 应对审计记录进行保护，定期备份，避免受到未预期的删除、修改或覆盖等 | {保留≥180天、异地备份、WORM} | ... | ... |
| 应对审计进程进行保护，防止未经授权的中断 | ... | ... | ... |

#### 5.3.4 入侵防范
| 要求 | 现状 | 结论 | 整改建议 |
|------|------|------|---------|
| 应遵循最小安装的原则 | {Docker 镜像是否精简} | ... | ... |
| 应关闭不需要的系统服务、默认共享和高危端口 | ... | ... | ... |
| 应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制 | ... | ... | ... |
| 应提供数据有效性检验功能 | {Bean Validation 覆盖} | ... | ... |
| 应能发现可能存在的已知漏洞 | {SCA 扫描频率} | ... | ... |
| 应能够检测到对重要节点进行入侵的行为 | {IDS/HIDS 部署} | ... | ... |

#### 5.3.5 恶意代码防范
{表格}

#### 5.3.6 可信验证
{表格}

#### 5.3.7 数据完整性
{表格 —— 传输完整性：HMAC/签名；存储完整性：哈希校验链}

#### 5.3.8 数据保密性
{表格 —— 传输保密性：TLS 1.2+ / 国密 TLCP；存储保密性：敏感字段 SM4 加密}

#### 5.3.9 数据备份恢复
{表格 —— 数据备份策略、异地备份、灾备切换演练}

#### 5.3.10 剩余信息保护
{表格 —— 登出后清空会话、内存擦除、前端 localStorage/Vuex 清理}

#### 5.3.11 个人信息保护
{表格 —— 最小必要收集、脱敏展示、导出日志、删除权利}

### 5.4 8.1.5 安全管理中心
{表格 —— 系统管理 / 审计管理 / 安全管理 / 集中管控}

---

## 6. 信创适配专章

### 6.1 国产数据库兼容性
| 目标 | 当前状态 | 兼容性问题 | 整改建议 |
|------|---------|-----------|---------|
| 达梦 DM8 | {JDBC 驱动 / SQL 方言 / 存储过程} | {具体不兼容项} | ... |
| 人大金仓 KingbaseES | ... | ... | ... |
| 瀚高 HighGo / openGauss | ... | ... | ... |

**SQL 不兼容示例**:
```sql
-- PostgreSQL 特有，达梦不支持
SELECT jsonb_array_elements('[...]'::jsonb);
-- 达梦兼容写法
SELECT value FROM JSON_TABLE('[...]', '$[*]' COLUMNS(value VARCHAR(200) PATH '$'));
```

**JDBC 切换方案**:
```yaml
# application-dm.yml (达梦 profile)
spring:
  datasource:
    driver-class-name: dm.jdbc.driver.DmDriver
    url: jdbc:dm://dm-host:5236/DBNAME
# application-pg.yml (PostgreSQL profile)
spring:
  datasource:
    driver-class-name: org.postgresql.Driver
    url: jdbc:postgresql://pg-host:5432/dbname
```

### 6.2 国产操作系统兼容性
| 目标 | 镜像 / 内核 | 兼容性问题 | 整改建议 |
|------|-----------|-----------|---------|
| 麒麟 Kylin V10 SP2 | {对应 Docker 镜像} | {JDK 版本/glibc/systemd 差异} | ... |
| 统信 UOS | ... | ... | ... |
| 欧拉 openEuler | ... | ... | ... |

### 6.3 国产 CPU 架构兼容性
| 架构 | 构建产物 | 兼容性 | 整改建议 |
|------|---------|--------|---------|
| 鲲鹏 (arm64) | {docker buildx 多架构} | ... | ... |
| 飞腾 (arm64) | ... | ... | ... |
| 龙芯 (loongarch64) | {C++ 交叉编译 / JDK 可得} | ... | ... |
| 海光 (x86_64) | ... | ... | ... |

### 6.4 国密算法适配
| 算法 | 用途 | 当前状态 | 整改建议 |
|------|------|---------|---------|
| SM2 | 非对称加密 / 签名 | {是否已集成 bouncycastle / 安全芯片} | ... |
| SM3 | 哈希 | {替换 SHA-256 的位置} | ... |
| SM4 | 对称加密 | {替换 AES 的位置 —— 敏感字段存储} | ... |
| TLCP / GMSSL | 传输加密 | {网关 / Nginx 国密版 / 东方通} | ... |

### 6.5 国产中间件适配
| 目标 | 替换对象 | 兼容性问题 | 整改建议 |
|------|---------|-----------|---------|
| 东方通 TongWeb | Tomcat | {Servlet 规范 / 线程模型 / WebSocket 扩展} | ... |
| 宝兰德 BES | Tomcat | ... | ... |
| 金蝶 Apusic | Tomcat | ... | ... |

---

## 7. 详细漏洞清单

### FINDING-001: {标题，如 "OrderMapper.xml 存在 SQL 注入"}

| 属性 | 值 |
|------|-----|
| 严重等级 | CRITICAL |
| CVSS 3.1 | CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H → 9.9 |
| OWASP | A03: Injection |
| CWE | CWE-89: SQL Injection |
| 等保 | 8.1.4.2 访问控制 / 8.1.4.4 入侵防范（数据有效性检验） |
| 文件 | `dao-module/src/main/resources/mapper/OrderMapper.xml:42-48` |
| 发现日期 | {YYYY-MM-DD} |
| 状态 | 未修复 |

**描述**:
{漏洞的详细技术描述，包括上下文和根本原因分析。例：MyBatis XML 中 `${orderStatus}` 是字符串替换，等价于 JDBC `Statement`，
攻击者可通过 `orderStatus=' OR 1=1--` 绕过原条件，读取全表。正确用法 `#{orderStatus}` 会走 `PreparedStatement` 参数化绑定。}

**攻击向量**:
```bash
curl -H "Authorization: Bearer {低权限 token}" \
  "http://target/api/orders?status=%27%20OR%201%3D1--"
# 预期：根据 status 过滤；实际：绕过过滤，返回全部订单
```

**影响**:
- 机密性：**高** — 可读取所有订单数据，含客户姓名/电话/金额
- 完整性：**高** — 可通过堆叠 SQL 注入（若数据库支持）修改/删除数据
- 可用性：**高** — 可触发 `pg_sleep(60)` 导致 DoS

**漏洞代码**:
```xml
<!-- dao-module/src/main/resources/mapper/OrderMapper.xml -->
<select id="findByStatus" resultType="OrderPO">
  SELECT id, user_id, amount, status
  FROM t_order
  WHERE status = '${orderStatus}'        <!-- ❌ 字符串拼接 -->
  ORDER BY create_time DESC
</select>
```

**修复方案**:
```xml
<!-- dao-module/src/main/resources/mapper/OrderMapper.xml -->
<select id="findByStatus" resultType="OrderPO">
  SELECT id, user_id, amount, status
  FROM t_order
  WHERE status = #{orderStatus}          <!-- ✅ 参数化绑定 -->
  ORDER BY create_time DESC
</select>
```

Service 层追加 Bean Validation：
```java
// service-module/src/main/java/com/example/service/OrderService.java
public List<Order> findByStatus(
    @Pattern(regexp = "^[A-Z_]{1,20}$", message = "订单状态格式非法")
    String orderStatus) {
    return orderMapper.findByStatus(orderStatus);
}
```

**验证步骤**:
1. `mvn -pl dao-module,service-module -am test -Dtest=OrderMapperTest`
2. 启动后执行 `curl "http://localhost:8080/api/orders?status=%27%20OR%201%3D1--"` 期望返回 400 (参数校验拒绝)
3. 启用 MyBatis 日志 `logging.level.org.mybatis=DEBUG`，确认 SQL 为 `WHERE status = ?` 且参数独立绑定
4. SpotBugs/SonarQube 复扫 `MYBATIS_INJECTION` 规则应消除

---

### FINDING-002: {下一项}
{同上格式}

---

## 8. 代码覆盖率矩阵

### 8.1 Java 后端
| 文件 | 审计状态 | 发现数 | 备注 |
|------|---------|--------|------|
| `api-module/src/main/java/.../OrderController.java` | ✅ 已审计 | 2 | FINDING-005, FINDING-008 |
| `dao-module/src/main/resources/mapper/OrderMapper.xml` | ✅ 已审计 | 3 | FINDING-001, FINDING-011, FINDING-012 |
| ... | | | |

### 8.2 C++ 服务
| 文件 | 审计状态 | 发现数 | 备注 |
|------|---------|--------|------|
| `cpp-worker/src/rpc/http_client.cpp` | ✅ 已审计 | 1 | FINDING-020 (libcurl 无证书校验) |
| ... | | | |

### 8.3 Vue 2 前端
| 文件 | 审计状态 | 发现数 | 备注 |
|------|---------|--------|------|
| `web-admin/src/views/system/User.vue` | ✅ 已审计 | 1 | FINDING-030 (v-html) |
| ... | | | |

### 8.4 基础设施
{同上}

---

## 9. 修复优先级路线图

### 9.1 立即修复 (P0 — 24h 内)
{CRITICAL 级别 + 等保不符合项}
| FINDING | 标题 | 负责模块 | 负责人 | 预计工时 |
|---------|------|---------|-------|---------|
| FINDING-001 | OrderMapper SQL 注入 | dao | @张三 | 0.5d |
| ... | | | | |

### 9.2 尽快修复 (P1 — 1 周内)
{HIGH 级别}
{表格}

### 9.3 计划修复 (P2 — 1 个月内)
{MEDIUM 级别}
{表格}

### 9.4 持续改进 (P3 — 下个版本)
{LOW 级别 + INFO}
{表格}

---

## 10. 安全加固建议

### 10.1 架构层面
- 前置 WAF（如 ModSecurity / 阿里云 WAF / 腾讯云 T-Sec）
- API 网关统一鉴权（Spring Cloud Gateway / Kong）+ 限流
- 信任边界清晰化：互联网 / DMZ / 内网 / 数据中心四层
- 服务间调用 mTLS（Istio / Linkerd）

### 10.2 开发流程
- IDE 插件：SonarLint + FindSecBugs + Checkstyle
- Pre-commit hook：`mvn spotbugs:check checkstyle:check`
- PR 模板强制：安全影响评估勾选项
- CI 集成：OWASP Dependency-Check + SAST（SonarQube）+ 镜像扫描（Trivy）
- DAST：Upon 上线前人工 + 自动化渗透测试

### 10.3 运维安全
- 日志：集中收集（ELK/Loki），敏感字段脱敏，保留 ≥ 180 天
- 监控：关键指标告警（登录失败突增、5xx 异常、DB 慢查询）
- 密钥管理：Vault / KMS，禁止代码/配置文件硬编码
- 漏洞响应：CVE 订阅（github.com/advisories + CNNVD），SLA 明确
- 应急响应：预案文档 + 演练 + 事件回溯

### 10.4 合规持续化
- 等保测评每年一次，代码侧自查每季度一次
- 信创适配清单纳入架构评审门槛
- 隐私影响评估 (PIA) 随新功能上线

---

## 11. 附录

### 11.1 参考标准
- OWASP Top 10 2021 — https://owasp.org/Top10/
- CVSS 3.1 Calculator — https://www.first.org/cvss/calculator/3.1
- CWE (Common Weakness Enumeration)
- GB/T 22239-2019 《信息安全技术 网络安全等级保护基本要求》
- GB/T 28448-2019 《信息安全技术 网络安全等级保护测评要求》
- GB/T 32915-2016 《信息安全技术 二元序列随机性检测方法》
- GM/T 0002-2012 SM4 分组密码算法
- GM/T 0003.1~0003.5 SM2 椭圆曲线公钥密码算法
- GM/T 0004-2012 SM3 密码杂凑算法

### 11.2 术语表
| 术语 | 定义 |
|------|------|
| XSS | Cross-Site Scripting 跨站脚本 |
| CSRF | Cross-Site Request Forgery 跨站请求伪造 |
| SSRF | Server-Side Request Forgery 服务端请求伪造 |
| SQLi | SQL Injection |
| XXE | XML External Entity 注入 |
| RCE | Remote Code Execution 远程代码执行 |
| IDOR | Insecure Direct Object Reference 越权访问 |
| 等保 | 网络安全等级保护 |
| 信创 | 信息技术应用创新 |
| 三员分立 | 系统管理员 / 安全管理员 / 安全审计员 角色分离 |
| WORM | Write Once Read Many 一次写入多次读取（防篡改存储） |
| DLX | Dead Letter Exchange (RabbitMQ 死信交换) |

### 11.3 修订历史
| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| 1.0 | {YYYY-MM-DD} | 初始审计报告 | Claude + {人工复核人} |
