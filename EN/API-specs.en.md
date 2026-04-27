# LTBase Data Plane API Specification (Based on the Current `cmd/api` Implementation)

This document describes the HTTP API behavior currently exposed by `ltbase.api/cmd/api`.

- Code baseline:
  - `ltbase.api/cmd/api/main.go`
  - `ltbase.api/internal/http_handler_routing.go`
  - `ltbase.api/internal/notes_handlers.go`
  - `ltbase.api/internal/forma_handlers.go`
  - `ltbase.api/internal/http_handler_crud.go`
  - `ltbase.api/internal/semantic/*.go`
- Document language: English
- Updated on: 2026-04-22

## 1. Overview

The current data plane provides the following capabilities:

- AI Notes: create, retrieve, update summaries, and delete notes
- Note model sync: check sync status and retry synchronization
- Deep Ping: probe authentication and downstream dependency connectivity
- Forma: entity CRUD, list queries, cross-schema search, and advanced conditional queries
- CRUD Agent: session creation, session status retrieval, message-driven execution, and direct execution
- Semantic: semantic resource catalog and entity lineage lookup
- Governance: governance views for entities, capabilities, and policies
- Discovery: semantic graph reachability and path queries
- Intent-to-Action Planning: intent planning, plan execution, and execution status lookup

## 2. Authentication, Context, and Shared Conventions

### 2.1 License Validation

All requests pass through license validation before reaching business routes. Unlicensed deployments return:

```json
{
  "error_code": "not_implemented",
  "message": "Unlicensed LTBase."
}
```

Status code: `501 Not Implemented`

### 2.2 JWT Claims and Trusted Context

The server reads identity from API Gateway authorizer claims:

- `project_id`: project scope. Most endpoints require this field, and it must be a UUID.
- `sub`: current user ID
- `user_id`: fallback field when `sub` is absent

In the current implementation, many endpoints still retain `owner_id` and `project_id` fields in their request bodies, but the trusted values come from JWT claims:

- Notes APIs: `owner_id` is always taken from JWT `sub` or `user_id`
- CRUD sessions and operations: `owner_id` and `project_id` are always taken from JWT claims
- Planning: `actor_context.project_id` must match the JWT `project_id`, and `user_id` is overwritten by the server with the current JWT subject

### 2.3 Header Conventions

- `Authorization`: consumed by the API Gateway JWT authorizer
- `Accept-Encoding: gzip`: large responses may be gzip-compressed
- `Accept-Language`: `zh`, `en`, and `ja` are supported; responses may include `Content-Language`
- `X-LTBASE-TZ-ID`: optional; must be a valid IANA time zone. Invalid values return `400 invalid_tz_id`
- `Idempotency-Key`: used only by `POST /api/ai/v1/notes` for idempotent creation

### 2.4 Successful Responses

- Default `Content-Type: application/json`
- When the client declares gzip support and the payload is large, responses may include:
  - `Content-Encoding: gzip`
  - `IsBase64Encoded: true`

### 2.5 Error Responses

Except for a few internally delegated handlers, the top-level API consistently uses the following error shape:

```json
{
  "error_code": "string",
  "message": "string"
}
```

### 2.6 Common Status Codes

- `200 OK`
- `201 Created`
- `202 Accepted`
- `204 No Content`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `422 Unprocessable Entity`
- `429 Too Many Requests`
- `500 Internal Server Error`
- `501 Not Implemented`
- `502 Bad Gateway`
- `503 Service Unavailable`

