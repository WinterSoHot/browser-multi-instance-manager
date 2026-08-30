# Repository Guidelines

## Structure

Core `main.js`; bridge `preload.js`; UI `renderer/`; helpers `lib/`; icons `build/icons/`; tests `test/`; CI `.github/workflows/build.yml`; `dist/` ignored.

## Commands

- `npm ci`: locked install.
- `npm test`: run tests.
- `npm start`: launch Electron.
- `npm run build`: package this platform.
- `npm run build:mac`: create x64/arm64 DMGs.
- `npm run build:win`: create Windows x64 installer.

## Style, Tests, and P0 Invariants

Use CommonJS JS/HTML/CSS with two-space indents, semicolons, trailing commas, `camelCase`, quotes, and CSS variables. `preload.js` exposes only required renderer methods.

Add `test/*.test.js` regressions; run `npm test`. Smoke-test paths/platforms. PRs need summary, screenshots, and manual checks. Use Chinese commit subjects: `新增`, `修复`, `优化`, or `更新`.

Before bulk actions remove hidden selections. Workspace/tray launches use one forced snapshot, skip running/unknown, and max four; close only running/retryable states. Test re-entry/bounded failures.

## System Tray

Closing to tray defaults on and uses the persisted app setting. Tray open/double-click restores; explicit manager exit never closes browsers. Running/unknown requires an exit warning. Disabled: Windows/Linux last-window close uses the same check; macOS follows normal behavior. Do not add tray polling, process-error leaks, or lifecycle/queue bypasses.

Imports preview without side effects; confirmation is token-bound; invalid rows block it; duplicates skip/auto-rename; failures roll back only batch records/empty directories. Import/export only browser type/profile name. Keep “new blank copy” wording unless browser data is copied. Bound status lists and chunk platform process inspection.

Renderer and diagnostics expose only stable, sanitized states. Repair only after a fresh explicit `stopped` result and exact expected-profile-path match; never repair running/unknown. Unknown recovery permits only retry or a warned tracking clear, which only clears tracking data and never signals an unverified PID.

## Automatic Releases

For releases, update both manifest versions, run `npm test` and local packaging, then obtain explicit approval before pushing `main`. Actions tests macOS and Windows before creating or reusing an exact-commit annotated `v<version>` tag and publishing. Never pre-create, move, or overwrite tags; increment released versions.

## Security

Validate renderer input in main-process IPC handlers. Keep machine paths in app settings. Never commit `dist/`, local settings, profile data, credentials, or tokens.

Profile removal preserves data; move it with Electron’s trash API only after explicit choice. “Forget process” only clears tracking data, requires warning acknowledgement, and never signals an unverified PID. Tree termination is limited to app-launched processes; recovered PIDs need fresh exact executable/profile verification immediately before signaling. Launch, delete, rename, and diagnostics repair share per-profile lifecycle coordination.
