# High-Level Design (HLD): Serverless State Machine Workflow Engine (Revised)

## 1. Introduction

This document describes the architecture and core interface design for a distributed, serverless-first workflow engine implemented in Go.

The engine is modeled as a state-machine orchestration system. Given an `(instance, state, version, event, payload)` tuple, the resulting target state is computed by a deterministic transition function. The engine itself is a stateless control plane that evaluates transitions, persists workflow state, emits durable commands, and coordinates asynchronous callbacks from external workers, timers, and child workflows.

The engine does not execute long-running business logic directly. All external work is delegated to workers or infrastructure services through durable commands written to a transactional outbox.

This revision strengthens the previous draft in the following areas:

- Outbox ordering is now a first-class correctness guarantee instead of an open question.
- Action execution is split into a pure planning phase and a state-mutation phase to bound transaction work.
- Action failure semantics, callback authentication, version ordering, and sub-workflow callback transport are explicitly defined.
- The repository interface is decomposed into per-aggregate stores under a unit-of-work abstraction.
- Idempotency records, history events, and terminal instances all have explicit retention and cleanup paths.
- Stuck-instance detection is part of the operational baseline.
- Task tokens are hashed at rest by default.

---

## 2. Goals and Non-Goals

### 2.1 Primary Goals

1. Support serverless and horizontally scalable deployments.
2. Keep the engine stateless at the compute layer.
3. Model workflows as immutable, versioned state-machine definitions.
4. Provide a deterministic state transition function: same `(state, version, event, payload, definition)` always produces the same target state.
5. Support asynchronous task execution through persistent callback tokens.
6. Provide strong protection against duplicate events, duplicate callbacks, and concurrent delivery.
7. Support state timeouts using external timer infrastructure.
8. Support sub-workflow orchestration with explicit parent-child lifecycle tracking and well-defined callback transport.
9. Guarantee atomic persistence of state changes, task records, idempotency records, history records, and outbound messages.
10. Guarantee per-instance ordering of outbox commands so that cancel/schedule pairs cannot be reordered downstream.
11. Provide retention and cleanup for idempotency records, history events, and terminal-state task data.
12. Detect and surface stuck workflow instances as a built-in operational concern.

### 2.2 Non-Goals

The following are intentionally out of scope:

1. Temporal-style deterministic replay of application code. The engine guarantees a deterministic transition function, **not** deterministic re-execution of side-effecting application code.
2. Arbitrary DAG execution.
3. Distributed transactions across external systems.
4. Synchronous long-running task execution inside the engine.
5. Complex compensation DSL.
6. Built-in human approval UI.
7. Multi-region active-active consensus.

The distinction in non-goal #1 matters: actions in this engine are constrained, but they are **not** required to be replayable. A given `(input context, params)` should produce the same `[]CommandSpec`, but the engine does not record action inputs/outputs in a way that allows re-deriving past results from scratch.

---

## 3. Architectural Principles

### 3.1 Serverless-First Control Plane

The engine must never block while waiting for external work. All long-running work is represented as a durable task and resumed through one of:

- worker callback;
- timeout callback;
- child workflow completion callback;
- explicit external event;
- cancellation event.

### 3.2 Durable State, Stateless Compute

Engine instances are stateless and horizontally scalable. Any engine process can handle any incoming event. Durable state lives in the repository:

- workflow instances;
- workflow tasks;
- idempotency records;
- workflow links (parent-child relationships);
- outbox messages;
- workflow history.

### 3.3 Immutable Versioned Definitions with Total Ordering

Workflow definitions are immutable once activated. Each instance is bound to one definition version at creation time and is evaluated against that version for its entire life.

Definition versions carry a server-assigned monotonic `ActivationSequence` integer. "Latest active version" means the active definition with the highest `ActivationSequence`. The `WorkflowVersion` string is treated as an opaque label for humans; the integer is what the engine uses for ordering.

### 3.4 Transactional Outbox for All External Side Effects

The engine never performs external side effects inside a transition transaction. State changes and outbox writes commit together. A separate outbox relay publishes commands with at-least-once semantics.

### 3.5 Per-Partition Outbox Ordering

The outbox guarantees FIFO delivery per `partition_key`. The engine assigns partition keys such that any pair of commands that must be ordered downstream (for example, "cancel timer X" and "schedule timer Y" emitted from the same transition) share a partition key. This eliminates the cancel-before-schedule race that would otherwise occur when commands targeting the same logical resource are reordered by the relay.

### 3.6 Persistent Task Tokens Bound to State and Version

Every asynchronous wait point is represented by a durable task record. A task token is bound to:

- workflow instance ID;
- state at the time the task was created;
- instance version at the time the task was created;
- task purpose;
- expected callback event;
- task status;
- optional expiration time.

This binding allows the engine to reject stale callbacks, duplicate callbacks, timeout races, and callbacks for abandoned states. Task tokens are stored as hashes; raw tokens exist only in transit.

### 3.7 Two-Phase Action Execution

An action evaluation has two phases:

1. **Plan** (pure, may run inside or outside a transaction): given the evaluation context, return `[]CommandSpec` and an optional payload patch.
2. **Apply** (always inside the transition transaction): the engine materializes commands, tasks, and outbox messages from the planned specs.

The plan phase is forbidden from performing external I/O. A sentinel context flag is propagated and any registered I/O client must refuse calls under this flag.

### 3.8 Transactional Idempotency

Idempotency is enforced inside the same transaction as the state transition via a unique constraint on `(instance_id, idempotency_key)`. There is no separate "processing" phase visible to other readers — the engine commits in a single transaction, so idempotency records have only succeeded or failed terminal states.

### 3.9 Complete, Bounded Audit History

Every accepted event, rejected stale callback, transition, command emission, task lifecycle change, and workflow lifecycle change is recorded as workflow history. History is append-only but **not** infinite — terminal instances and their associated rows have an explicit retention policy (Section 35).

---

## 4. Core Concepts

### 4.1 Workflow Definition

An immutable blueprint containing: name, version label, activation sequence, initial state, state configs, transition rules, terminal states, schema metadata, action references, and mapper references. Loaded by `(workflow_name, workflow_version)` and cached in process.

### 4.2 Workflow Instance

A running or completed execution of a workflow definition. Each instance carries its bound `(WfName, WfVersion)`, current state, lifecycle status, payload, optimistic lock version, and timestamps.

### 4.3 State

A durable point in the workflow. May define an entry action, a timeout, sub-workflow config, terminal behavior, and cancellation behavior.

### 4.4 Event

An input that attempts to advance an instance. Origins: external API, worker callback, timeout callback, child completion, cancellation, system recovery.

### 4.5 Transition

A valid `(from, event) → to` movement, optionally guarded.

### 4.6 Task

An outstanding asynchronous wait point. Owns a callback token. Purposes: worker, timeout, sub-workflow, cancellation.

### 4.7 Outbox Message

A durable command awaiting delivery to an external system. Carries a `partition_key` so that ordered command sequences are not reordered by the relay.

### 4.8 History Event

An immutable audit record. Subject to retention policy after the parent instance reaches terminal state.

### 4.9 Workflow Link

A first-class table row recording a parent-child workflow relationship. Identified by a surrogate `link_id`, with a unique constraint on the parent task token.

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
        │                   Repository (Unit of Work)               │
        │                                                           │
        │  Instances · Tasks · Idempotency · Links · Outbox ·       │
        │  History                                                  │
        └───────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                           ┌─────────────────┐
                           │  Outbox Relay   │
                           │  (poll or CDC)  │
                           └───────┬─────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
 ┌──────────────┐          ┌───────────────┐          ┌──────────────┐
 │ Worker Queue │          │ Timer Service │          │ Child Starter│
 └──────┬───────┘          └───────┬───────┘          └──────┬───────┘
        │                          │                         │
        ▼                          ▼                         ▼
 ┌──────────────┐          ┌───────────────┐          ┌──────────────┐
 │ Workers      │          │ Timeout Event │          │ Child Engine │
 └──────┬───────┘          └───────┬───────┘          └──────┬───────┘
        │                          │                         │
        └──────────────┬───────────┴──────────────┬──────────┘
                       ▼                          ▼
                ┌────────────────────────────────────┐
                │ Callback Gateway (auth + dispatch) │
                └────────────────────────────────────┘
                                   │
                                   ▼
                          (back into Engine Core)
