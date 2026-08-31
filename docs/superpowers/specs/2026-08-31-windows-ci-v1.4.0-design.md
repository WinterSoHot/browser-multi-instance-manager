# Windows CI Repair and v1.4.0 Design

## Goal

Restore cross-platform CI determinism, then prepare version `1.4.0` for the completed P0, system-tray, and update-check features.

## Root Cause

`main selects the dedicated tray template asset` calls the main-process harness without an explicit platform. The harness therefore uses the runner's `process.platform`, while the assertion always expects the macOS-only `trayTemplate.png`. Production code correctly uses `trayIcon.png` on Windows and Linux, and the adjacent platform-matrix test already verifies that behavior.

## Changes

- Make the dedicated-template test explicitly run with `platform: 'darwin'`.
- Keep the existing macOS/Windows/Linux matrix test unchanged.
- Do not change production tray selection or `.github/workflows/build.yml`.
- Update `package.json` and `package-lock.json` from `1.3.1` to `1.4.0` with the package manager so both manifests remain synchronized.

## Verification and Release Gate

Run the focused tray test, the full Node test suite, syntax and diff checks, and local macOS x64/arm64 packaging. Confirm both DMGs and packaged runtime files. Commit the fix and version update on the feature branch. Do not push `main`, create `v1.4.0`, or publish a Release until local verification passes and the user explicitly approves. After pushing `main`, require macOS and Windows Actions to pass before creating an exact-commit annotated tag.
