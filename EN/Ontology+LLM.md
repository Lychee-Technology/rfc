# From Knowledge Graph to Governance Control Plane: Ontology + LLM Incremental Construction for AI Agent Governance and Compliance

This RFC proposes an architecture pattern for enterprise AI Agent Governance that combines Operational Ontology, LLM-assisted incremental knowledge construction, and Policy-as-Code.

The goal is not to let an LLM govern enterprise agents on its own. The goal is to build an auditable, testable, and evolvable governance compilation pipeline:

- LLMs turn policies, capability boundaries, assets, approval rules, and runtime events into reviewable semantic proposals.
- Humans approve critical facts, interpretations, classifications, and control decisions.
- The Contract & Policy Layer compiles approved obligations, controls, and evidence requirements into executable policy, action, and approval contracts.
- The Governance Control Plane enforces those contracts at agent registration, action execution, data access, external integration, approval, and monitoring boundaries.

The design assumes that LLMs are proposal engines, not authority engines.

---

## 1. Why AI Agent Governance Is Hard

The core problem is that enterprise governance rules are ambiguous, evolving, and cross-domain, while agent behavior must be controlled in ways that are precise, auditable, and enforceable.

Before defining the architecture, this RFC separates two concepts that are often conflated.

### 1.1 AI Governance vs AI Compliance

Governance is the framework for doing the right things. Compliance is the execution discipline for doing things according to rules.

| Dimension | AI Governance | AI Compliance |
| :--- | :--- | :--- |
| Nature | Strategic framework and decision mechanism | Adherence to rules, regulations, standards, and contracts |
| Driver | Internal values, risk appetite, business goals | External law, industry standards, contractual obligations |
| Posture | Proactive and upstream | Verification-oriented and often reactive |
| Scope | Broader: registration, authorization, operation, approval, retirement | Narrower: specific rules, controls, records, and attestations |
| Owners | Board, executives, governance committee, business and technical owners | Legal, compliance, risk, audit teams |
| Outputs | Principles, boundaries, risk tiers, accountability model | Evidence, approval records, audit trails, filings |

The relationship is not peer-to-peer. Compliance is the verifiable execution pillar inside a broader governance framework.

```text
Governance
  - defines principles, risk appetite, and responsibility boundaries
  - includes Compliance as the auditable execution layer
  - also covers what the organization should do even when regulation is silent

Compliance
  - is the minimum verifiable part of Governance execution
  - is measurable, inspectable, and auditable
  - is necessary but not sufficient for sound Governance
```

Organizations that only do compliance tend to optimize for the legal minimum. Organizations that only write governance principles without executable controls stay at the document layer. This RFC addresses the gap between Governance intent and Compliance execution.

In practice, that gap appears as five fractures.

### 1.2 Semantic Fracture

The same agent governance phrase can mean different things to business, engineering, security, and compliance teams.

For example, "allow the agent to send email," "allow the agent to act on behalf of a user," and "allow the agent to call an external payment API" are not equivalent claims. Business cares whether the task is useful. Engineering cares whether the agent has the tool or capability. Security cares about privilege, exfiltration, external effects, and sensitive writes. Compliance cares about approval, records, authorization, and evidence.

A governance system cannot flatten these into one rule table. It must distinguish:

- enterprise-wide prohibited actions
- high-impact actions that require human approval
- capability binding rules
- additional restrictions for vendor agents
- data access boundaries
- runtime incidents, complaints, and anomalies

Semantic alignment for agent governance is therefore not a synonym problem. It requires a shared model for `agent`, `capability`, `action`, `approval`, `evidence`, and `responsibility`.

### 1.3 Evidence Fracture

Agent compliance is not proven by writing a rule. The organization must prove that a specific agent, at a specific time, in a specific context, took or did not take a specific action under the applicable controls.

Statements such as "this agent is read-only," "outbound emails are reviewed," or "the agent cannot access payment data" are not sufficient by themselves. They must be bound to an agent, a configuration version, a capability, an action, an approval record, a trace, and a time window.

Without scoped evidence, common failures include:

- reusing an old approval for a new high-risk action
- applying a read-only authorization to a write operation
- losing the audit trail for a real tool call
- treating a third-party capability statement as an internal verification result

`AuditEvidence` must be a first-class governance object. Logs and screenshots are artifacts, not the evidence model itself.

### 1.4 Execution Fracture

Governance principles usually live in PDFs, wikis, or spreadsheets. Runtime enforcement lives in agent registration, tool invocation, data access, permissioning, external API calls, monitoring systems, and approval workflows.

If a rule only exists in a policy document, it has no runtime force. Engineering teams can forget it, bypass it, misunderstand it, or deploy shadow AI workflows outside the governance path.

The root problem is not lack of rules. Governance statements and compliance gates are different kinds of objects, and most organizations do not have a compilation layer between them.

Example governance statement:

> All AI Agents with external side effects must pass capability checks before executing payments, outbound communication, or data writes, and must receive human approval in high-impact contexts.

To become enforceable, this statement must go through three technical stages.

#### Stage A: Semantic Parsing

The statement is transformed into structured obligations, controls, and evidence requirements.

```text
AgentRule:
  obligation_text: "Agents with external payment capability must not issue refunds without human review"
  obligated_actor_role: INTERNAL_OPERATOR
  applies_to_condition:
    action.category == "external_payment"
  required_controls:
    - HUMAN_APPROVAL
  required_evidence:
    - APPROVAL_RECORD

EnforcementControl:
  control_type: HUMAN_APPROVAL
  enforcement_mode: AUTOMATED
  frequency: EVENT_TRIGGERED
  required_evidence:
    - APPROVAL_RECORD

Relation:
  obligation_requires_control(obl-001 -> ctrl-human-approval)
```

At this point the system has versioned, referenceable semantic objects instead of an isolated policy sentence.

#### Stage B: Contract Compilation

Approved semantic obligations are compiled into executable compliance mechanisms.

Some obligations become Policy Contracts:

```go
var governanceControls = map[string]EvaluatorFunc{
    "evidence_must_be_valid": func(req Request) []Finding {
        // 1. Traverse obligation -> control -> evidence dependencies.
        // 2. Check evidence.status == VALIDATED.
        // 3. Check evidence.scope covers agent, action, and execution_context.
        // 4. Check validity_period and review_due_date.
        // 5. On failure, block or require evidence.
    },
    "approval_required_for_sensitive_action": func(req Request) []Finding {
        // 1. Find ACCEPTED ActionClaims for action_requires_approval.
        // 2. Check the linked ApprovalTask.
        // 3. If missing, require approval.
    },
}
```

Other obligations become Approval Contracts:

```json
{
  "name": "sensitive-agent-action-approval",
  "initialState": "pending_agent_owner",
  "states": {
    "pending_agent_owner": {"name": "agent_owner_approval"},
    "pending_compliance_officer": {"name": "compliance_officer_approval"},
    "approved": {"name": "approved"}
  },
  "transitions": [
    {"from": "pending_agent_owner", "to": "pending_compliance_officer", "event": "approved"},
    {"from": "pending_compliance_officer", "to": "approved", "event": "approved"}
  ]
}
```

Only after this step does the Governance statement become a Compliance mechanism the system can execute.

#### Stage C: Control Plane Enforcement

Contracts must be attached to control points, not just made queryable.

