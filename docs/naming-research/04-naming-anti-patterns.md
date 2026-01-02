# Naming Anti-Patterns and Failure Modes

## Documentation Decay Timeline

> "Developer documentation decays. Code changes, but docs don't. **After 6 months, documentation becomes suspect. After a year, it's often actively misleading**, which is worse than having no documentation at all." — DX Research

## The "Two Systems" Problem

### Design Systems Divergence

> "The dream: one library, used across design and code, always up-to-date. Reality: fragmentation, divergence, manual sync, and drift."

**The fundamental mismatch:** Design updates take days. Code updates take weeks or months. This timing gap alone creates endless drift.

### Case Studies

**Airbnb:** When they built their Design Language System (DLS), they encountered fragmentation, inconsistent experience between platforms, and poor documentation. Contributed to abandonment of initial design-system efforts.

**Salesforce SLDS:** Keeping up with best practices, naming conventions, and correct usage became so difficult they built a VS Code "validator" extension.

## Semantic Drift

> "Semantic drift accumulates into semantic debt, the hidden liability that bankrupts large-scale projects. Every scattered validation is a future inconsistency. Every duplicated check is a future divergence. The codebase doesn't just become messy; it becomes untrustworthy."

### How It Happens
- Same business logic appears in multiple places
- Quick copy-paste drifts over time
- Two services handle the "same" rule in slightly different ways

## Naming Debt Signs

| Sign | What It Indicates |
|------|-------------------|
| Inconsistent naming conventions | Lack of coding standards, multiple contributors without coordination |
| TODO comments from years ago | Accumulated intent/reality gap |
| Variable names that lie (e.g., `iteration_count` containing a sum) | Semantic drift, poor maintenance |
| Different modules using different terms for same concept | Domain language fragmentation |
| Long, compound names like `calculateDataAndDisplayIt()` | Functions doing too many things |
| Vague names like `DataManager`, `Utils`, `Helper` | Unclear responsibility, catch-all abstractions |

## Specific Anti-Patterns

### Shadowing Built-in Names

**65% of "str object is not callable" errors in Python** stem from overwriting built-in functions like `str`, `len`, or `dict` with variable names.

### The "Stringly Typed" Anti-Pattern

```python
# Anti-pattern: Giant if/elif dispatch
def apply_filter(posts, filter_name):
    if filter_name == "has_url":
        return filter_has_url(posts)
    elif filter_name == "english_only":
        return filter_english(posts)
    # ... grows endlessly
```

Problems:
- Parameters being hacked into signatures for new filters
- No compile-time safety
- Typos causing silent failures

### AI Refactoring Gone Wrong

Documented incident: AI code assistant performing cross-file renames introduced subtle inconsistencies:

> "The assistant had sometimes replaced `userProfile` with `user_profile` and other times with `profileUser`. Unit tests passed because mocks used the assistant-provided names selectively; integration tests failed silently."

### The "Avoided Module" Pattern

> "There is always that module in a codebase that no one wants to work on, the one with the ominous comment that reads, 'don't change this unless absolutely necessary.'"

## Ontological Conflict (John Cutler)

> "Ontological conflict occurs when concepts from different bounded contexts are treated as if they were the same object. If strategy, finance, and delivery all claim their definitions are the only right ones, or fail to acknowledge the impact of their competing definitions, this is classic model collision. 2+ domains are trying to share a noun without a translation layer."

## Legacy Naming Chaos

Research on particle accelerator control systems:

> "Legacy channels often encode subsystem structure in cryptic, fixed-length identifiers shaped by decades-old software constraints, while newer subsystems introduce more descriptive conventions but rarely update older names for backward compatibility."

## Comments That Lie

> "Many programmers assume the comments accurately describe the code" — Wikipedia Software Bug

Documented bug categories:
- **Unpropagated updates**: Programmer changes `myAdd` but forgets to change `mySubtract` which uses the same algorithm
- **Comments out of date or incorrect**
- **Differences between documentation and product**

## Key Lessons

1. **Naming errors compound**: A single bad name can shadow built-ins, create silent failures, spread through copy-paste
2. **Documentation has a half-life**: ~6 months before suspect, ~1 year before actively misleading
3. **The "two systems" problem is structural**: Design/code, docs/implementation, naming/meaning will always drift unless actively synchronized
4. **AI accelerates both creation and drift**: AI-generated code can create illusion of completeness while masking inconsistencies
5. **Legacy naming encodes historical constraints**: Cryptic identifiers may reflect software limitations from decades ago

## Sources

- DX Research - Developer Documentation
- Design Systems Collective - Critical Unsolved Challenges
- MojoTech - AI Feedback Loops
- Brainhub - Technical Debt Guide
- Wikipedia - Software Bug
- John Cutler - The Beautiful Mess
