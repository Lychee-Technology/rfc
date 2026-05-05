# Harness Engineering: From Theory to Production
### Nine questions on building AI agents that don't collapse under real-world conditions

Transitioning from experimental agents to production systems is not a prompting problem. It is a systems design problem. **Harness Engineering** is the discipline of building the constraints, state management, and recovery workflows that keep models reliable across long-horizon tasks.

Three principles underpin everything below:

- Never rely on the model to enforce correctness
- Always externalize state
- Treat every boundary as a contract

---

## Q1: Why do search tools cause context overflow if I'm already using RAG?

RAG chunks are pre-processed, cleaned, and size-bounded before they reach the model. Raw web search responses are none of those things.

When an agent calls a live search API, it receives unstructured, unbounded payloads—HTML tags, duplicate snippets, irrelevant noise. These easily exceed a model's context window. Worse, many inference layers silently truncate the overflow rather than raising an error, so the model reasons from an incomplete picture without knowing it.

A robust harness treats tool output as untrusted raw material. Before passing any search payload to the model, it must:

- Rank results by relevance (BM25 and/or embedding similarity)
- Deduplicate overlapping content
- Enforce a hard token budget

**Rule of thumb:** Never pass raw tool output directly to the model. Preprocess, rank, and bound it first.

---

## Q2: Why use deterministic(rule-based) verification nodes instead of LLM-based prompt checks?

Asking an LLM to "ensure the output is valid JSON" is a hope. It is probabilistic, slow, and hallucinates.

For deterministic checks—JSON schema validation, type enforcement, required field presence—code-based verification is the only reliable option. Libraries like `Pydantic` or `jq` either pass or fail with a structured error trace. There is no ambiguity.

The harness should intercept every LLM output before it propagates, run it through the relevant validator, and on failure, return the exact error back to the model for a localized retry. The model never sees a downstream consequence of its own malformed output.

**Rule of thumb:** If a check can be deterministic, it must not be delegated to an LLM.

---

## Q3: Can an LLM strictly follow a generated DAG?

No—and it shouldn't try.

The LLM's job ends at generating the plan: a Directed Acyclic Graph or JSON-based workflow. A dedicated execution engine inside the harness then reads that DAG and runs it. The model does not control execution flow.

This separation has three concrete benefits:

- **Security:** The engine handles credential injection (OAuth tokens, API keys). The model never sees them.
- **Determinism:** Execution order cannot drift once the plan is locked.
- **Observability:** Every step is individually logged, inspectable, and retryable.

Crucially, the DAG must be treated as untrusted input. Every node should be validated before execution—a model can generate a plan that is syntactically valid but logically unsafe.

**Rule of thumb:** The model proposes. The harness disposes.

---

## Q4: How do you evaluate if a generated plan is "good"?

A plan that is logically correct but not executable in production is not a good plan. Three properties define production-readiness:

**Granularity.** Steps should represent stable, high-level units of work—"Fetch Competitor Data," "Validate Schema"—not fragile implementation details that may change mid-execution.

**Separation of Concerns.** State persistence, retries, and error handling do not belong inside the plan. They are harness responsibilities. A plan that encodes its own recovery logic couples business logic to infrastructure and breaks when either changes.

**Observability.** Every step must be independently traceable and retryable. If a step cannot be debugged in isolation during a production incident, the plan is not ready.

**Rule of thumb:** A good plan is one you can debug step-by-step under production conditions.

---

## Q5: Should state be stored in files or databases?

Files work in local development. They break in production.

In stateless environments—Kubernetes, serverless functions—there is no guarantee that the next request lands on the same instance. A local `state.json` written by one container is invisible to another. Any progress since the last checkpoint is lost.

Production harnesses must externalize state:

- **Redis** for fast, ephemeral execution state (e.g., current DAG node status, in-progress subtasks)
- **PostgreSQL** for durable, queryable state (e.g., audit logs, completed task history, resumable sessions)

The split is deliberate. Redis is fast but volatile; PostgreSQL is slower but survives restarts. Use each for what it is designed for.

**Rule of thumb:** Use fast storage for execution state, durable storage for recovery state.

---

## Q6: Why verify tool outputs if the tool logic is fixed?

Because the tool's environment is not fixed.

Two failure modes appear consistently in production:

**API Drift.** External APIs make format changes that are invisible to humans but break downstream parsers. A field that returns `"status": "active"` may silently change to `"status": 1`. The API docs may not be updated. Your harness has no way to know unless it validates the shape of every response at the boundary.

**Data Defects.** Scrapers and third-party APIs return incomplete or malformed data—missing required fields, embedded HTML artifacts, null values where numbers are expected. These defects propagate silently through an unvalidated system until they corrupt the model's reasoning several steps later.

The fix is boundary validation: reject non-conforming data at the point of entry, log the failure, and trigger retry or fallback logic. Long-term, this also means introducing schema versioning to manage backward compatibility as external APIs evolve.

**Rule of thumb:** Every external boundary is a failure surface. Validate before trusting.

---

## Q7: How does the Sprint Contract negotiation work?

The Sprint Contract is an adversarial planning protocol between two independent roles—a Generator and an Evaluator—run before any execution begins.

The process:

1. **Propose.** The Generator outputs a structured plan with explicit success criteria.
2. **Critique.** The Evaluator identifies missing edge cases, ambiguous assertions, or untestable conditions and rejects the plan.
3. **Revise.** The Generator submits an updated plan addressing the gaps.
4. **Sign-off.** Once the criteria are verifiable and complete, the contract is locked. Execution starts.

