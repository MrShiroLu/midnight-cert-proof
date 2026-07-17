import { useCallback, useState } from 'react'
import '@midnight-ntwrk/dapp-connector-api'
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api'

const PREPROD_NETWORK_ID = 'preprod'
// Long on purpose: connect() only resolves after the user unlocks Lace and
// approves the popup, which easily takes more than 30s.
const CONNECT_TIMEOUT_MS = 120_000

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), CONNECT_TIMEOUT_MS),
    ),
  ])
}

type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

type WalletState = {
  status: WalletStatus
  walletName: string | null
  address: string | null
  api: ConnectedAPI | null
  error: string | null
}

const initialState: WalletState = {
  status: 'disconnected',
  walletName: null,
  address: null,
  api: null,
  error: null,
}

export function useWallet() {
  const [state, setState] = useState<WalletState>(initialState)

  const connect = useCallback(async () => {
    const injected = window.midnight
    if (!injected) {
      setState({
        ...initialState,
        status: 'error',
        error: 'No Midnight wallet found. Install Lace to continue.',
      })
      return
    }

    // A wallet can inject several API versions; prefer the v4 entry instead
    // of whatever happens to enumerate first.
    console.info('[wallet] injected midnight APIs:',
      Object.entries(injected).map(([k, v]) => `${k} (${v.name} ${v.apiVersion})`))
    const walletKey =
      Object.keys(injected).find((k) =>
        injected[k].apiVersion?.startsWith('4') && typeof injected[k].connect === 'function',
      ) ?? Object.keys(injected)[0]
    if (!walletKey) {
      setState({
        ...initialState,
        status: 'error',
        error: 'No Midnight wallet found. Install Lace to continue.',
      })
      return
    }

    setState((s) => ({ ...s, status: 'connecting', error: null }))

    try {
      const initialApi = injected[walletKey]
      const connectedApi = await withTimeout(
        initialApi.connect(PREPROD_NETWORK_ID),
        'Wallet did not respond in 30s. Check Lace for a pending approval and that it has finished syncing Preprod.',
      )
      const { unshieldedAddress } = await withTimeout(
        connectedApi.getUnshieldedAddress(),
        'Wallet did not return an address in 30s. Check that Lace has finished syncing Preprod.',
      )
      setState({
        status: 'connected',
        walletName: initialApi.name,
        address: unshieldedAddress,
        api: connectedApi,
        error: null,
      })
    } catch (err) {
      setState({
        ...initialState,
        status: 'error',
        error:
          err instanceof Error
            ? err.message
            : 'Wallet connection was rejected.',
      })
    }
  }, [])

  const disconnect = useCallback(() => setState(initialState), [])

  return { ...state, connect, disconnect }
}

export function shortenAddress(address: string) {
  return address.length > 12
    ? `${address.slice(0, 8)}…${address.slice(-6)}`
    : address
}
