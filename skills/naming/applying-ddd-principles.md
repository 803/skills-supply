# Applying DDD Principles to Naming

## Purpose

Evaluate naming against Domain-Driven Design (DDD) and library science principles. This is the quality gate for naming decisions—checking that terms are well-defined, properly scoped, and aligned with how domain experts actually talk.

## When to Use

- Reviewing glossary entries for quality
- Evaluating naming decisions before implementation
- Resolving naming conflicts between teams
- Assessing naming debt
- Onboarding to ensure terms are learnable

## Evaluation Framework

### 1. Bounded Context Check

**Question:** Is the term's scope explicitly defined?

| Check | Pass | Fail |
|-------|------|------|
| Scope field present | `scope: sales-context` | `scope:` missing |
| Scope is meaningful | References real system boundary | `scope: global` or `scope: default` |
| No context leakage | Term stays in its context | `SalesOrder` used in fulfillment code |
| Conflicts documented | If same name exists in other context, noted | Same name, no scope, confusion |

**DDD principle:** A term's meaning is only valid within its bounded context. `Order` in sales and `Order` in fulfillment are different concepts that happen to share a name.

**Evaluation:**
```yaml
# GOOD: Explicit scope
term: Order
scope: sales-context
definition: Customer's request to purchase products

# BAD: No scope
term: Order
definition: Something ordered  # Which Order? In what context?
```

### 2. Ubiquitous Language Check

**Question:** Do domain experts recognize and use this term?

| Check | Pass | Fail |
|-------|------|------|
| Domain expert recognition | PMs/sales/support use this term | Only engineers know it |
| Definition matches domain | Business meaning, not technical | "Database record for purchases" |
| No jargon introduction | Uses existing domain vocabulary | Invents new term when existing works |
| Conversations work | Can discuss with stakeholders | Have to "translate" for non-devs |

**DDD principle:** Ubiquitous language means developers and domain experts use the same vocabulary. If you have to translate, the naming is wrong.

**Red flags:**
- "We call it X in the code but the business calls it Y"
- "That's the technical term, stakeholders wouldn't understand"
- Engineering-only abbreviations (`CRO`, `DAU`, `LTV`) without glossary definitions

### 3. Anti-Pattern Check

Scan for known naming problems:

| Anti-Pattern | Detection | Fix |
|--------------|-----------|-----|
| **Misleading name** | Name suggests wrong behavior | Rename to match actual behavior |
| **Shadowing** | Same name used for different things | Disambiguate with prefixes/suffixes |
| **Stringly-typed** | String constants instead of types | Create proper enum/type |
| **Abbreviation soup** | `CustOrdTxnMgr` | Use full words |
| **Generic names** | `Data`, `Info`, `Manager`, `Handler` | Use domain-specific terms |
| **Implementation leak** | `OrderEntity`, `CustomerRow`, `UserDTO` | Drop suffixes in domain layer |
| **Version in name** | `OrderV2`, `NewCustomer`, `LegacyPayment` | Migrate and remove version |

**Evaluation checklist:**
```markdown
- [ ] Name accurately describes what it represents
- [ ] Name is not used elsewhere for different concept
- [ ] Name uses full words (or well-known abbreviations)
- [ ] Name is domain term, not implementation term
- [ ] Name has no version/legacy markers
```

### 4. Taxonomy Check

**Question:** Are relationships properly documented?

| Check | Pass | Fail |
|-------|------|------|
| Aliases captured | Known synonyms listed | Only canonical name |
| Hierarchy defined | `broader`/`narrower` present | Flat, unconnected terms |
| Related terms linked | Associated concepts connected | Isolated entries |
| Code examples current | Links to actual implementations | Stale or missing links |

**Library science principle:** Terms don't exist in isolation. Document what people ALSO call this thing (aliases), what category it belongs to (broader), what specific types exist (narrower), and what it's associated with (related).

