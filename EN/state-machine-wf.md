
# High-Level Design (HLD): Serverless State Machine Workflow Engine

## 1. Introduction

This document describes the high-level architecture and core interface design for a distributed, serverless-first workflow engine implemented in Go.

The engine is modeled as a deterministic state-machine orchestration system. It acts as a stateless control plane that evaluates workflow state transitions, persists workflow state, emits durable commands, and coordinates asynchronous callbacks from external workers, timers, and child workflows.

The engine does not execute long-running business logic directly. All external work is delegated to workers or infrastructure services through durable commands written to a transactional outbox.

This design supersedes the earlier draft by strengthening the reliability model around definition versioning, persistent task tokens, transactional idempotency, timeout safety, sub-workflow lifecycle management, and auditability.

---

## 2. Goals

### 2.1 Primary Goals

1. Support serverless and horizontally scalable deployments.
2. Keep the engine stateless at the compute layer.
3. Model workflows as immutable, versioned state-machine definitions.
4. Ensure deterministic state transitions.
5. Support asynchronous task execution through callback tokens.
6. Provide strong protection against duplicate events, duplicate callbacks, and concurrent delivery.
7. Support state timeouts using external timer infrastructure.
8. Support sub-workflow orchestration with parent-child lifecycle tracking.
9. Guarantee atomic persistence of state changes, task records, idempotency records, history records, and outbound messages.
10. Provide complete workflow audit history for debugging, replay, compliance, and operations.

### 2.2 Non-Goals

The following are intentionally out of scope for the first version:

1. Full Temporal-style deterministic replay of application code.
2. Arbitrary DAG execution.
3. Distributed transactions across external systems.
4. Synchronous long-running task execution inside the engine.
5. Complex compensation DSL.
6. Built-in human approval UI.
7. Multi-region active-active consensus.

---

## 3. Architectural Principles

### 3.1 Serverless-First Control Plane

The engine must never block while waiting for external work.

All long-running work is represented as a durable task and resumed through one of the following asynchronous inputs:

- worker callback;
- timeout callback;
- child workflow completion callback;
- explicit external event;
- cancellation event.

### 3.2 Durable State, Stateless Compute

Engine instances are stateless and horizontally scalable. Any engine process can handle any incoming event.

Durable state lives in the repository:

- workflow instances;
- workflow tasks;
- idempotency records;
- parent-child workflow links;
- outbox messages;
- workflow history.

### 3.3 Immutable Versioned Definitions

Workflow definitions are immutable once activated.

Each workflow instance is bound to a specific workflow definition version at creation time. All future events for that instance are evaluated against the same definition version.

This avoids unsafe behavior where a running instance created under one topology is later interpreted using a different topology.

### 3.4 Transactional Outbox for All External Side Effects

The engine does not directly call workers, message queues, timer services, or child workflow starters inside the transition transaction.

Instead, the engine writes outbound commands to an outbox table in the same transaction as the state transition.

A separate outbox relay publishes commands to external systems with at-least-once semantics.

### 3.5 Persistent Task Tokens

Callback tokens are first-class persisted entities.

Every asynchronous wait point is represented by a durable task record. A task token is bound to:

- workflow instance ID;
- state;
- instance version;
- task purpose;
- expected callback event;
- task status;
- optional expiration time.

This binding allows the engine to safely reject stale callbacks, duplicate callbacks, timeout races, and callbacks for abandoned states.

### 3.6 Transactional Idempotency

Idempotency must be handled inside the same transaction as the state transition.

The engine must not implement idempotency as a separate `HasProcessed` followed by `RecordProcessed` sequence outside the transition transaction.

### 3.7 Complete Audit History

Every accepted event, rejected stale callback, transition, command emission, task creation, task completion, timeout, cancellation, child start, child completion, workflow completion, and workflow failure should be recorded as workflow history.

---

## 4. Core Concepts

### 4.1 Workflow Definition

A workflow definition is an immutable blueprint containing:

- workflow name;
- workflow version;
- initial state;
- state configs;
- transition rules;
- terminal states;
- schema metadata;
- action references;
- mapper references.

Definitions should be stored, loaded, and cached by `(workflow_name, workflow_version)`.

### 4.2 Workflow Instance

A workflow instance is a running or completed execution of a workflow definition.

Each instance has:

- unique instance ID;
- workflow name;
- workflow version;
- current state;
- lifecycle status;
- payload;
- optimistic lock version;
- timestamps.

### 4.3 State

A state represents a durable point in the workflow.

A state may define:

- entry action;
- timeout;
- timeout event;
- sub-workflow config;
- terminal behavior;
- cancellation behavior.

### 4.4 Event

An event is an input that attempts to advance a workflow instance.

Events may originate from:

- external API request;
- worker callback;
- timeout callback;
- child workflow completion;
- cancellation request;
- system recovery process.

### 4.5 Transition

A transition defines a valid movement from one state to another when a specific event is accepted.

A transition may include a guard condition.

### 4.6 Task

A task represents an outstanding asynchronous wait point.

Examples:

- worker task;
- timeout task;
- sub-workflow wait task;
- cancellation task.

A task owns a callback token.

### 4.7 Outbox Message

An outbox message is a durable command to be delivered to an external system.

Examples:

- invoke worker;
- schedule timer;
- cancel timer;
- start child workflow;
- cancel child workflow;
- publish notification.

### 4.8 History Event

A history event is an immutable audit record describing something that happened to a workflow instance.

---

## 5. System Architecture

