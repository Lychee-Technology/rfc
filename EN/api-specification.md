# API Specification: Intelligent CRUD Agent System

## Overview

This document provides the complete API specification for the Intelligent CRUD Agent System, extending the existing multimodal notes platform with intelligent CRUD capabilities. The API maintains backward compatibility with existing Notes API while adding new endpoints for CRUD agent functionality.

## Status Update (2026-06-09)

The runtime has migrated to an internal lightweight workflow core. Current AI routes include:

- `POST /api/ai/v1/sessions`
- `GET /api/ai/v1/sessions/{session_id}`
- `POST /api/ai/v1/sessions/{session_id}/messages`
- `GET /api/ai/v1/sessions/{session_id}/messages`
- `POST /api/ai/v1/operations`
- `POST /api/ai/v1/compliance/decisions`
- `POST /api/ai/v1/intent-to-action/plans`
- `POST /api/ai/v1/intent-to-action/executions`
- `POST /api/ai/v1/governance/actions/execute`

Current system ontology and governance routes include:

- `GET /api/sys/v1/ontology/object-types`
- `GET /api/sys/v1/ontology/object-types/{type_name}`
- `GET /api/sys/v1/ontology/link-types`
- `GET /api/sys/v1/ontology/action-types`
- `GET /api/sys/v1/ontology/objects/{type_name}/{id}`
- `POST /api/sys/v1/ontology/objects/{type_name}/search`
- `POST /api/sys/v1/ontology/objects/{type_name}/{id}/reachable`
- `GET /api/sys/v1/ontology/objects/{type_name}/{id}/actions`
- `GET /api/sys/v1/ontology/objects/{type_name}/{id}/provenance`
- `GET /api/sys/v1/governance/entities/{entity_name}/capabilities`
- `GET /api/sys/v1/governance/capabilities/{capability_name}`
- `GET /api/sys/v1/governance/policies/{policy_id}/capabilities`
- `POST /api/sys/v1/governance/claims`
- `GET /api/sys/v1/governance/claims`
- `POST /api/sys/v1/governance/claims/{claim_id}/approve`
- `POST /api/sys/v1/governance/claims/{claim_id}/reject`
- `GET /api/sys/v1/governance/events`
- `POST /api/sys/v1/governance/evidence`
- `GET /api/sys/v1/governance/evidence/gaps`
- `GET /api/sys/v1/governance/evidence/expired`
- `POST /api/sys/v1/governance/evidence/{evidence_id}/validate`
- `POST /api/sys/v1/governance/monitoring/re-evaluate`
- `GET /api/sys/v1/compliance/entities/{entity_name}`
- `GET /api/sys/v1/compliance/capabilities/{capability_name}`
- `GET /api/sys/v1/compliance/policies/{policy_id}`

## Intent-to-Action Planning

LTBase now exposes a schema-agnostic intent-to-action planning API that returns explainable plan steps and execution handoff metadata for upper-layer applications.

## Compliance Decision API

LTBase exposes a read-only compliance preflight API under `/api/ai/v1/compliance/decisions`.

This endpoint evaluates the current request context against project compliance profile and semantic graph state, but it does not mutate data, persist decision results, seed semantic state, or trigger execution handoff.

See `docs/compliance.md` for:
- compliance read-view examples
- decision request and response examples
- profile defaults and built-in controls
- `warn` vs `block` semantics
- planner boundary vs governance and approval

See `docs/intent-to-action.md` for:
- request and response shapes
- `PlanStep` execution handoff fields
- `external_app` vs `ltbase_internal` ownership semantics
- confirmation signal semantics
- the current LTBase internal execution boundary

See `docs/ai-harness.md` for:
- 7-layer harness stack mapping
- execution lifecycle and state machine
- trace and audit contract
- V1 safety and execution boundaries
- roadmap for tool middleware, verifier, and connector runtime

## Ontology API

LTBase exposes project-scoped ontology read APIs under `/api/sys/v1/ontology`.

See `docs/ontology-api.md` for:
- route list
- request and response examples
- relation to semantic, governance, discovery, planning, and Forma APIs
- ontology non-goals

## Governance API

LTBase exposes governance claim lifecycle, evidence, events, monitoring, and action engine routes.

See `docs/governance-api.md` for:
- claim creation, approval, and rejection
- audit evidence submission and validation
- governance event log and hash chain integrity
- governance action engine and execution audit log
- monitoring and re-evaluation

## Task 1 Implementation Status

### 1.1 Document existing Notes API endpoints ✅

**Current Notes API Endpoints:**

