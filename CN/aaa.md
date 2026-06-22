# **LTBase AAA 系统技术规范**

本文定义 **LTBase** 的完整 AAA（Authentication / Authorization / Accounting，认证 / 授权 / 审计）架构，面向社交登录场景与企业级访问控制场景。

该架构显式拆分三个关注点：

| 层 | 职责 |
| --- | --- |
| **Authentication** | 校验外部身份（社交登录 / SSO） |
| **Identity Binding** | 将外部身份映射为内部 LTBase 用户 |
| **Authorization** | 执行行级与列级权限控制 |

这种拆分使 LTBase 可以支持邀请码入驻、白名单、外部审批系统以及多项目部署，同时不削弱安全性，也不把过多状态塞进 JWT。

---

## **1. 系统概览**

LTBase AAA 系统提供：

* **Authentication**：校验外部身份并签发 JWT
* **Identity Binding**：基于策略把外部身份绑定到内部用户
* **Fine-grained Authorization**：支持行级与列/属性级访问控制
* **Audit Trails**：记录完整访问审计日志
* **AI Safety**：策略模型可安全供 AI Agent 与工具使用

授权引擎同时集成 **EntityMain + EAV 业务数据模型** 与现有 **LTBase query rule syntax**，以支持可表达的条件逻辑。

---

## **2. Authentication - Login Service（登录服务）**

### **2.1 目标**

认证层负责：

* 校验第三方身份令牌（Google / Apple / 其他）
* 规范化外部身份 claims
* 仅在身份绑定成功后签发 LTBase 会话令牌

> [!IMPORTANT]
> Authentication 本身 **不授予** 对 LTBase 资源的访问权限。只有存在有效 Identity Binding 才可以访问。

### **2.2 外部身份模型**

当前实现通过一个项目级外部身份查找记录加上确定性回退逻辑来解析外部身份：

* `project_id`
* `provider`
* `issuer`
* `sub`

Authservice 会先读取目标项目范围内的外部身份查找记录。  
如果没有查找到该记录，则推导确定性的 `user_id`，再直接读取用户档案。

| 记录类型 | 逻辑查找键 | 用途 |
| --- | --- | --- |
| External Lookup | `project_id + provider + issuer + sub` | 将外部身份解析到内部 `user_id` |
| User Profile | `project_id + user_id` | 判断该身份是否已经绑定 |

当前路径里，用户档案仍然是绑定状态的事实来源。

### **2.3 API 定义**

登录服务作为独立微服务运行，提供以下接口：

#### **POST /api/v1/login/{provider}**

把第三方身份令牌交换为 LTBase 会话令牌。

**请求头：**

| Header | Required | Description |
| --- | --- | --- |
| Authorization | Yes | `Bearer <id_token>`，由身份提供方签发，并由 API Gateway authorizer 校验 |

**请求体：**

