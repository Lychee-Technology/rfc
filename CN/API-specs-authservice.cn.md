# LTBase API 规格：Auth Service（终端用户 Token 服务）

本文档描述独立终端用户 token 服务 `cmd/authservice` 已实现的 HTTP API 契约：provider 登录换取、身份绑定、token 刷新/吊销，以及公开 profile 查询。

- 代码基线：
  - `ltbase.api/cmd/authservice`
  - `ltbase.api/internal/authservice/routes.go`（权威路由表）
  - `rfc/CN/aaa.md`
- 文档语言：中文
- 更新日期：2026-07-17

## 1. 总览

Auth service 是 LTBase 部署中的终端用户 token 服务。它作为 AWS Lambda 运行在 API Gateway v2（HTTP API）之后，负责：

- 将上游 IdP 已认证的身份换取为 LTBase access/refresh token 对（`login/{provider}`）
- 使用邀请/推荐码将新的外部身份绑定到项目用户，并受 binding policy 治理（`id_bindings/{provider}`）
- 带重放检测的 refresh token 轮换（`auth/refresh`）以及 refresh 链吊销（`auth/revoke`）
- 项目内公开 profile 查询（`auth/profile/{user_id}`）

命名空间归属说明：`/api/v1/auth/*` 命名空间由两个服务分治。本文档描述由 `cmd/authservice` 提供的终端用户 token 路由；同一命名空间下的 admin 管理面（users、roles、policies、binding policies、referrals 的 CRUD）由 control plane 提供，见 `API-specs-control-plane-service-auth-routes.cn.md`。两者的路由集互不重叠。

路由面的唯一真实来源是 `ltbase.api/internal/authservice/routes.go` 中的 `handlerRouteTable()`；请求分发与发布的 `routes-manifest.json` 都由它派生。

## 2. 认证、作用域与通用约定

### 2.1 信任模型

服务本身不校验调用方的凭证。API Gateway 的 JWT authorizer 在上游校验 bearer token，并把校验后的 claims 传给 Lambda；handler 从 `RequestContext.Authorizer.JWT.Claims` 读取。

- 对 `login/{provider}` 与 `id_bindings/{provider}`，authorizer token 是**上游 IdP token**（如 Firebase）。handler 消费其 `sub`、`iss` 以及其他身份 claims（`email`、`name`、`display_name` 等）。
- 对 `auth/refresh`，authorizer token 就是 **LTBase 签发的 refresh token** 本身（见 §5.4）。
- 对 `auth/profile/{user_id}`，authorizer token 必须携带 `project_id` claim（LTBase access token 满足此条件）。
- `auth/health` 是唯一不带 authorizer 的路由。

### 2.2 项目作用域

服务运行在单项目作用域下：部署项目通过 `PROJECT_ID` 配置。请求可携带 `project_id`（在 body 中，或对 login 而言在 claim 中），解析顺序为：请求 body → authorizer claim（仅 login）→ 配置默认值。任何显式提供的值都必须是合法 UUID 且等于配置的默认值，否则请求被拒（`invalid_project_id` / `invalid_project_scope`）。

### 2.3 请求/响应约定

- 所有请求体均为 JSON；所有响应均为 JSON，`Content-Type: application/json`。
- 无 envelope：成功负载是扁平对象（不像 control-plane admin API 那样有 `request_id` 包裹）。
- 每个错误响应形如：

```json
{ "error": "<error_code>" }
```

- 未知路由返回 `404 {"error":"not_found"}`。
- 被恢复的 panic 返回 `500 {"error":"internal_error"}`。

### 2.4 JWKS 发布

服务的签名公钥**不由任何路由提供**。此前的 `GET /auth/jwks.json` 路由已被移除，现在返回 `404 not_found`。JWKS 文档作为静态发布产物发布，托管在 `AUTH_JWKS_URL` 配置的 URL 上；服务在 refresh 时会拉取该 URL，用于校验自己此前签发的 access token。JWK 格式：`{"kty":"RSA","alg":"RS256","use":"sig","kid":"...","n":"...","e":"..."}`。

