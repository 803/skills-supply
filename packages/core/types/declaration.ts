import type {
	AbsolutePath,
	GithubRef,
	GitUrl,
	NonEmptyString,
	RemoteMarketplaceUrl,
} from "@/types/branded"

export type RawDeclaration =
	| string
	| { gh: string; tag?: string; branch?: string; rev?: string; path?: string }
	| { git: string; tag?: string; branch?: string; rev?: string; path?: string }
	| { registry: string; version?: string }
	| { path: string }
	| { type: "claude-plugin"; plugin: string; marketplace: string }

export type GitRef =
	| { type: "tag"; value: NonEmptyString }
	| { type: "branch"; value: NonEmptyString }
	| { type: "rev"; value: NonEmptyString }

export type ValidatedDeclaration =
	| { type: "github"; gh: GithubRef; ref?: GitRef; path?: NonEmptyString }
	| { type: "git"; url: GitUrl; ref?: GitRef; path?: NonEmptyString }
	| {
			type: "registry"
			name: NonEmptyString
			org?: NonEmptyString
			version: NonEmptyString
	  }
	| { type: "local"; path: AbsolutePath }
	| {
			type: "claude-plugin"
			plugin: NonEmptyString
			marketplace: GithubRef | GitUrl | AbsolutePath | RemoteMarketplaceUrl
	  }