```

---

## 6. Component Responsibilities

### 6.1 Definition Registry

Stores immutable definitions. Responsibilities: register drafts, validate topology, activate (assigning a monotonic `ActivationSequence`), reject incompatible duplicates, load by `(name, version)`, resolve latest active version, cache, and refuse mutation of activated definitions.

### 6.2 Engine Core

Stateless decision maker. Responsibilities: start instances, accept events, handle callbacks, validate events against the definition version bound to the instance, evaluate guards, plan and apply entry actions, create task records, write outbox commands, write history, complete or cancel tasks, enforce optimistic concurrency, enforce idempotency, and reject stale callbacks safely. Never directly calls external systems during transition processing.

### 6.3 Repository

Owns persistence. Exposes a `UnitOfWork` abstraction over per-aggregate stores. Provides transactional unit-of-work API, optimistic lock checks, task-token lookup, and safe retry semantics.

### 6.4 Outbox Relay

Publishes outbox messages. Responsibilities: claim pending messages with fencing tokens, publish with at-least-once delivery, retry transient failures with backoff, dead-letter permanent failures, **preserve per-partition-key ordering**, and record attempts/errors. Implementations may be polling-based or CDC-based; both must satisfy the same contract.

### 6.5 Callback Gateway

Receives callbacks. Responsibilities: authenticate the source (signature, mTLS, or both), validate request shape, forward to `Engine.HandleCallback`, return safe success for duplicate/stale callbacks, rate-limit by `(token, payload-hash)` to bound the cost of malicious replays, and avoid leaking instance internals.

### 6.6 Timer Provider

External service that fires callbacks after a configured delay. Examples: AWS EventBridge Scheduler, Cloud Tasks, delayed queues, DB-backed schedulers. The engine never calls the provider directly — schedule/cancel requests go through the outbox.

### 6.7 External Workers

Consume commands from queues or topics. Must be idempotent, must use the provided task token in the callback, and must tolerate at-least-once delivery.

### 6.8 Stuck Instance Detector

Background job. Periodically scans for tasks where `expires_at + grace_period < now AND status = pending`, and for instances where no progress has occurred for an unusually long window. Surfaces these for operator action and metrics.

### 6.9 Retention Worker

Background job. Archives or deletes idempotency records, history events, and terminated-instance rows according to retention policy (Section 35).

---

## 7. Data Model — Primitive Types

```go
package workflow

import (
    "context"
    "encoding/json"
    "errors"
    "time"
)

type WorkflowName       string
type WorkflowVersion    string  // human label; not used for ordering
type ActivationSequence int64   // monotonic; used for "latest active" resolution
type InstanceID         string
type State              string
type Event              string

// TaskToken is a cryptographically random secret. The engine stores
// only the hash; the raw value exists only in transit.
type TaskToken          string
type TaskTokenHash      [32]byte

type CommandID          string
type OutboxMessageID    string
type PartitionKey       string
type IdempotencyKey     string
type HistoryEventID     string
type LinkID             string
```

---

## 8. Workflow Definition Model

### 8.1 Definition

```go
type Definition struct {
    Name               WorkflowName
    Version            WorkflowVersion
    ActivationSequence ActivationSequence  // assigned at activation

    InitialState   State
    States         map[State]StateConfig
    Transitions    []Transition
    TerminalStates map[State]TerminalType

    InputSchemaRef  string  // resolved by SchemaRegistry; immutable per version
    OutputSchemaRef string

    CreatedAt   time.Time
    ActivatedAt *time.Time
}
```

### 8.2 State Config

```go
type StateConfig struct {
    Name              State
    OnEntry           *ActionRef            // optional; nil means no entry action
    Timeout           *StateTimeoutConfig   // optional
    SubWorkflow       *SubWorkflowConfig    // optional
    AllowCancellation bool
}
```

A terminal state must not have `OnEntry`, `Timeout`, or `SubWorkflow` set; the registry rejects definitions that violate this.

### 8.3 Terminal Type

```go
type TerminalType string

const (
    TerminalSuccess   TerminalType = "success"
    TerminalFailure   TerminalType = "failure"
    TerminalCancelled TerminalType = "cancelled"
)
```

### 8.4 Transition

```go
type Transition struct {
    From  State
    To    State
    Event Event
    Guard *GuardRef  // nil means unconditional
}
```

### 8.5 References

```go
type ActionRef struct {
    Name   string
    Params map[string]any
}

type GuardRef struct {
    Name   string
    Params map[string]any
}

type MapperRef struct {
    Name   string
    Params map[string]any
}
```

A nil `MapperRef` in `SubWorkflowConfig.InputMapper` means "pass parent payload through unchanged." A nil `OutputMapper` means "discard child output." Both behaviors must be explicit, not implicit.

### 8.6 Sub-Workflow Config

```go
type SubWorkflowConfig struct {
    DefinitionName WorkflowName

    // Pinned version is recommended for production stability.
    // If nil, the engine resolves latest active at start time.
    PinnedVersion *WorkflowVersion

    InputMapper  *MapperRef
    OutputMapper *MapperRef

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

    Version int64  // optimistic lock counter

    // Heartbeat for stuck-instance detection: updated on every transition.
    LastProgressAt time.Time

    CreatedAt   time.Time
    UpdatedAt   time.Time
    CompletedAt *time.Time
}
```

### 9.3 Version Binding

`Start()` resolves the highest `ActivationSequence` for the workflow name (or honors a requested explicit version) and stores `(WfName, WfVersion)` on the instance. `FireEvent()` and `HandleCallback()` always reload the definition by `(instance.WfName, instance.WfVersion)`. Instances are unaffected by future definition changes.

---

## 10. Task Model

### 10.1 Task Purpose and Status

```go
type TaskPurpose string

const (
    TaskPurposeWorker       TaskPurpose = "worker"
    TaskPurposeTimeout      TaskPurpose = "timeout"
    TaskPurposeSubWorkflow  TaskPurpose = "sub_workflow"
    TaskPurposeCancellation TaskPurpose = "cancellation"
)

type TaskStatus string

const (
    TaskPending   TaskStatus = "pending"
    TaskCompleted TaskStatus = "completed"
    TaskCancelled TaskStatus = "cancelled"
    TaskExpired   TaskStatus = "expired"
)
```

### 10.2 Task

```go
type Task struct {
    // TokenHash is the persisted form. The raw token is never stored.
    TokenHash TaskTokenHash

    InstanceID InstanceID
    State      State
    Version    int64

    Purpose TaskPurpose
    Status  TaskStatus

    ExpectedEvent Event

    // PartitionKey ensures all outbox commands related to this task
    // (schedule + cancel + worker invoke) are ordered FIFO downstream.
    PartitionKey PartitionKey

    ExpiresAt  *time.Time
    CreatedAt  time.Time
    UpdatedAt  time.Time
    ResolvedAt *time.Time
}
```

### 10.3 Task Token Rules

1. Cryptographically secure random source.
2. Globally unique.
3. Persisted as a hash before being delivered to workers or timers.
4. Single-use for successful callbacks.
5. Bound to instance ID, state, and version.
6. Rejected if the instance has moved to another state or version.
7. Safe to receive more than once (returns success no-op when already completed).

### 10.4 Callback Validation

When a callback arrives, the engine verifies, in order:

```text
1. callback signature is valid
2. task with matching token hash exists
3. task.status == pending
4. instance.id == task.instance_id
5. instance.state == task.state
6. instance.version == task.version
7. callback.event == task.expected_event
8. instance.status == running
```

Failure cases:

| Failure                      | Treatment                                                    |
| ---------------------------- | ------------------------------------------------------------ |
| Bad signature                | Reject with auth error; rate-limit caller                    |
| Token unknown                | Reject; gateway rate-limits to bound replay cost             |
| Task already completed       | Idempotent success: return 200, write history (deduped)      |
| State/version mismatch       | Stale: return 200, write history (deduped), increment metric |
| Wrong event                  | Reject with logical error                                    |
| Instance terminal            | Stale: same as state/version mismatch                        |

History writes for stale callbacks are **deduplicated within a short window per task token** — a single `callback_ignored` history row records the first occurrence and a counter; subsequent stale callbacks within the window only update the counter. This bounds the cost of replay attacks even if rate limiting fails.

---

## 11. Event and Callback Model

### 11.1 Event Request

```go
type EventRequest struct {
    Event          Event
    IdempotencyKey IdempotencyKey
    Payload        json.RawMessage
    RequestID      string
    TraceID        string
}
```

### 11.2 Callback Request

```go
type CallbackRequest struct {
    TaskToken TaskToken       `json:"task_token"`
    Event     Event           `json:"event"`
    Result    json.RawMessage `json:"result"`

    // Authentication. The gateway requires at least one of:
    //   - Signature: HMAC over (task_token || event || result || timestamp),
    //     keyed per-worker-identity.
    //   - mTLS at the transport layer + WorkerIdentity claim.
    Signature       string `json:"signature,omitempty"`
    SignatureKeyID  string `json:"signature_key_id,omitempty"`
    Timestamp       int64  `json:"timestamp"`
    WorkerIdentity  string `json:"worker_identity,omitempty"`

    RequestID string `json:"request_id,omitempty"`
    TraceID   string `json:"trace_id,omitempty"`
}
```

The default deployment requires signature-based auth. The token hash alone is **not** the security boundary; signature provides authenticity, the token provides authorization scope.

Callbacks do not include `instance_id` — the engine resolves it through the persisted task record, preventing callers from forging cross-instance writes.

---

## 12. Idempotency Model

### 12.1 Event Record Status

```go
type EventRecordStatus string

