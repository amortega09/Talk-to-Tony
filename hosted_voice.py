"""Authenticated, serverless voice drafting. No desktop process or audio upload.
Deploy through Vercel; browser speech recognition supplies the editable text.
"""
import http.client
import json
import os
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit
import desktop


class AccessError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def authenticate(headers):
    value = headers.get('Authorization', '')
    if not value.startswith('Bearer ') or not value[7:].strip():
        raise AccessError(401, 'Please sign in to Day to use voice.')
    url = urlsplit(os.environ.get('SUPABASE_URL', ''))
    anon = os.environ.get('SUPABASE_ANON_KEY', '')
    owners = {value.strip() for value in os.environ.get('DAY_ALLOWED_USER_IDS', '').split(',') if value.strip()}
    if url.scheme != 'https' or not url.netloc or url.path not in ['', '/'] or not anon or not owners:
        raise AccessError(503, 'Voice is being set up. Please try again shortly.')
    connection = http.client.HTTPSConnection(url.netloc, timeout=10)
    try:
        connection.request('GET', '/auth/v1/user', headers={'apikey': anon, 'Authorization': value})
        response = connection.getresponse()
        data = json.loads(response.read(64000))
        if response.status != 200:
            raise AccessError(401, 'Your session expired. Please sign in again.')
        if data.get('id') not in owners:
            raise AccessError(403, 'Voice is not enabled for this account.')
        return data['id']
    finally:
        connection.close()


class HostedVoiceHandler(BaseHTTPRequestHandler):
    route = ''

    def log_message(self, *_args):
        pass

    def origin_allowed(self):
        origin = self.headers.get('Origin')
        allowed = {'https://amortega09.github.io'} | {value.strip() for value in os.environ.get('DAY_ALLOWED_ORIGINS', '').split(',') if value.strip()}
        host = self.headers.get('Host', '')
        return not origin or origin in allowed or origin == 'https://' + host

    def send(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if self.headers.get('Origin') and self.origin_allowed():
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.origin_allowed():
            return self.send(403, {'error': 'This website cannot use the voice service.'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', ''))
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Vary', 'Origin')
        self.end_headers()

    def handle_voice(self, method):
        if not self.origin_allowed():
            return self.send(403, {'error': 'This website cannot use the voice service.'})
        try:
            authenticate(self.headers)
            if self.route == 'status' and method == 'GET':
                models = [model['name'] for model in desktop.cloud_models()]
                recommended = desktop.RECOMMENDED_MODEL if desktop.RECOMMENDED_MODEL in models else None
                return self.send(200, {'transport': 'hosted', 'transcription_mode': 'browser', 'models': models,
                    'recommended_model': recommended, 'default_model': recommended or '',
                    'api_key_ready': bool(desktop.api_key()), 'transcription_ready': True})
            if self.route == 'draft' and method == 'POST':
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > 80000:
                    return self.send(413, {'error': 'That is a little too much at once. Try a shorter description.'})
                value = json.loads(self.rfile.read(length))
                if not isinstance(value, dict):
                    raise ValueError('Please describe your day and try again.')
                return self.send(200, desktop.interpret(value, timeout=45))
            return self.send(405, {'error': 'Method not allowed.'})
        except AccessError as error:
            self.send(error.status, {'error': error.message})
        except ValueError as error:
            self.send(400, {'error': str(error)[:300]})
        except (OSError, http.client.HTTPException):
            self.send(503, {'error': 'Voice is taking a moment. Your words are safe—please try again.'})

    def do_GET(self):
        self.handle_voice('GET')

    def do_POST(self):
        self.handle_voice('POST')
