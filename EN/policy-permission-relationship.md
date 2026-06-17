# **Policy–Permission Relationship — Canonical Terminology**

This RFC resolves the semantic ambiguity between `policy` and `permission` in LTBase auth and control-plane terminology. It defines the canonical model, identifies legacy compatibility surfaces, and specifies migration semantics.

**Status:** Accepted (issue [#330](https://github.com/Lychee-Technology/ltbase.api/issues/330), [#337](https://github.com/Lychee-Technology/ltbase.api/issues/337))

---

## **1. Problem**

The LTBase codebase and documentation contain both legacy permission-oriented structures (`permission_profile`, `role_permission_attachment`) and newer policy-oriented structures (`policy_profile`, `principal_policy_attachment`, `ou_policy_attachment`). Maintainers and future implementors need an unambiguous answer to:

- What is a *permission*?
- What is a *policy*?
- Does one derive from the other?
- Which concepts are legacy compatibility surfaces?
- Which model is canonical going forward?

Without these answers, control-plane read-model design, REST API DTOs, migration code, and JWT claim design cannot converge on a shared vocabulary.

---

## **2. Decision**

| Concept | Status | Canonical? |
| ------- | ------ | ---------- |
| `policy` / `policy_profile` | Authorization rule container holding one or more `statement` items with `effect`, `ops`, `schema`, `selector`, `outcome`, and `condition` | **Yes — canonical authorization object** |
| `principal_policy_attachment` | Binds a `policy` to a principal (`user` or `role`) | **Yes — canonical principal authorization relationship** |
| `ou_policy_attachment` | Binds a `policy` to an OU; inherits down the OU subtree | **Yes — canonical org authorization relationship** |
| `permission_profile` | Legacy record representing a single permission name and optional rule | **No — legacy data, not canonical** |
| `role_permission_attachment` | Legacy edge connecting a role to a permission | **No — legacy binding edge** |
| `resource_grant` | Legacy/transition principal-to-resource grant (manual or migrated) | **No — may be retained only as a physical projection index for hot-path lookups** |
| JWT `permissions` claim | Runtime compatibility field on issued JWTs; used by some authorizers (e.g., `controlplane.admin`) | **No — compatibility claim, not canonical model** |

The unified `policy_profile` model (defined in `aaa.md` §4.1) is the single canonical authorization model. All other authorization concepts are either legacy or derived.

---

## **3. Canonical Policy Model**

The canonical model is `aaa.md` §4.1. In summary:

- **`policy_profile`** is the unit of authorization. It carries a `policy_document` containing one or more `statement` items.
- A statement expresses: `effect` (allow / deny / mask), `ops` (create / read / update / delete), `schema` (entity scope), `selector` (resource_id list, filter, or both), optional `outcome`, and optional `condition`.
- **`principal_policy_attachment`** attaches a policy to a `user` or `role` principal. OUs are **not** ACL principals.
- **`ou_policy_attachment`** attaches a policy to an OU; the policy inherits down the OU subtree along `ou_path` (GPO-style).
- The evaluator processes all three attachment surfaces (user-direct, role, OU-ancestor) and resolves conflicts via deny-overrides and mask-overrides-allow precedence (`aaa.md` §9.6).

A policy exists independently. It does **not** require a permission to exist. It does **not** reference permission records.

---

## **4. Legacy Permission Model**

### **4.1 `permission_profile`**

A legacy DynamoDB record (`entity_type = "permission_profile"`) representing a named permission such as `log:create` or `controlplane.admin`. It may carry an optional `rule` and `outcome`.

- **Read path:** Surfaces only in the `ProjectAuthConfig.Legacy.Permissions` diagnostic snapshot. It is **not** part of the public REST DTO for `auth/config`.
- **Write path:** Not writeable through new control-plane REST APIs. Legacy write paths (`CreatePermissionRecords`) remain available in action-style `/control-plane` endpoints for backward compatibility only.
- **Evaluator:** No evaluator should rely on `permission_profile` records directly. The evaluator should process `policy_profile` statements.

### **4.2 `role_permission_attachment`**

A legacy DynamoDB record (`entity_type = "role_permission_attachment"`) connecting a `role_id` to a `permission_id`.

- **Read path:** Surfaces only in `ProjectAuthConfig.Legacy.RolePermissions`.
- **Write path:** Not writeable through new control-plane REST APIs.
- **Canonical replacement:** `principal_policy_attachment` with `principal_type = "role"`.

### **4.3 `resource_grant`**

A legacy/transition DynamoDB record (`entity_type = "resource_grant"`) granting a principal (`user` or `role`) access to a specific `schema_name` / `resource_id` or `filter` selector, with specific `ops`.

- **Read path:** Surfaces only in `ProjectAuthConfig.Legacy.Grants`.
- **Canonical replacement:** A single-statement `policy_profile` attached to the original principal via `principal_policy_attachment`.
- **Physical projection:** `aaa.md` §4.2 allows a `resource_grant`-style index to persist as a denormalized cache for hot-path lookups. This is an optimization, not a parallel authorization model (`aaa-control-plane-store-mapping.md` §3.3, §4.3, §5.5).

---

## **5. JWT Permission Claims**

The JWT `permissions` claim (e.g., `["controlplane.admin", "notes:read"]`) is a **runtime compatibility field**.

- It is read from JWT claims by `permissionsFromRequest` (`internal/request_authz_claims.go`) and used by authorizers such as the control-plane admin check (`controlplane.admin`).
- It is **not** the canonical authorization model. It is a snapshot at token-issue time.
- The `aaa.md` §2.4 design explicitly states: *"Permissions must be evaluated dynamically to reflect real-time policy changes. Do not embed permissions in JWT."*
- The long-term direction is to keep `role_ids` in the JWT and evaluate permissions/policies dynamically from the control-plane store at request time.

The existence of a `permissions` claim does **not** make `permission_profile` canonical, and consuming `permissions` in an authorizer does **not** make the legacy permission model authoritative for new API design.

---

## **6. Migration Semantics**

The `MigrateProjectAuthRecords` action (`internal/control_plane_auth_migration.go`) converts legacy auth records into the canonical policy model. The following rules are locked:

### **6.1 Source → Target Mapping**

| Legacy source (entity_type) | Generated target(s) |
| --------------------------- | -------------------- |
| `permission_profile` | `policy_profile` — one generated policy per permission; the policy document is synthesized from the permission's `rule`, `outcome`, and `permission_name` |
| `role_permission_attachment` (permission exists) | `principal_policy_attachment` — attaches the generated permission-policy to the role principal |
| `role_permission_attachment` (permission missing) | `role_permission_attachment` — preserved as-is in canonical SK format |
| `resource_grant` (well-formed) | `policy_profile` + `principal_policy_attachment` — one single-statement policy generated from the grant, attached to the original principal |
| `resource_grant` (unsupported shape) | Preserved as-is with a warning |
| `policy_profile` (legacy PK) | `policy_profile` (canonical PK) — document normalized from `statement` to `statements` shape |
| `user_role_attachment` (legacy PK) | `user_role_attachment` (canonical SK) |
| `session` / `session_child` | Preserved with canonical PK |

### **6.2 Key Rules**

- **Policy does not depend on permission.** A generated permission-to-policy conversion creates a standalone `policy_profile`; after migration, the resulting policy is self-contained.
- **Migration is DynamoDB-only.** Postgres-backed deployments do not need migration; their data is already in the canonical shape.
- **Migration is idempotent.** Running with `force=true` overwrites existing canonical records; running without `force` skips existing targets.
- **Legacy records are not deleted.** Migration writes canonical records but does not remove legacy source items.

### **6.3 Result Counters**

The `MigrateProjectAuthRecordsResult` exposes three counter layers:

- **`discovered`** — legacy source records recognized as migration inputs (`permission_profiles`, `role_permissions`, `grants`, etc.)
- **`planned_writes`** — generated candidate records by target kind (`policy_profiles`, `principal_policies`, etc.)
- **`written`** — successfully persisted target records

See `docs/superpowers/specs/2026-05-23-auth-migration-result-counters-design.md` for the counter contract.

---

## **7. Control Plane / API Implications**

### **7.1 Public REST DTOs**

The public `GET /api/v1/auth/config` snapshot (`control-plane-aaa-org-chart-rest-api-design.md` §9) surfaces:

- `policies` — canonical policy profiles
- `principal_policy_attachments` — canonical principal bindings
- `ou_policy_attachments` — canonical OU bindings (shape-complete; may be empty until backend implementation)

Legacy data (`permissions`, `role_permissions`, `grants`) is **relegated to `legacy` sub-object** for diagnostics only. It must **not** appear as primary REST resource fields.

This is enforced by the DTO alignment design (`control-plane-auth-dto-alignment-design.md`).

### **7.2 Write APIs**

The *proposed* write APIs (e.g. `POST /api/v1/auth/policies`, `PUT /api/v1/auth/principals/{type}/{id}/policies/{policy_id}`) are not yet implemented (see §8). When built, they will operate on the canonical model and will **not** create `permission_profile` or `role_permission_attachment` records.

### **7.3 Semantic Layer**

The semantic layer (`semantic-layer-v1-design.md`) registers `policy` resources with IDs like `sem:policy:{project_id}:{policy_id}` sourced from `policy_profile` records. It does **not** register `permission_profile` records as semantic resources.

---

## **8. Out of Scope**

This RFC does **not**:

- Mandate code changes or removal of legacy data
- Redesign the policy evaluator or inheritance model
- Implement new REST APIs or storage backends
- Define a full permission-to-policy data migration schedule
- Remove the JWT `permissions` claim from current token issuance
- Change the behavior of `permissionsFromRequest` or existing authorizers

These are deferred to follow-up implementation issues.

---

## **9. Acceptance Criteria Mapping**

Mapping against the acceptance criteria of parent issue [#330](https://github.com/Lychee-Technology/ltbase.api/issues/330):

| # | Criterion | Covered by |
| --- | --------- | ---------- |
| 1 | Written design defines canonical `policy` and `permission` relationship | §2 Decision, §3 Canonical Policy Model, §4 Legacy Permission Model |
| 2 | Design explicitly describes status of legacy `role_permission` vs canonical policy | §4.2, §6.1 migration mapping |
| 3 | Design is specific enough to drive follow-up control-plane read-model and documentation changes | §7 Control Plane / API Implications |

Mapping against sub-issue [#337](https://github.com/Lychee-Technology/ltbase.api/issues/337):

| # | Criterion | Covered by |
| --- | --------- | ---------- |
| 1 | `policy` is canonical authorization object | §2, §3 |
| 2 | `principal_policy_attachment` is canonical principal relationship | §2, §3 |
| 3 | `ou_policy_attachment` is canonical org relationship | §2, §3 |
| 4 | `permission_profile` is legacy data | §2, §4.1 |
| 5 | `role_permission` is legacy binding edge | §2, §4.2 |
| 6 | `permission claim` is JWT compatibility, not canonical permission model | §5 |
| 7 | Migration can generate policy from legacy permission, but policy does not depend on permission | §6.2 |
| 8 | RFC file written and available for downstream sub-issues | This document |

---

## **References**

- `rfc/EN/aaa.md` — AAA architecture specification; defines unified `policy_profile` model (§4.1)
- `rfc/EN/aaa-control-plane-store-mapping.md` — store mapping; explicitly excludes legacy record families (§2 Note)
- `ltbase.api/internal/control_plane_auth_migration.go` — migration implementation
- `ltbase.api/internal/control_plane_auth_config.go` — legacy snapshot structure
- `ltbase.api/internal/control_plane_iam_authz.go` — legacy IAM record kind constants
- `ltbase.api/docs/superpowers/specs/2026-05-22-control-plane-aaa-org-chart-rest-api-design.md` — REST API contract; legacy relegated to `legacy` sub-object (§9)
- `ltbase.api/docs/superpowers/specs/2026-05-23-control-plane-auth-dto-alignment-design.md` — DTO alignment; explicit removal of legacy fields from public DTO
- `ltbase.api/docs/superpowers/specs/2026-05-23-auth-migration-result-counters-design.md` — migration counter semantics
