# Revised Skill Design: Single Orchestrator Approach

> **Context:** This document captures our revised approach after reviewing against `superpowers:writing-skills` and `plugin-dev:skill-development` best practices. See `00-skill-family-design.md` for the original proposal.

## What Changed

### Original Approach (00-skill-family-design.md)
- 5 separate skills
- Foundational "educational" skill (`naming-concepts`) that doesn't tell you how to do anything
- Sub-skills as independent skills

### Problems Identified
1. **Educational-only skills aren't a valid skill type** - Skills must be techniques, patterns, or references
2. **5 skills = 5 separate triggers** - Fragmented, harder to discover
3. **No shared context** - Each skill would repeat "why naming matters"
4. **No progressive disclosure** - Everything in SKILL.md instead of references/

### New Approach: Single Orchestrator
One skill (`naming`) with sub-skill documents and references. Like `systematic-debugging` which has `root-cause-tracing.md`, `defense-in-depth.md`, etc.

## Revised Structure

```
skills/
  naming/
    SKILL.md                        # Orchestrator: shared concepts + routing

    # Sub-skill techniques (loaded when routed)
    reviewing-naming.md             # Check code against existing patterns
    creating-naming-concepts.md     # Define new domain terms
    discovering-naming.md           # Audit codebase for all naming
    applying-ddd-principles.md      # Evaluate with DDD/taxonomy lens

    # Reference material (loaded as needed)
    references/
      glossary-format.md            # YAML schema for glossary entries
      naming-research.md            # Academic findings, why it matters
      ddd-principles.md             # Ubiquitous language, bounded contexts
      taxonomy-principles.md        # Library science patterns
      antipatterns.md               # What goes wrong, how to detect
```

## How It Works

### Progressive Disclosure

1. **Always loaded** (when skill triggers): `SKILL.md` (~1,500 words)
   - What is a naming concept (brief)
   - Why it matters (brief - stats only)
   - Routing: which sub-skill for which task

2. **Loaded when routed**: Sub-skill `.md` files
   - `reviewing-naming.md` - technique for code review
   - `creating-naming-concepts.md` - technique for new terms
   - `discovering-naming.md` - technique for codebase audit
   - `applying-ddd-principles.md` - technique for evaluation

3. **Loaded as needed**: `references/` files
   - Deep research, detailed formats, comprehensive principles

### Trigger Flow

```
User asks about naming consistency
         ↓
    SKILL.md loads
    (shared concepts, routing logic)
         ↓
    Agent determines sub-task:
    ├── "Review this code" → reviewing-naming.md
    ├── "Define new term" → creating-naming-concepts.md
    ├── "Audit codebase" → discovering-naming.md
    └── "Evaluate naming" → applying-ddd-principles.md
         ↓
    If deeper context needed → references/*.md
```

## SKILL.md Content Plan

### Frontmatter
```yaml
---
name: naming
description: This skill should be used when the user asks to "review naming",
  "check naming consistency", "create a naming concept", "define a domain term",
  "audit naming in codebase", "discover naming patterns", "apply DDD to naming",
  or mentions naming inconsistencies, domain terminology, or ubiquitous language.
---
```

### Body Structure (~1,500 words)

1. **Overview** (~200 words)
   - What is a naming concept: canonical term + aliases + scope + relationships
   - Why it matters: 20% faster defect detection, 42% time on bad code
   - Core principle: consistency > any specific convention

2. **Routing** (~300 words)
   - Flowchart or table: task → sub-skill
   - When to use each sub-skill
   - How sub-skills compose

3. **Shared Concepts** (~500 words)
   - Glossary entry format (brief, link to references/glossary-format.md)
   - Bounded context awareness
   - The drift problem

4. **Quick Reference** (~200 words)
   - Table of sub-skills with one-line descriptions
   - Table of references with when to load them

5. **Common Mistakes** (~300 words)
   - Not checking existing patterns before creating new terms
   - Treating naming as cosmetic
   - Skipping scope definition

## Sub-Skill Content Plans

