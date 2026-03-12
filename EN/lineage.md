# AI Agent Data Lineage Technical Specification

## 1. Overview

This document defines the complete technical design for AI Agent data lineage in the LTBase platform. The lineage system captures data flows automatically at the framework layer without requiring any manual instrumentation in business code.

The storage layer uses LTBase's native hot-cold tiered architecture: hot data is written to AWS DSQL, flushed to S3 Parquet via CDC, and cold-data graph queries are executed by LadybugDB. Lineage data does not enter the business EAV tables; it associates with business entity versions through explicit references.

## 2. Core Challenges

AI Agent data lineage is more complex than traditional ETL:

| Challenge | Description |
| :--- | :--- |
| Non-determinism | LLM outputs are not reproducible — the same input may produce different results |
| Multi-hop reasoning | Data passes through multiple tools and sub-agents, creating long causal chains |
| Implicit transformation | LLM internal reasoning is opaque; lineage can only be captured at boundaries |
| Concurrent execution | Lineage can break across parallel agents; a global trace ID is required to reconnect it |

## 3. Core Data Structures

### 3.1 LineageNode

Each piece of data carries an immutable lineage metadata package:

```go
type SourceType string

const (
	SourceUserInput     SourceType = "user_input"
	SourceToolCall      SourceType = "tool_call"
	SourceLLMInference  SourceType = "llm_inference"
	SourceDBQuery       SourceType = "db_query"
	SourceAgentDispatch SourceType = "agent_dispatch"
)

type TransformType string

const (
	TransformExtraction    TransformType = "extraction"
	TransformAggregation   TransformType = "aggregation"
	TransformGeneration    TransformType = "generation"
	TransformFilter        TransformType = "filter"
	TransformOrchestration TransformType = "orchestration"
)

// LineageNode is an immutable lineage metadata package — once written it cannot be modified.
type LineageNode struct {
	NodeID      uuid.UUID         `json:"node_id"`
	ParentIDs   []uuid.UUID       `json:"parent_ids"`
	CreatedAtMs int64             `json:"created_at_ms"`

	SourceType    SourceType      `json:"source_type"`
	SourceDetail  json.RawMessage `json:"source_detail,omitempty"`

	TransformType   TransformType   `json:"transform_type"`
	TransformParams json.RawMessage `json:"transform_params,omitempty"`

	AgentID   string    `json:"agent_id"`
	SessionID uuid.UUID `json:"session_id"`
	TraceID   uuid.UUID `json:"trace_id"`
}
```

### 3.2 TrackedData

All data flowing through an Agent is wrapped in `TrackedData`; lineage travels with the data rather than being passed separately:

```go
// TrackedData wraps a business value together with its lineage metadata.
type TrackedData struct {
	Value      any         `json:"value"`
	Lineage    LineageNode `json:"lineage"`
	Confidence float64     `json:"confidence"` // < 1.0 for LLM-generated output
}
```

## 4. Automatic Capture at the Framework Layer

Lineage is recorded at the framework layer and is completely transparent to business code. The three capture points below cover every data-transformation boundary.

### 4.0 Design Rationale and Capture Mechanism

**Why not manual instrumentation in business code**

Traditional data lineage approaches require developers to call lineage APIs explicitly in business functions — every read, transform, and write must be annotated. This creates three problems: (1) high coupling between business logic and lineage infrastructure; changing the lineage record format requires touching all business code; (2) easy to miss — lineage completeness depends on developer discipline, and any new tool or Agent added without instrumentation breaks the chain; (3) in AI Agent scenarios, LLM calls, tool dispatches, and sub-agent communications are frequent and dynamically routed, making manual instrumentation practically unmaintainable.

**How the framework achieves automatic capture**

The core idea is to funnel all data transformations through a small number of framework-level boundaries and intercept them uniformly:

- **Tool execution boundary**: Business code invokes tools through `ToolExecutor.Execute`. The framework automatically constructs lineage nodes before and after `toolFn` executes. The business-side `toolFn` only needs to handle business logic with no awareness of lineage.
- **LLM inference boundary**: All LLM calls are issued through `LineageAwareLLM.Infer`. The framework records metadata — model name, prompt hash, temperature — at the black-box boundary. The LLM's internal reasoning is opaque, but the lineage nodes for its inputs and outputs are fully captured.
- **Agent dispatch boundary**: `Orchestrator.Dispatch` wraps all sub-agent calls. The framework automatically writes dispatch nodes when tasks are sent and results are collected, and propagates `TraceID` to sub-agents to keep the cross-agent lineage chain intact.

**TrackedData: lineage flows with data**

The three interception points connect seamlessly because of one key mechanism: `TrackedData`. Business values and lineage metadata are packed in the same struct and passed together — lineage naturally travels with data without requiring global context injection or manual propagation. Each capture point reads parent node IDs from the input `TrackedData`, writes a new lineage node, and attaches the new node to the output `TrackedData`, forming a complete directed acyclic graph.

### 4.1 Tool Execution Layer

```go
// LineageStore defines the lineage persistence interface.
type LineageStore interface {
	SaveNode(ctx context.Context, node LineageNode) error
	SaveEdges(ctx context.Context, parentIDs []uuid.UUID, childID uuid.UUID, traceID uuid.UUID, sessionID uuid.UUID) error
}

type ToolExecutor struct {
	store LineageStore
}

func (e *ToolExecutor) Execute(
	ctx context.Context,
	toolName string,
	inputs []TrackedData,
	toolFn func(ctx context.Context, args ...any) (any, error),
	agentID string,
	sessionID, traceID uuid.UUID,
) (TrackedData, error) {
	// Extract business values
	args := make([]any, len(inputs))
	for i, d := range inputs {
		args[i] = d.Value
	}

	result, err := toolFn(ctx, args...)
	if err != nil {
		return TrackedData{}, err
	}

	// Build lineage node
	parentIDs := make([]uuid.UUID, len(inputs))
	for i, d := range inputs {
		parentIDs[i] = d.Lineage.NodeID
	}

	node := LineageNode{
		NodeID:        uuid.Must(uuid.NewV7()),
		ParentIDs:     parentIDs,
		CreatedAtMs:   time.Now().UnixMilli(),
		SourceType:    SourceToolCall,
		SourceDetail:  mustMarshal(map[string]any{"tool_name": toolName}),
		TransformType: TransformExtraction,
		AgentID:       agentID,
		SessionID:     sessionID,
		TraceID:       traceID,
	}

	if err := e.store.SaveNode(ctx, node); err != nil {
		return TrackedData{}, err
	}
	if err := e.store.SaveEdges(ctx, parentIDs, node.NodeID, traceID, sessionID); err != nil {
		return TrackedData{}, err
	}

	return TrackedData{Value: result, Lineage: node, Confidence: 1.0}, nil
}
```

### 4.2 LLM Inference Layer

The LLM is a black box; only structured metadata at the boundary can be recorded. Prompts are stored as hashes rather than raw text:

```go
type LLMClient interface {
	Complete(ctx context.Context, prompt string) (string, error)
	ModelName() string
	Temperature() float64
}

type LineageAwareLLM struct {
	llm   LLMClient
	store LineageStore
}

func (l *LineageAwareLLM) Infer(
	ctx context.Context,
	promptTemplate string,
	contextData []TrackedData,
	agentID string,
	sessionID, traceID uuid.UUID,
) (TrackedData, error) {
	prompt := renderPrompt(promptTemplate, contextData)

	response, err := l.llm.Complete(ctx, prompt)
	if err != nil {
		return TrackedData{}, err
	}

	parentIDs := make([]uuid.UUID, len(contextData))
	for i, d := range contextData {
		parentIDs[i] = d.Lineage.NodeID
	}

	h := sha256.Sum256([]byte(prompt))

	node := LineageNode{
		NodeID:      uuid.Must(uuid.NewV7()),
		ParentIDs:   parentIDs,
		CreatedAtMs: time.Now().UnixMilli(),
		SourceType:  SourceLLMInference,
		SourceDetail: mustMarshal(map[string]any{
			"model":            l.llm.ModelName(),
			"prompt_hash":      hex.EncodeToString(h[:]),
			"prompt_template":  promptTemplate,
			"temperature":      l.llm.Temperature(),
		}),
		TransformType: TransformGeneration,
		AgentID:       agentID,
		SessionID:     sessionID,
		TraceID:       traceID,
	}

	if err := l.store.SaveNode(ctx, node); err != nil {
		return TrackedData{}, err
	}
	if err := l.store.SaveEdges(ctx, parentIDs, node.NodeID, traceID, sessionID); err != nil {
		return TrackedData{}, err
	}

	return TrackedData{Value: response, Lineage: node, Confidence: 0.85}, nil
}
```

