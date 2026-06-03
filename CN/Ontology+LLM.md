# 从知识图谱到治理控制面：Ontology + LLM 增量构建模式在 AI Agent Governance & Compliance 中的架构设计

> 本文提出一种将 Operational Ontology、LLM 增量知识编译与 Policy-as-Code 相结合的企业 AI Agent Governance 架构模式。
> 其核心思想不是让 LLM 自动治理企业 AI Agent，而是建立一条可审计、可测试、可演化的治理编译链：
> LLM 将政策、能力边界、资产、审批规则和运行事件编译为可审核的语义主张；人类批准关键判断；契约层将批准后的约束、控制项和证据要求编译为策略、动作和审批流程；治理控制面在 agent 注册、操作执行、数据访问、外部调用和持续监控等关键路径上执行这些契约。

---

## 1. 问题：为什么 AI Governance & Compliance 如此之难

企业 AI Agent 治理的根本困难在于：**治理规则是模糊、演化、跨域的，但 agent 行为合规要求精确、可审计、可强制**。

在进入具体问题之前，需要先区分两个经常被混用、但并不等价的概念。

### 1.0 AI Governance vs AI Compliance

可以用一句话概括二者关系：

> **Governance 是“做正确的事”的框架，Compliance 是“按规定做事”的执行。**

二者紧密相关，但本质不同。

| 维度 | AI Governance | AI Compliance |
| ---- | ------------- | ------------- |
| **本质** | 战略性框架与决策机制 | 对规则、法规和标准的遵守与验证 |
| **驱动力** | 内部价值观、风险管理、商业目标 | 外部法规、行业标准、合同要求 |
| **视角** | 主动、前置 | 响应式、验证导向 |
| **范围** | 更宽，覆盖 agent 的注册、授权、运行、审批和退役 | 更窄，针对特定规则、标准、合同或企业控制要求 |
| **负责方** | 董事会、高管、治理委员会、业务和技术负责人 | 法务、合规、风控、审计团队 |
| **产出** | 原则、边界、风险分级、问责机制 | 证据、审批记录、审计结果、备案材料 |

二者的关系不是并列，而是包含关系：

```text
Governance（治理）
  ├── 设定原则、风险偏好和责任边界
  ├── 包含 Compliance 作为可验证、可审计的执行支柱
  └── 超出合规：覆盖“法规尚未要求但组织仍应去做”的事项

Compliance（合规）
  ├── Governance 框架落地的最低可验证部分
  ├── 可量化、可检查、可审计
  └── 是 Governance 的必要但非充分条件
```

这一区分非常关键。只做 Compliance，组织往往只能达到“法定最低标准”；只做 Governance，不把原则编译为可执行、可审计的控制，又会停留在文件层。本文要解决的，不是二选一，而是建立一条从 Governance 意图到 Compliance 执行的治理编译链。

在实践中，这种困难体现为五类断裂。

### 1.1 语义断裂

同一个 agent 治理概念，在不同组织、系统和控制点里往往不是同一个东西。

例如，“允许 agent 发邮件”“允许 agent 代表用户执行操作”“允许 agent 调用外部支付接口”这些说法，在业务、工程、安全和合规视角下含义并不一致：

* 业务关注的是 agent 是否完成任务；
* 工程关注的是 agent 是否具备对应 tool / capability；
* 安全关注的是是否越权、是否能外联、是否能写敏感数据；
* 合规关注的是是否需要审批、是否需要留痕、是否需要用户授权。

一个企业治理系统不能简单把这些来源合并成一个扁平规则库，而必须区分：

* 哪些是企业级禁止动作；
* 哪些是需要人工审批的高影响动作；
* 哪些是 capability 绑定规则；
* 哪些是供应商 agent 的额外限制；
* 哪些是数据访问边界；
* 哪些只是运行期异常、事故或用户投诉。

因此，agent 治理中的语义对齐，不是给“AI”找几个同义词，而是对 **agent、capability、action、approval、evidence 和 responsibility** 做统一建模。

### 1.2 证据断裂

企业里的 agent 合规，不是“写了规则”就够了，还必须证明某个 agent 在某个时间点、在某个上下文中，是否按规则执行了动作。

“这个 agent 只能读不能写”“这个 agent 的外发邮件都有人审”“这个 agent 不会访问客户付款信息”这些说法本身都不是充分证据。它们必须绑定到具体的 agent、具体 capability、具体 action、具体审批记录、具体 trace 和具体时间窗口。

如果证据没有作用域，就会出现典型问题：

* 一个旧审批被错误复用到新的高风险操作；
* 一次针对只读权限的授权被误用到写操作；
* agent 的一次真实 tool call 没有被审计记录到；
* 第三方 agent 的 capability 声明被当成内部验证结论使用。

因此，AI Agent Governance 系统必须把 **execution evidence** 作为一等对象，而不是把日志和审批截图当作附件。

### 1.3 执行断裂

治理原则通常写在 PDF、Wiki 或 Excel 中，但实际系统执行路径在 agent 注册、tool 调用、数据访问、权限管理、外部 API 调用、监控平台和审批系统中。

如果这条规则只存在于政策文档中，那么系统层面没有任何强制力。工程团队可能忘记、绕过、误解，或者在影子 AI 项目中完全不经过治理流程。

用 Governance vs Compliance 的视角看，执行断裂的根因并不是“企业缺少规则”，而是：

> **Governance 声明与 Compliance 门禁是不同层级的对象，但大多数企业没有建立从前者到后者的编译层。**

例如：

> 所有具备外部副作用的 AI Agent，在执行支付、外发通信或数据写入前，必须完成 capability 校验，并在高影响场景下经过人工审批。

这首先是一条 **Governance 声明**，它表达“组织认为应该做什么”。但要让它在系统里产生约束力，必须经过至少三个阶段的技术编译。

#### 阶段 A：语义解析

LLM Agent 将自然语言声明编译为结构化约束、控制项和证据要求。

```text
AgentRule:
  obligation_text: "具备外部支付能力的 agent 不得在无人审情况下执行退款"
  obligated_actor_role: INTERNAL_OPERATOR
  applies_to_condition:
    action.category == "external_payment"
  required_controls:
    - HUMAN_APPROVAL
  required_evidence:
    - APPROVAL_RECORD

EnforcementControl:
  control_type: HUMAN_APPROVAL
  enforcement_mode: AUTOMATED
  frequency: EVENT_TRIGGERED
  required_evidence:
    - APPROVAL_RECORD

Relation:
  obligation_requires_control(obl-001 -> ctrl-human-approval)
```

此时系统不再只有一条“政策句子”，而是得到可遍历、可引用、可版本化的语义对象。

#### 阶段 B：契约编译

结构化义务进一步编译为可执行的 Compliance 规则，而不是停留在图谱层。

一部分义务被编译为 **Policy Contract**：

```go
// 示例：治理控制被编译为可执行的 compliance control
var governanceControls = map[string]EvaluatorFunc{
    "evidence_must_be_valid": func(req Request) []Finding {
        // 1. 解析 obligation -> control -> evidence 依赖链
        // 2. 检查 evidence.status == VALIDATED
        // 3. 检查 evidence.scope 覆盖当前 agent / action / execution_context
        // 4. 检查 validity_period 和 review_due_date
        // 5. 任一失败 => block / require_evidence
    },
    "approval_required_for_sensitive_action": func(req Request) []Finding {
        // 1. 查找 ACCEPTED 的 action_requires_approval ActionClaim
        // 2. 检查对应 ApprovalTask 是否完成
        // 3. 缺失 => require_approval
    },
}
```

另一部分被编译为 **Approval Contract**，用于驱动审批工作流：

```json
{
  "name": "sensitive-agent-action-approval",
  "initialState": "pending_operator_owner",
  "states": {
    "pending_operator_owner": {"name": "operator_owner_approval"},
    "pending_compliance_officer": {"name": "compliance_officer_approval"},
    "approved": {"name": "approved"}
  },
  "transitions": [
    {"from": "pending_operator_owner", "to": "pending_compliance_officer", "event": "approved"},
    {"from": "pending_compliance_officer", "to": "approved", "event": "approved"}
  ]
}
```

此时，Governance 声明才第一次被转化为系统真正可以执行的 Compliance 机制。

#### 阶段 C：控制面强制执行

最后，契约必须接入关键控制点，而不是只在后台“可查询”。

```text
Action Execution Gate:
  - 收到 agent action 请求
  - 读取 accepted claim / applicable obligations / evidence status
  - 执行 Policy Contract
  - 决策为 DENY / REQUIRE_APPROVAL / REQUIRE_EVIDENCE / ALLOW

Approval Workflow:
  - 如果 require_approval，则创建结构化 ApprovalTask
  - 审批人通过显式 event 推动状态机前进

Audit Trail:
  - 记录 claim 创建、claim 批准、策略评估、审批决策、动作执行
  - 形成可回放、可追责的执行链
```

因此，真正的治理系统必须把规则接入关键控制点：

* agent 注册；
* 高影响操作审批；
* 数据访问；
* tool 调用；
* 监控告警；
* 供应商接入；
* 变更管理。

执行断裂的本质，不是“原则写得不够多”，而是 **Governance 声明没有被编译为可机读、可执行、可审计的 Compliance 契约**。本文后续提出的 `Semantic Graph → Contract Layer → Governance Control Plane`，本质上就是为了填补这条编译链。

### 1.4 演化断裂

组织的 agent 使用政策、能力边界、供应商约束和技术实现都在变化。

一个原本只读的 agent，今年可能因为接入了写接口、外部邮件能力或支付能力而触发新的义务。一个原本有效的审批策略，也可能因为 capability 变化、供应商变更或组织政策更新而失效。

静态合规方案无法跟上这种变化。治理系统需要支持：

* 政策版本更新；
* 规范来源取代关系；
* 义务生效日期；
* 证据有效期；
* 历史时间点回放；
* 变更影响分析；
* 控制项回归测试。

### 1.5 责任断裂

AI Governance 不是纯技术问题。不同判断需要不同责任主体：

* agent 业务用途由业务 owner 确认；
* capability 与 tool scope 由工程 owner 和安全 owner 确认；
* 敏感动作是否需要审批由合规或风险团队确认；
* 数据访问边界由 data owner 或 DPO 确认；
* 伦理灰区或高影响自动化由治理委员会确认；
* 外部副作用与回滚路径由工程 owner 确认可执行性。

