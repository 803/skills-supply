import { confirm, isCancel, select, text } from "@clack/prompts"
import { consola } from "consola"
import { loadManifestForUpdate } from "@/src/commands/manifest-prompt"
import type { AddOptions } from "@/src/commands/pkg/spec"
import { buildPackageSpec } from "@/src/commands/pkg/spec"
import { coerceDependency } from "@/src/core/manifest/coerce"
import { loadManifestFromCwd, saveManifest } from "@/src/core/manifest/fs"
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

	const manifestResult = await loadManifestForUpdate()
	const pkgSpec = buildPackageSpec(type as string, spec, options)

	const aliasKey = coerceAlias(pkgSpec.alias)
	if (!aliasKey) {
		throw new Error(`Invalid alias: ${pkgSpec.alias}`)
	}

	if (hasDependency(manifestResult.manifest, aliasKey)) {
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
		manifestResult.manifestPath,
	)
	if (!coerced.ok) {
		throw new Error(coerced.error.message)
	}

	const updated = addDependency(manifestResult.manifest, aliasKey, coerced.value)
	await saveManifest(updated, manifestResult.manifestPath)
	consola.success(`Updated ${manifestResult.manifestPath}.`)
}

async function handleRemove(): Promise<void> {
	const manifestResult = await loadManifestFromCwd({ createIfMissing: false })
	const aliases = [...manifestResult.manifest.dependencies.keys()].sort()
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

	const updated = removeDependency(manifestResult.manifest, choice as Alias)
	await saveManifest(updated, manifestResult.manifestPath)
	consola.success(`Removed dependency: ${String(choice)}.`)
}
