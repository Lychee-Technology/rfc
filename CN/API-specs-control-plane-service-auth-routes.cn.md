# LTBase API 规格：Auth Service

本文档描述独立的 control-plane gateway/domain 下 `/api/v1/auth/...` 已实现的管理 REST API 合约。

- 代码基线：
  - `ltbase.api/cmd/controlplane`
  - `ltbase.api/internal/routemanifest/controlplane.go`（权威路由表）
  - `rfc/CN/aaa.md`
- 文档语言：中文
- 更新日期：2026-07-16

## 1. 总览

Control-plane admin REST surface 按路由族拆分：

- `/api/v1/auth/...`：AAA 配置与 referral 管理
- `/api/v1/org/...`：组织架构与 OU 管理
- 运维与目录路由（status、repair、catalogs 等）

本文档覆盖 `/api/v1/auth/...` 路由：

- auth 配置快照读取，用于初始化与检查
- AAA 配置管理：用户、角色、统一策略、principal policy attachment、binding policy、referral
- 与 `rfc/CN/aaa.md` 对齐的 policy-first 授权模型

`/api/v1/org/...` 路由、运维路由与 `/control-plane` 运维 actions 见 `API-specs-control-plane.cn.md`。

路由服务方式：

- 所有路由同时挂载在 `/api/v1/...` 与 `/api/control-plane/v1/...` 两个前缀下，行为一致。
- referral 路由双挂载：`/auth/referrals...` 与顶层 `/referrals...` 是同一 handler 的两个别名。
- `GET /api/v1/auth-config` 是 `GET /api/v1/auth/config` 的 legacy 别名。

命名空间归属说明：`/api/v1/auth/*` 命名空间由两个服务分治。`cmd/authservice` 是独立的终端用户 token 服务，提供 `health`、`refresh`、`revoke`、`profile/{user_id}` 以及 `login/{provider}`、`id_bindings/{provider}` 等身份路由（见 `internal/authservice/routes.go` 与 `API-specs-authservice.cn.md`）；本文档描述的是 control plane 提供的 admin 管理面，两者互不重叠。

## 2. 认证、作用域与公共约定

### 2.1 Admin 鉴权

Control-plane admin REST API 使用 Bearer JWT 认证，鉴权基于 **admin policy 绑定**（`api_authorizer.go`）：

- 请求无 JWT claims 时返回 `401 unauthorized`。
- 授权条件：调用者（JWT subject 对应的用户）通过 `principal_policy_attachment` 持有 **slug 为 `admin.controlplane` 的 policy**（直接绑定，或经 role 间接绑定）。
- 当项目中尚不存在携带该 slug 的 policy（例如 slug 回填之前的旧部署）时，回退检查 legacy policy id `generated#permission#controlplane.admin`（旧迁移产物）。
- 鉴权不检查 role slug，也不检查 policy document 的内容——这是单一的、基于绑定的授权。

未认证请求返回：

```json
{
  "request_id": "req_123",
  "code": "unauthorized",
  "message": "admin authentication required"
}
```

已认证但未持有 admin policy 的请求返回：

```json
{
  "request_id": "req_123",
  "code": "forbidden",
  "message": "admin policy required"
}
```

所有 `/api/v1/auth/...` 路由（任意 method）均要求 admin。未知路由在鉴权之后才返回 404。

**唯一例外：CORS preflight。** 任何 `OPTIONS` 请求在鉴权与路由匹配**之前**直接返回 `204 No Content`（仅带 CORS 头，无响应体，因此也没有 `request_id` envelope）。preflight 不是正常的 API 响应，不受本节鉴权规则与 §2.3 envelope 约定的约束。

### 2.2 Project 作用域

LTBase 当前在 control plane 上只支持单 project 私有部署。

因此：

- 每个管理 REST 请求都隐式作用于部署环境配置中的 project（服务端忽略请求内容，直接使用部署 project）
- 客户端不能在 path、query、header 或 body 中提供 `project_id`
- 服务端可以在响应中返回只读的 `project_id`

### 2.3 成功与错误响应 envelope

所有响应顶层都带 `request_id`。

单资源成功响应：

```json
{
  "request_id": "req_123",
  "data": {}
}
```

