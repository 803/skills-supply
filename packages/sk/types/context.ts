import type { AbsolutePath, Alias } from "@skills-supply/core"

export type ManifestDiscoveredAt = "cwd" | "parent" | "home" | "sk-global"

export type ManifestOrigin = {
	sourcePath: AbsolutePath
	discoveredAt: ManifestDiscoveredAt
}

export type PackageOrigin = {
	alias: Alias
	manifestPath: AbsolutePath
}

export type FetchStrategy = { mode: "clone"; sparse: boolean } | { mode: "symlink" }