const (
    EventSucceeded EventRecordStatus = "succeeded"
    EventFailed    EventRecordStatus = "failed"
)
```

There is no `Processing` status. The engine commits all idempotency state changes inside the transition transaction, so no other reader ever observes an in-flight record.

### 12.2 Event Record

```go
type EventRecord struct {
    InstanceID     InstanceID
    IdempotencyKey IdempotencyKey
    RequestHash    string  // SHA-256 of (event, normalized payload)

    Event Event

    Status EventRecordStatus

    ResultState   State
    ResultVersion int64
    ErrorCode     string

    CreatedAt time.Time
    UpdatedAt time.Time

    // Retention pointer. Nil while parent instance is non-terminal;
    // populated at terminal time and used by the retention worker.
    EligibleForCleanupAt *time.Time
}
```

### 12.3 Rules for External Events

1. `IdempotencyKey` is required.
2. `(instance_id, idempotency_key)` is unique.
3. `RequestHash` includes event name and normalized payload.
4. Same key + same hash + status `succeeded` → return original result.
5. Same key + same hash + status `failed` → caller may retry, treated as fresh attempt (the failed record is overwritten in the same transaction).
6. Same key + different hash → `ErrDuplicateRequestConflict`.
7. The record is inserted/updated in the same transaction as the state transition.

### 12.4 Rules for Callbacks

1. The task token hash is the primary idempotency key.
2. Duplicate callbacks for completed tasks return a successful no-op.
3. Callbacks for stale state/version are recorded once per window in history (Section 10.4).

### 12.5 Retention

Event records become eligible for cleanup `idempotency_retention` after the parent instance reaches terminal state. Default: 7 days. The retention worker (Section 35) batch-deletes expired records.

---

## 13. Command and Outbox Model

### 13.1 Command Type

```go
type CommandType string

const (
    CommandInvokeWorker      CommandType = "invoke_worker"
    CommandScheduleTimer     CommandType = "schedule_timer"
    CommandCancelTimer       CommandType = "cancel_timer"
    CommandStartSubWorkflow  CommandType = "start_sub_workflow"
    CommandCancelSubWorkflow CommandType = "cancel_sub_workflow"
    CommandEmitNotification  CommandType = "emit_notification"
)
```

### 13.2 Command Spec

Actions return command specs. The engine materializes outbox messages and task tokens.

```go
type CommandSpec struct {
    Type             CommandType
    Payload          json.RawMessage
    RequiresCallback bool
    ExpectedEvent    Event
    Timeout          *time.Duration

    // Optional explicit grouping for ordering. When empty, the engine
    // uses (instance_id) as the partition key. For sub-workflow and
    // timer pairs (schedule/cancel) the engine derives a stable key
    // from the task identity so both messages share a partition.
    PartitionHint string
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

    // Critical for ordering: messages with the same PartitionKey are
    // delivered in insertion order. See Section 30.
    PartitionKey PartitionKey

    Topic       string
    CommandType CommandType
    Payload     json.RawMessage

    Status OutboxStatus

    Attempts      int
    NextAttemptAt time.Time

    // Fencing fields. LockGeneration is monotonic; relays update with
    // a CAS on (id, lock_generation). Prevents split-brain double-publish
    // from corrupting status when an old relay wakes up after GC pause.
    LockedBy       string
    LockedUntil    *time.Time
    LockGeneration int64

    LastError string
    TraceID   string

    CreatedAt   time.Time
    UpdatedAt   time.Time
    PublishedAt *time.Time
}
```

### 13.5 Delivery Semantics

The outbox provides **at-least-once delivery with per-partition FIFO ordering**.

Concretely:

1. All consumers must be idempotent.
2. Every command carries a stable `command_id` for downstream dedup.
3. Within a single `partition_key`, messages are published in insertion order; a message will not be marked `published` until all earlier messages in its partition have been published (or moved to dead-letter).
4. Across partitions, no ordering is implied.

Partition key construction:

| Command                             | Partition key                                      |
| ----------------------------------- | -------------------------------------------------- |
| `invoke_worker`                     | `instance_id`                                      |
| `schedule_timer` / `cancel_timer`   | `instance_id:timer:{logical_timer_id}`             |
| `start_sub_workflow` / `cancel_sub` | `instance_id:child:{link_id}`                      |
| `emit_notification`                 | configurable; default `instance_id`                |

This is what keeps "cancel old timer" and "schedule new timer" from racing each other — they target the same logical timer slot and therefore share a partition.

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
    ID LinkID  // surrogate primary key

    ParentInstanceID InstanceID
    ParentTaskHash   TaskTokenHash  // unique; bound to a single waiting task

    ChildInstanceID *InstanceID  // nil until child is started

    Status WorkflowLinkStatus

    CreatedAt   time.Time
    UpdatedAt   time.Time
    CompletedAt *time.Time
}
```

Indexes:

- primary key on `id`;
- unique on `parent_task_hash`;
- index on `(parent_instance_id, status)`;
- index on `child_instance_id`.

### 14.3 Why a Surrogate Key

Using `parent_task_hash` directly as PK is fragile under retry: if a transition has to be replayed, the engine may need to insert/upsert the link before the parent task is fully finalized. A surrogate `link_id` lets the engine reason about link lifecycle independently from task lifecycle, and leaves room for fan-out (multiple children per parent task — out of scope for v1 but not blocked).

---

## 15. History Model

### 15.1 History Event Type

```go
type HistoryEventType string

const (
    HistoryWorkflowStarted        HistoryEventType = "workflow_started"
    HistoryEventAccepted          HistoryEventType = "event_accepted"
    HistoryEventRejected          HistoryEventType = "event_rejected"
    HistoryGuardFailed            HistoryEventType = "guard_failed"
    HistoryTransitionTaken        HistoryEventType = "transition_taken"
    HistoryActionPlanFailed       HistoryEventType = "action_plan_failed"
    HistoryTaskCreated            HistoryEventType = "task_created"
    HistoryTaskCompleted          HistoryEventType = "task_completed"
    HistoryTaskCancelled          HistoryEventType = "task_cancelled"
    HistoryCommandEmitted         HistoryEventType = "command_emitted"
    HistoryTimerScheduled         HistoryEventType = "timer_scheduled"
    HistoryTimerCancelled         HistoryEventType = "timer_cancelled"
    HistoryTimeoutFired           HistoryEventType = "timeout_fired"
    HistoryCallbackReceived       HistoryEventType = "callback_received"
    HistoryCallbackIgnored        HistoryEventType = "callback_ignored"
    HistoryChildWorkflowStarted   HistoryEventType = "child_workflow_started"
    HistoryChildWorkflowCompleted HistoryEventType = "child_workflow_completed"
    HistoryWorkflowCompleted      HistoryEventType = "workflow_completed"
    HistoryWorkflowFailed         HistoryEventType = "workflow_failed"
    HistoryWorkflowCancelled      HistoryEventType = "workflow_cancelled"
    HistoryStuckDetected          HistoryEventType = "stuck_detected"
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
    Event     *Event

    Details json.RawMessage  // type-specific structured detail; never contains raw token

    TraceID string

    // For deduplicated stale callback rows, this counts how many
    // additional ignored callbacks were collapsed into this row.
    DedupCount int

    CreatedAt time.Time
}
```

