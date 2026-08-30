# Repository Guidelines

## Structure

This app keeps main-process behavior and persistence in `main.js`; `preload.js` exposes `window.browserAPI`. UI files live in `renderer/`, reusable privileged helpers in `lib/`, icons in `build/icons/`, tests in `test/`, and CI in `.github/workflows/build.yml`. `dist/` is ignored.

## Commands

- `npm ci`: install locked dependencies.
- `npm test`: run tests.
- `npm start`: launch Electron.
- `npm run build`: package this platform.
- `npm run build:mac`: create x64/arm64 DMGs.
- `npm run build:win`: create the Windows x64 installer.

## Style, Tests, and P0 Invariants

Use CommonJS JS, HTML, and CSS. Follow surrounding two-space, semicolon, trailing-comma, `camelCase`, quote, and CSS-variable conventions. Expose only required renderer methods through `preload.js`.

Add named `test/*.test.js` regressions and run `npm test`. Smoke-test affected profile actions, filters, views, and browser paths with `npm start`; verify platform changes on that OS. PRs need a behavior/platform summary, linked issues, screenshots, and manual checks. Use Chinese commit subjects: `新增`, `修复`, `优化`, or `更新`.

Before bulk actions, filters remove hidden selections and use only visible targets. A workspace batch takes one forced snapshot and at most four concurrent operations; launch excludes running/unknown, close only running or retryable-close states. Test these rules, re-entry, and bounded failures.

Imports preview without side effects; confirmation is token-bound, invalid rows block it, duplicates skip/auto-rename, and failure rolls back only batch-created records and empty directories. Tests must prove import/export carries only browser type and profile name. Keep “new blank copy” wording unless browser data is copied. Bound status lists and chunk platform process inspection.

Diagnostics expose stable, sanitized states. Recreate only after a fresh explicit `stopped` result and exact expected-profile-path match; never repair running/unknown profiles. Unknown recovery permits only retry or warned tracking clear.

## Automatic Releases

For releases, update both manifest versions, run `npm test` and local packaging, then obtain explicit approval before pushing `main`. Actions tests macOS and Windows before creating or reusing an exact-commit annotated `v<version>` tag and publishing. Never pre-create, move, or overwrite tags; increment released versions.

## Security

Validate renderer input in main-process IPC handlers. Keep machine paths in app settings. Never commit `dist/`, local settings, profile data, credentials, or tokens.

Profile removal preserves data unless explicitly moved with Electron’s trash API. “Forget process” only clears tracking after warning acknowledgement. Tree termination is limited to app-launched processes; recovered PIDs require a fresh exact executable/profile verification immediately before signaling. Main-process launch, delete, rename, and diagnostics repair share per-profile lifecycle coordination.
