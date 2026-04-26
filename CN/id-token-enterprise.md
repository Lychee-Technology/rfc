# **企业身份与委托执行控制平面**

它不再只保管 OAuth token，而是统一承接企业内部常见的几类身份与委托机制：

* **OIDC / OAuth 2.0**：现代企业 IdP、SaaS API 授权。OIDC是在 OAuth 2.0 之上的身份层。([OpenID Foundation][1])
* **SAML 2.0**：大量企业内部 Web SSO 仍在使用，核心是断言、协议绑定和元数据交换。([OASIS Open][2])
* **Token Exchange / STS**：把一个受信令牌换成另一个受限令牌，适合“代表用户但不暴露原始凭证”的中间层。RFC 8693 定义了 OAuth 2.0 Token Exchange。([RFC Editor][3])
* **SCIM**：不是登录协议，而是企业身份对象、组和生命周期同步的标准协议，适合做用户/组/角色治理。([RFC Editor][4])
* **证书绑定 / mTLS**：可把访问令牌和客户端证书绑定，减少令牌被窃取后离线重放的风险。RFC 8705 定义了 OAuth 的 mTLS 客户端认证和证书绑定 access token。([RFC Editor][5])

核心思路不变：

**AI Agent 永远不接触企业 SSO 的原始凭证、会话材料或可重放令牌。**
Agent 只拿到“能力”，不拿到“凭证”。



# 一、从“Token Vault”升级成“Enterprise Credential Abstraction Layer”

之前平台里保管的是：

* access token
* refresh token

扩到企业 SSO 后，平台要抽象为统一的 **Credential / Assertion / Session / Delegation** 模型。

## 统一凭证抽象

把各种企业身份材料统一成下面几类对象：

### 1. Identity Proof

证明“这个用户是谁、在哪个租户、通过什么 IdP 登录”的材料，比如：

* OIDC ID Token
* SAML Assertion
* Kerberos/SPNEGO 结果
* 企业 CAS/自研 SSO 的登录票据
* X.509 客户端证书映射结果

### 2. Delegation Credential

证明“平台可以在什么范围内代表用户做什么”的材料，比如：

* OAuth access token
* RFC 8693 exchange 后的受限 token
* 某个内部服务签发的短期 delegation token
* 某个 connector 的 capability token

### 3. Session Handle

不直接保存可重放的原始票据，而是保存：

* `session_id`
* `subject_id`
* `tenant_id`
* `authn_context`
* `assurance_level`
* `delegation_scope`

Agent 最多只知道 handle，不知道底层票据。

### 4. Entitlement Snapshot

来自企业目录或 SCIM / HR / IAM 的权限快照：

* 部门
* 组
* 项目
* 角色
* 数据域
* 环境级别

这部分决定 Agent “可不可以请求某能力”，而不是底层协议决定。SCIM 正适合承担跨域身份对象和组信息同步。([RFC Editor][4])



# 二、把“认证”和“委托”拆开

企业内部 SSO 最大的坑，是把这两件事混在一起：

* **认证 Authentication**：证明用户是谁
* **委托 Delegation**：证明平台能代表用户做什么

扩展设计时，必须强制分层。

## 第一层：企业认证层

接入企业 IdP / SSO：

* Okta / Entra ID / Ping / Keycloak / ADFS
* SAML IdP
* OIDC Provider
* 企业内网 Kerberos / IWA
* 自建门户登录

产物不是直接给 Agent 的 token，而是：

* 企业主身份 `principal`
* 登录上下文
* MFA / device / network / authn context
* 会话句柄

## 第二层：平台委托层

平台基于第一层身份，再签发自己的内部委托令牌或 capability。

这层可以做成自己的 **STS（Security Token Service）**。RFC 8693 的 Token Exchange 正好提供了标准化思路：由授权服务器把一个安全令牌换成另一个适合下游使用的令牌。([RFC Editor][3])

