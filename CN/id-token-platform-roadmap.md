# 一、总体演进路径（分层视角）

你的平台会逐步演进为：

```
Phase 1 → Token Vault（OAuth）
Phase 2 → Capability Gateway（无Token Agent）
Phase 3 → Federation（OIDC + SAML）
Phase 4 → Internal STS（委托与Token Exchange）
Phase 5 → Enterprise Identity Graph（SCIM/目录）
Phase 6 → High Assurance Security（mTLS / PoP / 审计强化）
```



# 二、Phase 1：安全 OAuth Token 托管（0–2个月）

## 🎯目标

建立最小可信基础设施：**安全存储 + 不泄漏 Token**

## 核心功能

* OAuth 2.0 Authorization Code + PKCE
* Token Vault（加密存储）
* Token Broker（运行时解密）
* 基础 Connector（如 Google / GitHub）

## 技术要点

* KMS + Envelope Encryption
* access/refresh token 分开管理
* token 不进入日志/trace
* refresh 自动化

## 架构最小集

* OAuth Connect Service
* Token Vault（DB + KMS）
* Token Broker
* 简单 Connector Runtime

## Deliverables

* 能安全接入至少 1 个 OAuth provider
* Token 全程不可见（除 Broker 内存）
* 基础 API 可调用第三方服务

## 验收标准

* ✔ DB dump 无法还原 token
* ✔ Agent / API 不返回 token
* ✔ refresh 流程稳定



# 三、Phase 2：Capability Gateway（2–4个月）

## 🎯目标

**彻底切断 AI Agent 与 Token 的接触**

## 核心功能

* Capability-based API（能力接口）
* Policy Engine（基础 RBAC）
* Connector 白名单动作
* Audit Logging

## 技术要点

* 禁止通用 HTTP 工具
* schema + 参数校验
* action-level 权限控制
* 审计日志结构化

## 新增组件

* Capability Gateway
* Policy Engine（初版）
* Audit Service

## 示例调用（目标形态）

```json
{
  "capability": "google.calendar.create_event",
  "user": "u123",
  "agent": "assistant",
  "args": {...}
}
```

## Deliverables

* Agent 只能调用能力接口
* 所有第三方调用经 Gateway
* 有完整审计链路

## 验收标准

* ✔ 无任何路径能让 Agent 获取 token
* ✔ 能阻止未授权 action
* ✔ 所有调用可追踪



# 四、Phase 3：企业 SSO 接入（OIDC + SAML）（4–6个月）

## 🎯目标

支持企业身份体系（不仅是 OAuth）

## 核心功能

* OIDC 登录（员工登录）
* SAML SP（企业 IdP 接入）
* Federation Gateway
* Principal Session 抽象

## 技术要点

* SAML Assertion 验证（签名、时效）
* OIDC ID Token 校验（issuer/audience）
* 统一身份模型（principal）

## 新增组件

* Federation Gateway
* Identity Session Vault

## 数据模型新增

* `principal_session`
* `authn_context`
* `assurance_level`

## Deliverables

* 支持企业 IdP（如 Okta / Entra）
* SAML/OIDC 登录成功映射统一身份
* Agent 使用统一 user_id

## 验收标准

* ✔ SAML/OIDC 不泄漏 assertion/token
* ✔ 不同协议统一为同一身份模型
* ✔ 支持多租户 IdP



# 五、Phase 4：Internal STS（委托系统）（6–8个月）

## 🎯目标

建立**真正的“无凭证执行模型”**

## 核心功能

* Token Exchange（内部）
* Delegation Grant（短期能力票据）
* On-behalf-of 模型
* Approval Flow（人工确认）

## 技术要点

* 类似 RFC 8693 思路
* grant TTL 极短（1–5分钟）
* PoP（proof binding）初步实现
* 区分：

  * user
  * agent
  * actor

## 新增组件

* Internal STS
* Delegation Grant Store
* Approval Service

## 执行链路升级

