# Command Result Types Design

> Progress logging belongs where work happens. Outcome messaging belongs where decisions are made.

## Problem

CLI command functions use inconsistent return types and messaging patterns, causing:

1. **Double "Done." bug**: `syncWithSelection` prints "Done." then callers print it again
2. **Semantic ambiguity**: `boolean` returns conflate "success", "nothing to do", and "user cancelled"
3. **Inconsistent cancellation**: Some cancels throw, some return `true`, some return custom types

### Current State

| Function | Returns | Prints "Done."? | Called By |
|----------|---------|-----------------|-----------|
| `syncCommand` | `void` | delegates to `syncWithSelection` | CLI |
| `syncWithSelection` | `boolean` | **Yes** (line 119) | `syncCommand`, `pkgAdd`, `pkgRemove`, `handleAdd`, `handleRemove` |
| `pkgAdd` | `void` | **Yes** (line 120) if `syncOk` | CLI |
| `pkgRemove` | `void` | **Yes** (line 76) if `syncOk` | CLI |
| `pkgInteractive` | `void` | **Yes** (lines 42, 49) if `completed` | CLI |
| `handleAdd` | `boolean` | No | `pkgInteractive` |
| `handleRemove` | `boolean` | No | `pkgInteractive` |
| `initCommand` | `void` | **Yes** (line 59) | CLI |
| `agentInteractive` | `void` | **Yes** (lines 79, 90) | CLI |
| `runAgentUpdate` | `void` | **Yes** (lines 43, 50) | `agentAdd`, `agentRemove` |
| `auth` | `void` | **Yes** (line 115) | CLI |
| `status` | `void` | **Yes** (line 43) | CLI |

**Note**: `auth` and `status` are standalone commands not involved in the double "Done." bug. They're included for completeness but are out of scope for this refactor.

### The Double "Done." Bug

```
pkgAdd with --sync:
  syncWithSelection prints "Done."
  pkgAdd prints "Done." again because syncOk=true

pkgInteractive → handleAdd → user syncs:
  syncWithSelection prints "Done."
  handleAdd returns true
  pkgInteractive prints "Done." again
```

### Semantic Confusion

`handleAdd` returns `true` for three different outcomes:
- User declined to overwrite existing dependency → prints "Done." (wrong)
- User declined to sync after successful add → prints "Done." (correct)
- Sync completed → prints "Done." (doubled!)

### Inconsistent Cancellation

| Location | Cancel Action | Behavior |
|----------|--------------|----------|
| `handleAdd`: type/spec/alias | Cancel | `throw new Error("Canceled.")` |
| `handleAdd`: overwrite confirm | Cancel | `return true` → prints "Done." |
| `handleRemove`: select dependency | Cancel | `throw new Error("Canceled.")` |
| `agentInteractive`: multiselect | Cancel | `consola.info("Canceled.")` → return |
| `initCommand`: multiselect | Cancel | `{ canceled: true }` → `consola.info("Canceled.")` |

## Solution

Introduce a unified `CommandResult` discriminated union with clear ownership rules.

### Core Type

```typescript
// src/commands/types.ts

/**
 * Outcome of an interactive command or sub-operation.
 *
 * - completed: Made changes successfully, with optional return value
 * - unchanged: Completed but no changes needed (idempotent success)
 * - cancelled: User explicitly cancelled
 * - failed: Error occurred (exitCode already set, error already logged)
 *
 * Generic parameter T allows commands to return data on success:
 * - CommandResult<void> for simple commands (handleAdd, handleRemove)
 * - CommandResult<{ agents, manifest }> for resolveSyncAgents
 * - CommandResult<Set<AgentId>> for resolveAgentSelection
 *
 * Note: This uses `status` as discriminator, NOT `ok`. Core Result types
 * (IoResult, SyncResult, etc.) use `{ ok: true, value } | { ok: false, error }`
 * for operation success/failure. CommandResult is different—it represents
 * user-facing flow outcomes, not operation results. Using `status` avoids
 * confusion between the two patterns.
 */
export type CommandResult<T = void> =
    | { status: "completed"; value: T }
    | { status: "unchanged"; reason: string }
    | { status: "cancelled" }
    | { status: "failed" }

// Helper constructors
export const CommandResult = {
    completed: <T>(value: T): CommandResult<T> => ({ status: "completed", value }),
    unchanged: (reason: string): CommandResult<never> => ({ status: "unchanged", reason }),
    cancelled: (): CommandResult<never> => ({ status: "cancelled" }),
    failed: (): CommandResult<never> => ({ status: "failed" }),
} as const
```

### Scope: Unified Command Results

This refactor unifies **all** command-layer result types:

| Current Type | Location | Becomes |
|--------------|----------|---------|
| `boolean` return | `syncWithSelection` | `CommandResult<void>` |
| `boolean` return | `handleAdd`, `handleRemove` | `CommandResult<void>` |
| `SyncAgentsResult` | `sync.ts` | `CommandResult<{ agents: ResolvedAgent[]; manifest: Manifest }>` |
| `AgentSelectionResult` | `init.ts` | `CommandResult<{ selected: Set<AgentId>; warning?: string }>` |
| `AgentUpdateResult` (private) | `agent/shared.ts` | `CommandResult<AgentUpdateData>` |

