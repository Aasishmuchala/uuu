# Markdown
Category: Content.
Import: import { Markdown } from '@astryxdesign/core';

Renders markdown string as Astryx-styled components. Use for user-generated content, AI responses, docs. Headings, lists, tables, code, citations w/ consistent styling.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | string |  | yes | markdown string |
| display | 'block' \| 'inline' | 'block' |  | Display type. Markdown defaults to block. Use 'inline' for markdown spans embedded inside text. |
| density | 'default' \| 'compact' | 'default' |  | Block spacing. 'default'\|'compact'. Default: 'default'. |
| headingLevelStart | 1 \| 2 \| 3 \| 4 \| 5 \| 6 | 1 |  | Maps # to this heading level (1-6). Clamped to h6. Default: 1. |
| isStreaming | boolean | false |  | Incremental parse + fade-in for streamed chunks. Default: false. |
| onLinkClick | (href: string, event: MouseEvent) => void \| false |  |  | (href, event) => void\|false. Return false prevents navigation. Link destinations follow the shared navigation rule (see Link href), and every data: link or image URL is also dropped; rejected ones render as text. |
| sources | Record<string, MarkdownSource> |  |  | Record<string, MarkdownSource>. Citation sources by ID. [id]/【id】 markers render as chips. |
| citationStyle | 'label' \| 'number' | 'label' |  | 'label'\|'number'. label=chip w/ title+icon, number=compact badge. Default: 'label'. |
| contentWidth | number \| string | 680 |  | number\|string. Max width for prose (headings, paragraphs, lists). Tables/code unconstrained. |
| contentAlign | 'start' \| 'center' | 'start' |  | 'start'\|'center'. Prose alignment when contentWidth < container. Default: 'start'. |
| plugins | readonly MarkdownPluginEntry[] |  |  | readonly MarkdownPluginEntry[]. Ordered syntax, immutable AST transforms, and typed extension renderers from createMarkdownPlugin(), plus first-party helpers such as createMarkdownHeadingLinks(). Default: omitted or empty. |
| inlinePlugins | MarkdownInlinePlugin[] |  |  | MarkdownInlinePlugin[]. Regex matches in text nodes -> custom inline React elements. Skips inline/fenced code and math. |
| autolink | 'gfm' |  |  | 'gfm'. Opt-in GFM autolinking: bare URLs (https?://, www.), <scheme:url>, <email>, user@host. Skips code, code blocks, existing links. Default: off. |
| codeLanguages | ReadonlyArray<CodeLanguage> |  |  | CodeBlock language values a fence may name, each imported on its own (e.g. graphql from @astryxdesign/core/CodeBlock/languages/graphql) or made with createCodeLanguage. A fence whose language word is one of a listed value's identifiers renders with it, ahead of a built-in; a diff-<identifier> fence takes the diff layer over it; a later entry wins. Pass the same list to RichTextEditor or RichTextView so read and edit match. |
| components | MarkdownComponents |  |  | MarkdownComponents. Custom renderers; math({value, display}) opts into $…$/$$…$$ parsing. Renderer owns output and accessibility. |
| xstyle | StyleXStyles |  |  | stylex.create() for layout (margins, sizing). |
| className | string |  |  | CSS class. Prefer xstyle. |
| style | CSSProperties |  |  | Inline styles. Prefer xstyle. |
| data-testid | string |  |  | Test selector. |

## Do
- Set headingLevelStart to match the page hierarchy, e.g. start at 3 if the markdown sits inside an h2 section.
- Use contentWidth to keep prose at a readable line length in wide layouts.
- Emphasis and strong pair as CommonMark specifies, so *see **bold** more* puts the bold inside the emphasis. ***text*** renders as strong around emphasis, the order RichText draws, and is announced as both. Emphasis nested more than 100 levels deep stays as written text.
- Use plugins created by createMarkdownPlugin for reusable syntax, immutable AST transforms, and typed extension rendering. Keep the ordered list stable while its syntax configuration is unchanged.
- To render a plugin node outside Markdown, as another surface showing the same document does, read what the plugin declares with getMarkdownPluginCapabilities (syntax and transform, nothing else), and render each parsed extension node with MarkdownPluginNodeRenderer from the client-only @astryxdesign/core/Markdown/plugin-renderer subpath. It presents the node exactly as Markdown does, fallbacks and failure reports included, with no element of its own.
- Add markdownSoftBreaksPlugin when single line endings are meaningful. It matches remark-breaks for supported Markdown, including multiline link labels, while code and other opaque content stay unchanged.
- Add markdownSourceLinesPlugin when a feature maps the rendered document back to Markdown source lines (find, highlights, review comments). Every block Markdown renders, nested blocks included, then carries data-source-line and data-source-line-end (1-based, inclusive); components block renderers receive sourceLines to place on their own element, and plugin renderers read node.position lines. Inline elements, table rows, and cells carry none. Without the plugin no line work runs.
- Use createMarkdownTextTransform for prose matching; it preserves code, links, images, citations, math, and accepted extension syntax as protected contexts. Provide requiredSubstrings only when they conservatively cover every possible match.
- Use createMarkdownFenceTransform for declared code-fence languages with semantic data. createNode returns an owned block extension node; its standard plugin renderer and toText own presentation. A claimed fence renders through that plugin even when components.code is supplied; components.code renders every unclaimed fence and is the fallback when the plugin renderer declines, throws, or suspends, and without it the accessible, copyable CodeBlock is that fallback.
- Use createMarkdownSourceDecoration to attach non-visual metadata — search hits, review annotations — to the blocks a source range touches, and getMarkdownSourceDecorations to read it back in a later plugin. Decorations appear on the settled document rather than on partial streaming chunks, and never change rendering, copyable text, accessible names, ids, focus order, or navigation.
- Import parseMarkdownAst or parseInlineAst from @astryxdesign/core/Markdown/parser when server or React Server Component code needs to run plugins against the canonical readonly tree. The parser and plugin subpaths have no use-client boundary. The Markdown component remains client-owned, so function-bearing plugin entries must not be passed across an RSC serialization boundary.
- Use decodeMarkdownCharacterReferences (from @astryxdesign/core/Markdown/parser or @astryxdesign/core/Markdown) to show text the way Markdown renders its character references: &copy;, &#169;, and &#xA9; become ©, while unknown names and references without their semicolon stay as written. It decodes plain text and knows nothing of Markdown, so skip code and backslash-escaped references yourself. It uses the same table Markdown renders with.
- Use createMarkdownFrontmatter for typed document metadata. Its parse() method gives the host metadata directly; its plugin removes a complete leading block before rendering and withholds an unfinished block during streaming.
- Import createMarkdownRemarkTransform from '@astryxdesign/core/Markdown/remark' only to reuse an existing synchronous transform-only Remark plugin; it stays out of every other bundle. Prove each plugin with fixtures: anything outside the supported MDAST subset — async work, parser or compiler plugins, processor state, raw HTML, unsupported nodes, forged positions, or metadata Astryx cannot represent — keeps the last valid document and reports one diagnostic.
- Use inlinePlugins for prefixed identifiers, mentions, and other prose-only shorthand instead of preprocessing the markdown string.
- Provide components.math only for documents that use dollar-delimited math. The renderer owns typesetting and accessible output; Astryx passes the expression as text and never executes raw HTML.
- For direct parsing, use MathParseOptions and handle InlineNodeWithMath or BlockNodeWithMath. Incremental math parsing also uses createIncrementalState<true>() and IncrementalParseState<true>; default calls and ParseOptions annotations keep the legacy unions.
- Install createMarkdownHeadingLinks() through plugins when a document needs copyable h1–h6 permalinks. The returned entry carries its validated namespace and URL base across compatible Core package copies. Each built-in heading keeps its incoming fragment ID and gains an inline trailing # copy button: it is hidden at fine-pointer rest through useContainerReveal, reveals on heading-row hover or keyboard focus, and stays visible under the hook’s coarse/touch semantics. Unmodified tap, click, Enter, or Space copies the canonical URL without navigation, hash mutation, or scrolling; a check confirms success for 1.5 seconds. The no-plugin path stays unchanged, and nested headings use the same depth-first identity projection as Markdown-derived Outline.
- For multiple documents, create one heading-links plugin per document with headingIdPrefix and pass that same plugin to Markdown and useOutlineFromMarkdown. Use the same stable value for Markdown id when the root also needs a DOM id; permalinkBaseUrl may supply a safe caller-owned URL before the fragment.

## Do not
- Use Markdown for hand-authored layouts; use Text and Heading directly when you control the content.

## Example
```jsx
import {Text} from '@astryxdesign/core/Text';

<Text>
  This description includes{' '}
  <Markdown display="inline">{'`inline code` and **bold text**'}</Markdown>
  .
</Text>;
```