## 3. 路由总表

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/auth/health` | 存活检查 |
| POST | `/api/v1/login/{provider}` | 将上游身份换取为 LTBase token 对 |
| POST | `/api/v1/id_bindings/{provider}` | 绑定外部身份（带邀请/推荐码）并签发 token |
| POST | `/api/v1/auth/refresh` | 将 refresh token 轮换为新的 token 对 |
| POST | `/api/v1/auth/revoke` | 吊销一条 refresh 链 |
| GET | `/api/v1/auth/profile/{user_id}` | 项目内公开 profile 查询 |

`{provider}` 路由在路由 manifest 中带 `expand: provider` 标记（`routemanifest.ExpandProvider`）：部署为每个已配置的 provider 声明一条具体的 gateway 路由。provider 路径值会被转为小写，且必须在 `AUTH_PROVIDERS` 允许列表内。

## 4. Token 模型

### 4.1 签名

所有 token 都是 RS256 签名的 JWT。两种签名模式（`AUTH_SIGNER_MODE`）：

- **`kms`**（默认）：通过 AWS KMS 签名（`RSASSA_PKCS1_V1_5_SHA_256`）；需要非对称 RSA_2048/3072/4096 key。JWT 的 `kid` header 为 KMS key ID。
- **`file`**：使用本地 OpenSSH RSA 私钥签名（可带口令加密）。`kid` 解析顺序为 `LTBASE_JWT_KID` → `AUTH_LOCAL_KEY_ID` → 私钥文件名主干 → `local-file-key`。

历史说明：服务最初使用 Ed25519（EdDSA）签名，后迁移到 RS256。`cmd/authservice/ed25519/` 密钥对是遗留产物；当前代码中不存在 Ed25519 签名路径。当前使用的本地文件密钥对位于 `cmd/authservice/rsa256/`。

### 4.2 Access Token Claims

默认 TTL：75 分钟（`AUTH_ACCESS_TTL`）。

```json
{
  "iss": "<AUTH_ISSUER>",
  "aud": ["<project_id>"],
  "sub": "<user_id>",
  "role_ids": ["role.employee"],
  "project_id": "<project_id>",
  "api_base_url": "https://api.example.com",
  "iat": 1700000000,
  "exp": 1700004500,
  "jti": "<random id>",
  "token_use": "access",
  "auth_time": 1700000000,
  "email": "user@example.com"
}
```

- `aud` 为 `[project_id]`；当设置了 `AUTH_ACCESS_AUD` 时为 `[project_id, AUTH_ACCESS_AUD]`。
- `role_ids` 是经层级展开后的用户角色列表。
- 由 refresh 签发的 access token 中，`auth_time` 沿用原始 session 的签发时间，`email` 为空。

### 4.3 Refresh Token Claims

默认 TTL：672 小时 / 28 天（`AUTH_REFRESH_TTL`）。

```json
{
  "iss": "<AUTH_ISSUER>",
  "aud": "<AUTH_REFRESH_AUD>",
  "sub": "<user_id>",
  "project_id": "<project_id>",
  "api_base_url": "https://api.example.com",
  "iat": 1700000000,
  "exp": 1702419200,
  "jti": "<random id>",
  "session_id": "<random id>",
  "token_use": "refresh"
}
```

### 4.4 轮换与重放检测

每次成功的 exchange 或 refresh 都会持久化一条以 refresh token 的 `jti` 为键的 refresh session，并通过 `parent_jti` 关联其父节点。在 refresh 时：

- 过期的 refresh token 会以原因 `expired` 吊销其链并返回 `refresh_expired`；
- 已吊销的 session 返回 `refresh_revoked`；
- 复用已轮换过的 refresh token 会以原因 `refresh_reuse` 吊销**整条链**并返回 `refresh_revoked`。

成功的 exchange、refresh、revoke、binding 操作各自写入一条 audit 记录（`action`：`exchange` / `refresh` / `revoke` / `id_binding`）。

## 5. 端点

### 5.1 `GET /api/v1/auth/health`

用途：存活检查。无 authorizer，无参数。

响应（`200 OK`）：

```json
{ "status": "ok" }
```

### 5.2 `POST /api/v1/login/{provider}`

用途：将上游 IdP 已认证的身份换取为 LTBase token 对。身份必须已绑定（见 §5.3），否则返回 `403 identity_unbound`。

Authorizer：上游 IdP JWT。消费的 claims：`sub`（必填）、`iss`（必填）、`project_id`（可选）。

请求体（可选，可为空）：

```json
{ "project_id": "11111111-1111-4111-8111-111111111111" }
```

处理流程：解析项目作用域（§2.2）→ 对照允许列表校验 provider → 要求 `sub`/`iss` → 解析项目的 API base URL → 查找已绑定用户 → 更新 `last_login` → 列出并展开角色 → 签发 token 对。

响应（`200 OK`；注意：login 不返回 `expires_at`）：

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "api_base_url": "https://api.example.com"
}
```