如果所有判断都被写成“LLM 推断”或“系统自动分类”，那么系统会缺少责任链，无法经受审计。

因此，我们需要的不是一个“会回答合规问题的知识库”，而是一个能将政策、capability、agent、证据、审批和执行连接起来的**治理控制面**。

---

## 2. 两个可借鉴的范式

本文借鉴两个方向：Operational Ontology 的可执行语义建模，以及 LLM 增量知识编译的持续维护模式。

### 2.1 Operational Ontology：把业务语义变成可执行控制面

Palantir Ontology 代表了一类重要思想：企业语义模型不只是查询层或报表层，而是运营系统的中间层。

可以将这类 Operational Ontology 的工程价值抽象为四个维度：

```text
Data × Logic × Action × Security
```

* **Data**：将分散数据源抽象为业务对象、属性和关系；
* **Logic**：将规则、模型、计算函数绑定到业务对象；
* **Action**：将带副作用的操作建模为受控入口；
* **Security**：将权限、审计和访问控制嵌入执行路径。

这种范式的优势在于：语义对象不只是被读取，还能被操作；规则不只是被解释，还能触发流程；权限不是应用层补丁，而是执行时的一等约束。

但它也有局限。平台型 Ontology 通常需要较重的数据建模、流程改造和实施服务；本体结构往往由专家和工程团队自顶向下设计，面对快速演化的 AI 法规和治理实践时，变更成本较高。

### 2.2 LLM 增量知识编译：把维护成本从查询时前移到摄入时

Karpathy 的 LLM Wiki 提出了一种与传统 RAG 不同的知识管理思路：不在每次查询时临时检索、拼接和综合信息，而是在新来源进入时，由 LLM 将信息增量编译进一个持久化知识结构。

这个模式的关键价值不是 Markdown，也不是个人 Wiki，而是三个机制：

* **Ingest**：新来源进入时，LLM 提取信息、更新概念、补充证据和关系；
* **Query as contribution**：好的查询结果可以沉淀回知识库；
* **Lint**：定期检查矛盾、过时、重复、孤立和覆盖盲区。

这种模式降低了重复检索、重复摘要和重复综合的成本，使知识在摄入阶段形成可维护的中间表示。

但它不能直接用于企业合规。原因包括：

* 它不是经过企业合规场景验证的治理框架；
* Markdown 不适合作为可执行合规系统的载体；
* 它缺少权限、证据链、审批流、回归测试和审计保全；
* 企业合规知识不是越积累越好，而是必须区分有效、失效、适用、不适用、被取代、待审核和被拒绝。

在企业场景中，LLM 增量构建的价值不是“自动形成真理”，而是**持续提出可审核的结构化变更建议**。

### 2.3 核心洞见：借鉴模式，替换载体，限制权限

本文借鉴 LLM Wiki 的模式，但替换其载体，并严格限制 LLM 权限。

| LLM Wiki 模式   | 企业治理场景中的替换                  |
| ------------- | --------------------------- |
| Markdown 知识文件 | 结构化治理图谱                     |
| 概念链接          | 类型化关系                       |
| Query 结果沉淀    | ActionClaim / AuditEvidence / Case 回流  |
| log.md        | 防篡改事件日志                     |
| LLM 直接编辑内容    | LLM 通过 API 创建 PROPOSED 状态变更 |
| 知识持续积累        | 受控演化、清退、版本治理和回归测试           |

关键原则是：

> LLM 是 proposal engine，不是 authority engine。

LLM 可以提取、归纳、匹配、建议和生成草案，但不能直接赋予法律结论、不能直接改变生产系统状态、不能绕过人工批准触发高影响副作用。

---

## 3. 总体架构：Semantic Graph → Contract Layer → Governance Control Plane

本文提出的架构分为三层：

```text
Sources
  ↓
Semantic Governance Graph
  ↓
Contract & Policy Layer
  ↓
Governance Control Plane
```

### 3.1 架构概览

```text
┌──────────────────────────────────────────────────────────┐
│                        Sources                           │
│                                                          │
│  企业政策：Enterprise Agent Policy                         │
│  平台约束：Capability bindings / tool policies             │
│  组织规则：approval chain / escalation / audit retention   │
│  企业资产：agent inventory / tool registry / data scopes   │
│  证据制品：approval records / audit logs / capability refs │
│  事件：tool call / incident / user complaint               │
└────────────────────────────┬─────────────────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────┐
│              Semantic Governance Graph                   │
│              受控演化，LLM 辅助维护                         │
│                                                          │
│  Policy Concepts · Action Claims · Agent Rules · Enforcement Controls · Audit Evidence │
│  Agents · Config Versions · Capability Scopes · Executions│
│  Jurisdictions · Temporal Validity · Source Authority     │
│                                                          │
│  LLM 只能创建 PROPOSED 变更                               │
│  高影响 ActionClaim / AgentRule / EnforcementControl 必须人工审核 │
│  所有变更进入防篡改 Event Log                              │
└────────────────────────────┬─────────────────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────┐
│              Contract & Policy Layer                     │
│              稳定、版本化、可测试                           │
│                                                          │
│  Policy Contracts                                         │
│    ALLOW / DENY / REQUIRE_APPROVAL / REQUIRE_EVIDENCE     │
│                                                          │
│  Action Contracts                                         │
│    输入输出 · 副作用 · 幂等性 · 补偿事务 · 回滚策略          │
│                                                          │
│  Approval Contracts                                       │
│    审批链 · 超时上报 · 条件批准 · 补证流程                  │
│                                                          │
│  Regression Tests                                         │
│    历史案例回放 · 证据测试 · blast-radius analysis          │
└────────────────────────────┬─────────────────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────┐
│              Governance Control Plane                    │
│              关键路径上的强制控制点                         │
│                                                          │
│  Agent Registration Gate                                  │
│  Action Execution Gate                                    │
│  Data Access Gate                                         │
│  Human Approval Workflow                                  │
│  Tamper-evident Audit Log                                 │
│  Post-market Monitoring                                   │
│  Writeback Adapters                                       │
└──────────────────────────────────────────────────────────┘
```

### 3.2 设计原则

1. **语义层受控演化**
   语义层可以持续吸收法规、政策、资产和事件，但核心概念、义务、控制项和高影响主张必须经过审核、版本化和回归测试。

2. **LLM 只提案，不授权**
   LLM 只能创建 `PROPOSED` 状态的 ActionClaim、AgentRule 或 Contract 草案。只有被授权角色批准后，相关对象才能进入可执行路径。

3. **契约层是唯一受控通道**
   从语义判断到系统副作用，必须经过 Contract & Policy Layer。任何 Action 都必须有输入 schema、权限要求、副作用声明、审计策略和失败处理语义。

4. **控制面覆盖关键路径，而非宣称绝对不可绕过**
   企业总有旁路系统、影子 AI、供应商工具和手工流程。治理系统的价值取决于控制面覆盖率，而不是口头宣称“不可绕过”。

5. **证据与时间是一等对象**
   所有合规判断必须带有证据、作用域、有效期、管辖区和历史可追溯性。

6. **治理与合规分层编译**
   Governance 负责定义原则、边界、风险偏好和责任结构；Compliance 负责把这些要求编译为可验证、可测试、可审计的契约。只有进入 Contract & Policy Layer 的要求，才能进入控制面执行。

### 3.3 基于 LTBase / LTFlow 的落地映射

如果以当前 LTBase 基础设施作为落地底座，三层架构可以映射为：

```text
Semantic Governance Graph
  -> ltbase.api/internal/semantic
  -> PostgreSQL semantic_resource / semantic_relation
  -> Forma schema + entity storage

Contract & Policy Layer
  -> compliance_evaluator / compliance_profile
  -> planning_service / planning_types
  -> LTFlow workflow definitions

Governance Control Plane
  -> ltbase.api HTTP handlers + tool registry
  -> LTFlow runtime + task/history APIs
  -> ltbase-controlplane-ui
  -> DynamoDB audit records + external write-back adapters
```

这意味着本文并不要求一开始就引入新的图数据库、策略引擎或 BPM 平台。一个更现实的路径是：优先复用 LTBase 已有的语义层、合规评估器、工作流引擎和控制台能力，再针对 AI Governance 特有需求做增量扩展。

但这也意味着实现方案必须接受 LTBase 当前的边界条件：

* 运营图谱主存储更适合采用 **PostgreSQL + Forma 混合模式**，而不是专门图数据库；
* Policy 决策初期更适合建立在现有 compliance evaluator 之上，而不是立即引入新的 policy engine；
* 审批流优先使用 LTFlow 状态机，而不是引入 Temporal/Camunda 类系统；
* 治理控制面 UI 初期更适合扩展现有 control plane，而不是建设独立治理产品前端。

下文会在每一层分别指出 LTBase/LTFlow 当前可覆盖的能力，以及尚未覆盖或仍不够优化的能力缺口。

---

## 4. 语义层：以 agent 控制链为中心的治理图谱

### 4.1 来源权威模型

不同规范来源不应被简单线性排序。更合理的是多维权威模型。

```text
SourceAuthority:
  legal_force:
    BINDING | CONTRACTUAL | CERTIFICATION_REQUIRED | ADVISORY | INTERNAL

  issuer_authority:
    LEGISLATOR | REGULATOR | STANDARD_BODY | COMPANY | VENDOR | USER

  jurisdiction_scope:
    EU | US | UK | GLOBAL | INTERNAL | CUSTOM

  enforcement_risk:
    HIGH | MEDIUM | LOW

  effective_date:
    date

  expiry_date:
    date?

  supersession_chain:
    SourceRef[]
```

这样可以表达更复杂的现实情况：

* 法规具有法律约束力；
* 监管指南可能没有硬法效力，但具有执法预期意义；
* 内部政策可能比外部标准更严格；
* 合同义务可能对特定客户或供应商关系具有强制力；
* 旧版本政策可能被新版本取代。

因此，系统不应硬编码“法规 > 指南 > 标准 > 内部政策 > 用户报告”这样的简单排序，而应通过策略函数计算来源权重和适用性。

### 4.2 核心对象模型

治理图谱的核心链条是：

```text
Source → AgentRule → EnforcementControl → AuditEvidence → ActionClaim → Policy / Action
```

#### 4.2.1 GovernancePolicySource

