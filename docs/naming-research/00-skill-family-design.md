# Naming Concepts Skill Family Design

## The Problem

Codebases accumulate naming inconsistencies over time:
- Same concept called different things in different places
- Documentation and code drift apart
- New code doesn't match existing naming patterns
- Domain language isn't captured or enforced
- Renaming is risky and rarely done well

## The Outcome We Want

A family of skills that help Claude:
1. **Identify** existing naming concepts in a codebase
2. **Review** new code for naming consistency
3. **Create** new naming concepts when needed
4. **Apply** DDD and other principles to improve naming
5. **Maintain** a living glossary that stays in sync with code

## Skill Family Structure

### 1. Foundational Skill: `naming-concepts`

**Purpose:** Explain what naming concepts are, why they matter, and introduce the vocabulary.

**Content:**
- What is a "naming concept"? (A domain term with canonical form, aliases, scope, relationships)
- Why naming matters (academic research: 20% faster defect detection, 42% time on "bad code")
- The costs of naming inconsistency (drift, cognitive load, bugs)
- Relationship to DDD Ubiquitous Language
- When to think about naming (always - it's not cosmetic)

**This skill does NOT:** Tell you how to do any specific task. It's educational context.

### 2. Sub-Skill: `reviewing-code-for-naming`

**Purpose:** Check if new code fits existing naming concepts.

**When to use:** During code review, when writing new code, after AI generates code.

**Process:**
1. Identify what domain concepts the new code touches
2. Look up existing naming for those concepts
3. Check if new code uses the same terms
4. Flag inconsistencies
5. Suggest corrections to match existing patterns

**Key insight:** This is the most frequent use case - catching drift before it happens.

### 3. Sub-Skill: `creating-naming-concepts`

**Purpose:** Define a new naming concept when one doesn't exist.

**When to use:** When introducing new domain concepts, when discovering unnamed patterns.

**Process:**
1. Identify the concept that needs naming
2. Research how similar concepts are named (in codebase, in domain)
3. Propose a canonical name
4. Document aliases (what else might someone call this?)
5. Define scope (where does this term apply?)
6. Document relationships (broader/narrower/related terms)
7. Add to glossary

**Key insight:** Library science approach - preferred term + documented variants.

### 4. Sub-Skill: `discovering-naming-concepts`

**Purpose:** Audit a codebase to find all existing naming concepts.

**When to use:** Starting on a new codebase, periodic audits, before major refactoring.

**Process:**
1. Scan for domain-specific nouns in code (classes, types, variables)
2. Look for patterns and clusters
3. Identify inconsistencies (same concept, different names)
4. Identify conflicts (same name, different concepts)
5. Build a glossary from discovered terms
6. Flag areas needing attention

**Key insight:** This is archaeology - understanding what exists before changing it.

### 5. Sub-Skill: `applying-ddd-principles-to-naming`

**Purpose:** Evaluate naming against DDD and other established principles.

**When to use:** Reviewing a glossary, evaluating naming decisions, resolving conflicts.

**Process:**
1. Check for bounded context clarity (is this term's scope clear?)
2. Check for ubiquitous language alignment (do domain experts use this term?)
3. Check for anti-patterns (misleading names, shadowing, stringly-typed)
4. Apply taxonomy principles (relationships documented? aliases captured?)
5. Recommend improvements

**Key insight:** DDD is the framework, but taxonomy and linguistic research fill gaps.

## How Skills Compose

These are independent but compose:

```
discovering-naming-concepts → create initial glossary
  ↓
applying-ddd-principles-to-naming → evaluate and improve glossary
  ↓
creating-naming-concepts → add missing concepts
  ↓
reviewing-code-for-naming → ongoing enforcement
```

But you might also:
- Use `reviewing-code-for-naming` without ever doing full discovery
- Use `creating-naming-concepts` for just one new feature
- Use `applying-ddd-principles-to-naming` to review a single term

## What Goes in the Glossary?

Each naming concept entry should have:

```yaml
term: Order          # Canonical name
aliases:             # What else might someone call this?
  - Purchase
  - Transaction
scope: sales-context # Where does this apply?
definition: >        # What does this mean?
  A customer's request to purchase one or more products
broader: Transaction # Parent concept (if any)
narrower:            # Child concepts (if any)
  - ReturnOrder
  - SubscriptionOrder
related:             # Associated concepts
  - Customer
  - Product
  - Payment
code_examples:       # Where is this used?
  - src/sales/Order.ts
  - src/sales/OrderRepository.ts
```

## Success Criteria

The skill family is working if:
1. New code uses consistent naming without being told every time
2. Naming conflicts are caught before they merge
3. The glossary is used and stays up-to-date
4. Onboarding developers can understand domain terms from the glossary
5. Code and documentation use the same language

## Research Foundation

See the other files in this directory:
- `01-ddd-ubiquitous-language.md` - DDD principles
- `02-academic-naming-research.md` - Empirical evidence on naming
- `03-taxonomy-ontology-principles.md` - Library science patterns
- `04-naming-anti-patterns.md` - What goes wrong
- `05-refactoring-tools-and-ai.md` - Tools for renaming
- `06-api-naming-conventions.md` - API-specific conventions

## Next Steps

1. Write foundational skill (`naming-concepts`)
2. Write sub-skills in order of frequency:
   - `reviewing-code-for-naming` (most common)
   - `creating-naming-concepts`
   - `discovering-naming-concepts`
   - `applying-ddd-principles-to-naming`
3. Test each skill with pressure scenarios
4. Iterate based on real usage
