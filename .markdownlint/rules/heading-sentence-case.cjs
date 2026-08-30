// @ts-check
// CONTRIBUTING.md rule 1: write headings in sentence case, capitalizing only
// the first word and proper nouns. See issue #27.
//
// What counts as a violation:
//   - the first alphabetic word of a heading starting lowercase;
//   - any later word matching Xxxx (initial capital, rest lowercase) that is
//     not exempted below.
// Exempt: headings containing CJK text (Chinese title conventions differ),
// code spans, acronyms and mixed-case product words (AAA, OAuth, LTBase),
// single capital letters (Appendix A), the first word after a colon or an
// em dash connector, configured proper nouns (`properNouns`, words or
// phrases), and files listed in `ignoreFiles` (legacy documents whose
// headings are kept for anchor stability).

const { walkTokens, descendantsByType, isIgnoredFile } = require("./token-helpers.cjs");

const CJK = /[㐀-鿿豈-﫿]/;
// Xxxx word: capitalized, rest lowercase, at least two letters. The second
// character must be a letter so that contractions of the pronoun I (I'm,
// I've) stay exempt like the bare pronoun.
const CAPITALIZED_WORD = /^[A-Z][a-z][a-z'’]*$/;
const LOWERCASE_WORD = /^[a-z'’]+$/;
const NUMBERING = /^\d+(\.\d+)*\.?$/;
// A chunk that ends a segment: trailing colon, or sentence-final punctuation.
const SEGMENT_END = /[:：.?!]$/;

// Rebuilds the heading text with code-span content blanked out so that
// capitalized identifiers inside backticks are never inspected.
function headingProseText(headingTextToken) {
  let text = "";
  walkTokens(headingTextToken.children || [], (token, ancestors) => {
    if (token.type === "data" && !ancestors.some((a) => a.type === "codeText")) {
      text += token.text;
    } else if (token.type === "codeText") {
      text += " X "; // single-capital placeholder, never flagged in any position
    }
  });
  return text;
}

function removeProperNouns(text, properNouns) {
  let result = text;
  for (const noun of properNouns) {
    if (!noun) {
      continue;
    }
    const escaped = noun.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    result = result.replaceAll(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"),
      // Single capital letter: passes both the capitalized-first-word check
      // and the mid-segment check, so allowlisted words are never flagged.
      "X"
    );
  }
  return result;
}

// Splits a whitespace-delimited chunk into bare words (hyphenated compounds
// yield one word per part), stripping surrounding punctuation.
function wordsOfChunk(chunk) {
  return chunk
    .split(/[-–]/)
    .map((part) => part.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, ""))
    .filter((part) => part.length > 0);
}

function findViolations(text) {
  const violations = [];
  let atSegmentStart = true;
  let isFirstWord = true;
  for (const chunk of text.split(/\s+/)) {
    if (chunk.length === 0) {
      continue;
    }
    if (chunk === "—" || chunk === "–") {
      atSegmentStart = true;
      continue;
    }
    const words = wordsOfChunk(chunk);
    if (words.length === 0) {
      continue;
    }
    if (words.length === 1 && NUMBERING.test(words[0])) {
      // Numbering such as `2.` or `3.1` is never a word, but a trailing
      // colon (`Section 1:`) still opens a new segment.
      if (SEGMENT_END.test(chunk)) {
        atSegmentStart = true;
      }
      continue;
    }
    for (const word of words) {
      if (isFirstWord) {
        // The very first word must be capitalized, unless it is not a plain
        // alphabetic word (file names, identifiers, numbers).
        if (LOWERCASE_WORD.test(word) && words.length === 1 && !chunk.includes(".")) {
          violations.push(word);
        }
        isFirstWord = false;
      } else if (
        !atSegmentStart &&
        CAPITALIZED_WORD.test(word)
      ) {
        violations.push(word);
      }
      atSegmentStart = false;
    }
    if (SEGMENT_END.test(chunk)) {
      atSegmentStart = true;
    }
  }
  return violations;
}

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["LTB001", "heading-sentence-case"],
  description: "Heading is not in sentence case",
  tags: ["ltbase", "headings"],
  parser: "micromark",
  function: function LTB001(params, onError) {
    const config = params.config;
    const properNouns = Array.isArray(config.properNouns) ? config.properNouns : [];
    const ignoreFiles = Array.isArray(config.ignoreFiles) ? config.ignoreFiles : [];
    if (isIgnoredFile(params.name, ignoreFiles)) {
      return;
    }
    walkTokens(params.parsers.micromark.tokens, (token) => {
      if (token.type !== "atxHeading") {
        return;
      }
      const [headingText] = descendantsByType(token, ["atxHeadingText"]);
      if (!headingText || CJK.test(headingText.text)) {
        return;
      }
      const prose = removeProperNouns(headingProseText(headingText), properNouns);
      const violations = findViolations(prose);
      if (violations.length > 0) {
        onError({
          lineNumber: token.startLine,
          detail:
            `Not sentence case: ${violations.join(", ")}. Capitalize only ` +
            "the first word and proper nouns; add real proper nouns to " +
            "properNouns in .markdownlint-cli2.jsonc",
          context: headingText.text,
        });
      }
    });
  },
};
