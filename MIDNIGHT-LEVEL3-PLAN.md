# Midnight Level 3 — Confidential Credentials: Implementation Plan

> This file temporarily lives in the astroBar repo; move it to the Midnight Level 2 repo.
> It contains no code — each phase describes WHAT to do and HOW to do it.

## 1. Product Summary

**CertProof** — a confidential certificate verification dApp.

An institution (issuer; e.g. a bootcamp/course provider) issues completion certificates
to participants. The certificate holder proves on-chain that the certificate is
**valid and unexpired** — but the certificate ID, name, grade and other contents
**never** touch the chain. When a proof succeeds, the contract records an "access"
grant (e.g. entry to an alumni-only area) and prevents the same certificate from
being used twice at the same gate via a nullifier.

Why Midnight: on a transparent chain this is solved either by publishing the
certificate in the clear or by trusting a centralized API. On Midnight, verification
happens on-chain while the contents stay entirely on the user's device.

## 2. Architecture

### Roles
- **Issuer**: The address that deploys the contract. Adds certificate commitments to the registry.
- **Holder**: Keeps the credential data and a secret key in local private state; generates proofs.
- **Verifier**: The contract itself. Produces a public result when the proof passes; anyone watching the chain can verify the outcome.

### Registry model (instead of signature verification)
Since in-circuit signature verification is impractical in Compact, we use a
**registry (commitment list)** model:

1. Issuance starts off-chain: the issuer verifies the holder's real-world identity
   through its own process.
2. The holder generates a `secret` on their device; a **commitment** (persistent hash)
   is computed from the credential fields + secret + salt. Only the commitment is
   given to the issuer.
3. The issuer calls the `issue` circuit to add the commitment to the on-chain
   registry. Only the issuer can make this call (the caller is compared against the
   issuer public key recorded at deploy time).

### Anonymous membership: Merkle tree
If the registry were a plain `Set`, the verification transcript would reveal which
commitment was used, making all of a holder's proofs linkable. Instead the registry
is kept as **Compact's ledger MerkleTree ADT**:

- The holder provides the credential fields, the secret, and the **merkle path** as witnesses.
- The circuit recomputes the commitment and verifies tree membership via the path.
- An observer therefore learns "A VALID certificate in the registry was proven" —
  but not WHICH one.

### Nullifier (single use / unlinkability)
- `nullifier = hash(secret, domain_separator)` — derived from the same secret as the
  commitment but with a different domain; the link between the two can only be
  established by someone who knows the secret.
- The contract keeps nullifiers in a ledger `Set`; a second access attempt with the
  same certificate is rejected.
- Note: how many times a credential can be proven is a product decision. For an
  access-gate scenario single-use is correct; for pure verification the nullifier
  should be derived per context (e.g. `hash(secret, gate_id)`). State this decision
  explicitly in the README.

### Expiry check
Compact circuits have no trusted clock. Pragmatic solution for Level 3:
- Include `expiryDate` (day-level epoch) in the credential fields; it is part of the commitment.
- The verification call takes "today" as a **disclosed public input** and the circuit
  asserts `expiryDate > today`.
- Write the limitation honestly in the README's privacy/limitations section: the
  chain does not guarantee the correctness of the "today" value; production would
  need block time / an epoch counter. (Alternative: a ledger epoch counter advanced
  periodically by the issuer — consider only if scope allows.)

### Revocation
Proving non-membership in a revocation list while keeping the commitment hidden is
beyond Level 3 scope. Decision: **leave revocation out of scope**, rely on expiry for
bounded validity, and document it in PROPOSAL.md as a feature required on the road to
Mainnet.

## 3. Data Model

| Data | Type | Disclosed to |
|---|---|---|
| Commitment registry (Merkle tree) | Public ledger | Everyone (opaque hashes) |
| Nullifier set | Public ledger | Everyone (unlinkable to identity) |
| Issuer public key | Public ledger | Everyone |
| Credential fields (name, ID, grade, expiry) | Private witness | No one |
| Holder secret + salt | Private witness | No one |
| Merkle path | Private witness | No one |
| "Valid credential proven" result | Public | Everyone |