也就是说：

* 企业 SSO 只负责“人登录进来”
* 你的平台只负责“给执行面发最小权限的短期委托能力”

这样 Agent 永远不会碰企业 SSO 的原始断言或长会话。



# 三、支持 SAML 的正确方式

如果企业内部大量系统还是 SAML，建议不要让 Agent 或普通业务服务直接消费 SAML assertion，而是让平台做 **SAML Service Provider / Federation Proxy**。

SAML 2.0 的核心是 assertion、协议和绑定，通常用元数据描述实体和密钥。([OASIS Open][6])

## 推荐模式：SAML Federation Gateway

你的平台充当：

* 对企业 IdP 来说：一个 SP
* 对内部执行层来说：一个身份代理

流程：

1. 用户通过企业 SAML IdP 登录
2. 平台验证 SAML Response / Assertion
3. 提取：

   * `NameID`
   * groups / attributes
   * authn context
   * session info
4. 平台把 SAML assertion 转成内部统一的 `principal_session`
5. 如果要访问下游现代 API，再由内部 STS 交换成短期 delegation token
6. Agent 只看到：

   * `user_ref`
   * `tenant_ref`
   * `capability_ref`

## 为什么不要让 SAML assertion 到处流转

因为它很容易变成：

* 可重放材料
* 调试日志污染源
* XML 签名解析风险面
* 复杂的跨服务兼容负担

正确做法是：

**SAML 只在边界验证一次，进入平台后立即归一化。**



# 四、支持 OIDC / OAuth 的方式

OIDC 是身份层，OAuth 2.0 是授权框架。OIDC 可以验证终端用户身份并携带 claims。([OpenID Foundation][1])

扩展到企业内部 SSO 时，OIDC 通常有两种用途：

## 用途 1：员工登录平台

平台作为 OIDC Relying Party / Client：

* 企业 IdP 发 ID Token
* 平台建立员工会话
* 不把 ID Token 传给 Agent

## 用途 2：访问现代企业 API

例如企业的 Microsoft Graph、Google Workspace、内部 API Gateway。

这里不要让 Agent 持有原始 access token，而是：

* 平台保管 refresh/access token
* 或平台对原始 token 做 Token Exchange
* 给执行器一枚更窄权限、更短时效的内部 token



# 五、把平台做成企业级 STS

这是扩展的关键落点。

## 你的平台新增一个内部 STS

它负责把各种“上游身份材料”兑换成“下游受控执行能力”。

### 输入可以是

* SAML assertion 验证结果
* OIDC 登录会话
* OAuth token
* 企业设备证书身份
* 服务账号身份
* 内部机器身份

### 输出不要是原始企业令牌

而是内部的：

* delegation token
* capability token
* signed execution grant
* proof-of-possession token

### 建议输出特征

* 极短 TTL，例如 1–5 分钟
* 仅适用于某个 connector / action
* 绑定 user、tenant、agent、resource、policy version
* 最好绑定调用方证书或运行时实例，防重放

RFC 8693 已经说明了 token exchange / delegation / impersonation 的标准方向。你的平台可以借鉴这个模型，即使内部实现不完全照搬外部格式。([RFC Editor][3])



# 六、把“谁能代表谁”建模清楚

企业内部 SSO 扩展后，最大的复杂度不是协议，而是代理关系。

你至少要支持 4 种主体：

* **Human User**
* **AI Agent**
* **Service / Workflow**
* **Administrator / Break-glass Operator**

以及 4 种关系：

## 1. Authenticate-as

“这是张三本人登录了”

## 2. Act-on-behalf-of

“这个执行器在张三授权范围内代张三操作”

## 3. Impersonate

“管理员或受控系统以某身份执行”
这个要比 on-behalf-of 更严格，通常默认禁用。

## 4. Service-to-service

“某自动化流程用服务主体访问系统”
不能和用户代理混淆。

建议在内部令牌里显式区分：

