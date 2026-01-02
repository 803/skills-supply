# Glossary Entry Format

## Full Schema

```yaml
# Required fields
term: string              # Canonical name (PascalCase for types, as-used for concepts)
scope: string             # Bounded context where this term applies
definition: string        # Business-language explanation

# Recommended fields
aliases: string[]         # Other names people use for this concept
broader: string           # Parent concept (more general)
narrower: string[]        # Child concepts (more specific)
related: string[]         # Associated concepts (not hierarchical)
code_examples: string[]   # File paths where this is implemented

# Optional metadata
status: enum              # draft | confirmed | deprecated
created: date             # When entry was created
updated: date             # Last modification date
owner: string             # Team or person responsible
notes: string             # Internal notes, questions, context
```

## Field Definitions

### term (required)
The canonical name for this concept. This is the ONE name that should be used in code and documentation.

```yaml
# Good
term: SubscriptionOrder

# Bad
term: Subscription Order    # No spaces
term: subscriptionOrder     # Use PascalCase for types
term: SUBSCRIPTION_ORDER    # Not for types
```

### scope (required)
The bounded context where this term has meaning. A term's definition is only valid within its scope.

```yaml
# Good
scope: sales-context
scope: fulfillment-context
scope: billing-context

# Bad
scope: global              # Too vague
scope: all                 # Not a real boundary
scope: backend             # Technical, not domain
```

### definition (required)
A business-language explanation that a domain expert would recognize. No implementation details.

```yaml
# Good
definition: >
  A customer's request to purchase one or more products,
  including their selected items, shipping address, and payment method.

# Bad
definition: Database record in the orders table
definition: OrderEntity mapped to PostgreSQL
definition: See Order.ts for implementation
```

### aliases (recommended)
All other names that people use for this concept. Include:
- Terms from legacy systems
- Terms from different teams
- Common abbreviations
- Regional variations

```yaml
aliases:
  - Purchase           # Sales team uses this
  - Transaction        # Legacy system name
  - PO                 # Abbreviation in some reports
```

### broader / narrower (recommended)
Hierarchical relationships.

- `broader`: The parent concept (this term is a more specific form of X)
- `narrower`: Child concepts (these are more specific forms of this term)

```yaml
term: SubscriptionOrder
broader: Order                    # SubscriptionOrder IS-A Order
narrower:
  - MonthlySubscription          # These ARE SubscriptionOrders
  - AnnualSubscription
```

### related (recommended)
Concepts that are associated but not hierarchical. Use when concepts are frequently mentioned together or work together.

```yaml
term: Order
related:
  - Customer          # Orders belong to Customers
  - Product           # Orders contain Products
  - Payment           # Orders are paid via Payments
  - Shipment          # Orders are fulfilled via Shipments
```

### code_examples (recommended)
Paths to files where this concept is implemented. Keep these updated when code moves.

```yaml
code_examples:
  - src/sales/Order.ts
  - src/sales/OrderService.ts
  - src/sales/repositories/OrderRepository.ts
```

## Complete Example

```yaml
term: SubscriptionOrder
aliases:
  - RecurringOrder
  - AutoshipOrder
  - Standing Order
scope: sales-context
definition: >
  An Order that recurs automatically on a schedule. Created when a customer
  subscribes to receive products at regular intervals. Each billing cycle
  generates a child Order for fulfillment.
broader: Order
narrower:
  - MonthlySubscription
  - AnnualSubscription
  - CustomIntervalSubscription
related:
  - Subscription
  - RecurringPayment
  - SubscriptionPlan
  - Customer
code_examples:
  - src/sales/orders/SubscriptionOrder.ts
  - src/sales/services/SubscriptionOrderService.ts
  - src/sales/jobs/SubscriptionRenewalJob.ts
status: confirmed
created: 2024-01-15
updated: 2024-06-20
owner: sales-team
notes: |
  Introduced in Q1 2024 for subscription product launch.
  Legacy system called this AutoshipOrder - migration complete.
```

## File Organization

### Single File
For small glossaries (<50 terms):
```
docs/glossary.yaml
```

### Directory Structure
For larger glossaries, organize by context:
```
docs/glossary/
  sales/
    order.yaml
    customer.yaml
    cart.yaml
  fulfillment/
    shipment.yaml
    warehouse.yaml
  billing/
    invoice.yaml
    payment.yaml
  _index.yaml           # Links to all entries
```

### Naming Convention
- Files: `kebab-case.yaml` matching the term
- One term per file for large glossaries
- Multiple related terms per file for small glossaries

## Validation Rules

A glossary entry is valid if:

1. **Required fields present**: `term`, `scope`, `definition`
2. **Term format**: PascalCase for types, no spaces
3. **Scope exists**: References a real bounded context
4. **Definition is business language**: No implementation terms
5. **Aliases are distinct**: Not duplicating other canonical terms
6. **Relationships reference existing terms**: `broader`, `narrower`, `related` point to real entries
7. **Code examples exist**: Files actually exist at specified paths

## Anti-Patterns

| Anti-Pattern | Example | Fix |
|--------------|---------|-----|
| Missing scope | `scope: all` | Specify real bounded context |
| Technical definition | `Postgres table for orders` | Write in business terms |
| No aliases | Only canonical term | Add known variants |
| Stale code_examples | Links to moved/deleted files | Update on code changes |
| Circular broader | `Order.broader: Order` | Remove self-reference |
| Orphan narrower | `narrower: [NonexistentTerm]` | Create referenced entries |
