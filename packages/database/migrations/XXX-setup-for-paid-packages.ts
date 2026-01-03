// import { type Kysely, sql } from "kysely"

// export async function up(db: Kysely<unknown>): Promise<void> {
// 	await sql`create extension if not exists "pgcrypto"`.execute(db)

// 	await db.schema
// 		.createTable("users")
// 		.ifNotExists()
// 		.addColumn("id", "uuid", (col) =>
// 			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
// 		)
// 		.addColumn("email", "text", (col) => col.notNull().unique())
// 		.addColumn("username", "text", (col) => col.notNull().unique())
// 		.addColumn("created_at", "timestamptz", (col) =>
// 			col.notNull().defaultTo(sql`now()`),
// 		)
// 		.addColumn("updated_at", "timestamptz", (col) =>
// 			col.notNull().defaultTo(sql`now()`),
// 		)
// 		.execute()

// 	await db.schema
// 		.createTable("plugins")
// 		.ifNotExists()
// 		.addColumn("id", "uuid", (col) =>
// 			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
// 		)
// 		.addColumn("creator_username", "text", (col) => col.notNull())
// 		.addColumn("slug", "text", (col) => col.notNull().unique())
// 		.addColumn("name", "text", (col) => col.notNull())
// 		.addColumn("description", "text", (col) => col.notNull())
// 		.addColumn("preview_markdown", "text")
// 		.addColumn("source_repo_url", "text", (col) => col.notNull())
// 		.addColumn("source_ref", "text", (col) => col.notNull())
// 		.addColumn("is_active", "boolean", (col) => col.notNull().defaultTo(true))
// 		.addColumn("created_at", "timestamptz", (col) =>
// 			col.notNull().defaultTo(sql`now()`),
// 		)
// 		.addColumn("updated_at", "timestamptz", (col) =>
// 			col.notNull().defaultTo(sql`now()`),
// 		)
// 		.execute()

// 	await db.schema
// 		.createTable("api_tokens")
// 		.ifNotExists()
// 		.addColumn("id", "uuid", (col) =>
// 			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
// 		)
// 		.addColumn("user_id", "uuid", (col) =>
// 			col.notNull().references("users.id").onDelete("cascade"),
// 		)
// 		.addColumn("token_hash", "text", (col) => col.notNull().unique())
// 		.addColumn("token_prefix", "text", (col) => col.notNull())
// 		.addColumn("created_at", "timestamptz", (col) =>
// 			col.notNull().defaultTo(sql`now()`),
// 		)
// 		.addColumn("revoked_at", "timestamptz")
// 		.execute()

// 	await db.schema
// 		.createTable("cli_auth_sessions")
// 		.ifNotExists()
// 		.addColumn("id", "uuid", (col) =>
// 			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
// 		)
// 		.addColumn("device_code", "text", (col) => col.notNull().unique())
// 		.addColumn("user_code", "text", (col) => col.notNull().unique())
// 		.addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
// 		.addColumn("user_id", "uuid", (col) =>
// 			col.references("users.id").onDelete("set null"),
// 		)
// 		.addColumn("created_at", "timestamptz", (col) =>
// 			col.notNull().defaultTo(sql`now()`),
// 		)
// 		.addColumn("authenticated_at", "timestamptz")
// 		.addColumn("consumed_at", "timestamptz")
// 		.addColumn("expires_at", "timestamptz", (col) => col.notNull())
// 		.addColumn("ip_address", sql`inet`)
// 		.addColumn("user_agent", "text")
// 		.execute()

// 	await db.schema
// 		.createTable("purchases")
// 		.ifNotExists()
// 		.addColumn("id", "uuid", (col) =>
// 			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
// 		)
// 		.addColumn("user_id", "uuid", (col) =>
// 			col.notNull().references("users.id").onDelete("cascade"),
// 		)
// 		.addColumn("plugin_id", "uuid", (col) =>
// 			col.notNull().references("plugins.id").onDelete("cascade"),
// 		)
// 		.addColumn("status", "text", (col) => col.notNull().defaultTo("paid"))
// 		.addColumn("stripe_payment_intent_id", "text")
// 		.addColumn("purchased_at", "timestamptz", (col) =>
// 			col.notNull().defaultTo(sql`now()`),
// 		)
// 		.addUniqueConstraint("purchases_user_plugin_unique", ["user_id", "plugin_id"])
// 		.execute()

// 	await db.schema
// 		.createTable("repo_state")
// 		.ifNotExists()
// 		.addColumn("id", "uuid", (col) =>
// 			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
// 		)
// 		.addColumn("user_id", "uuid", (col) =>
// 			col.notNull().references("users.id").onDelete("cascade"),
// 		)
// 		.addColumn("repo_name", "text", (col) => col.notNull())
// 		.addColumn("last_commit_sha", "text", (col) => col.notNull())
// 		.addColumn("content_hash", "text", (col) => col.notNull())
// 		.addColumn("repo_path", "text", (col) => col.notNull())
// 		.addColumn("created_at", "timestamptz", (col) =>
// 			col.notNull().defaultTo(sql`now()`),
// 		)
// 		.addColumn("updated_at", "timestamptz", (col) =>
// 			col.notNull().defaultTo(sql`now()`),
// 		)
// 		.addUniqueConstraint("repo_state_user_repo_unique", ["user_id", "repo_name"])
// 		.execute()
// }

// export async function down(db: Kysely<unknown>): Promise<void> {
// 	await db.schema.dropTable("repo_state").ifExists().execute()
// 	await db.schema.dropTable("purchases").ifExists().execute()
// 	await db.schema.dropTable("cli_auth_sessions").ifExists().execute()
// 	await db.schema.dropTable("api_tokens").ifExists().execute()
// 	await db.schema.dropTable("plugins").ifExists().execute()
// 	await db.schema.dropTable("users").ifExists().execute()
// }
