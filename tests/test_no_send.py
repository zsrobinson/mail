"""A build-time tripwire: this service can only APPEND drafts via IMAP."""
import ast
from pathlib import Path
import re

FORBIDDEN = {'smtplib', 'aiosmtplib', 'yagmail', 'sendgrid', 'mailgun', 'postmarker', 'resend', 'sendmail'}


def test_no_sending_capability_in_runtime():
    root = Path(__file__).resolve().parents[1]
    for path in root.glob('*.py'):
        if path.name.startswith('test_'):
            continue
        source = path.read_text()
        assert not re.search(r'\b(?:' + '|'.join(FORBIDDEN) + r')\b', source, re.I), path.name
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                assert not any(n.name.split('.')[0] in FORBIDDEN for n in node.names), path.name
            if isinstance(node, ast.ImportFrom):
                assert (node.module or '').split('.')[0] not in FORBIDDEN, path.name
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                assert node.value not in {'25', '465', '587', '1025'}, path.name
            if isinstance(node, ast.Constant) and type(node.value) is int:
                assert node.value not in {25, 465, 587, 1025}, path.name
        assert not re.search(r'\b(?:sendmail|send_message|sendgrid|mailgun|api\.resend)\b', source, re.I), path.name