```
Agent → Gateway → Policy → STS → Grant → Connector → API
```

## Deliverables

* 所有 Connector 不再直接使用 OAuth token
* 改为使用 STS grant
* 支持审批（高风险操作）

## 验收标准

* ✔ token 不跨服务传播
* ✔ grant 过期后不可复用
* ✔ 支持 revoke / approval



# 六、Phase 5：企业权限体系（SCIM + Identity Graph）（8–10个月）

## 🎯目标

从“token 权限”升级到“企业级权限治理”

## 核心功能

* SCIM 用户/组同步
* Identity Graph（用户-组-资源关系）
* ABAC / RBAC 混合策略
* 环境/部门/数据域控制

## 技术要点

* SCIM webhook / sync job
* graph-based 权限查询
* 策略引擎升级（OPA / Cedar）

## 新增组件

* Identity Graph Service
* Entitlement Service

## 能力增强

策略可以表达：

* “Finance 部门不能访问 GitHub”
* “只有 Manager 可以发邮件”
* “生产环境需要审批”

## Deliverables

* 接入企业目录（至少一个）
* 策略基于组/部门/环境
* 支持复杂权限判断

## 验收标准

* ✔ 权限不再依赖 token scope
* ✔ 可动态变更权限
* ✔ 权限变化实时生效



# 七、Phase 6：高安全强化（10–12个月）

## 🎯目标

达到企业级/高安全级别

## 核心功能

* mTLS / SPIFFE 服务身份
* Proof-of-Possession Token
* Token Binding（防重放）
* 风险检测（异常行为）
* TEE（可选）

## 技术要点

* 所有服务间 mTLS
* token 绑定 client cert
* anomaly detection（频率/行为）
* 审计增强（SIEM 集成）

## 可选增强

* Nitro Enclave / Confidential VM
* BYOK（客户自带密钥）
* 数据分区隔离

## Deliverables

* 安全等级可对标金融/大型企业
* 满足审计（SOC2 / ISO27001）

## 验收标准

* ✔ token 无法被重放
* ✔ 内部攻击面显著降低
* ✔ 审计链完整



# 八、横向能力（贯穿所有阶段）

## 1. 安全（持续投入）

* 日志脱敏
* 密钥轮换
* 权限最小化
* 渗透测试

## 2. 可观测性

* tracing（无敏感信息）
* metrics（调用/失败/延迟）
* audit（谁做了什么）

## 3. 多租户

* tenant 隔离
* per-tenant KMS key（后期）
* rate limit

## 4. SDK / 开发者体验

* Agent SDK（只暴露 capability）
* Connector SDK（规范化实现）
* Policy DSL



# 九、团队建议配置

最小团队（8–12人）：

* Backend（4–6人）
* Security/Infra（2–3人）
* IAM/Protocol 专家（1–2人）
* SRE（1人）



# 十、关键风险与应对

## 风险 1：设计成“Token Proxy”

👉 解决：强制 Capability 模型

## 风险 2：SAML/OIDC 复杂度爆炸

👉 解决：统一 Identity 抽象

## 风险 3：Agent 绕过策略

👉 解决：无通用 HTTP + 强策略

## 风险 4：日志泄漏 token

👉 解决：全链路 redaction

## 风险 5：权限模型过于简单

👉 解决：尽早引入 ABAC + Graph



# 十一、最终形态（你要达到的系统）

```
          企业 IdP（OIDC / SAML）
                     |
              Federation Gateway
                     |
              Identity Session
                     |
                Internal STS
                     |
      Policy + Identity Graph + Approval
                     |
             Capability Gateway
                     |
          Connector Runtime（受控）
                     |
              第三方 / 内部系统
```

AI Agent 永远停留在：

```
Capability Layer（无凭证区）
```



# 十二、一句话路线总结

**从“安全存 token” → “控制 token 使用” → “抽象身份” → “统一委托” → “企业权限治理” → “高安全执行平台”**