集合成功响应：

```json
{
  "request_id": "req_123",
  "items": []
}
```

约定说明：

- 只有 `GET /api/v1/auth/referrals` 返回 `total`；其余集合接口只返回 `items`。
- 单资源响应的 `data` 内层键并不统一：用户为 `data.user`（GET 单用户时附带 `data.roles`），角色为 `data.role`，策略为 `data.policy`，binding policy 为 `data.binding_policy`，referral 为裸 `data` 对象；删除/绑定/解绑类操作返回带 `status` 字段的小对象。以下各节按实际形状描述。

错误响应：

```json
{
  "request_id": "req_123",
  "code": "invalid_body",
  "message": "invalid request body"
}
```

字段级或校验诊断可以通过可选 `details` 返回。

### 2.4 常见状态码

- `200 OK`
- `201 Created`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `405 Method Not Allowed`（`code: method_not_allowed`）
- `409 Conflict`
- `500 Internal Server Error`

## 3. 路由总表

以下路由全部已在当前代码中实现并注册。

| Method | Path | 功能 |
| --- | --- | --- |
| GET | `/api/v1/auth/config` | 获取 control-plane auth 快照（legacy 别名：`/api/v1/auth-config`） |
| GET | `/api/v1/auth/users` | 列出 control-plane 用户 |
| GET | `/api/v1/auth/users/{user_id}` | 获取单个 control-plane 用户 |
| PATCH | `/api/v1/auth/users/{user_id}` | 更新单个 control-plane 用户 |
| PUT | `/api/v1/auth/users/{user_id}/roles/{role_id}` | 给用户绑定角色 |
| DELETE | `/api/v1/auth/users/{user_id}/roles/{role_id}` | 解绑用户角色 |
| GET | `/api/v1/auth/roles` | 列出角色配置 |
| POST | `/api/v1/auth/roles` | 创建角色配置 |
| GET | `/api/v1/auth/roles/{role_id}` | 获取单个角色配置 |
| PATCH | `/api/v1/auth/roles/{role_id}` | 更新单个角色配置 |
| DELETE | `/api/v1/auth/roles/{role_id}` | 删除单个角色配置 |
| GET | `/api/v1/auth/policies` | 列出策略配置 |
| POST | `/api/v1/auth/policies` | 创建策略配置 |
| GET | `/api/v1/auth/policies/{policy_id}` | 获取单个策略配置 |
| PATCH | `/api/v1/auth/policies/{policy_id}` | 更新单个策略配置 |
| DELETE | `/api/v1/auth/policies/{policy_id}` | 删除单个策略配置 |
| GET | `/api/v1/auth/principals/{principal_type}/{principal_id}/policies` | 列出 principal 已绑定的策略 |
| PUT | `/api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}` | 给 user 或 role 绑定策略 |
| DELETE | `/api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}` | 解绑 user 或 role 的策略 |
| GET | `/api/v1/auth/binding-policies` | 列出 binding policies |
| POST | `/api/v1/auth/binding-policies` | 创建 binding policy |
| PATCH | `/api/v1/auth/binding-policies/{policy_id}` | 更新 binding policy |
| DELETE | `/api/v1/auth/binding-policies/{policy_id}` | 删除 binding policy |
| GET | `/api/v1/auth/referrals` | 列出 referral codes |
| POST | `/api/v1/auth/referrals` | 创建 referral code |
| POST | `/api/v1/auth/referrals?import=1` | 批量导入 referral codes |
| PATCH | `/api/v1/auth/referrals/{code}` | 更新 referral code |
| POST | `/api/v1/auth/referrals/{code}/disable` | 禁用 referral code |
| DELETE | `/api/v1/auth/referrals/{code}` | 删除 referral code |

referral 路由另有顶层别名 `/api/v1/referrals...`（同一 handler）。

## 4. 通用数据结构

`policy_id`、`role_id` 以及绑定策略的 `policy_id` 是服务端生成的 UUIDv7 持久标识符；
`slug` 与 `external_key` 是人类可读 / 调用方关联键。根据语义键约定（semantic-key
contract），调用方可在请求路径参数中通过 `slug` 引用实体（大小写不敏感，解析为持久
id）。slug 解析适用于 role、policy 与 binding policy 的路径参数；`user_id` 只按精确值
匹配。`ou_id` 和 `user_id` 由调用方/身份提供，并非服务端生成。