错误：

| Status | `error` | 触发条件 |
| --- | --- | --- |
| 400 | `invalid_body` | body 存在但非合法 JSON |
| 400 | `project_id_required` / `invalid_project_id` / `invalid_project_scope` | 项目作用域解析失败（§2.2） |
| 400 | `invalid_provider` | provider 不在 `AUTH_PROVIDERS` 允许列表内 |
| 400 | `missing_identity` | authorizer 的 `sub` 或 `iss` 为空 |
| 400 | `project_not_configured` | 项目未配置 API base URL |
| 403 | `identity_unbound` | 身份没有绑定用户 |
| 409 | `identity_inconsistent` | 存储的身份状态不一致 |
| 500 | `user_lookup_failed` / `update_last_login_failed` / `role_list_failed` / `role_expand_failed` / `exchange_failed` | 下游失败 |

### 5.3 `POST /api/v1/id_bindings/{provider}`

用途：使用邀请/推荐码将外部身份绑定到项目用户，随后签发 token 对。绑定受 binding policy 引擎治理（见下）。

Authorizer：上游 IdP JWT。消费的 claims：`sub`（必填）、`iss`（必填）；所有身份 claims（如 `email`、`name`、`display_name`）都会作为 `identity_claims` 存储到用户上。

请求体（必填）：

```json
{
  "bind_context": {
    "code": "invite-code-1",
    "project_id": "11111111-1111-4111-8111-111111111111"
  }
}
```

响应（`200 OK`）：形状与 login 相同——`access_token`、`refresh_token`、`api_base_url`。

Binding policy：按项目加载已启用的 policy；当不存在任何 policy 时，应用内置回退 policy `referral.default`，要求 `referral_valid == true`。规则形如 `{l, c, a, v}`（左操作数、比较符、动作、值），在上下文字段 `project_id, provider, issuer, sub, email, code, referral_exists, referral_used, referral_valid` 上求值。比较符：`eq, ne, exists, not_exists, truthy, falsy, contains, prefix, in, not_in`；动作：`must`（亦作 `require`/`allow_if`）与 `deny_if`（亦作 `deny`）。是否执行由 `AUTH_BINDING_POLICY_SHADOW_MODE`（仅求值与审计、永不拒绝）与 `AUTH_BINDING_POLICY_ALLOWLIST`（仅对列出的项目执行；为空 = 全部）控制。`REFERRAL_REQUIRED=true` 会在没有任何已存 policy 含 referral 规则时追加默认 referral 规则。

若身份已绑定到某用户，绑定调用会解析出已有用户、刷新其推荐码记录，并仍返回 token 对（幂等重绑）；只有当已有用户无法被一致地解析时才返回 `identity_bound`。

错误：

