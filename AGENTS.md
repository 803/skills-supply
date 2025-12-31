# AGENTS.md

> **Note**: This project uses [bd (beads)](https://github.com/steveyegge/beads) for issue tracking. Use `bd` commands instead of markdown TODOs. See the Issue Tracking section below for workflow details.

> **Purpose**: The bare‑minimum rules this repo cares about. Follow exactly. When unsure, ask.

---

## ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.

---

## Runtime & Dev Environment

* **Browser access**: You should have access to the browser.
* **DB**: Postgres is already running **in Docker**. Use containerized access.
  * **psql**: Not installed on host. Run inside Docker (`docker-compose.yaml` has details / service names).
* **Server**: Already running; when launched via `./watchexec.sh`, logs are tee'd to `./.logs/<timestamp>.log`.
* **Hot reload**:
  * Changes to `./config` or `./lib` **automatically restart the server**
  * Changes to `./assets` or `./packages` **automatically rebuild static assets**.
  * `./watchexec.sh` runs the dev server under `watchexec` to enforce the above:
    - Restarts on `./config` changes (Phoenix requires a hard restart for config edits) and also watches `./lib`.
    - Streams stdout/stderr to the terminal and tees to `./.logs/<timestamp>.log`.
    - Run with: `./watchexec.sh` (requires `watchexec`).

---

## Core Principles

* **Self‑documenting code; comments are for _why_** (rationale, invariants, tradeoffs). Do not narrate what code already states.
* **Functional core, imperative shell**.
* **Fail loudly on ambiguity**: if input isn’t explicitly handled, error fast. Prefer explicit ignores over silent catch‑alls.
* **Idiomatic over clever**.
* **No in‑code TODO sprawl**: Do **not** add `TODO` comments in source files. Use **bd (beads)** to track tasks
* **Consistent error shapes**: Within a module/service, keep the exact error/ok/result shape consistent (e.g., always `{:ok, v} | {:error, e} | {:state, v}` or a single Result type). Only `raise` when the process **should die**.
* **No imports inside function bodies**: Never put `import`/`alias`/`require` (or language‑equivalents) inside functions/blocks. Imports go at the file/module top.
* **Data structures first**: Design types/interfaces before logic. Good data models make code obvious; complex algorithms often mean wrong structures. "Show me your tables and I won't need your flowcharts."
* **Explicit boundaries**: Know where system edges are (CLI input, file I/O, database, network, user display). Transform data **once** at boundaries, not throughout the system.
* **Rich types over primitives**: Keep objects/typed values until the last moment. Convert to strings/derived values only at display or serialization boundaries.
* **Composability over configuration**: Build small, explicit functions that compose. Implicit configuration ("this coerces if X, does Y if Z") hides intent and makes testing harder.

---

## Error Handling Strategy

* **Result types at core boundaries**: Pure/core modules return Result-like types (`{ok, value} | {ok, error}`) to make error paths explicit and composable.
* **Throw only at application edges**: CLI/web layers unwrap Results and throw for user-facing errors. Core logic never throws.
* **Rich error shapes**: Errors carry context (type, message, path/field, original cause). Don't lose information as exceptions bubble up.
* **Fail fast, fail loudly**: When input can't be handled, return error immediately. Don't default, don't silently ignore. Ambiguity is a bug.

When in doubt: If you're catching exceptions in core code to return them, you're in the wrong place. Push error handling to the boundary.

---

## Interface Design

* **Small, focused units**: Each function does one thing well. 3-5 parameters max. If you need more, introduce a parameter object.
* **Explicit over implicit**: Caller decides composition (`coerceThenParse()` vs `parse()` that secretly coerces). Magic in function bodies is technical debt.
* **Validated types guarantee invariants**: Use branded types or similar mechanisms to ensure data passed through validation can't become invalid downstream.
* **Separation of declaration and validated types**: `RawDependency` vs `ValidatedDependency`. Transform at boundaries, keep core simple.

Red flag: Function signature has `boolean` or `string` flags to control behavior ("if `force`, do X; if `quiet`, do Y"). Prefer separate functions or parameter objects with descriptive names.

---

## State Management

* **State is explicit, not implicit**: State files/state machines track what happened. Don't infer state from filesystem alone.
* **Reconcile, don't overwrite**: Sync means "make installed match manifest". Compute diff, apply changes atomically. `npm prune` pattern, not `rm -rf`.
* **Track what you manage**: State files list what your tool installed. Don't delete manually-added skills. Reconcile only removes tracked items.
* **State transitions are explicit**: Functions like `read → diff → reconcile → write` make flow clear. One function doing all three is a smell.

Red flag: "Remove everything and reinstall" as primary sync strategy. This loses user data and creates race conditions.

---

## Testing Strategy

* **Test behavior, not implementation**: Test inputs → outputs. Don't test internal details (private functions, exact error messages) unless they're user-visible.
* **Test boundary contracts**: Core functions receive rich types and return Results. Test both success and error paths with realistic inputs.
* **Don't test framework**: If you're testing your test helpers more than production code, simplify your tests.
* **Missing tests are bugs**: If you discover edge cases in PR review or production, add tests before fixing. Coverage doesn't matter, but gaps do.
* **Integration > unit for flows**: End-to-end flows (CLI command → file writes) catch more bugs than isolated unit tests of internal helpers.

---

## Complexity Management

* **Function length as smell**: 20+ lines is a warning. 50+ lines should split. Extract named sub-functions with descriptive names.
* **Extract state machines**: If logic reads state, transforms, writes state in 50+ lines, extract to separate module. State transitions should be visible in one place.
* **Avoid "God functions"**: Functions that orchestrate fetching, validation, prompts, I/O, AND state management are doing too much. Split along layer boundaries.
* **Duplication over abstraction**: Copy small logic blocks 2-3 times before abstracting. Premature abstraction (helper functions for one call site) adds complexity without benefit.
* **Readability > cleverness**: Code you understand in 2 weeks is better than code that's "elegant" but opaque.

---

## When to Refactor

Refactor when you notice:

* **"This feels hacky"** → Fix the upstream problem, don't work around it
* **"I wish I had different data"** → Restructure types/objects to carry what you need
* **Complex conditional logic** → Replace with polymorphism or sum types (Result types, enums)
* **Stringly-typed parameters** → Use discriminated unions or branded types
* **Inconsistent error handling** → Decide Result vs exception pattern and apply uniformly

Don't refactor just for style or "clean code" aesthetics. Refactor when complexity is slowing you down or hiding bugs.

---

## Change Policy & Check‑ins

* **Backwards compatibility is not sacred**: Make the changes we need. Do not block improvements to preserve old behaviors unless explicitly requested.
* **Large or long-running changes require feedback**: Before starting substantial refactors or breaking changes, **check-in with the Human**.
* **Frequent feedback loop**: **Check in every few minutes** (≈2–5 min) while working, share current status, open questions, and next intended step.
* **Git commits must disable GPG signing**: Always run commits with `--no-gpg-sign` (example: `git commit --no-gpg-sign -m "message"`).

---

## TS/CSS preferences

* **Always run `npm biome`** in the root directory

---

## Compilation Discipline

* **Zero tolerance for compiler errors/warnings**: Do not ignore compilation errors or warnings. Fix or justify and eliminate warnings before committing. Treat new warnings as failures.

---

## Task Discipline (Effectively manage deep/long/broad threads of work)

* **Use bd (beads) for issue tracking**: As you discover follow‑ups, create issues with `bd create`. Do NOT use markdown TODOs or in-source comments.
* **Keep adding as you work**: If you touch a surface and uncover new work, **immediately** create a bd issue. Don't rely on memory.
* **Periodic check‑ins**: For work lasting more than ~2 minutes, run `bd ready` to review issues and re‑prioritize before continuing.
* **Stay on the main objective**: If a tangent isn't blocking, create a bd issue and return to the primary goal.
* **If you hit a flaky test**: Do **not** skip/disable it in source. Create a bd issue with a short description and a link to the failing run if available; proceed only if it's non‑blocking.
* **Link discovered work**: When you find new work while working on an issue, use `--deps discovered-from:<parent-id>` to link them.

---

## JS and CSS guidelines

- **Use Tailwind CSS classes and custom CSS rules** to create polished, responsive, and visually stunning interfaces.
- Tailwindcss v4 **no longer needs a tailwind.config.js** and uses a new import syntax in `app.css`:

      @import "tailwindcss" source(none);
      @source "../css";
      @source "../js";
      @source "../../lib/my_app_web";

- **Always use and maintain this import syntax** in the app.css file for projects generated with `phx.new`
- **Never** use `@apply` when writing raw css
- **Always** manually write your own tailwind-based components instead of using daisyUI for a unique, world-class design
- Out of the box **only the app.js and app.css bundles are supported**
  - You cannot reference an external vendor'd script `src` or link `href` in the layouts
  - You must import the vendor deps into app.js and app.css to use them
  - **Never write inline <script>custom js</script> tags within templates**

---

## UI/UX & design guidelines

- **Produce world-class UI designs** with a focus on usability, aesthetics, and modern design principles
- Implement **subtle micro-interactions** (e.g., button hover effects, and smooth transitions)
- Ensure **clean typography, spacing, and layout balance** for a refined, premium look
- Focus on **delightful details** like hover effects, loading states, and smooth page transitions
