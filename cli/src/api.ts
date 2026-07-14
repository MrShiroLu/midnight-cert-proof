/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  CertProof,
  type CertProofPrivateState,
  type HolderCredential,
  witnesses,
  createIssuerPrivateState,
  createHolderPrivateState,
  commitmentOf,
} from '@midnight-ntwrk/certproof-contract';
import { randomBytes } from 'node:crypto';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { type FinalizedTxData, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import {
  type CertProofCircuits,
  CertProofPrivateStateId,
  type CertProofProviders,
  type DeployedCertProofContract,
} from './common-types.js';
import { type Config, contractConfig, PreprodConfig } from './config.js';
import { createLogger } from './logger-utils.js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js/utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Buffer } from 'buffer';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

let logger: Logger;

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const certProofCompiledContract = CompiledContract.make('certproof', CertProof.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

export { createIssuerPrivateState, createHolderPrivateState, commitmentOf };
export type { HolderCredential, CertProofPrivateState };

export const generateSecretKey = (): Uint8Array => new Uint8Array(randomBytes(32));

export const generateCredentialFields = (): {
  credentialSecret: Uint8Array;
  salt: Uint8Array;
} => ({
  credentialSecret: new Uint8Array(randomBytes(32)),
  salt: new Uint8Array(randomBytes(32)),
});

export const issuerPublicKeyOf = (secretKey: Uint8Array): Uint8Array =>
  CertProof.pureCircuits.issuerPublicKey(secretKey);

/** Encodes a UTF-8 string into a left-padded, null-terminated 32-byte field. */
export const toBytes32 = (value: string): Uint8Array => {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > 32) {
    throw new Error(`Value "${value}" is longer than 32 bytes once UTF-8 encoded`);
  }
  const out = new Uint8Array(32);
  out.set(encoded);
  return out;
};

/** Day-level epoch (matches the contract's `Uint<64>` expiry/today convention). */
export const daysSinceEpoch = (date: Date): bigint => BigInt(Math.floor(date.getTime() / 86_400_000));

export const getRegistryState = async (
  providers: CertProofProviders,
  contractAddress: ContractAddress,
): Promise<{ issued: bigint; verified: bigint } | null> => {
  assertIsContractAddress(contractAddress);
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (state === null) return null;
  const certProofLedger = CertProof.ledger(state.data);
  return { issued: certProofLedger.issuedCount, verified: certProofLedger.verifiedCount };
};

export const joinContract = async (
  providers: CertProofProviders,
  contractAddress: string,
  privateState: CertProofPrivateState,
): Promise<DeployedCertProofContract> => {
  const certProofContract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: certProofCompiledContract,
    privateStateId: 'certProofPrivateState',
    initialPrivateState: privateState,
  });
  logger.info(`Joined contract at address: ${certProofContract.deployTxData.public.contractAddress}`);
  return certProofContract;
};

export const deploy = async (
  providers: CertProofProviders,
  issuerSecretKey: Uint8Array,
): Promise<DeployedCertProofContract> => {
  logger.info('Deploying CertProof contract...');
  const issuerPk = issuerPublicKeyOf(issuerSecretKey);
  const certProofContract = await deployContract(providers, {
    compiledContract: certProofCompiledContract,
    privateStateId: 'certProofPrivateState',
    initialPrivateState: createIssuerPrivateState(issuerSecretKey),
    args: [issuerPk],
  });
  logger.info(`Deployed contract at address: ${certProofContract.deployTxData.public.contractAddress}`);
  return certProofContract;
};

/**
 * Switches which private state the local witnesses read for the next
 * circuit call. In this demo a single wallet submits every transaction, but
 * the private state (and therefore which credential/secret a circuit sees)
 * can be swapped per call to simulate issuer vs. holder turns.
 */
export const setActivePrivateState = async (
  providers: CertProofProviders,
  privateState: CertProofPrivateState,
): Promise<void> => {
  await providers.privateStateProvider.set('certProofPrivateState', privateState);
};

export const issueCertificate = async (
  certProofContract: DeployedCertProofContract,
  commitment: Uint8Array,
): Promise<FinalizedTxData> => {
  logger.info(`Issuing commitment ${toHex(commitment)}...`);
  const finalizedTxData = await certProofContract.callTx.issue(commitment);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const proveAndAccess = async (
  certProofContract: DeployedCertProofContract,
  today: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Proving certificate membership (today=${today})...`);
  const finalizedTxData = await certProofContract.callTx.prove_and_access(today);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const verifyOnly = async (
  certProofContract: DeployedCertProofContract,
  today: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Verifying certificate membership without consuming a nullifier (today=${today})...`);
  const finalizedTxData = await certProofContract.callTx.verify_only(today);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

/**
 * Sign all unshielded offers in a transaction's intents, using the correct
 * proof marker for Intent.deserialize. This works around a bug in the wallet
 * SDK where signRecipe hardcodes 'pre-proof', which fails for proven
 * (UnboundTransaction) intents that contain 'proof' data.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

/**
 * CertProof never touches shielded (ZSwap) tokens, so we don't wait on that
 * scan. We also don't wait for the Dust generation Merkle index's own
 * `isStrictlyComplete()` — for a fresh wallet that index can be well over a
 * million entries behind the chain tip and can take an hour+ to fully catch
 * up, even though the wallet's own Dust balance/coins are already visible
 * long before that global index finishes. We only require the unshielded
 * (NIGHT) section, which is what actually gates knowing our own balance.
 */
const isReadyForUnshieldedOps = (state: { unshielded: { progress: { isStrictlyComplete(): boolean } } }): boolean =>
  state.unshielded.progress.isStrictlyComplete();

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => isReadyForUnshieldedOps(s))));
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );

      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }

      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as any;
    },
  };
};

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => isReadyForUnshieldedOps(s)),
    ),
  );

