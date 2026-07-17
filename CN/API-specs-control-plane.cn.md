# LTBase API 规格：Control Plane

本文档描述 control-plane admin REST API 中 `/api/v1/org/...` 与运维类路由（status、repair、catalogs、compliance-profile 等）的已实现合约，以及与其分离的 `/control-plane` 运维 action API。

- 代码基线：
  - `ltbase.api/cmd/controlplane`
  - `ltbase.api/internal/routemanifest/controlplane.go`（权威路由表）
  - `rfc/CN/aaa.md`
- 文档语言：中文
- 更新日期：2026-07-16

## 1. 总览

Control-plane admin REST surface 按路由族拆分：

- `/api/v1/auth/...`：AAA 配置与 referral 管理（见 `API-specs-control-plane-service-auth-routes.cn.md`）
- `/api/v1/org/...`：组织架构与 OU 管理
- 运维与目录路由：`/status`、`/schema/status`、`/repair/*`、`/catalogs/*`、`/compliance-profile`、`/workflows`

本文档覆盖 `/api/v1/org/...` 路由、运维/目录路由，以及 admin REST API 与 `/control-plane` 运维 action API 的边界。

路由服务方式：

- 所有 REST 路由同时挂载在 **两个前缀** 下：`/api/v1/...` 与 `/api/control-plane/v1/...`（`routemanifest.ControlPlanePrefixes`）。两个前缀行为完全一致。
- 路由表（`internal/routemanifest/controlplane.go` 的 `ControlPlaneRouteSuffixes`）是 load-bearing 的 allowlist：不匹配表内 `METHOD /path` 的请求在鉴权之后一律返回 `404`。

命名空间归属说明：`/api/v1/auth/*` 命名空间由两个服务分治。`cmd/authservice` 是独立的终端用户 token 服务，提供 `health`、`refresh`、`revoke`、`profile/{user_id}` 以及 `login/{provider}`、`id_bindings/{provider}` 等身份路由（见 `internal/authservice/routes.go`）；control plane 提供本文档与 `API-specs-control-plane-service-auth-routes.cn.md` 描述的 admin 管理面。两者互不重叠。

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

**Org 读路由的放宽鉴权**：`GET /api/v1/org/...`（含 `/org/charts`）使用更宽松的 org-read 鉴权：admin **或** 任何 referral-bound 用户（`referral_code` 非空的已绑定用户）均可读取。非以上二者返回：

```json
{
  "request_id": "req_123",
  "code": "forbidden",
  "message": "referral-bound user required"
}
```

Org 的所有写操作（POST/PATCH/PUT/DELETE）仍要求 admin。未知路由在鉴权 **之后** 才返回 404，因此无法用未授权请求探测路由表。

**唯一例外：CORS preflight。** 任何 `OPTIONS` 请求在鉴权与路由匹配**之前**直接返回 `204 No Content`（仅带 CORS 头，无响应体，因此也没有 `request_id` envelope）。preflight 不是正常的 API 响应，不受本节鉴权规则与 §2.3 envelope 约定的约束。

### 2.2 Project 作用域

LTBase 当前在 control plane 上只支持单 project 私有部署。

因此：

- 每个 control-plane admin REST 请求都隐式作用于部署环境配置中的 project（服务端忽略请求内容，直接使用部署 project）
- 客户端不能在 path、query、header 或 body 中提供 `project_id`（例外：`/repair/*` 的 body 可显式携带 `project_id`，但必须解析为合法 UUID，通常应省略以使用部署 project）
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

- 整个 REST surface 中只有 `GET /api/v1/auth/referrals` 返回 `total`；org 与运维路由的集合响应只有 `items`。
- 单资源响应的 `data` 内层键并不统一：org unit 相关为 `data.org_unit`，用户相关为 `data.user`，OU-policy 绑定为 `data.attachment`，删除/解绑类操作返回带 `status` 字段的小对象。以下各节按实际形状描述。
- catalogs 与 compliance-profile 路由是例外：响应顶层为 `{"request_id", "project_id", "data"}`，`data` 直接是原始目录 JSON（见 §7）。

