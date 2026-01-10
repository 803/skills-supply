import type { Database } from "@skills-supply/database"
import type { Insertable, Kysely, Selectable } from "kysely"

export type IndexedPackageRow = Selectable<Database["indexed_packages"]>
export type IndexedPackageId = IndexedPackageRow["id"]

export type IndexedPackageInsert = Omit<
	Insertable<Database["indexed_packages"]>,
	"id" | "discovered_at" | "updated_at" | "gh_repo"
>

export type IndexedPackageSkillRow = Selectable<Database["indexed_package_skills"]>

export type IndexedPackageSkillInsert = Omit<
	Insertable<Database["indexed_package_skills"]>,
	"id" | "indexed_package_id"
>

export type IndexedPackageInsertWithSkills = {
	package: IndexedPackageInsert
	skills: IndexedPackageSkillInsert[]
}

export function coerceIndexedPackageId(value: number): IndexedPackageId | null {
	if (!Number.isInteger(value) || value <= 0) {
		return null
	}

	return value as IndexedPackageId
}

export async function upsertRepoPackages(
	db: Kysely<Database>,
	githubRepo: string,
	packages: IndexedPackageInsertWithSkills[],
): Promise<void> {
	await db.transaction().execute(async (trx) => {
		await trx
			.deleteFrom("indexed_packages")
			.where("gh_repo", "=", githubRepo)
			.execute()

		if (packages.length === 0) {
			return
		}

		const inserted = await trx
			.insertInto("indexed_packages")
			.values(
				packages.map((pkg) => ({
					...pkg.package,
					gh_repo: githubRepo,
				})),
			)
			.returning(["id", "declaration"])
			.execute()

		const skillMap = new Map<string, IndexedPackageSkillInsert[]>()
		for (const pkg of packages) {
			skillMap.set(pkg.package.declaration, pkg.skills)
		}

		const skillRows: Insertable<Database["indexed_package_skills"]>[] = []
		for (const row of inserted) {
			const skills = skillMap.get(row.declaration)
			if (!skills) {
				continue
			}
			for (const skill of skills) {
				skillRows.push({
					...skill,
					indexed_package_id: row.id,
				})
			}
		}

		if (skillRows.length > 0) {
			await trx.insertInto("indexed_package_skills").values(skillRows).execute()
		}
	})
}

export async function listIndexedPackages(
	db: Kysely<Database>,
	options: { minStars?: number } = {},
): Promise<IndexedPackageRow[]> {
	let query = db.selectFrom("indexed_packages").selectAll()

	if (options.minStars !== undefined) {
		query = query.where("gh_stars", ">=", options.minStars)
	}

	return query.orderBy("gh_stars", "desc").execute()
}

export async function listPackagesByStars(
	db: Kysely<Database>,
): Promise<IndexedPackageRow[]> {
	return db
		.selectFrom("indexed_packages")
		.selectAll()
		.where((eb) =>
			eb.or([
				eb("path", "is", null),
				eb.and(
					EXCLUDED_PATH_SEGMENTS.map((segment) =>
						eb("path", "not like", `%${segment}%`),
					),
				),
			]),
		)
		.orderBy("gh_stars", "desc")
		.execute()
}

export interface RepoWithStars {
	gh_repo: string
	gh_stars: number
}

/**
 * Returns distinct repos ordered by stars (highest first).
 * Only includes repos that have at least one non-excluded package.
 */
export async function listDistinctReposByStars(
	db: Kysely<Database>,
	options: { maxStars?: number } = {},
): Promise<RepoWithStars[]> {
	let query = db
		.selectFrom("indexed_packages")
		.select(["gh_repo", (eb) => eb.fn.max("gh_stars").as("gh_stars")])
		.where((eb) =>
			eb.or([
				eb("path", "is", null),
				eb.and(
					EXCLUDED_PATH_SEGMENTS.map((segment) =>
						eb("path", "not like", `%${segment}%`),
					),
				),
			]),
		)
		.groupBy("gh_repo")
		.orderBy("gh_stars", "desc")

	if (options.maxStars !== undefined) {
		query = query.having((eb) => eb.fn.max("gh_stars"), "<=", options.maxStars)
	}

	const rows = await query.execute()

	// Kysely returns max() as number | null, coerce to number
	return rows.map((row) => ({
		gh_repo: row.gh_repo,
		gh_stars: row.gh_stars ?? 0,
	}))
}

export async function getIndexedPackageById(
	db: Kysely<Database>,
	id: IndexedPackageId,
): Promise<IndexedPackageRow | undefined> {
	return db
		.selectFrom("indexed_packages")
		.selectAll()
		.where("id", "=", id)
		.executeTakeFirst()
}

export async function listIndexedRepos(db: Kysely<Database>): Promise<string[]> {
	const rows = await db
		.selectFrom("indexed_packages")
		.select("gh_repo")
		.distinct()
		.execute()

	return rows.map((row) => row.gh_repo)
}

/**
 * Path segments that indicate installed/configured skills rather than source packages.
 * Packages with paths containing any of these segments should be excluded from listings.
 */
const EXCLUDED_PATH_SEGMENTS = [
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

export async function listPackagesByRepo(
	db: Kysely<Database>,
	ghRepo: string,
): Promise<
	Array<{
		id: number
		name: string | null
		description: string | null
		gh_repo: string
		gh_stars: number
		declaration: string
	}>
> {
	return db
		.selectFrom("indexed_packages")
		.select(["id", "name", "description", "gh_repo", "gh_stars", "declaration"])
		.where("gh_repo", "=", ghRepo)
		.where((eb) =>
			eb.or([
				eb("path", "is", null),
				eb.and(
					EXCLUDED_PATH_SEGMENTS.map((segment) =>
						eb("path", "not like", `%${segment}%`),
					),
				),
			]),
		)
		.execute()
}

export async function getRandomIndexedPackage(
	db: Kysely<Database>,
): Promise<IndexedPackageRow | undefined> {
	return db
		.selectFrom("indexed_packages")
		.selectAll()
		.where((eb) =>
			eb.or([
				eb("path", "is", null),
				eb.and(
					EXCLUDED_PATH_SEGMENTS.map((segment) =>
						eb("path", "not like", `%${segment}%`),
					),
				),
			]),
		)
		.orderBy((eb) => eb.fn("random"))
		.limit(1)
		.executeTakeFirst()
}

export async function listSkillsByPackageIds(
	db: Kysely<Database>,
	packageIds: IndexedPackageId[],
): Promise<IndexedPackageSkillRow[]> {
	if (packageIds.length === 0) {
		return []
	}

	return db
		.selectFrom("indexed_package_skills")
		.selectAll()
		.where("indexed_package_id", "in", packageIds)
		.execute()
}