History events are append-only during the instance's life. After terminal + retention window, the retention worker may delete or archive (Section 35).

---

## 16. Repository Interfaces

The repository is decomposed into per-aggregate stores accessed through a `UnitOfWork`. This replaces the previous god-interface design.

### 16.1 Unit of Work

```go
type Repository interface {
    InTx(ctx context.Context, fn func(uow UnitOfWork) error) error
}

type UnitOfWork interface {
    Instances()    InstanceStore
    Tasks()        TaskStore
    Idempotency()  IdempotencyStore
    Links()        WorkflowLinkStore
    Outbox()       OutboxStore
    History()      HistoryStore
}
```

### 16.2 Per-Aggregate Stores

```go
type InstanceStore interface {
    Create(ctx context.Context, inst *Instance) error
    Get(ctx context.Context, id InstanceID) (*Instance, error)
    Update(ctx context.Context, inst *Instance, expectedVersion int64) error
}

type TaskStore interface {
    Insert(ctx context.Context, t *Task) error
    GetByTokenHash(ctx context.Context, h TaskTokenHash) (*Task, error)
    UpdateStatus(ctx context.Context, h TaskTokenHash, from, to TaskStatus) error
    CancelPendingForInstanceVersion(
        ctx context.Context, instanceID InstanceID, state State, version int64,
    ) ([]Task, error)  // returns the cancelled tasks so caller can emit cancel commands
    ListExpired(ctx context.Context, before time.Time, limit int) ([]Task, error)
}

type IdempotencyStore interface {
    Upsert(ctx context.Context, r *EventRecord) error
    Get(ctx context.Context, instanceID InstanceID, key IdempotencyKey) (*EventRecord, error)
    MarkSucceeded(ctx context.Context, instanceID InstanceID, key IdempotencyKey,
                   state State, version int64) error
    MarkFailed(ctx context.Context, instanceID InstanceID, key IdempotencyKey,
                errorCode string) error
    DeleteEligible(ctx context.Context, before time.Time, limit int) (int, error)
}

type WorkflowLinkStore interface {
    Insert(ctx context.Context, l *WorkflowLink) error
    UpdateStatus(ctx context.Context, parentTaskHash TaskTokenHash,
                  status WorkflowLinkStatus) error
    GetByParentTaskHash(ctx context.Context, h TaskTokenHash) (*WorkflowLink, error)
    AttachChildInstance(ctx context.Context, linkID LinkID, childID InstanceID) error
}

type OutboxStore interface {
    Insert(ctx context.Context, msgs []OutboxMessage) error
    ClaimBatch(ctx context.Context, claimer string, leaseUntil time.Time,
                limit int) ([]OutboxMessage, error)
    MarkPublished(ctx context.Context, id OutboxMessageID,
                   expectedGeneration int64) error
    MarkFailed(ctx context.Context, id OutboxMessageID, expectedGeneration int64,
                err string, nextAttemptAt time.Time) error
    MarkDeadLetter(ctx context.Context, id OutboxMessageID,
                    expectedGeneration int64, err string) error
}

type HistoryStore interface {
    Insert(ctx context.Context, events []HistoryEvent) error
    UpsertDeduped(ctx context.Context, evt HistoryEvent, dedupKey string,
                   window time.Duration) error
    ListForInstance(ctx context.Context, instanceID InstanceID,
                     limit int, cursor string) ([]HistoryEvent, string, error)
    DeleteForTerminatedInstances(ctx context.Context, before time.Time,
                                   limit int) (int, error)
}
```

### 16.3 Transactional Requirements

The following must commit atomically inside `InTx`:

- instance update;
- idempotency record insert/update;
- task creation and task status changes;
- workflow link insert/update;
- outbox message insertion;
- history insertion.

If the transaction fails, no external command is observable.

### 16.4 Ordering Within a Transaction

The engine should batch all writes and execute them late in the transaction, after action planning is complete. See Section 21 for the canonical ordering.

---

## 17. Definition Registry Interface

```go
type Registry interface {
    RegisterDraft(ctx context.Context, def Definition) error

    // Activate validates and activates the definition, assigning the
    // next ActivationSequence atomically. Returns the assigned sequence.
    Activate(ctx context.Context, name WorkflowName,
              version WorkflowVersion) (ActivationSequence, error)

    Get(ctx context.Context, name WorkflowName,
         version WorkflowVersion) (Definition, error)

    // GetLatestActive returns the active definition with the highest
    // ActivationSequence for the given name. NOT lexicographic on Version.
    GetLatestActive(ctx context.Context, name WorkflowName) (Definition, error)
}
```

### 17.1 Definition Validation

Before activation, the registry must verify:

1. Initial state exists in `States`.
2. Every `Transition.From`, `Transition.To`, and `TerminalStates` key exists in `States`.
3. Every state declared in `TerminalStates` has no `OnEntry`, `Timeout`, or `SubWorkflow`.
4. Every non-terminal state has at least one outgoing transition (no dead non-terminal states).
5. Every state is reachable from `InitialState`.
6. No two transitions from the same state with the same event are both unguarded (ambiguity).
7. Every `ActionRef.Name` is registered in the action registry.
8. Every `GuardRef.Name` is registered in the guard registry.
9. Every `MapperRef.Name` is registered in the mapper registry.
10. For every state with `Timeout`, the configured timeout event has a valid transition out of that state.
11. Every `SubWorkflowConfig.DefinitionName` resolves (or is annotated as deferred resolution).
12. `InputSchemaRef` and `OutputSchemaRef` resolve in the schema registry.

### 17.2 Schema References

Schemas are stored in a separate `SchemaRegistry`, versioned independently. A `Definition` references schemas by `(name, version)` strings. Schemas are immutable once referenced by an activated definition. Schema evolution for long-running instances is deferred to a future revision (Section 37).

---

## 18. Engine Interface

```go
type Engine interface {
    Start(ctx context.Context, wfName WorkflowName,
           req StartRequest) (*Instance, error)

    FireEvent(ctx context.Context, instanceID InstanceID,
               req EventRequest) (*Instance, error)

    HandleCallback(ctx context.Context, req CallbackRequest) error

    Cancel(ctx context.Context, instanceID InstanceID,
            req CancelRequest) (*Instance, error)
}
```

### 18.1 Start Request

```go
type StartRequest struct {
    IdempotencyKey   IdempotencyKey
    Payload          json.RawMessage
    RequestedVersion *WorkflowVersion  // nil = latest active
    TraceID          string
}
```

### 18.2 Cancel Request

```go
type CancelRequest struct {
    IdempotencyKey IdempotencyKey
    Reason         string
    TraceID        string
}
```

---

## 19. Action, Guard, and Mapper Runtime Interfaces

### 19.1 Evaluation Context

```go
type EvalContext struct {
    InstanceID InstanceID
    WfName     WorkflowName
    WfVersion  WorkflowVersion

    State State

    Payload      json.RawMessage
    EventPayload json.RawMessage

    TraceID string

    // InTransaction is true when the context is being passed to a
    // pure planning function. Registered I/O clients must refuse calls.
    InTransaction bool
}
```

### 19.2 Action Runtime — Two-Phase

```go
type ActionPlan struct {
    Commands     []CommandSpec
    PayloadPatch json.RawMessage  // optional; merged into instance.Payload
}

type Action interface {
    // Plan is pure. It must not perform external I/O. Given the same
    // (EvalContext, params), it must produce the same ActionPlan.
    // Returning an error classified as Retryable rolls back the
    // transition; the caller may retry with the same idempotency key.
    // Returning a Fatal error rolls back the transition AND records
    // a HistoryActionPlanFailed event; the workflow does not advance,
    // and policy (Section 19.5) determines whether the instance fails.
    Plan(ctx context.Context, ec EvalContext,
          params map[string]any) (ActionPlan, error)
}
```

Plan-phase rules:

1. No blocking external I/O.
2. No queue publishing, no timer scheduling, no child workflow creation — those return as `CommandSpec`.
3. No reading of mutable shared state outside `EvalContext`.
4. Side effects on `EvalContext.Payload` are forbidden; payload changes are returned via `PayloadPatch`.

### 19.3 Guard Runtime

