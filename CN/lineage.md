# AI Agent 数据血缘（Data Lineage）技术规范

## 1. 概述

本文档定义 LTBase 平台中 AI Agent 数据血缘的完整技术方案。血缘系统在框架层自动捕获数据流转，不依赖业务代码主动埋点。

存储层采用 LTBase 原生的冷热分层架构：热数据写入 AWS DSQL，通过 CDC 刷入 S3 Parquet，冷数据图查询由 LadybugDB 执行。血缘不进入业务 EAV 表，通过显式引用与业务实体版本关联。

## 2. 核心挑战

AI Agent 的数据血缘比传统 ETL 更复杂：

| 挑战     | 说明                                             |
| :------- | :----------------------------------------------- |
| 非确定性 | LLM 输出不可复现，相同输入可能产生不同结果       |
| 多跳推理 | 数据经过多个工具 / 子 Agent 变换，因果链条长     |
| 隐式转换 | LLM 内部的推理过程不透明，只能在边界捕获         |
| 并发执行 | 多 Agent 并行时血缘容易断裂，需要全局 trace 串联 |

## 3. 核心数据结构

### 3.1 LineageNode

每条数据携带一个不可变的血缘元数据包：

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

// LineageNode 是不可变的血缘元数据包，一旦写入不可修改。
type LineageNode struct {
	NodeID      uuid.UUID         `json:"node_id"`
	ParentIDs   []uuid.UUID       `json:"parent_ids"`
	CreatedAtMs int64             `json:"created_at_ms"`

	SourceType    SourceType      `json:"source_type"`
	SourceDetail  json.RawMessage `json:"source_detail,omitempty"`

	TransformType   TransformType `json:"transform_type"`
	TransformParams json.RawMessage `json:"transform_params,omitempty"`

	AgentID   string    `json:"agent_id"`
	SessionID uuid.UUID `json:"session_id"`
	TraceID   uuid.UUID `json:"trace_id"`
}
```

### 3.2 TrackedData

所有在 Agent 中流转的数据都用 `TrackedData` 包装，血缘跟随数据而非单独传递：

```go
// TrackedData 包装业务值和血缘信息。
type TrackedData struct {
	Value      any         `json:"value"`
	Lineage    LineageNode `json:"lineage"`
	Confidence float64     `json:"confidence"` // LLM 生成时 < 1.0
}
```

## 4. 框架层自动捕获

血缘记录在框架层完成，业务代码无感知。以下三个捕获点覆盖了全部数据变换边界。

### 4.0 设计动机与捕获机制

**为什么不用业务代码主动埋点**

传统数据血缘方案要求开发者在业务函数中手动调用血缘 API：每个数据读取、转换、写入都需要显式埋点。这带来三个问题：一是侵入性强，业务代码与血缘逻辑耦合，修改血缘记录格式时需要同步修改所有业务代码；二是容易遗漏，血缘完整性依赖开发者纪律，新增工具或 Agent 时若忘记埋点则血缘断链；三是在 AI Agent 场景中，LLM 调用、工具调度、子 Agent 通信频繁且路径动态，手工埋点几乎不可维护。

**框架层如何做到自动捕获**

核心思路是将所有数据变换收束到有限的框架级边界，在这些边界上统一拦截：

- **Tool 执行边界**：业务代码通过 `ToolExecutor.Execute` 调用工具，框架在 `toolFn` 执行前后自动构建血缘节点，业务侧的 `toolFn` 只需关注业务逻辑，无需感知血缘。
- **LLM 推理边界**：所有 LLM 调用通过 `LineageAwareLLM.Infer` 发出，框架在黑盒外边界记录模型名、prompt hash、温度等元数据。LLM 内部推理过程不透明，但输入和输出的血缘节点在边界处被完整记录。
- **Agent 调度边界**：`Orchestrator.Dispatch` 封装所有子 Agent 调用，框架在任务下发和结果回收时自动写入调度节点，并将 `TraceID` 透传给子 Agent，保证跨 Agent 的血缘链条不断裂。

**TrackedData：血缘跟随数据流动**

三个拦截边界能够无缝衔接，依赖一个关键机制：`TrackedData`。业务值与血缘元数据被打包在同一结构体中流转，血缘天然随数据传递，不依赖全局 context 注入或调用方手动传参。每个捕获点从输入的 `TrackedData` 中读取父节点 ID，写入新的血缘节点后，将新节点附在输出的 `TrackedData` 上继续传递，形成完整的有向无环图。

### 4.1 Tool 执行层

```go
// LineageStore 定义血缘持久化接口。
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
	// 提取业务值
	args := make([]any, len(inputs))
	for i, d := range inputs {
		args[i] = d.Value
	}

	result, err := toolFn(ctx, args...)
	if err != nil {
		return TrackedData{}, err
	}

	// 构建血缘节点
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
		TransformType: "tool_execution",
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

