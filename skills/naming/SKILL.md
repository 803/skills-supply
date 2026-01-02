---
name: naming
description: This skill should be used when the user asks to "review naming", "check naming consistency", "create a naming concept", "define a domain term", "audit naming in codebase", "discover naming patterns", "apply DDD to naming", or mentions naming inconsistencies, domain terminology, ubiquitous language, or glossary maintenance.
---

# Naming Concepts

## Overview

A **naming concept** is a domain term with:
- **Canonical name**: The preferred term (e.g., `Order`)
- **Aliases**: What else people call it (e.g., `Purchase`, `Transaction`)
- **Scope**: Where this term applies (bounded context)
- **Relationships**: Broader, narrower, and related terms

**Why this matters:**
- Developers spend 42% of time on code with bad naming (Fakhoury et al., 2018)
- Good naming enables 20% faster defect detection (Hofmeister et al., 2019)
- 69% of developers can recognize naming antipatterns but don't fix them

**Core principle:** Consistency beats any specific convention. The goal isn't perfect names—it's predictable names.

## Routing: Which Sub-Skill to Use

```
┌─────────────────────────────────────────────────────────────┐
│                    What's the task?                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  "Review this code/PR for naming"                           │
│  "Does this match existing patterns?"      → reviewing-naming.md
│  "Check naming consistency"                                 │
│                                                             │
│  "Define a new term"                                        │
│  "Name this new concept"                   → creating-naming-concepts.md
│  "Add to glossary"                                          │
│                                                             │
│  "What naming exists in this codebase?"                     │
│  "Audit all naming"                        → discovering-naming.md
│  "Build initial glossary"                                   │
│                                                             │
│  "Evaluate this naming against DDD"                         │
│  "Is this term well-defined?"              → applying-ddd-principles.md
│  "Review glossary quality"                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Multiple sub-skills may apply.** Common sequences:
- New codebase: `discovering-naming` → `applying-ddd-principles` → `creating-naming-concepts`
- Code review: `reviewing-naming` (usually sufficient alone)
- New feature: `reviewing-naming` (check existing) → `creating-naming-concepts` (if new term needed)

## Shared Concepts

### Glossary Entry Format

Each naming concept should be documented:

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

See `references/glossary-format.md` for full schema and examples.

### Bounded Contexts

Terms mean different things in different contexts:
- `Account` in billing ≠ `Account` in user management
- `Order` in sales ≠ `Order` in fulfillment

**Always specify scope.** A glossary without scope creates false confidence.

### The Drift Problem

Naming degrades over time:
1. **Initial state**: Code and docs use consistent terms
2. **Feature pressure**: New code uses slightly different names ("just ship it")
3. **Onboarding decay**: New devs learn from inconsistent code, not glossary
4. **Documentation rot**: Docs update slower than code
5. **Terminal state**: Nobody trusts any naming; everyone invents their own

**Intervention points:**
- Code review (catch drift before merge) → `reviewing-naming.md`
- Periodic audits (find existing drift) → `discovering-naming.md`
- Glossary maintenance (keep docs current) → `creating-naming-concepts.md`

## Quick Reference

### Sub-Skills

| Sub-Skill | Purpose | When to Use |
|-----------|---------|-------------|
| `reviewing-naming.md` | Check code against existing patterns | Code review, writing new code, AI-generated code |
| `creating-naming-concepts.md` | Define new terms properly | New features, unnamed patterns, glossary gaps |
| `discovering-naming.md` | Audit codebase for all naming | New codebase, before refactoring, periodic audits |
| `applying-ddd-principles.md` | Evaluate with DDD/taxonomy lens | Reviewing glossary, resolving conflicts, evaluating decisions |

### Reference Files

| Reference | Content | Load When |
|-----------|---------|-----------|
| `references/glossary-format.md` | YAML schema, field definitions | Creating/updating glossary entries |
| `references/naming-research.md` | Academic findings, statistics | Justifying naming investment |
| `references/ddd-principles.md` | Ubiquitous language, bounded contexts | Deep DDD evaluation |
| `references/taxonomy-principles.md` | Library science patterns | Designing term relationships |
| `references/antipatterns.md` | What goes wrong, detection | Identifying naming debt |

## Common Mistakes

### 1. Creating Before Checking

**Wrong:** See unfamiliar concept → invent new name → add to code
**Right:** See unfamiliar concept → search existing code/glossary → use existing OR create properly

The `reviewing-naming.md` sub-skill exists specifically to prevent this.

### 2. Treating Naming as Cosmetic

**Wrong:** "It's just naming, we can fix it later"
**Reality:** Naming shapes how people think about the domain. Bad names create wrong mental models that propagate through code, docs, and conversations.

Renaming later is expensive—every reference, every test, every doc, every conversation.

### 3. Skipping Scope Definition

**Wrong:** `glossary.yaml` with 50 terms, no bounded context markers
**Reality:** Same term means different things in different parts of the system.

A glossary without scope is a glossary that will be ignored. Always include `scope:` in entries.

### 4. No Aliases

**Wrong:** Canonical term only, no documented alternatives
**Reality:** People will call things by different names. Document what they ARE calling it, not just what they SHOULD call it.

Aliases make the glossary searchable and honest about actual usage.

### 5. Not Updating Code Examples

**Wrong:** Glossary entry with `code_examples: [src/old/path.ts]` (file moved 6 months ago)
**Reality:** Stale references destroy trust. If the glossary points to wrong places, people stop consulting it.

Update `code_examples` when you touch related code.

## When NOT to Use This Skill

- **Mechanical naming conventions** (camelCase vs snake_case): Use linters
- **API naming standards** (REST conventions): Use API style guides
- **Language-specific idioms** (Go vs Java naming): Use language guides

This skill is for **domain concepts**—the nouns and verbs that represent business logic, not syntactic conventions.

## Getting Started

**For a new codebase:**
1. Run `discovering-naming.md` to build initial glossary
2. Run `applying-ddd-principles.md` to evaluate and improve
3. Use `reviewing-naming.md` for ongoing code review

**For an existing team:**
1. Start with `reviewing-naming.md` in code reviews (low friction)
2. When conflicts arise, use `creating-naming-concepts.md` to resolve properly
3. Consider `discovering-naming.md` audit if naming debt is high

**For a single new feature:**
1. Run `reviewing-naming.md` to check what exists
2. If new term needed, use `creating-naming-concepts.md`
