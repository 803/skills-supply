/**
 * Shared tsdown configuration for all Cuttlefish packages
 * @type {import('tsdown').Options}
 */
export const baseConfig = {
	clean: true,
	dts: true,
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	minify: false,
	platform: "browser",
	sourcemap: true,
}
