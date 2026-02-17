# **Best Practice Guide: Nested `AGENTS.md` Context Files**

## **Core Concept: Progressive Disclosure**

Instead of maintaining a single, monolithic `AGENTS.md` at the root of your repository, leverage **nested context files**. Place smaller, specific `AGENTS.md` (or `CLAUDE.md`) files inside relevant subdirectories.

This strategy forces the agent to load instructions **only when they are relevant**, specifically when the agent reads or touches files within that specific folder.


## **Why Use Nested Files?**

### **1. Superior Attention Management**

Large context files degrade model performance because the "attention layer" of the LLM struggles to prioritize specific rules buried in a long document.

* **The Fix:** By splitting instructions, the model only sees the 15 lines relevant to the *current* task, granting those instructions higher importance and adherence.

### **2. Eliminating Context Rot**

Every unnecessary token in the context window degrades the quality of future outputs.


* **The Fix:** Progressive disclosure ensures the agent isn't burdened with database rules when working on CSS, or frontend rules when writing backend logic.  
  
### **3. Scalability & Ownership**

In large teams or monorepos, a single file causes merge conflicts and ownership ambiguity.

* **The Fix:** Assign specific roles or teams to own specific folders. If one team changes the billing logic, they only update src/billing/AGENTS.md. This results in zero overlap and no merge conflicts.

## **The Hierarchy Strategy**

### **1. The Root File (Global Context)**

Keep this **extremely lean** (under 15 lines). Include only universally applicable truths:

* Global package manager instructions (e.g., "Always use pnpm").  
* High-level architectural constraints (e.g., "This is a Monorepo structured by domain, not layer").

### **2. The Feature/Module File (Local Context)**

Place these in subfolders (e.g., /src/auth/ or /src/database/). These should clarify **"Tribal Knowledge"** specific to that domain.

* **Domain Logic:** "Auth goes through Middleware X, not Controller Y".

* **Intent:** "Why is this implemented this way?" (Answers to questions a fresh human would ask) .

* **Length:** Keep these short (e.g., ~80 tokens or <15 lines).

## **Implementation Notes**

* **Trigger Mechanism:** Most advanced coding agents (including OpenCode and Claude Code) automatically pull these files into context when a sibling or child file is accessed.  
  
* **Claude Code Specifics:** For Claude Code, these are typically named `CLAUDE.md`. While native support for nested files varies by version, they are generally detected or can be symlinked if strictly necessary.

* **Anti-Pattern:** Do not use "References" folders or static instructions that refer the LLM to other files (e.g., "See docs/db.md for schema"). This is an anti-pattern; the context must be automatic and immediate.  