* `sub`：当前执行主体
* `act`：实际操作者
* `obo`：代表的用户
* `agent_id`
* `approval_id`
* `policy_id`

这样审计时能回答：

“是谁授权的、谁触发的、谁真正执行的、代表了谁、用的哪条策略”。



# 七、对企业目录和组权限，要接入 SCIM / Directory，同步而不是临时查

SCIM 的目标就是跨域身份管理，尤其适合企业到云服务的用户、组和生命周期同步。([RFC Editor][4])

## 扩展建议

不要仅靠 token 里的 claims 决策。
应该引入 **Identity Graph / Entitlement Graph**：

* 用户
* 组
* 部门
* 成本中心
* 经理关系
* 项目成员关系
* 数据域
* 环境级别

来源可以是：

* SCIM
* LDAP / AD
* HRIS
* IAM / IGA
* 自建 RBAC 系统

## 用法

策略判断时不只看：

* token scope

还看：

* 用户是否在 Finance 组
* 是否能访问生产环境
* 是否为该 repo maintainer
* 是否通过了特定审批链

这样你就把“企业 SSO 登录”扩展成“企业身份治理 + 委托执行”。



# 八、如果企业内部还有 Kerberos / Windows 集成认证

很多内网系统并不使用 OAuth / OIDC / SAML，而是：

* Kerberos
* SPNEGO / Negotiate
* NTLM（尽量别新接）
* ADFS / WIA

这类系统也不要直接让 Agent 去持有票据。思路还是一样：

## 方式

* 在边界网关完成集成认证
* 把认证结果映射成内部 principal session
* 对需要访问老系统的执行器使用受控代理

## 最好不要做的事

* 不要把 Kerberos TGT/TGS 暴露给 Agent
* 不要让 Agent 驱动浏览器带企业单点登录 cookie 到处跑
* 不要把浏览器 session cookie 当“能力令牌”

更安全的方式是：

**由受控 connector 代访问老系统，Agent 发意图，执行器发请求。**



# 九、针对企业内部应用，新增“Session Vault”，不只 Token Vault

扩展后存的就不只是 OAuth token 了。

建议拆成三层库：

## 1. Identity Session Vault

存企业认证态，但尽量避免存可重放原件：

* `session_id`
* `tenant_id`
* `subject_id`
* `auth_protocol`（SAML/OIDC/Kerberos/...）
* `authn_time`
* `mfa_state`
* `authn_context`
* `device_trust`
* `network_zone`

## 2. Credential Vault

存真正高敏凭证：

* refresh token
* access token
* exchanged token
* connector secret
* service account credential
* certificate private key reference

全部 envelope encryption。

## 3. Delegation Grant Store

存你平台自己签发的短期委托能力：

* `grant_id`
* `user_id`
* `agent_id`
* `connector`
* `action`
* `resource_scope`
* `approved_by`
* `expires_at`
* `proof_binding`

Agent 常接触的是第三层，不是第二层。



# 十、引入“凭证降级”和“协议归一化”

这是平台可维护的关键。

## 原则

无论上游是：

* SAML assertion
* OIDC ID token
* OAuth access token
* Kerberos session
* X.509 cert identity

进入平台后都先归一化成统一内部对象：

```json
{
  "principal_id": "user_123",
  "tenant_id": "acme",
  "auth_source": "entra_id",
  "auth_protocol": "saml",
  "assurance_level": "aal2",
  "groups": ["finance", "managers"],
  "session_id": "sess_abc"
}
```

然后再生成：

```json
{
  "grant_id": "g_789",
  "on_behalf_of": "user_123",
  "agent_id": "meeting_assistant",
  "connector": "google_calendar",
  "actions": ["create_event"],
  "ttl": 300,
  "proof_bound": true
}
```

这样底层协议的复杂度不会污染 Agent 层和 connector 层。



# 十一、把“浏览器 SSO”与“API 代理”彻底分开