### 4.2 LLM 推理层

LLM 是黑盒，只能在边界做结构化记录。Prompt 存哈希而非原文：

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
			"model":           l.llm.ModelName(),
			"prompt_hash":     hex.EncodeToString(h[:]),
			"prompt_template": promptTemplate,
			"temperature":     l.llm.Temperature(),
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

### 4.3 多 Agent 血缘传播

血缘跟随 `TrackedData` 跨越 Agent 边界，`TraceID` 贯穿整个调用链：

```go
// AgentMessage 是 Agent 间通信的载体。
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

	// Orchestrator 层记录调度节点
	node := LineageNode{
		NodeID:        uuid.Must(uuid.NewV7()),
		ParentIDs:     []uuid.UUID{task.Lineage.NodeID, result.Lineage.NodeID},
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

## 5. 存储架构

血缘不进入业务 Forma 实体表（`entity_main` / `eav_data`），而采用专门的四类物理表，复用 LTBase 的 Entity Main + EAV 分层思路但不把图结构本身塞进业务 EAV。

```text
┌──────────────────────────────────────────────────────────────┐
│ 热写 + 在线查询                        AWS DSQL              │
│  lineage_node_main ── 节点头信息（类似 Entity Main）         │
│  lineage_edge       ── DAG 父子边                            │
│  lineage_entity_ref ── 到业务实体版本的引用                  │
│  lineage_node_ext   ── 大字段 / 敏感字段（类似 EAV 灵活层）  │
├──────────────────────────────────────────────────────────────┤
│ CDC 缓冲                               lineage_change_log    │
│  → Smart Flushing（复用 LTBase OLAP 的阈值触发机制）        │
├──────────────────────────────────────────────────────────────┤
│ 冷存 + 历史图查询                       S3 Parquet           │
│  nodes / edges / refs / ext 四类独立数据集                   │
│  → LadybugDB 映射为 node table + relationship table         │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 热表设计

#### lineage_node_main

```sql
CREATE TABLE lineage_node_main (
    project_id         UUID        NOT NULL,
    node_id            UUID        NOT NULL,   -- UUID v7，保持时间局部性
    trace_id           UUID        NOT NULL,
    session_id         UUID        NOT NULL,
    agent_id           TEXT        NOT NULL,
    source_type        TEXT        NOT NULL,   -- 'user_input' | 'tool_call' | 'llm_inference' | 'db_query' | 'agent_dispatch'
    transform_type     TEXT        NOT NULL,
    created_at_ms      BIGINT      NOT NULL,
    confidence         DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    primary_schema_id  SMALLINT,               -- 可选：关联的主要业务 schema
    primary_row_id     UUID,                   -- 可选：关联的主要业务 row
    status_flags       BIGINT      NOT NULL DEFAULT 0,
    flush_watermark_ms BIGINT      NOT NULL DEFAULT 0,
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
    project_id         UUID        NOT NULL,
    parent_node_id     UUID        NOT NULL,
    child_node_id      UUID        NOT NULL,
    edge_type          TEXT        NOT NULL,   -- 'derived_from' | 'used_by' | 'orchestrated'
    trace_id           UUID        NOT NULL,
    session_id         UUID        NOT NULL,
    created_at_ms      BIGINT      NOT NULL,
    flush_watermark_ms BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, parent_node_id, child_node_id)
);

CREATE INDEX idx_edge_child ON lineage_edge (project_id, child_node_id);
CREATE INDEX idx_edge_parent ON lineage_edge (project_id, parent_node_id);
CREATE INDEX idx_edge_trace ON lineage_edge (project_id, trace_id, created_at_ms);
```