### reviewing-naming.md (~800 words)
**Purpose:** Check if code matches existing naming patterns

**Process:**
1. Identify domain concepts touched by the code
2. Look up existing naming (glossary, existing code)
3. Compare: does new code use same terms?
4. Flag inconsistencies with specific locations
5. Suggest corrections

**When to use:** Code review, writing new code, after AI generates code

### creating-naming-concepts.md (~800 words)
**Purpose:** Define a new naming concept properly

**Process:**
1. Identify the concept needing a name
2. Research existing naming (codebase, domain, industry)
3. Propose canonical name
4. Document aliases (what else might people call this?)
5. Define scope (bounded context)
6. Document relationships (broader/narrower/related)
7. Add to glossary

**Key insight:** Library science approach - preferred term + documented variants

### discovering-naming.md (~800 words)
**Purpose:** Audit a codebase to find all naming concepts

**Process:**
1. Scan for domain-specific nouns (classes, types, key variables)
2. Cluster related terms
3. Identify inconsistencies (same concept, different names)
4. Identify conflicts (same name, different concepts)
5. Build initial glossary
6. Flag areas needing attention

**When to use:** New codebase, before major refactoring, periodic audits

### applying-ddd-principles.md (~800 words)
**Purpose:** Evaluate naming against DDD and taxonomy principles

**Process:**
1. Bounded context clarity: Is scope explicit?
2. Ubiquitous language: Do domain experts use this term?
3. Anti-pattern check: Misleading? Shadowing? Stringly-typed?
4. Taxonomy check: Relationships documented? Aliases captured?
5. Recommend improvements

**When to use:** Reviewing glossary, resolving naming conflicts, evaluating decisions

## Reference Content Plans

### references/glossary-format.md
The YAML schema for glossary entries (from original plan):
```yaml
term: Order
aliases: [Purchase, Transaction]
scope: sales-context
definition: A customer's request to purchase products
broader: Transaction
narrower: [ReturnOrder, SubscriptionOrder]
related: [Customer, Product, Payment]
code_examples: [src/sales/Order.ts]
```

### references/naming-research.md
Synthesized from `02-academic-naming-research.md`:
- Key statistics (20% faster, 42% time, 69% recognize antipatterns)
- Why naming is not cosmetic
- What makes good identifier names

### references/ddd-principles.md
Synthesized from `01-ddd-ubiquitous-language.md`:
- Ubiquitous language concept
- Bounded contexts as linguistic boundaries
- Context mapping patterns
- Anti-corruption layers

### references/taxonomy-principles.md
Synthesized from `03-taxonomy-ontology-principles.md`:
- Preferred terms + aliases
- Relationship types (equivalence, hierarchy, association)
- Scope notes
- Authority control

### references/antipatterns.md
Synthesized from `04-naming-anti-patterns.md`:
- Documentation decay timeline
- The "two systems" problem
- Semantic drift
- Signs of naming debt

## Success Criteria

Same as original, but now achievable through one unified skill:

1. New code uses consistent naming without being told every time
2. Naming conflicts are caught before they merge
3. The glossary is used and stays up-to-date
4. Onboarding developers can understand domain terms
5. Code and documentation use the same language

## Next Steps

1. Create `skills/naming/` directory structure
2. Write SKILL.md (orchestrator)
3. Write sub-skill documents in order:
   - `reviewing-naming.md` (most common use case)
   - `creating-naming-concepts.md`
   - `discovering-naming.md`
   - `applying-ddd-principles.md`
4. Create reference files from research
5. Test with baseline scenarios (TDD approach)
6. Iterate based on agent behavior

## Comparison to Original

| Aspect | Original | Revised |
|--------|----------|---------|
| Number of skills | 5 | 1 |
| Trigger points | 5 separate | 1 unified |
| Shared concepts | Repeated or missing | In SKILL.md once |
| Progressive disclosure | None | SKILL.md → sub-skills → references |
| Educational content | Separate skill | Integrated + references |
| Discovery | Find right skill | One skill routes internally |
