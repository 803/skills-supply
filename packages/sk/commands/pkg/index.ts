import path from "node:path"
import { confirm, isCancel, select, text } from "@clack/prompts"
import type { AbsolutePath, Alias } from "@skills-supply/core"
import { coerceAbsolutePath, coerceAlias, validateDeclaration } from "@skills-supply/core"
import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveLocalManifest,
} from "@/commands/manifest-selection"
import type { AddOptions } from "@/commands/pkg/spec"
import { buildPackageSpec, normalizeAddOptions } from "@/commands/pkg/spec"
import { syncWithSelection } from "@/commands/sync"
import { CommandResult, printOutcome } from "@/commands/types"
import { saveManifest } from "@/manifest/fs"
import { addDependency, hasDependency, removeDependency } from "@/manifest/transform"
import type { DependencyDraft } from "@/manifest/types"

export async function pkgInteractive(): Promise<void> {
	consola.info("sk pkg")

	const action = await select({
		message: "What do you want to do?",
		options: [
			{ label: "Add a package", value: "add" },
			{ label: "Remove a package", value: "remove" },
			{ label: "Exit", value: "exit" },
		],
	})

	if (isCancel(action) || action === "exit") {
		printOutcome(CommandResult.cancelled())
		return
	}

	if (action === "add") {
		const result = await handleAdd()
		printOutcome(result)
		return
	}

	const result = await handleRemove()
	printOutcome(result)
}

async function handleAdd(): Promise<CommandResult<void>> {
	const type = await select({
		message: "Package type",
		options: [
			{ label: "GitHub (owner/repo)", value: "gh" },
			{ label: "Git URL", value: "git" },
			{ label: "Local path", value: "path" },
			{ label: "Registry (name@version)", value: "registry" },
		],
	})

	if (isCancel(type)) {
		return CommandResult.cancelled()
	}

	const spec = await text({
		message: "Package spec",
		placeholder:
			type === "gh"
				? "owner/repo"
				: type === "git"
					? "https://example.com/repo.git"
					: type === "path"
						? "./relative/path"
						: "@org/name@1.2.3",
	})

	if (isCancel(spec)) {
		return CommandResult.cancelled()
	}
	if (!spec.trim()) {
		const message = "Package spec cannot be empty."
		return CommandResult.failed({
			field: "spec",
			message,
			source: "manual",
			type: "validation",
		})
	}

	const alias = await text({
		message: "Alias (optional)",
		placeholder: "leave blank to derive",
	})

	if (isCancel(alias)) {
		return CommandResult.cancelled()
	}

	const options: AddOptions = {}
	if (alias.trim()) {
		options.as = alias
	}

	if (type === "gh" || type === "git") {
		const subPath = await text({
			message: "Repo subpath (optional)",
			placeholder: "leave blank to use repo root",
		})
		if (isCancel(subPath)) {
			return CommandResult.cancelled()
		}
		if (subPath.trim()) {
			options.path = subPath
		}

		const refType = await select({
			message: "Ref (optional)",
			options: [
				{ label: "Default branch", value: "default" },
				{ label: "Tag", value: "tag" },
				{ label: "Branch", value: "branch" },
				{ label: "Commit SHA", value: "rev" },
			],
		})
		if (isCancel(refType)) {
			return CommandResult.cancelled()
		}

		if (refType !== "default") {
			const refValue = await text({
				message: `Ref value (${refType})`,
			})
			if (isCancel(refValue)) {
				return CommandResult.cancelled()
			}
			if (!refValue.trim()) {
				const message = "Ref value cannot be empty."
				return CommandResult.failed({
					field: "ref",
					message,
					source: "manual",
					type: "validation",
				})
			}
			if (refType === "tag") {
				options.tag = refValue
			} else if (refType === "branch") {
				options.branch = refValue
			} else {
				options.rev = refValue
			}
		}
	}

	const selectionResult = await resolveLocalManifest({
		createIfMissing: false,
		nonInteractive: false,
		parentPrompt: {
			buildMessage: (projectRoot, cwd) =>
				buildParentPromptMessage(projectRoot, cwd, {
					action: "modify",
					warnAboutSkillVisibility: true,
				}),
		},
		promptToCreate: true,
	})
	if (selectionResult.status !== "completed") {
		return selectionResult
	}
	const selection = selectionResult.value
	if (selection.usedParent) {
		consola.warn(
			`Skills will install under ${selection.scopeRoot}. Run agents from that directory to use them.`,
		)
	}
	const normalizedOptions = normalizeAddOptions(options)
	if (!normalizedOptions.ok) {
		return CommandResult.failed(normalizedOptions.error)
	}
	const pkgSpecResult = buildPackageSpec(type as string, spec, normalizedOptions.value)
	if (!pkgSpecResult.ok) {
		return CommandResult.failed(pkgSpecResult.error)
	}
	const pkgSpec = pkgSpecResult.value

	const aliasKey = coerceAlias(pkgSpec.alias)
	if (!aliasKey) {
		const message = `Invalid alias: ${pkgSpec.alias}`
		return CommandResult.failed({
			field: "alias",
			message,
			source: "manual",
			type: "validation",
		})
	}

	if (hasDependency(selection.manifest, aliasKey)) {
		const overwrite = await confirm({
			message: `Dependency ${pkgSpec.alias} already exists. Overwrite it?`,
		})
		if (isCancel(overwrite) || !overwrite) {
			return CommandResult.cancelled()
		}
	}

	const resolvedDeclaration = resolveDeclarationPath(
		pkgSpec.declaration,
		selection.manifestPath,
	)
	if (resolvedDeclaration.status !== "completed") {
		return resolvedDeclaration
	}
	const validated = validateDeclaration(resolvedDeclaration.value)
	if (!validated.ok) {
		return CommandResult.failed(validated.error)
	}

	const updated = addDependency(selection.manifest, aliasKey, validated.value)
	const saved = await saveManifest(
		updated,
		selection.manifestPath,
		selection.serializeOptions,
	)
	if (!saved.ok) {
		return CommandResult.failed(saved.error)
	}
	consola.success(`Updated ${selection.manifestPath}.`)

	const shouldSync = await confirm({
		message: "Sync skills now?",
	})
	if (isCancel(shouldSync) || !shouldSync) {
		return CommandResult.completed(undefined)
	}

	const syncResult = await syncWithSelection(
		{ ...selection, manifest: updated },
		{ dryRun: false, nonInteractive: false },
	)
	if (syncResult.status === "failed") {
		return syncResult
	}
	if (syncResult.status === "cancelled") {
		consola.info("Sync skipped.")
	} else if (syncResult.status === "unchanged") {
		consola.info(syncResult.reason)
	}
	return CommandResult.completed(undefined)
}

