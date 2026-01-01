import type { Dirent } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { parseLegacyManifest } from "@/src/core/manifest/parse"
import type {
	DetectedPackage,
	PackageExtractionError,
	PackageExtractionResult,
	Skill,
} from "@/src/core/packages/types"
import type { AbsolutePath } from "@/src/core/types/branded"
import { coerceAbsolutePath, coerceNonEmpty } from "@/src/core/types/coerce"

const SKILL_FILENAME = "SKILL.md"

type SkillResult =
	| { ok: true; value: Skill }
	| { ok: false; error: PackageExtractionError }
type SkillNameResult =
	| { ok: true; value: string }
	| { ok: false; error: PackageExtractionError }
type SkillDirResult =
	| { ok: true; value: AbsolutePath[] }
	| { ok: false; error: PackageExtractionError }

/**
 * Extract skills from a detected package.
 * For manifest packages, discovers skills based on exports.auto_discover setting.
 * For other packages, uses pre-computed skillPaths from detection.
 */
export async function extractSkills(
	detected: DetectedPackage,
): Promise<PackageExtractionResult> {
	const origin = detected.canonical.origin

	// For manifest packages, we need to read the manifest to get skill discovery settings
	if (detected.detection.method === "manifest" && detected.detection.manifestPath) {
		return extractFromManifest(detected.detection.manifestPath, origin)
	}

	if (detected.detection.method === "marketplace") {
		return failure(
			"invalid_skill",
			"Marketplace packages cannot be installed as skills. Add a plugin from the marketplace instead.",
			detected.packagePath,
			origin,
		)
	}

	// For other detection methods, use pre-computed skillPaths
	return buildSkillList(detected.skillPaths as AbsolutePath[], origin)
}

async function extractFromManifest(
	manifestPath: AbsolutePath,
	origin: Skill["origin"],
): Promise<PackageExtractionResult> {
	let contents: string

	try {
		contents = await readFile(manifestPath, "utf8")
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to read ${manifestPath}.`),
			manifestPath,
			origin,
		)
	}

	const parsed = parseLegacyManifest(contents, manifestPath)
	if (!parsed.ok) {
		return failure("invalid_skill", parsed.error.message, manifestPath, origin)
	}

	const skillsSetting = resolveAutoDiscoverSkills(parsed.value.exports)
	if (skillsSetting === false) {
		return failure(
			"invalid_skill",
			"Skill auto-discovery is disabled in agents.toml.",
			manifestPath,
			origin,
		)
	}

	const skillsRoot = coerceAbsolutePath(skillsSetting, path.dirname(manifestPath))
	if (!skillsRoot) {
		return failure(
			"invalid_skill",
			`Invalid skills path "${skillsSetting}" in ${manifestPath}.`,
			manifestPath,
			origin,
		)
	}
	const skillDirs = await discoverSkillDirs(skillsRoot)
	if (!skillDirs.ok) {
		return skillDirs
	}

	return buildSkillList(skillDirs.value, origin)
}

function resolveAutoDiscoverSkills(
	exports: { autoDiscover: { skills: string | false } } | undefined,
): string | false {
	const value = exports?.autoDiscover.skills
	if (value === false) {
		return false
	}

	if (typeof value === "string") {
		return value
	}

	return "./skills"
}

async function discoverSkillDirs(rootDir: AbsolutePath): Promise<SkillDirResult> {
	const stats = await safeStat(rootDir)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return failure("invalid_skill", `Skills directory not found: ${rootDir}`, rootDir)
	}

	if (!stats.value.isDirectory()) {
		return failure("invalid_skill", `Expected directory at ${rootDir}.`, rootDir)
	}

	let entries: Dirent[]
	try {
		entries = await readdir(rootDir, { withFileTypes: true })
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to read ${rootDir}.`),
			rootDir,
		)
	}

	const skillDirs: AbsolutePath[] = []
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue
		}

		const skillDir = coerceAbsolutePath(String(entry.name), rootDir)
		if (!skillDir) {
			return failure(
				"invalid_skill",
				`Invalid skill directory entry "${entry.name}" under ${rootDir}.`,
				rootDir,
			)
		}
		const skillFile = coerceAbsolutePath(SKILL_FILENAME, skillDir)
		if (!skillFile) {
			return failure(
				"invalid_skill",
				`Unable to resolve ${SKILL_FILENAME} under ${skillDir}.`,
				skillDir,
			)
		}
		const exists = await fileExists(skillFile)
		if (!exists.ok) {
			return exists
		}

		if (exists.value) {
			skillDirs.push(skillDir)
		}
	}

	if (skillDirs.length === 0) {
		return failure("invalid_skill", `No skills found in ${rootDir}.`, rootDir)
	}

	return { ok: true, value: skillDirs }
}

