# `.claudejav` — Java 企业栈 Claude Code Skills 镜像

> 这是从本项目 `.claude/skills/` 派生、面向 **Java 企业项目** 改写的两个核心 skill。
> 目录内容保持与 `.claude/skills/` 的文件树结构完全一致，方便直接拷贝到目标 Java 项目使用。

---

## 一、目标技术栈

| 层 | 技术 |
|----|------|
| 构建 | Maven 多模块 (parent pom + api/service/dao/common/websocket/mq/boot/cpp/web-admin) |
| 后端 | Java 8/11/17、Spring Boot 2.x (或 3.x)、Spring Security、MyBatis (含 MyBatis-Plus) |
| 消息 | RabbitMQ (Spring AMQP)、WebSocket (Spring STOMP / Java-WebSocket) |
| 存储 | PostgreSQL / 达梦 DM8 / 人大金仓 KingbaseES、Redis (Jedis/Lettuce/Redisson) |
| 原生 | C++17 服务（CMake），**混合模式** —— 既做 RabbitMQ 生产/消费，又作为 HTTP 客户端调 Java REST |
| 前端 | Vue 2 + JavaScript + Element UI + Vuex + Vue Router + vue-cli |
| 基础设施 | Docker / docker-compose、Nginx |
| 合规 | OWASP Top 10 2021 + 等保 2.0 三级 + 信创适配（麒麟/统信/国密 SM2/SM3/SM4） |

---

## 二、目录结构

```
.claudejav/
├── README.md                                        # 本文件
└── skills/
    ├── bug-fix-pipeline/
    │   └── SKILL.md                                 # 批量 bug 分诊→计划→修复→验证
    └── security-audit/
        ├── SKILL.md                                 # 六阶段全栈安全审计
        └── references/
            ├── report-template.md                   # 审计报告模板（含等保/信创专章）
            └── previous-findings.md                 # 多会话审计续接模板
```

---

## 三、迁移到其他 Java 项目的步骤

### Step 1：拷贝并改名

在目标 Java 项目根目录执行：

```bash
# 假设目标项目为 /path/to/your-java-project
cp -r /Users/liangfeng/evn/projects/AetherBlog/.claudejav/skills \
      /path/to/your-java-project/.claude/skills

# 或者保留两套（不覆盖目标原有的 .claude/skills）：
cp -r /Users/liangfeng/evn/projects/AetherBlog/.claudejav \
      /path/to/your-java-project/.claudejav
# 然后手动合并需要的 skill 到 .claude/skills/
```

**关键**：Claude Code 只会从 `.claude/skills/` 发现 skill；`.claudejav/` 仅是你迁移时的中转 / 文件仓库。真正让 skill 生效必须放到 `.claude/skills/`。

### Step 2：替换项目占位符

两个 `SKILL.md` 与模板中有若干项目特定的假设，需要按目标项目实际调整：

| 位置 | 原值（AetherBlog 版本） | 需替换为 |
|------|------------------------|---------|
| `bug-fix-pipeline/SKILL.md` §技术栈前置声明 | 示意目录树 (api-module/service-module/...) | 目标项目实际 module 名 |
| `security-audit/SKILL.md` §阶段一文件发现 | glob 路径 `api-module/src/main/java/**/*.java` | 目标项目 glob |
| `security-audit/SKILL.md` §4.5 PostgreSQL | 默认 PG | 若用 MySQL/Oracle，补扫描模式 |
| `security-audit/SKILL.md` §4.7 等保 | 三级 | 若项目需二级/四级，调整控制项 |
| `references/previous-findings.md` §2 | 示例 module 名 | 目标 module 名 |
| `references/report-template.md` §2.1 | 模块表格 | 目标实际模块 |

**快速替换脚本**（示例）：

```bash
# 如果目标项目把 api-module 叫做 gateway-api、dao-module 叫做 persistence
cd .claude/skills
rg -l "api-module" | xargs sed -i '' 's/api-module/gateway-api/g'
rg -l "dao-module" | xargs sed -i '' 's/dao-module/persistence/g'
```

### Step 3：校验 skill 可被发现

在目标项目根目录启动 Claude Code，输入：

```
/doctor
```

或直接问 Claude：

```
列出当前可用的 skills
```

应看到 `bug-fix-pipeline` 和 `security-audit` 出现在列表中。

### Step 4：试运行

**bug-fix-pipeline** 试运行：

```
请根据 docs/qa/sample-bugs.md 里的清单，启动 bug-fix-pipeline skill 做分诊
```

**security-audit** 试运行：

```
/security-audit
```

---

## 四、需要目标项目提供的前置条件

### 必需
- ✅ Maven 多模块项目（或 Gradle，需自行调整命令）
- ✅ `docs/qa/` 目录（审计/bug 报告存放位置）——若无，skill 会在首次运行时建立
- ✅ git 仓库已初始化

