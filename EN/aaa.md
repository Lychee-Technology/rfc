# **LTBase AAA System — Technical Specification**

This document defines the **complete Authentication, Authorization, and Accounting (AAA)** architecture for **LTBase**, designed for both social login environments and enterprise-grade access control requirements.

The architecture explicitly separates three concerns:

| Layer                | Responsibility                                  |
| -------------------- | ----------------------------------------------- |
| **Authentication**   | Verify external identity via social login / SSO |
| **Identity Binding** | Map external identity to internal LTBase user   |
| **Authorization**    | Enforce row-level and column-level permissions  |

This separation enables LTBase to support invitation-based onboarding, whitelists, external approval systems, and multi-project deployments — without weakening security or overloading JWTs.

---

## **1. System Overview**

The LTBase AAA system provides:

* **Authentication** — External identity verification and JWT token issuance
* **Identity Binding** — Maps external identities to internal users using policy-driven rules
* **Fine-grained Authorization** — Enforces access at row-level and column/attribute-level
* **Audit Trails** — Complete logging of all access events
* **AI Safety** — Policy model safe for usage by AI Agents and tools

The authorization engine integrates with both **EntityMain + EAV business data** and the existing **LTBase query rule syntax** for expressive condition logic.

---

## **2. Authentication — Login Service**

### **2.1 Purpose**

The authentication layer is responsible for:

* Validating third-party identity tokens (Google / Apple / etc.)
* Normalizing external identity claims
* Issuing LTBase session tokens **only after identity binding succeeds**

> [!IMPORTANT]
> Authentication alone does **not** grant access to LTBase resources. An active Identity Binding is required.

### **2.2 External Identity Model**

Current implementation resolves external identity by deriving a **deterministic internal `user_id`** from normalized identity tuple:

* `project_id`
* `provider`
* `issuer`
* `sub`

Login does not require querying a dedicated external-lookup item.  
Instead, authservice computes deterministic `user_id` and reads:

| Item Type | Key Pattern | Purpose |
| --------- | ----------- | ------- |
| User Profile | `PK: auth#project#{project_id}#user#{user_id}`<br>`SK: profile` | Resolve whether identity is already bound |

The user profile remains the source of truth for binding state in the current path.

### **2.3 API Definition**

The Login Service runs as an **independent microservice** with the following endpoints:

#### **POST /api/v1/login/{provider}**

Exchange a third-party identity token for an LTBase session token.

**Request Headers:**

| Header        | Required | Description                                                                            |
| ------------- | -------- | -------------------------------------------------------------------------------------- |
| Authorization | Yes      | `Bearer <id_token>` — JWT from identity provider (validated by API Gateway authorizer) |

**Request Body:**

```json
{
  "project_id": "accbd397-974e-47f2-9331-56e6c64e19ef"
}
```

| Field      | Type   | Required | Description                          |
| ---------- | ------ | -------- | ------------------------------------ |
| project_id | string | Yes      | Target project ID for authentication |

**Response (200 OK):**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
  "api_base_url": "https://api.example.com"
}
```

| Field         | Type   | Description                           |
| ------------- | ------ | ------------------------------------- |
| access_token  | string | LTBase signed JWT for API access      |
| refresh_token | string | Token for obtaining new access tokens |
| api_base_url  | string | Project-scoped data plane base URL    |

**Error Responses:**

| Status | `error` Value              | Description                                          |
| ------ | -------------------------- | ---------------------------------------------------- |
| 400    | `invalid_body`             | Malformed JSON body                                  |
| 400    | `project_id_required`      | `project_id` missing in body and claims              |
| 400    | `invalid_provider`         | Provider path parameter is invalid                   |
| 400    | `missing_identity`         | Missing required identity claims (`sub`/`iss`)       |
| 400    | `project_not_configured`   | No API base URL configured for the target project    |
| 403    | `identity_unbound`         | External identity is not bound to an internal user   |
| 500    | `user_lookup_failed`       | Failed to lookup user by external identity           |
| 500    | `update_last_login_failed` | Failed to update user login timestamp                |
| 500    | `role_list_failed`         | Failed to load direct user roles                     |
| 500    | `role_expand_failed`       | Failed to expand inherited roles                     |
| 500    | `permission_list_failed`   | Failed to load permissions from effective roles      |
| 500    | `exchange_failed`          | Failed to issue access/refresh token pair            |

#### **POST /api/v1/id_bindings/{provider}**

Bind a third-party identity token for an LTBase user.

**Request Headers:**

| Header        | Required | Description                                                                            |
| ------------- | -------- | -------------------------------------------------------------------------------------- |
| Authorization | Yes      | `Bearer <id_token>` — JWT from identity provider (validated by API Gateway authorizer) |

**Request Body:** 

```json
{
  "bind_context": {
    "code": "ABC123",
    "project_id": "project_456"
  }
}
```

**Response (200 OK):**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
  "api_base_url": "https://api.example.com"
}
```

