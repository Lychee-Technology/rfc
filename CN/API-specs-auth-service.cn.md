# LTBase API 规格：Auth Service

本文档描述独立 control-plane gateway/domain 下 `/api/v1/auth/...` 的已批准管理 REST API 合约。

- 代码基线：
  - `ltbase.api/cmd/controlplane`
  - `rfc/CN/aaa.md`
- 文档语言：中文
- 更新日期：2026-05-25

## 1. 总览

Control-plane admin REST surface 当前拆分为两组路由：

- `/api/v1/auth/...`：AAA 配置与 referral 管理
- `/api/v1/org/...`：组织架构与 OU 管理

本文档覆盖 `/api/v1/auth/...` 路由：

- auth 配置快照读取，用于初始化与检查
- AAA 配置管理：用户、角色、统一策略、principal policy attachment、binding policy、referral
- 与 `rfc/CN/aaa.md` 对齐的 policy-first 授权模型

`/api/v1/org/...` 路由与 `/control-plane` 运维 actions 见 `API-specs-control-plane.cn.md`。

## 2. 认证、作用域与公共约定

### 2.1 Admin 鉴权

Control-plane admin REST API 仅允许管理员访问，并使用 Bearer JWT 认证。

请求满足以下任一条件时允许访问：

- 角色 `role.admin`
- 权限 `controlplane.admin`

未认证请求返回：

```json
{
  "request_id": "req_123",
  "code": "unauthorized",
  "message": "admin authentication required"
}
```

已认证但非 admin 的请求返回：

```json
{
  "request_id": "req_123",
  "code": "forbidden",
  "message": "admin role or permission required"
}
```

### 2.2 Project 作用域

LTBase 当前在 control plane 上只支持单 project 私有部署。

因此：

- 每个管理 REST 请求都隐式作用于部署环境配置中的 project
- 客户端不能在 path、query、header 或 body 中提供 `project_id`
- 服务端从部署配置解析 project 作用域
- 服务端可以在响应中返回只读的 `project_id`

### 2.3 成功与错误响应 envelope

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

部分集合接口在有明确计数意义时还会返回 `total`。

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
- `204 No Content`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `500 Internal Server Error`

## 3. 路由总表

| Method | Path | 功能 |
| --- | --- | --- |
| GET | `/api/v1/auth/config` | 获取 control-plane auth 快照 |
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

## 4. 通用数据结构

### 4.1 ControlPlaneUser

```json
{
  "user_id": "user_alice",
  "provider": "google",
  "issuer": "https://accounts.google.com",
  "external_sub": "provider-subject",
  "referral_code": "INVITE-2026-001",
  "primary_ou_id": "ou_team_android",
  "report_to_user_id": "user_manager_1",
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "last_login_at": 1760000005000
}
```

说明：

- `referral_code` 属于当前 auth-config 用户快照字段。
- `primary_ou_id` 与 `report_to_user_id` 属于组织管理合约，可由 user 或 org 资源接口返回。

### 4.2 Role

```json
{
  "role_id": "role.manager",
  "name": "Manager",
  "description": "People manager",
  "parent_role_ids": ["role.employee"],
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

### 4.3 PrincipalPolicyAttachment

```json
{
  "principal_type": "role",
  "principal_id": "role.sales",
  "policy_id": "policy.sales_read"
}
```

### 4.4 Policy

```json
{
  "policy_id": "policy.sales_read",
  "name": "Sales Read Policy",
  "description": "销售记录读取策略",
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
  "policy_id": "bind.company_email",
  "enabled": true,
  "priority": 10,
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

### 4.6 Referral

```json
{
  "code": "INVITE-2026-001",
  "expires_at": 1767139200000,
  "used_at": 0,
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

说明：referral 的可用状态由 `used_at` 与 `expires_at` 推导，当前模型不要求单独存储 `status` 字段。

### 4.7 OUPolicyAttachment

```json
{
  "ou_id": "ou_team_android",
  "policy_id": "policy.sales_read",
  "enforced": false
}
```

## 5. Auth Config Snapshot API

### `GET /api/v1/auth/config`

用途：获取完整 control-plane auth 配置快照，供管理后台初始化和检查使用。

实现状态：当前分支已落地。

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
      "referrals": 5,
      "principal_policies": 1,
      "ou_policies": 1,
      "warnings": 0
    },
    "users": [],
    "roles": [],
    "policies": [],
    "principal_policy_attachments": [],
    "ou_policy_attachments": [],
    "binding_policies": [],
    "referrals": [],
    "warnings": []
  }
}
```

说明：

- 该快照以 policy-first 为主。统一的 `policy_profile.statements` 是规范授权模型。
- 旧的 `permission_profile`、`role_permission` 和逻辑上的 `resource_grant` 仅作为内部兼容数据存在，不通过公开 REST API 暴露。
- 从旧 authz 记录迁移到统一 policy 的流程通过 `/control-plane` action `migrate-authz-policy-model` 完成。

状态码：`200`、`401`、`403`、`500`

## 6. Auth 资源 APIs

### 6.1 Users

实现状态：

- `GET /api/v1/auth/users` 与 `GET /api/v1/auth/users/{user_id}` 已在当前分支落地。
- user 写接口仍为已批准合同文档，待实现落地。

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

用途：获取单个内部用户。

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
        "role_id": "role.employee",
        "name": "Employee",
        "description": "Default employee role",
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

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "primary_ou_id": "ou_team_android",
    "report_to_user_id": "user_manager_1"
  }
}
```

说明：

- `provider`、`issuer`、`external_sub` 等身份字段不能通过该接口修改

#### `PUT /api/v1/auth/users/{user_id}/roles/{role_id}`

用途：给用户绑定角色。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "role_id": "role.manager"
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
    "role_id": "role.manager"
  }
}
```

