# Functionality and Performance Optimization Design

## Scope

Improve process-state reliability, bulk-operation scalability, profile lifecycle tools, browser-path discovery, and renderer responsiveness without adding dependencies or changing the existing macOS/Windows support boundary. Existing profile data remains compatible.

## Process State

The main process will expose one bulk status snapshot instead of requiring one IPC call per profile. `BrowserProcessManager` will preserve three UI states: `running`, `stopped`, and `unknown` when a recovered process cannot be verified. State changes will be pushed to the renderer; adaptive polling remains a fallback and pauses while the document is hidden. Users may refresh an unknown state or forget only its saved tracking record without terminating a process.

Process inspection will accept a shared system snapshot so multiple recovered records do not start duplicate `ps`/PowerShell commands in the same pass. Exact executable and profile-argument matching remains mandatory before terminating recovered PIDs.

## Profiles and Browser Paths

Profile names are unique within a browser type, allowing names such as `Work` in both Chrome and Firefox. The profile menu will support cloning metadata into a new isolated directory, exporting profile metadata as JSON, importing validated metadata, and optionally moving profile data to the operating-system trash when removing an entry. Import/export never copies cookies, browsing data, or credentials.

Browser settings will be loaded through one IPC call. Default-path resolution will check known macOS and Windows installation locations, including per-user Windows installs. Saving a custom path will verify that it exists and resolves to a supported executable.

## Renderer and Bulk Operations

Filtering will be centralized so “select all” affects only visible profiles. Bulk launch and close will use a concurrency limit of four, expose progress, prevent duplicate actions, and summarize long error lists. Search updates will be debounced. Profile-list events will use delegation, and unchanged cards will be retained or patched instead of rebinding listeners after every status change.

Main-process filesystem work in IPC handlers will use asynchronous APIs. Expensive directory-size calculation will be on demand and will never run during normal list rendering.

## Reliability and Testing

Initialization errors will produce visible messages instead of unhandled promise rejections. Pure helpers will cover concurrency, filtering, status normalization, imports, and browser detection. Process-manager tests will cover bulk snapshots, unknown-state recovery, and forgetting records. Existing workflow/release behavior is out of scope and must remain unchanged.

Completion requires `npm test` and a successful local `npm run build:mac`. No merge or push occurs without explicit user approval after those checks.
