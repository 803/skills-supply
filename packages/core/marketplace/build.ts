import type {
	AbsolutePath,
	GithubRef,
	GitUrl,
	NonEmptyString,
	RemoteMarketplaceUrl,
} from "@/types/branded"
import type { ValidatedDeclaration } from "@/types/declaration"

export function buildClaudePluginDeclaration(
	marketplace: GithubRef | GitUrl | AbsolutePath | RemoteMarketplaceUrl,
	plugin: NonEmptyString,
): ValidatedDeclaration {
	return {
		marketplace,
		plugin,
		type: "claude-plugin",
	}
}