```text
                         ┌────────────────────────┐
                         │ External API / Gateway │
                         └───────────┬────────────┘
                                     │
                                     ▼
                           ┌─────────────────┐
                           │  Engine Core    │
                           │  Stateless      │
                           └───────┬─────────┘
                                   │
                     transactional │
                                   ▼
        ┌───────────────────────────────────────────────────────────┐
        │                    Repository / Database                  │
        │                                                           │
        │  ┌──────────────┐   ┌────────────┐   ┌─────────────────┐  │
        │  │ Instances    │   │ Tasks      │   │ Idempotency     │  │
        │  └──────────────┘   └────────────┘   └─────────────────┘  │
        │                                                           │
        │  ┌──────────────┐   ┌────────────┐   ┌─────────────────┐  │
        │  │ Outbox       │   │ History    │   │ Workflow Links  │  │
        │  └──────────────┘   └────────────┘   └─────────────────┘  │
        └───────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                           ┌─────────────────┐
                           │ Outbox Relay    │
                           └───────┬─────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                        ▼                        ▼
 ┌──────────────┐          ┌───────────────┐          ┌──────────────┐
 │ Worker Queue │          │ Timer Service │          │ Child Starter│
 └──────┬───────┘          └───────┬───────┘          └──────┬───────┘
        │                          │                         │
        ▼                         ▼                        ▼
 ┌──────────────┐          ┌───────────────┐          ┌──────────────┐
 │ Workers      │          │ Timeout Event │          │ Child Engine │
 └──────┬───────┘          └───────┬───────┘          └──────┬───────┘
        │                          │                         │
        └──────────────┬───────────┴──────────────┬──────────┘
                       ▼                         ▼
                ┌────────────────────────────────────┐
                │ Callback Gateway / Engine Callback │
                └────────────────────────────────────┘
```

---

## 6. Component Responsibilities

### 6.1 Definition Registry

The definition registry stores immutable workflow definitions.

Responsibilities:

* register new workflow definitions;
* validate workflow topology;
* reject incompatible duplicate versions;
* load definitions by `(name, version)`;
* resolve latest active version for new instances;
* cache definitions in memory;
* never mutate an activated definition.

The registry must support multiple versions of the same workflow.

### 6.2 Engine Core

The engine core is the stateless decision maker.

Responsibilities:

* start workflow instances;
* accept external events;
* handle callbacks;
* validate events against the current state and definition version;
* evaluate guards;
* evaluate entry actions;
* compute next state;
* create task records;
* write outbox commands;
* write history records;
* complete or cancel tasks;
* enforce optimistic concurrency;
* enforce idempotency;
* reject stale callbacks safely.

The engine must not directly call workers, queues, timer services, or child workflow APIs as part of state transition processing.

### 6.3 Repository

The repository owns persistence and transaction boundaries.

Responsibilities:

* provide transactional unit-of-work API;
* persist instances;
* persist task records;
* persist idempotency records;
* persist workflow links;
* persist history events;
* persist outbox messages;
* perform optimistic lock checks;
* provide task-token lookup;
* support safe retry after transient failures.

### 6.4 Outbox Relay

The outbox relay publishes pending outbox messages to external systems.

Responsibilities:

* poll pending outbox messages;
* lock messages for publishing;
* publish with at-least-once delivery;
* retry transient failures;
* move permanently failing messages to a dead-letter state;
* preserve message ordering where required by partition key;
* record attempts and errors.

### 6.5 Callback Gateway

The callback gateway receives callbacks from workers, timers, and child workflows.

Responsibilities:

* authenticate callback source;
* validate callback shape;
* forward callback to `Engine.HandleCallback`;
* return safe success for duplicate or stale callbacks when appropriate;
* avoid exposing internal instance details.

### 6.6 Timer Provider

The timer provider is an external service that fires callbacks after a configured delay.

Examples:

* AWS EventBridge Scheduler;
* Cloud Tasks;
* delayed queue;
* database-backed scheduler.

The engine does not call the timer provider directly. Timer schedule and cancel requests are emitted as outbox commands.

### 6.7 External Workers

Workers consume commands from queues or topics and execute business logic.

Responsibilities:

* process commands idempotently;
* use the provided task token when calling back;
* return callback result payload;
* tolerate duplicate command delivery;
* avoid assuming exactly-once queue semantics.

---

## 7. Data Model

The following Go-like model describes the high-level types.

### 7.1 Primitive Types

```go
package workflow

import (
    "context"
    "encoding/json"
    "errors"
    "time"
)

type WorkflowName string
type WorkflowVersion string
type InstanceID string
type State string
type Event string
type TaskToken string
type CommandID string
type OutboxMessageID string
type IdempotencyKey string
type HistoryEventID string
```

---

## 8. Workflow Definition Model

### 8.1 Definition

```go
type Definition struct {
    Name           WorkflowName
    Version        WorkflowVersion
    InitialState   State
    States         map[State]StateConfig
    Transitions    []Transition
    TerminalStates map[State]TerminalType

    InputSchemaRef  string
    OutputSchemaRef string

    CreatedAt time.Time
    ActivatedAt *time.Time
}
```

### 8.2 State Config

```go
type StateConfig struct {
    Name State

    OnEntry ActionRef

    Timeout *StateTimeoutConfig

    SubWorkflow *SubWorkflowConfig

    AllowCancellation bool
}
```

### 8.3 Terminal Type

```go
type TerminalType string

const (
    TerminalSuccess TerminalType = "success"
    TerminalFailure TerminalType = "failure"
    TerminalCancelled TerminalType = "cancelled"
)
```

### 8.4 Transition

```go
type Transition struct {
    From  State
    To    State
    Event Event

    Guard GuardRef
}
```

### 8.5 Action Reference

Actions should be referenced by name instead of storing raw Go functions inside the definition.

This makes definitions easier to version, validate, serialize, deploy, and audit.

```go
type ActionRef struct {
    Name   string
    Params map[string]any
}
```

An action implementation is resolved at runtime by an action registry.

### 8.6 Guard Reference

```go
type GuardRef struct {
    Name   string
    Params map[string]any
}
```

A missing guard means the transition is unconditional.

