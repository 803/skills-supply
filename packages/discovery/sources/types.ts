import type { Result } from "@skills-supply/core"
import type { DiscoveryError } from "@/types/errors"

export type ControlFlow = "continue" | "stop"

export type OnGithubRepoUrls = (urls: string[]) => Promise<ControlFlow>

export interface DiscoverySource {
	discover(onGithubRepoUrls: OnGithubRepoUrls): Promise<Result<void, DiscoveryError>>
}
