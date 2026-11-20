![Codex JLC EDA, a local plugin for JLCEDA Pro. An exploded illustration shows four PCB layers.](docs/assets/workflow.svg)

[简体中文](README.md) · **English**　|　[Setup](#quick-start) · [Examples](#board-examples) · [Workflows](#workflows) · [Docs](#documentation-and-support)

# Design and verify JLCEDA Pro boards from Codex

Give Codex a project and a change, such as “replace the filter capacitor with a 100 nF part and keep the existing traces.” The plugin uses **35 local MCP tools** to read component models, edit the schematic and PCB in a working copy, then reopen the saved design from disk to check pins, pads and copper connectivity.

**Development source** `0.11.0-dev.a31-r4` · **Prebuilt runtime** [Alpha.3](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) · **License** [MIT](LICENSE)

## Board examples

### Four-layer controller · extending an existing layout

A working copy of the STM32H563 controller retained its existing copper while routing closed **74 gaps across 37 target signal nets**. After saving and reopening on EDA Pro 4.1.105, the checks covered **12 schematic sheets, 265 components, 161 named nets and 887 logical pin assignments**.

| Check | Result on the saved board |
|---|---|
| Whole-board connectivity | Including local supply and return routing, remaining connections fell from **487 to 348**. All pre-existing copper groups stayed connected. |
| Manufacturing data | Pad groups reconstructed from four Gerber copper layers and plated NC drills matched editor readback on **161/161 nets**. |
| Strict design rule check (DRC) | **480 unconnected markers**, zero shorts and zero clearance violations. The board still needs routing. |

A fresh Codex host loaded A31-r4, reopened the final board read-only and closed its inspection copy. [Validation record](docs/validation.md)

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

## Workflows

In an MCP client, use `jlc_eda_read_connectivity` to check pin assignments, `jlc_eda_check_pcb` to read copper connectivity and strict DRC results, and `jlc_eda_finish_work_project` to save and verify the design from disk. [Full tool definitions](https://github.com/aning0922/codex-jlc-eda/blob/main/tests/fixtures/public-tools.json)

| Task | What the plugin does | What it checks |
|---|---|---|
| Inspect an existing project | Read symbols, footprints, pins, pads and nets in a read-only copy | Match each schematic pin to its physical pad and net |
| Create or extend a schematic | Draw from a blank template, or add a sheet to a routed board and connect pins left open on an earlier sheet | Compare the combined netlist, original pad assignments and new components |
| Place and route | Set two- or four-layer outlines and mounting holes, place parts, route in batches, change layers and refill solid pours | Read back segment widths, vias, annular copper contact and thermal spokes, then run strict DRC |
| Save and deliver | Save both documents, reopen the working copy and generate local Gerber, BOM and CPL files | Compare the full design read from disk, inspect manufacturing files and write a hash manifest |

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
