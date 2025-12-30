import { confirm, intro, isCancel, log, outro, select, text } from "@clack/prompts"
import {
	isManifestNotFoundError,
	loadManifestFromCwd,
	saveManifest,
} from "@/commands/manifest"
import type { AddOptions } from "@/commands/pkg/spec"
import { buildPackageSpec } from "@/commands/pkg/spec"
import { formatError } from "@/utils/errors"

export async function pkgInteractive(): Promise<void> {
	intro("sksup pkg")

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
			outro("Canceled.")
			return
		}

		if (action === "add") {
			await handleAdd()
			outro("Done.")
			return
		}

		await handleRemove()
		outro("Done.")
	} catch (error) {
		process.exitCode = 1
		log.error(formatError(error))
		outro("Package update failed.")
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
	const pkgSpec = buildPackageSpec(type, spec, options)
	if (pkgSpec.alias in manifestResult.manifest.packages) {
		const overwrite = await confirm({
			message: `Package ${pkgSpec.alias} already exists. Overwrite it?`,
		})
		if (isCancel(overwrite) || !overwrite) {
			log.info("No changes made.")
			return
		}
	}
	manifestResult.manifest.packages[pkgSpec.alias] = pkgSpec.declaration
	await saveManifest(manifestResult.manifest, manifestResult.manifestPath)
	log.success(`Updated ${manifestResult.manifestPath}.`)
}

async function handleRemove(): Promise<void> {
	const manifestResult = await loadManifestFromCwd({ createIfMissing: false })
	const aliases = Object.keys(manifestResult.manifest.packages).sort()
	if (aliases.length === 0) {
		log.info("No packages to remove.")
		return
	}

	const choice = await select({
		message: "Select a package to remove",
		options: aliases.map((alias) => ({ label: alias, value: alias })),
	})

	if (isCancel(choice)) {
		throw new Error("Canceled.")
	}

	delete manifestResult.manifest.packages[choice]
	await saveManifest(manifestResult.manifest, manifestResult.manifestPath)
	log.success(`Removed package: ${choice}.`)
}

async function loadManifestForUpdate() {
	try {
		return await loadManifestFromCwd({ createIfMissing: false })
	} catch (error) {
		if (!isManifestNotFoundError(error)) {
			throw error
		}

		const shouldCreate = await confirm({
			message: "skills.toml not found. Create it?",
		})
		if (isCancel(shouldCreate) || !shouldCreate) {
			throw new Error("Canceled.")
		}

		return await loadManifestFromCwd({ createIfMissing: true })
	}
}
