# Design: agents-toml Integration

**Date**: 2026-01-01
**Status**: Draft
**Author**: Claude + Alizain

## Summary

Replace skills-supply's inline TOML parsing with the standalone `@skills-supply/agents-toml` package, while enhancing both packages.

**Key principle**: KISS. No unnecessary transformations. Data flows through as close to its original form as possible.

## Current State

### agents-toml package (`../agents-toml/`)

Pure parser for agents.toml files:
- Uses smol-toml + Zod
- Returns `ValidatedManifest` with Maps
- GitHub deps: `{ owner, repo }` (currently splits - **will change to `{gh}`**)
- Local paths: kept as relative strings ✓ (no transformation)
- Exports: snake_case (`auto_discover`) ✓
- Origin tracking: `ManifestOrigin` type exists but `parse()` never populates it (**will remove dead type**)
- Alias validation: `Alias` Zod type exists but not wired to `DependenciesSchema` (**will wire up**)

### skills-supply parsing (`packages/sk/src/core/manifest/`)

Full manifest handling:
- `parse.ts`: TOML parsing with Zod schemas (will simplify to use agents-toml)
- `coerce.ts`: Converts to branded types (will simplify)
- `fs.ts`: File I/O (load/save) ✓
- `discover.ts`: Find agents.toml up directory tree ✓
- `write.ts`: Serialize back to TOML ✓
- `transform.ts`: Immutable manifest transforms ✓