用户路由状态码：`200`、`400`、`401`、`403`、`404 user_not_found`、`409`、`500`

### 6.2 Roles

实现状态：

- `GET /api/v1/auth/roles` 与 `GET /api/v1/auth/roles/{role_id}` 已在当前分支落地。
- role 写接口仍为已批准合同文档，待实现落地。

#### `GET /api/v1/auth/roles`

用途：列出角色配置。

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "role_id": "role.manager",
      "name": "Manager",
      "description": "People manager",
      "parent_role_ids": ["role.employee"],
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  ]
}
```

#### `POST /api/v1/auth/roles`

用途：创建角色配置。

请求体：

```json
{
  "role_id": "role.manager",
  "name": "Manager",
  "description": "People manager",
  "parent_role_ids": ["role.employee"]
}
```

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "role_id": "role.manager",
    "name": "Manager",
    "description": "People manager",
    "parent_role_ids": ["role.employee"]
  }
}
```

#### `GET /api/v1/auth/roles/{role_id}`

用途：获取单个角色配置。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "role": {
      "role_id": "role.manager",
      "name": "Manager",
      "description": "People manager",
      "parent_role_ids": ["role.employee"],
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

#### `DELETE /api/v1/auth/roles/{role_id}`

用途：删除单个角色配置。

删除冲突返回 `409 role_in_use`。

### 6.3 Policies 与 Policy Attachments

实现状态：

- `GET /api/v1/auth/policies` 与 `GET /api/v1/auth/policies/{policy_id}` 已在当前分支落地。
- policy 写接口与 attachment 路由仍为已批准合同文档，待实现落地。

#### `GET /api/v1/auth/policies`

用途：列出策略配置。

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "policy_id": "policy.sales_read",
      "name": "Sales Read Policy",
      "description": "销售记录读取策略",
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

请求体：

```json
{
  "policy_id": "policy.sales_read",
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

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "policy_id": "policy.sales_read",
    "name": "Sales Read Policy"
  }
}
```

说明：

- `policy_document.statements` 是规范授权模型。
- 每个 statement 可包含 `effect`、`ops`、`schema`、`selector`、`condition`、`outcome`，具体以 `rfc/CN/aaa.md` 为准。
- `selector` 可包含 `resource_id`、`filter`，或两者同时存在。
- OU policy attachment 路由在 `API-specs-control-plane.cn.md` 中说明，因为它们通过 `/api/v1/org/...` 提供。

#### `GET /api/v1/auth/policies/{policy_id}`

用途：获取单个策略配置。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "policy": {
      "policy_id": "policy.sales_read",
      "name": "Sales Read Policy",
      "description": "销售记录读取策略",
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

#### `DELETE /api/v1/auth/policies/{policy_id}`

用途：删除单个策略配置。

删除冲突返回 `409 policy_in_use`。

#### `PUT /api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}`

用途：给 user 或 role 绑定策略。

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
    "principal_id": "role.sales",
    "policy_id": "policy.sales_read"
  }
}
```

#### `DELETE /api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}`

用途：解绑 user 或 role 的策略。

统一 AAA 合约中不存在一等 REST 资源形式的 `permission_profile` 或逻辑 `resource_grant`。

- `resource_grant` 仍可作为统一策略的内部物理投影存在。
- 旧权限和 grants 仅作为内部兼容数据存在，不通过公开 REST API 暴露。

### 6.4 Binding Policies

实现状态：已批准合同，但当前分支尚未作为 `/api/v1` 路由落地。

#### `GET /api/v1/auth/binding-policies`

用途：列出 binding policies。

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "policy_id": "bind.company_email",
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
  ]
}
```

#### `POST /api/v1/auth/binding-policies`

用途：创建 binding policy。

请求体：

```json
{
  "policy_id": "bind.company_email",
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

#### `PATCH /api/v1/auth/binding-policies/{policy_id}`

用途：更新 binding policy。

#### `DELETE /api/v1/auth/binding-policies/{policy_id}`

用途：删除 binding policy。

### 6.5 Referrals

实现状态：当前分支已落地。

#### `GET /api/v1/auth/referrals`

用途：列出 referral codes。

支持的 query 参数：

- `status`
- `code`

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "code": "INVITE-2026-001",
      "project_id": "11111111-1111-4111-8111-111111111111",
      "status": "available"
    }
  ],
  "total": 1
}
```

#### `POST /api/v1/auth/referrals`

用途：创建单个 referral code。

请求体：

```json
{
  "code": "INVITE-2026-001",
  "expires_at_ms": 1767139200000
}
```

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "status": "available"
  }
}
```

#### `POST /api/v1/auth/referrals?import=1`

用途：批量导入 referral codes。

请求体：

```json
[
  {
    "code": "INVITE-2026-001",
    "expires_at_ms": 1767139200000
  },
  {
    "code": "INVITE-2026-002",
    "expires_at_ms": 1767139200000
  }
]
```

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "created": 2,
    "failed": 0
  }
}
```

#### `PATCH /api/v1/auth/referrals/{code}`

用途：更新 referral code，通常是过期时间。

请求体：

```json
{
  "expires_at_ms": 1767139200000
}
```

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "status": "available"
  }
}
```

#### `POST /api/v1/auth/referrals/{code}/disable`

用途：禁用 referral code。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
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

Referral 路由状态码：`200`、`201`、`400`、`401`、`403`、`404 referral_not_found`、`409 referral_in_use|referral_exists`、`500`