```text
Action Execution Gate:
  - receive an agent action request
  - load accepted claims, applicable obligations, and evidence status
  - evaluate Policy Contracts
  - return DENY, REQUIRE_APPROVAL, REQUIRE_EVIDENCE, or ALLOW

Approval Workflow:
  - create a structured ApprovalTask when approval is required
  - advance workflow state through explicit reviewer events

Audit Trail:
  - record claim creation, claim approval, policy evaluation, approval decision, and action execution
  - keep a replayable accountability chain
```

The architecture in this RFC, `Semantic Governance Graph -> Contract & Policy Layer -> Governance Control Plane`, exists to close this compilation gap.

### 1.5 Evolution Fracture

Agent policy, capability boundaries, vendor constraints, and implementation details keep changing.

A read-only agent may later receive write tools, outbound email, or payment capability. An approval strategy that was valid at deployment time can become invalid after a capability change, vendor change, or policy update.

The governance system must support:

- policy version updates
- source supersession chains
- obligation effective dates
- evidence validity periods
- historical replay at a past point in time
- change impact analysis
- control regression tests

### 1.6 Responsibility Fracture

AI Governance is not a purely technical problem. Different decisions require different accountable roles:

- business purpose: business owner
- capability and tool scope: engineering owner and security owner
- approval requirements: compliance or risk team
- data access boundaries: data owner or DPO
- ethical gray areas and high-impact automation: governance committee
- external side effects and rollback feasibility: engineering owner

If every judgment is encoded as "LLM inferred" or "system classified," the responsibility chain will fail an audit. The system must connect policies, capabilities, agents, evidence, approvals, and execution into a Governance Control Plane.

---

## 2. Two Useful Patterns

This RFC borrows from two patterns and deliberately changes both for enterprise governance.

### 2.1 Operational Ontology

Palantir-style Operational Ontology demonstrates that an enterprise semantic model can be more than a reporting layer. It can become an operational middle layer that combines:

```text
Data x Logic x Action x Security
```

- Data: abstract distributed sources into business objects, properties, and links
- Logic: bind rules, calculations, and models to those objects
- Action: expose side-effecting operations through controlled action entry points
- Security: embed permissions, auditing, and access control into runtime paths

The value is that semantic objects can be acted on, not merely queried. Rules can trigger workflows. Security becomes a runtime constraint instead of an application-layer patch.

The limitation is cost. Platform ontologies usually require heavy modeling, process redesign, and expert-driven implementation. That is expensive when AI regulations, internal policy, and agent practice are still changing quickly.

### 2.2 LLM Incremental Knowledge Construction

Karpathy's LLM Wiki pattern points to a different knowledge-management idea: do less repeated retrieval and synthesis at query time, and instead use LLMs to incrementally compile incoming sources into a durable knowledge structure.

The useful mechanisms are:

- Ingest: extract facts, concepts, evidence, and relationships when new sources arrive
- Query as contribution: persist useful answers back into the knowledge base
- Lint: periodically detect contradictions, outdated content, duplicates, orphan concepts, and coverage gaps

This does not directly solve enterprise compliance. Markdown is not an executable compliance substrate. Enterprise governance needs permissions, evidence chains, approval workflows, regression tests, retention, and audit preservation. It also must distinguish valid, expired, applicable, inapplicable, superseded, proposed, accepted, and rejected knowledge.

The reusable idea is not "LLM writes truth." The reusable idea is "LLM continuously proposes structured changes for human and system review."

### 2.3 Adapt the Pattern, Replace the Substrate, Restrict Authority

The enterprise version replaces the wiki substrate and restricts LLM authority.

| LLM Wiki pattern | Enterprise governance replacement |
| :--- | :--- |
| Markdown knowledge files | Structured governance graph |
| Concept links | Typed relations |
| Query results written back | ActionClaim, AuditEvidence, Case, and MonitoringSignal feedback |
| `log.md` | Tamper-evident event log |
| LLM edits knowledge directly | LLM creates PROPOSED changes through APIs |
| Accumulating knowledge | Controlled evolution, retirement, versioning, and regression tests |

The core rule is simple: LLMs can extract, summarize, match, suggest, and draft, but they cannot grant legal authority, directly change production state, or bypass human approval for high-impact side effects.

---

## 3. Architecture

The proposed architecture has three layers.

```text
Sources
  -> Semantic Governance Graph
  -> Contract & Policy Layer
  -> Governance Control Plane
```

### 3.1 System View

```text
Sources
  - enterprise agent policies
  - capability bindings and tool policies
  - approval chains, escalation rules, retention rules
  - agent inventory, tool registry, data scopes
  - approval records, audit logs, capability snapshots
  - tool calls, incidents, complaints

Semantic Governance Graph
  - PolicyConcept, ActionClaim, AgentRule, EnforcementControl, AuditEvidence
  - RegisteredAgent, AgentConfigVersion, CapabilityScope, AgentExecution
  - jurisdiction, temporal validity, source authority
  - LLM may only create PROPOSED changes
  - high-impact claims, rules, and controls require human review
  - all changes enter the Governance Event Log

Contract & Policy Layer
  - Policy Contracts: ALLOW, DENY, REQUIRE_APPROVAL, REQUIRE_EVIDENCE
  - Action Contracts: input, output, side effects, idempotency, compensation
  - Approval Contracts: approval chains, escalation, evidence requests
  - Regression Tests: historical replay, evidence tests, blast-radius analysis

Governance Control Plane
  - Agent Registration Gate
  - Action Execution Gate
  - Data Access Gate
  - Human Approval Workflow
  - Execution Audit Log
  - Runtime Monitoring
  - Writeback Adapters
```

### 3.2 Design Principles

1. Semantic evolution must be controlled.
   The graph can ingest policies, assets, and events continuously, but core concepts, obligations, controls, and high-impact claims must be reviewed, versioned, and regression-tested.

2. LLMs propose, they do not authorize.
   LLMs may create `PROPOSED` ActionClaims, AgentRules, or Contract drafts. Only authorized roles can approve objects for executable use.

3. The Contract & Policy Layer is the only path to side effects.
   Semantic judgments cannot directly mutate production systems. Actions must pass through contracts with schemas, permissions, side-effect declarations, audit strategy, idempotency, and failure handling.

4. Control plane coverage is measured, not assumed.
   No enterprise can honestly claim total coverage across shadow AI, vendor tools, manual processes, and legacy systems. The governance system should measure coverage and improve it over time.

5. Evidence and time are first-class objects.
   Compliance decisions must include evidence, scope, validity, jurisdiction, and historical traceability.

6. Governance and Compliance are compiled through layers.
   Governance defines principles and responsibility boundaries. Compliance compiles approved requirements into verifiable, testable, and auditable contracts.

### 3.3 Mapping to LTBase and LTFlow

The design can be implemented incrementally on the existing LTBase/LTFlow foundation.

```text
Semantic Governance Graph
  -> ltbase.api/internal/semantic
  -> PostgreSQL semantic_resource / semantic_relation
  -> Forma schema + entity storage

Contract & Policy Layer
  -> compliance_evaluator / ComplianceProfile
  -> planning_service / planning_types
  -> LTFlow workflow definitions

Governance Control Plane
  -> ltbase.api HTTP handlers + tool registry
  -> LTFlow runtime + task/history APIs
  -> ltbase-controlplane-ui
  -> DynamoDB AuditRecord + external writeback adapters
```

This means the first implementation should not start by introducing a new graph database, a new policy engine, or a full BPM platform. The pragmatic path is to reuse the existing semantic layer, compliance evaluator, workflow runtime, search stack, control plane, and UI, then add governance-specific extensions.

The current constraints are also clear:

- the operational graph should start as PostgreSQL + Forma, not Neo4j or Neptune
- policy decisions should begin as extensions to `compliance_evaluator`, not a new Rego or Cedar runtime
- approval should use LTFlow before adopting Temporal or Camunda-style systems
- the UI should extend the existing control plane before becoming a separate governance product

---

## 4. Semantic Governance Graph

The semantic layer is organized around the agent control chain: sources, rules, controls, evidence, claims, agents, executions, and approvals.

### 4.1 Source Authority

Sources should not be ranked with a single hard-coded ordering such as "law > guidance > standard > internal policy > user report." Real authority is multidimensional.

```text
SourceAuthority:
  legal_force:
    BINDING | CONTRACTUAL | CERTIFICATION_REQUIRED | ADVISORY | INTERNAL

  issuer_authority:
    LEGISLATOR | REGULATOR | STANDARD_BODY | COMPANY | VENDOR | USER

  jurisdiction_scope:
    EU | US | UK | GLOBAL | INTERNAL | CUSTOM

  enforcement_risk:
    HIGH | MEDIUM | LOW

  effective_date: date
  expiry_date: date?
  supersession_chain: SourceRef[]
```

This model can express laws, regulatory guidance, internal policies stricter than external standards, contractual duties that only apply to a specific customer, and old policies superseded by new versions.

### 4.2 Core Objects

The main chain is:

```text
Source -> AgentRule -> EnforcementControl -> AuditEvidence -> ActionClaim -> Policy / Action
```

#### GovernancePolicySource

```text
GovernancePolicySource:
  id: UUID
  name: string
  source_type:
    INTERNAL_POLICY | CONTRACT | STANDARD_OPERATING_RULE |
    VENDOR_REQUIREMENT | CASE_RECORD | USER_REPORT
  authority: SourceAuthority
  jurisdiction: string[]
  effective_date: date
  expiry_date: date?
  supersedes: SourceRef?
  canonical_uri: string?
  source_hash: string
```

#### PolicyConcept

```text
PolicyConcept:
  id: UUID
  name: string
  canonical_definition: text
  organization_interpretation: text?
  source_refs: SourceRef[]
  status: DRAFT | ACTIVE | DEPRECATED | CONFLICT | FROZEN
  valid_from: timestamp
  valid_until: timestamp?
  semantic_version: string
```

LLMs should not rewrite `canonical_definition` freely. They may propose changes to `organization_interpretation`, but every change must preserve source binding and semantic diff.

#### ActionClaim

`ActionClaim` is the central reviewable assertion object. Many governance facts are not static facts; they are judgments with scope, evidence, authority, and accountability.

```text
ActionClaim:
  id: UUID
  claim_type:
    FACTUAL | LEGAL_INTERPRETATION | ACTION_CLASSIFICATION |
    CONTROL_DECISION | EVIDENCE_ASSESSMENT
  subject: ObjectRef
  predicate: string
  object: ObjectRef | literal
  authority_level:
    LLM_INFERRED | SME_REVIEWED | COMPLIANCE_APPROVED |
    LEGAL_APPROVED | BOARD_APPROVED
  status:
    PROPOSED | ACCEPTED | REJECTED | SUPERSEDED | EXPIRED
  jurisdiction: string[]
  confidence: float
  evidence_refs: EvidenceRef[]
  reasoning: text
  approved_by_role:
    DataOwner | SystemOwner | ComplianceOfficer |
    LegalCounsel | DPO | EthicsBoard | SecurityOwner
  approval_basis: EvidenceRef[]
  decision_record: ApprovalTaskRef?
  valid_from: timestamp
  valid_until: timestamp?
  transaction_time: timestamp
```

Example:

```text
ActionClaim:
  claim_type: ACTION_CLASSIFICATION
  subject: AgentRefundAssistant
  predicate: action_requires_approval
  object: external_payment_refund
  jurisdiction: ["INTERNAL"]
  authority_level: LLM_INFERRED
  status: PROPOSED
  evidence_refs:
    - capability/payment_write
    - tool/refund_api
  reasoning:
    "The agent has payment write capability, and the action has an external financial side effect."
```

The LLM may create this claim. The claim cannot affect production behavior until it is `ACCEPTED` at the required `authority_level`.

#### AgentRule

Obligations must bind to accountable actor roles, not just to systems.

```text
AgentRule:
  id: UUID
  source: SourceRef
  obligation_text: text
  obligated_actor_role:
    PROVIDER | DEPLOYER | IMPORTER | DISTRIBUTOR |
    PRODUCT_MANUFACTURER | AUTHORIZED_REPRESENTATIVE | INTERNAL_OPERATOR
  applies_to_system_condition: Condition
  applies_to_use_case_condition: Condition
  obligation_trigger: Condition
  jurisdiction: string[]
  applicability_phase: string
  effective_date: date
  expiry_date: date?
  required_controls: ControlRef[]
  required_evidence: EvidenceType[]
```

The same agent can create different duties under different execution contexts and actor roles.

#### EnforcementControl

```text
EnforcementControl:
  id: UUID
  name: string
  control_type:
    PRE_EXECUTION_REVIEW | CAPABILITY_BINDING | HUMAN_OVERSIGHT |
    LOGGING | DATA_GOVERNANCE | EXTERNAL_ACTION_REVIEW |
    RUNTIME_MONITORING | INCIDENT_RESPONSE
  owner: RoleRef
  frequency: ONCE | PERIODIC | CONTINUOUS | EVENT_TRIGGERED
  enforcement_mode: MANUAL | SEMI_AUTOMATED | AUTOMATED
  required_evidence: EvidenceType[]
  mapped_obligations: ObligationRef[]
```

#### AuditEvidence

Evidence is not an attachment. It is scoped, verifiable, expirable, and auditable.

```text
AuditEvidence:
  id: UUID
  artifact_type:
    CAPABILITY_SNAPSHOT | APPROVAL_RECORD | TOOL_EXECUTION_LOG |
    MONITORING_REPORT | INCIDENT_REPORT | HUMAN_APPROVAL_NOTE
  evidence_status:
    SUBMITTED | VALIDATED | REJECTED | EXPIRED | SUPERSEDED
  evidence_quality:
    SELF_ASSERTED | SYSTEM_GENERATED | THIRD_PARTY_AUDITED | REGULATOR_ACCEPTED
  scope:
    system_id: string
    agent_version: string?
    action_id: string?
    execution_session: string?
    jurisdiction: string[]
  storage_ref: string
  hash: string
  signature: string?
  signed_by: string?
  reviewed_by: string?
  reviewed_at: timestamp?
  created_at: timestamp
  validity_period: duration?
  review_due_date: timestamp?
  retention_class: string
  contains_personal_data: boolean
  confidentiality_level: PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
```

This avoids the mistake of treating "there is a log" as equivalent to "the action is compliant."

### 4.3 Object Relationships and Lifecycle

The core relationship cardinality is:

```text
Source (1) --< (N) AgentRule (N) >-- (N) EnforcementControl
                      |                         |
                      | required_evidence       | required_evidence
                      v                         v
                 AuditEvidence (N) <------------+
                      ^
                      | evidence_refs
                 ActionClaim (N)
```

- One source may create many AgentRules.
- One AgentRule may require many EnforcementControls; one EnforcementControl may satisfy many AgentRules.
- One ActionClaim may reference many AuditEvidence objects; one AuditEvidence object may support many ActionClaims.
- Evidence requirements on AgentRules and EnforcementControls may overlap but are not automatically identical.

State transitions are append-only:

| Object | Transition | Trigger |
| :--- | :--- | :--- |
| ActionClaim | PROPOSED -> ACCEPTED | authorized reviewer approval |
| ActionClaim | PROPOSED -> REJECTED | authorized reviewer rejection |
| ActionClaim | ACCEPTED -> SUPERSEDED | new claim replaces prior claim |
| ActionClaim | ACCEPTED -> EXPIRED | `valid_until` passes |
| AuditEvidence | SUBMITTED -> VALIDATED | evidence review succeeds |
| AuditEvidence | VALIDATED -> EXPIRED | validity period or review due date expires |
| AuditEvidence | VALIDATED -> SUPERSEDED | newer evidence replaces it |
| AgentRule | ACTIVE -> DEPRECATED | source is replaced or retired |
| AgentRule | ACTIVE -> EXPIRED | `expiry_date` passes |

Historical versions remain available through `transaction_time`.

### 4.4 Agent Assets and Execution Context

Governance cannot operate on an abstract "AI system" alone. It needs concrete agents, configuration versions, capabilities, execution sessions, resources, and responsibility boundaries.

```text
RegisteredAgent:
  id: UUID
  name: string
  owner: RoleRef
  business_process: string?
  intended_purpose: text
  provider_type: INTERNAL | THIRD_PARTY | HYBRID
  lifecycle_stage: EXPERIMENTAL | DEVELOPMENT | VALIDATION | DEPLOYED | RETIRED
  trust_level: SANDBOXED | INTERNAL_APPROVED | PRIVILEGED | RESTRICTED

AgentConfigVersion:
  id: UUID
  agent_id: string
  version: string
  tool_refs: ToolRef[]
  capability_refs: CapabilityRef[]
  prompt_profile_ref: string?
  release_date: date

CapabilityScope:
  id: UUID
  name: string
  resource_types: string[]
  allowed_actions: string[]
  forbidden_actions: string[]
  requires_approval_for: string[]

AgentExecution:
  id: UUID
  agent_id: RegisteredAgentRef
  config_version: AgentConfigVersionRef
  environment: DEV | STAGING | PRODUCTION
  caller_identity: string
  target_resource: string?
  action_name: string
  started_at: timestamp
  trace_id: string

ExecutionContext:
  actor_type: USER | AGENT | SERVICE
  sensitivity: LOW | MEDIUM | HIGH | CRITICAL
  data_scope: string[]
  external_side_effect: boolean
  human_approval_required: boolean
```

### 4.5 Time Semantics

Auditors often ask: at the time this agent requested this action, what did we know, what rules applied, who approved what, and what evidence existed?

Key nodes and edges should support bitemporal semantics.

```text
Temporal Model:
  valid_time:
    the period when a fact or rule is true in the real world
  transaction_time:
    the immutable time when the system recorded it
  effective_date:
    when a regulation, policy, control, or obligation becomes active
  review_due_date:
    when evidence, approval, or control review is due
```

Architecture examples should not hard-code policy effective dates. Real systems should model them by policy clause, obligation class, actor role, and applicability phase.

### 4.6 Property Graph First, RDF/SKOS/SHACL at the Boundary

The operational graph should start as a Property Graph because it is more natural for enterprise object modeling, application development, and runtime queries.

```text
Operational graph:
  - registered agent
  - agent config version
  - agent execution
  - claim
  - evidence
  - obligation
  - approval task
```

Regulatory vocabulary, standards, and cross-organization exchange still benefit from RDF, SKOS, and SHACL.

```text
Interoperability boundary:
  - standard vocabulary
  - concept hierarchy
  - constraint validation
  - cross-organization exchange
```

For LTBase, "Property Graph" should initially mean `semantic_resource` + `semantic_relation` + Forma entity payload, not a default commitment to Neo4j or Neptune.

```text
semantic_resource / semantic_relation:
  - lightweight nodes and relations
  - traversal, impact analysis, coverage calculation
  - Concepts, Claims, Obligations, Controls index layer

Forma entity:
  - detailed payloads, versioned fields, complex evidence scope
  - AuditEvidence, ExecutionContext, ApprovalTask, MonitoringSignal

External interoperability layer:
  - RDF / SKOS / SHACL export, import, and validation
```

The known gaps are:

- `semantic_resource` has too few `ResourceKind` and `RelationKind` values for governance
- PostgreSQL is acceptable for operational traversal but not ideal for complex regulatory reasoning at scale
- LTBase does not yet have an RDF/SKOS/SHACL mapping and validation layer

### 4.7 LLM Operation Interface

LLMs should not edit storage directly. They should call structured governance APIs that enforce schema validation, permissions, source tracking, consistency constraints, and state transitions.

```go
type GovernanceService interface {
    CreateConceptProposal(ctx context.Context, req CreateConceptProposalRequest) (*PolicyConcept, error)
    CreateClaim(ctx context.Context, req CreateClaimRequest) (*ActionClaim, error)
    CreateObligationProposal(ctx context.Context, req CreateObligationProposalRequest) (*AgentRule, error)
    AttachEvidence(ctx context.Context, req AttachEvidenceRequest) (*AuditEvidence, error)
    FindApplicableObligations(ctx context.Context, req ApplicableObligationsRequest) ([]AgentRule, error)
    FindEvidenceGaps(ctx context.Context, req EvidenceGapRequest) ([]EvidenceGap, error)
    FindAcceptedClaims(ctx context.Context, subject, predicate string) ([]ActionClaim, error)
    FindExpiredEvidence(ctx context.Context) ([]AuditEvidence, error)
    FindUnreviewedClaims(ctx context.Context, olderThanDays int) ([]ActionClaim, error)
    CheckContractSync(ctx context.Context) ([]SyncGap, error)
}
```

For LTBase, this should be implemented as LTAgent tools backed by Go service APIs, not as direct LLM database writes.

Current gaps:

- LTAgent does not yet include a governance tool set
- Gemini integration exists, but multi-provider abstraction is not first-class
- governance-grade ingestion needs stronger citation validation, semantic diffing, and contradiction linting

---

## 5. Semantic Supply Chain Security

LLM risk is not just hallucination. In governance systems, semantic supply chain risk is often more serious:

- polluted sources
- outdated regulatory versions
- prompt injection
- low-authority sources contaminating high-authority concepts
- reused erroneous claims
- semantic drift
- bad contracts published to the control plane

### 5.1 Source Governance

```text
Source Governance:
  - source allowlist
  - source hash
  - issuer verification
  - jurisdiction tagging
  - effective date tracking
  - supersession detection
```

User reports and incident records can enter as `CASE_RECORD` or `USER_REPORT`, but they cannot directly modify legal concepts or obligation definitions.

### 5.2 Quarantine State

New LLM-ingested content starts quarantined.

```text
status = PROPOSED
authority_level = LLM_INFERRED
executable = false
```

Only authorized review can promote it to:

```text
status = ACCEPTED
authority_level = COMPLIANCE_APPROVED | LEGAL_APPROVED | BOARD_APPROVED
```

### 5.3 Prompt Injection Controls

Unstructured sources should be filtered before entering the LLM pipeline.

```text
Ingestion Security:
  - prompt-injection scanning
  - instruction stripping
  - source segmentation
  - model output validation
  - citation requirement
```

Any ActionClaim that cannot be traced to a source must not become `ACCEPTED`.

### 5.4 Semantic Drift Controls

Incremental construction can slowly move concepts away from their original meaning. Controls should include:

```text
Semantic Drift Controls:
  - canonical definition lock
  - semantic diff
  - source-bound sections
  - periodic re-grounding
  - contradiction budget
  - frozen state for high-conflict concepts
```

Critical concepts should separate:

```text
canonical_definition:
  source-grounded summary of a law, standard, or formal policy

organization_interpretation:
  internal interpretation, mapping, and control practice
```

LLMs may suggest changes to the organization interpretation. They should not rewrite the canonical definition.

### 5.5 Governance Event Log

This RFC distinguishes two tamper-evident logs:

- Governance Event Log: records semantic graph changes such as ActionClaim creation, AgentRule approval, EnforcementControl changes, and AuditEvidence state transitions.
- Execution Audit Log: records control-plane decisions such as policy evaluations, approvals, side effects, compensations, and action outcomes.

Both can share integrity mechanisms, but they serve different audit questions.

```text
GovernanceEventLogEntry:
  event_id: evt-20260602-001
  type: CLAIM_CREATED
  target: claim/refund-assistant-v2-external-payment-refund
  actor: llm-agent-governance-v2
  timestamp: 2026-06-02T14:23:17Z
  transaction_time: 2026-06-02T14:23:17Z
  payload:
    subject: RefundAssistant_v2
    predicate: action_requires_approval
    object: external_payment_refund
    authority_level: LLM_INFERRED
    status: PROPOSED
  source_trigger: ingest/deploy-record/2026-06-02
  prev_hash: sha256:...
  signature: ...
```

Implementation should use:

```text
- append-only event store
- hash chain
- signed timestamp
- WORM storage / object lock
- independent access audit
```

The claim is not "absolute immutability." The goal is that post-hoc modification is detectable, traceable, and auditable.

For LTBase, current DynamoDB `AuditRecord` is useful for short- and medium-term operational auditing, but governance-grade event preservation still needs hash chaining, object lock/WORM strategy, an independent ledger, and a unified event model for claims, evidence, approvals, and rule changes.

---

## 6. Contract & Policy Layer

The execution layer splits contracts into three tracks.

```text
Contract & Policy Layer
  - Policy Contracts
  - Action Contracts
  - Approval Contracts
```

### 6.1 Policy Contract

Policy Contracts answer:

- is the action allowed
- is it blocked
- does it require approval
- does it require more evidence
- which obligations apply
- which controls are required

Example. The string constants below stand in for ActionClaim object values for readability. A production implementation should use semantic IDs and graph lookups rather than hard-coded string literals.

```go
func EvaluateSensitiveAgentAction(req GovernancePolicyRequest) GovernancePolicyDecision {
    riskClaims := findAcceptedClaims(req.Agent.ID, "action_requires_approval")
    riskClaim := firstClaimObject(riskClaims)

    if riskClaim == "forbidden_external_action" {
        return GovernancePolicyDecision{Decision: "DENY"}
    }

    if riskClaim == "external_payment_refund" {
        requiredEvidence := []string{
            "APPROVAL_RECORD",
            "CAPABILITY_SNAPSHOT",
            "TOOL_EXECUTION_LOG",
        }
        if missing := findMissingEvidence(req.ExistingEvidence, requiredEvidence); len(missing) > 0 {
            return GovernancePolicyDecision{
                Decision:         "REQUIRE_EVIDENCE",
                EvidenceRequired: missing,
            }
        }
        if !req.ApprovalState.SensitiveActionApproved {
            return GovernancePolicyDecision{
                Decision:    "REQUIRE_APPROVAL",
                Obligations: []string{"human_approval", "execution_logging", "caller_accountability"},
            }
        }
    }

    return GovernancePolicyDecision{Decision: "ALLOW"}
}
```

Critical boundary: Policy Contracts may reference only approved ActionClaims. `PROPOSED` LLM output cannot trigger production side effects.

For LTBase, the first practical implementation should extend `compliance_evaluator.go` and `ComplianceProfile` instead of introducing Rego or Cedar immediately.

```text
Existing capability:
  - allow / warn / block decisions
  - control-id based evaluators
  - selectors and profile configuration

Governance extensions:
  - action_claim_must_be_accepted
  - audit_evidence_must_be_valid
  - agent_rule_must_be_current
  - approval_required_for_sensitive_action
  - required_evidence_present
```

Known gaps:

- intermediate decisions such as `REQUIRE_APPROVAL` and `REQUIRE_EVIDENCE`
- cross-object evaluation across AgentRule, AuditEvidence, and ActionClaim
- blast-radius analysis and policy regression testing
- governance-friendly contract authoring instead of Go-only evaluator changes

### 6.2 Action Contract

Action Contracts define executable operations: input, output, side effects, permissions, idempotency, transaction model, and compensation.

```go
type GovernanceActionContract struct {
    ID                string
    Version           string
    RequiredRoles     []string
    InputSchema       string
    TransactionModel  string
    IdempotencyFormat string
    Effects           []ActionEffect
    Compensations     []CompensationAction
}
```

Single-transaction state changes can use ACID. Cross-system side effects such as JIRA, Slack, CI/CD, IAM, an agent registry, or a data catalog need Saga, idempotency keys, compensation actions, and outbox/reconciler patterns.

In LTBase this maps to:

- `planning_service` / `PlanStep` for deciding whether an action should enter execution
- tool registry for side-effecting calls
- LTFlow for stateful, compensating, or human-in-the-loop action chains

Known gaps:

- standardized side-effect declarations
- unified idempotency, outbox, and compensation framework
- external writeback reconciler and dead-letter handling
- compatibility and rollback model for Action version upgrades

### 6.3 Approval Contract

Approval workflows should be modeled independently from Policy and Action Contracts.

```go
approvalDef := ltflow.Definition{
    Name:         "sensitive-agent-action-approval",
    Version:      "v1",
    InitialState: "pending_agent_owner",
    States: map[string]ltflow.StateConfig{
        "pending_agent_owner":        {Name: "pending_agent_owner"},
        "pending_compliance_officer": {Name: "pending_compliance_officer"},
        "pending_security_owner":     {Name: "pending_security_owner"},
        "approved":                   {Name: "approved"},
        "rejected":                   {Name: "rejected"},
    },
}
```

This separation allows approval chains to be reused by multiple policies or actions, and allows approval changes without rewriting action contracts.

LTFlow is the natural starting point because it already has state machine definitions, event-driven transitions, task/history models, idempotent start, and replay reads.

Known gaps:

- quorum approvals, parallel countersignature, proxy approval, dynamic reviewer addition
- evidence panels, blast-radius view, and precedent comparison in the control plane UI
- SLA escalation, reviewer workload balancing, and governance-grade audit preservation

### 6.4 Contract Regression Tests

Contract changes must be tested before release.

```text
Contract Regression Suite:
  1. Historical case replay
  2. Golden set tests
  3. Agent rule coverage tests
  4. Audit evidence requirement tests
  5. Negative tests
  6. Blast-radius tests
  7. Policy monotonicity tests
```

Required invariants:

```text
PROPOSED ActionClaim -> must not trigger Action
EXPIRED AuditEvidence -> must not satisfy evidence requirement
SUPERSEDED AgentRule -> must not execute as a current obligation
```

### 6.5 Versioning

| Change type | Version impact | Requirement |
| :--- | :--- | :--- |
| wording fix | patch | no migration |
| optional parameter | minor | regression test |
| new evidence requirement | minor or major | blast-radius analysis |
| changed trigger condition | minor or major | historical replay |
| changed side effect | major | migration plan and human approval |
| changed approval chain | minor or major | responsibility review |

