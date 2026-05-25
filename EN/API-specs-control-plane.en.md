# LTBase API Specification: Control Plane

This document describes the approved control-plane admin REST API contract under `/api/v1/org/...` together with the separate legacy operational `/control-plane` action API.

- Code baseline:
  - `ltbase.api/cmd/controlplane`
  - `rfc/EN/aaa.md`
- Document language: English
- Updated on: 2026-05-25

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

## 7. Legacy `/control-plane` Action API Notes

The admin REST API does not replace the existing action-style control-plane API.

Use the REST admin API for productized admin UI and automation.

Use `/control-plane` for Lambda Console style operations, CLI workflows, and backend operational tasks.

In particular:

- `/control-plane` remains the home of `ensure-project`, repair, schema, catalog, and migration actions
- `migrate-authz-policy-model` is an operational action, not a `/api/v1/...` REST endpoint
- the admin REST contract is resource-oriented, while `/control-plane` is action-oriented
