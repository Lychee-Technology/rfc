# LTBase API Specification: Control Plane

This document describes the approved control-plane admin REST API contract under `/api/v1/org/...` together with the separate legacy operational `/control-plane` action API.

- Code baseline:
  - `ltbase.api/cmd/controlplane`
  - `rfc/EN/aaa.md`
- Document language: English
- Updated on: 2026-06-20

## 1. Overview

The control-plane admin REST surface is split into two route families:

- `/api/v1/auth/...` for AAA configuration and referral administration
- `/api/v1/org/...` for org-chart and OU administration

This document covers the `/api/v1/org/...` routes and the distinction between the admin REST API and the operational `/control-plane` action API.

The control plane provides the following admin capabilities:

- organizational structure management for OUs, manager relationships, OU policy attachments, and org chart read models
- separate operational actions under `/control-plane` for bootstrap, repair, catalog, schema, and migration workflows

For `/api/v1/auth/...` routes, see `API-specs-auth-service.en.md`.

## 2. Authentication, Scope, and Shared Conventions

### 2.1 Admin Authentication

The control-plane admin REST API is admin-only and uses Bearer JWT authentication.

Requests are allowed when the caller has either:

- role `role.admin`
- permission `controlplane.admin`

Unauthenticated requests return:

```json
{
  "request_id": "req_123",
  "code": "unauthorized",
  "message": "admin authentication required"
}
```

Authenticated but non-admin requests return:

```json
{
  "request_id": "req_123",
  "code": "forbidden",
  "message": "admin role or permission required"
}
```

### 2.2 Project Scope

LTBase currently supports single-project private deployment for the control plane.

Therefore:

- every control-plane admin REST request implicitly targets the deployment project from server environment configuration
- clients must not provide `project_id` in the path, query, headers, or request body
- the server resolves project scope from deployment configuration
- the server may return `project_id` as read-only metadata in responses

### 2.3 Success and Error Envelopes

Single-resource success shape:

```json
{
  "request_id": "req_123",
  "data": {}
}
```

Collection success shape:

```json
{
  "request_id": "req_123",
  "items": []
}
```

Some collection endpoints may later add `total` if their contract grows to include meaningful counts, but the current approved org routes do not require it.

Error shape:

```json
{
  "request_id": "req_123",
  "code": "invalid_body",
  "message": "invalid request body"
}
```

Optional field-level or validation diagnostics may be returned as `details`.

### 2.4 Common Status Codes

- `200 OK`
- `201 Created`
- `204 No Content`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `500 Internal Server Error`

## 3. Route Summary

### 3.1 Admin REST Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/org/units` | List org units |
| POST | `/api/v1/org/units` | Create an org unit |
| GET | `/api/v1/org/units/{ou_id}` | Retrieve one org unit |
| PATCH | `/api/v1/org/units/{ou_id}` | Update or move an org unit |
| DELETE | `/api/v1/org/units/{ou_id}` | Delete an org unit |
| GET | `/api/v1/org/units/{ou_id}/users` | List users assigned to an org unit |
| PUT | `/api/v1/org/units/{ou_id}/users/{user_id}` | Move a user into an org unit |
| GET | `/api/v1/org/units/{ou_id}/policies` | List policies attached to an org unit |
| PUT | `/api/v1/org/units/{ou_id}/policies/{policy_id}` | Attach a policy to an org unit |
| DELETE | `/api/v1/org/units/{ou_id}/policies/{policy_id}` | Detach a policy from an org unit |
| GET | `/api/v1/org/users/{user_id}/manager` | Retrieve a user's direct manager |
| PUT | `/api/v1/org/users/{user_id}/manager` | Set a user's direct manager |
| DELETE | `/api/v1/org/users/{user_id}/manager` | Clear a user's direct manager |
| GET | `/api/v1/org/users/{user_id}/direct-reports` | List a user's direct reports |
| GET | `/api/v1/org/charts` | Retrieve the org chart read model |

### 3.2 Legacy `/control-plane` Actions

The following remain under `/control-plane` as operational actions rather than admin REST resources:

- `ensure-project`
- `repair-project`
- `update-schema`
- `create-permission-records`
- `create-iam-authz-records`
- `list-project-auth-config`
- `migrate-authz-policy-model`
- catalog put/get actions
- `import-referrals`

### 3.3 REST ↔ Action Mapping Summary

| REST API | `/control-plane` action | CLI (`cmd/tools`) |
|---|---|---|
| `POST /api/v1/auth/policies` | `create-iam-authz-records` (*) | **none** |
| `POST /api/v1/auth/referrals?import=1` | `import-referrals` | **none** |
| `GET /api/v1/auth/policies` | `list-project-auth-config` | **none** |

Notes:

- (*) `create-iam-authz-records` is a lower-level batch seed action. The REST `POST /api/v1/auth/policies` auto-generates a durable `policy_id`; `create-iam-authz-records` requires the caller to supply `policy_id` explicitly. The action is suitable for seeding, migration, and operational bulk writes, while the REST endpoint is the productized admin contract.
- The `cmd/tools` CLI currently exposes only `ensure-project`, `repair-project`, and `update-schema`. It does **not** expose a policy or referral management subcommand. Use the Control Plane Lambda action API or the HTTP REST API for those workflows.
- `list-project-auth-config` returns the full project auth snapshot (users, roles, policies, binding policies, referrals, attachments, and warnings), which is broader than `GET /api/v1/auth/policies`.

## 4. Common Data Structures

### 4.1 ControlPlaneUser

```json
{
  "user_id": "user_alice",
  "provider": "google",
  "issuer": "https://accounts.google.com",
  "external_sub": "provider-subject",
  "referral_code": "INVITE-2026-001",
  "primary_ou_id": "ou_team_android",
  "report_to_user_id": "user_manager_1",
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "last_login_at": 1760000005000
}
```

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

```json
{
  "ou_id": "ou_team_android",
  "policy_id": "policy.sales_read",
  "enforced": false
}
```

### 4.4 ManagerRelationship

```json
{
  "user_id": "user_alice",
  "report_to_user_id": "user_manager_1",
  "manager": {
    "user_id": "user_manager_1"
  }
}
```

### 4.5 OrgChart

```json
{
  "root_ou_id": "ou_rnd",
  "org_units": [],
  "users": [],
  "policy_attachments": []
}
```

Notes:

- `policy_attachments` is the org-chart read-model field name.
- In V1, these items are currently OU policy attachment records such as `{ "ou_id": "...", "policy_id": "...", "enforced": false }`.
- This differs intentionally from the auth-config snapshot field `ou_policy_attachments`, because the org-chart response is a UI-oriented aggregate read model rather than a direct snapshot dump.

## 5. Org Chart Semantics And Invariants

The org chart model follows two independent relationships:

- OU containment through `primary_ou_id` and `parent_ou_id`
- manager relationship through `report_to_user_id`

V1 rules:

- OU containment forms a tree
- `ou_path` is server-managed and read-only to clients
- moving an OU must recompute subtree paths safely
- an OU cannot be moved into its own descendant subtree
- a user cannot directly or transitively report to themselves
- dotted-line or matrix reporting is out of scope for V1
- OUs are not principals for principal policy attachments
- OU-wide authorization flows through OU policy attachments
- `block_inheritance` and `enforced` are accepted and stored for forward compatibility, but V1 runtime evaluation still behaves as simple ancestor-union inheritance

## 6. Org Chart APIs

### 6.1 Org Units

Implementation status: approved contract, not yet landed as `/api/v1/org/...` routes in the current branch.

#### `GET /api/v1/org/units`

Purpose: List org units.

Supported query parameters:

- `parent_ou_id`
- `tree=true`
- `q`

Response:

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

Purpose: Create an org unit.

Request body:

```json
{
  "ou_id": "ou_team_android",
  "name": "Team Android",
  "parent_ou_id": "ou_mobiledev",
  "block_inheritance": false
}
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "name": "Team Android",
    "parent_ou_id": "ou_mobiledev",
    "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
    "block_inheritance": false
  }
}
```

Notes:

- clients must not send `ou_path`
- `ou_path` is server-managed

#### `GET /api/v1/org/units/{ou_id}`

