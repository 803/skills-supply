# Refactoring Tools and AI for Naming

## Classic Refactoring Patterns (Fowler, 1999)

Naming-specific patterns:
- **Rename Method/Field**: Change name to better reveal purpose
- **Move Method/Field**: Relocate to more appropriate class (often paired with renaming)
- **Extract Method**: Pull code into new named function (forces naming decision)
- **Introduce Parameter Object**: Replace parameter lists with named object

**Key principle**: Each refactoring step should address one specific aspect. Don't simultaneously rename, optimize, and add features.

## Large-Scale Rename Tools

### jscodeshift (Facebook)

AST-based transformation toolkit for JavaScript/TypeScript:

```typescript
// Example: rename-variable.ts
import { Transform } from 'jscodeshift';

const transform: Transform = (file, api) => {
  const j = api.jscodeshift;
  const root = j(file.source);

  root.find(j.Identifier, { name: 'oldVariable' })
      .replaceWith(j.identifier('newVariable'));

  return root.toSource();
};
```

**Best practices:**
1. Use AST Explorer (astexplorer.net) to understand code structure
2. Write unit tests for codemods before running
3. Run with `--dry` flag first to preview changes
4. Consider creating reversible codemods for safety

### IDE Rename Refactoring

**JetBrains IDEs** (`Shift+F6`):
- Context-aware, understands code structure
- Updates all references across project
- Prevents broken references

**VS Code** (`F2`):
- Rename Symbol
- Extract Method
- Update imports automatically

## Linting for Naming Conventions

### ESLint @typescript-eslint/naming-convention

Configurable rule for enforcing naming patterns:
- Variables (camelCase, PascalCase, UPPER_CASE)
- Functions and methods
- Classes and interfaces
- Type aliases and enums

### Other Tools

| Tool | Focus | Naming Support |
|------|-------|----------------|
| ESLint/TSLint | Style + logic | Configurable naming rules |
| PMD | Best practices | Naming pattern detection |
| SonarQube | Quality gates | Inconsistent naming smell |
| Pylint | Python standards | PEP 8 naming enforcement |
| Checkstyle | Java style | Naming conventions |

## AI/LLM Tools for Naming

### Neural Method Name Prediction

**code2vec (Alon et al., POPL 2019):**
- Represents code as paths through AST
- Learns to predict method names
- **75% relative improvement** over previous techniques
- Captures semantic similarities and analogies in method names

**CodeT5 (EMNLP 2021):**
- Uses Identifier Tagging and Masked Identifier Prediction
- Specifically designed to understand role of identifiers

**GraphCodeBERT (Microsoft):**
- Extends CodeBERT with data flow information
- Captures relationships between variables

### Commercial AI Assistants

**GitHub Copilot:**
- Setting: `github.copilot.renameSuggestions.triggerAutomatically`
- Analyzes function names, variable names, comments, file content
- Best practice: Use clear function names for better suggestions

**Claude/ChatGPT:**
- Style matching - observes existing patterns and continues them
- Can be configured with style instructions in CLAUDE.md

### Limitations of AI Naming

Research notes AI-generated code often:
- Lacks readability and consistency
- May use non-standard naming conventions
- May not conform to team's coding style

**Recommendation:** Use AI suggestions as starting points, validate against team standards.

## Code Review Practices for Naming

### Structured Review Checklist

Naming-specific review items:
- Variable, function, and class names follow project standards
- Names are consistently applied across codebase
- Names are descriptive and reveal purpose
- Abbreviations are avoided unless widely understood
- Positive variable names preferred (`allow` vs `prevent`)

### Anti-Patterns to Flag in Review

- **Moving goalpost**: "Use more descriptive names" then "These are too verbose"
- **Style-as-architecture**: "Use this pattern because I like it" without explaining why
- **Single-letter variables** (except loop indices)
- **Non-universal abbreviations**

## Recommended Workflow

1. **Establish conventions**: Document naming standards in style guide
2. **Automate enforcement**: Configure ESLint/linter rules
3. **Use IDE tooling**: Leverage rename refactoring for safe, project-wide changes
4. **For large migrations**: Use jscodeshift codemods or AI-assisted refactoring
5. **Code review**: Include naming checks in review checklist
6. **AI assistance**: Use for suggestions, but validate against standards

## Sources

- Martin Fowler, "Refactoring" (1999)
- facebook/jscodeshift (GitHub)
- Uri Alon et al., "code2vec: Learning Distributed Representations of Code" (POPL 2019)
- Microsoft Research - Code Intelligence
- @typescript-eslint documentation
