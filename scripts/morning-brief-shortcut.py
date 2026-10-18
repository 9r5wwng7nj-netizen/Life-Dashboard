#!/usr/bin/env python3
"""Builds assets/shortcuts/Morning-brief.shortcut, the iPhone Shortcut for the Morning brief (reader/connector.js).

It asks for the person's private brief link when it is added (a Shortcuts "import question"), opens it, shows the answer as a
notification and reads it aloud. Signing needs a Mac signed in to iCloud:   python3 scripts/morning-brief-shortcut.py
The signed file is what the dashboard's "Add the shortcut" button and the Worker's setup page point to. No secret is in it:
the link is typed in by the person when they add the shortcut."""
import plistlib, subprocess, sys, tempfile, uuid, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
out = root / 'assets' / 'shortcuts' / 'Morning-brief.shortcut'
link_id, get_id = str(uuid.uuid4()).upper(), str(uuid.uuid4()).upper()
OBJ = '￼'  # where a variable sits inside a text field

def variable(output_name, output_uuid):
    return {'Value': {'string': OBJ, 'attachmentsByRange': {'{0, 1}': {'OutputName': output_name, 'OutputUUID': output_uuid, 'Type': 'ActionOutput'}}}, 'WFSerializationType': 'WFTextTokenString'}

actions = [
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext', 'WFWorkflowActionParameters': {'UUID': link_id, 'WFTextActionText': 'Paste your Morning brief link'}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl', 'WFWorkflowActionParameters': {'UUID': get_id, 'WFURL': variable('Text', link_id), 'WFHTTPMethod': 'GET'}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.notification', 'WFWorkflowActionParameters': {'WFNotificationActionTitle': 'Morning brief', 'WFNotificationActionBody': variable('Contents of URL', get_id)}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.speaktext', 'WFWorkflowActionParameters': {'WFText': variable('Contents of URL', get_id), 'WFSpeakTextWait': True}},
]
shortcut = {
    'WFQuickActionSurfaces': [], 'WFWorkflowActions': actions, 'WFWorkflowClientVersion': '2607.0.4', 'WFWorkflowHasShortcutInputVariables': False,
    'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 59511, 'WFWorkflowIconStartColor': 4274264319},  # yellow
    # Asked once when the shortcut is added; the answer replaces the text in the first action.
    'WFWorkflowImportQuestions': [{'ActionIndex': 0, 'Category': 'Parameter', 'DefaultValue': '', 'ParameterKey': 'WFTextActionText', 'Text': 'Paste your Morning brief link (from Life Dashboard: Settings & Sync, Morning brief)'}],
    'WFWorkflowInputContentItemClasses': [], 'WFWorkflowMinimumClientVersion': 900, 'WFWorkflowMinimumClientVersionString': '900', 'WFWorkflowOutputContentItemClasses': [], 'WFWorkflowTypes': [],
}
with tempfile.TemporaryDirectory() as tmp:
    raw = pathlib.Path(tmp) / 'Morning brief.shortcut'
    raw.write_bytes(plistlib.dumps(shortcut, fmt=plistlib.FMT_BINARY))
    out.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', str(raw), '--output', str(out)], capture_output=True, text=True)
    if r.returncode: sys.exit('Signing failed (it needs a Mac signed in to iCloud): ' + (r.stderr or r.stdout).strip())
print('wrote', out.relative_to(root), out.stat().st_size, 'bytes')
