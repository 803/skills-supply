import { parse, TomlError } from "smol-toml"
import type {
	GithubPackageDeclaration,
	GitPackageDeclaration,
	LocalPackageDeclaration,
	ManifestParseError,
	ManifestParseResult,
	PackageDeclaration,
} from "@/core/manifest/types"

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ManifestParseError }

const TOP_LEVEL_KEYS = new Set(["agents", "packages"])
const GITHUB_KEYS = new Set(["gh", "tag", "branch", "rev", "path"])
const GIT_KEYS = new Set(["git", "tag", "branch", "rev", "path"])
const PATH_KEYS = new Set(["path"])
const REF_KEYS = ["tag", "branch", "rev"] as const

export function parseManifest(contents: string, sourcePath: string): ManifestParseResult {
	let data: unknown

	try {
		data = parse(contents)
	} catch (error) {
		const message =
			error instanceof TomlError
				? `Invalid TOML: ${error.message}`
				: "Invalid TOML."
		return failure("invalid_toml", message, sourcePath)
	}

	if (!isRecord(data)) {
		return failure("invalid_root", "Manifest must be a TOML table.", sourcePath)
	}

	const unknownTopLevel = Object.keys(data).filter((key) => !TOP_LEVEL_KEYS.has(key))
	if (unknownTopLevel.length > 0) {
		return failure(
			"invalid_root",
			`Unknown top-level keys: ${unknownTopLevel.join(", ")}`,
			sourcePath,
		)
	}

	const agentsResult = parseAgents(data.agents, sourcePath)
	if (!agentsResult.ok) {
		return agentsResult
	}

	const packagesResult = parsePackages(data.packages, sourcePath)
	if (!packagesResult.ok) {
		return packagesResult
	}

	return {
		ok: true,
		value: {
			agents: agentsResult.value,
			packages: packagesResult.value,
			sourcePath,
		},
	}
}

function parseAgents(
	value: unknown,
	sourcePath: string,
): ParseResult<Record<string, boolean>> {
	if (value === undefined) {
		return success({})
	}

	if (!isRecord(value)) {
		return failure("invalid_agents", "Agents must be a TOML table.", sourcePath)
	}

	const agents: Record<string, boolean> = {}
	for (const [key, agentValue] of Object.entries(value)) {
		if (typeof agentValue !== "boolean") {
			return failure(
				"invalid_agents",
				`Agent "${key}" must be a boolean.`,
				sourcePath,
				key,
			)
		}

		agents[key] = agentValue
	}

	return success(agents)
}

function parsePackages(
	value: unknown,
	sourcePath: string,
): ParseResult<Record<string, PackageDeclaration>> {
	if (value === undefined) {
		return success({})
	}

	if (!isRecord(value)) {
		return failure("invalid_packages", "Packages must be a TOML table.", sourcePath)
	}

	const packages: Record<string, PackageDeclaration> = {}
	for (const [key, pkgValue] of Object.entries(value)) {
		const parsed = parsePackageDeclaration(key, pkgValue, sourcePath)
		if (!parsed.ok) {
			return parsed
		}

		packages[key] = parsed.value
	}

	return success(packages)
}

function parsePackageDeclaration(
	alias: string,
	value: unknown,
	sourcePath: string,
): ParseResult<PackageDeclaration> {
	if (typeof value === "string") {
		return success(value)
	}

	if (!isRecord(value)) {
		return failure(
			"invalid_package",
			`Package "${alias}" must be a string or inline table.`,
			sourcePath,
			alias,
		)
	}

	const sources = ["gh", "git", "path"].filter((key) => key in value)
	if (sources.length !== 1) {
		return failure(
			"invalid_package",
			`Package "${alias}" must define exactly one of gh, git, or path.`,
			sourcePath,
			alias,
		)
	}

	const source = sources[0]
	if (source === "path") {
		return parsePathPackage(alias, value, sourcePath)
	}

	if (source === "gh") {
		return parseGithubPackage(alias, value, sourcePath)
	}

	return parseGitPackage(alias, value, sourcePath)
}

