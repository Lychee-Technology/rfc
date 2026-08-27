# Policy–Permission 关系 —— 规范术语定义

本文定义 LTBase auth 与控制面中 `policy` 与 `permission` 之间的规范关系：哪一个模型是 canonical，哪些结构属于 legacy 兼容面，以及迁移语义。

> 内置控制面资源（users、roles、policies、binding policies、org units、attachments、referrals）在各层的规范命名见 `API-specs-control-plane.cn.md` §3.4（内置资源）。

**状态：** Accepted（关联 issue [#330](https://github.com/Lychee-Technology/ltbase.api/issues/330)、[#337](https://github.com/Lychee-Technology/ltbase.api/issues/337)）

---

## 1. 问题

LTBase 代码库与文档中同时存在面向 legacy permission 的结构（`permission_profile`、`role_permission_attachment`）和面向 policy 的结构（`policy_profile`、`principal_policy_attachment`、`ou_policy_attachment`）。维护者和后续实现者需要明确以下问题：

- `permission` 是什么？
- `policy` 是什么？
- 二者之间是否存在派生关系？
- 哪些概念是 legacy 兼容面？
- 今后哪个模型是 canonical？

没有这些答案，control-plane 读模型设计、REST API DTO、迁移代码与 JWT claim 设计无法收敛到统一词汇。

---

## 2. 决策

| 概念 | 状态 | 是否 canonical |
| --- | --- | --- |
| `policy` / `policy_profile` | 授权规则容器，包含一条或多条 `statement`，每条携带 `effect`、`ops`、`schema`、`selector`、`outcome`、`condition` | **是 —— canonical 授权对象** |
| `principal_policy_attachment` | 将 `policy` 绑定到主体（`user` 或 `role`） | **是 —— canonical 主体授权关系** |
| `ou_policy_attachment` | 将 `policy` 绑定到 OU，并沿 OU 子树继承 | **是 —— canonical 组织授权关系** |
| `permission_profile` | Legacy 记录，表示单个 permission 名称与可选 rule | **否 —— legacy 数据，非 canonical** |
| `role_permission_attachment` | Legacy 边，连接角色与 permission | **否 —— legacy 绑定边** |
| `resource_grant` | Legacy / 过渡期 主体到资源的 grant（手动或迁移产生） | **否 —— 仅可作为物理投影索引用作热路径优化** |
| JWT `permissions` claim | JWT 中的运行时兼容字段；某些 authorizer 会消费它（如 `controlplane.admin`） | **否 —— 兼容字段，不等同于 canonical 模型** |

统一的 `policy_profile` 模型（定义于 `aaa.md` §4.1）是唯一 canonical 授权模型。其他所有授权概念均为 legacy 或派生。

---

## 3. Canonical Policy 模型

详见 `aaa.md` §4.1。要点：

- `policy_profile` 是授权单元。它携带包含一条或多条 `statement` 的 `policy_document`。
- 每条 statement 包含：`effect`（allow / deny / mask）、`ops`（create / read / update / delete）、`schema`（实体范围）、`selector`（resource_id 列表、filter，或二者并集）、可选 `outcome` 与 `condition`。
- `principal_policy_attachment` 将 policy 绑定到 `user` 或 `role` 主体。OU **不是** ACL principal。
- `ou_policy_attachment` 将 policy 绑定到 OU；策略沿 `ou_path` 向下继承（GPO 风格）。
- Evaluator 统一处理三个附加面（user-direct、role、OU-ancestor），按 deny-overrides 与 mask-overrides-allow 优先级合并（`aaa.md` §9.6）。

Policy 独立存在：它不依赖 permission 即可存在，也不引用 permission 记录。

---

## 4. Legacy Permission 模型

### 4.1 `permission_profile`

Legacy DynamoDB 记录（`entity_type = "permission_profile"`），表示命名 permission，例如 `log:create` 或 `controlplane.admin`，可携带可选 `rule` 与 `outcome`。

- **读路径：** 仅出现在 `ProjectAuthConfig.Legacy.Permissions` 诊断快照中，**不是** `auth/config` 公共 REST DTO 的一部分。
- **写路径：** 不可通过新 control-plane REST API 写入。Legacy 写路径（`CreatePermissionRecords`）保留在 action 风格 `/control-plane` 接口中，仅用于向后兼容。
- **Evaluator：** 任何 evaluator 都不应直接依赖 `permission_profile` 记录。Evaluator 应处理 `policy_profile` statement。

### 4.2 `role_permission_attachment`

Legacy DynamoDB 记录（`entity_type = "role_permission_attachment"`），连接 `role_id` 与 `permission_id`。

- **读路径：** 仅出现在 `ProjectAuthConfig.Legacy.RolePermissions`。
- **写路径：** 不可通过新 control-plane REST API 写入。
- **Canonical 替代：** `principal_policy_attachment`，`principal_type = "role"`。

### 4.3 `resource_grant`

Legacy / 过渡期 DynamoDB 记录（`entity_type = "resource_grant"`），授予主体（`user` 或 `role`）对特定 `schema_name` / `resource_id` 或 `filter` selector 的访问权限，并指定具体 `ops`。

- **读路径：** 仅出现在 `ProjectAuthConfig.Legacy.Grants`。
- **Canonical 替代：** 单 statement `policy_profile` + 对应的 `principal_policy_attachment`。
- **物理投影：** `aaa.md` §4.2 允许保留 `resource_grant` 风格索引作为热路径去规范化缓存。这是优化手段，而非并行授权模型（`aaa-control-plane-store-mapping.md` §3.3、§4.3、§5.5）。

---

## 5. JWT Permission Claims

JWT `permissions` claim（如 `["controlplane.admin", "notes:read"]`）是运行时兼容字段。

- 由 `permissionsFromRequest`（`internal/request_authz_claims.go`）从 JWT 中读取，被控制面 admin check（`controlplane.admin`）等 authorizer 消费。
- 它不是 canonical 授权模型，只是令牌签发时刻的快照。
- `aaa.md` §2.4 设计明确指出：*"权限必须动态评估，以反映实时策略变化。不要把权限直接嵌入 JWT。"*
- 长期方向是在 JWT 中保留 `role_ids`，在请求时从 control-plane store 动态评估权限/策略。

`permissions` claim 的存在不改变 `permission_profile` 的 legacy 状态；authorizer 消费 `permissions` 也不构成新 API 设计沿用 legacy permission 模型的理由。

---

## 6. 迁移语义

`MigrateProjectAuthRecords` 操作（`internal/control_plane_auth_migration.go`）将 legacy auth 记录转换为 canonical policy 模型。以下规则已锁定：

### 6.1 Source → Target 映射

| Legacy source（entity_type） | 生成 target |
| --------------------------- | ----------- |
| `permission_profile` | `policy_profile` —— 每个 permission 生成一个 policy；policy document 由 permission 的 `rule`、`outcome`、`permission_name` 合成 |
| `role_permission_attachment`（permission 存在） | `principal_policy_attachment` —— 将生成的 permission-policy 绑定到 role 主体 |
| `role_permission_attachment`（permission 缺失） | `role_permission_attachment` —— 以 canonical SK 格式保留原样 |
| `resource_grant`（格式良好） | `policy_profile` + `principal_policy_attachment` —— 由 grant 生成单 statement policy，绑定到原主体 |
| `resource_grant`（不支持的形状） | 保留原样并发出警告 |
| `policy_profile`（legacy PK） | `policy_profile`（canonical PK）—— document 由 `statement` 规范化为 `statements` |
| `user_role_attachment`（legacy PK） | `user_role_attachment`（canonical SK） |
| `session` / `session_child` | 以 canonical PK 保留 |

### 6.2 关键规则

- **Policy 不依赖 permission。** permission-to-policy 迁移生成独立的 `policy_profile`；迁移后生成的策略是自包含的。
- **迁移仅限 DynamoDB。** Postgres 后端部署不需要迁移；其数据已经是 canonical 形态。
- **迁移是幂等的。** `force=true` 时覆盖已有 canonical 记录；无 `force` 时跳过已有 target。
- **Legacy 记录不会被删除。** 迁移写入 canonical 记录，但不会移除 legacy source item。

### 6.3 结果计数器

`MigrateProjectAuthRecordsResult` 暴露三个计数层：

- `discovered`：被识别为迁移输入的 legacy source 记录（`permission_profiles`、`role_permissions`、`grants` 等）
- `planned_writes`：生成的候选记录，按 target kind 计数（`policy_profiles`、`principal_policies` 等）
- `written`：成功持久化的 target 记录

详见 `docs/superpowers/specs/2026-05-23-auth-migration-result-counters-design.md`。

---

## 7. 控制面 / API 影响

### 7.1 公共 REST DTO

`GET /api/v1/auth/config` 快照（`control-plane-aaa-org-chart-rest-api-design.md` §9）返回：

- `policies`：canonical policy profile
- `principal_policy_attachments`：canonical 主体绑定
- `ou_policy_attachments`：canonical OU 绑定（形态完整；后端实现前可为空数组）

Legacy 数据（`permissions`、`role_permissions`、`grants`）归于 `legacy` 子对象，仅供诊断使用，**不得**作为 REST 主字段出现。

DTO 对齐设计（`control-plane-auth-dto-alignment-design.md`）已执行此约束。

### 7.2 写 API

拟议的写 API（如 `POST /api/v1/auth/policies`、`PUT /api/v1/auth/principals/{type}/{id}/policies/{policy_id}`）尚未实现（见 §8）。一旦实现，它们将操作 canonical 模型，且**不创建** `permission_profile` 或 `role_permission_attachment` 记录。

### 7.3 语义层

语义层（`semantic-layer-v1-design.md`）以 `sem:policy:{project_id}:{policy_id}` 注册 `policy` 资源，来源于 `policy_profile` 记录。`permission_profile` 记录不注册为语义资源。

---

## 8. Out of Scope

本 RFC **不**做以下事项：

- 要求代码变更或删除 legacy 数据
- 重新设计 policy evaluator 或继承模型
- 实现新 REST API 或存储后端
- 定义 permission-to-policy 数据迁移排期
- 从当前 token 签发中移除 JWT `permissions` claim
- 修改 `permissionsFromRequest` 或现有 authorizer 行为

以上留待后续实现 issue。

---

## 9. 验收标准对照

对照父 issue [#330](https://github.com/Lychee-Technology/ltbase.api/issues/330)：

| # | 验收项 | 覆盖 |
| --- | --- | --- |
| 1 | 书面设计定义 `policy` 与 `permission` 的规范关系 | §2 决策、§3 Canonical Policy 模型、§4 Legacy Permission 模型 |
| 2 | 设计明确说明 legacy `role_permission` 与 canonical policy 的状态 | §4.2、§6.1 迁移映射 |
| 3 | 设计足够具体，可驱动后续 control-plane 读模型与文档变更 | §7 控制面 / API 影响 |

对照子 issue [#337](https://github.com/Lychee-Technology/ltbase.api/issues/337)：

| # | 验收项 | 覆盖 |
| --- | --- | --- |
| 1 | `policy` 是 canonical 授权对象 | §2、§3 |
| 2 | `principal_policy_attachment` 是 canonical 主体授权关系 | §2、§3 |
| 3 | `ou_policy_attachment` 是 canonical 组织授权关系 | §2、§3 |
| 4 | `permission_profile` 是 legacy 数据 | §2、§4.1 |
| 5 | `role_permission` 是 legacy 绑定边 | §2、§4.2 |
| 6 | `permission claim` 是 JWT 兼容字段，非 canonical | §5 |
| 7 | Migration 可从 legacy permission 生成 policy，但 policy 不依赖 permission | §6.2 |
| 8 | RFC 文件写入，可供下游子 issue 引用 | 本文 |

---

## 参考

- `rfc/EN/aaa.md`：AAA 架构规范；定义统一 `policy_profile` 模型（§4.1）
- `rfc/EN/aaa-control-plane-store-mapping.md`：store 映射；显式排除 legacy 记录族（§2 Note）
- `ltbase.api/internal/control_plane_auth_migration.go`：迁移实现
- `ltbase.api/internal/control_plane_auth_config.go`：legacy 快照结构
- `ltbase.api/internal/control_plane_iam_authz.go`：legacy IAM 记录类型常量
- `ltbase.api/docs/superpowers/specs/2026-05-22-control-plane-aaa-org-chart-rest-api-design.md`：REST API 合同；legacy 归于 `legacy` 子对象（§9）
- `ltbase.api/docs/superpowers/specs/2026-05-23-control-plane-auth-dto-alignment-design.md`：DTO 对齐；显式移除 legacy 字段
- `ltbase.api/docs/superpowers/specs/2026-05-23-auth-migration-result-counters-design.md`：迁移计数器语义