### 4.3 Multi-Agent Lineage Propagation

Lineage follows `TrackedData` across Agent boundaries; `TraceID` threads through the entire call chain:

```go
// AgentMessage is the carrier for inter-agent communication.
type AgentMessage struct {
	SenderID   string      `json:"sender_id"`
	ReceiverID string      `json:"receiver_id"`
	Payload    TrackedData `json:"payload"`
	TraceID    uuid.UUID   `json:"trace_id"`
}

type Agent interface {
	Run(ctx context.Context, msg AgentMessage) (TrackedData, error)
}

type Orchestrator struct {
	agentID string
	store   LineageStore
}

func (o *Orchestrator) Dispatch(
	ctx context.Context,
	task TrackedData,
	subAgent Agent,
	subAgentID string,
	sessionID uuid.UUID,
) (TrackedData, error) {
	msg := AgentMessage{
		SenderID:   o.agentID,
		ReceiverID: subAgentID,
		Payload:    task,
		TraceID:    task.Lineage.TraceID,
	}

	result, err := subAgent.Run(ctx, msg)
	if err != nil {
		return TrackedData{}, err
	}

	// Orchestrator layer records the dispatch node.
	// Parent: the task node dispatched to the sub-agent.
	// The result node (result.Lineage.NodeID) is already a child inside the sub-agent.
	node := LineageNode{
		NodeID:        uuid.Must(uuid.NewV7()),
		ParentIDs:     []uuid.UUID{task.Lineage.NodeID},
		CreatedAtMs:   time.Now().UnixMilli(),
		SourceType:    SourceAgentDispatch,
		SourceDetail:  mustMarshal(map[string]string{"sub_agent": subAgentID}),
		TransformType: TransformOrchestration,
		AgentID:       o.agentID,
		SessionID:     sessionID,
		TraceID:       task.Lineage.TraceID,
	}

	if err := o.store.SaveNode(ctx, node); err != nil {
		return TrackedData{}, err
	}
	if err := o.store.SaveEdges(ctx, node.ParentIDs, node.NodeID, node.TraceID, sessionID); err != nil {
		return TrackedData{}, err
	}

	return TrackedData{Value: result.Value, Lineage: node, Confidence: result.Confidence}, nil
}
```

## 5. Storage Architecture

Lineage data does not enter the business Forma entity tables (`entity_main` / `eav_data`). Instead it uses four dedicated physical tables that mirror the Entity Main + EAV layering philosophy of LTBase without pushing graph structures into the business EAV.

```text
┌──────────────────────────────────────────────────────────────┐
│ Hot write + online query                    AWS DSQL          │
│  lineage_node_main  — node header (similar to Entity Main)   │
│  lineage_edge       — DAG parent-child edges                  │
│  lineage_entity_ref — references to business entity versions  │
│  lineage_node_ext   — large / sensitive fields (EAV-like)    │
├──────────────────────────────────────────────────────────────┤
│ CDC buffer                           lineage_change_log       │
│  → Smart Flushing (reuses LTBase OLAP threshold mechanism)   │
├──────────────────────────────────────────────────────────────┤
│ Cold storage + historical graph query        S3 Parquet       │
│  nodes / edges / refs / ext as four independent datasets      │
│  → LadybugDB maps them as node table + relationship table    │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 Hot Table Design

#### lineage_node_main

```sql
CREATE TABLE lineage_node_main (
    project_id         UUID             NOT NULL,
    node_id            UUID             NOT NULL,   -- UUID v7 for time locality
    trace_id           UUID             NOT NULL,
    session_id         UUID             NOT NULL,
    agent_id           TEXT             NOT NULL,
    source_type        TEXT             NOT NULL,   -- 'user_input' | 'tool_call' | 'llm_inference' | 'db_query' | 'agent_dispatch'
    transform_type     TEXT             NOT NULL,
    created_at_ms      BIGINT           NOT NULL,
    confidence         DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    primary_schema_id  SMALLINT,                    -- optional: associated primary business schema
    primary_row_id     UUID,                        -- optional: associated primary business row
    status_flags       BIGINT           NOT NULL DEFAULT 0,
    flush_watermark_ms BIGINT           NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, node_id)
);

