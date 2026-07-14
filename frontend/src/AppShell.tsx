import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { InteractiveDotGrid } from './InteractiveDotGrid'
import { RoleWatermark } from './RoleWatermark'
import { WalletButton } from './WalletButton'

type Role = 'holder' | 'issuer'

export function AppShell() {
  const [role, setRole] = useState<Role>('holder')
  const contentRef = useRef<HTMLDivElement>(null)
  const [watermarkTop, setWatermarkTop] = useState(500)

  useLayoutEffect(() => {
    function measure() {
      if (contentRef.current) {
        setWatermarkTop(contentRef.current.getBoundingClientRect().top)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  return (
    <div className="relative min-h-svh overflow-hidden bg-black text-foreground">
      <InteractiveDotGrid className="pointer-events-none absolute inset-x-0 top-16 h-[650px] w-full" />
      <div className="noise-overlay pointer-events-none fixed inset-0" />

      <RoleWatermark
        word={role === 'holder' ? 'Holder' : 'Issuer'}
        top={watermarkTop}
      />

      <div className="relative">
        <header className="flex items-center justify-between border-b border-border px-8 py-6">
          <Link to="/" className="text-xl font-semibold">
            CertProof
          </Link>
          <WalletButton />
        </header>

        <div className="border-b border-border bg-white/5 px-8 py-3 text-center text-base text-muted-foreground">
          The contract isn't deployed to Preprod yet, so on-chain actions
          below are still simulated even after the wallet connects.
        </div>

        <main className="mx-auto max-w-2xl px-8 py-16">
          <div
            role="tablist"
            aria-label="Role"
            className="inline-flex rounded-full border border-border p-1"
          >
            {(['holder', 'issuer'] as const).map((r) => (
              <button
              key={r}
              type="button"
              role="tab"
              aria-selected={role === r}
              onClick={() => setRole(r)}
              className={`rounded-full px-5 py-2 text-base font-medium capitalize transition-colors ${
                role === r
                  ? 'bg-white text-black'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

          <div ref={contentRef} className="mt-10">
            {role === 'holder' ? <HolderFlow /> : <IssuerPanel />}
          </div>
        </main>
      </div>
    </div>
  )
}

function Field({
  label,
  where,
  ...props
}: {
  label: string
  where: 'device' | 'chain'
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center justify-between text-base">
        {label}
        <span
          className={`rounded-full border px-2.5 py-0.5 text-sm ${
            where === 'device'
              ? 'border-border text-muted-foreground'
              : 'border-foreground/40 text-foreground'
          }`}
        >
          {where === 'device' ? 'stays on this device' : 'goes on chain'}
        </span>
      </span>
      <input
        {...props}
        className="rounded-md border border-border bg-black px-4 py-2.5 text-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      />
    </label>
  )
}

function IssuerPanel() {
  const [commitment, setCommitment] = useState('')
  const [issued, setIssued] = useState(12)
  const [status, setStatus] = useState<'idle' | 'issuing' | 'done'>('idle')

  function handleIssue() {
    if (!commitment) return
    setStatus('issuing')
    setTimeout(() => {
      setIssued((n) => n + 1)
      setCommitment('')
      setStatus('done')
    }, 1200)
  }

  return (
    <div>
      <h1 className="text-2xl font-medium">Issuer panel</h1>
      <p className="mt-2 text-lg text-muted-foreground">
        Paste the commitment your holder sent you, then add it to the on-chain
        registry.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <input
          value={commitment}
          onChange={(e) => {
            setCommitment(e.target.value.toLowerCase().replace(/[^x0-9a-f]/g, ''))
            setStatus('idle')
          }}
          type="text"
          inputMode="text"
          maxLength={66}
          placeholder="commitment (0x…)"
          className="flex-1 rounded-md border border-border bg-black px-4 py-2.5 font-mono text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        />
        <button
          type="button"
          onClick={handleIssue}
          disabled={!commitment || status === 'issuing'}
          className="rounded-full bg-white px-6 py-2.5 text-base font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-40"
        >
          {status === 'issuing' ? 'Issuing…' : 'Issue'}
        </button>
      </div>

      {status === 'done' && (
        <p className="mt-4 text-base text-muted-foreground">
          Commitment added to the registry.
        </p>
      )}

      <div className="mt-10 flex items-center gap-2.5 text-base text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-foreground" />
        {issued} certificates issued
      </div>
    </div>
  )
}

type HolderStage = 'form' | 'commitment' | 'proving' | 'result'

const provingSteps = [
  'Preparing witness',
  'Generating proof',
  'Submitting to chain',
]

function HolderFlow() {
  const [stage, setStage] = useState<HolderStage>('form')
  const [provingStep, setProvingStep] = useState(0)
  const [credential, setCredential] = useState({
    name: '',
    certificateId: '',
    grade: '',
    expiry: '',
  })

  const commitment = '0x' + '4f2a9c'.repeat(6) + '1b'

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setStage('commitment')
  }

  function handleProve() {
    setStage('proving')
    setProvingStep(0)
    const timings = [900, 2200, 900]
    timings.forEach((delay, i) => {
      setTimeout(
        () => {
          if (i === timings.length - 1) {
            setTimeout(() => setStage('result'), delay)
          } else {
            setProvingStep(i + 1)
          }
        },
        timings.slice(0, i + 1).reduce((a, b) => a + b, 0),
      )
    })
  }

  if (stage === 'form') {
    return (
      <form onSubmit={handleCreate}>
        <h1 className="text-2xl font-medium">Create a credential</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          These fields are generated on your device. Only a commitment — a
          hash of all of it — will ever leave it.
        </p>

        <div className="mt-8 flex flex-col gap-5">
          <Field
            label="Name"
            where="device"
            required
            maxLength={64}
            placeholder="Ada Lovelace"
            value={credential.name}
            onChange={(e) =>
              setCredential({
                ...credential,
                name: e.target.value.replace(/[^\p{L}\s'-]/gu, ''),
              })
            }
          />
          <Field
            label="Certificate ID"
            where="device"
            required
            maxLength={32}
            placeholder="CERT-2026-0142"
            value={credential.certificateId}
            onChange={(e) =>
              setCredential({
                ...credential,
                certificateId: e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9-]/g, ''),
              })
            }
          />
          <Field
            label="Grade"
            where="device"
            required
            maxLength={4}
            placeholder="A or 95"
            value={credential.grade}
            onChange={(e) =>
              setCredential({
                ...credential,
                grade: e.target.value.replace(/[^A-Za-z0-9+-]/g, ''),
              })
            }
          />
          <Field
            label="Expiry date"
            where="device"
            type="date"
            required
            min={new Date().toISOString().split('T')[0]}
            value={credential.expiry}
            onChange={(e) =>
              setCredential({ ...credential, expiry: e.target.value })
            }
          />
        </div>

        <button
          type="submit"
          className="mt-10 rounded-full bg-white px-8 py-3 text-base font-medium text-black transition-colors hover:bg-white/90"
        >
          Generate commitment
        </button>
      </form>
    )
  }

  if (stage === 'commitment') {
    return (
      <div>
        <h1 className="text-2xl font-medium">Give this to your issuer</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          The commitment below is an opaque hash. It doesn't reveal anything
          about the credential fields.
        </p>

        <div className="mt-8 flex items-center gap-3 rounded-md border border-border bg-white/5 px-4 py-3">
          <code className="flex-1 truncate font-mono text-base">
            {commitment}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(commitment)}
            className="rounded-full border border-border px-4 py-1.5 text-base transition-colors hover:bg-white/10"
          >
            Copy
          </button>
        </div>

        <p className="mt-8 text-base text-muted-foreground">
          Once your issuer has added this to the registry, you can prove it.
        </p>
        <button
          type="button"
          onClick={handleProve}
          className="mt-4 rounded-full bg-white px-8 py-3 text-base font-medium text-black transition-colors hover:bg-white/90"
        >
          Prove
        </button>
      </div>
    )
  }

  if (stage === 'proving') {
    return (
      <div>
        <h1 className="text-2xl font-medium">Generating proof</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          This can take 10 or more seconds and can't be cancelled once
          started.
        </p>

        <ol className="mt-10 flex flex-col gap-4">
          {provingSteps.map((step, i) => (
            <li
              key={step}
              className={`flex items-center gap-3 text-lg ${
                i === provingStep
                  ? 'text-foreground'
                  : i < provingStep
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/50'
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm tabular-nums ${
                  i === provingStep ? 'border-foreground' : 'border-border'
                }`}
              >
                {i < provingStep ? '✓' : i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-medium">Access granted</h1>
      <p className="mt-2 text-lg text-muted-foreground">
        The proof succeeded. The registry now shows one more successful
        verification — nothing else.
      </p>
      <button
        type="button"
        onClick={() => setStage('form')}
        className="mt-8 rounded-full border border-border px-6 py-2.5 text-base transition-colors hover:bg-white/10"
      >
        Start over
      </button>
    </div>
  )
}
