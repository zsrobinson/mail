"""Explicit full-stack smoke: fake wire IMAP, real core API, real web/JWT proxy.

Run after `npm run build` in web/: python tests/integration_full.py.
All mail, keys and claims below are generated fixtures. No installed state,
credential, action journal or real Bridge is opened.
"""
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import http.client
import http.server
import imaplib
import json
import os
from pathlib import Path
import socket
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from access import AccessJWT
from allowlist import Allowlist
from activity import Activity
from core_api import start_api, start_metrics
import mail_mcp

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class FakeIMAP(socketserver.StreamRequestHandler):
    body_fetches = []
    def handle(self):
        def write(value):
            self.wfile.write(value)
            self.wfile.flush()
        write(b'* OK synthetic IMAP\r\n')
        while line := self.rfile.readline():
            tag, cmd, *rest = line.decode().strip().split(' ', 2)
            args = rest[0] if rest else ''
            if cmd == 'CAPABILITY':
                write(b'* CAPABILITY IMAP4rev1 MOVE\r\n')
            elif cmd == 'NOOP':
                pass
            elif cmd == 'LOGIN':
                pass
            elif cmd in ('EXAMINE', 'SELECT'):
                write(b'* 2 EXISTS\r\n* OK [UIDVALIDITY 1] synthetic\r\n')
            elif cmd == 'UID':
                operation, value = args.split(' ', 1)
                if operation == 'SEARCH':
                    write(b'* SEARCH 1 2\r\n')
                elif operation == 'FETCH':
                    uids, fields = value.split(' ', 1)
                    for uid in uids.split(','):
                        message = EmailMessage()
                        message['From'] = 'updates@example.org' if uid == '1' else 'unapproved@example.net'
                        message['To'] = 'owner@example.org'
                        message['Subject'] = 'Synthetic full-stack fixture'
                        message['Authentication-Results'] = 'receiver.example.org; dmarc=pass header.from=example.org'
                        message.set_content('Synthetic permitted body')
                        raw = message.as_bytes(policy=__import__('email.policy').policy.SMTP)
                        if 'HEADER.FIELDS' in fields:
                            raw = raw.split(b'\r\n\r\n')[0] + b'\r\n\r\n'
                            section = b'HEADER.FIELDS (From Authentication-Results)'
                        else:
                            self.body_fetches.append(uid)
                            section = b''
                        write(f'* {uid} FETCH (UID {uid} FLAGS () RFC822.SIZE 500 BODY['.encode() + section + b'] {' + str(len(raw)).encode() + b'}\r\n' + raw + b')\r\n')
                else:
                    raise AssertionError('Only reads are exercised')
            elif cmd == 'LOGOUT':
                write(b'* BYE fixture complete\r\n' + tag.encode() + b' OK logout\r\n')
                break
            else:
                raise AssertionError('Unsupported synthetic command')
            write(tag.encode() + b' OK fixture\r\n')


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=3)
        self.path = path
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.connect(self.path)


