// @ts-check
// Small micromark-token helpers shared by the custom rules. markdownlint does
// not export its internal micromark helpers, so the walkers live here.

/**
 * Depth-first walk over a micromark token tree. `visit` receives each token
 * and the array of its ancestor tokens (outermost first).
 *
 * @param {readonly object[]} tokens Top-level micromark tokens.
 * @param {(token: object, ancestors: object[]) => void} visit Callback.
 * @param {object[]} [ancestors] Ancestor chain (internal).
 * @returns {void}
 */
function walkTokens(tokens, visit, ancestors = []) {
  for (const token of tokens) {
    visit(token, ancestors);
    if (token.children && token.children.length > 0) {
      ancestors.push(token);
      walkTokens(token.children, visit, ancestors);
      ancestors.pop();
    }
  }
}

/**
 * True when any ancestor has one of the given types.
 *
 * @param {readonly object[]} ancestors Ancestor chain.
 * @param {readonly string[]} types Token types to look for.
 * @returns {boolean}
 */
function hasAncestorOfType(ancestors, types) {
  return ancestors.some((token) => types.includes(token.type));
}

/**
 * Collects all descendant tokens of the given types.
 *
 * @param {object} token Root token.
 * @param {readonly string[]} types Token types to collect.
 * @returns {object[]}
 */
function descendantsByType(token, types) {
  const result = [];
  walkTokens(token.children || [], (child) => {
    if (types.includes(child.type)) {
      result.push(child);
    }
  });
  return result;
}

/**
 * True when the file being linted matches an `ignoreFiles` entry. Entries are
 * repository-relative paths; matching is by exact path or path suffix so the
 * rules behave the same for absolute and relative lint invocations.
 *
 * @param {string} name File name being linted.
 * @param {readonly string[]} ignoreFiles Configured ignore list.
 * @returns {boolean}
 */
function isIgnoredFile(name, ignoreFiles) {
  const normalized = name.replaceAll("\\", "/");
  return ignoreFiles.some((entry) => {
    const suffix = entry.replaceAll("\\", "/");
    return normalized === suffix || normalized.endsWith(`/${suffix}`);
  });
}

module.exports = { walkTokens, hasAncestorOfType, descendantsByType, isIgnoredFile };
