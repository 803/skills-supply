# Creating Naming Concepts

## Purpose

Define a new naming concept properly when one doesn't exist. This isn't just picking a name—it's establishing a term that will be used consistently across code, documentation, and conversations.

## When to Use

- Introducing a new domain concept (new feature, new entity)
- Discovering an unnamed pattern in existing code
- Filling a gap in the glossary
- Resolving a naming conflict (two teams using different names for same thing)

## Process

### Step 1: Confirm No Existing Term

Before creating, verify the concept doesn't already have a name:

```bash
# Search glossary
grep -ri "definition:.*[your concept description keywords]" docs/glossary/

# Search code for similar concepts
grep -rn "class\|interface\|type" src/ | grep -i "[keywords]"

# Search docs
grep -ri "[keywords]" docs/ README.md
```

If an existing term fits, use it. Don't create synonyms.

### Step 2: Research Domain Language

Look for what domain experts call this concept:

1. **Internal sources:**
   - Product specs, PRDs
   - Slack/email discussions with stakeholders
   - Existing documentation
   - How sales/support refers to it

2. **External sources:**
   - Industry standards (if applicable)
   - Competitor terminology
   - Academic/technical literature

**Goal:** Find the term that domain experts already use. Don't invent jargon.

### Step 3: Propose Canonical Name

Choose one authoritative name based on:

| Factor | Weight | Example |
|--------|--------|---------|
| Domain expert usage | High | If PMs call it "Campaign", use that |
| Industry standard | High | If industry uses "SKU", don't invent "ProductCode" |
| Existing codebase patterns | Medium | If similar concepts are `OrderItem`, `CartItem`, use `*Item` pattern |
| Clarity | Medium | Prefer specific over generic (`SubscriptionOrder` > `RecurringOrder`) |
| Length | Low | Shorter is better, but not at cost of clarity |

**Anti-patterns:**
- Abbreviations that aren't universally known (`CRO` instead of `ConversionRateOptimization`)
- Generic terms (`Entity`, `Item`, `Object`, `Data`)
- Implementation terms in domain layer (`OrderRecord`, `CustomerRow`)

### Step 4: Document Aliases

List what else people call this concept:

```yaml
term: SubscriptionOrder
aliases:
  - RecurringOrder      # Engineering team uses this
  - AutoshipOrder       # Legacy system calls it this
  - Standing Order      # UK customers use this term
```

**Why aliases matter:**
- Makes glossary searchable by any variant
- Acknowledges reality (people WILL use different terms)
- Helps onboarding (new dev searching for "AutoshipOrder" finds the right entry)

**Finding aliases:**
- Search Slack/email for how different teams refer to it
- Ask: "What else might someone call this?"
- Check legacy systems, partner integrations

### Step 5: Define Scope (Bounded Context)

Specify where this term applies:

```yaml
term: Order
scope: sales-context
# Note: fulfillment-context has its own Order with different meaning
```

**Questions to answer:**
- Which part of the system does this term belong to?
- Are there other contexts where the same word means something different?
- Who "owns" this term?

If scope is ambiguous, the term will cause confusion. Be explicit.

### Step 6: Document Relationships

Connect the term to related concepts:

```yaml
term: SubscriptionOrder
broader: Order                    # Parent concept
narrower:                         # Child concepts
  - MonthlySubscription
  - AnnualSubscription
related:                          # Associated concepts
  - Subscription
  - RecurringPayment
  - Customer
```

**Relationship types:**

| Type | Meaning | Example |
|------|---------|---------|
| `broader` | Parent/more general | Order is broader than SubscriptionOrder |
| `narrower` | Child/more specific | MonthlySubscription is narrower than SubscriptionOrder |
| `related` | Associated but not hierarchical | Customer is related to Order |

### Step 7: Create Glossary Entry

Assemble the full entry:

```yaml
term: SubscriptionOrder
aliases:
  - RecurringOrder
  - AutoshipOrder
  - Standing Order
scope: sales-context
definition: >
  An Order that recurs automatically on a schedule. Created when a customer
  signs up for a subscription. Generates child Orders on each billing cycle.
broader: Order
narrower:
  - MonthlySubscription
  - AnnualSubscription
related:
  - Subscription
  - RecurringPayment
  - Customer
code_examples:
  - src/sales/orders/SubscriptionOrder.ts
  - src/sales/services/SubscriptionOrderService.ts
created: 2024-01-15
updated: 2024-01-15
```

See `references/glossary-format.md` for full schema.

### Step 8: Update Code to Match

After defining the term:

1. **Create/rename types** to use canonical name
2. **Update variables** to match type names
3. **Update comments** to use defined term
4. **Add code_examples** back to glossary entry

The glossary entry isn't done until code matches it.

## Output Format

When creating a new naming concept, produce:

```markdown
## New Naming Concept: [Term]

### Research Summary
- Domain expert usage: [what stakeholders call it]
- Industry precedent: [external usage]
- Existing codebase patterns: [related terms]

### Proposed Entry
[Full YAML glossary entry]

### Required Code Changes
- [ ] Create type `[Term]` in `[path]`
- [ ] Rename existing `[OldTerm]` references
- [ ] Update comments in `[files]`

### Alternatives Considered
- [AlternativeName]: Rejected because [reason]
- [AnotherOption]: Rejected because [reason]
```

## Common Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|----------------|-----|
| No scope defined | Same term will mean different things | Always specify bounded context |
| No aliases documented | People will use other terms, won't find entry | Ask "what else might this be called?" |
| Definition too technical | Domain experts won't recognize it | Define in business terms |
| No code_examples | Entry becomes stale, can't verify usage | Link to actual implementation |
| Skipping relationship mapping | Term exists in isolation | Connect to broader/narrower/related |

## Quality Checklist

Before finalizing a new naming concept:

- [ ] Confirmed no existing term covers this concept
- [ ] Domain experts recognize the chosen name
- [ ] Scope (bounded context) is explicit
- [ ] At least 2-3 aliases documented
- [ ] Definition is in business terms, not implementation
- [ ] Relationships mapped (broader/narrower/related)
- [ ] At least one code_example linked
- [ ] Code has been updated to use the new term