#### lineage_entity_ref

连接血缘节点与 LTBase 业务实体（`schema_id` / `row_id` / `attr_id`），同一业务实体版本可参与多条 trace：

```sql
CREATE TABLE lineage_entity_ref (
    project_id           UUID        NOT NULL,
    node_id              UUID        NOT NULL,
    ref_role             TEXT        NOT NULL,   -- 'read_set' | 'write_set' | 'source_ref' | 'output_ref' | 'change_ref'
    schema_id            SMALLINT    NOT NULL,
    row_id               UUID        NOT NULL,
    attr_id              INTEGER,
    entity_version_ts_ms BIGINT,
    change_event_id      UUID,
    snapshot_hash        TEXT,
    created_at_ms        BIGINT      NOT NULL,
    flush_watermark_ms   BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, node_id, ref_role, schema_id, row_id, attr_id, entity_version_ts_ms)
);

CREATE INDEX idx_ref_entity ON lineage_entity_ref (project_id, schema_id, row_id, created_at_ms DESC);
CREATE INDEX idx_ref_change ON lineage_entity_ref (project_id, change_event_id);
```

#### lineage_node_ext

存放 prompt hash、采样后的输入快照、工具参数、SQL 摘要等低频或敏感数据：

```sql
CREATE TABLE lineage_node_ext (
    project_id         UUID        NOT NULL,
    node_id            UUID        NOT NULL,
    ext_type           TEXT        NOT NULL,   -- 'prompt_detail' | 'input_sample' | 'tool_params' | 'sql_digest'
    payload_json       JSONB       NOT NULL,
    payload_size       BIGINT      NOT NULL,
    encryption_class   TEXT        NOT NULL DEFAULT 'default',
    created_at_ms      BIGINT      NOT NULL,
    flush_watermark_ms BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, node_id, ext_type)
);
```

### 5.2 CDC 与 Smart Flushing

业务 `change_log` 围绕 `schema_id + row_id` 设计，不适合直接承载 node / edge / ref / ext 四种形状。血缘使用专用的 CDC envelope：

```sql
CREATE TABLE lineage_change_log (
    project_id         UUID        NOT NULL,
    source_table       TEXT        NOT NULL,   -- 'node_main' | 'edge' | 'entity_ref' | 'node_ext'
    entity_key         TEXT        NOT NULL,   -- 行的逻辑主键序列化
    op_type            TEXT        NOT NULL,   -- 'I' | 'D'（血缘只有插入和软删除）
    changed_at_ms      BIGINT      NOT NULL,
    flush_watermark_ms BIGINT      NOT NULL DEFAULT 0,
    payload_json       JSONB       NOT NULL,
    PRIMARY KEY (project_id, source_table, entity_key, changed_at_ms)
);
```

Flush 触发条件复用 LTBase OLAP 原则：

- 累积记录数 > 20,000 **或** 最老未刷记录 > 1 小时
- 写出 Delta Parquet 到 S3 并标记 `flush_watermark_ms`

### 5.3 冷存布局（S3 Parquet）

```text
s3://<bucket>/lineage/nodes/project_id=<id>/date_hour=<yyyy-mm-dd-hh>/*.parquet
s3://<bucket>/lineage/edges/project_id=<id>/date_hour=<yyyy-mm-dd-hh>/*.parquet
s3://<bucket>/lineage/refs/project_id=<id>/date_hour=<yyyy-mm-dd-hh>/*.parquet
s3://<bucket>/lineage/ext/project_id=<id>/date_hour=<yyyy-mm-dd-hh>/*.parquet
```

