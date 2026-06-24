# API 认证规范

## 当前方案

LtBase Data Plane 现已统一使用 JWT 认证。

- JWT 由 `authservice` 签发
- JWT 签名 key 由 KMS 管理
- Data Plane 只校验上游 authorizer 注入的 JWT claims
- `project_id` 是所有请求的核心隔离维度

## 请求要求

1. 请求必须经过上游 JWT authorizer 校验
2. 请求上下文中必须包含 JWT claims
3. claims 中必须包含 `project_id`

当前 Data Plane 不再接受历史上的 `LtBase {AccessKey}:{Signature}:{Timestamp}:{Nonce}` 自签名请求头。

## 授权流程

1. 客户端先通过 `authservice` 获取 access token
2. 客户端使用 `Authorization: Bearer <jwt>` 调用 Data Plane
3. API Gateway / 上游 authorizer 验证 JWT
4. Data Plane 从请求上下文读取 claims
5. Data Plane 校验 `project_id` 是否存在，并据此执行 project 级隔离

## 公开用户 Profile

`GET /api/v1/auth/profile/{user_id}`

非管理员用户可读取同一 project 内其他用户的公开 profile，无需额外权限。该接口不可跨 project 读取。

请求要求：
- 携带有效 authservice access token（`Authorization: Bearer <jwt>`）
- JWT claims 必须包含 `project_id`

返回字段：
| 字段 | 说明 |
| --- | --- |
| `user_id` | 用户 ID |
| `email` | 邮箱（来自身份提供方 claim，未必已验证；若有） |
| `display_name` | 显示名（若有） |
| `primary_ou_id` | 主组织单元 ID（组织层级预留字段，目前可能为空，为空时省略） |
| `report_to_user_id` | 汇报对象用户 ID（组织层级预留字段，目前可能为空，为空时省略） |
| `created_at` | 创建时间（Unix 毫秒） |
| `updated_at` | 更新时间（Unix 毫秒） |
| `last_login_at` | 最近登录时间（Unix 毫秒） |

不返回字段：`provider`、`issuer`、`external_sub`、`referral_code`、`identity_claims`、`roles`、`permissions`。

响应示例：
```json
{
  "profile": {
    "user_id": "user_123",
    "email": "user@example.com",
    "display_name": "Alice",
    "primary_ou_id": "ou-root",
    "report_to_user_id": "user_manager",
    "created_at": 1760000000000,
    "updated_at": 1760000000000,
    "last_login_at": 1760000005000
  }
}
```

## 已退役能力

以下历史能力已移除，不应继续使用：

- project 级 `Access Key` / `Access Secret`
- `AK_...` / `SK_...` 凭证格式
- Ed25519 请求体签名认证
- nonce / timestamp 重放保护链路

## 迁移说明

如果你仍持有旧的 access key 集成代码，需要迁移为：

1. 对接 `authservice` 登录或 token 交换接口
2. 获取 JWT access token
3. 用 Bearer Token 调用 Data Plane
