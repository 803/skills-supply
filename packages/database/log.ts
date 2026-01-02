const PREFIX = "skillssupply"

function cleanFilename(filename: string) {
	let found = false
	return filename
		.split("/")
		.filter((part) => {
			if (found) {
				return true
			}
			if (part === PREFIX) {
				found = true
				return true
			}
			return false
		})
		.join("/")
}

export function debug(filename: string, ...args: unknown[]) {
	console.debug(`📎 [${cleanFilename(filename)}] -- `, ...args)
}

export function info(filename: string, ...args: unknown[]) {
	console.info(`📎 [${cleanFilename(filename)}] -- `, ...args)
}

export function warn(filename: string, ...args: unknown[]) {
	console.warn(`📎 [${cleanFilename(filename)}] -- `, ...args)
}

export function error(filename: string, ...args: unknown[]) {
	console.error(`📎 [${cleanFilename(filename)}] -- `, ...args)
}

export function log(filename: string, ...args: unknown[]) {
	console.log(`📎 [${cleanFilename(filename)}] -- `, ...args)
}
