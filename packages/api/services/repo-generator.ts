import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import type { Database } from "@skills-supply/database"
import { db } from "@skills-supply/database"
import type { Selectable } from "kysely"
import { env } from "@/env"
import { addCommit, ensureBareRepo, type FileMap, getHeadSha } from "@/services/git-ops"

export type User = Selectable<Database["users"]>
export type Plugin = Selectable<Database["plugins"]>

export interface ResolvedRepo {
	repoPath: string
	cleanup?: () => Promise<void>
}

const MARKETPLACE_REPO = "marketplace"
const PLUGIN_REPO_PREFIX = "plugins"

export async function getMarketplaceRepoPath(user: User): Promise<string> {
	const plugins = await db
		.selectFrom("plugins")
		.selectAll()
		.where("is_active", "=", true)
		.execute()

	const purchases = await db
		.selectFrom("purchases")
		.select(["plugin_id"])
		.where("user_id", "=", user.id)
		.where("status", "=", "paid")
		.execute()

	const purchasedIds = new Set(purchases.map((purchase) => purchase.plugin_id))
	const marketplace = {
		name: "user-marketplace",
		plugins: plugins.map((plugin) => ({
			description: purchasedIds.has(plugin.id)
				? plugin.description
				: `${plugin.description} [NOT PURCHASED]`,
			name: plugin.slug,
			source: {
				source: "url",
				url: `${normalizeBaseUrl(env.API_BASE_URL)}/u/${plugin.creator_username}/${plugin.slug}.git`,
			},
		})),
	}

	const files: FileMap = {
		".claude-plugin/marketplace.json": JSON.stringify(marketplace, null, 2),
	}

	return getOrCreateUserRepo(user, MARKETPLACE_REPO, files)
}

export async function resolvePluginRepo(
	user: User,
	creatorUsername: string,
	slug: string,
): Promise<ResolvedRepo | null> {
	const plugin = await db
		.selectFrom("plugins")
		.selectAll()
		.where("slug", "=", slug)
		.where("creator_username", "=", creatorUsername)
		.where("is_active", "=", true)
		.executeTakeFirst()

	if (!plugin) {
		return null
	}

	const purchase = await db
		.selectFrom("purchases")
		.select(["id"])
		.where("user_id", "=", user.id)
		.where("plugin_id", "=", plugin.id)
		.where("status", "=", "paid")
		.executeTakeFirst()

	if (purchase) {
		return clonePurchasedRepo(plugin)
	}

	const files = buildStubPluginFiles(plugin)
	const repoPath = await getOrCreateUserRepo(
		user,
		`${PLUGIN_REPO_PREFIX}/${creatorUsername}/${slug}`,
		files,
	)
	return { repoPath }
}

function buildStubPluginFiles(plugin: Plugin): FileMap {
	const manifest = {
		description: `Premium plugin by @${plugin.creator_username} - purchase required`,
		name: plugin.slug,
		version: "0.0.0-stub",
	}

	const skillMarkdown = buildSkillMarkdown(plugin)
	const buyCommand = buildBuyCommandMarkdown(plugin)

	return {
		"commands/buy.md": buyCommand,
		"plugin.json": JSON.stringify(manifest, null, 2),
		"SKILL.md": skillMarkdown,
	}
}

function buildSkillMarkdown(plugin: Plugin): string {
	return `---\nname: ${plugin.slug}\ndescription: ${plugin.description} [PURCHASE REQUIRED]\n---\n\n# ${plugin.name}\n\n${plugin.description}\n\n## Get Access\n\nRun the \`/buy\` command to purchase this plugin, or visit:\n${normalizeBaseUrl(env.WEB_BASE_URL)}/u/${plugin.creator_username}/${plugin.slug}\n`
}

function buildBuyCommandMarkdown(plugin: Plugin): string {
	return `---\nname: buy\ndescription: Purchase this plugin to unlock full functionality\n---\n\nOpening browser to complete purchase...\n\n${normalizeBaseUrl(env.WEB_BASE_URL)}/u/${plugin.creator_username}/${plugin.slug}\n`
}

async function getOrCreateUserRepo(
	user: User,
	repoName: string,
	files: FileMap,
): Promise<string> {
	const contentHash = hashFiles(files)
	const existing = await db
		.selectFrom("repo_state")
		.selectAll()
		.where("user_id", "=", user.id)
		.where("repo_name", "=", repoName)
		.executeTakeFirst()

	if (existing && existing.content_hash === contentHash) {
		return existing.repo_path
	}

	const repoPath =
		existing?.repo_path ?? path.join(env.REPO_CACHE_DIR, user.id, repoName)

	await ensureBareRepo(repoPath)
	await addCommit(repoPath, files, existing?.last_commit_sha ?? null)
	const headSha = getHeadSha(repoPath)

	await db
		.insertInto("repo_state")
		.values({
			content_hash: contentHash,
			last_commit_sha: headSha,
			repo_name: repoName,
			repo_path: repoPath,
			user_id: user.id,
		})
		.onConflict((oc) =>
			oc.columns(["user_id", "repo_name"]).doUpdateSet({
				content_hash: contentHash,
				last_commit_sha: headSha,
				repo_path: repoPath,
				updated_at: new Date(),
			}),
		)
		.execute()

	return repoPath
}

function hashFiles(files: FileMap): string {
	const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
	const hash = createHash("sha256")
		.update(entries.map(([name, contents]) => `${name}\u0000${contents}`).join("\n"))
		.digest("hex")
	return hash.slice(0, 12)
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}

async function clonePurchasedRepo(plugin: Plugin): Promise<ResolvedRepo> {
	if (!plugin.source_repo_url || !plugin.source_ref) {
		throw new Error(`Missing source repo data for plugin ${plugin.slug}`)
	}

	await fs.mkdir(env.REPO_CACHE_DIR, { recursive: true })
	const tempDir = await fs.mkdtemp(path.join(env.REPO_CACHE_DIR, "sk-clone-"))
	const repoPath = path.join(tempDir, "repo.git")

	try {
		execFileSync(
			"git",
			[
				"clone",
				"--bare",
				"--branch",
				plugin.source_ref,
				"--single-branch",
				plugin.source_repo_url,
				repoPath,
			],
			{
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
				stdio: "ignore",
			},
		)
	} catch (error) {
		await fs.rm(tempDir, { force: true, recursive: true })
		throw error
	}

	return {
		cleanup: async () => {
			await fs.rm(tempDir, { force: true, recursive: true })
		},
		repoPath,
	}
}