企业内部 SSO 经常是浏览器导向的，而 AI Agent 往往是 API 导向的。两者不能混。

## 浏览器侧

适合：

* 员工登录
* MFA
* 设备校验
* 企业 IdP 重定向
* SAML/OIDC 前端交互

## API 侧

适合：

* Agent 请求能力
* 执行器调用下游系统
* 审计与审批
* Token exchange

### 设计要求

* 浏览器 cookie 不进入 Agent
* 前端 session 不作为下游 API 凭证
* 执行器用独立的后端委托票据



# 十二、为企业场景加入“审批”和“高保证级别”触发器

扩展到企业 SSO 后，很多动作不能只靠“用户登录过”就放行。

建议策略里加入：

* 登录是否为 MFA
* 认证是否来自受管设备
* 是否来自企业网络 / ZTNA 信任网络
* 是否是最近 15 分钟内 re-auth
* 是否满足某个 Authn Context

SAML 有认证上下文概念，OIDC 也可承载认证相关 claims；你的平台应把这些统一映射成 assurance level，而不是每个 connector 单独理解。([OASIS Open][7])

例如：

* 读日历：AAL1 可用
* 发工资邮件：AAL2 + MFA + 最近重认证 + 审批
* 生产环境变更：AAL2 + 管理员审批 + break-glass 记录



# 十三、对下游系统，不再信任长会话，改用短期能力票据

为了避免 SSO 扩展后“平台成了超级会话中心”，建议默认：

* 上游企业 SSO 会话可以相对长
* 下游执行票据必须极短
* 一次动作一票据，或一小段时间一票据

## 可选强化

* 绑定 mTLS 客户端证书
* 绑定执行器实例身份
* 绑定 nonce / audience / connector
* 禁止跨 connector 重用

RFC 8705 说明了证书绑定 access token 的方向，适合高敏执行面。([RFC Editor][5])



# 十四、企业内部系统常见的 3 种接入模式

## 模式 A：平台作为企业 IdP 的下游应用

适合员工登录平台。

* 平台 = SP / RP
* 企业 = IdP / OP
* 平台获取身份，不获取业务系统权限

## 模式 B：平台作为安全代理访问下游系统

适合 Agent 代操作业务系统。

* 平台 = controlled proxy / executor
* 下游 = SaaS API / internal API / legacy app
* 平台自己负责委托和审计

## 模式 C：平台作为身份中介 / federation broker

适合多 IdP、多 BU、多租户。

* 平台统一接多个 IdP
* 内部生成统一 principal model
* 对内只暴露一个委托接口

企业级产品通常最后都会走到 C。



# 十五、你需要新增的核心组件

在原来的 8 个组件基础上，再加这些：

## 1. Federation Gateway

处理 SAML/OIDC/Kerberos 等企业认证接入。

## 2. Internal STS

负责 token exchange、capability issuance、proof binding。

## 3. Identity Graph / Entitlement Service

整合 SCIM、目录、HR、RBAC、ABAC。SCIM 是标准化同步入口之一。([RFC Editor][4])

## 4. Session Assurance Evaluator

把 MFA、device、network、recent auth 等统一算成 assurance level。

## 5. Legacy Connector Sandbox

专门承接老系统，不把老式会话票据扩散到平台其他部分。



# 十六、建议的数据模型升级

## principal_session

```sql
session_id
tenant_id
principal_id
auth_source
auth_protocol
authn_context
mfa_state
device_trust
network_zone
assurance_level
created_at
expires_at
revoked_at
```

## delegated_grant

```sql
grant_id
tenant_id
principal_id
agent_id
actor_type
connector
allowed_actions
resource_constraints
approval_id
policy_id
proof_binding_type
issued_at
expires_at
status
```

## external_credential

```sql
credential_id
tenant_id
principal_id
provider
credential_type -- oauth_token / saml_artifact / exchanged_token / cert_ref / service_cred
encrypted_secret
encrypted_aux_data
kms_key_ref
version
status
```