```text
GovernancePolicySource:
  id: UUID
  name: string
  source_type:
    INTERNAL_POLICY | CONTRACT | STANDARD_OPERATING_RULE |
    VENDOR_REQUIREMENT | CASE_RECORD | USER_REPORT

  authority: SourceAuthority
  jurisdiction: string[]
  effective_date: date
  expiry_date: date?
  supersedes: SourceRef?
  canonical_uri: string?
  source_hash: string
```

#### 4.2.2 PolicyConcept

```text
PolicyConcept:
  id: UUID
  name: string
  canonical_definition: text
  organization_interpretation: text?
  source_refs: SourceRef[]
  status:
    DRAFT | ACTIVE | DEPRECATED | CONFLICT | FROZEN

  valid_from: timestamp
  valid_until: timestamp?
  semantic_version: string
```

核心治理概念的 `canonical_definition` 不应由 LLM 自由改写。LLM 可以提出 `organization_interpretation` 的变更草案，但必须保留来源绑定和 semantic diff。

#### 4.2.3 ActionClaim

ActionClaim 是本文架构的关键对象。在 agent 治理系统中，很多内容不是静态事实，而是带来源、适用范围、证据和责任人的判断。

```text
ActionClaim:
  id: UUID

  claim_type:
    FACTUAL |
    LEGAL_INTERPRETATION |
    ACTION_CLASSIFICATION |
    CONTROL_DECISION |
    EVIDENCE_ASSESSMENT

  subject: ObjectRef
  predicate: string
  object: ObjectRef | literal

  authority_level:
    LLM_INFERRED |
    SME_REVIEWED |
    COMPLIANCE_APPROVED |
    LEGAL_APPROVED |
    BOARD_APPROVED

  status:
    PROPOSED | ACCEPTED | REJECTED | SUPERSEDED | EXPIRED

  jurisdiction: string[]
  confidence: float
  evidence_refs: EvidenceRef[]
  reasoning: text

  approved_by_role:
    DataOwner | SystemOwner | ComplianceOfficer |
    LegalCounsel | DPO | EthicsBoard | SecurityOwner

  approval_basis: EvidenceRef[]
  decision_record: ApprovalTaskRef?

  valid_from: timestamp
  valid_until: timestamp?
  transaction_time: timestamp
```

示例：

```text
ActionClaim:
  claim_type: ACTION_CLASSIFICATION
  subject: AgentRefundAssistant
  predicate: action_requires_approval
  object: external_payment_refund
  jurisdiction: ["INTERNAL"]
  authority_level: LLM_INFERRED
  status: PROPOSED
  evidence_refs:
    - capability/payment_write
    - tool/refund_api
  reasoning:
    "该 agent 具备支付写能力，且动作带外部财务副作用，应进入人工审批路径。"
```

LLM 可以创建该 ActionClaim，但不能让它直接触发生产副作用。只有 `status=ACCEPTED` 且达到所需 `authority_level` 的 ActionClaim，才能被契约层引用。

#### 4.2.4 AgentRule

义务必须绑定到主体角色，而不只是绑定到系统。

```text
AgentRule:
  id: UUID

  source: SourceRef
  obligation_text: text

  obligated_actor_role:
    PROVIDER |
    DEPLOYER |
    IMPORTER |
    DISTRIBUTOR |
    PRODUCT_MANUFACTURER |
    AUTHORIZED_REPRESENTATIVE |
    INTERNAL_OPERATOR

  applies_to_system_condition: Condition
  applies_to_use_case_condition: Condition
  obligation_trigger: Condition

  jurisdiction: string[]
  applicability_phase: string
  effective_date: date
  expiry_date: date?

  required_controls: ControlRef[]
  required_evidence: EvidenceType[]
```

同一个 agent 或 AI-based system，在不同执行上下文和责任角色下义务可能不同。企业作为内部 operator、vendor manager 或平台 owner 时，控制项和证据要求都可能不同。

#### 4.2.5 EnforcementControl

```text
EnforcementControl:
  id: UUID
  name: string

  control_type:
    PRE_EXECUTION_REVIEW |
    CAPABILITY_BINDING |
    HUMAN_OVERSIGHT |
    LOGGING |
    DATA_GOVERNANCE |
    EXTERNAL_ACTION_REVIEW |
    RUNTIME_MONITORING |
    INCIDENT_RESPONSE

  owner: RoleRef
  frequency:
    ONCE | PERIODIC | CONTINUOUS | EVENT_TRIGGERED

  enforcement_mode:
    MANUAL | SEMI_AUTOMATED | AUTOMATED

  required_evidence: EvidenceType[]
  mapped_obligations: ObligationRef[]
```

#### 4.2.6 AuditEvidence

证据不是附件，而是可验证、可过期、可限定作用域的对象。在 agent 治理里，最重要的证据往往不是“模型报告”，而是审批记录、执行日志、tool 调用轨迹和 capability 绑定快照。

```text
AuditEvidence:
  id: UUID

  artifact_type:
    CAPABILITY_SNAPSHOT |
    APPROVAL_RECORD |
    TOOL_EXECUTION_LOG |
    MONITORING_REPORT |
    INCIDENT_REPORT |
    HUMAN_APPROVAL_NOTE

  evidence_status:
    SUBMITTED | VALIDATED | REJECTED | EXPIRED | SUPERSEDED

  evidence_quality:
    SELF_ASSERTED |
    SYSTEM_GENERATED |
    THIRD_PARTY_AUDITED |
    REGULATOR_ACCEPTED

  scope:
    system_id: string
    agent_version: string?
    action_id: string?
    execution_session: string?
    jurisdiction: string[]

  storage_ref: string
  hash: string
  signature: string?
  signed_by: string?
  reviewed_by: string?
  reviewed_at: timestamp?

  created_at: timestamp
  validity_period: duration?
  review_due_date: timestamp?

  retention_class: string
  contains_personal_data: boolean
  confidentiality_level: PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
```

这可以避免“有日志即合规”的误判。系统必须知道证据覆盖哪个 agent、哪个 action、哪个执行会话、哪个责任角色和哪个时间范围。

#### 4.2.7 核心对象之间的关系与生命周期

四个核心对象之间的基数关系如下：

```
Source (1) ──< (N) AgentRule (N) >── (N) EnforcementControl
                      │                        │
                      │ required_evidence      │ required_evidence
                      ▼                        ▼
                 AuditEvidence (N) ◄────────────┘
                      ▲
                      │ evidence_refs
                 ActionClaim (N)
```

- 一条 Source 可派生多条 AgentRule；
- 一条 AgentRule 可要求多条 EnforcementControl，一条 EnforcementControl 可满足多条 AgentRule（多对多）；
- 一条 ActionClaim 可引用多条 AuditEvidence，一条 AuditEvidence 可被多条 ActionClaim 引用；
- 一条 AgentRule 要求的 AuditEvidence 和 EnforcementControl 要求的 AuditEvidence 类型可能重叠，但不强制相等。

关键对象的状态转换规则：

| 对象 | 状态转换 | 触发条件 |
| ---- | -------- | -------- |
| ActionClaim | PROPOSED → ACCEPTED | 授权角色批准 |
| ActionClaim | PROPOSED → REJECTED | 授权角色拒绝 |
| ActionClaim | ACCEPTED → SUPERSEDED | 新 ActionClaim 覆盖旧事实 |
| ActionClaim | ACCEPTED → EXPIRED | valid_until 过期 |
| AuditEvidence | SUBMITTED → VALIDATED | 合规人员验证通过 |
| AuditEvidence | VALIDATED → EXPIRED | validity_period 过期或 review_due_date 逾限 |
| AuditEvidence | VALIDATED → SUPERSEDED | 新证据取代旧证据 |
| AgentRule | ACTIVE → DEPRECATED | 被新来源取代或明确废止 |
| AgentRule | ACTIVE → EXPIRED | expiry_date 过期 |

所有对象采用仅追加（append-only）模式——状态变更不可逆，历史版本通过 transaction_time 回溯。

### 4.3 Agent 资产与执行上下文模型

AI Agent Governance 不能只对抽象“系统”做判断。合规判断通常依赖具体 agent、配置版本、可用 capability、执行会话、目标资源和责任边界。

```text
RegisteredAgent:
  id: UUID
  name: string
  owner: RoleRef
  business_process: string?
  intended_purpose: text
  provider_type:
    INTERNAL | THIRD_PARTY | HYBRID
  lifecycle_stage:
    EXPERIMENTAL | DEVELOPMENT | VALIDATION | DEPLOYED | RETIRED

  trust_level:
    SANDBOXED | INTERNAL_APPROVED | PRIVILEGED | RESTRICTED

AgentConfigVersion:
  id: UUID
  agent_id: string
  version: string
  tool_refs: ToolRef[]
  capability_refs: CapabilityRef[]
  prompt_profile_ref: string?
  release_date: date

CapabilityScope:
  id: UUID
  name: string
  resource_types: string[]
  allowed_actions: string[]
  forbidden_actions: string[]
  requires_approval_for: string[]

AgentExecution:
  id: UUID
  agent_id: RegisteredAgentRef
  config_version: AgentConfigVersionRef
  environment:
    DEV | STAGING | PRODUCTION

  caller_identity: string
  target_resource: string?
  action_name: string
  started_at: timestamp
  trace_id: string

ExecutionContext:
  actor_type:
    USER | AGENT | SERVICE
  sensitivity:
    LOW | MEDIUM | HIGH | CRITICAL
  data_scope: string[]
  external_side_effect: boolean
  human_approval_required: boolean
```

### 4.4 时间语义模型

审计时经常要回答：

> 在某个时间点，这个 agent 请求执行某个动作时，我们当时知道什么？当时适用哪条规则？谁批准了什么？留下了哪些证据？

因此，所有关键节点和边都应支持双时间模型。

```text
Temporal Model:
  valid_time:
    事实或规则在现实世界中有效的时间区间

  transaction_time:
    系统记录该事实或规则的时间，不可修改

  effective_date:
    法规、政策、控制项或义务的生效时间

  review_due_date:
    证据、审批或控制项的复核截止时间
```

示例：

```text
ActionClaim:
  subject: AgentRefundAssistant
  predicate: action_requires_approval
  object: external_payment_refund
  valid_from: 2026-06-02
  transaction_time: 2026-06-02T14:23:17Z

AgentRule:
  source: Enterprise Agent Policy Section 4.2
  effective_date: <按具体政策版本填充>
  applicability_phase: SENSITIVE_ACTION_CONTROLS

AuditEvidence:
  artifact_type: APPROVAL_RECORD
  validity_period: 365d
  review_due_date: 2027-06-02
```