| Status | `error` | 触发条件 |
| --- | --- | --- |
| 400 | `invalid_body` | body 缺失或非合法 JSON |
| 400 | `project_id_required` / `invalid_project_id` / `invalid_project_scope` | 项目作用域解析失败（§2.2） |
| 400 | `invalid_code` | `bind_context.code` 为空 |
| 400 | `invalid_provider` | provider 不在允许列表内 |
| 400 | `missing_identity` | authorizer 的 `sub` 或 `iss` 为空 |
| 409 | `invalid_code` | 需要 referral/referral 无效，或 binding policy 拒绝（执行模式下） |
| 409 | `identity_bound` | 身份已绑定且无法解析到用户 |
| 409 | `identity_inconsistent` | 存储的身份状态不一致 |
| 500 | `id_binding_failed` | 其他下游失败 |

### 5.4 `POST /api/v1/auth/refresh`

用途：将 refresh token 轮换为新的 access/refresh 对。

Authorizer：**LTBase refresh token** 作为 gateway bearer token 呈递。消费的 claims：`iss, aud, sub, project_id, api_base_url, iat, exp, jti, session_id`；其中 `project_id`、`jti`、`exp` 为必需（否则 `refresh_invalid`）。

请求体（必填）：

```json
{ "access_token": "<当前 access jwt>" }
```

提供的 `access_token` 会对照 `AUTH_JWKS_URL` 的 JWKS 校验：RS256 签名（按 `kid` 选择密钥）、`token_use` 必须为 `access`、`iss` 必须等于配置的 issuer。其过期时间**故意不校验**——在 access token 过期后刷新是正常场景。校验失败 → `401 access_invalid`。