def main():
    servers, web = [], None
    old_env = os.environ.copy()
    with tempfile.TemporaryDirectory(prefix='mail-full-stack-') as temporary:
        temp = Path(temporary)
        try:
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key())) | {'kid': 'synthetic', 'use': 'sig', 'alg': 'RS256'}
            keyfile, certfile = temp / 'key.pem', temp / 'cert.pem'
            # TLS fixtures only: output is discarded, nothing is installed.
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(keyfile), '-out', str(certfile), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            class JWKS(http.server.BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass
                def do_GET(self):
                    assert self.path == '/cdn-cgi/access/certs'
                    raw = json.dumps({'keys': [jwk]}).encode()
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
            keys = http.server.ThreadingHTTPServer(('127.0.0.1', 0), JWKS)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certfile, keyfile)
            keys.socket = context.wrap_socket(keys.socket, server_side=True)
            servers.append(keys)
            issuer = f'https://localhost:{keys.server_port}'
            os.environ['SSL_CERT_FILE'] = str(certfile)
            os.environ.pop('ACCESS_JWKS_FILE', None)
            os.environ['MAIL_ACTIVITY'] = str(temp / 'activity/activity.jsonl')
            os.environ['PROTON_ACTION_LOG'] = str(temp / 'actions/actions.jsonl')
            os.environ['MAIL_ALLOWLIST'] = str(temp / 'policy/allowlist.json')
            os.environ['MAIL_TRUSTED_AUTHSERV_ID'] = 'receiver.example.org'
            (temp / 'policy').mkdir(mode=0o700)
            policy_path = temp / 'policy/allowlist.json'
            policy_path.write_text('{"version":1,"entries":[],"history":[]}')
            policy_path.chmod(0o600)
            policy = Allowlist(policy_path)
            policy.edit(changes={'address':'updates@example.org'})
            mail_mcp._policy_instance = policy
            activity = Activity(temp / 'activity/activity.jsonl', temp / 'health/health.jsonl')
            mail_mcp._activity_instance = activity
            imap = socketserver.ThreadingTCPServer(('127.0.0.1', 0), FakeIMAP)
            imap.daemon_threads = True
            servers.append(imap)
            for server in servers:
                threading.Thread(target=server.serve_forever, daemon=True).start()
            def factory():
                client = imaplib.IMAP4('127.0.0.1', imap.server_address[1], timeout=3)
                with mail_mcp.phase('login'):
                    client.login('fixture', 'fixture')
                if getattr(mail_mcp._local, 'metrics', None) is not None:
                    mail_mcp._local.metrics['login_ok'] = True
                client.bridge_username = 'owner@example.org'
                return client
            call = lambda name, args: mail_mcp.call(name, args, factory=factory)
            result = call('read_messages', {'messages': [dict(folder='INBOX', uid=uid, uidvalidity='1') for uid in ('1','2')]})
            assert 'body' in result['messages'][0]
            assert set(result['messages'][1]) == {'folder','uid','uidvalidity','refusal'}
            assert FakeIMAP.body_fetches == ['1']
            # Header-only operations never load a body.
            call('list_messages', {'folder':'INBOX'})
            assert FakeIMAP.body_fetches == ['1']
            probe = mail_mcp.probe_bridge(factory)
            assert probe['connected'] and probe['login_ms'] >= 0
            activity.health_store.append(probe)
            assert FakeIMAP.body_fetches == ['1']
            directory = temp / 'api'
            directory.mkdir(mode=0o750)
            verifier = AccessJWT(f'localhost:{keys.server_port}', 'synthetic-web-audience')
            api = start_api(str(directory / 'core.sock'), threading.Lock(), call, policy, activity, verifier)
            servers.append(api)
            metrics = start_metrics(activity, 0)
            servers.append(metrics)
            def token(audience='synthetic-web-audience', expires=300):
                return jwt.encode({'iss':issuer,'aud':audience,'email':'owner@example.org','exp':int(time.time())+expires}, key, algorithm='RS256', headers={'kid':'synthetic'})
            # The core independently rejects another audience and an expired token.
            for assertion in (token('other-audience'), token(expires=-1), None):
                conn = UnixConnection(str(directory / 'core.sock'))
                headers = {'Content-Type':'application/json'}
                if assertion:
                    headers['Cf-Access-Jwt-Assertion'] = assertion
                conn.request('POST', '/api/allowlist', '{"address":"blocked@example.org"}', headers)
                assert conn.getresponse().status == 401
                conn.close()
            manifest = temp / 'services.json'
            manifest.write_text('[]')
            port = free_port()
            env = dict(os.environ, NODE_ENV='production', NODE_EXTRA_CA_CERTS=str(certfile), ACCESS_ISSUER=issuer,
                       ACCESS_AUD='synthetic-web-audience', PUBLIC_ORIGIN=f'http://127.0.0.1:{port}',
                       SERVICE_MANIFEST=str(manifest), MAIL_CORE_SOCKET=str(directory / 'core.sock'), PORT=str(port), METRICS_TOKEN='synthetic-metrics')
            env.pop('MAIL_FIXTURES', None)
            web = subprocess.Popen(['node', 'dist-server/server.js'], cwd=ROOT / 'web', env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(50):
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1):
                        break
                except OSError:
                    if web.poll() is not None:
                        raise AssertionError('Fixture web process exited')
                    time.sleep(.1)
            def request(path, method='GET', body=None, assertion=None):
                headers = {'Cf-Access-Jwt-Assertion': assertion or token(), 'Origin':f'http://127.0.0.1:{port}'}
                if body is not None:
                    headers['Content-Type'] = 'application/json'
                conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
                conn.request(method,path,json.dumps(body) if body is not None else None,headers)
                response = conn.getresponse()
                raw = response.read()
                conn.close()
                return response.status,json.loads(raw)
            for path in ('/api/overview?range=24h','/api/activity','/api/health','/api/allowlist'):
                status, value = request(path)
                assert status == 200, (path,status)
            status, value = request('/api/overview?range=24h')
            assert value['totals']['body_reads_allowed'] == 1 and value['totals']['body_reads_refused'] == 1
            status, value = request('/api/allowlist','POST',{'address':'new@example.org','note':'Synthetic','expires_at':None})
            assert status == 201
            ident = value['entry']['id']
            assert request('/api/allowlist/'+ident, 'PATCH', {'note':'Changed synthetic'})[0] == 200
            assert request('/api/allowlist/'+ident)[0] == 200
            assert request('/api/allowlist/'+ident,'DELETE',{})[0] == 200
            assert request('/api/allowlist','POST',{'address':'bad@example.org'},token('wrong'))[0] == 401
            assert request('/api/overview',assertion=token(expires=-1))[0] == 401
            with urllib.request.urlopen(f'http://127.0.0.1:{metrics.server_port}/metrics',timeout=3) as response:
                output = response.read().decode()
            assert 'mail_read_refusals_total{reason="sender_not_allowlisted"} 1' in output
            assert 'example.org' not in output and 'example.net' not in output
            print('Full-stack fixture smoke passed: fake wire IMAP + core Unix API + production web + signed JWT re-check + metrics; no real mail/state accessed.')
        finally:
            if web is not None:
                web.terminate()
                web.wait(timeout=5)
            for server in reversed(servers):
                server.shutdown()
                server.server_close()
            os.environ.clear()
            os.environ.update(old_env)


if __name__ == '__main__':
    main()
