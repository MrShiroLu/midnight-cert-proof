import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { InteractiveDotGrid } from './InteractiveDotGrid'
import { RoleWatermark } from './RoleWatermark'
import { WalletButton } from './WalletButton'
import { useWallet } from './wallet'
import {
  commitmentOf,
  configureProviders,
  createHolderPrivateState,
  createIssuerPrivateState,
  currentNetworkId,
  daysSinceEpoch,
  fromHex,
  getRegistryState,
  isHex,
  issueCertificate,
  joinCertProofContract,
  proveAndAccess,
  setActivePrivateState,
  toBytes32,
  toHex,
  type HolderCredential,
} from './midnight'

type Role = 'holder' | 'issuer'
type Wallet = ReturnType<typeof useWallet>

export function AppShell() {
  const wallet = useWallet()
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
          <WalletButton wallet={wallet} />
        </header>

        <div className="border-b border-border bg-white/5 px-8 py-3 text-center text-base text-muted-foreground">
          {wallet.status === 'connected'
            ? 'Connected to Preprod. Actions below submit real transactions and require a local proof server (see README).'
            : 'Connect a Lace wallet to issue or prove on Preprod. Without one, this only shows the registry.'}
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
            {role === 'holder' ? <HolderFlow wallet={wallet} /> : <IssuerPanel wallet={wallet} />}
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

function IssuerPanel({ wallet }: { wallet: Wallet }) {
  const [issuerSecretHex, setIssuerSecretHex] = useState('')
  const [commitment, setCommitment] = useState('')
  const [issued, setIssued] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'issuing' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRegistryState()
      .then((registry) => setIssued(registry ? Number(registry.issued) : 0))
      .catch(() => setIssued(null))
  }, [status])

  async function handleIssue() {
    if (!commitment) return
    if (wallet.status !== 'connected' || !wallet.api) {
      setStatus('error')
      setError('Connect a Lace wallet first.')
      return
    }
    const secretHex = issuerSecretHex.replace(/^0x/, '')
    const commitmentHex = commitment.replace(/^0x/, '')
    if (!isHex(secretHex, 32)) {
      setStatus('error')
      setError('Issuer secret key must be 32 bytes of hex (64 hex chars).')
      return
    }
    if (!isHex(commitmentHex, 32)) {
      setStatus('error')
      setError('Commitment must be 32 bytes of hex (64 hex chars).')
      return
    }

    setStatus('issuing')
    setError(null)
    try {
      const providers = await configureProviders(wallet.api, currentNetworkId())
      const issuerKey = fromHex(secretHex)
      const contract = await joinCertProofContract(providers, createIssuerPrivateState(issuerKey))
      await setActivePrivateState(providers, createIssuerPrivateState(issuerKey))
      const commitmentBytes = fromHex(commitmentHex)
      await issueCertificate(contract, commitmentBytes)
      setCommitment('')
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Issuing failed.')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-medium">Issuer panel</h1>
      <p className="mt-2 text-lg text-muted-foreground">
        Paste the commitment your holder sent you, then add it to the on-chain
        registry.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <input
          value={issuerSecretHex}
          onChange={(e) => setIssuerSecretHex(e.target.value.trim())}
          type="password"
          maxLength={66}
          placeholder="issuer secret key (0x…, stays on this device)"
          className="rounded-md border border-border bg-black px-4 py-2.5 font-mono text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        />
        <div className="flex flex-col gap-3 sm:flex-row">
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
      </div>

      {status === 'done' && (
        <p className="mt-4 text-base text-muted-foreground">
          Commitment added to the registry.
        </p>
      )}
      {status === 'error' && error && (
        <p className="mt-4 text-base text-red-400">{error}</p>
      )}

      <div className="mt-10 flex items-center gap-2.5 text-base text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-foreground" />
        {issued ?? '—'} certificates issued
      </div>
    </div>
  )
}

type HolderStage = 'form' | 'commitment' | 'proving' | 'result' | 'error'

const provingSteps = [
  'Preparing witness',
  'Generating proof',
  'Submitting to chain',
]

function generateCredentialFields() {
  return {
    credentialSecret: crypto.getRandomValues(new Uint8Array(32)),
    salt: crypto.getRandomValues(new Uint8Array(32)),
  }
}

function HolderFlow({ wallet }: { wallet: Wallet }) {
  const [stage, setStage] = useState<HolderStage>('form')
  const [provingStep, setProvingStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [credential, setCredential] = useState({
    name: '',
    certificateId: '',
    grade: '',
    expiry: '',
  })
  const secretFields = useRef(generateCredentialFields())

  const holderCredential = useMemo<HolderCredential | null>(() => {
    if (stage === 'form') return null
    return {
      certificateId: toBytes32(credential.certificateId),
      holderName: toBytes32(credential.name),
      grade: toBytes32(credential.grade),
      expiryDate: daysSinceEpoch(new Date(credential.expiry)),
      ...secretFields.current,
    }
  }, [stage, credential])

  const commitment = useMemo(() => {
    if (!holderCredential) return ''
    return '0x' + toHex(commitmentOf(createHolderPrivateState(holderCredential)))
  }, [holderCredential])

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setStage('commitment')
  }

  async function handleProve() {
    if (!holderCredential) return
    if (wallet.status !== 'connected' || !wallet.api) {
      setError('Connect a Lace wallet first.')
      setStage('error')
      return
    }
    setStage('proving')
    setProvingStep(0)
    setError(null)
    try {
      const providers = await configureProviders(wallet.api, currentNetworkId())
      setProvingStep(1)
      const privateState = createHolderPrivateState(holderCredential)
      const contract = await joinCertProofContract(providers, privateState)
      await setActivePrivateState(providers, privateState)
      setProvingStep(2)
      await proveAndAccess(contract, daysSinceEpoch(new Date()))
      setStage('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proof failed.')
      setStage('error')
    }
  }

  function reset() {
    secretFields.current = generateCredentialFields()
    setCredential({ name: '', certificateId: '', grade: '', expiry: '' })
    setStage('form')
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

  if (stage === 'error') {
    return (
      <div>
        <h1 className="text-2xl font-medium">Proof rejected</h1>
        <p className="mt-2 text-lg text-red-400">{error}</p>
        <p className="mt-4 text-base text-muted-foreground">
          Common causes: proof server not running locally, wrong network,
          certificate not yet issued, or this certificate already used at
          this gate.
        </p>
        <button
          type="button"
          onClick={() => setStage('commitment')}
          className="mt-8 rounded-full border border-border px-6 py-2.5 text-base transition-colors hover:bg-white/10"
        >
          Back
        </button>
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
        onClick={reset}
        className="mt-8 rounded-full border border-border px-6 py-2.5 text-base transition-colors hover:bg-white/10"
      >
        Start over
      </button>
    </div>
  )
}
