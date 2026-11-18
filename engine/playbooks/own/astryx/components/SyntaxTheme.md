# SyntaxTheme
Group: Utilities. Category: Utility.
Import: import { SyntaxTheme } from '@astryxdesign/core';

Applies syntax highlighting colors to CodeBlock and any code component in the subtree. By default, code components use the theme-level syntax colors (set via defineTheme({ syntax: ... })), which derive from the palette (--color-text-accent for keywords, --color-text-green for strings, etc.). SyntaxTheme lets you override those per-region. The system uses 14 semantic tokens (keyword, string, comment, number, function, type, variable, operator, constant, tag, attribute, property, punctuation, background) validated against 11 community themes. Custom themes are created with defineSyntaxTheme() and can use [light, dark] tuples for automatic color-scheme adaptation. Built-in presets: oneDarkPro, dracula, monokai, nord, tokyoNight, catppuccinMocha, githubLight, githubDark, solarizedLight, oneLight (import from @astryxdesign/core/theme/syntax).

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| theme | SyntaxTheme |  | yes | syntax highlighting theme: preset from @astryxdesign/core/theme/syntax or custom theme created w/ defineSyntaxTheme() |
| children | ReactNode |  | yes | Content subtree. All CodeBlock components within will use this syntax theme. |

## Do
- Use syntax field in defineTheme() for app-wide code styling. Use SyntaxTheme only when a specific section needs different look.
- Pick from built-in presets or create custom theme w/ defineSyntaxTheme() for brand-specific colors.
- Syntax themes support light-dark() tuples: each token can have different values for light/dark mode, resolved automatically by color scheme.
- Single CodeBlock: pass syntaxTheme prop (shorthand for wrapping in SyntaxTheme). Whole region of code components: wrap w/ SyntaxTheme.
