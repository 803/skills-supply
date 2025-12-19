"use client"

import faBars from "@fa/utility-semibold/bars.svg?react"
import faXmark from "@fa/utility-semibold/xmark.svg?react"
import { FontAwesomeIcon } from "@skillsupply/shared/fontawesome"
import Link from "next/link"
import { useState } from "react"
import { Drawer } from "vaul"

export interface NavItem {
	label: string
	href: string
	active?: boolean
}

export interface HeaderProps {
	navItems?: NavItem[]
}

export function Header({ navItems = [] }: HeaderProps) {
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
	const showMenu = navItems.length > 0

	return (
		<header>
			<nav
				aria-label="Global"
				className="mx-auto flex max-w-4xl items-center justify-between py-4 px-6"
			>
				<Link
					href="/"
					className="-m-1.5 px-1.5 py-2"
				>
					<span className="sr-only">Sensei</span>
					<span className="text-xl font-400 tracking-tighter font-heading">
						sensei
					</span>
				</Link>
				<div className="flex md:hidden">
					{showMenu && (
						<button
							type="button"
							onClick={() => setMobileMenuOpen(true)}
							className="-m-2.5 inline-flex items-center justify-center p-2.5"
						>
							<span className="sr-only">Open main menu</span>
							<FontAwesomeIcon
								icon={faBars}
								alt=""
								aria-hidden="true"
								className="h-6 w-auto text-slate-800 cursor-pointer"
							/>
						</button>
					)}
				</div>
				<div className="hidden md:flex md:gap-x-6 items-center">
					{navItems.map((item) => (
						<Link
							key={item.href}
							href={item.href}
							className="text-sm text-slate-600 hover:text-slate-900"
						>
							{item.label}
						</Link>
					))}
				</div>
			</nav>
			{showMenu && (
				<Drawer.Root
					open={mobileMenuOpen}
					onOpenChange={setMobileMenuOpen}
					direction="right"
				>
					<Drawer.Portal>
						<Drawer.Overlay className="fixed inset-0 z-50 bg-black/30 md:hidden" />
						<Drawer.Content className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-stone-50 py-4 px-6 sm:max-w-sm shadow-xl/10 md:hidden">
							<Drawer.Title className="sr-only">
								Navigation Menu
							</Drawer.Title>
							<div className="flex items-center justify-between">
								<Link
									href="/"
									className="-m-1.5 px-1.5 py-2 h-[44px]"
								>
									<span className="sr-only">Sensei</span>
									<span className="text-xl font-400 tracking-tighter font-heading">
										sensei
									</span>
								</Link>
								<button
									type="button"
									onClick={() => setMobileMenuOpen(false)}
									className="-m-2.5 inline-flex items-center justify-center p-2.5"
								>
									<span className="sr-only">Close menu</span>
									<FontAwesomeIcon
										icon={faXmark}
										alt=""
										aria-hidden="true"
										className="h-6 w-auto text-slate-400 cursor-pointer"
									/>
								</button>
							</div>
							<div className="mt-6 flow-root">
								<div className="divide-y divide-white/10 space-y-6">
									<div className="space-y-2">
										{navItems.map((item) => (
											<Link
												key={item.href}
												href={item.href}
												className="-mx-3 block px-3 py-2 text-base/7"
											>
												{item.label}
											</Link>
										))}
									</div>
								</div>
							</div>
						</Drawer.Content>
					</Drawer.Portal>
				</Drawer.Root>
			)}
		</header>
	)
}
