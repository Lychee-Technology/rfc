# LTBase Data Plane API Specification (Current Implementation)

This document describes the **current** HTTP API behavior of LtBase data plane.

- Source of truth: `internal/http_handler_routing.go` and related handlers
- Document language: English
- Updated on: 2026-02-27

## 1. Overview

LtBase data plane provides:

- AI Notes (create, list, get, update summary, delete)
- Note model sync status and retry
- Forma entity CRUD and query
- Cross-schema search and advanced query
- CRUD Agent session and operation APIs
- Deep Ping health endpoint

## 2. Authentication and Context

### 2.1 Authentication

Data plane uses JWT claims provided by API Gateway authorizer. Current server requirements:

- JWT claims must exist
- `project_id` (UUID) must exist in claims

> Note: on some code paths, missing `project_id` returns `400` instead of `401`. This is current implementation behavior.

### 2.2 Multi-tenant context

`project_id` is used to isolate tenant data (notes tables, forma tables, session state, etc.).

### 2.3 Common request headers

- `Authorization`
- `Accept-Encoding` (gzip response compression is supported)

Current data plane code does not apply business logic for `Accept-Language` and `X-LTBASE-TZ-ID`.

## 3. Response Format

### 3.1 Success responses

- `Content-Type: application/json`
- For large payloads, if client accepts gzip:
  - `Content-Encoding: gzip`
  - `IsBase64Encoded: true` (Lambda proxy semantics)

### 3.2 Error responses

Unified error payload:

```json
{
  "error_code": "string",
  "message": "string"
}
```

### 3.3 Common status codes

- `200 OK`
- `201 Created`
- `202 Accepted` (e.g., model sync retry still pending)
- `204 No Content`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `422 Unprocessable Entity`
- `500 Internal Server Error`
- `501 Not Implemented` (license check failed)
- `502 Bad Gateway`
- `503 Service Unavailable`

## 4. Route List

| Method | Path |
|---|---|
| POST | `/api/ai/v1/notes` |
| GET | `/api/ai/v1/notes` |
| GET | `/api/ai/v1/notes/{note_id}` |
| PUT | `/api/ai/v1/notes/{note_id}` |
| DELETE | `/api/ai/v1/notes/{note_id}` |
| GET | `/api/ai/v1/notes/{note_id}/model_sync` |
| POST | `/api/ai/v1/notes/{note_id}/model_sync` |
| GET | `/api/v1/deepping` |
| POST | `/api/v1/{schema_name}` |
| GET | `/api/v1/{schema_name}` |
| GET | `/api/v1/{schema_name}/{row_id}` |
| PUT | `/api/v1/{schema_name}/{row_id}` |
| DELETE | `/api/v1/{schema_name}/{row_id}` |
| DELETE | `/api/v1/{schema_name}` |
| GET | `/api/v1/search` |
| POST | `/api/v1/advanced_query` |
| POST | `/api/ai/v1/sessions` |
| GET | `/api/ai/v1/sessions/{session_id}` |
| POST | `/api/ai/v1/sessions/{session_id}/messages` |
| GET | `/api/ai/v1/sessions/{session_id}/messages` |
| POST | `/api/ai/v1/operations` |

## 5. AI Notes API

## 5.1 Note model

```json
{
  "note_id": "<uuid>",
  "owner_id": "<string>",
  "created_at": 1730000000000,
  "updated_at": 1730000000000,
  "type": "text/plain",
  "data": "<text or base64/data-url>",
  "summary": "<summary>",
  "models": [
    {
      "type": "<schema_name>",
      "data": {
        "field": "value"
      }
    }
  ]
}
```

## 5.2 Create Note

- **URL**: `POST /api/ai/v1/notes`
- **Body**:

```json
{
  "owner_id": "usr_01HGW2B5X7J9",
  "type": "text/plain",
  "data": "I plan to visit properties with my family next weekend.",
  "role": "real_estate",
  "models": [
    {
      "type": "log",
      "data": {
        "lead_id": "lead_123",
        "summary": "${note.summary}",
        "type": "${note.type}",
        "data": "${note.data}"
      }
    }
  ]
}
```

- **Field notes**:
  - `owner_id` required
  - `type` required; must start with `text/`, `audio/`, or `image/`
  - `data` required
  - `role` optional (`general`, `real_estate`, `insurance`, `financial`)
  - `models` optional; current implementation supports up to 1 model