CREATE INDEX idx_node_trace   ON lineage_node_main (project_id, trace_id, created_at_ms);
CREATE INDEX idx_node_session ON lineage_node_main (project_id, session_id, created_at_ms);
CREATE INDEX idx_node_entity  ON lineage_node_main (project_id, primary_schema_id, primary_row_id, created_at_ms DESC);
CREATE INDEX idx_node_flush   ON lineage_node_main (project_id, flush_watermark_ms, created_at_ms);
```

#### lineage_edge

```sql
CREATE TABLE lineage_edge (
    project_id         UUID   NOT NULL,
    parent_node_id     UUID   NOT NULL,
    child_node_id      UUID   NOT NULL,
    edge_type          TEXT   NOT NULL,   -- 'derived_from' | 'used_by' | 'orchestrated'
    trace_id           UUID   NOT NULL,
    session_id         UUID   NOT NULL,
    created_at_ms      BIGINT NOT NULL,
    flush_watermark_ms BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, parent_node_id, child_node_id)
);

CREATE INDEX idx_edge_child  ON lineage_edge (project_id, child_node_id);
CREATE INDEX idx_edge_parent ON lineage_edge (project_id, parent_node_id);
CREATE INDEX idx_edge_trace  ON lineage_edge (project_id, trace_id, created_at_ms);
```

#### lineage_entity_ref

Links lineage nodes to LTBase business entities (`schema_id` / `row_id` / `attr_id`). The same business entity version can participate in multiple traces:

```sql
CREATE TABLE lineage_entity_ref (
    project_id           UUID     NOT NULL,
    node_id              UUID     NOT NULL,
    ref_role             TEXT     NOT NULL,   -- 'read_set' | 'write_set' | 'source_ref' | 'output_ref' | 'change_ref'
    schema_id            SMALLINT NOT NULL,
    row_id               UUID     NOT NULL,
    attr_id              INTEGER,
    entity_version_ts_ms BIGINT,
    change_event_id      UUID,
    snapshot_hash        TEXT,
    created_at_ms        BIGINT   NOT NULL,
    flush_watermark_ms   BIGINT   NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, node_id, ref_role, schema_id, row_id, attr_id, entity_version_ts_ms)
);

