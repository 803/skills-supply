"use client"

import { useEffect, useState } from "react"

interface CopyCodeBlockProps {
	code: string
	label?: string
}

export function CopyCodeBlock({ code, label = "Install command" }: CopyCodeBlockProps) {
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (!copied) {
			return undefined
		}

		const timer = window.setTimeout(() => setCopied(false), 1800)
		return () => window.clearTimeout(timer)
	}, [copied])

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(code)
			setCopied(true)
		} catch {
			setCopied(false)
		}
	}

	return (
		<section className="relative overflow-hidden rounded-3xl border border-stone-200/80 bg-white/85 p-6 shadow-[0_20px_70px_-55px_rgba(15,23,42,0.45),0_2px_12px_rgba(15,23,42,0.08)] backdrop-blur">
			<div className="pointer-events-none absolute -right-20 -top-16 h-44 w-44 rounded-full bg-amber-200/40 blur-3xl" />
			<div className="pointer-events-none absolute -left-24 bottom-0 h-40 w-40 rounded-full bg-sky-200/40 blur-3xl" />
			<div className="relative flex flex-col gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p className="text-[11px] uppercase tracking-[0.38em] text-stone-500">
							{label}
						</p>
						<p className="mt-2 text-sm text-stone-600">
							Copy and run this in your project root.
						</p>
					</div>
					<button
						type="button"
						onClick={handleCopy}
						className="rounded-full border border-stone-200 bg-white/90 px-4 py-2 text-xs uppercase tracking-[0.3em] text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300 hover:text-stone-900"
					>
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
				<pre className="overflow-x-auto rounded-2xl border border-stone-200/80 bg-stone-950 px-4 py-4 text-sm text-stone-100 shadow-inner">
					<code className="font-mono">{code}</code>
				</pre>
			</div>
		</section>
	)
}
