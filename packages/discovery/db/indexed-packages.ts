import type { Database } from "@skills-supply/database"
import type { Insertable, Kysely, Selectable } from "kysely"

export type IndexedPackageRow = Selectable<Database["indexed_packages"]>
export type IndexedPackageId = IndexedPackageRow["id"]

export type IndexedPackageInsert = Omit<
	Insertable<Database["indexed_packages"]>,
	"id" | "discovered_at" | "updated_at" | "github_repo"
>

export function coerceIndexedPackageId(value: number): IndexedPackageId | null {
	if (!Number.isInteger(value) || value <= 0) {
		return null
	}

	return value as IndexedPackageId
}

export async function upsertRepoPackages(
	db: Kysely<Database>,
	githubRepo: string,
	packages: IndexedPackageInsert[],
): Promise<void> {
	await db.transaction().execute(async (trx) => {
		await trx
			.deleteFrom("indexed_packages")
			.where("github_repo", "=", githubRepo)
			.execute()

		if (packages.length === 0) {
			return
		}

		await trx
			.insertInto("indexed_packages")
			.values(
				packages.map((pkg) => ({
					...pkg,
					github_repo: githubRepo,
				})),
			)
			.execute()
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
		.select("github_repo")
		.distinct()
		.execute()

	return rows.map((row) => row.github_repo)
}
