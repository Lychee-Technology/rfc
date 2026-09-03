import test from "node:test";
import assert from "node:assert/strict";
import rule from "../rules/no-spaced-em-dash.cjs";
import { runRule, errorLines } from "./harness.mjs";

test("flags a spaced em dash in paragraph prose", () => {
  const errors = runRule(rule, "Some prose — with a spaced em dash.\n");
  assert.deepEqual(errorLines(errors), [1]);
});

test("flags a spaced em dash in list-item prose", () => {
  const errors = runRule(rule, "- first item\n- second item — with a dash\n");
  assert.deepEqual(errorLines(errors), [2]);
});

test("flags a spaced em dash inside a bold label in prose", () => {
  const errors = runRule(rule, "**Example 1 — request data overrides:**\n");
  assert.deepEqual(errorLines(errors), [1]);
});

test("flags a spaced em dash in blockquote prose", () => {
  const errors = runRule(rule, "> quoted text — with a dash\n");
  assert.deepEqual(errorLines(errors), [1]);
});

test("allows an em dash connector inside a heading", () => {
  const errors = runRule(rule, "# AAA System — Technical Specification\n");
  assert.deepEqual(errors, []);
});

test("allows em dashes inside fenced code blocks", () => {
  const md = [
    "```text",
    "PHASE 1 — pre-transaction",
    "lineage_edge — DAG parent-child edges",
    "```",
    "",
  ].join("\n");
  assert.deepEqual(runRule(rule, md), []);
});

test("allows em dashes inside a fenced code block nested in a list", () => {
  const md = [
    "- item:",
    "",
    "  ```json",
    '  { "name": "MobileDev — read own tickets" }',
    "  ```",
    "",
  ].join("\n");
  assert.deepEqual(runRule(rule, md), []);
});

test("allows em dashes inside inline code spans", () => {
  const errors = runRule(rule, "Use `a — b` in code.\n");
  assert.deepEqual(errors, []);
});

test("allows em dash placeholders and separators in table cells", () => {
  const md = [
    "| col a | col b |",
    "|-------|-------|",
    "| — | x — y |",
    "",
  ].join("\n");
  assert.deepEqual(runRule(rule, md), []);
});

test("allows the native Chinese dash without spaces", () => {
  const errors = runRule(rule, "中文破折号——不受影响。\n");
  assert.deepEqual(errors, []);
});

test("flags each offending line once even with multiple dashes", () => {
  const errors = runRule(rule, "a — b — c\n");
  assert.equal(errors.length, 1);
});

test("still flags prose around an inline code span", () => {
  const errors = runRule(rule, "Use `code` here — and prose.\n");
  assert.deepEqual(errorLines(errors), [1]);
});
