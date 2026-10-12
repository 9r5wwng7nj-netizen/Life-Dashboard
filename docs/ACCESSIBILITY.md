# Accessibility

The shared UI now links visible labels to their fields, names otherwise unlabeled filters, hides decorative icons from assistive technology, labels embedded players, and announces success/error notices in persistent live regions.

## Keyboard behavior

- A skip link moves focus to the main content.
- Main-view navigation focuses the page heading. Switching a section preserves focus on the selected button, which exposes its pressed state.
- Dialogs are named by their heading, move focus inside, make the background inert, wrap Tab/Shift+Tab, close with Escape, and return focus to the opener or page heading.
- Replacing a dialog preserves focus and text selection on the matching field when possible.
- A closed mobile sidebar is inert and absent from keyboard navigation. Opening it focuses its first navigation button; Escape closes it and returns to the menu button.
- Custom actions, Scripture verse selection and hidden photo/file pickers support keyboard activation.
- Keyboard focus has a visible outline; reduced-motion preferences suppress decorative motion.

## Development rules

Prefer explicit associated labels or meaningful aria-label values when adding controls. The existing label/field pattern is associated by enhanceAccessibility() after rendering. Add filter names there only when no visible label exists. Do not remove a control's explicit accessible name.

Use Modal.open()/Modal.close() rather than custom overlays. Decorative icons use aria-hidden, so icon-only buttons need their own name. Uploaded photos still need meaningful descriptions appropriate to their context.

## Verification and limits

The browser suite scans all nine views and their available top-level sections, in light and dark mode, plus Settings and common exercise/recipe/task/article editors. Keyboard tests cover dialog focus, focus restoration, mobile navigation, section controls, notices and file pickers. The scans use axe-core's WCAG 2 A/AA and WCAG 2.1 AA rules.

Passing automated checks is not a claim of full WCAG compliance. Manual VoiceOver/TalkBack testing, other browsers, complex screens populated with years of records, and the remaining WCAG 2.2 checks (including detailed target-size review) are still needed.

The implementation follows W3C's [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [form labeling guidance](https://www.w3.org/WAI/tutorials/forms/labels/).
