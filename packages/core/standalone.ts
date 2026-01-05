type ParsedDeclaration =
	| {
			type: "registry"
			name: string
			org?: string
			version: string
	  }
	| {
			type: "github"
			gh: string
			ref?: ParsedRef
			path?: string
	  }
	| {
			type: "git"
			url: string
			ref?: ParsedRef
			path?: string
	  }
	| { type: "local"; path: string }
	| { type: "claude-plugin"; plugin: string; marketplace: string }

type ParsedRef = { type: "tag" | "branch" | "rev"; value: string }

type ParseError =
	| { type: "parse"; message: string }
	| { type: "validation"; message: string }

type Result<T> = { ok: true; value: T } | { ok: false; error: ParseError }

function isNonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0
}

function parseRef(value: unknown): Result<ParsedRef | undefined> {
	if (value === undefined || value === null) {
		return { ok: true, value: undefined }
	}

	if (!value || typeof value !== "object") {
		return {
			error: { message: "Declaration ref is invalid.", type: "validation" },
			ok: false,
		}
	}

	const record = value as Record<string, unknown>
	if (!isNonEmpty(record.type) || !isNonEmpty(record.value)) {
		return {
			error: { message: "Declaration ref is invalid.", type: "validation" },
			ok: false,
		}
	}

	if (record.type !== "tag" && record.type !== "branch" && record.type !== "rev") {
		return {
			error: { message: "Declaration ref is invalid.", type: "validation" },
			ok: false,
		}
	}

	return { ok: true, value: { type: record.type, value: record.value } }
}

export function parseSerializedDeclaration(raw: string): Result<ParsedDeclaration> {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return {
			error: { message: "Invalid declaration JSON.", type: "parse" },
			ok: false,
		}
	}

	if (!parsed || typeof parsed !== "object") {
		return {
			error: { message: "Declaration is invalid.", type: "validation" },
			ok: false,
		}
	}

	const record = parsed as Record<string, unknown>
	if (!isNonEmpty(record.type)) {
		return {
			error: { message: "Declaration is missing a type.", type: "validation" },
			ok: false,
		}
	}

	if (record.type === "registry") {
		if (!isNonEmpty(record.name) || !isNonEmpty(record.version)) {
			return {
				error: {
					message: "Registry declaration is missing name or version.",
					type: "validation",
				},
				ok: false,
			}
		}

		const org = isNonEmpty(record.org) ? record.org : undefined
		return {
			ok: true,
			value: {
				name: record.name,
				org,
				type: "registry",
				version: record.version,
			},
		}
	}

	if (record.type === "github") {
		if (!isNonEmpty(record.gh)) {
			return {
				error: {
					message: "GitHub declaration is missing gh.",
					type: "validation",
				},
				ok: false,
			}
		}

		const ref = parseRef(record.ref)
		if (!ref.ok) {
			return ref
		}

		const path = isNonEmpty(record.path) ? record.path : undefined
		return {
			ok: true,
			value: {
				gh: record.gh,
				path,
				ref: ref.value,
				type: "github",
			},
		}
	}

	if (record.type === "git") {
		if (!isNonEmpty(record.url)) {
			return {
				error: { message: "Git declaration is missing url.", type: "validation" },
				ok: false,
			}
		}

		const ref = parseRef(record.ref)
		if (!ref.ok) {
			return ref
		}

		const path = isNonEmpty(record.path) ? record.path : undefined
		return {
			ok: true,
			value: {
				path,
				ref: ref.value,
				type: "git",
				url: record.url,
			},
		}
	}

	if (record.type === "local") {
		if (!isNonEmpty(record.path)) {
			return {
				error: {
					message: "Local declaration is missing path.",
					type: "validation",
				},
				ok: false,
			}
		}

		return { ok: true, value: { path: record.path, type: "local" } }
	}

	if (record.type === "claude-plugin") {
		if (!isNonEmpty(record.plugin) || !isNonEmpty(record.marketplace)) {
			return {
				error: {
					message:
						"Claude plugin declaration is missing plugin or marketplace.",
					type: "validation",
				},
				ok: false,
			}
		}

		return {
			ok: true,
			value: {
				marketplace: record.marketplace,
				plugin: record.plugin,
				type: "claude-plugin",
			},
		}
	}

	return {
		error: {
			message: "Declaration did not match any known type.",
			type: "validation",
		},
		ok: false,
	}
}

function formatRef(ref?: ParsedRef): string[] {
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

export function formatSkPackageAddCommand(declaration: ParsedDeclaration): string {
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
