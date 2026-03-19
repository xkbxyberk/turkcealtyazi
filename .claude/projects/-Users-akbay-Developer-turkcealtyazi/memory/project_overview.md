---
name: project_overview
description: turkcealtyazi - Premiere Pro Turkish auto-subtitle UXP plugin with whisper.cpp companion app
type: project
---

Two components:
1. **Companion App** (companion-app/): whisper.cpp based local transcription server, Core ML + Metal on Apple Silicon M4, runs on port 8787, lifecycle tied to plugin open/close
2. **UXP Plugin** (uxp-plugin/): Premiere Pro panel, sends HTTP to whisper-server, generates SRT, imports to timeline

**Why:** Local Turkish speech-to-text for video editors, no cloud dependency.

**How to apply:** Currently in Phase 1 (MVP) — build whisper.cpp, download model, test transcription. Phase 2 will be the UXP plugin.