```json
{
  "project_id": "accbd397-974e-47f2-9331-56e6c64e19ef"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| project_id | string | Yes | 认证目标项目 ID |

**响应（200 OK）：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
  "api_base_url": "https://api.example.com"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| access_token | string | LTBase 签发的 API 访问 JWT |
| refresh_token | string | 用于换取新 access token |
| api_base_url | string | 项目级 data plane base URL |

**错误响应：**

| Status | `error` 值 | 说明 |
| --- | --- | --- |
| 400 | `invalid_body` | JSON body 非法 |
| 400 | `project_id_required` | body 和 claims 中都缺失 `project_id` |
| 400 | `invalid_provider` | provider 路径参数非法 |
| 400 | `missing_identity` | 缺失必要身份 claims（`sub` / `iss`） |
| 400 | `project_not_configured` | 目标项目未配置 API base URL |
| 403 | `identity_unbound` | 外部身份尚未绑定内部用户 |
| 500 | `user_lookup_failed` | 外部身份查找内部用户失败 |
| 500 | `update_last_login_failed` | 更新最近登录时间失败 |
| 500 | `role_list_failed` | 读取用户直接角色失败 |
| 500 | `role_expand_failed` | 展开继承角色失败 |
| 500 | `permission_list_failed` | 加载有效角色对应权限失败 |
| 500 | `exchange_failed` | 访问 / 刷新令牌签发失败 |

#### **POST /api/v1/id_bindings/{provider}**

为 LTBase 用户绑定第三方身份令牌。

**请求头：**

| Header | Required | Description |
| --- | --- | --- |
| Authorization | Yes | `Bearer <id_token>`，由身份提供方签发，并由 API Gateway authorizer 校验 |

**请求体：**

```json
{
  "bind_context": {
    "code": "ABC123",
    "project_id": "project_456"
  }
}
```

**响应（200 OK）：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
  "api_base_url": "https://api.example.com"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| access_token | string | LTBase 签发的 API 访问 JWT |
| refresh_token | string | 用于换取新 access token |
| api_base_url | string | 项目级 data plane base URL |

**错误响应：**

| Status | `error` 值 | 说明 |
| --- | --- | --- |
| 400 | `invalid_body` | JSON body 非法 |
| 400 | `project_id_required` | 缺失 `bind_context.project_id` |
| 400 | `invalid_provider` | provider 路径参数非法 |
| 400 | `missing_identity` | 缺失必要身份 claims（`sub` / `iss`） |
| 400 | `invalid_code` | 缺失 `bind_context.code` |
| 409 | `invalid_code` | 邀请码无效、已过期或已使用 |
| 500 | `id_binding_failed` | 绑定事务或令牌签发失败 |

### **2.4 JWT 设计**

LTBase JWT：

* `sub` 使用内部 `user_id`，而不是外部 provider subject
* 不嵌入权限或绑定状态
* 令牌短期有效且保持无状态

```json
{
  "sub": "ltbase_user_id",
  "role_ids": ["Team_Android", "Dev"],
  "iat": 1700000000,
  "exp": 1700003600
}
```

> [!NOTE]
> 权限必须动态评估，以反映实时策略变化。不要把权限直接嵌入 JWT。

---

## **3. Identity Binding Layer（身份绑定层）**

### **3.1 动机**

在企业环境中：

* 不是所有 Google/Apple 用户都允许访问系统
* 访问可能依赖邀请码、邮箱域名、审批流程或外部系统
* 一个外部身份可能需要访问多个项目

因此 LTBase 在认证与授权之间引入显式的 **Identity Binding** 层。

### **3.2 内部用户（授权主体）**

内部 LTBase 用户是 **授权策略唯一使用的主体**。

用户档案作为 control-plane auth store 中的一类记录保存：

| 记录类型 | 逻辑标识 | 核心字段 |
| --- | --- | --- |
| User Profile | `project_id + user_id` | `user_id`, `project_id`, `created_at`, `last_login_at`, `provider`, `issuer`, `external_sub`, `identity_claims`, `primary_ou_id`, `report_to_user_id` |

### **3.3 身份绑定模型**

LTBase authservice 使用 **逻辑记录式 binding model**，而不是单独的 `identity_binding` 表：

| 绑定状态 | Auth Store 表示 |
| --- | --- |
| Unbound | 项目范围内不存在该确定性 `user_id` 的用户档案 |
| Bound | 存在 `project_id + user_id` 对应的用户档案 |
| Bound via code | 在同一事务中校验并消费 referral 记录，同时创建 user profile 与 external lookup（可选写入 verified email lookup） |

该设计支持：

| 能力 | 说明 |
| --- | --- |
| 多项目访问 | 一个外部身份可绑定多个项目 |
| 确定性绑定状态 | 通过确定性用户键解析绑定状态 |
| 生命周期控制 | 通过记录存在性与条件写控制绑定生命周期 |

### **3.4 登录与绑定流程**

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant AuthService
    participant SocialProvider
    participant ControlPlaneStore
    participant AuthorizationEngine

    Client->>AuthService: POST /api/v1/login/{provider}
    AuthService->>SocialProvider: 校验 id_token
    SocialProvider-->>AuthService: Claims (sub, iss, email)

    AuthService->>AuthService: 规范化身份并推导确定性 user_id
    AuthService->>ControlPlaneStore: 读取 external lookup，否则读取 user profile

    alt 尚未绑定
        AuthService-->>Client: 403 identity_unbound
        Client->>AuthService: POST /api/v1/id_bindings/{provider} (code)
        AuthService->>ControlPlaneStore: 校验 referral 并事务性创建 user profile/external lookup
        AuthService->>ControlPlaneStore: 可选写入 verified email lookup
    end

    AuthService->>AuthorizationEngine: 解析角色与权限
    AuthService-->>Client: LTBase JWT pair
```

**流程步骤：**

1. 用户通过社交 provider 登录
2. LTBase 校验外部令牌
3. Authservice 规范化身份元组并推导确定性内部 `user_id`
4. Authservice 通过确定性 `user_id` 读取用户档案
5. 如果已绑定，解析角色/权限并签发 JWT pair
6. 如果未绑定，返回 `identity_unbound`
7. 客户端使用 referral code 调用 bind 接口，原子化建立绑定

### **3.5 绑定策略模型**

绑定策略复用 LTBase rule syntax，并在 bind-time 评估：

> [!NOTE]
> 当前实现（`v1`）仍以 referral code 校验作为绑定门槛。以下策略化模型是目标设计，并且当前只在本文档层面定义契约，不再额外依赖单独的后端实现说明文档。

**邀请码策略：**

```json
{
  "l": "and",
  "c": [
    { "a": "invite.code", "v": "equals:${payload.code}" },
    { "a": "invite.status", "v": "equals:active" }
  ]
}
```

**邮箱域白名单：**