## entitlement_edge

```sql
tenant_id
subject_type   -- user/group/service
subject_id
relation       -- member_of / owns / approves / administers
object_type
object_id
source_system
valid_from
valid_to
```



# 十七、一个更合理的执行链路

## 员工先登录

企业 IdP 通过 SAML 或 OIDC 让员工登录平台。OIDC提供身份 claims；SAML 使用 assertion 与元数据机制。([OpenID Foundation][1])

## 平台归一化身份

平台生成 `principal_session`。

## Agent 发起请求

比如：

* “帮我给团队排会”
* “帮我读取审批状态”

## Gateway 校验

检查：

* 用户是否允许这个 agent
* 是否具备相应组/角色
* 当前 assurance 是否满足要求
* 是否需要审批

## STS 发短期 grant

生成只允许：

* calendar.read_freebusy
* calendar.create_event

的短期 capability。

## Connector Runtime 执行

必要时：

* 使用存于 Vault 的 OAuth token
* 或代走内部代理访问 SAML/Kerberos 老系统
* 或做 token exchange

## 返回脱敏结果

Agent 只得到业务结果，不得到凭证。



# 十八、最关键的一条架构变化

原来你的边界是：

**“不让 AI 拿 OAuth token。”**

扩展后边界要升级成：

## **“不让 AI 拿任何可重放的企业认证材料或高价值会话材料。”**

这包括：

* access token
* refresh token
* ID token
* SAML assertion
* session cookie
* Kerberos ticket
* API key
* 证书私钥
* service account secret

Agent 只能拿：

* opaque handle
* scoped grant
* approval reference
* redacted result



# 十九、推荐的总体定位

把产品重新定义为：

## **Enterprise Identity Broker + Delegation STS + Controlled Execution Gateway**

它的职责不是“支持更多登录协议”，而是：

1. **吸收企业各种认证协议**
2. **统一成内部身份与权限图**
3. **签发最小权限的短期委托能力**
4. **由受控执行层代调用系统**
5. **让 AI 始终处于无凭证区**



# 二十、最实用的落地顺序

我建议按这个顺序做：

## 第一阶段

* 保留现有 OAuth Vault
* 增加企业 OIDC 登录
* 增加 SAML SP / Federation Gateway
* 引入内部 principal session 模型

## 第二阶段

* 上 Internal STS
* 做 token exchange / capability grant
* 所有 connector 改成只吃内部 grant

## 第三阶段

* 接 SCIM / 企业目录
* 上 entitlement graph
* 策略改成 ABAC + 组/部门/环境维度

## 第四阶段

* 接老系统代理层
* 支持 Kerberos / session bridging / legacy connectors
* 强化 mTLS / proof-of-possession


[1]: https://openid.net/specs/openid-connect-core-1_0.html?utm_source=chatgpt.com "OpenID Connect Core 1.0 incorporating errata set 2"
[2]: https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.pdf?utm_source=chatgpt.com "Security Assertion Markup Language (SAML) V2.0 ..."
[3]: https://www.rfc-editor.org/rfc/rfc8693.html?utm_source=chatgpt.com "RFC 8693: OAuth 2.0 Token Exchange"
[4]: https://www.rfc-editor.org/rfc/rfc7644.html?utm_source=chatgpt.com "RFC 7644: System for Cross-domain Identity Management"
[5]: https://www.rfc-editor.org/search/rfc_search_detail.php?page=All&title=OAuth&utm_source=chatgpt.com "OAuth"
[6]: https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf?utm_source=chatgpt.com "SAML V2.0 - Assertions and Protocols for the OASIS Security ..."
[7]: https://docs.oasis-open.org/security/saml/v2.0/saml-authn-context-2.0-os.pdf?utm_source=chatgpt.com "Authentication Context for the OASIS Security Assertion ..."
