import type { Kysely } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("indexed_package_skills")
		.ifNotExists()
		.addColumn("id", "serial", (col) => col.primaryKey())
		.addColumn("indexed_package_id", "integer", (col) =>
			col.notNull().references("indexed_packages.id").onDelete("cascade"),
		)
		.addColumn("name", "text", (col) => col.notNull())
		.addColumn("description", "text")
		.addColumn("relative_path", "text", (col) => col.notNull())
		.execute()

	await db.schema
		.createIndex("indexed_package_skills_package_idx")
		.ifNotExists()
		.on("indexed_package_skills")
		.column("indexed_package_id")
		.execute()

	await db.schema
		.createIndex("indexed_package_skills_package_name_idx")
		.ifNotExists()
		.on("indexed_package_skills")
		.columns(["indexed_package_id", "name"])
		.unique()
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("indexed_package_skills").ifExists().execute()
}