错误响应：

```json
{
  "request_id": "req_123",
  "code": "invalid_body",
  "message": "invalid request body"
}
```

字段级或校验诊断可以通过可选 `details` 返回（如 catalogs PUT 校验失败时的 `details.field = "data"`）。

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

### 3.1 Admin REST 路由

以下路由全部已在当前代码中实现并注册（每条同时挂载于 `/api/v1` 与 `/api/control-plane/v1` 前缀）。

组织架构路由：

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

运维与目录路由：

| Method | Path | 功能 |
| --- | --- | --- |
| GET | `/api/v1/status` | 部署项目状态概要 |
| GET | `/api/v1/schema/status` | 已应用 / 已发布 schema 版本对比 |
| POST | `/api/v1/repair/dry-run` | Repair 预演（不写入） |
| POST | `/api/v1/repair/apply` | 执行 repair（需 `confirm: true`） |
| GET / PUT | `/api/v1/catalogs/capabilities` | 读取 / 写入 capability catalog |
| GET / PUT | `/api/v1/catalogs/action-templates` | 读取 / 写入 action template catalog |
| GET / PUT | `/api/v1/catalogs/assistant-roles` | 读取 / 写入 assistant role catalog |
| GET / PUT | `/api/v1/compliance-profile` | 读取 / 写入 compliance profile |
| GET | `/api/v1/workflows` | 列出 workflow 定义（dev-only，见 §7.5） |

### 3.2 `/control-plane` Actions

以下接口以运维 action 的形式通过 `POST /control-plane`（或直接 Lambda invoke）提供，完整清单（`main.go` dispatch）：

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
| `POST /api/v1/repair/dry-run` / `POST /api/v1/repair/apply` | `repair-project` | `repair-project` |
| `GET/PUT /api/v1/catalogs/capabilities` | `get/put-project-capability-catalog` | **无** |
| `GET/PUT /api/v1/catalogs/action-templates` | `get/put-project-action-template-catalog` | **无** |
| `GET/PUT /api/v1/catalogs/assistant-roles` | `get/put-project-assistant-role-catalog` | **无** |
| `GET/PUT /api/v1/compliance-profile` | `get/put-project-compliance-profile` | **无** |

说明：

- （*）`create-iam-authz-records` 是一个更底层的批量种子写入 action。REST `POST /api/v1/auth/policies` 会自动生成 durable `policy_id`；`create-iam-authz-records` 要求调用方显式提供 `policy_id`。action 适用于种子数据、迁移和运维批量写入，REST endpoint 是产品化管理合同。
- `cmd/tools` CLI 目前仅暴露 `ensure-project`、`repair-project`、`update-schema`，**不**暴露 policy 或 referral 管理子命令。这些流程请使用 Control Plane Lambda action API 或 HTTP REST API。
- `list-project-auth-config` 返回完整的 project auth 快照（users、roles、policies、binding policies、referrals、attachments、warnings），比 `GET /api/v1/auth/policies` 范围更广。
- `ensure-project`、`update-schema`、`migrate-authz-*` 没有 REST 等价物，仍仅通过 action API 提供。

### 3.4 内置资源（Built-in Resources）

control plane 管理一组固定的**内置资源**。它们通过各自的 REST endpoint 和 `/control-plane` action 管理——**不是** authz policy 的 `schema` 目标，也不能通过写 policy statement 来授权（例如不存在 `schema: "users"` 或 `schema: "org_units"` 这样的 statement）。control-plane 级别的 admin 是单一的、基于绑定的授权：将 `admin.controlplane` policy 绑定到 principal（见 §8.2）。

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
`user_id` 由调用方/身份提供。唯一例外是 `create-iam-authz-records` 动作载荷（§8.2）中由
调用方提供的 `policy_id`/`role_id`——该动作要求调用方显式提供持久 id。

### 4.1 ControlPlaneUser（公开 DTO）

