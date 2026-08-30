// @ts-check
// CONTRIBUTING.md rule 3: bold must carry meaning. Full machine judgment is
// not possible (issue #27), so this rule flags only two high-confidence
// decorative patterns:
//   (a) a paragraph that consists entirely of one bold span and reads like a
//       sentence (sentence-final punctuation, or five or more words with no
//       colon), rather than a label item such as `**Supported placeholders:**`
//       or `**示例：policy profile**`;
//   (b) bold text that merely restates the nearest preceding heading.
// Everything else (inline `**not**`, warnings, UI control names, first-use
// definitions, label items) is left alone.

const { walkTokens, hasAncestorOfType, isIgnoredFile } = require("./token-helpers.cjs");

const FULL_STOP_END = /[.。]$/;
const QUESTION_BANG_END = /[!！?？]$/;
const COLON = /[:：]/;
const NUMBERING_PREFIX = /^(\d+(\.\d+)*\.?|[一二三四五六七八九十百]+、)\s*/;

function normalize(text) {
  return text
    .replace(NUMBERING_PREFIX, "")
    .replace(/[:：]\s*$/, "")
    .trim()
    .toLowerCase();
}

function isParagraphChildMeaningful(token) {
  return !(
    token.type === "htmlText" ||
    (token.type === "data" && token.text.trim().length === 0)
  );
}

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["LTB003", "semantic-bold-only"],
  description: "Bold that does not carry meaning",
  tags: ["ltbase", "emphasis"],
  parser: "micromark",
  function: function LTB003(params, onError) {
    const config = params.config;
    const ignoreFiles = Array.isArray(config.ignoreFiles) ? config.ignoreFiles : [];
    if (isIgnoredFile(params.name, ignoreFiles)) {
      return;
    }

    // Headings in document order, for the restates-a-heading check.
    const headings = [];
    walkTokens(params.parsers.micromark.tokens, (token) => {
      if (token.type === "atxHeadingText" || token.type === "setextHeadingText") {
        headings.push({ line: token.startLine, text: normalize(token.text) });
      }
    });
    const nearestHeadingBefore = (line) => {
      let found;
      for (const heading of headings) {
        if (heading.line < line) {
          found = heading;
        }
      }
      return found;
    };

    walkTokens(params.parsers.micromark.tokens, (token, ancestors) => {
      if (
        token.type !== "strong" ||
        hasAncestorOfType(ancestors, ["atxHeading", "setextHeading", "table"])
      ) {
        return;
      }
      const strongText = (token.children || []).find(
        (child) => child.type === "strongText"
      );
      if (!strongText) {
        return;
      }
      const text = strongText.text.trim();

      // (b) bold restating the nearest preceding heading
      const heading = nearestHeadingBefore(token.startLine);
      if (heading && normalize(text) === heading.text && heading.text.length > 0) {
        onError({
          lineNumber: token.startLine,
          detail:
            "Bold restates the nearby heading; drop the lead-in " +
            "(CONTRIBUTING.md rule 3)",
          context: strongText.text,
        });
        return;
      }

      // (a) whole-paragraph bold that reads like a sentence, not a label
      const paragraph = ancestors[ancestors.length - 1];
      if (!paragraph || paragraph.type !== "paragraph") {
        return;
      }
      const meaningful = paragraph.children.filter(isParagraphChildMeaningful);
      const wholeParagraphBold = meaningful.length === 1 && meaningful[0] === token;
      if (!wholeParagraphBold) {
        return;
      }
      const wordCount = text.split(/\s+/).length;
      // A colon marks a label item (`**Appendix C: Why Zip Artifacts?**`);
      // without one, question/bang endings and long phrases read as
      // sentences or pseudo-headings.
      const sentenceLike =
        FULL_STOP_END.test(text) ||
        (!COLON.test(text) && (QUESTION_BANG_END.test(text) || wordCount >= 5));
      if (sentenceLike) {
        onError({
          lineNumber: token.startLine,
          detail:
            "Whole line in bold; use a heading or plain prose instead " +
            "(CONTRIBUTING.md rule 3)",
          context: strongText.text,
        });
      }
    });
  },
};
