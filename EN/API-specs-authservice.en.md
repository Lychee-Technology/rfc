# LTBase API Specification: Auth Service (End-User Token Service)

This document describes the implemented HTTP API contract of the standalone end-user token service `cmd/authservice`: provider login exchange, identity binding, token refresh/revocation, and public profile lookup.

- Code baseline:
  - `ltbase.api/cmd/authservice`
  - `ltbase.api/internal/authservice/routes.go` (authoritative route table)
  - `rfc/EN/aaa.md`
- Document language: English
- Updated on: 2026-07-17

## 1. Overview

The auth service is the end-user token service of an LTBase deployment. It runs as an AWS Lambda behind API Gateway v2 (HTTP API) and is responsible for:

- exchanging an upstream-IdP-authenticated identity for an LTBase access/refresh token pair (`login/{provider}`)
- binding a new external identity to a project user with a referral/invite code, governed by binding policies (`id_bindings/{provider}`)
- refresh-token rotation with reuse detection (`auth/refresh`) and refresh-chain revocation (`auth/revoke`)
- project-scoped public profile lookup (`auth/profile/{user_id}`)

Namespace ownership note: the `/api/v1/auth/*` namespace is shared by two services. This document covers the end-user token routes served by `cmd/authservice`. The admin management surface (users, roles, policies, binding policies, referrals CRUD) under the same namespace is served by the control plane and documented in `API-specs-control-plane-service-auth-routes.en.md`. The two route sets do not overlap.

The single source of truth for the route surface is `handlerRouteTable()` in `ltbase.api/internal/authservice/routes.go`; both request dispatch and the published `routes-manifest.json` derive from it.

## 2. Authentication, Scope, and Shared Conventions

### 2.1 Trust Model

The service does not validate the caller's credential itself. The API Gateway JWT authorizer validates the bearer token upstream and passes the verified claims to the Lambda; handlers read them from `RequestContext.Authorizer.JWT.Claims`.

- For `login/{provider}` and `id_bindings/{provider}`, the authorizer token is the **upstream IdP token** (e.g. Firebase). Handlers consume its `sub`, `iss`, and other identity claims (`email`, `name`, `display_name`, ...).
- For `auth/refresh`, the authorizer token is the **LTBase-issued refresh token** itself (see §5.4).
- For `auth/profile/{user_id}`, the authorizer token must carry a `project_id` claim (an LTBase access token qualifies).
- `auth/health` is the only route without an authorizer.

### 2.2 Project Scope

The service runs in single-project scope: the deployment project is configured via `PROJECT_ID`. A request may carry `project_id` (in the body or, for login, in a claim), and it is resolved as: request body → authorizer claim (login only) → configured default. Any explicitly provided value must be a valid UUID and equal the configured default, otherwise the request is rejected (`invalid_project_id` / `invalid_project_scope`).

### 2.3 Request/Response Conventions

- All request bodies are JSON; all responses are JSON with `Content-Type: application/json`.
- There is no envelope: success payloads are flat objects (no `request_id` wrapper, unlike the control-plane admin API).
- Every error response has the shape:

```json
{ "error": "<error_code>" }
```

- Unknown routes return `404 {"error":"not_found"}`.
- A recovered panic returns `500 {"error":"internal_error"}`.

### 2.4 JWKS Publication

The service's signing public keys are **not served by a route**. The former `GET /auth/jwks.json` route was removed and now returns `404 not_found`. The JWKS document is published as a static release artifact and hosted at the URL configured by `AUTH_JWKS_URL`; the service itself fetches that URL to verify its own previously-issued access tokens during refresh. JWK format: `{"kty":"RSA","alg":"RS256","use":"sig","kid":"...","n":"...","e":"..."}`.