不要在架构示例中随意硬编码策略生效日期。真实系统应按具体政策条款、义务类别、主体角色和适用阶段建模。

上述时间语义模型的实现依赖于底层存储的选择。在确定存储方案时，需要综合考虑时间窗口查询效率、图遍历性能和跨组织互操作需求。

### 4.5 Property Graph 为主，RDF/SKOS/SHACL 为辅

本方案优先采用 Property Graph 作为运营时语义层，因为它更贴近企业对象建模、应用开发和运行时查询。

```text
内部运营：
  Property Graph
  - registered agent
  - agent config version
  - agent execution
  - claim
  - evidence
  - obligation
  - approval task
```

但法规语义、标准词表和跨组织交换天然需要 RDF、SKOS、SHACL 等生态能力。

```text
外部互操作：
  RDF / SKOS / SHACL
  - 标准词表
  - 概念层级
  - 约束校验
  - 跨组织交换
```

因此，推荐架构是：

```text
Property Graph 作为运营图谱
        ↕
语义映射层
        ↕
RDF / SKOS / SHACL 作为互操作边界
```

这避免了在工程友好性和语义标准化之间做非此即彼的选择。

如果基于 LTBase 落地，这里的“Property Graph”应优先理解为 **`semantic_resource` + `semantic_relation` + Forma entity payload** 的混合实现，而不是默认引入 Neo4j 或 Neptune。

推荐的存储职责拆分是：

```text
semantic_resource / semantic_relation:
  - 轻量节点与关系
  - 遍历、影响分析、覆盖率计算
  - 适合 Concepts / Claims / Obligations / Controls 的索引层

Forma entity:
  - 详细字段、版本化 payload、复杂 evidence scope
  - 适合 AuditEvidence / ExecutionContext / ApprovalTask / MonitoringSignal

外部互操作层（新增）:
  - RDF / SKOS / SHACL 导出与交换
```

这种设计能够最大化复用 LTBase 现有基础设施，但也存在明确缺口：

* `semantic_resource` 当前只有较少的 `ResourceKind` / `RelationKind`，需要为治理场景新增类型体系；
* PostgreSQL 语义层适合运营查询和有限遍历，但对复杂多跳法规推理、跨本体对齐和大规模路径分析并不是最优；
* LTBase 目前没有现成的 RDF/SKOS/SHACL 映射层，需要新增导入导出和约束校验模块。

### 4.6 LLM 操作接口

LLM 不直接编辑底层存储，而是通过结构化 API 操作治理图谱。API 负责 schema 校验、权限校验、来源追踪、一致性约束和状态机控制。

```go
type GovernanceService interface {
	CreateConceptProposal(ctx context.Context, req CreateConceptProposalRequest) (*PolicyConcept, error)
	CreateClaim(ctx context.Context, req CreateClaimRequest) (*ActionClaim, error)
	CreateAgentRuleProposal(ctx context.Context, req CreateAgentRuleProposalRequest) (*AgentRule, error)
	AttachEvidence(ctx context.Context, req AttachEvidenceRequest) (*AuditEvidence, error)
	FindApplicableAgentRules(ctx context.Context, req ApplicableAgentRulesRequest) ([]AgentRule, error)
	FindEvidenceGaps(ctx context.Context, req EvidenceGapRequest) ([]EvidenceGap, error)
	FindAcceptedClaims(ctx context.Context, subject, predicate string) ([]ActionClaim, error)
	FindExpiredEvidence(ctx context.Context) ([]AuditEvidence, error)
	FindUnreviewedClaims(ctx context.Context, olderThanDays int) ([]ActionClaim, error)
	FindObligationGaps(ctx context.Context) ([]ObligationGap, error)
	CheckContractSync(ctx context.Context) ([]SyncGap, error)
}

type CreateClaimTool struct {
	svc GovernanceService
}

func (t *CreateClaimTool) Name() string { return "governance_create_claim" }

func (t *CreateClaimTool) Execute(ctx context.Context, input json.RawMessage) (ToolResult, error) {
	var req CreateClaimRequest
	if err := json.Unmarshal(input, &req); err != nil {
		return ToolResult{}, err
	}
	claim, err := t.svc.CreateClaim(ctx, req)
	if err != nil {
		return ToolResult{}, err
	}
	return ToolResult{Output: claim}, nil
	// GovernanceService 在内部强制：
	// authority_level=LLM_INFERRED
	// status=PROPOSED
	// executable=false
}
```

关键点：LLM 仅负责提案，API 负责 schema、权限、来源和状态机约束的校验（详参 2.3 与 3.2 节）。高影响变更必须经过人工审核后，才能进入可执行路径。

如果基于 LTBase 落地，这一层更适合实现为 **LTAgent Tool + Go service API**，而不是让 LLM 直接操作数据库或自由编辑文档。也就是说，上述接口在工程上应映射为：

* LTAgent 中的治理专用 tool，例如 `create_claim`, `create_agent_rule_proposal`, `attach_evidence`；
* `ltbase.api` 中的 governance service，对 schema、权限、来源和状态流转做集中校验；
* LTFlow 的 `ltflow.llm` activity 用于驱动需要异步回调的长时推理或审批辅助步骤。

当前缺口包括：

* LTAgent 已有通用 agent/runtime，但没有开箱即用的 governance tool set；
* LTBase 现有 Gemini 集成可用，但“多 provider 抽象”还不是一等能力；
* 目前缺少专门针对法规摄入、citation 强校验、语义 diff 和 contradiction lint 的治理级 agent 管道。

---

## 5. Semantic Supply Chain Security

在企业 AI Governance 场景中，LLM 风险远不止幻觉。更重要的是语义供应链风险：

* 来源污染；
* 过期法规版本；
* Prompt injection；
* 低权威来源污染高权威概念；
* 错误主张被复用；
* 语义漂移；
* 错误契约被发布到控制面。

### 5.1 来源治理

```text
Source Governance:
  - source allowlist
  - source hash
  - issuer verification
  - jurisdiction tagging
  - effective date tracking
  - supersession detection
```

用户提交的事故报告可以进入 `CASE_RECORD` 或 `USER_REPORT` 层级，但不能直接修改法规概念或义务定义。

### 5.2 隔离区

LLM 新摄入内容默认进入隔离状态：

```text
status = PROPOSED
authority_level = LLM_INFERRED
executable = false
```

只有经过授权角色审核后，才能升级为：

```text
status = ACCEPTED
authority_level = COMPLIANCE_APPROVED | LEGAL_APPROVED | BOARD_APPROVED
```

### 5.3 Prompt Injection 防护

非结构化来源进入 LLM Agent 前应进行安全过滤：

```text
Ingestion Security:
  - prompt-injection scanning
  - instruction stripping
  - source segmentation
  - model output validation
  - citation requirement
```

任何无法追溯到来源的 ActionClaim 都不能进入 `ACCEPTED` 状态。

### 5.4 语义漂移控制

LLM 增量构建可能导致核心概念慢慢漂移。因此需要额外控制：

```text
Semantic Drift Controls:
  - canonical definition lock
  - semantic diff
  - source-bound sections
  - periodic re-grounding
  - contradiction budget
  - frozen state for high-conflict concepts
```

对于关键法规概念，系统应区分：

```text
canonical_definition:
  来自法规、标准或正式政策的原始语义摘要

organization_interpretation:
  企业内部解释、映射和控制实践
```

LLM 可以建议修改组织解释，但不应直接改写 canonical definition。

### 5.5 Governance Event Log：语义层的防篡改事件日志

本文区分两类防篡改日志：

- **Governance Event Log（治理事件日志）：** 记录语义层所有对象（ActionClaim、AgentRule、EnforcementControl、AuditEvidence）的创建、状态变更、批准和取代，面向「谁在什么时候对图谱做了什么」。
- **Execution Audit Log（执行审计日志，见 7.4 节）：** 记录控制面关键路径上的策略判断、审批决策、动作副作用和补偿动作，面向「系统在什么时候依据什么做出了什么决定」。

两者共享相同的防篡改机制（hash chain、WORM、signed timestamp），但服务于不同的审计用途：前者用于图谱可信度审计，后者用于执行合规审计。

语义层所有变更进入 Governance Event Log。

```text
EventLog Entry:
  event_id: evt-20260602-001
  type: CLAIM_CREATED
  target: claim/refund-assistant-v2-external-payment-refund
  actor: llm-agent-governance-v2
  timestamp: 2026-06-02T14:23:17Z
  transaction_time: 2026-06-02T14:23:17Z
  payload:
    subject: RefundAssistant_v2
    predicate: action_requires_approval
    object: external_payment_refund
    authority_level: LLM_INFERRED
    status: PROPOSED
  source_trigger: ingest/deploy-record/2026-06-02
  prev_hash: sha256:...
  signature: ...
```

事件日志采用：

```text
- append-only event store
- hash chain
- signed timestamp
- WORM storage / object lock
- independent access audit
```

目标不是绝对声称“不可篡改”，而是使任何事后修改都可被检测、追溯和审计。

基于 LTBase 落地时，可以把这层拆成两部分：

* **短中期可复用能力**：现有 DynamoDB `AuditRecord` 机制，已能记录 action、actor、resource、trace_id、input/output；
* **治理级增强能力**：新增 append-only governance event log，补上 hash chain、签名时间戳、对象锁/WORM 存储和独立访问审计。

也就是说，LTBase 当前已经具备“审计记录”的基础能力，但距离本文要求的 tamper-evident governance log 还有明显差距。至少还需要补：

* 前后记录 hash 链；
* 跨存储层的不可变保全策略；
* 独立于业务表的事件账本；
* 对审批、证据、主张状态变更的统一事件模型。

---

## 6. 契约层：Policy、Action 与 Approval 的三轨制

AI Governance 的执行核心不只是触发动作，还包括策略判断和审批流程。因此契约层拆分为三类：

```text
Contract & Policy Layer
  ├── Policy Contracts
  ├── Action Contracts
  └── Approval Contracts
```

### 6.1 Policy Contract：能不能做，缺什么证据

Policy Contract 回答：

* 是否允许；
* 是否阻断；
* 是否需要审批；
* 是否需要补充证据；
* 适用哪些义务；
* 需要哪些控制措施。

