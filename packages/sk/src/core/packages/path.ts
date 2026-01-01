import path from "node:path"

export type SparsePathNormalization =
	| { ok: true; value?: string }
	| { ok: false; reason: "empty" | "absolute" | "traversal" }

/**
 * Normalize a sparse checkout path.
 * Pure function - returns reason codes, callers wrap with context-specific errors.
 */
export function normalizeSparsePathCore(
	value: string | undefined,
): SparsePathNormalization {
	if (value === undefined) {
		return { ok: true, value: undefined }
	}

	const trimmed = value.trim()
	if (!trimmed) {
		return { ok: false, reason: "empty" }
	}

	const cleaned = trimmed.replace(/\\/g, "/")
	if (cleaned.startsWith("/")) {
		return { ok: false, reason: "absolute" }
	}

	const segments = cleaned.split("/")
	if (segments.some((segment) => segment === "..")) {
		return { ok: false, reason: "traversal" }
	}

	const normalized = path.posix.normalize(cleaned).replace(/^\.\/+/, "")
	if (!normalized || normalized === ".") {
		return { ok: true, value: undefined }
	}

	return { ok: true, value: normalized }
}

/**
 * Get error message for sparse path normalization failure.
 */
export function sparsePathErrorMessage(
	reason: "empty" | "absolute" | "traversal",
): string {
	switch (reason) {
		case "empty":
			return "Package path must not be empty."
		case "absolute":
			return "Package path must be relative."
		case "traversal":
			return "Package path must not escape the repository."
	}
}