**Bug fixes**:
- `SyncAgentsResult` treats user cancellation as a fatal error (throws) → explicit `cancelled` status
- `agentInteractive` and `runAgentUpdate` both have double "Done." bug → single `printOutcome` call

### Why `status` Instead of `ok`

The codebase uses `{ ok: true, value } | { ok: false, error }` for **core operations**:
- `IoResult<T>` - file system operations
- `SyncResult<T>` - sync operations
- `PackageDetectionResult` - package detection
- etc.

`CommandResult` is different—it represents **user-facing flow outcomes**:
- Did the user cancel?
- Did the operation complete?
- Was there nothing to do?

Using `status` as the discriminator makes this distinction clear and avoids confusion.

### Ownership Rules

**Rule: Sub-operations log progress, top-level commands log outcomes.**

| Layer | Logs | Examples |
|-------|------|----------|
| Sub-operations | Progress: "Syncing...", "Found X manifests" | `consola.start()`, `consola.info()` |
| Top-level commands | Outcomes: "Done.", "Failed.", "Canceled." | `consola.success()`, `consola.error()` |

Sub-operations **never** print "Done." - they return a result for the caller to interpret.

### Function Signatures

```typescript
// Sub-operations: return CommandResult<T>, log progress only
async function syncWithSelection(
    selection: ManifestSelection,
    options: { dryRun: boolean; nonInteractive: boolean },
): Promise<CommandResult<void>>

async function handleAdd(): Promise<CommandResult<void>>
async function handleRemove(): Promise<CommandResult<void>>

// Data-returning sub-operations
async function resolveSyncAgents(
    selection: ManifestSelection,
    nonInteractive: boolean,
): Promise<CommandResult<{ agents: ResolvedAgent[]; manifest: Manifest }>>

async function resolveAgentSelection(
    agentList: string | undefined,
    nonInteractive: boolean,
): Promise<CommandResult<{ selected: Set<AgentId>; warning?: string }>>

// Top-level commands: return void, handle final messaging
async function pkgAdd(...): Promise<void>
async function syncCommand(...): Promise<void>
```

## Implementation

### `resolveSyncAgents` Changes

**Before:** (`SyncAgentsResult` with `ok` discriminator)
```typescript
type SyncAgentsResult =
    | { ok: true; agents: ResolvedAgent[]; manifest: Manifest }
    | { ok: false; message: string; noAgentsEnabled: boolean }

async function resolveSyncAgents(...): Promise<SyncAgentsResult> {
    if (isCancel(selected)) {
        return { message: "Canceled.", noAgentsEnabled: false, ok: false }  // ← Treated as error!
    }
    // ...
}
```

**After:** (`CommandResult` with explicit cancellation)
```typescript
type SyncAgentsData = { agents: ResolvedAgent[]; manifest: Manifest }

async function resolveSyncAgents(...): Promise<CommandResult<SyncAgentsData>> {
    if (isCancel(selected)) {
        return CommandResult.cancelled()  // ← Explicit, handled gracefully
    }

    if (enabled.length === 0) {
        return CommandResult.unchanged("No agents enabled")
    }

    // ... resolve agents ...
    return CommandResult.completed({ agents, manifest })
}
```

### `syncWithSelection` Changes

**Before:**
```typescript
export async function syncWithSelection(...): Promise<boolean> {
    const agentResult = await resolveSyncAgents(...)
    if (!agentResult.ok) {
        if (agentResult.noAgentsEnabled) {
            consola.warn(agentResult.message)
            return true  // ← Confusing: returns true for "nothing to do"
        }
        throw new Error(agentResult.message)  // ← Cancellation throws!
    }
    // ... work ...
    consola.success("Done.")  // ← Remove this
    return true
}
```

**After:**
```typescript
export async function syncWithSelection(...): Promise<CommandResult<void>> {
    const agentResult = await resolveSyncAgents(...)

    // Propagate non-success statuses
    if (agentResult.status !== "completed") {
        return agentResult  // cancelled, unchanged, or failed pass through
    }

    const { agents, manifest } = agentResult.value

    // ... sync work ...

    if (result.value.noOpReason === "no-dependencies") {
        consola.success(options.dryRun ? "Plan complete." : "Sync complete.")
        consola.info("No dependencies to sync.")
        return CommandResult.unchanged("No dependencies to sync")
    }

    consola.success(options.dryRun ? "Plan complete." : "Sync complete.")
    // ... stats logging ...
    // NO "Done." here
    return CommandResult.completed(undefined)
}
```

### `resolveAgentSelection` Changes

**Before:**
```typescript
type AgentSelectionResult =
    | { canceled: true }
    | { canceled: false; selected: Set<AgentId>; warning?: string }

async function resolveAgentSelection(...): Promise<AgentSelectionResult> {
    if (isCancel(selected)) {
        return { canceled: true }
    }
    return { canceled: false, selected: selectedSet, warning }
}
```