**Evaluation:**
```yaml
# GOOD: Rich taxonomy
term: SubscriptionOrder
aliases: [RecurringOrder, StandingOrder]
broader: Order
narrower: [MonthlySubscription, AnnualSubscription]
related: [Subscription, RecurringPayment, Customer]

# BAD: Isolated term
term: SubscriptionOrder
definition: An order that recurs
# No aliases, no relationships, no code links
```

### 5. Learnability Check

**Question:** Can a new team member understand this term from the glossary?

| Check | Pass | Fail |
|-------|------|------|
| Definition is self-contained | Understandable without reading code | Requires code diving |
| No circular definitions | Doesn't reference itself | "Order is an ordering of ordered items" |
| Context provided | When/why this concept exists | Just what it is, not when used |
| Examples linked | Can see real usage | Abstract definition only |

**Test:** Show the glossary entry to someone unfamiliar with the codebase. Can they explain what this term means?

## Evaluation Process

### Step 1: Gather Context

For each term being evaluated:
```bash
# Find all usages
grep -rn "[Term]" src/ docs/ | head -50

# Check if stakeholders use this term
grep -ri "[Term]" docs/specs/ docs/prd/ docs/design/
```

### Step 2: Score Each Dimension

```markdown
## Evaluation: [Term]

### Bounded Context
- [ ] Scope explicitly defined
- [ ] Scope is meaningful boundary
- [ ] No leakage to other contexts
Score: [1-5]

### Ubiquitous Language
- [ ] Domain experts recognize term
- [ ] Definition in business language
- [ ] No translation needed
Score: [1-5]

### Anti-Patterns
- [ ] Name is not misleading
- [ ] No shadowing
- [ ] Not stringly-typed
- [ ] Full words used
- [ ] Domain term, not implementation
Score: [1-5]

### Taxonomy
- [ ] Aliases documented
- [ ] Hierarchy defined
- [ ] Related terms linked
- [ ] Code examples current
Score: [1-5]

### Learnability
- [ ] Self-contained definition
- [ ] Not circular
- [ ] Context provided
- [ ] Examples available
Score: [1-5]

### Overall: [Average/25]
```

### Step 3: Generate Recommendations

Based on scores, recommend actions:

| Score | Category | Action |
|-------|----------|--------|
| 20-25 | Excellent | No changes needed |
| 15-19 | Good | Minor improvements |
| 10-14 | Needs work | Schedule improvements |
| 5-9 | Poor | Priority fix |
| 1-4 | Critical | Block until fixed |

## Output Format

```markdown
## DDD Evaluation Report: [Term or Glossary Section]

### Summary
- Terms evaluated: [N]
- Average score: [X/25]
- Critical issues: [N]
- Recommendations: [N]

### Term Evaluations

#### [Term 1]
**Score: [X/25]**
- Bounded Context: [score] - [notes]
- Ubiquitous Language: [score] - [notes]
- Anti-Patterns: [score] - [notes]
- Taxonomy: [score] - [notes]
- Learnability: [score] - [notes]

**Issues:**
1. [Issue description]
2. [Issue description]

**Recommendations:**
1. [Specific fix]
2. [Specific fix]

#### [Term 2]
...

### Priority Actions
1. [Highest priority fix]
2. [Second priority]
3. ...
```

## Common Evaluation Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|----------------|-----|
| Only checking syntax | Naming is about meaning, not spelling | Focus on semantic evaluation |
| Skipping domain expert check | Engineers approve terms they like | Always validate with stakeholders |
| Evaluating in isolation | Terms exist in relationship | Check context and relationships |
| Binary pass/fail | Naming quality is a spectrum | Use scoring to prioritize |
| No action items | Evaluation without improvement plan | Always produce recommendations |

## When Evaluation Reveals Problems

If evaluation shows poor naming quality:

1. **Don't mandate glossary rewrites** (creates resistance)
2. **Start with highest-impact terms** (most frequently used)
3. **Fix in context** (improve terms when you're already touching that code)
4. **Make glossary valuable** (if it helps people, they'll maintain it)

Naming improvement is a continuous process, not a one-time project.