| Method | Path | Description | Authentication |
|--------|------|-------------|----------------|
| POST | `/api/ai/v1/notes` | Create a new note with optional model data | JWT bearer token |
| GET | `/api/ai/v1/notes` | List notes with pagination and filtering | JWT bearer token |
| GET | `/api/ai/v1/notes/{note_id}` | Get a specific note by ID | JWT bearer token |
| PUT | `/api/ai/v1/notes/{note_id}` | Update note summary | JWT bearer token |
| DELETE | `/api/ai/v1/notes/{note_id}` | Delete a note | JWT bearer token |
| GET | `/api/ai/v1/notes/{note_id}/model_sync` | Get Forma model sync status for a note | JWT bearer token |
| POST | `/api/ai/v1/notes/{note_id}/model_sync` | Retry Forma model sync for a note | JWT bearer token |
| GET | `/api/v1/deepping` | Health check with authorization | JWT bearer token |
| GET | `/api/v1/search` | Forma entity search | JWT bearer token |
| POST | `/api/v1/advanced_query` | Forma advanced query | JWT bearer token |

**Key Features of Existing API:**
- Multi-tenant isolation via Project ID in request context
- JWT-based authentication via authservice
- Multimodal input support (text, audio, image)
- Gemini AI integration for summary generation
- Forma integration for structured data models
- DynamoDB + PostgreSQL + S3 storage
- Compression support for large responses
- Comprehensive error handling

### 1.2 Design new CRUD Agent API endpoints ✅

**New CRUD Agent API Endpoints:**

| Method | Path | Description | Authentication |
|--------|------|-------------|----------------|
| POST | `/api/ai/v1/sessions` | Start a new CRUD conversation session | JWT bearer token |
| GET | `/api/ai/v1/sessions/{session_id}` | Get session status and context | JWT bearer token |
| POST | `/api/ai/v1/sessions/{session_id}/messages` | Send message to CRUD agent | JWT bearer token |
| GET | `/api/ai/v1/sessions/{session_id}/messages` | Get conversation history | JWT bearer token |
| POST | `/api/ai/v1/operations` | Execute CRUD operations directly | JWT bearer token |
| POST | `/api/ai/v1/compliance/decisions` | Read-only compliance preflight decision evaluation | JWT bearer token |
| POST | `/api/ai/v1/intent-to-action/plans` | Create an intent-to-action plan | JWT bearer token |
| POST | `/api/ai/v1/intent-to-action/executions` | Execute an eligible persisted plan step internally | JWT bearer token |

### 1.3 Create comprehensive OpenAPI 3.0 specification ✅

## OpenAPI 3.0 Specification

