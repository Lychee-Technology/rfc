# Control Plane REST Admin API

本文档说明 `cmd/controlplane` 当前已经实现的 REST 管理接口，用于私有化单部署场景下的 AAA 与组织架构管理。

如果要通过 AWS Lambda Console Test、CLI 工具或直接 Lambda Invoke 调用旧的 action 风格接口，请看 `docs/control-plane-cli.md`。这两套接口并存，但用途不同：

- REST Admin API：给管理后台、自动化脚本、运维集成使用
- Action API：给 Lambda Console / CLI 运维动作与兼容旧流程使用

## 1. 作用域与路由

- 当前模型是单部署单 project
- REST 请求的 project scope 由服务端根据 deployment 配置自动解析
- 客户端不应该在 REST 请求的 path、query、header、body 中传 `project_id`
- REST 基础前缀是 `/api/v1`
- 路由器当前仍兼容旧前缀 `/api/control-plane/v1`，但新客户端应统一使用 `/api/v1`

示例：

- `GET /api/v1/auth/config`
- `GET /api/v1/auth/users`
- `GET /api/v1/org/units`
- `POST /api/v1/repair/dry-run`

## 2. 认证与授权

REST Admin API 的管理类接口需要 admin policy 绑定。

当前授权规则来自 `cmd/controlplane/api_authorizer.go` 和 `cmd/controlplane/api_router.go`：

- 所有非 org 的 `/api/v1/*` REST 管理接口（状态、schema、repair、auth resources、catalogs 等）要求调用者持 admin policy
- Org 只读接口（`GET /api/v1/org/*`）允许两类调用者：持 admin policy 的管理员，或已绑定 referral code 的已登录用户
- Org 写接口（`POST/PATCH/PUT/DELETE /api/v1/org/*`）仅允许持 admin policy 的管理员
- admin policy 通过 slug `admin.controlplane` 解析到其 durable UUIDv7 policy id（参见 #376）；旧布局迁移产生的 `generated#permission#controlplane.admin` 仅作为兼容回退识别
- 本地测试辅助请求可绕过该校验

错误行为：

- `401 unauthorized`：没有有效认证 claims
- `403 forbidden`：有 claims，但不具备 admin policy 绑定（或 org 只读接口下，用户未绑定 referral code）

## 3. 响应约定

成功响应统一带 `request_id`。

单资源响应：

```json
{
  "request_id": "req_123",
  "data": {}
}
```

列表响应：

```json
{
  "request_id": "req_123",
  "items": []
}
```

部分列表接口还会返回 `total`：

```json
{
  "request_id": "req_123",
  "items": [],
  "total": 0
}
```

错误响应：

```json
{
  "request_id": "req_123",
  "code": "invalid_body",
  "message": "invalid request body"
}
```

当服务端有额外字段级诊断时，会附带 `details`。

## 4. 已实现接口

以下内容按当前代码实现整理，不是按设计 spec 的目标整理。

### 4.1 Auth Config Snapshot

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/auth/config` | 返回当前 deployment project 的完整 auth/org snapshot |

用途：

- 管理后台启动时一次性加载 AAA 与组织架构状态
- 导出或诊断当前 control-plane 配置

响应契约：

- `GET /api/v1/auth/config` 在权限模型层面只暴露 policy / policy attachment / authorization decision 相关字段：`policies`、`principal_policy_attachments`、`ou_policy_attachments`、`binding_policies`（snapshot 仍包含 `users`、`roles`、`org_units` 等组织架构字段）
- 不在顶层返回 `permissions`、`role_permissions`、`grants`
- legacy permission 数据只存在于内部存储和迁移输出，不通过 REST bootstrap snapshot 泄露到公共 DTO
- 新 REST Admin API 不提供 `/api/v1/auth/permissions` 资源；permission 为首的概念只在 action API 的 legacy 运维操作和迁移输出中出现
- `GET /api/v1/auth/config` 返回 `data.authorization_model` 字段，描述 canonical policy-permission 关系：
  - `canonical_object`: `"policy"`，规范授权对象（对应 `policy_profile` 实体）
  - `canonical_principal_relationship`: `"principal_policy_attachment"`，规范主体绑定关系
  - `canonical_org_relationship`: `"ou_policy_attachment"`，规范组织绑定关系
  - `permission_status`: `"legacy_compatibility"`，permission 概念为 legacy 兼容面
  - `legacy_data_location`: `"internal_or_migration_output_only"`，legacy permission 数据仅在内部存储和迁移输出中出现
  - `policy_depends_on_permission`: `false`，policy 独立存在，不依赖 permission

### 4.2 Auth Users

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/auth/users` | 列出用户 |
| `GET` | `/api/v1/auth/users/{user_id}` | 获取单个用户与其角色信息 |
| `PATCH` | `/api/v1/auth/users/{user_id}` | 更新 `primary_ou_id`、`report_to_user_id` |
| `PUT` | `/api/v1/auth/users/{user_id}/roles/{role_id}` | 绑定角色 |
| `DELETE` | `/api/v1/auth/users/{user_id}/roles/{role_id}` | 解绑角色 |