示例。*为简明起见，以下代码用字符串常量代表 ActionClaim 的 object 字段值；在实际实现中，应使用 ActionClaim 的语义 ID 引用并通过 findAcceptedClaims() 查询图谱，而非硬编码字符串字面量。*

```go
func EvaluateSensitiveAgentAction(req GovernancePolicyRequest) GovernancePolicyDecision {
	riskClaims := findAcceptedClaims(req.Agent.ID, "action_requires_approval")
	riskClaim := firstClaimObject(riskClaims)

	if riskClaim == "forbidden_external_action" {
		return GovernancePolicyDecision{Decision: "DENY"}
	}

	if riskClaim == "external_payment_refund" {
		requiredEvidence := []string{
			"APPROVAL_RECORD",
			"CAPABILITY_SNAPSHOT",
			"TOOL_EXECUTION_LOG",
		}
		if missing := findMissingEvidence(req.ExistingEvidence, requiredEvidence); len(missing) > 0 {
			return GovernancePolicyDecision{
				Decision:         "REQUIRE_EVIDENCE",
				EvidenceRequired: missing,
			}
		}
		if !req.ApprovalState.SensitiveActionApproved {
			return GovernancePolicyDecision{
				Decision:    "REQUIRE_APPROVAL",
				Obligations: []string{"human_approval", "execution_logging", "caller_accountability"},
			}
		}
	}

	return GovernancePolicyDecision{Decision: "ALLOW"}
}
```

关键安全边界：

> Policy Contract 只能引用已批准的 ActionClaim。`PROPOSED` 状态的 LLM 推断不得触发生产副作用。

如果基于 LTBase 落地，Policy Contract 最现实的载体不是单独引入 Rego/Cedar，而是先扩展现有 `compliance_evaluator.go` 与 `ComplianceProfile`：

```text
现有能力：
  - allow / warn / block 决策
  - 基于 control id 的评估器
  - 选择器与 profile 配置

治理扩展：
  - action_claim_must_be_accepted
  - audit_evidence_must_be_valid
  - agent_rule_must_be_current
  - approval_required_for_sensitive_action
  - required_evidence_present
```

当前缺口是：LTBase 现有 compliance engine 更像“控制检查器”，还不是完整的治理 policy runtime。要满足本文目标，还需要补：

* `REQUIRE_APPROVAL` / `REQUIRE_EVIDENCE` 这类中间决策语义；
* 对 agent_rule / audit_evidence / action_claim 的跨对象联动评估；
* 更强的 blast-radius analysis 和 policy regression 测试基座；
* 面向治理人员可维护的 contract authoring 体验，而不是只靠 Go 代码改 evaluator。

### 6.2 Action Contract：做什么，如何处理副作用

Action Contract 定义可执行动作，包括输入、输出、副作用、权限、幂等性、事务语义和补偿策略。

```go
type GovernanceActionContract struct {
	ID                string
	Version           string
	RequiredRoles     []string
	InputSchema       string
	TransactionModel  string
	IdempotencyFormat string
	Effects           []ActionEffect
	Compensations     []CompensationAction
}

var FlagSensitiveAgentActionContract = GovernanceActionContract{
	ID:                "flag-sensitive-agent-action",
	Version:           "1.3.0",
	RequiredRoles:     []string{"ComplianceOfficer", "RiskAnalyst"},
	InputSchema:       "ltbase.governance.flag_ai_risk.input",
	TransactionModel:  "SAGA",
	IdempotencyFormat: "action_id + system_id + claim_ref + version",
	Effects: []ActionEffect{
		{Type: "UPDATE", Target: "AgentExecution.status", Value: "UNDER_REVIEW"},
		{Type: "UPDATE", Target: "RegisteredAgent.last_sensitive_action"},
		{Type: "CREATE", Target: "ActionRiskRecord"},
		{Type: "START_WORKFLOW", Target: "sensitive-agent-action-approval"},
		{Type: "NOTIFY", Target: "role:ComplianceOfficer"},
		{Type: "APPEND_AUDIT", Target: "GovernanceAuditLog"},
	},
	Compensations: []CompensationAction{
		{Effect: "AgentExecution.status", Strategy: "RESTORE_PREVIOUS_STATUS"},
		{Effect: "ActionRiskRecord", Strategy: "MARK_RETRACTED"},
	},
}
```

重要工程现实：

> 对单一事务域内的状态变更可以使用 ACID；对跨系统副作用，例如 JIRA、Slack、CI/CD、IAM、agent registry 和 data catalog，应使用 Saga、幂等键、补偿动作和 outbox pattern 保证最终一致和可审计。

在 LTBase 体系下，Action Contract 更适合落到三类机制上：

* `planning_service` / `PlanStep`：决定某个动作是否应进入执行路径；
* tool registry：承载实际副作用调用；
* LTFlow：承载需要状态推进、补偿和人工参与的动作链。

当前缺口是：LTBase 已有 planning 和 tool execution，但还没有形成专门的 governance action contract runtime。特别是以下能力仍需增强：

* 标准化的副作用声明模型；
* 统一的 idempotency / outbox / compensation 框架；
* 对外部系统 write-back 的 reconciler 和 dead-letter 机制；
* 对 Action version 升级的兼容性与回滚流程。

### 6.3 Approval Contract：谁批准，如何批准

审批流程应独立建模，而不是塞进 Policy 或 Action 子字段中。

```go
approvalDef := ltflow.Definition{
	Name:         "sensitive-agent-action-approval",
	Version:      "v1",
	InitialState: "pending_agent_owner",
	States: map[string]ltflow.StateConfig{
		"pending_agent_owner":        {Name: "pending_agent_owner"},
		"pending_compliance_officer": {Name: "pending_compliance_officer"},
		"pending_security_owner":     {Name: "pending_security_owner"},
		"approved":                   {Name: "approved"},
		"rejected":                   {Name: "rejected"},
	},
	Transitions: []ltflow.Transition{
		{From: "pending_agent_owner", To: "pending_compliance_officer", Event: "approved"},
		{From: "pending_compliance_officer", To: "pending_security_owner", Event: "approved"},
		{From: "pending_security_owner", To: "approved", Event: "approved"},
		{From: "pending_agent_owner", To: "rejected", Event: "rejected"},
		{From: "pending_compliance_officer", To: "rejected", Event: "rejected"},
	},
	TerminalStates: map[string]ltflow.TerminalType{
		"approved": ltflow.TerminalSuccess,
		"rejected": ltflow.TerminalFailure,
	},
}
```

这种拆分让审批流程可以被多个 Policy 或 Action 复用，也让审批链变更不必强行修改 Action Contract。

这一层与 LTFlow 的匹配度很高。LTFlow 已经具备：

* 状态机定义；
* 条件判断与事件驱动迁移；
* task / history 模型；
* 幂等启动与回放读取。

因此，Approval Contract 最适合优先落在 LTFlow 上。

但也必须看到当前缺口：

* LTFlow 当前更偏单实例状态机，不是完整的人审工作流产品；
* 多审批人 quorum、并行会签、代理审批、动态加签等高级能力需要补；
* 治理审批所需的 evidence panel、blast radius 视图、precedent 对比目前不在 LTFlow 内，需要 control plane UI 侧补齐；
* SLA、超时升级、工作负载均衡与审计保全还需要治理级封装。

### 6.4 契约回归测试

契约变更必须经过测试，而不是直接发布。

```text
Contract Regression Suite:

1. Historical case replay
   用历史 AI 系统和审批案例重放新策略。

2. Golden set tests
   使用人工标注的高风险、低风险、禁止类样例。

3. Agent rule coverage tests
   检查每条高优先级 agent rule 是否映射到至少一个 enforcement control。

4. Audit evidence requirement tests
   检查敏感动作是否要求正确证据。

5. Negative tests
   验证缺少 ActionClaim、缺少 AuditEvidence、ActionClaim 未批准时不得触发 Action。

6. Blast-radius tests
   评估新契约会影响多少 agent、业务线和执行路径。

7. Policy monotonicity tests
   更高风险等级不能获得更宽松的策略结果。
```

尤其必须保证：

```text
PROPOSED ActionClaim → 不得触发 Action
EXPIRED AuditEvidence → 不得满足 evidence requirement
SUPERSEDED AgentRule → 不得继续作为当前义务执行
```

### 6.5 版本策略

| 变更类型   | 版本变化          | 要求                    |
| ------ | ------------- | --------------------- |
| 文案修复   | patch         | 无迁移                   |
| 新增可选参数 | minor         | 回归测试                  |
| 新增证据要求 | minor 或 major | blast-radius analysis |
| 修改触发条件 | minor 或 major | 历史案例回放                |
| 修改副作用  | major         | 迁移计划与人工审核             |
| 修改审批链  | minor 或 major | 责任边界审核                |

---

## 7. Governance Control Plane

治理控制面不是一个孤立引擎，而是在企业 AI Agent 生命周期和执行路径上的一组受控关卡。

### 7.1 控制面覆盖率

治理系统不能宣称绝对不可绕过。它应该持续度量覆盖率：

```text
Control Plane Coverage =
  受治理控制面强制管控的 agent、执行路径和数据访问路径
  /
  企业实际 agent、执行路径和数据访问路径
```

控制面覆盖的关键路径包括：

```text
Agent Registration Gate:
  agent 注册或 capability 变更时检查能力边界、责任人和初始约束。

Action Execution Gate:
  执行动作前执行 Policy Contract，检查 capability、审批和证据。

Data Access Gate:
  agent 读取或写入敏感数据前检查数据类别、用途和责任边界。

Procurement Gate:
  第三方 agent 或 agent 平台接入前检查供应商能力声明、审计能力和合同约束。

Human Approval Workflow:
  创建结构化审批任务，附带证据链、义务、控制项和影响范围。

Tamper-evident Audit Log:
  记录每次判断、审批、策略结果和副作用。

Post-market Monitoring:
  对 agent 的运行行为进行持续监控，发现异常操作、投诉和事故后触发重新评估。
```

对 LTBase 而言，控制面并不是一个全新系统，而更像是对现有 control plane 的治理化扩展：

* `ltbase.api` 提供 gate API 和治理写入入口；
* `planning_service` 提供动作前置判断；
* LTFlow 提供审批与长事务编排；
* `ltbase-controlplane-ui` 提供治理工作台；
* `ltbase-ts` 为外部控制台和脚本提供治理 API SDK。

当前缺口主要有：