function resolveDeclarationPath(
	declaration: DependencyDraft["declaration"],
	manifestPath: AbsolutePath,
): CommandResult<DependencyDraft["declaration"]> {
	if (
		typeof declaration === "object" &&
		declaration !== null &&
		"path" in declaration &&
		!("gh" in declaration) &&
		!("git" in declaration) &&
		!("type" in declaration)
	) {
		const resolved = coerceAbsolutePath(
			String(declaration.path),
			path.dirname(manifestPath),
		)
		if (!resolved) {
			const message = `Invalid local path: ${String(declaration.path)}`
			return CommandResult.failed({
				field: "path",
				message,
				source: "manual",
				type: "validation",
			})
		}
		return CommandResult.completed({ path: resolved })
	}

	return CommandResult.completed(declaration)
}

async function handleRemove(): Promise<CommandResult<void>> {
	const selectionResult = await resolveLocalManifest({
		createIfMissing: false,
		nonInteractive: false,
		parentPrompt: {
			buildMessage: (projectRoot, cwd) =>
				buildParentPromptMessage(projectRoot, cwd, {
					action: "modify",
					warnAboutSkillVisibility: true,
				}),
		},
		promptToCreate: false,
	})
	if (selectionResult.status !== "completed") {
		return selectionResult
	}
	const selection = selectionResult.value
	if (selection.usedParent) {
		consola.warn(
			`Skills will install under ${selection.scopeRoot}. Run agents from that directory to use them.`,
		)
	}
	const aliases = [...selection.manifest.dependencies.keys()].sort()
	if (aliases.length === 0) {
		return CommandResult.unchanged("No dependencies to remove.")
	}

	const choice = await select({
		message: "Select a dependency to remove",
		options: aliases.map((alias) => ({
			label: String(alias),
			value: alias as Alias,
		})),
	})

	if (isCancel(choice)) {
		return CommandResult.cancelled()
	}

	const updated = removeDependency(selection.manifest, choice as Alias)
	const saved = await saveManifest(
		updated,
		selection.manifestPath,
		selection.serializeOptions,
	)
	if (!saved.ok) {
		return CommandResult.failed(saved.error)
	}
	consola.success(`Removed dependency: ${String(choice)}.`)

	const shouldSync = await confirm({
		message: "Sync skills now?",
	})
	if (isCancel(shouldSync) || !shouldSync) {
		return CommandResult.completed(undefined)
	}

	const syncResult = await syncWithSelection(
		{ ...selection, manifest: updated },
		{ dryRun: false, nonInteractive: false },
	)
	if (syncResult.status === "failed") {
		return syncResult
	}
	if (syncResult.status === "cancelled") {
		consola.info("Sync skipped.")
	} else if (syncResult.status === "unchanged") {
		consola.info(syncResult.reason)
	}
	return CommandResult.completed(undefined)
}