```json
{
  "l": "and",
  "c": [
    { "a": "external.email", "v": "ends_with:@company.com" }
  ]
}
```

**外部系统断言：**

```json
{
  "l": "and",
  "c": [
    { "a": "crm.customer_id", "v": "equals:${payload.customer_id}" }
  ]
}
```

---

## **4. Authorization Goals（授权目标）**

授权引擎必须保证：

* 用户只能看到有权查看的行（**row-level restriction**）
* 用户只能看到有权访问的列/属性（**column/attribute-level**）
* 策略解析或计算失败时必须 **fail-closed**
* 策略 statement 可引用 EAV 中的动态实体属性以及 `${requester.*}` 上下文
* 规则必须是安全、结构化的，不能允许代码注入

> [!IMPORTANT]
> **行访问 ≠ 列可见性**，二者是不同的数据治理控制层。

### **4.1 统一策略模型**

所有授权都通过一个概念表达 —— `policy_profile`，其内部承载一个或多个 `statement`。每个 statement 包含：

* `effect` —— `allow` / `deny` / `mask`
* `ops` —— 操作集合（`create` / `read` / `update` / `delete`，或 `*` 表示全部）
* `schema` —— 实体范围
* `selector` —— 行范围（`resource_id` 列表、`filter`，或二者并集）
* `outcome` —— 可选的列级注解（哪些属性、做什么动作）
* `condition` —— 可选 `l/c/a/v` 谓词，针对实体属性与 `${requester.*}` 上下文求值

Policy 可以附加到主体（`user`、`role`）和 `OU` 容器上;OU 上的附加沿 OU 子树继承（见 5.7.2）。同一个 evaluator 处理这三种附加面,并采用 **deny-overrides** 与 **mask-overrides-allow** 优先级（见 9.6）。

> [!NOTE]
> 早期草案中并存的三套机制 —— `resource_grant`、`permission_profile`、`policy_profile` —— 已合并为统一 statement 模型。`resource_grant` 仅作为**物理投影**保留（见 4.2），不再是独立的逻辑概念。
>
> 每个 legacy 术语的规范化定义、完整迁移映射、JWT `permissions` claim 兼容约定，见 `policy-permission-relationship.md`。

### **4.2 物理优化**

Auth store 可对单 statement 策略维护去规范化的投影（例如保留原 `resource_grant` 风格的索引，用于 `resource_id` / `filter` 热路径查找）作为运行时优化。这些投影是统一策略模型的**缓存**,必须与完整 statement 集合的求值结果一致。

---

## **5. AAA 数据模型**

### **5.1 业务实体 - EntityMain + EAV**

业务实体采用 **DSQL** 数据模型：

* **主表（`entity_main_<project_id>`）**：
  存储高频固定列，例如 `{ ltbase_schema_id, ltbase_row_id, ltbase_created_at, ltbase_updated_at, text_01...10, ... }`

* **EAV 数据表（`eav_data_<project_id>`）**：
  存储动态属性以及对应类型值列，例如 `{ schema_id, row_id, attr_id, value_text, value_numeric, ... }`

这要求授权条件针对 `eav_data` 中的属性求值，而不是仅依赖静态列。

### **5.2 授权实体**

| 记录族 | 用途 |
| --- | --- |
| `user profile` | 内部用户主体 |
| `external lookup` | 把 provider/issuer/sub 解析到 `user_id` |
| `email lookup` | 把已验证邮箱解析到 `user_id` |
| `user role` | 用户到角色映射 |
| `ou profile` | Organizational Unit 容器，带 parent 与 materialized path |
| `ou policy attachment` | 把 `policy_profile` 挂到 OU 上，并向 OU 子树继承 |
| `ou user index` | 通过主 OU 反查用户 |
| `direct report index` | 通过 manager 反查直属下属 |
| `role profile` | 角色元数据与父角色信息 |
| `policy profile` | 授权策略,包含一条或多条 `statement`（allow / deny / mask）—— 见 §6 |
| `principal policy attachment` | 给用户/角色主体附加策略 |
| `binding policy` | 绑定阶段门禁策略（`enabled`, `priority`, `rules`） |
| `refresh session` | refresh token 生命周期 |
| `session parent-child edge` | 撤销链遍历 |
| `referral profile` | 邀请码 / referral 校验与消费状态 |
| `audit event` | 审计事件 |

Policy 仍然是结构化对象,而不是 EAV 记录。项目级客户端调用走 control-plane authz API;无法通过 data-plane EAV 路径直接修改策略文档。

### **5.3 实体关系**

该系统采用标准 **RBAC（Role-Based Access Control）**，并支持层级组关系；同时用 **类 Active Directory 的组织层级** 来表达组织结构：

* **User**：内部身份主体
* **Role / Group**：一组策略附加,以及角色继承图中的一个节点
  * Group 在语义上等价于 Role
  * **继承**：Role 可继承其他 Role（例如 `Manager` 继承 `Employee`）
  * Role 是唯一支持跨切面 / 矩阵关系的机制（一个用户可持有多个角色）
