import { execFile, spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { confirm, intro, isCancel, text } from "@clack/prompts"
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
	listDistinctReposByStars,
	listPackagesByRepo,
	listSkillsByPackageIds,
} from "@/db/indexed-packages"
import type { IndexedDeclaration } from "@/types"
import type { DiscoveryError } from "@/types/errors"

interface SkillInfo {
	name: string
	description: string | null
}

interface PackageInfo {
	id: number
	name: string | null
	description: string | null
	path: string | null
	declaration: IndexedDeclaration
	declarationKey: string
	installCommand: string
	skills: SkillInfo[]
}

interface TargetRepo {
	gh_repo: string
	packages: PackageInfo[]
}

interface WorkingDir {
	path: string
	root: string
}

type DraftState = Record<
	string,
	{
		pr_url: string
		packages: string[]
	}
>

type DraftMode = "link" | "submit"

type DraftOptions = {
	id?: number
	maxStars?: number
	mode: DraftMode
}

const BRANCH_NAME = "sk-install-instructions"
const COMMIT_MESSAGE = "docs: add sk installation instructions"
const PR_TITLE = "docs: add sk installation instructions"
const FORK_OWNER = "803"

const COMMAND_DIR = path.dirname(fileURLToPath(import.meta.url))
const DISCOVERY_DIR = path.resolve(COMMAND_DIR, "..")
const STATE_FILE_PATH = path.join(DISCOVERY_DIR, "drafted-prs.json")
const PROMPT_FILE_PATH = path.join(DISCOVERY_DIR, "draft-prompt.md")
const PR_BODY_FILE_PATH = path.join(DISCOVERY_DIR, "PR.md")

const execFileAsync = promisify(execFile)

export async function draftCommand(
	options: DraftOptions,
): Promise<Result<void, DiscoveryError>> {
	let tempRoot: string | undefined

	try {
		if (options.mode === "submit") {
			intro(`🚨 SUBMIT MODE — a PR will be created in the upstream repo`)
		} else {
			intro("🔗 LINK MODE — changes pushed to fork, you create the PR")
		}

		const target = await resolveTargetRepo(options)
		if (!target.ok) {
			return target
		}

		const packageCount = target.value.packages.length
		console.log(
			`[info] Target repo: ${target.value.gh_repo} (${packageCount} package${packageCount === 1 ? "" : "s"})`,
		)
		for (const pkg of target.value.packages) {
			console.log(`[info]   - ${pkg.name ?? pkg.declarationKey}`)
		}

		const workdir = await prepareWorkingDir(target.value.gh_repo)
		if (!workdir.ok) {
			return workdir
		}
		tempRoot = workdir.value.root
		console.log(
			`[info] Fork and branch ready: ${FORK_OWNER}/${target.value.gh_repo.split("/")[1]}`,
		)

		const generated = await invokeClaudeForGeneration(workdir.value, target.value)
		if (!generated.ok) {
			return generated
		}
		console.log("[info] Claude session ended")

		const result = await finalizeChanges(workdir.value, target.value, options.mode)
		return result
	} finally {
		if (tempRoot) {
			await rm(tempRoot, { force: true, recursive: true })
		}
		await db.destroy()
	}
}

async function resolveTargetRepo(
	options: DraftOptions,
): Promise<Result<TargetRepo, DiscoveryError>> {
	if (options.id !== undefined) {
		return resolveRepoByPackageId(options.id)
	}

	return selectNextUnprocessedRepo({ maxStars: options.maxStars })
}

async function resolveRepoByPackageId(
	id: number,
): Promise<Result<TargetRepo, DiscoveryError>> {
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

	const allPackages = await listPackagesByRepo(db, row.gh_repo)
	return await buildTargetRepo(row.gh_repo, allPackages)
}

