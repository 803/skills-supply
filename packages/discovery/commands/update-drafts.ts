import { execFile, spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { intro, isCancel, multiselect, outro } from "@clack/prompts"
import { assertAbsolutePathDirect, type Result } from "@skills-supply/core"
import { z } from "zod"
import type { DiscoveryError } from "@/types/errors"

const execFileAsync = promisify(execFile)

const COMMAND_DIR = path.dirname(fileURLToPath(import.meta.url))
const DISCOVERY_DIR = path.resolve(COMMAND_DIR, "..")
const STATE_FILE_PATH = path.join(DISCOVERY_DIR, "drafted-prs.json")

const FORK_OWNER = "803"
const BRANCH_NAME = "sk-install-instructions"
const COMMIT_MESSAGE = "docs: refine sk installation instructions"

const CLAUDE_PROMPT = `You are refining sk installation instructions in this repository.

The repo already has sk installation docs from a previous PR. Your task:
1. Explore the repo to understand the existing documentation
2. Wait for user feedback on what to improve
3. Make the requested changes

Do not make changes until the user provides specific feedback.`

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface DraftEntry {
	ghRepo: string
	prUrl: string
	packages: string[]
}

interface OpenPR extends DraftEntry {
	prNumber: number
}

interface WorkingDir {
	path: string
	root: string
}

// ─────────────────────────────────────────────────────────────
// State file schema
// ─────────────────────────────────────────────────────────────

const DraftStateSchema = z.record(
	z.string(),
	z.object({
		packages: z.array(z.string()),
		pr_url: z.string().min(1),
	}),
)

// ─────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────

async function loadDraftEntries(): Promise<Result<DraftEntry[], DiscoveryError>> {
	let contents: string
	try {
		contents = await readFile(STATE_FILE_PATH, "utf8")
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: [] }
		}
		return {
			error: {
				message: `Unable to read ${STATE_FILE_PATH}.`,
				operation: "readFile",
				path: assertAbsolutePathDirect(STATE_FILE_PATH),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (error) {
		return {
			error: {
				message: `Invalid JSON in ${STATE_FILE_PATH}.`,
				path: assertAbsolutePathDirect(STATE_FILE_PATH),
				rawError: error instanceof Error ? error : undefined,
				source: "draft_pr_state",
				type: "parse",
			},
			ok: false,
		}
	}

	const result = DraftStateSchema.safeParse(parsed)
	if (!result.success) {
		return {
			error: {
				field: "state",
				message: result.error.message,
				path: assertAbsolutePathDirect(STATE_FILE_PATH),
				source: "zod",
				type: "validation",
				zodError: result.error,
			},
			ok: false,
		}
	}

	const entries: DraftEntry[] = Object.entries(result.data).map(([ghRepo, data]) => ({
		ghRepo,
		packages: data.packages,
		prUrl: data.pr_url,
	}))

	return { ok: true, value: entries }
}

async function checkPRStatus(
	entry: DraftEntry,
): Promise<Result<OpenPR | null, DiscoveryError>> {
	try {
		const { stdout } = await execFileAsync("gh", [
			"pr",
			"view",
			entry.prUrl,
			"--json",
			"state,number",
		])

		const data = JSON.parse(stdout) as { state: string; number: number }
		if (data.state === "OPEN") {
			return {
				ok: true,
				value: { ...entry, prNumber: data.number },
			}
		}
		return { ok: true, value: null }
	} catch (error) {
		return {
			error: {
				message: `Failed to check PR status for ${entry.prUrl}`,
				rawError: error instanceof Error ? error : undefined,
				source: "gh",
				type: "network",
			},
			ok: false,
		}
	}
}

async function filterOpenPRs(
	entries: DraftEntry[],
): Promise<Result<OpenPR[], DiscoveryError>> {
	const openPRs: OpenPR[] = []

	for (const entry of entries) {
		process.stdout.write(`  Checking ${entry.ghRepo}...`)
		const result = await checkPRStatus(entry)
		if (!result.ok) {
			console.log(" ERROR")
			return result
		}
		if (result.value) {
			console.log(" OPEN")
			openPRs.push(result.value)
		} else {
			console.log(" closed/merged")
		}
	}

	return { ok: true, value: openPRs }
}

// ─────────────────────────────────────────────────────────────
// Working directory setup
// ─────────────────────────────────────────────────────────────

async function prepareWorkingDir(
	ghRepo: string,
): Promise<Result<WorkingDir, DiscoveryError>> {
	let tempRoot: string
	try {
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "sk-update-"))
	} catch (error) {
		return {
			error: {
				message: "Unable to create temporary working directory.",
				operation: "mkdtemp",
				path: assertAbsolutePathDirect(os.tmpdir()),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}

	const repoName = ghRepo.split("/")[1]
	if (!repoName) {
		return {
			error: {
				field: "gh_repo",
				message: `Invalid GitHub repo format: ${ghRepo}`,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	// Clone the existing fork (don't create a new one)
	const script = `
set -euo pipefail
cd "${tempRoot}"

# Clone the existing fork
gh repo clone "${FORK_OWNER}/${repoName}" repo -- --depth=1
echo "Cloned fork"

# Checkout the branch
cd repo
git fetch origin "${BRANCH_NAME}"
git checkout -b "${BRANCH_NAME}" FETCH_HEAD
echo "Checked out ${BRANCH_NAME}"
`

	const setupResult = await new Promise<Result<void, DiscoveryError>>((resolve) => {
		const child = spawn("bash", ["-c", script], {
			env: process.env,
			stdio: "inherit",
		})

		child.on("error", (error) => {
			resolve({
				error: {
					message: "Clone/checkout failed. Check gh CLI authentication.",
					operation: "spawn",
					path: assertAbsolutePathDirect(tempRoot),
					rawError: error,
					type: "io",
				},
				ok: false,
			})
		})

		child.on("close", (code) => {
			if (code === 0) {
				resolve({ ok: true, value: undefined })
			} else {
				resolve({
					error: {
						message: `Clone/checkout failed with exit code ${code}.`,
						operation: "spawn",
						path: assertAbsolutePathDirect(tempRoot),
						type: "io",
					},
					ok: false,
				})
			}
		})
	})

	if (!setupResult.ok) {
		await rm(tempRoot, { force: true, recursive: true })
		return setupResult
	}

	const repoPath = path.join(tempRoot, "repo")
	return { ok: true, value: { path: repoPath, root: tempRoot } }
}

// ─────────────────────────────────────────────────────────────
// Claude session
// ─────────────────────────────────────────────────────────────

async function invokeClaudeSession(
	workdir: WorkingDir,
): Promise<Result<void, DiscoveryError>> {
	return new Promise((resolve) => {
		const child = spawn("claude", [CLAUDE_PROMPT], {
			cwd: workdir.path,
			env: process.env,
			stdio: "inherit",
		})

		child.on("error", (error) => {
			resolve({
				error: {
					message: "Failed to spawn Claude CLI.",
					operation: "spawn",
					path: assertAbsolutePathDirect(workdir.path),
					rawError: error,
					type: "io",
				},
				ok: false,
			})
		})

		child.on("close", (code) => {
			if (code === 0) {
				resolve({ ok: true, value: undefined })
			} else {
				resolve({
					error: {
						message: `Claude CLI exited with code ${code}.`,
						operation: "spawn",
						path: assertAbsolutePathDirect(workdir.path),
						type: "io",
					},
					ok: false,
				})
			}
		})
	})
}

// ─────────────────────────────────────────────────────────────
// Finalize changes
// ─────────────────────────────────────────────────────────────

async function finalizeChanges(
	workdir: WorkingDir,
): Promise<Result<{ hasChanges: boolean }, DiscoveryError>> {
	const script = `
set -euo pipefail
cd "${workdir.path}"

git add .

# Check if there are any changes (exit 2 = no changes)
if git diff --staged --quiet; then
  echo "[info] No changes detected."
  exit 2
fi

echo "[info] Committing and pushing..."
git commit --no-gpg-sign -m "${COMMIT_MESSAGE}"
git push origin "${BRANCH_NAME}"
echo "[success] Changes pushed"
`

	return new Promise((resolve) => {
		const child = spawn("bash", ["-c", script], {
			env: process.env,
			stdio: "inherit",
		})

		child.on("error", (error) => {
			resolve({
				error: {
					message: "Finalize script failed.",
					operation: "spawn",
					path: assertAbsolutePathDirect(workdir.path),
					rawError: error,
					type: "io",
				},
				ok: false,
			})
		})

		child.on("close", (code) => {
			if (code === 0) {
				resolve({ ok: true, value: { hasChanges: true } })
			} else if (code === 2) {
				resolve({ ok: true, value: { hasChanges: false } })
			} else {
				resolve({
					error: {
						message: `Finalize script exited with code ${code}.`,
						operation: "spawn",
						path: assertAbsolutePathDirect(workdir.path),
						type: "io",
					},
					ok: false,
				})
			}
		})
	})
}

// ─────────────────────────────────────────────────────────────
// Process a single repo
// ─────────────────────────────────────────────────────────────

async function processRepo(pr: OpenPR): Promise<Result<void, DiscoveryError>> {
	console.log(`\n${"─".repeat(60)}`)
	console.log(`Processing: ${pr.ghRepo}`)
	console.log(`PR: ${pr.prUrl}`)
	console.log(`${"─".repeat(60)}\n`)

	const workdir = await prepareWorkingDir(pr.ghRepo)
	if (!workdir.ok) {
		return workdir
	}

	try {
		const claudeResult = await invokeClaudeSession(workdir.value)
		if (!claudeResult.ok) {
			return claudeResult
		}

		console.log("\n[info] Claude session ended")

		const finalizeResult = await finalizeChanges(workdir.value)
		if (!finalizeResult.ok) {
			return finalizeResult
		}

		if (finalizeResult.value.hasChanges) {
			console.log(`[success] Updated ${pr.ghRepo}`)
		} else {
			console.log(`[info] No changes for ${pr.ghRepo}`)
		}

		return { ok: true, value: undefined }
	} finally {
		await rm(workdir.value.root, { force: true, recursive: true })
	}
}

// ─────────────────────────────────────────────────────────────
// Main command
// ─────────────────────────────────────────────────────────────

export async function updateDraftsCommand(): Promise<Result<void, DiscoveryError>> {
	intro("Update drafted PRs")

	// Step 1: Load draft entries
	console.log("\nLoading drafted PRs...")
	const entriesResult = await loadDraftEntries()
	if (!entriesResult.ok) {
		return entriesResult
	}

	if (entriesResult.value.length === 0) {
		outro("No drafted PRs found")
		return { ok: true, value: undefined }
	}

	console.log(`Found ${entriesResult.value.length} drafted PR(s)\n`)

	// Step 2: Filter to open PRs
	console.log("Checking PR status...")
	const openResult = await filterOpenPRs(entriesResult.value)
	if (!openResult.ok) {
		return openResult
	}

	if (openResult.value.length === 0) {
		outro("No open PRs to update")
		return { ok: true, value: undefined }
	}

	console.log(`\n${openResult.value.length} open PR(s) available\n`)

	// Step 3: Multi-select which repos to update
	const options = openResult.value.map((pr) => ({
		label: `${pr.ghRepo} (PR #${pr.prNumber})`,
		value: pr.ghRepo,
	}))

	const selected = await multiselect({
		initialValues: openResult.value.map((pr) => pr.ghRepo),
		message: "Select PRs to update:",
		options,
		required: false,
	})

	if (isCancel(selected)) {
		outro("Cancelled")
		return { ok: true, value: undefined }
	}

	if (selected.length === 0) {
		outro("No PRs selected")
		return { ok: true, value: undefined }
	}

	// Step 4: Process selected repos sequentially
	const selectedSet = new Set(selected)
	const toProcess = openResult.value.filter((pr) => selectedSet.has(pr.ghRepo))

	for (const pr of toProcess) {
		const result = await processRepo(pr)
		if (!result.ok) {
			console.error(`\n[error] Failed to process ${pr.ghRepo}`)
			return result
		}
	}

	outro(`Done! Processed ${toProcess.length} PR(s)`)
	return { ok: true, value: undefined }
}

function isNotFound(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	)
}