支持的查询参数：

- `q`
- `provider`
- `ou_id`
- `manager_user_id`

说明：

- `PATCH` 只支持管理员维护组织相关元数据
- 该接口不写入 provider identity 字段

### 4.3 Auth Roles

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/auth/roles` | 列出角色 |
| `POST` | `/api/v1/auth/roles` | 创建角色 |
| `GET` | `/api/v1/auth/roles/{role_id}` | 获取单个角色 |
| `DELETE` | `/api/v1/auth/roles/{role_id}` | 删除角色 |

当前实现注意点：

- 创建请求 body 当前只接收 `name`、`description`、`parent_role_ids`
- `role_id` 由服务端生成的 durable UUIDv7（参见 #376），不是客户端输入字段
- 响应包含 `slug`（人类可读语义名）与 `external_key`（导入/部署稳定键）字段；REST 创建不接受这两个输入，故 REST 创建的角色通常为空，需通过 action API import 写入
- 设计 spec 中的 `PATCH /api/v1/auth/roles/{role_id}` 当前尚未实现

### 4.4 Auth Policies

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/auth/policies` | 列出策略 |
| `POST` | `/api/v1/auth/policies` | 创建策略 |
| `GET` | `/api/v1/auth/policies/{policy_id}` | 获取单个策略 |
| `DELETE` | `/api/v1/auth/policies/{policy_id}` | 删除策略 |

当前实现注意点：

- 创建请求 body 当前只接收 `name`、`description`、`policy_document`
- `policy_id` 由服务端生成的 durable UUIDv7（参见 #376），不是客户端输入字段
- 响应包含 `slug`（人类可读语义名）与 `external_key`（导入/部署稳定键）字段；REST 创建不接受这两个输入，故 REST 创建的策略通常为空，需通过 action API import 写入
- 设计 spec 中的 `PATCH /api/v1/auth/policies/{policy_id}` 当前尚未实现

### 4.5 Principal Policy Attachments

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/auth/principals/{principal_type}/{principal_id}/policies` | 列出 principal 直接绑定的策略 |
| `PUT` | `/api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}` | 绑定策略到 principal |
| `DELETE` | `/api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}` | 从 principal 解绑策略 |

`GET` 返回 `"items"` 数组，每项包含 `principal_type`、`principal_id`、`policy_id` 和内嵌 `policy` 对象。

当前实现允许的 `principal_type`：

- `user`
- `role`

不应把 OU 当作 principal 使用。

### 4.6 Binding Policies

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/auth/binding-policies` | 创建 binding policy |
| `PATCH` | `/api/v1/auth/binding-policies/{policy_id}` | 更新 binding policy |
| `DELETE` | `/api/v1/auth/binding-policies/{policy_id}` | 删除 binding policy |

当前创建 / 更新 body 字段：

- `enabled`
- `priority`
- `rules`

### 4.7 Referrals

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/auth/referrals` | 列出 referral codes |
| `POST` | `/api/v1/auth/referrals` | 创建单个 referral code |
| `POST` | `/api/v1/auth/referrals?import=1` | 批量导入 referrals |
| `PATCH` | `/api/v1/auth/referrals/{code}` | 更新过期时间 |
| `POST` | `/api/v1/auth/referrals/{code}/disable` | 禁用 referral |
| `DELETE` | `/api/v1/auth/referrals/{code}` | 删除 referral |

支持的查询参数：

- `status`
- `code`

补充说明：

- 路由器当前还兼容旧入口 `/api/v1/referrals` 与 `/api/control-plane/v1/referrals`
- 新调用方应优先使用 `/api/v1/auth/referrals`
- referral 数据根据 `CONTROLPLANE_STORE_BACKEND` 落在 DynamoDB 或 Postgres backend

### 4.8 Org Units

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/org/units` | 列出 OU |
| `POST` | `/api/v1/org/units` | 创建 OU |
| `GET` | `/api/v1/org/units/{ou_id}` | 获取单个 OU |
| `PATCH` | `/api/v1/org/units/{ou_id}` | 更新 OU |
| `DELETE` | `/api/v1/org/units/{ou_id}` | 删除 OU |

支持的查询参数：

- `parent_ou_id`
- `tree=true`
- `q`

写入约束：

- `ou_path` 为服务端维护字段，客户端不应提交
- OU move 会重新计算子树路径
- 会拒绝形成包含环的变更
- 删除非空 OU 会返回冲突错误

### 4.9 Org Unit Users

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/org/units/{ou_id}/users` | 列出该 OU 下的用户 |
| `PUT` | `/api/v1/org/units/{ou_id}/users/{user_id}` | 把用户移动到目标 OU |

支持的查询参数：

- `include_subtree=true`

### 4.10 OU Policy Attachments

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/org/units/{ou_id}/policies` | 列出 OU 直接绑定的策略 |
| `PUT` | `/api/v1/org/units/{ou_id}/policies/{policy_id}` | 绑定策略到 OU |
| `DELETE` | `/api/v1/org/units/{ou_id}/policies/{policy_id}` | 从 OU 解绑策略 |