- **Status codes**:
  - `201` created
  - `200` idempotent replay (with `Idempotency-Key`)
  - `400` bad request
  - `500` create failed
  - `502` summary generation failed
  - `503` schema registry / forma unavailable

- **Possible response headers**:
  - `X-LTBase-Model-Sync-Status`: `synced|pending|not_applicable`
  - `X-LTBase-Model-Sync-Task-Id`: `<task_id>`
  - `X-LTBase-Idempotency-Replayed`: `true|false`

## 5.3 List Notes

- **URL**: `GET /api/ai/v1/notes?owner_id=<owner_id>&page=1&items_per_page=20&summary=<keyword>`
- **Query params**:
  - `owner_id` required
  - `page` optional, default `1`
  - `items_per_page` optional, default `20`, max `100`
  - `summary` optional
  - `schema_name` currently unsupported (`400 schema_filter_not_supported`)

- **Response**:

```json
{
  "items": [
    {
      "note_id": "<uuid>",
      "owner_id": "<string>",
      "created_at": 1730000000000,
      "updated_at": 1730000000000,
      "type": "text/plain",
      "data": "<text>",
      "summary": "<text>"
    }
  ],
  "page": 1,
  "items_per_page": 20,
  "total_items": 123
}
```

- **Status codes**: `200`, `400`, `500`

## 5.4 Get Note

- **URL**: `GET /api/ai/v1/notes/{note_id}?owner_id=<owner_id>`
- **Status codes**: `200`, `400`, `404`, `500`

## 5.5 Update Note Summary

- **URL**: `PUT /api/ai/v1/notes/{note_id}`
- **Body**:

```json
{
  "summary": "<updated summary>",
  "owner_id": "<optional owner_id>"
}
```

> Current implementation only updates `summary`. `owner_id` in body is not required.

- **Status codes**: `200`, `400`, `404`, `500`

## 5.6 Delete Note

- **URL**: `DELETE /api/ai/v1/notes/{note_id}?owner_id=<owner_id>`
- **Status codes**:
  - `204` success (no body)
  - `400`, `404`, `500`

## 6. Note Model Sync API

## 6.1 Get sync status

- **URL**: `GET /api/ai/v1/notes/{note_id}/model_sync?owner_id=<owner_id>`
- **Response example**:

```json
{
  "task_id": "<task_id>",
  "project_id": "<uuid>",
  "owner_id": "<string>",
  "note_id": "<uuid>",
  "status": "synced",
  "retry_count": 0,
  "last_error": "",
  "updated_at": 1730000000000
}
```

- **Status codes**: `200`, `400`, `404`, `500`

## 6.2 Retry sync

- **URL**: `POST /api/ai/v1/notes/{note_id}/model_sync?owner_id=<owner_id>`
- **Status codes**:
  - `200` synced
  - `202` accepted but still pending
  - `400`, `404`, `500`

## 7. Deep Ping API

- **URL**: `GET /api/v1/deepping?echo=<value>`
- **Notes**: `echo` is truncated to 16 characters max
- **Response**:

```json
{
  "status": "ok",
  "echo": "hello",
  "timestamp": 1730000000000
}
```

- **Status codes**: `200`, `400`, `401`, `500`, `503`

## 8. Forma Entity API

## 8.1 Create entity

- **URL**: `POST /api/v1/{schema_name}`
- **Body**: object (single) or object array (batch)
- **Status codes**: `201`, `400`, `401`, `500`, `503`

Single create response example:

```json
{
  "row_id": "<uuid>",
  "schema_name": "lead",
  "attributes": {
    "name": "Alice"
  }
}
```

## 8.2 List entities

- **URL**: `GET /api/v1/{schema_name}`
- **Query params**:
  - pagination: `page`, `page_size` / `items_per_page`
  - sorting: `order_by=<field>:asc|desc`
  - projection: `attrs=<a,b,c>`
  - filtering: all other query params are parsed as filters (AND logic)

- **Filter operators** (value format: `op:value`):
  - `eq` / `equals`
  - `neq` / `not_equals`
  - `lt` / `lte`
  - `gt` / `gte`
  - `in` / `nin`
  - `^` / `starts_with`

- **Status codes**: `200`, `400`, `401`, `500`, `503`

## 8.3 Get entity by row_id

