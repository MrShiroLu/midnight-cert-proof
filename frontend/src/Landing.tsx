import { Link } from 'react-router-dom'
import { GradientBackground } from './GradientBackground'
import { InteractiveDotGrid } from './InteractiveDotGrid'

const steps = [
  {
    n: '01',
    title: 'Holder creates a credential',
    body: 'Name, certificate ID, grade and expiry are generated on the holder’s own device, along with a secret. Only a commitment - a hash of all of it - leaves the device.',
  },
  {
    n: '02',
    title: 'Issuer adds the commitment',
    body: 'The issuer records the commitment in an on-chain registry. It’s an opaque hash - nothing about the certificate is readable from it.',
  },
  {
    n: '03',
    title: 'Holder proves it’s valid',
    body: 'A zero-knowledge proof shows the certificate is in the registry and unexpired - without revealing which one it is, or who holds it.',
  },
]

export function Landing() {
  return (
    <div className="relative min-h-svh">
      <GradientBackground />
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-b from-black via-black/35 to-black" />
      <div className="noise-overlay pointer-events-none fixed inset-0" />

      <div className="relative flex min-h-svh flex-col">
        <header className="flex items-center justify-between px-8 py-6">
          <span className="text-xl font-semibold">CertProof</span>
        </header>

        <main className="flex flex-1 flex-col justify-center px-8 py-16">
          <div className="fade-up max-w-2xl [text-shadow:0_2px_24px_rgba(0,0,0,0.7)]">
            <h1 className="font-medium text-4xl leading-tight sm:text-5xl">
              Prove a certificate is valid. Reveal nothing else.
            </h1>
            <p className="mt-6 max-w-lg text-lg text-foreground/80">
              CertProof verifies certificates on Midnight without putting the
              certificate itself on chain. Only the proof is public.
            </p>
            <Link
              to="/app"
              className="mt-10 inline-block rounded-full bg-white px-8 py-3 text-base font-medium text-black transition-colors hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
            >
              Launch app
            </Link>
          </div>
        </main>

        <div className="relative overflow-hidden border-t border-border bg-black">
          <InteractiveDotGrid
            className="pointer-events-none absolute inset-x-0 top-0 h-[500px] w-full"
          />

          <div className="relative">
            <section className="px-8 py-24">
              <div className="mx-auto max-w-3xl">
                <h2 className="text-3xl font-medium">How it works</h2>

                <div className="mt-14 flex flex-col">
                  {steps.map((step, i) => (
                    <div
                      key={step.n}
                      className="group relative flex gap-8 pb-14 last:pb-0"
                    >
                      {i < steps.length - 1 && (
                        <span className="absolute left-6 top-14 bottom-0 w-px bg-border" />
                      )}
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border text-lg tabular-nums text-muted-foreground transition-all duration-300 group-hover:scale-110 group-hover:border-foreground group-hover:bg-foreground group-hover:text-black">
                        {step.n}
                      </span>
                      <div className="pt-1.5">
                        <h3 className="text-xl font-medium">{step.title}</h3>
                        <p className="mt-2 max-w-lg text-lg text-muted-foreground">
                          {step.body}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="border-t border-border px-8 py-24">
              <div className="mx-auto max-w-3xl">
                <h2 className="text-3xl font-medium">What stays where</h2>

                <div className="relative mt-14 grid gap-12 sm:grid-cols-2 sm:gap-0">
                  <div className="group sm:pr-12">
                    <div className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-foreground transition-transform duration-300 group-hover:scale-150" />
                      <h3 className="text-xl font-medium">On chain</h3>
                    </div>
                    <ul className="mt-6 flex flex-col gap-3 text-lg text-muted-foreground">
                      <li>Commitment registry</li>
                      <li>Nullifier set</li>
                      <li>Issuer public key</li>
                      <li>The proof result</li>
                    </ul>
                  </div>

                  <span className="hidden sm:block absolute inset-y-0 left-1/2 w-px bg-border" />

                  <div className="group sm:pl-12">
                    <div className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-muted-foreground transition-transform duration-300 group-hover:scale-150 group-hover:border-foreground" />
                      <h3 className="text-xl font-medium">Never on chain</h3>
                    </div>
                    <ul className="mt-6 flex flex-col gap-3 text-lg text-muted-foreground">
                      <li>Name and certificate ID</li>
                      <li>Grade and expiry date</li>
                      <li>The holder’s secret</li>
                      <li>Which certificate was proven</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            <footer className="flex items-center gap-2.5 border-t border-border px-8 py-6 text-base text-muted-foreground">
              <span className="pulse-dot h-2 w-2 rounded-full bg-foreground" />
              Running on the Midnight Preprod testnet.
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}
