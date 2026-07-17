# LTBase API Specification: Auth Service

This document describes the implemented admin REST API contract under `/api/v1/auth/...` for a dedicated control-plane gateway/domain.

- Code baseline:
  - `ltbase.api/cmd/controlplane`
  - `ltbase.api/internal/routemanifest/controlplane.go` (authoritative route table)
  - `rfc/EN/aaa.md`
- Document language: English
- Updated on: 2026-07-16

## 1. Overview

The control-plane admin REST surface is split into route families:

- `/api/v1/auth/...` for AAA configuration and referral administration
- `/api/v1/org/...` for org-chart and OU administration
- operational and catalog routes (status, repair, catalogs, etc.)

This document covers the `/api/v1/auth/...` routes:

- auth configuration snapshot retrieval for bootstrap and inspection
- AAA configuration management for users, roles, unified policies, principal policy attachments, binding policies, and referrals
- policy-first authorization modeling aligned with `rfc/EN/aaa.md`

For `/api/v1/org/...` routes, the operational routes, and the `/control-plane` operational actions, see `API-specs-control-plane.en.md`.

How routes are served:

- Every route is mounted under both the `/api/v1/...` and `/api/control-plane/v1/...` prefixes, with identical behavior.
- The referral routes are dual-mounted: `/auth/referrals...` and top-level `/referrals...` are two aliases of the same handler.
- `GET /api/v1/auth-config` is a legacy alias of `GET /api/v1/auth/config`.

Namespace ownership note: the `/api/v1/auth/*` namespace is shared by two services. `cmd/authservice` is a separate end-user token service that serves `health`, `refresh`, `revoke`, `profile/{user_id}`, plus the `login/{provider}` and `id_bindings/{provider}` identity routes (see `internal/authservice/routes.go`). This document describes the admin surface served by the control plane; the two route sets do not overlap.

## 2. Authentication, Scope, and Shared Conventions

### 2.1 Admin Authentication

The control-plane admin REST API uses Bearer JWT authentication, with authorization based on an **admin policy binding** (`api_authorizer.go`):

- A request with no JWT claims returns `401 unauthorized`.
- Access is granted when the caller (the user resolved from the JWT subject) holds — via `principal_policy_attachment`, directly or indirectly through a role — the policy whose **slug is `admin.controlplane`**.
- When no policy in the project carries that slug yet (e.g. a deployment that predates slug backfill), the authorizer falls back to the legacy policy id `generated#permission#controlplane.admin` (emitted by the legacy migration).
- The check does not inspect role slugs and does not inspect the policy document's contents — it is a single binding-based grant.

Unauthenticated requests return:

```json
{
  "request_id": "req_123",
  "code": "unauthorized",
  "message": "admin authentication required"
}
```

Authenticated requests without the admin policy return:

```json
{
  "request_id": "req_123",
  "code": "forbidden",
  "message": "admin policy required"
}
```

All `/api/v1/auth/...` routes (any method) require admin. Unknown routes 404 only after authorization.

**The one exception: CORS preflight.** Any `OPTIONS` request returns `204 No Content` **before** authorization and route matching (CORS headers only, no body — and therefore no `request_id` envelope). Preflight is not a normal API response and is exempt from this section's authorization rules and the §2.3 envelope conventions.

### 2.2 Project Scope

LTBase currently supports single-project private deployment for the control plane.

Therefore:

- every admin REST request implicitly targets the deployment project from server environment configuration (the server ignores the request and uses the deployment project)
- clients must not provide `project_id` in the path, query, headers, or request body
- the server may return `project_id` as read-only metadata in responses

### 2.3 Success and Error Envelopes

Every response carries a top-level `request_id`.

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

Conventions:

- Only `GET /api/v1/auth/referrals` returns `total`; every other collection endpoint returns just `items`.
- The inner key inside single-resource `data` is not uniform: users use `data.user` (single-user GET adds `data.roles`), roles use `data.role`, policies use `data.policy`, binding policies use `data.binding_policy`, referrals use a bare `data` object; delete/attach/detach operations return a small object with a `status` field. Each section below documents the actual shape.

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
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `405 Method Not Allowed` (`code: method_not_allowed`)
- `409 Conflict`
- `500 Internal Server Error`

## 3. Route Summary

