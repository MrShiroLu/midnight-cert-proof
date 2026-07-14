import {
  type CircuitContext,
  type ProofData,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  type Witnesses,
  ledger,
  pureCircuits
} from "../managed/certproof/contract/index.js";
import {
  type CertProofPrivateState,
  type HolderCredential,
  witnesses,
  createIssuerPrivateState,
  createHolderPrivateState,
  commitmentOf
} from "../witnesses.js";

export class CertProofSimulator {
  readonly contract: Contract<CertProofPrivateState>;
  circuitContext: CircuitContext<CertProofPrivateState>;
  // The proof data (incl. public transcript) from the most recent impure
  // circuit call — kept around so privacy tests can inspect exactly what a
  // chain observer would see for that call.
  lastProofData: ProofData | undefined;

  constructor(
    callerState: CertProofPrivateState,
    issuerSecretKey: Uint8Array,
    // Overridable so adversarial tests can inject a tampered witness (e.g.
    // a corrupted Merkle path) without touching the production witnesses.
    customWitnesses: Witnesses<CertProofPrivateState> = witnesses
  ) {
    this.contract = new Contract<CertProofPrivateState>(customWitnesses);
    const issuerPk = pureCircuits.issuerPublicKey(issuerSecretKey);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext(callerState, "0".repeat(64)),
      issuerPk
    );
    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState
    );
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public switchTo(state: CertProofPrivateState): void {
    this.circuitContext = {
      ...this.circuitContext,
      currentPrivateState: state
    };
  }

  public issue(commitment: Uint8Array): Ledger {
    const result = this.contract.impureCircuits.issue(
      this.circuitContext,
      commitment
    );
    this.circuitContext = result.context;
    this.lastProofData = result.proofData;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public proveAndAccess(today: bigint): Ledger {
    const result = this.contract.impureCircuits.prove_and_access(
      this.circuitContext,
      today
    );
    this.circuitContext = result.context;
    this.lastProofData = result.proofData;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public verifyOnly(today: bigint): Ledger {
    const result = this.contract.impureCircuits.verify_only(
      this.circuitContext,
      today
    );
    this.circuitContext = result.context;
    this.lastProofData = result.proofData;
    return ledger(this.circuitContext.currentQueryContext.state);
  }
}

export const issuerPublicKeyOf = (secretKey: Uint8Array): Uint8Array =>
  pureCircuits.issuerPublicKey(secretKey);

export const commitmentOfCredential = (
  credential: HolderCredential
): Uint8Array => commitmentOf(createHolderPrivateState(credential));

export { createIssuerPrivateState, createHolderPrivateState };
export type { HolderCredential };
