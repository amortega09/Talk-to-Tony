import json
import unittest
from unittest.mock import patch
import desktop

class OpenAIProviderTests(unittest.TestCase):
    @patch('desktop.api_key', return_value='synthetic-private-key')
    @patch('desktop.http.client.HTTPSConnection')
    def test_openai_uses_fixed_host_bounded_json_and_no_storage(self, connection, _key):
        response = connection.return_value.getresponse.return_value
        response.status = 200
        response.read.return_value = json.dumps({'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'{"reply":"Ready","questions":[],"items":[],"reflections":[]}'}]}]}).encode()
        result = desktop.openai_draft('gpt-5-nano','Return JSON',{'transcript':'Synthetic'},40)
        self.assertEqual(json.loads(result['message']['content'])['reply'],'Ready')
        self.assertEqual(connection.call_args.args[0],'api.openai.com')
        args = connection.return_value.request.call_args.args
        self.assertEqual(args[:2],('POST','/v1/responses'))
        body = json.loads(args[2]); self.assertFalse(body['store']); self.assertEqual(body['max_output_tokens'],8192)
        self.assertEqual(body['reasoning'],{'effort':'medium'}); self.assertIn('JSON',body['input'])
        connection.return_value.close.assert_called_once()

    @patch('desktop.api_key', return_value='test')
    @patch('desktop.http.client.HTTPSConnection')
    def test_incomplete_refused_and_exhausted_credit_responses_fail_closed(self, connection, _key):
        response = connection.return_value.getresponse.return_value
        for status, value in [(200,{'status':'incomplete','output':[]}),(200,{'status':'completed','output':[{'type':'message','content':[{'type':'refusal'}]}]}),(429,{'error':{'code':'insufficient_quota','message':'private account detail'}})]:
            response.status = status; response.read.return_value = json.dumps(value).encode()
            with self.assertRaises(ValueError) as error:
                desktop.openai_draft('gpt-5-nano','Return JSON',{},40)
            self.assertNotIn('private account detail',str(error.exception))

    @patch('desktop.ai_provider', return_value='openai')
    @patch('desktop.config_value', return_value='')
    def test_only_configured_openai_model_is_offered(self, _config, _provider):
        self.assertEqual(desktop.cloud_models(),[{'name':'gpt-5-nano'}])

    @patch('desktop.ai_provider', return_value='openai')
    @patch('desktop.config_value', return_value='')
    @patch('desktop.openai_draft')
    @patch('desktop.ollama')
    def test_browser_drafts_use_openai_and_preserve_details(self, ollama, call, _config, _provider):
        draft = {'reply':'Review','questions':[],'items':[{'date':'2026-11-10','start':'09:00','end_date':'2026-11-10','end':'10:00','category':'travel','activity':'Travel','note':'','details':{'modes':['Train','Bus'],'destination':'Testville'}}],'reflections':[]}
        call.return_value={'message':{'content':json.dumps(draft)}}
        result=desktop.interpret({'transcript':'Synthetic travel','context':{'today':'2026-11-10','viewed_date':'2026-11-10'}})
        self.assertEqual(result['model_used'],'gpt-5-nano');self.assertEqual(result['items'][0]['details'],draft['items'][0]['details']);ollama.assert_not_called()

    def test_explicit_work_selection_does_not_guess_from_project_alone(self):
        from provider_schema import explicit_work_details
        catalog=[{'name':'Atlas','projects':['Research']}]
        for text, expected in [('Work for Atlas on Research.',{'company':'Atlas','project':'Research'}),('Work on Research.',{}),('Not for Atlas on Research.',{})]:
            value={'items':[{'category':'work','details':{}}]}
            self.assertEqual(explicit_work_details(value,text,catalog)['items'][0]['details'],expected)

    def test_simple_new_entries_use_less_reasoning_without_cheapening_edits(self):
        from provider_schema import reasoning_effort
        self.assertEqual(reasoning_effort('I travelled from noon until one.'),'low')
        for text in ['Move work from nine to ten.','What did I do from nine to ten?','Add company Boreal and work from nine to ten.']:
            self.assertEqual(reasoning_effort(text),'medium')
        self.assertEqual(reasoning_effort('Travel from nine to ten.',{}),'medium')
