# 02 - Nginx 网关 / 反代 / 安全头

> 范围:`nginx/nginx.conf`(生产)/ `nginx/nginx.dev.conf`(本地 gateway dev)/ `nginx/security-headers.conf` 的 SSE 透传、限流、CSP、上游路由全集。

---

## 1. 关键文件

| 文件 | 行数 | 用途 | 加载方式 |
| --- | --- | --- | --- |
| `nginx/nginx.conf` | 422 | 生产网关 | `docker-compose.prod.yml:39` 挂到 `/etc/nginx/conf.d/default.conf:ro` |
| `nginx/nginx.dev.conf` | 255 | 本地 gateway dev | `docker-compose.dev.yml:65` 挂载;或 `start.sh:1174-1183` `docker run -v` |
| `nginx/security-headers.conf` | 23 | CSP / HSTS 等共用 | `docker-compose.prod.yml:40` 挂到 `/etc/nginx/security-headers.conf:ro`,在每个 location include |
| `apps/admin/nginx.conf` | 68 | admin 容器内 SPA 路由 + API 转发 | 容器内 `apps/admin/Dockerfile:44` 拷贝 |

---

## 2. 路由表(生产 nginx.conf)

### 2.1 location 优先级与命中顺序

nginx 内部按 `=` > `^~` > 正则(`~/~*`)> 前缀匹配。本仓库实际声明顺序:

```
nginx/nginx.conf 行  匹配           upstream            用途
─────────────────  ─────────────   ──────────────────  ────────────────────
122-124            = /admin        301 → /admin/       SPA base 修复
126-132            /admin/         admin:8080          SPA 主入口
135-143            /admin/assets/  admin:8080          静态资源,1d immutable
152-174            ^~ /api/v1/ai/  ai-service:8000     AI 流式,边缘限流 10r/min
176-183            ^~ /api/v1/admin/providers ai-service provider 管理
194-204            ^~ /api/v1/admin/search backend     索引/重建,长超时
205-218            ^~ /api/v1/public/search backend    公开搜索 + SSE QA
227-239            ^~ /api/v1/agent backend            Agent SSE
240-259            ~ ^/api/(ai|chat|stream) backend    老 SSE 兼容
265-279            ~ ^/api/(ws|websocket|socket) backend WebSocket
288-303            ~ ^/api/(upload|media|file) backend 大文件 10G + 1h timeout
313-326            /uploads/       backend /api/uploads/ 用户上传文件
332-345            ~ ^/uploads/.+\.(svg|svgz|xml|html|htm)$ 强制 attachment
350-357            = /api/v1/auth/login backend       登录,边缘限流 5r/min
364-375            /api            backend             兜底,边缘限流 30r/s
380-388            /_next/static   blog:3000           静态资源,1y immutable
393-404            /               blog:3000           博客前台默认
409-414            /health         200 'OK'            网关自身健康检查
417-421            error_page 502/503/504 → /50x.html  错误页
```

### 2.2 容器服务名 → upstream

`nginx.conf:60-79`:

```nginx
upstream blog       { server blog:3000       max_fails=3 fail_timeout=10s; keepalive 32; }
upstream admin      { server admin:8080      max_fails=3 fail_timeout=10s; keepalive 16; }
upstream backend    { server backend:8080    max_fails=3 fail_timeout=10s; keepalive 64; }
upstream ai_service { server ai-service:8000 max_fails=3 fail_timeout=10s; keepalive 64; }
```

`max_fails=3 / fail_timeout=10s`(VULN-148):上游连续失败时短暂摘掉,避免 worker 阻塞。当前 single-host 只有一个 server,留作未来横向扩的 placeholder。

`keepalive` 数值:backend / ai_service 给 64,因为 SSE 长连接多;blog/admin 静态较多给 16-32。

---

## 3. SSE / 流式响应透传

### 3.1 标准 SSE 配方(在所有流式 location 重复)

`nginx.conf:152-174`(`/api/v1/ai/`)是范本:

```nginx
proxy_set_header Connection "";              # 不传 Connection: close,保持长连接
proxy_buffering off;                         # 关闭代理响应缓冲(SSE 关键)
proxy_cache off;                             # 关闭缓存
proxy_connect_timeout 60s;
proxy_send_timeout 600s;                     # 10 分钟,thinking 模型可能很慢
proxy_read_timeout 600s;
chunked_transfer_encoding on;                # 强制 chunked(分片)
add_header X-Accel-Buffering no;             # 应用层补:即便客户端有反向代理也别再 buffer
include /etc/nginx/security-headers.conf;
```