### 8.7 Mapper Reference

```go
type MapperRef struct {
    Name   string
    Params map[string]any
}
```

Mappers are referenced by name rather than stored as raw function pointers.

### 8.8 Sub-Workflow Config

```go
type SubWorkflowConfig struct {
    DefinitionName WorkflowName

    InputMapper  MapperRef
    OutputMapper MapperRef

    OnCompletedEvent Event
    OnFailedEvent    Event
}
```

---

## 9. Runtime Instance Model

### 9.1 Instance Status

```go
type InstanceStatus string

const (
    InstanceRunning   InstanceStatus = "running"
    InstanceCompleted InstanceStatus = "completed"
    InstanceFailed    InstanceStatus = "failed"
    InstanceCancelled InstanceStatus = "cancelled"
)
```

### 9.2 Instance

```go
type Instance struct {
    ID        InstanceID
    WfName    WorkflowName
    WfVersion WorkflowVersion

    State  State
    Status InstanceStatus

    Payload       json.RawMessage
    PayloadSchema string

    Version int64

    CreatedAt time.Time
    UpdatedAt time.Time
    CompletedAt *time.Time
}
```

### 9.3 Why `WfVersion` Is Required

Every instance is bound to one immutable workflow definition version.

`Start()` resolves the latest active version and stores it on the instance.

`FireEvent()` and `HandleCallback()` always load the definition using:

```text
(instance.WfName, instance.WfVersion)
```

This prevents running instances from being affected by later workflow definition changes.

---

## 10. Task Model

### 10.1 Task Purpose

```go
type TaskPurpose string

const (
    TaskPurposeWorker      TaskPurpose = "worker"
    TaskPurposeTimeout     TaskPurpose = "timeout"
    TaskPurposeSubWorkflow TaskPurpose = "sub_workflow"
    TaskPurposeCancellation TaskPurpose = "cancellation"
)
```

### 10.2 Task Status

```go
type TaskStatus string

const (
    TaskPending   TaskStatus = "pending"
    TaskCompleted TaskStatus = "completed"
    TaskCancelled TaskStatus = "cancelled"
    TaskExpired   TaskStatus = "expired"
)
```

### 10.3 Task

```go
type Task struct {
    Token TaskToken

    InstanceID InstanceID
    State      State
    Version    int64

    Purpose TaskPurpose
    Status  TaskStatus

    ExpectedEvent Event

    ExpiresAt *time.Time

    CreatedAt time.Time
    UpdatedAt time.Time
    ResolvedAt *time.Time
}
```

### 10.4 Task Token Rules

Task tokens must be:

1. cryptographically secure;
2. globally unique;
3. persisted before being delivered to workers or timers;
4. single-use for successful callbacks;
5. bound to instance ID, state, and version;
6. rejected if the instance has moved to another state or version;
7. safe to receive more than once.

### 10.5 Callback Validation

When a callback arrives, the engine must check:

```text
task exists
task.status == pending
instance.id == task.instance_id
instance.state == task.state
instance.version == task.version
callback.event == task.expected_event
instance.status == running
```

If any condition fails, the callback is stale, duplicate, invalid, or no longer relevant.

The engine should treat stale or duplicate callbacks as safely ignored, while invalid or unauthorized callbacks should be rejected.

---

## 11. Event and Callback Model

### 11.1 Event Request

```go
type EventRequest struct {
    Event Event

    IdempotencyKey IdempotencyKey

    Payload json.RawMessage

    RequestID string
    TraceID   string
}
```

### 11.2 Callback Request

```go
type CallbackRequest struct {
    TaskToken TaskToken `json:"task_token"`

    Event Event `json:"event"`

    Result json.RawMessage `json:"result"`

    RequestID string `json:"request_id,omitempty"`
    TraceID   string `json:"trace_id,omitempty"`
}
```

Callbacks do not need to include instance ID. The engine resolves instance ID through the persisted task token.

---

## 12. Idempotency Model

### 12.1 Event Record Status

```go
type EventRecordStatus string

const (
    EventProcessing EventRecordStatus = "processing"
    EventSucceeded  EventRecordStatus = "succeeded"
    EventFailed     EventRecordStatus = "failed"
)
```

### 12.2 Event Record

```go
type EventRecord struct {
    InstanceID InstanceID

    IdempotencyKey IdempotencyKey
    RequestHash    string

    Event Event

    Status EventRecordStatus

    ResultState   State
    ResultVersion int64

    ErrorCode string

    CreatedAt time.Time
    UpdatedAt time.Time
}
```

### 12.3 Idempotency Rules

For external `FireEvent` calls:

1. `IdempotencyKey` is required.
2. `(instance_id, idempotency_key)` must be unique.
3. The request hash must include event name and payload.
4. If the same key is reused with the same request hash, return the original result.
5. If the same key is reused with a different request hash, return a duplicate request conflict.
6. The idempotency record must be inserted or updated in the same transaction as the state transition.

For callbacks:

1. the task token is the primary idempotency key;
2. duplicate callbacks for completed tasks should be safely ignored;
3. callbacks for stale state/version should be safely ignored and recorded in history.

---

## 13. Command and Outbox Model

### 13.1 Command Type

```go
type CommandType string

const (
    CommandInvokeWorker       CommandType = "invoke_worker"
    CommandScheduleTimer      CommandType = "schedule_timer"
    CommandCancelTimer        CommandType = "cancel_timer"
    CommandStartSubWorkflow   CommandType = "start_sub_workflow"
    CommandCancelSubWorkflow  CommandType = "cancel_sub_workflow"
    CommandEmitNotification   CommandType = "emit_notification"
)
```

### 13.2 Command Spec

Actions return command specs, not fully materialized commands.

The engine is responsible for generating durable command IDs, task tokens, and outbox messages.

