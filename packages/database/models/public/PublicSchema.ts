import type { ColumnType, Generated } from "kysely"

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>

type CliAuthStatus = "pending" | "authenticated" | "consumed" | "expired"

type PurchaseStatus = "paid" | "refunded" | "canceled"

export interface UsersTable {
	id: Generated<string>
	email: string
	username: string
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

export interface PluginsTable {
	id: Generated<string>
	creator_username: string
	slug: string
	name: string
	description: string
	preview_markdown: Nullable<string>
	source_repo_url: string
	source_ref: string
	is_active: Generated<boolean>
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

export interface ApiTokensTable {
	id: Generated<string>
	user_id: string
	token_hash: string
	token_prefix: string
	created_at: Generated<Date>
	revoked_at: Nullable<Date>
}

export interface CliAuthSessionsTable {
	id: Generated<string>
	device_code: string
	user_code: string
	status: CliAuthStatus
	user_id: Nullable<string>
	created_at: Generated<Date>
	authenticated_at: Nullable<Date>
	consumed_at: Nullable<Date>
	expires_at: Date
	ip_address: Nullable<string>
	user_agent: Nullable<string>
}

export interface PurchasesTable {
	id: Generated<string>
	user_id: string
	plugin_id: string
	status: PurchaseStatus
	stripe_payment_intent_id: Nullable<string>
	purchased_at: Generated<Date>
}

export interface RepoStateTable {
	id: Generated<string>
	user_id: string
	repo_name: string
	last_commit_sha: string
	content_hash: string
	repo_path: string
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

export default interface PublicSchema {
	users: UsersTable
	plugins: PluginsTable
	api_tokens: ApiTokensTable
	cli_auth_sessions: CliAuthSessionsTable
	purchases: PurchasesTable
	repo_state: RepoStateTable
}