CREATE INDEX idx_ref_entity ON lineage_entity_ref (project_id, schema_id, row_id, created_at_ms DESC);
CREATE INDEX idx_ref_change ON lineage_entity_ref (project_id, change_event_id);
```

#### lineage_node_ext

Stores prompt hashes, sampled input snapshots, tool parameters, SQL digests, and other low-frequency or sensitive data:

```sql
CREATE TABLE lineage_node_ext (
    project_id         UUID   NOT NULL,
    node_id            UUID   NOT NULL,
    ext_type           TEXT   NOT NULL,   -- 'prompt_detail' | 'input_sample' | 'tool_params' | 'sql_digest'
    payload_json       JSONB  NOT NULL,
    payload_size       BIGINT NOT NULL,
    encryption_class   TEXT   NOT NULL DEFAULT 'default',
    created_at_ms      BIGINT NOT NULL,
    flush_watermark_ms BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, node_id, ext_type)
);
```

### 5.2 CDC and Smart Flushing

The business `change_log` is designed around `schema_id + row_id` and is not suited to carry the four distinct shapes of node / edge / ref / ext data. Lineage uses a dedicated CDC envelope:

```sql
CREATE TABLE lineage_change_log (
    project_id         UUID   NOT NULL,
    source_table       TEXT   NOT NULL,   -- 'node_main' | 'edge' | 'entity_ref' | 'node_ext'
    entity_key         TEXT   NOT NULL,   -- serialized logical primary key of the row
    op_type            TEXT   NOT NULL,   -- 'I' | 'D'  (lineage is insert-only or soft-delete)
    changed_at_ms      BIGINT NOT NULL,
    flush_watermark_ms BIGINT NOT NULL DEFAULT 0,
    payload_json       JSONB  NOT NULL,
    PRIMARY KEY (project_id, source_table, entity_key, changed_at_ms)
);
```

Flush trigger conditions reuse LTBase OLAP principles:

- Accumulated record count > 20,000 **or** oldest unflushed record > 1 hour
- Write Delta Parquet to S3 and mark `flush_watermark_ms`

### 5.3 Cold Storage Layout (S3 Parquet)

```text
s3://<bucket>/lineage/nodes/project_id=<id>/date_hour=<yyyy-mm-dd-hh>/*.parquet
s3://<bucket>/lineage/edges/project_id=<id>/date_hour=<yyyy-mm-dd-hh>/*.parquet
s3://<bucket>/lineage/refs/project_id=<id>/date_hour=<yyyy-mm-dd-hh>/*.parquet
s3://<bucket>/lineage/ext/project_id=<id>/date_hour=<yyyy-mm-dd-hh>/*.parquet
```

| Principle | Description |
| :--- | :--- |
| Partition key | `project_id` + `date_hour` |
| Pruning columns | `trace_id`, `session_id`, `schema_id`, `row_id` retained as file columns |
| Large field isolation | `payload_json` appears only in the `ext` dataset; main datasets stay narrow |
| Compression | ZSTD, consistent with business Parquet |
| Compaction strategy | Merge-on-read; edge dataset applies duplicate suppression and tombstone handling |

### 5.4 LadybugDB Cold Query Mapping

LadybugDB can map external Parquet files directly as node / relationship tables without importing them:

```cypher
-- Map nodes
CREATE NODE TABLE LineageNode (
    node_id STRING, project_id STRING, trace_id STRING,
    session_id STRING, agent_id STRING, source_type STRING,
    created_at_ms INT64, confidence DOUBLE,
    PRIMARY KEY (node_id)
) WITH (storage='s3://.../lineage/nodes/**/*.parquet');

-- Map edges
CREATE REL TABLE DerivedFrom (FROM LineageNode TO LineageNode, edge_type STRING)
    WITH (storage='s3://.../lineage/edges/**/*.parquet');

-- Deep ancestor query
MATCH (target:LineageNode {node_id: $nodeId})<-[:DerivedFrom*]-(ancestor)
RETURN ancestor.node_id, ancestor.source_type, ancestor.created_at_ms
ORDER BY ancestor.created_at_ms;

-- Impact analysis
MATCH (source:LineageNode {node_id: $nodeId})-[:DerivedFrom*]->(descendant)
RETURN descendant.node_id, descendant.source_type;
```

## 6. Query Path Design

Queries are tiered by "recency + fan-out", not by query language.

### 6.1 Trace Timeline

- Entry: `project_id + trace_id`
- Hits `idx_node_trace` index, ordered by `created_at_ms`
- Optionally joins `lineage_entity_ref` to annotate business objects
- Engine: AWS DSQL

### 6.2 Bounded Ancestor Traversal

- Entry: `project_id + node_id`
- Recursive CTE walks `child_node_id → parent_node_id` upward
- Depth limit is mandatory

```sql
WITH RECURSIVE ancestry AS (
    SELECT e.parent_node_id, e.child_node_id, 1 AS depth
    FROM lineage_edge e
    WHERE e.project_id = $1
      AND e.child_node_id = $2

    UNION ALL

    SELECT e.parent_node_id, e.child_node_id, a.depth + 1
    FROM lineage_edge e
    JOIN ancestry a ON e.project_id = $1
                   AND e.child_node_id = a.parent_node_id
    WHERE a.depth < 10  -- online depth guardrail
)
SELECT n.*
FROM ancestry a
JOIN lineage_node_main n ON n.project_id = $1
                        AND n.node_id = a.parent_node_id
