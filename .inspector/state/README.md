# Durable Inspector Development State

This directory contains repository-tracked control-plane state for autonomous development.

## Files

- `campaign.yaml` — canonical machine-readable campaign/milestone/waypoint state.
- `CHECKPOINT.md` — compact recovery note for a fresh agent.

Runtime Inspector state, run databases, traces, screenshots, and generated artifacts do **not** belong here and remain gitignored.

## Update rule

Whenever a waypoint gate passes, update `campaign.yaml` and `CHECKPOINT.md` before or with the checkpoint commit. Do not claim a gate passed unless it was actually executed against the relevant revision.

This state exists so development can resume after model context loss, machine restart, or agent handoff without relying on chat memory.
