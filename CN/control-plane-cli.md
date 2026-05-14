# Control Plane — AWS Lambda Console 调用手册

本文档说明如何通过 **AWS Lambda Console 的 Test 功能**直接调用 Control Plane Lambda，用于运维和排查。

## 1. 当前模型

- 仅支持私有化部署，每个部署只有一个固定 project
- deployment project 由环境变量 `PROJECT_ID`、`PROJECT_NAME`、`ACCOUNT_ID`、`API_BASE_URL` 定义
- Control Plane Lambda 启动时自动执行 `EnsureProject` bootstrap

## 2. 如何使用 Lambda Console Test

1. 打开 [AWS Lambda Console](https://console.aws.amazon.com/lambda)，进入 Control Plane 函数页面
2. 点击顶部 **Test** 标签页
3. 选择 **Create new event** 或编辑已有 event
4. 将下方各 action 对应的 JSON 粘贴到 Event JSON 框
5. 点击 **Test** 按钮执行
6. 在 **Execution result** 面板查看响应（`status`、`result` 或 `error`）

> **注意**：Lambda Console Test 使用直接调用（Invoke）方式，payload 为纯 JSON，不需要 HTTP 包装。

## 3. 通用请求字段

所有 action 共用以下顶层 JSON 字段（`ControlPlaneRequest`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 操作名称 |
| `project_id` | UUID string | 视 action 而定 | 目标 project UUID |
| `data` | JSON array / object | 视 action 而定 | action 专属数据载荷 |
| `dry_run` | bool | 否 | 预览模式，不实际写入 |
| `force` | bool | 否 | 覆盖已存在的冲突记录 |
| `force_rebuild_views` | bool | 否 | `repair-project` 强制重建 Postgres 视图 |
| `tenant_id` | UUID string | 否 | 兼容期 tenant ID（已废弃） |
| `project_name` | string | 否 | 兼容期 project 名称（已废弃） |
| `account_id` | string | 否 | 账户 ID |
| `api_id` | string | 否 | API ID |
| `api_base_url` | string | 否 | API 基础 URL |
| `referral_code` | string | 否 | `import-referrals` 单条模式的 referral code |
| `referral_expires_at_ms` | int64 | 否 | `import-referrals` 单条模式的过期时间（epoch 毫秒） |

## 4. 支持的 Action 及 Test Event 示例

> **已废弃的 action**：`create-key`、`delete-key` 已 retired，调用会返回 `"unknown_action"` 错误。

### 4.1 `ensure-project`

确保 deployment project 存在并完成 bootstrap。无需额外参数，project 信息从环境变量读取。

```json
{
  "action": "ensure-project"
}
```

### 4.2 `repair-project`

检查并修复 project 的 DynamoDB 记录和 Postgres SQL 对象。支持 `dry_run` 预览。

```json
{
  "action": "repair-project",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": true
}
```

带全量可选参数的示例：

```json
{
  "action": "repair-project",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "account_id": "acc123",
  "api_base_url": "https://api.example.com",
  "api_id": "11111111-1111-4111-8111-111111111111",
  "tenant_id": "22222222-2222-4222-8222-222222222222",
  "force_rebuild_views": true,
  "dry_run": false
}
```

### 4.3 `update-schema`

更新 project 的 schema 注册表（schema name ↔ schema ID 映射）。支持 `dry_run` 和 `force`（覆盖冲突）。`schema_id` 范围：1–32767。

`data[]` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project_id` | UUID string | 是 | 目标 project UUID |
| `schema_name` | string | 是 | schema 名称 |
| `schema_id` | int (1–32767) | 是 | schema 数字 ID |

```json
{
  "action": "update-schema",
  "dry_run": true,
  "data": [
    {
      "project_id": "11111111-1111-4111-8111-111111111111",
      "schema_name": "lead",
      "schema_id": 1
    },
    {
      "project_id": "11111111-1111-4111-8111-111111111111",
      "schema_name": "visit",
      "schema_id": 2
    }
  ]
}
```

### 4.4 `create-permission-records`

为 project 批量创建权限记录。

`data[]` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `permission_id` | string | 是 | 权限唯一标识 |
| `name` | string | 是 | 权限显示名称（可用 `permission_name` 代替） |
| `permission_name` | string | 否 | 权限显示名称（`name` 的别名） |
| `description` | string | 否 | 权限描述 |
| `rule_json` | JSON object / string | 否 | 权限规则 |
| `outcome` | string | 否 | 权限结果 |

```json
{
  "action": "create-permission-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": false,
  "data": [
    {
      "permission_id": "perm_read_notes",
      "name": "read:notes",
      "description": "Read access to notes"
    },
    {
      "permission_id": "perm_write_notes",
      "name": "write:notes",
      "rule_json": { "resource": "notes" }
    }
  ]
}
```

### 4.5 `create-iam-authz-records`

批量创建 IAM 授权记录。`data` 为 JSON 数组，每条记录必须包含 `kind` 字段。

#### 支持的 `kind` 及字段

##### `role_profile`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 是 | `"role_profile"` |
| `role_id` | string | 是 | 角色唯一标识 |
| `name` | string | 是 | 角色显示名称 |
| `description` | string | 否 | 角色描述 |
| `parent_role_ids` | string[] | 否 | 父角色 ID 列表 |

##### `policy_profile`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 是 | `"policy_profile"` |
| `policy_id` | string | 是 | 策略唯一标识 |
| `name` | string | 是 | 策略显示名称 |
| `description` | string | 否 | 策略描述 |
| `policy_document` | JSON object / string | 否 | 策略文档 |

##### `role_permission_attachment`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 是 | `"role_permission_attachment"` |
| `role_id` | string | 是 | 角色标识 |
| `permission_id` | string | 是 | 权限标识 |
| `name` | string | 否 | 权限显示名称 |

##### `principal_policy_attachment`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 是 | `"principal_policy_attachment"` |
| `principal_type` | string | 是 | 主体类型（如 `"role"`） |
| `principal_id` | string | 是 | 主体标识 |
| `policy_id` | string | 是 | 策略标识 |

##### `user_role_attachment`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 是 | `"user_role_attachment"` |
| `user_id` | string | 是 | 用户标识 |
| `role_id` | string | 是 | 角色标识 |

##### `resource_grant`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 是 | `"resource_grant"` |
| `principal_type` | string | 是 | 主体类型（`"role"` 或 `"user"`） |
| `principal_id` | string | 是 | 主体标识 |
| `schema_name` | string | 是 | 目标 schema 名称 |
| `ops` | string[] | 是 | 操作列表：`create`、`read`、`update`、`delete` |
| `resource_id` | string | 条件 | 资源 ID（与 `filter` 二选一；两者都不传时默认为 `"*"`） |
| `filter` | JSON object | 条件 | 属性过滤条件（与 `resource_id` 二选一） |
| `source` | string | 否 | 授权来源，默认为 `"manual"` |

> **`resource_grant` 选择器规则**：
>
> - `resource_id` 和 `filter` **只能二选一**，同时传会报错。
> - 两者都不传时默认为 `resource_id: "*"`（全量授权）。
> - `filter` 必须是 JSON object，值为字符串操作表达式。支持 `eq:`（等于）、`in:`（包含于）操作符和 `${requester.user_id}`、`${requester.role_ids}` 等占位符。
> - 属性名 `filter_json` **不是有效的请求属性**，传入会被静默忽略，导致 filter 不生效。

#### 完整示例

```json
{
  "action": "create-iam-authz-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": false,
  "data": [
    {
      "kind": "role_profile",
      "role_id": "role_admin",
      "name": "Admin",
      "description": "Full access",
      "parent_role_ids": ["role_viewer"]
    },
    {
      "kind": "policy_profile",
      "policy_id": "policy_read_notes",
      "name": "ReadNotes",
      "policy_document": "{\"statement\":[{\"effect\":\"allow\",\"schema_name\":\"notes\",\"ops\":[\"read\"]}]}"
    },
    {
      "kind": "resource_grant",
      "principal_type": "role",
      "principal_id": "self_scope",
      "schema_name": "log",
      "filter": { "ownerId": "eq:${requester.user_id}" },
      "ops": ["create", "read", "update", "delete"],
      "source": "manual"
    },
    {
      "kind": "user_role_attachment",
      "user_id": "user_001",
      "role_id": "role_admin"
    }
  ]
}
```

### 4.6 `list-project-auth-config`

列出 project 的所有认证/授权配置。返回完整的 IAM 模型快照。

```json
{
  "action": "list-project-auth-config",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

响应 `result` 中包含：`users`、`roles`、`permissions`、`policies`、`grants`、`bindings`、`referrals`、`binding_policies`、`warnings`、`summary` 等。

### 4.7 `migrate-project-auth-records`

迁移 project 的授权记录（schema 版本升级等）。支持 `dry_run`。

```json
{
  "action": "migrate-project-auth-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": true
}
```

### 4.8 `put-project-capability-catalog`

创建或更新 project 的 capability catalog。`data` 为 JSON 对象（非字符串）。

```json
{
  "action": "put-project-capability-catalog",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": {
    "capabilities": [
      { "id": "cap_read", "name": "Read" }
    ]
  }
}
```

### 4.9 `get-project-capability-catalog`

获取 project 的 capability catalog。catalog 不存在时返回 404。

```json
{
  "action": "get-project-capability-catalog",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 4.10 `put-project-compliance-profile`

创建或更新 project 的 compliance profile。`data` 为 JSON 对象（非字符串）。若 profile 为空控制集，使用系统默认 baseline。

```json
{
  "action": "put-project-compliance-profile",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": {
    "version": 1,
    "controls": [
      {
        "id": "capability_must_have_policy",
        "mode": "warn"
      }
    ]
  }
}
```

### 4.11 `get-project-compliance-profile`

获取 project 的 compliance profile。profile 不存在或为空时返回系统默认 baseline。

```json
{
  "action": "get-project-compliance-profile",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 4.12 `put-project-action-template-catalog`

创建或更新 project 的 action template catalog。`data` 为 JSON 对象（非字符串）。

```json
{
  "action": "put-project-action-template-catalog",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": {
    "templates": [
      { "id": "tpl_create_lead", "name": "Create Lead" }
    ]
  }
}
```

### 4.13 `get-project-action-template-catalog`

获取 project 的 action template catalog。catalog 不存在时返回 404。

```json
{
  "action": "get-project-action-template-catalog",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 4.14 `import-referrals`

向 DynamoDB 导入 referral code。支持单条和批量两种模式，重复 code 自动跳过。

**单条**：

```json
{
  "action": "import-referrals",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "referral_code": "EARLYBIRD2024",
  "referral_expires_at_ms": 1800000000000
}
```

**批量**：

```json
{
  "action": "import-referrals",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": [
    { "referral_code": "CODE_A" },
    { "referral_code": "CODE_B", "expires_at_ms": 1800000000000 }
  ]
}
```

## 5. 响应结构

所有 action 共享同一响应格式。

**成功**：

```json
{
  "action": "<action名称>",
  "status": "success",
  "result": { ... }
}
```

示例（`ensure-project`）：

```json
{
  "action": "ensure-project",
  "status": "success",
  "result": {
    "project_id": "11111111-1111-4111-8111-111111111111"
  }
}
```

示例（`create-iam-authz-records`）：

```json
{
  "action": "create-iam-authz-records",
  "status": "success",
  "result": {
    "total": 2,
    "inserted": 2,
    "overwritten": 0,
    "dry_run_insert": 0,
    "dry_run_overwrite": 0,
    "dry_run": false,
    "force": false
  }
}
```

**失败**：

```json
{
  "action": "<action名称>",
  "status": "error",
  "error": "<错误描述>"
}
```

示例：

```json
{
  "action": "list-project-auth-config",
  "status": "error",
  "error": "project ID cannot be empty"
}
```

HTTP 状态码（HTTP 调用时适用）：

| Action | 成功状态码 |
|---|---|
| `ensure-project`、`create-permission-records`、`create-iam-authz-records`、`import-referrals` | `201` |
| 其余 action | `200` |
| 参数错误 | `400` |
| 记录已存在（未设置 `force`） | `409` |
| catalog 不存在 | `404` |
| 执行失败 | `500` |

## 6. DynamoDB 对象模型

### 6.1 Project Metadata

- `PK = project#<project_id>`
- `SK = meta`
- 字段：`name`、`account_id`、`num_of_active_keys`、`updated_at`

### 6.2 Access Key

- `PK = account#<account_id>#project#<project_id>`
- `SK = key#<access_key_id_without_AK_prefix>`
- 字段：`is_active`、`public_key`、`project_id`、`created_at`、`updated_at`

### 6.3 Project Runtime Info

- `PK = project#<project_id>`
- `SK = info`
- 字段：`account_id`、`api_id`、`api_base_url`

### 6.4 IAM Authz 记录

所有 IAM 授权记录共享 `PK = auth#project#<project_id>`，通过 `SK` 前缀区分类型：

| SK 前缀 | entity_type | 说明 |
|---|---|---|
| `role#` | `role_profile` | 角色 |
| `policy#` | `policy_profile` | 策略 |
| `permission#` | `permission_profile` | 权限 |
| `binding_policy#` | `binding_policy` | 绑定策略 |
| `user#` | `user` | 用户 |
| `ref#` | `referral` | referral code |
| `user_role#` | `user_role_attachment` | 用户-角色绑定 |
| `role_permission#` | `role_permission_attachment` | 角色-权限绑定 |
| `principal_policy#` | `principal_policy_attachment` | 主体-策略绑定 |
| `grant#` | `resource_grant` | 资源授权 |

`resource_grant` 的 SK 格式：

```
grant#<principal_type>#<principal_id>#<schema_name>#<selector>
```

- `selector` 为 `resource#<resource_id>` 时表示按资源 ID 授权
- `selector` 为 `filter#<filter_hash>` 时表示按 filter 授权（同时存储 `filter_json` 和 `filter_hash` 属性）

## 7. 环境变量（Control Plane Lambda）

必须设置：

| 变量 | 说明 |
|---|---|
| `DYNAMODB_TABLE_NAME` 或 `LTBASE_TABLE_NAME` | Control Plane DynamoDB 表名 |
| `PROJECT_ID` | Deployment project UUID |
| `PROJECT_NAME` | Deployment project 名称 |
| `ACCOUNT_ID` | 账户 ID |
| `API_BASE_URL` | API 基础 URL |

Postgres/DSQL 连接（`repair-project`、`ensure-project` 需要）：

| 场景 | 变量 |
|---|---|
| AWS DSQL | `DSQL_ENDPOINT`、`DSQL_USER`、`AWS_REGION` |
| 本地 Postgres | `DSQL_HOST`、`DSQL_USER`、`DSQL_PASSWORD`、`DSQL_DB` |

## 8. 常见错误

| 错误信息 | 原因 |
|---|---|
| `PROJECT_ID is required` | 环境变量未配置 |
| `project-id must be a valid UUID` | `project_id` 格式错误 |
| `--account-id is required` | 操作非 deployment project 时未提供 `account_id` |
| `unknown_action` | action 名称不存在或已废弃（如 `create-key`、`delete-key`） |
| `project record is missing; provide --account-id to auto-create` | DynamoDB 中无 project 记录 |
| `project runtime info is missing; provide account_id and api_base_url` | DynamoDB 中无 runtime info |
| `permission denied for schema <name> (SQLSTATE 42501)` | Postgres 用户无对应 schema 权限 |
| `resource_id and filter cannot both be set` | `resource_grant` 同时传了 `resource_id` 和 `filter` |
| `ops is required` / `unsupported op` | `resource_grant` 缺少 `ops` 或包含不支持的 op |

---

> CLI 工具（`cmd/tools`）仍可用于本地运维，参数与上述 JSON 字段一一对应，详见代码注释。
