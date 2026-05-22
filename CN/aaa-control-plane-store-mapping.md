# **LTBase AAA Control-Plane Store 映射说明**

本文定义存储无关 AAA 模型在具体 control-plane backend 上的映射方式。

主规范 `aaa.md` 只定义 **逻辑 auth-store contract**。本文说明如何在 **DynamoDB** 与 **PostgreSQL** 上实现同一套 contract，而不改变 AAA 语义。

---

## **1. 目标**

无论后端是什么，实现都必须保持以下不变量：

* 每条 auth 记录都具备项目级隔离
* 外部身份绑定必须具备唯一查找能力
* 用户、角色、权限、策略都必须支持确定性查找
* referral 消费与 binding 创建必须原子化
* bind / session 安全必须依赖条件写语义
* role expansion、OU inheritance、grant fetch 必须具备高效列表 / 查询能力
* audit log 必须能稳定追加并按顺序读取

主 AAA 设计不能依赖某个后端独有、而另一个受支持后端无法等价实现的能力。

---

## **2. 逻辑记录族**

逻辑记录族定义见 `aaa.md` 的 5.4 节。

后端需要为以下记录族提供等价访问路径：

* `user_profile`
* `external_lookup`
* `email_lookup`
* `user_role`
* `ou_profile`
* `ou_user`
* `ou_policy_attachment`
* `direct_report`
* `role_profile`
* `role_permission`
* `permission_profile`
* `policy_profile`
* `principal_policy_attachment`
* `resource_grant`
* `binding_policy`
* `referral_profile`
* `refresh_session`
* `session_edge`
* `audit_event`

---

## **3. DynamoDB 映射**

### **3.1 物理结构**

DynamoDB 可通过共享表与项目级 key namespace 实现该 auth store。

| 逻辑记录族 | 分区键 / 排序键模式 | 说明 |
| --- | --- | --- |
| `user_profile` | `PK=auth#project#{project_id}`, `SK=user#{user_id}` | 唯一用户记录 |
| `external_lookup` | `PK=auth#project#{project_id}`, `SK=lookup_ext#{provider_b64}#{issuer_b64}#{sub_b64}` | 外部身份 -> `user_id` |
| `email_lookup` | `PK=auth#project#{project_id}`, `SK=lookup_email#{email_lower_b64}` | 可选邮箱索引 |
| `user_role` | `PK=auth#project#{project_id}`, `SK=user_role#{user_id}#{role_id}` | 按用户列角色 |
| `ou_profile` | `PK=auth#project#{project_id}`, `SK=ou#{ou_id}` | OU 元数据 |
| `ou_user` | `PK=auth#project#{project_id}`, `SK=ou_user#{ou_id}#{user_id}` | 按 OU 反查用户 |
| `ou_policy_attachment` | `PK=auth#project#{project_id}`, `SK=ou_policy#{ou_id}#{policy_id}` | OU 策略挂接 |
| `direct_report` | `PK=auth#project#{project_id}`, `SK=direct_report#{manager_user_id}#{report_user_id}` | manager 反查 |
| `role_profile` | `PK=auth#project#{project_id}`, `SK=role#{role_id}` | 角色元数据 |
| `role_permission` | `PK=auth#project#{project_id}`, `SK=role_permission#{role_id}#{permission_id}` | 角色权限映射 |
| `permission_profile` | `PK=auth#project#{project_id}`, `SK=permission#{permission_id}` | 权限载荷 |
| `policy_profile` | `PK=auth#project#{project_id}`, `SK=policy#{policy_id}` | 策略载荷 |
| `principal_policy_attachment` | `PK=auth#project#{project_id}`, `SK=principal_policy#{type}#{id}#{policy_id}` | 主体策略挂接 |
| `resource_grant` | `PK=auth#project#{project_id}`, `SK=grant#{type}#{id}#{schema}#{selector}` | selector 可是 resource 或 filter hash |
| `binding_policy` | `PK=auth#project#{project_id}`, `SK=binding_policy#{priority}#{policy_id}` | 按优先级排序 |
| `referral_profile` | `PK=auth#project#{project_id}`, `SK=ref#{code_b64}` | 邀请码记录 |
| `refresh_session` | `PK=auth#project#{project_id}#session`, `SK=session#{refresh_jti}` | 会话状态 |
| `session_edge` | `PK=auth#project#{project_id}#session`, `SK=child#{parent_jti}#{child_jti}` | parent/child 撤销链 |
| `audit_event` | `PK=auth#audit#project#{project_id}#date#{yyyy-mm-dd}`, `SK=ts#{unix_ms}#{rand}` | 追加写有序日志 |

