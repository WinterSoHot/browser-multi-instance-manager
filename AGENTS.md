# Repository Guidelines

## Structure

`main.js`; `preload.js`; UI `renderer/`; helpers `lib/`; icons `build/icons/`; tests `test/`; CI `.github/workflows/build.yml`; ignored `dist/`.

## Commands

- `npm ci`: locked install.
- `npm test`: run tests.
- `npm start`: launch Electron.
- `npm run build`: package this platform.
- `npm run build:mac`: create x64/arm64 DMGs.
- `npm run build:win`: create Windows x64 installer.

## Style, Tests, and P0 Invariants

Use CommonJS JS/HTML/CSS; two-space indents, semicolons, trailing commas, `camelCase`, existing quotes/CSS variables. `preload.js` exposes only required renderer methods.

Add `test/*.test.js` regressions, run `npm test`, smoke-test affected paths/platforms. PRs need summary/screenshots/manual checks. Use Chinese subjects: `新增`, `修复`, `优化`, or `更新`.

Remove hidden selections before bulk actions. Workspace/tray launches: one forced snapshot, skip running/unknown, max four; close only running/retryable. Test re-entry/bounded failures.

## System Tray

Tray close defaults on via persisted setting. Open/double-click restores; explicit manager exit never closes browsers. Warn running/unknown. Disabled: Windows/Linux last-window uses that check; macOS normal behavior. No polling, process-error leaks, lifecycle/queue bypasses.

Side-effect-free import preview; confirmation token-bound; invalid rows block; duplicates skip/auto-rename; failures roll back only batch records/empty directories. Import/export only browser type/profile name. Keep “new blank copy” wording unless browser data is copied. Bound status lists; chunk platform process inspection.

Renderer/diagnostics expose only stable, sanitized states. Repair only after fresh explicit `stopped` and exact expected-profile-path match; never running/unknown. Unknown recovery: retry or warned tracking clear only; clear tracking data only, never signal an unverified PID.

## Update Checks

Startup checks default on, GitHub Releases only. Cache successful version-bound results 24 hours; manual bypasses time cache but shares one flight. Accept/open only `https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v<semver>`; never download/install. Fail nonblocking, cache no errors, expose only sanitized stable results. Dismissal is session-only per version.

## Automatic Releases

For releases update both manifest versions, run `npm test` and local packaging, then obtain explicit approval before pushing `main`. Actions tests macOS/Windows before creating/reusing an exact-commit annotated `v<version>` tag and publishing. Never pre-create, move, or overwrite tags; increment released versions.

## Security

Validate renderer IPC input. Keep machine paths in app settings. Never commit `dist/`, local settings, profile data, credentials, tokens.

Profile removal preserves data; Electron trash only after explicit choice. “Forget process” clears tracking only, needs warning acknowledgement, never signals an unverified PID. Tree termination is limited to app-launched processes; recovered PIDs need fresh exact executable/profile verification immediately before signaling. Launch/delete/rename/diagnostics repair share per-profile lifecycle coordination.
