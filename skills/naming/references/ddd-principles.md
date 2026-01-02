# DDD Principles for Naming

## Ubiquitous Language

### Definition
A shared vocabulary used by developers AND domain experts. Not a translation layer—the SAME words in conversations, documentation, and code.

### Key Principle
> "Use the model as the backbone of a language. Commit to exercising the language relentlessly in all communication."
> — Eric Evans, Domain-Driven Design

### Requirements
1. **Domain experts recognize terms** without translation
2. **Code uses the same words** as business conversations
3. **Documentation matches code** without synonyms
4. **All team members** (dev, PM, QA, support) use same terms

### Anti-Pattern: Translation Layer
```
Domain Expert: "Can we see the customer's orders?"
Developer: "Sure, let me query the UserEntity for its PurchaseRecords..."
```

If you translate between "customer/user" or "order/purchase", you don't have ubiquitous language.

## Bounded Contexts

### Definition
An explicit boundary within which a domain model exists. A term's meaning is only valid within its context.

### Why Boundaries Matter
- `Account` in billing = payment method, balance
- `Account` in users = identity, permissions, profile
- `Account` in CRM = company record

These are **different concepts** with the same name. Without explicit boundaries, confusion is guaranteed.

### Implementing Bounded Contexts

**In code:**
```
src/
  billing/              ← billing context
    Account.ts          ← BillingAccount
  users/                ← user context
    Account.ts          ← UserAccount
  crm/                  ← crm context
    Account.ts          ← CustomerAccount
```

**In glossary:**
```yaml
term: Account
scope: billing-context
definition: A customer's payment methods and balance

---
term: Account
scope: user-context
definition: A user's identity and access permissions
```

### Context Mapping

When contexts interact, define the relationship:

| Pattern | Description | When to Use |
|---------|-------------|-------------|
| **Shared Kernel** | Shared model between contexts | Tightly coupled teams |
| **Customer/Supplier** | One context serves another | Clear dependency |
| **Conformist** | One context adopts another's model | Don't fight upstream |
| **Anti-Corruption Layer** | Translate at boundary | Protect from bad models |
| **Separate Ways** | No integration | Independent domains |

## Anti-Corruption Layer (ACL)

### Purpose
Protect your domain model from external models that don't fit your language.

### When to Use
- Integrating with legacy systems
- Consuming external APIs
- Working with third-party services

### Implementation
```typescript
// External API uses different language
interface LegacyOrderResponse {
  order_nbr: string;
  cust_id: number;
  purch_amt: number;
}

// ACL translates to our domain language
class OrderTranslator {
  fromLegacy(response: LegacyOrderResponse): Order {
    return new Order({
      id: response.order_nbr,
      customerId: response.cust_id,
      total: Money.fromCents(response.purch_amt)
    });
  }
}
```

**Key:** The translation happens at the boundary. Internal code only sees domain terms.

## Aggregate Naming

### Definition
An Aggregate is a cluster of objects treated as a single unit. The root entity gives the aggregate its name.

### Naming Pattern
```
[AggregateName]           ← Root entity
[AggregateName][Part]     ← Child entities
[AggregateName]Repository ← Data access
[AggregateName]Service    ← Operations
```

### Example
```
Order (aggregate root)
OrderItem (part of Order aggregate)
OrderRepository
OrderService
```

**Anti-pattern:** Naming aggregates by implementation (`OrderAggregate`, `OrderRoot`).

## Value Object Naming

### Definition
Objects defined by their attributes, not identity. Immutable.

### Naming Patterns
- **What it represents:** `Money`, `Address`, `DateRange`
- **Not how it's used:** Not `OrderMoney`, `ShippingAddress`

### Example
```typescript
// Good: Named for what it IS
class Money {
  constructor(
    readonly amount: number,
    readonly currency: Currency
  ) {}
}

// Bad: Named for how it's used
class OrderTotal {  // Should just be Money
  constructor(readonly amount: number) {}
}
```

## Domain Events

### Naming Pattern
Past tense verb + noun (what happened):
- `OrderPlaced`
- `PaymentReceived`
- `InventoryDepleted`

**Not:**
- `PlaceOrder` (command, not event)
- `OrderEvent` (generic, says nothing)
- `OrderUpdated` (too vague—what update?)

### Example
```typescript
// Good: Specific, past tense
class OrderShipped {
  constructor(
    readonly orderId: string,
    readonly shippedAt: Date,
    readonly trackingNumber: string
  ) {}
}

// Bad: Vague, generic
class OrderUpdated {
  constructor(
    readonly orderId: string,
    readonly changes: object
  ) {}
}
```

## Common DDD Naming Mistakes

| Mistake | Example | Fix |
|---------|---------|-----|
| Technical suffixes | `OrderEntity`, `CustomerDTO` | Drop suffix in domain |
| Generic names | `OrderManager`, `CustomerHandler` | Use domain verbs |
| Missing context | Global `Account` type | Scope to bounded context |
| Translation layer | Code says X, docs say Y | Align on one term |
| Event as command | `PlaceOrder` event | Use past tense |

## Applying to Glossary

When creating glossary entries, verify DDD alignment:

```yaml
term: Order
scope: sales-context              # Bounded context
definition: >                     # Ubiquitous language definition
  A customer's request to purchase products
aliases: []                       # No aliases if language is truly ubiquitous
broader: null
narrower:
  - SubscriptionOrder
  - GiftOrder
related:
  - Customer
  - Product
  - Payment
```

**Quality check:**
- [ ] Would a domain expert (PM, business analyst) recognize this definition?
- [ ] Is the scope (bounded context) explicit?
- [ ] If there are aliases, why isn't language ubiquitous?
- [ ] Do events use past tense?
- [ ] Are technical suffixes removed?
