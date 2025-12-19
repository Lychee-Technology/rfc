# LTBase API

LTBase API是一组遵循RESTFul语义的HTTP API。

## LTBase扩展Headers

除了标准的HTTP Headers，LTBase还支持一些扩展Headers。

### 支持的请求Headers

* `Authorization `，请参阅[Auth](./Auth.cn.md)文档。
* `Accept-Language`，指定客户端接受的语言，目前支持中文、英文和日文。
* `Accept-Encoding`，说明客户端是否可以处理压缩的HTTP Response，目前服务器端只支持`gzip`一种压缩格式。
* `X-LTBASE-TZ-ID`, 指定客户端的时区，使用IANA Time Zone Identifier(e.g., `Asia/Tokyo`)格式，大小写不敏感。

## 请求和响应的HTTP Body

请求和响应的HTTP Body的实际内容均为JSON格式。响应的Body可能使用gzip进行压缩。目前服务器端不支持压缩的请求。

### 响应

* `Content-Encoding`，说明服务器端是否对响应进行了压缩，目前服务器端只支持`gzip`一种压缩格式。
* `Retry-After`，当服务器端遇到可重试的错误（例如上游AI API报错），那么服务器可能会指定这个header，客户端应该遵循服务器的指示在一定时间后重试。服务器端会使用delay格式的Retry-After，单位为秒。例如 `Retry-After: 5`的意思是指延迟5秒后再重试。

## 成功代码

LTBase API使用标准的HTTP状态码来表示请求的处理结果。

* `200 Ok`: 对于大多数API，`200`代表调用成功。
* `201 Created`: 对于创建实体的API，`201`代表调用成功。
* `204 No Content`：对于删除实体的API，由于它的响应没有body，所以使用`204`。

## 错误代码

LTBase API使用标准的HTTP状态码来表示请求的处理结果。以下是一些常见的错误代码：
* `400 Bad Request`：请求参数错误或格式不正确。
* `401 Unauthorized`：认证失败或缺少认证信息。
* `403 Forbidden`：没有权限访问该资源。
* `404 Not Found`：请求的资源不存在。
* `429 Too Many Requests`：请求过多，超过了速率限制。
* `500 Internal Server Error`：服务器内部错误。
* `503 Service Unavailable`：服务暂时不可用，可能是由于维护或过载。

## AI APIs

LTBase的AI API实现了多模态的非机构化数据向结构化数据转换的功能。提供多模态数据提取、模型验证和追问能力。

### Notes Model

`Note`是AI API的基础数据模型，一个`note` 可以是：

* 文字
* 图片
* 语音

每个`note`有自己的owner，客户端在创建note时必须设定 `owner-id` ，在查询note时也必须指定 `owner-id`。从客户端程序的角度，`owner-id` 不一定需要跟用户id一致。例如，owner-id可以是某个项目的id或者某个团队的id。`note` 可以关联多个业务模型（model），每个模型有自己的结构化数据格式。AI API会根据note的内容自动识别并提取对应的结构化数据。

```json
{
    "note_id": "<uuid>",
    "created_at": <epoch millisecond>,
    "updated_at": <epoch millisecond>,
    "type": "text|audio|image",
    "data": "text or url of audio/image file",
    "models": [
       {
          "type": "<model/schema name>",
          "data": {
              "<field1>": "...",
          }
      }
    ],
    "summary": "<summary>"
}
```

`note` 属于LTBase自动管理的数据，所以不支持用户自定义字段，也不建议客户直接在业务中使用`note`中的数据。因此，在 `models` 中，客户可以指定自己定义的模型(schema)和数据格式，并使用占位符（类似于：`${note.<field>}`） 来引用AI从 `note` 中提取的字段数据。目前支持的占位符有：

* `${note.summary}`：AI从note中提取的摘要信息。
* `${note.type}`：note的类型，例如 `text/plain`。
* `${note.data}`：note的原始数据内容，只能用于type是`text/*`类型的note。
* `${note.id}`：note的id。


### 添加一个AI Note

请求URL：`POST /api/ai/v1/notes`

Body:

**例子：**

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

**字段说明：**

*   **`owner_id`**: (必填) 笔记所有者的唯一标识符。
*   **`type`**: (必填) 内容的 MIME 类型，必须以 `text/`, `audio/`, 或 `image/` 开头。
*   **`data`**: (必填) 实际的笔记内容（如果是图片或音频，通常是 Base64 编码或 Data URL）。
*   **`role`**: (可选) AI 助手的角色设定，例如 `"general"`, `"real_estate"`, `"insurance"`, `"financial"`。
*   **`models`**: (可选) 结构化数据数组，用于指定与笔记相关的特定业务模型和数据。目前只支持一个model。在`models`中指定的数据会覆盖LLM从`data`中解析出的数据的对应字段。

### 列出某个owner-id所属的notes

请求URL：`GET /api/ai/v1/notes?owner_id=<owner_id>`

** Response **
```json
{
  "items": [
    {
      "note_id": "<uuid>",
      "owner_id": "<string>",
      "created_at": <epoch millisecond>,
      "updated_at": <epoch millisecond>,
      "type": "text/plain",
      "data": "<text or url of audio/image file>",
      "summary": "<text>"
    }
  ]
}
```

### 获取某个note的详情

请求URL：`GET /api/ai/v1/notes/{note_id}`

**Response**
```json
{
    "note_id": "<uuid>",
    "owner_id": "<string>",
    "created_at": <epoch millisecond>,
    "updated_at": <epoch millisecond>,
    "type": "text/plain",
    "data": "<text or url of audio/image file>",
    "summary": "<text>",
    "models": [
       {
          "type": "<model/schema name>",
          "data": {
              "<field1>": "...",
          }
      }
    ]
}
```