```go
type CommandSpec struct {
    Type CommandType

    Payload json.RawMessage

    RequiresCallback bool
    ExpectedEvent    Event
    Timeout          *time.Duration
}
```

### 13.3 Outbox Message Status

```go
type OutboxStatus string

const (
    OutboxPending    OutboxStatus = "pending"
    OutboxPublishing OutboxStatus = "publishing"
    OutboxPublished  OutboxStatus = "published"
    OutboxFailed     OutboxStatus = "failed"
    OutboxDeadLetter OutboxStatus = "dead_letter"
)
```

### 13.4 Outbox Message

```go
type OutboxMessage struct {
    ID OutboxMessageID

    Topic string
    Key   string

    CommandType CommandType
    Payload     json.RawMessage

    Status OutboxStatus

    Attempts      int
    NextAttemptAt time.Time

    LockedBy    string
    LockedUntil *time.Time

    LastError string

    TraceID string

    CreatedAt   time.Time
    UpdatedAt   time.Time
    PublishedAt *time.Time
}
```

### 13.5 Outbox Delivery Semantics

The outbox relay provides at-least-once delivery.

Therefore:

1. all consumers must be idempotent;
2. every command should have a stable command ID;
3. worker commands should include task token;
4. timer commands should include timer ID and task token;
5. child workflow start commands should include parent link metadata;
6. duplicate delivery must not corrupt workflow state.

---

## 14. Workflow Link Model

### 14.1 Workflow Link Status

```go
type WorkflowLinkStatus string

const (
    LinkPending   WorkflowLinkStatus = "pending"
    LinkRunning   WorkflowLinkStatus = "running"
    LinkCompleted WorkflowLinkStatus = "completed"
    LinkFailed    WorkflowLinkStatus = "failed"
    LinkCancelled WorkflowLinkStatus = "cancelled"
)
```

### 14.2 Workflow Link

```go
type WorkflowLink struct {
    ParentInstanceID InstanceID
    ParentTaskToken  TaskToken

    ChildInstanceID InstanceID

    Status WorkflowLinkStatus

    CreatedAt time.Time
    UpdatedAt time.Time
    CompletedAt *time.Time
}
```

### 14.3 Why a Link Table Is Required

A single `ParentTaskToken` field on the child instance is insufficient because the engine must support:

* querying parent-child relationships;
* cancellation propagation;
* safe handling of late child completion;
* future fan-out and fan-in;
* lifecycle auditing;
* orphan detection;
* retry-safe child creation.

---

## 15. History Model

### 15.1 History Event Type

```go
type HistoryEventType string

const (
    HistoryWorkflowStarted       HistoryEventType = "workflow_started"
    HistoryEventAccepted         HistoryEventType = "event_accepted"
    HistoryEventRejected         HistoryEventType = "event_rejected"
    HistoryTransitionTaken       HistoryEventType = "transition_taken"
    HistoryTaskCreated           HistoryEventType = "task_created"
    HistoryTaskCompleted         HistoryEventType = "task_completed"
    HistoryTaskCancelled         HistoryEventType = "task_cancelled"
    HistoryCommandEmitted        HistoryEventType = "command_emitted"
    HistoryTimerScheduled        HistoryEventType = "timer_scheduled"
    HistoryTimerCancelled        HistoryEventType = "timer_cancelled"
    HistoryTimeoutFired          HistoryEventType = "timeout_fired"
    HistoryCallbackReceived      HistoryEventType = "callback_received"
    HistoryCallbackIgnored       HistoryEventType = "callback_ignored"
    HistoryChildWorkflowStarted  HistoryEventType = "child_workflow_started"
    HistoryChildWorkflowCompleted HistoryEventType = "child_workflow_completed"
    HistoryWorkflowCompleted     HistoryEventType = "workflow_completed"
    HistoryWorkflowFailed        HistoryEventType = "workflow_failed"
    HistoryWorkflowCancelled     HistoryEventType = "workflow_cancelled"
)
```

### 15.2 History Event

```go
type HistoryEvent struct {
    ID HistoryEventID

    InstanceID InstanceID

    Type HistoryEventType

    StateFrom *State
    StateTo   *State

    Event *Event

    Details json.RawMessage

    TraceID string

    CreatedAt time.Time
}
```

History events are append-only.

---

## 16. Repository Interface

### 16.1 Repository

```go
type Repository interface {
    WithTx(ctx context.Context, fn func(tx TxRepository) error) error
}
```

### 16.2 Transactional Repository

```go
type TxRepository interface {
    CreateInstance(ctx context.Context, instance *Instance) error

    GetInstance(ctx context.Context, id InstanceID) (*Instance, error)

    UpdateInstance(ctx context.Context, instance *Instance, expectedVersion int64) error

    InsertTask(ctx context.Context, task *Task) error
    GetTaskByToken(ctx context.Context, token TaskToken) (*Task, error)
    UpdateTaskStatus(ctx context.Context, token TaskToken, from TaskStatus, to TaskStatus) error
    CancelPendingTasksForInstanceVersion(ctx context.Context, instanceID InstanceID, state State, version int64) error

    InsertEventRecord(ctx context.Context, record *EventRecord) error
    GetEventRecord(ctx context.Context, instanceID InstanceID, key IdempotencyKey) (*EventRecord, error)
    MarkEventRecordSucceeded(ctx context.Context, instanceID InstanceID, key IdempotencyKey, state State, version int64) error
    MarkEventRecordFailed(ctx context.Context, instanceID InstanceID, key IdempotencyKey, errorCode string) error

    InsertWorkflowLink(ctx context.Context, link *WorkflowLink) error
    UpdateWorkflowLinkStatus(ctx context.Context, parentToken TaskToken, status WorkflowLinkStatus) error
    GetWorkflowLinkByParentToken(ctx context.Context, token TaskToken) (*WorkflowLink, error)

    InsertOutboxMessages(ctx context.Context, messages []OutboxMessage) error

    InsertHistoryEvents(ctx context.Context, events []HistoryEvent) error
}
```

