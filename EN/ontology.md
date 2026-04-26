# LTBase Operational Ontology RFC

## 1. Overview

This document proposes an ontology-first semantic layer for LTBase.

The goal is not to copy Palantir Foundry product-for-product. The goal is to give LTBase a stable business-semantic model that sits above raw schemas, APIs, and execution traces so that:

- applications reason about business objects instead of storage details
- policies and action planning bind to the same shared semantic model
- lineage and provenance attach to object references instead of becoming the semantic model themselves

In this RFC, "ontology" means the business-facing semantic layer of LTBase:

- object types
- object properties
- link types
- action types
- policy bindings
- provenance bindings

## 2. Why LTBase Needs This Layer

LTBase already has several pieces of a semantic system:

- Forma schemas define entity structure
- `semantic_resource` and `semantic_relation` provide a project-scoped registry
- discovery APIs traverse semantic relations
- governance APIs bind entities, capabilities, and policies
- planning APIs map user intent to actions
- lineage RFC work captures operational provenance

These pieces are useful, but they currently sit beside each other instead of being organized around one explicit semantic contract.

Without an ontology-first design, LTBase risks three problems:

1. `semantic` stays a thin registry of system facts rather than a stable business model.
2. `lineage` keeps absorbing business relationships that should belong to object/link modeling.
3. agent planning, permissions, and future UI surfaces end up coupling to implementation details instead of object semantics.

## 3. Design Principles

### 3.1 Model Reality, Not Storage

Ontology types should represent business objects such as `lead`, `account`, `invoice`, or `deployment`, not technical tables, CDC rows, or Lambda handlers.

### 3.2 Keep Ontology Separate From Provenance

Ontology answers:

- what is this object
- what is it related to
- what actions are valid on it
- what policy constrains those actions

Lineage answers:

- where did this output come from
- which agent, tool, or model produced it
- which prior records or inputs contributed to it

The two systems must join cleanly, but they should not collapse into one abstraction.

### 3.3 Reuse Existing LTBase Assets

The ontology should be built from existing LTBase sources of truth wherever possible:

- Forma schema for object and property definitions
- semantic registry for project-scoped resources and relations
- capability catalogs for action definitions
- policy documents for governance constraints
- change log and lineage capture for provenance

### 3.4 API-First Before UI-First

LTBase should not begin by cloning Foundry Object Views or Workshop.

Version 1 should expose:

- object lookup
- object graph traversal
- governed action discovery
- provenance lookup

Any richer application surface can be built on top later.

## 4. Core Ontology Model

### 4.1 Object Types

An `ObjectType` is the stable semantic definition of a business object.

Suggested shape:

```go
type ObjectType struct {
	TypeID        string           `json:"type_id"`
	Name          string           `json:"name"`
	DisplayName   string           `json:"display_name"`
	Description   string           `json:"description"`
	BackingSchema string           `json:"backing_schema"`
	IdentityField string           `json:"identity_field"`
	DisplayFields []string         `json:"display_fields"`
	StatusField   string           `json:"status_field,omitempty"`
	Properties    []ObjectProperty `json:"properties"`
	Source        string           `json:"source"`
	Version       string           `json:"version"`
}

type ObjectProperty struct {
	Name         string `json:"name"`
	DisplayName  string `json:"display_name"`
	DataType     string `json:"data_type"`
	Required     bool   `json:"required"`
	Searchable   bool   `json:"searchable"`
	Filterable   bool   `json:"filterable"`
	DisplayOrder int    `json:"display_order"`
}
```

`ObjectType` is business-facing. It can be derived from Forma schema, but it is not a raw dump of schema internals.

### 4.2 Link Types

A `LinkType` defines a semantic relationship between two object types.

Examples:

- `lead belongs_to account`
- `invoice generated_from order`
- `note references document`

This is where schema-level `$ref` and `x-relation` belong when they express stable business relationships.

Suggested shape:

```go
type LinkType struct {
	LinkTypeID     string `json:"link_type_id"`
	Name           string `json:"name"`
	FromType       string `json:"from_type"`
	ToType         string `json:"to_type"`
	Cardinality    string `json:"cardinality"`
	Directionality string `json:"directionality"`
	BackingField   string `json:"backing_field,omitempty"`
	DerivedFrom    string `json:"derived_from"`
}
```

### 4.3 Action Types

An `ActionType` is the ontology-level definition of something a user or agent can do to an object.

Examples:

- `create lead`
- `list invoice`
- `approve deployment`
- `summarize document`

LTBase already has partial inputs for this in the capability catalog and planner. The missing step is to treat actions as first-class semantic definitions instead of only planner candidates.

Suggested shape:

```go
type ActionType struct {
	ActionTypeID         string   `json:"action_type_id"`
	Name                 string   `json:"name"`
	TargetObjectType     string   `json:"target_object_type"`
	SupportedOperations  []string `json:"supported_operations"`
	RequiredCapabilities []string `json:"required_capabilities"`
	InputSchemaRef       string   `json:"input_schema_ref,omitempty"`
	OutputSchemaRef      string   `json:"output_schema_ref,omitempty"`
	ExecutionOwner       string   `json:"execution_owner"`
}
```

