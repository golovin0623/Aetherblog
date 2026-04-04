---
trigger: model_decision
description: Nginx 配置最佳实践指南
---

# Nginx 配置最佳实践指南

> **最后更新**: 2026-04-04
> **相关故障**: Admin 404/502 Incident (2026-01-08)

## 1. 核心原则：前缀路由优先 (Prefix Routing)

在单页面应用 (SPA) 部署中，我们经常需要将 `/admin` 等子路径路由到特定的根目录。

### 🛑 陷阱：正则优先 (Regex Precedence)
Nginx 的默认行为是：**正则表达式 (`~`) 的优先级高于普通前缀匹配 (`/`)**。

**错误示例**:
```nginx
# 1. 前缀匹配
location /admin {
    rewrite ^/admin(.*)$ $1 break;
    # ...
}

# 2. 全局 JS 缓存 (正则)
# 💀 致命: 请求 /admin/assets/app.js 时，这个正则会抢占！
# 导致 Nginx 忽略上面的 rewrite，去错误的路径找文件。
location ~* \.js$ {
    expires 1y;
}
```

### ✅ 解决方案：使用 `^~`

使用 `^~` 修饰符告诉 Nginx：**"只要匹配了这个前缀，立刻停止搜索正则规则！"**

**正确示例**:
```nginx
# 🔒 锁定前缀，防止正则抢占
location ^~ /admin/assets/ {
    rewrite ^/admin/(.*)$ /$1 break;
    root /usr/share/nginx/html;
    expires 1y;
}

location ^~ /admin/ {
    rewrite ^/admin/(.*)$ /$1 break;
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
}
```

---

## 2. 核心原则：慎用 `alias`

在配合 `try_files` 时，尽量避免使用 `alias`。

### 🛑 陷阱：Alias + Try_files Bug
`alias` 在处理嵌套 location 或正则匹配时，经常出现路径拼接错误，或者 `try_files` 无法正确回退。

**不推荐**:
```nginx
location /admin {
    alias /usr/share/nginx/html;
    try_files $uri $uri/ /index.html; # 风险极高
}
```

### ✅ 解决方案：Root + Rewrite

使用 `root` 指定根目录，配合 `rewrite` 移除 URL 前缀，这种方式最稳健。

**推荐**:
```nginx
location /admin {
    rewrite ^/admin(.*)$ $1 break; # 剥离前缀
    root /usr/share/nginx/html;    # 明确根目录
    try_files $uri $uri/ /index.html;
}
```

---

## 3. 生产环境部署检查清单

- [ ] 确保所有二级目录 (`/admin`, `/blog`) 都使用了 `^~` 保护。
- [ ] 检查是否有全局 `location ~` 规则可能冲突。
- [ ] 验证静态资源 (JS/CSS) 是否能正确加载 (`curl -I ...`).
- [ ] 验证 SPA 刷新是否正常 (回退到 index.html).

---

## 4. AetherBlog 实际生产配置说明（nginx/nginx.conf）

### 4.1 上游服务定义（upstream）

```nginx
upstream blog    { server blog:3000;       keepalive 32; }
upstream admin   { server admin:80;        keepalive 16; }
upstream backend { server backend:8080;    keepalive 64; }
upstream ai_service { server ai-service:8000; keepalive 64; }
```

- `blog` 和 `admin` 是容器内部服务名（Docker Compose network）
- `backend` 提供所有 `/api/` 路由（Go Echo 服务）
- `ai_service` 提供 `/api/v1/ai/*` 路由（Python FastAPI 服务）

### 4.2 AI 路由特殊配置（SSE 流式响应）

```nginx
# AI 推理 / 对话流式输出
location /api/v1/ai/ {
    proxy_pass http://ai_service;
    proxy_read_timeout 600s;     # AI 推理可能耗时较长
    proxy_buffering off;         # 必须关闭缓冲，SSE 才能实时推送
    proxy_set_header Connection ''; # 保持 keepalive
    chunked_transfer_encoding on;  # chunk 编码，SSE 必须
}

# AI Provider 管理
location /api/v1/admin/providers {
    proxy_pass http://ai_service;
    proxy_read_timeout 120s;
}

# AI 向量搜索
location /api/v1/admin/search/ {
    proxy_pass http://ai_service;
    proxy_read_timeout 60s;
}
```

**关键要点：**
- `proxy_buffering off` — 缺少此项会导致 SSE 事件在响应完成后才一次性推送，实时性丧失
- `proxy_read_timeout 600s` — AI 推理响应时间不可预测，必须设置足够长的超时
- `chunked_transfer_encoding on` — SSE 需要 chunked 传输编码

### 4.3 大文件上传配置

```nginx
http {
    client_max_body_size 10G;  # 全局最大请求体，支持大视频/附件上传
}

# 文件上传路由
location ~ ^/(upload|media|file) {
    proxy_pass http://backend;
    proxy_read_timeout 3600s;   # 大文件上传可能超时，3600s 对应 1 小时
}

# 静态文件访问（已上传）
location /uploads/ {
    proxy_pass http://backend;
    proxy_read_timeout 60s;
}
```

### 4.4 静态资源缓存（Next.js）

```nginx
# Next.js 构建输出的哈希静态资源（内容寻址，永不过期）
location /_next/static {
    proxy_pass http://blog;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

- `max-age=31536000` = 1 年，配合 Next.js 文件名哈希可做到永久缓存
- `immutable` 提示浏览器文件不会变更，跳过条件请求

### 4.5 SPA 支持（/admin/ 路由）

```nginx
location ^~ /admin/ {
    rewrite ^/admin/(.*)$ /$1 break;
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;  # 任何路径回退到 SPA 入口
}
```

- 使用 `^~` 防止正则规则抢占（见第 1 节）
- `try_files ... /index.html` 实现客户端路由支持

### 4.6 WebSocket 与长连接

```nginx
# WebSocket / 实时通信
location ~ ^/(ws|websocket|socket) {
    proxy_pass http://backend;
    proxy_read_timeout 3600s;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# AI 长对话 / 流式聊天
location ~ ^/(ai|chat|stream) {
    proxy_pass http://backend;
    proxy_read_timeout 600s;
}
```