async function buildSkillList(
	skillDirs: readonly AbsolutePath[],
	origin: Skill["origin"],
): Promise<PackageExtractionResult> {
	const skills: Skill[] = []
	const seen = new Set<string>()

	for (const skillDir of skillDirs) {
		const skillResult = await loadSkillFromDir(skillDir, origin)
		if (!skillResult.ok) {
			return skillResult
		}

		if (seen.has(skillResult.value.name)) {
			return failure(
				"invalid_skill",
				`Duplicate skill name "${skillResult.value.name}" found.`,
				skillDir,
				origin,
			)
		}

		seen.add(skillResult.value.name)
		skills.push(skillResult.value)
	}

	return { ok: true, value: skills }
}

async function loadSkillFromDir(
	skillDir: AbsolutePath,
	origin: Skill["origin"],
): Promise<SkillResult> {
	const skillPath = coerceAbsolutePath(SKILL_FILENAME, skillDir)
	if (!skillPath) {
		return failure(
			"invalid_skill",
			`Unable to resolve ${SKILL_FILENAME} under ${skillDir}.`,
			skillDir,
			origin,
		)
	}
	let contents: string

	try {
		contents = await readFile(skillPath, "utf8")
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to read ${skillPath}.`),
			skillPath,
			origin,
		)
	}

	const nameResult = parseSkillName(contents, skillPath)
	if (!nameResult.ok) {
		return nameResult
	}

	const name = coerceNonEmpty(nameResult.value)
	if (!name) {
		return failure(
			"invalid_skill",
			"Skill name must not be empty.",
			skillPath,
			origin,
		)
	}

	return {
		ok: true,
		value: {
			name,
			origin,
			sourcePath: skillDir,
		},
	}
}

function parseSkillName(contents: string, skillPath: AbsolutePath): SkillNameResult {
	const normalized = contents.replace(/\r\n/g, "\n")
	const lines = normalized.split("\n")

	const firstLine = lines[0]?.trim() ?? ""
	if (!firstLine || firstLine !== "---") {
		return failure(
			"invalid_skill",
			"SKILL.md must start with YAML frontmatter.",
			skillPath,
		)
	}

	let name: string | null = null
	let closed = false

	for (const line of lines.slice(1)) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#")) {
			continue
		}

		if (trimmed === "---") {
			closed = true
			break
		}

		if (!trimmed.startsWith("name:")) {
			continue
		}

		if (name !== null) {
			return failure(
				"invalid_skill",
				"SKILL.md frontmatter defines name more than once.",
				skillPath,
			)
		}

		const rawValue = trimmed.slice("name:".length).trim()
		if (!rawValue) {
			return failure(
				"invalid_skill",
				"SKILL.md frontmatter name must not be empty.",
				skillPath,
			)
		}

		if (rawValue.startsWith("|") || rawValue.startsWith(">")) {
			return failure(
				"invalid_skill",
				"SKILL.md frontmatter name must be a single-line value.",
				skillPath,
			)
		}

		name = stripOuterQuotes(rawValue)
	}

	if (!closed) {
		return failure(
			"invalid_skill",
			"SKILL.md frontmatter is missing a closing --- line.",
			skillPath,
		)
	}

	if (!name) {
		return failure(
			"invalid_skill",
			"SKILL.md frontmatter must include a name.",
			skillPath,
		)
	}

	return { ok: true, value: name }
}

function stripOuterQuotes(value: string): string {
	if (value.length < 2) {
		return value
	}

	const first = value[0]
	const last = value[value.length - 1]
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return value.slice(1, -1).trim()
	}

	return value
}

function formatErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		return `${fallback} ${error.message}`
	}

	return fallback
}

type StatResult =
	| { ok: true; value: Awaited<ReturnType<typeof stat>> | null }
	| { ok: false; error: PackageExtractionError }

type ExistsResult =
	| { ok: true; value: boolean }
	| { ok: false; error: PackageExtractionError }

async function safeStat(targetPath: AbsolutePath): Promise<StatResult> {
	try {
		const stats = await stat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to access ${targetPath}.`),
			targetPath,
		)
	}
}

async function fileExists(targetPath: AbsolutePath): Promise<ExistsResult> {
	const stats = await safeStat(targetPath)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return { ok: true, value: false }
	}

	if (!stats.value.isFile()) {
		return failure("invalid_skill", `Expected file at ${targetPath}.`, targetPath)
	}

	return { ok: true, value: true }
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}

function failure(
	type: PackageExtractionError["type"],
	message: string,
	pathValue: AbsolutePath,
	origin?: Skill["origin"],
): { ok: false; error: PackageExtractionError } {
	return {
		error: {
			message,
			origin,
			path: pathValue,
			type,
		},
		ok: false,
	}
}
