import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { parseManifest } from "@/core/manifest/parse"
import type { Manifest } from "@/core/manifest/types"
import type {
	DetectedPackage,
	PackageExtractionError,
	PackageExtractionResult,
	Skill,
} from "@/core/packages/types"

const SKILL_FILENAME = "SKILL.md"
const PLUGIN_SKILLS_DIR = "skills"

type SkillResult =
	| { ok: true; value: Skill }
	| { ok: false; error: PackageExtractionError }
type SkillNameResult =
	| { ok: true; value: string }
	| { ok: false; error: PackageExtractionError }
type SkillDirResult =
	| { ok: true; value: string[] }
	| { ok: false; error: PackageExtractionError }

export async function extractSkills(
	detected: DetectedPackage,
): Promise<PackageExtractionResult> {
	switch (detected.type) {
		case "manifest":
			return extractFromManifest(detected.manifestPath)
		case "plugin":
			return extractFromPlugin(detected.rootPath)
		case "single":
			return buildSkillList([detected.skillDir])
		case "subdir":
			return buildSkillList(detected.skillDirs)
	}
}

async function extractFromManifest(
	manifestPath: string,
): Promise<PackageExtractionResult> {
	let contents: string

	try {
		contents = await readFile(manifestPath, "utf8")
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to read ${manifestPath}.`),
			manifestPath,
		)
	}

	const parsed = parseManifest(contents, manifestPath)
	if (!parsed.ok) {
		return failure("invalid_skill", parsed.error.message, manifestPath)
	}

	const skillsSetting = resolveAutoDiscoverSkills(parsed.value)
	if (skillsSetting === false) {
		return failure(
			"invalid_skill",
			"Skill auto-discovery is disabled in package.toml.",
			manifestPath,
		)
	}

	const skillsRoot = path.resolve(path.dirname(manifestPath), skillsSetting)
	const skillDirs = await discoverSkillDirs(skillsRoot)
	if (!skillDirs.ok) {
		return skillDirs
	}

	return buildSkillList(skillDirs.value)
}

async function extractFromPlugin(rootPath: string): Promise<PackageExtractionResult> {
	const skillsRoot = path.join(rootPath, PLUGIN_SKILLS_DIR)
	const skillDirs = await discoverSkillDirs(skillsRoot)
	if (!skillDirs.ok) {
		return skillDirs
	}

	return buildSkillList(skillDirs.value)
}

function resolveAutoDiscoverSkills(manifest: Manifest): string | false {
	const value = manifest.exports?.autoDiscover.skills
	if (value === false) {
		return false
	}

	if (typeof value === "string") {
		return value
	}

	return "./skills"
}

async function discoverSkillDirs(rootDir: string): Promise<SkillDirResult> {
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

	let entries: Awaited<ReturnType<typeof readdir>>
	try {
		entries = await readdir(rootDir, { encoding: "utf8", withFileTypes: true })
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to read ${rootDir}.`),
			rootDir,
		)
	}

	const skillDirs: string[] = []
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue
		}

		const skillDir = path.join(rootDir, entry.name)
		const skillFile = path.join(skillDir, SKILL_FILENAME)
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

async function buildSkillList(skillDirs: string[]): Promise<PackageExtractionResult> {
	const skills: Skill[] = []
	const seen = new Set<string>()

	for (const skillDir of skillDirs) {
		const skillResult = await loadSkillFromDir(skillDir)
		if (!skillResult.ok) {
			return skillResult
		}

		if (seen.has(skillResult.value.name)) {
			return failure(
				"invalid_skill",
				`Duplicate skill name "${skillResult.value.name}" found.`,
				skillDir,
			)
		}

		seen.add(skillResult.value.name)
		skills.push(skillResult.value)
	}

	return { ok: true, value: skills }
}

async function loadSkillFromDir(skillDir: string): Promise<SkillResult> {
	const skillPath = path.join(skillDir, SKILL_FILENAME)
	let contents: string

	try {
		contents = await readFile(skillPath, "utf8")
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to read ${skillPath}.`),
			skillPath,
		)
	}

	const nameResult = parseSkillName(contents, skillPath)
	if (!nameResult.ok) {
		return nameResult
	}

	return {
		ok: true,
		value: {
			name: nameResult.value,
			sourcePath: skillDir,
		},
	}
}

function parseSkillName(contents: string, skillPath: string): SkillNameResult {
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

async function safeStat(targetPath: string): Promise<StatResult> {
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

async function fileExists(targetPath: string): Promise<ExistsResult> {
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
	pathValue: string,
): { ok: false; error: PackageExtractionError } {
	return {
		error: {
			message,
			path: pathValue,
			type,
		},
		ok: false,
	}
}