| 原则       | 说明                                                           |
| :--------- | :------------------------------------------------------------- |
| 分区键     | `project_id` + `date_hour`                                     |
| 裁剪列     | `trace_id`、`session_id`、`schema_id`、`row_id` 保留在文件列中 |
| 大字段隔离 | `payload_json` 只出现在 `ext` 数据集，主数据集保持窄行         |
| 压缩       | ZSTD，与业务 parquet 一致                                      |
| 压缩策略   | merge-on-read；边数据做重复边抑制和 tombstone 处理             |

### 5.4 LadybugDB 冷查询映射

LadybugDB 支持直接将外部 Parquet 映射为 node / relationship table，无需导入：

```cypher
-- 映射节点
CREATE NODE TABLE LineageNode (
    node_id STRING, project_id STRING, trace_id STRING,
    session_id STRING, agent_id STRING, source_type STRING,
    created_at_ms INT64, confidence DOUBLE,
    PRIMARY KEY (node_id)
) WITH (storage='s3://.../lineage/nodes/**/*.parquet');

-- 映射边
CREATE REL TABLE DerivedFrom (FROM LineageNode TO LineageNode, edge_type STRING)
    WITH (storage='s3://.../lineage/edges/**/*.parquet');

-- 深度祖先查询
MATCH (target:LineageNode {node_id: $nodeId})<-[:DerivedFrom*]-(ancestor)
RETURN ancestor.node_id, ancestor.source_type, ancestor.created_at_ms
ORDER BY ancestor.created_at_ms;

-- 影响分析
MATCH (source:LineageNode {node_id: $nodeId})-[:DerivedFrom*]->(descendant)
RETURN descendant.node_id, descendant.source_type;
```

## 6. 查询路径设计

查询按"温度 + fan-out"分层，不按查询语言分层。

### 6.1 Trace 时间线

- 入口：`project_id + trace_id`
- 命中 `idx_node_trace` 索引，按 `created_at_ms` 排序
- 按需 join `lineage_entity_ref` 补充业务对象标注
- 引擎：AWS DSQL

### 6.2 受限祖先回溯

- 入口：`project_id + node_id`
- 递归 CTE 沿 `child_node_id → parent_node_id` 向上回溯
- 必须设置深度上限

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
    WHERE a.depth < 10  -- 在线深度护栏
)
SELECT n.*
FROM ancestry a
JOIN lineage_node_main n ON n.project_id = $1
                        AND n.node_id = a.parent_node_id
ORDER BY n.created_at_ms DESC;
```

- 引擎：AWS DSQL

### 6.3 受限影响分析

- 入口：`project_id + node_id`
- 沿 `parent_node_id → child_node_id` 向下展开
- 通过 `lineage_entity_ref` 映射到受影响实体
- fan-out 上限必须比 ancestry 更严格
- 引擎：AWS DSQL

### 6.4 业务实体溯源

- 入口：`project_id + schema_id + row_id`，可选 `attr_id`
- 查 `lineage_entity_ref` 反查 lineage 节点 → 回连 `lineage_node_main`
- 不做递归，是从 LTBase 业务对象进入血缘的主入口
- 引擎：AWS DSQL

### 6.5 深层历史图查询

- 入口：历史 session、跨 trace、高 fan-out
- LadybugDB 在冷 parquet 上做全图遍历
- 可与 DuckDB 协同做 mixed graph + wide table 分析
- 引擎：LadybugDB

### 6.6 查询路由策略

| 条件                           | 路由                 |
| :----------------------------- | :------------------- |
| 近期 + 浅层 + trace-local      | AWS DSQL             |
| 历史 + 跨 session + 高 fan-out | LadybugDB            |
| 超过在线阈值                   | 自动降级到 cold path |

在线保护阈值：

| 参数         | 建议值           |
| :----------- | :--------------- |
| 最大回溯深度 | 10               |
| 最大边数     | 1,000            |
| 最大时间窗   | 7 天             |
| 命中归档分区 | 直接切 cold path |

## 7. 架构总览

```text
User Input
    │  [LineageNode: source=user_input]
    ▼