## Delete Note

删除一个Note

`DELETE /api/ai/v1/notes/{note_id}`

## Update Note Summary

只能更新note的summary,其他字段不可变

`PUT /api/ai/v1/notes/{note_id}`

### Body

```json
{
    "summary": "<updated summary>"
}
```


## 访问客户自定义模型的实体的APIs

### 创建一个实体

请求URL：`POST /api/v1/{schema_name}`

#### Body:
```json
{
    ... // 属性字段，根据schema定义
}
```

#### Response:
```json
{
    "row_id": "<row_id>",
    "attributes": {
        ... // 属性字段，根据schema定义
    }
}
```

### 删除一个实体

请求URL： `DELETE /api/v1/{schema_name}/{row_id}`

#### Response：

只通过HTTP Status Code来表示是否删除成功，无body。


### 获取实体数据

执行获取实体操作时，客户端可以指定要求返回的attributes，LTBase会自动根据[Schema](./JSON-Schema-Ext.md) 中定义的 `$ref` 和 `unique property` 属性去相应父实体记录中加载数据。例如：
visit schema 里的contactSnapshot是引用了 `lead.contact` 。在获取visit的时候，BE会自动根据ref 和 ref id （在这里就是lead id）去相应的lead记录中加载 contact 数据。

#### List
请求URL：`GET /api/v1/{schema_name}?page=<page>&page_size=<page_size>&{attr_name}={<operator>:<value>}&order_by=<attr_name>:asc|desc&attrs=<attr1>,<attr2>,...`

List API 支持分页和按属性过滤查询，但是不支持复杂的查询条件组合。所有的过滤条件都是`AND`关系。List API不会自动根据[Schema](./JSON-Schema-Ext.md) 中定义的 `$ref` 和 `unique prorperty` 属性去相应父实体记录中加载数据。

* `page` 和 `page_size` 用于分页，默认 `page=1`，`page_size=20`，最大 `page_size=100`。
* `attrs` 用于指定返回的属性字段，多个属性用逗号分隔。如果不指定，则返回所有属性字段。
* `order_by` 支持按某**一个属性**升序或者降序排序，例如 `order_by=created_at:desc`。

##### 过滤条件

* `operator` 支持的操作符有：

  * `eq`: 等于
  * `neq`: 不等于
  * `lt`: 小于
  * `lte`: 小于等于
  * `gt`: 大于
  * `gte`: 大于等于
  * `in`: 在列表中
  * `nin`: 不在列表中
  * `^`: 字符串以某个值开头

List API不支持如下操作，如果需要更复杂的查询，请使用Search API。
* 复杂的查询条件组合（例如`(A and B) or C`）
* 在查询条件中使用函数
* 在查询条件中使用like
* 全文检索。


#### 按照Row ID获取实体

请求URL：`GET /api/v1/{schema_name}/{row_id}?attrs=<attr1>,<attr2>,...`

* `attrs` 用于指定返回的属性字段（JSON Path），多个属性用逗号分隔。如果不指定，则返回所有属性字段。

* Response:
```json
{
    "row_id": "<row_id>",
    "attributes": {
        ... // attrs中定义的属性字段，
    }
}
```

### 更新一个客户定义的模型的数据

URL：`PUT /api/v1/{schema_name}/{row_id}?attrs=<attr1>,<attr2>,...`

* `attrs` 用于指定返回的属性字段，多个属性用逗号分隔。如果不指定，则返回所有属性字段。

#### Body:
```json
{
    ... // 属性字段，根据schema定义，不需要完整提供所有字段
}
```

#### Response:
```json
{
    "row_id": "<row_id>",
    "attributes": {
        ... // attrs中定义的属性字段，
    }
}
```

### Search

Search API 支持更复杂的查询条件组合、like以及全文检索(拉丁文字，需要单独开启)。如果符合以下条件，Search API会使用OLAP数据（DuckDB）作为后端存储和查询引擎。

1. 搜索请求中设置了接受OLAP存储，也就是说`storage` 属性包含"olap"。
2. 项目启用了[CDC](./CDC.cn.md)
3. 在搜索条件无法使用任何一个`entity_main`中的索引。无论是没有索引，还是索引不可用（例如like、或者使用函数）。

使用OLAP存储的好处是可以支持更复杂的查询条件组合和更高效的查询性能，缺点是数据有一定的延迟（通常在几分钟以内）。如果搜索请求中同时接受OLTP和OLAP存储，那么系统会优先使用OLTP存储进行搜索，如果发现无法使用OLTP存储（例如没有索引），那么会自动切换到OLAP存储。

请求URL：`POST /api/v1/{schema_name}/search?page=<page>&page_size=<page_size>&attrs=<attr1>,<attr2>,...`

```json
{
  "storage": [
    "oltp",
    "olap"
  ],
  "filters": {
    "l": "and",
    "c": [
      {
        "a": "age",
        "v": "gt:18"
      },
      {
        "l": "or",
        "c": [
          {
            "a": "name",
            "v": "like:'%John%'"
          },
          {
            "a": "description",
            "v": "in:['engineer','developer']",
          }
        ]
      }
    ],
    "order_by": [
      {
        "field": "created_at",
        "direction": "desc"
      }
    ]
  }
}

```

* Response:

```json
{
    "total": 100,
    "storage": "oltp|olap", // 搜索使用了哪种存储
    "items": [
        {
            ... // 属性字段，根据schema定义
        }
    ]
}
```

### Semantic search

> 暂不支持
