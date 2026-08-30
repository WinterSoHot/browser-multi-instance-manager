# Repository Guidelines

## Structure

This is a small Electron desktop app. `main.js` owns the main process, IPC handlers, browser launching, and `electron-store` persistence; `preload.js` exposes `window.browserAPI`. Renderer pages and shared CSS live in `renderer/`, packaged icons in `build/icons/`, tests in `test/`, and release automation in `.github/workflows/build.yml`. Keep generated installers in ignored `dist/`.

## Commands

- `npm ci`: install the locked dependency set.
- `npm test`: run Node’s built-in tests.
- `npm start`: launch Electron locally.
- `npm run build`: package for the current platform.
- `npm run build:mac`: create x64 and arm64 DMGs.
- `npm run build:win`: create the Windows x64 NSIS installer.
- `npm run build:all`: request both platforms; host restrictions may apply.

## Style and Tests

Use CommonJS JavaScript, HTML, and CSS; discuss new frameworks first. Follow surrounding style: two-space indentation, semicolons, multiline trailing commas, `camelCase` names, existing quote style, and shared CSS variables. Keep browser behavior in `main.js` and expose only required renderer methods through `preload.js`.

Add regressions as `test/*.test.js`, name the protected behavior, and run `npm test`. Smoke-test affected actions, search/filter, view switching, and browser paths with `npm start`. Verify platform-specific changes on that OS. PRs should summarize behavior and platform impact, link issues, include UI screenshots, and record manual checks. Use focused Chinese commit subjects such as `新增`, `修复`, `优化`, or `更新`.

For process or bulk-operation changes, cover bulk snapshots, unknown recovered-process states, and the four-operation concurrency limit. Import/export tests must prove that only browser type and profile name leave the app.

## Automatic Releases

For a release, update both manifest versions, run `npm test` and the relevant local package command, and obtain explicit approval before pushing `main`. Actions tests PRs and `main` on macOS and Windows. An already-published version only tests; otherwise both installers must build before Actions creates or reuses a same-commit annotated `v<version>` tag and publishes the Release. Never create, move, or overwrite the tag beforehand; increment released versions.

## Security

Treat IPC as a trust boundary and validate renderer input in main-process handlers. Keep machine-specific browser paths in app settings. Never commit `dist/`, local settings, profile data, credentials, or publishing tokens; use repository secrets.

Profile removal preserves data by default. Local data may only be moved with Electron’s system trash API after an explicit UI choice; never permanently delete profile directories. “Forget process” clears only a recovered tracking record and must never signal an unverified PID.
