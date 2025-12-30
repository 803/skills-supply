import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type {
	ManifestDiscoveryError,
	ManifestDiscoveryResult,
} from "@/core/manifest/types"

const MANIFEST_FILENAME = "package.toml"
const USER_MANIFEST_DIR = ".sksup"

type FileExistsResult =
	| { ok: true; value: boolean }
	| { ok: false; error: ManifestDiscoveryError }

type StatResult =
	| { ok: true; value: Awaited<ReturnType<typeof stat>> }
	| { ok: false; error: ManifestDiscoveryError }

export async function discoverManifests(
	startDir: string,
): Promise<ManifestDiscoveryResult> {
	const absoluteStart = path.resolve(startDir)
	const startStat = await safeStat(absoluteStart)
	if (!startStat.ok) {
		return startStat
	}

	if (!startStat.value.isDirectory()) {
		return failure(
			"invalid_start",
			"Manifest discovery start path must be a directory.",
			absoluteStart,
		)
	}

	const homeDir = path.resolve(homedir())
	const rootDir = path.parse(absoluteStart).root
	const stopDir = isWithinHome(absoluteStart, homeDir) ? homeDir : rootDir
	const discovered: string[] = []
	const seen = new Set<string>()

	let current = absoluteStart
	while (true) {
		const manifestPath = path.join(current, MANIFEST_FILENAME)
		const existsResult = await fileExists(manifestPath)
		if (!existsResult.ok) {
			return existsResult
		}

		if (existsResult.value && !seen.has(manifestPath)) {
			seen.add(manifestPath)
			discovered.push(manifestPath)
		}

		if (current === stopDir) {
			break
		}

		const parent = path.dirname(current)
		if (parent === current) {
			break
		}

		current = parent
	}

	const userManifestPath = path.join(homeDir, USER_MANIFEST_DIR, MANIFEST_FILENAME)
	const userExistsResult = await fileExists(userManifestPath)
	if (!userExistsResult.ok) {
		return userExistsResult
	}

	if (userExistsResult.value && !seen.has(userManifestPath)) {
		discovered.push(userManifestPath)
	}

	return { ok: true, value: discovered }
}

function isWithinHome(candidate: string, homeDir: string): boolean {
	if (candidate === homeDir) {
		return true
	}

	const relative = path.relative(homeDir, candidate)
	return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function fileExists(filePath: string): Promise<FileExistsResult> {
	try {
		const stats = await stat(filePath)
		if (!stats.isFile()) {
			return failure(
				"io_error",
				`Manifest path is not a file: ${filePath}`,
				filePath,
			)
		}

		return { ok: true, value: true }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: false }
		}

		return failure("io_error", `Unable to access ${filePath}.`, filePath)
	}
}

async function safeStat(targetPath: string): Promise<StatResult> {
	try {
		const stats = await stat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return failure("invalid_start", "Start path does not exist.", targetPath)
		}

		return failure("io_error", `Unable to access ${targetPath}.`, targetPath)
	}
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}

function failure(
	type: ManifestDiscoveryError["type"],
	message: string,
	pathValue: string,
): { ok: false; error: ManifestDiscoveryError } {
	return {
		error: {
			message,
			path: pathValue,
			type,
		},
		ok: false,
	}
}
