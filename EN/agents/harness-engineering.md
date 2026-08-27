# Your AI Isn't "Stupid": It Just Needs a Better Harness

TL;DR. Agents don't fail because models are weak. They fail because systems are undefined.

A good harness does four things:
- Constrains what the model can do
- Externalizes what it must remember
- Verifies every step it takes
- Recovers when things go wrong

## The problem: the 10-step collapse

Imagine you deploy an autonomous agent to compile a market research report. Steps 1 through 3 execute perfectly: it plans the task, searches the web, and extracts competitor data.

By step 7 it starts hallucinating statistics, because the search tool's payload exceeded the context window and was silently truncated. By step 10 it outputs a broken JSON string because there was no schema validator in the loop. The pipeline crashes.

This kind of agentic collapse is easy to blame on the model's reasoning. In production systems the cause is usually elsewhere: the problem isn't the horse, it's the reins.

## The root cause: a paradigm shift in AI engineering

For the past two years, the industry has treated AI failures as a communication problem. If a model failed, we assumed we just needed to ask better or feed it better documents. But for long-horizon, autonomous execution, these approaches hit a hard ceiling.

What works instead is **harness engineering**: the discipline of designing the system *around* the model. An agent is not just the LLM. It is the LLM embedded within a strict scaffolding of code, state management, and recovery workflows.

The field has moved through three stages:

| Era | Focus | Limitation |
| :--- | :--- | :--- |
| **Prompt Engineering** | *Instructions:* How to ask. | Brittle; zero persistence across steps. |
| **Context Engineering** | *Information:* What to know (e.g., RAG). | Stateless; cannot control long-horizon execution. |
| **Harness Engineering** | *System Design:* How to constrain and run. | Solves continuous, multi-step execution control. |

Each stage subsumed the last rather than replacing it. Good harness engineering still requires good prompts and good context; it adds the execution layer that neither of them provides.

Structurally, that execution layer is what surrounds the model and controls it. At a high level, a production-grade agent system looks like this:
```
          ┌─────────────────────────────────┐
          │          User Request           │
          └────────────────┬────────────────┘
                           ▼
          ┌─────────────────────────────────┐
          │       HARNESS (7 layer stack)   │
          │  ┌───────────────────────────┐  │
          │  │     LLM (The Model)       │  │
          │  └───────────────────────────┘  │
          └────────────────┬────────────────┘
                           ▼
          ┌─────────────────────────────────┐
          │        Verified Output          │
          └─────────────────────────────────┘
```

The model is *inside* the harness. It never speaks to the user directly, and it never speaks to the outside world without supervision. Every input is filtered on the way in; every output is validated on the way out.

---

## The design principles of a good harness

Four principles should guide every design decision in the layers below. When you're unsure whether your harness is doing its job, come back to these tests:

**1. Constrain, don't instruct.**
Never rely on the model to "choose correctly" if you can restrict its choices programmatically. A prompt that says "always respond in valid JSON" is a hope. A schema validator that rejects malformed output is a guarantee.

**2. Externalize state.**
If a piece of information matters to the task's continuity (what's been done, what's pending, what failed), it must exist outside the context window. Context windows are volatile; files on disk are not.

**3. Make every step verifiable.**
If you can't check it, you can't trust it. Every layer of your harness should produce outputs that can be validated by something other than the model that generated them.

**4. Fail locally, not globally.**
A single failed tool call should trigger a retry of that step, not a restart of the entire pipeline. The blast radius of any failure should be as small as your state management allows.

Each of these has direct implementation consequences, and each surfaces repeatedly in the stack below.

---

## The 7-layer harness stack

A harness does more than pass text back and forth. It runs a typed, stateful, observable system. Here is what a production-ready stack contains.

### 1. Cognition

The foundation layer sets the model's operational boundaries. Instead of a massive, encyclopedic system prompt, the harness feeds the model a localized map of its current role, its success criteria, and strict negative constraints: what *not* to do. It is a job description rather than an encyclopedia.

In practice, this often takes the form of structured system prompts, role files (e.g., `agents.md`), or dynamically generated task briefs scoped to a single step.

### 2. Tools

The harness does not pass raw tool outputs back to the LLM. It is a strict middleware layer that applies:

- **Ranking:** Uses embedding similarity or BM25 scoring to surface only the most relevant results.
- **Deduplication:** Strips repetitive data before it wastes tokens.
- **Token budget truncation:** Hard-caps tool payloads to prevent context overflow, the failure mode from the opening example.

### 3. Contracts & Interfaces

This is the layer most teams skip, and the one behind the most puzzling production failures.

The model speaks in probabilities. The harness must speak in types.