An observer **sees**: how many credentials were issued, how many successful
verifications happened, who the issuer is.
An observer **cannot see**: credential contents, which credential was proven, the
holder's identity, or any link between different proofs by the same person.

---

## 4. Phases

### Phase 0 — Setup and skeleton (~half day)
**Goal:** Verify the working Level 2 environment and bring the repo structure up to the Level 3 template.

- Add the Midnight docs MCP: `claude mcp add --transport http midnight-docs https://midnight.mcp.kapa.ai`
- Create a new working branch in the Level 2 repo; verify the compact compiler and the
  proof server (Docker) still work and Lace is connected to Preprod.
- Arrange the file structure per the template: `contracts/`, `managed/`, `src/`,
  `tests/`, `.github/workflows/`, `PROPOSAL.md`, `README.md`.
- Keep the Level 2 counter contract around as a reference (don't delete it; it helps
  while wiring up the test/CI skeleton).
- Create the PROPOSAL.md skeleton (template in section 6); content to be filled in by hand.

**Acceptance:** `compact compile` and existing tests (if any) run clean; structure matches the template.
**Suggested commits (2):** `chore: restructure repo for level 3`, `docs: add proposal skeleton`

### Phase 1 — Compact contract (~1.5-2 days) — HIGHEST-RISK PHASE
**Goal:** The CertProof contract compiles and the circuits behave correctly.

- **Ledger design:** issuer public key field, a MerkleTree for commitments, a Set for
  nullifiers, (optionally) counters for total issued/verified.
- **Circuits (3):**
  - `issue(commitment)` — asserts the caller is the issuer, inserts the commitment into the tree.
  - `prove_and_access(today)` — recomputes the commitment from witnesses, verifies
    merkle membership, checks expiry, computes the nullifier, asserts it is not in
    the set, and inserts it.
  - (optional) `verify_only(today)` — verification without writing a nullifier; adds demo variety.
- **Witness functions:** TS functions that supply the credential fields, secret, and
  merkle path from the holder's (local) private state. Solving where the merkle path
  comes from is critical: read the current tree state from the indexer/public state
  and build the path client-side — follow the pattern in the official Midnight
  examples (bboard).
- **Hash choice:** persistent hash/commit family for values written to state,
  transient for ephemeral values. Verify via the docs MCP.
- Compile; confirm `managed/` output and generated TS type definitions exist.

**Acceptance:** Contract compiles; circuits behave correctly when driven manually in the simulator.
**Suggested commits (3):** `feat(contract): credential registry with merkle membership`,
`feat(contract): nullifier-based single-use access`, `feat(contract): expiry check via disclosed date`

### Phase 2 — Tests (~1 day)
**Goal:** Minimum 3, target 6-8 meaningful tests; all green.

Testing approach: drive circuit calls from TS tests via the contract simulator/runtime
(no live chain) — follow the test pattern in the official Midnight example repos.
Vitest recommended.

The three mandatory categories:
- **a) Circuit logic:** `prove_and_access` succeeds with a valid witness; FAILS
  separately with a wrong secret, a corrupted merkle path, and an expired credential.
- **b) State transitions:** the tree changes after `issue`; a successful proof inserts
  the nullifier; a second call with the same nullifier is rejected; a non-issuer
  calling `issue` is rejected.
- **c) Privacy:** serialize all public outputs/transcript of a successful proof and
  assert that the credential fields (name, ID, grade) and the secret do **not appear
  at the byte level** anywhere. This test is the proof behind the README's privacy claim.

**Acceptance:** `npm test` all green; screenshot captured (submission item).
**Suggested commits (2):** `test: circuit logic and state transition coverage`, `test: privacy — no witness data in public outputs`

### Phase 3 — CI/CD (~half day)
**Goal:** A green pipeline compiling + testing on every push.

- `.github/workflows/ci.yml`: triggers on push (main) + pull_request; steps:
  checkout → set up Node 22 → `npm ci` → install the compact compiler →
  `compact compile` → `npm test` → `npm run build`.
- **Hidden difficulty:** installing the compact compiler on the CI runner. Two
  options: make the official install script/binary download a workflow step, or use a
  Docker image that contains the compiler. Pin the compiler version (same as local)
  and cache it. Verify the current install method via the docs MCP.
