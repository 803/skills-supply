# Result and Error Handling Approach

> Errors are values. Context flows with them. Structure survives to the boundary.

This document describes the error handling philosophy for the skills-supply packages. It's not about specific types or migration — it's about invariants that code should maintain.

## Core Philosophy

### Errors Are Values, Not Exceptions

Functions return `Result<T, E>` rather than throwing. Exceptions are reserved for truly exceptional cases — programmer errors, invariant violations, cases where recovery is impossible.

Why: Returned errors are explicit in the type signature. Callers must handle them. Nothing gets silently swallowed or unexpectedly thrown.

### Errors Carry Context

An error should answer: "What failed, and what was happening when it failed?"

A bare message like `"not found"` is useless. An error with type, message, and cause chain tells the full story: the parse failed because the file couldn't be read because the path didn't exist.

### Structure Survives to the Boundary

Errors maintain their typed structure from origin to CLI. Only at the final display boundary do we convert to strings. This enables:

- Rich human-readable formatting with context
- Machine-parseable JSON output
- Programmatic error handling in callers

## The Shapes

### BaseError

All errors conform to this interface:

```typescript
interface BaseError {
  type: string        // Broad category
  message: string     // Human-readable description
  cause?: BaseError   // Chain to underlying error
}
```

That's it. Three fields.

- `type` is a broad category, not a specific code. Think `"validation"`, `"io"`, `"parse"` — not `"invalid_alias"` or `"file_not_found"`.
- `message` explains what went wrong in human terms.
- `cause` links to the underlying error when wrapping.

Domain-specific errors extend this with additional fields. A sync error might add `stage`. A network error might add `status`. But all errors satisfy BaseError, which means any error can be formatted, logged, or serialized without knowing its specific type.

### Result<T, E>

```typescript
type Result<T, E extends BaseError = BaseError> =
  | { ok: true; value: T }
  | { ok: false; error: E }
```

Parameterized by error type. Functions declare what errors they can produce. The type system tracks this through composition.

### Why No `code` Field?

Earlier designs had both `type` (category) and `code` (specific error). This created confusion: which do you check? What's the difference?

The answer: `type` is the broad category. Domain extensions add specificity through their own fields. A validation error with `field: "alias"` is clearer than a generic error with `code: "invalid_alias"`.

## Domain Extensions

### The Pattern

BaseError is deliberately minimal. Domains add fields that provide context specific to their operations:

```typescript
// Core: adds path for file operations
type IoError = BaseError & {
  type: "io"
  path: AbsolutePath
  operation?: string
}

// sk: adds stage for sync operations
type SyncError = BaseError & {
  stage: "fetch" | "detect" | "extract" | "install"
  alias?: Alias
}

// discovery: adds HTTP context for API calls
type NetworkError = BaseError & {
  type: "network"
  status?: number
  retryable?: boolean
}
```

### What To Add

Ask: "What context helps answer 'what was happening when this failed?'"

Good additions:

- `path` — Which file?
- `stage` — Which phase of a multi-step operation?
- `alias` — Which package?
- `status` — What did the server return?
- `source` — What URL or ref failed?

Bad additions:

- Redundant info already in `message`
- Internal implementation details
- Fields the caller can't act on

### Structural Typing at Boundaries

Because all domain errors extend BaseError, any error can be handled generically at package boundaries:

```typescript
function formatError(error: BaseError): string {
  // Works for IoError, SyncError, NetworkError, anything
  return `[${error.type}] ${error.message}`
}
```

No type assertions. No switch on error types. Structural typing just works.

## Composition

When function A calls function B, what happens to B's errors?

### The Rule

**Wrap when adding context. Pass through otherwise.**

This is the only rule. Everything else follows from it.

### Pass-Through

When the inner error already says everything needed, widen your return type:

```typescript
function loadMarketplace(path: AbsolutePath): Result<MarketplaceInfo, IoError | ParseError> {
  const contents = readFile(path)
  if (!contents.ok) return contents  // IoError passes through

  return parseMarketplace(contents.value)  // ParseError passes through
}
```

No conversion. No wrapping. The union type honestly reflects what can fail.

### Wrap With Cause

When you have meaningful context to add:

```typescript
function syncPackage(pkg: CanonicalPackage): Result<void, SyncError> {
  const fetched = fetchPackage(pkg)
  if (!fetched.ok) {
    return {
      ok: false,
      error: {
        type: fetched.error.type,
        message: `Failed to sync ${pkg.origin.alias}: ${fetched.error.message}`,
        stage: "fetch",
        alias: pkg.origin.alias,
        cause: fetched.error  // Original preserved
      }
    }
  }
}
```