async function selectNextUnprocessedRepo(
	options: { maxStars?: number } = {},
): Promise<Result<TargetRepo, DiscoveryError>> {
	const state = await loadStateFile()
	if (!state.ok) {
		return state
	}

	const repos = await listDistinctReposByStars(db, { maxStars: options.maxStars })
	for (const repo of repos) {
		if (state.value[repo.gh_repo]) {
			continue
		}

		const allPackages = await listPackagesByRepo(db, repo.gh_repo)
		const target = await buildTargetRepo(repo.gh_repo, allPackages)
		if (!target.ok) {
			return target
		}

		// Display repo info and prompt user
		const confirmed = await promptForRepoConfirmation(target.value)
		if (confirmed === "cancelled") {
			return {
				error: {
					message: "Cancelled by user.",
					target: "repo",
					type: "not_found",
				},
				ok: false,
			}
		}
		if (confirmed === "skip") {
			continue
		}

		return target
	}

	return {
		error: {
			message: "No unprocessed repos found.",
			target: "repo",
			type: "not_found",
		},
		ok: false,
	}
}

async function promptForRepoConfirmation(
	repo: TargetRepo,
): Promise<"confirmed" | "skip" | "cancelled"> {
	console.log("")
	console.log(`[repo] https://github.com/${repo.gh_repo}`)
	console.log("")

	for (const pkg of repo.packages) {
		const name = pkg.name ?? pkg.declarationKey
		console.log(`  Package: ${name}`)
		if (pkg.description) {
			console.log(`    Description: ${pkg.description}`)
		}
		if (pkg.path) {
			console.log(`    Path: ${pkg.path}`)
		}
		console.log(`    Install: ${pkg.installCommand}`)

		if (pkg.skills.length > 0) {
			console.log(`    Skills (${pkg.skills.length}):`)
			for (const skill of pkg.skills) {
				const desc = skill.description
					? ` - ${truncate(skill.description, 60)}`
					: ""
				console.log(`      • ${skill.name}${desc}`)
			}
		}
		console.log("")
	}

	const shouldProceed = await confirm({
		initialValue: true,
		message: `Process ${repo.gh_repo}?`,
	})

	if (isCancel(shouldProceed)) {
		return "cancelled"
	}

	return shouldProceed ? "confirmed" : "skip"
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text
	}
	return `${text.slice(0, maxLength - 3)}...`
}