* **Policy**：包含一条或多条 `statement` 的命名容器。statement 携带 `effect`（allow / deny / mask）、`ops`、`schema`、可选的 `selector` 与 `outcome`,以及可选的 `condition`（见 §6）
* **OU（Organizational Unit）**：反映汇报与归属结构的层级容器
  * 每个用户恰好属于一个 `primary_ou_id`
  * OU 通过 `parent_ou_id` 与 materialized `ou_path` 组成树
  * **OU 不是 ACL principal**。它通过挂接 `policy_profile` 间接携带授权
* **Manager**：用户档案上的单值 `report_to_user_id`，并通过 direct-report 反向索引支持"谁向谁汇报"查询

**关系流：**

1. **External Identity** 被规范化成确定性内部 `user_id`，再映射为 **User Profile**
2. **Users** 通过 `user role` 记录获得 **Roles**，并通过 `primary_ou_id` 进入一个 **OU**
3. **Policy** 可以附加到 **User**、**Role** 或 **OU**,通过对应的 attachment 记录
4. **OU 上的策略附加** 沿 `ou_path` 向 OU 子树继承
5. **Authorization** 综合用户直接附加、角色（含继承）附加、OU 祖先附加的全部策略,并按 §9.6 的优先级合并 statement

### **5.4 逻辑 Auth Store 记录定义**

AAA 设计依赖一个逻辑 auth store contract，而不是具体物理后端。下面每种记录族都必须能按项目范围访问，并在所有受支持后端中高效满足对应访问模式。后端映射定义见 `aaa-control-plane-store-mapping.md`。

| 记录族 | 逻辑标识 / 访问模式 | 说明 |
| --- | --- | --- |
| User profile | 唯一键 `project_id + user_id` | 内部用户主体 |
| External lookup | 唯一键 `project_id + provider + issuer + sub` | provider/issuer/sub -> `user_id` |
| Verified email lookup | 唯一键 `project_id + email_lower` | 可选 |
| User-role mapping | 按 `project_id + user_id` 列表；唯一键 `project_id + user_id + role_id` | 查询用户角色 |
| OU profile | 唯一键 `project_id + ou_id` | 包含 `parent_ou_id`、`ou_path`、`name`、`block_inheritance` |
| OU user index | 按 `project_id + ou_id` 列表 | 反查 OU 下用户 |
| OU policy attachment | 按 `project_id + ou_id` 列表；唯一键 `project_id + ou_id + policy_id` | OU 上挂接策略 |
| Direct report index | 按 `project_id + manager_user_id` 列表 | 反查直属下属 |
| Role profile | 唯一键 `project_id + role_id` | 包含父角色 |
| Policy profile | 唯一键 `project_id + policy_id` | 含一条或多条 `statement` 的文档（见 §6） |
| Principal policy attachment | 按 `project_id + principal_type + principal_id` 列表 | 给 user/role 挂接策略 |
| Binding policy | 按 `project_id` 列表，并按优先级排序 | bind-time 策略 |
| Referral | 唯一键 `project_id + code` | 邀请码校验与消费 |
| Refresh session | 唯一键 `project_id + refresh_jti` | 轮转 / 撤销状态 |
| Session edge | 按 `project_id + parent_jti` 列表 | 撤销链遍历 |
| Audit event | 追加写入 `project_id + event_time` | 时间有序安全日志 |

### **5.5 项目隔离策略（不依赖 SQL Views）**

项目隔离通过 **项目级记录归属** 实现，而不是 SQL views：

| 隔离控制 | 说明 |
| --- | --- |
| Project scope | 每条 auth-store 记录都且仅属于一个 `project_id` |
| Session scope | 会话记录由 `project_id` 与会话标识共同隔离 |
| Lookup discipline | 所有 authservice 读写都必须把 `project_id` 带入 repository 条件 |
| Conditional writes | 绑定 / 会话操作必须使用条件写或事务写保障安全 |

该设计避免动态 SQL view provisioning，并使 control-plane storage contract 可以跨后端移植。

### **5.6 标识规范化与编码规则**

为避免碰撞与跨语言不一致，所有标识在持久化或查找前都必须做确定性规范化：

| Segment | Rule |
| --- | --- |
| `project_id` | 使用 canonical UUID 字符串（小写、带连字符） |
| `provider` | 去首尾空格、转小写，再做 URL-safe Base64 编码（无 padding） |
| `issuer` | 去首尾空格、保留大小写，再做 URL-safe Base64 编码（无 padding） |
| `sub` | 去首尾空格，再做 URL-safe Base64 编码（无 padding） |
| `email_lower` | 去首尾空格、转小写，再做 URL-safe Base64 编码（无 padding） |
| `code` | 去首尾空格，再做 URL-safe Base64 编码（无 padding） |

通用规则：