export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((s) => isReadyForUnshieldedOps(s)),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryCommonSchema),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  },
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

/**
 * Derive HD wallet keys for all three roles (Zswap, NightExternal, Dust)
 * from a hex-encoded seed using BIP-44 style derivation at account 0, index 0.
 */
const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }

  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

const formatBalance = (balance: bigint): string => balance.toLocaleString();

const DIV = '──────────────────────────────────────────────────────────────';

export const withStatus = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
  process.stdout.write(`  ... ${message}\n`);
  try {
    const result = await fn();
    process.stdout.write(`  OK  ${message}\n`);
    return result;
  } catch (e) {
    process.stdout.write(`  FAIL ${message}\n`);
    throw e;
  }
};

/**
 * Register unshielded NIGHT UTXOs for dust generation.
 *
 * On Preprod/Preview, NIGHT tokens generate DUST over time, but only after
 * the UTXOs have been explicitly designated for dust generation via an on-chain
 * transaction. DUST is the non-transferable fee token used by the Midnight network.
 */
const waitForDust = (wallet: WalletFacade): Promise<bigint> =>
  withStatus('Waiting for dust tokens to generate', () =>
    Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => isReadyForUnshieldedOps(s)),
        Rx.map((s) => s.dust.balance(new Date())),
        Rx.filter((balance) => balance > 0n),
      ),
    ),
  );

const registerForDustGeneration = async (
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => isReadyForUnshieldedOps(s))));

  if (state.dust.availableCoins.length > 0) {
    const dustBal = state.dust.balance(new Date());
    console.log(`  Dust tokens already available (${formatBalance(dustBal)} DUST)`);
    return;
  }

  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length === 0) {
    await waitForDust(wallet);
    return;
  }

  await withStatus(`Registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation`, async () => {
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);
  });

  await waitForDust(wallet);
};

const printWalletSummary = (state: any, unshieldedKeystore: UnshieldedKeystore) => {
  const networkId = getNetworkId();
  const unshieldedBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

  let shieldedAddress = '(unavailable)';
  try {
    const coinPubKey = ShieldedCoinPublicKey.fromHexString(state.shielded.coinPublicKey.toHexString());
    const encPubKey = ShieldedEncryptionPublicKey.fromHexString(state.shielded.encryptionPublicKey.toHexString());
    shieldedAddress = MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey)).toString();
  } catch {
    // display-only, not required for the certproof flow
  }

  let dustAddress = '(unavailable)';
  try {
    dustAddress = MidnightBech32m.encode(networkId, state.dust.address).toString();
  } catch {
    // display-only
  }

  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}

  Shielded (ZSwap)
  └─ Address: ${shieldedAddress}

  Unshielded
  ├─ Address: ${unshieldedKeystore.getBech32Address()}
  └─ Balance: ${formatBalance(unshieldedBalance)} tNight

  Dust
  └─ Address: ${dustAddress}

${DIV}`);
};

export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  console.log('');

  const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await withStatus(
    'Building wallet',
    async () => {
      const keys = deriveKeysFromSeed(seed);
      const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
      const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
      const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

      const walletConfig = {
        ...buildShieldedConfig(config),
        ...buildUnshieldedConfig(config),
        ...buildDustConfig(config),
      };
      const wallet = await WalletFacade.init({
        configuration: walletConfig,
        shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
        unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
        dust: (cfg) =>
          DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
      });
      await wallet.start(shieldedSecretKeys, dustSecretKey);

      return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
    },
  );

  const networkId = getNetworkId();
  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}
  Unshielded Address (send tNight here):
  ${unshieldedKeystore.getBech32Address()}

  Fund your wallet with tNight from the ${networkId} faucet:
  https://faucet.${networkId}.midnight.network/
${DIV}
`);

  const syncedState = await withStatus('Syncing with network', () => waitForSync(wallet));
  printWalletSummary(syncedState, unshieldedKeystore);

  const balance = syncedState.unshielded.balances[unshieldedToken().raw] ?? 0n;
  if (balance === 0n) {
    const fundedBalance = await withStatus('Waiting for incoming tokens', () => waitForFunds(wallet));
    console.log(`    Balance: ${formatBalance(fundedBalance)} tNight\n`);
  }

  await registerForDustGeneration(wallet, unshieldedKeystore);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

/**
 * Configure all midnight-js providers needed for contract deployment and interaction.
 * This wires together the wallet, proof server, indexer, and private state storage.
 */
export const configureProviders = async (ctx: WalletContext, config: Config) => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<CertProofCircuits>(contractConfig.zkConfigPath);
  // accountId and privateStoragePasswordProvider are required by levelPrivateStateProvider.
  // The coin public key is encoded as base64 for the password — base64 output covers all
  // four character classes and avoids repeated-character runs found in raw hex strings.
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  return {
    privateStateProvider: levelPrivateStateProvider<typeof CertProofPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}

export const bootstrap = async (seed: string) => {
  const config = new PreprodConfig();
  const walletLogger = await createLogger(config.logDir);
  setLogger(walletLogger);
  const walletCtx = await buildWalletAndWaitForFunds(config, seed);
  const providers = await configureProviders(walletCtx, config);
  return { walletCtx, providers };
};

export { generateRandomSeed };