---

## 7. Governance Control Plane

The control plane is not a single isolated engine. It is a set of controlled gates across the AI Agent lifecycle and execution path.

### 7.1 Coverage

The system should measure control-plane coverage rather than claim that nothing can bypass it.

```text
Control Plane Coverage =
  governed agents, execution paths, and data access paths
  /
  actual enterprise agents, execution paths, and data access paths
```

Key gates:

```text
Agent Registration Gate:
  check capability boundaries, owners, and initial constraints during registration or capability change

Action Execution Gate:
  evaluate Policy Contracts before executing an action

Data Access Gate:
  check data category, purpose, and responsibility boundary before sensitive reads or writes

Procurement Gate:
  verify vendor claims, auditability, and contract constraints before onboarding third-party agents

Human Approval Workflow:
  create structured approval tasks with evidence, obligations, controls, and impact scope

Execution Audit Log:
  record judgments, approvals, policy results, and side effects

Runtime Monitoring:
  detect anomalous behavior, complaints, and incidents after deployment
```

For LTBase this is an extension of the existing control plane:

- `ltbase.api` provides gate APIs and governance write entry points
- `planning_service` provides pre-action decisions
- LTFlow provides approval and long transaction orchestration
- `ltbase-controlplane-ui` provides the governance workspace
- `ltbase-ts` exposes governance APIs to external consoles and scripts

Known gaps:

- no native registered agent inventory or capability registry yet
- Data Access Gate and Procurement Gate are not yet implemented as governance control points
- Security & Compliance UI is not yet productized
- coverage metrics and reporting are still missing

### 7.2 GovernanceActionEngine

```go
type GovernanceActionEngine struct {
    authz    AuthorizationService
    policy   GovernancePolicyService
    workflow *ltflow.Client
    audit    AuditRecorder
    tools    ToolExecutor
}

func (e *GovernanceActionEngine) Execute(ctx context.Context, actionID string, input GovernanceActionInput, caller Caller) (any, error) {
    contract := loadGovernanceContract(actionID)
    if err := e.authz.Check(ctx, caller, contract.RequiredRoles); err != nil {
        return nil, err
    }
    validated, err := validateGovernanceInput(contract.InputSchema, input)
    if err != nil {
        return nil, err
    }
    decision, err := e.policy.Evaluate(ctx, contract.ID, validated, caller)
    if err != nil {
        return nil, err
    }
    if decision.Decision == "DENY" {
        e.audit.RecordDenied(ctx, actionID, caller, decision)
        return nil, ErrPolicyDenied
    }
    if decision.Decision == "REQUIRE_APPROVAL" || decision.Decision == "REQUIRE_EVIDENCE" {
        return e.workflow.StartOrResume(ctx, "sensitive-agent-action-approval", decision.IdempotencyKey, mustJSON(decision))
    }
    result, err := e.tools.ExecuteContractEffects(ctx, contract, validated)
    if err != nil {
        return nil, err
    }
    if err := e.audit.RecordSuccess(ctx, actionID, caller, validated, result, decision); err != nil {
        return nil, err
    }
    return result, nil
}
```

In LTBase this should not be treated as a brand-new kernel. It should be a facade over existing authorization, validation, compliance evaluation, LTFlow, tool execution, and audit/event logging.

### 7.3 Human-in-the-Loop

Approval tasks should be structured governance objects, not email threads.

```text
ApprovalTask #2026-0312

agent:
  RefundAssistant_v2

execution_context:
  action: external_payment_refund
  target_resource: payment/txn-2026-0312
  caller: agent/refund-assistant-v2
  environment: PRODUCTION

triggering_claim:
  ActionClaim #claim-2026-0847
  claim_type: ACTION_CLASSIFICATION
  predicate: action_requires_approval
  object: external_payment_refund
  status: ACCEPTED

evidence_status:
  ok capability snapshot
  ok tool execution request
  missing approval record
  missing operator confirmation

applicable_obligations:
  - high-impact external actions require human approval
  - sensitive data access requires responsibility boundary confirmation
  - all external side effects require audit logging

approval_chain:
  AgentOwner -> ComplianceOfficer -> SecurityOwner

actions:
  approve | approve with conditions | reject | request evidence
```

Reviewers need evidence, applicable obligations, precedent, and blast radius, not just a yes/no prompt.

### 7.4 Execution Audit Log

The Execution Audit Log records control-plane decisions and side effects. It is separate from the Governance Event Log described in section 5.5.

```text
ExecutionAuditLog:
  storage: append-only event store
  integrity: hash chain / Merkle proof
  authentication: signed timestamp
  persistence: WORM storage / object lock
  governance: retention policy, legal hold, independent access audit
  privacy: pseudonymization, field-level encryption, separation of immutable metadata and erasable personal data
```

When audit retention conflicts with privacy deletion, prefer pseudonymization, field-level encryption, and key destruction over deleting audit events.

LTBase's current DynamoDB audit store has a default TTL, which is useful for operational audit and debugging but not sufficient for long-term regulatory preservation. Governance needs to separate operational audit records from audit preservation.

---

## 8. Runtime Monitoring

Governance should not stop at pre-execution approval. Agent capabilities, behavior, tool paths, complaints, and policies change after deployment.

### 8.1 Signals

```text
MonitoringSignal:
  - abnormal action frequency
  - repeated approval bypass attempts
  - sensitive data access anomaly
  - user complaint
  - incident report
  - human override rate
  - approval rejection rate
  - policy change impact
  - capability change
  - intended purpose change
```

### 8.2 Feedback Loop

```text
MonitoringSignal
  -> ActionClaim update / AuditEvidence expiry / EnforcementControl escalation
  -> Policy re-evaluation
  -> ApprovalTask / ActionRiskRecord / action pause
```

Example:

```text
If an agent triggers repeated high-risk external action requests within 24 hours:
  1. Create MonitoringSignal.
  2. Mark the approval baseline as potentially stale.
  3. Create a PROPOSED ActionClaim:
       agent_may_no_longer_satisfy_sensitive_action_control
  4. Re-evaluate capability and approval requirements.
  5. If risk is high, create ApprovalTask, reduce capability, or pause the action.
```

### 8.3 Detection Thresholds

Monitoring should use aggregated patterns, not isolated events.

| Signal | Detection strategy | Example threshold |
| :--- | :--- | :--- |
| abnormal action frequency | sliding-window count | more than 5 high-risk actions per hour for one agent |
| approval bypass attempts | count with time decay | more than 3 retries after DENY within 24 hours |
| sensitive data anomaly | baseline deviation | more than 3 standard deviations over 7-day baseline |
| approval rejection rate | rolling ratio | more than 40 percent rejection over 30 days |
| human override rate | rolling ratio | more than 50 percent increase over 30 days |

Thresholds should be configurable and jurisdiction-aware. Alerts can be `INFO`, `WARNING`, or `CRITICAL`. Only `CRITICAL` should trigger automatic re-evaluation.

### 8.4 Automatic Re-evaluation

```text
1. MonitoringSignal enters a queue.
2. The system recomputes applicable obligations and evidence validity.
3. Policy Engine re-evaluates current capability and execution history.
4. Results are classified:
   - NO_CHANGE: record audit only
   - EVIDENCE_EXPIRED: expire evidence and notify owner
   - RISK_INCREASED: create PROPOSED ActionClaim and consider capability reduction
   - CRITICAL_RISK: pause action and create urgent ApprovalTask
5. Re-evaluation results enter the Governance Event Log.
```

