/**
 * Test-only branded type helpers
 *
 * These cast strings directly to branded types without validation.
 * Only use in tests where you control the input values.
 *
 * For production code, use the coerce functions from @skills-supply/core
 * which validate input and return null on invalid values.
 */

import type {
	AbsolutePath,
	Alias,
	GithubRef,
	GitUrl,
	NonEmptyString,
} from "@skills-supply/core"

/** Cast string to NonEmptyString (test-only, no validation) */
export const nes = (s: string): NonEmptyString => s as NonEmptyString

/** Cast string to AbsolutePath (test-only, no validation) */
export const abs = (s: string): AbsolutePath => s as AbsolutePath

/** Cast string to Alias (test-only, no validation) */
export const alias = (s: string): Alias => s as Alias

/** Cast string to GithubRef (test-only, no validation) */
export const ghRef = (s: string): GithubRef => s as GithubRef

/** Cast string to GitUrl (test-only, no validation) */
export const gitUrl = (s: string): GitUrl => s as GitUrl
