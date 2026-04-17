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

## 3. 支持的 Action 及 Test Event 示例

### 3.1 `ensure-project`

确保 deployment project 存在并完成 bootstrap。无需额外参数，project 信息从环境变量读取。

```json
{
  "action": "ensure-project"
}
```

### 3.2 `create-key`

为指定 project 创建访问密钥对。若 `project_id` 与 deployment project 一致，`account_id` 可从环境变量补默认值。

```json
{
  "action": "create-key",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "account_id": "acc123"
}
```

响应中包含 `access_key`、`access_secret`、`public_key`（base64）及创建时间。

### 3.3 `delete-key`

软删除一个访问密钥。

```json
{
  "action": "delete-key",
  "access_key": "AK_xxxxxxxxxxxxxxxx",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "account_id": "acc123"
}
```

### 3.4 `repair-project`

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

### 3.5 `update-schema`

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

### 3.6 `create-permission-records`

为 project 批量创建权限记录。

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

### 3.7 `create-iam-authz-records`

批量创建 IAM 授权记录（role、policy、binding、capability 等）。`kind` 字段必填。

```json
{
  "action": "create-iam-authz-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": false,
  "data": [
    {
      "kind": "role",
      "role_id": "role_admin",
      "name": "Admin",
      "description": "Full access"
    },
    {
      "kind": "policy",
      "policy_id": "policy_read_notes",
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

### 3.8 `list-project-auth-config`

列出 project 的所有认证/授权配置。

```json
{
  "action": "list-project-auth-config",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 3.9 `migrate-project-auth-records`

迁移 project 的授权记录（schema 版本升级等）。支持 `dry_run`。

```json
{
  "action": "migrate-project-auth-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": true
}
```

### 3.10 `put-project-capability-catalog`

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

### 3.11 `get-project-capability-catalog`

获取 project 的 capability catalog。catalog 不存在时返回 404。

```json
{
  "action": "get-project-capability-catalog",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 3.12 `put-project-action-template-catalog`

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

### 3.13 `get-project-action-template-catalog`

获取 project 的 action template catalog。catalog 不存在时返回 404。

```json
{
  "action": "get-project-action-template-catalog",
  "project_id": "11111111-1111-4111-8111-111111111111"
}
```

### 3.14 `import-referrals`

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
  "action": "create-key",
  "status": "error",
  "error": "cannot create more than 2 active access keys for project ..."
}
```

HTTP 状态码（HTTP 调用时适用）：

| Action | 成功状态码 |
|---|---|
| `ensure-project`、`create-key`、`create-permission-records`、`create-iam-authz-records`、`import-referrals` | `201` |
| 其余 action | `200` |
| 参数错误 | `400` |
| catalog 不存在 | `404` |
| 执行失败 | `500` |

## 5. DynamoDB 对象模型

### 5.1 Project Metadata

- `PK = project#<project_id>`
- `SK = meta`
- 字段：`name`、`account_id`、`num_of_active_keys`、`updated_at`

### 5.2 Access Key

- `PK = account#<account_id>#project#<project_id>`
- `SK = key#<access_key_id_without_AK_prefix>`
- 字段：`is_active`、`public_key`、`project_id`、`created_at`、`updated_at`

### 5.3 Project Runtime Info

- `PK = project#<project_id>`
- `SK = info`
- 字段：`account_id`、`api_id`、`api_base_url`

## 6. 环境变量（Control Plane Lambda）

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

## 7. 常见错误

| 错误信息 | 原因 |
|---|---|
| `PROJECT_ID is required` | 环境变量未配置 |
| `project-id must be a valid UUID` | `project_id` 格式错误 |
| `--account-id is required` | 操作非 deployment project 时未提供 `account_id` |
| `cannot create more than 2 active access keys` | 该 project 已有 2 个活跃密钥 |
| `project record is missing; provide --account-id to auto-create` | DynamoDB 中无 project 记录 |
| `project runtime info is missing; provide account_id and api_base_url` | DynamoDB 中无 runtime info |
| `permission denied for schema <name> (SQLSTATE 42501)` | Postgres 用户无对应 schema 权限 |

---

> CLI 工具（`cmd/tools`）仍可用于本地运维，参数与上述 JSON 字段一一对应，详见代码注释。
