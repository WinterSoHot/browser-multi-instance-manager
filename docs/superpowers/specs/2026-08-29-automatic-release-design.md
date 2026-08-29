# Automatic Release Workflow Design

## Goal

Make every pull request and `main` push prove cross-platform health, while ensuring a release tag is created only after the matching macOS and Windows packages build successfully. The release version is read from `package.json`; maintainers do not enter it in the Actions UI.

## Workflow Structure

Replace the tag-triggered workflow with one workflow triggered by pull requests, pushes to `main`, and input-free `workflow_dispatch` reruns on `main`. A preparation job reads `package.json`, validates its SemVer value, derives `v<version>`, and checks the repository's existing tag and release state. Pull requests are always non-releasing.

macOS and Windows jobs install the locked dependencies with `npm ci` and run `npm test`. On a `main` push whose derived tag has no published release, the same jobs also run their platform packaging command and upload short-lived artifacts. Ordinary commits that retain an already-released version still receive cross-platform tests but skip packaging.

The release job depends on both platform jobs. It downloads their artifacts, rechecks the tag to protect against concurrent runs, creates an annotated tag at the tested commit if needed, pushes it, and creates the GitHub Release from the DMG and EXE files. A tag that exists without a release may be resumed only when it points to the same commit; a conflicting tag is never moved or reused.

## Reliability and Security

Do not apply workflow-level concurrency, because every `main` push must reach its platform tests. Concurrent release candidates fail closed by rechecking the remote release and tag state before publication. Default permissions remain read-only; only the final release job receives `contents: write`. Upgrade official JavaScript actions to their current Node 24-compatible majors: `actions/checkout@v5`, `actions/setup-node@v5`, `actions/upload-artifact@v6`, and `actions/download-artifact@v6`. The application itself continues testing on Node.js 20.

Failures before the release job leave no new tag. If release creation fails after the annotated tag is pushed, rerunning the same commit can reuse that exact tag and finish the Release without rewriting history.

## Contributor Process

Update the version in both `package.json` and `package-lock.json`, run `npm test` and the relevant local package command, then push to `main` only after explicit approval. GitHub Actions handles cross-platform validation, skips packaging when that version is already published, and otherwise builds both installers before creating or reusing the same-commit annotated tag and publishing the Release. `AGENTS.md` will document this flow and prohibit manual pre-build tags, moving tags, or reusing released versions.

## Verification

Add regression tests that inspect the workflow structure and package scripts. Before committing, run `npm test`, validate the workflow YAML syntax, and run `npm run build:mac` locally. The first real release after this change provides the Windows packaging proof that macOS cannot supply locally, while pull requests and non-bumping `main` pushes still prove both platforms can install dependencies and pass tests.