ORDER BY n.created_at_ms DESC;
```

- Engine: AWS DSQL

### 6.3 Bounded Impact Analysis

- Entry: `project_id + node_id`
- Walks `parent_node_id → child_node_id` downward
- Maps to affected entities via `lineage_entity_ref`
- Fan-out limit must be stricter than ancestor traversal
- Engine: AWS DSQL

### 6.4 Business Entity Provenance

- Entry: `project_id + schema_id + row_id`, optional `attr_id`
- Queries `lineage_entity_ref` to find lineage nodes → joins `lineage_node_main`
- Non-recursive; this is the primary entry point from a LTBase business object into the lineage graph
- Engine: AWS DSQL

### 6.5 Deep Historical Graph Query

- Entry: historical sessions, cross-trace, high fan-out
- LadybugDB performs full-graph traversal on cold Parquet
- Can cooperate with DuckDB for mixed graph + wide-table analysis
- Engine: LadybugDB

### 6.6 Query Routing Strategy

| Condition | Route |
| :--- | :--- |
| Recent + shallow + trace-local | AWS DSQL |
| Historical + cross-session + high fan-out | LadybugDB |
| Exceeds online threshold | Auto-downgrade to cold path |

Online protection thresholds:

| Parameter | Recommended Value |
| :--- | :--- |
| Max traversal depth | 10 |
| Max edge count | 1,000 |
| Max time window | 7 days |
| Hit archived partition | Route directly to cold path |

## 7. Architecture Overview

```text
User Input
    │  [LineageNode: source=user_input]
    ▼
Orchestrator Agent
    │  [trace_id generated, propagated end-to-end]
    ├──► Tool Executor ──► DB/API
    │         │  [node + edge + entity_ref]
    │         ▼
    ├──► LLM Inference
    │         │  [node + edge + ext]
    │         ▼
    └──► Sub Agent
              │  [trace_id propagated]
              ▼
       AWS DSQL (Hot)
              │  lineage_node_main / lineage_edge
              │  lineage_entity_ref / lineage_node_ext
              ▼
       lineage_change_log
              │  Smart Flushing (>20k rows || >1h)
              ▼
       S3 Parquet (Cold)
              │  nodes / edges / refs / ext
              ▼
       LadybugDB Graph Query
