# LTBase API Specification: Auth Service

This document describes the approved control-plane admin REST API contract under `/api/v1/auth/...` for a dedicated control-plane gateway/domain.

- Code baseline:
  - `ltbase.api/cmd/controlplane`
  - `rfc/EN/aaa.md`
- Document language: English
- Updated on: 2026-05-25

## 1. Overview

The control-plane admin REST surface is split into two route families:

- `/api/v1/auth/...` for AAA configuration and referral administration
- `/api/v1/org/...` for org-chart and OU administration

This document covers the `/api/v1/auth/...` routes:

- auth configuration snapshot retrieval for bootstrap and inspection
- AAA configuration management for users, roles, unified policies, principal policy attachments, binding policies, and referrals
- policy-first authorization modeling aligned with `rfc/EN/aaa.md`

For `/api/v1/org/...` routes and `/control-plane` operational actions, see `API-specs-control-plane.en.md`.

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

- every admin REST request implicitly targets the deployment project from server environment configuration
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

Some collection endpoints also include `total` when the endpoint contract defines a meaningful count.

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

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/auth/config` | Retrieve the control-plane auth snapshot |
| GET | `/api/v1/auth/users` | List control-plane users |
| GET | `/api/v1/auth/users/{user_id}` | Retrieve one control-plane user |
| PATCH | `/api/v1/auth/users/{user_id}` | Update one control-plane user |
| PUT | `/api/v1/auth/users/{user_id}/roles/{role_id}` | Attach a role to a user |
| DELETE | `/api/v1/auth/users/{user_id}/roles/{role_id}` | Detach a role from a user |
| GET | `/api/v1/auth/roles` | List role profiles |
| POST | `/api/v1/auth/roles` | Create a role profile |
| GET | `/api/v1/auth/roles/{role_id}` | Retrieve one role profile |
| PATCH | `/api/v1/auth/roles/{role_id}` | Update one role profile |
| DELETE | `/api/v1/auth/roles/{role_id}` | Delete one role profile |
| GET | `/api/v1/auth/policies` | List policy profiles |
| POST | `/api/v1/auth/policies` | Create a policy profile |
| GET | `/api/v1/auth/policies/{policy_id}` | Retrieve one policy profile |
| PATCH | `/api/v1/auth/policies/{policy_id}` | Update one policy profile |
| DELETE | `/api/v1/auth/policies/{policy_id}` | Delete one policy profile |
| PUT | `/api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}` | Attach a policy to a user or role |
| DELETE | `/api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}` | Detach a policy from a user or role |
| GET | `/api/v1/auth/binding-policies` | List binding policies |
| POST | `/api/v1/auth/binding-policies` | Create a binding policy |
| PATCH | `/api/v1/auth/binding-policies/{policy_id}` | Update a binding policy |
| DELETE | `/api/v1/auth/binding-policies/{policy_id}` | Delete a binding policy |
| GET | `/api/v1/auth/referrals` | List referral codes |
| POST | `/api/v1/auth/referrals` | Create a referral code |
| POST | `/api/v1/auth/referrals?import=1` | Import referral codes in batch |
| PATCH | `/api/v1/auth/referrals/{code}` | Update a referral code |
| POST | `/api/v1/auth/referrals/{code}/disable` | Disable a referral code |
| DELETE | `/api/v1/auth/referrals/{code}` | Delete a referral code |

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

Notes:

- `referral_code` is part of the current auth-config user snapshot shape.
- `primary_ou_id` and `report_to_user_id` belong to the org-management contract and may be surfaced by user or org resource endpoints.

### 4.2 Role

```json
{
  "role_id": "role.manager",
  "name": "Manager",
  "description": "People manager",
  "parent_role_ids": ["role.employee"],
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

### 4.3 PrincipalPolicyAttachment

```json
{
  "principal_type": "role",
  "principal_id": "role.sales",
  "policy_id": "policy.sales_read"
}
```

### 4.4 Policy

```json
{
  "policy_id": "policy.sales_read",
  "name": "Sales Read Policy",
  "description": "Read access for sales records",
  "document": {
    "statements": [
      {
        "effect": "allow",
        "ops": ["read"],
        "schema": "lead",
        "selector": {
          "filter": {
            "owner_ou_path": "starts_with:${requester.ou_path}"
          }
        }
      }
    ]
  },
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

### 4.5 BindingPolicy

```json
{
  "policy_id": "bind.company_email",
  "enabled": true,
  "priority": 10,
  "rules": [
    {
      "l": "and",
      "c": [
        { "a": "external.email", "v": "ends_with:@company.com" }
      ]
    }
  ],
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

### 4.6 Referral

```json
{
  "code": "INVITE-2026-001",
  "expires_at": 1767139200000,
  "used_at": 0,
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

Note: referral availability is derived from `used_at` and `expires_at`; the current model does not require a stored `status` field.

### 4.7 OUPolicyAttachment

```json
{
  "ou_id": "ou_team_android",
  "policy_id": "policy.sales_read",
  "enforced": false
}
```

## 5. Auth Config Snapshot API

### `GET /api/v1/auth/config`

Purpose: Retrieve the full control-plane auth configuration snapshot for admin bootstrap and inspection.

Implementation status: landed in the current branch.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "summary": {
      "users": 1,
      "roles": 2,
      "policies": 1,
      "binding_policies": 1,
      "referrals": 5,
      "principal_policies": 1,
      "ou_policies": 1,
      "warnings": 0
    },
    "users": [],
    "roles": [],
    "policies": [],
    "principal_policy_attachments": [],
    "ou_policy_attachments": [],
    "binding_policies": [],
    "referrals": [],
    "warnings": []
  }
}
```

Notes:

- The snapshot is policy-first. Unified `policy_profile.statements` are the canonical authorization model.
- Legacy `permission_profile`, `role_permission`, and logical `resource_grant` data remain internal compatibility concerns and are not exposed through public REST APIs.
- Migration from legacy authz records to unified policies is handled through the `/control-plane` action `migrate-authz-policy-model`.

Status codes: `200`, `401`, `403`, `500`

## 6. Auth Resource APIs

### 6.1 Users

Implementation status:

- `GET /api/v1/auth/users` and `GET /api/v1/auth/users/{user_id}` are landed in the current branch.
- user write routes remain approved-contract docs until implementation lands.

#### `GET /api/v1/auth/users`

Purpose: List bound internal users.

Supported query parameters:

- `q`
- `provider`
- `ou_id`
- `manager_user_id`

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "user_id": "user_alice",
      "provider": "google",
      "issuer": "https://accounts.google.com",
      "external_sub": "provider-subject",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "last_login_at": 1760000005000
    }
  ]
}
```

#### `GET /api/v1/auth/users/{user_id}`

Purpose: Retrieve one internal user.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "user": {
      "user_id": "user_alice",
      "provider": "google",
      "issuer": "https://accounts.google.com",
      "external_sub": "provider-subject",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "last_login_at": 1760000005000
    },
    "roles": [
      {
        "role_id": "role.employee",
        "name": "Employee",
        "description": "Default employee role",
        "parent_role_ids": [],
        "created_at": 1760000000000,
        "updated_at": 1760000000000
      }
    ]
  }
}
```