| Field         | Type   | Description                           |
| ------------- | ------ | ------------------------------------- |
| access_token  | string | LTBase signed JWT for API access      |
| refresh_token | string | Token for obtaining new access tokens |

**Error Responses:**

| Status | `error` Value         | Description                                       |
| ------ | --------------------- | ------------------------------------------------- |
| 400    | `invalid_body`        | Malformed JSON body                               |
| 400    | `project_id_required` | `bind_context.project_id` is missing              |
| 400    | `invalid_provider`    | Provider path parameter is invalid                |
| 400    | `missing_identity`    | Missing required identity claims (`sub`/`iss`)    |
| 400    | `invalid_code`        | `bind_context.code` is missing                    |
| 409    | `invalid_code`        | Referral code invalid, expired, or already used   |
| 500    | `id_binding_failed`   | Binding transaction or token issuance failed       |


### **2.4 JWT Design**

LTBase JWTs:

* Use **internal user_id** as `sub` (not external provider subject)
* Never include permissions or binding state
* Are short-lived and stateless

```json
{
  "sub": "ltbase_user_id",
  "role_ids": ["Team_Android", "Dev"],
  "iat": 1700000000,
  "exp": 1700003600
}
```

> [!NOTE]
> Permissions must be evaluated dynamically to reflect real-time policy changes. Do not embed permissions in JWT.

---

## **3. Identity Binding Layer**

### **3.1 Motivation**

In enterprise environments:

* Not every Google/Apple user is allowed to access the system
* Access may depend on invitation codes, email domains, approvals, or external systems
* One external identity may need access to multiple projects

Therefore, LTBase introduces an explicit **Identity Binding** layer between authentication and authorization.

### **3.2 Internal User (Authorization Subject)**

The internal LTBase user is the **only subject used by authorization policies**.

User profile is stored as a DynamoDB item:

| Item Type | Key Pattern | Core Attributes |
| --------- | ----------- | --------------- |
| User Profile | `PK: auth#project#{project_id}#user#{user_id}`<br>`SK: profile` | `user_id`, `project_id`, `email`, `email_verified`, `created_at`, `last_login_at`, `provider`, `issuer`, `external_sub` |

### **3.3 Identity Binding Schema**

LTBase authservice uses an **item-based binding model** instead of a dedicated `identity_binding` table:

| Binding State | DynamoDB Representation |
| ------------- | ----------------------- |
| Unbound | No user profile item at deterministic `user_id` |
| Bound | User profile item exists at `auth#project#{project_id}#user#{user_id}` |
| Bound via code | Referral item validated + consumed in the same transaction that creates user profile (optional email lookup may also be written) |

This design enables:

| Capability                  | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| Multi-project access        | One external identity → multiple projects               |
| Deterministic binding state | Binding state is resolved through deterministic user key |
| Lifecycle control           | Binding is controlled through item existence and conditional writes |