All routes below are implemented and registered in the current code.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/auth/config` | Retrieve the control-plane auth snapshot (legacy alias: `/api/v1/auth-config`) |
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
| GET | `/api/v1/auth/principals/{principal_type}/{principal_id}/policies` | List policies attached to a principal |
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

The referral routes also exist under the top-level alias `/api/v1/referrals...` (same handler).

## 4. Common Data Structures

`policy_id`, `role_id`, and binding `policy_id` are server-generated UUIDv7
durable identifiers; `slug` and `external_key` are the human-readable /
caller-correlation keys. Per the semantic-key contract a caller may reference
an entity by its `slug` in request path-params (case-insensitive; it resolves
to the durable id). Slug resolution applies to role, policy, and binding-policy
path params; `user_id` matches only by exact value. `ou_id` and `user_id` are
caller/identity-supplied, not server-generated.

Identifier canonicalization boundary: **stored records and full resource-object
responses** (`data.user` / `data.role` / `data.policy` / `data.binding_policy`
and collection items) always carry the UUIDv7. However, the small `status`
objects returned by attach / detach / delete **echo the identifier exactly as
supplied in the path** — when the caller passes a slug, the `role_id` /
`policy_id` / `principal_id` in the response is that slug, not the canonical
UUID (this applies to user-role attach/detach, principal-policy attach/detach,
and role/policy/binding-policy delete). When the durable id is needed, rely on
resource-object responses or the GET endpoints.

### 4.1 ControlPlaneUser (public DTO)

The user object shape returned by the user list/get and org routes (`apiPublicAuthUser`):

```json
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
```

Notes:

- The public DTO does **not** include `referral_code`; only the user objects inside the `GET /api/v1/auth/config` snapshot carry `referral_code` (see §5).
- `primary_ou_id` and `report_to_user_id` belong to the org-management contract and may be surfaced by user or org resource endpoints.

### 4.2 Role

```json
{
  "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
  "name": "Manager",
  "description": "People manager",
  "slug": "role.manager",
  "external_key": "role-manager-v1",
  "parent_role_ids": ["0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07"],
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

`slug` and `external_key` are server-derived/maintained; create and update requests do not accept these fields.

### 4.3 PrincipalPolicyAttachment

```json
{
  "principal_type": "role",
  "principal_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd06",
  "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03"
}
```

### 4.4 Policy

```json
{
  "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
  "name": "Sales Read Policy",
  "description": "Read access for sales records",
  "slug": "policy.sales_read",
  "external_key": "policy-sales-read-v1",
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
  "policy_id": "0192e0a1-9e5f-7d2c-9f30-cc03dd04ee08",
  "enabled": true,
  "priority": 10,
  "slug": "bind.company_email",
  "external_key": "bind-company-email-v1",
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

### 4.6 Referral (full record)

The full record shape returned by the referral list / PATCH / disable responses (`ReferralRecord`):

```json
{
  "code": "INVITE-2026-001",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
  "used_at": 0,
  "expires_at": 1767139200000,
  "disabled": false,
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "status": "available"
}
```

Notes:

- `policy_id` is optional (bound at import/create time).
- `status` is a derived field, evaluated in order: `disabled == true` → `"disabled"`; `used_at > 0` → `"used"`; `expires_at > 0` and past → `"expired"`; otherwise → `"available"`.

## 5. Auth Config Snapshot API

### `GET /api/v1/auth/config`

Purpose: Retrieve the full control-plane auth configuration snapshot for admin bootstrap and inspection.

Legacy alias: `GET /api/v1/auth-config` (same handler). GET-only; other methods return `405`.

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
      "principal_policies": 1,
      "ou_policies": 1,
      "referrals": 5,
      "warnings": 0
    },
    "users": [],
    "org_units": [],
    "roles": [],
    "policies": [],
    "binding_policies": [],
    "principal_policy_attachments": [],
    "ou_policy_attachments": [],
    "referrals": [],
    "warnings": [],
    "authorization_model": {
      "canonical_object": "policy",
      "canonical_principal_relationship": "principal_policy_attachment",
      "canonical_org_relationship": "ou_policy_attachment",
      "permission_status": "legacy_compatibility",
      "legacy_data_location": "internal_or_migration_output_only",
      "policy_depends_on_permission": false
    }
  }
}
```

Snapshot field notes:

- `users[]` items use a snapshot-specific user shape that **includes** `referral_code` (the public user DTO does not).
- `org_units[]` items are OrgUnit objects (see `API-specs-control-plane.en.md` §4.2).
- `ou_policy_attachments[]` items contain only `{ "ou_id", "policy_id" }` (no `enforced`, no timestamps).
- `referrals[]` items use a snapshot-specific shape `{ "code", "policy_id?", "used_at", "expires_at", "created_at", "updated_at" }` (no `project_id`, `disabled`, or `status`).
- `warnings[]` items are `{ "code", "message" }`.
- `authorization_model` is a fixed-value object declaring the canonical authorization model (see `rfc/EN/policy-permission-relationship.md`).

Other notes:

- The snapshot is policy-first. Unified `policy_profile.statements` are the canonical authorization model.
- Legacy `permission_profile`, `role_permission`, and logical `resource_grant` data remain internal compatibility concerns and are not exposed through public REST APIs.
- Migration from legacy authz records to unified policies is handled through the `/control-plane` action `migrate-authz-policy-model`.

Status codes: `200`, `401`, `403`, `500 list_auth_config_failed`

## 6. Auth Resource APIs

### 6.1 Users

Implementation status: fully landed (including write routes).

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

Purpose: Retrieve one internal user together with the roles attached to them.

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
        "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07",
        "name": "Employee",
        "description": "Default employee role",
        "slug": "role.employee",
        "external_key": "role-employee-v1",
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

Response: returns the full updated user object (`data.user`):

```json
{
  "request_id": "req_123",
  "data": {
    "user": {
      "user_id": "user_alice",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "last_login_at": 1760000005000
    }
  }
}
```

Notes:

- identity fields such as `provider`, `issuer`, and `external_sub` are not writable here
- unknown user or target OU → `404 not_found`; a reporting cycle → `409 invalid_org_cycle`

#### `PUT /api/v1/auth/users/{user_id}/roles/{role_id}`

Purpose: Attach a role to a user. `{role_id}` may be a durable id or a slug. No request body.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "user_id": "user_alice",
    "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
    "status": "attached"
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
    "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
    "status": "detached"
  }
}
```

Status codes for user routes: `200`, `400 invalid_body`, `401`, `403`, `404 not_found` (unknown user/role/OU), `409 invalid_org_cycle`, `500`

### 6.2 Roles

Implementation status: fully landed (including write routes).

#### `GET /api/v1/auth/roles`

Purpose: List role profiles.

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
      "name": "Manager",
      "description": "People manager",
      "slug": "role.manager",
      "external_key": "role-manager-v1",
      "parent_role_ids": ["0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07"],
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  ]
}
```

