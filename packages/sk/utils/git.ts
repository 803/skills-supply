import { execSync } from "node:child_process"
import type { Result } from "@skills-supply/core"
import type { ValidationError } from "@/types/errors"

export function ensureGitAvailable(): Result<void, ValidationError> {
	try {
		execSync("git --version", { stdio: "ignore" })
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				field: "git",
				message: "git is not installed or not in PATH.",
				rawError: error instanceof Error ? error : undefined,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
}
