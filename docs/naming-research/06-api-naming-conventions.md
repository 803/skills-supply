# API Naming Conventions

## REST API Naming

### Core Principles

**Resource-Oriented Design:**
- Use **plural nouns** for resources, not verbs
- Good: `/users`, `/orders`, `/products`
- Bad: `/getUsers`, `/createOrder`, `/deleteProduct`

**Casing Conventions:**
| Context | Convention | Example |
|---------|------------|---------|
| URL paths | kebab-case | `/api/task-groups` |
| JSON fields | snake_case or camelCase | `user_id` or `userId` |

**Critical Rule:** Pick one convention and use it consistently everywhere.

## Google API Design Guide (AIP-190)

### Interface Names
- Use intuitive nouns: `Calendar`, `BlobStore`, `Library`
- Avoid conflict with programming language concepts
- Use suffix like `Api` or `Service` to disambiguate

### Method Names
- Follow `VerbNoun` in UpperCamelCase
- Standard methods: `Get`, `List`, `Create`, `Update`, `Delete`

### Message Names
- Keep short and concise
- Avoid unnecessary adjectives
- Don't include prepositions ("With", "For")

### All names should be:
1. Simple
2. Intuitive
3. Consistent
4. Use small vocabulary (helps non-native English speakers)

## GraphQL Naming

| Element | Convention | Example |
|---------|------------|---------|
| Types | PascalCase | `User`, `Order` |
| Fields | camelCase | `firstName`, `createdAt` |
| Enum Values | SCREAMING_SNAKE_CASE | `NEWHOPE`, `EMPIRE` |
| Mutations | camelCase verbs | `createReview`, `updateUser` |

## Protocol Buffers / gRPC

| Element | Convention | Example |
|---------|------------|---------|
| Messages | PascalCase | `UserRequest`, `Customer` |
| Fields | snake_case | `user_id`, `auth_token` |
| Services | PascalCase | `UserService` |
| RPC Methods | PascalCase | `GetUserInfo`, `AddCustomer` |
| Enum values | SCREAMING_SNAKE_CASE | `INDIVIDUAL = 0` |

## Stripe's API Design Philosophy

Core Principles:
- **API design is product design** - treat with same rigor
- **Avoid internal jargon** - eliminate acronyms
- **Hide complexity** - abstract away implementation details
- **Anchor to user intent**, not implementation
- **Dogfooding** - use your own API in your product

> "If developers have to guess how your system behaves, your mental model - and therefore your product - is flawed."

## API Governance Tools

### Linting

**Spectral (Stoplight):**
- Open-source OpenAPI document linter
- Validates quality of OpenAPI documents
- CI/CD integration
- Custom rulesets

**Redocly CLI:**
- OpenAPI, AsyncAPI linting
- API guidelines enforcement
- Built-in rules + custom rule support

### Key Features for Governance
- Enforce naming conventions automatically
- Catch security hazards
- Ensure consistency across API lifecycle
- Shape API design before implementation

## Summary: Naming by System

| System | Types/Messages | Fields | Methods | Enums |
|--------|---------------|--------|---------|-------|
| REST | N/A | snake_case or camelCase | HTTP verbs | N/A |
| GraphQL | PascalCase | camelCase | camelCase | SCREAMING_SNAKE_CASE |
| Protobuf/gRPC | PascalCase | snake_case | PascalCase | SCREAMING_SNAKE_CASE |
| Google APIs | UpperCamelCase | varies | VerbNoun | varies |

## Key Takeaways

1. **Consistency trumps any specific convention**
2. **Resource-oriented > action-oriented** for REST
3. **Naming should be simple, intuitive** - optimize for non-native speakers
4. **Automate enforcement** with Spectral, Redocly, etc.
5. **Treat API design as product design**

## Sources

- Google AIP-190: Naming Conventions
- Microsoft REST API Guidelines
- GraphQL Best Practices
- Stripe Sessions: API Design Principles
- Stoplight Spectral documentation