org 与 auth REST 路由返回的用户对象形状（`apiPublicAuthUser`）：

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

说明：公开 DTO **不含** `referral_code`；只有 `GET /api/v1/auth/config` 快照中的用户对象包含 `referral_code`（快照专用形状见 `API-specs-control-plane-service-auth-routes.cn.md` §5）。

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

`GET /api/v1/org/units/{ou_id}/policies` 返回的完整形状（含嵌套 policy 对象）：

```json
{
  "ou_id": "ou_team_android",
  "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
  "enforced": false,
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "policy": {
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "name": "Sales Read Policy",
    "slug": "policy.sales_read",
    "document": { "statements": [] },
    "created_at": 1760000000000,
    "updated_at": 1760000000000
  }
}
```

org-chart 与 PUT attach 响应中的变体省略嵌套 `policy`，只含 `ou_id`、`policy_id`、`enforced`、`created_at`、`updated_at`。

### 4.4 Manager 关系

manager 关系不再以扁平字段返回，而是返回完整的用户对象对：

```json
{
  "user": { "user_id": "user_alice", "report_to_user_id": "user_manager_1" },
  "manager": { "user_id": "user_manager_1" }
}
```

（`user` / `manager` 均为完整 ControlPlaneUser 对象，示例已省略其余字段。）

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

- `policy_attachments` 是 org-chart read model 使用的字段名，条目形如 `{ "ou_id": "...", "policy_id": "...", "enforced": false, "created_at": ..., "updated_at": ... }`（无嵌套 policy）。
- 这与 auth-config 快照中的 `ou_policy_attachments` 是有意区分的，因为 org-chart 响应是面向 UI 的聚合读模型，不是快照字段的直接搬运。

## 5. 组织架构语义与约束

组织架构模型包含两条相互独立的关系：

- 通过 `primary_ou_id` 与 `parent_ou_id` 表达 OU containment
- 通过 `report_to_user_id` 表达 manager relationship

V1 规则：

- OU containment 必须形成树
- `ou_path` 由服务端维护，客户端只读（创建/更新请求不接受 `ou_path`）
- 移动 OU 时必须安全重算整棵子树的路径
- OU 不能移动到自己的后代子树中
- 用户不能直接或间接向自己汇报
- dotted-line 或 matrix reporting 不在 V1 范围内
- OU 不是 principal，不能用于 principal policy attachment
- OU 范围授权通过 OU policy attachment 实现
- `block_inheritance` 与 `enforced` 为前向兼容字段，可接受并存储，但 V1 运行时仍按简单 ancestor-union inheritance 处理

## 6. Org Chart APIs

实现状态：全部路由已在当前代码中落地（`cmd/controlplane/api_org.go`）。

错误码约定（org 路由通用）：

- `404 not_found`：OU、用户或 policy 不存在
- `409 invalid_org_cycle`：OU 移动或汇报关系形成环
- `409 ou_not_empty`：删除仍有子 OU 或用户的 OU
- `400 invalid_body`：body 解析失败或其他写入校验失败
- `405 method_not_allowed`：路径存在但方法不支持
- 读路径的存储失败返回 `500`，code 为 `list_org_units_failed`、`get_org_unit_failed` 等

### 6.1 Org Units

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

响应（`201 Created`）：

```json
{
  "request_id": "req_123",
  "data": {
    "org_unit": {
      "ou_id": "ou_team_android",
      "name": "Team Android",
      "parent_ou_id": "ou_mobiledev",
      "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
      "block_inheritance": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

说明：

- 客户端不能传 `ou_path`，该字段由服务端维护
- 单资源响应嵌套在 `data.org_unit` 下

#### `GET /api/v1/org/units/{ou_id}`

用途：获取单个 OU。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "org_unit": {
      "ou_id": "ou_team_android",
      "name": "Team Android",
      "parent_ou_id": "ou_mobiledev",
      "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
      "block_inheritance": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
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

响应：`200`，形状与 GET 相同（`data.org_unit`）。

如果移动会形成 containment cycle，服务端返回 `409 invalid_org_cycle`。

#### `DELETE /api/v1/org/units/{ou_id}`

用途：仅当没有子 OU 且没有分配用户时删除 OU。

响应（`200`）：

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "status": "deleted"
  }
}
```

