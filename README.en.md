![Codex JLC EDA, a local plugin for JLCEDA Pro. An exploded illustration shows four PCB layers.](docs/assets/workflow.svg)

[简体中文](README.md) · **English**　|　[Usage](#how-to-use-it) · [35 tools](#tool-directory) · [Setup](#quick-start) · [Boards](#board-examples)

# Design and verify JLCEDA Pro boards from Codex

Give Codex a project and a change, such as “replace the filter capacitor with a 100 nF part and keep the existing traces.” The plugin uses **35 local MCP tools** to read component models, edit the schematic and PCB in a working copy, then reopen the saved design from disk to check pins, pads and copper connectivity.

**Development source** `0.11.0-dev.a31-r4` · **Prebuilt runtime** [Alpha.3](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) · **License** [MIT](LICENSE)

## How to use it

These examples use the A31-r4 development build. Describe the task in a Codex chat with the plugin enabled and replace the example paths with your own absolute paths. The assistant reads project, sheet and pad identifiers from the editor.

### Inspect an existing board

> Open a read-only copy of `/absolute/path/to/rc/work.eprj2` with the JLCEDA assistant. List its sheets, report the pin number and net for each pin on C1, and check whether the corresponding PCB pads have the same assignments. Close the inspection copy when finished.

`jlc_eda_open_project` returns the sheets and PCBs. The assistant uses `jlc_eda_read_connectivity` to compare the schematic and pads on the same board, selects C1 by designator, then closes its own copy with `jlc_eda_close_session`. To see the pad shapes too, ask it to read the PCB pad geometry.

### Look up a replacement part

> In this RC project’s device library, find 100 nF, 0603 non-polar MLCC candidates. List each part number, published voltage rating where available, and datasheet link. Compare the pad numbers and dimensions with C1’s actual footprint. Give me the shortlist first.

`jlc_eda_search_devices` returns candidate identities. `jlc_eda_read_device` resolves the symbol and footprint, and `jlc_eda_read_library_model` with `view="geometry"` returns the physical pads. Compare their geometry before choosing the replacement.

### Build an RC board from a blank template

> Start with the empty template `/absolute/path/to/blank.eprj2` and create a project at `/absolute/path/to/rc-first`. Follow the RC example in the repository, including the 1 kΩ series resistor, 10 nF shunt capacitor, 100 kΩ bleed resistor, input and output connectors, and three test points. Synchronize, place and route the board. Report whether all three nets are connected and what was verified after reopening the saved file.

`jlc_eda_create_work_project` creates the working copy. `jlc_eda_draw_schematic` uses `place` to read the actual pins, then `complete` to wire them. After verifying the schematic, `jlc_eda_sync_pcb` synchronizes the PCB. Once placement, rules and routing are complete, `jlc_eda_check_pcb` checks copper connectivity and strict DRC, and `jlc_eda_finish_work_project` saves and verifies the design from disk. [RC requirements and full connection table](examples/rc-filter/README.md)

### Replace a part and export a completed board

> Use the completed RC board at `/absolute/path/to/rc-first/work.eprj2` and its sibling `work-project.json`. In a new copy at `/absolute/path/to/rc-100nf`, replace C1 with a real, footprint-compatible 100 nF part. Preserve all other components and existing copper. Check the BOM, netlist and saved result, then export Gerber, BOM and pick-and-place files to a new `/absolute/path/to/rc-fab` directory.

This uses `jlc_eda_schematic_eco` with `mode="passives"`. The assistant checks the candidate part and footprint, runs `prepare_replace`, uses the native picker, then calls `adopt_replace` and verifies PCB synchronization and saving. Create the copy with `renderMode="visible"` for the picker. Finally, `jlc_eda_export_manufacturing` writes local files and returns the report path. [Complete passive-edit procedure](skills/jlc-eda-project/references/passives.md)

For a direct MCP integration, see the [calls with arguments](#mcp-call-examples) or look up [all 35 tools](#tool-directory) by task.

## Board examples

### Four-layer controller · extending an existing layout

A working copy of the STM32H563 controller retained its existing copper while routing closed **74 gaps across 37 target signal nets**. After saving and reopening on EDA Pro 4.1.105, the checks covered **12 schematic sheets, 265 components, 161 named nets and 887 logical pin assignments**.

| Check | Result on the saved board |
|---|---|
| Whole-board connectivity | Including local supply and return routing, remaining connections fell from **487 to 348**. All pre-existing copper groups stayed connected. |
| Manufacturing data | Pad groups reconstructed from four Gerber copper layers and plated NC drills matched editor readback on **161/161 nets**. |
| Strict design rule check (DRC) | **480 unconnected markers**, zero shorts and zero clearance violations. The board still needs routing. |

A fresh Codex host loaded A31-r4, reopened the final board read-only and closed its inspection copy. [Validation record](docs/validation.md)

To extend a verified, partially routed board, substitute actual references, pins and a net name in this request.

> Derive a new copy from this board and its `work-project.json`. Add a sensor-interface sheet. Connect the deferred [designator and pin] on the earlier sheet to [net name and component pin] on the new sheet. Place the new surface-mount parts on the bottom side. Reopen the saved board and check the cross-sheet netlist, existing traces and remaining connections.

This uses `jlc_eda_schematic_eco` with `mode="add_page"`. `pageAddition.sourcePins` identifies deferred pins verified against the earlier sheet’s netlist and the PCB. `pageAddition.placements` sets the position and side of each new part. [Adding sheets and bottom-side parts](skills/jlc-eda-project/references/usage.md)

### RC filter · replacing a capacitor and verifying the original copper

![RC filter schematic. R1 connects input to output, C1 and R2 shunt the output to ground, and C1 changes from 10 nF to 100 nF.](docs/assets/rc-filter.svg)

Starting with a blank two-layer project on EDA Pro 4.1.71, the workflow drew the schematic, synchronized the PCB, placed the parts and routed the board. A copy of the saved design then received a footprint-compatible **100 nF** replacement for C1. The BOM was checked after the change.

| Design | Copper and rules | Delivery checks |
|---|---|---|
| 8 components, 13 pins, 3 nets | All three nets connected through 21 trace segments and no vias, with zero strict DRC errors | Reopening confirmed the original copper was intact. All 41 manufacturing files passed their checks. |

The drawing follows the public connection table. Assembly orientation, 3D fit and physical performance still need verification. [RC walkthrough and netlist](examples/rc-filter/README.md) · [Development status](docs/development-status.md)

## Quick start

You need **macOS, Node.js 20 or later, JLCEDA Pro desktop** and a Codex host that supports local plugins. Choose the source build to reproduce the multi-sheet, four-layer and RC replacement examples below.

<details>
<summary><strong>Build A31-r4 from source</strong> · Multi-sheet designs, four-layer boards and local routing</summary>

Clone the repository into a fresh directory. `npm run check` builds the plugin, runs the offline and protocol checks, and produces the runtime archive.

```sh
git clone https://github.com/aning0922/codex-jlc-eda.git
cd codex-jlc-eda
PROJECT_ROOT="$(pwd -P)"
node -e 'const p=require("./package.json"); if(p.name!=="codex-jlc-eda" || p.version!=="0.11.0-dev.a31-r4") process.exit(1)' &&
  npm --prefix "$PROJECT_ROOT" ci --ignore-scripts --no-audit --no-fund &&
  npm --prefix "$PROJECT_ROOT" run check
```

After the checks pass, verify both ZIPs and enter the unpacked runtime directory.

```sh
cd "$PROJECT_ROOT/release/0.11.0-dev.a31-r4" &&
  shasum -a 256 -c SHA256SUMS &&
  unzip -q codex-jlc-eda-0.11.0-dev.a31-r4-runtime.zip -d runtime &&
  cd runtime
```

</details>

<details>
<summary><strong>Download the Alpha.3 runtime</strong> · Early community preview, ready to install</summary>

Alpha.3 was published on 2026-10-10, before the A6–A31 work. Download both files into the same empty directory. Run these commands there to verify and unpack the runtime. [Runtime ZIP](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/codex-jlc-eda-0.11.0-alpha.3-runtime.zip) · [SHA256SUMS](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/SHA256SUMS)

```sh
runtime_zip=codex-jlc-eda-0.11.0-alpha.3-runtime.zip
awk -v name="$runtime_zip" '$2 == name' SHA256SUMS | shasum -a 256 -c - &&
  unzip -q "$runtime_zip" -d runtime &&
  cd runtime
```

This package includes its dependencies, among them `fflate 0.8.3` and MCP SDK `1.31.0`. [Dependency audit](docs/dependency-security.md)

</details>

**Install in Codex.** Run the following commands from the unpacked runtime directory you chose above. It contains `.agents/` and `plugins/`. Keep that directory in place after installation.

```sh
codex plugin marketplace add "$PWD"
codex plugin add jlc-eda@jlc-eda-alpha --json
codex plugin list --marketplace jlc-eda-alpha --json
```

Open the EDA editor and start with a read-only request in a fresh Codex chat.

> Use the JLCEDA assistant to report the loaded plugin version, how many tools are available, and whether the editor is connected.

Expect your selected version, **35** tools and `editorConnected=true`. If an older version appears, check for duplicate plugin sources and reload the host. For a nonstandard EDA installation, point `JLCEDA_CLI_PATH` at its CLI executable. Use `CODEX_MCP_NODE_PATH` to select Node. [Local plugin installation](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)

## MCP call examples

For a custom MCP client, launch `/bin/sh ./scripts/launch-mcp.sh` from the plugin directory and forward `PATH`, `TMPDIR` and any configured path overrides as specified in the manifest. On **one initialized stdio connection**, use `tools/list` to discover the running server’s tools and input definitions. Each JSON block below is the `params` object for one `tools/call` request. Read the result from `structuredContent`. From a built source checkout, `node dist/cli.mjs doctor` also runs a standalone connection check. [Launch configuration](.mcp.json)

**1. Open an inspection copy.** Replace the path with an existing project file. Use the returned identifiers once `status="ok"` and `inspectionCopy=true`.

```json
{
  "name": "jlc_eda_open_project",
  "arguments": { "path": "/absolute/path/to/rc/work.eprj2" }
}
```

**2. Compare pin and pad assignments.** Replace `SESSION_FROM_OPEN` with the returned `sessionId` and `PROJECT_FROM_OPEN` with `project.uuid`. Select the intended board by name in `boards`. Use that board’s `pcbDocumentUuid` and a page from its `schematicPageUuids`. Use `documents` to look up the page UUID by name.

```json
{
  "name": "jlc_eda_read_connectivity",
  "arguments": {
    "sessionId": "SESSION_FROM_OPEN",
    "expectedProjectUuid": "PROJECT_FROM_OPEN",
    "schematicPageUuid": "PAGE_FROM_BOARD",
    "pcbDocumentUuid": "PCB_FROM_BOARD"
  }
}
```

Find `designator="C1"` in `netlist.components` and read `number` and `net` in its `pins`. The following values came from a read-only run of the RC example on EDA Pro 4.1.105.

```text
netlist.counts       {"components":8,"pins":13,"namedNets":3}
C1                   1 → OUT    2 → GND
comparison.status    matched
```

`matched` means schematic pins and PCB pads agree on their net assignments. Use `jlc_eda_check_pcb` on a bound working copy to check physical copper and strict DRC.

**3. Close this inspection session.** Use the same `sessionId` returned by open, including when a later read fails. Keep the MCP connection open across these calls. A one-shot CLI invocation cleans up its inspection sessions when it exits.

```json
{
  "name": "jlc_eda_close_session",
  "arguments": { "sessionId": "SESSION_FROM_OPEN" }
}
```

<details>
<summary><strong>Another direct call · Export a saved design</strong></summary>

Set `sourcePath` to the completed `.eprj2` file and choose a new, empty `outputDirectory`. This call writes the local delivery files.

```json
{
  "name": "jlc_eda_export_manufacturing",
  "arguments": {
    "sourcePath": "/absolute/path/to/rc-100nf/work.eprj2",
    "outputDirectory": "/absolute/path/to/rc-fab",
    "requestId": "rc-fab-01",
    "phase": "generate"
  }
}
```

The result contains `reportPath` and `manifestPath` for the manufacturing report and file inventory. `deliveryGenerated` indicates that file generation and file checks succeeded. `manufacturingReady` reports manufacturing qualification separately. To verify an existing complete capture, retain the original arguments and `requestId` and switch to `phase="verify"`.

</details>

## Tool directory

These are **all 35 MCP tools in A31-r4**. Project reads use the session and project IDs returned by the running service. Work-copy tools also use `workDirectory` and the related sheet, schematic and PCB IDs for the same board. `circuit` is the structured input assembled from actual parts, pins and connections. When a `requestId` is required, reuse it to verify that same operation. Use `tools/list` for the running server’s full required fields and enumerations. [A31-r4 input definitions](https://github.com/aning0922/codex-jlc-eda/blob/527b42efa9a6ffdeb59b6e27c9fbfc5a44c6e936/tests/fixtures/public-tools.json)

### Environment and project inspection (7)

- `jlc_eda_doctor` — Pass `{}` to read the plugin version, tool count and editor connection. Start with `pluginVersion`, `publicToolCount` and `editorConnected`.
- `jlc_eda_sessions` — Pass `{}` to list official CLI sessions. Identify the intended window by `path`, `headless` and `openedByThisService`.
- `jlc_eda_open_project` — Pass the absolute project file `path`. This opens an inspection copy and returns `sessionId`, `project.uuid`, `boards` and `documents`.
- `jlc_eda_inspect_project` — Pass the selected `sessionId` to list boards and documents. Add `expectedProjectUuid` when known to verify the session still points to that project.
- `jlc_eda_read_document` — Pass `documentUuid` and `kind` (`schematic` or `pcb`). Request `includePins=true` for pin numbers or `includeGeometry=true` for geometry. Check `truncated` before treating the result as complete and adjust `limit` if needed.
- `jlc_eda_read_connectivity` — Pass `schematicPageUuid` for the logical netlist. Add the same board’s `pcbDocumentUuid` to get `comparison.status` and differences between pin and pad assignments.
- `jlc_eda_close_session` — Pass the inspection copy’s `sessionId` to release the read session owned by the server. Check `sessionNoLongerAlive` after the default close operation.

### Devices and library models (3)

- `jlc_eda_search_devices` — Search with either `query` (at least three characters) or `properties`. Use `limit` and `page` to page through `devices` and take the candidate’s `uuid` and `libraryUuid`.
- `jlc_eda_read_device` — Pass the candidate’s `uuid` as `deviceUuid` together with `libraryUuid`. Read its parameters, part numbers and associated symbol and footprint identities.
- `jlc_eda_read_library_model` — Pass `modelUuid`, `libraryUuid` and `kind` (`symbol` or `footprint`). Use `view="geometry"` for pins or pads and `view="source"` for native model provenance.

### Working copies and schematics (8)

- `jlc_eda_create_work_project` — Supply `blankTemplatePath`, a new `outputDirectory` and `requestId` to create a writable copy from a verified empty template. The alternative `projectImport` input returns a separate import result for an official exchange file.
- `jlc_eda_derive_work_project` — Supply `sourcePath`, `circuit`, a new output directory and a request ID to derive a working copy from a schematic. For a synchronized, unrouted PCB, set `sourcePcbState="synchronized_unrouted"` and supply the matching `sourceCheckpointPath`.
- `jlc_eda_resume_work_project` — For a saved layout checkpoint, supply `sourceWorkDirectory`, a new `outputDirectory`, `requestId` and the original `circuit`. The result identifies the new copy’s session, documents and preserved actions.
- `jlc_eda_draw_schematic` — Supply the working copy, `circuit` and drawing `requestId`. Use `phase="place"` to place parts and read their pins, then `complete` with the same ID to wire them. Use `tidy` to arrange recorded annotations.
- `jlc_eda_verify_schematic` — Pass the expected `circuit` and sheet identity. Supply `schematicPageUuids` for a combined check. Read `comparison` for differences in components, pin assignments and explicit no-connects.
- `jlc_eda_preview_schematic` — Pass the target sheet and `workDirectory`. Choose `format="png"` or `"svg"` and read the local preview `path`.
- `jlc_eda_save_work_project` — Request a save on the bound working copy. Include `schematicUuid` and `pcbDocumentUuid` to save both documents, then use the appropriate reopen tool to verify persistence.
- `jlc_eda_reopen_work_project` — Use the original `workDirectory`, sheet identity and `circuit` to recheck a single-sheet schematic from disk. Inspect `persistenceVerified`.

### PCB synchronization, placement and routing (9)

- `jlc_eda_sync_pcb` — Pass the related document IDs, `workDirectory`, `circuit` and `requestId`. The default review workflow starts with `apply`. Review the import in the specified PCB window, then use `verify` with the same request.
- `jlc_eda_verify_pcb` — Pass `circuit` and its schematic and PCB IDs. Check synchronization against component identities, footprint models and pad assignments.
- `jlc_eda_preview_pcb` — Pass the bound PCB identifiers and `workDirectory` to capture the current native board view. The result includes `path` and `mimeType`.
- `jlc_eda_reopen_pcb` — Pass the work-copy parameters and `circuit` to recheck both documents and placement in a fresh disk context. Read `persistenceVerified`.
- `jlc_eda_read_pcb_routing` — Pass a bound working copy’s `workDirectory` and its related document IDs to inspect the outline, existing trace segments, vias and rules.
- `jlc_eda_layout_pcb` — Supply the outline, mounting holes and positions in `layout`. Run `plan → apply → verify`. The `strategy` choices are `manual`, `auto_candidate` and `adjust`.
- `jlc_eda_configure_pcb_rules` — Pass `rules` with clearance, track-width and via constraints in millimetres. Use `apply` followed by `verify` to read back the working board’s rules.
- `jlc_eda_route_pcb` — Use `phase="critical"` with `critical` for one path, `phase="batch"` with `batch` for multiple connections, or `plane` for a solid pour. Check the resulting copper using `verify` or `verify_plane` as appropriate.
- `jlc_eda_check_pcb` — Pass the bound PCB and `circuit` to run strict DRC and compute copper connectivity. Read `copper.remainingConnections`, `drc` and `boardReady` separately.

### Changes to existing designs and routing files (5)

- `jlc_eda_schematic_eco` — Supply `sourcePath`, its matching `sourceCheckpointPath`, a new directory and request ID, starting with `derive`. Choose `passives`, `add_page`, `notes`, `single_point` or `unrouted_decoupling` as the `mode` and follow that mode’s phases.
- `jlc_eda_incremental_pcb` — Use for local changes to traces, vias, designator labels or stencil apertures on a completed PCB. Supply the source and new directory, run `derive`, then use `changes` with `plan → apply → verify → finish`.
- `jlc_eda_repair_pcb` — For a verified partial-routing checkpoint, supply `net`, `from`, `to`, `paths` and `purpose`, plus `vias` when needed. Use `plan` to check obstacles and rules before `apply` and `verify`.
- `jlc_eda_export_pcb_dsn` — Pass the bound working PCB and a `requestId` to export a DSN for an external router. Retain the file path, SHA-256 and request ID.
- `jlc_eda_import_pcb_ses` — Pass the original DSN’s `exportRequestId`, the matching `sesPath` and `sesSha256`, and set `preservationPolicy` to `strict_collinear_coverage`. Import and check through `plan → apply → verify`.

### Finishing and manufacturing (3)

- `jlc_eda_finish_work_project` — Pass the working copy, the same `circuit` and a finish `requestId`. Verify saving, independent disk readback and closure of the owned window. Check `persistenceVerified` and the returned work file path.
- `jlc_eda_stop_work_project` — For a supported router timeout, UI rollback or partial file-routing state, supply the original `routeRequestId`, a stop request and the matching `mode` to preserve the state. Read `operationSucceeded` and `designReady` separately.
- `jlc_eda_export_manufacturing` — Pass the saved design’s `sourcePath`, a new `outputDirectory` and `requestId`. Use `generate` for Gerber, BOM, pick-and-place and reports, `verify` for captured files, or `refresh_previews` for updated previews.

### Scope and limits

Combined verification accepts up to **12 sheets, 500 components and 256 named nets** per board. A local routing batch accepts **32 specified connections**. When adding a sheet, new surface-mount parts and parts with round plated through-holes can go on the bottom side. A separate passive-edit workflow handles 1–2 ordinary two-pin resistors or non-polar MLCCs per stage with compatible orientation and geometry. [Multi-sheet design and routing](skills/jlc-eda-project/references/usage.md) · [Passive edits](skills/jlc-eda-project/references/passives.md)

<details>
<summary><strong>Editor windows, background copies and interrupted writes</strong></summary>

New working copies open in the background. Choose `renderMode: "visible"` when creating a copy that needs the native component picker or import review.

- `needs_ui` identifies the window that needs attention. Complete the native step and verify it with the same request.
- `pending` or `unknown` means that the outcome of a write still needs confirmation. Preserve the copy, receipts and journal, then diagnose read-only.
- `ok` covers the current step. A `closed` working copy has completed saving, independent readback and closure. Whole-board routing status comes from copper connectivity and strict DRC.

</details>

## Validation and compatibility

- **Software checks.** A clean install of A31-r4 passed **250/250 offline tests**. The compiled MCP matched 35 tool definitions and rejected all 35 invalid inputs. [Testing guide](docs/testing.md) · [GitHub Actions](https://github.com/aning0922/codex-jlc-eda/actions/workflows/ci.yml)
- **Desktop editor.** Version 4.1.60 is the early baseline. The RC workflow ran on 4.1.71, and the multi-sheet board and cross-host readback ran on 4.1.105. Other platforms, editor versions and `.eprj3` projects need separate checks. High-speed, RF, high-voltage and multi-board designs, as well as unrestricted whole-board autorouting, remain outside the tested scope. [Versions and qualification](docs/development-status.md)
- **Dependencies.** On 2026-11-20, `npm audit` reported 3 high and 5 moderate findings in the lockfile. The audit identifies which affected packages are included in the runtime. [Dependency security review](docs/dependency-security.md)

## Documentation and support

[Operating guide](skills/jlc-eda-project/references/usage.md) · [RC example](examples/rc-filter/README.md) · [Changelog](CHANGELOG.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)

The plugin handles working copies and manufacturing files locally. Library searches, accounts and sync may use JLCEDA services. Tool outputs sent to the AI host can include project paths, models and previews. The plugin needs no separate LLM API key. Project code, documentation and original illustrations use the MIT license. Dependencies retain their own licenses, and users read actual library models and native projects locally. [Sources and redistribution](docs/sources-and-licenses.md) · [Third-party notices](THIRD_PARTY_NOTICES.txt)

For a bug report, include the plugin and editor versions, platform, returned status and sanitized reproduction steps. Report security issues through the private channel. [GitHub Issues](https://github.com/aning0922/codex-jlc-eda/issues) · [Security reporting](SECURITY.md)