function parsePathPackage(
	alias: string,
	value: Record<string, unknown>,
	sourcePath: string,
): ParseResult<LocalPackageDeclaration> {
	const unknownKeys = Object.keys(value).filter((key) => !PATH_KEYS.has(key))
	if (unknownKeys.length > 0) {
		return failure(
			"invalid_package",
			`Package "${alias}" has unknown keys: ${unknownKeys.join(", ")}`,
			sourcePath,
			alias,
		)
	}

	const pathValue = value.path
	if (typeof pathValue !== "string") {
		return failure(
			"invalid_package",
			`Package "${alias}" path must be a string.`,
			sourcePath,
			alias,
		)
	}

	return success({ path: pathValue })
}

function parseGithubPackage(
	alias: string,
	value: Record<string, unknown>,
	sourcePath: string,
): ParseResult<GithubPackageDeclaration> {
	const unknownKeys = Object.keys(value).filter((key) => !GITHUB_KEYS.has(key))
	if (unknownKeys.length > 0) {
		return failure(
			"invalid_package",
			`Package "${alias}" has unknown keys: ${unknownKeys.join(", ")}`,
			sourcePath,
			alias,
		)
	}

	const ghValue = value.gh
	if (typeof ghValue !== "string") {
		return failure(
			"invalid_package",
			`Package "${alias}" gh must be a string.`,
			sourcePath,
			alias,
		)
	}

	const refResult = parseRef(alias, value, sourcePath)
	if (!refResult.ok) {
		return refResult
	}

	const pathValue = value.path
	if (pathValue !== undefined && typeof pathValue !== "string") {
		return failure(
			"invalid_package",
			`Package "${alias}" path must be a string.`,
			sourcePath,
			alias,
		)
	}

	return success({
		gh: ghValue,
		...refResult.value,
		...(pathValue !== undefined ? { path: pathValue } : {}),
	})
}

function parseGitPackage(
	alias: string,
	value: Record<string, unknown>,
	sourcePath: string,
): ParseResult<GitPackageDeclaration> {
	const unknownKeys = Object.keys(value).filter((key) => !GIT_KEYS.has(key))
	if (unknownKeys.length > 0) {
		return failure(
			"invalid_package",
			`Package "${alias}" has unknown keys: ${unknownKeys.join(", ")}`,
			sourcePath,
			alias,
		)
	}

	const gitValue = value.git
	if (typeof gitValue !== "string") {
		return failure(
			"invalid_package",
			`Package "${alias}" git must be a string.`,
			sourcePath,
			alias,
		)
	}

	const refResult = parseRef(alias, value, sourcePath)
	if (!refResult.ok) {
		return refResult
	}

	const pathValue = value.path
	if (pathValue !== undefined && typeof pathValue !== "string") {
		return failure(
			"invalid_package",
			`Package "${alias}" path must be a string.`,
			sourcePath,
			alias,
		)
	}

	return success({
		git: gitValue,
		...refResult.value,
		...(pathValue !== undefined ? { path: pathValue } : {}),
	})
}

function parseRef(
	alias: string,
	value: Record<string, unknown>,
	sourcePath: string,
): ParseResult<{ tag?: string; branch?: string; rev?: string }> {
	const presentRefs = REF_KEYS.filter((key) => key in value)
	if (presentRefs.length > 1) {
		return failure(
			"invalid_package",
			`Package "${alias}" must use only one of tag, branch, or rev.`,
			sourcePath,
			alias,
		)
	}

	const ref = presentRefs[0]
	if (!ref) {
		return success({})
	}

	const refValue = value[ref]
	if (typeof refValue !== "string") {
		return failure(
			"invalid_package",
			`Package "${alias}" ${ref} must be a string.`,
			sourcePath,
			alias,
		)
	}

	return success({ [ref]: refValue } as { tag?: string; branch?: string; rev?: string })
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function success<T>(value: T): ParseResult<T> {
	return { ok: true, value }
}

function failure(
	type: ManifestParseError["type"],
	message: string,
	sourcePath: string,
	key?: string,
): ParseResult<never> {
	return {
		error: {
			key,
			message,
			sourcePath,
			type,
		},
		ok: false,
	}
}