* 所有动态标识段都按 UTF-8 处理
* 读写路径必须复用相同规范化流水线
* 如果底层后端需要额外编码，必须保证确定性，必要时可逆
* 任一规范化结果为空或非法，必须在 repository 边界快速失败

### **5.7 组织结构（Org Chart）**

LTBase 用两条彼此独立的关系来表达组织结构：

| 关系 | 字段 | 基数 | 用途 |
| --- | --- | --- | --- |
| Containment（OU） | `User.primary_ou_id` -> `OU.ou_id` | 单值 | 表示用户在组织中的归属位置，并控制策略继承 |
| Reporting line | `User.report_to_user_id` -> `User.user_id` | 单值 | 表示用户向谁汇报，并为规则提供 manager-chain 上下文 |

> [!IMPORTANT]
> 归属与汇报是 **两条独立轴线**。用户的 manager 不需要与其位于同一 OU。

> [!NOTE]
> “org chart”是概念；数据模型是 **org units**（`org_units` / OU）。org units 及其他内置资源的 REST/JSON/action 命名见 `API-specs-control-plane.cn.md` §3.4（内置资源）。

#### **5.7.1 OU 树与 Materialized Path**

OU 树同时保存直接父指针 `parent_ou_id` 与 materialized `ou_path`，以支持高效子树查询：

```text
ou:rnd            parent_ou_id = null      ou_path = "/{ou_rnd}"
ou:mobiledev      parent_ou_id = ou_rnd    ou_path = "/{ou_rnd}/{ou_mobiledev}"
ou:team_android   parent_ou_id = ou_mobiledev ou_path = "/{ou_rnd}/{ou_mobiledev}/{ou_team_android}"
```

关键属性：

* `ou_path` 使用稳定 `ou_id` 片段，而不是展示名
* “查找 R&D 下所有用户”可通过 `ou_path` 前缀匹配实现，无需运行时递归展开
* 移动 OU（修改 `parent_ou_id`）时需要重写整棵子树的 `ou_path` 与 `ou_user` 反向索引，可视为后台管理操作
* 每个用户恰好一个 `primary_ou_id`；跨 OU / 矩阵关系应通过 Role 表达

#### **5.7.2 OU 策略继承（GPO 风格）**

授权只能通过 `policy_profile` 记录附着到 OU 上，具体载体为 **OU policy attachment**，逻辑标识为 `project_id + ou_id + policy_id`。

登录时，授权引擎沿用户 `primary_ou.ou_path` 从根到叶收集所有附着策略，并合并成 effective policy set。这一行为与 AD 的 GPO 继承模型一致。

> [!NOTE]
> OU 不是 `resource_grant` 或 `principal_policy_attachment` 的合法 principal。要做 OU 范围授权，应创建并挂接 `policy_profile`。

##### **继承修饰符（预留，v1 不启用）**

Schema 预留两个与 AD 对应的标志。它们可以存储，但 v1 evaluator 忽略：

| 字段 | 位置 | AD 对应概念 | 未来语义 |
| --- | --- | --- | --- |
| `block_inheritance` | OU profile | Block Inheritance | 为 true 时阻止子 OU 继承祖先策略 |
| `enforced` | OU policy attachment | Enforced / No Override | 为 true 时策略可穿透 `block_inheritance` 继续向下传播 |

#### **5.7.3 Manager 关系**

用户档案上的 `report_to_user_id` 是单值字段，指向其直属 manager。系统同时维护 direct-report 反向查找结构，以支持按 manager 快速列出直属下属。

* **仅允许单值。** 虚线汇报 / 次级 manager 不进入 schema；应通过额外 Role 表达
* **禁止环。** 写入时必须阻止用户直接或间接向自己汇报
* **链深受限。** 登录阶段展开 manager chain 时默认限制深度（例如 <= 10）

#### **5.7.4 从组织结构派生的上下文**

以下派生值在登录时（或策略刷新时）计算，并供规则求值使用：

| 变量 | 来源 | 说明 |
| --- | --- | --- |
| `${requester.primary_ou_id}` | User profile | 用户自身所属 OU |
| `${requester.ou_path}` | OU profile | 主 OU 的 materialized path |
| `${requester.ou_ancestor_ids}` | 由 `ou_path` 解析 | 所有祖先 OU（含自身） |
| `${requester.manager_chain}` | 向上遍历 `report_to_user_id` | 有界 user_id 列表，不含 requester 自身 |
| `${requester.direct_report_ids}` | 由 direct-report 反向查找得到 | 仅在规则显式引用时按需加载 |

这些值由引擎填充；客户端与 AI Agent 不能直接传入或覆盖。

---

## **6. Policy 与 Statement 语法**

LTBase 把所有授权决策表达为一个 **policy**，其中包含一条或多条 **statement**。statement 是求值的最小单位。

### **6.1 Policy 文档形态**

