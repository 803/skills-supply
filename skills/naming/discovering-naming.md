# Discovering Naming Concepts

## Purpose

Audit a codebase to find all existing naming concepts and build an initial glossary. This is archaeology—understanding what naming already exists before trying to improve or add to it.

## When to Use

- Starting on a new codebase (first task: what terms exist?)
- Before major refactoring
- Periodic audits (quarterly naming health check)
- After acquiring/merging codebases
- When naming feels "out of control"

## Process

### Step 1: Extract Domain Nouns

Scan for domain-specific terms in code:

```bash
# Find class/type names (adjust for your language)
grep -rhoP '(?:class|interface|type)\s+\K[A-Z][a-zA-Z]+' src/ | sort | uniq -c | sort -rn > nouns.txt

# Find enum names
grep -rhoP 'enum\s+\K[A-Z][a-zA-Z]+' src/ | sort | uniq -c | sort -rn >> nouns.txt

# Find exported constants that look like domain terms
grep -rhoP 'export\s+const\s+\K[A-Z][A-Z_]+' src/ | sort | uniq -c | sort -rn >> nouns.txt
```

**Filter out non-domain terms:**
- Generic programming terms: `Handler`, `Manager`, `Service`, `Helper`, `Utils`
- Framework terms: `Controller`, `Middleware`, `Provider`
- Infrastructure: `Database`, `Cache`, `Logger`

**Keep domain terms:**
- Business entities: `Order`, `Customer`, `Product`
- Domain operations: `Checkout`, `Fulfillment`, `Refund`
- Domain states: `OrderStatus`, `PaymentState`

### Step 2: Map Directory Structure to Bounded Contexts

Directories often reveal implicit bounded contexts:

```
src/
  sales/          ← sales context
    Order.ts
    Customer.ts
  fulfillment/    ← fulfillment context
    Order.ts      ← same name, different context!
    Shipment.ts
  billing/        ← billing context
    Invoice.ts
    Payment.ts
```

Create a context map:

```yaml
contexts:
  sales:
    path: src/sales/
    terms: [Order, Customer, Cart, Checkout]
  fulfillment:
    path: src/fulfillment/
    terms: [Order, Shipment, Warehouse, Inventory]
  billing:
    path: src/billing/
    terms: [Invoice, Payment, Subscription, Refund]
```

### Step 3: Identify Inconsistencies

Look for **same concept, different names**:

```bash
# Find variations of common terms
grep -rn "Order\|Purchase\|Transaction" src/ | head -50

# Look for abbreviations vs full names
grep -rn "Cust\|Customer" src/
grep -rn "Txn\|Transaction" src/
```

**Inconsistency patterns:**
| Pattern | Example | Problem |
|---------|---------|---------|
| Synonyms | `Order` vs `Purchase` | Which is canonical? |
| Abbreviations | `Cust` vs `Customer` | Inconsistent readability |
| Pluralization | `OrderItem` vs `OrderItems` | Plural type names |
| Prefixes | `CustomerOrder` vs `Order` | Redundant context |
| Suffixes | `Order` vs `OrderEntity` vs `OrderModel` | Layer leakage |

### Step 4: Identify Conflicts

Look for **same name, different concepts**:

```bash
# Find same term used in multiple directories
for term in Order Customer Account; do
  echo "=== $term ==="
  find src/ -name "*.ts" -exec grep -l "class $term\|interface $term\|type $term" {} \;
done
```

**Conflict patterns:**
| Pattern | Example | Problem |
|---------|---------|---------|
| Context collision | `Order` in sales vs fulfillment | Same name, different meaning |
| Layer collision | `User` in domain vs `User` in auth | Same name, different scope |
| Legacy collision | `Order` vs `OrderV2` | Version in name |

### Step 5: Build Initial Glossary

For each discovered term, create a draft entry:

```yaml
# Draft - needs review
term: Order
status: draft
sources:
  - src/sales/Order.ts:15
  - src/fulfillment/Order.ts:22
notes: |
  Found in two contexts with potentially different meanings.
  Sales: customer's purchase request
  Fulfillment: work item to ship
  Need to clarify if these are same concept or should be distinct.
```

**Draft fields:**
- `term`: The name as found
- `status`: `draft` (needs review), `confirmed`, `deprecated`
- `sources`: Where found in code
- `notes`: Observations, questions, conflicts

### Step 6: Categorize Findings

Group discoveries into action items:

```markdown
## Discovery Report: [Codebase Name]

### Well-Defined Terms (no action needed)
- `Customer` - consistent usage, clear meaning
- `Product` - consistent usage, clear meaning

### Inconsistent Terms (need unification)
- `Order` / `Purchase` - same concept, different names
  - Recommendation: Standardize on `Order`
  - Affected files: [list]

### Conflicting Terms (need disambiguation)
- `Account` - means different things in billing vs users
  - Recommendation: `BillingAccount` vs `UserAccount`
  - Affected files: [list]

### Missing Terms (need creation)
- Concept of "recurring order" exists in code but has no name
  - Used as: `order.isRecurring`, `recurringOrderJob`
  - Recommendation: Create `SubscriptionOrder` term

### Deprecated Terms (need removal)
- `OrderV2` - legacy naming, should migrate to `Order`
  - Affected files: [list]
```

## Output Format

Discovery produces a report with:

```markdown
## Naming Discovery Report

**Codebase:** [name]
**Date:** [date]
**Scope:** [directories scanned]

### Summary
- Terms found: [N]
- Contexts identified: [N]
- Inconsistencies: [N]
- Conflicts: [N]
- Missing glossary entries: [N]

### Context Map
[Directory → context mapping]

### Term Inventory
[Table of all terms with status]

### Issues Found
[Categorized list with recommendations]

### Recommended Actions
1. [Priority action items]
2. ...

### Draft Glossary
[YAML glossary entries for all discovered terms]
```

## Automated Discovery Script

For large codebases, automate extraction:

```bash
#!/bin/bash
# discover-naming.sh

echo "=== Extracting domain nouns ==="
grep -rhoP '(?:class|interface|type)\s+\K[A-Z][a-zA-Z]+' src/ \
  | sort | uniq -c | sort -rn \
  | grep -v -E '(Handler|Manager|Service|Helper|Utils|Controller|Provider)' \
  > domain-nouns.txt

echo "=== Finding potential conflicts ==="
for term in $(head -20 domain-nouns.txt | awk '{print $2}'); do
  count=$(find src/ -name "*.ts" -exec grep -l "class $term\|interface $term" {} \; | wc -l)
  if [ "$count" -gt 1 ]; then
    echo "CONFLICT: $term found in $count files"
  fi
done

echo "=== Output ==="
echo "Domain nouns: domain-nouns.txt"
```

## Common Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|----------------|-----|
| Only scanning types | Variables/functions also carry naming | Include all code elements |
| Ignoring directories | Directory structure reveals contexts | Map directories to contexts |
| Listing without categorizing | Raw list isn't actionable | Group by status (consistent/inconsistent/conflicting) |
| No conflict detection | Assumes same name = same concept | Explicitly check for semantic conflicts |
| One-time audit only | Naming drifts continuously | Schedule periodic re-discovery |

## When Discovery Reveals Chaos

If discovery finds severe inconsistency (30%+ terms with issues):

1. **Don't try to fix everything at once**
2. **Start with highest-frequency terms** (most used = most impact)
3. **Create glossary entries for top 10 terms first**
4. **Use `reviewing-naming.md` to prevent NEW inconsistencies** while cleaning up
5. **Schedule incremental cleanup** over multiple sprints

The goal of discovery isn't to fix—it's to understand. Fixing comes later, incrementally.
