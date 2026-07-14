// Wires the frontend to the real CertProof contract on Preprod. Mirrors the
// provider setup in cli/src/api.ts, but swaps the Node wallet SDK for the
// browser wallet the user already connected via wallet.ts (Lace's injected
// dapp-connector-api), and reads ZK artifacts over HTTP instead of the
// filesystem.
import {
  CertProof,
  type CertProofPrivateState,
  type HolderCredential,
  witnesses,
  createIssuerPrivateState,
  createHolderPrivateState,
  commitmentOf,
} from '@midnight-ntwrk/certproof-contract'
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime'
import { CompiledContract } from '@midnight-ntwrk/compact-js'
import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
} from '@midnight-ntwrk/midnight-js-types'
import type {
  MidnightProviders,
  WalletProvider,
  MidnightProvider,
  FinalizedTxData,
} from '@midnight-ntwrk/midnight-js/types'
import type {
  DeployedContract,
  FoundContract,
} from '@midnight-ntwrk/midnight-js/contracts'
import { findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts'
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js'
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider'
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider'
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js/network-id'
import { assertIsContractAddress, toHex, fromHex } from '@midnight-ntwrk/midnight-js/utils'
import * as ledger from '@midnight-ntwrk/ledger-v8'
import { MidnightBech32m, ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format'
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api'

setNetworkId('preprod')

// From README.md's Preprod Contract Address table.
export const CONTRACT_ADDRESS = '5d19ac150ab47c1b114e065675db18d593eb0934a85fafc5352a896fa474c47c'
const INDEXER = 'https://indexer.preprod.midnight.network/api/v3/graphql'
const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws'
const PROOF_SERVER = 'http://127.0.0.1:6300'
const ZK_BASE = `${import.meta.env.BASE_URL}zk`

export {
  type CertProofPrivateState,
  type HolderCredential,
  createIssuerPrivateState,
  createHolderPrivateState,
  commitmentOf,
}

export const issuerPublicKeyOf = (secretKey: Uint8Array): Uint8Array =>
  CertProof.pureCircuits.issuerPublicKey(secretKey)

/** Encodes a UTF-8 string into a left-padded, null-terminated 32-byte field. */
export const toBytes32 = (value: string): Uint8Array => {
  const encoded = new TextEncoder().encode(value)
  if (encoded.length > 32) {
    throw new Error(`Value "${value}" is longer than 32 bytes once UTF-8 encoded`)
  }
  const out = new Uint8Array(32)
  out.set(encoded)
  return out
}

/** Day-level epoch (matches the contract's `Uint<64>` expiry/today convention). */
export const daysSinceEpoch = (date: Date): bigint => BigInt(Math.floor(date.getTime() / 86_400_000))

type CertProofCircuits = ProvableCircuitId<CertProof.Contract<CertProofPrivateState>>
const CertProofPrivateStateId = 'certProofPrivateState'
type CertProofProviders = MidnightProviders<CertProofCircuits, typeof CertProofPrivateStateId, CertProofPrivateState>
type CertProofContract = CertProof.Contract<CertProofPrivateState>
export type DeployedCertProofContract = DeployedContract<CertProofContract> | FoundContract<CertProofContract>

// ponytail: no NodeZkConfigProvider equivalent ships for browsers — this is
// the same file layout (keys/<id>.prover|.verifier, zkir/<id>.bzkir) read
// over HTTP instead of fs. Artifacts are copied into public/zk/ by the
// "copy-zk" npm script (see package.json) before dev/build.
class FetchZkConfigProvider<K extends string> extends ZKConfigProvider<K> {
  private readonly baseUrl: string
  constructor(baseUrl: string) {
    super()
    this.baseUrl = baseUrl
  }
  private async fetchBytes(path: string): Promise<Uint8Array> {
    const res = await fetch(`${this.baseUrl}/${path}`)
    if (!res.ok) throw new Error(`Failed to fetch ZK artifact ${path}: ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  getProverKey(circuitId: K): Promise<ProverKey> {
    return this.fetchBytes(`keys/${circuitId}.prover`).then(createProverKey)
  }
  getVerifierKey(circuitId: K): Promise<VerifierKey> {
    return this.fetchBytes(`keys/${circuitId}.verifier`).then(createVerifierKey)
  }
  getZKIR(circuitId: K): Promise<ZKIR> {
    return this.fetchBytes(`zkir/${circuitId}.bzkir`).then(createZKIR)
  }
}

const certProofCompiledContract = CompiledContract.make('certproof', CertProof.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(ZK_BASE),
)

/**
 * Bridges the injected Lace wallet (dapp-connector-api, transaction-string
 * based) to the WalletProvider/MidnightProvider shape midnight-js expects
 * (typed ledger transaction objects). Mirrors cli/src/api.ts's Node wallet
 * adapter, but delegates balancing/signing/submission to the browser wallet
 * instead of a local wallet-sdk instance.
 *
 * ponytail: this is the one piece of the integration that cannot be
 * exercised without a live Lace wallet + reachable proof server — verify
 * against those before trusting it in production.
 */
export const createBrowserWalletProvider = async (
  connectedApi: ConnectedAPI,
  networkId: string,
): Promise<WalletProvider & MidnightProvider> => {
  const { shieldedAddress } = await connectedApi.getShieldedAddresses()
  const { coinPublicKey, encryptionPublicKey } = MidnightBech32m.parse(shieldedAddress).decode(
    ShieldedAddress,
    networkId,
  )

  return {
    getCoinPublicKey: () => coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => encryptionPublicKey.toHexString(),
    async balanceTx(tx) {
      const { tx: balancedHex } = await connectedApi.balanceUnsealedTransaction(toHex(tx.serialize()))
      return ledger.Transaction.deserialize('signature', 'proof', 'binding', fromHex(balancedHex)) as ReturnType<
        WalletProvider['balanceTx']
      > extends Promise<infer T>
        ? T
        : never
    },
    async submitTx(tx) {
      await connectedApi.submitTransaction(toHex(tx.serialize()))
      return tx.identifiers()[0]
    },
  }
}

export const configureProviders = async (
  connectedApi: ConnectedAPI,
  networkId: string,
): Promise<CertProofProviders> => {
  const walletProvider = await createBrowserWalletProvider(connectedApi, networkId)
  const accountId = walletProvider.getCoinPublicKey()
  const storagePassword = `${btoa(accountId)}!`
  const zkConfigProvider = new FetchZkConfigProvider<CertProofCircuits>(ZK_BASE)
  return {
    privateStateProvider: levelPrivateStateProvider<typeof CertProofPrivateStateId>({
      privateStateStoreName: 'certproof-private-state',
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(INDEXER, INDEXER_WS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(PROOF_SERVER, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  }
}

export const joinCertProofContract = async (
  providers: CertProofProviders,
  privateState: CertProofPrivateState,
): Promise<DeployedCertProofContract> =>
  findDeployedContract(providers, {
    contractAddress: CONTRACT_ADDRESS,
    compiledContract: certProofCompiledContract,
    privateStateId: CertProofPrivateStateId,
    initialPrivateState: privateState,
  })

export const setActivePrivateState = async (
  providers: CertProofProviders,
  privateState: CertProofPrivateState,
): Promise<void> => {
  await providers.privateStateProvider.set(CertProofPrivateStateId, privateState)
}

export const issueCertificate = async (
  contract: DeployedCertProofContract,
  commitment: Uint8Array,
): Promise<FinalizedTxData> => (await contract.callTx.issue(commitment)).public

export const proveAndAccess = async (
  contract: DeployedCertProofContract,
  today: bigint,
): Promise<FinalizedTxData> => (await contract.callTx.prove_and_access(today)).public

export const getRegistryState = async (
  contractAddress: ContractAddress = CONTRACT_ADDRESS,
): Promise<{ issued: bigint; verified: bigint } | null> => {
  assertIsContractAddress(contractAddress)
  const publicDataProvider = indexerPublicDataProvider(INDEXER, INDEXER_WS)
  const state = await publicDataProvider.queryContractState(contractAddress)
  if (state === null) return null
  const certProofLedger = CertProof.ledger(state.data)
  return { issued: certProofLedger.issuedCount, verified: certProofLedger.verifiedCount }
}

export const currentNetworkId = getNetworkId
export { toHex, fromHex }
