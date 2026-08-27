# Notes 调试运行手册（中文）

本文档面向 LTBase 私有化部署的运维人员，说明如何在已部署环境中排查 Notes 行为问题。

## 前置条件

- 拥有部署环境的访问权限（Control Plane DynamoDB 表、DSQL 集群、Data Plane 日志）
- 了解当前部署是单 project 模型
- 熟悉 rfc 中的工具与接口：[`CN/control-plane-cli.md`](https://github.com/Lychee-Technology/rfc/blob/main/CN/control-plane-cli.md) 与 [`EN/API-specs-control-plane.en.md`](https://github.com/Lychee-Technology/rfc/blob/main/EN/API-specs-control-plane.en.md)

## 0. 术语速查

| 术语 | 说明 |
|---|---|
| Data Plane | Notes / Forma CRUD 入口 Lambda |
| Control Plane | AAA / 项目引导 / 修复 Lambda |
| Gemini extraction | AI 从 note 内容中提取结构化模型数据的过程 |
| Forma model sync | 将提取的模型数据写入 Forma 实体表的过程 |
| ModelSyncTask | DynamoDB 中记录 model sync 状态的任务记录 |
| Project suffix | `UUIDToBase32(project_id)`，用于构造表名 |

## 1. 确认 Project Scope

当前 LTBase 采用单部署单 project 模型。在排查任何 Notes 问题前，先确认 target project：

### 方式一：从环境变量确认

```bash
# 在 Control Plane / Data Plane Lambda 环境变量中查看
echo $PROJECT_ID
```

### 方式二：从 JWT Claims 确认

解码用户的 JWT token（例如通过 [jwt.io](https://jwt.io)），检查 `project_id` claim。Data Plane 请求必须带有匹配部署的 `project_id`。

### 方式三：从 Control Plane REST Admin API 确认

```bash
curl -H "Authorization: Bearer <admin-jwt>" \
  https://<control-plane-url>/api/v1/auth/config
```

如 project 不匹配或缺失，问题出在部署 wiring / JWT 签发，而非 Notes 业务逻辑。

## 2. 定位特定用户的 Notes

### 推荐路径：调用现有 Notes API

```bash
# 列出某用户的 Notes（需有效 JWT）
curl -H "Authorization: Bearer <user-jwt>" \
  "https://<data-plane-url>/api/ai/v1/notes?owner_id=<user-id>&page=1&items_per_page=20"

# 获取单条 Note
curl -H "Authorization: Bearer <user-jwt>" \
  "https://<data-plane-url>/api/ai/v1/notes/<note-id>?owner_id=<user-id>"
```

如果 API 返回可用，这是最快路径。

### 备选路径：直接查询 DSQL

**何时使用直接 DSQL 查询**：仅当 API 返回的结果无法从响应体和日志中解释，或 API 本身不可用时。日常排查请优先使用 API。禁止通过 DSQL 执行写操作。

当 API 不可用或需要验证存储层数据时，可只读查询 DSQL：

```sql
-- 确认表名：notes_{ProjectSuffix}（suffix = UUIDToBase32(project_id)）
-- 默认 schema 为 "ltbase"

SELECT note_id, owner_id, summary, mime, compression,
       length(data) as data_len, s3_key,
       models, created_at, updated_at, deleted_at
FROM "ltbase"."notes_<project_suffix>"
WHERE owner_id = '<user-id>' AND deleted_at = 0
ORDER BY created_at DESC
LIMIT 50;
```

> **警告**：直接查询数据存储仅用于只读诊断。不要在 DSQL 上执行写操作。

## 3. 区分失败类型

### 3.1 Data Plane Note 创建失败

**症状**：`POST /api/ai/v1/notes` 返回非 201。

**排查步骤**：

1. 检查 HTTP 状态码和响应体中的错误码：
   - `400 invalid_body` / `400 invalid_json`：请求格式或字段有问题
   - `400 invalid_request`：缺少 `owner_id` / `type` / `data` 或 `type` 不在允许列表
   - `400 invalid_model_type`：请求的 model type 未在 schema registry 中注册
   - `401 unauthorized`：JWT 无效或缺失
   - `500` 或 `503`：内部服务错误，查 Data Plane Lambda 日志

2. 查看 Data Plane Lambda CloudWatch 日志，搜索 `noteID` 或 `create note`：
   ```
   create note request received
   create note request validated
   create note summary generated
   create note persistence started
   create note persistence succeeded
   ```

3. 常见日志错误模式：
   - `schema_registry_unavailable`：Forma schema 未加载或配置错误
   - `gemini response did not contain summary text`：Gemini API 返回空
   - `insert note into dsql`：数据库连接或 DDL 问题

### 3.2 Gemini Extraction 失败

**症状**：Note 创建成功（201），但 `model_extraction.status = "failed"`。

**含义**：Note 文本/音频/图片已成功保存，但 Gemini 未能从中提取出请求的 model type 的结构化数据。

**排查**：
- 响应头 `X-LTBase-Model-Extraction-Status: failed`
- 响应体 `model_extraction.error` 字段包含诊断码（如 `gemini_model_not_recognized`）
- 这意味着 `model_sync.status` 会是 `extraction_failed`，且没有 Forma 实体被创建

**可恢复性**：可以更新 note summary 或重新提交，但这个状态通常说明 Gemini 认为内容中不包含对应 model type 的信息。

### 3.3 Model Sync 失败

**症状**：Note 创建成功，`model_extraction.status = "succeeded"`，但 `model_sync.status = "pending"`。

**含义**：Gemini 成功提取了模型数据，但写入 Forma 实体表失败。Note 本身仍然可用，model sync 可稍后重试。

**排查**：

1. 查询 sync 状态：
   ```bash
   curl -H "Authorization: Bearer <user-jwt>" \
     "https://<data-plane-url>/api/ai/v1/notes/<note-id>/model_sync?owner_id=<user-id>"
   ```

2. 手动重试：
   ```bash
   curl -X POST -H "Authorization: Bearer <user-jwt>" \
     "https://<data-plane-url>/api/ai/v1/notes/<note-id>/model_sync?owner_id=<user-id>"
   ```

3. 查看 model sync 的 DynamoDB 记录：
   - Table：Control Plane DynamoDB 表（`DYNAMODB_TABLE_NAME`）
   - PK：`MODELSYNC#project#<project-id>#owner#<owner-id>#note#<note-id>`
   - SK：`STATE`
   - 关键字段：`status`、`retry_count`、`last_error`

4. 检查 Forma entity_main 表是否有对应的 row：
   ```sql
   SELECT * FROM "ltbase"."entity_main_<project_suffix>"
   WHERE ltbase_schema_id = <schema_id> AND ltbase_row_id = '<row-id-from-models>';
   ```
   其中 `<schema_id>` 可从 `ltbase.schema_registry` 查询得到。

**根因排查**：
- Forma Manager 无法访问 DSQL
- entity_main 表不存在（Control Plane repair 未完成）
- Schema registry 中缺少对应 model type
- 并发冲突或事务问题

### 3.4 权限 / 部署 Wiring 失败

**症状**：`401 unauthorized` 或 `403 forbidden`。

**排查**：
1. 确认 JWT 中 `project_id` claim 与部署 `PROJECT_ID` 匹配
2. 确认 Control Plane 已正确 bootstrap：
   ```bash
   # 查看 Control Plane Lambda 日志中 ensure-project 输出
   ```
3. 确认 Data Plane Lambda 环境变量 `PROJECT_ID` 设置正确
4. 确认 DSQL endpoint / DynamoDB table 均可达

### 3.5 Data Plane Note 读取失败

**症状**：`GET /api/ai/v1/notes/{note_id}` 返回非 200，或返回 200 但内容异常。

**排查步骤**：

1. 根据 HTTP 状态码判断：
   - `404 not_found`：该 owner 下 note 不存在，或 note 已被软删除。通过 DSQL 查询确认 `deleted_at`：
     ```sql
     SELECT note_id, deleted_at FROM "ltbase"."notes_<project_suffix>"
     WHERE note_id = '<note-id>' AND owner_id = '<user-id>';
     ```
     若 `deleted_at ≠ 0`，note 已被删除，API 不会返回该记录。
   - `401 unauthorized`：JWT 无效，或查询中的 `owner_id` 与 JWT `sub` claim 不匹配。参见 3.4 节。
   - `500` 或 `503`：内部服务错误。查看 Data Plane Lambda CloudWatch 日志中请求时间戳附近的 `get note` 相关日志。

2. Note 返回 200，但 `models` 数组为空或缺少 `row_id`：
   - note 已成功返回，这不属于读取失败。
   - 检查响应中的 `model_sync.status`。`row_id` 的填充规则参见常见问题 Q1，model sync 失败排查参见 3.3 节。

## 4. 工具选择决策树

| 你想做什么 | 使用工具 |
|---|---|
| 查看 note 是否存在及其内容 | `GET /api/ai/v1/notes/{note_id}` |
| 查看用户的 note 列表 | `GET /api/ai/v1/notes?owner_id=...` |
| 查看 model sync 状态 | `GET /api/ai/v1/notes/{note_id}/model_sync` |
| 重试失败的 model sync | `POST /api/ai/v1/notes/{note_id}/model_sync` |
| 查看 Control Plane 配置 | `GET /api/v1/auth/config` (REST Admin API) |
| repair project 存储对象 | Control Plane CLI `repair-project` 或 Lambda Console Test |
| 直接查看原始数据库内容（只读） | DSQL SQL 查询（仅当 API 不可用或结果无法解释时使用） |
| 确认 note 是否被软删除 | DSQL 查询（`deleted_at` 字段） |
| 查看 model sync 持久化状态 | DynamoDB 查询（MODELSYNC# PK） |

## 5. 常见问题 FAQ

### Q: Note 创建成功但 models 中没有 row_id

A: 检查 `model_sync.status`。只有 `synced` 状态下才有 `row_id`。若为 `pending`，手动调用 model sync retry；若为 `extraction_failed`，Gemini 未能从内容中提取对应类型的数据。

### Q: model sync 一直 pending

A: 检查 CloudWatch 日志中 `persist models to forma` 相关的错误。常见原因是 Forma Manager 初始化失败、entity_main 表不存在、或 schema registry 中没有对应的 model type。

### Q: 如何确认某个用户能访问哪些数据

A: 使用该用户的 JWT 直接调用 Data Plane API。LTBase 使用 JWT `sub` claim 作为 `owner_id`，用户只能访问自己的 Notes。

### Q: Note 数据很大时如何查看

A: 大文本会被压缩存储，二进制数据（音频/图片）存储在 S3。API 返回时会自动解压并从 S3 拉取，所以直接调 API 即可获取原始内容。