* LTBase 还没有原生的 registered agent inventory / capability registry 领域模型；
* Data Access Gate 与 Procurement Gate 目前没有现成的治理控制点实现；
* Security & Compliance 工作区在 UI 中仍然是占位，缺少治理态势、审批面板和证据缺口视图；
* 控制面覆盖率目前还缺少系统性度量与报表。

### 7.2 Action Engine

```go
type GovernanceActionEngine struct {
	authz    AuthorizationService
	policy   GovernancePolicyService
	workflow *ltflow.Client
	audit    AuditRecorder
	tools    ToolExecutor
}

func (e *GovernanceActionEngine) Execute(ctx context.Context, actionID string, input GovernanceActionInput, caller Caller) (any, error) {
	contract := loadGovernanceContract(actionID)
	if err := e.authz.Check(ctx, caller, contract.RequiredRoles); err != nil {
		return nil, err
	}
	validated, err := validateGovernanceInput(contract.InputSchema, input)
	if err != nil {
		return nil, err
	}
	decision, err := e.policy.Evaluate(ctx, contract.ID, validated, caller)
	if err != nil {
		return nil, err
	}
	if decision.Decision == "DENY" {
		e.audit.RecordDenied(ctx, actionID, caller, decision)
		return nil, ErrPolicyDenied
	}
	if decision.Decision == "REQUIRE_APPROVAL" || decision.Decision == "REQUIRE_EVIDENCE" {
		return e.workflow.StartOrResume(ctx, "sensitive-agent-action-approval", decision.IdempotencyKey, mustJSON(decision))
	}
	result, err := e.tools.ExecuteContractEffects(ctx, contract, validated)
	if err != nil {
		return nil, err
	}
	if err := e.audit.RecordSuccess(ctx, actionID, caller, validated, result, decision); err != nil {
		return nil, err
	}
	return result, nil
}
```

若用 LTBase 实现，这里的 `GovernanceActionEngine` 不宜理解为全新自研内核，而应拆解映射为：

```text
security.check
  -> 现有 authz / capability enforcement

contract.validate
  -> JSON Schema + Forma schema + handler-level validation

policy_engine.evaluate
  -> compliance_evaluator + governance extensions

create_approval_task
  -> LTFlow StartOrResume + task metadata

execute_saga
  -> LTFlow + tool execution + adapter layer

audit.append
  -> AuditRecordStore + governance event log
```

这一路径的好处是增量实施成本低，但不足也很明显：当前 LTBase 还没有一个统一、显式的 governance action engine 门面层，调用链会分散在 handler、planning、workflow 和 tool execution 之间。若要让治理能力可维护，后续最好补一个聚合 facade。

### 7.3 Human-in-the-Loop

审批任务应是结构化治理对象，而不是邮件。

```text
ApprovalTask #2026-0312

目标 agent:
  RefundAssistant_v2

执行上下文:
  action: external_payment_refund
  target_resource: payment/txn-2026-0312
  caller: agent/refund-assistant-v2
  environment: PRODUCTION

触发主张:
  ActionClaim #claim-2026-0847
  claim_type: ACTION_CLASSIFICATION
  subject: RefundAssistant_v2
  predicate: action_requires_approval
  object: external_payment_refund
  status: PROPOSED → 待审核

证据状态:
  ✓ capability snapshot
  ✓ tool execution request
  ✗ approval record 缺失
  ✗ operator confirmation 缺失

适用义务:
  - 高影响外部动作需要人工审批
  - 敏感数据访问需要责任边界确认
  - 所有外部副作用必须审计留痕

审批链:
  AgentOwner → ComplianceOfficer → SecurityOwner

操作:
  [批准]
  [附条件批准]
  [拒绝]
  [要求补充证据]
```

审批人必须看到证据链、适用义务、历史案例和 blast radius，而不是只看到一句“是否批准”。

### 7.4 Execution Audit Log：控制面的防篡改审计日志

> **注意：本节的 Execution Audit Log 与 5.5 节的 Governance Event Log 是不同的日志实体。** 前者记录控制面关键路径上的策略判断、审批决策、动作副作用和补偿动作；后者记录语义层对象的创建与状态变更。详见 5.5 节中的区分说明。

审计日志不应仅依赖数据库权限实现“不可变”。更合理的是 tamper-evident 设计。

```text
Tamper-evident Audit Log:

  storage:
    append-only event store

  integrity:
    hash chain / Merkle proof

  authentication:
    signed timestamp

  persistence:
    WORM storage / object lock

  governance:
    retention policy
    legal hold
    independent access audit

  privacy:
    pseudonymization
    field-level encryption
    separation of immutable metadata and erasable personal data
```

审计记录示例：

```text
AuditEntry:
  WHO:
    alice@company.com
    role: ComplianceOfficer

  WHAT:
    approve sensitive agent action

  WHEN:
    2026-06-02T14:23:17Z
    signed_timestamp: ...

  SUBJECT:
    claim/refund-assistant-v2-external-payment-refund

  POLICY:
    sensitive_agent_action_control v2.1

  RESULT:
    APPROVED_WITH_CONDITIONS

  CONDITIONS:
    - require operator confirmation for this refund
    - notify security team if refund amount exceeds threshold

  SOURCE:
    evidence/capability_snapshot_refund_assistant_v2
    evidence/execution_request_2026_06_02

  PREV_HASH:
    sha256:a3f8c...

  RECORD_HASH:
    sha256:b91d...
```

当审计保留要求与隐私删除请求冲突时，系统应优先采用假名化、字段级加密和密钥销毁策略，而不是简单删除审计事件。

对于 LTBase，这一节还有一个现实约束：当前 DynamoDB audit store 带默认 TTL，更适合操作审计和调试，而不是长期监管保全。因此治理场景需要把“审计记录”与“审计保全”明确拆开，前者可复用现有能力，后者需要新增独立存储与保全策略。

---

## 8. Runtime Monitoring：从执行前合规到生命周期治理

AI Agent Governance 不应止于执行前审批。系统运行后，agent 的 capability、行为模式、工具调用路径、用户投诉和组织政策都可能变化。

### 8.1 监控信号

```text
MonitoringSignal:
  - abnormal action frequency
  - repeated approval bypass attempts
  - sensitive data access anomaly
  - user complaint
  - incident report
  - human override rate
  - approval rejection rate
  - policy change impact
  - capability change
  - intended purpose change
```

### 8.2 监控回流

```text
MonitoringSignal
  ↓
ActionClaim update / AuditEvidence expiry / EnforcementControl escalation
  ↓
Policy re-evaluation
  ↓
ApprovalTask / ActionRiskRecord / action pause
```

示例：

```text
如果某个 agent 在 24 小时内连续触发多次高风险外部动作请求：

1. 创建 MonitoringSignal。
2. 标记现有 approval baseline 可能失效。
3. 创建 ActionClaim:
   agent_may_no_longer_satisfy_sensitive_action_control
   status=PROPOSED
4. Policy Engine 重新评估该 agent 的 capability 和 approval 要求。
5. 如风险较高，创建 ApprovalTask、降低 capability 或暂停相关 action。
```

这使系统从“执行前合规检查”升级为“持续生命周期治理”。

### 8.3 监控信号检测与阈值

监控触发不应基于单一事件，而应基于聚合模式。典型的检测策略包括：

| 信号类型 | 检测方式 | 示例阈值 |
| -------- | -------- | -------- |
| 异常动作频率 | 滑动窗口计数 | 1 小时内同 agent 触发 >5 次高风险动作 |
| 审批绕过尝试 | 累计计数 + 时间衰减 | 24 小时内 DENY 后重试 >3 次 |
| 敏感数据访问异常 | 基线偏差检测 | 与过去 7 日平均值偏差 >3 倍标准差 |
| 审批拒绝率 | 滚动比率 | 过去 30 日拒绝率 >40% |
| 人工否决率 | 滚动比率 | 过去 30 日否决率突增 >50% |

阈值应可配置且支持管辖区差异化。告警可分级为 `INFO`、`WARNING`、`CRITICAL`，仅 `CRITICAL` 级别触发自动 re-evaluation。

### 8.4 自动 Re-evaluation 流程

监控信号触发后，系统按以下流程自动重新评估合规状态：

```text
1. MonitoringSignal 进入队列（如 LTFlow timer / external scheduler）
2. 针对受影响 agent 重新计算 applicable obligations 和 evidence validity
3. Policy Engine 对 agent 的当前 capability 和执行历史执行 re-evaluation
4. 结果分类处理：
   - NO_CHANGE: 仅记录审计日志
   - EVIDENCE_EXPIRED: 标记 AuditEvidence 状态，通知 owner
   - RISK_INCREASED: 创建 PROPOSED ActionClaim，降低 capability 或暂停 action
   - CRITICAL_RISK: 立即暂停 agent action，创建紧急 ApprovalTask
5. 所有 re-evaluation 结果进入 Governance Event Log
```

重新评估本身不直接改变生产系统状态——高风险动作的暂停或降级必须经过 Approval Contract 的审核流程。

---

## 9. 端到端场景：Agent 执行高影响退款操作

### 9.1 事件

运营团队准备让 `RefundAssistant_v2` 代表客服执行一笔对外退款操作。

### 9.2 语义层摄入

这一阶段主要属于 **Governance**：系统在提取事实、用途和潜在风险分类，为后续合规验证准备结构化输入。

LLM Agent 读取 capability snapshot、tool 请求和执行上下文，生成结构化提案。

```go
claim, err := governanceService.CreateClaim(ctx, CreateClaimRequest{
	Subject:   "RefundAssistant_v2",
	Predicate: "action_requires_approval",
	Object:    "external_payment_refund",
	ClaimType: "ACTION_CLASSIFICATION",
	EvidenceRefs: []string{
		"capability/payment_write",
		"tool/refund_api",
		"execution_context/refund_request_2026_06_02",
	},
	Jurisdiction: []string{"INTERNAL"},
	Reasoning:    "该 agent 具备支付写能力，且当前动作带外部财务副作用，应进入人工审批路径。",
})
if err != nil {
	return err
}

_ = claim // GovernanceService 自动设置 authority_level=LLM_INFERRED, status=PROPOSED
```

系统自动设置：

```text
authority_level = LLM_INFERRED
status = PROPOSED
executable = false
```

### 9.3 人工审核 ActionClaim

这一阶段处于 **Governance → Compliance** 的转换带：业务 owner、合规和法务分别确认事实、风险分类和法律解释，使原本的治理判断进入可执行状态。