标识符规范化的边界：存储记录与完整资源对象响应（`data.user` / `data.role` /
`data.policy` / `data.binding_policy` 及集合条目）始终携带 UUIDv7。但 attach / detach /
delete 返回的 `status` 小对象会**原样回显路径参数中提供的标识**——调用方传 slug 时，
响应中的 `role_id` / `policy_id` / `principal_id` 就是该 slug，不会规范化为 UUID（涉及
user-role attach/detach、principal-policy attach/detach、role/policy/binding-policy
delete）。需要持久 id 时请以资源对象响应或 GET 接口为准。

### 4.1 ControlPlaneUser（公开 DTO）

user 列表 / 单查 / org 路由返回的用户对象形状（`apiPublicAuthUser`）：

```json
{
  "user_id": "user_alice",
  "provider": "google",
  "issuer": "https://accounts.google.com",
  "external_sub": "provider-subject",
  "primary_ou_id": "ou_team_android",
  "report_to_user_id": "user_manager_1",
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "last_login_at": 1760000005000
}
```

说明：

- 公开 DTO **不含** `referral_code`；只有 `GET /api/v1/auth/config` 快照中的用户对象包含 `referral_code`（见 §5）。
- `primary_ou_id` 与 `report_to_user_id` 属于组织管理合约，可由 user 或 org 资源接口返回。

### 4.2 Role