- **URL**: `GET /api/v1/{schema_name}/{row_id}`
- **Status codes**: `200`, `400`, `401`, `404`, `500`, `503`

## 8.4 Update entity

- **URL**: `PUT /api/v1/{schema_name}/{row_id}`
- **Body**: non-empty object of fields to update
- **Status codes**: `200`, `400`, `401`, `404`, `500`, `503`

## 8.5 Delete single entity

- **URL**: `DELETE /api/v1/{schema_name}/{row_id}`
- **Status codes**: `200`, `400`, `401`, `500`, `503`

> Current implementation returns JSON (`BatchResult`), not an empty body.

## 8.6 Delete entities in batch

- **URL**: `DELETE /api/v1/{schema_name}`
- **Body**: row_id array

```json
[
  "<uuid-1>",
  "<uuid-2>"
]
```

- **Status codes**: `200`, `400`, `401`, `500`, `503`

## 9. Forma Search API

## 9.1 Cross-schema search

- **URL**: `GET /api/v1/search?schemas=lead,visit&q=john&page=1&page_size=20`
- **Params**:
  - `schemas` required (comma-separated)
  - `q` required
  - `page` / `page_size` optional

- **Status codes**: `200`, `400`, `500`, `503`

## 9.2 Advanced conditional query

- **URL**: `POST /api/v1/advanced_query`
- **Body example**:

```json
{
  "schema_name": "lead",
  "page": 1,
  "items_per_page": 20,
  "condition": {
    "l": "and",
    "c": [
      { "a": "age", "v": "gt:18" },
      { "a": "city", "v": "equals:tokyo" }
    ]
  },
  "sort_by": ["created_at"],
  "sort_order": "desc"
}
```

- **Status codes**: `200`, `400`, `500`, `503`

## 9.3 Difference from older docs

Legacy route `POST /api/v1/{schema_name}/search` is **not implemented** in current data plane code. Available search APIs are:

- `GET /api/v1/search`
- `POST /api/v1/advanced_query`

## 10. CRUD Agent API

## 10.1 Create session

- **URL**: `POST /api/ai/v1/sessions`
- **Body example**:

```json
{
  "session_id": "optional-session-id",
  "owner_id": "owner-123",
  "user_preferences": {
    "locale": "en-US"
  },
  "attributes": {
    "source": "web"
  }
}
```

- **Status codes**: `201`, `400`, `401`, `500`, `503`

## 10.2 Get session

- **URL**: `GET /api/ai/v1/sessions/{session_id}?owner_id=<owner_id>`
- **Status codes**: `200`, `400`, `401`, `403`, `404`, `503`

## 10.3 Session message

- **URL**: `POST /api/ai/v1/sessions/{session_id}/messages?owner_id=<owner_id>`
- **Body example**:

```json
{
  "user_input": "Create a lead named Alice",
  "input_type": "text/plain",
  "confirmed": true,
  "context": {
    "channel": "chat"
  },
  "metadata": {
    "request_id": "r-123"
  }
}
```

- **Status codes**: `200`, `400`, `401`, `403`, `404`, `409`, `422`, `500`, `502`, `503`

## 10.4 Get session state/history summary

- **URL**: `GET /api/ai/v1/sessions/{session_id}/messages?owner_id=<owner_id>`
- **Status codes**: `200`, `400`, `401`, `403`, `404`, `503`

## 10.5 Direct CRUD operation

- **URL**: `POST /api/ai/v1/operations?owner_id=<owner_id>`
- **Body**: same as session message API
- **Status codes**: `200`, `400`, `401`, `409`, `422`, `500`, `502`, `503`

## 11. Common Data Structures

## 11.1 Error response

```json
{
  "error_code": "invalid_request",
  "message": "project_id is required in JWT claims"
}
```

## 11.2 ModelData

```json
{
  "type": "lead",
  "data": {
    "name": "Alice"
  }
}
```

## 11.3 WorkflowOutput (shape example)

```json
{
  "session_id": "sess-123",
  "phase": "validation",
  "response": "Please provide phone number",
  "data": {
    "missing_fields": ["phone"]
  },
  "next_action": "ask_user",
  "is_complete": false,
  "error": ""
}
```

## 11.4 Out-of-band errors

Beyond endpoint-specific status codes, all APIs may also return:

- `501 not_implemented` (license check failed)
- `404 route_not_found` (no route matched)
