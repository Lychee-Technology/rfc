# LTBase Data Plane API 规格（基于 `cmd/api` 当前实现）

本文档描述 `ltbase.api/cmd/api` 当前实际暴露的 HTTP API 行为。

- 代码基线：
  - `ltbase.api/cmd/api/main.go`
  - `ltbase.api/internal/http_handler_routing.go`
  - `ltbase.api/internal/notes_handlers.go`
  - `ltbase.api/internal/forma_handlers.go`
  - `ltbase.api/internal/http_handler_crud.go`
  - `ltbase.api/internal/semantic/*.go`
- 文档语言：中文
- 更新日期：2026-04-22

## 1. 总览

当前 data plane 提供以下能力：

- AI Notes：创建、查询、更新摘要、删除
- Note model sync：同步状态查询与重试
- Deep Ping：鉴权与依赖连通性探测
- Forma：实体 CRUD、列表查询、跨 schema 搜索、高级条件查询
- CRUD Agent：会话创建、会话状态、消息驱动执行、直接执行
- Semantic：资源目录与实体 lineage 查询
- Governance：实体/能力/策略的治理视图
- Discovery：语义图可达性与路径查询
- Intent-to-Action Planning：意图规划、计划执行、执行状态查询

## 2. 认证、上下文与公共约定

### 2.1 License 校验

所有请求在进入业务路由前会先经过 license 校验。未授权部署会直接返回：

```json
{
  "error_code": "not_implemented",
  "message": "Unlicensed LTBase."
}
```

状态码：`501 Not Implemented`

### 2.2 JWT claims 与可信上下文

服务端从 API Gateway authorizer claims 中读取身份：

- `project_id`：项目作用域，绝大多数接口要求存在且为 UUID
- `sub`：当前用户 ID
- `user_id`：当 `sub` 缺失时的回退字段

当前实现中，很多接口虽然在请求体里保留了 `owner_id`、`project_id` 字段，但真正生效的是 JWT 中的可信值：

- Notes 接口：`owner_id` 统一取自 JWT `sub`/`user_id`
- CRUD Session/Operations：`owner_id`、`project_id` 统一取自 JWT claims
- Planning：`actor_context.project_id` 必须与 JWT 中的 `project_id` 一致，`user_id` 会被服务端重写为当前 JWT 主体

### 2.3 Header 约定

- `Authorization`：由 API Gateway JWT authorizer 使用
- `Accept-Encoding: gzip`：大响应会返回 gzip 压缩
- `Accept-Language`：支持 `zh`、`en`、`ja`，响应可能附带 `Content-Language`
- `X-LTBASE-TZ-ID`：可选，必须是合法 IANA 时区；非法时返回 `400 invalid_tz_id`
- `Idempotency-Key`：仅 `POST /api/ai/v1/notes` 使用，用于幂等创建

### 2.4 成功响应

- 默认 `Content-Type: application/json`
- 当客户端声明支持 gzip 且响应体较大时，返回可能包含：
  - `Content-Encoding: gzip`
  - `IsBase64Encoded: true`

### 2.5 错误响应

除个别内部委托外，顶层 API 统一使用如下错误体：

```json
{
  "error_code": "string",
  "message": "string"
}
```

### 2.6 常见状态码

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

## 3. 路由总表

