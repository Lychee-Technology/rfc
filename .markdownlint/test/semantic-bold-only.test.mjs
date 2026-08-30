import test from "node:test";
import assert from "node:assert/strict";
import rule from "../rules/semantic-bold-only.cjs";
import { runRule, errorLines } from "./harness.mjs";

test("flags a whole-paragraph bold sentence", () => {
  const errors = runRule(rule, "**This is a whole bold sentence.**\n");
  assert.deepEqual(errorLines(errors), [1]);
});

test("flags a long whole-paragraph bold phrase without a colon", () => {
  const md = "**Deployment architecture and rollout considerations for production**\n";
  assert.deepEqual(errorLines(runRule(rule, md)), [1]);
});

test("flags a whole-line bold Chinese sentence", () => {
  const errors = runRule(rule, "**这是一个整句加粗的中文句子。**\n");
  assert.deepEqual(errorLines(errors), [1]);
});

test("flags a bold lead-in that restates the nearest heading", () => {
  const md = "## Deployment model\n\n- **Deployment model**: uses zip artifacts\n";
  assert.deepEqual(errorLines(runRule(rule, md)), [3]);
});

test("flags whole-line bold that restates a numbered heading", () => {
  const md = "## 3. Trust boundaries\n\n**Trust boundaries:**\n";
  assert.deepEqual(errorLines(runRule(rule, md)), [3]);
});

test("allows a label item ending with a colon", () => {
  assert.deepEqual(runRule(rule, "**Supported placeholders:**\n"), []);
});

test("allows a label item with a Chinese colon inside", () => {
  assert.deepEqual(runRule(rule, "**示例：policy profile**\n"), []);
});

test("allows a short warning word", () => {
  assert.deepEqual(runRule(rule, "**Warning**\n\n**注意**\n"), []);
});

test("allows inline semantic bold", () => {
  assert.deepEqual(runRule(rule, "Do **not** delete the vault.\n"), []);
});

test("allows a bold lead-in that does not restate a heading", () => {
  const md = "## Deployment model\n\n- **Timeout**: retry after five seconds\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("allows an example label with an em dash and trailing colon", () => {
  const md = "**Example 1 — request data overrides LLM output:**\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("allows a colon label whose title ends with a question mark", () => {
  const md = "**Appendix C: Why Lambda Zip Artifacts?**\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("still flags a whole-line bold question without a colon", () => {
  const md = "**Why would anyone deploy it this way?**\n";
  assert.deepEqual(errorLines(runRule(rule, md)), [1]);
});

test("ignores bold inside tables", () => {
  const md = "| a | b |\n|---|---|\n| **Strongly Worded Bold Cell Value Here** | x |\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("skips files listed in ignoreFiles", () => {
  const errors = runRule(
    rule,
    "**This is a whole bold sentence.**\n",
    { ignoreFiles: ["EN/legacy.md"] },
    "EN/legacy.md"
  );
  assert.deepEqual(errors, []);
});