The cause chain preserves the full story. The wrapper adds "what operation was attempted."

### When To Wrap

Wrap when you can answer questions the inner error can't:

- "Which package?" — add `alias`
- "Which stage?" — add `stage`
- "What were we trying to do?" — enrich `message`

### When To Pass Through

Pass through when wrapping adds nothing:

- Inner error is already specific enough
- You're just propagating up the call stack
- Wrapping would just duplicate the message

### The Cause Chain

The `cause` field creates a linked list of errors:

```
SyncError { stage: "fetch", cause:
  FetchError { source: "owner/repo", cause:
    NetworkError { status: 404, message: "Not found" }}}
```

At display time, walk the chain to show the full context.

## The CLI Boundary

### Two Type Systems Meet

The codebase has two result patterns:

- `Result<T, E>` — For operations. "Did it work?"
- `CommandResult<T>` — For user flows. "What happened?"

These are intentionally different. `Result` is `ok`/`error`. `CommandResult` is `completed`/`unchanged`/`cancelled`/`failed`.

See [Command Result Types Design](../docs/2026-01-02-command-result-types-design.md) for the full rationale.

### CommandResult Carries The Error

```typescript
type CommandResult<T = void> =
  | { status: "completed"; value: T }
  | { status: "unchanged"; reason: string }
  | { status: "cancelled" }
  | { status: "failed"; error: BaseError }
```

The `failed` case preserves the structured error. No information lost.

### Converting Result to CommandResult

```typescript
function toCommandResult<T>(result: Result<T, BaseError>): CommandResult<T> {
  if (result.ok) {
    return { status: "completed", value: result.value }
  }
  return { status: "failed", error: result.error }
}
```

### Formatting For Humans

```typescript
function formatError(error: BaseError): string {
  let output = `[${error.type}] ${error.message}`

  if (error.cause) {
    output += `\n  Caused by: ${formatError(error.cause)}`
  }

  return output
}
```

Walk the cause chain. Show the full story.

### Formatting For Machines

```typescript
if (options.json) {
  console.log(JSON.stringify({ error: result.error }))
}
```

The error is already structured. Just serialize it.

### No Throwing

Errors flow as values from origin to display. The only place exceptions appear is for truly exceptional cases — bugs, invariant violations, things that should crash the process.

If you're writing `throw new Error(result.error.message)`, stop. You're discarding structure. Return the error instead.

### Exceptions Are For Exceptions

When wrapping system calls that throw, catch only what you can handle:

```typescript
async function readFile(path: AbsolutePath): Promise<Result<string, IoError>> {
  try {
    const contents = await fs.readFile(path, "utf-8")
    return { ok: true, value: contents }
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      // Known filesystem error — convert to Result
      return {
        ok: false,
        error: { type: "io", message: error.message, path }
      }
    }
    // Unknown exception — rethrow, don't swallow
    throw error
  }
}
```

Swallowing unknown exceptions hides bugs. If you don't know what it is, let it crash. That's what exceptions are for — exceptional situations you can't handle.

## Invariants

These must always be true:

1. **Every error satisfies BaseError** — Has `type`, `message`, optionally `cause`
2. **Cause chains are typed** — `cause` is `BaseError`, not `unknown`
3. **Structure reaches the CLI** — No `throw new Error(err.message)` discarding types
4. **Unions are honest** — Return type reflects all errors that can occur

## Anti-Patterns

### Don't: Discard error structure

```typescript
// Bad: structure lost
if (!result.ok) {
  throw new Error(result.error.message)
}

// Good: structure preserved
if (!result.ok) {
  return { status: "failed", error: result.error }
}
```

### Don't: Swallow unknown exceptions

```typescript
// Bad: hides bugs
try {
  await riskyOperation()
} catch (error) {
  return { ok: false, error: { type: "unknown", message: String(error) } }
}

// Good: only catch what you understand
try {
  await riskyOperation()
} catch (error) {
  if (isKnownError(error)) {
    return { ok: false, error: toBaseError(error) }
  }
  throw error
}
```

### Don't: Wrap without adding value

```typescript
// Bad: wrapper adds nothing
if (!inner.ok) {
  return {
    ok: false,
    error: { type: inner.error.type, message: inner.error.message, cause: inner.error }
  }
}

// Good: just pass through
if (!inner.ok) {
  return inner
}
```

### Don't: Duplicate message in wrapper

```typescript
// Bad: redundant
error: {
  message: `Failed: ${inner.error.message}`,  // "Failed: Not found"
  cause: inner.error                           // Also has "Not found"
}

// Good: add new context
error: {
  message: `Failed to sync package ${alias}`,  // What we were doing
  cause: inner.error                            // Why it failed
}
```
