import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import {
	assertAbsolutePathDirect,
	formatSkPackageAddCommand,
	normalizeDeclarationToKey,
	parseSerializedDeclaration,
	type Result,
} from "@skills-supply/core"
import { z } from "zod"
import { db } from "@/db"
import {
	coerceIndexedPackageId,
	getIndexedPackageById,
	listPackagesByStars,
} from "@/db/indexed-packages"
import {
	cloneRemoteRepo,
	gitAddAll,
	gitCheckoutNewBranch,
	gitCommit,
	gitDiffStaged,
	gitPush,
} from "@/sources/git"
import {
	checkRepoExists,
	createFork,
	createPullRequestViaCli,
	deleteRepo,
	waitForForkReady,
} from "@/sources/github"
import type { IndexedDeclaration } from "@/types"
import type { DiscoveryError } from "@/types/errors"

interface TargetPackage {
	id: number
	name: string | null
	description: string | null
	gh_repo: string
	gh_stars: number
	declaration: IndexedDeclaration
	declarationKey: string
	installCommand: string
}

interface ForkInfo {
	forkUrl: string
	forkOwner: string
	forkRepo: string
}

interface WorkingDir {
	path: string
	root: string
}

type DraftState = Record<string, { pr_url: string }>

type DraftOptions = {
	id?: number
	dryRun: boolean
}

const execFileAsync = promisify(execFile)

const BRANCH_NAME = "sk-install-instructions"
const COMMIT_MESSAGE = "docs: add sk installation instructions"
const PR_TITLE = "docs: add sk installation instructions"
const PR_BODY =
	"Adds installation instructions for the sk tool.\n\n" +
	"sk is a cross-agent skill installer that works with Claude Code, Codex, OpenCode, Factory, and other compatible agents.\n\n" +
	"Learn more: https://skills.supply"
const FORK_OWNER = "803"

const COMMAND_DIR = path.dirname(fileURLToPath(import.meta.url))
const DISCOVERY_DIR = path.resolve(COMMAND_DIR, "..")
const STATE_FILE_PATH = path.join(DISCOVERY_DIR, "drafted-prs.json")
const PROMPT_FILE_PATH = path.join(DISCOVERY_DIR, "draft-prompt.md")

export async function draftCommand(
	options: DraftOptions,
): Promise<Result<void, DiscoveryError>> {
	let tempRoot: string | undefined

	try {
		const target = await resolveTargetPackage(options)
		if (!target.ok) {
			return target
		}

		const declarationLabel = JSON.stringify(target.value.declaration)
		console.log(
			`[info] Target package: ${declarationLabel} (id: ${target.value.id}, stars: ${target.value.gh_stars})`,
		)
		console.log(`[info] Target repo: ${target.value.gh_repo}`)

		const fork = await prepareFork(target.value.gh_repo)
		if (!fork.ok) {
			return fork
		}
		console.log(`[info] Fork created: ${fork.value.forkOwner}/${fork.value.forkRepo}`)

		const workdir = await cloneToWorkingDir(fork.value)
		if (!workdir.ok) {
			return workdir
		}
		tempRoot = workdir.value.root

		const generated = await invokeClaudeForGeneration(workdir.value, target.value)
		if (!generated.ok) {
			return generated
		}
		console.log("[info] Claude completed content generation")

		const diff = await detectChanges(workdir.value)
		if (!diff.ok) {
			return diff
		}
		console.log("[diff]")
		console.log(diff.value)

		if (options.dryRun) {
			console.log("[info] Dry run complete. No PR created.")
			return { ok: true, value: undefined }
		}

		if (diff.value.trim().length === 0) {
			console.log("[info] No changes detected. Exiting.")
			return { ok: true, value: undefined }
		}

		const pr = await submitPR(workdir.value, target.value, fork.value)
		if (!pr.ok) {
			return pr
		}
		console.log("[info] Changes committed and pushed")
		console.log(`[success] PR created: ${pr.value.prUrl}`)
		console.log("[info] State file updated")

		return { ok: true, value: undefined }
	} finally {
		if (tempRoot) {
			await rm(tempRoot, { force: true, recursive: true })
		}
		await db.destroy()
	}
}

