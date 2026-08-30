# Repository Guidelines

## Structure

This Electron app keeps main-process behavior and persistence in `main.js`; `preload.js` exposes `window.browserAPI`. UI files live in `renderer/`, reusable privileged helpers in `lib/`, icons in `build/icons/`, tests in `test/`, and CI in `.github/workflows/build.yml`. Generated installers belong in ignored `dist/`.

## Commands

- `npm ci`: install locked dependencies.
- `npm test`: run the Node test suite.
- `npm start`: launch Electron locally.
- `npm run build`: package for the current platform.
- `npm run build:mac`: create x64 and arm64 DMGs.
- `npm run build:win`: create the Windows x64 NSIS installer.

## Style and Tests

Use CommonJS JavaScript, HTML, and CSS. Follow surrounding style: two-space indentation, semicolons, multiline trailing commas, `camelCase` names, existing quote style, and shared CSS variables. Expose only required renderer methods through `preload.js`.

Add regressions as `test/*.test.js`, name the protected behavior, and run `npm test`. Smoke-test affected profile actions, filters, views, and browser paths with `npm start`; verify platform-specific changes on that OS. PRs need a behavior/platform summary, linked issues, UI screenshots when relevant, and manual checks. Use focused Chinese commit subjects such as `新增`, `修复`, `优化`, or `更新`.

For process or bulk-operation changes, cover bulk snapshots, unknown recovered-process states, and the four-operation concurrency limit. Import/export tests must prove that only browser type and profile name leave the app.

Filtering must remove hidden selections before bulk actions. Keep “new blank copy” wording unless browser data is copied. Bound status lists and chunk platform process inspection.

## Automatic Releases

For releases, update both manifest versions, run `npm test` and local packaging, then obtain explicit approval before pushing `main`. Actions tests macOS and Windows before creating or reusing an exact-commit annotated `v<version>` tag and publishing. Never pre-create, move, or overwrite tags; increment released versions.

## Security

Validate renderer input in main-process IPC handlers. Keep machine paths in app settings. Never commit `dist/`, local settings, profile data, credentials, or tokens.

Profile removal preserves data by default; only move it with Electron’s trash API after explicit choice. “Forget process” clears only tracking data, requires a warning acknowledgement, and never signals an unverified PID. Tree termination is limited to app-launched processes; recovered PIDs require a fresh exact executable/profile verification immediately before signaling. Main-process launch, delete, and rename operations must share per-profile lifecycle coordination.
