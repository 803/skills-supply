import type { Result } from "@skills-supply/core"
import {
	coerceAbsolutePathDirect,
	coerceGithubRef,
	coerceGitUrl,
	coerceNonEmpty,
	coerceRemoteMarketplaceUrl,
} from "@skills-supply/core"
import { db } from "@/db"
import { coerceIndexedPackageId, getIndexedPackageById } from "@/db/indexed-packages"
import type { IndexedDeclaration } from "@/types"
import type { DiscoveryError } from "@/types/errors"

export async function draftCommand(id: number): Promise<Result<void, DiscoveryError>> {
	try {
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

		const declaration = parseDeclaration(row.declaration)
		if (!declaration.ok) {
			return declaration
		}
		const markdown = renderDraft(declaration.value)
		console.log(markdown)
		return { ok: true, value: undefined }
	} finally {
		await db.destroy()
	}
}

function renderDraft(declaration: IndexedDeclaration): string {
	const lines: string[] = []
	lines.push("## Installation", "")

	if (isClaudePlugin(declaration)) {
		lines.push("### Claude Code (CLI)", "", "```bash")
		lines.push(
			`claude plugin marketplace add ${declaration.marketplace}`,
			`claude plugin install ${declaration.plugin}@${declaration.marketplace}`,
		)
		lines.push("```", "", "### Claude Code (Slash Commands)", "", "```")
		lines.push(
			`/plugin marketplace add ${declaration.marketplace}`,
			`/plugin install ${declaration.plugin}@${declaration.marketplace}`,
		)
		lines.push("```", "")
	}

	lines.push(
		"### Cross-Agent Install (sk)",
		"",
		"Works with Claude Code, Codex, OpenCode, Factory, and other compatible agents:",
		"",
		"```bash",
	)
	lines.push(buildSkInstallLine(declaration), "sk sync", "```", "")
	lines.push(
		"> **Why sk?** One manifest, all agents. [Learn more](https://skills.supply)",
	)

	return lines.join("\n")
}

function buildSkInstallLine(declaration: IndexedDeclaration): string {
	switch (declaration.type) {
		case "registry": {
			const name = declaration.org
				? `@${declaration.org}/${declaration.name}`
				: declaration.name
			return `sk pkg add registry ${name}@${declaration.version}`
		}
		case "git":
			return buildPathCommand(`sk pkg add git ${declaration.url}`, declaration.path)
		case "github":
			return buildPathCommand(
				`sk pkg add github ${declaration.gh}`,
				declaration.path,
			)
		case "local":
			return `sk pkg add local ${declaration.path}`
		case "claude-plugin":
			return `sk pkg add claude-plugin ${declaration.plugin}@${declaration.marketplace}`
		default: {
			const exhaustive: never = declaration
			throw new Error(
				`Unsupported declaration type: ${String(
					(exhaustive as { type?: string }).type ?? "unknown",
				)}`,
			)
		}
	}
}

function buildPathCommand(base: string, pathValue?: string): string {
	if (!pathValue) {
		return base
	}

	return `${base} --path ${pathValue}`
}

function parseDeclaration(raw: string): Result<IndexedDeclaration, DiscoveryError> {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (error) {
		return {
			error: {
				message: "Invalid declaration JSON.",
				rawError: error instanceof Error ? error : undefined,
				source: "declaration",
				type: "parse",
			},
			ok: false,
		}
	}

	if (!parsed || typeof parsed !== "object") {
		return {
			error: {
				field: "declaration",
				message: "Invalid declaration format.",
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const record = parsed as Record<string, unknown>

	if (record.type === "registry") {
		if (typeof record.name !== "string" || typeof record.version !== "string") {
			return {
				error: {
					field: "declaration",
					message: "Registry declaration is missing name or version.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const name = coerceNonEmpty(record.name)
		const version = coerceNonEmpty(record.version)
		const org =
			typeof record.org === "string"
				? (coerceNonEmpty(record.org) ?? undefined)
				: undefined
		if (!name || !version || (record.org && !org)) {
			return {
				error: {
					field: "declaration",
					message: "Registry declaration has invalid fields.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return {
			ok: true,
			value: {
				name,
				org,
				type: "registry",
				version,
			},
		}
	}

	if (record.type === "github") {
		if (typeof record.gh !== "string") {
			return {
				error: {
					field: "declaration",
					message: "GitHub declaration is missing gh.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const gh = coerceGithubRef(record.gh)
		if (!gh) {
			return {
				error: {
					field: "declaration",
					message: "GitHub declaration has invalid gh.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const pathValue =
			typeof record.path === "string"
				? (coerceNonEmpty(record.path) ?? undefined)
				: undefined
		if (record.path && !pathValue) {
			return {
				error: {
					field: "declaration",
					message: "GitHub declaration has invalid path.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return {
			ok: true,
			value: {
				gh,
				path: pathValue,
				type: "github",
			},
		}
	}

	if (record.type === "git") {
		if (typeof record.url !== "string") {
			return {
				error: {
					field: "declaration",
					message: "Git declaration is missing url.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const url = coerceGitUrl(record.url)
		if (!url) {
			return {
				error: {
					field: "declaration",
					message: "Git declaration has invalid url.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const pathValue =
			typeof record.path === "string"
				? (coerceNonEmpty(record.path) ?? undefined)
				: undefined
		if (record.path && !pathValue) {
			return {
				error: {
					field: "declaration",
					message: "Git declaration has invalid path.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return {
			ok: true,
			value: {
				path: pathValue,
				type: "git",
				url,
			},
		}
	}

	if (record.type === "local") {
		if (typeof record.path !== "string") {
			return {
				error: {
					field: "declaration",
					message: "Local declaration is missing path.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const pathValue = coerceAbsolutePathDirect(record.path)
		if (!pathValue) {
			return {
				error: {
					field: "declaration",
					message: "Local declaration has invalid path.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return { ok: true, value: { path: pathValue, type: "local" } }
	}

	if (record.type === "claude-plugin") {
		if (typeof record.plugin !== "string" || typeof record.marketplace !== "string") {
			return {
				error: {
					field: "declaration",
					message:
						"Claude plugin declaration is missing plugin or marketplace.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const plugin = coerceNonEmpty(record.plugin)
		const marketplace =
			coerceRemoteMarketplaceUrl(record.marketplace) ??
			coerceAbsolutePathDirect(record.marketplace) ??
			coerceGitUrl(record.marketplace) ??
			coerceGithubRef(record.marketplace)
		if (!plugin || !marketplace) {
			return {
				error: {
					field: "declaration",
					message: "Claude plugin declaration has invalid fields.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return {
			ok: true,
			value: {
				marketplace,
				plugin,
				type: "claude-plugin",
			},
		}
	}

	return {
		error: {
			field: "declaration",
			message: "Declaration did not match any known type.",
			source: "manual",
			type: "validation",
		},
		ok: false,
	}
}

function isClaudePlugin(
	declaration: IndexedDeclaration,
): declaration is Extract<IndexedDeclaration, { type: "claude-plugin" }> {
	return "type" in declaration && declaration.type === "claude-plugin"
}
