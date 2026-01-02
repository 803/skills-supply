# Naming Anti-Patterns

## The Drift Problem

### Documentation Decay Timeline

| Time | Code State | Doc State | Gap |
|------|------------|-----------|-----|
| Week 0 | Initial implementation | Matches code | 0% |
| Month 1 | First feature adds | Docs "mostly" current | 10% |
| Month 3 | Rapid iteration | Docs updated "when we can" | 25% |
| Month 6 | Team changes | New devs don't know docs exist | 40% |
| Year 1 | Legacy patterns emerge | Docs are "aspirational" | 60% |
| Year 2+ | Nobody trusts naming | "Check the code, not docs" | 80%+ |

### Why It Happens
1. **Urgency:** Features ship, docs wait
2. **Ownership:** Nobody is responsible for glossary
3. **Friction:** Updating glossary is separate from coding
4. **Visibility:** Inconsistency isn't caught in review

### The Two Systems Problem
Eventually you have:
- **System A:** What the code says
- **System B:** What the docs/glossary say

New developers learn from code (System A). They propagate whatever naming exists there. The glossary (System B) becomes fiction.

## Linguistic Anti-Patterns

### 1. Methods That Lie
**Pattern:** Method name doesn't match behavior.

```typescript
// Says "get" but modifies state
function getOrder(id: string): Order {
  this.lastAccessedId = id;  // Side effect!
  return this.orders.get(id);
}

// Says "validate" but also transforms
function validateAddress(input: string): Address {
  return this.parseAndNormalize(input);  // Does more than validate!
}
```

**Detection:** Look for side effects in "get/is/has" methods.

### 2. Names Containing "And"
**Pattern:** Name reveals function does two things.

```typescript
// Violation of single responsibility
function validateAndSave(order: Order) { ... }
function fetchAndTransform(url: string) { ... }
function parseAndExecute(query: string) { ... }
```

**Detection:** Search for `And` in function names.

**Fix:** Split into separate functions.

### 3. Attribute Names That Lie
**Pattern:** Variable/property name doesn't match its content.

```typescript
// Says "count" but might be null
let orderCount: number | null;

// Says "list" but is a Set
const customerList = new Set<Customer>();

// Says "is" but returns something other than boolean
function isValid(): ValidationResult { ... }
```

**Detection:** Check type vs. name implications.

### 4. Boolean Names That Don't Read as Questions
**Pattern:** Boolean variable that can't be read as yes/no question.

```typescript
// Bad: Not a question
let order: boolean;
let customer: boolean;
let validation: boolean;

// Good: Reads as question
let isValid: boolean;
let hasCustomer: boolean;
let canProceed: boolean;
```

**Detection:** Prepend "Is it true that..." to the name.

## Naming Debt Categories

### Inconsistent Synonyms
**Pattern:** Same concept, different names throughout codebase.

```
src/sales/Order.ts
src/checkout/Purchase.ts
src/reports/Transaction.ts
src/api/Sale.ts
// All mean the same thing!
```

**Impact:** Developers don't realize these are the same concept.

### Context Collision
**Pattern:** Same name, different concepts, no disambiguation.

```
src/billing/Account.ts    # Payment info
src/users/Account.ts      # User identity
src/crm/Account.ts        # Customer company
// All different things!
```

**Impact:** Bugs when wrong `Account` is imported/used.

### Abbreviation Inconsistency
**Pattern:** Mix of abbreviations and full forms.

```typescript
const custId = getCustomerId();
const orderId = getOrdId();  // Why sometimes abbrev?
const txnAmt = getTransactionAmount();
```

**Impact:** Can't predict how names are formed.

### Layer Leakage
**Pattern:** Implementation details in domain names.

```typescript
// Layer suffixes that don't belong
class OrderEntity { }      // JPA artifact
class CustomerDTO { }      // Transfer object
class ProductRow { }       // Database concept
class UserModel { }        // Framework term
```

**Impact:** Domain model polluted with technical concerns.

### Version in Name
**Pattern:** Version markers instead of proper migration.

```typescript
class Order { }
class OrderV2 { }          // Why not just Order?
class NewOrder { }         // New relative to what?
class LegacyCustomer { }   // When is it not legacy?
```

**Impact:** Names become meaningless over time. What is V3?

## Detection Methods

### Code Search
```bash
# Find potential synonyms
grep -rn "Order\|Purchase\|Transaction\|Sale" src/ | \
  cut -d: -f1 | sort | uniq

# Find "And" in function names
grep -rP "function \w+And\w+" src/

# Find version markers
grep -rn "V2\|V3\|New\|Old\|Legacy" src/

# Find layer leakage
grep -rn "Entity\|DTO\|Row\|Model" src/domain/
```

### Static Analysis
Tools that can help:
- ESLint with naming-convention rules
- SonarQube identifier checks
- Custom linting for project conventions

### Review Checklist
- [ ] Does new code use same terms as existing code?
- [ ] Are method names accurate (no lies)?
- [ ] Do boolean names read as questions?
- [ ] Are implementation terms kept out of domain layer?
- [ ] Are there "And" functions that should split?

## Signs of Naming Debt

### Warning Signs
1. **Frequent clarification questions:** "Which Order class do you mean?"
2. **Translator developers:** Someone who knows the "real" names
3. **Comment-heavy code:** Comments explaining what names mean
4. **Onboarding friction:** New devs struggle with terminology
5. **Doc rot:** Nobody updates the glossary

### Critical Signs
1. **Bugs from wrong imports:** `import { Account } from './wrong/place'`
2. **Code review conflicts:** "Should this be Order or Purchase?"
3. **Refactoring fear:** "We can't rename, too many places"
4. **Parallel vocabularies:** Business says X, code says Y

## Recovery Strategies

### Immediate (Stop the Bleeding)
1. Add `reviewing-naming.md` to code review process
2. Flag new inconsistencies as blocking issues
3. Document what EXISTS, even if messy

### Short-term (Reduce Confusion)
1. Pick winners for each synonym set
2. Add deprecation notices to losers
3. Update high-traffic code paths first

### Long-term (Systematic Cleanup)
1. Run `discovering-naming.md` audit
2. Create full glossary from findings
3. Migrate one bounded context at a time
4. Track naming debt like tech debt

## Anti-Pattern Quick Reference

| Anti-Pattern | Detection | Severity |
|--------------|-----------|----------|
| Method lies | Side effects in get/is/has | High |
| And in name | Search "And" in functions | Medium |
| Attribute lies | Type vs. name mismatch | High |
| Bad booleans | Not readable as question | Low |
| Synonyms | Same concept, different names | High |
| Collision | Same name, different concepts | Critical |
| Abbreviation mix | Inconsistent short forms | Low |
| Layer leakage | Entity/DTO/Row in domain | Medium |
| Version in name | V2/New/Legacy in types | Medium |