#### `POST /api/v1/auth/roles`

Purpose: Create a role profile.

Request body (only these fields are accepted; `slug`/`external_key` are server-derived):

```json
{
  "name": "Manager",
  "description": "People manager",
  "parent_role_ids": ["role.employee"]
}
```

Response (`201 Created`): returns the full role object (`data.role`):

```json
{
  "request_id": "req_123",
  "data": {
    "role": {
      "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
      "name": "Manager",
      "description": "People manager",
      "slug": "role.manager",
      "parent_role_ids": ["0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07"],
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

#### `GET /api/v1/auth/roles/{role_id}`

Purpose: Retrieve one role profile. `{role_id}` may be a durable id or a slug.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "role": {
      "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
      "name": "Manager",
      "description": "People manager",
      "slug": "role.manager",
      "external_key": "role-manager-v1",
      "parent_role_ids": ["0192e0a1-8d4e-7c2b-9f20-bb02cc03dd07"],
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

Response: `200`, same shape as GET (`data.role`). Unknown role → `404 not_found`.

#### `DELETE /api/v1/auth/roles/{role_id}`

Purpose: Delete one role profile.

Response (`200`):

```json
{
  "request_id": "req_123",
  "data": {
    "role_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd05",
    "status": "deleted"
  }
}
```

Delete conflicts return `409 role_in_use`; unknown role returns `404 not_found`.

### 6.3 Policies And Policy Attachments

Implementation status: fully landed (reads, writes, attach/detach, principal policy listing).

#### `GET /api/v1/auth/policies`

Purpose: List policy profiles.

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "name": "Sales Read Policy",
      "description": "Read access for sales records",
      "slug": "policy.sales_read",
      "external_key": "policy-sales-read-v1",
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

Request body (only these fields are accepted):

```json
{
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

Response (`201 Created`): returns the full policy object (`data.policy`, with the server-generated `policy_id`, the derived `slug`, and timestamps):

```json
{
  "request_id": "req_123",
  "data": {
    "policy": {
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "name": "Sales Read Policy",
      "description": "Read access for sales records",
      "slug": "policy.sales_read",
      "document": { "statements": [] },
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

Notes:

- `policy_document.statements` is the canonical authorization model.
- Each statement may include `effect`, `ops`, `schema`, `selector`, `condition`, and `outcome` as defined in `rfc/EN/aaa.md`.
- `selector` may include `resource_id`, `filter`, or both.
- The server validates `policy_document` only as well-formed JSON (then compacts it for storage); it does **not** validate the internal structure. The structural contract is defined by `rfc/EN/aaa.md` §6.
- OU policy attachment routes are documented in `API-specs-control-plane.en.md` because they are served under `/api/v1/org/...`.

#### `GET /api/v1/auth/policies/{policy_id}`

Purpose: Retrieve one policy profile. `{policy_id}` may be a durable id or a slug.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "policy": {
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "name": "Sales Read Policy",
      "description": "Read access for sales records",
      "slug": "policy.sales_read",
      "external_key": "policy-sales-read-v1",
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

Request body: `{ "name", "description", "policy_document" }` (same field set as POST).

Response: `200`, same shape as GET (`data.policy`). Unknown policy → `404 not_found`.

#### `DELETE /api/v1/auth/policies/{policy_id}`

Purpose: Delete one policy profile.

Response (`200`):

```json
{
  "request_id": "req_123",
  "data": {
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "status": "deleted"
  }
}
```

Delete conflicts return `409 policy_in_use`; unknown policy returns `404 not_found`.

#### `GET /api/v1/auth/principals/{principal_type}/{principal_id}/policies`

Purpose: List the policies attached to a principal (user or role), with the full policy object inlined.

Response (no `total`):

```json
{
  "request_id": "req_123",
  "items": [
    {
      "principal_type": "role",
      "principal_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd06",
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "policy": {
        "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
        "name": "Sales Read Policy",
        "slug": "policy.sales_read",
        "document": { "statements": [] },
        "created_at": 1760000000000,
        "updated_at": 1760000000000
      }
    }
  ]
}
```

Unknown user/role or an invalid `principal_type` → `404 not_found`.

#### `PUT /api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}`

Purpose: Attach a policy to a user or role principal. `{principal_id}` (for roles) and `{policy_id}` may each be a durable id or a slug. No request body.

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
    "principal_id": "0192e0a1-8d4e-7c2b-9f20-bb02cc03dd06",
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "status": "attached"
  }
}
```

