/**
 * Branded types used across core.
 */

declare const NonEmptyStringBrand: unique symbol
declare const AliasBrand: unique symbol
declare const AbsolutePathBrand: unique symbol
declare const GitUrlBrand: unique symbol
declare const GithubRefBrand: unique symbol
declare const RemoteMarketplaceUrlBrand: unique symbol

type Brand<T, B extends symbol> = T & { readonly [K in B]: true }

export type NonEmptyString = Brand<string, typeof NonEmptyStringBrand>
export type Alias = Brand<string, typeof AliasBrand>
export type AbsolutePath = Brand<string, typeof AbsolutePathBrand>
export type GitUrl = Brand<string, typeof GitUrlBrand>
export type GithubRef = Brand<string, typeof GithubRefBrand>
export type RemoteMarketplaceUrl = Brand<string, typeof RemoteMarketplaceUrlBrand>

export type AgentId = "claude-code" | "codex" | "opencode" | "factory"

export function unwrap<T extends string>(branded: T): string {
	return branded
}
