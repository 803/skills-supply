/**
 * Custom Vitest assertions for Result types
 *
 * These matchers make it easy to assert on Result<T, E> types
 * that follow the { ok: true, value: T } | { ok: false, error: E } pattern.
 */

import { expect } from "vitest"

/**
 * Result type that our assertions work with.
 */
interface OkResult<T> {
	ok: true
	value: T
}

interface ErrResult<E> {
	ok: false
	error: E
}

type Result<T, E> = OkResult<T> | ErrResult<E>

/**
 * Type guard for ok results.
 */
function isOk<T, E>(result: Result<T, E>): result is OkResult<T> {
	return result.ok === true
}

/**
 * Type guard for error results.
 */
function isErr<T, E>(result: Result<T, E>): result is ErrResult<E> {
	return result.ok === false
}

/**
 * Custom matchers for Result types.
 */
expect.extend({
	/**
	 * Assert that a result is an error.
	 *
	 * @example
	 * expect(parseManifest(badInput)).toBeErr()
	 */
	toBeErr(received: Result<unknown, unknown>) {
		if (isErr(received)) {
			return {
				message: () =>
					`expected result not to be an error, but got: ${JSON.stringify(received.error)}`,
				pass: true,
			}
		}

		return {
			message: () =>
				`expected result to be an error, but got ok with value: ${JSON.stringify(received.value)}`,
			pass: false,
		}
	},

	/**
	 * Assert that a result is an error containing a specific message.
	 *
	 * @example
	 * expect(parseManifest(badInput)).toBeErrContaining('invalid')
	 */
	toBeErrContaining(received: Result<unknown, unknown>, substring: string) {
		if (!isErr(received)) {
			return {
				message: () =>
					`expected result to be an error, but got ok with value: ${JSON.stringify(received.value)}`,
				pass: false,
			}
		}

		const errorString =
			typeof received.error === "object" && received.error !== null
				? JSON.stringify(received.error)
				: String(received.error)

		if (errorString.includes(substring)) {
			return {
				message: () => `expected error not to contain "${substring}", but it did`,
				pass: true,
			}
		}

		return {
			message: () =>
				`expected error to contain "${substring}", but got: ${errorString}`,
			pass: false,
		}
	},
	/**
	 * Assert that a result is Ok.
	 *
	 * @example
	 * expect(parseManifest(input)).toBeOk()
	 */
	toBeOk(received: Result<unknown, unknown>) {
		if (isOk(received)) {
			return {
				message: () =>
					`expected result not to be ok, but got value: ${JSON.stringify(received.value)}`,
				pass: true,
			}
		}

		const errorMessage =
			typeof received.error === "object" && received.error !== null
				? JSON.stringify(received.error, null, 2)
				: String(received.error)

		return {
			message: () => `expected result to be ok, but got error:\n${errorMessage}`,
			pass: false,
		}
	},

	/**
	 * Assert that a result is Ok and its value satisfies a predicate.
	 *
	 * @example
	 * expect(parseManifest(input)).toBeOkWith(manifest => manifest.name === 'test')
	 */
	toBeOkWith(
		received: Result<unknown, unknown>,
		predicate: (value: unknown) => boolean,
	) {
		if (!isOk(received)) {
			return {
				message: () =>
					`expected result to be ok, but got error: ${JSON.stringify(received.error)}`,
				pass: false,
			}
		}

		if (predicate(received.value)) {
			return {
				message: () => `expected value not to match predicate, but it did`,
				pass: true,
			}
		}

		return {
			message: () =>
				`expected value to match predicate, but it didn't. Value: ${JSON.stringify(received.value)}`,
			pass: false,
		}
	},
})

// Extend Vitest's expect types
declare module "vitest" {
	// biome-ignore lint/suspicious/noExplicitAny: matches Vitest's Assertion default.
	interface Assertion<T = any> {
		toBeOk(): void
		toBeErr(): void
		toBeOkWith(predicate: (value: T) => boolean): void
		toBeErrContaining(substring: string): void
	}

	interface AsymmetricMatchersContaining {
		toBeOk(): void
		toBeErr(): void
	}
}