- Add the CI badge to the top of the README (below the title).
- Push a deliberately broken test to see the pipeline go red, then revert — proof
  that the pipeline actually works.

**Acceptance:** Green run on GitHub Actions + badge in README.
**Suggested commits (2):** `ci: compile and test on every push`, `docs: add CI badge`

### Phase 4 — Frontend (~1.5-2 days)
**Goal:** A polished two-role UI that handles all error states.

- **Issuer panel:** form to add a commitment (pasted from the holder), total issued
  count, transaction status.
- **Holder flow:** create/import a credential (locally) → show the commitment
  ("give this to the issuer") → after the issuer adds it, a "prove" button → result screen.
- **Proof UX:** proof generation can take 10+ seconds — staged progress indicator
  ("preparing witness → generating proof → submitting to chain"), spinner, warning
  that it cannot be cancelled.
- **Error states:** wallet missing/rejected, wrong network, proof server down
  (connectivity check + setup instructions for the user), proof rejected
  (wrong/expired credential), nullifier collision ("this certificate was already used
  at this gate").
- **Privacy labels:** clearly mark in the form which fields stay on-device and which
  go on-chain — this is exactly what the reviewers want to see.
- Mobile layout + zero console errors in the production build (`npm run build` clean).

**Acceptance:** End-to-end flow works on Preprod: issue → prove → access; all error
states manually tested; build clean.
**Suggested commits (3):** `feat(ui): issuer panel`, `feat(ui): holder proof flow with staged progress`, `fix(ui): error states and mobile layout`

### Phase 5 — Documentation, deploy, submission (~1 day)
**Goal:** Every item on the submission checklist closed.

- **README** (in the template's order): title + CI badge, one-line description, Live
  Demo link, **Preprod contract address table (mandatory)**, What This Does, Privacy
  Model (PUBLIC / PRIVATE / PROVED without revealing), Privacy Claim (what an
  observer sees vs cannot see — from the table in section 3), Tech Stack,
  Prerequisites (including proof server + Lace setup), Setup & Run, Run Tests, CI/CD
  explanation, Product Proposal link.
- **PROPOSAL.md**: YOU fill in the four sections (product definition, why Midnight,
  data model table — adapt from section 3, Mainnet feasibility — honestly cover the
  revocation and time-oracle gaps).
- **Live demo:** deploy the frontend to Vercel/Netlify. Since the proof server runs
  locally, add a "requirements" box to the demo page (Docker command + Lace setup).
- **Demo video (1 min) script:** (1) connect wallet → holder creates a credential,
  commitment goes to the issuer, issuer issues → holder proves, access granted; the
  same proof is attempted again and rejected (~35s). (2) terminal running `npm test` —
  all tests green (~15s). (3) GitHub showing the green CI badge + Actions run (~10s).
- Check the commit count (following this plan naturally accumulates 12+).

**Acceptance:** All 8 items on the submission checklist can be ticked.

---

## 5. Risks and early decisions

| Risk | Impact | Mitigation |
|---|---|---|
| Building the merkle path client-side (reading tree state) | Phase 1 stalls | Study the bboard/example repo pattern on day one; discover early if there is no solution |
| Installing the compact compiler in CI | Phase 3 drags | Pin the compiler version in Phase 1; rehearse the install command locally |
| Proof time overruns the demo video | Video exceeds 1 min | Cut/speed up the video; show the staged UI during proving |
| Compact APIs not being what we assumed | General | Verify every API via the docs MCP; hallucination forbidden |
| Time-check criticism | Reviewer question | Deliberately document the limitation in the README — as a design decision, not an apology |

## 6. PROPOSAL.md skeleton (to be filled in by hand)

Keep the template's exact structure: "What is the product / Why Midnight / Data Model
table / Mainnet Feasibility". Adapt the data model table from section 3. In Mainnet
Feasibility, present revocation, the time oracle, and issuer onboarding as roadmap
items — as a plan, not as gaps.

---

## 7. APPENDIX — Implementation Prompt

Paste the prompt below into a fresh Claude Code session in the Midnight repo.
Fill in the placeholder.

```text
You are helping me build Level 3 of the Midnight Builder Challenge (Rise In).
Project: "CertProof" — Confidential Credentials dApp on Midnight.
My Level 2 repo is this working directory.
My Preprod contract address from Level 2 is: [PASTE CONTRACT ADDRESS]

Before anything else: use the midnight-docs MCP (https://midnight.mcp.kapa.ai) to
verify EVERY Compact language feature, ledger ADT, and JS API you use. Never invent
APIs from memory. If the docs contradict this prompt, follow the docs and tell me.

ARCHITECTURE (already decided — do not redesign):
- Roles: issuer (deployer) and holder. Registry model, no in-circuit signatures.
- Credential = {name, certificateId, grade, expiryDate} held ONLY in holder's local
  private state, never on chain.
- commitment = persistent hash of (credential fields, holder secret, salt).
- Ledger: issuer public key; MerkleTree of commitments; Set of nullifiers; counters.
- Circuits:
  1) issue(commitment): assert caller is issuer; insert into merkle tree.
  2) prove_and_access(todayDate): witnesses = credential fields + secret + salt +
     merkle path. Recompute commitment, verify merkle membership (so the proof does
     NOT reveal which commitment), assert expiryDate > todayDate, compute
     nullifier = hash(secret, domain separator), assert not in nullifier set, insert it.
- Expiry uses a disclosed todayDate input; document this limitation honestly.
- Revocation is explicitly out of scope; note it in PROPOSAL.md as future work.

Work in this exact order, committing after each milestone (conventional commits,
English messages). Target 12+ meaningful commits total.

STEP 1 — Restructure repo to: contracts/, managed/ (compile output), src/
(components/, hooks/, App.tsx, main.tsx), tests/, .github/workflows/ci.yml,
PROPOSAL.md, README.md. Keep the app compiling at every step.

STEP 2 — Write the Compact contract per the architecture above. Compile with the
compact compiler; fix errors using the docs MCP. Show me the compile output.

STEP 3 — Tests (minimum 6, vitest, using the contract simulator pattern from the
official Midnight examples — no live chain needed):
  a) circuit logic: valid witness passes; wrong secret fails; expired credential
     fails; invalid merkle path fails.
  b) state transitions: issue inserts into tree; successful proof inserts nullifier;
     second use of same nullifier is rejected; non-issuer cannot call issue.
  c) privacy: serialize all public outputs/transcript of a successful proof and
     assert the credential fields and secret bytes do NOT appear anywhere.
Run npm test and show me the full output.

STEP 4 — CI: .github/workflows/ci.yml triggered on push to main and pull_request:
checkout → Node 22 → npm ci → install the compact compiler (pin the same version as
local; verify install method via docs MCP) → compact compile → npm test → npm run
build. Add the CI badge under the README title.

STEP 5 — Frontend polish: issuer panel (add commitment, tx status) and holder flow
(create credential locally → show commitment to give to issuer → prove → access
granted screen). Staged progress indicator during proof generation. Handle: wallet
missing/rejected, wrong network, proof server unreachable (with setup instructions),
proof rejected, nullifier already used. Label clearly in the UI which fields stay
on-device vs. go on-chain. Mobile responsive. npm run build with zero errors and
zero console errors.

STEP 6 — README.md with sections in this order: title + CI badge + one-liner,
Live Demo, Contract Address table (Preprod — MANDATORY), What This Does, Privacy
Model (PUBLIC / PRIVATE / PROVED without revealing), Privacy Claim (what an on-chain
observer sees vs cannot see), Tech Stack, Prerequisites (incl. proof server Docker
command and Lace setup), Setup & Run Locally, Run Tests, CI/CD, Product Proposal
(link PROPOSAL.md).

STEP 7 — Create PROPOSAL.md with the exact Rise In structure (What is the product /
Why Midnight / Data Model table / Mainnet Feasibility) and leave [I WILL FILL THIS
IN] placeholders — do not write my answers for me.

STEP 8 — Print a final checklist (✓/✗): 6+ tests passing, CI green on push, badge
in README, contract address in README, privacy model section, PROPOSAL.md skeleton,
zero-error build, file structure, 12+ commits. Then list what I must do manually:
fill PROPOSAL.md, deploy the live demo, record the 1-minute video (dApp flow →
test output → green CI badge), submit on Rise In.
```