## 3. Route Summary

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/ai/v1/notes` | Create a note |
| GET | `/api/ai/v1/notes` | List notes |
| GET | `/api/ai/v1/notes/{note_id}` | Retrieve a single note |
| PUT | `/api/ai/v1/notes/{note_id}` | Update a note summary |
| DELETE | `/api/ai/v1/notes/{note_id}` | Delete a note |
| GET | `/api/ai/v1/notes/{note_id}/model_sync` | Retrieve model sync status |
| POST | `/api/ai/v1/notes/{note_id}/model_sync` | Retry model sync |
| GET | `/api/v1/deepping` | Perform a deep ping |
| POST | `/api/v1/{schema_name}` | Create a Forma entity |
| GET | `/api/v1/{schema_name}` | Query a Forma entity list |
| GET | `/api/v1/{schema_name}/{row_id}` | Retrieve a single Forma record |
| PUT | `/api/v1/{schema_name}/{row_id}` | Update a Forma record |
| DELETE | `/api/v1/{schema_name}/{row_id}` | Delete a single Forma record |
| DELETE | `/api/v1/{schema_name}` | Bulk-delete Forma records |
| GET | `/api/v1/search` | Run a cross-schema Forma search |
| POST | `/api/v1/advanced_query` | Run an advanced Forma query |
| POST | `/api/ai/v1/sessions` | Create a CRUD Agent session |
| GET | `/api/ai/v1/sessions/{session_id}` | Retrieve a session |
| POST | `/api/ai/v1/sessions/{session_id}/messages` | Send a session message |
| GET | `/api/ai/v1/sessions/{session_id}/messages` | Retrieve session workflow status |
| POST | `/api/ai/v1/operations` | Execute a CRUD Agent request directly |
| GET | `/api/v1/semantic/resources` | List semantic resources |
| GET | `/api/v1/semantic/resources/{resource_id}` | Retrieve semantic resource details |
| GET | `/api/v1/semantic/lineage/{entity_type}/{row_id}` | Retrieve entity lineage |
| GET | `/api/sys/v1/governance/entities/{entity_name}/capabilities` | Retrieve the entity governance view |
| GET | `/api/sys/v1/governance/capabilities/{capability_name}` | Retrieve the capability governance view |
| GET | `/api/sys/v1/governance/policies/{policy_id}/capabilities` | Retrieve the policy governance view |
| POST | `/api/sys/v1/discovery/reachable` | Run a semantic graph reachability query |
| POST | `/api/sys/v1/discovery/paths` | Run a semantic graph path query |
| POST | `/api/ai/v1/intent-to-action/plans` | Create an intent plan |
| POST | `/api/ai/v1/intent-to-action/executions` | Execute a plan step |
| GET | `/api/ai/v1/intent-to-action/executions/{execution_id}` | Retrieve execution status |

## 4. Common Data Structures

### 4.1 ErrorPayload

```json
{
  "error_code": "invalid_request",
  "message": "project_id is required in JWT claims"
}
```

### 4.2 Note

```json
{
  "note_id": "2b3f2c86-5a92-46e8-b0db-49b1fb9ce302",
  "owner_id": "user-123",
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "type": "text/plain",
  "data": "The customer wants to view homes this weekend.",
  "summary": "The customer plans to view homes this weekend.",
  "compression": "gzip",
  "s3_key": "notes/...",
  "models": [
    {
      "type": "lead",
      "data": {
        "source": "note"
      }
    }
  ]
}
```

Notes:

- `compression` and `s3_key` appear only when that storage path is used.
- `models` contains structured extraction results or persisted echo-back data.

### 4.3 ModelSyncStatus

```json
{
  "task_id": "2b3f2c86-5a92-46e8-b0db-49b1fb9ce302",
  "project_id": "8c1b6c5c-0c5b-4fd3-b1ea-d3627d3f7cc4",
  "owner_id": "user-123",
  "note_id": "2b3f2c86-5a92-46e8-b0db-49b1fb9ce302",
  "status": "synced",
  "retry_count": 0,
  "last_error": "",
  "updated_at": 1760000001000
}
```

`status` values:

- `synced`
- `pending`
- `not_applicable`

### 4.4 Forma DataRecord / QueryResult / BatchResult

Single record:

```json
{
  "schema_name": "lead",
  "row_id": "6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391",
  "attributes": {
    "name": "Alice",
    "city": "Tokyo"
  }
}
```

List query response:

```json
{
  "data": [
    {
      "schema_name": "lead",
      "row_id": "6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391",
      "attributes": {
        "name": "Alice"
      }
    }
  ],
  "total_records": 1,
  "total_pages": 1,
  "current_page": 1,
  "items_per_page": 20,
  "has_next": false,
  "has_previous": false,
  "execution_time": 123456
}
```

Batch result response:

```json
{
  "successful": [
    {
      "schema_name": "lead",
      "row_id": "6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391",
      "attributes": {
        "name": "Alice"
      }
    }
  ],
  "failed": [],
  "totalCount": 1,
  "duration": 1000
}
```

### 4.5 ConversationSession / WorkflowOutput / WorkflowState

Session object:

```json
{
  "session_id": "sess-123",
  "owner_id": "user-123",
  "project_id": "8c1b6c5c-0c5b-4fd3-b1ea-d3627d3f7cc4",
  "turn_number": 0,
  "context": {
    "user_preferences": {
      "language": "zh"
    },
    "collected_data": {}
  },
  "status": "active",
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "expires_at": 1760086400,
  "attributes": {
    "source": "web"
  }
}
```

Workflow output:

```json
{
  "session_id": "sess-123",
  "phase": "conversation",
  "response": "Please provide the phone number.",
  "data": {
    "questions": [
      {
        "field_name": "phone",
        "question": "Could you provide the phone?",
        "reason": "phone is required",
        "priority": 0
      }
    ]
  },
  "next_action": "wait_for_user",
  "is_complete": false,
  "error": ""
}
```

Workflow state:

```json
{
  "session_id": "sess-123",
  "current_phase": "conversation",
  "failed_phase": "",
  "last_successful_phase": "validation",
  "context": {
    "project_id": "8c1b6c5c-0c5b-4fd3-b1ea-d3627d3f7cc4"
  },
  "start_time": "2026-04-22T10:00:00Z",
  "last_updated": "2026-04-22T10:01:00Z",
  "is_complete": false
}
```

## 5. AI Notes API

### 5.1 Purpose

Stores raw note content, generates summaries, extracts model data, and tracks downstream sync status.

### 5.2 `POST /api/ai/v1/notes`

Purpose: Create a note and generate summary and model data when applicable.

Request body:

```json
{
  "owner_id": "ignored-by-server",
  "type": "text/plain",
  "data": "Planning to take the family to view homes next weekend.",
  "role": "real_estate",
  "models": [
    {
      "type": "lead",
      "data": {
        "summary": "${note.summary}",
        "raw_type": "${note.type}"
      }
    }
  ]
}
```

Field notes:

- `type`: required; must start with `text/`, `audio/`, or `image/`
- `data`: required
- `role`: optional
- `models`: optional structured extraction templates
- `model`: backward-compatible single-object alias for older clients; the server automatically converts it to `models`
- `owner_id`: even if provided, it is overwritten by the JWT subject

Request header:

- `Idempotency-Key`: optional. When present, `note_id` is derived from `project_id + owner_id + key`, and repeated requests may directly return the existing result.

Successful response: `201 Created`

```json
{
  "note_id": "2b3f2c86-5a92-46e8-b0db-49b1fb9ce302",
  "owner_id": "user-123",
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "type": "text/plain",
  "data": "Planning to take the family to view homes next weekend.",
  "summary": "The customer plans to take the family to view homes next weekend.",
  "models": [
    {
      "type": "lead",
      "data": {
        "summary": "The customer plans to take the family to view homes next weekend.",
        "raw_type": "text/plain"
      }
    }
  ]
}
```

Response headers:

- `X-LTBase-Model-Sync-Status: synced|pending|not_applicable`
- `X-LTBase-Model-Sync-Task-Id: <task_id>`, present only when a sync task exists
- `X-LTBase-Idempotency-Replayed: true|false`

Status codes:

- `201`: created successfully
- `200`: idempotency replay hit, returning an existing note
- `400`: empty body, invalid JSON, invalid `type`, missing `project_id` or `sub`, invalid model type
- `429`: summary service rate-limited, with `Retry-After`
- `500`: repository write failed
- `502`: summary generation failed
- `503`: dependencies such as the schema registry or Forma manager are not configured

### 5.3 `GET /api/ai/v1/notes`

Purpose: List notes for the current JWT user.

Query parameters:

- `page`: optional, default `1`
- `items_per_page`: optional, default `20`, maximum `100`
- `summary`: optional, fuzzy match against the summary
- `schema_name`: optional, filters by `models[].type`; supported in the current implementation

Response:

```json
{
  "items": [
    {
      "note_id": "2b3f2c86-5a92-46e8-b0db-49b1fb9ce302",
      "owner_id": "user-123",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "type": "text/plain",
      "data": "Planning to take the family to view homes next weekend.",
      "summary": "The customer plans to take the family to view homes next weekend."
    }
  ],
  "page": 1,
  "items_per_page": 20,
  "total_items": 1
}
```

Status codes: `200`, `400`, `500`

### 5.4 `GET /api/ai/v1/notes/{note_id}`

Purpose: Retrieve a single note.

Path parameter:

- `note_id`: UUID

Response: `Note`

Status codes:

- `200`
- `400 invalid_note_id`
- `404 note_not_found`
- `500 fetch_failed`

### 5.5 `PUT /api/ai/v1/notes/{note_id}`

Purpose: Update only the note's `summary`.

Request body:

```json
{
  "summary": "Manually corrected summary"
}
```

Notes:

- Although the request struct includes an `owner_id` field, the server still uses the JWT subject
- An empty summary returns `400 invalid_request`

Response: the updated `Note`

Status codes: `200`, `400`, `404`, `500`

### 5.6 `DELETE /api/ai/v1/notes/{note_id}`

Purpose: Delete a note.

Successful response: `204 No Content`

Status codes: `204`, `400`, `404`, `500`

## 6. Note Model Sync API

### 6.1 `GET /api/ai/v1/notes/{note_id}/model_sync`

Purpose: Retrieve the model persistence sync status for a note.

Response: `ModelSyncStatus`

Status codes: `200`, `400`, `404`, `500`

### 6.2 `POST /api/ai/v1/notes/{note_id}/model_sync`

Purpose: Retry syncing an existing note's `models` into Forma.

Response: `ModelSyncStatus`

Status codes:

- `200`: sync succeeded
- `202`: the retry ran, but the status remains `pending`
- `400`: the note has no models and returns `model_sync_not_required`
- `404`
- `500`

## 7. Deep Ping API

### `GET /api/v1/deepping`

Purpose: Verify JWT authentication, Dynamo connectivity, and request path health.

Query parameter:

- `echo`: optional; only the first 16 characters are preserved in the response

Response:

```json
{
  "status": "ok",
  "echo": "hello",
  "timestamp": 1760000000000
}
```

Status codes: `200`, `400`, `401`, `503`

## 8. Forma API

### 8.1 Purpose and Authorization

Provides in-project entity CRUD, search, and complex conditional queries.

Shared behavior:

- JWT authentication runs first
- Forma-level authorization runs next
- `project_id` must be present
- `schema_name` comes from the request path

### 8.2 `POST /api/v1/{schema_name}`

Purpose: Create one or more entities.

The request body supports two formats:

Single object:

```json
{
  "name": "Alice",
  "city": "Tokyo"
}
```

Batch array:

```json
[
  { "name": "Alice" },
  { "name": "Bob" }
]
```

Single-record success response:

```json
{
  "row_id": "6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391",
  "schema_name": "lead",
  "attributes": {
    "name": "Alice",
    "city": "Tokyo"
  }
}
```

Batch success response: `BatchResult`

Status codes: `201`, `400`, `401`, `403`, `500`, `503`

### 8.3 `GET /api/v1/{schema_name}`

Purpose: Query entity lists by schema.

Query parameters:

- `page`: default `1`
- `page_size` or `items_per_page`: default `20`, maximum `100`
- `order_by=<field>:asc|desc`: sort field; if the direction is omitted, the default is `asc`
- `attrs=a,b,c`: return only specific attributes
- Any other query parameter is treated as a filter; multiple parameters are combined with AND

Filter value syntax:

- `eq:value` or plain `value`
- `neq:value`
- `lt:value`
- `lte:value`
- `gt:value`
- `gte:value`
- `in:a,b,c`
- `nin:a,b,c`
- `^:prefix` or `starts_with:prefix`

Example:

`GET /api/v1/lead?page=1&items_per_page=20&order_by=created_at:desc&city=Tokyo&status=in:new,qualified&attrs=name,city`

Response: `QueryResult`

Status codes: `200`, `400`, `401`, `403`, `500`, `503`

### 8.4 `GET /api/v1/{schema_name}/{row_id}`

Purpose: Retrieve a single entity by `row_id`.

Query parameter:

- `attrs`: optional; returns only specific attributes

Response: `DataRecord`

Status codes: `200`, `400 invalid_row_id`, `401`, `403`, `404 record_not_found`, `500`, `503`

### 8.5 `PUT /api/v1/{schema_name}/{row_id}`

Purpose: Update a single entity.

Request body:

```json
{
  "phone": "1234567890",
  "status": "qualified"
}
```

Note: the request body must be a non-empty object.

Response: the updated `DataRecord`

Status codes: `200`, `400`, `401`, `403`, `404`, `500`, `503`

### 8.6 `DELETE /api/v1/{schema_name}/{row_id}`

Purpose: Delete a single entity.

Response: `BatchResult`

Status codes: `200`, `400`, `401`, `403`, `500`, `503`

### 8.7 `DELETE /api/v1/{schema_name}`

Purpose: Delete entities in batch.

Request body:

```json
[
  "6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391",
  "9d4d5a78-bf03-4ca1-97ff-01841d3e76a1"
]
```

Response: `BatchResult`

Status codes: `200`, `400`, `401`, `403`, `500`, `503`

### 8.8 `GET /api/v1/search`

Purpose: Perform a full-text-style search across multiple schemas.

Query parameters:

- `schemas`: required, comma-separated
- `q`: required, search term
- `page`: optional
- `page_size` or `items_per_page`: optional

Example:

`GET /api/v1/search?schemas=lead,visit&q=alice&page=1&page_size=20`

Response: `QueryResult`

Status codes: `200`, `400`, `401`, `403`, `500`, `503`

### 8.9 `POST /api/v1/advanced_query`

Purpose: Submit a complex conditional query using Forma's native `QueryRequest` structure.

Request body:

```json
{
  "schema_name": "lead",
  "page": 1,
  "items_per_page": 20,
  "condition": {
    "l": "and",
    "c": [
      { "a": "age", "v": "gt:18" },
      { "a": "city", "v": "equals:Tokyo" }
    ]
  },
  "sort_by": ["created_at"],
  "sort_order": "desc",
  "attrs": ["name", "city"]
}
```

Notes:

- `schema_name` is required
- `condition` is required
- `condition` may be a leaf node: `{ "a": "...", "v": "..." }`
- `condition` may also be a composite node: `{ "l": "and|or", "c": [ ... ] }`

Response: `QueryResult`

Status codes: `200`, `400`, `401`, `403`, `500`, `503`

## 9. CRUD Agent API

### 9.1 Purpose

Converts natural-language requests into CRUD workflows.

Common workflow phases:

- `intent_recognition`
- `validation`
- `conversation`
- `progressive_execution`
- `complete`
- `error`

### 9.2 `POST /api/ai/v1/sessions`

Purpose: Create a session container.

Request body:

```json
{
  "session_id": "optional-session-id",
  "owner_id": "ignored-by-server",
  "project_id": "ignored-by-server",
  "user_preferences": {
    "language": "zh"
  },
  "attributes": {
    "source": "web"
  }
}
```

Notes:

- `session_id` is optional; if omitted, a UUID is generated automatically
- `owner_id` and `project_id` are not taken from the body; they come from JWT claims

Response: `ConversationSession`

Status codes: `201`, `400`, `401`, `500`, `503`

### 9.3 `GET /api/ai/v1/sessions/{session_id}`

Purpose: Retrieve the session object.

Response: `ConversationSession`

Status codes: `200`, `400`, `401`, `403`, `404`, `503`

### 9.4 `POST /api/ai/v1/sessions/{session_id}/messages`

Purpose: Send one round of natural-language input to a session and trigger the workflow.

Request body:

```json
{
  "user_input": "Help me create a lead named Zhang San",
  "input_type": "text/plain",
  "context": {
    "channel": "chat"
  },
  "metadata": {
    "request_id": "r-123"
  },
  "confirmed": true
}
```

Field notes:

- `user_input`: required
- `input_type`: optional
- `context`: optional; the server injects `project_id`, `owner_id`, and `session_id`
- `metadata`: optional
- `confirmed`: optional; when `true`, the server writes the value into `metadata.confirmed`

Response: `WorkflowOutput`

Status codes:

- `200`: execution succeeded or advanced to the next phase
- `400`: missing `session_id`, `user_input`, or JWT context
- `401`
- `403`
- `404`
- `409`: session conflict, missing confirmation, and similar cases
- `422`: the validation phase failed
- `502`: workflow execution failed
- `503`: the session store or CRUD service is not configured

### 9.5 `GET /api/ai/v1/sessions/{session_id}/messages`

Purpose: Retrieve the workflow state summary.

Response: `WorkflowState`

Notes:

- If workflow state is missing but the session can still be read, the current implementation returns a fallback `WorkflowState` derived from the session.

Status codes: `200`, `400`, `401`, `403`, `404`, `503`

### 9.6 `POST /api/ai/v1/operations`

Purpose: Submit a CRUD Agent request directly without explicitly creating a session.

Request body: same as the session message API.

Additional behavior:

- `session_id` is optional
- If neither the body nor `context` provides `session_id`, the server generates one automatically

Response: `WorkflowOutput`

Status codes: `200`, `400`, `401`, `409`, `422`, `502`, `503`

## 10. Semantic API

### 10.1 `GET /api/v1/semantic/resources`

Purpose: List semantic resources in the project.

Query parameters:

- `kind`: optional; valid enum values are `entity`, `capability`, `policy`, `connector`
- `name`: optional; name filter

Response:

```json
{
  "items": [
    {
      "resource_id": "sem:entity:lead",
      "kind": "entity",
      "name": "lead",
      "description": "Lead entity",
      "metadata": {},
      "source": "schema_registry"
    }
  ]
}
```

Status codes: `200`, `400 invalid_kind`, `404`, `500`

### 10.2 `GET /api/v1/semantic/resources/{resource_id}`

Purpose: Retrieve a single semantic resource and its relations.

Response:

```json
{
  "resource": {
    "resource_id": "sem:entity:lead",
    "kind": "entity",
    "name": "lead",
    "description": "Lead entity",
    "metadata": {},
    "source": "schema_registry"
  },
  "relations": [
    {
      "from_id": "sem:capability:create_lead",
      "to_id": "sem:entity:lead",
      "relation": "capability_uses_entity"
    }
  ]
}
```

Status codes: `200`, `400`, `404`, `500`

### 10.3 `GET /api/v1/semantic/lineage/{entity_type}/{row_id}`

Purpose: Retrieve the change lineage for an entity instance.

Response:

```json
{
  "items": [
    {
      "schema_name": "lead",
      "row_id": "6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391",
      "changed_at": 1760000000000,
      "created_by": "user-123",
      "updated_by": "user-123",
      "deleted_by": ""
    }
  ]
}
```

Status codes: `200`, `400 unknown_entity_type`, `500`

## 11. Governance API

### 11.1 `GET /api/sys/v1/governance/entities/{entity_name}/capabilities`

Purpose: Retrieve the capability and policy view associated with an entity.

Response:

```json
{
  "entity": { "resource_id": "sem:entity:lead", "kind": "entity", "name": "lead", "description": "", "metadata": {}, "source": "schema_registry" },
  "capabilities": [],
  "policies": []
}
```

Status codes: `200`, `400`, `401`, `404`, `500`

### 11.2 `GET /api/sys/v1/governance/capabilities/{capability_name}`

Purpose: Retrieve the entities and policies associated with a capability.

Response:

```json
{
  "capability": { "resource_id": "sem:capability:create_lead", "kind": "capability", "name": "create_lead", "description": "", "metadata": {}, "source": "seed" },
  "entities": [],
  "policies": []
}
```

Status codes: `200`, `400`, `401`, `404`, `500`

### 11.3 `GET /api/sys/v1/governance/policies/{policy_id}/capabilities`

Purpose: Retrieve the capabilities and entities associated with a policy.

Response:

```json
{
  "policy": { "resource_id": "sem:policy:default", "kind": "policy", "name": "default", "description": "", "metadata": {}, "source": "seed" },
  "capabilities": [],
  "entities": []
}
```

Status codes: `200`, `400`, `401`, `404`, `500`

## 12. Discovery API

### 12.1 Shared Parameters

Discovery request bodies use the following structure:

```json
{
  "from": {
    "resource_id": "sem:entity:lead"
  },
  "direction": "both",
  "max_depth": 2,
  "allowed_relations": [
    "capability_uses_entity",
    "policy_governs_capability",
    "entity_linked_to_entity"
  ],
  "limits": {
    "max_nodes": 200,
    "max_edges": 500,
    "max_paths": 10
  }
}
```

Constraints:

- `from` and `to` must provide `resource_id`, or alternatively provide `kind + name`
- `direction` is optional, with the following values:
  - `outbound`
  - `inbound`
  - `both`
- `max_depth` defaults to `2`, with a maximum of `4`
- `allowed_relations` is optional, with the following values:
  - `capability_uses_entity`
  - `policy_governs_capability`
  - `entity_linked_to_entity`
- `limits.max_nodes` defaults to `200`
- `limits.max_edges` defaults to `500`
- `limits.max_paths` defaults to `10`

### 12.2 `POST /api/sys/v1/discovery/reachable`

Purpose: Query resources reachable from an anchor.

Request body:

```json
{
  "from": {
    "kind": "entity",
    "name": "lead"
  },
  "direction": "both",
  "max_depth": 2
}
```

Response:

```json
{
  "anchor": {
    "resource_id": "sem:entity:lead",
    "kind": "entity",
    "name": "lead"
  },
  "reachable": {
    "entities": [],
    "capabilities": [],
    "policies": [],
    "connectors": []
  },
  "edges": [
    {
      "from_id": "sem:capability:create_lead",
      "to_id": "sem:entity:lead",
      "relation": "capability_uses_entity",
      "created_at": 1760000000000
    }
  ],
  "meta": {
    "direction": "both",
    "max_depth": 2,
    "visited_nodes": 2,
    "traversed_edges": 1,
    "path_count": 0,
    "truncated": false,
    "limit_reason": ""
  }
}
```

Status codes: `200`, `400 invalid_request`, `401`, `404`, `500`

### 12.3 `POST /api/sys/v1/discovery/paths`

Purpose: Query paths between two anchors.

Request body:

```json
{
  "from": {
    "resource_id": "sem:policy:default"
  },
  "to": {
    "resource_id": "sem:entity:lead"
  },
  "direction": "both",
  "max_depth": 3
}
```

Response:

```json
{
  "source": {
    "resource_id": "sem:policy:default",
    "kind": "policy",
    "name": "default"
  },
  "target": {
    "resource_id": "sem:entity:lead",
    "kind": "entity",
    "name": "lead"
  },
  "paths": [
    {
      "hop_count": 2,
      "steps": [
        {
          "node": {
            "resource_id": "sem:policy:default",
            "kind": "policy",
            "name": "default"
          }
        },
        {
          "edge": {
            "from_id": "sem:policy:default",
            "to_id": "sem:capability:create_lead",
            "relation": "policy_governs_capability",
            "created_at": 1760000000000
          }
        }
      ]
    }
  ],
  "meta": {
    "direction": "both",
    "max_depth": 3,
    "visited_nodes": 3,
    "traversed_edges": 2,
    "path_count": 1,
    "truncated": false,
    "limit_reason": ""
  }
}
```

Status codes: `200`, `400 invalid_request`, `401`, `404`, `500`

## 13. Intent-to-Action Planning API

### 13.1 `POST /api/ai/v1/intent-to-action/plans`

Purpose: Convert a natural-language intent into an executable plan.

Request body:

```json
{
  "intent": {
    "raw": "delete lead 6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391"
  },
  "actor_context": {
    "project_id": "8c1b6c5c-0c5b-4fd3-b1ea-d3627d3f7cc4",
    "user_id": "ignored-by-server",
    "agent_id": "ignored-by-server"
  },
  "resource_context": {
    "target_kind": "entity",
    "target_type": "lead"
  },
  "known_inputs": {
    "record_id": "6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391"
  }
}
```

Notes:

- `intent.raw` is required
- `actor_context.project_id` must match the JWT `project_id`
- The server overwrites `actor_context.user_id` with the current JWT subject
- The server clears any incoming `actor_context.agent_id`

Response:

```json
{
  "intent": {
    "raw": "delete lead 6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391",
    "normalized": {
      "action_hint": "delete",
      "target_hint": "lead"
    }
  },
  "plan": {
    "id": "plan-123",
    "status": "ready",
    "steps": [
      {
        "step_id": "step-1",
        "title": "Delete lead",
        "status": "executable",
        "source": "ltbase_crud_fallback",
        "target_kind": "entity",
        "target_type": "lead",
        "action_name": "delete",
        "candidate_apis": [
          {
            "kind": "http",
            "method": "DELETE",
            "path": "/api/v1/lead/{record_id}"
          }
        ],
        "parameter_mapping_draft": {
          "record_id": "6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391"
        },
        "missing_inputs": [],
        "user_allowed": true,
        "agent_allowed": true,
        "execution_owners": ["ltbase_internal"],
        "execution_readiness": "ready",
        "blocked_reason": null,
        "semantic_reasoning": {
          "summary": "matched fallback delete action",
          "support": []
        }
      }
    ]
  }
}
```

Status codes: `200`, `400 invalid_request`, `401`, `500`

### 13.2 `POST /api/ai/v1/intent-to-action/executions`

Purpose: Execute a single step from a persisted plan.

Request body:

```json
{
  "plan_id": "plan-123",
  "step_id": "step-1",
  "execution_owner": "ltbase_internal",
  "idempotency_key": "delete-lead-step-1",
  "confirmation": {
    "approved": true
  }
}
```

Field notes:

- `plan_id`: required
- `step_id`: required
- `execution_owner`: the struct allows `external_app` or `ltbase_internal`, but this route currently allows only `ltbase_internal`
- `idempotency_key`: optional; if omitted, the server generates one automatically
- `confirmation.approved`: must be `true` when the step requires explicit confirmation

Execution constraints:

- Only persisted plans that belong to the current JWT user and project can be executed
- Only steps with `source = ltbase_crud_fallback` can be executed
- Internal execution supports only `read`, `list`, and `delete`
- Only `note` or `entity` targets are supported

Response: `ExecutionEnvelope`

```json
{
  "execution_id": "exec-123",
  "plan_id": "plan-123",
  "step_id": "step-1",
  "project_id": "8c1b6c5c-0c5b-4fd3-b1ea-d3627d3f7cc4",
  "user_id": "user-123",
  "trace_id": "trace-123",
  "execution_owner": "ltbase_internal",
  "idempotency_key": "delete-lead-step-1",
  "status": "completed",
  "result": {
    "status_code": 200
  },
  "retry_count": 0,
  "attempts": [
    {
      "attempt_number": 1,
      "status": "succeeded",
      "started_at": 1760000000000,
      "completed_at": 1760000001000
    }
  ],
  "created_at": 1760000000000,
  "updated_at": 1760000001000,
  "expires_at": 1760086400
}
```

Status codes:

- `200`
- `400 invalid_request`
- `401`
- `403 execution_owner_not_allowed`
- `404 execution_not_found`
- `409`: execution context mismatch, confirmation required, or execution is not ready
- `422`: the step is not internally executable
- `500`

### 13.3 `GET /api/ai/v1/intent-to-action/executions/{execution_id}`

Purpose: Retrieve persisted execution status.

Response: `ExecutionEnvelope`

Status codes: `200`, `400 invalid_request`, `401`, `404 execution_not_found`, `409 execution_context_mismatch`, `500`

## 14. Major Differences from the Older Spec

Compared with earlier documentation based on an older handler snapshot, the current implementation has the following major changes:

- `owner_id` is no longer a trusted input in the main Notes and CRUD flows; JWT `sub` or `user_id` is now authoritative
- Notes listing now supports `schema_name` filtering
- `Accept-Language` and `X-LTBASE-TZ-ID` now have active handling logic
- `cmd/api` now includes and exposes:
  - Semantic API
  - Governance API
  - Discovery API
  - Intent-to-Action Planning API
- The planning execution API has additional constraints around persisted plans, execution owner, and readiness or confirmation checks