```go
type Guard interface {
    Evaluate(ctx context.Context, ec EvalContext,
              params map[string]any) (bool, error)
}
```

Guard evaluation must be pure and side-effect-free. A guard error is treated as `Retryable` — the engine rolls the transition back and the caller may retry.

### 19.4 Mapper Runtime

```go
type Mapper interface {
    Map(ctx context.Context, input json.RawMessage,
         params map[string]any) (json.RawMessage, error)
}
```

Pure transformation of input to output. Errors are fatal at the call site.

### 19.5 Action Failure Policy

The engine classifies action errors:

```go
type ActionErrorClass int

const (
    ActionErrorRetryable ActionErrorClass = iota
    ActionErrorFatal
)

type ActionError struct {
    Class   ActionErrorClass
    Code    string
    Message string
    Cause   error
}
```

| Class       | Engine response                                                   |
| ----------- | ----------------------------------------------------------------- |
| `Retryable` | Roll back transaction; return `503` to caller; idempotency record not committed; safe to retry. |
| `Fatal`     | Roll back the *transition*; commit a separate transaction that writes a `HistoryActionPlanFailed` event and (per definition policy) either keeps the instance in its current state or moves it to a configured failure state; return `409` or `500` to the caller. |

Whether `Fatal` should fail the instance is configurable per workflow definition (`OnActionFatalError: hold | fail`). Default is `hold`, so transient bugs do not vaporize running workflows.

---

## 20. Execution Lifecycle: Starting a Workflow

### 20.1 Flow

1. Client calls `Engine.Start`.
2. Engine resolves definition (requested or latest active by `ActivationSequence`).
3. Engine validates input payload against the definition input schema.
4. Engine opens a transaction (`InTx`).
5. Engine checks idempotency: if `(synthesized_instance_id_seed, idempotency_key)` already succeeded, return prior result (a deterministic instance ID is derived from the seed so retries map to the same instance).
6. Engine creates the instance row in `InitialState`, status `running`.
7. Engine plans the initial state's `OnEntry` action (pure, no I/O).
8. Engine merges `PayloadPatch` into `instance.Payload`.
9. Engine materializes plans into:
   - new task records (with token hashes);
   - outbox messages with appropriate partition keys;
   - history events: `workflow_started`, `task_created` per task, `command_emitted` per command, `timer_scheduled` if applicable.
10. Engine commits the transaction.
11. Outbox relay eventually dispatches commands.

### 20.2 Atomicity

The instance is not visible as started until its entry tasks, outbox messages, and history records are all committed.

---

## 21. Execution Lifecycle: External Event

### 21.1 Flow

The engine performs as much work as possible **before** opening the database transaction, and writes all changes in a single late batch.

```
PHASE 1 — pre-transaction
1.  Validate request shape.
2.  Compute RequestHash from (event, normalized payload).

PHASE 2 — transaction
3.  Open InTx.
4.  Check idempotency:
        existing := IdempotencyStore.Get(instance_id, key)
        if existing.status == succeeded and existing.RequestHash == hash:
            return prior result (commit no-op)
        if existing exists and existing.RequestHash != hash:
            return ErrDuplicateRequestConflict
5.  Load instance; check status != terminal else ErrInstanceTerminal.
6.  Load definition by (instance.WfName, instance.WfVersion).
7.  Find transition for (current_state, event); else ErrTransitionNotAllowed.
8.  Evaluate guard (pure); on false, write HistoryGuardFailed and
        commit idempotency-failed; return ErrGuardNotSatisfied.
9.  Plan target state's OnEntry action (pure).

PHASE 3 — staged writes (still in tx)
10. CancelPendingForInstanceVersion(instance, current_state, current_version)
        → returns the list of cancelled tasks.
11. For each cancelled task that has external state (timer, child),
        synthesize a cancellation CommandSpec on the same partition key
        as the original schedule command.
12. Materialize all CommandSpecs (cancel + new entry) into outbox messages
        and tasks.
13. Update instance: state=target, version+=1, payload merged with
        PayloadPatch, LastProgressAt=now. Optimistic UPDATE WHERE version=expected.
14. If UPDATE affected zero rows: ErrConcurrencyConflict, rollback.
15. Insert tasks, outbox messages, history events in a single batch.
16. Mark idempotency record succeeded with (target_state, new_version).

PHASE 4 — commit
17. Commit transaction.
18. Outbox relay eventually publishes commands (in partition order).
```

Key invariant: every cancelled task with external side effects produces an outbox cancel command on the **same partition key** as its original schedule command. This is what guarantees the relay delivers them in order, so the timer service sees `schedule(T1) → cancel(T1)` and not `cancel(T1) → schedule(T1)`.

### 21.2 Concurrency Conflict Handling

If the optimistic UPDATE fails, the entire transaction rolls back. The idempotency record was never committed, so a retry with the same key is safe and will re-run the full evaluation. The engine must not have written to the outbox before the version check.

### 21.3 History Records

A successful `FireEvent` writes:

- `event_accepted` (input event accepted);
- `transition_taken` (from → to);
- one `task_cancelled` per cancelled prior task;
- one `task_created` per new task;
- one `command_emitted` per outbox command;
- specialized records (`timer_scheduled`, `timer_cancelled`, `child_workflow_started`) where applicable;
- `workflow_completed` / `workflow_failed` if the new state is terminal.

---

## 22. Execution Lifecycle: Worker Callback

### 22.1 Flow

1. Worker receives command containing the task token.
2. Worker executes business logic.
3. Worker calls callback gateway with token, event, result, signature.
4. Gateway authenticates (signature + optional mTLS).
5. Gateway rate-limits per `(token_hash, payload_hash)` to bound replay cost.
6. Gateway calls `Engine.HandleCallback`.
7. Engine opens `InTx`.
8. Engine resolves task by token hash.
9. Engine validates per Section 10.4. On stale/duplicate, write deduped `callback_ignored` history, commit, return success.
10. Engine marks task `completed`.
11. Engine delegates to internal event-processing flow (same as Section 21 phases 5–17, but the idempotency key is the task token hash and the request hash is derived from `(event, result)`).
12. Engine commits.

### 22.2 Duplicate Callback Behavior

A second callback with the same token after task completion does not apply the transition twice; the engine returns success and updates the dedup counter on the existing `callback_ignored` history row (within a configurable window, default 1 hour).

---

## 23. Execution Lifecycle: Timeout

### 23.1 Scheduling

When entering a state with `Timeout`:

1. Engine creates a timeout task bound to current state and version.
2. Engine assigns partition key `instance_id:timer:{logical_timer_id}`. The logical timer ID is derived from `(instance_id, state)` — there is exactly one timer per state.
3. Engine writes a `CommandScheduleTimer` outbox message on this partition key.
4. Outbox relay calls the timer provider in partition order.

### 23.2 Timer Callback

Identical to worker callback (Section 22), but the gateway authenticates the timer provider's identity. The task purpose check confirms `TaskPurposeTimeout`.

### 23.3 Cancelling

When a workflow leaves a state before timeout fires:

1. The transition flow in Section 21 cancels the pending task and emits `CommandCancelTimer` on the **same partition key** as the schedule command.
2. The relay delivers cancel after schedule (FIFO per partition).
3. Even if cancel is dropped or arrives after the timer fires, the resulting callback is stale (state/version mismatch) and is ignored.

### 23.4 Timeout Config

```go
type StateTimeoutConfig struct {
    Duration time.Duration
    Event    Event
}
```

---

## 24. Execution Lifecycle: Sub-Workflow

### 24.1 Starting a Child

When entering a state with `SubWorkflowConfig`:

1. Engine creates a parent task with `Purpose = sub_workflow`.
2. Engine inserts a `WorkflowLink` row (status `pending`, `child_instance_id` nil).
3. Engine applies the input mapper (or passes through if nil).
4. Engine emits `CommandStartSubWorkflow` on partition key `instance_id:child:{link_id}`. The payload includes:
   - link ID;
   - parent task token (raw, for the child engine to call back with);
   - parent's callback endpoint (the URL or topic where the child engine should deliver completion callbacks);
   - mapped input payload;
   - pinned version (if specified) or "latest active" sentinel.
