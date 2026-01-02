# DDD Ubiquitous Language Research

## Core Concept (Eric Evans, 2004)

Ubiquitous Language is a shared vocabulary developed collaboratively by developers and domain experts. It represents the terms and concepts of the business domain with no ambiguity.

**Key Principle:** "Using the same language and terminology in your code as is used in the wider domain." The words that the business uses should be the same words that appear in your software artifacts.

## Properties of Ubiquitous Language

1. **Consistent** within a Bounded Context
2. **Expressed in the Domain Model** (code, classes, methods, database tables)
3. **Used everywhere** - discussions, documentation, code, requirements
4. **Evolved over time** - not defined entirely in a single meeting

## Language Belongs to Bounded Contexts

A bounded context is fundamentally a **linguistic boundary**. The same word can mean entirely different things in different contexts, and this is expected.

**Classic Example: "Customer"**
- In **Sales**: A lead (someone showing interest)
- In **Billing**: Someone who has paid
- In **CRM**: Both active and churned accounts

**Key insight from Vlad Khononov:**
> "When we reach a mental conflict regarding the modeling of a ubiquitous language we must divide it into multiple smaller languages. Each of these smaller languages only applies within an explicit boundary that we call the bounded context."

## Context Mapping Patterns

How bounded contexts relate and translate terminology:

| Pattern | Translation Approach |
|---------|---------------------|
| **Shared Kernel** | No translation for shared portion; teams agree on shared terms |
| **Customer/Supplier** | Downstream requests what it needs; upstream provides in its terms |
| **Conformist** | No translation - downstream adopts upstream terminology entirely |
| **Partnership** | Joint translation - both teams agree on how concepts map |
| **Anti-Corruption Layer (ACL)** | Full translation - dedicated layer converts foreign models to local terms |
| **Open Host Service** | Published API provides stable translation interface |
| **Published Language** | Standardized vocabulary (like XML schemas or JSON-LD) |
| **Separate Ways** | No translation - contexts operate independently |

## Anti-Corruption Layer (ACL)

The ACL acts as a **protective buffer** that:
1. Translates between models
2. Prevents upstream assumptions from polluting downstream context
3. Allows internal models to evolve independently

**When to use ACL:**
- Integrating with legacy systems with different conceptual models
- Working with third-party APIs whose terminology conflicts with yours
- The upstream system may change in ways you can't control
- You want your core domain to remain pure

## Practical Implementation

### Event Storming for Discovery

Event Storming (Alberto Brandolini) surfaces domain terminology through:
- **Orange sticky notes**: Domain Events (past tense facts)
- **Blue sticky notes**: Commands (actions that trigger events)
- **Yellow sticky notes**: Actors/Users
- **Purple sticky notes**: Policies/Business Rules
- **Pale yellow sticky notes**: Aggregates

### Direct Mapping to Code

```
Orange Event → Domain Event class/record
Blue Command → Command class/handler
Pale Yellow → Aggregate Root entity
Purple Policy → Event handler/saga
```

### Maintenance Processes

**Regular Review Cycles:**
- Quarterly reviews where process owners verify terminology accuracy
- Check recent implementations against documented language
- Update documentation immediately when language changes

**Language Drift Prevention:**
- Common when multiple teams change business logic simultaneously
- Periodic terminology checks keep everyone aligned
- Contract testing ensures APIs match expected vocabulary

## Common Pitfalls

1. **Language Drift**: Multiple teams changing terminology simultaneously
2. **Overcomplication**: Applying every DDD pattern too early
3. **Boundary Mistakes**: Misaligned bounded context boundaries
4. **Multiple Languages in Same Context**: Should divide into smaller contexts
5. **Technical vs. Business Language**: Developers using jargon domain experts don't understand
6. **Static Definition**: Treating language as something to define once and freeze

## Key Insight

> "The difference between their initial approach and the one they ended up using was the shift from aggregates everywhere to ubiquitous language." — Vlad Khononov

**Ubiquitous Language reduces project failure more than any technical pattern.**

## Sources

- Eric Evans, "Domain-Driven Design: Tackling Complexity in the Heart of Software" (2004)
- Vlad Khononov, "Learning Domain-Driven Design" (O'Reilly)
- SAP Curated Resources for DDD
- Alberto Brandolini, "Introducing EventStorming"
