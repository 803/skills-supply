import { confirm, isCancel, select, text } from "@clack/prompts"
import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveLocalManifest,
} from "@/src/commands/manifest-selection"
import type { AddOptions } from "@/src/commands/pkg/spec"
import { buildPackageSpec, normalizeAddOptions } from "@/src/commands/pkg/spec"
import { coerceDependency } from "@/src/core/manifest/coerce"
import { saveManifest } from "@/src/core/manifest/fs"
import {
	addDependency,
	hasDependency,
	removeDependency,
} from "@/src/core/manifest/transform"
import type { Alias } from "@/src/core/types/branded"
import { coerceAlias } from "@/src/core/types/coerce"
import { formatError } from "@/src/utils/errors"

export async function pkgInteractive(): Promise<void> {
	consola.info("sk pkg")

	try {
		const action = await select({
			message: "What do you want to do?",
			options: [
				{ label: "Add a package", value: "add" },
				{ label: "Remove a package", value: "remove" },
				{ label: "Exit", value: "exit" },
			],
		})

		if (isCancel(action) || action === "exit") {
			consola.info("Canceled.")
			return
		}

		if (action === "add") {
			await handleAdd()
			consola.success("Done.")
			return
		}

		await handleRemove()
		consola.success("Done.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Package update failed.")
	}
}

async function handleAdd(): Promise<void> {
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
		throw new Error("Canceled.")
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
		throw new Error("Canceled.")
	}

	const alias = await text({
		message: "Alias (optional)",
		placeholder: "leave blank to derive",
	})

	if (isCancel(alias)) {
		throw new Error("Canceled.")
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
			throw new Error("Canceled.")
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
			throw new Error("Canceled.")
		}

		if (refType !== "default") {
			const refValue = await text({
				message: `Ref value (${refType})`,
			})
			if (isCancel(refValue)) {
				throw new Error("Canceled.")
			}
			if (!refValue.trim()) {
				throw new Error("Ref value cannot be empty.")
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

	const selection = await resolveLocalManifest({
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
	if (selection.usedParent) {
		consola.warn(
			`Skills will install under ${selection.scopeRoot}. Run agents from that directory to use them.`,
		)
	}
	const pkgSpec = buildPackageSpec(type as string, spec, normalizeAddOptions(options))

	const aliasKey = coerceAlias(pkgSpec.alias)
	if (!aliasKey) {
		throw new Error(`Invalid alias: ${pkgSpec.alias}`)
	}

	if (hasDependency(selection.manifest, aliasKey)) {
		const overwrite = await confirm({
			message: `Dependency ${pkgSpec.alias} already exists. Overwrite it?`,
		})
		if (isCancel(overwrite) || !overwrite) {
			consola.info("No changes made.")
			return
		}
	}

	// Coerce the declaration to a validated dependency
	const coerced = coerceDependency(
		pkgSpec.declaration,
		pkgSpec.alias,
		selection.manifestPath,
	)
	if (!coerced.ok) {
		throw new Error(coerced.error.message)
	}

	const updated = addDependency(selection.manifest, aliasKey, coerced.value)
	await saveManifest(updated, selection.manifestPath, selection.serializeOptions)
	consola.success(`Updated ${selection.manifestPath}.`)
}

async function handleRemove(): Promise<void> {
	const selection = await resolveLocalManifest({
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
	if (selection.usedParent) {
		consola.warn(
			`Skills will install under ${selection.scopeRoot}. Run agents from that directory to use them.`,
		)
	}
	const aliases = [...selection.manifest.dependencies.keys()].sort()
	if (aliases.length === 0) {
		consola.info("No dependencies to remove.")
		return
	}

	const choice = await select({
		message: "Select a dependency to remove",
		options: aliases.map((alias) => ({
			label: String(alias),
			value: alias as Alias,
		})),
	})

	if (isCancel(choice)) {
		throw new Error("Canceled.")
	}

	const updated = removeDependency(selection.manifest, choice as Alias)
	await saveManifest(updated, selection.manifestPath, selection.serializeOptions)
	consola.success(`Removed dependency: ${String(choice)}.`)
}