`PUT` body：

```json
{
  "enforced": true
}
```

### 4.11 Manager Relationship

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/org/users/{user_id}/manager` | 获取直接 manager |
| `PUT` | `/api/v1/org/users/{user_id}/manager` | 设置 manager |
| `DELETE` | `/api/v1/org/users/{user_id}/manager` | 清除 manager |
| `GET` | `/api/v1/org/users/{user_id}/direct-reports` | 列出直属下属 |

支持的查询参数：

- `recursive=true`

写入约束：

- 不允许用户直接或间接汇报给自己

### 4.12 Org Chart Read Model

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/org/charts` | 返回面向 UI/自动化的组织图读模型 |

支持的查询参数：

- `root_ou_id`
- `include_users=true`
- `include_policies=true`

### 4.13 Operational REST Endpoints

这些接口同样走 REST admin auth，但更偏运维与诊断用途。

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/status` | 读取 deployment project 基本状态 |
| `GET` | `/api/v1/schema/status` | 读取已应用 schema 与已发布 schema 信息 |
| `POST` | `/api/v1/repair/dry-run` | 预览 repair 结果 |
| `POST` | `/api/v1/repair/apply` | 真正执行 repair |
| `GET` | `/api/v1/workflows` | 列出本地测试工作流摘要 |
| `GET` | `/api/v1/catalogs/capabilities` | 获取 capability catalog |
| `PUT` | `/api/v1/catalogs/capabilities` | 更新 capability catalog |
| `GET` | `/api/v1/catalogs/action-templates` | 获取 action template catalog |
| `PUT` | `/api/v1/catalogs/action-templates` | 更新 action template catalog |
| `GET` | `/api/v1/compliance-profile` | 获取 compliance profile |
| `PUT` | `/api/v1/compliance-profile` | 更新 compliance profile |

## 5. REST Admin API 与 Action API 的边界

两套接口的职责不同：

### REST Admin API 适合：

- 管理后台读取与编辑 AAA 配置
- 管理后台读取与编辑组织架构
- 自动化脚本按资源粒度做增量变更
- 统一使用 JWT claims 做管理员鉴权

### `/control-plane` Action API 适合：

- AWS Lambda Console Test
- CLI 工具直接调用 Lambda action
- `ensure-project`、`repair-project` 这类动作型运维操作
- 兼容旧有 action payload 工作流
- 显式触发 `migrate-authz-policy-model` 等迁移动作

不要把 REST 资源写入与 action 风格 invoke payload 混用在同一个客户端抽象里。

## 6. 当前实现与设计 spec 的差异

`docs/superpowers/specs/2026-05-22-control-plane-aaa-org-chart-rest-api-design.md` 定义了更完整的 V1 目标，当前代码已实现其中的大部分读写面，但仍有差异：

- `PATCH /api/v1/auth/roles/{role_id}` 尚未实现
- `PATCH /api/v1/auth/policies/{policy_id}` 尚未实现
- role / policy create body 目前不接收 spec 示例中的显式 ID 字段，而是服务端生成
- authservice 仍然负责登录、binding、token issuance，不属于 control-plane REST admin API

做前端或自动化集成时请以当前实现为准，不要假设 spec 中所有目标接口都已落地。

## 7. 验证建议

更新文档或对接客户端前，建议先用以下命令确认接口实现仍与文档一致：

```bash
go test ./cmd/controlplane -count=1
```

如需进一步检查路由覆盖，可在仓库中搜索：

### 4.11 Catalogs: Assistant Roles

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/catalogs/assistant-roles` | 获取 project assistant role catalog |
| `PUT` | `/api/v1/catalogs/assistant-roles` | 更新 project assistant role catalog |

配置格式：

```json
{
  "version": 1,
  "roles": [
    {
      "role": "customer_followup",
      "system_prompt": "You are a customer follow-up assistant...",
      "status": "active"
    },
    {
      "role": "general",
      "system_prompt": "Custom general assistant prompt",
      "status": "active"
    }
  ]
}
```

字段说明：
- `version`：固定为 `1`
- `roles[].role`：角色名称，lower_snake_case。与内置角色名相同时覆盖内置角色
- `roles[].system_prompt`：自定义系统提示词
- `roles[].status`：`active` 或 `inactive`。inactive 角色命中时返回明确错误，不 fallback

解析顺序：
1. 查 project 自定义角色（active → 使用；inactive → 返回错误）
2. 查内置角色：`general`、`real_estate`、`insurance`、`financial`
3. Fallback 到默认 `general` 角色

GET 未配置时返回：
```json
{
  "request_id": "req_abc",
  "data": {"project_id": "...", "data": {"version": 1, "roles": []}}
}
```

## 参考实现

```bash
rg '/api/v1/(auth|org|status|schema|repair|catalogs|compliance-profile|workflows)' cmd/controlplane
```
