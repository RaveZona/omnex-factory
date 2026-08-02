/**
 * Public portfolio for the virtual brand ambassador service.
 *
 * The work grid is driven by lib/modules/ambassador/work.json, which is written by
 * the QC gate — only assets marked public_release appear here. An image that fails
 * the identity gate cannot reach this page by editing markup, which is the point:
 * the portfolio is the claim that one model stays one model.
 */
import work from '@/lib/modules/ambassador/work.json'
import { BriefForm } from './brief-form'

export const metadata = {
  title: 'Virtual Brand Ambassadors — OMNEX',
  description:
    'A consistent, fully synthetic model for your campaign. Same face across every shot, every scene, every season. No studio, no model release, no location permits.',
}

const SERVICES = [
  {
    name: 'Campaign set',
    price: 'from €490',
    body: 'One ambassador, 12 finished images across the scenes you publish in — feed, stories, product page, ads. Delivered in every format.',
  },
  {
    name: 'Seasonal retainer',
    price: 'from €1,200 / month',
    body: 'The same face all season. New wardrobe, new locations, new campaigns, on a monthly cadence, so your brand has a recognisable presence.',
  },
  {
    name: 'Exclusive ambassador',
    price: 'on request',
    body: 'A model built for your brand alone and licensed exclusively to you. Nobody else can use that face.',
  },
]

export default function AmbassadorPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      {/* Hero */}
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">
          OMNEX · Virtual Brand Ambassadors
        </p>
        <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          One model. Every campaign.
          <br />
          <span className="text-neutral-400">The same face, every time.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-neutral-400">
          A fully synthetic ambassador for your brand — no studio booking, no model
          release, no location permits, no reshoot when the collection changes. Built
          once, then photographed anywhere.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#brief"
            className="rounded-lg bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-neutral-200"
          >
            Start a brief
          </a>
          <a
            href="#work"
            className="rounded-lg border border-neutral-700 px-5 py-3 text-sm font-medium transition hover:border-neutral-500"
          >
            See the work
          </a>
        </div>
      </section>

      {/* Work */}
      <section id="work" className="mt-24 scroll-mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
            Selected work
          </h2>
          {/* The consistency claim is a measurement, so it is shown as one. */}
          <span className="text-xs text-neutral-600">
            identity consistency {work.identity_average} · gate {work.gate}
          </span>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {work.works.map((w) => (
            <figure key={w.file} className="overflow-hidden rounded-xl border border-neutral-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/work/${w.file}`}
                alt="Synthetic brand ambassador, editorial campaign frame"
                className="aspect-[3/4] w-full object-cover"
                loading="lazy"
              />
              <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-neutral-500">
                <span>{w.res}</span>
                <span>match {w.score}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-4 text-xs text-neutral-600">
          Every frame above passed an automated identity check against the master
          reference before publication. Frames that fall below the gate are never
          shown.
        </p>
      </section>

      {/* Services */}
      <section id="services" className="mt-24">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          How it works
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {SERVICES.map((s) => (
            <div key={s.name} className="rounded-xl border border-neutral-800 p-5">
              <div className="font-medium">{s.name}</div>
              <div className="mt-1 text-sm text-neutral-500">{s.price}</div>
              <p className="mt-3 text-sm text-neutral-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Disclosure — a legal obligation and, for agencies, a selling point. */}
      <section id="disclosure" className="mt-24 rounded-xl border border-neutral-800 p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          AI disclosure &amp; licensing
        </h2>
        <ul className="mt-4 space-y-2 text-sm text-neutral-400">
          <li>
            <strong className="text-neutral-200">{work.disclosure}</strong> Every
            image is generated. No photograph of any real person is used, and no real
            person&apos;s likeness is referenced.
          </li>
          <li>
            Delivered assets carry an AI-generated label, in line with the EU AI Act
            transparency requirement for synthetic media.
          </li>
          <li>
            Because the model does not exist, there is no model release to negotiate
            and no usage window that expires with a person&apos;s contract.
          </li>
          <li>
            Commercial licence for your brand. Exclusive licensing available so the
            face is used by nobody else.
          </li>
        </ul>
      </section>

      {/* Brief */}
      <section id="brief" className="mt-24 scroll-mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          Start a brief
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-neutral-400">
          Tell us the brand and what you need to publish. You will get a reply with a
          scope and a price, or an honest note that we are not the right fit.
        </p>
        <BriefForm />
      </section>

      <footer className="mt-24 border-t border-neutral-900 pt-8 text-xs text-neutral-600">
        OMNEX · {work.disclosure}
      </footer>
    </main>
  )
}