响应（`200 OK`；`expires_at` 是新 access token 的过期时间，Unix 秒）：

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "expires_at": 1700004500
}
```

错误：

| Status | `error` | 触发条件 |
| --- | --- | --- |
| 400 | `invalid_body` | body 非合法 JSON |
| 400 | `access_token_required` | `access_token` 为空 |
| 401 | `access_invalid` | access token 未通过 JWKS/`token_use`/issuer 校验 |
| 401 | `refresh_invalid` | refresh claims 不完整，或 session 校验因其他原因失败 |
| 401 | `refresh_expired` | refresh token 已过期（链以原因 `expired` 吊销） |
| 401 | `refresh_revoked` | session 已吊销，或检测到已轮换 token 的复用（链以原因 `refresh_reuse` 吊销） |

### 5.5 `POST /api/v1/auth/revoke`

用途：吊销一条 refresh 链（如登出、凭证泄露）。

请求体：

```json
{
  "project_id": "11111111-1111-4111-8111-111111111111",
  "jti": "<refresh token jti>",
  "reason": "manual_revoke"
}
```

`reason` 可选，默认为 `manual_revoke`。吊销作用于以给定 `jti` 为根的整条链。

响应（`200 OK`）：

```json
{ "status": "revoked" }
```

错误：

| Status | `error` | 触发条件 |
| --- | --- | --- |
| 400 | `invalid_body` | body 非合法 JSON |
| 400 | `project_id_required` / `invalid_project_id` / `invalid_project_scope` | 项目作用域解析失败（§2.2） |
| 400 | `jti_required` | `jti` 为空 |
| 500 | `revoke_failed` | 下游失败 |

### 5.6 `GET /api/v1/auth/profile/{user_id}`

用途：公开 profile 查询，限定在调用方所属项目内。项目内任意已认证调用方都可读取同项目的公开 profile。

消费的 authorizer claim：`project_id`（必需 → 否则 `401 auth_required`）。

路径参数：`{user_id}`。

响应（`200 OK`；时间戳为 Unix **毫秒**；`email`、`display_name`、`primary_ou_id`、`report_to_user_id` 为空时省略；`display_name` 优先取 `display_name` 身份 claim，回退到 `name`）：

```json
{
  "profile": {
    "user_id": "user-123",
    "email": "user@example.com",
    "display_name": "User Name",
    "primary_ou_id": "ou-1",
    "report_to_user_id": "user-456",
    "created_at": 1700000000000,
    "updated_at": 1700000000000,
    "last_login_at": 1700000000000
  }
}
```

错误：

| Status | `error` | 触发条件 |
| --- | --- | --- |
| 400 | `user_id_required` | 路径中的 `user_id` 为空 |
| 401 | `auth_required` | authorizer 无 `project_id` claim |
| 404 | `user_not_found` | 项目内无该用户 |
| 500 | `profile_lookup_failed` | 下游失败 |

## 6. 配置附录

契约相关的环境变量（`internal/authservice/config.go`，在 `cmd/authservice` 装配处加载）：

| 环境变量 | 必需 | 默认 | 含义 |
| --- | --- | --- | --- |
| `AUTH_ISSUER` | 是 | — | JWT `iss` 值 |
| `AUTH_REFRESH_AUD` | 是 | — | refresh token 的 `aud` |
| `AUTH_ACCESS_AUD` | 否 | 空 | access token 的额外 `aud` 条目 |
| `AUTH_ACCESS_TTL` | 否 | `75m` | access token 生命周期（Go duration） |
| `AUTH_REFRESH_TTL` | 否 | `672h` | refresh token 生命周期 |
| `AUTH_JWKS_URL` | 是 | — | refresh 时校验 access token 所用的 JWKS URL |
| `PROJECT_ID` | 是 | — | 部署项目（UUID）；单项目作用域 |
| `AUTH_DEFAULT_API_BASE_URL` | 否 | 空 | 回退 `api_base_url` |
| `AUTH_PROJECT_API_BASE_URLS` | 否 | `{}` | JSON 映射 `{project_id: url}` |
| `AUTH_SIGNER_MODE` | 否 | `kms` | `kms` 或 `file`（§4.1） |
| `AUTH_KMS_KEY_ID` | `kms` 时 | — | KMS 非对称 RSA key |
| `AUTH_LOCAL_PRIVATE_KEY_PATH` | `file` 时 | — | OpenSSH RSA 私钥路径 |
| `AUTH_LOCAL_PRIVATE_KEY_PASSWORD` | 否 | 空 | 私钥口令 |
| `AUTH_LOCAL_PUBLIC_KEY_PATH` | 否 | 空 | 可选公钥（须与私钥匹配） |
| `LTBASE_JWT_KID` / `AUTH_LOCAL_KEY_ID` | 否 | 密钥文件名主干 | file 模式下的 JWT `kid` |
| `AUTH_PROVIDERS` | 是 | — | provider 的 CSV 允许列表（如 `firebase,github`） |
| `REFERRAL_REQUIRED` | 否 | `false` | 强制将 referral 规则加入 binding policy |
| `AUTH_BINDING_POLICY_SHADOW_MODE` | 否 | `false` | 求值 binding policy 但不执行 |
| `AUTH_BINDING_POLICY_ALLOWLIST` | 否 | 空（= 全部） | 执行 policy 的项目 ID 的 CSV |

存储后端选择（`cmd/authservice/config.go`）：`AUTH_STORE_BACKEND`（`dynamodb`，默认；或 `postgres`；回退到 `CONTROLPLANE_STORE_BACKEND`）。DynamoDB 表名解析顺序 `AUTH_IDENTITY_TABLE_NAME` → `DYNAMODB_TABLE_NAME` → `LTBASE_TABLE_NAME`（已弃用）；Postgres schema 解析顺序 `CONTROLPLANE_PROJECT_SCHEMA` → `DSQL_PROJECT_SCHEMA` → `ltbase`。

## 7. 相关文档

- `aaa.md` —— 权威的 AAA 模型：身份模型、确定性 user ID、login/binding 时序、JWT 设计。
- `API-specs-control-plane-service-auth-routes.cn.md` —— 共享 `/api/v1/auth/*` 命名空间的 control-plane admin 管理面（users/roles/policies/binding policies/referrals 的 CRUD）。
- `API-specs-data-plane.cn.md` —— 消费此处签发 access token 的 data plane API。
- `IdentityArchitecture.md`（EN）—— 仅作设计背景；其 `/oauth/token` 与 `/oauth/revoke` 端点是愿景设计，与本文档中已实现的路由不一致。
