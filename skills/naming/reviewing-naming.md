# Reviewing Code for Naming Consistency

## Purpose

Check if new or modified code matches existing naming patterns in the codebase. This is the primary defense against naming drift—catching inconsistencies before they merge.

## When to Use

- Code review (PRs, commits)
- Writing new code that touches existing domain concepts
- After AI generates code
- Refactoring existing code

## Process

### Step 1: Identify Domain Concepts

Scan the code for **domain-specific nouns**:

```typescript
// What domain concepts appear here?
class OrderProcessor {
  async processOrder(purchase: Purchase) {  // ← "Order" and "Purchase" - same concept?
    const txn = await this.createTransaction(purchase);  // ← "Transaction" too
    return txn;
  }
}
```

Look for:
- Class/type names
- Function/method names with domain meaning
- Variable names representing business entities
- Comments mentioning domain terms

**Ignore:** Generic programming terms (`handler`, `manager`, `utils`, `data`, `result`)

### Step 2: Look Up Existing Naming

For each domain concept identified:

1. **Check glossary** (if one exists):
   ```bash
   # Look for existing term definitions
   grep -r "term:" docs/glossary.yaml
   grep -ri "order" docs/glossary/
   ```

2. **Search existing code** for the same concept:
   ```bash
   # Find how this concept is already named
   grep -rn "Order" src/ --include="*.ts" | head -20
   grep -rn "Purchase" src/ --include="*.ts" | head -20
   ```

3. **Check type definitions**:
   ```bash
   # Find existing types for this domain
   grep -rn "type.*Order\|interface.*Order" src/
   ```

### Step 3: Compare and Flag

For each domain concept, answer:

| Question | If No |
|----------|-------|
| Does new code use the same term as existing code? | Flag as inconsistency |
| If different, is the new term documented as an alias? | Flag as undocumented variant |
| Is the scope (bounded context) the same? | May be legitimate difference |

**Example inconsistency report:**

```
NAMING INCONSISTENCIES FOUND:

1. Order vs Purchase
   - Existing code uses: `Order` (src/sales/Order.ts:1)
   - New code uses: `Purchase` (src/checkout/processor.ts:15)
   - Same concept? YES - both represent customer's request to buy
   - Recommendation: Use `Order` to match existing pattern

2. Transaction vs Txn
   - Existing code uses: `Transaction` (src/payments/Transaction.ts:1)
   - New code uses: `txn` (src/checkout/processor.ts:17)
   - Same concept? YES - abbreviation of same term
   - Recommendation: Use full `transaction` variable name
```

### Step 4: Provide Specific Corrections

Don't just flag—show the fix:

```typescript
// BEFORE (inconsistent)
class OrderProcessor {
  async processOrder(purchase: Purchase) {
    const txn = await this.createTransaction(purchase);
    return txn;
  }
}

// AFTER (consistent with existing naming)
class OrderProcessor {
  async processOrder(order: Order) {
    const transaction = await this.createTransaction(order);
    return transaction;
  }
}
```

Include file paths and line numbers for each change.

## What to Check

### Type/Class Names
- Match existing types for same domain concept
- Follow existing naming patterns (e.g., if `UserAccount` exists, don't create `AccountUser`)

### Variable Names
- Use same nouns as types (`order: Order`, not `purchase: Order`)
- Consistent abbreviations (if `tx` is used elsewhere, don't introduce `txn`)

### Function Names
- Verbs should match existing patterns (`createOrder` vs `makeOrder` vs `newOrder`)
- Domain operations should use domain terms

### Comments and Documentation
- Use same terms as code
- Don't introduce synonyms in comments that aren't in code

## Output Format

When reviewing, produce:

```markdown
## Naming Review: [PR/file name]

### Concepts Identified
- Order (existing: src/sales/Order.ts)
- Customer (existing: src/users/Customer.ts)
- [NEW] SubscriptionOrder (not in glossary)

### Inconsistencies Found
1. **[file:line]** - `purchase` should be `order` (matches existing Order type)
2. **[file:line]** - `txn` should be `transaction` (existing code uses full word)

### New Terms Needing Definition
- `SubscriptionOrder` - appears to be new concept, needs glossary entry

### Suggested Changes
[Code diff or specific line changes]
```

## Edge Cases

### Legitimate Different Names (Different Contexts)
If `Account` means different things in `billing/` vs `users/`:
- Check if bounded contexts are explicit
- If yes, different names may be correct
- If no, recommend clarifying context

### No Existing Pattern
If the domain concept appears to be genuinely new:
- Don't force it into existing patterns
- Flag for `creating-naming-concepts.md` process
- Continue review for other terms

### Conflicting Existing Patterns
If existing code itself is inconsistent (uses both `Order` and `Purchase`):
- Note the existing inconsistency
- Pick the more prevalent term for new code
- Flag for `discovering-naming.md` audit

## Common Mistakes

| Mistake | Why It's Wrong |
|---------|----------------|
| Only checking types | Variables and functions also drift |
| Ignoring comments | Comments teach future readers wrong terms |
| Assuming new term is better | Consistency > correctness for existing concepts |
| Not providing fixes | "Wrong naming" without corrections isn't actionable |
