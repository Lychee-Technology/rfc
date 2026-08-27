# Best practice guide: nested `AGENTS.md` context files

## Core concept: progressive disclosure

Instead of maintaining a single, monolithic `AGENTS.md` at the root of your repository, use nested context files. Place smaller, specific `AGENTS.md` (or `CLAUDE.md`) files inside relevant subdirectories.

The agent then loads instructions only when they are relevant, that is, when it reads or touches files within that folder.


## Why use nested files?

### 1. Superior attention management

Large context files degrade model performance because the "attention layer" of the LLM struggles to prioritize specific rules buried in a long document.

* **The fix:** Split the instructions, so the model only sees the 15 lines relevant to the *current* task. Those instructions then carry higher importance and adherence.

### 2. Eliminating context rot

Every unnecessary token in the context window degrades the quality of future outputs.


* **The fix:** With progressive disclosure, the agent is not carrying database rules while working on CSS, or frontend rules while writing backend logic.  
  
### 3. Scalability & ownership

In large teams or monorepos, a single file causes merge conflicts and ownership ambiguity.

* **The fix:** Assign specific roles or teams to own specific folders. If one team changes the billing logic, they only update src/billing/AGENTS.md, so there is no overlap and no merge conflict.

## The hierarchy strategy

### 1. The root file (global context)

Keep this very short (under 15 lines). Include only universally applicable truths:

* Global package manager instructions (e.g., "Always use pnpm").  
* High-level architectural constraints (e.g., "This is a Monorepo structured by domain, not layer").

### 2. The feature/module file (local context)

Place these in subfolders (e.g., /src/auth/ or /src/database/). These should record the tribal knowledge specific to that domain.

* **Domain logic:** "Auth goes through Middleware X, not Controller Y".

* **Intent:** "Why is this implemented this way?" (Answers to questions a fresh human would ask) .

* **Length:** Keep these short (e.g., ~80 tokens or <15 lines).

## Implementation notes

* **Trigger mechanism:** Most advanced coding agents (including OpenCode and Claude Code) automatically pull these files into context when a sibling or child file is accessed.  
  
* **Claude Code specifics:** For Claude Code, these are typically named `CLAUDE.md`. While native support for nested files varies by version, they are generally detected or can be symlinked if strictly necessary.

* **Anti-pattern:** Do not use "References" folders or static instructions that refer the LLM to other files (e.g., "See docs/db.md for schema"). This is an anti-pattern; the context must be automatic and immediate.  