## 3. Route Summary

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/auth/health` | Liveness check |
| POST | `/api/v1/login/{provider}` | Exchange an upstream identity for an LTBase token pair |
| POST | `/api/v1/id_bindings/{provider}` | Bind an external identity (with invite/referral code) and issue tokens |
| POST | `/api/v1/auth/refresh` | Rotate a refresh token into a new token pair |
| POST | `/api/v1/auth/revoke` | Revoke a refresh chain |
| GET | `/api/v1/auth/profile/{user_id}` | Project-scoped public profile lookup |

The `{provider}` routes carry the `expand: provider` marker in the route manifest (`routemanifest.ExpandProvider`): the deployment declares one concrete gateway route per configured provider. The provider path value is lowercased and must be in the `AUTH_PROVIDERS` allowlist.

## 4. Token Model

### 4.1 Signing

All tokens are RS256-signed JWTs. Two signer modes (`AUTH_SIGNER_MODE`):

- **`kms`** (default): signs via AWS KMS (`RSASSA_PKCS1_V1_5_SHA_256`); requires an asymmetric RSA_2048/3072/4096 key. The JWT `kid` header is the KMS key ID.
- **`file`**: signs with a local OpenSSH RSA private key (optionally passphrase-encrypted). The `kid` is resolved from `LTBASE_JWT_KID` → `AUTH_LOCAL_KEY_ID` → private-key filename stem → `local-file-key`.

Historical note: the service originally signed with Ed25519 (EdDSA) and was migrated to RS256. The `cmd/authservice/ed25519/` key pair is a legacy artifact; there is no Ed25519 signing path in the current code. The active local-file key pair lives in `cmd/authservice/rsa256/`.

### 4.2 Access Token Claims

Default TTL: 75 minutes (`AUTH_ACCESS_TTL`).

```json
{
  "iss": "<AUTH_ISSUER>",
  "aud": ["<project_id>"],
  "sub": "<user_id>",
  "role_ids": ["role.employee"],
  "project_id": "<project_id>",
  "api_base_url": "https://api.example.com",
  "iat": 1700000000,
  "exp": 1700004500,
  "jti": "<random id>",
  "token_use": "access",
  "auth_time": 1700000000,
  "email": "user@example.com"
}
```

- `aud` is `[project_id]`, or `[project_id, AUTH_ACCESS_AUD]` when `AUTH_ACCESS_AUD` is set.
- `role_ids` is the user's role list after hierarchy expansion.
- On refresh-minted access tokens, `auth_time` is carried over from the original session's issue time and `email` is empty.

### 4.3 Refresh Token Claims

Default TTL: 672 hours / 28 days (`AUTH_REFRESH_TTL`).

```json
{
  "iss": "<AUTH_ISSUER>",
  "aud": "<AUTH_REFRESH_AUD>",
  "sub": "<user_id>",
  "project_id": "<project_id>",
  "api_base_url": "https://api.example.com",
  "iat": 1700000000,
  "exp": 1702419200,
  "jti": "<random id>",
  "session_id": "<random id>",
  "token_use": "refresh"
}
```

### 4.4 Rotation and Reuse Detection

Every successful exchange or refresh persists a refresh session keyed by the refresh token's `jti`, linked to its parent via `parent_jti`. On refresh:

- an expired refresh token revokes its chain with reason `expired` and returns `refresh_expired`;
- a revoked session returns `refresh_revoked`;
- reuse of an already-rotated refresh token revokes the **entire chain** with reason `refresh_reuse` and returns `refresh_revoked`.

Successful exchange, refresh, revoke, and binding operations each write an audit entry (`action`: `exchange` / `refresh` / `revoke` / `id_binding`).

## 5. Endpoints

### 5.1 `GET /api/v1/auth/health`

Purpose: liveness check. No authorizer, no parameters.

Response (`200 OK`):

```json
{ "status": "ok" }
```

### 5.2 `POST /api/v1/login/{provider}`

Purpose: exchange an upstream-IdP-authenticated identity for an LTBase token pair. The identity must already be bound (see §5.3), otherwise `403 identity_unbound`.

Authorizer: upstream IdP JWT. Claims consumed: `sub` (required), `iss` (required), `project_id` (optional).

Request body (optional; may be empty):

```json
{ "project_id": "11111111-1111-4111-8111-111111111111" }
```

Processing: resolve project scope (§2.2) → validate provider against allowlist → require `sub`/`iss` → resolve the project's API base URL → look up the bound user → update `last_login` → list and expand roles → mint the token pair.

Response (`200 OK`; note: no `expires_at` on login):

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "api_base_url": "https://api.example.com"
}
```

Errors:

| Status | `error` | Trigger |
| --- | --- | --- |
| 400 | `invalid_body` | body present but not valid JSON |
| 400 | `project_id_required` / `invalid_project_id` / `invalid_project_scope` | project scope resolution failed (§2.2) |
| 400 | `invalid_provider` | provider not in `AUTH_PROVIDERS` allowlist |
| 400 | `missing_identity` | authorizer `sub` or `iss` empty |
| 400 | `project_not_configured` | no API base URL configured for the project |
| 403 | `identity_unbound` | identity has no bound user |
| 409 | `identity_inconsistent` | stored identity state is inconsistent |
| 500 | `user_lookup_failed` / `update_last_login_failed` / `role_list_failed` / `role_expand_failed` / `exchange_failed` | downstream failure |

### 5.3 `POST /api/v1/id_bindings/{provider}`

