# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An Electron desktop application for managing multiple browser instances with separate user profiles. Supports Chrome, Firefox, and Microsoft Edge on macOS and Windows.

## Common Commands

```bash
npm install           # Install dependencies
npm start             # Run application in development mode
npm run build:mac     # Build macOS DMG (x64 + arm64)
npm run build:win     # Build Windows EXE (x64)
npm run build:all     # Build for all platforms
```

## Architecture

The app follows a standard Electron structure:

- **main.js** - Electron main process handling IPC, browser launching, and profile management via electron-store
- **preload.js** - Context bridge exposing secure APIs to renderer
- **renderer/** - UI layer (vanilla JS + HTML + CSS)

### IPC Communication Pattern

Main process exposes these handlers via `ipcMain.handle()`:
- `get-profiles` - Retrieve all saved browser profiles
- `add-profile` - Create new browser profile with type and name
- `delete-profile` - Remove profile by ID
- `launch-browser` - Launch browser with specified profile
- `rename-profile` - Rename profile and its directory
- `open-profile-folder` - Open profile directory in system file manager

### Browser Launching

The app locates browsers at fixed macOS paths:
- Chrome: `/Applications/Google Chrome.app`
- Firefox: `/Applications/Firefox.app`
- Edge: `/Applications/Microsoft Edge.app`

Each browser is launched with profile-specific arguments:
- Chrome/Edge: `--user-data-dir=<path>`
- Firefox: `-profile <path>`

### Profile Storage

Profiles are persisted using electron-store at `{userData}/browser-profiles.json`. Profile directories are stored in `{userData}/profiles/{browserType}/{profileName}/`.

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`):
- Builds on tag push (`v*`) or manual workflow dispatch
- Produces DMG for macOS (x64 + arm64) and NSIS installer for Windows
- Creates GitHub releases automatically using ncipollo/release-action