import type { Kysely } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("indexed_packages")
		.alterColumn("name", (col) => col.dropNotNull())
		.execute()

	await db.schema
		.alterTable("indexed_packages")
		.renameColumn("github_repo", "gh_repo")
		.execute()

	await db.schema.dropIndex("indexed_packages_github_repo_idx").ifExists().execute()

	await db.schema
		.createIndex("indexed_packages_gh_repo_idx")
		.ifNotExists()
		.on("indexed_packages")
		.column("gh_repo")
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropIndex("indexed_packages_gh_repo_idx").ifExists().execute()

	await db.schema
		.createIndex("indexed_packages_github_repo_idx")
		.ifNotExists()
		.on("indexed_packages")
		.column("github_repo")
		.execute()

	await db.schema
		.alterTable("indexed_packages")
		.renameColumn("gh_repo", "github_repo")
		.execute()

	await db.schema
		.alterTable("indexed_packages")
		.alterColumn("name", (col) => col.setNotNull())
		.execute()
}
