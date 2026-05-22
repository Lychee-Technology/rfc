# **LTBase AAA Control-Plane Store Mapping**

This document defines how the storage-agnostic AAA model in `aaa.md` maps onto concrete control-plane backends.

The primary specification defines the **logical auth-store contract** only. This mapping document explains how that contract can be implemented with both **DynamoDB** and **PostgreSQL** without changing AAA semantics.

---

## **1. Goals**

The backend mapping must preserve the following invariants across all supported stores:

* Project-scoped isolation for every auth record
* Unique lookup for external identity binding
* Deterministic lookup for user, role, permission, and policy records
* Atomic referral consumption + binding creation
* Conditional write semantics for bind/session safety
* Efficient list/query operations for role expansion, OU inheritance, and grant fetch
* Stable append-only audit logging

The AAA design must not depend on a backend-specific primitive when the same behavior cannot be achieved in the other supported backend.

---

## **2. Logical Record Families**

The logical record families are defined in `aaa.md` Section 5.4.

The backend is responsible for providing equivalent access paths for:

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

## **3. DynamoDB Mapping**

### **3.1 Physical Shape**

DynamoDB can implement the auth store with a shared table and project-scoped key namespaces.

| Logical Record Family | Partition / Sort Key Pattern | Notes |
| --------------------- | ---------------------------- | ----- |
| `user_profile` | `PK=auth#project#{project_id}`, `SK=user#{user_id}` | Unique user record |
| `external_lookup` | `PK=auth#project#{project_id}`, `SK=lookup_ext#{provider_b64}#{issuer_b64}#{sub_b64}` | External identity -> `user_id` |
| `email_lookup` | `PK=auth#project#{project_id}`, `SK=lookup_email#{email_lower_b64}` | Optional verified email index |
| `user_role` | `PK=auth#project#{project_id}`, `SK=user_role#{user_id}#{role_id}` | List roles by user |
| `ou_profile` | `PK=auth#project#{project_id}`, `SK=ou#{ou_id}` | OU metadata |
| `ou_user` | `PK=auth#project#{project_id}`, `SK=ou_user#{ou_id}#{user_id}` | Reverse user listing by OU |
| `ou_policy_attachment` | `PK=auth#project#{project_id}`, `SK=ou_policy#{ou_id}#{policy_id}` | Policy attachment |
| `direct_report` | `PK=auth#project#{project_id}`, `SK=direct_report#{manager_user_id}#{report_user_id}` | Reverse manager lookup |
| `role_profile` | `PK=auth#project#{project_id}`, `SK=role#{role_id}` | Role metadata |
| `role_permission` | `PK=auth#project#{project_id}`, `SK=role_permission#{role_id}#{permission_id}` | Permission mapping |
| `permission_profile` | `PK=auth#project#{project_id}`, `SK=permission#{permission_id}` | Permission payload |
| `policy_profile` | `PK=auth#project#{project_id}`, `SK=policy#{policy_id}` | Policy payload |
| `principal_policy_attachment` | `PK=auth#project#{project_id}`, `SK=principal_policy#{type}#{id}#{policy_id}` | Principal attachment |
| `resource_grant` | `PK=auth#project#{project_id}`, `SK=grant#{type}#{id}#{schema}#{selector}` | Selector is resource or filter hash |
| `binding_policy` | `PK=auth#project#{project_id}`, `SK=binding_policy#{priority}#{policy_id}` | Priority-sortable |
| `referral_profile` | `PK=auth#project#{project_id}`, `SK=ref#{code_b64}` | Invite record |
| `refresh_session` | `PK=auth#project#{project_id}#session`, `SK=session#{refresh_jti}` | Session state |
| `session_edge` | `PK=auth#project#{project_id}#session`, `SK=child#{parent_jti}#{child_jti}` | Parent/child revoke traversal |
| `audit_event` | `PK=auth#audit#project#{project_id}#date#{yyyy-mm-dd}`, `SK=ts#{unix_ms}#{rand}` | Append-only ordered log |

### **3.2 Strengths / Constraints**

* Prefix queries make project-scoped listing efficient.
* Conditional writes and transactions support bind/session safety.
* Item shape must remain bounded; large policy payloads should still stay within DynamoDB item limits.
* Audit ordering is naturally represented through sort-key time ordering.

---

## **4. PostgreSQL Mapping**

### **4.1 Physical Shape**

PostgreSQL can implement the same logical auth store with normalized tables plus unique indexes.

Suggested table set:

| Logical Record Family | Suggested Table | Key / Index Strategy |
| --------------------- | --------------- | -------------------- |
| `user_profile` | `auth_user_profile` | `UNIQUE(project_id, user_id)` |
| `external_lookup` | `auth_external_lookup` | `UNIQUE(project_id, provider_norm, issuer_norm, sub_norm)` |
| `email_lookup` | `auth_email_lookup` | `UNIQUE(project_id, email_lower_norm)` |
| `user_role` | `auth_user_role` | `UNIQUE(project_id, user_id, role_id)`, index `(project_id, user_id)` |
| `ou_profile` | `auth_ou_profile` | `UNIQUE(project_id, ou_id)`, index `(project_id, parent_ou_id)` |
| `ou_user` | `auth_ou_user` | `UNIQUE(project_id, ou_id, user_id)` |
| `ou_policy_attachment` | `auth_ou_policy_attachment` | `UNIQUE(project_id, ou_id, policy_id)` |
| `direct_report` | `auth_direct_report` | `UNIQUE(project_id, manager_user_id, report_user_id)` |
| `role_profile` | `auth_role_profile` | `UNIQUE(project_id, role_id)` |
| `role_permission` | `auth_role_permission` | `UNIQUE(project_id, role_id, permission_id)` |
| `permission_profile` | `auth_permission_profile` | `UNIQUE(project_id, permission_id)` |
| `policy_profile` | `auth_policy_profile` | `UNIQUE(project_id, policy_id)` |
| `principal_policy_attachment` | `auth_principal_policy_attachment` | `UNIQUE(project_id, principal_type, principal_id, policy_id)` |
| `resource_grant` | `auth_resource_grant` | `UNIQUE(project_id, principal_type, principal_id, schema_name, selector_kind, selector_hash)` |
| `binding_policy` | `auth_binding_policy` | index `(project_id, priority, policy_id)` |
| `referral_profile` | `auth_referral_profile` | `UNIQUE(project_id, code_norm)` |
| `refresh_session` | `auth_refresh_session` | `UNIQUE(project_id, refresh_jti)` |
| `session_edge` | `auth_session_edge` | `UNIQUE(project_id, parent_jti, child_jti)` |
| `audit_event` | `auth_audit_event` | index `(project_id, event_ts, tie_breaker)` |

### **4.2 Strengths / Constraints**

* Multi-row transactions naturally support bind/session workflows.
* Unique indexes provide deterministic identity and referral safety.
* Query planners can optimize joins for permission/policy expansion.
* Audit ordering should use `(event_ts, tie_breaker)` rather than relying on insertion order.

---

## **5. Operation Equivalence**

### **5.1 Login Lookup**

Logical contract:

1. Normalize `(project_id, provider, issuer, sub)`.
2. Try `external_lookup`.
3. If no mapping exists, derive deterministic `user_id` and try `user_profile`.

DynamoDB implementation:

* `GetItem` external lookup key
* fallback `GetItem` user profile key

PostgreSQL implementation:

* `SELECT ... FROM auth_external_lookup WHERE ...`
* fallback `SELECT ... FROM auth_user_profile WHERE project_id = ? AND user_id = ?`

### **5.2 Bind Transaction**

Logical contract:

1. Validate referral code.
2. Ensure binding target does not already exist.
3. Create `user_profile`.
4. Create `external_lookup`.
5. Optionally create `email_lookup`.
6. Mark referral consumed.

DynamoDB implementation:

* `TransactWriteItems` with conditional expressions

PostgreSQL implementation:

* single SQL transaction
* `SELECT ... FOR UPDATE` or equivalent row locking for referral
* unique-index enforcement plus checked updates/inserts

### **5.3 Role / Permission Expansion**

Logical contract:

1. List `user_role` by `(project_id, user_id)`.
2. Load `role_profile` records for inheritance expansion.
3. List `role_permission` by each effective role.
4. Load `permission_profile` records.

DynamoDB implementation:

* `Query` on project partition with role/user prefixes
* `GetItem` / `BatchGetItem` for profiles

PostgreSQL implementation:

* indexed `SELECT` on mapping tables
* point selects or batched `IN (...)` fetches for profiles

### **5.4 OU Policy Inheritance**

Logical contract:

1. Load `ou_profile` for `primary_ou_id`.
2. Derive `ou_ancestor_ids` from `ou_path`.
3. List `ou_policy_attachment` for each ancestor OU.
4. Load referenced `policy_profile` records.

DynamoDB implementation:

* repeated prefix `Query` for `ou_policy#{ou_id}#`

PostgreSQL implementation:

* indexed `SELECT` from `auth_ou_policy_attachment`
* batched fetch from `auth_policy_profile`

### **5.5 Resource Grant Fetch**

Logical contract:

* List grants by `(project_id, principal_type, principal_id, schema_name)`.
* Evaluate `ops` and either `resource_id` or normalized filter selector.

DynamoDB implementation:

* prefix `Query` on `grant#{...}`

PostgreSQL implementation:

* indexed `SELECT` with project/principal/schema predicates

### **5.6 Audit Append**

Logical contract:

* Append immutable event records.
* Read back in stable timestamp order.

DynamoDB implementation:

* time-ordered sort key with random suffix to avoid collisions

PostgreSQL implementation:

* append row with `event_ts` plus deterministic `tie_breaker` such as ULID or monotonic UUID

---

## **6. Portability Rules**

The primary AAA design must assume only the following backend capabilities:

* point lookup by normalized logical key
* indexed listing by project-scoped prefixes or equivalent predicates
* uniqueness constraints
* transactional write groups
* conditional update/insert semantics
* stable ordered audit reads

The primary AAA design must not require:

* DynamoDB-only key layout semantics
* PostgreSQL-only view or trigger semantics
* backend-specific evaluator behavior

If a future feature cannot be represented within these shared capabilities, the spec must either:

1. extend the common auth-store contract, or
2. explicitly mark the feature as backend-specific and out of core AAA scope

---

## **7. Summary**

`aaa.md` defines the AAA semantics.

This document defines how both DynamoDB and PostgreSQL satisfy the same control-plane storage contract:

* DynamoDB uses project-scoped single-table keys and conditional transactions.
* PostgreSQL uses normalized tables, unique indexes, and SQL transactions.
* Both implementations expose the same logical record families and operational guarantees.