Purpose: bind an external identity to a project user using an invite/referral code, then issue a token pair. Binding is governed by the binding-policy engine (see below).

Authorizer: upstream IdP JWT. Claims consumed: `sub` (required), `iss` (required); all identity claims (e.g. `email`, `name`, `display_name`) are stored on the user as `identity_claims`.

Request body (required):

```json
{
  "bind_context": {
    "code": "invite-code-1",
    "project_id": "11111111-1111-4111-8111-111111111111"
  }
}
```

Response (`200 OK`): same shape as login — `access_token`, `refresh_token`, `api_base_url`.

Binding policies: enabled policies are loaded per project; when none exist, the built-in fallback policy `referral.default` applies, requiring `referral_valid == true`. Rules have the shape `{l, c, a, v}` (left operand, comparator, action, value) evaluated over the context fields `project_id, provider, issuer, sub, email, code, referral_exists, referral_used, referral_valid`. Comparators: `eq, ne, exists, not_exists, truthy, falsy, contains, prefix, in, not_in`; actions: `must` (also `require`/`allow_if`) and `deny_if` (also `deny`). Enforcement is gated by `AUTH_BINDING_POLICY_SHADOW_MODE` (evaluate and audit but never deny) and `AUTH_BINDING_POLICY_ALLOWLIST` (enforce only for listed projects; empty = all). `REFERRAL_REQUIRED=true` appends the default referral rule when no stored policy has one.

If the identity is already bound to a user, the binding call resolves the existing user, refreshes its referral-code record, and still returns a token pair (idempotent re-bind); `identity_bound` is only returned when the existing user cannot be resolved consistently.

Errors:

| Status | `error` | Trigger |
| --- | --- | --- |
| 400 | `invalid_body` | body missing or not valid JSON |
| 400 | `project_id_required` / `invalid_project_id` / `invalid_project_scope` | project scope resolution failed (§2.2) |
| 400 | `invalid_code` | `bind_context.code` empty |
| 400 | `invalid_provider` | provider not in allowlist |
| 400 | `missing_identity` | authorizer `sub` or `iss` empty |
| 409 | `invalid_code` | referral required/invalid, or binding policy denied (enforced mode) |
| 409 | `identity_bound` | identity already bound and not resolvable to a user |
| 409 | `identity_inconsistent` | stored identity state is inconsistent |
| 500 | `id_binding_failed` | other downstream failure |

### 5.4 `POST /api/v1/auth/refresh`

Purpose: rotate a refresh token into a new access/refresh pair.

Authorizer: the **LTBase refresh token** is presented as the gateway bearer token. Claims consumed: `iss, aud, sub, project_id, api_base_url, iat, exp, jti, session_id`; `project_id`, `jti`, and `exp` are mandatory (otherwise `refresh_invalid`).

Request body (required):

```json
{ "access_token": "<current access jwt>" }
```

The provided `access_token` is verified against the JWKS at `AUTH_JWKS_URL`: RS256 signature (key selected by `kid`), `token_use` must be `access`, and `iss` must equal the configured issuer. Its expiry is deliberately **not** checked — refreshing after the access token has expired is the normal case. Failure → `401 access_invalid`.