**After:**
```typescript
type AgentSelectionData = { selected: Set<AgentId>; warning?: string }

async function resolveAgentSelection(...): Promise<CommandResult<AgentSelectionData>> {
    if (isCancel(selected)) {
        return CommandResult.cancelled()
    }
    return CommandResult.completed({ selected: selectedSet, warning })
}
```

### `handleAdd` / `handleRemove` Changes

**Before:**
```typescript
async function handleAdd(): Promise<boolean> {
    // ...
    if (isCancel(overwrite) || !overwrite) {
        consola.info("No changes made.")
        return true  // ← Ambiguous
    }
    // ...
    if (isCancel(shouldSync) || !shouldSync) {
        return true  // ← Ambiguous
    }
    return await syncWithSelection(...)
}
```

**After:**
```typescript
async function handleAdd(): Promise<CommandResult<void>> {
    // ...
    if (isCancel(overwrite) || !overwrite) {
        return CommandResult.cancelled()  // ← Explicit
    }
    // ...
    if (isCancel(shouldSync) || !shouldSync) {
        return CommandResult.completed(undefined)  // ← Manifest was updated
    }
    return await syncWithSelection(...)
}
```

### Top-Level Command Pattern

```typescript
export async function pkgAdd(...): Promise<void> {
    consola.info("sk pkg add")

    try {
        // ... do add work ...

        let result: CommandResult = CommandResult.completed()
        if (options.sync) {
            result = await syncWithSelection(...)
        }

        // Single place for final messaging
        printOutcome(result, "Package update")
    } catch (error) {
        process.exitCode = 1
        consola.error(formatError(error))
        consola.error("Package update failed.")
    }
}

// Shared helper for consistent outcome messaging
function printOutcome(result: CommandResult, operation: string): void {
    switch (result.status) {
        case "completed":
            consola.success("Done.")
            break
        case "unchanged":
            consola.info(result.reason)
            consola.success("Done.")
            break
        case "cancelled":
            consola.info("Canceled.")
            break
        case "failed":
            // Error already logged by sub-operation
            break
    }
}
```

### `pkgInteractive` Changes

```typescript
export async function pkgInteractive(): Promise<void> {
    consola.info("sk pkg")

    try {
        const action = await select({ /* ... */ })
        if (isCancel(action) || action === "exit") {
            consola.info("Canceled.")
            return
        }

        const result = action === "add"
            ? await handleAdd()
            : await handleRemove()

        printOutcome(result, "Package update")
    } catch (error) {
        process.exitCode = 1
        consola.error(formatError(error))
        consola.error("Package update failed.")
    }
}
```

## Migration Plan

### Phase 1: Foundation
1. **Add `CommandResult<T>` type** to `src/commands/types.ts`
2. **Add `printOutcome` helper** for consistent final messaging

### Phase 2: Agent Commands (simplest, good proof-of-concept)
3. **Refactor `updateAgentManifest`** - return `CommandResult<AgentUpdateData>`
4. **Update `runAgentUpdate`** - use `printOutcome`, remove double "Done."
5. **Update `agentInteractive`** - use `printOutcome`, remove double "Done."

### Phase 3: Sync Command (highest impact)
6. **Refactor `resolveSyncAgents`** - replace `SyncAgentsResult` with `CommandResult<SyncAgentsData>`
7. **Refactor `syncWithSelection`** - use `CommandResult<void>`, remove "Done." print
8. **Update `syncCommand`** - add `printOutcome` call

### Phase 4: Package Commands
9. **Refactor `handleAdd` / `handleRemove`** - return `CommandResult<void>`
10. **Update `pkgInteractive`** - use `printOutcome`
11. **Update `pkgAdd` / `pkgRemove`** - use `printOutcome`

### Phase 5: Init Command
12. **Refactor `resolveAgentSelection`** - replace `AgentSelectionResult` with `CommandResult<AgentSelectionData>`
13. **Update `initCommand`** - handle new return type

### Phase 6: Cleanup
14. **Remove old types** - delete `SyncAgentsResult`, `AgentSelectionResult`, `AgentUpdateResult`
15. **Update tests** - verify all paths return correct status

## Benefits

1. **No double "Done."** - single ownership of final messaging
2. **Explicit semantics** - `cancelled` vs `unchanged` vs `completed` are distinct
3. **Consistent pattern** - all commands follow same structure
4. **Composable** - sub-operations embed without messaging conflicts
5. **Testable** - can assert sub-operations return correct result types
6. **Aligned with codebase principles**:
   - Rich types over primitives (discriminated union over boolean)
   - Explicit boundaries (clear ownership of messaging)
   - Consistent error shapes (same result type everywhere)

## Open Questions

1. Should `unchanged` and `completed` both print "Done."? Or should `unchanged` print something different?
2. Should agent commands (`agentInteractive`, `runAgentUpdate`) adopt `CommandResult` too?

### Resolved Questions

- **Result shape**: Use `status` discriminator (not `ok`) to distinguish from core Result types ✓
- **Refactor scope**: Unify all command-layer result types (`SyncAgentsResult`, `AgentSelectionResult`) ✓
- **Value handling**: Use generic `CommandResult<T>` with value field on `completed` ✓