冲突返回 `409 ou_not_empty`。

### 6.2 Org Unit Users 与 Policies

#### `GET /api/v1/org/units/{ou_id}/users`

用途：列出 OU 下用户。

支持的 query 参数：

- `include_subtree=true`

响应：`items` 为完整 ControlPlaneUser 对象数组（见 §4.1，含 `provider`、时间戳等字段）：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "user_id": "user_alice",
      "provider": "google",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "last_login_at": 1760000005000
    }
  ]
}
```

#### `PUT /api/v1/org/units/{ou_id}/users/{user_id}`

用途：把用户移动到指定 OU。无请求体。

响应：

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

该路由是直接更新 user 资源的便捷形式，返回完整用户对象（`data.user`）。

#### `GET /api/v1/org/units/{ou_id}/policies`

用途：列出挂载到 OU 的策略。

响应：`items` 为完整 OUPolicyAttachment（见 §4.3，含时间戳与嵌套 `policy` 对象）：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "ou_id": "ou_team_android",
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "enforced": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "policy": {
        "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
        "name": "Sales Read Policy",
        "document": { "statements": [] },
        "created_at": 1760000000000,
        "updated_at": 1760000000000
      }
    }
  ]
}
```

#### `PUT /api/v1/org/units/{ou_id}/policies/{policy_id}`

