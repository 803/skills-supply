import {
	formatSkPackageAddCommand,
	parseSerializedDeclaration,
} from "@skills-supply/core"
import type { Database, IndexedPackagesId } from "@skills-supply/database"
import { db } from "@skills-supply/database"
import {
	type Expression,
	type ExpressionBuilder,
	type Selectable,
	type SqlBool,
	sql,
} from "kysely"

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
	"backups",
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

export interface IndexedPackagesStats {
	totalPackages: number
	uniqueRepos: number
	uniqueTopics: number
	latestUpdate: Date | null
}

export async function getIndexedPackagesStats(): Promise<IndexedPackagesStats> {
	// Single query using CTE to scan the table once for all stats
	const pathConditions = EXCLUDED_PATH_SEGMENTS.map(
		(seg) => sql`path NOT LIKE ${`%${seg}%`}`,
	)
	const whereClause = sql`path IS NULL OR (${sql.join(pathConditions, sql` AND `)})`

	const result = await sql<{
		total_packages: number
		unique_repos: number
		unique_topics: number
		latest_update: Date | null
	}>`
		WITH filtered_packages AS (
			SELECT gh_repo, gh_topics, updated_at
			FROM indexed_packages
			WHERE ${whereClause}
		)
		SELECT
			(SELECT COUNT(*) FROM filtered_packages) as total_packages,
			(SELECT COUNT(DISTINCT gh_repo) FROM filtered_packages) as unique_repos,
			(SELECT COUNT(DISTINCT topic) FROM filtered_packages, unnest(gh_topics) as topic) as unique_topics,
			(SELECT MAX(updated_at) FROM filtered_packages) as latest_update
	`.execute(db)

	const row = result.rows[0]
	return {
		latestUpdate: row?.latest_update ? new Date(row.latest_update) : null,
		totalPackages: Number(row?.total_packages ?? 0),
		uniqueRepos: Number(row?.unique_repos ?? 0),
		uniqueTopics: Number(row?.unique_topics ?? 0),
	}
}

export async function listIndexedPackages(
	options: { limit?: number } = {},
): Promise<IndexedPackage[]> {
	let query = db
		.selectFrom("indexed_packages")
		.selectAll()
		.where(excludeInstalledPaths)
		.orderBy("gh_stars", "desc")

	if (options.limit) {
		query = query.limit(options.limit)
	}

	return query.execute()
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
