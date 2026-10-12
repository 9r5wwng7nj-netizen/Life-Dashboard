# Manual verification checklist

Status: **not yet performed**. Automated accessibility/keyboard tests are useful but cannot establish what a screen reader actually announces.

Use synthetic records in a test browser/origin. Do not import test data into the browser/profile containing personal records. Record the browser, operating system, date, actual spoken wording and any failed step. Do not mark a box complete based on automated tests alone.

## VoiceOver on Mac — guided check

Only enable it when Seth chooses to do so. Apple's [VoiceOver on/off guide](https://support.apple.com/en-gb/guide/voiceover/vo2682/mac) documents Command-F5 (a function-key modifier may be needed). Use the same shortcut to turn it off afterward. Apple's [general command guide](https://support.apple.com/guide/voiceover/general-commands-cpvokys01/10/mac/27) explains the VoiceOver modifier. Do not change system settings automatically.

- [ ] Find the skip link, page heading and named main-navigation region.
- [ ] Open Settings: hear its dialog name and each field label. Navigate forward/backward without reaching background controls. Close and verify return to the opener.
- [ ] Open a synthetic task from both Board and Today. Hear its title/edit control and separate completion checkbox. Cancel without altering a real task.
- [ ] Open a synthetic Journal entry: hear the entry-type field name and editor.
- [ ] Enter Journal Focus: hear the dialog name and text field. Verify keyboard/VoiceOver navigation stays inside it; close with Escape and check return focus.
- [ ] Open a synthetic Family member: identify Remove member, Add quote/first and Add gift idea controls without guessing icons.
- [ ] Trigger a safe test success/error message: hear it once without focus being moved unexpectedly.
- [ ] Check selected section/rating state and close a repeated/replaced editing dialog.
- [ ] Check reading order and embedded-player names, including unfamiliar content and long labels.
- [ ] Record small-target/zoom issues for WCAG 2.2 review. Passing this brief check is not certification.

## Optional permission-based checks

- [ ] With explicit user approval, test notifications in a synthetic timer/task context and confirm permission-denied recovery.
- [ ] With explicit user approval, test dictation using a synthetic note and confirm stop/permission-denied behavior.
- [ ] Test podcast playback with a public sample and confirm pause/resume without autoplay surprises.
- [ ] Test optional user-entered service keys locally, never through chat or repository files.

TalkBack and actual mobile-device checks belong to the later mobile phase; do not start hosting or sync to make this checklist possible without Seth's approval.