```json
{
  "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
  "name": "Manager",
  "description": "People manager",
  "slug": "role.manager",
  "external_key": "role-manager-v1",
  "parent_role_ids": ["0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07"],
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

`slug` 与 `external_key` 由服务端派生/维护，创建与更新请求不接受这两个字段。

### 4.3 PrincipalPolicyAttachment

```json
{
  "principal_type": "role",
  "principal_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd06",
  "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03"
}
```

### 4.4 Policy

```json
{
  "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
  "name": "Sales Read Policy",
  "description": "销售记录读取策略",
  "slug": "policy.sales_read",
  "external_key": "policy-sales-read-v1",
  "document": {
    "statements": [
      {
        "effect": "allow",
        "ops": ["read"],
        "schema": "lead",
        "selector": {
          "filter": {
            "owner_ou_path": "starts_with:${requester.ou_path}"
          }
        }
      }
    ]
  },
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

### 4.5 BindingPolicy

```json
{
  "policy_id": "0192e0a1-9e5f-7d2c-9f30-cc03dd04ee08",
  "enabled": true,
  "priority": 10,
  "slug": "bind.company_email",
  "external_key": "bind-company-email-v1",
  "rules": [
    {
      "l": "and",
      "c": [
        { "a": "external.email", "v": "ends_with:@company.com" }
      ]
    }
  ],
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

### 4.6 Referral（完整记录）

referral 列表 / PATCH / disable 响应返回的完整记录形状（`ReferralRecord`）：

```json
{
  "code": "INVITE-2026-001",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
  "used_at": 0,
  "expires_at": 1767139200000,
  "disabled": false,
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "status": "available"
}
```

说明：

- `policy_id` 可选（导入/创建时绑定）。
- `status` 是派生字段，规则依序为：`disabled == true` → `"disabled"`；`used_at > 0` → `"used"`；`expires_at > 0` 且已过期 → `"expired"`；否则 → `"available"`。

## 5. Auth Config Snapshot API

### `GET /api/v1/auth/config`

用途：获取完整 control-plane auth 配置快照，供管理后台初始化和检查使用。

legacy 别名：`GET /api/v1/auth-config`（同一 handler）。仅支持 GET，其他方法返回 `405`。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "summary": {
      "users": 1,
      "roles": 2,
      "policies": 1,
      "binding_policies": 1,
      "principal_policies": 1,
      "ou_policies": 1,
      "referrals": 5,
      "warnings": 0
    },
    "users": [],
    "org_units": [],
    "roles": [],
    "policies": [],
    "binding_policies": [],
    "principal_policy_attachments": [],
    "ou_policy_attachments": [],
    "referrals": [],
    "warnings": [],
    "authorization_model": {
      "canonical_object": "policy",
      "canonical_principal_relationship": "principal_policy_attachment",
      "canonical_org_relationship": "ou_policy_attachment",
      "permission_status": "legacy_compatibility",
      "legacy_data_location": "internal_or_migration_output_only",
      "policy_depends_on_permission": false
    }
  }
}
```

快照字段说明：

- `users[]` 条目为快照专用用户形状，**包含** `referral_code`（公开 user DTO 不含）。
- `org_units[]` 条目为 OrgUnit 对象（见 `API-specs-control-plane.cn.md` §4.2）。
- `ou_policy_attachments[]` 条目仅含 `{ "ou_id", "policy_id" }`（不含 `enforced` 或时间戳）。
- `referrals[]` 条目为快照专用形状 `{ "code", "policy_id?", "used_at", "expires_at", "created_at", "updated_at" }`（不含 `project_id`、`disabled`、`status`）。
- `warnings[]` 条目为 `{ "code", "message" }`。
- `authorization_model` 是固定值对象，声明规范授权模型（见 `rfc/CN/policy-permission-relationship.md`）。

其他说明：

- 该快照以 policy-first 为主。统一的 `policy_profile.statements` 是规范授权模型。
- 旧的 `permission_profile`、`role_permission` 和逻辑上的 `resource_grant` 仅作为内部兼容数据存在，不通过公开 REST API 暴露。
- 从旧 authz 记录迁移到统一 policy 的流程通过 `/control-plane` action `migrate-authz-policy-model` 完成。

状态码：`200`、`401`、`403`、`500 list_auth_config_failed`

## 6. Auth 资源 APIs

### 6.1 Users

实现状态：全部已落地（含写接口）。

#### `GET /api/v1/auth/users`

用途：列出已绑定内部用户。

支持的 query 参数：

- `q`
- `provider`
- `ou_id`
- `manager_user_id`

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "user_id": "user_alice",
      "provider": "google",
      "issuer": "https://accounts.google.com",
      "external_sub": "provider-subject",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "last_login_at": 1760000005000
    }
  ]
}
```

#### `GET /api/v1/auth/users/{user_id}`

用途：获取单个内部用户及其已绑定角色。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "user": {
      "user_id": "user_alice",
      "provider": "google",
      "issuer": "https://accounts.google.com",
      "external_sub": "provider-subject",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "last_login_at": 1760000005000
    },
    "roles": [
      {
        "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07",
        "name": "Employee",
        "description": "Default employee role",
        "slug": "role.employee",
        "external_key": "role-employee-v1",
        "parent_role_ids": [],
        "created_at": 1760000000000,
        "updated_at": 1760000000000
      }
    ]
  }
}
```

#### `PATCH /api/v1/auth/users/{user_id}`

用途：更新 admin 可管理的用户组织字段。

请求体：

```json
{
  "primary_ou_id": "ou_team_android",
  "report_to_user_id": "user_manager_1"
}
```

响应：返回完整更新后的用户对象（`data.user`）：

```json
{
  "request_id": "req_123",
  "data": {
    "user": {
      "user_id": "user_alice",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "last_login_at": 1760000005000
    }
  }
}
```

说明：

- `provider`、`issuer`、`external_sub` 等身份字段不能通过该接口修改
- 用户或目标 OU 不存在 → `404 not_found`；汇报关系形成环 → `409 invalid_org_cycle`

#### `PUT /api/v1/auth/users/{user_id}/roles/{role_id}`

用途：给用户绑定角色。`{role_id}` 可为 durable id 或 slug。无请求体。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
    "status": "attached"
  }
}
```

#### `DELETE /api/v1/auth/users/{user_id}/roles/{role_id}`

用途：解绑用户角色。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
    "status": "detached"
  }
}
```

用户路由状态码：`200`、`400 invalid_body`、`401`、`403`、`404 not_found`（user/role/OU 不存在）、`409 invalid_org_cycle`、`500`

### 6.2 Roles

实现状态：全部已落地（含写接口）。

#### `GET /api/v1/auth/roles`