用途：给 OU 挂载策略。`{policy_id}` 可为 durable id 或 slug。

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
    "attachment": {
      "ou_id": "ou_team_android",
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "enforced": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

#### `DELETE /api/v1/org/units/{ou_id}/policies/{policy_id}`

用途：解绑 OU 上的策略。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "status": "detached"
  }
}
```

说明：

- OU 不是 principal
- `block_inheritance` 与 `enforced` 在 V1 中会被存储，但不会参与 evaluator

### 6.3 Manager APIs

#### `GET /api/v1/org/users/{user_id}/manager`

用途：获取用户直属经理。

响应：`user` 与 `manager` 均为完整 ControlPlaneUser 对象：

```json
{
  "request_id": "req_123",
  "data": {
    "user": {
      "user_id": "user_alice",
      "report_to_user_id": "user_manager_1"
    },
    "manager": {
      "user_id": "user_manager_1",
      "report_to_user_id": ""
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
    "user": {
      "user_id": "user_alice",
      "report_to_user_id": "user_manager_1"
    }
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
    "user": {
      "user_id": "user_alice",
      "report_to_user_id": ""
    },
    "status": "cleared"
  }
}
```

#### `GET /api/v1/org/users/{user_id}/direct-reports`

用途：列出用户直属下属。

支持的 query 参数：

- `recursive=true`

响应：`items` 为完整 ControlPlaneUser 对象数组：

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

循环保护错误返回 `409 invalid_org_cycle`。

### 6.4 Org Chart Read Model

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

- org-chart read model 顶层字段使用 `policy_attachments`，条目为 `{ "ou_id", "policy_id", "enforced", "created_at", "updated_at" }`（无嵌套 policy）。
- 鉴权上该路由属于 org 读路由，referral-bound 用户也可访问（见 §2.1）。

## 7. 运维与目录 REST 路由

实现状态：全部已在当前代码中落地。

### 7.1 Status

#### `GET /api/v1/status`

用途：返回部署项目的状态概要。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "project_name": "my-deployment",
    "account_id": "123456789012",
    "api_base_url": "https://api.example.com",
    "has_runtime_info": true
  }
}
```

`has_runtime_info` 表示能否成功读取 project runtime info。

#### `GET /api/v1/schema/status`

用途：对比已应用（runtime）与已发布（schema bucket）的 schema 元数据。

响应：

```json
{
  "request_id": "req_123",
  "data": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "applied_schema_version": "v42",
    "applied_schema_sha256": "abc123...",
    "applied_schema_at": 1760000000000,
    "published_version": "v43",
    "published_sha256": "def456..."
  }
}
```

所有 schema 字段均为 `omitempty`：对应元数据读取失败时字段缺席，响应仍为 `200`。

### 7.2 Repair

#### `POST /api/v1/repair/dry-run`

用途：预演 repair，不写入。body 可选。

请求体（全部字段可选）：

```json
{
  "project_id": "11111111-1111-4111-8111-111111111111",
  "force_rebuild_views": false
}
```

响应：`200`，`data` 为 repair report。

#### `POST /api/v1/repair/apply`

用途：执行 repair。body 必填，且必须携带 `confirm: true`。

请求体：

```json
{
  "confirm": true,
  "force_rebuild_views": false
}
```

错误码：

- `400 missing_body`：apply 缺少 body
- `400 confirmation_required`：`confirm` 不为 true
- `400 invalid_project_id`：body 中的 `project_id` 非法（省略时使用部署 project）
- `400 invalid_body`：body 解析失败
- `500 repair_failed`：repair 执行失败

### 7.3 Catalogs

三个 catalog 子资源共享同一合约：`capabilities`、`action-templates`、`assistant-roles`。

#### `GET /api/v1/catalogs/{capabilities|action-templates|assistant-roles}`

响应（注意：**不是** `data` envelope，`project_id` 在顶层）：

```json
{
  "request_id": "req_123",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": { "version": 1, "capabilities": [] }
}
```

`data` 是原样存储的目录 JSON。`assistant-roles` 在尚无记录时返回默认值 `{"version":1,"roles":[]}`（`200`），不报 404。

#### `PUT /api/v1/catalogs/{capabilities|action-templates|assistant-roles}`

请求体即目录 JSON 本身（不包一层 `data`）。服务端先做结构校验再存储，成功返回与 GET 相同的形状。

错误码：

- `400 invalid_data`：body 为空或不是 JSON object
- `400 invalid_capability_catalog` / `invalid_action_template_catalog` / `invalid_assistant_role_catalog`：结构校验失败，`details.field = "data"`
- `500 load_schema_registry_failed`（仅 capabilities）：加载 schema registry 失败
- `500 put_*_catalog_failed`：存储失败

capability catalog 的校验会对照 schema registry 中已知的 entity schema 名。

### 7.4 Compliance Profile

#### `GET /api/v1/compliance-profile` / `PUT /api/v1/compliance-profile`

与 catalogs 合约一致：GET 返回 `{"request_id", "project_id", "data"}`；PUT 的 body 即 profile JSON，校验失败返回 `400 invalid_compliance_profile`（`details.field = "data"`），其余错误码为 `invalid_data`、`put_compliance_profile_failed`。

### 7.5 Workflows（dev-only）

#### `GET /api/v1/workflows`

用途：列出 workflow 定义概要。**这是 local-testing / 开发用途的路由**：数据来自本地 JSON 定义文件（`LTBASE_LOCAL_TESTING_WORKFLOW_DEFINITION_PATHS` 或内置候选路径），没有数据库后备，生产部署通常返回空列表。

响应：

```json
{
  "request_id": "req_123",
  "items": [
    {
      "name": "claim-review",
      "active_version": "1",
      "referenced_tools": ["tool_a", "tool_b"]
    }
  ]
}
```

## 8. `/control-plane` Action API 说明

Admin REST API 不替代现有的 action-style control-plane API。

产品化管理后台与自动化配置请使用 REST admin API。

Lambda Console 风格运维、CLI 流程和后端运维任务继续使用 `/control-plane`。

特别是：

- `ensure-project`、`update-schema`、migration 等仍仅通过 `/control-plane` 提供
- `migrate-authz-policy-model` 与 `migrate-authz-resource-identity` 是运维 action，不是 `/api/v1/...` REST endpoint
- admin REST 合约是 resource-oriented，而 `/control-plane` 是 action-oriented

### 8.1 通用请求字段

所有 `/control-plane` action 共用以下顶层 JSON 字段（`ControlPlaneRequest`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | string | 是 | 操作名称（大小写不敏感，空值报 `missing_action`，未知报 `unknown_action`） |
| `project_id` | UUID string | 视 action 而定 | 目标 project UUID |
| `data` | JSON array/object | 视 action 而定 | action 数据载荷 |
| `dry_run` | bool | 否 | 预览模式，不实际写入 |
| `force` | bool | 否 | 覆盖已存在的冲突记录 |

`dry_run` 和 `force` 仅被显式声明支持的 action 识别（如 `create-iam-authz-records`、`update-schema`、`migrate-authz-*`）。`import-referrals` 会忽略二者。

响应 envelope：

```json
{
  "action": "create-iam-authz-records",
  "status": "success",
  "result": {}
}
```

HTTP 状态：`ensure-project`、`create-iam-authz-records`、`import-referrals` 成功返回 `201`，其余 action 成功返回 `200`。

### 8.2 `create-iam-authz-records`

用途：为 project 批量创建 IAM/authz 记录（role profile、policy profile、principal-policy attachment 和 user-role attachment）。

这是一个更底层的种子/迁移 action。产品化 policy 管理请使用 `POST /api/v1/auth/policies`（见 `API-specs-control-plane-service-auth-routes.cn.md`）。

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

**Result 形状：**

```json
{
  "total": 2,
  "inserted": 2,
  "overwritten": 0,
  "dry_run_insert": 0,
  "dry_run_overwrite": 0,
  "dry_run": false,
  "force": false
}
```

说明：

- `force` 标志允许覆盖已存在记录。
- `dry_run` 返回计数（`dry_run_insert` / `dry_run_overwrite`）但不写入。
- 写入 `policy_profile` 会自动触发语义 project reseed。
- 与 `POST /api/v1/auth/policies` 不同，该 action **不会**生成 `policy_id`；调用方必须提供。
- 该 action 按原样存储 `policy_document`（仅校验为合法 JSON 并压缩），**不**校验文档内部结构。statement 的规范 schema 由 `rfc/CN/aaa.md` §6 定义，以其为准。
- `data` 为空数组时报错（`data cannot be empty`）。同一批次内重复的逻辑键报 `duplicated logical item key`。
- 错误码：校验失败 → `400 invalid_iam_authz_data`；已存在冲突 → `409 iam_authz_record_conflict`；其他 → `500 create_iam_authz_records_failed`。

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

### 8.3 `import-referrals`

用途：向 project 导入一个或多个 referral code，可附带绑定的 policy ID。

该 action 对应 REST API 的 `POST /api/v1/auth/referrals?import=1`（见 `API-specs-control-plane-service-auth-routes.cn.md`）。

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
| `expires_at_ms` | int64 或数字字符串 | 否 | 过期时间（epoch 毫秒）。省略、`0` 或空表示永不过期。 |
| `project_id` | UUID string | 否 | 单条记录的 project ID；如提供则必须等于顶层 `project_id`，否则报错。 |

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

**响应（`201`）：**

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
- `policy_id` 在写入时即时校验，但错误码在两个入口不同：REST endpoint（`POST /api/v1/auth/referrals` 及 `?import=1`）把不存在的 policy 翻译为 `400 policy_not_found`；本 action **不做**该翻译，policy 不存在与其他导入失败一并返回 `500 import_referrals_failed`（错误消息中包含底层原因）。
- 当 `policy_id` 为 slug 时，写入前会解析为 durable `policy_id`。
- 省略 `policy_id` 保持旧绑定行为（身份绑定时不会自动附加 policy）。
- 在 REST referral 资源上，`PATCH /api/v1/auth/referrals/{code}` 仅接受 `expires_at_ms`；`policy_id` 不是可接受的 PATCH 字段，会被静默忽略（而非报错拒绝）。绑定在创建后可视为不可变。