Orchestrator Agent
    │  [trace_id 生成，贯穿全链]
    ├──► Tool Executor ──► DB/API
    │         │  [node + edge + entity_ref]
    │         ▼
    ├──► LLM Inference
    │         │  [node + edge + ext]
    │         ▼
    └──► Sub Agent
              │  [trace_id 透传]
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

## 8. 设计原则

| 原则            | 做法                                                           |
| :-------------- | :------------------------------------------------------------- |
| 不可变性        | `LineageNode` 一旦写入不可修改，只能追加或写补偿节点           |
| 自动捕获        | 血缘在框架层（Tool / LLM / Dispatch 边界）完成，业务代码无感知 |
| 全链路 trace_id | 跨 Agent、跨服务统一追踪                                       |
| 图结构专表化    | 边和实体引用是第一类数据，不进入业务 EAV                       |
| 冷热分层        | 在线查询走 DSQL，深层历史图查询走 LadybugDB                    |
| 查询护栏        | 在线递归必须限制深度、边数和时间窗                             |
| 输入采样        | 只保存必要快照，大对象存摘要或 hash                            |
| 置信度传播      | LLM 生成的数据携带 confidence，路径级聚合在查询时计算          |
| 隐私保护        | Prompt 默认存 SHA-256 hash，敏感 payload 存加密 ext            |

## 9. 与 LTBase 现有架构的整合

### 9.1 与 EAV + Entity Main

- 业务数据继续沿用 `entity_main_<project_id>` + `eav_data_<project_id>`
- 血缘数据独立存储，不把图遍历语义压到业务表
- 通过 `lineage_entity_ref` 关联，而非互相复制

### 9.2 与 change_log / OLAP

- 复用 CDC + Smart Flushing + merge-on-read 的架构思路
- 但使用血缘专用 CDC envelope，不强行复用业务 `change_log` 行形状
- 冷存沿用 Parquet + Base/Delta + 定期 Compaction

### 9.3 与 LadybugDB

- LadybugDB 不在热路径上
- 承担冷数据图遍历、历史审计、高 fan-out 分析
- 支持直接以 Parquet 作为外部存储映射 node/relationship table，无需导入

## 10. Schema 驱动的声明式血缘

### 10.1 设计动机

第 4 节描述的操作性血缘捕获的是 **AI Agent 的执行过程**：哪个工具被调用、哪个 LLM 做了推理、哪个子 Agent 被派发。这些节点回答的是"谁生产了这条记录"。

但在 Forma 的 JSON Schema 中，模型间的关系已经通过 `$ref` 显式声明（见 `JSON-Schema-Ext.md`）。当一条 `ai_note` 记录写入时，它的 `source_doc_id` 字段引用了 `document` 模型——这个关系在 schema 中是静态已知的，无需等待 AI Agent 在运行时手动埋点。

声明式血缘的目标是在 **Forma CRUD 写入层**拦截这类关系，自动生成血缘边，作为操作性血缘的互补：

| 维度 | 操作性血缘（第 4 节） | 声明式血缘（本节） |
| :--- | :--- | :--- |
| 捕获位置 | Tool / LLM / Dispatch 边界 | Forma CRUD 写入拦截器 |
| 捕获对象 | AI 推理与工具执行过程 | Schema `$ref` 字段声明的记录间关系 |
| 触发条件 | AI Agent 执行 | 任何 Forma Create / Update 操作 |
| 回答的问题 | 谁（哪个 Agent/LLM）写了这条记录 | 这条记录在数据模型上依赖哪些记录 |
| `source_type` | `tool_call` / `llm_inference` 等 | `schema_relation`（新增） |

两层血缘共用第 5 节的存储结构，通过 `lineage_entity_ref(schema_id, row_id)` 在查询时关联。

### 10.2 JSON Schema 扩展：`x-lineage-role`