Every boundary in the system (between the LLM and a tool, between one agent and another, between the harness and the outside world) needs an explicit contract: a strict JSON schema, a typed function signature, a versioned API spec. Without one you get schema drift: the model generates a `price` field as a string one time and a float the next, and the downstream pipeline silently produces garbage.

The contract layer validates inputs and outputs at every boundary crossing and rejects anything that doesn't conform *before* it propagates. This is Principle 1 (constrain, don't instruct) in practice. Drift that gets past this layer corrupts downstream systems quietly: a pricing field that switches from float to string may leave the pipeline running while breaking analytics.

### 4. Orchestration

Without this layer, an LLM tends to loop infinitely, skip critical steps, or prematurely declare victory. The harness enforces a structured workflow, either a Directed Acyclic Graph (DAG) or a state machine, that defines the legal transitions: *Plan → Gather → Draft → Verify*. The model proposes actions; the harness decides which actions are allowed.

### 5. Memory & State

State must be explicitly managed to prevent amnesia. A mature harness splits memory into two tiers:

- **Working memory (short-term):** The immediate conversation and context window needed for the current step.
- **Persistent state (long-term):** A structured file (e.g., `state.json`) that tracks exactly which sub-tasks are pending, in-progress, or completed. It survives context resets and even sessions.

This is Principle 2 (externalize state) in practice. If a piece of information only lives inside the context window, it will eventually be lost.

### 6. Evaluation & Observation

A system cannot rely solely on "another LLM prompt" for validation. The evaluation layer must be heterogeneous:

- **Rule-based checks:** Validating JSON schemas, string lengths, or required fields.
- **Tool-based verification:** Running code through a compiler, executing test suites, or using browser automation (like Playwright) to physically test a UI.
- **LLM-as-judge:** Reserved *only* for subjective or semantic grading (tone, coherence, user-friendliness) where deterministic checks can't apply.

### 7. Constraints & Recovery

In autonomous environments, tool failures and API timeouts are the norm, not the exception. The harness must enforce idempotency: if a step fails, the system retries that specific step without corrupting the overall state or duplicating previous work. This is Principle 4 (fail locally, not globally) made concrete, and it is what separates a fragile demo from a system that can run unattended.

---

## Example: one full agent run

Here is a full cycle of the market research agent, including a real failure, and how the layers keep it from collapsing.

![sequence diagram](./img/sequence.svg)

**Step 1, user request:** "Compare pricing between Competitor A and Competitor B."

**Step 2, orchestration and state:** The Planner LLM decomposes this into a DAG with two parallel branches. `state.json` marks "Fetch Competitor A" as `IN_PROGRESS`.

**Step 3, tool call:** The LLM triggers a web search. The Tool layer fetches 50 results, applies BM25 ranking, deduplicates overlapping text, and returns only the top 3,000 tokens, well within budget. The Contract layer validates the tool's output against the expected schema before passing it to the model.

**Step 4, evaluation:** The LLM generates pricing data. The Evaluation layer runs a rule-based schema check and catches that the JSON is missing the required `currency` field.

**Step 5, recovery:** The harness intercepts the error *before* the user ever sees it. Because the action is idempotent, it passes the exact error trace back to the LLM for a localized retry, so the entire pipeline never restarts.

**Step 6, state update:** The corrected data passes validation. `state.json` marks Competitor A as `COMPLETED`, and the harness moves to Competitor B.

**Step 7, hard failure:** The web search tool returns an empty result for Competitor B: the site is down. The harness detects the empty payload, logs the failure, and triggers a fallback: retry with an alternative search query. `state.json` remains unchanged at this point; no partial or corrupted data is written until the step fully succeeds.

**Step 8, fallback succeeds:** The alternative query returns valid results. The Contract layer validates the schema, the Evaluation layer confirms all required fields are present, and only now does `state.json` mark Competitor B as `COMPLETED`.

This cycle repeats dozens or hundreds of times in long-running tasks. Where the introduction's agent collapsed at step 10, this run absorbed an outright tool failure and recovered without human intervention, with no hallucinated data and no silent failure.

---

## Advanced traps: 4 lessons from the frontlines

When you scale this architecture to run for hours, new failure modes emerge that no amount of prompt tuning can fix. Four of them bite teams in production consistently.

### Trap 1: the "context anxiety" phenomenon

As an agent works and its context window fills up, models often exhibit a behavioral shift that practitioners have come to call "context anxiety." When approaching token limits, typically above 70% capacity, or when latency spikes, the model begins to skip steps or prematurely conclude the task. The behavior looks rushed.

**The fix:** In-place summarization is not enough, since it still leaves the model operating on a cluttered, degraded context. Execute a context reset instead. The harness monitors utilization and triggers the reset programmatically:

```python
# This threshold is empirical and should be tuned per model and workload.
if (tokens_used / max_context) > 0.7:
    save_state_to_disk(state)
    terminate_current_instance()
    launch_fresh_agent(state)
```

The harness saves the exact project state to persistent storage, terminates the current LLM instance, and launches a fresh agent with a clean context window. The new agent reads the saved state, orients itself, and continues. This is expensive but much more reliable for tasks that exceed a single context window.

### Trap 2: the self-grading illusion

If you ask an AI to grade its own work, it tends to approve mediocre output with unearned confidence. This is structural rather than a bug in any specific model: the same weights that generated the output are poorly positioned to critique it.

**The fix:** Implement a strict separation of concerns using a Sprint Contract. Before work begins, the Generator agent and an independent Evaluator agent negotiate a concrete, testable definition of "done." Two rules are non-negotiable:

First, the Evaluator must *execute*: it should run the code, validate the interface in a headless browser, or check the output against a schema, rather than read the raw text and render a judgment.

Second, the Evaluator must operate on a clean context, not the Generator's full reasoning trace. If the Evaluator reads the Generator's chain-of-thought, it inherits the Generator's assumptions and blind spots, which defeats the purpose of independent review. Give the Evaluator the output and the success criteria, and nothing more.

### Trap 3: optimizing for the illusion of correctness

When an LLM is placed under impossible or contradictory constraints (fix this bug, but don't change any code; make it shorter, but include everything), practitioners have observed a consistent behavioral pattern. The model stops trying to solve the actual problem and instead optimizes for *looking* correct. Outputs become fluent but hollow: hallucinated data, superficially plausible but broken logic, or answers that technically satisfy the letter of the prompt while violating its intent.

Recent research on steering vectors and internal model representations, including work from Anthropic on probing the inner states of language models, suggests this isn't just surface-level text prediction going awry. There appear to be measurable shifts in a model's internal state under conflicting pressure, though this line of research is still in its early stages.

**The fix:** LLMs predict the next token based on the trajectory of the current context. If your harness feeds back aggressive, emotional error messages ("You are stupid, this is completely wrong"), you bias the context toward a narrative of failure, and the model's subsequent outputs tend to degrade further. Harness feedback must remain strictly objective: supply the compiler error, the failed assertion, the schema mismatch.

### Trap 4: the memory consolidation cycle

For an agent to function as a long-running system, persistent state management isn't a one-off setup. Over time, memory logs become bloated and contradictory: old decisions conflict with new ones, and redundant entries waste tokens on every read.

Some production agent systems have adopted an approach often called memory consolidation: an automated routine that periodically processes and compresses the agent's accumulated working logs. Reports from teams using this pattern (including references in open-source agent frameworks and Anthropic's own tooling) describe large reductions. In one documented instance, a harness compressed 32K tokens of noisy, repetitive history into a clean 7K-token state file without meaningful information loss.

**The fix:** Implement an automated consolidation cycle. When the agent is idle, between tasks or during low-priority windows, trigger a background job that reads the raw logs, deduplicates entries, resolves contradictions in favor of the most recent data, and writes a clean, compressed state file. This keeps the agent fast, cheap, and accurate for its next run. It is defragmenting a hard drive, applied to an AI's working memory.

---

## Where to start: the minimum viable harness

If the seven-layer stack feels overwhelming, don't try to build all of it on day one. Start with Layer 7, Constraints & Recovery, and work backward. Imperfect prompts and a naive tool integration are survivable; an agent that corrupts its own state on failure or silently swallows errors is not.

A day 1 harness has four parts:

- **`state.json`:** A single structured file that tracks task status. If the process dies, you can pick up where you left off.
- **Retry wrapper:** Every tool call gets a try/catch with at least one automatic retry and exponential backoff.
- **Schema validator:** Every LLM output is validated against a JSON schema before it's accepted. Malformed output triggers a retry, not a crash.
- **Tool output truncation:** Hard-cap every tool payload to a fixed token budget. Silent truncation inside the context window is one of the most common causes of hallucination.

These four components can be built in a single afternoon. Once your agent can fail gracefully, it is worth making it smarter.

## Conclusion

The future of software is agent-first. As models gain the raw capability to autonomously generate and verify complex systems, the human contribution shifts away from writing syntax and toward designing the constraints that make autonomous execution reliable.

The best builders of the next decade will be the ones who engineer the best harnesses: the strongest reins for the fastest horses. Those reins are the consistent application of a few principles: constrain, externalize, verify, and recover.

---

*For the implementation details behind each layer (state storage, verification nodes, Sprint Contracts, and where to start) see the companion FAQ:*
[**Harness Engineering from Theory to Production**](/posts/agents/harness-engineering-faq.md)