#### `DELETE /api/v1/auth/principals/{principal_type}/{principal_id}/policies/{policy_id}`

Purpose: Detach a policy from a user or role principal.

Response: same shape as PUT, with `status` set to `"detached"`.

Unknown user/role/policy → `404 not_found`.

There is no first-class REST resource for `permission_profile` or logical `resource_grant` in the unified AAA contract.

- `resource_grant` may still exist as an internal physical projection of unified policies.
- Legacy permissions and grants remain internal compatibility data and are not exposed through public REST APIs.

### 6.4 Binding Policies

Implementation status: landed.

#### `GET /api/v1/auth/binding-policies`

Purpose: List binding policies.

Response (the list DTO includes timestamps):

```json
{
  "request_id": "req_123",
  "items": [
    {
      "policy_id": "0192e0a1-9e5f-7d2c-9f30-cc03dd04ee08",
      "enabled": true,
      "priority": 10,
      "slug": "bind.company_email",
      "external_key": "bind-company-email-v1",
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
  ]
}
```

#### `POST /api/v1/auth/binding-policies`

Purpose: Create a binding policy.

Request body:

```json
{
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

Response (`201 Created`): nested under `data.binding_policy`; note that unlike the GET list DTO it does **not** include timestamps (a known implementation difference, documented as-is):

```json
{
  "request_id": "req_123",
  "data": {
    "binding_policy": {
      "policy_id": "0192e0a1-9e5f-7d2c-9f30-cc03dd04ee08",
      "slug": "bind.company_email",
      "external_key": "bind-company-email-v1",
      "enabled": true,
      "priority": 10,
      "rules": []
    }
  }
}
```

#### `PATCH /api/v1/auth/binding-policies/{policy_id}`

Purpose: Update a binding policy. `{policy_id}` may be a durable id or a slug.

Request body is the same as POST; the response is `200` with the same shape as the POST response (`data.binding_policy`, no timestamps). Unknown policy → `404 not_found`.

#### `DELETE /api/v1/auth/binding-policies/{policy_id}`

Purpose: Delete a binding policy.

Response (`200`):

```json
{
  "request_id": "req_123",
  "data": {
    "policy_id": "0192e0a1-9e5f-7d2c-9f30-cc03dd04ee08",
    "status": "deleted"
  }
}
```

### 6.5 Referrals

Implementation status: landed. Dual-mounted: the routes below have equivalent aliases under `/api/v1/referrals...`.

#### `GET /api/v1/auth/referrals`

Purpose: List referral codes.

Supported query parameters:

- `status`
- `code`

Response (the only collection endpoint that returns `total`; items are full ReferralRecord objects, see §4.6):

```json
{
  "request_id": "req_123",
  "items": [
    {
      "code": "INVITE-2026-001",
      "project_id": "11111111-1111-4111-8111-111111111111",
      "used_at": 0,
      "expires_at": 1767139200000,
      "disabled": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "status": "available"
    }
  ],
  "total": 1
}
```

#### `POST /api/v1/auth/referrals`

Purpose: Create a single referral code.

Request body (`policy_id` is optional and may be a durable id or a slug):

```json
{
  "code": "INVITE-2026-001",
  "policy_id": "policy.lead.read",
  "expires_at_ms": 1767139200000
}
```

Response (`201 Created`): returns a lean creation result (no `status` field):

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "created_at": 1760000000000
  }
}
```