### 3.2 哪些 location 必须开 SSE 透传

| location | 文件:行 | 触发场景 |
| --- | --- | --- |
| `^~ /api/v1/ai/` | nginx.conf:152 | LiteLLM 流式 chat completion |
| `^~ /api/v1/public/search` | nginx.conf:205 | 公开搜索 SSE QA |
| `^~ /api/v1/agent` | nginx.conf:227 | Agent 工作台,thinking 模型可能数十秒 first token |
| `~ ^/api/(ai\|chat\|stream)` | nginx.conf:240 | 老 SSE 路径,兼容 |

### 3.3 历史踩坑:60s 默认超时

`nginx.conf:222-226` 注释:**"POST /api/v1/agent/chat 是 SSE 长流,thinking 模型可能在首个 token 前暂停数十秒;落到默认 /api 的 60s 超时会被 nginx 切断(codex review #575)"**。所以同款 `proxy_buffering off + 600s read timeout` 复制到了 `/api/v1/agent`。

### 3.4 nginx 行为:`add_header` 不继承

server 块的 `add_header` 一旦在子 location 出现 `add_header`,**全部父级头都不再下发**。这就是为什么 `nginx/security-headers.conf` 把头集中到一个文件,在每个需要的 location 里 `include`。

例外是 `nginx.dev.conf:174-197`(`/uploads/` 与可执行文件 location):没用 include,所以在每个块里手动重声明全部 4 个安全头 + CSP。注释写得很 explicit:**"location 一旦出现 add_header,server 块的全部 add_header 都会被压制。下面必须重新声明全局安全头"**。

---

## 4. 限流(VULN-125)

`nginx.conf:42-48`:

```nginx
limit_req_zone $binary_remote_addr zone=edge_api:10m   rate=30r/s;
limit_req_zone $binary_remote_addr zone=edge_login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=edge_ai:10m    rate=10r/m;
limit_conn_zone $binary_remote_addr zone=edge_conn:10m;
```

应用:

| location | limit_req | limit_conn |
| --- | --- | --- |
| `/api/v1/ai/` | `edge_ai burst=5 nodelay` | `edge_conn 4` |
| `/api/v1/auth/login` | `edge_login burst=3 nodelay` | — |
| `/api`(兜底) | `edge_api burst=20 nodelay` | `edge_conn 50` |

设计:
- 边缘**保护 LLM provider 账单**(`edge_ai` 10r/min)
- 边缘**抗登录爆破**(`edge_login` 5r/min)
- 后端 Redis fail-closed 限流(VULN-070)仍然存在,精细 per-user 配额由后端控制
- 双层防护:边缘挡 IP 洪流,后端挡用户洪流

dev `nginx.dev.conf` **没有限流**,本地调试不卡。

---

## 5. CSP / 安全响应头

### 5.1 `security-headers.conf` 完整内容

```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-XSS-Protection "0" always;     # 现代浏览器都禁用,但保留兼容老 IE
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()" always;
add_header Content-Security-Policy $csp_header always;
add_header Strict-Transport-Security $hsts_header always;
```

依赖在 `nginx.conf:21-40` 的两个 `map`:

### 5.2 HSTS 条件下发(VULN-127)

```nginx
map $scheme $hsts_header {
    https    "max-age=63072000; includeSubDomains; preload";
    default  "";
}
```

为什么:HTTP 调试时下发 HSTS 会让浏览器永久 pin 到 HTTPS,后续 `http://localhost:7899` 直接断网。所以只在 `$scheme=https` 时下发。

### 5.3 CSP 主体(VULN-128)

```nginx
map $request_uri $csp_header {
    default "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; img-src 'self' data: https: blob:; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self' https:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self';";
}
```

