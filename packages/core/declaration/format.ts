import type { GitRef, ValidatedDeclaration } from "@/types/declaration"

function formatRef(ref?: GitRef): string[] {
	if (!ref) {
		return []
	}

	switch (ref.type) {
		case "tag":
			return ["--tag", ref.value]
		case "branch":
			return ["--branch", ref.value]
		case "rev":
			return ["--rev", ref.value]
		default: {
			const exhaustive: never = ref
			return exhaustive
		}
	}
}

function formatPath(pathValue?: string): string[] {
	if (!pathValue) {
		return []
	}

	return ["--path", pathValue]
}

function withArgs(base: string, args: string[]): string {
	if (args.length === 0) {
		return base
	}

	return `${base} ${args.join(" ")}`
}

export function formatSkPackageAddCommand(declaration: ValidatedDeclaration): string {
	switch (declaration.type) {
		case "registry": {
			const name = declaration.org
				? `@${declaration.org}/${declaration.name}`
				: declaration.name
			return `sk pkg add registry ${name}@${declaration.version}`
		}
		case "github": {
			const args = [...formatRef(declaration.ref), ...formatPath(declaration.path)]
			return withArgs(`sk pkg add github ${declaration.gh}`, args)
		}
		case "git": {
			const args = [...formatRef(declaration.ref), ...formatPath(declaration.path)]
			return withArgs(`sk pkg add git ${declaration.url}`, args)
		}
		case "local":
			return `sk pkg add local ${declaration.path}`
		case "claude-plugin":
			return `sk pkg add claude-plugin ${declaration.plugin}@${declaration.marketplace}`
		default: {
			const exhaustive: never = declaration
			return exhaustive
		}
	}
}