Error codes: `400 missing_code` (empty code), `400 code_too_long` (over 256 characters), `400 policy_not_found` (referenced policy does not exist), `409 referral_exists` (code already exists).

#### `POST /api/v1/auth/referrals?import=1`

Purpose: Import referral codes in batch. Any non-empty `import` query value triggers the batch mode.

The request body is a JSON array; item fields are `referral_code` (required), `policy_id` (optional), `expires_at_ms` (optional, int or numeric string), and `project_id` (optional and **ignored** — the REST path always forces the deployment project; any value supplied per item is neither validated nor used. This differs from the `/control-plane` action batch mode, which requires an item `project_id` to match the top-level one):

```json
[
  {
    "referral_code": "INVITE-2026-001",
    "policy_id": "policy.lead.read",
    "expires_at_ms": 1767139200000
  },
  {
    "referral_code": "INVITE-2026-002"
  }
]
```

Response (`201 Created`):

```json
{
  "request_id": "req_123",
  "data": {
    "total": 2,
    "imported": 1,
    "skipped_existing": 1
  }
}
```

Behavior: existing codes are skipped (counted in `skipped_existing`), not errored. Error codes: `400 invalid_body` (body is not valid JSON), `400 invalid_referral_import` (item validation failure, e.g. empty array), `400 policy_not_found`, `500 import_referrals_failed`.

#### `PATCH /api/v1/auth/referrals/{code}`

Purpose: Update a referral code's expiration. **Only** `expires_at_ms` is accepted; any other body field, including `policy_id`, is silently ignored.

Request body:

```json
{
  "expires_at_ms": 1767139200000
}
```

Response: returns the full ReferralRecord (see §4.6):

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "used_at": 0,
    "expires_at": 1767139200000,
    "disabled": false,
    "created_at": 1760000000000,
    "updated_at": 1760000010000,
    "status": "available"
  }
}
```

A negative `expires_at_ms` → `400 invalid_expiration`; unknown code → `404 referral_not_found`.

#### `POST /api/v1/auth/referrals/{code}/disable`

Purpose: Disable a referral code. POST-only (other methods return `405`).

Response: returns the full ReferralRecord with `disabled` set to `true` and `status` set to `"disabled"`:

```json
{
  "request_id": "req_123",
  "data": {
    "code": "INVITE-2026-001",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "used_at": 0,
    "expires_at": 1767139200000,
    "disabled": true,
    "created_at": 1760000000000,
    "updated_at": 1760000020000,
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

A used code cannot be deleted and returns `409 referral_in_use`.

Referral route status codes: `200`, `201`, `400 missing_code|code_too_long|policy_not_found|invalid_expiration|invalid_body|invalid_referral_import`, `401`, `403`, `404 referral_not_found`, `409 referral_exists|referral_in_use`, `500`
