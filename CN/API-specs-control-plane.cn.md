# LTBase API 规格：Control Plane

本文档描述 `/api/v1/org/...` 下已批准的 control-plane admin REST API 合约，以及与其分离的旧版 `/control-plane` 运维 action API。

- 代码基线：
  - `ltbase.api/cmd/controlplane`
  - `rfc/CN/aaa.md`
- 文档语言：中文
- 更新日期：2026-06-20

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
- `create-iam-authz-records`
- `list-project-auth-config`
- `migrate-authz-policy-model`
- `migrate-authz-resource-identity`
- `put-project-capability-catalog` / `get-project-capability-catalog`
- `put-project-compliance-profile` / `get-project-compliance-profile`
- `put-project-action-template-catalog` / `get-project-action-template-catalog`
- `put-project-assistant-role-catalog` / `get-project-assistant-role-catalog`
- `import-referrals`

### 3.3 REST ↔ Action 映射

| REST API | `/control-plane` action | CLI (`cmd/tools`) |
|---|---|---|
| `POST /api/v1/auth/policies` | `create-iam-authz-records`（*） | **无** |
| `POST /api/v1/auth/referrals?import=1` | `import-referrals` | **无** |
| `GET /api/v1/auth/policies` | `list-project-auth-config` | **无** |

说明：

- （*）`create-iam-authz-records` 是一个更底层的批量种子写入 action。REST `POST /api/v1/auth/policies` 会自动生成 durable `policy_id`；`create-iam-authz-records` 要求调用方显式提供 `policy_id`。action 适用于种子数据、迁移和运维批量写入，REST endpoint 是产品化管理合同。
- `cmd/tools` CLI 目前仅暴露 `ensure-project`、`repair-project`、`update-schema`，**不**暴露 policy 或 referral 管理子命令。这些流程请使用 Control Plane Lambda action API 或 HTTP REST API。
- `list-project-auth-config` 返回完整的 project auth 快照（users、roles、policies、binding policies、referrals、attachments、warnings），比 `GET /api/v1/auth/policies` 范围更广。

### 3.4 内置资源（Built-in Resources）

control plane 管理一组固定的**内置资源**。它们通过各自的 REST endpoint 和 `/control-plane` action 管理——**不是** authz policy 的 `schema` 目标，也不能通过写 policy statement 来授权（例如不存在 `schema: "users"` 或 `schema: "org_units"` 这样的 statement）。control-plane 级别的 admin 是单一的、基于绑定的授权：将 `admin.controlplane` policy 绑定到 principal（见 §7.2）。

每个概念在不同层各自有一致的命名（同一资源在 REST route、JSON 字段、action `kind` 中可能拼写不同）：

| 资源 | JSON（`list-project-auth-config`） | REST route | Action `kind` |
|---|---|---|---|
| Users | `users`（单项：`user`） | `/api/v1/auth/users` | —（由身份层管理） |
| Roles | `roles`（单项：`role`） | `/api/v1/auth/roles` | `role_profile` |
| Policies | `policies`（单项：`policy`） | `/api/v1/auth/policies` | `policy_profile` |
| Binding policies | `binding_policies` | `/api/v1/auth/binding-policies` | — |
| 组织架构 / org units | `org_units`（OU；标识 `ou_id` / `parent_ou_id` / `ou_path`） | `/api/v1/org/units`（只读视图：`/api/v1/org/charts`） | — |
| OU-policy 绑定 | `ou_policy_attachments` | `/api/v1/org/units/{ou_id}/policies` | — |
| Principal-policy 绑定 | `principal_policy_attachments` | `/api/v1/auth/principals/{type}/{id}/policies` | `principal_policy_attachment` |
| User-role 绑定 | （归在 users 下） | `/api/v1/auth/users/{user_id}/roles/{role_id}` | `user_role_attachment` |
| Referrals | `referrals` | `/api/v1/auth/referrals` | （通过 `import-referrals`） |

说明：

- **“组织架构 / org chart”是概念词，不是资源名。** 数据模型是 **org units**（`org_units` / OU）。层级通过 `parent_ou_id` 和物化的 `ou_path` 编码；`/api/v1/org/charts` 只是该树的只读渲染。见 `aaa.md` §5.7。
- org units 和 OU-policy 绑定仅通过 `/api/v1/org/...` REST endpoint 管理；`create-iam-authz-records` 没有对应的 `kind`。

## 4. 通用数据结构