Re-evaluation itself should not silently mutate production state. High-risk pauses or downgrades should pass through Approval Contracts unless an emergency policy explicitly permits temporary containment.

---

## 9. End-to-End Scenario: High-Impact Refund Action

### 9.1 Event

The operations team prepares `RefundAssistant_v2` to execute an external refund on behalf of customer support.

### 9.2 Semantic Ingestion

The LLM Agent reads a capability snapshot, tool request, and execution context, then creates a structured proposal.

```go
claim, err := governanceService.CreateClaim(ctx, CreateClaimRequest{
    Subject:   "RefundAssistant_v2",
    Predicate: "action_requires_approval",
    Object:    "external_payment_refund",
    ClaimType: "ACTION_CLASSIFICATION",
    EvidenceRefs: []string{
        "capability/payment_write",
        "tool/refund_api",
        "execution_context/refund_request_2026_06_02",
    },
    Jurisdiction: []string{"INTERNAL"},
    Reasoning:    "The agent has payment write capability and the action has an external financial side effect.",
})
```

The service sets:

```text
authority_level = LLM_INFERRED
status = PROPOSED
executable = false
```

### 9.3 Human Review of the ActionClaim

The SystemOwner confirms the factual claim: the agent requested a refund action and has the relevant tool/capability.

The ComplianceOfficer confirms the risk classification:

```text
claim_type = ACTION_CLASSIFICATION
subject = RefundAssistant_v2
predicate = action_requires_approval
object = external_payment_refund
authority_level = COMPLIANCE_APPROVED
status = ACCEPTED
```

If legal interpretation is disputed, LegalCounsel may add `LEGAL_APPROVED`.

This approval is about the correctness of the ActionClaim. It is not approval for this specific execution. Execution approval happens later through the Approval Contract.

### 9.4 Contract Evaluation

The accepted ActionClaim triggers the `flag-sensitive-agent-action` Action Contract. The Policy Engine returns:

```text
decision = REQUIRE_APPROVAL

obligations:
  - human approval
  - execution logging
  - caller accountability

evidence_required:
  - APPROVAL_RECORD
  - CAPABILITY_SNAPSHOT
  - TOOL_EXECUTION_LOG
```

### 9.5 Control Plane Execution

The GovernanceActionEngine executes cross-system side effects as a Saga.

```text
1. UPDATE AgentExecution.status = UNDER_REVIEW
2. UPDATE RegisteredAgent.last_sensitive_action = external_payment_refund
3. CREATE ApprovalTask #2026-0312
4. CREATE AuditRecord for execution request
5. CREATE JIRA ticket for missing approval evidence
6. NOTIFY AgentOwner + ComplianceTeam
7. APPEND Execution Audit Log entry with hash chain
```

If JIRA creation succeeds but agent state update fails, the system uses compensation or reconciliation instead of pretending there is a global ACID transaction.

### 9.6 Execution Approval and Conditional Approval

At this stage the ComplianceOfficer and SecurityOwner approve the execution itself, not the ActionClaim classification.

The ComplianceOfficer approves with conditions:

```text
This refund requires a second operator confirmation and full approval evidence retention.
```

The SecurityOwner approves execution but requires monitoring:

```text
- repeated refund request monitoring
- approval rejection rate monitoring
- complaint escalation workflow
```

The system creates follow-up obligations:

```text
RecordOperatorConfirmation(due=1h)
PersistApprovalEvidence(due=1h)
CreateRefundExecutionAudit(due=1h)
SetupRuntimeMonitoring(frequency=daily)
```

### 9.7 Knowledge Feedback

Execution results and evidence write back to the semantic layer.

```go
_, err = governanceService.AttachEvidence(ctx, AttachEvidenceRequest{
    TargetID:    "claim-2026-0847",
    EvidenceRef: "approval_record/2026-0312",
    Scope: map[string]any{
        "agent_id":              "RefundAssistant_v2",
        "action_id":             "external_payment_refund",
        "jurisdiction":          []string{"INTERNAL"},
        "execution_environment": "PRODUCTION",
    },
})
```

If LegalCounsel did not participate, the ActionClaim must not be labeled `LEGAL_APPROVED`.

---

## 10. Responsibility Boundaries

| Object / decision | Layer | LLM | System API | Engineering Owner | Compliance | Legal | Ethics Board |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| governance rule extraction | Governance | propose | validate format/source | - | review control mapping | review legal interpretation | - |
| system purpose confirmation | Governance | extract candidate | record evidence | confirm facts | review impact | - | - |
| ActionClaim classification | Governance -> Compliance | propose | manage state | provide evidence | approve classification | approve if needed | participate in high-impact cases |
| AuditEvidence quality | Compliance | extract candidate | validate scope | provide artifact | verify sufficiency | review if needed | - |
| Policy Contract | Compliance | draft | test/version | review executable impact | review control logic | review obligation mapping | - |
| Action Contract | Compliance | draft | execution validation | review side effects | review governance impact | - | - |
| Approval Task | Compliance | generate context | route and audit | provide evidence | decide | participate if needed | high-risk ethical judgment |

This boundary is what makes the system credible under audit.

---

## 11. Failure Modes and Mitigations

### 11.1 LLM Misclassifies Action Risk

Mitigations:

```text
- ActionClaim defaults to PROPOSED
- unapproved ActionClaim cannot trigger Action
- golden set tests
- human review for high-impact classifications
```

### 11.2 Policy Source Is Outdated

Mitigations:

```text
- supersession chain
- effective_date / expiry_date
- periodic re-grounding
- source hash verification
```

### 11.3 Evidence Expires But Agent Still Appears Compliant

Mitigations:

```text
- AuditEvidence validity_period
- review_due_date
- evidence scope check
- expired evidence lint
```

### 11.4 External Writeback Fails

Mitigations:

```text
- Saga pattern
- idempotency key
- compensation action
- outbox pattern
- manual reconciliation queue
```

### 11.5 Policy Change Impacts Too Many Agents

Mitigations:

```text
- blast-radius analysis
- staged rollout
- historical case replay
- approval before major version release
```

### 11.6 Reviewer Rubber-Stamping

Mitigations:

```text
- required reasoning
- random sampling audit
- second-line review
- high-risk dual approval
- reviewer workload monitoring
```

### 11.7 Shadow AI Is Outside the Control Plane

Mitigations:

```text
- procurement integration
- network / usage discovery
- expense and SaaS inventory scan
- data access monitoring
- employee reporting channel
```

### 11.8 Governance and Compliance Drift Apart

Mitigations:

```text
- Governance Statement -> AgentRule -> EnforcementControl -> AuditEvidence -> Action compilation chain
- every high-impact governance principle maps to at least one executable Contract
- every key Compliance control traces back to a Governance source
- review cases that are compliant but still high-risk
- write governance committee conclusions back into the semantic and contract layers
```

---

## 12. LTBase / LTFlow Capability Mapping and Gaps