async function resolveTargetPackage(
	options: DraftOptions,
): Promise<Result<TargetPackage, DiscoveryError>> {
	if (options.id !== undefined) {
		return resolvePackageById(options.id)
	}

	return selectNextUnprocessedPackage()
}

async function resolvePackageById(
	id: number,
): Promise<Result<TargetPackage, DiscoveryError>> {
	const packageId = coerceIndexedPackageId(id)
	if (!packageId) {
		return {
			error: {
				field: "id",
				message: "Package id must be a positive integer.",
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const row = await getIndexedPackageById(db, packageId)
	if (!row) {
		return {
			error: {
				message: `Package not found: ${id}`,
				target: "package",
				type: "not_found",
			},
			ok: false,
		}
	}

	return buildTargetPackage(row)
}

async function selectNextUnprocessedPackage(): Promise<
	Result<TargetPackage, DiscoveryError>
> {
	const state = await loadStateFile()
	if (!state.ok) {
		return state
	}

	const rows = await listPackagesByStars(db)
	for (const row of rows) {
		const candidate = buildTargetPackage(row)
		if (!candidate.ok) {
			return candidate
		}
		if (!state.value[candidate.value.declarationKey]) {
			return candidate
		}
	}

	return {
		error: {
			message: "No unprocessed packages found.",
			target: "package",
			type: "not_found",
		},
		ok: false,
	}
}

function buildTargetPackage(row: {
	id: number
	name: string | null
	description: string | null
	gh_repo: string
	gh_stars: number
	declaration: string
}): Result<TargetPackage, DiscoveryError> {
	const parsed = parseSerializedDeclaration(row.declaration)
	if (!parsed.ok) {
		return {
			error: {
				field: "declaration",
				message: `Invalid declaration for package ${row.id}: ${parsed.error.message}`,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const declaration = parsed.value
	return {
		ok: true,
		value: {
			declaration,
			declarationKey: normalizeDeclarationToKey(declaration),
			description: row.description,
			gh_repo: row.gh_repo,
			gh_stars: row.gh_stars,
			id: row.id,
			installCommand: formatSkPackageAddCommand(declaration),
			name: row.name,
		},
	}
}

async function loadStateFile(): Promise<Result<DraftState, DiscoveryError>> {
	let contents: string
	try {
		contents = await readFile(STATE_FILE_PATH, "utf8")
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: {} }
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

	return parseDraftState(parsed, STATE_FILE_PATH)
}

async function saveStateFile(state: DraftState): Promise<Result<void, DiscoveryError>> {
	const output = JSON.stringify(state, null, 2)

	try {
		await writeFile(STATE_FILE_PATH, `${output}\n`)
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				message: `Unable to write ${STATE_FILE_PATH}.`,
				operation: "writeFile",
				path: assertAbsolutePathDirect(STATE_FILE_PATH),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

const DraftStateSchema = z.record(
	z.string(),
	z.object({
		pr_url: z.string().min(1, "pr_url cannot be empty"),
	}),
)

function parseDraftState(
	raw: unknown,
	statePath: string,
): Result<DraftState, DiscoveryError> {
	const result = DraftStateSchema.safeParse(raw)
	if (!result.success) {
		return {
			error: {
				field: "state",
				message: result.error.message,
				path: assertAbsolutePathDirect(statePath),
				source: "zod",
				type: "validation",
				zodError: result.error,
			},
			ok: false,
		}
	}
	return { ok: true, value: result.data }
}

async function prepareFork(ghRepo: string): Promise<Result<ForkInfo, DiscoveryError>> {
	const parsed = parseGithubRepo(ghRepo)
	if (!parsed.ok) {
		return parsed
	}
	const [owner, repo] = parsed.value

	const exists = await checkRepoExists(FORK_OWNER, repo)
	if (!exists.ok) {
		return exists
	}

	if (exists.value) {
		const deleted = await deleteRepo(FORK_OWNER, repo)
		if (!deleted.ok) {
			return deleted
		}
	}

	const fork = await createFork(owner, repo)
	if (!fork.ok) {
		return fork
	}

	const ready = await waitForForkReady(FORK_OWNER, repo)
	if (!ready.ok) {
		return ready
	}

	return {
		ok: true,
		value: {
			forkOwner: FORK_OWNER,
			forkRepo: repo,
			forkUrl: fork.value.clone_url,
		},
	}
}

async function cloneToWorkingDir(
	fork: ForkInfo,
): Promise<Result<WorkingDir, DiscoveryError>> {
	let tempRoot: string
	try {
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "sk-draft-"))
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

	const repoPath = path.join(tempRoot, "repo")
	const cloned = await cloneRemoteRepo({
		destination: repoPath,
		remoteUrl: fork.forkUrl,
	})
	if (!cloned.ok) {
		return cloned
	}

	const branched = await gitCheckoutNewBranch(repoPath, BRANCH_NAME)
	if (!branched.ok) {
		return branched
	}

	return { ok: true, value: { path: repoPath, root: tempRoot } }
}

async function invokeClaudeForGeneration(
	workdir: WorkingDir,
	pkg: TargetPackage,
): Promise<Result<void, DiscoveryError>> {
	const promptResult = await buildPrompt(pkg)
	if (!promptResult.ok) {
		return promptResult
	}

	try {
		await execFileAsync("claude", ["--print", "-p", promptResult.value], {
			cwd: workdir.path,
			env: process.env,
			timeout: 300000,
		})
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				message: "Claude CLI failed.",
				operation: "execFile",
				path: assertAbsolutePathDirect(workdir.path),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

async function buildPrompt(pkg: TargetPackage): Promise<Result<string, DiscoveryError>> {
	let template: string
	try {
		template = await readFile(PROMPT_FILE_PATH, "utf8")
	} catch (error) {
		return {
			error: {
				message: `Unable to read ${PROMPT_FILE_PATH}.`,
				operation: "readFile",
				path: assertAbsolutePathDirect(PROMPT_FILE_PATH),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}

	const installCommands = `${pkg.installCommand}\nsk sync`
	const prompt = template
		.replaceAll("{{PACKAGE_NAME}}", pkg.name ?? "unknown")
		.replaceAll("{{PACKAGE_DESCRIPTION}}", pkg.description ?? "")
		.replaceAll("{{INSTALL_COMMAND}}", installCommands)
		.replaceAll("{{DECLARATION}}", JSON.stringify(pkg.declaration, null, 2))

	return { ok: true, value: prompt }
}

async function detectChanges(
	workdir: WorkingDir,
): Promise<Result<string, DiscoveryError>> {
	const added = await gitAddAll(workdir.path)
	if (!added.ok) {
		return added
	}

	return gitDiffStaged(workdir.path)
}

async function submitPR(
	workdir: WorkingDir,
	pkg: TargetPackage,
	fork: ForkInfo,
): Promise<Result<{ prUrl: string }, DiscoveryError>> {
	// Load state file FIRST, before any irreversible actions
	const state = await loadStateFile()
	if (!state.ok) {
		return state
	}

	const committed = await gitCommit(workdir.path, COMMIT_MESSAGE)
	if (!committed.ok) {
		return committed
	}

	const pushed = await gitPush(workdir.path, "origin", BRANCH_NAME)
	if (!pushed.ok) {
		return pushed
	}

	const head = `${fork.forkOwner}:${BRANCH_NAME}`
	const pr = await createPullRequestViaCli(
		workdir.path,
		pkg.gh_repo,
		head,
		PR_TITLE,
		PR_BODY,
	)
	if (!pr.ok) {
		return pr
	}

	// Log before writing so manual recovery is possible if write fails
	const stateKey = pkg.declarationKey
	const stateValue = { pr_url: pr.value.url }
	console.log(`[state] Adding to state file:`)
	console.log(`[state]   key: ${JSON.stringify(stateKey)}`)
	console.log(`[state]   value: ${JSON.stringify(stateValue)}`)

	state.value[stateKey] = stateValue
	const saved = await saveStateFile(state.value)
	if (!saved.ok) {
		return saved
	}

	return { ok: true, value: { prUrl: pr.value.url } }
}

function parseGithubRepo(ghRepo: string): Result<[string, string], DiscoveryError> {
	const parts = ghRepo.split("/").map((part) => part.trim())
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		return {
			error: {
				field: "gh_repo",
				message: `Invalid GitHub repo: ${ghRepo}`,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return { ok: true, value: [parts[0], parts[1]] }
}

function isNotFound(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	)
}