#### `PATCH /api/v1/auth/users/{user_id}`

Purpose: Update admin-managed user org fields.

Request body:

```json
{
  "primary_ou_id": "ou_team_android",
  "report_to_user_id": "user_manager_1"
}
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "primary_ou_id": "ou_team_android",
    "report_to_user_id": "user_manager_1"
  }
}
```

Notes:

- identity fields such as `provider`, `issuer`, and `external_sub` are not writable here

#### `PUT /api/v1/auth/users/{user_id}/roles/{role_id}`

Purpose: Attach a role to a user.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "role_id": "role.manager"
  }
}
```

#### `DELETE /api/v1/auth/users/{user_id}/roles/{role_id}`

Purpose: Detach a role from a user.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "role_id": "role.manager"
  }
}
```

Status codes for user routes: `200`, `400`, `401`, `403`, `404 user_not_found`, `409`, `500`

### 6.2 Roles

Implementation status:

- `GET /api/v1/auth/roles` and `GET /api/v1/auth/roles/{role_id}` are landed in the current branch.
- role write routes remain approved-contract docs until implementation lands.

#### `GET /api/v1/auth/roles`

Purpose: List role profiles.

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "role_id": "role.manager",
      "name": "Manager",
      "description": "People manager",
      "parent_role_ids": ["role.employee"],
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  ]
}
```

#### `POST /api/v1/auth/roles`

Purpose: Create a role profile.

Request body:

```json
{
  "role_id": "role.manager",
  "name": "Manager",
  "description": "People manager",
  "parent_role_ids": ["role.employee"]
}
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "role_id": "role.manager",
    "name": "Manager",
    "description": "People manager",
    "parent_role_ids": ["role.employee"]
  }
}
```

#### `GET /api/v1/auth/roles/{role_id}`

Purpose: Retrieve one role profile.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "role": {
      "role_id": "role.manager",
      "name": "Manager",
      "description": "People manager",
      "parent_role_ids": ["role.employee"],
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

#### `PATCH /api/v1/auth/roles/{role_id}`

Purpose: Update mutable role fields.

Request body:

```json
{
  "name": "Manager",
  "description": "People manager",
  "parent_role_ids": ["role.employee"]
}
```

#### `DELETE /api/v1/auth/roles/{role_id}`

Purpose: Delete one role profile.

Delete conflicts return `409 role_in_use`.

### 6.3 Policies And Policy Attachments

Implementation status:

- `GET /api/v1/auth/policies` and `GET /api/v1/auth/policies/{policy_id}` are landed in the current branch.
- policy write and attachment routes remain approved-contract docs until implementation lands.

#### `GET /api/v1/auth/policies`

Purpose: List policy profiles.

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "policy_id": "policy.sales_read",
      "name": "Sales Read Policy",
      "description": "Read access for sales records",
      "document": {
        "statements": [
          {
            "effect": "allow",
            "ops": ["read"],
            "schema": "lead"
          }
        ]
      },
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  ]
}
```