### **3.2 优势与约束**

* prefix query 适合项目级列表读取
* conditional write 与 transaction 适合 bind / session 安全场景
* 单条 item 体积必须受控，大策略文档仍需满足 DynamoDB item 限制
* audit 排序可天然借助 sort key 表达

---

## **4. PostgreSQL 映射**

### **4.1 物理结构**

PostgreSQL 可通过规范化表结构与唯一索引实现同一套逻辑 auth store。

建议表集合：

| 逻辑记录族 | 建议表名 | 主键 / 索引策略 |
| --- | --- | --- |
| `user_profile` | `auth_user_profile` | `UNIQUE(project_id, user_id)` |
| `external_lookup` | `auth_external_lookup` | `UNIQUE(project_id, provider_norm, issuer_norm, sub_norm)` |
| `email_lookup` | `auth_email_lookup` | `UNIQUE(project_id, email_lower_norm)` |
| `user_role` | `auth_user_role` | `UNIQUE(project_id, user_id, role_id)`，索引 `(project_id, user_id)` |
| `ou_profile` | `auth_ou_profile` | `UNIQUE(project_id, ou_id)`，索引 `(project_id, parent_ou_id)` |
| `ou_user` | `auth_ou_user` | `UNIQUE(project_id, ou_id, user_id)` |
| `ou_policy_attachment` | `auth_ou_policy_attachment` | `UNIQUE(project_id, ou_id, policy_id)` |
| `direct_report` | `auth_direct_report` | `UNIQUE(project_id, manager_user_id, report_user_id)` |
| `role_profile` | `auth_role_profile` | `UNIQUE(project_id, role_id)` |
| `role_permission` | `auth_role_permission` | `UNIQUE(project_id, role_id, permission_id)` |
| `permission_profile` | `auth_permission_profile` | `UNIQUE(project_id, permission_id)` |
| `policy_profile` | `auth_policy_profile` | `UNIQUE(project_id, policy_id)` |
| `principal_policy_attachment` | `auth_principal_policy_attachment` | `UNIQUE(project_id, principal_type, principal_id, policy_id)` |
| `resource_grant` | `auth_resource_grant` | `UNIQUE(project_id, principal_type, principal_id, schema_name, selector_kind, selector_hash)` |
| `binding_policy` | `auth_binding_policy` | 索引 `(project_id, priority, policy_id)` |
| `referral_profile` | `auth_referral_profile` | `UNIQUE(project_id, code_norm)` |
| `refresh_session` | `auth_refresh_session` | `UNIQUE(project_id, refresh_jti)` |
| `session_edge` | `auth_session_edge` | `UNIQUE(project_id, parent_jti, child_jti)` |
| `audit_event` | `auth_audit_event` | 索引 `(project_id, event_ts, tie_breaker)` |

### **4.2 优势与约束**

* 多行事务天然适合 bind / session 工作流
* 唯一索引可保证身份与 referral 安全
* 查询规划器可优化 permission / policy expansion 所需的 join
* audit 顺序应依赖 `(event_ts, tie_breaker)`，而不是插入顺序

---

## **5. 操作等价性**

### **5.1 Login Lookup**

逻辑 contract：

