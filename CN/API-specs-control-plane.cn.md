# LTBase API 规格：Control Plane

本文档描述 `/api/v1/org/...` 下已批准的 control-plane admin REST API 合约，以及与其分离的旧版 `/control-plane` 运维 action API。

- 代码基线：
  - `ltbase.api/cmd/controlplane`
  - `rfc/CN/aaa.md`
- 文档语言：中文
- 更新日期：2026-05-25

## 1. 总览

Control-plane admin REST surface 当前拆分为两组路由：

- `/api/v1/auth/...`：AAA 配置与 referral 管理
- `/api/v1/org/...`：组织架构与 OU 管理

本文档覆盖 `/api/v1/org/...` 路由，并说明 admin REST API 与 `/control-plane` 运维 action API 的边界。

Control plane 提供以下管理能力：

- 组织架构管理：OU、汇报关系、OU policy attachment、org chart read model
- 独立的 `/control-plane` 运维 action：bootstrap、repair、catalog、schema、migration 等流程

`/api/v1/auth/...` 路由见 `API-specs-auth-service.cn.md`。

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

- 每个 control-plane admin REST 请求都隐式作用于部署环境配置中的 project
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

当前已批准的 org 路由不要求 `total`，后续如某个集合接口出现明确计数语义，可以单独加入。

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

### 3.1 Admin REST 路由

| Method | Path | 功能 |
| --- | --- | --- |
| GET | `/api/v1/org/units` | 列出 OU |
| POST | `/api/v1/org/units` | 创建 OU |
| GET | `/api/v1/org/units/{ou_id}` | 获取单个 OU |
| PATCH | `/api/v1/org/units/{ou_id}` | 更新或移动 OU |
| DELETE | `/api/v1/org/units/{ou_id}` | 删除 OU |
| GET | `/api/v1/org/units/{ou_id}/users` | 列出 OU 下用户 |
| PUT | `/api/v1/org/units/{ou_id}/users/{user_id}` | 把用户移动到 OU |
| GET | `/api/v1/org/units/{ou_id}/policies` | 列出 OU 上挂载的策略 |
| PUT | `/api/v1/org/units/{ou_id}/policies/{policy_id}` | 给 OU 挂载策略 |
| DELETE | `/api/v1/org/units/{ou_id}/policies/{policy_id}` | 解绑 OU 策略 |
| GET | `/api/v1/org/users/{user_id}/manager` | 获取用户直属经理 |
| PUT | `/api/v1/org/users/{user_id}/manager` | 设置用户直属经理 |
| DELETE | `/api/v1/org/users/{user_id}/manager` | 清空用户直属经理 |
| GET | `/api/v1/org/users/{user_id}/direct-reports` | 列出用户直属下属 |
| GET | `/api/v1/org/charts` | 获取 org chart read model |

### 3.2 旧版 `/control-plane` Actions

以下接口仍以运维 action 的形式通过 `/control-plane` 提供，而不是 admin REST 资源：

- `ensure-project`
- `repair-project`
- `update-schema`
- `create-permission-records`
- `create-iam-authz-records`
- `list-project-auth-config`
- `migrate-authz-policy-model`
- catalog put/get actions
- `import-referrals`

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

### 4.2 OrgUnit

```json
{
  "ou_id": "ou_team_android",
  "name": "Team Android",
  "parent_ou_id": "ou_mobiledev",
  "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
  "block_inheritance": false,
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

### 4.3 OUPolicyAttachment

```json
{
  "ou_id": "ou_team_android",
  "policy_id": "policy.sales_read",
  "enforced": false
}
```

### 4.4 ManagerRelationship

```json
{
  "user_id": "user_alice",
  "report_to_user_id": "user_manager_1",
  "manager": {
    "user_id": "user_manager_1"
  }
}
```

### 4.5 OrgChart

```json
{
  "root_ou_id": "ou_rnd",
  "org_units": [],
  "users": [],
  "policy_attachments": []
}
```

## 5. 组织架构语义与约束

组织架构模型包含两条相互独立的关系：

- 通过 `primary_ou_id` 与 `parent_ou_id` 表达 OU containment
- 通过 `report_to_user_id` 表达 manager relationship

V1 规则：

- OU containment 必须形成树
- `ou_path` 由服务端维护，客户端只读
- 移动 OU 时必须安全重算整棵子树的路径
- OU 不能移动到自己的后代子树中
- 用户不能直接或间接向自己汇报
- dotted-line 或 matrix reporting 不在 V1 范围内
- OU 不是 principal，不能用于 principal policy attachment
- OU 范围授权通过 OU policy attachment 实现
- `block_inheritance` 与 `enforced` 为前向兼容字段，可接受并存储，但 V1 运行时仍按简单 ancestor-union inheritance 处理

## 6. Org Chart APIs

### 6.1 Org Units

实现状态：已批准合同，但当前分支尚未落地 `/api/v1/org/...` 路由。

#### `GET /api/v1/org/units`

用途：列出 OU。

支持的 query 参数：

- `parent_ou_id`
- `tree=true`
- `q`

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "ou_id": "ou_team_android",
      "name": "Team Android",
      "parent_ou_id": "ou_mobiledev",
      "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
      "block_inheritance": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  ]
}
```