5. Transaction commits.
6. The child starter consumes the message and calls `Engine.Start` on the child engine cluster (which may be the same or a different deployment).
7. The child engine creates the child instance with a stored reference to `(parent_callback_endpoint, parent_task_token, link_id)`.
8. The child engine, in the same transaction, emits an `internal_callback`-typed outbox message back to the parent on partition `instance_id:child:{link_id}` with payload `{link_id, child_instance_id}` and event `child_workflow_started`.
9. Parent's callback gateway receives this, finds the matching link by `link_id`, attaches `child_instance_id`, and updates link status to `running`.

This flow keeps "parent and child in the same DB cluster" and "parent and child in different clusters" handled by the same transport: both use the outbox + callback gateway path.

### 24.2 Child Completion

When a child instance reaches a terminal state:

1. Child engine notices the link reference (stored as part of child instance metadata).
2. Child engine maps child output via the parent's `OutputMapper` reference (resolved on the child side, since mappers are registered globally) — or, if cross-cluster, the child includes the raw output and parent maps on receipt.
3. Child engine emits an outbox callback to the parent's callback endpoint with the parent task token and event `OnCompletedEvent` (success) or `OnFailedEvent` (failure).
4. Parent callback gateway processes the callback as a normal worker callback (Section 22).
5. Parent updates the link status to `completed` / `failed` in the same transaction as the parent state transition.

### 24.3 Parent Cancellation or Timeout

If the parent leaves the waiting state before the child completes:

1. Section 21 cancels the parent's sub-workflow task.
2. Engine updates link status to `cancelled`.
3. Engine emits `CommandCancelSubWorkflow` on the link's partition key.
4. The child engine, on receiving cancellation, fires a synthetic `cancel` event on the child instance.
5. If the child later completes anyway, its callback is stale at the parent (state/version mismatch) and is safely ignored.

---

## 25. Execution Lifecycle: Cancellation

### 25.1 Cancellation Flow

1. Client calls `Cancel`.
2. Engine opens `InTx`, checks idempotency.
3. Engine loads instance.
4. If terminal, return current result.
5. If `!StateConfig.AllowCancellation`, return `ErrCancellationNotAllowed`.
6. Engine cancels all pending tasks for the current `(instance, state, version)` via `CancelPendingForInstanceVersion`.
7. Engine emits cancel commands for each cancelled task with external state (cancel_timer, cancel_sub_workflow, optionally notify_worker), each on its respective partition key.
8. Engine sets instance status to `cancelled`, increments version, sets `LastProgressAt = now`.
9. Engine inserts `workflow_cancelled` and supporting history.
10. Engine commits.

### 25.2 Cancellation Semantics

Cancellation is best-effort for external workers. The engine guarantees that late callbacks for cancelled tasks cannot advance the workflow.

---

## 26. Terminal State Handling

When an instance enters a terminal state:

1. Engine sets `InstanceStatus` to `completed` / `failed` / `cancelled`.
2. Engine cancels all pending tasks and emits cancel commands per Section 25 step 7.
3. Engine sets `CompletedAt = now` and stamps `EligibleForCleanupAt` on the instance and its idempotency records (instance terminal time + retention window).
4. Engine inserts terminal history (`workflow_completed` / `workflow_failed` / `workflow_cancelled`).
5. Engine commits.
6. Future events on this instance return `ErrInstanceTerminal` except for idempotent duplicate requests, which return the cached terminal result.

---

## 27. Reliability Guarantees

### 27.1 State Update Atomicity

A committed state transition also commits: idempotency record, task lifecycle changes, new tasks, outbox messages, link updates, and history.

### 27.2 External Side Effect Safety

The engine never performs external side effects before transaction commit. All external work flows through the outbox.

### 27.3 Per-Partition Outbox Ordering

Cancel/schedule pairs (and any other ordered command sequences) share a partition key. The relay never publishes a later message in a partition before earlier messages in that partition succeed.

### 27.4 Callback Race Safety

Task tokens are bound to `(instance, state, version)`. Only the first valid callback for a pending task can advance the workflow. All other callbacks are safe no-ops.

### 27.5 Timeout Race Safety

Worker callback and timeout callback may race. Only the callback whose task is still pending and whose binding still matches advances the workflow.

### 27.6 Duplicate Delivery Safety

The system assumes at-least-once delivery from queues, workers, timers, and the outbox relay. All consumers are idempotent.

### 27.7 Optimistic Locking

Instance updates use:

```sql
UPDATE workflow_instances
SET state = ?, status = ?, payload = ?, last_progress_at = ?,
    version = version + 1, updated_at = ?
WHERE id = ? AND version = ?
```

Zero rows updated → `ErrConcurrencyConflict` and full rollback.

### 27.8 Outbox Fencing

Outbox claim updates `lock_generation` atomically. When a relay marks a message published, it CASes on the lock generation it holds. A relay that wakes from a long pause and tries to mark a message it no longer owns will fail the CAS and abort.

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
    ErrCancellationNotAllowed    = errors.New("cancellation not allowed in current state")
    ErrInvalidPayload            = errors.New("invalid payload")
    ErrInvalidTaskToken          = errors.New("invalid task token")
    ErrCallbackUnauthenticated   = errors.New("callback authentication failed")
    ErrTaskAlreadyResolved       = errors.New("task already resolved")
    ErrStaleTask                 = errors.New("stale task")
    ErrDuplicateRequestConflict  = errors.New("duplicate request conflict")
    ErrConcurrencyConflict       = errors.New("optimistic locking conflict")
    ErrActionFatal               = errors.New("action returned fatal error")
)
```

### 28.2 Error Handling Policy

| Error                         | HTTP | Retry?      | Notes                                        |
| ----------------------------- | ---- | ----------- | -------------------------------------------- |
| Definition not found          | 404  | No          | Configuration issue                          |
| Instance not found            | 404  | No          | Invalid instance ID                          |
| Invalid payload               | 400  | No          | Schema validation failed                     |
| Transition not allowed        | 409  | No          | Event not valid for current state            |
| Guard not satisfied           | 409  | No          | Guard returned false                         |
| Cancellation not allowed      | 409  | No          | State disallows cancellation                 |
| Duplicate request conflict    | 409  | No          | Same key, different payload                  |
| Concurrency conflict          | 503  | Yes (caller)| Retry with same idempotency key              |
| Callback unauthenticated      | 401  | No          | Bad signature / unauthorized worker          |
| Invalid task token            | 404  | No          | Token unknown                                |
| Stale task                    | 200  | No          | Safe no-op; recorded as ignored              |
| Action fatal                  | 500  | No          | Surfaced to ops; instance may be held        |
| Repository transient error    | 503  | Yes (caller)| Retry safe with same idempotency key         |
| Outbox publish failure        | —    | Yes (relay) | Relay retries with backoff                   |

---

## 29. Storage Schema Sketch

### 29.1 `workflow_instances`

| Column             | Type                |
| ------------------ | ------------------- |
| id                 | string / uuid (PK)  |
| wf_name            | string              |
| wf_version         | string              |
| state              | string              |
| status             | string              |
| payload            | json                |
| payload_schema     | string              |
| version            | bigint              |
| last_progress_at   | timestamp           |
| created_at         | timestamp           |
| updated_at         | timestamp           |
| completed_at       | timestamp nullable  |
| eligible_cleanup_at| timestamp nullable  |

Indexes: `(wf_name, wf_version)`; `(status, last_progress_at)` for stuck detection; `(eligible_cleanup_at)` for retention worker.

### 29.2 `workflow_definitions`

| Column              | Type                  |
| ------------------- | --------------------- |
| name                | string                |
| version             | string                |
| activation_sequence | bigint nullable       |
| status              | string (draft/active) |
| body                | json                  |
| created_at          | timestamp             |
| activated_at        | timestamp nullable    |

Indexes: PK `(name, version)`; unique `(name, activation_sequence)` where status='active'; index `(name, status, activation_sequence DESC)` for fast `GetLatestActive`.

### 29.3 `workflow_tasks`

| Column         | Type                |
| -------------- | ------------------- |
| token_hash     | bytea(32) (PK)      |
| instance_id    | string              |
| state          | string              |
| version        | bigint              |
| purpose        | string              |
| status         | string              |
| expected_event | string              |
| partition_key  | string              |
| expires_at     | timestamp nullable  |
| created_at     | timestamp           |
| updated_at     | timestamp           |
| resolved_at    | timestamp nullable  |

Indexes: `(instance_id, state, version, status)`; `(expires_at, status)`.

### 29.4 `workflow_event_records`

| Column                | Type                |
| --------------------- | ------------------- |
| instance_id           | string              |
| idempotency_key       | string              |
| request_hash          | string              |
| event                 | string              |
| status                | string              |
| result_state          | string              |
| result_version        | bigint              |
| error_code            | string              |
| created_at            | timestamp           |
| updated_at            | timestamp           |
| eligible_cleanup_at   | timestamp nullable  |

PK `(instance_id, idempotency_key)`. Index `(eligible_cleanup_at)`.

### 29.5 `workflow_outbox`

| Column           | Type                |
| ---------------- | ------------------- |
| id               | string (PK)         |
| partition_key    | string              |
| topic            | string              |
| command_type     | string              |
| payload          | json                |
| status           | string              |
| attempts         | int                 |
| next_attempt_at  | timestamp           |
| locked_by        | string nullable     |
| locked_until     | timestamp nullable  |
| lock_generation  | bigint              |
| last_error       | text                |
| trace_id         | string              |
| created_at       | timestamp           |
| updated_at       | timestamp           |
| published_at     | timestamp nullable  |

Indexes: `(status, partition_key, created_at)` for ordered claim; `(locked_until)` for lease recovery.

The relay's claim query selects, per partition key, only the **earliest** non-`published` message — this is what enforces FIFO per partition.

### 29.6 `workflow_links`

| Column              | Type                |
| ------------------- | ------------------- |
| id                  | string (PK)         |
| parent_instance_id  | string              |
| parent_task_hash    | bytea(32) (unique)  |
| child_instance_id   | string nullable     |
| status              | string              |
| created_at          | timestamp           |
| updated_at          | timestamp           |
| completed_at        | timestamp nullable  |

Indexes: unique `(parent_task_hash)`; `(parent_instance_id, status)`; `(child_instance_id)`.

### 29.7 `workflow_history`

| Column      | Type                |
| ----------- | ------------------- |
| id          | string (PK)         |
| instance_id | string              |
| type        | string              |
| state_from  | string nullable     |
| state_to    | string nullable     |
| event       | string nullable     |
| details     | json                |
| dedup_count | int                 |
| trace_id    | string              |
| created_at  | timestamp           |

Indexes: `(instance_id, created_at)`; `(type, created_at)`. For deduped rows, `details` carries `dedup_key`.

---

## 30. Outbox Relay Design

### 30.1 Two Implementations, One Contract

The relay contract is implementation-agnostic. Two reference implementations:

**Polling relay.** Lower operational complexity, higher latency floor (typically 100ms–1s). Suitable for default deployments.

**CDC relay.** Lower latency, requires database support (PG logical replication, MySQL binlog, DynamoDB Streams). The `lock_generation`, `locked_by`, `locked_until`, and `attempts` columns are still used for retry bookkeeping; the difference is in how messages are discovered.

### 30.2 Polling Flow with Per-Partition FIFO

```
1. Claim batch:
       SELECT * FROM workflow_outbox o1
       WHERE o1.status = 'pending'
         AND o1.next_attempt_at <= now()
         AND NOT EXISTS (
             SELECT 1 FROM workflow_outbox o2
             WHERE o2.partition_key = o1.partition_key
               AND o2.created_at < o1.created_at
               AND o2.status NOT IN ('published', 'dead_letter')
         )
       ORDER BY created_at
       LIMIT N
       FOR UPDATE SKIP LOCKED;

