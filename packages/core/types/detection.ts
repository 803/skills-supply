import type { AbsolutePath } from "@/types/branded"
import type { ValidatedDeclaration } from "@/types/declaration"

export type DetectedStructure =
	| { method: "manifest"; manifestPath: AbsolutePath }
	| {
			method: "plugin"
			pluginJsonPath: AbsolutePath
			skillsDir: AbsolutePath | null
	  }
	| { method: "marketplace"; marketplaceJsonPath: AbsolutePath }
	| { method: "subdir"; rootDir: AbsolutePath }
	| { method: "single"; skillPath: AbsolutePath }

export type DetectionTarget = {
	packagePath: AbsolutePath
	declaration: ValidatedDeclaration
}