在存储记录与响应中，`policy_id` 和 `role_id` 是服务端生成的 UUIDv7 持久标识符（由 auth
service 定义）；可读的 `slug` 是便捷引用键，调用方可在请求中用它引用实体。`ou_id` 与
`user_id` 由调用方/身份提供。唯一例外是 `create-iam-authz-records` 动作载荷（§7.2）中由
调用方提供的 `policy_id`/`role_id`——该动作要求调用方显式提供持久 id。

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
  "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
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

说明：

- `policy_attachments` 是 org-chart read model 使用的字段名。
- 在 V1 中，这里的条目当前是 OU policy attachment 记录，例如 `{ "ou_id": "...", "policy_id": "...", "enforced": false }`。
- 这与 auth-config 快照中的 `ou_policy_attachments` 是有意区分的，因为 org-chart 响应是面向 UI 的聚合读模型，不是快照字段的直接搬运。

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
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
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
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
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

字段说明：

- org-chart read model 顶层字段使用 `policy_attachments`。
- 当前 V1 载荷中这里可以承载 OU policy attachment 对象。

## 7. 旧版 `/control-plane` Action API 说明

Admin REST API 不替代现有的 action-style control-plane API。

产品化管理后台与自动化配置请使用 REST admin API。

Lambda Console 风格运维、CLI 流程和后端运维任务继续使用 `/control-plane`。

特别是：

- `ensure-project`、repair、schema、catalog、migration 等仍保留在 `/control-plane`
- `migrate-authz-policy-model` 与 `migrate-authz-resource-identity` 是运维 action，不是 `/api/v1/...` REST endpoint
- admin REST 合约是 resource-oriented，而 `/control-plane` 是 action-oriented

### 7.1 通用请求字段

所有 `/control-plane` action 共用以下顶层 JSON 字段（`ControlPlaneRequest`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | string | 是 | 操作名称 |
| `project_id` | UUID string | 视 action 而定 | 目标 project UUID |
| `data` | JSON array/object | 视 action 而定 | action 数据载荷 |
| `dry_run` | bool | 否 | 预览模式，不实际写入 |
| `force` | bool | 否 | 覆盖已存在的冲突记录 |

`dry_run` 和 `force` 仅被显式声明支持的 action 识别（如 `create-iam-authz-records`）。`import-referrals` 会忽略二者。

响应 envelope：

```json
{
  "action": "create-iam-authz-records",
  "status": "success",
  "result": {}
}
```

### 7.2 `create-iam-authz-records`

用途：为 project 批量创建 IAM/authz 记录（role profile、policy profile、principal-policy attachment 和 user-role attachment）。

这是一个更底层的种子/迁移 action。产品化 policy 管理请使用 `POST /api/v1/auth/policies`（见 `API-specs-auth-service.cn.md`）。

**支持的 `kind`：**

| Kind | 必填字段 | 用途 |
|---|---|---|
| `role_profile` | `role_id`、`name` | 创建角色 |
| `policy_profile` | `policy_id`、`name` | 创建含 policy document 的授权策略 |
| `principal_policy_attachment` | `principal_type`、`principal_id`、`policy_id` | 将 policy 绑定到 user 或 role |
| `user_role_attachment` | `user_id`、`role_id` | 给 user 分配 role |

**示例：policy profile**

```json
{
  "action": "create-iam-authz-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": [
    {
      "kind": "policy_profile",
      "policy_id": "policy.lead.read",
      "name": "Lead Read",
      "slug": "lead.read",
      "external_key": "lead-read-v1",
      "policy_document": {
        "statements": [
          {
            "effect": "allow",
            "ops": ["read"],
            "schema": "lead",
            "selector": { "resource_id": ["*"] }
          }
        ]
      }
    }
  ]
}
```

`policy_profile` 的 `data[]` 字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | string | 是 | 必须为 `"policy_profile"` |
| `policy_id` | string | 是 | durable policy 标识 |
| `name` | string | 是 | 可读名称 |
| `slug` | string | 否 | 语义 slug（如 `"lead.read"`） |
| `external_key` | string | 否 | 外部引用 key |
| `policy_document` | JSON object 或 JSON string | 否 | policy 语句；见 `rfc/CN/aaa.md` §6 |

**示例：role profile + principal-policy attachment**

```json
{
  "action": "create-iam-authz-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": [
    {
      "kind": "role_profile",
      "role_id": "role.sales",
      "name": "Sales",
      "slug": "role.sales"
    },
    {
      "kind": "principal_policy_attachment",
      "principal_type": "role",
      "principal_id": "role.sales",
      "policy_id": "policy.lead.read"
    }
  ]
}
```

说明：