### 16.3 Transactional Requirements

The following must happen atomically:

* instance update;
* idempotency record insert/update;
* task creation;
* task completion/cancellation;
* workflow link update;
* outbox message insertion;
* history insertion.

If the transaction fails, no external command should be observable.

---

## 17. Definition Registry Interface

```go
type Registry interface {
    RegisterDraft(ctx context.Context, def Definition) error

    Activate(ctx context.Context, name WorkflowName, version WorkflowVersion) error

    Get(ctx context.Context, name WorkflowName, version WorkflowVersion) (Definition, error)

    GetLatestActive(ctx context.Context, name WorkflowName) (Definition, error)
}
```

### 17.1 Definition Validation

Before activation, the registry must validate:

1. initial state exists;
2. every transition source and target state exists;
3. terminal states exist;
4. no duplicate transition ambiguity unless guarded;
5. action refs are known;
6. guard refs are known;
7. mapper refs are known;
8. timeout events are valid from the timed state;
9. sub-workflow references are resolvable or explicitly late-bound;
10. schema references are valid.

---

## 18. Engine Interface

```go
type Engine interface {
    Start(ctx context.Context, wfName WorkflowName, req StartRequest) (*Instance, error)

    FireEvent(ctx context.Context, instanceID InstanceID, req EventRequest) (*Instance, error)

    HandleCallback(ctx context.Context, req CallbackRequest) error

    Cancel(ctx context.Context, instanceID InstanceID, req CancelRequest) (*Instance, error)
}
```

### 18.1 Start Request

```go
type StartRequest struct {
    IdempotencyKey IdempotencyKey

    Payload json.RawMessage

    RequestedVersion *WorkflowVersion

    TraceID string
}
```

If `RequestedVersion` is absent, the engine starts the latest active version.

### 18.2 Cancel Request

```go
type CancelRequest struct {
    IdempotencyKey IdempotencyKey

    Reason string

    TraceID string
}
```

Cancellation is represented as a first-class lifecycle operation.

---

## 19. Action, Guard, and Mapper Runtime Interfaces

### 19.1 Evaluation Context

```go
type EvalContext struct {
    InstanceID InstanceID

    WfName    WorkflowName
    WfVersion WorkflowVersion

    State State

    Payload json.RawMessage

    EventPayload json.RawMessage

    TraceID string
}
```

### 19.2 Action Runtime

```go
type Action interface {
    Evaluate(ctx context.Context, wf EvalContext, params map[string]any) ([]CommandSpec, error)
}
```

Action rules:

1. no blocking external IO;
2. no irreversible side effects;
3. no direct queue publishing;
4. no direct timer scheduling;
5. no direct child workflow creation;
6. deterministic with respect to input context and params where possible;
7. any required external work must be returned as a `CommandSpec`.

### 19.3 Guard Runtime

```go
type Guard interface {
    Evaluate(ctx context.Context, wf EvalContext, params map[string]any) (bool, error)
}
```

### 19.4 Mapper Runtime

```go
type Mapper interface {
    Map(ctx context.Context, input json.RawMessage, params map[string]any) (json.RawMessage, error)
}
```

---

## 20. Execution Lifecycle: Starting a Workflow

### 20.1 Flow

1. Client calls `Engine.Start`.
2. Engine resolves definition:

   * requested version, or
   * latest active version.
3. Engine validates input payload against the definition input schema.
4. Engine checks idempotency key.
5. Engine creates an instance in the initial state.
6. Engine evaluates the initial state's `OnEntry` action.
7. Engine materializes command specs into:

   * task records;
   * outbox messages.
8. Engine writes:

   * instance;
   * idempotency record;
   * tasks;
   * outbox messages;
   * history events.
9. Transaction commits.
10. Outbox relay eventually dispatches commands.

### 20.2 Atomicity

The instance must not be visible as started without its corresponding entry tasks, outbox messages, and history records.

---

## 21. Execution Lifecycle: External Event

### 21.1 Flow

1. Client calls `FireEvent(instanceID, EventRequest)`.
2. Engine opens transaction.
3. Engine checks or inserts idempotency record.
4. If same idempotency key and same request hash already succeeded, return prior result.
5. If same idempotency key but different request hash, return conflict.
6. Engine loads instance.
7. Engine rejects event if instance is terminal.
8. Engine loads definition using instance workflow name and version.
9. Engine finds valid transition from current state for event.
10. Engine evaluates guard if present.
11. Engine computes target state.
12. Engine cancels pending tasks tied to the previous instance state/version.
13. Engine applies payload mutation or event result merge.
14. Engine evaluates target state's `OnEntry` action.
15. Engine creates new tasks and outbox commands.
16. Engine updates instance with optimistic lock.
17. Engine inserts history records.
18. Engine marks idempotency record succeeded.
19. Transaction commits.
20. Outbox relay dispatches commands.

### 21.2 Concurrency Conflict

If the optimistic lock update fails, the engine must treat this as a concurrency conflict.

The caller may retry with the same idempotency key. The engine must not create duplicate commands.

---

## 22. Execution Lifecycle: Worker Callback

### 22.1 Flow

1. Worker receives command containing task token.
2. Worker executes external business logic.
3. Worker calls callback gateway with:

   * task token;
   * event;
   * result payload.
4. Callback gateway authenticates request.
5. Engine resolves task by token.
6. Engine validates task status, instance state, and instance version.
7. If task is stale or already completed, engine records ignored callback and returns success.
8. If task is valid, engine marks task completed.
9. Engine delegates to internal event-processing flow.
10. Engine commits transition, outbox messages, and history atomically.

### 22.2 Duplicate Callback Behavior

