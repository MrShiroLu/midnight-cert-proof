/*
 * Adds a holder-supplied commitment to an already-deployed CertProof
 * registry, using the issuer's secret key.
 */

import { fromHex } from '@midnight-ntwrk/midnight-js/utils';
import * as api from './api.js';

const [SEED, ISSUER_SECRET_HEX, CONTRACT_ADDRESS, COMMITMENT_HEX] = process.argv.slice(2);
if (!SEED || !ISSUER_SECRET_HEX || !CONTRACT_ADDRESS || !COMMITMENT_HEX) {
  console.error('Usage: issue-certificate.ts <hex-seed> <issuer-secret-hex> <contract-address> <commitment-hex>');
  process.exit(1);
}

const { walletCtx, providers } = await api.bootstrap(SEED);

const issuerKey = fromHex(ISSUER_SECRET_HEX);
const certProofContract = await api.joinContract(providers, CONTRACT_ADDRESS, api.createIssuerPrivateState(issuerKey));

const finalized = await certProofContract.callTx.issue(fromHex(COMMITMENT_HEX));
console.log(`Issued commitment ${COMMITMENT_HEX} in tx ${finalized.public.txId}`);

await walletCtx.wallet.stop();
process.exit(0);