- `force` 标志允许覆盖已存在记录。
- `dry_run` 返回计数但不写入。
- 写入 `policy_profile` 会自动触发语义 project reseed。
- 与 `POST /api/v1/auth/policies` 不同，该 action **不会**生成 `policy_id`；调用方必须提供。
- 该 action 按原样存储 `policy_document`（仅校验为合法 JSON 并压缩），**不**校验文档内部结构。statement 的规范 schema 由 `rfc/CN/aaa.md` §6 定义，以其为准。

**示例：创建 Control Plane Admin Policy 并绑定给用户**

Control Plane Admin API 要求调用者持有 admin policy。`slug` 必须为 `admin.controlplane`；control-plane 鉴权通过 slug 解析到 durable policy ID。旧布局迁移产生的 `generated#permission#controlplane.admin` 仅作为兼容回退识别。

```json
{
  "action": "create-iam-authz-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": false,
  "data": [
    {
      "kind": "policy_profile",
      "policy_id": "0190b3c4-1a2b-7c3d-8e4f-000000000002",
      "slug": "admin.controlplane",
      "external_key": "controlplane-admin-v1",
      "name": "Control Plane Admin",
      "description": "Full access to control plane admin APIs",
      "policy_document": { "statements": [] }
    },
    {
      "kind": "principal_policy_attachment",
      "principal_type": "user",
      "principal_id": "<USER_ID>",
      "policy_id": "0190b3c4-1a2b-7c3d-8e4f-000000000002"
    }
  ]
}
```

admin policy 的 `policy_document` 内容不会被 control-plane admin 鉴权检查；鉴权唯一路径是通过 `principal_policy_attachment` 将 admin policy 绑定到用户（或通过角色间接绑定，先将 policy 绑定到 role，再将 role 分配给用户）。因此空的 `statements` 列表即可。control-plane admin 是单一的、基于绑定的授权，而非按资源的 op：`controlplane` 不是 entity schema，`admin` 也不是合法 op——entity statement 通过 `schema` 配合 `selector` 限定实体，op 仅限 `create` / `read` / `update` / `delete` / `*`（见 `aaa.md` §6）。

如果已通过 REST Admin API 存在 admin，也可以使用 REST 绑定：`PUT /api/v1/auth/principals/user/<USER_ID>/policies/admin.controlplane`，其中 `admin.controlplane` 作为 slug 解析。

### 7.3 `import-referrals`

用途：向 project 导入一个或多个 referral code，可附带绑定的 policy ID。

该 action 对应 REST API 的 `POST /api/v1/auth/referrals?import=1`（见 `API-specs-auth-service.cn.md`）。

**批量模式**（通过 `data` 数组）：

```json
{
  "action": "import-referrals",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": [
    {
      "referral_code": "CODE001",
      "policy_id": "policy.lead.read",
      "expires_at_ms": 1767139200000
    },
    {
      "referral_code": "CODE002"
    }
  ]
}
```

`data[]` 字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `referral_code` | string | 是 | referral code，最长 256 字符 |
| `policy_id` | string | 否 | durable policy id 或 slug；写入时解析为 durable id 存储。不存在或无效 policy 返回错误。 |
| `expires_at_ms` | int64 或 string | 否 | 过期时间（epoch 毫秒）。省略、`0` 或空表示永不过期。 |
| `project_id` | UUID string | 否 | 单条记录的 project ID（如与顶层 `project_id` 冲突会报错）。 |

**单条模式**（不用 `data`，使用顶层字段）：

```json
{
  "action": "import-referrals",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "referral_code": "CODE001",
  "referral_policy_id": "policy.lead.read",
  "referral_expires_at_ms": 1767139200000
}
```

**响应：**

```json
{
  "action": "import-referrals",
  "status": "success",
  "result": {
    "total": 2,
    "imported": 1,
    "skipped_existing": 1
  }
}
```

行为说明：

- 已存在的 referral code 会被**跳过**（条件写入），计入 `skipped_existing`。
- `policy_id` 在写入时即时校验：引用不存在的 policy 返回 `policy_not_found` 错误。
- 当 `policy_id` 为 slug 时，写入前会解析为 durable `policy_id`。
- 省略 `policy_id` 保持旧绑定行为（身份绑定时不会自动附加 policy）。
- 在 REST referral 资源上，`PATCH /api/v1/auth/referrals/{code}` 仅接受 `expires_at_ms`；`policy_id` 不是可接受的 PATCH 字段，会被静默忽略（而非报错拒绝）。绑定在创建后可视为不可变。