```json
{
  "policy_id": "pol_mobile_dev_read_own",
  "name": "MobileDev — 读取自己的工单",
  "statements": [ /* 一条或多条 statement */ ]
}
```

同一个 policy 可以混合不同的 effect（allow / deny / mask）。跨 statement、跨 policy 的合并规则定义在 §9.6。

### **6.2 Statement Schema**

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `effect` | 是 | enum | `allow` / `deny` / `mask` |
| `ops` | 是 | string[] | `create` / `read` / `update` / `delete` 的子集，或 `*` 表示全部 |
| `schema` | 是 | string | 该 statement 约束的实体 schema |
| `selector` | `allow`/`deny` 至少需要 `resource_id` 或 `filter` 其一;`mask` 可选 | object | 行范围（见 6.4） |
| `outcome` | `mask` 必填;`allow` 可选 | object | 列级注解（见 6.5） |
| `condition` | 可选 | object | 额外的 `l/c/a/v` 谓词（见 6.3） |

### **6.3 Condition 语法（`l/c/a/v`）**

Condition 复用 LTBase query-rule 格式,可同时引用实体属性与 `${requester.*}` 上下文（见 §9.4）：

```json
{
  "l": "and",
  "c": [
    { "a": "owner", "v": "equals:${requester.user_id}" },
    {
      "l": "or",
      "c": [
        { "a": "status", "v": "equals:active" },
        { "a": "priority", "v": "gt:3" }
      ]
    }
  ]
}
```

| Key | 含义 |
| --- | --- |
| `l` | 逻辑运算符（`and` / `or`） |
| `c` | 条件数组 |
| `a` | 属性名（实体属性或 `requester.*` 上下文） |
| `v` | 带操作符前缀的值表达式 |

支持嵌套 `l/c`,同一份语法同时服务于行级范围和列级谓词。

### **6.4 Selector 语法**

`selector` 把 statement 限定到 `schema` 中的部分行。两种形态,可叠加(并集)：

```json
{
  "resource_id": ["row_abc", "row_def"]
}
```

```json
{
  "filter": {
    "owner": "eq:${requester.user_id}",
    "status": "eq:open"
  }
}
```

`filter` 中每个 key 是属性名;每个 value 是 data-plane filter parser 支持的带操作符表达式。

> [!NOTE]
> 持久化记录内部可能将 selector 暴露为 `filter_json` / `filter_hash` 以便建索引。客户端**提交**时使用上述结构形态;持久化 hash 是实现细节,**不应**出现在 `create-iam-authz-records` 请求中。

### **6.5 Outcome Schema(列级)**

```json
{
  "scope": "column",
  "attrs": ["email", "phone"],
  "action": "mask"
}
```

* 当 `effect=allow` 且未指定 `outcome` 时,statement 允许对应 `ops` 下的**整行**(所有属性可读 / 可写)
* 当 `effect=mask` 时,必须给出 `outcome.attrs` 与 `outcome.action=mask`。无论是否有匹配的 `allow`,`mask` 都对所列属性生效(见 §9.6)
* `outcome.scope=row` 是隐含默认值,无需显式书写

### **6.6 完整示例**

> "MobileDev OU 的用户可读取其 OU 子树范围内所有工单;manager 还能看到其直属下属的联系方式;`ssn` 在读取时始终被掩码。"

```json
{
  "policy_id": "pol_mobile_dev_tickets",
  "name": "MobileDev 工单",
  "statements": [
    {
      "effect": "allow",
      "ops": ["read"],
      "schema": "tickets",
      "selector": { "filter": { "owner.ou_path": "starts_with:${requester.ou_path}" } }
    },
    {
      "effect": "allow",
      "ops": ["read"],
      "schema": "tickets",
      "selector": { "filter": { "reporter_id": "in:${requester.direct_report_ids}" } },
      "outcome": { "scope": "column", "attrs": ["reporter_email", "reporter_phone"], "action": "allow" }
    },
    {
      "effect": "mask",
      "ops": ["read"],
      "schema": "tickets",
      "outcome": { "scope": "column", "attrs": ["ssn"], "action": "mask" }
    }
  ]
}
```

把该 policy 通过 `ou_policy_attachment` 挂到 OU `MobileDev` 上,即可对该子树内所有用户生效。

---

## **7. 行级访问控制**

行级 statement 决定某个实体（row）是否可见或可操作。行范围通过 `selector`（`resource_id` 列表和/或 `filter`）表达,可选地再用 `condition` 收窄。

**示例：用户只能读取自己拥有的行**

```json
{
  "effect": "allow",
  "ops": ["read"],
  "schema": "tickets",
  "selector": { "filter": { "owner": "eq:${requester.user_id}" } }
}
```

运行时,list / read 操作会把所有 allow statement 的 selector 并集下推为 data-plane 查询谓词,再去读取业务数据;命中的 deny statement 的 selector 作为负向谓词加入。

---