Key changes needed:
- GitHub deps: `{ gh }` - already correct, no change
- Local paths: sk resolves relative → absolute in adapter (agents-toml returns as-is)
- Exports: change `autoDiscover` → `auto_discover` (KISS, no transform)
- Origin tracking: stays in sk (parser can't know this)
- Branded types: thin adapter layer on top of agents-toml output

---

## Proposed Changes

### Part 1: Enhance agents-toml

Add universally useful features that any consumer would benefit from.

#### 1.1 No basePath option - keep paths as-is

agents-toml returns local paths exactly as written in TOML (relative or absolute). Path resolution is the consumer's responsibility.

```typescript
// agents-toml just parses
function parse(contents: string): ParseResult<ValidatedManifest>

// Local deps keep original path
interface ValidatedLocalDependency {
  type: "local"
  path: string  // exactly as in TOML, no resolution
}
```

**Rationale**: KISS. No transformation in the parser. sk resolves paths in its adapter layer using the manifest's sourcePath.

#### 1.2 Remove dead ManifestOrigin type

agents-toml has a `ManifestOrigin` type defined but `parse()` never populates it - it's dead code. Remove it entirely. agents-toml is a pure parser that only receives a content string, so it can't know where the file came from anyway.

```typescript
// Remove from agents-toml schema.ts:
// - ManifestOrigin interface (dead code)
// - origin field on ValidatedManifest (never populated)

// agents-toml output becomes:
interface ValidatedManifest {
  package?: Package
  agents: Map<AgentId, boolean>
  dependencies: Map<string, ValidatedDependency>
  exports?: Exports
  // NO origin - parser doesn't know file location
}

// sk adds origin in its adapter layer
interface Manifest {
  // ... fields from agents-toml ...
  origin: ManifestOrigin  // sk-specific
}
```

**Rationale**: Dead code removal. The parser only sees content. The caller knows where the file came from and can add origin metadata in their own types.

#### 1.3 Wire up existing Alias validation

The `Alias` Zod type already exists with proper validation (no `/\.:` chars). Just needs to be wired to `DependenciesSchema`.

```typescript
// Alias type already exists in schema.ts:
export const Alias = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z.string()
      .min(1, "Alias cannot be empty")
      .refine((s) => !s.includes("/"), "Alias cannot contain '/'")
      .refine((s) => !s.includes("\\"), "Alias cannot contain '\\'")
      .refine((s) => !s.includes("."), "Alias cannot contain '.'")
      .refine((s) => !s.includes(":"), "Alias cannot contain ':'")
  )

// Change DependenciesSchema to use it:
// Before: z.record(z.string(), DependencyDeclaration)
// After:
const DependenciesSchema = z.record(Alias, DependencyDeclaration)
```

**Rationale**: Validation already exists - just connect it. Universal validation any consumer benefits from. Reject bad aliases at parse time.

#### 1.4 Keep GitHub `gh` as string (don't split)

agents-toml currently splits `gh = "owner/repo"` into `{owner, repo}`. Change to keep as string.

```typescript
// Current agents-toml output (splits)
interface ValidatedGithubDependency {
  type: "github"
  owner: string  // split from gh
  repo: string   // split from gh
  ref?: { type: "tag" | "branch" | "rev"; value: string }
  path?: string
}

// Proposed (keep as string)
interface ValidatedGithubDependency {
  type: "github"
  gh: string  // "owner/repo" - no transformation
  ref?: { type: "tag" | "branch" | "rev"; value: string }
  path?: string
}
```

**Rationale**: KISS. No transformation in the parser. Same principle as keeping snake_case. Consumers split when they actually need owner/repo separately.

#### 1.5 Local dependency: no change needed

Since we're not resolving paths in agents-toml, local deps stay simple:

```typescript
interface ValidatedLocalDependency {
  type: "local"
  path: string  // exactly as in TOML
}
```

sk resolves paths in its adapter when building its own `ValidatedLocalDependency` with `AbsolutePath`.

---

### Part 2: Simplify skills-supply

Adopt agents-toml patterns and reduce transformation code.

#### 2.1 GitHub deps: no change needed

skills-supply already uses `gh: GithubRef` (branded string). Once agents-toml is updated to output `{gh}` instead of `{owner, repo}`, no changes needed in skills-supply for GitHub deps.

```typescript
// skills-supply already has this - stays the same
interface ValidatedGithubDependency {
  type: "github"
  gh: GithubRef  // branded "owner/repo" string
  ref?: GitRef
  path?: NonEmptyString
}
```

Consumers that need owner/repo separately (like sync.ts) continue to call `parseGithubSlug()`.

#### 2.2 Keep snake_case exports

**Current**: Transform `auto_discover` → `autoDiscover`

**Proposed**: Keep `auto_discover` as-is

```typescript
// Before
interface ValidatedManifestExports {
  autoDiscover: { skills: NonEmptyString | false }
}

// After
interface ValidatedManifestExports {
  auto_discover: { skills: NonEmptyString | false }
}
```

**Rationale**: KISS. The camelCase transformation is an arbitrary layer, not a true boundary transformation. TOML uses snake_case idiomatically - we should match it throughout. No value is being transformed or enriched here, just renamed unnecessarily.

**Files to update**:
- `types.ts`: Rename `autoDiscover` → `auto_discover` in type definitions
- `parse.ts`: Remove the `.transform()` that converts case
- `coerce.ts`: Update field access
- `write.ts`: Remove back-conversion
- `extract.ts`: Update field access
- Test files: Update assertions

#### 2.3 Thin branded-type adapter

The only sk-specific layer becomes applying branded types:

```typescript
import { parse } from "@skills-supply/agents-toml"

function parseManifest(
  contents: string,
  sourcePath: AbsolutePath,
  discoveredAt: ManifestDiscoveredAt
): ManifestParseResult {
  const result = parse(contents)

  if (!result.ok) {
    return adaptError(result.error, sourcePath)
  }

  return applyBrandedTypes(result.value, sourcePath, discoveredAt)
}
```

The `applyBrandedTypes` function:
- Wraps strings in branded types (NonEmptyString, Alias, GithubRef, etc.)
- Resolves local dep paths relative to `path.dirname(sourcePath)`
- Adds `origin: { sourcePath, discoveredAt }` (sk-specific)
- No re-validation needed - agents-toml already validates alias format

---

## Migration Plan

### Phase 1: Update agents-toml

1. Change GitHub deps to keep `gh` as string (don't split to owner/repo)
2. Wire existing `Alias` type to `DependenciesSchema` (validates no `/\.:` chars)
3. Remove dead `ManifestOrigin` type from schema
4. Update tests
5. Publish new version

### Phase 2: Update skills-supply

1. Add `@skills-supply/agents-toml` as dependency
2. Create adapter module (`manifest/adapter.ts`)
3. Update `ValidatedManifestExports` to use snake_case (`auto_discover`)
4. Wire adapter into `parseManifest()`
5. Update all consumers of `autoDiscover` field
6. Run full test suite

### Phase 3: Cleanup

1. Refactor `extract.ts` to use new parser (currently uses `parseLegacyManifest`)
2. Delete redundant parsing code:
   - `parseLegacyManifest` function and `LegacyManifest` types
   - Zod schemas from `parse.ts` (now in agents-toml)
   - Legacy test cases
3. Simplify `coerce.ts` to just branded type application
4. Keep: `fs.ts`, `discover.ts`, `write.ts`, `transform.ts`

---

## Files Affected

### agents-toml
- `src/parse.ts` - change GitHub output to keep `gh` string (don't split to owner/repo)
- `src/schema.ts` - wire `Alias` type to `DependenciesSchema`, update `ValidatedGithubDependency` to use `gh`, remove dead `ManifestOrigin` type
- `src/index.ts` - export updated types
- `src/parse.test.ts` - update GitHub dep tests, add alias validation tests

### skills-supply
- `packages/sk/package.json` - add dependency
- `src/core/manifest/adapter.ts` - NEW, bridges agents-toml to branded types, resolves local paths to absolute
- `src/core/manifest/parse.ts` - simplify to use adapter, delete `parseLegacyManifest`
- `src/core/manifest/coerce.ts` - simplify, remove redundant Zod schemas and validation
- `src/core/manifest/types.ts` - update Exports (`autoDiscover` → `auto_discover`), delete `LegacyManifest` types
- `src/core/manifest/write.ts` - update for snake_case exports
- `src/core/manifest/transform.ts` - update for snake_case exports
- `src/core/packages/extract.ts` - refactor to use new parser, update for snake_case exports
- `src/core/manifest/parse.test.ts` - update assertions for snake_case
- `src/core/manifest/coerce.test.ts` - update assertions for snake_case

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking changes to manifest types | Update all consumers in same PR |
| Subtle behavior differences | Comprehensive test coverage, run existing tests |
| agents-toml version drift | Pin exact version, or use workspace link during dev |

---

## Open Questions

1. ~~Should `discoveredAt` move to agents-toml?~~ **RESOLVED**: No. agents-toml is a pure parser that only sees content strings - it can't know origin. Remove the dead `ManifestOrigin` type. sk adds origin in its adapter layer.

2. ~~Should agents-toml handle the Alias validation (no `/\.:`)?~~ **RESOLVED**: Yes - `Alias` type already exists, just wire it to `DependenciesSchema`. Universal validation any consumer benefits from.

3. ~~Should we keep `parseLegacyManifest` or remove it entirely?~~ **RESOLVED**: Delete it. Refactor `extract.ts` to use new parser as part of this work. Clean break, no deprecated code left.

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| No path resolution in agents-toml | KISS - parser returns paths as-is. sk resolves in adapter. |
| Remove dead ManifestOrigin type | Parser only sees content string, can't know file location. Caller adds origin. Dead code removal. |
| Wire existing Alias type to DependenciesSchema | Alias validation already exists - just needs to be connected. Universal validation any consumer benefits from. |
| Keep gh as string (don't split) | KISS - no transformation. Same principle as snake_case. Consumers split when needed. |
| Keep snake_case throughout | KISS - camelCase conversion is arbitrary layer, not true boundary transformation |
| Branded types stay in sk | Architectural choice specific to this codebase |
| Delete parseLegacyManifest | Refactor extract.ts to use new parser. Clean break, no deprecated code. |
