import {
	formatSkPackageAddCommand,
	parseSerializedDeclaration,
} from "@skills-supply/core/standalone"
import type { Database, IndexedPackagesId } from "@skills-supply/database"
import { db } from "@skills-supply/database"
import type { Expression, ExpressionBuilder, Selectable, SqlBool } from "kysely"

export type { IndexedPackagesId }

export type IndexedPackage = Selectable<Database["indexed_packages"]>
export type IndexedPackageSkill = Selectable<Database["indexed_package_skills"]>

export type IndexedPackageWithSkills = {
	package: IndexedPackage
	skills: IndexedPackageSkill[]
}

/**
 * Path segments that indicate installed/configured skills rather than source packages.
 * Packages with paths containing any of these segments should be excluded from listings.
 */
export const EXCLUDED_PATH_SEGMENTS = [
	".claude",
	".codex",
	".agent",
	".agents",
	".ai",
	".aider-desk",
	".config",
	".codebuddy",
	".opencode",
	".skills",
	".github",
] as const

/**
 * Builds a WHERE condition that excludes packages with paths containing
 * segments that indicate installed/configured skills (e.g., .claude, .codex).
 * Use this for any listing/browsing queries to filter out non-source packages.
 */
export function excludeInstalledPaths(
	eb: ExpressionBuilder<Database, "indexed_packages">,
): Expression<SqlBool> {
	return eb.or([
		eb("path", "is", null),
		eb.and(
			EXCLUDED_PATH_SEGMENTS.map((segment) =>
				eb("path", "not like", `%${segment}%`),
			),
		),
	])
}

export async function listIndexedPackages(): Promise<IndexedPackage[]> {
	return db
		.selectFrom("indexed_packages")
		.selectAll()
		.where(excludeInstalledPaths)
		.orderBy("gh_stars", "desc")
		.execute()
}

export async function fetchIndexedPackageById(
	id: IndexedPackagesId,
): Promise<IndexedPackage | undefined> {
	return db
		.selectFrom("indexed_packages")
		.selectAll()
		.where("id", "=", id)
		.executeTakeFirst()
}

type IndexedPackageSkillJoinRow = IndexedPackage & {
	skill_id: IndexedPackageSkill["id"] | null
	skill_name: IndexedPackageSkill["name"] | null
	skill_description: IndexedPackageSkill["description"] | null
	skill_relative_path: IndexedPackageSkill["relative_path"] | null
}

export async function fetchIndexedPackageWithSkills(
	id: IndexedPackagesId,
): Promise<IndexedPackageWithSkills | undefined> {
	const rows = await db
		.selectFrom("indexed_packages")
		.leftJoin(
			"indexed_package_skills",
			"indexed_packages.id",
			"indexed_package_skills.indexed_package_id",
		)
		.selectAll("indexed_packages")
		.select([
			"indexed_package_skills.id as skill_id",
			"indexed_package_skills.name as skill_name",
			"indexed_package_skills.description as skill_description",
			"indexed_package_skills.relative_path as skill_relative_path",
		])
		.where("indexed_packages.id", "=", id)
		.orderBy("indexed_package_skills.name", "asc")
		.execute()

	if (rows.length === 0) {
		return undefined
	}

	const {
		skill_id: _skillId,
		skill_name: _skillName,
		skill_description: _skillDesc,
		skill_relative_path: _skillPath,
		...pkg
	} = rows[0] as IndexedPackageSkillJoinRow

	const skills: IndexedPackageSkill[] = []
	for (const row of rows as IndexedPackageSkillJoinRow[]) {
		if (row.skill_id === null) {
			continue
		}
		if (row.skill_name === null || row.skill_relative_path === null) {
			continue
		}
		skills.push({
			description: row.skill_description ?? null,
			id: row.skill_id,
			indexed_package_id: pkg.id,
			name: row.skill_name,
			relative_path: row.skill_relative_path,
		})
	}

	return { package: pkg, skills }
}

export function buildSkInstallCommand(declaration: string): string {
	const parsed = parseSerializedDeclaration(declaration)
	if (!parsed.ok) {
		return `sk add ${declaration}`
	}

	return formatSkPackageAddCommand(parsed.value)
}
