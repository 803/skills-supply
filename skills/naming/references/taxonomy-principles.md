# Taxonomy and Library Science Principles

## Core Concept: Controlled Vocabulary

### Definition
A standardized set of terms where each concept has ONE preferred term and documented alternatives.

### Why It Works
- Eliminates ambiguity (everyone uses same term)
- Preserves history (old terms map to current)
- Enables search (find by any variant)

### Application to Code
The glossary IS a controlled vocabulary for your domain.

## Thesaurus Relationships

Library science defines three relationship types:

### 1. Equivalence (USE/UF)
"This term is the same as that term."

```yaml
term: Order
aliases:              # UF (Use For) = aliases
  - Purchase         # USE Order instead of Purchase
  - Transaction
```

- **USE:** The preferred term (canonical name)
- **UF (Use For):** Aliases that point to the preferred term

### 2. Hierarchy (BT/NT)
"This term is broader/narrower than that term."

```yaml
term: Order
broader: Transaction      # BT (Broader Term)
narrower:                 # NT (Narrower Term)
  - SubscriptionOrder
  - GiftOrder
  - ReturnOrder
```

- **BT (Broader Term):** More general category
- **NT (Narrower Term):** More specific type

### 3. Association (RT)
"This term is related to that term."

```yaml
term: Order
related:                  # RT (Related Term)
  - Customer
  - Product
  - Payment
  - Shipment
```

- **RT (Related Term):** Associated concept, not hierarchical

## Preferred Terms vs. Entry Terms

### Preferred Term
The ONE name used in code, docs, and conversation.

### Entry Terms
All other names that might be used or searched for.

```
Preferred Term: Order
Entry Terms: Purchase, Transaction, Sale, PO
```

**Why this matters:** Developers might search for "Purchase" in the glossary. Entry terms ensure they find the right concept and learn the preferred term.

## Scope Notes

### Purpose
Clarify what a term means in YOUR context, especially when:
- Industry uses term differently
- Multiple meanings exist
- Boundaries need explicit definition

### Format
```yaml
term: Account
scope: billing-context
definition: A customer's payment methods and stored balance.
scope_note: >
  In this system, Account refers specifically to billing/payment.
  For user identity, see UserAccount in user-context.
  For company records, see CustomerAccount in crm-context.
```

## Authority Control

### Definition
Ensuring one authoritative source for term definitions.

### In Practice
- **One glossary** is the source of truth
- **Code follows glossary**, not the other way around
- **Changes go through glossary first**, then propagate to code

### Anti-Pattern
```
Developer A: "I'll add CustomerRecord to the code"
Developer B: "But we use Customer in the glossary"
Developer A: "I'll add it to glossary later"
```

**Result:** Glossary becomes documentation of what happened, not authority for what should happen.

## Faceted Classification

### Concept
Organize terms by multiple dimensions, not just hierarchy.

### Example Facets
```
Order can be classified by:
  - Type: [Standard, Subscription, Gift, Return]
  - Status: [Pending, Confirmed, Shipped, Delivered]
  - Channel: [Web, Mobile, Phone, Partner]
  - Customer: [Consumer, Business, Wholesale]
```

### Application
When documenting narrower terms, consider multiple facets:
```yaml
term: Order
narrower:
  # By type
  - SubscriptionOrder
  - GiftOrder
  - ReturnOrder
  # By channel might be separate dimension
  # - PhoneOrder, WebOrder (if these are distinct domain concepts)
```

## Syndetic Structure

### Definition
The explicit display of relationships between terms.

### Application
Glossary entries should explicitly show connections:

```yaml
term: Order
# Show hierarchy
broader: Transaction
narrower: [SubscriptionOrder, GiftOrder]
# Show associations
related: [Customer, Product, Payment]
# Show equivalences
aliases: [Purchase, Sale]
```

**Anti-Pattern:** Isolated terms with no relationships. If a term has no connections, either:
- Relationships haven't been documented (fix this)
- Term might be too generic or too specific

## Literary Warrant

### Concept
Terms should be based on actual usage in the literature (or codebase).

### Application
- Don't invent terms that nobody uses
- Document terms as they ARE used, then standardize
- Glossary should reflect reality, then improve it

### Process
1. **Discover** what terms exist in code/docs/conversations
2. **Document** the current state (even if messy)
3. **Standardize** by picking preferred terms
4. **Migrate** code to use preferred terms

## User Warrant

### Concept
Terms should match what users actually search for / say.

### Application
- Include terms that domain experts use
- Add aliases for common misspellings or variations
- Test: "If I search for X, will I find the right concept?"

### Anti-Pattern
Technically correct glossary that nobody can use because:
- Terms are too formal
- Aliases missing for common usage
- Definitions are too technical

## Applying to Code Glossaries

### Library Science Checklist
- [ ] **Preferred term** is clear and documented
- [ ] **Aliases** capture all known variants
- [ ] **Hierarchy** (broader/narrower) is explicit
- [ ] **Related terms** are linked
- [ ] **Scope notes** clarify boundaries
- [ ] **Authority control** is maintained (glossary is source of truth)

### Mapping to Glossary Schema
```yaml
term: Order                    # Preferred term
aliases: [Purchase, Sale]      # Entry terms / UF
scope: sales-context           # Explicit scope
definition: ...                # Scope note
broader: Transaction           # BT
narrower: [...]               # NT
related: [...]                # RT
```

## Common Mistakes

| Mistake | Library Science Term | Fix |
|---------|---------------------|-----|
| No aliases | Missing entry terms | Ask "what else might this be called?" |
| Flat list | No syndetic structure | Add broader/narrower/related |
| Circular definitions | Tautology | Define in terms of OTHER concepts |
| Invented terms | No literary warrant | Use terms from actual usage |
| Too technical | No user warrant | Define for domain experts |
| Multiple authorities | No authority control | One glossary is truth |