Two rules are non-negotiable:

**The Evaluator must execute, not read.** It must run the code, validate the interface with browser automation, or simulate the interaction. Reading the Generator's output and judging it from text alone is not evaluation.

**The Evaluator must operate on a clean context.** It must not have access to the Generator's reasoning trace. If the Evaluator can see how the Generator arrived at its plan, it anchors to that logic and cannot independently surface blind spots. The whole point of a separate Evaluator is independence—removing that independence collapses the architecture into self-grading.

**Rule of thumb:** Verification must be independent—or it isn't verification.

---

## Q8: With limited resources, in what order should I implement the stack?

Do not try to build the full stack on day one. Prioritize resilience over intelligence.

**Minimum Viable Harness (build first):**

- `state.json` — track task progress outside the context window
- Retry wrapper — `try/catch` with exponential backoff on every tool call
- Schema validator — reject malformed LLM outputs before they propagate
- Tool output truncation — enforce a hard token budget on every payload

These four components prevent the most common and most costly failure modes: silent truncation, uncaught exceptions, corrupt outputs, and lost state.

**Then iterate in this order:**

1. **Constraints & Recovery** — make failures safe and idempotent
2. **Memory & State** — make progress persistent across sessions
3. **Tool Middleware** — prevent context collapse from raw payloads
4. **Contracts & Interfaces** — eliminate schema drift between components
5. **Orchestration** — enforce execution flow via DAG or state machine
6. **Cognition & Evaluation** — improve reasoning quality and output correctness

**Rule of thumb:** First make it fail safely. Then make it smarter.

---

## **Q9: How do you handle dynamic tool selection when an agent has hundreds of tools?**

Registering every tool upfront is not an option. A few hundred tool descriptions injected into the context window will exhaust the token budget before the model processes a single user request. The solution is to treat tool selection as its own sub-problem, handled by a dedicated sub-agent before the main agent runs.

**Step 1: Give the main agent a lightweight tool map.** Before planning, inject a compact capability summary into the main agent's context—not full tool descriptions, just categories and key capability phrases. A few hundred tokens is enough. This solves the chicken-and-egg problem: the agent needs some awareness of what tools exist to write a useful plan, but it doesn't need the full registry to do so.

**Step 2: Extract intent and generate a plan.** The main agent produces a plan describing what needs to be done, including explicit tool requirements ("I will need a tool that can query a SQL database, and a tool that can send email"). These requirements become the query for the next step.

**Step 3: A Tool Selector sub-agent narrows the candidate set.** A dedicated sub-agent receives the plan and identifies which tools are actually needed. It runs on a clean context, so the registry size does not affect the main agent's token budget. For very large tool counts, use a two-stage approach:

* **Coarse filter (RAG or embedding similarity):** Reduce the full registry to a candidate set of 50–100 tools. This stage trades some precision for scalability—pure LLM scanning across thousands of tools is not practical.  
* **Precise selection (LLM reasoning):** The sub-agent evaluates the candidate set against the full plan, reasoning about which tools are actually needed and in what combination. This is where accuracy is recovered. Do not rely on keyword or tag filtering at this stage—surface vocabulary rarely aligns between tool descriptions and plan language.

If the tool count is in the hundreds rather than thousands, skip the coarse filter and go directly to LLM reasoning. The two-stage approach is an optimization for scale, not a default requirement.

**Step 4: Register the selected tools and resume execution.** The selected tools are injected into the main agent's context and execution proceeds.

**Step 5: Cache the tool set within the session.** In multi-step tasks, avoid re-running tool selection on every iteration. Cache the selected tool set for the duration of the current task session and only trigger a new selection cycle when the agent encounters a genuinely new sub-task type. This keeps latency from compounding across steps.

**Two known limitations:**

The plan quality problem is real but manageable. A lightweight tool map (Step 1\) gives the agent enough context to express specific requirements rather than vague ones. If the agent writes "I need a data tool," the plan is underspecified—if it writes "I need a tool that can execute parameterized SQL queries against a Postgres database," the sub-agent can select accurately.

Latency is a genuine cost. Each tool selection cycle adds at least one LLM round-trip. With session caching and a well-scoped coarse filter, this cost is bounded. It is still worth paying: a fast agent with the wrong tools produces nothing useful.

**Rule of thumb:** Accurate tool selection is a prerequisite for task completion. Use RAG to scale, LLM reasoning to select accurately, and caching to keep multi-step tasks fast.

---

## Common anti-patterns

These are the failure modes that appear most often in early-stage agent systems:

- Passing raw tool output directly to the model
- Letting the LLM control its own execution flow
- Using prompt checks instead of validators for correctness
- Storing critical state only in the context window
- Encoding retry and recovery logic inside the plan itself

If your system does any of these, it is not production-ready.

---

## Conclusion

Harness Engineering is not about making the model smarter. It is about making the environment more rigid.

A production-grade agent is defined by its constraints—what it can do, what it must remember, what it must verify, and how it recovers when things go wrong. Build those constraints well, and even an imperfect model becomes a reliable system.

---

*For a deeper look at long-horizon failure modes—context overflow, evaluation bias, and memory consolidation—see the companion guide:*

[**Your AI Isn't "Stupid"—It Just Needs a Better Harness**](/posts/agents/harness-engineering.md)