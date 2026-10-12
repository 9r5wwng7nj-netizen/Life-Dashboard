# Accessibility

The shared UI now links visible labels to their fields, names otherwise unlabeled filters, hides decorative icons from assistive technology, labels embedded players, and announces success/error notices in persistent live regions.

## Keyboard behavior

- A skip link moves focus to the main content.
- Main-view navigation focuses the page heading. Switching a section preserves focus on the selected button, which exposes its pressed state.
- Dialogs are named by their heading, move focus inside, make the background inert, wrap Tab/Shift+Tab, close with Escape, and return focus to the opener or page heading.
- Replacing a dialog preserves focus and text selection on the matching field when possible.
- A closed mobile sidebar is inert and absent from keyboard navigation. Opening it focuses its first navigation button; Escape closes it and returns to the menu button.
- Custom actions, Scripture verse selection and hidden photo/file pickers support keyboard activation.
- Task-board titles are native edit buttons, even when the card contains other controls. Completed task text keeps its strike-through without reducing the opacity of the entire card/row.
- Journal Focus is a named dialog with an inert workspace/sidebar/header, Tab/Shift+Tab wrapping, a visible writing-field focus indicator, Escape timer/dictation cleanup and return focus. The normal journal type selector and family detail actions have meaningful names.
- Focus is set once, synchronously, when Journal Focus opens. CI exposed and fixed an older delayed call that could steal focus after the user began navigating.
- Keyboard focus has a visible outline; reduced-motion preferences suppress decorative motion.

## Development rules

Prefer explicit associated labels or meaningful aria-label values when adding controls. The existing label/field pattern is associated by enhanceAccessibility() after rendering. Add filter names there only when no visible label exists. Do not remove a control's explicit accessible name.

Use Modal.open()/Modal.close() rather than custom overlays. Decorative icons use aria-hidden, so icon-only buttons need their own name. Uploaded photos still need meaningful descriptions appropriate to their context.

## Verification and limits

The browser suite scans all nine views and their available top-level sections, in light and dark mode, plus Settings and common exercise/recipe/task/article editors. Keyboard tests cover dialog focus, focus restoration, mobile navigation, section controls, notices and file pickers. The scans use axe-core's WCAG 2 A/AA and WCAG 2.1 AA rules.

The populated CLI probe additionally scans 14 light/dark detail states (Task board, Journal editor/Focus, Family member/rating, book detail and study editor), and tests Journal Focus wrapping, visible focus, Escape and return focus. This exposed and fixed gaps that empty-screen scans did not catch. A manual VoiceOver session has not been performed; use docs/MANUAL_VERIFICATION.md for the remaining checklist.

Passing automated checks is not a claim of full WCAG compliance. Manual VoiceOver/TalkBack testing, other browsers, complex screens populated with years of records, and the remaining WCAG 2.2 checks (including detailed target-size review) are still needed.

The implementation follows W3C's [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [form labeling guidance](https://www.w3.org/WAI/tutorials/forms/labels/).