放行解读:
- `'unsafe-inline'`(script + style):Next.js 15 生产构建依赖。nonce 方案是 P3 后续(`security-headers.conf:13-17`)
- `'wasm-unsafe-eval'`:**博客文章详情页 Shiki(Oniguruma WASM)语法高亮**;`apps/admin/nginx.conf:24-25` 的 admin CSP 同步放行(编辑器预览)。**`'wasm-unsafe-eval'` 只放行 WebAssembly,不等同于 `'unsafe-eval'`(后者放行 `eval/new Function`)**
- `style-src` 放 `https://fonts.googleapis.com` + `https://cdn.jsdelivr.net`:blog 的 article font 切换会注入 `<link href="fonts.googleapis.com">`;admin 用 jsdelivr 加载图标字体
- `font-src` 同款放行 `https://fonts.gstatic.com` + `https://cdn.jsdelivr.net`
- `frame-ancestors 'none'`:与 `X-Frame-Options: DENY` 双保险防 clickjacking

### 5.4 admin 容器内 nginx 的 CSP 必须对齐

`apps/admin/nginx.conf:26` 的 admin 直连 CSP 与上面**完全一致**(放行 `https://fonts.googleapis.com` / `https://cdn.jsdelivr.net` / `'wasm-unsafe-eval'`)。注释里 explicit:**"VULN-149: 任何修改需要同步两处"**。历史事故:**2026-04-17 PR #459 漏同步本行导致 /admin/ 字体被拦**。

### 5.5 nginx.dev.conf 的安全头

dev 环境没用 include 模式,而是在 server 块直接 `add_header`(`nginx.dev.conf:36-46`)。CSP 不同:
- `script-src ... 'unsafe-eval'`(允许 Vite HMR)
- `connect-src 'self' ws://localhost:5173 ws://localhost:3000`(放行 Vite + Next HMR WebSocket)
- 没有 HSTS

### 5.6 `/uploads/` 的额外 CSP 收紧

`nginx.conf:332-345`(强制 attachment 模式):

```nginx
location ~ ^/uploads/.+\.(svg|svgz|xml|html|htm)$ {
    rewrite ^/uploads/(.*)$ /api/uploads/$1 break;
    proxy_pass http://backend;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Content-Disposition "attachment" always;
    add_header Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'" always;
    include /etc/nginx/security-headers.conf;
}
```

防止用户上传可脚本文件后被同源嗅探执行(VULN-049 / -030 历史):
1. `nosniff` 防 MIME 嗅探
2. `Content-Disposition: attachment` 强制下载
3. 局部 CSP `default-src 'none'` 阻止任何资源加载

---

## 6. 大文件上传

`nginx.conf:288-303`:

```nginx
location ~ ^/api/(upload|media|file) {
    proxy_pass http://backend;
    client_max_body_size 10G;          ← 视频/备份场景
    client_body_buffer_size 16M;
    proxy_connect_timeout 60s;
    proxy_send_timeout 3600s;          ← 1 小时
    proxy_read_timeout 3600s;
    proxy_request_buffering off;       ← 边收边传,不在 nginx 落盘
}
```

`nginx.conf:285-287` 注释:**"VULN-130 回退:恢复 10GB 上传额度。网关不再作为资源耗尽前置闸门 —— 由后端限流 + 磁盘配额 + IP 限速(edge_api zone)共同承担"**。如果确认不再需要 >2GB,单独改此处即可。

dev `nginx.dev.conf:203-218` 同款配置。

---

## 7. WebSocket 透传

### 7.1 通用 connection_upgrade map

