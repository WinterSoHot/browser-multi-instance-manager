# Repository Guidelines

## Structure

Core: `main.js`; `preload.js` exposes `window.browserAPI`. UI is `renderer/`, helpers `lib/`, icons `build/icons/`, tests `test/`, CI `.github/workflows/build.yml`; `dist/` is ignored.

## Commands

- `npm ci`: install locked dependencies.
- `npm test`: run tests.
- `npm start`: launch Electron.
- `npm run build`: package this platform.
- `npm run build:mac`: create x64/arm64 DMGs.
- `npm run build:win`: create the Windows x64 installer.

## Style, Tests, and P0 Invariants

Use CommonJS JS/HTML/CSS. Match existing two-space, semicolon, trailing-comma, `camelCase`, quote, and CSS-variable conventions. Keep `preload.js` minimal.

Add `test/*.test.js` regressions and run `npm test`. Smoke-test paths/platforms. PRs need a behavior summary, screenshots, and manual checks. Use Chinese commit subjects: `新增`, `修复`, `优化`, or `更新`.

Before bulk actions, filters remove hidden selections. Workspace/tray launches take one forced snapshot, skip running/unknown, and use at most four operations; close only running or retryable-close states. Test re-entry and bounded failures.

## System Tray

Closing to tray is enabled by default and is controlled only by the persisted app setting. Tray open/double-click restores the window; explicit manager exit never closes browser processes. Running or unknown states require an exit warning. With close-to-tray disabled, Windows/Linux last-window close uses the same exit check; macOS follows normal window behavior. Do not add tray polling, leak process errors, or bypass lifecycle/queued launch controls.

Imports preview without side effects; confirmation is token-bound, invalid rows block it, duplicates skip/auto-rename, and failures roll back only batch-created records/empty directories. Import/export carries only browser type and profile name. Keep “new blank copy” wording unless browser data is copied. Bound status lists and chunk inspection.

Diagnostics expose stable states. Recreate only after fresh `stopped` and expected path; never repair running/unknown. Unknown recovery permits only retry or warned clear.

## Automatic Releases

For releases, update both manifest versions, run `npm test` and local packaging, then obtain explicit approval before pushing `main`. Actions tests macOS and Windows before creating or reusing an exact-commit annotated `v<version>` tag and publishing. Never pre-create, move, or overwrite tags; increment released versions.

## Security

Validate renderer input in main-process IPC handlers. Keep machine paths in app settings. Never commit `dist/`, local settings, profile data, credentials, or tokens.

Profile removal preserves data unless explicitly moved with Electron’s trash API. “Forget process” clears tracking only after warning acknowledgement. Tree termination is limited to app-launched processes; recovered PIDs need fresh exact executable/profile checks before signaling. Launch, delete, rename, and diagnostics repair share per-profile lifecycle coordination.
