# Taxonomy and Ontology Principles from Library Science

## Core Insight

Libraries solved the "many terms for same concept" problem not by eliminating variation, but by creating **explicit mappings** between variants and canonical forms.

## Terminology Management Principles

### Systematic Organization

From terminology management best practices:
- Group terms by subject area or project for easy retrieval
- Use consistent formatting and naming conventions
- Include metadata like creation date and last update
- Tag terms with relevant categories

**Application to Code:** Just as terminologists group terms by subject area, code should group related concepts in modules/namespaces with consistent naming patterns.

## Controlled Vocabulary Types

| Type | Description | Code Analogy |
|------|-------------|--------------|
| **Subject Headings** | Standardized terms for topics | Module/namespace naming |
| **Authority Files** | Canonical names for entities | Type definitions |
| **Thesauri** | Terms with synonyms, broader/narrower | API documentation with aliases |
| **Taxonomies** | Hierarchical classification | Class hierarchies |
| **Ontologies** | Rich semantic relationships | Type systems with constraints |

## Thesaurus Relationship Types

Library science distinguishes three types of relationships:

### 1. Equivalence Relations
- **Preferred terms** vs **Non-preferred terms** (synonyms)
- Example: "Heart Attack" maps to preferred term "Myocardial Infarction"

**Code Application:**
- One canonical type/function name
- Explicit, documented aliases
- Tooling that shows the canonical form

### 2. Hierarchical Relations
- **Broader Term (BT)** / **Narrower Term (NT)**
- Example: "Cardiovascular Diseases" BT → "Heart Diseases" NT

**Code Application:**
- Inheritance hierarchies
- Interface/implementation relationships
- Generic/specific type relationships

### 3. Associative Relations
- **Related Term (RT)** - concepts associated but not hierarchically
- Example: "Heart" RT "Cardiovascular System"

**Code Application:**
- "This type works well with X"
- Related concepts documented together
- Cross-references in documentation

## Authority Control = Type Authority

Libraries maintain:
- **Authorized form** (the canonical name)
- **Variant forms** (alternative spellings, pseudonyms)
- **See references** (pointing from variants to authorized form)
- **See also references** (pointing to related authorities)

**Code Analogy:**
- Type aliases pointing to canonical types
- Re-exports in module systems
- Deprecation notices pointing to new APIs

## Scope Notes

Thesauri include **scope notes** explaining when to use a term.

**Code Application:**
- When to use this type vs alternatives
- What context this concept belongs to
- Disambiguation from similar concepts

## Faceted Classification

Library science uses **faceted classification** where items can be classified along multiple independent dimensions (author, subject, date, format).

**Code Application:**
- Tags/labels in issue trackers
- Multiple type constraints (generics with bounds)
- Multi-dimensional categorization of APIs

## Ontology Engineering Phases

According to Pulido et al. (2006):
1. **Gathering** - Collecting domain knowledge
2. **Extracting** - Identifying key concepts
3. **Organization** - Structuring relationships
4. **Combining** - Integrating multiple sources
5. **Refining** - Iterative improvement
6. **Retrieval** - Making knowledge accessible

## Key Insight: Taxonomy vs Ontology Trade-offs

From Heather Hedden (taxonomy expert):

> "Taxonomies have features not supported by ontologies based only on OWL and RDF-S standards. These taxonomy features include:
> - Incorporation of synonyms to support searching and tagging
> - Support of multilingual concepts
> - Inclusion of definitions and notes in a standardized manner
> - Ability to map and link taxonomies"

**Implication:** Sometimes a simpler hierarchical structure with rich synonym support is more practical than a complex ontology.

## Practical Applications for Code

1. **Preferred Terms + Aliases**: Establish canonical name, document all variants
2. **Scope Notes**: Document when to use this vs alternatives
3. **Relationship Types**: Explicitly document equivalence, hierarchy, association
4. **Authority Control**: Single source of truth for type definitions
5. **Faceted Classification**: Multiple dimensions for categorizing APIs

## Sources

- HyTerm - "The Art of Terminology Management"
- Hedden Information - "Taxonomy Benefits Over an Ontology"
- University of Texas Libraries - Controlled Vocabularies
- American University Library - Authority Control
- W3C SKOS (Simple Knowledge Organization System)