A duplicate callback with the same task token after the task is completed must not apply the transition twice.

The engine should return success or a safe no-op response.

---

## 23. Execution Lifecycle: Timeout

### 23.1 Scheduling a Timeout

When entering a state with timeout config:

1. Engine creates a timeout task bound to the current instance state and version.
2. Engine writes a `CommandScheduleTimer` outbox message.
3. Outbox relay calls the external timer provider.
4. Timer provider eventually sends a callback with the timeout task token.

### 23.2 Timeout Config

```go
type StateTimeoutConfig struct {
    Duration time.Duration
    Event    Event
}
```

### 23.3 Timer Callback

When the timer fires:

1. Timer provider sends callback with timeout task token.
2. Engine resolves task.
3. Engine verifies:

   * task is pending;
   * task purpose is timeout;
   * instance state matches task state;
   * instance version matches task version.
4. If valid, engine fires the timeout event.
5. If stale, engine records ignored timeout callback and returns success.

### 23.4 Cancelling a Timeout

When a workflow leaves a state before the timeout fires:

1. Engine marks pending timeout task as cancelled.
2. Engine writes a `CommandCancelTimer` outbox message.
3. Outbox relay calls timer provider cancellation API.

If timer cancellation fails or races with timer firing, the stale task binding prevents the old timeout from affecting the workflow.

---

## 24. Execution Lifecycle: Sub-Workflow

### 24.1 Starting a Child Workflow

When entering a state with `SubWorkflowConfig`:

1. Engine creates a parent task with purpose `sub_workflow`.
2. Engine applies the configured input mapper to generate child payload.
3. Engine writes a `CommandStartSubWorkflow` outbox message.
4. Engine creates a workflow link in `pending` status.
5. Transaction commits.
6. Outbox relay starts the child workflow.
7. Child workflow instance is created with link metadata.
8. Workflow link status becomes `running`.

### 24.2 Child Completion

When child workflow reaches a terminal success state:

1. Engine detects the child has a parent workflow link.
2. Engine maps child output using parent `OutputMapper`.
3. Engine sends or internally creates a callback using the parent task token.
4. Parent workflow resumes with `OnCompletedEvent`.

### 24.3 Child Failure

When child workflow reaches a terminal failure state:

1. Engine updates workflow link status to `failed`.
2. Engine resumes parent using `OnFailedEvent`, if configured.
3. If no failure event is configured, parent may transition to failed status according to definition policy.

### 24.4 Parent Cancellation or Timeout

If the parent leaves the waiting state before the child completes:

1. Engine cancels the parent sub-workflow task.
2. Engine updates workflow link status to `cancelled`.
3. Engine writes `CommandCancelSubWorkflow` to the outbox.
4. Child workflow receives cancellation request.
5. If child later completes, its callback is stale and ignored.

---

## 25. Execution Lifecycle: Cancellation

### 25.1 Cancellation Flow

1. Client calls `Cancel(instanceID, CancelRequest)`.
2. Engine checks idempotency.
3. Engine loads instance.
4. If instance is already terminal, return current terminal result.
5. Engine checks whether current state allows cancellation.
6. Engine marks instance status as `cancelled`.
7. Engine cancels all pending tasks for the current instance version.
8. Engine emits cancellation commands:

   * cancel timers;
   * cancel child workflows;
   * optionally notify workers.
9. Engine inserts history records.
10. Transaction commits.

### 25.2 Cancellation Semantics

Cancellation is best-effort for external workers.

The engine guarantees that late callbacks from cancelled tasks will not advance the workflow.

---

## 26. Terminal State Handling

When an instance enters a terminal state:

1. Engine sets instance status:

   * `completed`;
   * `failed`;
   * or `cancelled`.
2. Engine cancels all pending tasks for the instance.
3. Engine emits cleanup commands if needed.
4. Engine records terminal history.
5. Engine rejects or ignores future events except idempotent duplicate requests.

Terminal instances must not transition further.

---

## 27. Reliability Guarantees

### 27.1 State Update Atomicity

The engine guarantees that a committed state transition also commits:

* event record;
* task updates;
* new task records;
* outbox messages;
* workflow links;
* history records.

### 27.2 External Side Effect Safety

The engine never performs external side effects before the transition transaction commits.

All external side effects flow through the outbox.

### 27.3 Callback Race Safety

Callbacks are safe under concurrent delivery because task tokens are bound to instance state and version.

Only the first valid callback for a pending task can complete the task and advance the workflow.

### 27.4 Timeout Race Safety

Worker callback and timeout callback may race.

Only the callback whose task is still pending and whose state/version binding still matches the instance can advance the workflow.

### 27.5 Duplicate Delivery Safety

The system assumes at-least-once delivery from queues, workers, timers, and outbox relay.

All consumers must be idempotent.

### 27.6 Optimistic Locking

Instance updates must use:

```sql
UPDATE workflow_instances
SET state = ?, status = ?, payload = ?, version = version + 1, updated_at = ?
WHERE id = ? AND version = ?
```

If no row is updated, the engine must treat it as a concurrency conflict.

---

## 28. Error Model

### 28.1 Core Errors

```go
var (
    ErrDefinitionNotFound        = errors.New("definition not found")
    ErrDefinitionVersionNotFound = errors.New("definition version not found")
    ErrInvalidDefinition         = errors.New("invalid definition")
    ErrInstanceNotFound          = errors.New("instance not found")
    ErrInstanceTerminal          = errors.New("instance is terminal")
    ErrTransitionNotAllowed      = errors.New("transition not allowed")
    ErrGuardNotSatisfied         = errors.New("guard not satisfied")
    ErrInvalidPayload            = errors.New("invalid payload")
    ErrInvalidTaskToken          = errors.New("invalid task token")
    ErrTaskAlreadyResolved       = errors.New("task already resolved")
    ErrStaleTask                 = errors.New("stale task")
    ErrDuplicateRequestConflict  = errors.New("duplicate request conflict")
    ErrConcurrencyConflict       = errors.New("optimistic locking conflict")
)
```