1. 规范化 `(project_id, provider, issuer, sub)`
2. 查 `external_lookup`
3. 若无映射，则推导确定性 `user_id` 并查 `user_profile`

DynamoDB 实现：

* `GetItem` 外部身份查找键
* 回退 `GetItem` 用户档案键

PostgreSQL 实现：

* `SELECT ... FROM auth_external_lookup WHERE ...`
* 回退 `SELECT ... FROM auth_user_profile WHERE project_id = ? AND user_id = ?`

### **5.2 Bind Transaction**

逻辑 contract：

1. 校验 referral code
2. 确认绑定目标尚不存在
3. 创建 `user_profile`
4. 创建 `external_lookup`
5. 可选创建 `email_lookup`
6. 标记 referral 已消费

DynamoDB 实现：

* `TransactWriteItems` + conditional expressions

PostgreSQL 实现：

* 单个 SQL transaction
* `SELECT ... FOR UPDATE` 或等价锁方式锁定 referral 行
* 依赖唯一索引与受检 insert / update 保证一致性

### **5.3 Role / Permission Expansion**

逻辑 contract：

1. 按 `(project_id, user_id)` 列出 `user_role`
2. 加载 `role_profile` 做继承展开
3. 按有效角色列出 `role_permission`
4. 加载 `permission_profile`

DynamoDB 实现：

* 基于项目分区与前缀的 `Query`
* 用 `GetItem` / `BatchGetItem` 读取 profile

PostgreSQL 实现：

* 对映射表走索引 `SELECT`
* 对 profile 使用点查或 `IN (...)` 批量读取

### **5.4 OU Policy Inheritance**

逻辑 contract：

1. 读取 `primary_ou_id` 对应 `ou_profile`
2. 由 `ou_path` 推导 `ou_ancestor_ids`
3. 读取每个祖先 OU 上的 `ou_policy_attachment`
4. 加载关联的 `policy_profile`

DynamoDB 实现：

* 对 `ou_policy#{ou_id}#` 重复执行前缀 `Query`

PostgreSQL 实现：

* 在 `auth_ou_policy_attachment` 上执行带索引 `SELECT`
* 批量读取 `auth_policy_profile`

### **5.5 Resource Grant Fetch**

逻辑 contract：

* 按 `(project_id, principal_type, principal_id, schema_name)` 列出 grants
* 评估 `ops` 与 `resource_id` / 规范化 filter selector

DynamoDB 实现：

* 对 `grant#{...}` 执行前缀 `Query`

PostgreSQL 实现：

* 用 project / principal / schema 条件走索引查询

### **5.6 Audit Append**

逻辑 contract：

* 追加不可变事件记录
* 按稳定时间顺序读回

DynamoDB 实现：

* 使用带随机后缀的时间排序 key 避免冲突

PostgreSQL 实现：

* 追加带 `event_ts` 与稳定 `tie_breaker`（如 ULID 或单调 UUID）的行

---

## **6. 可移植性规则**

主 AAA 设计只能假设以下通用后端能力：

* 按规范化逻辑键点查
* 按项目级前缀或等价谓词做索引列表读取
* 唯一约束
* 事务写组
* 条件 update / insert 语义
* 稳定有序 audit 读取

主 AAA 设计不能要求：

* 仅 DynamoDB 才有的 key layout 语义
* 仅 PostgreSQL 才有的 view / trigger 语义
* 后端专属 evaluator 行为

若未来某项功能无法落入这组共享能力中，规范必须：

1. 扩展通用 auth-store contract，或
2. 显式标注该能力是 backend-specific，不属于 core AAA scope

---

## **7. 总结**

`aaa.md` 定义 AAA 语义本身。

本文定义 DynamoDB 与 PostgreSQL 如何满足同一套 control-plane storage contract：

* DynamoDB 通过项目级 single-table keys 与 conditional transactions 实现
* PostgreSQL 通过规范化表、唯一索引与 SQL transactions 实现
* 两者都暴露同样的逻辑记录族与操作保证
