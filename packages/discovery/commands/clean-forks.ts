import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
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

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface Fork {
	name: string
	upstream: string // "owner/repo"
}

interface OrphanFork extends Fork {
	hasOpenPR: boolean
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

async function loadTrackedRepos(): Promise<Result<Set<string>, DiscoveryError>> {
	let contents: string
	try {
		contents = await readFile(STATE_FILE_PATH, "utf8")
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: new Set() }
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

	return { ok: true, value: new Set(Object.keys(result.data)) }
}

async function listForks(): Promise<Result<Fork[], DiscoveryError>> {
	try {
		const { stdout } = await execFileAsync("gh", [
			"repo",
			"list",
			FORK_OWNER,
			"--fork",
			"--json",
			"name,parent",
			"--limit",
			"100",
		])

		const data = JSON.parse(stdout) as Array<{
			name: string
			parent: { name: string; owner: { login: string } }
		}>

		return {
			ok: true,
			value: data.map((repo) => ({
				name: repo.name,
				upstream: `${repo.parent.owner.login}/${repo.parent.name}`,
			})),
		}
	} catch (error) {
		return {
			error: {
				message: "Failed to list forks. Check gh CLI authentication.",
				rawError: error instanceof Error ? error : undefined,
				source: "gh",
				type: "network",
			},
			ok: false,
		}
	}
}

async function checkForOpenPR(fork: Fork): Promise<boolean> {
	try {
		// Check if there's any open PR from our fork to the upstream
		const { stdout } = await execFileAsync("gh", [
			"pr",
			"list",
			"--repo",
			fork.upstream,
			"--author",
			`@${FORK_OWNER}`,
			"--state",
			"open",
			"--json",
			"number",
			"--limit",
			"1",
		])

		const prs = JSON.parse(stdout) as Array<{ number: number }>
		return prs.length > 0
	} catch {
		// If we can't check (repo deleted, no access, etc.), assume no PR
		return false
	}
}

async function deleteFork(forkName: string): Promise<Result<void, DiscoveryError>> {
	try {
		await execFileAsync("gh", [
			"repo",
			"delete",
			`${FORK_OWNER}/${forkName}`,
			"--yes",
		])
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				message: `Failed to delete fork ${FORK_OWNER}/${forkName}.`,
				rawError: error instanceof Error ? error : undefined,
				source: "gh",
				type: "network",
			},
			ok: false,
		}
	}
}

// ─────────────────────────────────────────────────────────────
// Main command
// ─────────────────────────────────────────────────────────────

export async function cleanForksCommand(): Promise<Result<void, DiscoveryError>> {
	intro("Cleaning orphan forks")

	// Step 1: Load tracked repos from state file
	const trackedResult = await loadTrackedRepos()
	if (!trackedResult.ok) {
		return trackedResult
	}
	const trackedRepos = trackedResult.value

	// Step 2: List all forks in our org
	const forksResult = await listForks()
	if (!forksResult.ok) {
		return forksResult
	}
	const allForks = forksResult.value

	// Step 3: Filter to orphans (not tracked in state)
	const orphanCandidates = allForks.filter((fork) => !trackedRepos.has(fork.upstream))

	if (orphanCandidates.length === 0) {
		outro("No orphan forks found")
		return { ok: true, value: undefined }
	}

	// Step 4: Check each orphan for open PRs (error if found)
	console.log(`Checking ${orphanCandidates.length} orphan candidates for open PRs...`)
	const orphansWithPRCheck: OrphanFork[] = []
	const stateInconsistencies: Fork[] = []

	for (const fork of orphanCandidates) {
		const hasOpenPR = await checkForOpenPR(fork)
		if (hasOpenPR) {
			stateInconsistencies.push(fork)
		} else {
			orphansWithPRCheck.push({ ...fork, hasOpenPR: false })
		}
	}

	// If any orphan has an open PR, error out
	if (stateInconsistencies.length > 0) {
		const details = stateInconsistencies
			.map((f) => `  - ${FORK_OWNER}/${f.name} → ${f.upstream}`)
			.join("\n")
		return {
			error: {
				field: "state",
				message: `Found forks with open PRs not tracked in state file:\n${details}\n\nFix drafted-prs.json before cleaning.`,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (orphansWithPRCheck.length === 0) {
		outro("No orphan forks found")
		return { ok: true, value: undefined }
	}

	// Step 5: Sort by upstream for grouping
	orphansWithPRCheck.sort((a, b) => a.upstream.localeCompare(b.upstream))

	// Step 6: Multi-select UI (all selected by default)
	const options = orphansWithPRCheck.map((fork) => ({
		label: `${fork.upstream} → ${fork.name}`,
		value: fork.name,
	}))

	const selected = await multiselect({
		initialValues: orphansWithPRCheck.map((f) => f.name),
		message: "Select forks to delete:",
		options,
		required: false,
	})

	if (isCancel(selected)) {
		outro("Cancelled")
		return { ok: true, value: undefined }
	}

	if (selected.length === 0) {
		outro("No forks selected")
		return { ok: true, value: undefined }
	}

	// Step 7: Delete selected forks
	console.log(`\nDeleting ${selected.length} forks...`)
	const errors: Array<{ name: string; error: DiscoveryError }> = []

	for (const forkName of selected) {
		process.stdout.write(`  Deleting ${FORK_OWNER}/${forkName}...`)
		const result = await deleteFork(forkName)
		if (result.ok) {
			console.log(" done")
		} else {
			console.log(" FAILED")
			errors.push({ error: result.error, name: forkName })
		}
	}

	if (errors.length > 0) {
		const details = errors.map((e) => `  - ${e.name}: ${e.error.message}`).join("\n")
		return {
			error: {
				message: `Failed to delete ${errors.length} fork(s):\n${details}`,
				source: "gh",
				type: "network",
			},
			ok: false,
		}
	}

	outro(`Deleted ${selected.length} orphan fork(s)`)
	return { ok: true, value: undefined }
}

function isNotFound(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	)
}