### 推荐（提升 skill 效果）
- 📦 SpotBugs + FindSecBugs Maven 插件（`mvn spotbugs:check`）
- 📦 Checkstyle + PMD Maven 插件
- 📦 OWASP Dependency-Check 插件（`mvn dependency-check:check`）
- 📦 ArchUnit（架构测试）
- 📦 Testcontainers（PG + Redis + RabbitMQ 集成测试）
- 📦 C++ 侧：clang-tidy + cppcheck + ASAN/UBSAN 构建 target
- 📦 前端：ESLint + eslint-plugin-vue + eslint-plugin-security
- 📦 Docker 镜像扫描：Trivy / Grype
- 📦 SonarQube 集成（CI 阶段）

目标项目若缺少这些，skill 仍可运行，但 Quality Gates G4/G6/G7 无法自动执行，需人工替代方案。

---

## 五、版本与维护

### 当前版本
| 文件 | 版本 | 最后更新 |
|------|------|---------|
| `skills/bug-fix-pipeline/SKILL.md` | v1.0 | 2026-04-17 |
| `skills/security-audit/SKILL.md` | v1.0 | 2026-04-17 |
| `skills/security-audit/references/report-template.md` | v1.0 | 2026-04-17 |
| `skills/security-audit/references/previous-findings.md` | v1.0 | 2026-04-17 |

### 升级原则
- 新框架出现（如 Spring Boot 4、Vue 3 升级、新的等保测评要求），**在模板顶部标注版本差异**而不是删除旧版说明
- 新的 CVE 类别（如 Spring4Shell 类 JNDI 注入新变种），追加到 `SKILL.md` §阶段二扫描模式表
- 企业内部规范变更（如新增限流 / 国密新版本），在 `report-template.md` 对应章节补充

### 回到源目录同步
本文件所在的 `.claudejav/` 是 AetherBlog 维护的主版本。当你在某个 Java 项目中改进了 skill（例如加了一条新的扫描模式），欢迎 diff 回这里：

```bash
# 在 Java 项目内，将本地改进 diff 回 AetherBlog 主版本
diff -u /Users/liangfeng/evn/projects/AetherBlog/.claudejav/skills/security-audit/SKILL.md \
        .claude/skills/security-audit/SKILL.md \
  > /tmp/security-audit-delta.patch
```

---

## 六、与原始 `.claude/skills/` 的关键差异

| 维度 | 原 AetherBlog 版 | 本 Java 企业版 |
|------|----------------|--------------|
| 目标栈 | Go + TS/Vite + Next.js + Python FastAPI | Java Spring + MyBatis + Vue 2 + C++ |
| 构建命令 | `go build`、`pnpm lint` | `mvn clean verify`、`npm run lint`、`cmake --build` |
| 扫描模式 | Go SQL 拼接、React `dangerouslySetInnerHTML` | MyBatis `${}`、Vue `v-html`、Java 反序列化、Log4Shell |
| 并行单元 | 前端/后端/AI 服务 | Maven 模块边界（api/service/dao/...） |
| 合规框架 | OWASP Top 10 | OWASP Top 10 + 等保 2.0 三级 + 信创 |
| 特殊章节 | - | 等保 8.1.2~8.1.5 对齐表、信创五维（DB/OS/CPU/国密/中间件） |
| C++ 支持 | 无 | 内存安全、JNI→改 HTTP+MQ 混合模式、clang-tidy/ASAN |
| 质量门 | 4 道 (编译/测试/静态/diff) | 8 道 (+集成测试/前端/C++/C++ 静态) |

---

## 七、常见问题

**Q：`bug-fix-pipeline` 只能用于安全审计报告吗？**
A：不是。它可以消费任何 bug 清单：SonarQube 导出、测评机构报告、等保整改单、人工 QA 列表。只需是 Markdown/Excel 带条目的表单。

**Q：项目没有 C++ 服务，能用吗？**
A：可以。删除 `SKILL.md` §阶段三 3.5 C++ 专项检查、§阶段二 2.2 C++ 模式、`report-template.md` 中 cpp-worker 相关行即可。

**Q：我们用 Gradle 不用 Maven，怎么办？**
A：全局搜索替换 `mvn` → `./gradlew`，并调整命令参数：
- `mvn clean verify` → `./gradlew check`
- `mvn -pl <module> -am test` → `./gradlew :<module>:test`
- `mvn spotbugs:check` → `./gradlew spotbugsMain`

**Q：我们是 Vue 3 不是 Vue 2？**
A：`SKILL.md` §阶段二 2.3 Vue 2 模式大多数仍适用（v-html、eval、localStorage）。补充 Vue 3 专有：`<script setup>`、`ref/reactive` XSS 路径、Pinia 持久化。

**Q：AetherBlog 项目的 `/security-audit` 命令还能用吗？**
A：能。原 `.claude/skills/security-audit/` 保持不动。`.claudejav/` 是独立副本，互不影响。

**Q：`previous-findings.md` 填满了想重新开始怎么办？**
A：删除该文件，重新从本仓库 `.claudejav/skills/security-audit/references/previous-findings.md` 拷一份新的空模板即可。
