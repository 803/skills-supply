# SK Testing Strategy

## Overview

Three-layer testing strategy for regression prevention and documentation.

```
┌─────────────────────────────────────────────┐
│  E2E (few)                                  │
│  Full sync flows, real git (slow, high     │
│  confidence)                                │
├─────────────────────────────────────────────┤
│  Integration (medium)                       │
│  Real filesystem in temp dirs, mock git    │
│  Tests I/O layer behavior                   │
├─────────────────────────────────────────────┤
│  Unit (many)                                │
│  Pure functions, no I/O                     │
│  Fast, document behavior                    │
└─────────────────────────────────────────────┘
```

## Principles

1. **Test behavior, not implementation** - Assert on outputs and effects, not internal state
2. **Tests as documentation** - Each test file documents what that module does; use descriptive names
3. **Leverage the type system** - Branded types mean once data is coerced, tests can trust it. Focus tests on coercion boundaries.
4. **Result types make assertions easy** - `{ok, value} | {ok: false, error}` pattern means tests check `.ok` and inspect values
5. **Fixtures are first-class** - Sample manifests, package structures, agent configs should be reusable and realistic

## Tooling

- **Framework:** Vitest
- **Location:** Unit tests colocated (`*.test.ts`), integration/E2E in `tests/`

```
packages/sk/
├── src/
│   └── core/
│       └── manifest/
│           ├── parse.ts
│           └── parse.test.ts     # unit tests colocated
├── tests/
│   ├── fixtures/                 # sample data
│   ├── helpers/                  # test utilities
│   ├── integration/              # real filesystem tests
│   └── e2e/                      # full sync flows
└── vitest.config.ts
```

---

## Layer 1: Unit Tests

**Location:** Colocated with source (`*.test.ts` next to `*.ts`)

**What to test:** Pure functions with no I/O - parsing, coercion, merging, resolution logic.

### Modules to Cover

| Module | What to test |
|--------|--------------|
| `manifest/parse.ts` | TOML string → RawManifest, error cases |
| `manifest/coerce.ts` | RawManifest → Manifest (branded types), validation errors |
| `manifest/merge.ts` | Multiple Manifests → MergedManifest, conflict detection |
| `packages/resolve.ts` | Manifest deps → CanonicalPackage[], source type detection |
| `types/branded.ts` | Coercion functions: valid inputs pass, invalid reject |

### Pattern: Testing Coercion Boundaries

```typescript
// manifest/coerce.test.ts
import { describe, it, expect } from 'vitest'
import { coerceManifest } from './coerce'

describe('coerceManifest', () => {
  it('coerces valid raw manifest to Manifest', () => {
    const raw = { name: 'my-pkg', dependencies: { foo: 'github:org/repo' } }
    const result = coerceManifest(raw)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('my-pkg')
    }
  })

  it('rejects empty name', () => {
    const raw = { name: '', dependencies: {} }
    const result = coerceManifest(raw)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('name')
    }
  })
})
```

### Pattern: Snapshot Testing for Documentation

Use Vitest snapshots for complex outputs (merged manifests, resolved packages). They serve as living documentation of expected behavior.

```typescript
it('resolves github dependency', () => {
  const result = resolveDependency('foo', 'github:org/repo')
  expect(result).toMatchInlineSnapshot(`
    {
      "type": "github",
      "owner": "org",
      "repo": "repo",
      "ref": undefined,
    }
  `)
})
```

---

## Layer 2: Integration Tests

**Location:** `tests/integration/`

**What to test:** I/O operations with real filesystem in temp directories.

### Areas to Cover

| Area | What to test |
|------|--------------|
| `manifest/discover.ts` | Finds manifests in cwd, parents, home, sk-global |
| `manifest/fs.ts` | Read/write TOML files, handle missing/malformed |
| `agents/state.ts` | Read/write agent state, handles missing state |
| `agents/install.ts` | Copy skills to target dirs, create directories |

### Test Utility: Temp Directory Helper

```typescript
// tests/helpers/fs.ts
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'sk-test-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
```

### Example: Manifest Discovery

```typescript
// tests/integration/manifest-discovery.test.ts
import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { writeFile, mkdir } from 'fs/promises'
import { withTempDir } from '../helpers/fs'
import { discoverManifests } from '../../src/core/manifest/discover'

describe('discoverManifests', () => {
  it('finds manifest in current directory', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'agents.toml'), 'name = "test"')

      const result = await discoverManifests(dir)

      expect(result).toHaveLength(1)
      expect(result[0]).toContain('agents.toml')
    })
  })

  it('finds manifests in parent directories', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'agents.toml'), 'name = "parent"')
      const child = join(dir, 'child')
      await mkdir(child)

      const result = await discoverManifests(child)

      expect(result).toHaveLength(1)
    })
  })
})
```

### Mocking Strategy

Mock git operations, not filesystem. For tests that would trigger git:

```typescript
import { vi } from 'vitest'
import * as git from '../../src/core/packages/git'

vi.mock('../../src/core/packages/git', () => ({
  cloneRepo: vi.fn().mockResolvedValue({ ok: true, value: '/tmp/cloned' }),
  sparseCheckout: vi.fn().mockResolvedValue({ ok: true, value: '/tmp/sparse' }),
}))
```