```

## 8. Design Principles

| Principle | Approach |
| :--- | :--- |
| Immutability | `LineageNode` cannot be modified once written; only append or compensating nodes are allowed |
| Automatic capture | Lineage is completed at the framework layer (Tool / LLM / Dispatch boundaries); business code has no awareness |
| End-to-end trace_id | Unified tracking across agents and services |
| Graph structures as first-class data | Edges and entity references are first-class tables, not embedded in business EAV |
| Hot-cold tiering | Online queries go to DSQL; deep historical graph queries go to LadybugDB |
| Query guardrails | Online recursion must limit depth, edge count, and time window |
| Input sampling | Only necessary snapshots are retained; large objects are stored as digests or hashes |
| Confidence propagation | LLM-generated data carries a `confidence` score; path-level aggregation is computed at query time |
| Privacy protection | Prompts default to SHA-256 hash storage; sensitive payloads are stored in encrypted ext records |

## 9. Integration with the Existing LTBase Architecture

### 9.1 With EAV + Entity Main

- Business data continues to use `entity_main_<project_id>` + `eav_data_<project_id>`
- Lineage data is stored independently — graph traversal semantics are not pushed into business tables
- Association is achieved through `lineage_entity_ref`, not by copying data between systems

### 9.2 With change_log / OLAP

- Reuses the CDC + Smart Flushing + merge-on-read architectural approach
- Uses a lineage-dedicated CDC envelope rather than forcing reuse of the business `change_log` row shape
- Cold storage follows the same Parquet + Base/Delta + periodic compaction pattern

### 9.3 With LadybugDB

- LadybugDB is not on the hot path
- It handles cold-data graph traversal, historical auditing, and high fan-out analysis
- Supports mapping Parquet files directly as external node/relationship tables without importing them

## 10. Schema-Driven Declarative Lineage

### 10.1 Design Rationale

The operational lineage capture in Section 4 records the **AI Agent's execution process**: which tool was called, which LLM performed inference, which sub-agent was dispatched. These nodes answer the question "who produced this record."

In Forma's JSON Schema, however, relationships between models are already explicitly declared via `$ref` (see `JSON-Schema-Ext.md`). When an `ai_note` record is written, its `source_doc_id` field references the `document` model — this relationship is statically known from the schema and does not require the AI Agent to instrument it at runtime.

The goal of declarative lineage is to intercept these relationships at the **Forma CRUD write layer** and automatically generate lineage edges, complementing operational lineage:

| Dimension | Operational Lineage (Section 4) | Declarative Lineage (this section) |
| :--- | :--- | :--- |
| Capture point | Tool / LLM / Dispatch boundaries | Forma CRUD write interceptor |
| Capture target | AI inference and tool execution process | Record-to-record relationships declared via schema `$ref` fields |
| Trigger | AI Agent execution | Any Forma Create / Update operation |
| Question answered | Who (which Agent/LLM) wrote this record | Which records does this record depend on in the data model |
| `source_type` | `tool_call` / `llm_inference` / etc. | `schema_relation` (new value) |

Both lineage layers share the storage structure from Section 5 and are joined at query time via `lineage_entity_ref(schema_id, row_id)`.

### 10.2 JSON Schema Extension: `x-lineage-role`

An optional annotation `x-lineage-role` is added to `$ref` fields to declare the semantic role of the reference in lineage. **Only fields with this annotation trigger lineage capture** — `$ref` fields without the annotation are treated as plain foreign keys and do not generate lineage edges.

```json
// ai_note.schema.json
{
  "type": "object",
  "properties": {
    "id": { "$ref": "#/$defs/id" },
    "source_doc_id": {
      "$ref": "document.schema.json#/$defs/id",
      "x-lineage-role": "derived_from"
    },
    "reference_id": {
      "$ref": "document.schema.json#/$defs/id",
      "x-lineage-role": "source"
    },
    "category_id": {
      "$ref": "category.schema.json#/$defs/id"
      // no annotation → pure FK membership, no lineage edge generated
    }
  },
  "x-unique-property": "id"
}
```

`x-lineage-role` value semantics, mapped to [W3C PROV-O](https://www.w3.org/TR/prov-o/) standard predicates:

| Value | Meaning | PROV-O mapping | Generates lineage edge |
| :--- | :--- | :--- | :--- |
| `derived_from` | This record was transformed, processed, or generated from the referenced record — an explicit data transformation exists | [`prov:wasDerivedFrom`](https://www.w3.org/TR/prov-o/#wasDerivedFrom) | Yes |
| `source` | The referenced record is the original information source (raw material); the current record is a processed or organized product, but the referenced record itself was not transformed | [`prov:hadPrimarySource`](https://www.w3.org/TR/prov-o/#hadPrimarySource) | Yes |
| (no annotation) | Pure structural membership (FK) with no data-flow semantics | — | No |

**Selection guide**: If the current record is a direct processing result of the referenced record's content (e.g., an LLM summary or format conversion), use `derived_from`. If the referenced record only provides background material and the current record has independent content (e.g., a document cited as a knowledge source but the content was generated separately), use `source`. The two values have no difference at the storage or query layer; the distinction is only used for audit presentation.

### 10.3 CRUD Write Interceptor

A lineage hook is added to Forma's Create / Update path, reusing the existing `LineageStore` interface from Section 5.

```go
// New SourceType value
const SourceSchemaRelation SourceType = "schema_relation"

// SchemaLineageRef describes a $ref field with x-lineage-role in a schema.
type SchemaLineageRef struct {
	FieldName      string
	Role           string // "derived_from" | "source"
	TargetSchemaID int
}

// SchemaRelationParser extracts x-lineage-role fields from the schema registry.
type SchemaRelationParser interface {
	ExtractLineageRefs(schemaID int) []SchemaLineageRef
}

