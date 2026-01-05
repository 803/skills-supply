import type { ReactNode } from "react"
import type { IndexedPackage } from "@/lib/indexed-packages"
import { CopyCodeBlock } from "./CopyCodeBlock"

const numberFormatter = new Intl.NumberFormat("en-US")
const dateFormatter = new Intl.DateTimeFormat("en-US", {
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	month: "short",
	year: "numeric",
})

function toDate(value: Date | string | null | undefined): Date | null {
	if (!value) {
		return null
	}

	const date = value instanceof Date ? value : new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(value: Date | string | null | undefined): string {
	const parsed = toDate(value)
	return parsed ? dateFormatter.format(parsed) : "n/a"
}

function formatText(value: string | null | undefined): string {
	if (!value) {
		return "n/a"
	}

	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : "n/a"
}

function formatNumber(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) {
		return "n/a"
	}

	return numberFormatter.format(value)
}

function repoHref(repo: string): string {
	if (repo.startsWith("http://") || repo.startsWith("https://")) {
		return repo
	}

	if (repo.startsWith("github.com/")) {
		return `https://${repo}`
	}

	return `https://github.com/${repo}`
}

interface DetailRowProps {
	label: string
	value: ReactNode
	className?: string
}

function DetailRow({ label, value, className = "" }: DetailRowProps) {
	return (
		<div
			className={`rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur ${className}`}
		>
			<p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
				{label}
			</p>
			<div className="mt-2 text-sm text-stone-800">{value}</div>
		</div>
	)
}

function TopicsList({ topics }: { topics: string[] }) {
	if (topics.length === 0) {
		return <span className="text-sm text-stone-500">n/a</span>
	}

	return (
		<div className="flex flex-wrap gap-2">
			{topics.map((topic) => (
				<span
					key={topic}
					className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"
				>
					{topic}
				</span>
			))}
		</div>
	)
}

interface IndexedPackageCardProps {
	pkg: IndexedPackage
	index?: number
	installCommand?: string
}

export function IndexedPackageCard({
	pkg,
	index = 0,
	installCommand,
}: IndexedPackageCardProps) {
	const repoLink = repoHref(pkg.github_repo)

	return (
		<article
			className="group relative overflow-hidden rounded-3xl border border-stone-200/70 bg-white/80 p-6 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.55),0_2px_14px_rgba(15,23,42,0.08)] backdrop-blur animate-slide-up"
			style={{ animationDelay: `${Math.min(index, 10) * 0.05}s` }}
		>
			<div className="pointer-events-none absolute -right-16 -top-12 h-48 w-48 rounded-full bg-amber-200/40 blur-3xl transition duration-500 group-hover:scale-110" />
			<div className="pointer-events-none absolute -left-20 bottom-0 h-40 w-40 rounded-full bg-sky-200/40 blur-3xl transition duration-500 group-hover:scale-110" />
			<div className="relative space-y-6">
				<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
					<div>
						<p className="text-[11px] uppercase tracking-[0.35em] text-stone-500">
							Indexed record
						</p>
						<h2 className="mt-3 text-2xl font-heading text-stone-900 sm:text-3xl">
							{pkg.name}
						</h2>
						<p className="mt-2 text-sm text-stone-500">
							ID {formatNumber(pkg.id)}
						</p>
					</div>
					<div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-stone-600">
						<span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1">
							Stars {formatNumber(pkg.gh_stars)}
						</span>
						<span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1">
							Owner {formatText(pkg.gh_owner)}
						</span>
						<span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1">
							Lang {formatText(pkg.gh_language)}
						</span>
					</div>
				</div>

				<div className="grid gap-4 md:grid-cols-2">
					<DetailRow
						label="GitHub owner"
						value={formatText(pkg.gh_owner)}
					/>
					<DetailRow
						label="GitHub stars"
						value={formatNumber(pkg.gh_stars)}
					/>
					{installCommand ? (
						<div className="md:col-span-2">
							<CopyCodeBlock
								code={installCommand}
								label="Install with sk"
							/>
						</div>
					) : null}
					<DetailRow
						label="Name"
						value={
							<span className="font-medium">{formatText(pkg.name)}</span>
						}
					/>
					<DetailRow
						label="GitHub repo"
						value={
							<a
								href={repoLink}
								target="_blank"
								rel="noreferrer"
								className="font-medium text-stone-900 underline decoration-amber-300 underline-offset-4 transition hover:text-amber-700"
							>
								{pkg.github_repo}
							</a>
						}
					/>
					<DetailRow
						label="GitHub language"
						value={formatText(pkg.gh_language)}
					/>
					<DetailRow
						label="GitHub license"
						value={formatText(pkg.gh_license)}
					/>
					<DetailRow
						label="Package path"
						value={
							<span className="font-mono text-xs text-stone-700">
								{formatText(pkg.path)}
							</span>
						}
					/>
					<DetailRow
						label="Declaration"
						value={
							<span className="font-mono text-xs text-stone-700">
								{formatText(pkg.declaration)}
							</span>
						}
					/>
					<DetailRow
						label="Package description"
						value={formatText(pkg.description)}
						className="md:col-span-2"
					/>
					<DetailRow
						label="GitHub description"
						value={formatText(pkg.gh_description)}
						className="md:col-span-2"
					/>
					<DetailRow
						label="GitHub topics"
						value={<TopicsList topics={pkg.gh_topics ?? []} />}
						className="md:col-span-2"
					/>
					<DetailRow
						label="GitHub updated"
						value={formatDate(pkg.gh_updated_at)}
					/>
					<DetailRow
						label="Discovered"
						value={formatDate(pkg.discovered_at)}
					/>
					<DetailRow
						label="Record updated"
						value={formatDate(pkg.updated_at)}
					/>
					<DetailRow
						label="Indexed ID"
						value={formatNumber(pkg.id)}
					/>
				</div>
			</div>
		</article>
	)
}