---

## Layer 3: E2E Tests

**Location:** `tests/e2e/`

**What to test:** Complete sync flows. Few tests, high value.

### Scenarios to Cover

| Scenario | What it validates |
|----------|-------------------|
| Fresh sync | No prior state → skills installed correctly |
| Incremental sync | Add new dep → only new skills added |
| Remove dep | Remove from manifest → stale skills cleaned up |
| Multi-agent | Skills sync to Claude Code + Codex correctly |
| Dry run | `--dry-run` reports changes without applying |

### Approach

Use local fixture packages to avoid network flakiness:

```typescript
// tests/e2e/sync-flow.test.ts
import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { withTempDir } from '../helpers/fs'
import { setupFixturePackage, runSync, exists } from '../helpers/e2e'

describe('sync e2e', () => {
  it('installs skills from local package', async () => {
    await withTempDir(async (dir) => {
      // Setup: create a fake package with skills
      const pkgDir = join(dir, 'my-pkg')
      await setupFixturePackage(pkgDir, {
        skills: [{ name: 'greeting', content: 'Hello world skill' }]
      })

      // Setup: create manifest pointing to local package
      const projectDir = join(dir, 'project')
      await mkdir(projectDir)
      await writeFile(join(projectDir, 'agents.toml'), `
        [dependencies]
        my-pkg = "local:${pkgDir}"

        [agents]
        claude-code = true
      `)

      // Setup: fake agent home
      const agentHome = join(dir, 'claude-skills')

      // Act: run sync (with mocked home dir)
      const result = await runSync(projectDir, { agentHome })

      // Assert
      expect(result.installed).toContain('greeting')
      expect(await exists(join(agentHome, 'my-pkg', 'greeting.md'))).toBe(true)
    })
  })
})
```

### E2E Guidelines

- Target 5-10 tests covering critical paths
- Run separately from unit tests (slower)
- Use `vitest --project e2e` or similar to isolate

---

## Fixtures & Helpers

### Directory Structure

```
tests/
├── fixtures/
│   ├── manifests/
│   │   ├── minimal.toml        # name only
│   │   ├── full.toml           # all fields populated
│   │   ├── multi-agent.toml    # claude-code + codex
│   │   └── invalid/
│   │       ├── empty.toml
│   │       └── bad-dep.toml
│   └── packages/
│       ├── simple-skill/       # single skill package
│       ├── multi-skill/        # package with multiple skills
│       └── nested/             # subdir structure
├── helpers/
│   ├── fs.ts                   # withTempDir, setupFixturePackage
│   ├── manifest.ts             # buildManifest(), buildRawManifest()
│   ├── assertions.ts           # custom matchers
│   └── e2e.ts                  # runSync, setupFixturePackage
```

### Builder Helpers

```typescript
// tests/helpers/manifest.ts
import type { RawManifest } from '../../src/core/manifest/types'

export function buildRawManifest(overrides: Partial<RawManifest> = {}): RawManifest {
  return {
    name: 'test-pkg',
    dependencies: {},
    agents: { 'claude-code': true },
    ...overrides,
  }
}
```

### Custom Assertions (Optional)

```typescript
// tests/helpers/assertions.ts
import { expect } from 'vitest'

expect.extend({
  toBeOk(received) {
    return {
      pass: received.ok === true,
      message: () => `expected result to be ok, got error: ${received.error}`
    }
  },
  toBeErr(received) {
    return {
      pass: received.ok === false,
      message: () => `expected result to be error, got ok`
    }
  }
})

// Usage: expect(result).toBeOk()
```

---

## Vitest Configuration

```typescript
// packages/sk/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30000, // E2E tests are slower
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
})
```

NPM scripts:

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest --exclude tests/e2e",
    "test:e2e": "vitest --include tests/e2e/**/*.test.ts",
    "test:coverage": "vitest --coverage"
  }
}
```

---

## Implementation Phases

### Phase 1: Foundation

| Task | Description |
|------|-------------|
| Vitest setup | Install vitest, create config |
| Test helpers | `withTempDir`, `buildRawManifest` |
| `manifest/parse.test.ts` | TOML parsing tests |
| `manifest/coerce.test.ts` | Coercion boundary tests |

### Phase 2: Core Logic

| Task | Description |
|------|-------------|
| `manifest/merge.test.ts` | Conflict detection, multi-manifest merge |
| `packages/resolve.test.ts` | github/git/local/registry URL parsing |
| `types/branded.test.ts` | All branded type coercion |

### Phase 3: Integration

| Task | Description |
|------|-------------|
| Manifest discovery | Filesystem discovery tests |
| Agent state | State read/write tests |
| Agent install | Skill copying tests |

### Phase 4: E2E

| Task | Description |
|------|-------------|
| Fresh sync | Happy path test |
| Incremental add/remove | State reconciliation |
| Dry run | No side effects verification |

---

## Success Criteria

- Unit tests run in < 5 seconds
- Integration tests run in < 30 seconds
- E2E tests run in < 2 minutes
- Coverage > 80% on core modules
- All tests pass in CI before merge