Response (`200 OK`; `expires_at` is the new access token's expiry, Unix seconds):

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "expires_at": 1700004500
}
```

Errors:

| Status | `error` | Trigger |
| --- | --- | --- |
| 400 | `invalid_body` | body not valid JSON |
| 400 | `access_token_required` | `access_token` empty |
| 401 | `access_invalid` | access token fails JWKS/`token_use`/issuer verification |
| 401 | `refresh_invalid` | refresh claims incomplete or session validation failed for another reason |
| 401 | `refresh_expired` | refresh token expired (chain revoked with reason `expired`) |
| 401 | `refresh_revoked` | session revoked, or rotated-token reuse detected (chain revoked with reason `refresh_reuse`) |

### 5.5 `POST /api/v1/auth/revoke`

Purpose: revoke a refresh chain (e.g. logout, credential compromise).

Request body:

```json
{
  "project_id": "11111111-1111-4111-8111-111111111111",
  "jti": "<refresh token jti>",
  "reason": "manual_revoke"
}
```

`reason` is optional and defaults to `manual_revoke`. Revocation applies to the whole chain rooted at the given `jti`.

Response (`200 OK`):

```json
{ "status": "revoked" }
```

Errors:

| Status | `error` | Trigger |
| --- | --- | --- |
| 400 | `invalid_body` | body not valid JSON |
| 400 | `project_id_required` / `invalid_project_id` / `invalid_project_scope` | project scope resolution failed (§2.2) |
| 400 | `jti_required` | `jti` empty |
| 500 | `revoke_failed` | downstream failure |

### 5.6 `GET /api/v1/auth/profile/{user_id}`

Purpose: public profile lookup, scoped to the caller's project. Any authenticated caller in the project can read same-project public profiles.

Authorizer claim consumed: `project_id` (required → otherwise `401 auth_required`).

Path parameter: `{user_id}`.

Response (`200 OK`; timestamps are Unix **milliseconds**; `email`, `display_name`, `primary_ou_id`, `report_to_user_id` are omitted when empty; `display_name` falls back from the `display_name` identity claim to `name`):

```json
{
  "profile": {
    "user_id": "user-123",
    "email": "user@example.com",
    "display_name": "User Name",
    "primary_ou_id": "ou-1",
    "report_to_user_id": "user-456",
    "created_at": 1700000000000,
    "updated_at": 1700000000000,
    "last_login_at": 1700000000000
  }
}
```

Errors:

| Status | `error` | Trigger |
| --- | --- | --- |
| 400 | `user_id_required` | empty `user_id` path value |
| 401 | `auth_required` | authorizer has no `project_id` claim |
| 404 | `user_not_found` | no such user in the project |
| 500 | `profile_lookup_failed` | downstream failure |

## 6. Configuration Appendix

Contract-relevant environment variables (`internal/authservice/config.go`, loaded in `cmd/authservice` wiring):

| Env var | Required | Default | Meaning |
| --- | --- | --- | --- |
| `AUTH_ISSUER` | yes | — | JWT `iss` value |
| `AUTH_REFRESH_AUD` | yes | — | refresh token `aud` |
| `AUTH_ACCESS_AUD` | no | empty | extra access token `aud` entry |
| `AUTH_ACCESS_TTL` | no | `75m` | access token lifetime (Go duration) |
| `AUTH_REFRESH_TTL` | no | `672h` | refresh token lifetime |
| `AUTH_JWKS_URL` | yes | — | JWKS URL used to verify access tokens during refresh |
| `PROJECT_ID` | yes | — | deployment project (UUID); single-project scope |
| `AUTH_DEFAULT_API_BASE_URL` | no | empty | fallback `api_base_url` |
| `AUTH_PROJECT_API_BASE_URLS` | no | `{}` | JSON map `{project_id: url}` |
| `AUTH_SIGNER_MODE` | no | `kms` | `kms` or `file` (§4.1) |
| `AUTH_KMS_KEY_ID` | if `kms` | — | KMS asymmetric RSA key |
| `AUTH_LOCAL_PRIVATE_KEY_PATH` | if `file` | — | OpenSSH RSA private key path |
| `AUTH_LOCAL_PRIVATE_KEY_PASSWORD` | no | empty | private key passphrase |
| `AUTH_LOCAL_PUBLIC_KEY_PATH` | no | empty | optional public key (must match private) |
| `LTBASE_JWT_KID` / `AUTH_LOCAL_KEY_ID` | no | key filename stem | JWT `kid` for file mode |
| `AUTH_PROVIDERS` | yes | — | CSV allowlist of providers (e.g. `firebase,github`) |
| `REFERRAL_REQUIRED` | no | `false` | force the referral rule into binding policy |
| `AUTH_BINDING_POLICY_SHADOW_MODE` | no | `false` | evaluate binding policies without enforcing |
| `AUTH_BINDING_POLICY_ALLOWLIST` | no | empty (= all) | CSV of project IDs to enforce policies for |

Store backend selection (`cmd/authservice/config.go`): `AUTH_STORE_BACKEND` (`dynamodb`, the default, or `postgres`; falls back to `CONTROLPLANE_STORE_BACKEND`). DynamoDB table name resolves `AUTH_IDENTITY_TABLE_NAME` → `DYNAMODB_TABLE_NAME` → `LTBASE_TABLE_NAME` (deprecated); Postgres schema resolves `CONTROLPLANE_PROJECT_SCHEMA` → `DSQL_PROJECT_SCHEMA` → `ltbase`.

## 7. Related Documents

- `aaa.md` — the canonical AAA model: identity model, deterministic user IDs, login/binding sequences, JWT design.
- `API-specs-control-plane-service-auth-routes.en.md` — the control-plane admin surface sharing the `/api/v1/auth/*` namespace (users/roles/policies/binding policies/referrals CRUD).
- `API-specs-data-plane.en.md` — the data-plane API that consumes the access tokens issued here.
- `IdentityArchitecture.md` — design background only; its `/oauth/token` and `/oauth/revoke` endpoints are aspirational and do not match the implemented routes in this document.
