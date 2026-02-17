# **The Definitive Guide to Writing `AGENTS.md`**

## **Executive Summary**

Recent research indicates that **LLM-generated context files reduce coding agent performance by ~3%** and increase costs by over 20%. However, **developer-curated** files can improve success rates by `~4%`.

An effective `AGENTS.md` is not a project summary; it is a set of **hard constraints and tribal knowledge** that prevents the agent from making expensive mistakes. It should be treated as "notes for a new senior engineer", not a README for a user.

## **I. Core Philosophy: The "Negative Constraint" Approach**

Do not describe *what* the project is (the agent can figure that out from the code). Describe **what the agent typically gets wrong**.

### **1. Minimal Requirements Only**

The paper proves that "unnecessary requirements from context files make tasks harder". Agents waste tokens and reasoning steps navigating verbose instructions.

* **Goal:** Reduce the search space for the agent.  
* **Metric:** Keep files under 200 lines (or even <15 lines for sub-modules).

### **2. Guardrails Over Guidance**

Use the file to stop "dumb things".

* **Anti-Patterns:** List patterns the agent should **never** use (e.g., "Do not use TypeVar" or "Never modify shared proto files directly").  
* **Style Enforcement:** Enforce conventions that linters miss (e.g., "We use Result types for errors, never throw exceptions").

### **3. Tribal Knowledge (The "Why")**

Include information that cannot be inferred from the code itself.

* **Intent:** "Why is this architecture weird?" (e.g., "Auth goes through middleware X, not controller Y") .  
* **Gotchas:** "Don't touch the legacy billing module; it is being replaced next sprint".

## **II. The `AGENTS.md` Structure Template**

Do not use a generic template. Use this functional structure optimized for token efficiency and instruction following.

### **Section 1: Non-Obvious Build & Test**

*Standard commands (like npm test) are often guessed correctly by agents. Only document deviations.*

**Example:**

* "Run migrations (make migrate) before running tests."  
* "Integration tests require the Docker container `db_test` to be active."  
* "Use uv instead of pip for package management."

### **Section 2: Critical Architecture Constraints**

*Rules that prevent "working" code that violates system design.*

**Example:** 

* **UI:** "Never generate React code; this is a Vue codebase."
* **DB:** "All database access must go through the Repository pattern. Do not write raw SQL in controllers."  
* **Deps:** "Do not introduce new dependencies without checking package.json for existing alternatives."

### **Section 3: The "Do Not" List (Guardrails)**

*Explicit prohibitions based on past agent failures.*

**Example:**

* "Do not delete the tmp file during cleanup." 
* "Do not try to fill knowledge gaps with assumptions; stop and ask."

## **III. Advanced Strategies**

### **1. Progressive Disclosure (Nested Files)**

Instead of one massive root file, place smaller `AGENTS.md` files in specific subdirectories.

* **Root `AGENTS.md`:** Global build tools and high-level architecture (<15 lines).  
* **src/auth/AGENTS.md:** Specifics about authentication tokens and session management.  
* **Benefit:** Agents only load context relevant to the files they are touching, reducing "context rot" and cost.

### **2. The "Failure-Driven" Update Loop**

Do not write the file proactively. Write it reactively.

1. Let the agent attempt a task.  
2. If it fails or violates a convention, identify the missing knowledge.  
3. Add a **single bullet point** to `AGENTS.md` addressing that specific failure.  
4. Revert and retry.

### **3. Compiler-Based Enforcement**

Where possible, move rules from `AGENTS.md` to code/linters.

* If you tell an agent "Don't use Node APIs," it might ignore you.  
* If you configure a pre-commit hook or linter to fail on Node APIs, the agent is **forced** to correct itself.

## **IV. What to Avoid (Proven Failures)**

| Strategy                    | Reason                                                                                |
| :-------------------------- | :------------------------------------------------------------------------------------ |
| **LLM-Generated Summaries** | Reduces performance (-3%) and provides useless generic overviews.                     |
| **Codebase Overviews**      | Agents ignore them. They increase token cost and do not speed up file discovery.      |
| **Generic Formatting**      | Don't include "Overview" or "Introduction" headers. Go straight to the instructions.  |
| **Duplicate Info**          | If it is in `README.md` or `CONTRIBUTING.md`, do not repeat it. Agents read those anyway. |

