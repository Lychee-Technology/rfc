import { lint } from "markdownlint/sync";

// Runs a single custom rule against a markdown string and returns the
// reported errors. `config` is the rule's own configuration object.
export function runRule(rule, markdown, config, name = "doc") {
  const ruleName = rule.names[1];
  const results = lint({
    strings: { [name]: markdown },
    customRules: [rule],
    config: {
      default: false,
      [ruleName]: config === undefined ? true : config,
    },
  });
  return results[name];
}

export function errorLines(errors) {
  return errors.map((e) => e.lineNumber);
}
