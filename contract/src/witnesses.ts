import { Ledger, pureCircuits } from "./managed/certproof/contract/index.js";
import type {
  MerkleTreePath,
  WitnessContext
} from "@midnight-ntwrk/compact-runtime";

const EMPTY_32 = new Uint8Array(32);

export type CertProofPrivateState = {
  readonly secretKey: Uint8Array;
  readonly certificateId: Uint8Array;
  readonly holderName: Uint8Array;
  readonly grade: Uint8Array;
  readonly expiryDate: bigint;
  readonly credentialSecret: Uint8Array;
  readonly salt: Uint8Array;
};

export type HolderCredential = {
  readonly certificateId: Uint8Array;
  readonly holderName: Uint8Array;
  readonly grade: Uint8Array;
  readonly expiryDate: bigint;
  readonly credentialSecret: Uint8Array;
  readonly salt: Uint8Array;
};

// Issuer role: only the signing key matters, the rest are unused padding.
export const createIssuerPrivateState = (
  secretKey: Uint8Array
): CertProofPrivateState => ({
  secretKey,
  certificateId: EMPTY_32,
  holderName: EMPTY_32,
  grade: EMPTY_32,
  expiryDate: 0n,
  credentialSecret: EMPTY_32,
  salt: EMPTY_32
});

// Holder role: the signing key is unused, the credential fields matter.
export const createHolderPrivateState = (
  credential: HolderCredential
): CertProofPrivateState => ({
  secretKey: EMPTY_32,
  ...credential
});

// The commitment a holder hands to the issuer off-chain — same hash the
// circuit recomputes internally, exposed here so callers never have to
// duplicate the field ordering.
export const commitmentOf = (state: CertProofPrivateState): Uint8Array =>
  pureCircuits.computeCommitment(
    state.certificateId,
    state.holderName,
    state.grade,
    state.expiryDate,
    state.credentialSecret,
    state.salt
  );

export const witnesses = {
  localSecretKey: ({
    privateState
  }: WitnessContext<Ledger, CertProofPrivateState>): [
    CertProofPrivateState,
    Uint8Array
  ] => [privateState, privateState.secretKey],
  localCertificateId: ({
    privateState
  }: WitnessContext<Ledger, CertProofPrivateState>): [
    CertProofPrivateState,
    Uint8Array
  ] => [privateState, privateState.certificateId],
  localHolderName: ({
    privateState
  }: WitnessContext<Ledger, CertProofPrivateState>): [
    CertProofPrivateState,
    Uint8Array
  ] => [privateState, privateState.holderName],
  localGrade: ({
    privateState
  }: WitnessContext<Ledger, CertProofPrivateState>): [
    CertProofPrivateState,
    Uint8Array
  ] => [privateState, privateState.grade],
  localExpiryDate: ({
    privateState
  }: WitnessContext<Ledger, CertProofPrivateState>): [
    CertProofPrivateState,
    bigint
  ] => [privateState, privateState.expiryDate],
  localCredentialSecret: ({
    privateState
  }: WitnessContext<Ledger, CertProofPrivateState>): [
    CertProofPrivateState,
    Uint8Array
  ] => [privateState, privateState.credentialSecret],
  localSalt: ({
    privateState
  }: WitnessContext<Ledger, CertProofPrivateState>): [
    CertProofPrivateState,
    Uint8Array
  ] => [privateState, privateState.salt],
  // Built on demand from the current public tree state rather than stored
  // in private state: the path only stays correct as long as it matches
  // the registry's current shape, so it must be re-derived per call.
  localMerklePath: (
    context: WitnessContext<Ledger, CertProofPrivateState>
  ): [CertProofPrivateState, MerkleTreePath<Uint8Array>] => {
    const commitment = commitmentOf(context.privateState);
    const path = context.ledger.commitments.findPathForLeaf(commitment);
    if (path === undefined) {
      throw new Error(
        "Certificate commitment not found in the registry — has it been issued yet?"
      );
    }
    return [context.privateState, path];
  }
};