2. Update claimed rows:
       SET status = 'publishing',
           locked_by = $relay_id,
           locked_until = now() + lease,
           lock_generation = lock_generation + 1
       (capture each row's new lock_generation)

3. Publish each message to its target system.

4. On success:
       UPDATE ... SET status='published', published_at=now()
       WHERE id=? AND lock_generation=?
       (CAS: another relay may have stolen ownership; if 0 rows, abort)

5. On transient failure:
       UPDATE ... SET status='pending', attempts=attempts+1,
                       next_attempt_at=now()+backoff(attempts), last_error=?
       WHERE id=? AND lock_generation=?

6. On permanent failure:
       UPDATE ... SET status='dead_letter', last_error=?
       WHERE id=? AND lock_generation=?
```

The `NOT EXISTS` subquery is what enforces per-partition FIFO: the relay will not claim a message until all earlier messages in the same partition have left the pipeline (`published` or `dead_letter`).

### 30.3 Dead-Letter Handling

A message moves to `dead_letter` after exceeding `max_attempts` or on classified-as-permanent errors. **Critical caveat:** dead-lettering a message in a partition unblocks subsequent messages in the same partition, which may not be safe. By default, when any message in a partition dead-letters, the engine raises an alert and blocks further publishing on that partition until an operator resolves. This is configurable per command type.

### 30.4 Lock Recovery

If a relay crashes mid-publish, another relay reclaims after `locked_until`. The new relay increments `lock_generation`, and any subsequent CAS by the old relay fails. Workers must remain idempotent regardless.

---

## 31. Security Considerations

### 31.1 Task Token Security

- Generated from a CSPRNG, ≥ 256 bits of entropy.
- Stored as SHA-256 hash (`token_hash`); raw token never persists.
- Treated as bearer secret in transit; TLS required.
- Never logged in plaintext.
- Single-use semantics for successful callbacks.
- Per-task scope; never reused across tasks or instances.

### 31.2 Callback Authentication

The default callback gateway requires:

1. **Signature.** HMAC-SHA256 over `(token || event || result || timestamp)` with a per-worker-identity key. The gateway looks up the key by `signature_key_id`.
2. **Timestamp tolerance.** Callbacks with `timestamp` skew > 5 minutes are rejected.
3. **Optional mTLS** at the transport layer for higher-trust deployments.

The token alone is **not** the security boundary. A leaked token without a valid signature is rejected.

### 31.3 Payload Security

- Encryption at rest at the database layer.
- Field-level redaction in logs based on a redaction tag in the schema.
- Configurable max payload size (default 256 KiB).
- Schema validation enforced at every event boundary.
- Secret references (`{"secret_ref": "..."}`) resolved at worker side, never stored as raw secrets.

### 31.4 Stale Callback Replay Defense

The callback gateway rate-limits per `(token_hash, payload_hash)` to bound replay cost. The history layer deduplicates `callback_ignored` rows so replay attacks cannot inflate the history table even if the rate limiter fails.

---

## 32. Observability

### 32.1 Metrics

Workflow lifecycle: starts, transition attempts/successes/failures, terminal status distribution, workflow duration.

Concurrency and races: optimistic conflict count, stale callback count, duplicate callback count, ignored-callback dedup count.

Tasks: pending task age (p50/p99), expired-but-not-resolved count.

Outbox: pending backlog, publish latency per partition (p50/p99/max), dead-letter count, blocked-partition count, lease-recovery count.

Stuck detection: stuck-instance count.

### 32.2 Logs

Structured logs include `instance_id`, `wf_name`, `wf_version`, `state`, `event`, `trace_id`, `command_id`, `outbox_message_id`, `partition_key`. Token hashes may be logged; raw tokens never.

### 32.3 Tracing

Trace IDs propagate through API request → event processing → outbox messages → worker command → callback → child workflow start → timer callback. Each transition opens a span; outbox publish opens a child span.

---

## 33. Deployment Model

### 33.1 Engine

Deployable as a serverless function, containerized API service, Kubernetes Deployment, or queue consumer. Stateless, horizontally scalable.

### 33.2 Repository

Supported backends: PostgreSQL, MySQL (8.0+), DynamoDB with transactional writes, Spanner-class systems. The chosen backend must support multi-row atomic writes and conditional updates.

### 33.3 Outbox Relay

Polling relay: scheduled function, long-running worker, or Kubernetes Deployment. CDC relay: managed CDC pipeline (Debezium, AWS DMS, native streams).

### 33.4 Timer Provider

Selected for required scale, precision, durability, and cost. Examples: EventBridge Scheduler, Cloud Tasks, delayed queues, Redis-backed schedulers.

### 33.5 Background Workers

Stuck Instance Detector and Retention Worker can run as scheduled jobs (one process per cluster, leased) or as Kubernetes CronJobs.

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
            Name:    "created",
            OnEntry: &ActionRef{Name: "reserve_inventory"},
            Timeout: &StateTimeoutConfig{
                Duration: 15 * time.Minute,
                Event:    "inventory_reservation_timeout",
            },
            AllowCancellation: true,
        },
        "inventory_reserved": {
            Name:    "inventory_reserved",
            OnEntry: &ActionRef{Name: "charge_payment"},
            Timeout: &StateTimeoutConfig{
                Duration: 10 * time.Minute,
                Event:    "payment_timeout",
            },
            AllowCancellation: true,
        },
        "completed": {Name: "completed"},
        "failed":    {Name: "failed"},
    },

    Transitions: []Transition{
        {From: "created", Event: "inventory_reserved", To: "inventory_reserved"},
        {From: "created", Event: "inventory_reservation_timeout", To: "failed"},
        {From: "inventory_reserved", Event: "payment_charged", To: "completed"},
        {From: "inventory_reserved", Event: "payment_timeout", To: "failed"},
    },

    TerminalStates: map[State]TerminalType{
        "completed": TerminalSuccess,
        "failed":    TerminalFailure,
    },
}
```

### 34.2 Execution

1. `Start(order_fulfillment)` creates the instance in `created`, ActivationSequence-resolved.
2. Engine plans `reserve_inventory`, gets two `CommandSpec`s: invoke worker, schedule timeout.
3. Engine creates worker task and timeout task; both share partition key `instance_id` and `instance_id:timer:created` respectively.
4. Engine writes both outbox messages and history; commits.
5. Worker reserves inventory, calls back with `inventory_reserved` and a valid signature.
6. Engine validates token + signature, transitions to `inventory_reserved`.
7. Engine emits `cancel_timer` for the `created` timeout on partition `instance_id:timer:created`. Relay delivers it after the original schedule (FIFO).
8. Engine plans `charge_payment`; emits payment worker invoke and payment timeout schedule.
9. Worker calls back with `payment_charged`.
10. Engine transitions to `completed`, cancels payment timeout, emits cancel.
11. Engine marks instance `completed`, stamps `eligible_cleanup_at`.
12. Any late timeout callback is stale (state/version mismatch) and produces a deduped `callback_ignored` history row.

---

## 35. Retention and Cleanup

### 35.1 Retention Policy

Configurable per workflow (with global defaults):

| Data                                  | Default retention after instance terminal |
| ------------------------------------- | ----------------------------------------- |
| `workflow_event_records`              | 7 days                                    |
| `workflow_history`                    | 30 days, then archive cold; delete at 1y  |
| Resolved `workflow_tasks`             | 7 days                                    |
| `workflow_links` for terminated trees | 30 days                                   |
| Terminated `workflow_instances`       | Archive at 30 days; delete at 1y          |

### 35.2 Retention Worker

A background job runs every retention interval and:

1. Queries each table for rows with `eligible_cleanup_at <= now() - retention_window`.
2. Batches deletes (default 500 rows per batch, throttled to bound DB impact).
3. For archive-eligible rows, writes to cold storage (S3/object store) before deleting.
4. Emits metrics: rows archived, rows deleted, errors.

### 35.3 Stamping

`eligible_cleanup_at` is set on:

- the instance row at terminal time;
- idempotency records when the parent instance reaches terminal;
- task rows when the task is resolved AND the parent instance is terminal;
- link rows when the link is terminal AND the parent instance is terminal.

---

## 36. Operational Recovery

### 36.1 Stuck Instance Detection

A background scanner runs periodically with this logic:

```
For each instance with status='running':
    Find the most recent task or progress timestamp.
    If now - last_progress_at > stuck_threshold (default 24h):
        Emit metric workflow_stuck_total{wf_name=...}.
        Insert HistoryStuckDetected (deduped by instance + day).
        Notify ops via configured channel.
```

`stuck_threshold` is configurable per workflow.

### 36.2 Stuck-Task Detection

Separately, scan tasks where `expires_at + grace_period < now() AND status = pending`. These represent timers or workers that should have already responded. Operator action options:

1. Manually fire the timeout event.
2. Manually fail the workflow.
3. Cancel the workflow.

### 36.3 Outbox Backlog Recovery

If a partition is blocked due to a dead-lettered message, ops can:

1. Inspect and fix the dead-lettered message's payload (if it's a content bug).
2. Requeue manually (`status` back to `pending`, reset `attempts`).
3. Skip-and-acknowledge (mark as published despite the failure) — destructive, only with operator confirmation.