### 4.4 Policy Bindings

Policies should attach to action types and object scopes, not only to raw API routes.

This gives LTBase one consistent answer to:

- can this caller perform this action
- on which object type
- under what filter or ownership constraints

This builds on the existing entity-capability-policy graph rather than replacing it.

### 4.5 Provenance Bindings

Lineage should attach to ontology objects through stable object references:

- object type
- object id
- optional property or version reference

This allows provenance queries to enrich object views without forcing provenance nodes to become ontology nodes.

## 5. Mapping Ontology Onto Existing LTBase Systems

### 5.1 Forma Schema -> Object Types

Use Forma schema as the primary source for:

- object type identity
- core property metadata
- display and search hints
- stable object links derived from explicit schema annotations

Current schema ingestion already extracts entity resources and cross-schema relations. That should evolve into object-type and link-type extraction instead of stopping at generic semantic resources.

### 5.2 Semantic Registry -> Ontology Registry

The current `semantic_resource` and `semantic_relation` tables are a viable bootstrap layer.

Short term:

- keep the existing tables
- extend resource metadata to distinguish ontology concepts
- add clear semantic categories such as `object_type`, `link_type`, `action_type`, `policy_binding`

Long term:

- either keep the generic graph tables if they remain readable and queryable
- or split into dedicated ontology tables if the generic model starts hiding important invariants

### 5.3 Capability Catalog + Planner -> Action Types

Planner inputs should resolve against `ActionType` definitions first.

That changes the planner from:

- "find a template that roughly matches the intent"

to:

- "resolve the intent into an ontology action, then find the executable plan for that action"

This improves determinism, auditability, and permission reasoning.

### 5.4 Governance Graph -> Policy Bindings

The current governance model already links:

- entity -> capability
- policy -> capability

That should be reframed as:

- object type -> action type
- policy -> action type
- optional policy scope -> object filter

This keeps the graph but sharpens the semantics.

### 5.5 Lineage System -> Provenance Layer

The lineage RFC should remain responsible for:

- agent execution trace
- tool and model provenance
- record-to-record derived-from references

It should not become the container for all business semantics.

## 6. Proposed API Surface

Version 1 should stay small.

### 6.1 Ontology Read APIs

- `GET /api/sys/v1/ontology/object-types`
- `GET /api/sys/v1/ontology/object-types/{type_name}`
- `GET /api/sys/v1/ontology/link-types`
- `GET /api/sys/v1/ontology/action-types`

### 6.2 Object Instance Resolution APIs

- `GET /api/sys/v1/ontology/objects/{type_name}/{id}`
- `POST /api/sys/v1/ontology/objects/{type_name}/search`
- `POST /api/sys/v1/ontology/objects/{type_name}/{id}/reachable`

These may initially be thin wrappers over existing Forma and discovery infrastructure.

### 6.3 Governed Action APIs

- `GET /api/sys/v1/ontology/objects/{type_name}/{id}/actions`
- `POST /api/ai/v1/intent-to-action/plans`

The existing planner endpoint can remain, but internally it should resolve through ontology action definitions.

### 6.4 Provenance APIs

- `GET /api/sys/v1/ontology/objects/{type_name}/{id}/provenance`

This should be implemented by joining ontology object references with lineage storage, not by exposing lineage internals as the primary interface.

## 7. Data Model Guidance

LTBase should distinguish three layers:

### 7.1 Semantic Definition Layer

Stable metadata about object types, link types, action types, and policy bindings.

### 7.2 Operational Object Layer

Actual project data instances stored through Forma and other LTBase systems.

### 7.3 Provenance Layer

Execution traces, derived-from edges, and audit references attached to objects.

This separation is important because:

- ontology definitions change slowly
- object instances change constantly
- provenance can grow very quickly and may need separate storage and archival rules

## 8. Rollout Plan

### Phase 1: Clarify Semantics

- introduce the ontology vocabulary in RFCs
- define object, link, action, and policy concepts
- explicitly position lineage as provenance

### Phase 2: Reframe Existing Semantic Tables

- keep current tables and APIs working
- add ontology-oriented metadata and views
- avoid a breaking rename until behavior is stable

### Phase 3: Planner and Governance Convergence

- resolve planner candidates through ontology action types
- bind policy evaluation to ontology actions and object scopes

### Phase 4: Provenance Attachment

- link lineage nodes to ontology object references
- expose object-centric provenance queries

### Phase 5: Rich Application Surfaces

- build object-centric agent experiences
- add curated object views only after the ontology contract is stable

## 9. Non-Goals

This RFC does not propose:

- cloning Foundry UI products
- exposing every schema field as an ontology property
- replacing Forma with a new storage model
- putting provenance data into business object tables
- making the lineage graph the primary semantic abstraction

## 10. Recommendation

LTBase should adopt an ontology-first architecture with lineage attached as provenance.

Concretely:

- keep building on the current `semantic` subsystem
- rename its conceptual role from generic registry to ontology kernel
- treat object types, link types, and action types as first-class concepts
- keep lineage focused on execution provenance and derived-from tracing

This is the smallest path that captures the value of Foundry's ontology model while staying aligned with LTBase's existing architecture and implementation direction.
