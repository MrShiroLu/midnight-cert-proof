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
  deployCertProofContract,
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

// ContractRuntimeError wraps the actual circuit assertion (e.g. "Certificate
// has expired") in `.cause` and puts a generic "Error executing circuit ..."
// in `.message` — unwrap so the UI shows the reason instead of the wrapper.
function errorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback
  let deepest: Error = err
  let cause = (deepest as { cause?: unknown }).cause
  while (cause instanceof Error) {
    deepest = cause
    cause = (deepest as { cause?: unknown }).cause
  }
  if (typeof cause === 'string' && cause) return cause
  return deepest.message || err.message
}

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
    <div className="relative h-svh overflow-hidden bg-black text-foreground">
      <InteractiveDotGrid className="pointer-events-none absolute inset-x-0 top-0 h-[650px] w-full" />
      <div className="noise-overlay pointer-events-none fixed inset-0" />

      <RoleWatermark
        word={role === 'holder' ? 'Holder' : 'Issuer'}
        top={watermarkTop}
      />

      <div className="relative flex h-full flex-col">
        <header className="flex h-[92px] items-center justify-between border-b border-border px-8">
          <Link to="/" className="text-xl font-semibold">
            CertProof
          </Link>
          <WalletButton wallet={wallet} />
        </header>

        {wallet.status !== 'connected' && (
          <div className="border-b border-border bg-white/5 px-8 py-3 text-center text-base text-muted-foreground">
            Connect a Lace wallet to issue or prove on Preprod. Without one, this only shows the registry.
          </div>
        )}

        <main className="mx-auto w-full max-w-2xl flex-1 overflow-hidden px-8 py-16">
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
            {/* Both stay mounted so switching tabs (e.g. to submit a commitment
                as issuer) doesn't reset the holder's in-progress credential. */}
            <fieldset
              disabled={wallet.status !== 'connected'}
              className={`min-w-0 ${wallet.status !== 'connected' ? 'opacity-50' : ''}`}
            >
              <div hidden={role !== 'holder'}>
                <HolderFlow wallet={wallet} />
              </div>
              <div hidden={role !== 'issuer'}>
                <IssuerPanel wallet={wallet} />
              </div>
            </fieldset>
          </div>
        </main>
      </div>
    </div>
  )
}

function Field({
  label,
  ...props
}: {
  label: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-base">{label}</span>
      <input
        {...props}
        className="rounded-md border border-border bg-black px-4 py-2.5 text-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      />
    </label>
  )
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-white/5 px-4 py-3">
      <code className="flex-1 truncate font-mono text-base">{value}</code>
      <div className="relative">
        {copied && (
          <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-white px-2.5 py-1 text-sm font-medium text-black">
            Copied
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="rounded-full border border-border px-4 py-1.5 text-base transition-colors hover:bg-white/10"
        >
          Copy
        </button>
      </div>
    </div>
  )
}

type DeployState =
  | { status: 'idle' | 'deploying' }
  | { status: 'done'; address: string; secretKey: string }
  | { status: 'error'; error: string }

// ponytail: dev-only bootstrap tool, not part of the normal issuer flow. The
// CLI's own deploy script hits a wallet-sdk-dust-wallet/indexer schema
// mismatch on Preprod (SyncWalletError decoding dust ledger events); Lace
// pays its own fees and isn't affected, so this is the fallback way to mint
// a fresh contract until that SDK is fixed upstream.
function DeployNewContract({ wallet }: { wallet: Wallet }) {
  const [deploy, setDeploy] = useState<DeployState>({ status: 'idle' })

  async function handleDeploy() {
    if (wallet.status !== 'connected' || !wallet.api) {
      setDeploy({ status: 'error', error: 'Connect a Lace wallet first.' })
      return
    }
    setDeploy({ status: 'deploying' })
    try {
      const providers = await configureProviders(wallet.api, currentNetworkId())
      const issuerKey = crypto.getRandomValues(new Uint8Array(32))
      const contract = await deployCertProofContract(providers, issuerKey)
      setDeploy({
        status: 'done',
        address: contract.deployTxData.public.contractAddress,
        secretKey: '0x' + toHex(issuerKey),
      })
    } catch (err) {
      setDeploy({ status: 'error', error: errorMessage(err, 'Deploy failed.') })
    }
  }

  return (
    <details className="mt-10 rounded-md border border-border p-4">
      <summary className="cursor-pointer text-base text-muted-foreground">
        Deploy a new contract (dev)
      </summary>
      <p className="mt-3 text-base text-muted-foreground">
        Deploys via your connected Lace wallet, which pays its own fees. Save
        the address and secret key, then update CONTRACT_ADDRESS in
        midnight.ts and rebuild.
      </p>
      <button
        type="button"
        onClick={handleDeploy}
        disabled={deploy.status === 'deploying'}
        className="mt-4 rounded-full border border-border px-6 py-2.5 text-base transition-colors hover:bg-white/10 disabled:opacity-40"
      >
        {deploy.status === 'deploying' ? 'Deploying…' : 'Deploy new contract'}
      </button>
      {deploy.status === 'error' && (
        <p className="mt-4 text-base text-red-400">{deploy.error}</p>
      )}
      {deploy.status === 'done' && (
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <p className="mb-1 text-base">Contract address</p>
            <CopyField value={deploy.address} />
          </div>
          <div>
            <p className="mb-1 text-base">Issuer secret key</p>
            <CopyField value={deploy.secretKey} />
          </div>
        </div>
      )}
    </details>
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
      setError(errorMessage(err, 'Issuing failed.'))
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
        {issued ?? '-'} certificate{issued === 1 ? '' : 's'} issued
      </div>

      {/* ponytail: hidden unless ?dev=1 is on the URL, so it never shows up
          in a demo recording of the plain /app route. */}
      {new URLSearchParams(window.location.search).has('dev') && (
        <DeployNewContract wallet={wallet} />
      )}
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
  const [copied, setCopied] = useState(false)
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
    if (wallet.status !== 'connected' || !wallet.api) {
      setError('Connect a Lace wallet first.')
      setStage('error')
      return
    }
    try {
      toBytes32(credential.name)
      toBytes32(credential.certificateId)
      toBytes32(credential.grade)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credential field.')
      setStage('error')
      return
    }
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
      setError(errorMessage(err, 'Proof failed.'))
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
          These fields stay on this device. Only a commitment - a hash of all
          of it - will ever leave it.
        </p>

        <div className="mt-8 flex flex-col gap-5">
          <Field
            label="Name"
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
          <div className="relative">
            {copied && (
              <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-white px-2.5 py-1 text-sm font-medium text-black">
                Copied
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(commitment)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="rounded-full border border-border px-4 py-1.5 text-base transition-colors hover:bg-white/10"
            >
              Copy
            </button>
          </div>
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
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm tabular-nums ${
                  i === provingStep ? 'border-foreground' : 'border-border'
                }`}
              >
                {i === provingStep && (
                  <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-foreground" />
                )}
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
        verification - nothing else.
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
