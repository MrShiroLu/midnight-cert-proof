import { CertProof, type CertProofPrivateState } from '@midnight-ntwrk/certproof-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js/types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js/contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type CertProofCircuits = ProvableCircuitId<CertProof.Contract<CertProofPrivateState>>;

export const CertProofPrivateStateId = 'certProofPrivateState';

export type CertProofProviders = MidnightProviders<
  CertProofCircuits,
  typeof CertProofPrivateStateId,
  CertProofPrivateState
>;

export type CertProofContract = CertProof.Contract<CertProofPrivateState>;

export type DeployedCertProofContract = DeployedContract<CertProofContract> | FoundContract<CertProofContract>;
