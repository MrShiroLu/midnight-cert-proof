import { useState } from 'react'
import { shortenAddress, useWallet } from './wallet'

export function WalletButton() {
  const { status, address, walletName, error, connect } = useWallet()
  const [showError, setShowError] = useState(false)

  async function handleClick() {
    if (status === 'connected' || status === 'connecting') return
    await connect()
    setShowError(true)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === 'connecting'}
        className="rounded-full border border-border px-5 py-2 text-base transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60"
      >
        {status === 'connected' && address
          ? `${walletName ?? 'Wallet'} · ${shortenAddress(address)}`
          : status === 'connecting'
            ? 'Connecting…'
            : 'Connect Wallet'}
      </button>
      {status === 'error' && showError && (
        <div className="absolute right-0 top-full z-10 mt-2 w-64 rounded-md border border-border bg-black px-4 py-3 text-base text-muted-foreground shadow-lg">
          {error}
        </div>
      )}
    </div>
  )
}
