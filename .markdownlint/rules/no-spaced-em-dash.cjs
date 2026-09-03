// @ts-check
// CONTRIBUTING.md rule 2: English prose must not use a spaced em dash (" — ")
// as a separator. Exempt: code spans and fences, table cells, and em dash
// connectors inside headings. See issue #27.

const { walkTokens, hasAncestorOfType } = require("./token-helpers.cjs");

const SPACED_EM_DASH = / — /g;

// Prose text is a `data` token. Anything under these ancestors is exempt.
// (Code content never reaches here: it is tokenized as `codeFlowValue` /
// `codeTextData`, not `data` — the list below only guards fence info strings,
// table cells, headings, and raw HTML.)
const EXEMPT_ANCESTORS = [
  "atxHeading",
  "setextHeading",
  "table",
  "codeFenced",
  "codeText",
  "htmlFlow",
  "htmlText",
];

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["LTB002", "no-spaced-em-dash"],
  description: "Spaced em dash used as a separator in prose",
  tags: ["ltbase", "punctuation"],
  parser: "micromark",
  function: function LTB002(params, onError) {
    const reportedLines = new Set();
    walkTokens(params.parsers.micromark.tokens, (token, ancestors) => {
      if (token.type !== "data" || hasAncestorOfType(ancestors, EXEMPT_ANCESTORS)) {
        return;
      }
      const match = SPACED_EM_DASH.exec(token.text);
      SPACED_EM_DASH.lastIndex = 0;
      if (match && !reportedLines.has(token.startLine)) {
        reportedLines.add(token.startLine);
        onError({
          lineNumber: token.startLine,
          detail:
            "Replace the spaced em dash with a comma, a colon, or parentheses " +
            "(CONTRIBUTING.md rule 2)",
          range: [token.startColumn + match.index, 3],
        });
      }
    });
  },
};