### 28.2 Error Handling Policy

| Error                      | HTTP Equivalent |     Retry? | Notes                                   |
| -------------------------- | --------------: | ---------: | --------------------------------------- |
| Definition not found       |             404 |         No | Configuration issue                     |
| Instance not found         |             404 |         No | Invalid instance ID                     |
| Invalid payload            |             400 |         No | Schema validation failed                |
| Transition not allowed     |             409 | Usually no | Event not valid for current state       |
| Duplicate request conflict |             409 |         No | Same idempotency key, different payload |
| Concurrency conflict       |       409 / 503 |        Yes | Retry with same idempotency key         |
| Invalid task token         |       401 / 404 |         No | Could be unauthorized or expired        |
| Stale task                 |       200 / 202 |         No | Safe no-op                              |
| Repository transient error |             503 |        Yes | Retry safe if idempotent                |
| Outbox publish failure     |             N/A |        Yes | Relay retries                           |

---

## 29. Storage Schema Sketch

### 29.1 `workflow_instances`

| Column         | Type               |
| -------------- | ------------------ |
| id             | string / uuid      |
| wf_name        | string             |
| wf_version     | string             |
| state          | string             |
| status         | string             |
| payload        | json               |
| payload_schema | string             |
| version        | bigint             |
| created_at     | timestamp          |
| updated_at     | timestamp          |
| completed_at   | timestamp nullable |

Unique indexes:

```text
primary key (id)
index (wf_name, wf_version)
index (status, updated_at)
```

### 29.2 `workflow_tasks`

| Column         | Type               |
| -------------- | ------------------ |
| token          | string             |
| instance_id    | string             |
| state          | string             |
| version        | bigint             |
| purpose        | string             |
| status         | string             |
| expected_event | string             |
| expires_at     | timestamp nullable |
| created_at     | timestamp          |
| updated_at     | timestamp          |
| resolved_at    | timestamp nullable |

Indexes:

```text
primary key (token)
index (instance_id, state, version, status)
index (expires_at, status)
```

### 29.3 `workflow_event_records`

| Column          | Type      |
| --------------- | --------- |
| instance_id     | string    |
| idempotency_key | string    |
| request_hash    | string    |
| event           | string    |
| status          | string    |
| result_state    | string    |
| result_version  | bigint    |
| error_code      | string    |
| created_at      | timestamp |
| updated_at      | timestamp |

Indexes:

```text
primary key (instance_id, idempotency_key)
```

### 29.4 `workflow_outbox`

| Column          | Type               |
| --------------- | ------------------ |
| id              | string             |
| topic           | string             |
| key             | string             |
| command_type    | string             |
| payload         | json               |
| status          | string             |
| attempts        | int                |
| next_attempt_at | timestamp          |
| locked_by       | string nullable    |
| locked_until    | timestamp nullable |
| last_error      | text               |
| trace_id        | string             |
| created_at      | timestamp          |
| updated_at      | timestamp          |
| published_at    | timestamp nullable |

Indexes:

```text
primary key (id)
index (status, next_attempt_at)
index (locked_until)
index (key)
```

### 29.5 `workflow_links`

| Column             | Type               |
| ------------------ | ------------------ |
| parent_instance_id | string             |
| parent_task_token  | string             |
| child_instance_id  | string             |
| status             | string             |
| created_at         | timestamp          |
| updated_at         | timestamp          |
| completed_at       | timestamp nullable |

Indexes:

```text
primary key (parent_task_token)
index (parent_instance_id)
index (child_instance_id)
index (status)
```

### 29.6 `workflow_history`

| Column      | Type            |
| ----------- | --------------- |
| id          | string          |
| instance_id | string          |
| type        | string          |
| state_from  | string nullable |
| state_to    | string nullable |
| event       | string nullable |
| details     | json            |
| trace_id    | string          |
| created_at  | timestamp       |

Indexes:

```text
primary key (id)
index (instance_id, created_at)
index (type, created_at)
```

---

## 30. Outbox Relay Design

### 30.1 Polling Flow

1. Relay selects pending messages where `next_attempt_at <= now`.
2. Relay claims messages by setting:

   * status = `publishing`;
   * locked_by = relay ID;
   * locked_until = now + lock duration.
3. Relay publishes each message to the target system.
4. On success:

   * status = `published`;
   * published_at = now.
5. On transient failure:

   * attempts += 1;
   * status = `pending`;
   * next_attempt_at = exponential backoff time.
6. On permanent failure or max attempts exceeded:

   * status = `dead_letter`.

### 30.2 Lock Recovery

If a relay crashes while publishing, another relay may reclaim the message after `locked_until`.

This may cause duplicate publication. Consumers must be idempotent.

---

## 31. Security Considerations

### 31.1 Task Token Security

Task tokens must be:

* generated using a cryptographically secure random source;
* sufficiently long;
* treated as bearer secrets;
* never logged in plaintext;
* optionally hashed at rest;
* scoped to a single task.

### 31.2 Callback Authentication

Callbacks should be authenticated using one or more of:

* signed callback payloads;
* mTLS;
* private network ingress;
* API gateway authorization;
* worker identity tokens.

Task token alone should not be the only security boundary for high-risk workflows.

### 31.3 Payload Security

Payloads may contain sensitive data.

The system should support:

* encryption at rest;
* field redaction in logs;
* payload size limits;
* schema validation;
* secret reference patterns instead of storing raw secrets.

---

## 32. Observability

### 32.1 Metrics

The engine should emit metrics for:

* workflow starts;
* transition attempts;
* transition successes;
* transition failures;
* concurrency conflicts;
* stale callbacks;
* duplicate callbacks;
* timeout firings;
* outbox backlog;
* outbox publish latency;
* outbox dead-letter count;
* task age;
* workflow duration;
* terminal status distribution.

### 32.2 Logs

Logs should include:

* instance ID;
* workflow name;
* workflow version;
* state;
* event;
* trace ID;
* command ID;
* outbox message ID.

Task tokens should be redacted.

### 32.3 Tracing

The engine should propagate trace IDs through:

* API request;
* event processing;
* outbox messages;
* worker command;
* callback;
* child workflow start;
* timer callback.

---

## 33. Deployment Model

### 33.1 Engine

The engine can run as:

* serverless function;
* containerized API service;
* Kubernetes deployment;
* queue consumer.

It remains stateless and horizontally scalable.

### 33.2 Repository

Supported backing stores may include:

* PostgreSQL;
* MySQL;
* DynamoDB with transactional writes;
* Spanner-like distributed SQL systems.

The selected database must support the required atomic writes and conditional updates.

### 33.3 Outbox Relay

The relay may run as:

* scheduled serverless function;
* long-running worker;
* Kubernetes deployment;
* managed stream processor.

### 33.4 Timer Provider

The timer provider should be selected based on required scale, precision, durability, and cost.

---

## 34. Example Workflow

### 34.1 Definition

```go
Definition{
    Name:    "order_fulfillment",
    Version: "2026-05-01",

    InitialState: "created",

    States: map[State]StateConfig{
        "created": {
            Name: "created",
            OnEntry: ActionRef{
                Name: "reserve_inventory",
            },
            Timeout: &StateTimeoutConfig{
                Duration: 15 * time.Minute,
                Event: "inventory_reservation_timeout",
            },
        },
        "inventory_reserved": {
            Name: "inventory_reserved",
            OnEntry: ActionRef{
                Name: "charge_payment",
            },
            Timeout: &StateTimeoutConfig{
                Duration: 10 * time.Minute,
                Event: "payment_timeout",
            },
        },
        "completed": {
            Name: "completed",
        },
        "failed": {
            Name: "failed",
        },
    },

    Transitions: []Transition{
        {
            From: "created",
            Event: "inventory_reserved",
            To: "inventory_reserved",
        },
        {
            From: "created",
            Event: "inventory_reservation_timeout",
            To: "failed",
        },
        {
            From: "inventory_reserved",
            Event: "payment_charged",
            To: "completed",
        },
        {
            From: "inventory_reserved",
            Event: "payment_timeout",
            To: "failed",
        },
    },

    TerminalStates: map[State]TerminalType{
        "completed": TerminalSuccess,
        "failed": TerminalFailure,
    },
}
```

### 34.2 Execution

1. `Start(order_fulfillment)` creates instance in `created`.
2. Engine evaluates `reserve_inventory`.
3. Engine creates worker task and timeout task.
4. Engine writes worker command and schedule-timer command to outbox.
5. Worker reserves inventory and calls back with `inventory_reserved`.
6. Engine validates task token and transitions to `inventory_reserved`.
7. Engine cancels old timeout task.
8. Engine evaluates `charge_payment`.
9. Engine creates payment worker task and payment timeout task.
10. Worker calls back with `payment_charged`.
11. Engine transitions to `completed`.
12. Engine marks instance `completed`.
13. Any late timeout callback is ignored as stale.

---

## 35. Open Design Questions

The following topics require future design work:

1. Should the engine support transition-level actions in addition to state `OnEntry` actions?
2. Should payload mutation be handled by actions, mappers, or a dedicated reducer interface?
3. Should failed actions fail the workflow or block the transition?
4. Should workflow definitions be stored as code, JSON/YAML, or both?
5. Should guard and mapper logic be implemented as registered Go handlers or declarative expressions?
6. How should the engine support schema migration for long-running instances?
7. Should history support deterministic replay or only audit/debugging?
8. Should child workflow fan-out/fan-in be supported in the first version?
9. Should outbox ordering be guaranteed per instance, per task, or not at all?
10. Should task tokens be stored hashed at rest?

---

## 36. Implementation Priorities

The first implementation should prioritize correctness before feature breadth.

### P0: Required for Correctness

1. Versioned workflow definitions.
2. Instance binding to workflow definition version.
3. Persistent task token table.
4. Task token to instance/state/version binding.
5. Transactional idempotency.
6. Transactional outbox.
7. Optimistic locking.
8. Terminal state and instance status.
9. Timeout schedule/cancel through outbox only.
10. Workflow history.

### P1: Required for Sub-Workflow Safety

1. Workflow link table.
2. Parent-child lifecycle tracking.
3. Child completion callback through parent task token.
4. Cascading cancellation.
5. Late child completion protection.

### P2: Required for Operability

1. Outbox relay retry and dead-letter handling.
2. Metrics.
3. Structured logs.
4. Trace propagation.
5. Admin inspection APIs.
6. Task and instance cleanup jobs.

### P3: Advanced Orchestration

1. Fan-out / fan-in.
2. Retry policy DSL.
3. Compensation workflows.
4. Declarative guards.
5. Payload schema migration.
6. Workflow replay.

---

## 37. Conclusion

This design defines a serverless-first workflow engine whose correctness depends on durable state, immutable definitions, persistent task tokens, transactional idempotency, and transactional outbox delivery.

The most important design decision is that every asynchronous wait point is modeled as a persisted task token bound to a specific instance state and version. This allows the engine to handle duplicate callbacks, stale timeouts, late child completions, worker retries, and concurrent event delivery safely.

The second most important decision is that all external side effects flow through the outbox. The engine never updates workflow state and calls an external system in separate non-atomic steps.

With these two foundations, the workflow engine can safely scale horizontally in serverless environments while preserving deterministic state transitions and operational auditability.


