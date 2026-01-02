# Academic Research on Naming in Software

## The Famous Quote

> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil Karlton (~1970, Carnegie Mellon)

The insight: comparing something most experts agree is difficult (cache invalidation) with something seemingly trivial (naming) - until you realize it isn't trivial at all.

## Empirical Findings

### Comprehension Studies

**Key finding (Hofmeister et al., Saarland University):**
- Participants detected defects **20% faster** when code contained identifier names using words instead of abbreviations or single letters
- **Full words outperform abbreviations and single letters** for program comprehension
- Statistical tests revealed that **single-letter identifiers performed poorly** compared to full words and abbreviations

**Butler et al. (Open University):**
- Evaluated identifier names in 8 open-source Java applications
- Found **statistically significant associations between flawed identifiers** and **code quality issues** reported by static analysis tools

### Eye Tracking Studies

**Sharif and Maletic (2010):**
- **camelCase leads to higher accuracy** among all subjects regardless of training
- Training in a particular style improves speed but not accuracy
- camelCase took 13.5% longer to read than underscored identifiers, but was more accurate

**Code Reading Patterns:**
- Expert programmers pay more attention to "beacons" (key code fragments including meaningful identifiers)
- Reading code includes many **vertical jumps** (non-linear reading)
- Gaze focused on transitions between **identifiers and expressions**

### Cognitive Load Research

**Arnaoudova et al. - Linguistic Antipatterns:**
- Catalogued **17 types** of linguistic antipatterns (inconsistencies between method signatures, documentation, and behavior)
- **69% of external developers** and **51% of internal developers** perceive LAs as poor practices
- LAs have a **negative impact on developers' cognitive load**

## What Makes a Good Identifier Name

### Research-Backed Guidelines

From SCANL Identifier Name Structure Catalogue:
- Identifier names should be composed of **2-4 natural language words** or project-accepted acronyms
- Names should **not contain only abstract words**
- Names should **not contain plural words**
- Names should conform to project naming conventions

### Grammar Patterns

Common identifier patterns:
- `P NM NM N` pattern: `from_Local_Aabb_Min`
- `P N` pattern: `to_string()`
- Variables often map to **nouns**, methods to **verbs**

## The "Naturalness" of Code

**Hindle et al. (2012) - "On the Naturalness of Software":**
- Source code exhibits statistical properties similar to natural language
- Code follows statistical patterns similar to human language
- This enables NLP techniques to work on code

**Implications:**
- Identifier names carry semantic intent
- Code is dual-audience communication (machines + humans)
- Brain processes code linguistically (recruits same brain regions as natural language)

## Naming Quality Model

Research on "Towards a Naming Quality Model" found:
- Longer, descriptive identifier names improve code comprehension
- Tools that "improve the code lexicon are rarely applied commercially"
- More research needed on "complete theory of program comprehension to understand the role of identifiers"

## Developer Time Impact

**Stripe Developer Coefficient Report:**
- Engineers spend up to **42% of their time** maintaining "bad code"
- Poor naming is "silent tech debt that grows until it breaks"
- Every unclear name adds hours of translation overhead

## Key Takeaways

1. **Naming is not cosmetic** - it's a core factor in code comprehension and bug prevention
2. **Full words beat abbreviations** - empirically proven across multiple studies
3. **Consistency matters more than any specific convention**
4. **Linguistic antipatterns cause real cognitive load** - 69% of developers recognize them as problems
5. **Code is human communication first** - it must satisfy machine execution while remaining human-comprehensible

## Key Sources

- Hofmeister et al., Saarland University - Identifier comprehension study
- Butler et al., Open University - Identifier flaws and code quality
- Sharif & Maletic - Eye tracking on camelCase vs underscore
- Arnaoudova et al. - Linguistic Antipatterns
- Hindle et al. - "On the Naturalness of Software" (IEEE ICSE 2012)
- SCANL Identifier Name Structure Catalogue (GitHub)