在 `$ref` 字段上增加可选注解 `x-lineage-role`，声明该引用在血缘语义上的角色。**仅有此注解的字段才触发血缘捕获**，无注解的 `$ref` 只作为普通 FK，不生成血缘边。

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
      // 无注解 → 纯 FK 归属，不生成血缘边
    }
  },
  "x-unique-property": "id"
}
```

`x-lineage-role` 取值语义：

| 值 | 含义 | 生成血缘边 |
| :--- | :--- | :--- |
| `derived_from` | 此记录由引用记录派生或生成 | 是 |
| `source` | 引用记录是此记录的原始信息来源 | 是 |
| （无注解） | 纯结构性归属（FK） | 否 |

### 10.3 CRUD 写入拦截器

在 Forma 的 Create / Update 路径中加入血缘钩子，复用第 5 节已有的 `LineageStore` 接口。

```go
// 新增 SourceType
const SourceSchemaRelation SourceType = "schema_relation"

// SchemaLineageRef 描述 schema 中一个带 x-lineage-role 的 $ref 字段。
type SchemaLineageRef struct {
    FieldName      string
    Role           string // "derived_from" | "source"
    TargetSchemaID int
}

// SchemaRelationParser 从 schema registry 中提取 x-lineage-role 字段。
type SchemaRelationParser interface {
    ExtractLineageRefs(schemaID int) []SchemaLineageRef
}

type FormaCRUDInterceptor struct {
    store        LineageStore
    schemaParser SchemaRelationParser
}

// AfterWrite 在 Forma 写操作完成后调用，自动为带 x-lineage-role 的字段生成血缘节点。
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
            TransformType: TransformFilter, // 结构性关系，无数据变换
            AgentID:       agentID,
            SessionID:     sessionID,
            TraceID:       traceID,
        }

        if err := i.store.SaveNode(ctx, node); err != nil {
            return err
        }
        // 当前记录：输出方
        if err := i.store.SaveEntityRef(ctx, node.NodeID, "output_ref", schemaID, rowID, 0, 0); err != nil {
            return err
        }
        // 引用记录：来源方
        if err := i.store.SaveEntityRef(ctx, node.NodeID, "source_ref", ref.TargetSchemaID, parentRowID, 0, 0); err != nil {
            return err
        }
    }
    return nil
}
```

`SaveEntityRef` 对应第 5.1 节 `lineage_entity_ref` 表的写入，复用已有接口，无需修改存储层。

### 10.4 与操作性血缘的关联

当 AI Agent 通过 Tool 写入一条 `ai_note` 记录时，两层血缘节点并存于同一存储：

```
[操作性节点]   source_type=tool_call, agent_id=summarize-agent
      │  entity_ref: output_ref → ai_note#<row_id>
      │
[声明式节点]   source_type=schema_relation, field=source_doc_id, role=derived_from
      │  entity_ref: output_ref → ai_note#<row_id>
      └  entity_ref: source_ref → document#<doc_id>
```

两个节点通过 `lineage_entity_ref(schema_id=ai_note_schema, row_id=<row_id>)` 关联，查询时可合并为单一视图：

```sql
-- 查询一条 ai_note 记录的完整血缘（操作性 + 声明式）
SELECT n.source_type, n.agent_id, r.ref_role, r.schema_id, r.row_id
FROM lineage_entity_ref r
JOIN lineage_node_main n ON n.project_id = r.project_id AND n.node_id = r.node_id
WHERE r.project_id = $1
  AND r.schema_id  = $2   -- ai_note schema_id
  AND r.row_id     = $3   -- ai_note row_id
ORDER BY n.created_at_ms;
```

### 10.5 噪声控制策略

| 策略 | 说明 |
| :--- | :--- |
| 显式注解才触发 | 无 `x-lineage-role` 的 `$ref` 字段不生成血缘边，纯 FK 归属不参与血缘图 |
| 空值跳过 | 若引用字段为 `null` 或缺失，跳过该字段，不生成孤立节点 |
| UUID 格式校验 | 引用值无法解析为合法 UUID 时静默跳过，不阻断写入主流程 |
| 异步写入 | `AfterWrite` 可在写入主流程成功后异步执行，血缘捕获失败不影响业务写操作 |