async function buildTargetRepo(
	ghRepo: string,
	rows: Array<{
		id: number
		name: string | null
		description: string | null
		gh_repo: string
		gh_stars: number
		declaration: string
	}>,
): Promise<Result<TargetRepo, DiscoveryError>> {
	// Fetch skills for all packages
	const packageIds = rows
		.map((row) => coerceIndexedPackageId(row.id))
		.filter((id): id is NonNullable<typeof id> => id !== null)
	const skillRows = await listSkillsByPackageIds(db, packageIds)

	// Group skills by package id
	const skillsByPackage = new Map<number, SkillInfo[]>()
	for (const skill of skillRows) {
		const pkgId = skill.indexed_package_id
		if (pkgId === null) continue
		const list = skillsByPackage.get(pkgId) ?? []
		list.push({ description: skill.description, name: skill.name })
		skillsByPackage.set(pkgId, list)
	}

	const packages: PackageInfo[] = []

	for (const row of rows) {
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
		const pkgPath = "path" in declaration ? (declaration.path ?? null) : null

		packages.push({
			declaration,
			declarationKey: normalizeDeclarationToKey(declaration),
			description: row.description,
			id: row.id,
			installCommand: formatSkPackageAddCommand(declaration),
			name: row.name,
			path: pkgPath,
			skills: skillsByPackage.get(row.id) ?? [],
		})
	}

	return {
		ok: true,
		value: {
			gh_repo: ghRepo,
			packages,
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
		packages: z.array(z.string()),
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

async function prepareWorkingDir(
	ghRepo: string,
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

	const script = `
set -euo pipefail
cd "${tempRoot}"

# Create fork (prints URL like https://github.com/803/skills-3)
FORK_URL=$(gh repo fork "${ghRepo}" --org "${FORK_OWNER}" --clone=false)
FORK_NAME=$(basename "$FORK_URL")
echo "✓ Created fork ${FORK_OWNER}/$FORK_NAME"

# Clone to fixed path "repo"
gh repo clone "${FORK_OWNER}/$FORK_NAME" repo -- --depth=1
echo "✓ Cloned fork"

# Set up branch (gh repo clone already adds upstream remote for forks)
cd repo
git push origin --delete "${BRANCH_NAME}" 2>/dev/null || true
git fetch --depth 1 upstream HEAD
git checkout -b "${BRANCH_NAME}" FETCH_HEAD
`

	const setupResult = await new Promise<Result<void, DiscoveryError>>((resolve) => {
		const child = spawn("bash", ["-c", script], {
			env: process.env,
			stdio: "inherit",
		})

		child.on("error", (error) => {
			resolve({
				error: {
					message:
						"Fork/clone setup failed. Check gh CLI authentication and permissions.",
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
						message: `Fork/clone setup failed with exit code ${code}.`,
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
		return setupResult
	}

	const repoPath = path.join(tempRoot, "repo")
	return { ok: true, value: { path: repoPath, root: tempRoot } }
}

async function invokeClaudeForGeneration(
	workdir: WorkingDir,
	repo: TargetRepo,
): Promise<Result<void, DiscoveryError>> {
	const promptResult = await buildPrompt(repo)
	if (!promptResult.ok) {
		return promptResult
	}

	// Spawn Claude interactively - user takes control until Claude exits
	return new Promise((resolve) => {
		const child = spawn("claude", [promptResult.value], {
			cwd: workdir.path,
			env: process.env,
			stdio: "inherit", // User can interact directly with Claude
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

async function buildPrompt(repo: TargetRepo): Promise<Result<string, DiscoveryError>> {
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

	const packagesData = repo.packages.map((pkg) => ({
		description: pkg.description,
		installCommand: pkg.installCommand,
		name: pkg.name,
		path: pkg.path,
		skills: pkg.skills,
	}))

	const prompt = template
		.replaceAll("{{REPO}}", repo.gh_repo)
		.replaceAll("{{PACKAGES_JSON}}", JSON.stringify(packagesData, null, 2))

	return { ok: true, value: prompt }
}

async function finalizeChanges(
	workdir: WorkingDir,
	repo: TargetRepo,
	mode: DraftMode,
): Promise<Result<void, DiscoveryError>> {
	// Read PR body from file if in submit mode
	let prBody = ""
	if (mode === "submit") {
		try {
			prBody = (await readFile(PR_BODY_FILE_PATH, "utf8")).trim()
		} catch (error) {
			return {
				error: {
					message: `Unable to read ${PR_BODY_FILE_PATH}.`,
					operation: "readFile",
					path: assertAbsolutePathDirect(PR_BODY_FILE_PATH),
					rawError: error instanceof Error ? error : undefined,
					type: "io",
				},
				ok: false,
			}
		}
	}

	// Build script: show diff, commit, push, optionally create PR
	let script = `
set -euo pipefail
cd "${workdir.path}"

echo "[info] Staging changes..."
git add .

echo ""
echo "[diff]"
git diff --staged

# Check if there are any changes (exit 2 = no changes)
if git diff --staged --quiet; then
  echo ""
  echo "[info] No changes detected. Exiting."
  exit 2
fi

echo ""
echo "[info] Committing and pushing..."
git commit --no-gpg-sign -m "${COMMIT_MESSAGE}"
git push origin "${BRANCH_NAME}"
`

	if (mode === "submit") {
		script += `
echo ""
echo "[info] Creating PR..."
# gh pr create --head doesn't support org:branch syntax (cli/cli#10093)
# Use REST API which handles org forks correctly
DEFAULT_BRANCH=$(gh api "repos/${repo.gh_repo}" --jq '.default_branch')
gh api "repos/${repo.gh_repo}/pulls" \\
  --method POST \\
  -f title="${PR_TITLE}" \\
  -f body="${escapeForShell(prBody)}" \\
  -f head="${FORK_OWNER}:${BRANCH_NAME}" \\
  -f base="$DEFAULT_BRANCH"
`
	}

	// Run the script with inherited stdio so user sees everything
	// Exit codes: 0 = success with changes, 2 = success with no changes
	const scriptResult = await new Promise<
		Result<{ noChanges: boolean }, DiscoveryError>
	>((resolve) => {
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
				resolve({ ok: true, value: { noChanges: false } })
			} else if (code === 2) {
				resolve({ ok: true, value: { noChanges: true } })
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

	if (!scriptResult.ok) {
		return scriptResult
	}

	// No changes detected - exit cleanly
	if (scriptResult.value.noChanges) {
		return { ok: true, value: undefined }
	}

	// Link mode: print the PR creation link, prompt for URL, save state
	if (mode === "link") {
		const repoName = repo.gh_repo.split("/")[1]
		// Get default branch for the link
		let defaultBranch: string
		try {
			const { stdout } = await execFileAsync(
				"gh",
				["api", `repos/${repo.gh_repo}`, "--jq", ".default_branch"],
				{ cwd: workdir.path },
			)
			defaultBranch = stdout.trim()
		} catch {
			defaultBranch = "main" // fallback
		}

		const prLink = `https://github.com/${repo.gh_repo}/compare/${defaultBranch}...${FORK_OWNER}:${repoName}:${BRANCH_NAME}?expand=1`
		console.log("")
		console.log("[link] Open this URL to create the PR:")
		console.log(`       ${prLink}`)

		// Show preview of state entry
		const packageKeys = repo.packages.map((pkg) => pkg.declarationKey)
		console.log("")
		console.log("[state] Will add to drafted-prs.json:")
		console.log(
			`        "${repo.gh_repo}": { packages: ${JSON.stringify(packageKeys)}, pr_url: "..." }`,
		)

		// Prompt for PR URL
		console.log("")
		const prUrlInput = await text({
			message: "Paste the PR URL after creating it:",
			placeholder: `https://github.com/${repo.gh_repo}/pull/...`,
			validate: (value) => {
				if (!value.trim()) {
					return "PR URL is required"
				}
				if (!value.startsWith(`https://github.com/${repo.gh_repo}/pull/`)) {
					return `Expected URL starting with https://github.com/${repo.gh_repo}/pull/`
				}
			},
		})

		if (isCancel(prUrlInput)) {
			console.log("[info] Cancelled. State file not updated.")
			return { ok: true, value: undefined }
		}

		const prUrl = prUrlInput.trim()

		// Update state file
		const state = await loadStateFile()
		if (!state.ok) {
			return state
		}

		state.value[repo.gh_repo] = {
			packages: packageKeys,
			pr_url: prUrl,
		}

		const saved = await saveStateFile(state.value)
		if (!saved.ok) {
			return saved
		}

		console.log(`[success] PR recorded: ${prUrl}`)
		console.log("[info] State file updated")

		return { ok: true, value: undefined }
	}

	// Submit mode: query the PR URL from the upstream repo (--repo needed since we're in fork dir)
	let prUrl: string
	try {
		const { stdout } = await execFileAsync(
			"gh",
			["pr", "view", "--repo", repo.gh_repo, "--json", "url", "-q", ".url"],
			{
				cwd: workdir.path,
			},
		)
		prUrl = stdout.trim()
	} catch (error) {
		return {
			error: {
				message: "Failed to get PR URL after creation.",
				operation: "execFile",
				path: assertAbsolutePathDirect(workdir.path),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}

	if (!prUrl) {
		return {
			error: {
				message: "PR URL is empty after creation.",
				operation: "execFile",
				path: assertAbsolutePathDirect(workdir.path),
				type: "io",
			},
			ok: false,
		}
	}

	// Update state file
	const state = await loadStateFile()
	if (!state.ok) {
		return state
	}

	const stateKey = repo.gh_repo
	const stateValue = {
		packages: repo.packages.map((pkg) => pkg.declarationKey),
		pr_url: prUrl,
	}
	console.log(`[state] Adding to state file:`)
	console.log(`[state]   key: ${JSON.stringify(stateKey)}`)
	console.log(`[state]   value: ${JSON.stringify(stateValue)}`)

	state.value[stateKey] = stateValue
	const saved = await saveStateFile(state.value)
	if (!saved.ok) {
		return saved
	}

	console.log(`[success] PR created: ${prUrl}`)
	console.log("[info] State file updated")

	return { ok: true, value: undefined }
}

function isNotFound(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	)
}

function escapeForShell(str: string): string {
	return str
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\$/g, "\\$")
		.replace(/`/g, "\\`")
}
