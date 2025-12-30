import type { NextConfig } from "next"

type NextConfigReducer = (config: NextConfig) => NextConfig

// Inline webpack types we actually use (avoids @types/webpack dependency)
type WebpackRuleSetRule = {
	test?: RegExp
	resourceQuery?: unknown
	issuer?: unknown
	exclude?: RegExp
	use?: string[]
	type?: string
}

type WebpackConfiguration = {
	module?: {
		rules?: (WebpackRuleSetRule | "..." | 0 | false | null | undefined)[]
	}
}

/**
 * Adds SVGR support for SVG imports.
 *
 * - Turbopack: Handles FontAwesome SVGs in node_modules
 * - Webpack: Enables ?react query imports (e.g., `import Logo from './logo.svg?react'`)
 */
export const withSvgr: NextConfigReducer = (config) => {
	const prevWebpack = config.webpack

	return {
		...config,
		turbopack: {
			...config.turbopack,
			rules: {
				...config.turbopack?.rules,
				"*.svg": {
					as: "*.js",
					condition: {
						any: [
							{ path: /node_modules\/@awesome\.me\/.*\.svg$/i },
							{ path: /node_modules\/@fortawesome\/.*\.svg$/i },
						],
					},
					loaders: ["@svgr/webpack"],
				},
			},
		},
		webpack: (webpackConfig, options) => {
			const config = prevWebpack?.(webpackConfig, options) ?? webpackConfig
			return configureSvgrWebpack(config as WebpackConfiguration)
		},
	}
}

/**
 * Adds webpack rules for importing .md and .html files as raw strings.
 */
export const withAssetLoaders: NextConfigReducer = (config) => {
	const prevWebpack = config.webpack

	return {
		...config,
		webpack: (webpackConfig, options) => {
			const config = prevWebpack?.(webpackConfig, options) ?? webpackConfig

			config.module?.rules?.push(
				{ test: /\.md$/, type: "asset/source" },
				{ test: /\.html$/, type: "asset/source" },
			)

			return config
		},
	}
}

function configureSvgrWebpack(config: WebpackConfiguration): WebpackConfiguration {
	if (!config.module?.rules) {
		return config
	}

	const fileLoaderRule = config.module.rules.find(
		(rule): rule is WebpackRuleSetRule => {
			if (typeof rule === "object" && rule && "test" in rule) {
				const test = rule.test
				return test instanceof RegExp && test.test(".svg")
			}
			return false
		},
	)

	if (fileLoaderRule) {
		const resourceQuery = fileLoaderRule.resourceQuery
		const not =
			resourceQuery &&
			typeof resourceQuery === "object" &&
			"not" in resourceQuery &&
			Array.isArray((resourceQuery as { not?: unknown[] }).not)
				? (resourceQuery as { not: unknown[] }).not
				: []

		config.module.rules.push(
			{
				...fileLoaderRule,
				resourceQuery: { not: [...not, /react/] },
				test: /\.svg$/i,
			},
			{
				issuer: fileLoaderRule.issuer,
				resourceQuery: /react/,
				test: /\.svg$/i,
				use: ["@svgr/webpack"],
			},
		)

		fileLoaderRule.exclude = /\.svg$/i
	}

	return config
}