用途：列出角色配置。

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
      "name": "Manager",
      "description": "People manager",
      "slug": "role.manager",
      "external_key": "role-manager-v1",
      "parent_role_ids": ["0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07"],
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  ]
}
```

#### `POST /api/v1/auth/roles`

用途：创建角色配置。

请求体（仅接受以下字段；`slug`/`external_key` 由服务端派生）：

```json
{
  "name": "Manager",
  "description": "People manager",
  "parent_role_ids": ["role.employee"]
}
```

响应（`201 Created`）：返回完整角色对象（`data.role`）：

```json
{
  "request_id": "req_123",
  "data": {
    "role": {
      "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
      "name": "Manager",
      "description": "People manager",
      "slug": "role.manager",
      "parent_role_ids": ["0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07"],
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

#### `GET /api/v1/auth/roles/{role_id}`

用途：获取单个角色配置。`{role_id}` 可为 durable id 或 slug。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "role": {
      "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
      "name": "Manager",
      "description": "People manager",
      "slug": "role.manager",
      "external_key": "role-manager-v1",
      "parent_role_ids": ["0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07"],
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

#### `PATCH /api/v1/auth/roles/{role_id}`

用途：更新可变角色字段。

请求体：

```json
{
  "name": "Manager",
  "description": "People manager",
  "parent_role_ids": ["role.employee"]
}
```

响应：`200`，形状与 GET 相同（`data.role`）。角色不存在 → `404 not_found`。

#### `DELETE /api/v1/auth/roles/{role_id}`

用途：删除单个角色配置。

响应（`200`）：

```json
{
  "request_id": "req_123",
  "data": {
    "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
    "status": "deleted"
  }
}
```

删除冲突返回 `409 role_in_use`；角色不存在返回 `404 not_found`。

### 6.3 Policies 与 Policy Attachments

实现状态：全部已落地（读、写、attach/detach、principal policies 列表）。

#### `GET /api/v1/auth/policies`

用途：列出策略配置。

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "name": "Sales Read Policy",
      "description": "销售记录读取策略",
      "slug": "policy.sales_read",
      "external_key": "policy-sales-read-v1",
      "document": {
        "statements": [
          {
            "effect": "allow",
            "ops": ["read"],
            "schema": "lead"
          }
        ]
      },
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  ]
}
```

#### `POST /api/v1/auth/policies`

用途：创建策略配置。

请求体（仅接受以下字段）：

```json
{
  "name": "Sales Read Policy",
  "description": "销售记录读取策略",
  "policy_document": {
    "statements": [
      {
        "effect": "allow",
        "ops": ["read"],
        "schema": "lead",
        "selector": {
          "filter": {
            "owner_ou_path": "starts_with:${requester.ou_path}"
          }
        },
        "condition": {
          "l": "and",
          "c": [
            { "a": "status", "v": "eq:open" }
          ]
        }
      },
      {
        "effect": "mask",
        "ops": ["read"],
        "schema": "lead",
        "outcome": {
          "scope": "column",
          "attrs": ["ssn"],
          "action": "mask"
        }
      }
    ]
  }
}
```

响应（`201 Created`）：返回完整策略对象（`data.policy`，含服务端生成的 `policy_id`、派生 `slug` 与时间戳）：

```json
{
  "request_id": "req_123",
  "data": {
    "policy": {
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "name": "Sales Read Policy",
      "description": "销售记录读取策略",
      "slug": "policy.sales_read",
      "document": { "statements": [] },
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

说明：

- `policy_document.statements` 是规范授权模型。
- 每个 statement 可包含 `effect`、`ops`、`schema`、`selector`、`condition`、`outcome`，具体以 `rfc/CN/aaa.md` 为准。
- `selector` 可包含 `resource_id`、`filter`，或两者同时存在。
- 服务端仅校验 `policy_document` 为合法 JSON（随后压缩存储），**不**校验其内部结构；结构约束以 `rfc/CN/aaa.md` §6 为准。
- OU policy attachment 路由在 `API-specs-control-plane.cn.md` 中说明，因为它们通过 `/api/v1/org/...` 提供。

#### `GET /api/v1/auth/policies/{policy_id}`

用途：获取单个策略配置。`{policy_id}` 可为 durable id 或 slug。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "policy": {
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "name": "Sales Read Policy",
      "description": "销售记录读取策略",
      "slug": "policy.sales_read",
      "external_key": "policy-sales-read-v1",
      "document": {
        "statements": [
          {
            "effect": "allow",
            "ops": ["read"],
            "schema": "lead"
          }
        ]
      },
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

#### `PATCH /api/v1/auth/policies/{policy_id}`

用途：更新可变策略字段。

请求体：`{ "name", "description", "policy_document" }`（与 POST 相同的字段集）。

响应：`200`，形状与 GET 相同（`data.policy`）。策略不存在 → `404 not_found`。

#### `DELETE /api/v1/auth/policies/{policy_id}`

用途：删除单个策略配置。

响应（`200`）：

```json
{
  "request_id": "req_123",
  "data": {
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "status": "deleted"
  }
}
```

删除冲突返回 `409 policy_in_use`；策略不存在返回 `404 not_found`。

#### `GET /api/v1/auth/principals/{principal_type}/{principal_id}/policies`

用途：列出 principal（user 或 role）已绑定的策略，附带完整 policy 对象。

响应（无 `total`）：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "principal_type": "role",
      "principal_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd06",
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "policy": {
        "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
        "name": "Sales Read Policy",
        "slug": "policy.sales_read",
        "document": { "statements": [] },
        "created_at": 1760000000000,
        "updated_at": 1760000000000
      }
    }
  ]
}
```

未知 user/role 或非法 `principal_type` → `404 not_found`。

#### `PUT /api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}`

用途：给 user 或 role 绑定策略。`{principal_id}`（role 时）与 `{policy_id}` 均可为 durable id 或 slug。无请求体。

允许的 `principal_type`：

- `user`
- `role`

OU 不是合法 principal。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "principal_type": "role",
    "principal_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd06",
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "status": "attached"
  }
}
```

#### `DELETE /api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}`

用途：解绑 user 或 role 的策略。

响应：与 PUT 相同，`status` 为 `"detached"`。

未知 user/role/policy → `404 not_found`。

统一 AAA 合约中不存在一等 REST 资源形式的 `permission_profile` 或逻辑 `resource_grant`。

- `resource_grant` 仍可作为统一策略的内部物理投影存在。
- 旧权限和 grants 仅作为内部兼容数据存在，不通过公开 REST API 暴露。

### 6.4 Binding Policies

实现状态：已落地。

#### `GET /api/v1/auth/binding-policies`

用途：列出 binding policies。

响应（list DTO 含时间戳）：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "policy_id": "0192e0a1-9e5f-7d2c-9f30-cc03dd04ee08",
      "enabled": true,
      "priority": 10,
      "slug": "bind.company_email",
      "external_key": "bind-company-email-v1",
      "rules": [
        {
          "l": "and",
          "c": [
            { "a": "external.email", "v": "ends_with:@company.com" }
          ]
        }
      ],
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  ]
}
```

#### `POST /api/v1/auth/binding-policies`

用途：创建 binding policy。

请求体：

```json
{
  "enabled": true,
  "priority": 10,
  "rules": [
    {
      "l": "and",
      "c": [
        { "a": "external.email", "v": "ends_with:@company.com" }
      ]
    }
  ]
}
```

响应（`201 Created`）：嵌套在 `data.binding_policy` 下；注意与 GET list DTO 不同，**不含时间戳**（已知的实现差异，如实记录）：

```json
{
  "request_id": "req_123",
  "data": {
    "binding_policy": {
      "policy_id": "0192e0a1-9e5f-7d2c-9f30-cc03dd04ee08",
      "slug": "bind.company_email",
      "external_key": "bind-company-email-v1",
      "enabled": true,
      "priority": 10,
      "rules": []
    }
  }
}
```

#### `PATCH /api/v1/auth/binding-policies/{policy_id}`

用途：更新 binding policy。`{policy_id}` 可为 durable id 或 slug。

请求体与 POST 相同；响应 `200`，形状与 POST 响应相同（`data.binding_policy`，无时间戳）。不存在 → `404 not_found`。

#### `DELETE /api/v1/auth/binding-policies/{policy_id}`

用途：删除 binding policy。

响应（`200`）：

```json
{
  "request_id": "req_123",
  "data": {
    "policy_id": "0192e0a1-9e5f-7d2c-9f30-cc03dd04ee08",
    "status": "deleted"
  }
}
```

### 6.5 Referrals

实现状态：已落地。双挂载：以下路由在 `/api/v1/referrals...` 下有等价别名。

#### `GET /api/v1/auth/referrals`

用途：列出 referral codes。

支持的 query 参数：

- `status`
- `code`

响应（唯一返回 `total` 的集合接口；条目为完整 ReferralRecord，见 §4.6）：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "code": "INVITE-2026-001",
      "project_id": "11111111-1111-4111-8111-111111111111",
      "used_at": 0,
      "expires_at": 1767139200000,
      "disabled": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "status": "available"
    }
  ],
  "total": 1
}
```

