# LTBase Data Plane API 规格（当前实现）

本文档描述 **LtBase data plane** 当前代码实现的 HTTP API 行为。

- 基于代码：`internal/http_handler_routing.go` 及相关 handlers
- 文档语言：中文
- 更新日期：2026-02-27

## 1. 总览

LTBase data plane 提供以下能力：

- AI Notes（创建、查询、更新 summary、删除）
- Note 模型同步状态查询与重试
- Forma 实体 CRUD 与查询
- 跨 schema 搜索与高级条件查询
- CRUD Agent 会话与操作接口
- Deep Ping 健康检查接口

## 2. 认证与上下文

### 2.1 认证

Data plane 使用 API Gateway JWT authorizer 传入 claims。当前服务端要求：

- JWT claims 必须存在
- claims 中必须包含 `project_id`（UUID）

> 注意：部分接口在代码路径中返回 `400 project_id is required...`，而不是 `401`。这是当前实现行为。

### 2.2 多租户上下文

`project_id` 用于隔离租户数据（notes 表、forma 表、session 状态等）。

### 2.3 常用请求 Header

- `Authorization`
- `Accept-Encoding`（支持 `gzip` 响应压缩）

当前 data plane 代码未对 `Accept-Language`、`X-LTBASE-TZ-ID` 做业务逻辑处理。

## 3. 响应格式

### 3.1 成功响应

- `Content-Type: application/json`
- 大响应在客户端声明支持 gzip 时可能返回：
  - `Content-Encoding: gzip`
  - `IsBase64Encoded: true`（API Gateway Lambda proxy 语义）

### 3.2 错误响应

统一错误体：

```json
{
  "error_code": "string",
  "message": "string"
}
```

### 3.3 常见状态码

- `200 OK`
- `201 Created`
- `202 Accepted`（如 model sync retry 仍 pending）
- `204 No Content`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `422 Unprocessable Entity`
- `500 Internal Server Error`
- `501 Not Implemented`（license 校验失败）
- `502 Bad Gateway`
- `503 Service Unavailable`

## 4. 路由清单

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

## 5.1 Note 模型

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

## 5.2 添加 Note

- **URL**: `POST /api/ai/v1/notes`
- **Body**:

```json
{
  "owner_id": "usr_01HGW2B5X7J9",
  "type": "text/plain",
  "data": "计划下周末带家人来看房。",
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

- **字段说明**:
  - `owner_id` 必填
  - `type` 必填，必须以 `text/`、`audio/`、`image/` 开头
  - `data` 必填
  - `role` 可选（如 `general`、`real_estate`、`insurance`、`financial`）
  - `models` 可选；当前实现最多支持 1 个 model

- **状态码**:
  - `201` 创建成功
  - `200` 幂等重放（存在 `Idempotency-Key` 且已创建）
  - `400` 请求参数错误
  - `500` 创建失败
  - `502` AI 摘要生成失败
  - `503` schema registry / forma 不可用

- **响应 Header（可能出现）**:
  - `X-LTBase-Model-Sync-Status`: `synced|pending|not_applicable`
  - `X-LTBase-Model-Sync-Task-Id`: `<task_id>`
  - `X-LTBase-Idempotency-Replayed`: `true|false`

## 5.3 列表查询 Notes

- **URL**: `GET /api/ai/v1/notes?owner_id=<owner_id>&page=1&items_per_page=20&summary=<keyword>`
- **Query 参数**:
  - `owner_id` 必填
  - `page` 可选，默认 `1`
  - `items_per_page` 可选，默认 `20`，最大 `100`
  - `summary` 可选
  - `schema_name` 当前不支持（传入会返回 `400 schema_filter_not_supported`）

- **响应**:

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

- **状态码**: `200`、`400`、`500`

## 5.4 获取 Note 详情

- **URL**: `GET /api/ai/v1/notes/{note_id}?owner_id=<owner_id>`
- **状态码**: `200`、`400`、`404`、`500`

## 5.5 更新 Note Summary

- **URL**: `PUT /api/ai/v1/notes/{note_id}`
- **Body**:

```json
{
  "summary": "<updated summary>",
  "owner_id": "<optional owner_id>"
}
```

> 当前实现仅更新 summary。`owner_id` 在请求体中不是强制字段。

- **状态码**: `200`、`400`、`404`、`500`

## 5.6 删除 Note

- **URL**: `DELETE /api/ai/v1/notes/{note_id}?owner_id=<owner_id>`
- **状态码**:
  - `204` 成功（无 body）
  - `400`、`404`、`500`

## 6. Note Model Sync API

## 6.1 查询同步状态

- **URL**: `GET /api/ai/v1/notes/{note_id}/model_sync?owner_id=<owner_id>`
- **响应示例**:

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

- **状态码**: `200`、`400`、`404`、`500`

## 6.2 重试同步

- **URL**: `POST /api/ai/v1/notes/{note_id}/model_sync?owner_id=<owner_id>`
- **状态码**:
  - `200` 已同步
  - `202` 已受理但仍 pending
  - `400`、`404`、`500`

## 7. Deep Ping API

- **URL**: `GET /api/v1/deepping?echo=<value>`
- **说明**: `echo` 最多回显 16 个字符
- **响应**:

```json
{
  "status": "ok",
  "echo": "hello",
  "timestamp": 1730000000000
}
```

- **状态码**: `200`、`400`、`401`、`500`、`503`

## 8. Forma 实体 API

## 8.1 创建实体

- **URL**: `POST /api/v1/{schema_name}`
- **Body**: 对象（单条）或对象数组（批量）
- **状态码**: `201`、`400`、`401`、`500`、`503`

单条创建响应示例：

```json
{
  "row_id": "<uuid>",
  "schema_name": "lead",
  "attributes": {
    "name": "Alice"
  }
}
```

## 8.2 查询实体列表

- **URL**: `GET /api/v1/{schema_name}`
- **Query 参数**:
  - 分页：`page`、`page_size` / `items_per_page`
  - 排序：`order_by=<field>:asc|desc`
  - 字段投影：`attrs=<a,b,c>`
  - 过滤：其他 query 参数会被解析为过滤条件（AND 关系）

- **过滤操作符**（值格式：`op:value`）:
  - `eq` / `equals`
  - `neq` / `not_equals`
  - `lt` / `lte`
  - `gt` / `gte`
  - `in` / `nin`
  - `^` / `starts_with`

- **状态码**: `200`、`400`、`401`、`500`、`503`

## 8.3 按 row_id 获取实体

- **URL**: `GET /api/v1/{schema_name}/{row_id}`
- **状态码**: `200`、`400`、`401`、`404`、`500`、`503`

## 8.4 更新实体

- **URL**: `PUT /api/v1/{schema_name}/{row_id}`
- **Body**: 需要更新的字段（非空对象）
- **状态码**: `200`、`400`、`401`、`404`、`500`、`503`

## 8.5 删除单个实体

- **URL**: `DELETE /api/v1/{schema_name}/{row_id}`
- **状态码**: `200`、`400`、`401`、`500`、`503`

> 当前实现返回 JSON（BatchResult），不是无 body。

## 8.6 批量删除实体

- **URL**: `DELETE /api/v1/{schema_name}`
- **Body**: row_id 数组

```json
[
  "<uuid-1>",
  "<uuid-2>"
]
```

- **状态码**: `200`、`400`、`401`、`500`、`503`

## 9. Forma Search API

## 9.1 跨 schema 搜索

- **URL**: `GET /api/v1/search?schemas=lead,visit&q=john&page=1&page_size=20`
- **参数**:
  - `schemas` 必填（逗号分隔）
  - `q` 必填
  - `page` / `page_size` 可选

- **状态码**: `200`、`400`、`500`、`503`

## 9.2 高级条件查询

- **URL**: `POST /api/v1/advanced_query`
- **Body 示例**:

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

- **状态码**: `200`、`400`、`500`、`503`

## 9.3 与历史文档差异说明

旧文档中的 `POST /api/v1/{schema_name}/search` 在当前 data plane 代码中 **未实现**。当前可用搜索接口为：

- `GET /api/v1/search`
- `POST /api/v1/advanced_query`

## 10. CRUD Agent API

## 10.1 创建会话

- **URL**: `POST /api/ai/v1/sessions`
- **Body 示例**:

```json
{
  "session_id": "optional-session-id",
  "owner_id": "owner-123",
  "user_preferences": {
    "locale": "zh-CN"
  },
  "attributes": {
    "source": "web"
  }
}
```

- **状态码**: `201`、`400`、`401`、`500`、`503`

## 10.2 查询会话

- **URL**: `GET /api/ai/v1/sessions/{session_id}?owner_id=<owner_id>`
- **状态码**: `200`、`400`、`401`、`403`、`404`、`503`

## 10.3 会话消息

- **URL**: `POST /api/ai/v1/sessions/{session_id}/messages?owner_id=<owner_id>`
- **Body 示例**:

```json
{
  "user_input": "帮我创建一个lead，姓名是张三",
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

- **状态码**: `200`、`400`、`401`、`403`、`404`、`409`、`422`、`500`、`502`、`503`

## 10.4 查询会话状态/历史摘要

- **URL**: `GET /api/ai/v1/sessions/{session_id}/messages?owner_id=<owner_id>`
- **状态码**: `200`、`400`、`401`、`403`、`404`、`503`

## 10.5 直接执行 CRUD 操作

- **URL**: `POST /api/ai/v1/operations?owner_id=<owner_id>`
- **Body**: 与会话消息接口一致
- **状态码**: `200`、`400`、`401`、`409`、`422`、`500`、`502`、`503`

## 11. 通用数据结构

## 11.1 错误响应

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

## 11.3 WorkflowOutput（示意）

```json
{
  "session_id": "sess-123",
  "phase": "validation",
  "response": "请补充手机号",
  "data": {
    "missing_fields": ["phone"]
  },
  "next_action": "ask_user",
  "is_complete": false,
  "error": ""
}
```

## 11.4 约定外错误

所有接口除各自列出的状态码外，还可能返回：

- `501 not_implemented`（license 校验失败）
- `404 route_not_found`（路径未命中）