审批任务发送给 SystemOwner 和 ComplianceOfficer。

SystemOwner 确认事实性主张：

```text
claim_type = FACTUAL
subject = RefundAssistant_v2
predicate = requests_action
object = external_payment_refund
authority_level = SME_REVIEWED
```

ComplianceOfficer 确认风险分类：

```text
claim_type = ACTION_CLASSIFICATION
subject = RefundAssistant_v2
predicate = action_requires_approval
object = external_payment_refund
authority_level = COMPLIANCE_APPROVED
status = ACCEPTED
```

如果涉及法律解释争议，则进入 LegalCounsel 审核：

```text
authority_level = LEGAL_APPROVED
```

> **注意：** 此处的 SystemOwner/ComplianceOfficer 批准的是 **ActionClaim 本身的正确性**——即「该 agent 确实具备支付写能力，且退款操作确实属于高影响外部动作」这一分类主张是否成立。这是 **Governance 层的语义判断**，不是对本次执行操作的批准。执行操作的合规性审批见 9.6 节。

### 9.4 契约层触发

这一阶段主要属于 **Compliance**：系统不再只是理解“应该做什么”，而是开始计算“当前动作是否满足要求、缺什么、谁来批”。

已批准 ActionClaim 触发 `flag-sensitive-agent-action` Action Contract。

Policy Engine 评估：

```text
decision = REQUIRE_APPROVAL

obligations:
  - human approval
  - execution logging
  - caller accountability

evidence_required:
  - APPROVAL_RECORD
  - CAPABILITY_SNAPSHOT
  - TOOL_EXECUTION_LOG
```

### 9.5 控制面执行

这一阶段是 **Compliance 的执行面**：策略决策、审批任务、证据缺口和副作用都被强制接入关键路径。

Action Engine 通过 Saga 执行跨系统副作用：

```text
[1] UPDATE:
    AgentExecution.status = UNDER_REVIEW

[2] UPDATE:
    RegisteredAgent.last_sensitive_action = external_payment_refund

[3] CREATE:
    ApprovalTask #2026-0312

[4] CREATE:
    AuditRecord for execution request

[5] CREATE:
    JIRA tickets for missing approval evidence

[6] NOTIFY:
    AgentOwner + ComplianceTeam via platform + Slack

[7] APPEND:
    AuditLog with hash chain
```

如果 JIRA 创建成功但 agent execution 状态更新失败，系统通过补偿动作将 JIRA ticket 标记为 retracted 或 pending reconciliation，而不是假装存在全局 ACID 事务。

### 9.6 审批与条件批准

> **注意：** 与 9.3 节不同，此处的 ComplianceOfficer 和 SecurityOwner 批准的是 **本次具体执行操作的合规性**——即在证据齐全、分类已确认的前提下，是否允许本次退款实际执行。这是 **Compliance 层的执行决策**，可能附条件（如要求 operator 二次确认、后续监控）。9.3 节是对 ActionClaim 的分类审核，本节是对执行行为的合规审批。

ComplianceOfficer 批准，但附加条件：

```text
本次退款必须由人工 operator 二次确认，且保留完整审批记录。
```

SecurityOwner 批准执行，但要求后续监控：

```text
- repeated refund request monitoring
- approval rejection rate monitoring
- complaint escalation workflow
```

系统创建后续义务和证据需求：

```text
RecordOperatorConfirmation(due=1h)
PersistApprovalEvidence(due=1h)
CreateRefundExecutionAudit(due=1h)
SetupRuntimeMonitoring(frequency=daily)
```

### 9.7 知识回流

这一阶段把 Compliance 执行结果回写到治理知识层，使 Governance 框架能够基于真实执行历史持续演化。

审批结果和证据写回语义层：

```go
_, err = governanceService.AttachEvidence(ctx, AttachEvidenceRequest{
	TargetID:    "claim-2026-0847",
	EvidenceRef: "approval_record/2026-0312",
	Scope: map[string]any{
		"agent_id":              "RefundAssistant_v2",
		"action_id":             "external_payment_refund",
		"jurisdiction":          []string{"INTERNAL"},
		"execution_environment": "PRODUCTION",
	},
})
if err != nil {
	return err
}

err = governanceService.UpdateClaimStatus(ctx, UpdateClaimStatusRequest{
	ID:             "claim-2026-0847",
	AuthorityLevel: "COMPLIANCE_APPROVED",
	Status:         "ACCEPTED",
})
```

如果 LegalCounsel 未参与，不应将该 ActionClaim 标记为 `LEGAL_APPROVED`。

---

## 10. 责任边界

企业治理系统必须明确谁负责什么。

| 对象 / 决策 | 层级 | LLM | 系统 API | 工程 Owner | 合规人员 | 法务 | Ethics Board |
| ----------- | ---- | --- | ------- | ----------- | -------- | ---- | ------------ |
| 治理规则提取 | Governance | 提案 | 校验格式和来源 | — | 审核控制映射 | 审核法律解释 | — |
| 系统用途确认 | Governance | 提取候选 | 记录证据 | 确认事实 | 审核影响 | — | — |
| 动作分类 ActionClaim | Governance → Compliance | 提案 | 状态管理 | 提供证据 | 批准分类 | 必要时批准 | 高影响场景参与 |
| AuditEvidence 质量 | Compliance | 提取候选 | 校验证据作用域 | 提供制品 | 验证充分性 | 必要时审核 | — |
| Policy Contract | Compliance | 草案 | 测试和版本化 | 审核可执行影响 | 审核控制逻辑 | 审核义务映射 | — |
| Action Contract | Compliance | 草案 | 执行校验 | 审核副作用 | 审核治理影响 | — | — |
| Approval Task | Compliance | 生成上下文 | 路由和审计 | 补证 | 决策 | 必要时参与 | 高风险伦理判断 |

这个责任边界是系统可信度的基础。

---

## 11. 失败模式与缓解措施

### 11.1 LLM 错误分类 agent 动作风险

**失败模式**：LLM 将低风险 agent 动作错误分类为高风险，或反之。

**缓解措施**：

```text
- ActionClaim 默认 PROPOSED
- 未批准 ActionClaim 不触发 Action
- Golden set 测试
- 人工审核高影响分类
```

### 11.2 法规或政策来源过期

**失败模式**：系统继续使用已被取代的法规、政策或控制要求。

**缓解措施**：

```text
- supersession chain
- effective_date / expiry_date
- periodic re-grounding
- source hash verification
```

### 11.3 证据过期但 agent 仍显示合规

**失败模式**：旧 approval record 或 capability snapshot 继续满足新动作要求。

**缓解措施**：

```text
- AuditEvidence validity_period
- review_due_date
- evidence scope check
- expired evidence lint
```

### 11.4 外部系统 write-back 失败

**失败模式**：JIRA 工单创建成功，但 agent registry 或 action 状态更新失败。

**缓解措施**：

```text
- Saga pattern
- idempotency key
- compensation action
- outbox pattern
- manual reconciliation queue
```

### 11.5 Policy 变更误伤大量 agent

**失败模式**：新策略发布后，大量已注册 agent 或敏感动作突然被标记为不合规。

**缓解措施**：

```text
- blast-radius analysis
- staged rollout
- historical case replay
- approval before major version release
```

### 11.6 审批人 rubber-stamp

**失败模式**：审批人不认真审查，机械批准。

**缓解措施**：

```text
- required reasoning
- random sampling audit
- second-line review
- high-risk dual approval
- reviewer workload monitoring
```

### 11.7 影子 AI 未进入控制面

**失败模式**：业务团队使用未登记的 AI 工具或供应商系统。

**缓解措施**：

```text
- procurement integration
- network / usage discovery
- expense and SaaS inventory scan
- data access monitoring
- employee reporting channel
```

### 11.8 Governance 与 Compliance 错位

**失败模式**：组织在治理层定义了很多原则、红线和价值观，但没有把它们编译为控制点上的合规契约；或者相反，组织只做法规打勾和审计留痕，却从未审视这些要求是否真的覆盖了业务中的 AI 风险。

**缓解措施**：

```text
- 建立 Governance Statement -> AgentRule -> EnforcementControl -> AuditEvidence -> Action 的编译链
- 所有高影响治理原则都必须映射到至少一个可执行 Contract
- 对所有关键 Compliance 控制反向追溯其治理来源
- 定期审查“已合规但仍高风险”的案例
- 将治理委员会结论回写到语义层和契约层，而不只停留在会议纪要
```

---

## 12. 基于 LTBase / LTFlow 的技术选型与能力缺口

下表不是抽象市场选型，而是把本文方案映射到 LTBase 当前基础设施，并明确哪些能力已经有基座，哪些仍需补齐。

| 层次 | 本文需要的能力 | LTBase / LTFlow 当前可复用能力 | 当前缺口 / 不足 |
| ---- | -------------- | ------------------------------ | --------------- |
| 语义运营层 | Policy Concepts / ActionClaims / AgentRules / EnforcementControls / AuditEvidence 图谱 | `internal/semantic`、PostgreSQL `semantic_resource` / `semantic_relation`、Forma entity storage | 资源类型和关系类型仍偏少；缺少治理专用 schema；复杂图推理能力有限 |
| 规则语义层 | 标准词表、约束、跨组织交换 | 可先复用 Forma + semantic metadata | 缺少 RDF / SKOS / SHACL 映射层与验证器 |
| 检索层 | 政策、证据、案例、图谱混合检索 | LTSearch（BM25 + 向量）、LTEmbed | 缺少面向政策引用、precedent 检索和证据对齐的治理搜索体验 |
| LLM Agent | 摄入、提案、lint、差异检测 | Gemini 集成、LTAgent runtime、LTFlow `ltflow.llm` activity | 多 provider 不是一等能力；缺少治理专用 agent/tool 套件 |
| Policy 层 | allow / deny / require_approval / require_evidence | `compliance_evaluator`、`ComplianceProfile` | 当前只有 allow/warn/block；缺少治理中间态与跨对象评估能力 |
| Action 层 | 副作用契约、幂等、补偿 | `planning_service`、tool registry、handler execution | 缺少统一 governance action runtime、outbox、reconciler |
| Workflow 层 | 审批、补证、超时升级、回放 | LTFlow state machine、task/history、event-driven transitions | 高级审批能力不足，如会签、动态加签、多审批人法定人数 |
| Audit 层 | 防篡改治理审计 | DynamoDB `AuditRecord` | 缺少 hash chain、WORM/object lock、长期保全账本 |
| 控制台 | 治理工作台、审批面板、证据缺口视图 | `ltbase-controlplane-ui`、`ltbase-ts` | Security & Compliance 区域尚未产品化，缺少治理专用页面 |
| 监控层 | 行为异常、complaint、policy change impact | 可复用 LTSearch、DuckDB、LTFlow 定时流程 | 缺少治理专用 MonitoringSignal 模型与自动 re-evaluation 流程 |
| 集成层 | JIRA / Slack / CI/CD / IAM write-back | 现有 tool / webhook / adapter 模式可复用 | 缺少治理场景统一 adapter contract 与失败补偿框架 |