#### `POST /api/v1/auth/referrals`

用途：创建单个 referral code。

请求体（`policy_id` 可选，可为 durable id 或 slug）：

```json
{
  "code": "INVITE-2026-001",
  "policy_id": "policy.lead.read",
  "expires_at_ms": 1767139200000
}
```

响应（`201 Created`）：返回精简的创建结果（无 `status` 字段）：

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "created_at": 1760000000000
  }
}
```

错误码：`400 missing_code`（code 为空）、`400 code_too_long`（超过 256 字符）、`400 policy_not_found`（引用的 policy 不存在）、`409 referral_exists`（code 已存在）。

#### `POST /api/v1/auth/referrals?import=1`

用途：批量导入 referral codes。任意非空的 `import` query 值均触发批量模式。

请求体为 JSON 数组，条目字段为 `referral_code`（必填）、`policy_id`（可选）、`expires_at_ms`（可选，int 或数字字符串）、`project_id`（可选，**会被忽略**——REST 路径始终强制使用部署 project，条目里传任何值都不会被校验或采用；这与 `/control-plane` action 批量模式不同，后者要求条目 `project_id` 与顶层一致）：

```json
[
  {
    "referral_code": "INVITE-2026-001",
    "policy_id": "policy.lead.read",
    "expires_at_ms": 1767139200000
  },
  {
    "referral_code": "INVITE-2026-002"
  }
]
```

响应（`201 Created`）：

```json
{
  "request_id": "req_123",
  "data": {
    "total": 2,
    "imported": 1,
    "skipped_existing": 1
  }
}
```

行为：已存在的 code 会被跳过（计入 `skipped_existing`），不报错。错误码：`400 invalid_body`（body 不是合法 JSON）、`400 invalid_referral_import`（条目校验失败，如空数组）、`400 policy_not_found`、`500 import_referrals_failed`。

#### `PATCH /api/v1/auth/referrals/{code}`

用途：更新 referral code 的过期时间。**仅接受** `expires_at_ms`；body 中的 `policy_id` 等其他字段会被静默忽略。

请求体：

```json
{
  "expires_at_ms": 1767139200000
}
```

响应：返回完整 ReferralRecord（见 §4.6）：

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "used_at": 0,
    "expires_at": 1767139200000,
    "disabled": false,
    "created_at": 1760000000000,
    "updated_at": 1760000010000,
    "status": "available"
  }
}
```

`expires_at_ms` 为负 → `400 invalid_expiration`；code 不存在 → `404 referral_not_found`。

#### `POST /api/v1/auth/referrals/{code}/disable`

用途：禁用 referral code。仅支持 POST（其他方法返回 `405`）。

响应：返回完整 ReferralRecord，`disabled` 为 `true`、`status` 为 `"disabled"`：

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "used_at": 0,
    "expires_at": 1767139200000,
    "disabled": true,
    "created_at": 1760000000000,
    "updated_at": 1760000020000,
    "status": "disabled"
  }
}
```

#### `DELETE /api/v1/auth/referrals/{code}`

用途：在允许时删除 referral code。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "status": "deleted"
  }
}
```

已被使用的 code 不能删除，返回 `409 referral_in_use`。

Referral 路由状态码：`200`、`201`、`400 missing_code|code_too_long|policy_not_found|invalid_expiration|invalid_body|invalid_referral_import`、`401`、`403`、`404 referral_not_found`、`409 referral_exists|referral_in_use`、`500`