| Method | Path | 功能 |
| --- | --- | --- |
| POST | `/api/ai/v1/notes` | 创建 note |
| GET | `/api/ai/v1/notes` | 查询 note 列表 |
| GET | `/api/ai/v1/notes/{note_id}` | 获取单个 note |
| PUT | `/api/ai/v1/notes/{note_id}` | 更新 note 摘要 |
| DELETE | `/api/ai/v1/notes/{note_id}` | 删除 note |
| GET | `/api/ai/v1/notes/{note_id}/model_sync` | 查询 model sync 状态 |
| POST | `/api/ai/v1/notes/{note_id}/model_sync` | 重试 model sync |
| GET | `/api/v1/deepping` | Deep ping |
| POST | `/api/v1/{schema_name}` | Forma 创建实体 |
| GET | `/api/v1/{schema_name}` | Forma 列表查询 |
| GET | `/api/v1/{schema_name}/{row_id}` | Forma 单条读取 |
| PUT | `/api/v1/{schema_name}/{row_id}` | Forma 更新 |
| DELETE | `/api/v1/{schema_name}/{row_id}` | Forma 删除单条 |
| DELETE | `/api/v1/{schema_name}` | Forma 批量删除 |
| GET | `/api/v1/search` | Forma 跨 schema 搜索 |
| POST | `/api/v1/advanced_query` | Forma 高级查询 |
| POST | `/api/ai/v1/sessions` | 创建 CRUD Agent 会话 |
| GET | `/api/ai/v1/sessions/{session_id}` | 获取会话 |
| POST | `/api/ai/v1/sessions/{session_id}/messages` | 发送会话消息 |
| GET | `/api/ai/v1/sessions/{session_id}/messages` | 获取会话工作流状态 |
| POST | `/api/ai/v1/operations` | 直接执行 CRUD Agent 请求 |
| GET | `/api/v1/semantic/resources` | 列出语义资源 |
| GET | `/api/v1/semantic/resources/{resource_id}` | 获取语义资源详情 |
| GET | `/api/v1/semantic/lineage/{entity_type}/{row_id}` | 获取实体 lineage |
| GET | `/api/sys/v1/governance/entities/{entity_name}/capabilities` | 实体治理视图 |
| GET | `/api/sys/v1/governance/capabilities/{capability_name}` | 能力治理视图 |
| GET | `/api/sys/v1/governance/policies/{policy_id}/capabilities` | 策略治理视图 |
| POST | `/api/sys/v1/discovery/reachable` | 语义图可达性查询 |
| POST | `/api/sys/v1/discovery/paths` | 语义图路径查询 |
| POST | `/api/ai/v1/intent-to-action/plans` | 创建意图计划 |
| POST | `/api/ai/v1/intent-to-action/executions` | 执行计划步骤 |
| GET | `/api/ai/v1/intent-to-action/executions/{execution_id}` | 查询执行状态 |

## 4. 通用数据结构

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
  "data": "客户想周末看房",
  "summary": "客户计划周末看房",
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

说明：

- `compression`、`s3_key` 仅在对应存储路径下出现
- `models` 为结构化抽取结果或持久化回显

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

`status` 取值：

- `synced`
- `pending`
- `not_applicable`

### 4.4 Forma DataRecord / QueryResult / BatchResult

单条记录：

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

列表查询响应：

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

批量结果响应：

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

会话对象：

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

工作流输出：

