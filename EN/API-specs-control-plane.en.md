# LTBase API Specification: Control Plane

This document describes the implemented control-plane admin REST API contract for `/api/v1/org/...` and the operational route families (status, repair, catalogs, compliance-profile, etc.), together with the separate `/control-plane` operational action API.

- Code baseline:
  - `ltbase.api/cmd/controlplane`
  - `ltbase.api/internal/routemanifest/controlplane.go` (authoritative route table)
  - `rfc/EN/aaa.md`
- Document language: English
- Updated on: 2026-07-16

## 1. Overview

The control-plane admin REST surface is split into route families:

- `/api/v1/auth/...` for AAA configuration and referral administration (see `API-specs-control-plane-service-auth-routes.en.md`)
- `/api/v1/org/...` for org-chart and OU administration
- operational and catalog routes: `/status`, `/schema/status`, `/repair/*`, `/catalogs/*`, `/compliance-profile`, `/workflows`

This document covers the `/api/v1/org/...` routes, the operational/catalog routes, and the distinction between the admin REST API and the operational `/control-plane` action API.

How routes are served:

- Every REST route is mounted under **two prefixes**: `/api/v1/...` and `/api/control-plane/v1/...` (`routemanifest.ControlPlanePrefixes`). Both prefixes behave identically.
- The route table (`ControlPlaneRouteSuffixes` in `internal/routemanifest/controlplane.go`) is a load-bearing allowlist: any request whose `METHOD /path` does not match a table entry returns `404` — after authorization.

Namespace ownership note: the `/api/v1/auth/*` namespace is shared by two services. `cmd/authservice` is a separate end-user token service that serves `health`, `refresh`, `revoke`, `profile/{user_id}`, plus the `login/{provider}` and `id_bindings/{provider}` identity routes (see `internal/authservice/routes.go`); the control plane serves the admin surface described in this document and `API-specs-control-plane-service-auth-routes.en.md`. The two route sets do not overlap.

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

**Relaxed authorization for org reads**: `GET /api/v1/org/...` (including `/org/charts`) uses a looser org-read authorizer: either an admin **or** any referral-bound user (a bound user with a non-empty `referral_code`) may read. All other callers receive:

```json
{
  "request_id": "req_123",
  "code": "forbidden",
  "message": "referral-bound user required"
}
```

All org writes (POST/PATCH/PUT/DELETE) still require admin. Unknown routes 404 **after** authorization, so the route table cannot be probed with unauthorized requests.

**The one exception: CORS preflight.** Any `OPTIONS` request returns `204 No Content` **before** authorization and route matching (CORS headers only, no body — and therefore no `request_id` envelope). Preflight is not a normal API response and is exempt from this section's authorization rules and the §2.3 envelope conventions.

### 2.2 Project Scope

LTBase currently supports single-project private deployment for the control plane.

Therefore:

- every control-plane admin REST request implicitly targets the deployment project from server environment configuration (the server ignores the request and uses the deployment project)
- clients must not provide `project_id` in the path, query, headers, or request body (exception: the `/repair/*` body may carry an explicit `project_id`, which must parse as a valid UUID; it should normally be omitted so the deployment project is used)
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

- Across the whole REST surface, only `GET /api/v1/auth/referrals` returns `total`; the org and operational collection responses contain only `items`.
- The inner key inside single-resource `data` is not uniform: org-unit resources use `data.org_unit`, user resources use `data.user`, OU-policy attachments use `data.attachment`, and delete/detach operations return a small object with a `status` field. Each section below documents the actual shape.
- The catalogs and compliance-profile routes are an exception: the response top level is `{"request_id", "project_id", "data"}` where `data` is the raw catalog JSON (see §7).

Error shape:

```json
{
  "request_id": "req_123",
  "code": "invalid_body",
  "message": "invalid request body"
}
```

Optional field-level or validation diagnostics may be returned as `details` (e.g. `details.field = "data"` on catalogs PUT validation failures).

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

