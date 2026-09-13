# Agent Note: Harness-owned operating guidance

Status: implemented

English | [中文](2026-09-13-harness-owned-operating-guidance.zh.md)

## Problem

Three execution habits that cost wall-clock time in practice had no prompt owner. Measured session logs show all three: a command that failed for an environmental reason (a missing Playwright browser) was rerun unchanged and spent its full duration again to learn the same fact; long commands ran serially while independent work waited; and a long command's output was piped straight into a filter, so the run had to be repeated in full to answer a later question about that same output.

Every existing owner was the wrong one. The [prompt ownership decision](2026-07-05-prompt-variables-and-tool-guidance-ownership.md) assigns cross-call habits to the owning tool package's prompt section, and per-tool semantics to the tool description — but these rules are not per-tool: they govern whether to invoke *any* long or already-failed command, so no single tool package owns them. A deployment persona is the wrong owner for the opposite reason: the rule must hold for every agent the harness composes, and an agent preset shadows `deployment:persona-*` wholesale, so a persona-level rule disappears the moment someone selects a different preset.

## Decision

`dsh-system-prompt` owns a new section, `harness:operating-guidance`, registered at order `-900` — after `harness:identity` (`-1000`) and before the `deployment:persona-prefix` slot (`0`).

**The text is a code literal, not deployment config.** The obvious shape was an `operatingGuidance: string` config field beside `personaPrefix`, set once in the `dsh-base` bundle so every profile inherits it. That shape does not work here: a patch replaces the targeted row's whole `config`, and the Web, headless, ACP, SDK, and sdk-minimal bundles each restate the `system-prompt` row. A value set at the base layer is therefore discarded by every mode bundle that patches the row afterwards, which is the exact opposite of a rule every profile is meant to share. Verified against the real composed layer lists: with the config-field shape, `web-app`, `headless`, `acp-app`, and `sdk-app` all lost the text. The code-literal form reaches all four, because no bundle can replace what the plugin registers itself.

**A boolean, not a string, gates it.** `includeOperatingGuidance` defaults to `true`, mirroring `includeHarnessIdentity` directly above it. The sdk-minimal bundle sets it `false` for the same reason it already sets `includeHarnessIdentity: false` and `includeRuntimeContext: false`: that profile pins a byte-exact minimal prompt, and a rule it did not ask for would break the pin.

The section name is harness-owned, so a scoped `deployment:persona-prefix` — how an agent preset replaces the persona — leaves it in place. The name is reserved like the other built-ins: a second registration of it throws.

The text names three habits as one discipline: a command that already failed for an environmental reason fails the same way again, so do not rerun it to confirm — report the limitation, or state what changed first; a command whose duration is unknown or long belongs in the background so independent work continues; and a long command's output is captured in a file before any filter reads it, so a later question about that output never pays for a second run. Each sentence was measured in a real session before it was added — the third after a session spent three full test-suite runs and two snapshot refreshes because piped output had been discarded. The rule stays terse because it is rendered on every request and competes with the persona for the model's attention.

## Alternatives considered

**Deployment config (`operatingGuidance`) on the base bundle row.** Rejected by measurement, not preference: each mode bundle replaces that row's whole config, so the value vanished in every profile that patches `system-prompt` after the base layer. Restating the string in all five bundles would make one shared rule five independently drifting copies.

**Register it from `dsh-tool-bash` as a cross-call habit, beside the existing exit-code guidance.** The closest neighbour, and it would have been the answer if the rule were per-tool. It is not: the rule also covers `pnpm`-style commands reached through the same shell, and a deployment that swaps the shell provider would silently lose it.

**Put it in the deployment persona or the shipped presets' `dsh-persona` rows.** Rejected because presets shadow the persona slot: the rule would hold for whichever presets happened to restate it and vanish for any new or user-authored preset, including the `liangshen`-style custom presets under `$DSH_HOME/.agent-presets`.

**Rely on the model reading tool descriptions.** Rejected because the failure is not a missing tool contract — `bash` already documents `run_in_background`, and the retry has correct syntax. The model knows how to do both things; what it lacked was a standing instruction that these are the defaults.

## Consequences

Every base-backed profile now renders the discipline before its persona: Web, headless, desktop, ACP, SDK, and cortex, plus every agent preset, with `sdk-minimal` opted out. Because the section sits at `-900`, inside the first-party prefix, it is a stable KV-cache prefix — the text is fixed and contains no variables — so the cost is one constant block per request rather than a per-turn invalidation.

The text is model-visible and now pinned in the packages that assert assembled prompts: `dsh-system-prompt`, `dsh-agent-loop`, `dsh-persona`, `dsh-tool-bash`, `dsh-tool-fs`, `dsh-tool-fs-search`, and `dsh-tool-web` each pin the literal in their own suite, so a reworded rule fails tests rather than shipping silently. `dsh-system-prompt` additionally pins the order relation against `DEPLOYMENT_PERSONA_PREFIX` and the opt-out.

The [guidance-ownership decision](2026-07-05-prompt-variables-and-tool-guidance-ownership.md) still governs: this section is one more cross-call habit, owned by the prompt registry rather than a tool package because it spans tools. Its session-prompt snapshots carry the new block, refreshed in the same change.
