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
* `Retry-After`，当服务器端遇到可重试的错误（例如上游AI API报错），那么服务器可能会指定这个header，客户端应该遵循服务器的指示在一定时间后重试。服务器端会使用delay格式的Retry-After，例如 `Retry-After: 5`的意思是指少延迟5秒后再重试。

## 错误代码

## AI APIs

LTBase的AI API实现了多模态的非机构化数据向结构化数据转换的功能。提供多模态数据提取、模型验证和追问能力。

`Note`是AI API的基础数据模型，一个`note` 可以是：

* 文字
* 图片
* 语音

每个`note`有自己的owner，客户端在创建note时必须设定 `owner-id` ，在查询note时也必须指定 `owner-id`。从客户端程序的角度，`owner-id` 不一定需要跟用户id一致。例如，owner-id可以是某个项目的id或者某个团队的id。



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
      "type": "visit",
      "data": {
      	"lead_id": "lead_123",
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

请求URL：`GET /api/ai/v1/notes`


### 获取某个note的详情

请求URL：`GET /api/ai/v1/notes/{note_id}`


## 客户定义的模型的APIs