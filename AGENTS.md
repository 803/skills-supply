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
