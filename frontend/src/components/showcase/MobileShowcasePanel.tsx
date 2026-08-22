import React from 'react'

interface MobileShowcasePanelProps {
  eyebrow: string
  title: string
  description: string
  accentClass: string
  children?: React.ReactNode
}

export function MobileShowcasePanel({ eyebrow, title, description, accentClass, children }: MobileShowcasePanelProps) {
  return (
    <section className="flex min-h-[100svh] w-full items-center bg-[#040406] px-5 py-20 text-white">
      <div className="w-full rounded-3xl border border-white/10 bg-[#090a0f]/90 p-5 shadow-2xl backdrop-blur-xl">
        <p className={`mb-3 text-[10px] font-bold uppercase tracking-[0.2em] ${accentClass}`}>{eyebrow}</p>
        <h1 className="text-3xl font-light leading-tight tracking-tight">{title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-neutral-300">{description}</p>
        {children}
      </div>
    </section>
  )
}
