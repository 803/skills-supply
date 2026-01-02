# Academic Research on Naming

## Key Statistics

### Defect Detection
**Finding:** Good identifier names enable 20% faster defect detection.
**Source:** Hofmeister et al. (2019), "Shorter identifier names take longer to comprehend"

### Time Spent on Bad Code
**Finding:** Developers spend 42% more time on code with poor naming conventions.
**Source:** Fakhoury et al. (2018), SANER study on code comprehensibility

### Anti-Pattern Recognition
**Finding:** 69% of developers recognize naming anti-patterns but don't fix them.
**Implication:** Recognition isn't the problem—habits and process are.

### Comprehension Time
**Finding:** Code with consistent naming reduces comprehension time by ~30%.
**Source:** Multiple studies on identifier quality and code reading

## What Makes Good Identifier Names

### Length
- **Too short:** Cryptic, requires mental lookup (`n`, `tmp`, `x`)
- **Too long:** Hard to scan, noisy (`numberOfItemsInShoppingCartAfterDiscount`)
- **Optimal:** 8-20 characters for most identifiers
- **Exception:** Loop counters (`i`, `j`) and lambdas can be short

### Word Choice
- **Concrete > Abstract:** `sendEmail` > `handleNotification`
- **Specific > Generic:** `orderTotal` > `amount`
- **Domain terms > Technical:** `Customer` > `UserEntity`

### Consistency
**Most important factor.** Inconsistent naming (mixing `Customer`/`Client`/`User`) is worse than suboptimal but consistent naming.

### Grammatical Patterns
- **Classes/Types:** Nouns (`Order`, `Customer`, `PaymentMethod`)
- **Functions/Methods:** Verbs (`calculate`, `send`, `validate`)
- **Booleans:** Questions (`isValid`, `hasPermission`, `canProceed`)
- **Collections:** Plural nouns (`orders`, `customers`, `items`)

## Naming and Cognitive Load

### Working Memory Limits
Developers hold ~4 concepts in working memory while coding. Each unfamiliar or inconsistent name consumes capacity.

### Translation Cost
When code says `Purchase` but domain experts say `Order`, developers constantly translate. This translation is:
- Exhausting (continuous mental effort)
- Error-prone (translation mistakes cause bugs)
- Exclusionary (new devs don't know the mapping)

### The Familiarity Advantage
Consistent naming creates familiarity. Familiar patterns are processed automatically, freeing cognitive capacity for actual problem-solving.

## Studies on Naming Practices

### Butler et al. (2009)
**Taxonomy of identifier naming issues:**
1. Capitalization anomalies
2. Consecutive underscores
3. Dictionary words (overloaded meaning)
4. Excessive words
5. Long names
6. Numeric identifier
7. Short names

**Finding:** Flawed identifier names correlate with lower code quality.

### Arnaoudova et al. (2013)
**Linguistic anti-patterns:**
1. Methods that do more/less than their name suggests
2. Names containing "And" (violation of single responsibility)
3. Attribute names that lie about their content
4. Boolean names that don't read as questions

### Fakhoury et al. (2018)
**Surprising finding:** Measured readability tools (like Flesch-Kincaid) don't correlate well with actual comprehension time for code.

**Implication:** Code readability is different from prose readability. Domain consistency matters more than "simple words."

## Cost of Naming Debt

### Documentation Decay
- **Week 1:** Docs match code (0% drift)
- **Month 1:** Docs mostly match (10% drift)
- **Month 6:** Significant gaps (25% drift)
- **Year 1:** Docs are "aspirational" (50% drift)
- **Year 2+:** Nobody trusts docs (75%+ drift)

### Onboarding Impact
New developers learn from:
1. Existing code (50%)
2. Asking colleagues (30%)
3. Documentation (20%)

If code naming is inconsistent, onboarding propagates that inconsistency.

### Bug Correlation
Studies show correlation between naming quality and bug density:
- Files with naming issues have 2x bug density
- Renamed (cleaned) files show reduced bug rates

**Causation unclear:** Bad naming may cause bugs OR both may come from rushed development.

## Recommendations from Research

### For Individuals
1. Use full words, not abbreviations
2. Use domain vocabulary, not technical jargon
3. Name things for what they ARE, not how they're USED
4. Be consistent with existing code, even if you disagree

### For Teams
1. Establish glossary early
2. Enforce naming in code review
3. Update glossary when introducing new concepts
4. Treat naming inconsistency as a bug

### For Organizations
1. Invest in ubiquitous language development
2. Include domain experts in naming decisions
3. Track naming debt like technical debt
4. Build tooling to detect inconsistencies

## Sources

- Hofmeister, J., et al. (2019). Shorter identifier names take longer to comprehend.
- Fakhoury, S., et al. (2018). The effect of poor source code lexicon and readability on developers' cognitive load.
- Butler, S., et al. (2009). Relating identifier naming flaws and code quality.
- Arnaoudova, V., et al. (2013). A new family of software anti-patterns: Linguistic anti-patterns.
- Lawrie, D., et al. (2006). What's in a name? A study of identifiers.
