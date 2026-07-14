/*
 * Deploys the CertProof contract to Preprod, issues one holder's
 * certificate commitment, proves it once (access granted), then attempts
 * to prove it a second time to show the nullifier rejecting replay.
 * Prints the deployed contract address for the README's contract table.
 */

import * as api from './api.js';

const SEED = process.argv[2];
if (!SEED) {
  console.error('Usage: deploy-demo.ts <hex-seed>');
  process.exit(1);
}

const { walletCtx, providers } = await api.bootstrap(SEED);

const issuerKey = api.generateSecretKey();
const { credentialSecret, salt } = api.generateCredentialFields();
const credential: api.HolderCredential = {
  certificateId: api.toBytes32('CERT-2026-0142'),
  holderName: api.toBytes32('Ada Lovelace'),
  grade: api.toBytes32('A'),
  expiryDate: api.daysSinceEpoch(new Date('2030-01-01')),
  credentialSecret,
  salt,
};

const holderPrivateState = api.createHolderPrivateState(credential);

const certProofContract = await api.withStatus('Deploying CertProof contract to Preprod', () =>
  api.deploy(providers, issuerKey),
);
const contractAddress = certProofContract.deployTxData.public.contractAddress;
console.log(`\n=== DEPLOYED CONTRACT ADDRESS: ${contractAddress} ===\n`);

const commitment = api.commitmentOf(holderPrivateState);
console.log(`=== HOLDER COMMITMENT (handed to issuer off-chain): 0x${Buffer.from(commitment).toString('hex')} ===\n`);

await api.withStatus('Issuer adds the commitment to the registry', () =>
  api.issueCertificate(certProofContract, commitment),
);

await api.setActivePrivateState(providers, holderPrivateState);
const today = api.daysSinceEpoch(new Date());

await api.withStatus('Holder proves the certificate and gains access', () =>
  api.proveAndAccess(certProofContract, today),
);

try {
  await api.withStatus('Holder attempts to reuse the same certificate at this gate', () =>
    api.proveAndAccess(certProofContract, today),
  );
  console.log('\n!!! Second proof unexpectedly succeeded — nullifier check did not reject replay !!!\n');
} catch (err) {
  console.log(`\n=== Second proof correctly rejected: ${err instanceof Error ? err.message : String(err)} ===\n`);
}

const registryState = await api.getRegistryState(providers, contractAddress);
console.log(`=== REGISTRY STATE: issued=${registryState?.issued} verified=${registryState?.verified} ===\n`);

await walletCtx.wallet.stop();
process.exit(0);