#### `POST /api/v1/auth/policies`

Purpose: Create a policy profile.

Request body:

```json
{
  "policy_id": "policy.sales_read",
  "name": "Sales Read Policy",
  "description": "Read access for sales records",
  "policy_document": {
    "statements": [
      {
        "effect": "allow",
        "ops": ["read"],
        "schema": "lead",
        "selector": {
          "filter": {
            "owner_ou_path": "starts_with:${requester.ou_path}"
          }
        },
        "condition": {
          "l": "and",
          "c": [
            { "a": "status", "v": "eq:open" }
          ]
        }
      },
      {
        "effect": "mask",
        "ops": ["read"],
        "schema": "lead",
        "outcome": {
          "scope": "column",
          "attrs": ["ssn"],
          "action": "mask"
        }
      }
    ]
  }
}
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "policy_id": "policy.sales_read",
    "name": "Sales Read Policy"
  }
}
```

Notes:

- `policy_document.statements` is the canonical authorization model.
- Each statement may include `effect`, `ops`, `schema`, `selector`, `condition`, and `outcome` as defined in `rfc/EN/aaa.md`.
- `selector` may include `resource_id`, `filter`, or both.
- OU policy attachment routes are documented in `API-specs-control-plane.en.md` because they are served under `/api/v1/org/...`.

#### `GET /api/v1/auth/policies/{policy_id}`

