import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("indexed_packages")
		.ifNotExists()
		.addColumn("id", "serial", (col) => col.primaryKey())
		.addColumn("github_repo", "text", (col) => col.notNull())
		.addColumn("declaration", "text", (col) => col.notNull())
		.addColumn("path", "text")
		.addColumn("name", "text", (col) => col.notNull())
		.addColumn("description", "text")
		.addColumn("gh_owner", "text", (col) => col.notNull())
		.addColumn("gh_stars", "integer", (col) => col.notNull())
		.addColumn("gh_description", "text")
		.addColumn("gh_topics", sql`text[]`, (col) => col.notNull())
		.addColumn("gh_license", "text")
		.addColumn("gh_language", "text")
		.addColumn("gh_updated_at", "timestamptz", (col) => col.notNull())
		.addColumn("discovered_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addColumn("updated_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.execute()

	await db.schema
		.createIndex("indexed_packages_github_repo_idx")
		.ifNotExists()
		.on("indexed_packages")
		.column("github_repo")
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("indexed_packages").ifExists().execute()
}