## **8. 列 / 属性级访问控制**

列级决策通过 statement 上的 `outcome.scope=column` 表达。`effect` 决定该属性上的行为：

* `effect=allow` + `outcome.scope=column` —— 把可见范围扩展到所列属性
* `effect=mask` + `outcome.scope=column` —— 无论是否有匹配的 `allow`,都对所列属性做掩码 / 替换(mask 在属性级覆盖 allow,见 §9.6)

主体范围(哪些用户获得该行为)由**策略附加在哪个主体上**决定,而不是在 condition 里手写 role 检查。表达"manager 可读 email"的标准做法是:

```json
// 该策略只附加在 role `Manager` 上
{
  "effect": "allow",
  "ops": ["read"],
  "schema": "people",
  "outcome": { "scope": "column", "attrs": ["email"], "action": "allow" }
}
```

**示例：全局对 SSN 做掩码**

```json
{
  "effect": "mask",
  "ops": ["read"],
  "schema": "people",
  "outcome": { "scope": "column", "attrs": ["ssn"], "action": "mask" }
}
```

> [!NOTE]
> 当前实现基线仍主要覆盖行级范围控制。列级 statement（`outcome.scope=column`）属于集成设计的一部分,会逐步落地。

### **数据脱敏（可选）**

对敏感属性(如 SSN),`effect=mask` 在读取时把存储值替换为掩码模式(如 `*****`),而非完全隐藏。具体替换规则属于 `outcome.action` 语义,在 schema 属性层级配置。

---

## **9. 授权引擎与求值**

### **9.1 角色展开**

有效角色需通过角色继承展开：

```text
All_Employees -> Dev -> Team_Android
```

引擎必须在评估权限前完成继承角色展开。

> [!NOTE]
> 当前实现会同时读取 JWT 中的 `role_ids` 与 auth-store `user_role` 映射，并基于 role profiles 递归展开 `parent_role_ids`。任一数据访问失败时都必须 fail-closed。

### **9.1.1 OU 祖先与策略展开**

除角色展开外，引擎还需解析用户 OU 归属链，并收集继承策略：

```text
1) 读取 user profile，得到 primary_ou_id。
2) 读取 OU profile，拆分 ou_path 得到 ou_ancestor_ids（从根到当前 OU）。
3) 对每个 ou_id，按 `project_id + ou_id` 列出 OU policy attachment。
4) 按 `project_id + policy_id` 加载 policy_profile，并合并为 effective policy set。
```

说明：

* OU 继承策略会与角色权限、主体直接附加策略一起参与评估
* `block_inheritance` 与 `enforced` 在 v1 中预留但不生效，所有祖先策略都参与合并
* OU 永远不是 resource grants 中的 principal_type

### **9.1.2 Manager Chain 解析**

引擎沿 `report_to_user_id` 向上走，填充 `${requester.manager_chain}`：

* 深度受限（默认 <= 10）以控制评估成本
* 若读取阶段发现环，应按 fail-closed 处理
* `${requester.direct_report_ids}` 仅在规则显式引用时，通过 direct-report 反向查找按需解析

### **9.2 有效策略收集**

每次请求,引擎汇集对请求者生效的所有策略：

```text
1) 用户直接附加:
     按 `project_id + principal_type=user + principal_id=user_id`
     列出 principal_policy_attachment。

2) 角色附加(对 9.1 得到的每个有效角色):
     按 `project_id + principal_type=role + principal_id=role_id`
     列出 principal_policy_attachment。

3) OU 附加(对 9.1.1 得到的每个 ou_id):
     按 `project_id + ou_id` 列出 ou_policy_attachment。

4) 合并所有引用到的 policy_id,并按 `project_id + policy_id`
   读取 policy_profile,去重后得到 effective policy set。
```

结果是一个扁平、去重的策略集合,每个策略带一条或多条 statement。

### **9.3 Statement 扁平化与预过滤**

把所有已收集策略中的 statement 扁平为一个列表。引擎对其做预过滤：

* `schema` 必须匹配当前目标 schema
* `ops` 必须包含当前请求的操作

不匹配的 statement 在条件求值前丢弃。剩余集合即为本次请求的**候选集**。

> [!NOTE]
> 像 `resource_grant` 索引这样的物理投影可用于热路径(例如 `read` 已知 `resource_id`)上的预过滤短路。这些投影产出的决策必须与对完整候选集的求值结果一致。

### **9.4 上下文展开**

在评估规则前，引擎将以下占位符替换为真实值：

* `${requester.user_id}`
* `${requester.role_ids}`
* `${requester.primary_ou_id}`
* `${requester.ou_path}`
* `${requester.ou_ancestor_ids}`
* `${requester.manager_chain}`
* `${requester.direct_report_ids}`（按需解析）

**示例：用户可读取自己 OU 子树内所有 owner 的记录**

```json
{ "a": "owner.ou_path", "v": "starts_with:${requester.ou_path}" }
```

