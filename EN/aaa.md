


# **LTBase AAA System — Technical Specification**

LTBase AAA now has **two parts**:

1. A **Login / Authentication Service**
2. A **Data Plane Authorization Engine** that enforces **row-level, column-level, and attribute-level permissions**

This design uses your existing **EntityMain + EAV** data model and your **LTBase query rule syntax** for expressive, safe authorization — including fine-grained column/attribute control.

## **1. Overview**

The LTBase AAA (Authentication, Authorization, Accounting) system provides:

* **Authentication** via a login service issuing JWT tokens  
* **Fine-grained authorization** enforcing user access to data at:  
  * **Row Level**  
  * **Column/Attribute Level**  
* **Audit trails** of all access events  
* A policy model safe for usage by AI Agents and tools

This design integrates AAA policies with both **EntityMain + EAV business data** and your **existing query rule syntax** for expressive condition logic.

## **2. Authentication — Login Service**

The purpose of the login service:

* Validate credentials (e.g., username/password, SSO)
* Issue signed **JWT tokens** with minimal identity claims
* Include direct roles, not permission details

#### Example JWT payload:
```json
{  
  "sub": "user_id",  
  "role_ids": ["Team_Android","Dev"],  
  "iat": 1700000000,  
  "exp": 1700003600  
}
```

**Do not embed permissions in JWT.** Permissions must be evaluated dynamically to reflect real-time policy changes.

## **3. Authorization Goals**

The authorization engine must ensure:

* A user only sees rows they are permitted to see (row-level restriction)
* A user only sees columns/attributes they are allowed to (column/attribute-level)
* Permission rules can reference dynamic entity attributes in EAV
* Rules are safe and structured (no code injection)

**Row CPU access ≠ Column visibility** — both are distinct controls.

In modern platforms, row- and column-level permissions are treated as distinct control layers for data governance and compliance. 

## **4. AAA Data Model**

### **4.1 Business Entities — EntityMain + EAV**

Business entities use the **DSQL** based data model:

*   **Primary Table (`entity_main`)**:  
    Stores high-frequency fixed columns: `{ ltbase_schema_id, ltbase_row_id, ltbase_created_at, ltbase_updated_at, text_01...10, ... }`
*   **EAV Data Table (`eav_data`)**:  
    Stores dynamic attributes with typed value columns: `{ schema_id, row_id, attr_id, value_text, value_numeric, ... }`

This dynamic attribute model requires authorization conditions that match attributes from `eav_data` (mapping `attr_name` to `attr_id` and using `value_text`/`value_numeric`) rather than static columns.

### **4.2 Authorization Entities (Structured)**

| Entity                   | Purpose                         |
| ------------------------ | ------------------------------- |
| identity.user            | User identity                   |
| identity.role            | Role / group (with inheritance) |
| identity.user_role       | User → Roles                    |
| identity.permission      | Permission definition           |
| identity.role_permission | Roles → Permissions             |
| audit.log                | Audit/Accounting                |

**Permissions are stored in structured tables**, not EAV.

### **4.3 Entity Relationships and Schema**

The system follows a standard **RBAC (Role-Based Access Control)** model with support for hierarchical groups.

*   **User**: The identity principal.
*   **Role / Group**: Represents a collection of permissions or other roles.
    *   **Groups** are functionally equivalent to **Roles**.
    *   **Inheritance**: A Role can inherit from another Role (e.g., `Manager` inherits `Employee`).
*   **Permission**: A specific access rule composed of a Logic Condition (JSON) and an Outcome (Effect).

**Relationship Flow:**

1.  **Users** are assigned **Roles** (Many-to-Many via `identity.user_role`).
2.  **Roles** are mapped to **Permissions** (Many-to-Many via `identity.role_permission`).
3.  **Permissions** define the actual policies.

#### **SQL Definition**

```sql
CREATE SCHEMA identity;

-- 1. Users
CREATE TABLE identity.user (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    created_at BIGINT NOT NULL
);

-- 2. Roles (and Groups)
-- Supports hierarchy via parent_role_id
CREATE TABLE identity.role (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    parent_role_id UUID REFERENCES identity.role(role_id), -- Optional: for inheritance
    created_at BIGINT NOT NULL
);

-- 3. Permissions (The Rules)
CREATE TABLE identity.permission (
    permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    
    -- The logic predicate (Condition) defined in Section 5
    rule_json JSONB NOT NULL, 
    
    -- The result if condition matches (Effect)
    -- e.g., 'allow', 'deny', 'allow_column', 'mask_column'
    outcome TEXT NOT NULL, 
    
    description TEXT,
    created_at BIGINT NOT NULL
);

-- 4. User -> Role Mapping
CREATE TABLE identity.user_role (
    user_id UUID REFERENCES identity.user(user_id),
    role_id UUID REFERENCES identity.role(role_id),
    assigned_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

-- 5. Role -> Permission Mapping
CREATE TABLE identity.role_permission (
    role_id UUID REFERENCES identity.role(role_id),
    permission_id UUID REFERENCES identity.permission(permission_id),
    PRIMARY KEY (role_id, permission_id)
);
```