### **3.4 Login & Binding Flow**

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant AuthService
    participant SocialProvider
    participant DynamoDB
    participant AuthorizationEngine

    Client->>AuthService: POST /api/v1/login/{provider}
    AuthService->>SocialProvider: Validate id_token
    SocialProvider-->>AuthService: Claims (sub, iss, email)

    AuthService->>AuthService: Normalize identity + derive deterministic user_id
    AuthService->>DynamoDB: Get user profile item by user_id

    alt Not bound
        AuthService-->>Client: 403 IDENTITY_UNBOUND
        Client->>AuthService: POST /api/v1/id_bindings/{provider} (code)
        AuthService->>DynamoDB: Validate referral + create user profile (transaction)
        AuthService->>DynamoDB: Optional email lookup write
    end

    AuthService->>AuthorizationEngine: Resolve roles & permissions
    AuthService-->>Client: LTBase JWT pair
```

**Flow Steps:**

1. User logs in via social provider
2. LTBase validates the external token
3. Authservice normalizes identity tuple and derives deterministic internal `user_id`
4. Authservice reads user profile by deterministic `user_id`
5. If bound → resolve roles/permissions and issue JWT pair
6. If not bound → return `IDENTITY_UNBOUND`
7. Client calls bind endpoint with referral code to create binding atomically

### **3.5 Binding Policy Model**

Binding policies reuse LTBase rule syntax and are evaluated at bind-time:

> [!NOTE]
> Current implementation (`v1`) uses referral-code validation as the binding gate.
> The policy-driven model below is the target design.
> Detailed implementation guidance is documented in `aaa-binding-policy-implementation.md`.

**Invitation Code Policy:**

```json
{
  "l": "and",
  "c": [
    { "a": "invite.code", "v": "equals:${payload.code}" },
    { "a": "invite.status", "v": "equals:active" }
  ]
}
```

**Email Domain Whitelist:**

```json
{
  "l": "and",
  "c": [
    { "a": "external.email", "v": "ends_with:@company.com" }
  ]
}
```

**External System Assertion:**

```json
{
  "l": "and",
  "c": [
    { "a": "crm.customer_id", "v": "equals:${payload.customer_id}" }
  ]
}
```

---

## **4. Authorization Goals**

The authorization engine must ensure:

* A user only sees rows they are permitted to see (**row-level restriction**)
* A user only sees columns/attributes they are allowed to (**column/attribute-level**)
* Runtime policy is **fail-closed** when policy resolution/evaluation fails
* Permission rules can reference dynamic entity attributes in EAV
* Rules are safe and structured (no code injection)

> [!IMPORTANT]
> **Row access ≠ Column visibility** — both are distinct control layers for data governance and compliance.

### **4.1 Current Runtime Baseline (Implemented)**

The current data-plane enforcement path is IAM-style and DynamoDB-backed:

* Principal = requester `sub` + `role_ids` from JWT claims
* Lookup `resource_grant` records under principal partition
* Enforce operation (`create/read/update/delete`) using `ops`
* Apply either:
  * explicit `resource_id` grants, or
  * `filter_json` grants converted to Forma conditions
* Reject by default when no matching grants are found (fail-closed)

### **4.2 Integrated Direction (Next Layer)**

On top of resource grants, LTBase introduces richer permission semantics:

* `permission_profile.rule_json` for structured rule logic
* `permission_profile.outcome` for row/column action semantics (`allow_row`, `allow_column`, `mask_column`, etc.)
* context expansion (`${requester.user_id}`, `${requester.role_ids}`) performed server-side only

---

## **5. AAA Data Model**

### **5.1 Business Entities — EntityMain + EAV**

Business entities use the **DSQL** based data model:

* **Primary Table (`entity_main_<project_id>`):**
  Stores high-frequency fixed columns: `{ ltbase_schema_id, ltbase_row_id, ltbase_created_at, ltbase_updated_at, text_01...10, ... }`

* **EAV Data Table (`eav_data_<project_id>`):**
  Stores dynamic attributes with typed value columns: `{ schema_id, row_id, attr_id, value_text, value_numeric, ... }`

This dynamic attribute model requires authorization conditions that match attributes from `eav_data` (mapping `attr_name` to `attr_id` and using `value_text`/`value_numeric`) rather than static columns.

### **5.2 Authorization Entities**

| Item Family | Purpose |
| ----------- | ------- |
| `user profile` | Internal user identity subject |
| `email lookup` | Resolve verified email to `user_id` |
| `user role` | User → role mapping |
| `role profile` | Role metadata and parent role (inheritance) |
| `role permission` | Role → permission mapping |
| `permission profile` | Permission definition (`name`, `rule_json`, `outcome`) |
| `policy profile` | IAM-style policy document (`policy_document`) |
| `principal policy attachment` | Attach policy to principal (user/role) |
| `resource grant` | Principal-scoped resource operation grant (`ops`, `resource_id`/`filter_json`) |
| `resource grant reverse` | Reverse index for resource-centric inspection |
| `refresh session` | Refresh token lifecycle (issued/rotated/revoked) |
| `session parent-child edge` | Revoke-chain traversal |
| `referral profile` | Invite/referral validation and consume state |
| `audit event` | Accounting and security audit trail |

Permissions remain structured objects, not EAV records. Project-scoped client calls still cannot mutate permission definitions directly.

### **5.3 Entity Relationships**

The system follows a standard **RBAC (Role-Based Access Control)** model with support for hierarchical groups:

* **User**: The internal identity principal
* **Role / Group**: Represents a collection of permissions or other roles
  * Groups are functionally equivalent to Roles
  * **Inheritance**: A Role can inherit from another Role (e.g., `Manager` inherits `Employee`)
* **Permission**: A specific access rule composed of a Logic Condition and an Outcome

**Relationship Flow:**

1. **External Identity** is normalized to deterministic internal `user_id`, then mapped to **User Profile**
2. **Users** are assigned **Roles** (via `user role` items)
3. **Roles** may be mapped to **Permissions** (via `role permission` items)
4. **Principals** may also receive direct IAM-style grants (`resource_grant`) and policy attachments
5. **Authorization** combines grant-based scope with permission profile semantics

### **5.4 DynamoDB Single-Table Key Definitions**

Identity records are stored in the shared physical table with project-scoped key namespaces:

| Domain | `PK` Pattern | `SK` Pattern | Notes |
| ------ | ------------ | ------------ | ----- |
| User profile | `auth#project#{project_id}#user#{user_id}` | `profile` | Internal user principal |
| Verified email lookup | `auth#project#{project_id}#email#{email_lower_b64}` | `user` | Optional/conditional |
| User-role mapping | `auth#project#{project_id}#user#{user_id}` | `role#{role_id}` | Query roles by user |
| Role profile | `auth#project#{project_id}#role#{role_id}` | `profile` | Includes parent role |
| Role-permission mapping | `auth#project#{project_id}#role#{role_id}` | `permission#{permission_id}` | Query permissions by role |
| Permission profile | `auth#project#{project_id}#permission#{permission_id}` | `profile` | Permission payload |
| Policy profile | `auth#project#{project_id}#policy#{policy_id}` | `profile` | IAM-style policy document |
| Principal policy attachment | `auth#project#{project_id}#principal#{type}#{id}` | `policy#{policy_id}` | Attach policy to user/role principal |
| Resource grant | `auth#project#{project_id}#principal#{type}#{id}` | `grant#{schema}#{resource_or_filter}` | Operation-level grant with selector |
| Resource grant reverse | `auth#project#{project_id}#resource#{schema}#{resource_or_filter}` | `principal#{type}#{id}` | Reverse lookup for governance/debug |
| Binding policy | `auth#project#{project_id}#binding_policy` | `profile#{policy_id}` | Query-enabled policy loading |
| Refresh session | `auth#project#{project_id}#session#{refresh_jti}` | `profile` | Rotation/revocation state |
| Session edge | `auth#project#{project_id}#session_parent#{parent_jti}` | `child#{refresh_jti}` | Revoke-chain traversal |
| Referral | `auth#project#{project_id}#ref#{code_b64}` | `profile` | Invite validation/consumption |
| Audit event | `auth#project#{project_id}#audit` | `ts#{unix_ms}#{rand}` | Time-ordered append log |

