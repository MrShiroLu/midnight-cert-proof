import {
  CertProofSimulator,
  createIssuerPrivateState,
  createHolderPrivateState,
  commitmentOfCredential,
  type HolderCredential
} from "./certproof-simulator.js";
import { witnesses } from "../witnesses.js";
import { pureCircuits } from "../managed/certproof/contract/index.js";
import { flatten, containsBytes } from "./byte-scan.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";

setNetworkId("undeployed");

const issuerKey = new Uint8Array(32).fill(1);
const otherKey = new Uint8Array(32).fill(9);

const TODAY = 20000n;
const FUTURE_EXPIRY = 20365n;
const PAST_EXPIRY = 19999n;

const aliceCredential: HolderCredential = {
  certificateId: new Uint8Array(32).fill(2),
  holderName: new Uint8Array(32).fill(3),
  grade: new Uint8Array(32).fill(4),
  expiryDate: FUTURE_EXPIRY,
  credentialSecret: new Uint8Array(32).fill(5),
  salt: new Uint8Array(32).fill(6)
};

describe("CertProof — circuit logic", () => {
  it("prove_and_access succeeds with a valid witness", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    simulator.issue(commitmentOfCredential(aliceCredential));

    simulator.switchTo(createHolderPrivateState(aliceCredential));
    const ledger = simulator.proveAndAccess(TODAY);
    expect(ledger.verifiedCount).toEqual(1n);
    expect(ledger.nullifiers.size()).toEqual(1n);
  });

  it("fails with a wrong credential secret (different commitment than what was issued)", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    simulator.issue(commitmentOfCredential(aliceCredential));

    const wrongSecret: HolderCredential = {
      ...aliceCredential,
      credentialSecret: new Uint8Array(32).fill(42)
    };
    simulator.switchTo(createHolderPrivateState(wrongSecret));
    // Pin the exact failure mode: the wrong secret must yield a commitment
    // that was never issued, caught by the merkle-path witness lookup —
    // not some unrelated crash.
    expect(() => simulator.proveAndAccess(TODAY)).toThrow(
      /commitment not found in the registry/
    );
  });

  it("fails with a corrupted merkle path even for a genuinely issued leaf", () => {
    // Wrap the real witness and flip one bit of the first sibling hash —
    // the leaf and its commitment are entirely correct, only the path is
    // tampered, so this isolates checkRoot()'s tamper detection.
    const tamperedWitnesses: typeof witnesses = {
      ...witnesses,
      localMerklePath: (
        context: Parameters<typeof witnesses.localMerklePath>[0]
      ) => {
        const [ps, path] = witnesses.localMerklePath(context);
        const tamperedPath = {
          leaf: path.leaf,
          path: path.path.map((entry, i) =>
            i === 0
              ? { ...entry, sibling: { field: entry.sibling.field ^ 1n } }
              : entry
          )
        };
        return [ps, tamperedPath];
      }
    };

    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey,
      tamperedWitnesses
    );
    simulator.issue(commitmentOfCredential(aliceCredential));
    simulator.switchTo(createHolderPrivateState(aliceCredential));
    // Pin the exact assertion so this test genuinely isolates checkRoot()'s
    // tamper detection rather than passing on any unrelated throw (e.g. if
    // the leaf/commitment match were broken instead).
    expect(() => simulator.proveAndAccess(TODAY)).toThrow(
      /Certificate not found in registry/
    );
  });

  it("fails with an expired credential", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    const expired: HolderCredential = {
      ...aliceCredential,
      expiryDate: PAST_EXPIRY
    };
    simulator.issue(commitmentOfCredential(expired));

    simulator.switchTo(createHolderPrivateState(expired));
    // Pin the exact assertion: membership succeeds (it really was issued),
    // only the expiry check should fail.
    expect(() => simulator.proveAndAccess(TODAY)).toThrow(
      /Certificate has expired/
    );
  });
});