```yaml
openapi: 3.0.3
info:
  title: Intelligent CRUD Agent API
  description: |
    Multimodal AI-powered CRUD operations with intelligent intent recognition,
    conversation management, and progressive execution capabilities.
    
    **Key Features:**
    - Multimodal input processing (text, voice, images)
    - Intelligent CRUD intent recognition with confidence scoring
    - Multi-turn conversation management with context preservation
    - Progressive operation execution with automatic validation
    - Multi-tenant architecture with Project ID isolation
    - JWT-based authentication via authservice
    
    **Architecture:**
    - Built on proven multimodal notes platform
    - lightweight workflow core orchestration
    - Deterministic workflow runtime with optional LLM integrations
    - DynamoDB + PostgreSQL + S3 storage
    - Forma integration for structured data models
  version: 2.0.0
  contact:
    name: LTBase API Support
    url: https://ltbase.com/support
  license:
    name: Proprietary
    url: https://ltbase.com/license

servers:
  - url: https://api.ltbase.com
    description: Production server
  - url: https://staging-api.ltbase.com
    description: Staging server

security:
  - BearerJWT: []

paths:
  # Existing Notes API (v1) - Maintained for backward compatibility
  /api/ai/v1/notes:
    post:
      tags: [Notes API v1]
      summary: Create a new note
      description: |
        Create a new multimodal note with optional AI summary generation and model data extraction.
        Supports text, audio, and image inputs with Gemini AI processing.

        ## Model Data Behavior

        ### Placeholders

        Model `data` values may contain `${note.*}` placeholders that are replaced with
        actual note values before model persistence. The following placeholders are supported:

        | Placeholder | Value |
        |---|---|
        | `${note.note_id}` | Note UUID |
        | `${note.owner_id}` | Owner ID |
        | `${note.summary}` | AI-generated summary |
        | `${note.type}` | MIME type of note content |
        | `${note.data}` | Raw note data |
        | `${note.created_at}` | Creation timestamp (milliseconds) |
        | `${note.updated_at}` | Update timestamp (milliseconds) |

        Legacy aliases (without `note.` prefix) are also supported for backward compatibility:
        `${note_id}`, `${owner_id}`, `${note_summary}`, `${note_type}`,
        `${note_data}`, `${note_created_at}`, `${note_updated_at}`.

        Placeholder substitution happens after AI summary generation, before models are
        persisted to Forma. If a placeholder value is not available at substitution time,
        the literal placeholder text is kept as-is.

        ### Request Data Overrides LLM Extraction

        When a field is present in both the request model data and the AI-extracted
        output, the request value takes precedence. AI-extracted-only fields are preserved.

        **Example 1 — request data overrides LLM output:**
        ```jsonc
        // Request models
        { "type": "lead", "data": { "name": "Alice Smith" } }

        // AI extracts: { "type": "lead", "data": { "name": "Alice", "phone": "555-0100" } }
        // Merged result: { "type": "lead", "data": { "name": "Alice Smith", "phone": "555-0100" } }
        ```

        **Example 2 — placeholder substitution with merge:**
        ```jsonc
        // Request models
        { "type": "log", "data": { "note_ref": "${note.note_id}", "title": "Manual Entry" } }

        // AI extracts: { "type": "log", "data": { "title": "Auto Title", "category": "general" } }
        // After placeholder replacement: note_ref = "550e8400-..."
        // Merged result: { "type": "log", "data": { "note_ref": "550e8400-...", "title": "Manual Entry", "category": "general" } }
        ```

        ### models[].row_id

        The `row_id` field in response `models[]` is populated only after Forma model sync
        succeeds (model_sync.status = `synced`). It is absent when:
        - No models were requested
        - AI extraction failed (model_sync.status = `extraction_failed`)
        - Forma persistence is still pending (model_sync.status = `pending`)
      operationId: createNote
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateNoteRequest'
            examples:
              text_note:
                summary: Simple text note
                value:
                  owner_id: "user123"
                  type: "text/plain"
                  data: "Meeting notes: Discussed Q4 budget allocation"
                  role: "general"
              structured_note:
                summary: Note with model data
                value:
                  owner_id: "user123"
                  type: "text/plain"
                  data: "Create order for John Doe, 5 widgets, ship to NYC"
                  role: "general"
                  models:
                    - type: "order"
                      data:
                        customer_name: "John Doe"
                        quantity: 5
                        product: "widgets"
                        shipping_address: "${note.data}"
                    - type: "customer"
                      data:
                        name: "John Doe"
      responses:
        '201':
          description: |
            Note created successfully. The response preserves top-level note fields for
            compatibility and adds model extraction and Forma sync diagnostics.
          headers:
            X-LTBase-Model-Extraction-Status:
              schema:
                $ref: '#/components/schemas/ModelExtractionStatus'
              description: Gemini model extraction result for this create request
            X-LTBase-Model-Sync-Status:
              schema:
                $ref: '#/components/schemas/ModelSyncStatus'
              description: Forma persistence status for extracted models
            X-LTBase-Model-Sync-Task-Id:
              schema:
                type: string
              description: Present when a model sync task was saved
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CreateNoteResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '500':
          $ref: '#/components/responses/InternalError'
    
    get:
      tags: [Notes API v1]
      summary: List notes
      description: List notes with pagination and optional filtering
      operationId: listNotes
      parameters:
        - name: owner_id
          in: query
          required: true
          schema:
            type: string
          description: Owner ID to filter notes
        - name: page
          in: query
          schema:
            type: integer
            minimum: 1
            default: 1
          description: Page number for pagination
        - name: items_per_page
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
          description: Number of items per page
        - name: schema_name
          in: query
          schema:
            type: string
          description: Filter by model schema name
        - name: summary
          in: query
          schema:
            type: string
          description: Filter by summary content
      responses:
        '200':
          description: Notes retrieved successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListNotesResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'

  /api/ai/v1/notes/{note_id}:
    get:
      tags: [Notes API v1]
      summary: Get a specific note
      operationId: getNote
      parameters:
        - name: note_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: owner_id
          in: query
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Note retrieved successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Note'
        '404':
          $ref: '#/components/responses/NotFound'
    
    put:
      tags: [Notes API v1]
      summary: Update note summary
      operationId: updateNote
      parameters:
        - name: note_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateNoteSummaryRequest'
      responses:
        '200':
          description: Note updated successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Note'
        '404':
          $ref: '#/components/responses/NotFound'
    
    delete:
      tags: [Notes API v1]
      summary: Delete a note
      operationId: deleteNote
      parameters:
        - name: note_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: owner_id
          in: query
          required: true
          schema:
            type: string
      responses:
        '204':
          description: Note deleted successfully
        '404':
          $ref: '#/components/responses/NotFound'

  /api/ai/v1/notes/{note_id}/model_sync:
    get:
      tags: [Notes API v1]
      summary: Get note model sync status
      description: |
        Return the saved Forma sync status for a note. If Gemini could not
        recognize requested model data, the endpoint returns `extraction_failed`
        even when the note has no extracted models.
      operationId: getNoteModelSync
      parameters:
        - name: note_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: owner_id
          in: query
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Model sync status retrieved
          headers:
            X-LTBase-Model-Sync-Status:
              schema:
                $ref: '#/components/schemas/ModelSyncStatus'
            X-LTBase-Model-Sync-Task-Id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ModelSyncStatusResponse'
        '404':
          $ref: '#/components/responses/NotFound'
    post:
      tags: [Notes API v1]
      summary: Retry note model sync
      description: Retry Forma persistence for models stored on the note.
      operationId: retryNoteModelSync
      parameters:
        - name: note_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: owner_id
          in: query
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Model sync retry completed
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ModelSyncStatusResponse'
        '202':
          description: Model sync retry accepted but persistence is still pending
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ModelSyncStatusResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '404':
          $ref: '#/components/responses/NotFound'

  # New CRUD Agent API (v1)
  /api/ai/v1/sessions:
    post:
      tags: [CRUD Agent v1]
      summary: Start a new CRUD conversation session
      description: |
        Initialize a new conversation session with the CRUD agent.
        Sessions maintain context across multiple interactions and support
        multi-turn conversations for complex CRUD operations.
      operationId: createCrudSession
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateSessionRequest'
            examples:
              basic_session:
                summary: Basic session creation
                value:
                  owner_id: "user123"
                  preferences:
                    language: "en"
                    confirmation_required: true
              advanced_session:
                summary: Session with model preferences
                value:
                  owner_id: "user123"
                  preferences:
                    language: "en"
                    confirmation_required: false
                    preferred_models: ["order", "customer"]
                    auto_execute: true
      responses:
        '201':
          description: Session created successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CrudSession'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'

  /api/ai/v1/sessions/{session_id}:
    get:
      tags: [CRUD Agent v1]
      summary: Get session status and context
      description: Retrieve current session state, context, and conversation history
      operationId: getCrudSession
      parameters:
        - name: session_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: owner_id
          in: query
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Session retrieved successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CrudSession'
        '404':
          $ref: '#/components/responses/NotFound'

  /api/ai/v1/sessions/{session_id}/messages:
    post:
      tags: [CRUD Agent v1]
      summary: Send message to CRUD agent
      description: |
        Send a multimodal message to the CRUD agent within a session context.
        The agent will process the input, recognize CRUD intents, validate data,
        and either execute operations or ask follow-up questions.
      operationId: sendCrudMessage
      parameters:
        - name: session_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CrudMessageRequest'
            examples:
              text_message:
                summary: Text-based CRUD request
                value:
                  owner_id: "user123"
                  type: "text/plain"
                  data: "Create a new order for customer John Smith, 10 widgets, priority shipping"
              image_message:
                summary: Image-based CRUD request
                value:
                  owner_id: "user123"
                  type: "image/jpeg"
                  data: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
              voice_message:
                summary: Voice-based CRUD request
                value:
                  owner_id: "user123"
                  type: "audio/wav"
                  data: "data:audio/wav;base64,UklGRnoGAABXQVZFZm10..."
      responses:
        '200':
          description: Message processed successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CrudMessageResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '404':
          $ref: '#/components/responses/NotFound'
    
    get:
      tags: [CRUD Agent v1]
      summary: Get conversation history
      description: Retrieve the conversation history for a session
      operationId: getCrudMessages
      parameters:
        - name: session_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: owner_id
          in: query
          required: true
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
          description: Maximum number of messages to return
        - name: offset
          in: query
          schema:
            type: integer
            minimum: 0
            default: 0
          description: Number of messages to skip
      responses:
        '200':
          description: Messages retrieved successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CrudMessagesResponse'

  /api/ai/v1/operations:
    post:
      tags: [CRUD Agent v1]
      summary: Execute CRUD operations directly
      description: |
        Execute CRUD operations directly without a conversation session.
        Useful for programmatic access or when the intent is already clear.
      operationId: executeCrudOperations
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ExecuteOperationsRequest'
            examples:
              single_operation:
                summary: Single create operation
                value:
                  owner_id: "user123"
                  operations:
                    - model: "order"
                      operation: "create"
                      fields:
                        customer_name: "John Smith"
                        product: "widgets"
                        quantity: 10
                        priority: "high"
              multiple_operations:
                summary: Multiple operations
                value:
                  owner_id: "user123"
                  operations:
                    - model: "customer"
                      operation: "create"
                      fields:
                        name: "John Smith"
                        email: "john@example.com"
                    - model: "order"
                      operation: "create"
                      fields:
                        customer_id: "${previous.customer.id}"
                        product: "widgets"
                        quantity: 10
      responses:
        '200':
          description: Operations executed successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ExecuteOperationsResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '422':
          description: Validation failed
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ValidationErrorResponse'

  # Health and utility endpoints
  /api/v1/deepping:
    get:
      tags: [System]
      summary: Health check with authorization
      description: Comprehensive health check that validates authentication and database connectivity
      operationId: deepPing
      parameters:
        - name: echo
          in: query
          schema:
            type: string
            maxLength: 16
          description: Echo parameter for testing
      responses:
        '200':
          description: System is healthy
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: "ok"
                  echo:
                    type: string
                    example: "test"
                  timestamp:
                    type: integer
                    format: int64
                    example: 1703980800000

components:
  securitySchemes:
    BearerJWT:
      type: http
      scheme: bearer
      description: |
        JWT bearer authentication. Tokens are issued by authservice and signed using
        KMS-backed signing keys.
        
        Format: `Authorization: Bearer <jwt>`

  schemas:
    # Existing Notes API schemas
    CreateNoteRequest:
      type: object
      required: [owner_id, type, data]
      properties:
        owner_id:
          type: string
          description: Unique identifier for the note owner
          example: "user123"
        type:
          type: string
          description: MIME type of the note data
          enum: [text/plain, text/markdown, audio/wav, audio/mp3, image/jpeg, image/png]
          example: "text/plain"
        data:
          type: string
          description: Note content (text or base64-encoded binary data)
          example: "Meeting notes: Discussed Q4 budget allocation"
        role:
          $ref: '#/components/schemas/AssistantRole'
        models:
          type: array
          items:
            $ref: '#/components/schemas/ModelData'
          description: Optional structured data models to extract

    UpdateNoteSummaryRequest:
      type: object
      required: [owner_id, summary]
      properties:
        owner_id:
          type: string
          example: "user123"
        summary:
          type: string
          maxLength: 300
          example: "Updated summary of the meeting notes"

    Note:
      type: object
      properties:
        note_id:
          type: string
          format: uuid
          example: "123e4567-e89b-12d3-a456-426614174000"
        owner_id:
          type: string
          example: "user123"
        created_at:
          type: integer
          format: int64
          description: Creation timestamp in milliseconds
          example: 1703980800000
        updated_at:
          type: integer
          format: int64
          description: Last update timestamp in milliseconds
          example: 1703980800000
        deleted_at:
          type: integer
          format: int64
          description: Deletion timestamp in milliseconds (if soft deleted)
          example: 0
        type:
          type: string
          description: MIME type of the original data
          example: "text/plain"
        data:
          type: string
          description: Original note content
          example: "Meeting notes: Discussed Q4 budget allocation"
        summary:
          type: string
          description: AI-generated summary
          example: "Q4 budget meeting summary"
        compression:
          type: string
          description: Compression method used (if any)
          example: "gzip"
        s3_key:
          type: string
          description: S3 key for large content storage
          example: "notes/user123/123e4567-e89b-12d3-a456-426614174000"
        models:
          type: array
          items:
            $ref: '#/components/schemas/ModelData'
          description: Extracted structured data models

    CreateNoteResponse:
      allOf:
        - $ref: '#/components/schemas/Note'
        - type: object
          required: [model_extraction, model_sync]
          properties:
            model_extraction:
              $ref: '#/components/schemas/ModelExtractionResult'
            model_sync:
              $ref: '#/components/schemas/CreateNoteModelSyncStatus'

    ModelExtractionResult:
      type: object
      required: [status]
      properties:
        status:
          $ref: '#/components/schemas/ModelExtractionStatus'
        requested_types:
          type: array
          items:
            type: string
          description: Model types requested by the create request
          example: ["log"]
        extracted_types:
          type: array
          items:
            type: string
          description: Requested model types Gemini returned recognizable data for
          example: ["log"]
        failed_types:
          type: array
          items:
            type: string
          description: Requested model types Gemini did not return recognizable data for
          example: ["log"]
        error:
          type: string
          description: Machine-readable extraction diagnostic when extraction failed or was partial
          example: "gemini_model_not_recognized"

    ModelExtractionStatus:
      type: string
      enum: [not_requested, succeeded, partial, failed]
      description: |
        `not_requested` means no models were requested. `succeeded` means all
        requested model types were recognized. `partial` means only some
        requested model types were recognized. `failed` means note and
        transcription persistence succeeded, but Gemini did not return usable
        model data for any requested type.

    CreateNoteModelSyncStatus:
      type: object
      required: [status]
      properties:
        status:
          $ref: '#/components/schemas/ModelSyncStatus'
        task_id:
          type: string
          description: Saved model sync task ID when present
          example: "123e4567-e89b-12d3-a456-426614174000"

    ModelSyncStatus:
      type: string
      enum: [synced, pending, not_applicable, extraction_failed]
      description: |
        `synced` means extracted models were persisted to Forma. `pending`
        means Forma persistence failed and can be retried. `not_applicable`
        means no models were requested. `extraction_failed` means Gemini did
        not produce usable model data, so no Forma records were created.

    ModelSyncStatusResponse:
      type: object
      required: [project_id, owner_id, note_id, status, retry_count]
      properties:
        task_id:
          type: string
          example: "123e4567-e89b-12d3-a456-426614174000"
        project_id:
          type: string
          example: "api123"
        owner_id:
          type: string
          example: "user123"
        note_id:
          type: string
          format: uuid
          example: "123e4567-e89b-12d3-a456-426614174000"
        status:
          $ref: '#/components/schemas/ModelSyncStatus'
        retry_count:
          type: integer
          minimum: 0
          example: 0
        last_error:
          type: string
          example: "gemini_model_not_recognized"
        updated_at:
          type: integer
          format: int64
          example: 1703980800000

    ListNotesResponse:
      type: object
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/Note'
        page:
          type: integer
          minimum: 1
          example: 1
        items_per_page:
          type: integer
          minimum: 1
          maximum: 100
          example: 20
        total_items:
          type: integer
          minimum: 0
          example: 150

    ModelData:
      type: object
      required: [type]
      properties:
        type:
          type: string
          description: Model schema name
          example: "order"
        row_id:
          type: string
          format: uuid
          description: >
            Forma row ID assigned when the model is successfully persisted.
            This field is populated in create-note and get-note responses after
            Forma model sync succeeds. It is absent when model sync is pending,
            extraction failed, or models were not requested.
          example: "550e8400-e29b-41d4-a716-446655440000"
        data:
          type: object
          additionalProperties: true
          description: Model field values. May contain `${note.*}` placeholders (see create-note description).
          example:
            customer_name: "John Smith"
            product: "widgets"
            quantity: 10

    AssistantRole:
      type: string
      default: general
      description: >
        AI assistant role name that influences summary generation style.
        Built-in values `general`, `real_estate`, `insurance`, `financial`
        serve as fallback. Custom roles can be configured per project via
        the Control Plane catalog API (`/api/v1/catalogs/assistant-roles`).
        Unknown roles fall back to the default `general` role.

    # New CRUD Agent schemas
    CreateSessionRequest:
      type: object
      required: [owner_id]
      properties:
        owner_id:
          type: string
          description: Session owner identifier
          example: "user123"
        preferences:
          $ref: '#/components/schemas/SessionPreferences'

    SessionPreferences:
      type: object
      properties:
        language:
          type: string
          description: Preferred language for responses
          default: "en"
          example: "en"
        confirmation_required:
          type: boolean
          description: Whether to require confirmation before executing operations
          default: true
          example: true
        preferred_models:
          type: array
          items:
            type: string
          description: Preferred data models for intent recognition
          example: ["order", "customer"]
        auto_execute:
          type: boolean
          description: Whether to automatically execute high-confidence operations
          default: false
          example: false
        max_operations_per_turn:
          type: integer
          minimum: 1
          maximum: 10
          default: 3
          description: Maximum operations to execute in a single turn

    CrudSession:
      type: object
      properties:
        session_id:
          type: string
          format: uuid
          example: "123e4567-e89b-12d3-a456-426614174000"
        owner_id:
          type: string
          example: "user123"
        project_id:
          type: string
          description: API tenant identifier
          example: "api123"
        turn_number:
          type: integer
          minimum: 0
          description: Current conversation turn number
          example: 3
        status:
          $ref: '#/components/schemas/SessionStatus'
        preferences:
          $ref: '#/components/schemas/SessionPreferences'
        context:
          $ref: '#/components/schemas/ConversationContext'
        created_at:
          type: integer
          format: int64
          example: 1703980800000
        updated_at:
          type: integer
          format: int64
          example: 1703980800000
        expires_at:
          type: integer
          format: int64
          description: Session expiration timestamp
          example: 1703984400000

    SessionStatus:
      type: string
      enum: [active, waiting_input, completed, expired]
      description: Current session state

    ConversationContext:
      type: object
      properties:
        previous_intents:
          type: array
          items:
            $ref: '#/components/schemas/CrudIntent'
          description: Previously recognized intents in this session
        active_operations:
          type: array
          items:
            $ref: '#/components/schemas/OperationCandidate'
          description: Operations pending execution or confirmation
        user_preferences:
          type: object
          additionalProperties: true
          description: User preferences learned during conversation
        collected_data:
          type: object
          additionalProperties: true
          description: Data collected across conversation turns

    CrudMessageRequest:
      type: object
      required: [owner_id, type, data]
      properties:
        owner_id:
          type: string
          example: "user123"
        type:
          type: string
          description: Input type (MIME type)
          example: "text/plain"
        data:
          type: string
          description: Input content (text or base64-encoded binary)
          example: "Create an order for 5 widgets for customer John Smith"
        context:
          type: object
          additionalProperties: true
          description: Additional context for processing

    CrudMessageResponse:
      type: object
      properties:
        message_id:
          type: string
          format: uuid
          example: "123e4567-e89b-12d3-a456-426614174000"
        session_id:
          type: string
          format: uuid
          example: "123e4567-e89b-12d3-a456-426614174000"
        turn_number:
          type: integer
          example: 4
        response_type:
          $ref: '#/components/schemas/ResponseType'
        content:
          type: string
          description: Agent response message
          example: "I found an intent to create an order. I need the shipping address to proceed."
        recognized_intents:
          type: array
          items:
            $ref: '#/components/schemas/CrudIntent'
          description: CRUD intents recognized from the input
        validation_results:
          type: array
          items:
            $ref: '#/components/schemas/ValidationResult'
          description: Validation results for recognized operations
        executed_operations:
          type: array
          items:
            $ref: '#/components/schemas/ExecutedOperation'
          description: Operations that were executed (if any)
        follow_up_questions:
          type: array
          items:
            type: string
          description: Questions to collect missing information
          example: ["What is the shipping address for this order?"]
        session_status:
          $ref: '#/components/schemas/SessionStatus'
        timestamp:
          type: integer
          format: int64
          example: 1703980800000

    ResponseType:
      type: string
      enum: [question, confirmation, execution, error, completion]
      description: Type of agent response

    CrudIntent:
      type: object
      properties:
        session_id:
          type: string
          format: uuid
        operations:
          type: array
          items:
            $ref: '#/components/schemas/OperationCandidate'
        context:
          $ref: '#/components/schemas/ConversationContext'
        timestamp:
          type: integer
          format: int64

    OperationCandidate:
      type: object
      properties:
        model:
          type: string
          description: Target data model name
          example: "order"
        operation:
          $ref: '#/components/schemas/CrudOperation'
        fields:
          type: object
          additionalProperties: true
          description: Extracted field values
          example:
            customer_name: "John Smith"
            product: "widgets"
            quantity: 5
        confidence:
          type: number
          format: float
          minimum: 0.0
          maximum: 1.0
          description: Confidence score for this operation
          example: 0.85
        required_fields:
          type: array
          items:
            type: string
          description: Fields required for this operation
          example: ["customer_name", "product", "quantity", "shipping_address"]
        missing_fields:
          type: array
          items:
            type: string
          description: Required fields that are missing
          example: ["shipping_address"]

    CrudOperation:
      type: string
      enum: [create, read, update, delete]
      description: CRUD operation type

    ValidationResult:
      type: object
      properties:
        valid:
          type: boolean
          description: Whether validation passed
          example: false
        missing_fields:
          type: array
          items:
            $ref: '#/components/schemas/FieldRequirement'
          description: Missing required fields
        invalid_fields:
          type: array
          items:
            $ref: '#/components/schemas/FieldError'
          description: Fields with validation errors
        suggestions:
          type: array
          items:
            $ref: '#/components/schemas/FieldSuggestion'
          description: Suggested values for fields
        confidence_score:
          type: number
          format: float
          minimum: 0.0
          maximum: 1.0
          example: 0.75

    FieldRequirement:
      type: object
      properties:
        field_name:
          type: string
          example: "shipping_address"
        field_type:
          type: string
          example: "string"
        description:
          type: string
          example: "Customer shipping address"
        examples:
          type: array
          items:
            type: string
          example: ["123 Main St, New York, NY 10001"]
        is_required:
          type: boolean
          example: true

    FieldError:
      type: object
      properties:
        field_name:
          type: string
          example: "quantity"
        error_code:
          type: string
          example: "invalid_range"
        error_message:
          type: string
          example: "Quantity must be between 1 and 1000"
        current_value:
          description: Current invalid value
        suggested_value:
          description: Suggested correction

    FieldSuggestion:
      type: object
      properties:
        field_name:
          type: string
          example: "priority"
        suggested_values:
          type: array
          items:
            type: string
          example: ["low", "normal", "high", "urgent"]
        reason:
          type: string
          example: "Based on schema enum values"

    ExecutedOperation:
      type: object
      properties:
        operation_id:
          type: string
          format: uuid
          example: "123e4567-e89b-12d3-a456-426614174000"
        model:
          type: string
          example: "order"
        operation:
          $ref: '#/components/schemas/CrudOperation'
        fields:
          type: object
          additionalProperties: true
          description: Operation input data
        result:
          type: object
          additionalProperties: true
          description: Operation result data
        success:
          type: boolean
          example: true
        error_message:
          type: string
          description: Error message if operation failed
        timestamp:
          type: integer
          format: int64
          example: 1703980800000

    CrudMessagesResponse:
      type: object
      properties:
        messages:
          type: array
          items:
            $ref: '#/components/schemas/CrudMessageResponse'
        total_count:
          type: integer
          minimum: 0
          example: 25
        has_more:
          type: boolean
          example: true

    ExecuteOperationsRequest:
      type: object
      required: [owner_id, operations]
      properties:
        owner_id:
          type: string
          example: "user123"
        operations:
          type: array
          items:
            $ref: '#/components/schemas/DirectOperation'
          description: Operations to execute
        options:
          $ref: '#/components/schemas/ExecutionOptions'

    DirectOperation:
      type: object
      required: [model, operation, fields]
      properties:
        model:
          type: string
          description: Target data model
          example: "order"
        operation:
          $ref: '#/components/schemas/CrudOperation'
        fields:
          type: object
          additionalProperties: true
          description: Operation data
          example:
            customer_name: "John Smith"
            product: "widgets"
            quantity: 10

    ExecutionOptions:
      type: object
      properties:
        validate_only:
          type: boolean
          description: Only validate operations without executing
          default: false
        atomic:
          type: boolean
          description: Execute all operations atomically
          default: true
        continue_on_error:
          type: boolean
          description: Continue executing remaining operations if one fails
          default: false

    ExecuteOperationsResponse:
      type: object
      properties:
        execution_id:
          type: string
          format: uuid
          example: "123e4567-e89b-12d3-a456-426614174000"
        operations:
          type: array
          items:
            $ref: '#/components/schemas/ExecutedOperation'
        summary:
          type: object
          properties:
            total_operations:
              type: integer
              example: 3
            successful_operations:
              type: integer
              example: 2
            failed_operations:
              type: integer
              example: 1
        timestamp:
          type: integer
          format: int64
          example: 1703980800000

    # Error response schemas
    ErrorResponse:
      type: object
      properties:
        error_code:
          type: string
          description: Machine-readable error code
          example: "validation_failed"
        message:
          type: string
          description: Human-readable error message
          example: "Required field 'customer_name' is missing"
        details:
          type: object
          additionalProperties: true
          description: Additional error details
        timestamp:
          type: integer
          format: int64
          example: 1703980800000

    ValidationErrorResponse:
      type: object
      properties:
        error_code:
          type: string
          example: "validation_failed"
        message:
          type: string
          example: "Operation validation failed"
        validation_results:
          type: array
          items:
            $ref: '#/components/schemas/ValidationResult'
        timestamp:
          type: integer
          format: int64
          example: 1703980800000

  responses:
    BadRequest:
      description: Bad request - invalid input parameters
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            error_code: "invalid_request"
            message: "Required parameter 'owner_id' is missing"
            timestamp: 1703980800000

    Unauthorized:
      description: Unauthorized - invalid or missing authentication
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            error_code: "unauthorized"
            message: "Authorization failed"
            timestamp: 1703980800000

    NotFound:
      description: Resource not found
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            error_code: "not_found"
            message: "Session not found"
            timestamp: 1703980800000

    InternalError:
      description: Internal server error
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            error_code: "internal_error"
            message: "An unexpected error occurred"
            timestamp: 1703980800000

tags:
  - name: Notes API v1
    description: |
      Original multimodal notes API with AI summary generation.
      Maintained for backward compatibility.
  - name: CRUD Agent v1
    description: |
      Intelligent CRUD agent with conversation management,
      intent recognition, and progressive execution.
  - name: System
    description: |
      System health checks and utility endpoints.
```