### **5.5 Project Isolation Strategy (No SQL Views)**

Project isolation is implemented by **key scoping**, not SQL views:

| Isolation Control | Description |
| ----------------- | ----------- |
| Key namespace | Every auth item is prefixed with `auth#project#{project_id}` |
| Lookup discipline | All authservice reads/writes include project-scoped keys |
| Conditional writes | Binding/session operations use conditional or transactional writes for safety |

This design removes dynamic SQL view provisioning and keeps authservice storage serverless-native.

### **5.6 Key Normalization and Encoding Rules**

To avoid key collisions and cross-language inconsistencies, key segments must be normalized deterministically:

| Segment | Rule |
| ------- | ---- |
| `project_id` | Use canonical UUID string form (lowercase, hyphenated). |
| `provider` | Trim spaces, lowercase, then encode with Base64 URL-safe (no padding). |
| `issuer` | Trim spaces, keep original case, encode with Base64 URL-safe (no padding). |
| `sub` | Trim spaces, encode with Base64 URL-safe (no padding). |
| `email_lower` | Trim spaces, lowercase, then encode with Base64 URL-safe (no padding). |
| `code` | Trim spaces, encode with Base64 URL-safe (no padding). |

General rules:

* All dynamic key segments are UTF-8 strings.
* Do not use raw delimiters (`#`) inside key segments; always encode dynamic segments.
* The same normalization pipeline must be shared by read and write paths.
* Any invalid or empty normalized segment must fail fast at repository boundary.