## **5. Permission Rule Syntax (Reusing LTBase Rule Format)**

Policy rules use your existing LTBase query rule format:

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

Meaning:

* l: logical operator (and / or)
* c: condition array
* a: attribute name
* v: value with operator prefix

This format supports nested logic and will serve both row-level and column/attribute-level conditions.


## **6. Row-Level Permission**

A row-level rule determines whether a given entity (e.g., a row of data) is visible or actionable.

Example — User can read only rows they own:

```json
{  
  "l": "and",  
  "c": [  
    { "a": "owner", "v": "equals:${requester.user_id}" }  
  ]  
}
```

Row-level access control restricts visibility to specific dataset rows based on attributes or roles. 

## **7. Column / Attribute-Level Permission**

Column/attribute-level permission controls *which attributes of an entity* a user may read or write.

This is important when:

* A user has access to a record but not all its fields
* Sensitive fields should be masked or hidden

Example privileges might define rules like:

**Allow reading email only for managers:**

```json
{  
  "l": "and",  
  "c": [  
    { "a": "role", "v": "equals:${requester.role_ids}" },  
    { "a": "attribute_name", "v": "equals:email" }  
  ]
}
```

(Note: The `outcome` for this permission would be stored as `'allow_column'` in the `identity.permission` table).

In this design:

* The permission rule can include a special attribute (e.g., "attribute_name") to indicate which fields are controlled.
* During evaluation, if a rule matches a specific attribute, the engine applies a visibility mask for that column.

### **Data Masking (Optional)**

For sensitive attributes (e.g., SSN), you may choose to *mask the value* (e.g., replace with \*\*\*\*\*) instead of hiding it completely. This is akin to dynamic data masking in database systems. 

## **8. Authorization Engine & Evaluation**

### **8.1 Role Expansion**

Compute effective roles by resolving hierarchy:

`All_Employees → Dev → Team_Android`

The engine must expand inherited roles before evaluating permissions.

### **8.2 Permission Fetch**

Fetch permissions associated with all effective roles.

Example structured permission model:

```sql
SELECT p.*  
FROM identity.permission p  
JOIN identity.role_permission rp ON p.permission_id = rp.permission_id  
WHERE rp.role_id IN (:role_ids)  
```

### **8.3 Context Expansion**

Before evaluating a rule, the engine replaces placeholders:

* `${requester.user_id}`
* `${requester.role_ids}`

with real values.


### **8.4 Condition Evaluation**

The rule logic (l/c) is evaluated against:

* EAV attributes of the target entity (row-level rules)
* The attribute names being accessed (column/attribute-level rules)

Example:

`{ "a": "project_team", "v": "equals:${requester.role_ids}" }`

evaluates whether the requester’s roles include the team of the project.

## **9. Query Filtering & Enforcement**

To enforce permissions on list queries, use the **CTE (Common Table Expression)** pattern to first resolve matching entity IDs from the EAV data, then retrieve the full records.

Example — CTE based filtering:

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

Then run post-filter evaluation for full condition satisfaction if needed.

Column/attribute filters involve checking which fields should be returned or masked.

## **10. AI Agent Safety**

To defend against prompt injection and unintended privilege escalation:

* Permissions must be **defined statically in policy storage**
* Agents may request data but **cannot contribute policy logic**
* Rule evaluation must be deterministic and safe
* Variables like ${…} are expanded only server-side

This ensures that agents *never generate policy conditions* but only request actions against enforced policies.


## **11. Accounting & Auditing**

All enforcement decisions are logged:

| Field     | Purpose                      |
| --------- | ---------------------------- |
| timestamp | When check happened          |
| user_id   | Who requested                |
| action    | Operation attempted          |
| resource  | Entity type / ID             |
| decision  | allowed / denied             |
| details   | Rule matched, context values |

This supports compliance and incident investigation.

## **12. Summary**

The LTBase AAA framework:

* Provides a login service with JWT authentication
* Enforces both **row-level** and **column/attribute-level** permissions
* Integrates permission evaluation with EAV business data
* Reuses existing LTBase logic rule syntax for authorization
* Expands roles hierarchically
* Ensures AI agent safety
* Generates complete audit trails

### **Optional Extensions**

If you want, we can also produce:

* JSON Schema for permission rules
* Policy editor UI design
* Implementation templates in **Golang / TypeScript**
* Automatic SQL pushdown rule translation

