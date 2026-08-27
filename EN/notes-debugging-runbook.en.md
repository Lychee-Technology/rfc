# Notes Debugging Runbook (English)

This runbook helps LTBase operators debug notes behavior in deployed environments.

## Prerequisites

- Access to the deployment environment (Control Plane DynamoDB table, DSQL cluster, Data Plane logs)
- Understanding that the current deployment model is single-project
- Familiarity with tools and APIs in rfc [`CN/control-plane-cli.md`](https://github.com/Lychee-Technology/rfc/blob/main/CN/control-plane-cli.md) and [`EN/API-specs-control-plane.en.md`](https://github.com/Lychee-Technology/rfc/blob/main/EN/API-specs-control-plane.en.md)

## 0. Glossary

| Term | Description |
|---|---|
| Data Plane | Notes / Forma CRUD entry-point Lambda |
| Control Plane | AAA / project bootstrap / repair Lambda |
| Gemini extraction | AI-driven extraction of structured model data from note content |
| Forma model sync | Persisting extracted model data into Forma entity tables |
| ModelSyncTask | DynamoDB record tracking model sync state for a note |
| Project suffix | `UUIDToBase32(project_id)`, used to construct table names |

## 1. Identifying project scope

LTBase currently uses a single-project-per-deployment model. Before debugging any notes issue, confirm the target project:

### Option 1: From environment variables

```bash
# Check in Control Plane / Data Plane Lambda environment
echo $PROJECT_ID
```

### Option 2: From JWT claims

Decode the user's JWT token (e.g., via [jwt.io](https://jwt.io)) and inspect the `project_id` claim. Data Plane requests must carry a `project_id` that matches the deployment.

### Option 3: From the Control Plane REST Admin API

```bash
curl -H "Authorization: Bearer <admin-jwt>" \
  https://<control-plane-url>/api/v1/auth/config
```

If the project is mismatched or missing, the issue is in deployment wiring or JWT issuance, not in Notes business logic.

## 2. Locating a specific user's notes

### Recommended: Use existing Notes API

```bash
# List a user's notes (requires valid JWT)
curl -H "Authorization: Bearer <user-jwt>" \
  "https://<data-plane-url>/api/ai/v1/notes?owner_id=<user-id>&page=1&items_per_page=20"

# Get a single note
curl -H "Authorization: Bearer <user-jwt>" \
  "https://<data-plane-url>/api/ai/v1/notes/<note-id>?owner_id=<user-id>"
```

If the API responds correctly, this is the fastest path.

### Fallback: Query DSQL directly

**When to use direct DSQL inspection**: Only when the API is returning unexpected results you cannot explain from the response body and logs, or when the API itself is unavailable. For routine diagnostics, always prefer the API. Never use direct DSQL for writes.

When the API is unavailable or you need to verify storage-level data, run read-only DSQL queries:

```sql
-- Table name: notes_{ProjectSuffix} (suffix = UUIDToBase32(project_id))
-- Default schema is "ltbase"

SELECT note_id, owner_id, summary, mime, compression,
       length(data) as data_len, s3_key,
       models, created_at, updated_at, deleted_at
FROM "ltbase"."notes_<project_suffix>"
WHERE owner_id = '<user-id>' AND deleted_at = 0
ORDER BY created_at DESC
LIMIT 50;
```

> **Warning**: Direct datastore queries are for read-only diagnostics only. Do not perform write operations against DSQL.

## 3. Distinguishing failure types

### 3.1 Data Plane note creation failure

**Symptom**: `POST /api/ai/v1/notes` returns non-201.

**Diagnostic steps**:

1. Check the HTTP status code and error code in the response body:
   - `400 invalid_body` / `400 invalid_json`: Request format or field issue
   - `400 invalid_request`: Missing `owner_id` / `type` / `data`, or `type` not in the allowed list
   - `400 invalid_model_type`: Requested model type is not registered in the schema registry
   - `401 unauthorized`: Invalid or missing JWT
   - `500` or `503`: Internal service error; check Data Plane Lambda logs

2. Inspect Data Plane Lambda CloudWatch logs for the note. Search for `noteID` or key log lines:
   ```
   create note request received
   create note request validated
   create note summary generated
   create note persistence started
   create note persistence succeeded
   ```

3. Common log error patterns:
   - `schema_registry_unavailable`: Forma schema not loaded or misconfigured
   - `gemini response did not contain summary text`: Gemini API returned empty
   - `insert note into dsql`: Database connection or DDL issue

### 3.2 Gemini extraction failure

**Symptom**: Note creation succeeds (201), but `model_extraction.status = "failed"`.

**Meaning**: The note text/audio/image was saved successfully, but Gemini did not return usable structured data for any requested model type.

**Diagnostics**:
- Response header `X-LTBase-Model-Extraction-Status: failed`
- Response body `model_extraction.error` field contains a diagnostic code (e.g., `gemini_model_not_recognized`)
- This means `model_sync.status` will be `extraction_failed` and no Forma entities were created

**Recoverability**: You can update the note summary or resubmit, but this is generally informational: Gemini considers the content to lack matching model type data.

### 3.3 Model sync failure

**Symptom**: Note created successfully, `model_extraction.status = "succeeded"`, but `model_sync.status = "pending"`.

**Meaning**: Gemini successfully extracted model data, but writing to Forma entity tables failed. The note itself is still usable; model sync can be retried later.

**Diagnostics**:

1. Query sync status:
   ```bash
   curl -H "Authorization: Bearer <user-jwt>" \
     "https://<data-plane-url>/api/ai/v1/notes/<note-id>/model_sync?owner_id=<user-id>"
   ```

2. Manually retry:
   ```bash
   curl -X POST -H "Authorization: Bearer <user-jwt>" \
     "https://<data-plane-url>/api/ai/v1/notes/<note-id>/model_sync?owner_id=<user-id>"
   ```

3. Inspect the model sync DynamoDB record:
   - Table: Control Plane DynamoDB table (`DYNAMODB_TABLE_NAME`)
   - PK: `MODELSYNC#project#<project-id>#owner#<owner-id>#note#<note-id>`
   - SK: `STATE`
   - Key fields: `status`, `retry_count`, `last_error`

4. Check whether rows exist in the Forma entity_main table:
   ```sql
   SELECT * FROM "ltbase"."entity_main_<project_suffix>"
   WHERE ltbase_schema_id = <schema_id> AND ltbase_row_id = '<row-id-from-models>';
   ```
   `<schema_id>` can be looked up from `ltbase.schema_registry`.

**Root cause investigation**:
- Forma Manager cannot reach DSQL
- entity_main table does not exist (Control Plane repair not complete)
- Model type missing from schema registry
- Concurrency conflict or transaction issue

### 3.4 Auth / deployment wiring failure

**Symptom**: `401 unauthorized` or `403 forbidden`.

**Diagnostics**:
1. Verify that the JWT `project_id` claim matches the deployment `PROJECT_ID`
2. Confirm Control Plane has bootstrapped correctly:
   ```bash
   # Check Control Plane Lambda logs for ensure-project output
   ```
3. Confirm Data Plane Lambda environment variable `PROJECT_ID` is set correctly
4. Confirm DSQL endpoint and DynamoDB table are reachable

### 3.5 Data Plane note read failure

**Symptom**: `GET /api/ai/v1/notes/{note_id}` returns non-200, or returns 200 but with unexpected content.

**Diagnostic steps**:

1. Check the HTTP status code:
   - `404 not_found`: The note does not exist for this owner, or it has been soft-deleted. Verify with a DSQL query checking `deleted_at`:
     ```sql
     SELECT note_id, deleted_at FROM "ltbase"."notes_<project_suffix>"
     WHERE note_id = '<note-id>' AND owner_id = '<user-id>';
     ```
     If `deleted_at ≠ 0`, the note was deleted and will not be returned by the API.
   - `401 unauthorized`: JWT is invalid or the `owner_id` in the query does not match the JWT `sub` claim. See section 3.4.
   - `500` or `503`: Internal service error. Check Data Plane Lambda CloudWatch logs for `get note` log lines near the timestamp of the request.

2. Note returns 200 but `models` array is empty or `row_id` is absent:
   - This is not a read failure; the note was returned successfully.
   - Check `model_sync.status` in the response. See FAQ Q1 for the `row_id` population rules and section 3.3 for model sync failures.

## 4. Tool selection decision tree

| Goal | Tool |
|---|---|
| Check if a note exists and view its content | `GET /api/ai/v1/notes/{note_id}` |
| List a user's notes | `GET /api/ai/v1/notes?owner_id=...` |
| Check model sync status | `GET /api/ai/v1/notes/{note_id}/model_sync` |
| Retry failed model sync | `POST /api/ai/v1/notes/{note_id}/model_sync` |
| Inspect Control Plane configuration | `GET /api/v1/auth/config` (REST Admin API) |
| Repair project storage objects | Control Plane CLI `repair-project` or Lambda Console Test |
| Inspect raw database content (read-only) | DSQL SQL query (only when API is unavailable or results are unexplainable) |
| Check if a note has been soft-deleted | DSQL query (`deleted_at` field) |
| Inspect model sync persistence state | DynamoDB query (MODELSYNC# PK) |

## 5. FAQ

### Q: Note created successfully but models have no row_id

A: Check `model_sync.status`. `row_id` is present only when status is `synced`. If `pending`, invoke the model sync retry endpoint manually. If `extraction_failed`, Gemini could not extract data matching the requested model types from the content.

### Q: Model sync stays pending

A: Check CloudWatch logs for errors related to `persist models to forma`. Common causes: Forma Manager initialization failure, missing entity_main table, or model type not registered in the schema registry.

### Q: How to confirm what data a specific user can access

A: Use the user's own JWT to call the Data Plane API directly. LTBase uses the JWT `sub` claim as `owner_id`; users can only access their own notes.

### Q: How to inspect large note data

A: Large text is stored compressed; binary data (audio/images) is stored in S3. The API automatically decompresses and fetches from S3 on read, so calling the API directly returns the full original content.
