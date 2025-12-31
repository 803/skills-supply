# SK Package: Parse-Don't-Validate Refactor

> **Status**: ✅ COMPLETE
> **Date**: 2025-12-30
> **Goal**: Refactor sk package to use refined types, thread origin through pipeline, separate reconciliation, aggregate errors

---

## Progress Summary

### Completed
- [x] `core/types/branded.ts` — Branded types (NonEmptyString, Alias, AbsolutePath, etc.)
- [x] `core/types/coerce.ts` — Coercion functions at boundaries
- [x] `core/types/index.ts` — Module exports
- [x] `core/manifest/types.ts` — Updated with ValidatedDependency, ManifestOrigin, new Manifest type
- [x] `core/manifest/coerce.ts` — NEW: Coerces raw TOML to validated types
- [x] `core/manifest/parse.ts` — Updated parseManifest with 3 args, added parseLegacyManifest
- [x] `core/manifest/discover.ts` — Updated to return AbsolutePath[]
- [x] `core/manifest/fs.ts` — Updated to use new Manifest type with Maps
- [x] `core/manifest/write.ts` — Updated to serialize ValidatedDependency
- [x] `core/manifest/merge.ts` — Updated to use new types, no longer needs resolve
- [x] `core/packages/types.ts` — Updated with origin, fetchStrategy, uniform DetectedPackage
- [x] `core/packages/resolve.ts` — Simplified to pure mapping (no validation)
- [x] `core/packages/detect.ts` — Updated to return new DetectedPackage with skillPaths
- [x] `core/packages/extract.ts` — Updated for new types, uses Dirent properly
- [x] `core/packages/fetch.ts` — Updated to use origin instead of alias
- [x] `core/sync/sync.ts` — Updated for new types, Map iteration, resolveMergedPackages
- [x] `core/sync/marketplace.ts` — Updated for new types, origin threading
- [x] `core/sync/repo.ts` — Updated for new GitRef structure
- [x] `core/io/fs.ts` — Added re-exports for IoResult, IoError

### Completed (final session)
- [x] `core/manifest/transform.ts` — NEW: Pure transformation functions (addDependency, removeDependency, setAgent, etc.)
- [x] `commands/pkg/add.ts` — Uses addDependency(), getDependency()
- [x] `commands/pkg/remove.ts` — Uses hasDependency(), removeDependency()
- [x] `commands/pkg/index.ts` — Uses transform functions + fixed type coercion
- [x] `commands/agent/index.ts` — Uses getAgent(), setAgent()
- [x] `commands/agent/shared.ts` — Uses getAgent(), setAgent()

### Resolution
Instead of mutating ReadonlyMap (which would require changing to mutable Map or casting), we chose the **functional-core approach**:

1. **Keep `ReadonlyMap`** in the Manifest type — correct! Enforces immutability at type level
2. **Pure transformation functions** in `core/manifest/transform.ts` return new Manifest instances
3. **Commands become thin shells** that compose pure transformations

---

## Key Changes Made This Session

### `core/packages/detect.ts`
- Now takes `(canonical: CanonicalPackage, packagePath: AbsolutePath)` instead of just path
- Returns new `DetectedPackage` with `skillPaths: AbsolutePath[]` pre-computed
- Removed `LegacyPackageDetectionResult` export

### `core/packages/extract.ts`
- Complete rewrite to use new `DetectedPackage` type
- Gets `origin` from `detected.canonical.origin`
- For manifest detection, reads manifest to get skill discovery settings
- Uses `Dirent[]` with `String(entry.name)` for type safety

### `core/packages/fetch.ts`
- All functions now take `origin: PackageOrigin` instead of `alias: string`
- `PackageFetchError` has `origin: PackageOrigin` field
- `GitRef` access changed from `ref.tag` to `ref.type`/`ref.value`

### `core/sync/sync.ts`
- Uses `resolveMergedPackages(mergedResult.value)` instead of old resolve
- Map iteration: `merged.agents.size`, `for (const [agentId, enabled] of merged.agents)`
- `detectPackageType(pkg.canonical, pkg.packagePath)` with 2 args
- `coerceAbsolutePathDirect()` for path coercion

### `core/sync/marketplace.ts`
- Added `createMarketplaceOrigin()` helper for fake origins
- Uses `coerceDependency()` + `resolveValidatedDependency()` for plugin resolution
- `parseGithubSlug()` now takes `PackageOrigin` instead of string

### `core/sync/repo.ts`
- `refKey()` simplified to `${ref.type}:${ref.value}`

### `commands/pkg/*.ts`
- Added `coerceAlias()` for user input validation
- Added `coerceDependency()` to convert declarations to ValidatedDependency
- Changed to use `.get()`, `.has()`, `.set()`, `.delete()` on Maps
- **BLOCKED**: ReadonlyMap doesn't have `.set()` or `.delete()`

---

## Final Error Count

```
$ npx tsc --noEmit -p packages/sk/tsconfig.json
(no output - 0 errors)
```

---

## Implementation Summary

### New File: `core/manifest/transform.ts`

Pure transformation functions that return new Manifest instances:

```typescript
// Add or update a dependency
export function addDependency(manifest: Manifest, alias: Alias, dep: ValidatedDependency): Manifest

// Remove a dependency
export function removeDependency(manifest: Manifest, alias: Alias): Manifest

// Set agent enabled state
export function setAgent(manifest: Manifest, agentId: AgentId, enabled: boolean): Manifest

// Query functions
export function hasDependency(manifest: Manifest, alias: Alias): boolean
export function getDependency(manifest: Manifest, alias: Alias): ValidatedDependency | undefined
export function getAgent(manifest: Manifest, agentId: AgentId): boolean | undefined
```

### Command Pattern (before → after)

**Before** (mutation):
```typescript
manifest.dependencies.set(alias, dep)
await saveManifest(manifest, path)
```

**After** (functional):
```typescript
const updated = addDependency(manifest, alias, dep)
await saveManifest(updated, path)
```

---

## Design Decisions Made

1. **Maps over Records**: `Manifest.agents` and `Manifest.dependencies` use `Map` for type-safe key access

2. **Origin threading**: Every `CanonicalPackage` and `Skill` carries `PackageOrigin` for error traceability

3. **Parse-time path resolution**: Local paths in dependencies are resolved to `AbsolutePath` at parse time

4. **Fetch strategy at resolve time**: Determined when creating `CanonicalPackage`, not at install time

5. **Uniform DetectedPackage**: Single shape with `skillPaths: AbsolutePath[]` computed during detection

6. **GitRef as discriminated union**: `{ type: "tag" | "branch" | "rev"; value: NonEmptyString }`

7. **Functional-core for manifest mutations**: Pure transformation functions in `transform.ts`, commands compose them. ReadonlyMap enforces immutability at type level.

---

## Refactor Complete

All 51+ type errors from the original refactor have been resolved. The codebase now:

- Uses branded types throughout (`Alias`, `AgentId`, `AbsolutePath`, etc.)
- Threads `PackageOrigin` for error traceability
- Coerces at boundaries (parse → coerce → validated types)
- Uses pure transformation functions for manifest mutations
- Maintains immutability guarantees via `ReadonlyMap`