Purpose: Retrieve one policy profile.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "policy": {
      "policy_id": "policy.sales_read",
      "name": "Sales Read Policy",
      "description": "Read access for sales records",
      "document": {
        "statements": [
          {
            "effect": "allow",
            "ops": ["read"],
            "schema": "lead"
          }
        ]
      },
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

#### `PATCH /api/v1/auth/policies/{policy_id}`

Purpose: Update mutable policy fields.

#### `DELETE /api/v1/auth/policies/{policy_id}`

Purpose: Delete one policy profile.

Delete conflicts return `409 policy_in_use`.

#### `PUT /api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}`

Purpose: Attach a policy to a user or role principal.

Allowed `principal_type` values:

- `user`
- `role`

OUs are not valid principals.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "principal_type": "role",
    "principal_id": "role.sales",
    "policy_id": "policy.sales_read"
  }
}
```

#### `DELETE /api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}`

Purpose: Detach a policy from a user or role principal.

There is no first-class REST resource for `permission_profile` or logical `resource_grant` in the approved unified AAA contract.

- `resource_grant` may still exist as an internal physical projection of unified policies.
- Legacy permissions and grants remain internal compatibility data and are not exposed through public REST APIs.

### 6.4 Binding Policies

Implementation status: approved contract, not yet landed as a `/api/v1` route in the current branch.

#### `GET /api/v1/auth/binding-policies`

Purpose: List binding policies.

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "policy_id": "bind.company_email",
      "enabled": true,
      "priority": 10,
      "rules": [
        {
          "l": "and",
          "c": [
            { "a": "external.email", "v": "ends_with:@company.com" }
          ]
        }
      ]
    }
  ]
}
```

#### `POST /api/v1/auth/binding-policies`

Purpose: Create a binding policy.

Request body:

```json
{
  "policy_id": "bind.company_email",
  "enabled": true,
  "priority": 10,
  "rules": [
    {
      "l": "and",
      "c": [
        { "a": "external.email", "v": "ends_with:@company.com" }
      ]
    }
  ]
}
```

#### `PATCH /api/v1/auth/binding-policies/{policy_id}`

Purpose: Update a binding policy.

#### `DELETE /api/v1/auth/binding-policies/{policy_id}`

Purpose: Delete a binding policy.

### 6.5 Referrals

Implementation status: landed in the current branch.

#### `GET /api/v1/auth/referrals`

Purpose: List referral codes.

Supported query parameters:

- `status`
- `code`

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "code": "INVITE-2026-001",
      "project_id": "11111111-1111-4111-8111-111111111111",
      "status": "available"
    }
  ],
  "total": 1
}
```

#### `POST /api/v1/auth/referrals`

Purpose: Create a single referral code.

Request body:

```json
{
  "code": "INVITE-2026-001",
  "expires_at_ms": 1767139200000
}
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "status": "available"
  }
}
```

#### `POST /api/v1/auth/referrals?import=1`

Purpose: Import referral codes in batch.

Request body:

```json
[
  {
    "code": "INVITE-2026-001",
    "expires_at_ms": 1767139200000
  },
  {
    "code": "INVITE-2026-002",
    "expires_at_ms": 1767139200000
  }
]
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "created": 2,
    "failed": 0
  }
}
```

#### `PATCH /api/v1/auth/referrals/{code}`

Purpose: Update a referral code, typically its expiration.

Request body:

```json
{
  "expires_at_ms": 1767139200000
}
```

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "status": "available"
  }
}
```

#### `POST /api/v1/auth/referrals/{code}/disable`

Purpose: Disable a referral code.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "status": "disabled"
  }
}
```

#### `DELETE /api/v1/auth/referrals/{code}`

Purpose: Delete a referral code when allowed.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "status": "deleted"
  }
}
```

Referral route status codes: `200`, `201`, `400`, `401`, `403`, `404 referral_not_found`, `409 referral_in_use|referral_exists`, `500`
