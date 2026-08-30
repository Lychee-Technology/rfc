# Contributing

This repository holds bilingual (English and Chinese) RFCs and technical specifications. This guide records the markdown style rules the documents follow. The rules were established during the prose cleanup in PR #20 and codified per issue #23. They apply to all markdown files in this repository.

中文版见[下文](#贡献指南中文)。

## Markdown style rules

### 1. Headings

- Write headings in sentence case: capitalize only the first word and proper nouns, for example `## 2. Authentication, scope, and shared conventions`.
- Use `#` markers only; never wrap heading text in `**bold**`.
- Renaming an existing heading changes its anchor. Check inbound links, both inside this repository and in downstream consumers, before rewording a heading.

### 2. Dashes and punctuation

- English prose: do not use a spaced em dash (` — `) as a separator. Use a comma, a colon, or parentheses instead. An em dash acting as a connector inside a heading, such as `AAA System — Technical Specification`, is acceptable.
- Chinese prose: use full-width punctuation (`，`/`：`/`（）`) and keep the native Chinese dash `——`.
- These rules apply to prose only. A `—` placeholder in a table cell is fine.

### 3. Bold

Bold must carry meaning. Keep it for:

- normative negation: `**not**` / `**不**`
- warnings: `**Warning**` / `**注意**`
- the first occurrence of a term being defined
- UI control names
- label items that introduce an independent fact or block, such as `**Supported placeholders:**` or `**示例：policy profile**`

Do not use decorative bold: ordinary nouns, whole sentences, or list-item lead-ins that merely restate a nearby heading.

## What style edits must not touch

Style-only changes must leave the technical substance byte-for-byte intact: code fences, JSON/YAML/SQL, mermaid and ASCII diagrams, tables, endpoint paths, field names, error codes, and link targets.

## Machine checks

The three rules above are enforced by custom markdownlint rules, added per issue #27. Stock markdownlint could not express them: issue #23 confirmed none of the three maps to a stock rule, and the closest one, MD036 (no emphasis as heading), false-positives on the label items rule 3 allows (for example `**示例：policy profile**`). prettier remains out of scope: it only normalizes whitespace and line wrapping.

- The rules live in `.markdownlint/rules/` (`heading-sentence-case`, `no-spaced-em-dash`, `semantic-bold-only`), with tests in `.markdownlint/test/` and configuration in `.markdownlint-cli2.jsonc`.
- Run `npm install` once, then `npm run lint`; `npm test` runs the rule tests. CI runs both on every pull request.
- Rule 3 is heuristic by design: it only flags whole-line bold that reads as a sentence or pseudo-heading, and bold that restates the nearby heading. Subtler decorative bold still relies on review.
- Documents whose headings predate rule 1 are listed in the rule's `ignoreFiles`: renaming a heading changes its anchor, so they are exempt rather than rewritten. Do not add new files to that list; remove an entry once a document's headings are cleaned up.
- Stock markdownlint rules stay off. If they are ever enabled, keep MD025 (single-title) exempt for this file's intentional dual-H1 bilingual layout; the inline marker before the Chinese title below already covers it.

---

<!-- markdownlint-disable-next-line MD025 -->
# 贡献指南（中文）

本仓库存放中英双语的 RFC 与技术规范。本文固化文档遵循的 Markdown 风格规则：规则形成于 PR #20 的 prose 清理，依 issue #23 落地，适用于仓库内全部 Markdown 文件。

## Markdown 风格规则

### 1. 标题

- 标题使用句首大写（sentence case）：仅首词与专有名词大写，例如 `## 2. Authentication, scope, and shared conventions`。
- 只用 `#` 标记标题，不用 `**粗体**` 包裹标题文本。
- 修改既有标题会改变锚点。改动前先确认仓库内外的引用链接。

### 2. 破折号与标点

- 英文 prose 不用带空格的 em dash（` — `）作分隔符，改用 `,`/`:`/`()`。标题内作为连接符的 em dash（如 `AAA System — Technical Specification`）可以保留。
- 中文 prose 使用全角标点（`，`/`：`/`（）`），保留中文原生破折号 `——`。
- 以上仅约束 prose。表格单元格中的 `—` 占位符可保留。

### 3. 加粗

加粗必须承载语义，仅保留以下用法：

- 规范性否定：`**not**` / `**不**`
- 警告：`**Warning**` / `**注意**`
- 术语首次定义
- UI 控件名
- 引出独立事实或内容块的标签项（如 `**Supported placeholders:**`、`**示例：policy profile**`）

不使用装饰性加粗：普通名词、整句加粗、与临近标题重复的列表引导词。

## 风格修改的边界

纯风格修改不得改动技术实质：代码块、JSON/YAML/SQL、mermaid 与 ASCII 图、表格、端点路径、字段名、错误码、链接目标须逐字节保持不变。

## 机器校验

三条规则已由自定义 markdownlint 规则强制执行（依 issue #27 落地）。现成规则无法表达：issue #23 已确认三条规则均无 stock 规则可对应，最接近的 MD036（禁止用强调充当标题）会误报规则 3 允许的标签项（如 `**示例：policy profile**`）。prettier 仍不在范围内：它仅规整空白与换行。

- 规则位于 `.markdownlint/rules/`（`heading-sentence-case`、`no-spaced-em-dash`、`semantic-bold-only`），测试在 `.markdownlint/test/`，配置在 `.markdownlint-cli2.jsonc`；
- 首次运行 `npm install`，之后 `npm run lint` 执行校验，`npm test` 运行规则测试。CI 在每个 pull request 上运行两者；
- 规则 3 有意保持启发式：仅标记读起来像整句或伪标题的整行加粗，以及与临近标题重复的加粗。更细微的装饰性加粗仍依赖评审；
- 标题早于规则 1 的存量文档列在该规则的 `ignoreFiles` 中：修改标题会改变锚点，因此豁免而非改写。不要向该清单添加新文件；某文档标题清理完毕后应移除对应条目；
- stock markdownlint 规则保持关闭。若未来启用，需为本文件有意的双 H1 双语结构保留 MD025（单一标题）豁免；中文标题前的 inline 标记已覆盖。
