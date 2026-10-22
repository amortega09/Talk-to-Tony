import io
import json
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hosted_voice


class HostedTests(unittest.TestCase):
    def handler(self, route='status', headers=None, body=None):
        value = hosted_voice.HostedVoiceHandler.__new__(hosted_voice.HostedVoiceHandler)
        value.route = route
        value.headers = {'Host': 'voice.example', 'Origin': 'https://amortega09.github.io', **(headers or {})}
        value.results = []; value.send = lambda *data: value.results.append(data)
        data = json.dumps(body).encode() if body else b''
        value.headers['Content-Length'] = str(len(data)); value.rfile = io.BytesIO(data)
        return value

    def test_missing_auth_and_unconfigured_service_never_call_ollama(self):
        with patch('hosted_voice.desktop.cloud_models') as models:
            handler = self.handler(); handler.do_GET(); self.assertEqual(handler.results[0][0], 401)
            with patch.dict(os.environ, {'SUPABASE_URL': '', 'SUPABASE_ANON_KEY': '', 'DAY_ALLOWED_USER_IDS': ''}):
                handler = self.handler(headers={'Authorization': 'Bearer test'}); handler.do_GET(); self.assertEqual(handler.results[0][0], 503)
            models.assert_not_called()

    @patch('hosted_voice.http.client.HTTPSConnection')
    def test_supabase_verifies_token_and_owner_on_server(self, connection):
        response = connection.return_value.getresponse.return_value
        response.status = 200; response.read.return_value = b'{"id":"owner-test"}'
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://project.supabase.co', 'SUPABASE_ANON_KEY': 'public-test', 'DAY_ALLOWED_USER_IDS': 'owner-test'}):
            self.assertEqual(hosted_voice.authenticate({'Authorization': 'Bearer user-test'}), 'owner-test')
            self.assertEqual(connection.call_args.args[0], 'project.supabase.co')
            response.read.return_value = b'{"id":"another-user"}'
            with self.assertRaises(hosted_voice.AccessError) as result:
                hosted_voice.authenticate({'Authorization': 'Bearer user-test'})
            self.assertEqual(result.exception.status, 403)

    @patch('hosted_voice.authenticate', return_value='owner-test')
    @patch('hosted_voice.desktop.cloud_models', return_value=[{'name': 'gemma4:31b'}])
    @patch('hosted_voice.desktop.api_key', return_value='server-secret-test')
    def test_status_supports_browser_voice_without_exposing_secret(self, _key, _models, _auth):
        handler = self.handler(); handler.do_GET(); status, data = handler.results[0]
        self.assertEqual(status, 200); self.assertEqual(data['transcription_mode'], 'browser')
        self.assertNotIn('server-secret-test', json.dumps(data)); self.assertNotIn('token', data)

    @patch('hosted_voice.authenticate', return_value='owner-test')
    @patch('hosted_voice.desktop.interpret', return_value={'items': [], 'reflections': [], 'questions': [], 'reply': 'Review'})
    def test_authenticated_drafting_uses_bounded_timeout_and_no_direct_writes(self, interpret, _auth):
        handler = self.handler('draft', body={'transcript': 'Synthetic text', 'model': 'auto'})
        handler.do_POST(); self.assertEqual(handler.results[0][0], 200)
        self.assertEqual(interpret.call_args.kwargs['timeout'], 45)

    @patch('hosted_voice.authenticate')
    def test_disallowed_origin_is_rejected_before_authentication(self, auth):
        handler = self.handler(headers={'Origin': 'https://evil.example'}); handler.do_GET()
        self.assertEqual(handler.results[0][0], 403); auth.assert_not_called()


if __name__ == '__main__': unittest.main()