综合来看，LTBase / LTFlow 已经能够覆盖本文架构的 **骨架能力**：

* 语义层基座；
* agent 与 LLM 编排；
* 合规检查器；
* 状态机工作流；
* 控制面 API 与前端；
* 搜索、向量与嵌入能力。

但要把它们提升为一个真正可用于 AI Governance 的控制面，仍然至少需要补齐以下功能包：

```text
1. Governance schema pack
   - ActionClaim / AgentRule / EnforcementControl / AuditEvidence / ApprovalTask / MonitoringSignal

2. Governance policy runtime extensions
   - require_approval / require_evidence / obligation coverage / evidence validity

3. Governance workflow pack on LTFlow
   - claim review / action approval / evidence request / conditional approval

4. Governance audit ledger
   - append-only event log + hash chain + retention / legal hold

5. Governance UI workspace
   - evidence gap dashboard / approval inbox / blast radius / precedent viewer

6. Governance adapters
  - agent registry / action gate / procurement gate / monitoring ingestion
```

因此，本文对 LTBase 的判断不是“现有能力已经完全覆盖”，而是：

> LTBase / LTFlow 已经足够作为 AI Governance 控制面的第一阶段底座，但距离企业级治理产品仍有一组明确、可枚举、可分期建设的能力缺口。

### 12.1 Gap Analysis 与实现 Backlog

为了把“能力缺口”转化为可执行工作，下面给出一个更贴近工程落地的 backlog。这里不按组织部门划分，而按实现模块划分。

| 优先级 | 模块 | 目标 | 依赖现有能力 | 主要缺口 |
| ------ | ---- | ---- | ------------ | -------- |
| P0 | Governance schema pack | 定义 ActionClaim / AgentRule / EnforcementControl / AuditEvidence / ApprovalTask / MonitoringSignal 的 Forma schema 与 semantic type | Forma、`internal/semantic` | 缺少治理领域模型 |
| P0 | Governance policy extensions | 在 `compliance_evaluator` 上新增治理控制与中间态决策 | `ComplianceProfile`、现有 evaluator | 缺少 `REQUIRE_APPROVAL` / `REQUIRE_EVIDENCE` |
| P0 | ActionClaim review workflow | 基于 LTFlow 实现 ActionClaim 审核、补证、批准、驳回链路 | LTFlow state machine、task/history | 缺少治理审批模板 |
| P0 | Governance service facade | 聚合 semantic / policy / workflow / audit，形成统一治理 API | `ltbase.api` handler/service 模式 | 当前调用链分散 |
| P1 | Governance UI workspace | 提供 evidence gap、approval inbox、blast radius、precedent 视图 | `ltbase-controlplane-ui`、`ltbase-ts` | Security & Compliance 仍是占位 |
| P1 | Governance audit ledger | 建立 append-only governance event log 与 hash chain | `AuditRecord` 基础能力 | 缺少长期保全、不可变账本 |
| P1 | Action / Data / Procurement gates | 将治理契约接入动作执行、数据访问、供应商接入关键路径 | planning/tool/handler 体系 | 缺少统一 gate contract |
| P2 | Governance retrieval layer | 基于 LTSearch / LTEmbed 建立政策、案例、证据联合检索 | LTSearch、LTEmbed | 缺少 precedent / citation 检索产品层 |
| P2 | Workflow advanced approvals | 会签、加签、代理审批、法定人数、SLA 升级 | LTFlow 核心状态机 | 高级审批能力缺失 |
| P2 | RDF/SKOS/SHACL mapping | 建立外部规则词表交换与语义互操作层 | semantic metadata | 缺少映射与验证实现 |

如果进一步细化到交付顺序，推荐 backlog 顺序为：

```text
Backlog Wave 1:
  - Governance schema pack
  - Governance service facade
  - Governance policy extensions
  - ActionClaim review workflow

Backlog Wave 2:
  - Governance UI workspace
  - Governance audit ledger
  - Action / Data / Procurement gates

Backlog Wave 3:
  - Governance retrieval layer
  - Workflow advanced approvals
  - RDF / SKOS / SHACL mapping
```

这样排的原因是：Wave 1 先把“语义对象 -> 策略判断 -> 审批流转”打通；Wave 2 再把它接进真实控制点并补 UI / 审计；Wave 3 才去做更重的互操作和高级治理能力。

#### 关键工程风险提示

以下模块在实施前建议先做 PoC 验证，避免低估工程复杂度：

- **Governance audit ledger（P1/Wave 2）：** hash chain 实现涉及跨存储层（DynamoDB → 独立 Ledger）的同步写入，建议在 Wave 2 早期评估是否需要引入 event store 中间件或自研轻量 ledger。
- **Saga / compensation 框架（P1/Wave 2）：** JIRA、Slack、IAM 等外部系统缺乏统一的 compensation API 语义，建议先对 3–5 个目标系统做 adapter 能力摸底，再设计统一的 outbox / reconciler 模式。
- **Blast-radius analysis（P0/Wave 1）：** 依赖 semantic_resource + semantic_relation 的完整遍历能力，而当前 PostgreSQL 语义层对复杂多跳推理并非最优。建议在 Wave 1 中验证图谱遍历性能是否满足真实规模下的影响分析需求。
- **RDF/SKOS/SHACL mapping（P2/Wave 3）：** 标准词表构建、SHACL 约束编写和跨组织语义对齐的实际工作量可能远超预期，建议在 Wave 2 末评估需求迫切性，必要时降级或分阶段交付。


---

## 13. 实施路线图

### 阶段 0：治理控制面盘点，2–4 周

在构建系统前，先摸清现状。

```text
产出:
  - agent asset inventory baseline
  - agent 注册、动作执行、数据访问、审批、监控系统盘点
  - 3 个最高风险 use cases
  - 10–20 条可机器化控制项
  - 现有证据制品和审批流程清单
  - 控制面覆盖率 baseline
```

### 阶段 1：只读语义层，2–3 个月

先建设语义图谱，但不做自动执行。

```text
产出:
  - Source / AgentRule / EnforcementControl / AuditEvidence / ActionClaim 模型
  - 政策约束 → 控制项 → 证据 的映射
  - agent 资产与执行上下文图谱
  - AuditEvidence gap analysis
  - LLM ingest + PROPOSED ActionClaim 流程
  - LTBase 治理 schema pack（基于 Forma + semantic types）
```

### 阶段 2：半自动审批，2–3 个月

引入 Policy Contract、Approval Contract 和审计日志，但仍不直接修改生产系统。

```text
产出:
  - 3–5 个核心 Policy Contract
  - 结构化 ApprovalTask
  - 防篡改审计日志
  - ActionClaim 审核工作流
  - Contract regression suite
  - LTFlow 审批工作流模板与 control plane UI 初版
```

### 阶段 3：有限 write-back，2–3 个月

选择明确控制点执行强约束。

```text
产出:
  - Agent Registration Gate
  - Action Execution Gate
  - Data Access Gate
  - Saga / outbox / compensation 机制
  - 外部系统集成：JIRA、Slack、CI/CD、IAM
  - 控制面覆盖率监控
  - governance action runtime facade
```

### 阶段 4：生命周期闭环，持续

扩展到运行后治理。

```text
产出:
  - Runtime monitoring
  - AuditEvidence expiry automation
  - 异常动作 / 审批拒绝率 触发重新评估
  - Policy change impact analysis
  - Shadow AI discovery
  - 多业务线和多管辖区扩展
  - LTSearch / LTEmbed 驱动的 precedent / policy impact retrieval
```

---

## 14. 结论

AI Agent Governance & Compliance 的核心挑战，不是让模型回答“这条规则是什么意思”，而是把不断演化的治理知识转化为可审核、可测试、可执行的企业控制面。

Operational Ontology 证明了业务语义可以成为企业运营系统的一部分，但传统本体建设往往自顶向下、专家驱动、变更成本高。LLM 增量知识编译提供了一种持续吸收新来源、更新知识结构的模式，但它本身不能承担企业合规中的授权、审计和执行责任。

本文提出的架构将二者结合，但明确划分边界：

* LLM 负责从政策、能力边界、资产、证据和事件中生成结构化提案；
* Semantic Governance Graph 承载 Policy Concepts、ActionClaims、AgentRules、EnforcementControls、AuditEvidence 和执行上下文；
* 人类批准关键事实、法律解释、动作分类和控制决策；
* Contract & Policy Layer 将批准后的义务和控制项编译为 Policy、Action 与 Approval；
* Governance Control Plane 在 agent 注册、动作执行、数据访问和持续监控等关键路径上执行这些契约；
* 防篡改审计日志、回归测试、证据有效期和失败模式治理保证系统可信。

如果以 LTBase / LTFlow 作为实现底座，这一方案并不要求从零搭建新平台。LTBase 已经具备语义层、agent 编排、工作流、搜索、控制面 API 和前端工作台等关键骨架，足以支撑第一阶段治理控制面的建设。

但也必须明确：当前 LTBase / LTFlow 覆盖的是“可落地的基础能力”，还不是“现成完整的治理产品”。治理专用 schema、policy runtime 扩展、审计账本、高级审批能力、治理工作台和 write-back 适配器仍需专项建设。

这不是“一套方案自动解决合规”，而是一种把合规知识转化为可执行治理控制面的架构模式。

它的目标是：

> 让治理系统的演化速度跟上 AI Agent 与企业政策的演化速度，同时保持企业级的可靠性、可审计性和责任可追溯性。

---

*本文讨论框架受 Operational Ontology、LLM 增量知识编译模式、Agent Governance 实践及企业内部政策、能力授权、审批审计和运行期控制需求启发。方案为概念性架构设计，具体实施需根据组织角色、技术栈、风险偏好和控制面覆盖率进行调整。*
