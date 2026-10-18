<div align="center">

# Codex JLC EDA

### From a design brief to a verifiable schematic and PCB

A local MCP / Skill plugin for JLCEDA Pro.<br>
Real component models · Isolated work copies · Native placement and routing · Verified saves

[简体中文](README.md) · **English**

[Latest results](#latest-results) · [Quick start](#quick-start) · [RC example](examples/rc-filter/README.md) · [Validation](docs/validation.md) · [Changelog](CHANGELOG.md)

</div>

![Original Codex JLC EDA concept diagram: requirements, real models, isolated design, verification and saving; not an editor screenshot](docs/assets/workflow.svg)

| Development source | Published runtime | Public interface | License |
|:---:|:---:|:---:|:---:|
| `0.11.0-dev.a10` | [Alpha.3](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) | **35 MCP tools** | [MIT](LICENSE) |

> **Current progress · synced on 2026-10-18**
> Independent development builds on EDA Pro 4.1.71 have completed an RC board's schematic, PCB synchronization, constrained placement, native routing, compatible component replacement and fresh disk verification. This source includes those results and the unfinished A10 notes-editing branch. The published download remains Alpha.3 and does not include these later capabilities. This is a community Alpha developer preview, unaffiliated with JLCEDA or OpenAI.

## Latest results

Starting with a real blank project, the workflow completed an RC signal filter board, then derived a new copy from the saved, closed result and replaced C1 from **10 nF to 100 nF**. These bounded real-editor results were recorded on 2026-10-10 and 10-11.

| 8 components · 13 pins · 3 nets | 21 traces · 0 vias | Strict DRC: 0 | 41 manufacturing files |
|:---:|:---:|:---:|:---:|
| All pin → net → pad mappings checked | All nets connected; about 60.24 mm total trace length | Connectivity, visual review and saving checked separately | Gerber / BOM / CPL and associated files checked |

- **A6 · Real model reading** — Validated symbol and footprint source with explicit identity, units and geometry provenance; qualified a bounded existing-board edit and save on 4.1.71.
- **A7 · Schematic to PCB** — RC schematic, local exchange-file import, controlled initial synchronization into an empty PCB, and complete saving of the unrouted stage.
- **A8 · Placement and native routing** — Evaluated a native placement candidate, adopted circuit-constrained positions, then completed native routing, strict checks and fresh disk readback.
- **A9-R1 · Compatible real replacement** — Replaced C1 with a real compatible 100 nF part, preserved non-target content, nets, placement, rules and existing copper, and completed saving, closing and local manufacturing checks.
- **A10 · Notes editing in development** — Two text changes have full live-archive evidence. Position cleanup, final disk verification and a new delivery remain incomplete. Window focus interference is unresolved.

Manufacturing status is `filesValid=true`, `manufacturingReady=false`: assembly orientation, 3D and physical performance still need separate verification. See the [development status and evidence summary](docs/development-status.md).

## Capabilities

Describe the circuit and project location. The assistant uses tools to read, plan, execute and verify each stage.

| Stage | Current capability |
|---|---|
| **Understand a project** | Project identity, real library models, complete native records, schematic pins, PCB pads and copper connectivity |
| **Create a small board** | Native blank templates, schematic drawing and annotation, initial PCB sync, constrained placement and bounded native routing |
| **Modify a completed design** | Derive from a closed result; add ordinary top-layer two-pin R/C parts, replace compatible real parts, or make source-backed local reconnections |
| **Preserve the design** | Compare complete before/after archives, preserve non-target content, avoid replaying unknown writes, and diagnose or recover using the original request |
| **Save and deliver** | Save both documents, verify in a fresh disk context, generate local Gerber / BOM / CPL files, previews and hash manifests |

Scope: **one schematic page, one low-voltage two-layer board**. Passive changes are limited to ordinary two-pin resistors / non-polar MLCCs, orthogonal orientations and compatible geometry, with 1–2 parts per stage. High-speed / RF / high-voltage designs, multiple boards, arbitrary footprint changes and unrestricted whole-board optimization are outside current qualification.

## Quick start

### 1 · Choose a version

| Your goal | Entry point | What to expect |
|---|---|---|
| Inspect or develop the latest work | Current source, `0.11.0-dev.a10` | Build required; A10 notes editing is unfinished |
| Use the existing precompiled package | [Alpha.3 pre-release](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) | No npm installation; excludes the A6–A10 additions |

Requirements: **macOS, Node.js ≥20, JLCEDA desktop Pro, and a Codex host supporting local stdio MCP**. Version 4.1.60 is the earlier baseline; 4.1.71 has the bounded qualifications above. Other platforms, versions and `.eprj3` paths need separate checks. Native interaction requires host desktop capabilities or operator assistance. [Official CLI documentation](https://prodocs.lceda.cn/cn/api/guide/cli.html)

### 2 · Build the latest source

```sh
git clone https://github.com/aning0922/codex-jlc-eda.git
cd codex-jlc-eda
PROJECT_ROOT="$(pwd -P)"
node -e 'const p=require("./package.json"); if(p.name!=="codex-jlc-eda" || p.version!=="0.11.0-dev.a10") process.exit(1)'
npm --prefix "$PROJECT_ROOT" ci --ignore-scripts --no-audit --no-fund
npm --prefix "$PROJECT_ROOT" test
npm --prefix "$PROJECT_ROOT" run test:protocol
npm --prefix "$PROJECT_ROOT" run package
```

Outputs are written to `release/0.11.0-dev.a10/`: source / runtime ZIPs, file manifests and `SHA256SUMS`. This creates a local development build; it does not establish a new public release or actual chat-host qualification. Offline tests and protocol checks do not call the real editor.

<details>
<summary><strong>Use the published Alpha.3 runtime</strong></summary>

Download the [runtime ZIP](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/codex-jlc-eda-0.11.0-alpha.3-runtime.zip) and [SHA256SUMS](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/SHA256SUMS). Compare this digest with its manifest entry before unpacking into a permanent directory.

```sh
shasum -a 256 codex-jlc-eda-0.11.0-alpha.3-runtime.zip
```

Keep the root `.agents/` and `plugins/jlc-eda/` directories. The runtime includes its bundles and needs no `npm install`. The published version uses `fflate 0.8.3` and MCP SDK `1.31.0`; see the historical [dependency security review](docs/dependency-security.md).

</details>

### 3 · Install the unpacked local runtime

These commands accept the root of either runtime ZIP described above. Confirm the chosen version first.

```sh
codex plugin marketplace add "/absolute/path/to/unpacked-runtime"
codex plugin add jlc-eda@jlc-eda-alpha --json
codex plugin list --marketplace jlc-eda-alpha --json
```

If an older source provides the same plugin, disable that source and keep its cache to avoid confusing two `jlc_eda` services. When reloading is necessary, fully restart the desktop host at a convenient break, then check the loaded version in a fresh context. [Local plugin installation](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)

Installed-file matching and actual host loading are separate checks. The source repository excludes `dist`; a Git source is not a verified zero-build installation path. The launcher prefers `CODEX_MCP_NODE_PATH`, then `node` on PATH. Set `JLCEDA_CLI_PATH` for a nonstandard editor installation.

### 4 · Start a conversation

> Use the JLCEDA assistant to check the environment. Report the loaded plugin version, tool count and editor connection status. Only check the environment for now.

Expect your installed version and **35** tools. If `editorConnected=false`, open the desktop editor first. Then describe a task:

> Build a low-voltage RC filter board from a fresh blank template. Verify real parts and every pin, complete the schematic and PCB, check connectivity, and verify saving through fresh disk readback.

> Derive a copy of the completed board, replace C1 with a real compatible 100 nF capacitor, preserve everything else, and check the BOM and saved result.

## Validation and recovery

The current public offline suite contains **188 tests**. Protocol checks cover **35 tools and 35 invalid-input rejections**. Real-editor results came from independent development builds; actual chat-host loading, sustained background interaction and hardware performance need separate qualification. [Validation record](docs/validation.md) · [GitHub Actions](https://github.com/aning0922/codex-jlc-eda/actions)

| Returned status | Next step |
|---|---|
| `needs_ui` | Complete the specified native step in the exact window, then verify with the same request |
| `unknown` / `pending` | Preserve the project, receipts and journal; diagnose read-only before further action |
| `failed` / `unsupported` | Address the specific model, source, geometry or state issue |
| `ok` / `closed` | Read the scope of that stage's evidence; final persistence requires independent disk readback |

[Daily use](skills/jlc-eda-project/references/usage.md) · [Passive changes](skills/jlc-eda-project/references/passives.md) · [Testing](docs/testing.md) · [Roadmap](docs/roadmap.md)

## Data and licensing

The local MCP handles projects, copies and manufacturing files. Library search, accounts and synchronization may use JLCEDA services. Tool outputs go to the AI host and can include paths, models and previews, subject to that host's settings. This plugin requires no additional LLM API key.

Original code, documentation and the concept diagram use [MIT](LICENSE); bundled dependencies retain [their own licenses](THIRD_PARTY_NOTICES.txt). Real library models, native projects, editor screenshots and manufacturing materials stay local. Public regression tests use synthetic data. [Sources and redistribution boundaries](docs/sources-and-licenses.md)

## Contribute

[Contribution guide](CONTRIBUTING.md) · [Report an issue](https://github.com/aning0922/codex-jlc-eda/issues) · [Security policy](SECURITY.md) · [Releases](https://github.com/aning0922/codex-jlc-eda/releases)

Include versions, platform, status codes and a sanitized minimal reproduction. Report security issues through the [private reporting channel](https://github.com/aning0922/codex-jlc-eda/security/advisories/new).