### 1.5 Validate API design with user scenarios ✅

## User Scenario Validation

### Scenario 1: Simple CRUD Operation via REST API

**User Goal:** Create a new order through text input

**API Flow:**
1. `POST /api/ai/v1/sessions` - Start session
2. `POST /api/ai/v1/sessions/{session_id}/messages` - Send "Create order for John Smith, 5 widgets"
3. Agent recognizes intent, validates data, asks for shipping address
4. `POST /api/ai/v1/sessions/{session_id}/messages` - Provide address
5. Agent executes operation and confirms success

**Validation:** ✅ API supports complete flow with session management and multi-turn conversation

### Scenario 2: Direct Operation Execution

**User Goal:** Programmatically execute known operations

**API Flow:**
1. `POST /api/ai/v1/operations` with structured operation data
2. Receive immediate validation and execution results

**Validation:** ✅ Direct operations API supports programmatic access

### Scenario 3: Multimodal Input Processing

**User Goal:** Create order from image of handwritten note

**API Flow:**
1. Start session via REST
2. Send image data with MIME type `image/jpeg`
3. Agent processes image, extracts text, recognizes CRUD intent
4. Agent asks clarifying questions for missing information
5. Complete operation execution

**Validation:** ✅ API supports multimodal input through existing data field with MIME type specification

## API Design Validation Summary

✅ **Backward Compatibility:** All existing Notes API endpoints preserved with same contracts

✅ **Authentication:** Consistent JWT bearer authentication across all endpoints

✅ **Multi-tenancy:** Project ID isolation maintained through request context

✅ **Multimodal Support:** Text, voice, and image inputs supported via MIME type specification

✅ **Programmatic Access:** Direct operations API supports non-conversational usage

✅ **Extensibility:** Model-aware CRUD flows are supported through existing schema registry integration

✅ **Error Handling:** Comprehensive error responses with actionable information

✅ **Scalability:** Stateless REST design with stateful session context persisted by the backend

✅ **Security:** Consistent authentication, authorization, and audit logging

The API specification successfully addresses all requirements while maintaining consistency with the existing architecture and providing both conversational and programmatic interfaces for CRUD operations.
