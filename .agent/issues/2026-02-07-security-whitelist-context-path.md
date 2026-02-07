# Admin 登录后 403 循环问题排查与修复

**日期**: 2026-02-07  
**严重程度**: 🔴 Critical  
**状态**: ✅ 已修复  
**耗时**: ~60 分钟  

---

## 问题现象

### 用户报告
Admin 管理后台登录成功后，页面持续跳转回登录页，形成无限循环。

### 具体表现
1. 输入正确的用户名密码，点击登录
2. 短暂显示"登录成功"后立即跳转回登录页
3. 浏览器控制台显示多个 API 请求返回 `403 Forbidden`
4. 尤其是 `POST /api/v1/auth/refresh` 请求失败

---

## 排查过程

### 阶段一：初步验证

**检查项 1: 后端服务状态**
```bash
curl http://localhost:8080/api/v1/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```
✅ 结果：返回 200 成功，包含有效的 accessToken

**检查项 2: 后端日志**
```
Securing POST /v1/auth/refresh
AnonymousAuthenticationFilter: Set SecurityContextHolder to anonymous SecurityContext
Http403ForbiddenEntryPoint: Pre-authenticated entry point called. Rejecting access
```
❓ 问题：refresh 请求被拒绝，且显示为"匿名用户"

### 阶段二：分析假设

**假设 1: Spring Security 白名单配置错误**

检查 `SecurityConfig.java`：
```java
private static final String[] WHITE_LIST = {
    "/v1/auth/refresh",  // 应该在白名单中
    // ...
};
```
✅ 结果：路径配置正确，排除此假设

**假设 2: context-path 导致路径不匹配**

检查 `application.yml`：
```yaml
server:
  servlet:
    context-path: /api
```
❓ 怀疑：白名单应该是 `/api/v1/auth/refresh` 而非 `/v1/auth/refresh`？

测试验证：修改白名单添加 `/api` 前缀后，问题依旧。
✅ 结论：Spring Security 匹配的是去除 context-path 后的路径，原配置正确

### 阶段三：深入分析

**关键发现：登录响应缺少 Set-Cookie**

```bash
# 检查响应头
curl -i http://localhost:8080/api/v1/auth/login -X POST ...

# 响应头（关键部分）
HTTP/1.1 200
Content-Type: application/json
# ❌ 没有 Set-Cookie 头！
```

**问题确认**：后端登录成功但**未返回认证 Cookie**，导致：
1. 浏览器没有保存 `ab_access_token` 和 `ab_refresh_token`
2. 后续 API 请求不携带认证信息
3. refresh 请求被视为匿名请求，返回 403

### 阶段四：代码调试

**添加调试日志**

在 `AuthController.writeAuthCookies()` 添加：
```java
log.info("Writing auth cookies...");
response.addHeader(HttpHeaders.SET_COOKIE, accessCookie.toString());
log.info("Cookies added to response headers");
```

**异常现象**：重新编译运行后，日志**未显示**调试信息！

**验证编译产物**：
```bash
# 源码中有调试日志
grep "Writing auth" AuthController.java
# 输出: 365: log.info("Writing auth cookies...")  ✅

# 编译后的 class 文件中没有
strings AuthController.class | grep "Writing auth"
# 输出: (空)  ❌
```

---

## 根本原因

### Maven 多模块增量编译陷阱

项目结构：
```
apps/server/
├── aetherblog-app/              # 主启动模块
├── aetherblog-common/           # 公共模块
└── aetherblog-service/
    └── blog-service/            # 业务服务模块 (包含 AuthController)
```

**问题命令**：
```bash
mvn spring-boot:run -pl aetherblog-app
```

**执行流程**：
1. Maven 只编译 `aetherblog-app` 模块
2. `blog-service` 作为依赖，从**本地 Maven 仓库**加载
3. 本地仓库中是**旧版本 JAR**（上次 `mvn install` 时的版本）
4. 源码修改**完全未生效**

| 编译方式 | blog-service 来源 | 源码修改生效 |
|:---------|:------------------|:-------------|
| `mvn spring-boot:run -pl aetherblog-app` | ~/.m2/repository 旧版本 | ❌ |
| `mvn clean install` 后再 `-pl` | 新编译并安装的版本 | ✅ |

---

## 解决方案

### 正确的开发编译方式

```bash
# 方案1：先安装所有模块，再运行
cd apps/server
mvn clean install -DskipTests
mvn spring-boot:run -pl aetherblog-app

# 方案2：不使用 -pl，编译整个项目
mvn clean spring-boot:run
```

### 修复验证

修复后登录响应正确包含 Cookie：
```http
HTTP/1.1 200
Set-Cookie: ab_access_token=eyJ...; Path=/api; Max-Age=86400; HttpOnly; SameSite=Strict
Set-Cookie: ab_refresh_token=GhD...; Path=/api/v1/auth; Max-Age=604800; HttpOnly; SameSite=Strict
Content-Type: application/json
```

---

## 经验总结

### 技术教训

1. **Maven `-pl` 参数的隐藏陷阱**
   - 只编译指定模块，依赖模块使用本地仓库缓存
   - 修改依赖模块代码后，必须先 `install` 再运行

2. **验证代码是否真正更新**
   - 使用 `strings *.class | grep` 检查编译产物
   - 或查看日志确认预期输出

3. **403 问题排查思路**
   - 不仅检查 Security 配置
   - 还要验证认证凭证（Cookie/Token）是否正确传递

### 预防措施

建议创建开发启动脚本：

```bash
#!/bin/bash
# start-backend.sh

cd apps/server

echo "🔧 安装所有模块..."
mvn clean install -DskipTests -q

echo "🚀 启动后端服务..."
mvn spring-boot:run -pl aetherblog-app \
  -Dspring-boot.run.jvmArguments="-DJWT_SECRET=your-secret-key"
```

---

## 相关文件

- `apps/server/aetherblog-service/blog-service/src/main/java/com/aetherblog/blog/controller/AuthController.java`
- `apps/server/aetherblog-common/common-security/src/main/java/com/aetherblog/common/security/config/SecurityConfig.java`

## 标签

`#maven` `#multi-module` `#authentication` `#cookie` `#403` `#debugging`