---

## **6. Permission Rule Syntax**

LTBase currently uses two structured policy payloads:

1. **Permission Rule JSON (`rule_json`)** for permission profiles
2. **Grant Filter JSON (`filter_json`)** for resource grants

### **6.1 Permission Rule JSON (`l/c/a/v`)**

Permission rules reuse the LTBase query-rule format:

```json
{
  "l": "and",
  "c": [
    { "a": "price", "v": "gt:10" },
    {
      "l": "or",
      "c": [
        { "a": "status", "v": "equals:active" },
        { "a": "category", "v": "starts_with:A" }
      ]
    }
  ]
}
```

| Key | Meaning                     |
| --- | --------------------------- |
| l   | Logical operator (and / or) |
| c   | Condition array             |
| a   | Attribute name              |
| v   | Value with operator prefix  |

This format supports nested logic and serves both row-level and column-level conditions.

### **6.2 Grant Filter JSON (`filter_json`)**

For grant-based row scoping, filters are stored as:

```json
{
  "ownerUserId": "eq:${requester.user_id}",
  "status": "eq:open"
}
```

Each key is an attribute name; each value is an operator-prefixed expression supported by the data-plane filter parser.

---

## **7. Row-Level Permission**

A row-level rule determines whether a given entity (row) is visible or actionable.

Current enforcement combines:

* `resource_id` grants (explicit allow-list)
* `filter_json` grants (attribute condition scope)

**Example — User can read only rows they own:**

```json
{
  "l": "and",
  "c": [
    { "a": "owner", "v": "equals:${requester.user_id}" }
  ]
}
```

At runtime, list/read operations are constrained by grant-derived conditions before querying business data.

---

## **8. Column / Attribute-Level Permission**

Column-level permission controls *which attributes of an entity* a user may read or write.

Use cases:

* A user has access to a record but not all its fields
* Sensitive fields should be masked or hidden

**Example — Allow reading email only for managers:**

```json
{
  "l": "and",
  "c": [
    { "a": "role", "v": "equals:${requester.role_ids}" },
    { "a": "attribute_name", "v": "equals:email" }
  ]
}
```

The `outcome` for this permission is stored in permission profile items (for example `'allow_column'`, `'mask_column'`).

> [!NOTE]
> Current implementation baseline mainly enforces row-level scope.  
> Column-level policy outcomes are part of the integrated design and are introduced incrementally.

### **Data Masking (Optional)**

For sensitive attributes (e.g., SSN), you may choose to *mask the value* (e.g., replace with `*****`) instead of hiding it completely. This is akin to dynamic data masking in database systems.

---

## **9. Authorization Engine & Evaluation**

### **9.1 Role Expansion**

Compute effective roles by resolving hierarchy:

```
All_Employees → Dev → Team_Android
```

The engine must expand inherited roles before evaluating permissions.

