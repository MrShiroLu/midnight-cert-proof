# CertProof

[![CI](https://github.com/MrShiroLu/certproof/actions/workflows/ci.yml/badge.svg)](https://github.com/MrShiroLu/certproof/actions/workflows/ci.yml)

> The badge above assumes this project is pushed to `github.com/MrShiroLu/certproof`.
> Update the owner/repo in the badge URL once the real repository is created.

A confidential certificate verification dApp on Midnight: an issuer registers a
certificate as an opaque commitment, and the holder later proves on-chain that
they hold a valid, unexpired certificate — without ever revealing its contents.

## Live Demo

[TO FILL IN — deploy the frontend (Vercel/Netlify) and link it here]

The proof server runs locally, so the demo page should show the same
"Prerequisites" box as below.

## Preprod Contract Address

| Contract | Network | Address |
|---|---|---|
| CertProof | Preprod | `5d19ac150ab47c1b114e065675db18d593eb0934a85fafc5352a896fa474c47c` |

## What This Does

- **Issuer** deploys the contract and adds certificate **commitments** to an
  on-chain registry (a Merkle tree). Only the issuer's key can call `issue`.
- **Holder** generates the credential fields and a secret locally, derives the
  commitment, and hands only the commitment to the issuer.
- **Holder** later calls `prove_and_access`: the circuit recomputes the
  commitment from the (private) credential fields + secret + Merkle path,
  checks membership in the registry, checks the certificate hasn't expired,
  and inserts a **nullifier** so the same certificate can't be used twice at
  the same gate.
- An on-chain observer sees that *a* valid certificate was proven — never
  which one, and never its contents.

## Privacy Model

| Data | Where it lives | Disclosed to |
|---|---|---|
| Commitment registry (Merkle tree) | Public ledger | Everyone (opaque hashes) |
| Nullifier set | Public ledger | Everyone (unlinkable to identity) |
| Issuer public key | Public ledger | Everyone |
| Credential fields (name, ID, grade, expiry) | Private witness | No one |
| Holder secret + salt | Private witness | No one |
| Merkle path | Private witness | No one |
| "Valid credential proven" result | Public | Everyone |

**PUBLIC** — issuer key, commitment tree, nullifier set, issued/verified counts.
**PRIVATE** — credential contents, holder secret, Merkle path; these never
leave the holder's device.
**PROVED without revealing** — that the holder possesses *some* valid,
unexpired, not-yet-used certificate in the registry.

## Privacy Claim

An observer watching the chain can see: how many certificates were issued,
how many successful verifications happened, and who the issuer is.
An observer **cannot** see: certificate contents, which certificate was
proven, the holder's identity, or any link between two proofs by the same
holder. This is verified directly in `contract/src/test/certproof.test.ts`,
which serializes the full public transcript of a successful proof and asserts
the credential fields and secret never appear at the byte level (see
`contract/src/test/byte-scan.ts`).

### Known limitations (honest, not hidden)

- **Expiry check**: Compact circuits have no trusted clock. `prove_and_access`
  takes "today" as a disclosed public input and asserts `expiryDate > today`;
  the chain does not independently verify that the supplied date is correct.
  Production would need block time or an issuer-advanced epoch counter.
- **Revocation**: proving non-membership in a revocation list while keeping
  the commitment hidden is out of scope for this submission. Validity is
  bounded only by expiry. See `PROPOSAL.md` for the roadmap treatment.

## Tech Stack

- **Contract**: [Compact](https://docs.midnight.network/) (Midnight's ZK
  smart contract language), compiled with `compact compile`.
- **Testing**: Vitest against the Compact contract simulator/runtime — no
  live chain required.
- **Frontend**: React 19 + Vite, React Router, Tailwind CSS, the Midnight
  Lace dApp connector (`@midnight-ntwrk/dapp-connector-api`).
- **CLI**: Node/TypeScript deployment script (`cli/`) using `midnight-js`
  and the wallet SDK to deploy the contract to Preprod from a seed-derived
  wallet and drive the issue → prove → replay-rejection flow end to end —
  this is how the Preprod contract address below was produced.
- **CI**: GitHub Actions — installs the pinned Compact toolchain, compiles
  the contract, runs the test suite, and builds/typechecks every workspace.

## Prerequisites

- Node.js 20+
- The [Compact compiler](https://docs.midnight.network/) if you want to
  recompile the contract yourself (CI pins and installs it automatically).
- A local Midnight proof server (Docker) and the [Lace](https://docs.midnight.network/)
  wallet extension connected to Preprod, if you want to exercise real proving
  and wallet connection rather than the frontend's simulated flow:

  ```bash
  docker run -p 6300:6300 midnightnetwork/proof-server -- 'midnight-proof-server --network preprod'
  ```

## Setup & Run Locally

```bash
npm install
npm run compact --workspace=contract   # recompile the circuits (optional, artifacts are checked in)
npm run dev --workspace=frontend       # http://localhost:5173
```

### Deploying to Preprod (CLI)

```bash
# 1. Start the local proof server (see Prerequisites above).
# 2. Fund a Preprod wallet: generate a seed, send it tNight from
#    https://faucet.preprod.midnight.network/, then:
npm run deploy --workspace=cli -- <hex-seed>
```

This deploys the contract, issues one demo commitment, proves it once
(access granted), and attempts to reuse it (rejected by the nullifier
check) — printing the deployed contract address for the table above.

## Run Tests

```bash
npm test --workspace=contract
```

## CI/CD

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests:
checkout → Node 22 → install the pinned Compact toolchain → `npm ci` →
compile the contract → run the test suite → build the contract package →
build the frontend → typecheck and build the CLI.

## Product Proposal

See [PROPOSAL.md](./PROPOSAL.md) for the product definition, Midnight
rationale, data model, and Mainnet feasibility notes.

## Project Layout

```
contract/   Compact contract source, compiled ZK circuit artifacts, witnesses, tests
cli/        Node/TypeScript CLI: deploys the contract to Preprod and drives the demo flow
frontend/   React + Vite app: Lace wallet connect, issuer panel, holder proof flow
```
