import test from "node:test";
import assert from "node:assert/strict";
import rule from "../rules/heading-sentence-case.cjs";
import { runRule, errorLines } from "./harness.mjs";

test("flags title-case words after the first word", () => {
  const errors = runRule(rule, "# The Quick Brown Fox\n");
  assert.equal(errors.length, 1);
  assert.match(errors[0].errorDetail, /Quick/);
  assert.match(errors[0].errorDetail, /Brown/);
  assert.match(errors[0].errorDetail, /Fox/);
});

test("flags title case in a numbered heading, allowing the word after the number", () => {
  const errors = runRule(rule, "## 2. Supported Grant Types\n");
  assert.equal(errors.length, 1);
  assert.match(errors[0].errorDetail, /Grant/);
  assert.match(errors[0].errorDetail, /Types/);
  assert.doesNotMatch(errors[0].errorDetail, /Supported/);
});

test("flags a lowercase first word", () => {
  const errors = runRule(rule, "## introduction to the system\n");
  assert.equal(errors.length, 1);
  assert.match(errors[0].errorDetail, /introduction/);
});

test("allows a sentence-case numbered heading", () => {
  const md = "## 2. Authentication, scope, and shared conventions\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("allows acronyms and mixed-case product words", () => {
  const md = "## Using OAuth and AAA with LTBase over HTTP2\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("allows capitalized words inside code spans", () => {
  const md = "## Configure `MaxRetries` and `Timeout` values\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("skips headings containing CJK text", () => {
  const md = "# 七、避免泄漏给 AI Agent 的关键控制\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("allows the first word after an em dash connector", () => {
  const errors = runRule(rule, "# AAA — Technical overview\n");
  assert.deepEqual(errors, []);
});

test("still flags later words in a segment after an em dash", () => {
  const errors = runRule(rule, "# AAA — Technical Specification\n");
  assert.equal(errors.length, 1);
  assert.match(errors[0].errorDetail, /Specification/);
  assert.doesNotMatch(errors[0].errorDetail, /Technical/);
});

test("allows the first word after a colon", () => {
  const md = "# API Specification: Intelligent agent System\n";
  const errors = runRule(rule, md);
  assert.equal(errors.length, 1);
  assert.doesNotMatch(errors[0].errorDetail, /Intelligent/);
  assert.match(errors[0].errorDetail, /Specification/);
  assert.match(errors[0].errorDetail, /System/);
});

test("allows configured proper nouns, including phrases", () => {
  const md = "## Deploying AAA System handlers with Lambda\n";
  const errors = runRule(rule, md, {
    properNouns: ["AAA System", "Lambda"],
  });
  assert.deepEqual(errors, []);
});

test("flags unlisted capitalized words even when others are allowlisted", () => {
  const md = "## Deploying Lambda Handlers\n";
  const errors = runRule(rule, md, { properNouns: ["Lambda"] });
  assert.equal(errors.length, 1);
  assert.match(errors[0].errorDetail, /Handlers/);
});

test("allows a single capital letter, as in appendix labels", () => {
  const md = "## Appendix A: reference architecture\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("does not flag lowercase file-name-like first words", () => {
  const md = "### control-plane-cli.md layout\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("skips files listed in ignoreFiles", () => {
  const md = "# The Quick Brown Fox\n";
  const errors = runRule(
    rule,
    md,
    { ignoreFiles: ["EN/legacy.md"] },
    "EN/legacy.md"
  );
  assert.deepEqual(errors, []);
});

test("treats a colon after a section number as a segment boundary", () => {
  const md = "## Section 1: Non-obvious build steps\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("allows an allowlisted lowercase brand as the first word", () => {
  const errors = runRule(rule, "# rfc\n", { properNouns: ["rfc"] });
  assert.deepEqual(errors, []);
});

test("allows the pronoun I and its contractions", () => {
  const md = "## Why do tools fail when I'm already using RAG\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("allows a heading that starts with a code span", () => {
  const md = "## `control-plane` commands\n";
  assert.deepEqual(runRule(rule, md), []);
});

test("reports the heading line number", () => {
  const errors = runRule(rule, "intro\n\n## Bad Heading Here\n");
  assert.deepEqual(errorLines(errors), [3]);
});