**示例：manager 可读取直属下属 owner 的记录**

```json
{ "a": "owner.user_id", "v": "in:${requester.direct_report_ids}" }
```

### **9.5 条件求值**

规则逻辑（`l/c`）针对以下数据求值：

* 目标实体的 EAV 属性（行级规则）
* 当前访问的属性名（列级规则）

**示例：**

```json
{ "a": "project_team", "v": "equals:${requester.role_ids}" }
```

表示判断请求者角色中是否包含该项目所属 team。

未解析的占位符或非法策略表达式必须 fail-closed。

### **9.6 冲突解决**

多条候选 statement 可能同时命中同一行或同一属性。合并遵循两条有序规则：

1. **Deny overrides Allow。** 只要有任何匹配的 `effect=deny` statement 命中 `(ops, row)`,访问即被拒绝 —— 即使存在允许的 statement。
2. **Mask overrides Allow。** 行已通过 `allow` 的行范围,但目标属性又被 `mask` statement 命中时,该属性按 `outcome.action` 进行掩码 / 替换。

对单行 `r` 与操作 `op` 的判定流程：

```text
if any deny.matches(r, op):
    result = denied
else if any allow.matches(r, op):
    for attr a in 请求投影:
        if any mask.matches(r, op, a):
            按掩码输出 a
        else:
            正常输出 a
    result = allowed(可能含掩码)
else:
    result = denied                      # fail-closed: 无 allow 即为 deny
```

补充说明：

* 单个 policy 内 statement 顺序不影响结果;优先级完全由 `effect` 决定
* 不同 selector 的 `allow` statement **并集**其行范围
* 不同 selector 的 `deny` statement **并集**其排除范围(任一 deny 命中即拒)
* 不同 `outcome.attrs` 的 `mask` statement **并集**其掩码属性集合
* OU 继承、角色继承、用户直接附加来源的 statement 平等参与,**没有**基于附加面的额外优先级

---

## **10. 查询过滤与执行**

当前 data-plane 会把 grant 派生的条件下推到 Forma query conditions。

对于 SQL-native 路径，可使用等价的 CTE（Common Table Expression）模式来实现：

```sql
WITH matched_entities AS (
    SELECT DISTINCT e.row_id
    FROM public.eav_data e
    WHERE e.schema_id = $1
      AND (
          EXISTS (SELECT 1 FROM public.eav_data x WHERE x.row_id = e.row_id AND x.attr_id = ... AND ...)
      )
)
SELECT t.*
FROM public.entity_main t
JOIN matched_entities m ON t.ltbase_row_id = m.row_id;
```

列 / 属性过滤则根据 permission outcomes 决定字段是否返回或做 masking。

---

## **11. AI Agent 安全性**

为防止 prompt injection 与意外提权：

* Policy 必须静态定义在策略存储中
* Agent 可以请求数据,但 **不能贡献 statement、condition 或 selector**
* Statement 求值必须是确定且安全的
* `${...}` 变量只允许在服务端展开
* 非法策略载荷默认拒绝（fail-closed）

这保证 Agent 永远只是请求动作,而不是生成实际策略条件。

---

## **12. 审计与记账**

与授权相关的决策应被记录：

| 字段 | 用途 |
| --- | --- |
| timestamp | 发生时间 |
| user_id | 请求者（内部用户） |
| action | 尝试执行的操作 |
| resource | 实体类型 / ID |
| decision | allowed / denied |
| details | 命中的规则、上下文值 |

Audit events 作为 auth-store 里的项目级审计日志追加写入。底层存储必须支持按 `(timestamp, tie_breaker)` 稳定排序，以便做审计查询、导出与事故分析。

> [!NOTE]
> 当前实现已通过 control-plane store 记录 authservice audit events。data-plane 授权决策审计会逐步对齐到同一模型。

---

## **13. 总结**

LTBase AAA 框架：

* 清晰拆分 **Authentication**、**Identity Binding**、**Authorization**
* 支持仅依赖社交登录的企业级入驻模型
* 提供面向邀请、白名单、审批流的 **policy-driven identity binding**
* 采用单一 **统一策略模型** —— 所有授权决策都通过 `policy_profile` 中的 `statement`（allow / deny / mask）表达,可附加到 user / role / OU
* 以 **deny-overrides** + **mask-overrides-allow** 优先级合并 statement;默认 fail-closed
* 以接近 Active Directory 的方式表达组织结构（OU 归属 + manager 关系）与 OU 子树策略继承
* 支持层级角色展开,并把 user / role / OU 三类主体收敛到同一个 evaluator
* 保留 `resource_grant` 等热路径投影作为内部优化,而不是独立的逻辑概念
* 确保 AI Agent 安全
* 生成完整审计轨迹

该设计使 LTBase 能作为 **AI-native、enterprise-ready 的 BaaS 平台** 演进。