Purpose: Retrieve one org unit.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "name": "Team Android",
    "parent_ou_id": "ou_mobiledev",
    "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
    "block_inheritance": false,
    "created_at": 1760000000000,
    "updated_at": 1760000000000
  }
}
```

#### `PATCH /api/v1/org/units/{ou_id}`

Purpose: Update or move an org unit.

Request body example:

```json
{
  "name": "Android Platform",
  "parent_ou_id": "ou_mobiledev",
  "block_inheritance": false
}
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "name": "Android Platform",
    "parent_ou_id": "ou_mobiledev",
    "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
    "block_inheritance": false
  }
}
```

The server must reject moves that create a containment cycle with `400 invalid_org_cycle`.

#### `DELETE /api/v1/org/units/{ou_id}`

Purpose: Delete an org unit only when it has no child OUs and no assigned users.

Conflict responses return `409 ou_not_empty`.

### 6.2 Org Unit Users And Policies

Implementation status: approved contract, not yet landed as `/api/v1/org/...` routes in the current branch.

#### `GET /api/v1/org/units/{ou_id}/users`

Purpose: List users assigned to an org unit.

Supported query parameters:

- `include_subtree=true`

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "user_id": "user_alice",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1"
    }
  ]
}
```

#### `PUT /api/v1/org/units/{ou_id}/users/{user_id}`

Purpose: Move a user into an org unit.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "primary_ou_id": "ou_team_android"
  }
}
```

This route is a convenience form of updating the user resource directly.

#### `GET /api/v1/org/units/{ou_id}/policies`

Purpose: List policies attached to an org unit.

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "ou_id": "ou_team_android",
      "policy_id": "policy.sales_read",
      "enforced": false
    }
  ]
}
```

#### `PUT /api/v1/org/units/{ou_id}/policies/{policy_id}`

Purpose: Attach a policy to an org unit.

Request body:

```json
{
  "enforced": false
}
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "policy_id": "policy.sales_read",
    "enforced": false
  }
}
```

#### `DELETE /api/v1/org/units/{ou_id}/policies/{policy_id}`

Purpose: Detach a policy from an org unit.

Notes:

- OUs are not principals
- `block_inheritance` and `enforced` are stored but ignored by the V1 evaluator

### 6.3 Manager APIs

Implementation status: approved contract, not yet landed as `/api/v1/org/...` routes in the current branch.

#### `GET /api/v1/org/users/{user_id}/manager`

Purpose: Retrieve a user's direct manager.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "report_to_user_id": "user_manager_1",
    "manager": {
      "user_id": "user_manager_1"
    }
  }
}
```

#### `PUT /api/v1/org/users/{user_id}/manager`

Purpose: Set a user's direct manager.

Request body:

```json
{
  "report_to_user_id": "user_manager_1"
}
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "report_to_user_id": "user_manager_1"
  }
}
```

#### `DELETE /api/v1/org/users/{user_id}/manager`

Purpose: Clear a user's direct manager.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "report_to_user_id": ""
  }
}
```

#### `GET /api/v1/org/users/{user_id}/direct-reports`

Purpose: List a user's direct reports.

Supported query parameters:

- `recursive=true`

Response:

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

Cycle protection errors return `400 invalid_org_cycle`.

### 6.4 Org Chart Read Model

Implementation status: approved contract, not yet landed as `/api/v1/org/...` routes in the current branch.

#### `GET /api/v1/org/charts`

Purpose: Retrieve a UI-friendly org chart read model.

Supported query parameters:

- `root_ou_id`
- `include_users=true`
- `include_policies=true`

Response:

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

This endpoint is read-only. All writes still go through the resource endpoints above.

Field note:

- `policy_attachments` is the top-level field for the org-chart read model.
- The current V1 payload shape may contain OU policy attachment objects.

## 7. Legacy `/control-plane` Action API Notes

The admin REST API does not replace the existing action-style control-plane API.

Use the REST admin API for productized admin UI and automation.

Use `/control-plane` for Lambda Console style operations, CLI workflows, and backend operational tasks.

In particular:

- `/control-plane` remains the home of `ensure-project`, repair, schema, catalog, and migration actions
- `migrate-authz-policy-model` is an operational action, not a `/api/v1/...` REST endpoint
- the admin REST contract is resource-oriented, while `/control-plane` is action-oriented

### 7.1 Common Request Fields

All `/control-plane` actions share the following top-level JSON fields (`ControlPlaneRequest`):

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | Action name |
| `project_id` | UUID string | varies | Target project UUID |
| `data` | JSON array/object | varies | Action payload |
| `dry_run` | bool | no | Preview mode; no writes |
| `force` | bool | no | Overwrite existing conflicting records |

`dry_run` and `force` are honored only by actions that document support for them (e.g. `create-iam-authz-records`). `import-referrals` ignores both.

Response envelope:

```json
{
  "action": "create-iam-authz-records",
  "status": "success",
  "result": {}
}
```

### 7.2 `create-iam-authz-records`

Purpose: Bulk-create IAM/authz records (role profiles, policy profiles, principal-policy attachments, and user-role attachments) for a project.

This is a lower-level seed/migration action. For the productized policy management contract, use `POST /api/v1/auth/policies` (see `API-specs-auth-service.en.md`).

**Supported `kind` values:**

| Kind | Required fields | Purpose |
|---|---|---|
| `role_profile` | `role_id`, `name` | Create a role |
| `policy_profile` | `policy_id`, `name` | Create an auth policy with a policy document |
| `principal_policy_attachment` | `principal_type`, `principal_id`, `policy_id` | Attach a policy to a user or role |
| `user_role_attachment` | `user_id`, `role_id` | Assign a role to a user |

**Example: policy profile**

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

`data[]` fields for `policy_profile`:

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | string | yes | Must be `"policy_profile"` |
| `policy_id` | string | yes | Durable policy identifier |
| `name` | string | yes | Human-readable name |
| `slug` | string | no | Semantic slug for lookup (e.g. `"lead.read"`) |
| `external_key` | string | no | External reference key |
| `policy_document` | JSON object or JSON string | no | Policy statements; see `rfc/EN/aaa.md` §6 |

**Example: role profile with principal-policy attachment**

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

Notes:

- The `force` flag allows overwriting existing records.
- `dry_run` returns counts without writing.
- A `policy_profile` write triggers an automatic semantic project reseed.
- Unlike `POST /api/v1/auth/policies`, this action does **not** generate a `policy_id`; the caller provides it.
- The action stores `policy_document` verbatim (validated only as well-formed JSON, then compacted); it does **not** validate the document's internal shape. The canonical statement schema is defined in `rfc/EN/aaa.md` §6, which is authoritative.

### 7.3 `import-referrals`

Purpose: Import one or more referral codes into a project, optionally with a bound policy ID.

This action corresponds to `POST /api/v1/auth/referrals?import=1` in the REST API (see `API-specs-auth-service.en.md`).

**Batch mode** (via `data` array):

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

`data[]` fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `referral_code` | string | yes | Referral code, max 256 characters |
| `policy_id` | string | no | Durable policy ID or slug; resolved to durable ID before storage. Invalid/missing policy returns an error. |
| `expires_at_ms` | int64 or string | no | Expiration in epoch milliseconds. Omitting, `0`, or empty means never expires. |
| `project_id` | UUID string | no | Per-item project ID (must match top-level `project_id` if both are present). |

**Single-item mode** (without `data`, using top-level fields):

```json
{
  "action": "import-referrals",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "referral_code": "CODE001",
  "referral_policy_id": "policy.lead.read",
  "referral_expires_at_ms": 1767139200000
}
```

**Response:**

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

Behavior notes:

- Existing referral codes are **skipped** (conditional write) and counted as `skipped_existing`.
- `policy_id` is validated at write time: unknown policies return a `policy_not_found` error.
- When `policy_id` is a slug, it is resolved to the durable `policy_id` before persistence.
- Omitting `policy_id` preserves legacy binding behavior (no automatic policy attachment on identity binding).
- On the REST referral resource, `PATCH /api/v1/auth/referrals/{code}` accepts only `expires_at_ms`; `policy_id` is not an accepted PATCH field and is silently ignored (not rejected). Treat the binding as effectively immutable after creation.