> [!NOTE]
> Current implementation resolves effective roles from both JWT `role_ids` and DynamoDB `user_role_attachment`,
> then expands `parent_role_ids` transitively from role profiles (fail-closed on data access errors).

### **9.2 Principal Scope Fetch (Current Baseline)**

Fetch principal grants directly from DynamoDB:

```text
PK: auth#project#{project_id}#principal#{principal_type}#{principal_id}
SK begins_with "grant#{schema_name}#"
```

Then evaluate:

* operation compatibility via `ops`
* selector via `resource_id` or `filter_json`

### **9.3 Permission Fetch (Integrated Layer)**

Fetch permissions associated with all effective roles:

```text
1) Query each role partition:
   PK: auth#project#{project_id}#role#{role_id}
   SK begins_with "permission#"

2) Collect unique permission_id values.

3) Get each permission profile:
   PK: auth#project#{project_id}#permission#{permission_id}
   SK: profile
```

At runtime, this is implemented with DynamoDB `Query` + `GetItem`/batch read patterns, then de-duplicated in memory.

### **9.4 Context Expansion**

Before evaluating a rule, the engine replaces placeholders:

* `${requester.user_id}`
* `${requester.role_ids}`

with real values.

### **9.5 Condition Evaluation**

The rule logic (l/c) is evaluated against:

* EAV attributes of the target entity (row-level rules)
* The attribute names being accessed (column-level rules)

**Example:**

```json
{ "a": "project_team", "v": "equals:${requester.role_ids}" }
```

evaluates whether the requester's roles include the team of the project.

Unresolved placeholders or invalid policy expressions must fail closed.

---

## **10. Query Filtering & Enforcement**

Current data-plane enforcement pushes grant-derived conditions into Forma query conditions.

For SQL-native paths, equivalent enforcement can be implemented using CTE (Common Table Expression) pattern:

```sql
WITH matched_entities AS (
    SELECT DISTINCT e.row_id
    FROM public.eav_data e
    WHERE e.schema_id = $1
      AND (
          -- Recursive logic generated from permission rules
          EXISTS (SELECT 1 FROM public.eav_data x WHERE x.row_id = e.row_id AND x.attr_id = ... AND ...)
      )
)
SELECT t.*
FROM public.entity_main t
JOIN matched_entities m ON t.ltbase_row_id = m.row_id;
```

Column/attribute filters involve checking which fields should be returned or masked according to permission outcomes.

---

## **11. AI Agent Safety**

To defend against prompt injection and unintended privilege escalation:

* Permissions must be **defined statically in policy storage**
* Agents may request data but **cannot contribute policy logic**
* Rule evaluation must be deterministic and safe
* Variables like `${…}` are expanded only server-side
* Invalid policy payloads are denied by default (fail-closed)

This ensures that agents *never generate policy conditions* but only request actions against enforced policies.

---

## **12. Accounting & Auditing**

Authorization-relevant decisions should be logged:

| Field     | Purpose                       |
| --------- | ----------------------------- |
| timestamp | When check happened           |
| user_id   | Who requested (internal user) |
| action    | Operation attempted           |
| resource  | Entity type / ID              |
| decision  | allowed / denied              |
| details   | Rule matched, context values  |

Audit events are appended as DynamoDB items under:

* `PK: auth#project#{project_id}#audit`
* `SK: ts#{unix_ms}#{rand}`

This supports compliance and incident investigation.

> [!NOTE]
> Current implementation already records authservice audit events in this partition.
> Data-plane authorization decision auditing is progressively aligned to the same model.

---

## **13. Summary**

The LTBase AAA framework:

* Cleanly separates **Authentication**, **Identity Binding**, and **Authorization**
* Supports enterprise onboarding models with social login only
* Provides **policy-driven identity binding** for invitations, whitelists, and approvals
* Uses fail-closed **grant-based row enforcement** as current baseline
* Extends toward permission-profile-driven **row/column outcomes**
* Supports both grant filters and LTBase rule syntax in policy storage
* Expands roles hierarchically and combines role/user principals
* Ensures AI agent safety
* Generates complete audit trails

This design positions LTBase as an **AI-native, enterprise-ready BaaS platform**.