`nginx.conf:13-16` / `nginx.dev.conf:8-11`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
```

### 7.2 backend WebSocket(`/api/(ws|websocket|socket)`)

`nginx.conf:265-279`:1 小时 read_timeout,`proxy_buffering off`。

### 7.3 默认 location `/`

`nginx.conf:393-404`:

```nginx
location / {
    proxy_pass http://blog;
    proxy_set_header Upgrade $http_upgrade;        ← Next.js HMR
    proxy_set_header Connection $connection_upgrade;
    ...
}
```

生产其实不需要 HMR,但留这两行无害(`Upgrade: websocket` 没设时 `Connection: close`)。

### 7.4 dev nginx 的 Vite HMR 全套

`nginx.dev.conf:62-92` 把 Vite 内部所有路径都映射到宿主机 :5173:
- `/@vite/` HMR client
- `/@react-refresh` React HMR
- `/@id/` 模块解析
- `/src/` 源文件
- `/@fs/` 文件系统访问
- `/node_modules/` 依赖

少了任何一个,Vite admin 在网关下都会黑屏。

---

## 8. 静态资源缓存

| location | 缓存策略 | 文件:行 |
| --- | --- | --- |
| `/_next/static` | `expires 1y` + `immutable` | nginx.conf:380-388 |
| `/admin/assets/` | `expires 1d` + `immutable` | nginx.conf:135-143 |
| `/uploads/`(普通文件) | `expires 7d` + `public` | nginx.conf:313-326 |
| `/health` | `access_log off` | nginx.conf:409-414 |

为什么 admin 1d 而不是 1y:Vite 构建文件名也带 hash,本可以 1y;但留 1d 给应急强刷场景。

---

## 9. nginx.dev.conf vs nginx.conf 差异速查

| 特性 | nginx.dev.conf | nginx.conf |
| --- | --- | --- |
| upstream | `host.docker.internal:5173/3000/8080/8000` | docker network 服务名 `blog/admin/backend/ai-service` |
| 限流 | 无 | edge_api / edge_login / edge_ai 三档 |
| HSTS | 无(注释提示启 HTTPS 时取消) | map 条件下发 |
| CSP | 行内 add_header,放行 ws + unsafe-eval(Vite HMR) | include security-headers.conf,无 unsafe-eval |
| Vite HMR 路径 | 6 个专用 location(`/@vite/` 等) | 不需要 |
| `proxy_intercept_errors` | 默认 | 默认 |
| `server_tokens` | 默认显示 | `off`(VULN-126) |
| `resolver` | 默认 | `127.0.0.11 valid=10s`(Docker DNS) |
| `add_header` 兜底 | location 内手动重声明 | include security-headers.conf |

---

## 10. nginx 加固速查

| 加固点 | 位置 | VULN |
| --- | --- | --- |
| 隐藏版本号 | `nginx.conf:51 server_tokens off` | VULN-126 |
| Connection map | `nginx.conf:13-16` | — |
| upstream max_fails / fail_timeout | `nginx.conf:60-79` | VULN-148 |
| edge limit_req | `nginx.conf:42-48` | VULN-125 |
| HSTS conditional | `nginx.conf:21-24` map | VULN-127 |
| CSP wasm-unsafe-eval | `nginx.conf:35-40` map | VULN-128 |
| /uploads/ attachment | `nginx.conf:332-345` | VULN-049 / -030 |
| docker daemon resolver | `nginx.conf:54` | — |
| admin 容器 nginx-unprivileged | `apps/admin/Dockerfile:37` | VULN-124 |

---

## 11. 已知限制

1. **`nginx.dev.conf` 没用 `include security-headers.conf`** — dev 模式所有 location 都没继承父级 add_header(因为只在 server 块声明)。`/uploads/` location 已手动重声明,但 `/api`、`/admin/`、`/` 这些主路径在 dev 下没有 nosniff/X-Frame-Options 等。生产 OK,dev 检查 head 时会少一些。
2. **没有 HTTPS 终结配置** — 生产实际部署预期前面再套一层(Cloudflare / cdn / 单独 caddy),仓库里 `nginx.conf` 永远 `listen 80`。HSTS map 已经为 HTTPS ready,但 `listen 443 ssl` + cert 路径需要部署侧自己加。
3. **`set_real_ip_from` 没设** — 走 CDN 时 nginx 看到的是 CDN IP,不是真实客户端 IP,`X-Forwarded-For` 链可被伪造。生产对接 Cloudflare 时需要在 `nginx.conf` 头部加上 CF 的 IP 段。
4. **CSP 仍带 `'unsafe-inline'`** — Next.js 15 inline style 限制,nonce 方案需要 middleware 改造,跟踪为 P3。
5. **`/api/(ai|chat|stream)` 老兼容路径已无业务路由命中** — 但保留以防回归;实际 SSE 走 `/api/v1/ai/` 与 `/api/v1/agent`。
6. **edge_login 5r/min 对真人用户不友好** — 一次输错密码 + 重试 + 又一次错就触发限流。后端 RateLimitByIP 是真正的精细层,边缘只是防爬虫扫描器。
7. **`upstream backend` 单 server 声明** — 横向扩 backend 时需要多个 `server backend1:8080;` 行,目前是 placeholder。