```json
{
  "session_id": "sess-123",
  "phase": "conversation",
  "response": "请补充手机号。",
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

工作流状态：

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

### 5.1 功能

提供原始 note 内容存储、摘要生成、模型抽取与后续同步跟踪。

### 5.2 `POST /api/ai/v1/notes`

用途：创建 note，并在需要时生成 summary 和 model 数据。

请求体：

```json
{
  "owner_id": "ignored-by-server",
  "type": "text/plain",
  "data": "计划下周末带家人看房。",
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

字段说明：

- `type`：必填，必须以 `text/`、`audio/`、`image/` 开头
- `data`：必填
- `role`：可选
- `models`：可选，结构化抽取模板
- `model`：兼容旧客户端的单对象别名，服务端会自动转成 `models`
- `owner_id`：即使传入，也会被 JWT 主体覆盖

请求 Header：

- `Idempotency-Key`：可选。存在时，`note_id` 基于 `project_id + owner_id + key` 生成，重复请求可能直接返回已存在结果

成功响应：`201 Created`

```json
{
  "note_id": "2b3f2c86-5a92-46e8-b0db-49b1fb9ce302",
  "owner_id": "user-123",
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "type": "text/plain",
  "data": "计划下周末带家人看房。",
  "summary": "客户计划下周末带家人看房。",
  "models": [
    {
      "type": "lead",
      "data": {
        "summary": "客户计划下周末带家人看房。",
        "raw_type": "text/plain"
      }
    }
  ]
}
```

响应 Header：

- `X-LTBase-Model-Sync-Status: synced|pending|not_applicable`
- `X-LTBase-Model-Sync-Task-Id: <task_id>`，仅有同步任务时出现
- `X-LTBase-Idempotency-Replayed: true|false`

状态码：

- `201`：创建成功
- `200`：幂等重放命中，返回已存在 note
- `400`：空 body、JSON 非法、`type` 非法、`project_id`/`sub` 缺失、model type 非法
- `429`：摘要服务限流，带 `Retry-After`
- `500`：仓储写入失败
- `502`：摘要生成失败
- `503`：schema registry、Forma manager 等依赖未配置

### 5.3 `GET /api/ai/v1/notes`

用途：按当前 JWT 用户列出 note。

Query 参数：

- `page`：可选，默认 `1`
- `items_per_page`：可选，默认 `20`，最大 `100`
- `summary`：可选，对 summary 做模糊匹配
- `schema_name`：可选，按 `models[].type` 过滤；当前实现支持

响应：

```json
{
  "items": [
    {
      "note_id": "2b3f2c86-5a92-46e8-b0db-49b1fb9ce302",
      "owner_id": "user-123",
      "created_at": 1760000000000,
      "updated_at": 1760000000000,
      "type": "text/plain",
      "data": "计划下周末带家人看房。",
      "summary": "客户计划下周末带家人看房。"
    }
  ],
  "page": 1,
  "items_per_page": 20,
  "total_items": 1
}
```

状态码：`200`、`400`、`500`

### 5.4 `GET /api/ai/v1/notes/{note_id}`

用途：获取单个 note。

路径参数：

- `note_id`：UUID

响应：`Note`

状态码：

- `200`
- `400 invalid_note_id`
- `404 note_not_found`
- `500 fetch_failed`

### 5.5 `PUT /api/ai/v1/notes/{note_id}`

用途：仅更新 note 的 `summary`。

请求体：

```json
{
  "summary": "已人工修正摘要"
}
```

说明：

- 请求体中的 `owner_id` 字段虽然存在于结构体，但服务端仍会使用 JWT 主体
- 空摘要会返回 `400 invalid_request`

响应：更新后的 `Note`

状态码：`200`、`400`、`404`、`500`

### 5.6 `DELETE /api/ai/v1/notes/{note_id}`

用途：删除 note。

成功响应：`204 No Content`

状态码：`204`、`400`、`404`、`500`

## 6. Note Model Sync API

### 6.1 `GET /api/ai/v1/notes/{note_id}/model_sync`

用途：查询 note 的 model 持久化同步状态。

响应：`ModelSyncStatus`

状态码：`200`、`400`、`404`、`500`

### 6.2 `POST /api/ai/v1/notes/{note_id}/model_sync`

用途：对已有 `models` 的 note 再次尝试同步到 Forma。

响应：`ModelSyncStatus`

状态码：

- `200`：同步成功
- `202`：已执行重试但仍是 `pending`
- `400`：note 没有 models，返回 `model_sync_not_required`
- `404`
- `500`

## 7. Deep Ping API

### `GET /api/v1/deepping`

用途：验证 JWT、Dynamo 连接与请求通路。

Query 参数：

- `echo`：可选，返回时最多保留前 16 个字符

响应：

```json
{
  "status": "ok",
  "echo": "hello",
  "timestamp": 1760000000000
}
```

状态码：`200`、`400`、`401`、`503`

## 8. Forma API

### 8.1 功能与授权

提供项目内实体 CRUD、搜索和复杂条件查询。

公共行为：

- 先做 JWT 鉴权
- 再做 Forma 粒度授权
- `project_id` 必须存在
- `schema_name` 来自路径

### 8.2 `POST /api/v1/{schema_name}`

用途：创建单条或多条实体。

请求体支持两种格式：

单条对象：

```json
{
  "name": "Alice",
  "city": "Tokyo"
}
```

批量数组：

```json
[
  { "name": "Alice" },
  { "name": "Bob" }
]
```

单条成功响应：

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

批量成功响应：`BatchResult`

状态码：`201`、`400`、`401`、`403`、`500`、`503`

### 8.3 `GET /api/v1/{schema_name}`

用途：按 schema 查询实体列表。

Query 参数：

- `page`：默认 `1`
- `page_size` 或 `items_per_page`：默认 `20`，最大 `100`
- `order_by=<field>:asc|desc`：排序字段，方向省略时默认 `asc`
- `attrs=a,b,c`：仅返回指定 attributes
- 其他任意 query 参数：视为过滤条件，多个参数按 AND 组合

过滤值语法：

- `eq:value` 或直接 `value`
- `neq:value`
- `lt:value`
- `lte:value`
- `gt:value`
- `gte:value`
- `in:a,b,c`
- `nin:a,b,c`
- `^:prefix` 或 `starts_with:prefix`

示例：

`GET /api/v1/lead?page=1&items_per_page=20&order_by=created_at:desc&city=Tokyo&status=in:new,qualified&attrs=name,city`

响应：`QueryResult`

状态码：`200`、`400`、`401`、`403`、`500`、`503`

### 8.4 `GET /api/v1/{schema_name}/{row_id}`

用途：按 `row_id` 获取单条实体。

Query 参数：

- `attrs`：可选，仅返回指定 attributes

响应：`DataRecord`

状态码：`200`、`400 invalid_row_id`、`401`、`403`、`404 record_not_found`、`500`、`503`

### 8.5 `PUT /api/v1/{schema_name}/{row_id}`

用途：更新单条实体。

请求体：

```json
{
  "phone": "1234567890",
  "status": "qualified"
}
```

说明：必须是非空对象。

响应：更新后的 `DataRecord`

状态码：`200`、`400`、`401`、`403`、`404`、`500`、`503`

### 8.6 `DELETE /api/v1/{schema_name}/{row_id}`

用途：删除单条实体。

响应：`BatchResult`

状态码：`200`、`400`、`401`、`403`、`500`、`503`

### 8.7 `DELETE /api/v1/{schema_name}`

用途：批量删除实体。

请求体：

```json
[
  "6c11d4dd-c5f6-4b8d-b6aa-3c4ce8d8b391",
  "9d4d5a78-bf03-4ca1-97ff-01841d3e76a1"
]
```

响应：`BatchResult`

状态码：`200`、`400`、`401`、`403`、`500`、`503`

### 8.8 `GET /api/v1/search`

用途：跨多个 schema 做全文式搜索。

Query 参数：

- `schemas`：必填，逗号分隔
- `q`：必填，搜索词
- `page`：可选
- `page_size` 或 `items_per_page`：可选

示例：

`GET /api/v1/search?schemas=lead,visit&q=alice&page=1&page_size=20`

响应：`QueryResult`

状态码：`200`、`400`、`401`、`403`、`500`、`503`

### 8.9 `POST /api/v1/advanced_query`

用途：以 Forma 原生 `QueryRequest` 结构提交复杂条件查询。

请求体：

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

说明：

- `schema_name` 必填
- `condition` 必填
- `condition` 可为叶子节点 `{ "a": "...", "v": "..." }`
- 也可为复合节点 `{ "l": "and|or", "c": [ ... ] }`

响应：`QueryResult`

状态码：`200`、`400`、`401`、`403`、`500`、`503`

## 9. CRUD Agent API

### 9.1 功能

用于把自然语言请求转成 CRUD 工作流。

工作流常见 phase：

- `intent_recognition`
- `validation`
- `conversation`
- `progressive_execution`
- `complete`
- `error`

### 9.2 `POST /api/ai/v1/sessions`

用途：创建会话容器。

请求体：

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

说明：

- `session_id` 可选，不传则自动生成 UUID
- `owner_id`、`project_id` 不以 body 为准，而以 JWT claims 为准

响应：`ConversationSession`

状态码：`201`、`400`、`401`、`500`、`503`

### 9.3 `GET /api/ai/v1/sessions/{session_id}`

用途：读取会话对象。

响应：`ConversationSession`

状态码：`200`、`400`、`401`、`403`、`404`、`503`

### 9.4 `POST /api/ai/v1/sessions/{session_id}/messages`

用途：向会话发送一轮自然语言输入并触发工作流。

请求体：

```json
{
  "user_input": "帮我创建一个 lead，姓名是张三",
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

字段说明：

- `user_input`：必填
- `input_type`：可选
- `context`：可选，服务端会补入 `project_id`、`owner_id`、`session_id`
- `metadata`：可选
- `confirmed`：可选，若为 `true`，会写入 `metadata.confirmed`

响应：`WorkflowOutput`

状态码：

- `200`：执行成功或进入下一阶段
- `400`：缺少 `session_id` / `user_input` / JWT 上下文
- `401`
- `403`
- `404`
- `409`：会话冲突、确认缺失等
- `422`：校验阶段失败
- `502`：工作流执行失败
- `503`：session store 或 CRUD service 未配置

### 9.5 `GET /api/ai/v1/sessions/{session_id}/messages`

用途：读取工作流状态摘要。

响应：`WorkflowState`

说明：

- 如果工作流状态不存在，但 session 仍能读到，当前实现会返回基于 session 推导出的 fallback `WorkflowState`

状态码：`200`、`400`、`401`、`403`、`404`、`503`

### 9.6 `POST /api/ai/v1/operations`

用途：不显式创建会话，直接提交一条 CRUD Agent 请求。

请求体：与会话消息接口相同。

补充行为：

- `session_id` 可选
- 若 body 与 `context` 都未提供 `session_id`，服务端会自动生成

响应：`WorkflowOutput`

状态码：`200`、`400`、`401`、`409`、`422`、`502`、`503`

## 10. Semantic API

### 10.1 `GET /api/v1/semantic/resources`

用途：列出项目内语义资源。

Query 参数：

- `kind`：可选，枚举为 `entity`、`capability`、`policy`、`connector`
- `name`：可选，名称过滤

响应：

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

状态码：`200`、`400 invalid_kind`、`404`、`500`

### 10.2 `GET /api/v1/semantic/resources/{resource_id}`

用途：读取单个语义资源及其关系。

响应：

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

状态码：`200`、`400`、`404`、`500`

### 10.3 `GET /api/v1/semantic/lineage/{entity_type}/{row_id}`

用途：读取实体实例的变更 lineage。

响应：

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

状态码：`200`、`400 unknown_entity_type`、`500`

## 11. Governance API

### 11.1 `GET /api/sys/v1/governance/entities/{entity_name}/capabilities`

用途：查询一个实体可关联的 capability / policy 视图。

响应：

```json
{
  "entity": { "resource_id": "sem:entity:lead", "kind": "entity", "name": "lead", "description": "", "metadata": {}, "source": "schema_registry" },
  "capabilities": [],
  "policies": []
}
```

状态码：`200`、`400`、`401`、`404`、`500`

### 11.2 `GET /api/sys/v1/governance/capabilities/{capability_name}`

用途：查询一个 capability 对应的实体与策略。

响应：

```json
{
  "capability": { "resource_id": "sem:capability:create_lead", "kind": "capability", "name": "create_lead", "description": "", "metadata": {}, "source": "seed" },
  "entities": [],
  "policies": []
}
```

状态码：`200`、`400`、`401`、`404`、`500`

### 11.3 `GET /api/sys/v1/governance/policies/{policy_id}/capabilities`

用途：查询一个 policy 关联的 capability 与 entity。

响应：

```json
{
  "policy": { "resource_id": "sem:policy:default", "kind": "policy", "name": "default", "description": "", "metadata": {}, "source": "seed" },
  "capabilities": [],
  "entities": []
}
```

状态码：`200`、`400`、`401`、`404`、`500`

## 12. Discovery API

### 12.1 公共参数

Discovery 请求体使用以下结构：

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

约束：

- `from`/`to` 必须提供 `resource_id`，或提供 `kind + name`
- `direction` 可选，取值：
  - `outbound`
  - `inbound`
  - `both`
- `max_depth` 默认 `2`，最大 `4`
- `allowed_relations` 可选，取值：
  - `capability_uses_entity`
  - `policy_governs_capability`
  - `entity_linked_to_entity`
- `limits.max_nodes` 默认 `200`
- `limits.max_edges` 默认 `500`
- `limits.max_paths` 默认 `10`

### 12.2 `POST /api/sys/v1/discovery/reachable`

用途：从一个 anchor 出发，查询可达资源。

请求体：

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

响应：

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

状态码：`200`、`400 invalid_request`、`401`、`404`、`500`

### 12.3 `POST /api/sys/v1/discovery/paths`

用途：查询两个 anchor 之间的路径。

请求体：

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

响应：

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

状态码：`200`、`400 invalid_request`、`401`、`404`、`500`

## 13. Intent-to-Action Planning API

### 13.1 `POST /api/ai/v1/intent-to-action/plans`

用途：把自然语言意图转换为可执行计划。

请求体：

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

说明：

- `intent.raw` 必填
- `actor_context.project_id` 必须与 JWT claims 中的 `project_id` 一致
- 服务端会把 `actor_context.user_id` 重写为当前 JWT 主体
- 服务端会清空传入的 `actor_context.agent_id`

响应：

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

状态码：`200`、`400 invalid_request`、`401`、`500`

### 13.2 `POST /api/ai/v1/intent-to-action/executions`

用途：执行已持久化计划中的一个步骤。

请求体：

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

字段说明：

- `plan_id`：必填
- `step_id`：必填
- `execution_owner`：结构体允许 `external_app` 或 `ltbase_internal`，但该路由当前只允许 `ltbase_internal`
- `idempotency_key`：可选；不传时服务端会自动生成
- `confirmation.approved`：当步骤要求显式确认时需要传 `true`

执行限制：

- 仅能执行与当前 JWT 用户、当前项目匹配的已持久化 plan
- 仅能执行 `source = ltbase_crud_fallback` 的步骤
- 仅支持内部执行 `read`、`list`、`delete`
- 仅支持 target 为 `note` 或 `entity`

响应：`ExecutionEnvelope`

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

状态码：

- `200`
- `400 invalid_request`
- `401`
- `403 execution_owner_not_allowed`
- `404 execution_not_found`
- `409`：执行上下文不匹配、需要确认、执行未就绪
- `422`：步骤不可内部执行
- `500`

### 13.3 `GET /api/ai/v1/intent-to-action/executions/{execution_id}`

用途：读取已持久化执行状态。

响应：`ExecutionEnvelope`

状态码：`200`、`400 invalid_request`、`401`、`404 execution_not_found`、`409 execution_context_mismatch`、`500`

## 14. 与旧版 spec 的主要差异

相较此前基于旧 handler 快照的文档，当前实现有以下关键变化：

- `owner_id` 已不再作为 Notes / CRUD 主流程的可信输入，统一以 JWT `sub`/`user_id` 为准
- Notes 列表已支持 `schema_name` 过滤
- `Accept-Language` 与 `X-LTBASE-TZ-ID` 已有实际处理逻辑
- `cmd/api` 已新增并暴露：
  - Semantic API
  - Governance API
  - Discovery API
  - Intent-to-Action Planning API
- Planning 执行接口存在额外的持久化计划、执行 owner、ready/confirmation 校验约束
