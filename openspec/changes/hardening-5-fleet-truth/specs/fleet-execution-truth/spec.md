# Fleet Execution Truth — Delta Specification

## ADDED Requirements

### Requirement: Accepted adapter families preserve semantic identity
The system MUST preserve the validated campaign adapter family through capability routing, workflow resolution, adapter process selection, durable run/environment records, evidence, findings, replay, result reporting, and resume. Internal implementation reuse MUST NOT change the externally durable adapter family.

#### Scenario: Electron item reaches Electron execution
- GIVEN a campaign manifest containing a valid `adapterFamily: electron` hunt/explore item
- AND a worker truthfully advertises Electron capability
- WHEN the scheduler executes the item
- THEN the workflow MUST instantiate an Electron-capable path
- AND durable run/environment/evidence/finding identity MUST remain Electron
- AND the item MUST NOT execute through fake or web by implicit fallback.

#### Scenario: Unknown family fails closed
- GIVEN product configuration containing an unknown or unimplemented adapter family
- WHEN validation/execution is attempted
- THEN Inspector MUST return a stable configuration/capability refusal before target work begins
- AND MUST NOT substitute fake, web, or any other family.

### Requirement: Capability advertisement is executable truth
A worker MUST advertise an adapter family only when the configured executor can construct the required workflow path under that capability model. Test/injectable capability and real-runtime capability MUST be distinguishable when they imply different evidence strength.

#### Scenario: Electron runtime unavailable
- GIVEN Electron is requested but its required executable or display is unavailable
- WHEN capability discovery or preflight runs
- THEN the item MUST be refused/blocked with an honest typed environment/capability classification
- AND MUST NOT be reported as a successful real Electron run.

### Requirement: Electron fleet execution is product-complete
Electron hunt/explore campaign work MUST use Inspector's real workflow services, budgets, cancellation, checkpointing, finding/evidence pipeline, settlement, and isolated campaign workspace semantics while retaining Electron identity.

#### Scenario: Bounded Electron hunt
- GIVEN a deterministic Electron fixture and explicit action/wall/finding budgets
- WHEN an Electron campaign hunt runs
- THEN actions MUST be admitted before consumption and charged after actual consumption
- AND cancellation MUST stop at a safe boundary
- AND findings/evidence MUST be durable in the standard schema
- AND campaign result usage/status MUST reflect actual work.

### Requirement: Windows/UIA campaign execution has an end-to-end field proof
The existing Windows/UIA capability MUST be proven at the campaign layer from manifest through scheduler/workflow to UIA evidence and replay, or current product truth MUST explicitly state the exact environment limitation.

#### Scenario: Real Windows campaign
- GIVEN a supported Windows host and UIA target fixture
- WHEN a Windows campaign item executes
- THEN the scheduler MUST route by UIA capability
- AND the workflow MUST launch the Windows adapter
- AND durable provenance MUST identify Windows/UIA
- AND downstream replay MUST target the same platform.

### Requirement: Replay, verify, regress, and resume are adapter-faithful
A durable finding from a supported fleet adapter MUST either have a platform-faithful replay path or be rejected at preflight by an explicit product contract. It MUST NOT be accepted and later replayed with a different adapter family.

#### Scenario: Electron verify/regress
- GIVEN a confirmed finding produced by an Electron campaign item and a retained source workspace
- WHEN a downstream verify or regress item references it
- THEN the replay driver MUST reconstruct Electron target/backend provenance
- AND MUST reject missing/incompatible provenance
- AND MUST NOT substitute WebReplayDriver or FakeStateMachineDriver solely because Electron support was omitted from a switch.

#### Scenario: Electron resume
- GIVEN a non-terminal resumable Electron exploration run
- WHEN resume is requested
- THEN Inspector MUST restore compatible Electron workflow/adapter/target provenance and budgets/checkpoint state
- OR fail with a stable incompatibility/environment error before acting.

### Requirement: Adapter-family handling is exhaustively tested
The repository MUST have a test/contract matrix derived from the declared adapter-family vocabulary that detects when validation, capability requirements, workflow mapping, adapter resolution, durable identity, or replay support/refusal omits a family.

#### Scenario: Future family is added incompletely
- GIVEN a developer adds a new family to the canonical family list but omits a required execution mapping
- WHEN typecheck/tests run
- THEN the change MUST fail compilation or a deterministic repository-contract/matrix test
- AND MUST NOT pass by default fallthrough.

### Requirement: Capability truth follows configured backend semantics
Capability advertisement and preflight MUST model the backend configuration the executor will actually construct. A host-level real-backend probe MUST NOT suppress an explicitly selected cross-platform mock/injectable backend that is intentionally executable on that host. Conversely, test/injectable availability MUST NOT be promoted to real field capability.

#### Scenario: Windows mock selected on Linux
- GIVEN `INSPECTOR_WINDOWS_BACKEND=mock`
- AND the deterministic Windows mock adapter is supported on the current host
- WHEN `InspectorWorkflowExecutor` reports capabilities and the scheduler routes a Windows item
- THEN Windows mock execution MUST be routable
- AND the durable capability/provenance record MUST identify mock/test strength
- AND the item MUST NOT be refused merely because real `probeUia()` is unavailable.

#### Scenario: Windows real selected on non-Windows
- GIVEN `INSPECTOR_WINDOWS_BACKEND=real`
- AND the host cannot execute real UIA
- WHEN preflight runs
- THEN the item MUST fail/refuse with a typed real-backend capability/environment outcome before target work
- AND mock capability MUST NOT satisfy real field certification.

### Requirement: Zero executed work is not semantic success
Campaign reporting MUST preserve the distinction among completed work, execution failure, routing refusal, external block, cancellation, and an empty/no-valid-execution outcome. A report with no failures is not sufficient evidence of successful campaign execution when zero requested items completed.

#### Scenario: Every item is capability-refused
- GIVEN a non-empty campaign whose requested items are all refused during routing
- WHEN the campaign terminates
- THEN every refusal MUST remain durable/operator-visible
- AND completion/certification logic MUST NOT interpret `failed=[]` as proof that the requested workflows ran successfully
- AND tests claiming platform execution MUST assert completed/assignment/execution evidence, not only absence of failures.