#### `POST /api/v1/org/units`

用途：创建 OU。

请求体：

```json
{
  "ou_id": "ou_team_android",
  "name": "Team Android",
  "parent_ou_id": "ou_mobiledev",
  "block_inheritance": false
}
```

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "name": "Team Android",
    "parent_ou_id": "ou_mobiledev",
    "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
    "block_inheritance": false
  }
}
```

说明：

- 客户端不能传 `ou_path`
- `ou_path` 由服务端维护

#### `GET /api/v1/org/units/{ou_id}`

用途：获取单个 OU。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "name": "Team Android",
    "parent_ou_id": "ou_mobiledev",
    "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
    "block_inheritance": false,
    "created_at": 1760000000000,
    "updated_at": 1760000000000
  }
}
```

#### `PATCH /api/v1/org/units/{ou_id}`

用途：更新或移动 OU。

请求体示例：

```json
{
  "name": "Android Platform",
  "parent_ou_id": "ou_mobiledev",
  "block_inheritance": false
}
```

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "name": "Android Platform",
    "parent_ou_id": "ou_mobiledev",
    "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
    "block_inheritance": false
  }
}
```

如果移动会形成 containment cycle，服务端必须返回 `400 invalid_org_cycle`。

#### `DELETE /api/v1/org/units/{ou_id}`

用途：仅当没有子 OU 且没有分配用户时删除 OU。

冲突返回 `409 ou_not_empty`。

### 6.2 Org Unit Users 与 Policies

实现状态：已批准合同，但当前分支尚未落地 `/api/v1/org/...` 路由。

#### `GET /api/v1/org/units/{ou_id}/users`

用途：列出 OU 下用户。

支持的 query 参数：

- `include_subtree=true`

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "user_id": "user_alice",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1"
    }
  ]
}
```

#### `PUT /api/v1/org/units/{ou_id}/users/{user_id}`

用途：把用户移动到指定 OU。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "primary_ou_id": "ou_team_android"
  }
}
```

该路由是直接更新 user 资源的便捷形式。

#### `GET /api/v1/org/units/{ou_id}/policies`

用途：列出挂载到 OU 的策略。

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "ou_id": "ou_team_android",
      "policy_id": "policy.sales_read",
      "enforced": false
    }
  ]
}
```

#### `PUT /api/v1/org/units/{ou_id}/policies/{policy_id}`

用途：给 OU 挂载策略。

请求体：

```json
{
  "enforced": false
}
```

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "policy_id": "policy.sales_read",
    "enforced": false
  }
}
```

#### `DELETE /api/v1/org/units/{ou_id}/policies/{policy_id}`

用途：解绑 OU 上的策略。

说明：

- OU 不是 principal
- `block_inheritance` 与 `enforced` 在 V1 中会被存储，但不会参与 evaluator

### 6.3 Manager APIs

实现状态：已批准合同，但当前分支尚未落地 `/api/v1/org/...` 路由。

#### `GET /api/v1/org/users/{user_id}/manager`

用途：获取用户直属经理。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "report_to_user_id": "user_manager_1",
    "manager": {
      "user_id": "user_manager_1"
    }
  }
}
```

#### `PUT /api/v1/org/users/{user_id}/manager`

用途：设置用户直属经理。

请求体：

```json
{
  "report_to_user_id": "user_manager_1"
}
```

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "report_to_user_id": "user_manager_1"
  }
}
```

#### `DELETE /api/v1/org/users/{user_id}/manager`

用途：清空直属经理关系。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "report_to_user_id": ""
  }
}
```

#### `GET /api/v1/org/users/{user_id}/direct-reports`

用途：列出用户直属下属。

支持的 query 参数：

- `recursive=true`

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "user_id": "user_bob",
      "report_to_user_id": "user_manager_1"
    }
  ]
}
```

循环保护错误返回 `400 invalid_org_cycle`。

### 6.4 Org Chart Read Model

实现状态：已批准合同，但当前分支尚未落地 `/api/v1/org/...` 路由。

#### `GET /api/v1/org/charts`

用途：获取管理后台友好的 org chart read model。

支持的 query 参数：

- `root_ou_id`
- `include_users=true`
- `include_policies=true`

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "root_ou_id": "ou_rnd",
    "org_units": [],
    "users": [],
    "policy_attachments": []
  }
}
```

该接口为只读；所有写操作仍通过上面的资源路由完成。

## 7. 旧版 `/control-plane` Action API 说明

Admin REST API 不替代现有的 action-style control-plane API。

产品化管理后台与自动化配置请使用 REST admin API。

Lambda Console 风格运维、CLI 流程和后端运维任务继续使用 `/control-plane`。

特别是：

- `ensure-project`、repair、schema、catalog、migration 等仍保留在 `/control-plane`
- `migrate-authz-policy-model` 是运维 action，不是 `/api/v1/...` REST endpoint
- admin REST 合约是 resource-oriented，而 `/control-plane` 是 action-oriented
