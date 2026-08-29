# Repository Guidelines

## Project Structure & Module Organization

This is a small Electron desktop application. `main.js` owns the main process, IPC handlers, browser launching, and profile persistence through `electron-store`. `preload.js` exposes the `window.browserAPI` bridge. UI files live in `renderer/`: `index.*` implements profile management, `settings.*` implements browser-path settings, and `styles.css` provides shared styling. Packaged icons are under `build/icons/`; release automation is in `.github/workflows/build.yml`. Generated installers belong in ignored `dist/`.

## Build, Test, and Development Commands

- `npm ci` installs the locked dependency set for clean checkouts and CI.
- `npm test` runs the Node.js unit tests under `test/`.
- `npm start` launches the application locally with Electron.
- `npm run build` builds installers for the current platform into `dist/`.
- `npm run build:mac` creates macOS DMGs for x64 and arm64.
- `npm run build:win` creates the Windows x64 NSIS installer.
- `npm run build:all` requests both platform builds; tooling may require the matching host OS.

There is currently no lint or formatting command.

## Coding Style & Naming Conventions

Use plain CommonJS JavaScript, HTML, and CSS; discuss new frameworks first. Match surrounding code: two-space indentation, semicolons, trailing commas in multiline objects, `camelCase` variables/functions, and descriptive IPC names such as `open-profile-folder`. Keep browser behavior in `main.js`, expose renderer capabilities through `preload.js`, and reuse CSS custom properties from `:root`. Preserve each file's quote style.

## Testing Guidelines

Add tests in `test/*.test.js` with Node's built-in `node:test` runner. Name tests after the regression or behavior they protect, then run `npm test`. Also run focused smoke tests with `npm start` for affected profile actions, folder opening, search/filter, view switching, and custom browser paths. Test platform-specific path or packaging changes on the relevant OS. In pull requests, list the scenarios and operating systems checked.

## Commit & Pull Request Guidelines

Recent history uses concise Chinese subjects, often prefixed by intent (`新增`, `修复`, `优化`, `更新`) or a release label such as `v1.2.1 - ...`. Keep each commit focused and use the same imperative style. Pull requests should summarize behavior changes, identify platform impact, link related issues, include screenshots for UI changes, and record manual verification. Do not commit `dist/`, local settings, user profile data, or credentials.

## Release Process

Before merging a release, update both `package.json` and `package-lock.json` to the same version, run `npm test`, and run the platform-appropriate packaging command, such as `npm run build:mac`. Push `main` only after local packaging succeeds and approval is explicit. GitHub Actions then runs macOS and Windows tests for pull requests and `main` pushes; if that version already has a published release, the workflow stops after testing, otherwise it builds both installers, creates or reuses the same-commit annotated tag, and publishes the GitHub Release. Do not create a release tag manually in advance, and never move, reuse, or overwrite an existing release tag; publish a new patch version instead.

## Security & Configuration

Treat IPC as a trust boundary: validate renderer inputs in main-process handlers and expose only required methods through `contextBridge`. Keep machine-specific browser paths in application settings, not source code. Never add publishing tokens to `package.json` or workflow files; use repository secrets.
