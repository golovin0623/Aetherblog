# AI Service 近 7 天代码评审问题清单（按问题）

范围：最近 7 天提交（`2026-05-05` 至 `2026-05-11`）  
参考命令：`git log --since='7 days ago' --no-merges --oneline`

- 记录中当前命令行测试快照（基于 `apps/ai-service`）  
  - `python3 -m pytest`（系统 python）先报环境兼容错误后，切到 `.venv-ci` 后为：`16 failed, 1 error`  
  - 覆盖率为 `64.57%`，低于 `--cov-fail-under=80`

> 说明：以下问题均为“审查问题”，不包含修复动作；仅给出建议与定位。

---

## 1) JWT 认证链路与测试契约不一致（高）

- 现象  
  - `tests/test_deps.py` 中 `test_require_user_*`、`test_get_current_user_valid_and_invalid` 报 5xx/断言失败。  
- 证据来源  
  - `apps/ai-service/app/core/jwt.py:33-36`：`get_cached_keys()` 为空时直接 `raise jwt.InvalidKeyError("no JWT keys available")`。  
  - `apps/ai-service/app/core/jwt_keys.py:60-68`：空缓存返回空 list（fail-closed）。  
  - `apps/ai-service/app/api/deps.py:178-183`：`require_user` 捕获任意异常并抛 `Invalid token`。  
  - `apps/ai-service/tests/test_deps.py:19-53` 仍用本地 `test-secret` 构造 token。  
  - 失败日志包含 `jwt.invalid` + `no JWT keys available`。  
- 定位  
  - 本周安全收紧 (`7124014d fix(ai): fail closed on empty jwt key cache`) 使测试环境里未预热的缓存直接拒绝 token，导致原有签名路径被截断。  
- 修复建议  
  - 测试侧注入 `get_cached_keys`（或 mock `Settings`）以提供可用密钥；  
  - 对只需语义验证的测试，改用 `get_current_user`/`require_user` 的隔离路径或 fixture 显式补齐 JWT 刷新；  
  - 增加“空 cache + 有测试 token”的契约测试，避免该安全策略与测试数据源误碰。

---

## 2) `ModelInfo` dataclass 字段演进未同步到测试构造（高）

- 现象  
  - `tests/test_model_router_service.py` 多处实例化 `ModelInfo(...)` 报 `TypeError`（缺少 `input_cost_per_1m`、`output_cost_per_1m`、`cached_input_cost_per_1m`）。  
- 证据来源  
  - `apps/ai-service/app/services/provider_registry.py:200-204,234-247`：`ModelInfo` 包含新增 1m 粒度字段且构造时要求传入。  
  - `apps/ai-service/tests/test_model_router_service.py:67-79`、`110-122`、`135-147`：构造时仍只传 `*_1k`。  
  - `apps/ai-service/tests/test_provider_routes.py:42-58`：`FakeRegistry` 的 `ModelInfo` 已带部分 1m 字段，说明模型桩不一致。  
- 定位  
  - 代码契约向 1m 字段收敛，但多个测试工厂/桩未升级，导致单测不具备结构兼容。  
- 修复建议  
  - 统一新增 `tests` 侧构造 helper（集中处理字段映射）；  
  - 为 `ModelInfo` 提供兼容构造器（保留默认/回退）以平滑 1k->1m 迁移；  
  - 补齐所有引用 `ModelInfo` 的测试场景扫描，避免隐性遗漏。

---

## 3) `providers` 路由直接在测试注入下暴露 `Depends` 对象（高）

- 现象  
  - `tests/test_provider_routes.py::test_provider_and_model_endpoints` 在 `delete_model` 步骤抛 `AttributeError: 'Depends' object has no attribute 'acquire'`。  
- 证据来源  
  - `apps/ai-service/app/api/routes/providers.py:422-426`：`delete_model` 强依赖 `pool: asyncpg.Pool = Depends(get_pg_pool)`；  
  - `apps/ai-service/app/api/routes/providers.py:433`：`async with pool.acquire()`。  
  - `apps/ai-service/tests/test_provider_routes.py:253`：测试直接调用 `delete_model(..., registry=registry)` 并未提供 `pool`。  
- 定位  
  - 路由函数设计偏重 FastAPI DI，测试不通过参数注入入口调用，造成 `Depends` 泄漏到业务逻辑。  
- 修复建议  
  - 将 db 使用抽离到 `ProviderRegistry`/服务层方法，路由只传入 `registry` 与 `pool` 默认可为 `None` 的可测入口；  
  - 或新增内部 `__delete_model_impl(pool, model_id, registry)`，测试直接注入 fake pool。  

---

## 4) `providers.get_routing` 与测试桩接口契约不对齐（中）

- 现象  
  - `tests/test_provider_routes.py::test_credential_and_routing_endpoints` 报 `AttributeError: 'FakeModelRouter' object has no attribute 'get_routing_db'`。  
- 证据来源  
  - `apps/ai-service/app/api/routes/providers.py:1120`：`get_routing` 直接调用 `model_router.get_routing_db(task_type, user_id=None)`。  
  - `apps/ai-service/app/services/model_router.py:168-204`：该方法是 `ModelRouter` 的公开契约。  
  - `apps/ai-service/tests/test_provider_routes.py:147-177`：`FakeModelRouter` 未实现 `get_routing_db`。  