| Layer | Required capability | Reusable LTBase / LTFlow capability | Gap |
| :--- | :--- | :--- | :--- |
| semantic operations | PolicyConcept, ActionClaim, AgentRule, EnforcementControl, AuditEvidence graph | `internal/semantic`, PostgreSQL `semantic_resource` / `semantic_relation`, Forma | missing governance schema and richer relation kinds |
| rule semantics | vocabularies, constraints, exchange | Forma + semantic metadata | no RDF/SKOS/SHACL mapping or validator |
| retrieval | policy, evidence, precedent, graph search | LTSearch, LTEmbed | no governance citation or precedent UX |
| LLM Agent | ingest, propose, lint, diff | Gemini integration, LTAgent runtime, LTFlow `ltflow.llm` activity | no governance tool set; multi-provider not first-class |
| policy | allow / deny / require_approval / require_evidence | `compliance_evaluator`, `ComplianceProfile` | no intermediate governance decisions or cross-object evaluation |
| action | side-effect contract, idempotency, compensation | `planning_service`, tool registry, handlers | no governance action runtime or reconciler |
| workflow | approvals, evidence requests, escalation, replay | LTFlow state machine, task/history | advanced approval patterns missing |
| audit | tamper-evident governance audit | DynamoDB `AuditRecord` | no hash chain, WORM/object lock, long-term ledger |
| console | governance workspace | `ltbase-controlplane-ui`, `ltbase-ts` | Security & Compliance UI not productized |
| monitoring | behavior anomaly and policy impact | LTSearch, DuckDB, LTFlow timers | no MonitoringSignal model or auto re-evaluation flow |
| integration | JIRA, Slack, CI/CD, IAM writeback | tools, webhooks, adapter pattern | no unified adapter contract or compensation framework |

LTBase and LTFlow already provide the skeleton:

- semantic foundation
- agent and LLM orchestration
- compliance evaluator
- state machine workflow
- control plane API and UI
- search, vector, and embedding capability

They are sufficient for the first phase of an AI Governance control plane, but not yet a complete governance product.

### 12.1 Backlog

| Priority | Module | Goal | Main gap |
| :--- | :--- | :--- | :--- |
| P0 | Governance schema pack | define ActionClaim, AgentRule, EnforcementControl, AuditEvidence, ApprovalTask, MonitoringSignal | missing domain model |
| P0 | Governance policy extensions | add governance controls and intermediate decisions to compliance evaluator | missing REQUIRE_APPROVAL / REQUIRE_EVIDENCE |
| P0 | ActionClaim review workflow | review, evidence request, approval, rejection chain on LTFlow | missing governance workflow template |
| P0 | Governance service facade | aggregate semantic, policy, workflow, and audit APIs | current call chain is scattered |
| P1 | Governance UI workspace | evidence gaps, approval inbox, blast radius, precedent view | Security & Compliance UI is placeholder |
| P1 | Governance audit ledger | append-only event log with hash chain and retention | no long-term immutable ledger |
| P1 | Action / Data / Procurement gates | enforce contracts at key runtime paths | no unified gate contract |
| P2 | Governance retrieval layer | policy, case, and evidence search | missing precedent/citation experience |
| P2 | Advanced approvals | quorum, parallel approval, delegation, SLA escalation | LTFlow core is lower-level |
| P2 | RDF/SKOS/SHACL mapping | vocabulary exchange and semantic validation | no mapping or validation implementation |

Recommended delivery waves:

```text
Wave 1:
  - Governance schema pack
  - Governance service facade
  - Governance policy extensions
  - ActionClaim review workflow

Wave 2:
  - Governance UI workspace
  - Governance audit ledger
  - Action / Data / Procurement gates

Wave 3:
  - Governance retrieval layer
  - Advanced approvals
  - RDF / SKOS / SHACL mapping
```

Wave 1 connects semantic objects, policy decisions, and review workflow. Wave 2 connects them to real control points and adds UI/audit. Wave 3 handles heavier interoperability and advanced workflow capabilities.

### 12.2 Key Engineering Risks

Run PoCs before committing to full implementation for:

- Governance audit ledger: hash chains across DynamoDB and an independent ledger may require an event store or purpose-built lightweight ledger.
- Saga / compensation framework: external systems such as JIRA, Slack, and IAM do not share one compensation model; adapters and reconcilers need validation.
- Blast-radius analysis: the PostgreSQL semantic layer may not be enough for complex multi-hop analysis at real scale.
- RDF/SKOS/SHACL mapping: vocabulary construction and constraint authoring can be much larger than expected; defer or stage if customer need is not immediate.

---

## 13. Implementation Roadmap

### Phase 0: Control Plane Inventory, 2-4 Weeks

Outputs:

```text
- agent asset inventory baseline
- inventory of registration, execution, data access, approval, and monitoring systems
- top 3 highest-risk use cases
- 10-20 machine-enforceable controls
- current evidence artifacts and approval flows
- control plane coverage baseline
```

### Phase 1: Read-Only Semantic Layer, 2-3 Months

Build the graph without automatic execution.

```text
- Source / AgentRule / EnforcementControl / AuditEvidence / ActionClaim models
- policy constraint -> control -> evidence mappings
- agent asset and execution context graph
- AuditEvidence gap analysis
- LLM ingest + PROPOSED ActionClaim flow
- LTBase governance schema pack on Forma + semantic types
```

### Phase 2: Semi-Automated Review, 2-3 Months

Add Policy Contracts, Approval Contracts, and governance audit, but do not directly mutate production systems yet.

```text
- 3-5 core Policy Contracts
- structured ApprovalTask
- tamper-evident audit/event logs
- ActionClaim review workflow
- Contract regression suite
- LTFlow approval workflow templates and initial control plane UI
```

### Phase 3: Limited Writeback, 2-3 Months

Attach strong controls to well-defined execution points.

```text
- Agent Registration Gate
- Action Execution Gate
- Data Access Gate
- Saga / outbox / compensation mechanisms
- external integrations: JIRA, Slack, CI/CD, IAM
- coverage monitoring
- GovernanceActionEngine facade
```

### Phase 4: Lifecycle Closure, Continuous

Extend governance after deployment.

```text
- Runtime Monitoring
- AuditEvidence expiry automation
- anomaly / rejection-rate triggered re-evaluation
- policy change impact analysis
- Shadow AI discovery
- multi-business-line and multi-jurisdiction expansion
- LTSearch / LTEmbed-driven precedent and policy impact retrieval
```

---

## 14. Conclusion

The hard problem in AI Agent Governance is not asking an LLM what a policy means. The hard problem is turning evolving governance knowledge into an auditable, testable, and executable enterprise control plane.

Operational Ontology shows that business semantics can become part of operational systems. LLM incremental knowledge construction shows how new sources can continuously update a durable knowledge structure. Neither pattern is sufficient by itself for enterprise compliance.

This RFC combines them with clear authority boundaries:

- LLMs generate structured proposals from policies, capabilities, assets, evidence, and events.
- The Semantic Governance Graph stores PolicyConcepts, ActionClaims, AgentRules, EnforcementControls, AuditEvidence, and execution context.
- Humans approve critical facts, legal interpretations, action classifications, and control decisions.
- The Contract & Policy Layer compiles approved obligations and controls into Policy, Action, and Approval Contracts.
- The Governance Control Plane enforces those contracts at registration, execution, data access, approval, and monitoring boundaries.
- Tamper-evident logs, regression tests, evidence validity, and failure-mode controls preserve trust.

With LTBase and LTFlow, this does not require starting from a blank platform. The existing semantic layer, agent orchestration, workflow engine, search stack, control plane API, and UI provide enough foundation for a first-phase governance control plane.

The current stack is a practical foundation, not a finished enterprise governance product. Governance schemas, policy runtime extensions, audit ledger, advanced approvals, governance UI, writeback adapters, and monitoring loops still require focused implementation.

The architecture should therefore be understood not as an automatic compliance solution, but as a pattern for compiling governance knowledge into an executable control plane.

The objective is to let governance evolve at the speed of AI Agents and enterprise policy while preserving reliability, auditability, and accountable human judgment.
