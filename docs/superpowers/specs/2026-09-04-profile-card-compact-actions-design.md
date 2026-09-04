# Profile Card Compact Actions Design

## Goal

Replace the crowded profile-card action row with a stable, compact hierarchy that remains readable with long profile names and at 680–1536px viewport widths. Existing profile operations and lifecycle safeguards remain unchanged.

## Card Structure

Each list card uses one responsive header row:

- Selection checkbox.
- A flexible identity block containing the ellipsized profile name plus browser, workspace, and sanitized runtime-status metadata.
- A fixed action group containing **启动/关闭**, **收藏**, **归属**, and a **更多** trigger.

On wide content areas the identity and action group share one row. When space is insufficient, the action group moves intact beneath the identity block. The card must never create document-level horizontal overflow. Grid view uses the same action hierarchy with its existing stacked presentation.

## More Menu

The menu contains **打开文件夹**, **查看占用大小**, **新建空白副本**, **重命名**, and **删除配置**. Delete is visually separated and uses danger styling. Menu items call the existing profile-action handlers; the menu does not duplicate business logic or bypass lifecycle coordination and confirmation flows.

Only one profile menu may be open. It closes after an action, on outside click, on `Escape`, when profiles rerender, or when its profile disappears. The trigger exposes `aria-haspopup`, `aria-expanded`, and an accessible profile-specific label. Menu interactions must not toggle the card checkbox.

## Responsive Behavior

- Above 900px: compact single row when content fits; actions stay right-aligned.
- 681–900px: action group moves to a second row without splitting individual controls.
- 680px and below: the identity remains ellipsized and actions wrap only as a group within the card.

Selected-state badges retain reserved space and may not cover the menu trigger. Long workspace names remain bounded by the select control.

## Verification

Add renderer contract tests for menu markup, action routing, accessibility, close behavior, and responsive CSS. Verify list/grid views with long names and stopped/running/unknown states at 1536px, 900px, 800px, and 680px. Run `npm test` and `npm run build:mac`, then inspect the packaged application before requesting integration approval.