### 3.1 Admin REST Routes

All routes below are implemented and registered in the current code (each is mounted under both the `/api/v1` and `/api/control-plane/v1` prefixes).

Org routes:

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

Operational and catalog routes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/status` | Deployment project status summary |
| GET | `/api/v1/schema/status` | Applied vs. published schema versions |
| POST | `/api/v1/repair/dry-run` | Repair preview (no writes) |
| POST | `/api/v1/repair/apply` | Execute repair (requires `confirm: true`) |
| GET / PUT | `/api/v1/catalogs/capabilities` | Read / write the capability catalog |
| GET / PUT | `/api/v1/catalogs/action-templates` | Read / write the action template catalog |
| GET / PUT | `/api/v1/catalogs/assistant-roles` | Read / write the assistant role catalog |
| GET / PUT | `/api/v1/compliance-profile` | Read / write the compliance profile |
| GET | `/api/v1/workflows` | List workflow definitions (dev-only, see §7.5) |

### 3.2 `/control-plane` Actions

The following are provided as operational actions through `POST /control-plane` (or direct Lambda invoke). Complete list (`main.go` dispatch):

- `ensure-project`
- `repair-project`
- `update-schema`
- `create-iam-authz-records`
- `list-project-auth-config`
- `migrate-authz-policy-model`
- `migrate-authz-resource-identity`
- `put-project-capability-catalog` / `get-project-capability-catalog`
- `put-project-compliance-profile` / `get-project-compliance-profile`
- `put-project-action-template-catalog` / `get-project-action-template-catalog`
- `put-project-assistant-role-catalog` / `get-project-assistant-role-catalog`
- `import-referrals`

### 3.3 REST ↔ Action Mapping Summary

| REST API | `/control-plane` action | CLI (`cmd/tools`) |
|---|---|---|
| `POST /api/v1/auth/policies` | `create-iam-authz-records` (*) | **none** |
| `POST /api/v1/auth/referrals?import=1` | `import-referrals` | **none** |
| `GET /api/v1/auth/policies` | `list-project-auth-config` | **none** |
| `POST /api/v1/repair/dry-run` / `POST /api/v1/repair/apply` | `repair-project` | `repair-project` |
| `GET/PUT /api/v1/catalogs/capabilities` | `get/put-project-capability-catalog` | **none** |
| `GET/PUT /api/v1/catalogs/action-templates` | `get/put-project-action-template-catalog` | **none** |
| `GET/PUT /api/v1/catalogs/assistant-roles` | `get/put-project-assistant-role-catalog` | **none** |
| `GET/PUT /api/v1/compliance-profile` | `get/put-project-compliance-profile` | **none** |

Notes:

- (*) `create-iam-authz-records` is a lower-level batch seed action. The REST `POST /api/v1/auth/policies` auto-generates a durable `policy_id`; `create-iam-authz-records` requires the caller to supply `policy_id` explicitly. The action is suitable for seeding, migration, and operational bulk writes, while the REST endpoint is the productized admin contract.
- The `cmd/tools` CLI currently exposes only `ensure-project`, `repair-project`, and `update-schema`. It does **not** expose a policy or referral management subcommand. Use the Control Plane Lambda action API or the HTTP REST API for those workflows.
- `list-project-auth-config` returns the full project auth snapshot (users, roles, policies, binding policies, referrals, attachments, and warnings), which is broader than `GET /api/v1/auth/policies`.
- `ensure-project`, `update-schema`, and `migrate-authz-*` have no REST equivalents and remain action-only.

### 3.4 Built-in Resources

The control plane manages a fixed set of **built-in resources**. These are administered through their own REST endpoints and `/control-plane` actions — they are **not** authz policy `schema` targets, and you do not grant access to them by writing policy statements (e.g. there is no `schema: "users"` or `schema: "org_units"` statement). Control-plane-wide admin is a single binding-based grant: the `admin.controlplane` policy attached to a principal (see §8.2).

Each concept is named consistently per layer (the same resource may appear with a different spelling in a REST route vs. a JSON field vs. an action `kind`):

| Resource | JSON (`list-project-auth-config`) | REST route | Action `kind` |
|---|---|---|---|
| Users | `users` (item: `user`) | `/api/v1/auth/users` | — (identity-managed) |
| Roles | `roles` (item: `role`) | `/api/v1/auth/roles` | `role_profile` |
| Policies | `policies` (item: `policy`) | `/api/v1/auth/policies` | `policy_profile` |
| Binding policies | `binding_policies` | `/api/v1/auth/binding-policies` | — |
| Org chart / org units | `org_units` (OU; ids `ou_id` / `parent_ou_id` / `ou_path`) | `/api/v1/org/units` (read-only view: `/api/v1/org/charts`) | — |
| OU-policy attachments | `ou_policy_attachments` | `/api/v1/org/units/{ou_id}/policies` | — |
| Principal-policy attachments | `principal_policy_attachments` | `/api/v1/auth/principals/{type}/{id}/policies` | `principal_policy_attachment` |
| User-role attachments | (surfaced under users) | `/api/v1/auth/users/{user_id}/roles/{role_id}` | `user_role_attachment` |
| Referrals | `referrals` | `/api/v1/auth/referrals` | (via `import-referrals`) |

Notes:

- **"Org chart" is a concept word, not a resource name.** The data model is **org units** (`org_units` / OU). The hierarchy is encoded with `parent_ou_id` and a materialized `ou_path`; `/api/v1/org/charts` is only a read-only rendering of that tree. See `aaa.md` §5.7.
- Org units and OU-policy attachments are managed only via the `/api/v1/org/...` REST endpoints; there is no `create-iam-authz-records` `kind` for them.

## 4. Common Data Structures

In stored records and responses, `policy_id` and `role_id` are the server-generated
UUIDv7 durable identifiers (defined by the auth service); the readable `slug` is a
convenience key that callers may use to reference an entity in requests. `ou_id`
and `user_id` are caller/identity-supplied. The caller-supplied `policy_id`/`role_id`
in `create-iam-authz-records` action payloads (§8.2) are the exception — that action
requires the caller to provide the durable id explicitly.

### 4.1 ControlPlaneUser (public DTO)

The user object shape returned by the org and auth REST routes (`apiPublicAuthUser`):

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

Note: the public DTO does **not** include `referral_code`; only the user objects inside the `GET /api/v1/auth/config` snapshot carry `referral_code` (the snapshot-specific shape is documented in `API-specs-control-plane-service-auth-routes.en.md` §5).

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

The full shape returned by `GET /api/v1/org/units/{ou_id}/policies` (with a nested policy object):

```json
{
  "ou_id": "ou_team_android",
  "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
  "enforced": false,
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "policy": {
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "name": "Sales Read Policy",
    "slug": "policy.sales_read",
    "document": { "statements": [] },
    "created_at": 1760000000000,
    "updated_at": 1760000000000
  }
}
```

The variant used in org-chart responses and PUT attach responses omits the nested `policy` and contains only `ou_id`, `policy_id`, `enforced`, `created_at`, `updated_at`.

### 4.4 Manager Relationship

Manager relationships are no longer returned as flat fields; the response carries a pair of full user objects:

```json
{
  "user": { "user_id": "user_alice", "report_to_user_id": "user_manager_1" },
  "manager": { "user_id": "user_manager_1" }
}
```

(`user` / `manager` are both full ControlPlaneUser objects; remaining fields elided in the example.)

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

- `policy_attachments` is the org-chart read-model field name; items look like `{ "ou_id": "...", "policy_id": "...", "enforced": false, "created_at": ..., "updated_at": ... }` (no nested policy).
- This differs intentionally from the auth-config snapshot field `ou_policy_attachments`, because the org-chart response is a UI-oriented aggregate read model rather than a direct snapshot dump.

## 5. Org Chart Semantics And Invariants

The org chart model follows two independent relationships:

- OU containment through `primary_ou_id` and `parent_ou_id`
- manager relationship through `report_to_user_id`

V1 rules:

- OU containment forms a tree
- `ou_path` is server-managed and read-only to clients (create/update requests do not accept `ou_path`)
- moving an OU must recompute subtree paths safely
- an OU cannot be moved into its own descendant subtree
- a user cannot directly or transitively report to themselves
- dotted-line or matrix reporting is out of scope for V1
- OUs are not principals for principal policy attachments
- OU-wide authorization flows through OU policy attachments
- `block_inheritance` and `enforced` are accepted and stored for forward compatibility, but V1 runtime evaluation still behaves as simple ancestor-union inheritance

## 6. Org Chart APIs

Implementation status: all routes are landed in the current code (`cmd/controlplane/api_org.go`).

Error code conventions (shared by the org routes):

- `404 not_found`: OU, user, or policy does not exist
- `409 invalid_org_cycle`: an OU move or reporting change would create a cycle
- `409 ou_not_empty`: deleting an OU that still has child OUs or users
- `400 invalid_body`: body parse failure or other write validation failure
- `405 method_not_allowed`: path exists but method is not supported
- read-path store failures return `500` with codes such as `list_org_units_failed`, `get_org_unit_failed`

### 6.1 Org Units

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

Response (`201 Created`):

```json
{
  "request_id": "req_123",
  "data": {
    "org_unit": {
      "ou_id": "ou_team_android",
      "name": "Team Android",
      "parent_ou_id": "ou_mobiledev",
      "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
      "block_inheritance": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

Notes:

- clients must not send `ou_path`; it is server-managed
- the single-resource response nests under `data.org_unit`

#### `GET /api/v1/org/units/{ou_id}`

Purpose: Retrieve one org unit.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "org_unit": {
      "ou_id": "ou_team_android",
      "name": "Team Android",
      "parent_ou_id": "ou_mobiledev",
      "ou_path": "/ou_rnd/ou_mobiledev/ou_team_android",
      "block_inheritance": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
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

Response: `200`, same shape as GET (`data.org_unit`).

Moves that would create a containment cycle are rejected with `409 invalid_org_cycle`.

#### `DELETE /api/v1/org/units/{ou_id}`

Purpose: Delete an org unit only when it has no child OUs and no assigned users.

Response (`200`):

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "status": "deleted"
  }
}
```

Conflict responses return `409 ou_not_empty`.

### 6.2 Org Unit Users And Policies

#### `GET /api/v1/org/units/{ou_id}/users`

Purpose: List users assigned to an org unit.

Supported query parameters:

- `include_subtree=true`

Response: `items` is an array of full ControlPlaneUser objects (see §4.1, with `provider`, timestamps, etc.):

```json
{
  "request_id": "req_123",
  "items": [
    {
      "user_id": "user_alice",
      "provider": "google",
      "primary_ou_id": "ou_team_android",
      "report_to_user_id": "user_manager_1",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "last_login_at": 1760000005000
    }
  ]
}
```

#### `PUT /api/v1/org/units/{ou_id}/users/{user_id}`

Purpose: Move a user into an org unit. No request body.

Response:

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

This route is a convenience form of updating the user resource directly; it returns the full user object (`data.user`).

#### `GET /api/v1/org/units/{ou_id}/policies`

Purpose: List policies attached to an org unit.

Response: `items` are full OUPolicyAttachment objects (see §4.3, with timestamps and a nested `policy` object):

```json
{
  "request_id": "req_123",
  "items": [
    {
      "ou_id": "ou_team_android",
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "enforced": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "policy": {
        "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
        "name": "Sales Read Policy",
        "document": { "statements": [] },
        "created_at": 1760000000000,
        "updated_at": 1760000000000
      }
    }
  ]
}
```

#### `PUT /api/v1/org/units/{ou_id}/policies/{policy_id}`

Purpose: Attach a policy to an org unit. `{policy_id}` may be a durable id or a slug.

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
    "attachment": {
      "ou_id": "ou_team_android",
      "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
      "enforced": false,
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  }
}
```

#### `DELETE /api/v1/org/units/{ou_id}/policies/{policy_id}`

Purpose: Detach a policy from an org unit.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "ou_id": "ou_team_android",
    "policy_id": "0192e0a1-7c3d-7b2a-9f10-aa01bb02cc03",
    "status": "detached"
  }
}
```

Notes:

- OUs are not principals
- `block_inheritance` and `enforced` are stored but ignored by the V1 evaluator

### 6.3 Manager APIs

#### `GET /api/v1/org/users/{user_id}/manager`

Purpose: Retrieve a user's direct manager.

Response: `user` and `manager` are both full ControlPlaneUser objects:

```json
{
  "request_id": "req_123",
  "data": {
    "user": {
      "user_id": "user_alice",
      "report_to_user_id": "user_manager_1"
    },
    "manager": {
      "user_id": "user_manager_1",
      "report_to_user_id": ""
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
    "user": {
      "user_id": "user_alice",
      "report_to_user_id": "user_manager_1"
    }
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
    "user": {
      "user_id": "user_alice",
      "report_to_user_id": ""
    },
    "status": "cleared"
  }
}
```

#### `GET /api/v1/org/users/{user_id}/direct-reports`

Purpose: List a user's direct reports.

Supported query parameters:

- `recursive=true`

Response: `items` is an array of full ControlPlaneUser objects:

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

Cycle protection errors return `409 invalid_org_cycle`.

### 6.4 Org Chart Read Model

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

Field notes:

- The top-level org-chart field is `policy_attachments`; items are `{ "ou_id", "policy_id", "enforced", "created_at", "updated_at" }` (no nested policy).
- For authorization this is an org read route — referral-bound users may access it (see §2.1).

## 7. Operational And Catalog REST Routes

Implementation status: all landed in the current code.

### 7.1 Status

#### `GET /api/v1/status`

Purpose: Return the deployment project status summary.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "project_name": "my-deployment",
    "account_id": "123456789012",
    "api_base_url": "https://api.example.com",
    "has_runtime_info": true
  }
}
```

`has_runtime_info` indicates whether the project runtime info could be read.

#### `GET /api/v1/schema/status`

Purpose: Compare applied (runtime) vs. published (schema bucket) schema metadata.

Response:

```json
{
  "request_id": "req_123",
  "data": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "applied_schema_version": "v42",
    "applied_schema_sha256": "abc123...",
    "applied_schema_at": 1760000000000,
    "published_version": "v43",
    "published_sha256": "def456..."
  }
}
```

All schema fields are `omitempty`: when the corresponding metadata read fails, the field is absent and the response is still `200`.

### 7.2 Repair

#### `POST /api/v1/repair/dry-run`

Purpose: Preview a repair without writing. Body is optional.

Request body (all fields optional):

```json
{
  "project_id": "11111111-1111-4111-8111-111111111111",
  "force_rebuild_views": false
}
```

Response: `200`, `data` is the repair report.

#### `POST /api/v1/repair/apply`

Purpose: Execute the repair. Body is required and must carry `confirm: true`.

Request body:

```json
{
  "confirm": true,
  "force_rebuild_views": false
}
```

Error codes:

- `400 missing_body`: apply called without a body
- `400 confirmation_required`: `confirm` is not true
- `400 invalid_project_id`: the body `project_id` is invalid (omit it to use the deployment project)
- `400 invalid_body`: body parse failure
- `500 repair_failed`: repair execution failure

### 7.3 Catalogs

The three catalog sub-resources share one contract: `capabilities`, `action-templates`, `assistant-roles`.

#### `GET /api/v1/catalogs/{capabilities|action-templates|assistant-roles}`

Response (note: **not** a `data` envelope — `project_id` is top-level):

```json
{
  "request_id": "req_123",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "data": { "version": 1, "capabilities": [] }
}
```

`data` is the catalog JSON stored verbatim. `assistant-roles` returns the default `{"version":1,"roles":[]}` (`200`) when no record exists yet — not a 404.

#### `PUT /api/v1/catalogs/{capabilities|action-templates|assistant-roles}`

The request body is the catalog JSON itself (not wrapped in a `data` field). The server validates the structure before storing; success returns the same shape as GET.

Error codes:

- `400 invalid_data`: body is empty or not a JSON object
- `400 invalid_capability_catalog` / `invalid_action_template_catalog` / `invalid_assistant_role_catalog`: structural validation failure, with `details.field = "data"`
- `500 load_schema_registry_failed` (capabilities only): failed to load the schema registry
- `500 put_*_catalog_failed`: store failure

The capability catalog validation checks entity references against the known entity schema names in the schema registry.

### 7.4 Compliance Profile

#### `GET /api/v1/compliance-profile` / `PUT /api/v1/compliance-profile`

Same contract as the catalogs: GET returns `{"request_id", "project_id", "data"}`; the PUT body is the profile JSON itself, with validation failures returning `400 invalid_compliance_profile` (`details.field = "data"`) and the remaining error codes being `invalid_data` and `put_compliance_profile_failed`.

### 7.5 Workflows (dev-only)

#### `GET /api/v1/workflows`

Purpose: List workflow definition summaries. **This is a local-testing / development route**: the data comes from local JSON definition files (`LTBASE_LOCAL_TESTING_WORKFLOW_DEFINITION_PATHS` or built-in candidate paths); there is no database backing, and production deployments typically return an empty list.

Response:

```json
{
  "request_id": "req_123",
  "items": [
    {
      "name": "claim-review",
      "active_version": "1",
      "referenced_tools": ["tool_a", "tool_b"]
    }
  ]
}
```

## 8. `/control-plane` Action API Notes

The admin REST API does not replace the existing action-style control-plane API.

Use the REST admin API for productized admin UI and automation.

Use `/control-plane` for Lambda Console style operations, CLI workflows, and backend operational tasks.

In particular:

- `ensure-project`, `update-schema`, and the migration actions remain action-only
- `migrate-authz-policy-model` and `migrate-authz-resource-identity` are operational actions, not `/api/v1/...` REST endpoints
- the admin REST contract is resource-oriented, while `/control-plane` is action-oriented

### 8.1 Common Request Fields

All `/control-plane` actions share the following top-level JSON fields (`ControlPlaneRequest`):

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | Action name (case-insensitive; empty returns `missing_action`, unknown returns `unknown_action`) |
| `project_id` | UUID string | varies | Target project UUID |
| `data` | JSON array/object | varies | Action payload |
| `dry_run` | bool | no | Preview mode; no writes |
| `force` | bool | no | Overwrite existing conflicting records |

`dry_run` and `force` are honored only by actions that document support for them (e.g. `create-iam-authz-records`, `update-schema`, `migrate-authz-*`). `import-referrals` ignores both.

Response envelope:

```json
{
  "action": "create-iam-authz-records",
  "status": "success",
  "result": {}
}
```

HTTP status: `ensure-project`, `create-iam-authz-records`, and `import-referrals` return `201` on success; all other actions return `200`.

### 8.2 `create-iam-authz-records`

Purpose: Bulk-create IAM/authz records (role profiles, policy profiles, principal-policy attachments, and user-role attachments) for a project.

This is a lower-level seed/migration action. For the productized policy management contract, use `POST /api/v1/auth/policies` (see `API-specs-control-plane-service-auth-routes.en.md`).

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

**Result shape:**

```json
{
  "total": 2,
  "inserted": 2,
  "overwritten": 0,
  "dry_run_insert": 0,
  "dry_run_overwrite": 0,
  "dry_run": false,
  "force": false
}
```

Notes:

- The `force` flag allows overwriting existing records.
- `dry_run` returns counts (`dry_run_insert` / `dry_run_overwrite`) without writing.
- A `policy_profile` write triggers an automatic semantic project reseed.
- Unlike `POST /api/v1/auth/policies`, this action does **not** generate a `policy_id`; the caller provides it.
- The action stores `policy_document` verbatim (validated only as well-formed JSON, then compacted); it does **not** validate the document's internal shape. The canonical statement schema is defined in `rfc/EN/aaa.md` §6, which is authoritative.
- An empty `data` array is an error (`data cannot be empty`). Duplicate logical keys inside one batch fail with `duplicated logical item key`.
- Error codes: validation failure → `400 invalid_iam_authz_data`; existing-record conflict → `409 iam_authz_record_conflict`; otherwise → `500 create_iam_authz_records_failed`.

**Example: Creating a Control Plane Admin Policy and Binding to a User**

The Control Plane Admin API requires the caller to hold an admin policy. The `slug` must be `admin.controlplane`; the control-plane authorizer resolves the slug to the durable policy ID. The legacy migration ID `generated#permission#controlplane.admin` is only a compatibility fallback.

```json
{
  "action": "create-iam-authz-records",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "dry_run": false,
  "data": [
    {
      "kind": "policy_profile",
      "policy_id": "0190b3c4-1a2b-7c3d-8e4f-000000000002",
      "slug": "admin.controlplane",
      "external_key": "controlplane-admin-v1",
      "name": "Control Plane Admin",
      "description": "Full access to control plane admin APIs",
      "policy_document": { "statements": [] }
    },
    {
      "kind": "principal_policy_attachment",
      "principal_type": "user",
      "principal_id": "<USER_ID>",
      "policy_id": "0190b3c4-1a2b-7c3d-8e4f-000000000002"
    }
  ]
}
```

The admin policy's `policy_document` content is not inspected by the control-plane admin authorization check; the sole authorization path is through a `principal_policy_attachment` binding the admin policy to the user (or indirectly via a role — attach the policy to a role, then assign the role to the user). An empty `statements` list is therefore sufficient. Control-plane admin is a single binding-based grant, not a per-resource op: `controlplane` is not an entity schema and `admin` is not a valid op — entity statements scope an entity via `schema` with a `selector`, and ops are limited to `create` / `read` / `update` / `delete` / `*` (see `aaa.md` §6).

If an admin already exists via the REST Admin API, you can also bind using the REST endpoint: `PUT /api/v1/auth/principals/user/<USER_ID>/policies/admin.controlplane`, where `admin.controlplane` is resolved as a slug to the durable policy ID.

### 8.3 `import-referrals`

Purpose: Import one or more referral codes into a project, optionally with a bound policy ID.

This action corresponds to `POST /api/v1/auth/referrals?import=1` in the REST API (see `API-specs-control-plane-service-auth-routes.en.md`).

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
| `expires_at_ms` | int64 or numeric string | no | Expiration in epoch milliseconds. Omitting, `0`, or empty means never expires. |
| `project_id` | UUID string | no | Per-item project ID; if present it must equal the top-level `project_id`, otherwise the request fails. |

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

**Response (`201`):**

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
- `policy_id` is validated at write time, but the error code differs between the two entry points: the REST endpoints (`POST /api/v1/auth/referrals` and `?import=1`) translate an unknown policy to `400 policy_not_found`; this action does **not** perform that translation — an unknown policy is returned together with all other import failures as `500 import_referrals_failed` (the underlying cause appears in the error message).
- When `policy_id` is a slug, it is resolved to the durable `policy_id` before persistence.
- Omitting `policy_id` preserves legacy binding behavior (no automatic policy attachment on identity binding).
- On the REST referral resource, `PATCH /api/v1/auth/referrals/{code}` accepts only `expires_at_ms`; `policy_id` is not an accepted PATCH field and is silently ignored (not rejected). Treat the binding as effectively immutable after creation.