// LineageStore is extended to support entity reference writes.
type LineageStore interface {
	SaveNode(ctx context.Context, node LineageNode) error
	SaveEdges(ctx context.Context, parentIDs []uuid.UUID, childID uuid.UUID, traceID uuid.UUID, sessionID uuid.UUID) error
	SaveEntityRef(ctx context.Context, nodeID uuid.UUID, refRole string, schemaID int, rowID uuid.UUID, attrID int, versionTsMs int64) error
}

type FormaCRUDInterceptor struct {
	store        LineageStore
	schemaParser SchemaRelationParser
}

// AfterWrite is called after a Forma write operation completes and automatically
// generates lineage nodes for fields annotated with x-lineage-role.
func (i *FormaCRUDInterceptor) AfterWrite(
	ctx context.Context,
	schemaID int,
	rowID uuid.UUID,
	record map[string]any,
	traceID uuid.UUID,
	sessionID uuid.UUID,
	agentID string,
) error {
	refs := i.schemaParser.ExtractLineageRefs(schemaID)

	for _, ref := range refs {
		val, ok := record[ref.FieldName]
		if !ok || val == nil {
			continue
		}
		parentRowID, err := uuid.Parse(fmt.Sprint(val))
		if err != nil {
			continue
		}

		node := LineageNode{
			NodeID:      uuid.Must(uuid.NewV7()),
			ParentIDs:   nil,
			CreatedAtMs: time.Now().UnixMilli(),
			SourceType:  SourceSchemaRelation,
			SourceDetail: mustMarshal(map[string]any{
				"field":        ref.FieldName,
				"lineage_role": ref.Role,
			}),
			TransformType: TransformOrchestration, // structural relationship, no data transformation
			AgentID:       agentID,
			SessionID:     sessionID,
			TraceID:       traceID,
		}

		if err := i.store.SaveNode(ctx, node); err != nil {
			return err
		}
		// Current record: output side
		if err := i.store.SaveEntityRef(ctx, node.NodeID, "output_ref", schemaID, rowID, 0, 0); err != nil {
			return err
		}
		// Referenced record: source side
		if err := i.store.SaveEntityRef(ctx, node.NodeID, "source_ref", ref.TargetSchemaID, parentRowID, 0, 0); err != nil {
			return err
		}
	}
	return nil
}
```

`SaveEntityRef` corresponds to writes to the `lineage_entity_ref` table in Section 5.1. It is added to the `LineageStore` interface so that no storage-layer changes are needed beyond the interface definition.

### 10.4 Correlation with Operational Lineage

When an AI Agent writes an `ai_note` record via a Tool, both lineage layers coexist in the same store:

```
[Operational node]   source_type=tool_call, agent_id=summarize-agent
      │  entity_ref: output_ref → ai_note#<row_id>
      │
[Declarative node]   source_type=schema_relation, field=source_doc_id, role=derived_from
      │  entity_ref: output_ref → ai_note#<row_id>
      └  entity_ref: source_ref → document#<doc_id>
```

Both nodes are linked via `lineage_entity_ref(schema_id=ai_note_schema, row_id=<row_id>)` and can be merged into a single view at query time:

```sql
-- Query the complete lineage of an ai_note record (operational + declarative)
SELECT n.source_type, n.agent_id, r.ref_role, r.schema_id, r.row_id
FROM lineage_entity_ref r
JOIN lineage_node_main n ON n.project_id = r.project_id AND n.node_id = r.node_id
WHERE r.project_id = $1
  AND r.schema_id  = $2   -- ai_note schema_id
  AND r.row_id     = $3   -- ai_note row_id
ORDER BY n.created_at_ms;
```

### 10.5 Noise Control Strategies

| Strategy | Description |
| :--- | :--- |
| Explicit annotation required | `$ref` fields without `x-lineage-role` do not generate lineage edges; pure FK membership does not participate in the lineage graph |
| Null value skip | If a reference field is `null` or absent, skip it and do not generate an isolated node |
| UUID format validation | If the reference value cannot be parsed as a valid UUID, silently skip it without blocking the main write flow |
| Async execution | `AfterWrite` can run asynchronously after the main write succeeds; a lineage capture failure does not affect the business write operation |
