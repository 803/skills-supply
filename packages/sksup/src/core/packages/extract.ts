import { readFile } from "node:fs/promises"
import path from "node:path"
import type {
	DetectedPackage,
	PackageExtractionError,
	PackageExtractionResult,
	Skill,
} from "@/core/packages/types"

const SKILL_FILENAME = "SKILL.md"

type SkillResult =
	| { ok: true; value: Skill }
	| { ok: false; error: PackageExtractionError }
type SkillNameResult =
	| { ok: true; value: string }
	| { ok: false; error: PackageExtractionError }

export async function extractSkills(
	detected: DetectedPackage,
): Promise<PackageExtractionResult> {
	switch (detected.type) {
		case "manifest":
			return failure(
				"invalid_skill",
				"Package skills.toml manifests are not supported yet.",
				detected.manifestPath,
			)
		case "plugin":
			return failure(
				"invalid_skill",
				"Claude plugin packages are not supported yet.",
				detected.pluginPath,
			)
		case "single":
			return buildSkillList([detected.skillDir])
		case "subdir":
			return buildSkillList(detected.skillDirs)
	}
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
