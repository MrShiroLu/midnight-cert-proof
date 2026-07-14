import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  localCertificateId(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  localHolderName(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  localGrade(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  localExpiryDate(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  localCredentialSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  localSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  localMerklePath(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                                path: { sibling: { field: bigint
                                                                                                 },
                                                                                        goes_left: boolean
                                                                                      }[]
                                                                              }];
}

export type ImpureCircuits<PS> = {
  issue(context: __compactRuntime.CircuitContext<PS>, commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  prove_and_access(context: __compactRuntime.CircuitContext<PS>, today_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verify_only(context: __compactRuntime.CircuitContext<PS>, today_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  issue(context: __compactRuntime.CircuitContext<PS>, commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  prove_and_access(context: __compactRuntime.CircuitContext<PS>, today_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verify_only(context: __compactRuntime.CircuitContext<PS>, today_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  issuerPublicKey(sk_0: Uint8Array): Uint8Array;
  computeCommitment(certificateId_0: Uint8Array,
                    holderName_0: Uint8Array,
                    grade_0: Uint8Array,
                    expiryDate_0: bigint,
                    credentialSecret_0: Uint8Array,
                    salt_0: Uint8Array): Uint8Array;
  computeNullifier(credentialSecret_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  issue(context: __compactRuntime.CircuitContext<PS>, commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  prove_and_access(context: __compactRuntime.CircuitContext<PS>, today_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verify_only(context: __compactRuntime.CircuitContext<PS>, today_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  issuerPublicKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  computeCommitment(context: __compactRuntime.CircuitContext<PS>,
                    certificateId_0: Uint8Array,
                    holderName_0: Uint8Array,
                    grade_0: Uint8Array,
                    expiryDate_0: bigint,
                    credentialSecret_0: Uint8Array,
                    salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  computeNullifier(context: __compactRuntime.CircuitContext<PS>,
                   credentialSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type Ledger = {
  readonly issuerPk: Uint8Array;
  commitments: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined
  };
  nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly issuedCount: bigint;
  readonly verifiedCount: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               issuerPublicKey_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