- 定位  
  - 测试桩未反映真实 `ModelRouter` 对路由读路径的新接口要求。  
- 修复建议  
  - 更新测试桩：补齐 `get_routing_db` 与最小返回结构；  
  - 更稳妥是将路由调用拆成更细的 service 函数，并让测试 mock 该 service 而非内部对象细节。

---

## 5) 搜索路由对 `vector_store.llm` 的硬依赖导致 mock 无法复用（中）

- 现象  
 - 全量测试中 `test_semantic_search_content_limit` 曾出现 `AttributeError: 'MockVectorStore' object has no attribute 'llm'`。  
- 证据来源  
  - `apps/ai-service/app/api/routes/search.py:99`：`model = await vector_store.llm.resolve_embedding_model_id()`。  
  - `apps/ai-service/tests/test_search_limit.py:20-23`：`MockVectorStore` 在该测试仅实现 `semantic_search`。  
  - 失败栈明确指向 `vector_store.llm` 字段缺失。  
- 定位  
  - 路由层把内部实现细节（依赖 `llm` 属性）硬耦合进接口约束，导致测试桩必须实现更多不必要行为。  
- 修复建议  
  - 路由层从 `get_vector_store()` 分离模型解析依赖，改由独立注入 `llm_router`；  
  - 或约定 `vector_store` 接口暴露统一 `resolve_embedding_model_id()` 抽象方法（兼容 mock）。

---

## 6) `REDIS_PASSWORD`/`REDIS_URL` 组合语义与测试预期/Fixture 混乱（高）

- 现象  
  - `tests/test_redis_url_password.py` 有 6 项失败，包含：
    - `test_redis_url_unchanged_when_no_password`
    - `test_redis_url_built_from_host_port_password`
    - `test_redis_url_built_from_host_without_password`
    - `test_empty_redis_url_falls_through_to_three_var`
    - `test_explicit_redis_url_wins_over_three_var`
    - `test_redis_password_field_drives_merge`
- 证据来源  
  - `apps/ai-service/app/core/config.py:156-184`：`_merge_redis_password` 会将 `_data['redis_password']`/env 合并进 `redis_url`。  
  - `apps/ai-service/app/core/config.py:187-220`：三段式重建 `redis_url`，并把 `raw_url_env` 非空视为 override。  
  - `apps/ai-service/tests/test_redis_url_password.py` 若干处出现 `fresh_settings()()` 双括号（如 `test_redis_url_built_from_host_port_password`）。  
  - 失败输出显示：即便测试删除 `REDIS_PASSWORD`，仍可能使用环境默认 `aetherblog_dev`。  
- 定位  
  - 第一层：配置语义变化后，测试 fixture 假设与配置实现之间缺少一致化（尤其 `fresh_settings` 返回值/实例化方式）。  
  - 第二层：测试套件中的 fixture 写法有明显误用（对类实例二次调用），增加误报风险。  
- 修复建议  
  - 明确 `Settings` 构造入口：统一使用 `Settings()`（或已有工厂）而非 `fresh_settings()()`；  
  - 明确 `REDIS_PASSWORD` 空值/未设置/来自 `.env` 三种源的优先级并在验证注释+测试中同步；  
  - 为 `raw_url_env` 与三段式 fallback 场景各增加独立覆盖，固定 `os.environ` 基线。

---

## 7) E2E 测试依赖缺失 fixture（中）

- 现象  
  - `tests/e2e/test_model_fetch_flow.py` 运行报 `ERROR at setup ... fixture 'client' not found`。  
- 证据来源  
  - `apps/ai-service/tests/e2e/test_model_fetch_flow.py:12`：测试签名 `def test_fetch_remote_models_end_to_end(client, admin_headers)`。  
  - `apps/ai-service/tests/conftest.py` 仅做环境 defaults（`JWT_SECRET` 等），未提供 `client` / `admin_headers` fixture。  
- 定位  
  - 测试入口约定发生变更后，依赖迁移未同步，导致发现阶段直接失败。  
- 修复建议  
  - 在 `tests/conftest.py` 中补齐 `client` 与 `admin_headers` fixture，或重写该测试为自给式 `TestClient` 与 token 生成逻辑；  
  - 建议将 e2e fixture 放到顶层 `tests/conftest.py`，避免每文件重复定义或被误删。

---

## 8) 质量门禁风险（中）

- 现象  
  - 全量测试始终以 `coverage fail-under=80` 失败（快照 `64.57%`）。  
- 证据来源  
  - `pytest` 全量结果包含 `FAIL Required test coverage of 80% not reached.`。  
- 定位  
  - 当前变更导致测试数量/路径不稳定，既有失效测试掩盖真实回归，也拉低覆盖率基线。  
- 修复建议  
  - 优先保证现有失败测试修复后再评估新增/受影响模块覆盖；  
  - 将覆盖率检查前置为“最小可回归测试集通过 + 重点路径覆盖”，避免临时放松主门禁。

---

## 结论（本次周报）

在本周提交中，AI-Service 的主要风险集中在**安全默认（fail-closed）落地后测试契约未同步**及**接口变更后的桩/测试未对齐**。  
建议优先处理 Issue 1、2、3、6，再逐步处理 4~8，并以 `pytest` 绿灯与覆盖率恢复为验收条件。