### 36.4 Replay-from-Cold-Storage

For deleted history needed for compliance investigation, a replay tool can rehydrate archive entries into a query-only cold DB. Out of scope for v1 but reserved as a design constraint on the archive format (it must be self-describing).

---

## 37. Open Design Questions

The previous draft listed ten open questions, several of which have been resolved in this revision. Remaining items:

1. **Transition-level actions** in addition to state `OnEntry`. Currently only entry actions are supported; some workflows want side effects on the transition itself (e.g., audit on transition without changing entry behavior).
2. **Definition source format.** Code-defined definitions are convenient for Go users; YAML/JSON definitions would enable tooling and non-Go integration. Both can coexist.
3. **Schema migration for long-running instances.** When a definition needs a payload schema change, what happens to instances on the old schema? Options: forced upgrade, lazy migration, dual-read, freeze-old-version.
4. **Deterministic replay for debugging.** History today is for audit. A deterministic replay (re-derive past payloads from history) requires capturing more action input/output detail and constraining actions further. Useful but expensive.
5. **Fan-out / fan-in sub-workflows.** The link table is already shaped to support multiple children per parent task; the engine API and parent-side aggregation logic are not designed in this draft.
6. **Retry policies on actions.** Currently all retry is on the caller. Native per-action retry (with backoff and budget) would reduce caller complexity but adds engine complexity.

---

## 38. Implementation Priorities

### P0 — Required for Correctness

1. Versioned workflow definitions with `ActivationSequence` ordering.
2. Instance binding to definition version.
3. Persistent task token table with hashed storage.
4. Task token to `(instance, state, version)` binding.
5. Transactional idempotency (single-phase, no in-flight status).
6. Transactional outbox **with per-partition FIFO ordering**.
7. Optimistic locking on instance updates.
8. Two-phase action execution with classified errors.
9. Terminal state and instance status handling.
10. Timeout schedule/cancel through outbox only, with cancel commands on the same partition as schedule commands.
11. Cancel outbox emission for every cancelled task with external state, on the matching partition key.
12. Workflow history with stale-callback deduplication.

### P1 — Required for Sub-Workflow Safety

1. Workflow link table with surrogate primary key.
2. Parent-child lifecycle tracking.
3. Sub-workflow callback transport over outbox + callback gateway (uniform across same-cluster and cross-cluster).
4. Cascading cancellation.
5. Late-completion protection via stale-token rejection.

### P2 — Required for Operability

1. Outbox relay retry, lease recovery with fencing, and dead-letter handling.
2. Stuck-instance detector.
3. Retention worker for idempotency, history, tasks, links, instances.
4. Metrics, structured logs, trace propagation.
5. Admin inspection APIs (instance state, history, links, outbox status).
6. Per-partition blocked-partition alerting and operator override.

### P3 — Advanced Orchestration

1. Fan-out / fan-in.
2. Retry policy DSL on actions.
3. Compensation workflows.
4. Declarative guards (expression language).
5. Payload schema migration for long-running instances.
6. Deterministic replay for debugging.
7. Transition-level actions.

---

## 39. Conclusion

This revised design defines a serverless-first workflow engine whose correctness rests on four foundations:

1. **Persistent task tokens bound to `(instance, state, version)`.** This makes duplicate, stale, and racing callbacks safe by construction.
2. **Transactional outbox with per-partition FIFO ordering.** This eliminates the cancel-before-schedule class of races and makes ordered command sequences trustworthy without distributed coordination.
3. **Two-phase actions with classified errors.** This bounds the work an action can do inside a transaction and makes the failure mode of business logic explicit instead of accidental.
4. **Decomposed repository with strict transaction boundaries.** This makes the atomicity contract testable and the storage backend pluggable without leaking responsibilities into the engine.

Compared to the previous draft, this revision (a) promotes outbox ordering and idempotency-record retention from open questions to first-class guarantees, (b) replaces the god-interface repository with per-aggregate stores under a unit-of-work, (c) defines the action failure contract instead of leaving it to interpretation, (d) makes sub-workflow callback transport uniform across deployment topologies, and (e) treats stuck-instance detection as part of the operational baseline rather than a future concern.

With these in place, the engine can scale horizontally in serverless environments while preserving deterministic transitions, bounded resource growth, and operational auditability.