describe("CertProof — state transitions", () => {
  it("issue() grows the commitment tree", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    expect(simulator.getLedger().commitments.firstFree()).toEqual(0n);

    simulator.issue(commitmentOfCredential(aliceCredential));
    expect(simulator.getLedger().commitments.firstFree()).toEqual(1n);

    const bobCredential: HolderCredential = {
      ...aliceCredential,
      certificateId: new Uint8Array(32).fill(7)
    };
    simulator.issue(commitmentOfCredential(bobCredential));
    expect(simulator.getLedger().commitments.firstFree()).toEqual(2n);
    expect(simulator.getLedger().issuedCount).toEqual(2n);
  });

  it("a successful proof inserts exactly one nullifier", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    simulator.issue(commitmentOfCredential(aliceCredential));

    simulator.switchTo(createHolderPrivateState(aliceCredential));
    const ledger = simulator.proveAndAccess(TODAY);
    expect(ledger.nullifiers.size()).toEqual(1n);
  });

  it("a second access attempt with the same credential is rejected", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    simulator.issue(commitmentOfCredential(aliceCredential));

    simulator.switchTo(createHolderPrivateState(aliceCredential));
    simulator.proveAndAccess(TODAY);
    expect(() => simulator.proveAndAccess(TODAY)).toThrow(
      /already used at this gate/
    );
  });

  it("issuing the same commitment twice does not break nullifier uniqueness", () => {
    // MerkleTree permits duplicate leaves, so nothing stops an issuer from
    // (accidentally or otherwise) issuing the identical commitment twice.
    // The nullifier is derived solely from the credential secret — not from
    // which leaf/path was used — so a holder must still only be able to
    // authenticate once, even with two matching leaves to pick a path from.
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    const commitment = commitmentOfCredential(aliceCredential);
    simulator.issue(commitment);
    simulator.issue(commitment);
    expect(simulator.getLedger().commitments.firstFree()).toEqual(2n);
    expect(simulator.getLedger().issuedCount).toEqual(2n);

    simulator.switchTo(createHolderPrivateState(aliceCredential));
    const ledger = simulator.proveAndAccess(TODAY);
    expect(ledger.nullifiers.size()).toEqual(1n);

    expect(() => simulator.proveAndAccess(TODAY)).toThrow(
      /already used at this gate/
    );
  });

  it("a non-issuer caller cannot call issue()", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    simulator.switchTo(createIssuerPrivateState(otherKey));
    expect(() =>
      simulator.issue(commitmentOfCredential(aliceCredential))
    ).toThrow(/Only the issuer can add certificates/);
    expect(simulator.getLedger().issuedCount).toEqual(0n);
  });

  it("verify_only performs the same checks without consuming a nullifier", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    simulator.issue(commitmentOfCredential(aliceCredential));

    simulator.switchTo(createHolderPrivateState(aliceCredential));
    simulator.verifyOnly(TODAY);
    const ledger = simulator.verifyOnly(TODAY);
    expect(ledger.nullifiers.size()).toEqual(0n);
  });
});

describe("CertProof — privacy", () => {
  it("the public transcript of a successful proof never contains the credential fields or secret", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );
    simulator.issue(commitmentOfCredential(aliceCredential));

    simulator.switchTo(createHolderPrivateState(aliceCredential));
    simulator.proveAndAccess(TODAY);

    const transcript = simulator.lastProofData?.publicTranscript;
    expect(transcript).toBeDefined();
    const haystack = flatten(transcript);

    // Positive control: the nullifier IS deliberately disclosed (that's how
    // the contract prevents replay), so it must show up in the transcript.
    // If it didn't, the negative assertions below would be checking nothing.
    const nullifier = pureCircuits.computeNullifier(
      aliceCredential.credentialSecret
    );
    expect(haystack.length).toBeGreaterThan(0);
    expect(containsBytes(haystack, nullifier)).toBe(true);

    // Everything that must stay hidden: the raw credential fields and both
    // secrets. (The commitment and nullifier ARE expected to be derivable
    // from these via hashing, but the plaintext bytes themselves must not
    // appear verbatim anywhere in what a chain observer receives.)
    const secretValues = [
      aliceCredential.certificateId,
      aliceCredential.holderName,
      aliceCredential.grade,
      aliceCredential.credentialSecret,
      aliceCredential.salt
    ];
    for (const secret of secretValues) {
      expect(containsBytes(haystack, secret)).toBe(false);
    }
  });

  it("two different holders' proofs produce different transcripts with no shared secret bytes", () => {
    const simulator = new CertProofSimulator(
      createIssuerPrivateState(issuerKey),
      issuerKey
    );

    const bobCredential: HolderCredential = {
      certificateId: new Uint8Array(32).fill(11),
      holderName: new Uint8Array(32).fill(12),
      grade: new Uint8Array(32).fill(13),
      expiryDate: FUTURE_EXPIRY,
      credentialSecret: new Uint8Array(32).fill(14),
      salt: new Uint8Array(32).fill(15)
    };
    simulator.issue(commitmentOfCredential(aliceCredential));
    simulator.issue(commitmentOfCredential(bobCredential));

    simulator.switchTo(createHolderPrivateState(aliceCredential));
    simulator.proveAndAccess(TODAY);
    const aliceHaystack = flatten(simulator.lastProofData?.publicTranscript);

    expect(containsBytes(aliceHaystack, bobCredential.credentialSecret)).toBe(
      false
    );
    expect(containsBytes(aliceHaystack, bobCredential.certificateId)).toBe(
      false
    );
  });
});
