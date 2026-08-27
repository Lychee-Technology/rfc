# Control Plane Action API 与 AWS Lambda Console 调用手册

本文档说明如何通过 AWS Lambda Console 的 Test 功能直接调用 Control Plane Lambda 的 action 风格接口，用于运维和排查。

这不是 `cmd/controlplane` 的 REST Admin API 文档。

- 如果你要使用 `/api/v1/auth/...`、`/api/v1/org/...` 这类资源型接口，请看 `docs/control-plane-rest-admin-api.md`
- 本文只覆盖 `/control-plane` action payload 与直接 Lambda invoke 相关用法

## 1. 当前模型

- 仅支持私有化部署，每个部署只有一个固定 project
- deployment project 由环境变量 `PROJECT_ID`、`PROJECT_NAME`、`ACCOUNT_ID`、`API_BASE_URL` 定义
- Control Plane Lambda 启动时自动执行 `EnsureProject` bootstrap

Action API 的典型入口有两种：

- AWS Lambda Console Test：直接提交 JSON payload
- HTTP `POST /control-plane`：提交包含 `action` 的 JSON body

## 2. 如何使用 Lambda Console Test

1. 打开 [AWS Lambda Console](https://console.aws.amazon.com/lambda)，进入 Control Plane 函数页面
2. 点击顶部 **Test** 标签页
3. 选择 **Create new event** 或编辑已有 event
4. 将下方各 action 对应的 JSON 粘贴到 Event JSON 框
5. 点击 **Test** 按钮执行
6. 在 **Execution result** 面板查看响应（`status`、`result` 或 `error`）

> **注意**：Lambda Console Test 使用直接调用（Invoke）方式，payload 为纯 JSON，不需要 HTTP 包装。

## 3. 支持的 Action 及 Test Event 示例

### 3.1 `ensure-project`

确保 deployment project 存在并完成 bootstrap。无需额外参数，project 信息从环境变量读取。

```json
{
  "action": "ensure-project"
}
```

### 3.2 `repair-project`

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

### 3.3 `update-schema`

更新 project 的 schema 注册表（schema name ↔ schema ID 映射）。支持 `dry_run` 和 `force`（覆盖冲突）。`schema_id` 范围：1–32767。

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

### 3.4 `create-iam-authz-records`

批量创建 IAM 授权记录（role、policy、role attachment 等）。`kind` 字段必填。

> 支持的 kind: `role_profile`、`policy_profile`、`principal_policy_attachment`、`user_role_attachment`。`role_permission_attachment` 和 `resource_grant` 已废弃，不再接受写入。

> **ID 约定（参见 #376）**：`role_id` / `policy_id` 是 durable UUIDv7 标识符，作为该资源的主键。人类可读的语义名放入 `slug`（如 `role.admin`、`policy.read.notes`），导入/部署侧稳定键放入 `external_key`。import 路径接受调用方直接提供 durable id（应为 UUIDv7），并可携带 `slug` / `external_key`。

```json
{
  "action": "create-iam-authz-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": false,
  "data": [
    {
      "kind": "role_profile",
      "role_id": "0190b3c4-1a2b-7c3d-8e4f-000000000001",
      "slug": "role.admin",
      "external_key": "admin-role-v1",
      "name": "Admin",
      "description": "Full access"
    },
    {
      "kind": "policy_profile",
      "policy_id": "0190b3c4-1a2b-7c3d-8e4f-000000000002",
      "slug": "policy.read.notes",
      "external_key": "read-notes-v1",
      "name": "ReadNotes",
      "policy_document": {
        "statements": [
          { "effect": "allow", "schema_name": "notes", "ops": ["read"] }
        ]
      }
    }
  ]
}
```

### 3.5 `list-project-auth-config`

列出 project 的所有认证/授权配置。

```json
{
  "action": "list-project-auth-config",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 3.6 `migrate-project-auth-records`

迁移 project 的授权记录（schema 版本升级等）。支持 `dry_run`。

```json
{
  "action": "migrate-project-auth-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": true
}
```

### 3.7 `migrate-authz-policy-model`

把旧的 authz 存储布局迁移到统一 policy model。该动作保留在 action API 中，不通过 REST Admin API 暴露。

```json
{
  "action": "migrate-authz-policy-model",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": true,
  "force": false
}
```

说明：

- 当前为显式运维动作，不是管理后台资源接口
- 用于旧 authz 数据向统一 policy model 迁移
- 适合先 `dry_run=true` 做预检查

### 3.8 `put-project-capability-catalog`

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

### 3.9 `get-project-capability-catalog`

获取 project 的 capability catalog。catalog 不存在时返回 404。

```json
{
  "action": "get-project-capability-catalog",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 3.10 `put-project-action-template-catalog`

创建或更新 project 的 action template catalog。

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

### 3.11 `get-project-action-template-catalog`

获取 project 的 action template catalog。catalog 不存在时返回 404。

```json
{
  "action": "get-project-action-template-catalog",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 3.12 `put-project-compliance-profile`

创建或更新 project 的 compliance profile。`data` 为 JSON 对象（非字符串）。若 profile 为空控制集，应使用系统默认 baseline。

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

### 3.13 `get-project-compliance-profile`

获取 project 的 compliance profile。profile 不存在或为空时，返回系统默认 baseline，而不是 404。

```json
{
  "action": "get-project-compliance-profile",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 3.14 `import-referrals`

向当前 Control Plane backend 导入 referral code。支持单条和批量两种模式，重复 code 自动跳过。

- `dynamodb` 模式下写入 DynamoDB referral records
- `postgres` 模式下写入 PostgreSQL `controlplane_referrals`

> 可选的 `referral_policy_id`（单条）/ `policy_id`（`data` 元素）接受 policy 的 slug 或 durable UUIDv7，写入时解析为 durable UUIDv7 存储；引用不存在的 policy 返回 `400 policy_not_found`。字段语义与契约详见 `docs/toos/import-referral.md` 与 #376。

**单条**：

```json
{
  "action": "import-referrals",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "referral_code": "EARLYBIRD2024",
  "referral_policy_id": "policy.lead.read",
  "referral_expires_at_ms": 1800000000000
}
```

**批量**：

```json
{
  "action": "import-referrals",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": [
    { "referral_code": "CODE_A", "policy_id": "policy.lead.read" },
    { "referral_code": "CODE_B", "expires_at_ms": 1800000000000 }
  ]
}
```

## 4. 响应结构

**成功**：

```json
{
  "action": "ensure-project",
  "status": "success",
  "result": {
    "project_id": "11111111-1111-4111-8111-111111111111"
  }
}
```

**失败**：

```json
{
  "action": "repair-project",
  "status": "error",
  "error": "project runtime info is missing; provide account_id and api_base_url"
}
```

HTTP 状态码（HTTP 调用时适用）：

| Action | 成功状态码 |
|---|---|
| `ensure-project`、`create-iam-authz-records`、`import-referrals` | `201` |
| 其余 action | `200` |
| 参数错误 | `400` |
| catalog 不存在 | `404` |
| 执行失败 | `500` |

## 5. 与 REST Admin API 的区别

Action API 与 REST Admin API 不应该混用：

- Action API：动作型、运维型、显式 `action` 调用
- REST Admin API：资源型、面向后台和自动化集成、统一走 `/api/v1/...`

建议：

- 管理后台开发优先对接 REST Admin API
- Lambda Console Test、CLI、迁移与 repair 动作继续使用 action API

## 6. DynamoDB 对象模型

### 6.1 Project Metadata

- `PK = project#<project_id>`
- `SK = meta`
- 字段：`name`、`account_id`、`updated_at`

### 6.2 Project Runtime Info

- `PK = project#<project_id>`
- `SK = info`
- 字段：`account_id`、`api_id`、`api_base_url`

## 7. 环境变量（Control Plane Lambda）

通用必填：

| 变量 | 说明 |
|---|---|
| `PROJECT_ID` | Deployment project UUID |
| `PROJECT_NAME` | Deployment project 名称 |
| `ACCOUNT_ID` | 账户 ID |
| `API_BASE_URL` | API 基础 URL |

Backend 选择：

| 变量 | 说明 |
|---|---|
| `CONTROLPLANE_STORE_BACKEND` | 可选，`dynamodb` 或 `postgres`；默认 `dynamodb` |

`dynamodb` 模式额外需要：

| 变量 | 说明 |
|---|---|
| `DYNAMODB_TABLE_NAME` 或 `LTBASE_TABLE_NAME` | Control Plane DynamoDB 表名 |

`postgres` 模式额外需要：

| 变量 | 说明 |
|---|---|
| `CONTROLPLANE_PROJECT_SCHEMA` | 可选，优先使用的 schema 名 |
| `DSQL_PROJECT_SCHEMA` | 可选，schema 回退值 |

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
| `project record is missing; provide --account-id to auto-create` | DynamoDB 中无 project 记录 |
| `project runtime info is missing; provide account_id and api_base_url` | DynamoDB 中无 runtime info |
| `permission denied for schema <name> (SQLSTATE 42501)` | Postgres 用户无对应 schema 权限 |

---

> CLI 工具（`cmd/tools`）仍可用于本地运维，参数与上述 JSON 字段一一对应，详见代码注释。
