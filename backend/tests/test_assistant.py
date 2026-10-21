import json
from datetime import datetime
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

from app import assistant, hermes
from app.main import app
from app.store import database

PROPOSAL = 'Bonne idée !\n```karl-event\n{"title": "Piscine", "starts_at": "2026-10-21T17:00:00+02:00", "ends_at": "2026-10-21T18:00:00+02:00", "attendees": ["Proche"]}\n```'


class AssistantTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"KARL_DB_PATH": str(Path(self.temp.name) / "family.db"),
            "KARL_ACCESS_TOKEN": "owner-test-secret", "KARL_PUBLIC_ORIGIN": "http://localhost", "KARL_FAMILY_OWNER_NAME": "Parent",
            "HERMES_API_KEY": "personal-secret", "HERMES_FAMILY_API_KEY": "family-secret", "KARL_ASSISTANT_DAILY_LIMIT": "3"})
        self.env.start()
        self.client = TestClient(app, base_url="http://localhost")
        self.client.__enter__()
        self.headers = {"Origin": "http://localhost"}
        self.client.post('/api/family/bootstrap', headers={**self.headers, 'Authorization': 'Bearer owner-test-secret'}).raise_for_status()
        self.parent = self.client.get('/api/auth/session').json()
        self.headers['X-CSRF-Token'] = self.parent['csrf']
        self.parent_cookie = self.client.cookies.get('karl_family')

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.temp.cleanup()

    def join(self, email):
        self.use(self.parent_cookie, self.parent['csrf'])
        url = self.client.post('/api/family/invitations', headers=self.headers, json={'name': 'Proche', 'email': email}).json()['url']
        self.client.post('/api/auth/invitation', headers=self.headers, json={'token': parse_qs(urlsplit(url).fragment)['invitation'][0]}).raise_for_status()
        session = self.client.get('/api/auth/session').json()
        self.headers['X-CSRF-Token'] = session['csrf']
        return session, self.client.cookies.get('karl_family')

    def use(self, cookie, csrf):
        self.client.cookies.clear()
        self.client.cookies.set('karl_family', cookie, domain='localhost.local', path='/api')
        self.headers['X-CSRF-Token'] = csrf

    def ask(self, thread, message='Bonjour'):
        return self.client.post('/api/family/assistant/chat', headers=self.headers, json={'thread_id': thread, 'message': message})

    def test_family_assistant_uses_its_own_hermes_profile_never_the_personal_one(self):
        calls = []

        def handler(request):
            calls.append((str(request.url), request.headers['authorization'], json.loads(request.content)))
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': 'Salut'}}]})

        real = httpx.AsyncClient
        with patch.object(assistant.httpx, 'AsyncClient', lambda **kw: real(transport=httpx.MockTransport(handler), **kw)):
            response = self.ask(str(uuid4()))
        self.assertEqual(response.status_code, 200, response.text)
        url, auth, body = calls[0]
        self.assertEqual(auth, 'Bearer family-secret')
        self.assertTrue(url.startswith('http://127.0.0.1:8643/'))
        self.assertEqual(body['messages'][0]['role'], 'system')
        self.assertIn('Parent', body['messages'][0]['content'])
        with patch.dict(os.environ, {'HERMES_FAMILY_API_KEY': ''}), patch.object(hermes, 'complete', AsyncMock()) as personal:
            response = self.ask(str(uuid4()))
        self.assertEqual(response.status_code, 502)
        personal.assert_not_called()

    def test_threads_are_private_to_each_member_even_from_the_owner(self):
        thread = str(uuid4())
        _, teen_cookie = self.join('teen@example.test')
        teen_csrf = self.headers['X-CSRF-Token']
        with patch.object(assistant, 'complete', AsyncMock(return_value='Réponse privée')) as complete:
            self.assertEqual(self.ask(thread, 'Mon secret').status_code, 200)
        self.assertEqual(len(self.client.get('/api/family/assistant').json()['threads']), 1)
        self.use(self.parent_cookie, self.parent['csrf'])
        self.assertEqual(self.client.get('/api/family/assistant').json()['threads'], [])
        self.assertEqual(self.client.get('/api/family/assistant/threads/' + thread).status_code, 404)
        self.assertEqual(self.client.delete('/api/family/assistant/threads/' + thread, headers=self.headers).status_code, 404)
        with patch.object(assistant, 'complete', AsyncMock(return_value='x')) as complete:
            self.assertEqual(self.ask(thread, 'Je lis ?').status_code, 404)
        complete.assert_not_called()
        self.use(teen_cookie, teen_csrf)
        messages = self.client.get('/api/family/assistant/threads/' + thread).json()['messages']
        self.assertEqual([row['content'] for row in messages], ['Mon secret', 'Réponse privée'])
        self.assertEqual(self.client.delete('/api/family/assistant/threads/' + thread, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/family/assistant/threads/' + thread).status_code, 404)

    def test_context_carries_only_the_members_own_agenda_and_history(self):
        session, _ = self.join('teen@example.test')
        me = session['user']['id']
        for title, attendees in [('Judo', [me]), ('Dîner des parents', [self.parent['user']['id']])]:
            self.client.post('/api/family/events', headers=self.headers, json={'title': title, 'attendees': attendees,
                'starts_at': '2099-01-01T10:00:00+01:00', 'ends_at': '2099-01-01T11:00:00+01:00'})
        with database() as db, db:
            db.execute("UPDATE family_events SET starts_at=datetime('now','+1 day'), ends_at=datetime('now','+1 day','+1 hour')")
        thread = str(uuid4())
        with patch.object(assistant, 'complete', AsyncMock(return_value='Un')) as complete:
            self.ask(thread, 'Premier')
            self.ask(thread, 'Second')
        messages = complete.call_args.args[0]
        self.assertIn('Judo', messages[0]['content'])
        self.assertNotIn('Dîner des parents', messages[0]['content'])
        self.assertEqual([row['content'] for row in messages[1:]], ['Premier', 'Un', 'Second'])

    def test_calendar_changes_only_through_an_explicit_idempotent_confirmation(self):
        session, _ = self.join('teen@example.test')
        with patch.object(assistant, 'complete', AsyncMock(return_value=PROPOSAL + '\n```karl-event\n{"title": ""}\n```')):
            reply = self.ask(str(uuid4()), 'Ajoute piscine mercredi').json()['message']
        self.assertEqual(reply['content'], 'Bonne idée !')
        self.assertEqual(len(reply['proposals']), 1)
        self.assertEqual(reply['proposals'][0]['attendees'], [session['user']['id']])
        events = lambda: self.client.get('/api/family/events?first=2026-10-19&last=2026-10-25').json()['events']
        self.assertEqual(events(), [])
        path = f"/api/family/assistant/messages/{reply['id']}/accept"
        first = self.client.post(path, headers=self.headers, json={'index': 0})
        second = self.client.post(path, headers=self.headers, json={'index': 0})
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(first.json(), second.json())
        self.assertEqual([(row['title'], row['created_by']) for row in events()], [('Piscine', session['user']['id'])])
        self.assertEqual(self.client.post(path, headers=self.headers, json={'index': 1}).status_code, 404)
        self.use(self.parent_cookie, self.parent['csrf'])
        self.assertEqual(self.client.post(path, headers=self.headers, json={'index': 0}).status_code, 404)

    def test_daily_limit_admin_switch_and_csrf(self):
        session, cookie = self.join('teen@example.test')
        csrf = self.headers['X-CSRF-Token']
        self.assertEqual(self.client.post('/api/family/assistant/chat', headers={'Origin': 'http://localhost'},
                                          json={'thread_id': str(uuid4()), 'message': 'x'}).status_code, 403)
        with patch.object(assistant, 'complete', AsyncMock(return_value='ok')):
            for _ in range(3):
                self.assertEqual(self.ask(str(uuid4())).status_code, 200)
            self.assertEqual(self.ask(str(uuid4())).status_code, 429)
        self.assertEqual(self.client.get('/api/family/assistant').json()['remaining'], 0)
        self.use(self.parent_cookie, self.parent['csrf'])
        self.client.patch('/api/family/members/' + session['user']['id'], headers=self.headers, json={'assistant': False}).raise_for_status()
        member = next(row for row in self.client.get('/api/family/members').json()['members'] if row['id'] == session['user']['id'])
        self.assertEqual((member['assistant'], member['active']), (False, True))
        self.use(cookie, csrf)
        self.assertEqual(self.client.get('/api/auth/session').json()['user']['id'], session['user']['id'])
        self.assertEqual(self.ask(str(uuid4())).status_code, 403)
        self.assertFalse(self.client.get('/api/family/assistant').json()['enabled'])


    def test_tasks_items_and_memory_need_a_tap_and_memory_stays_private(self):
        session, cookie = self.join('teen@example.test')
        csrf = self.headers['X-CSRF-Token']
        reply_text = ('Voilà.\n```karl-task\n{"title": "Réviser", "due_date": "2026-11-03", "assignee": "Inconnu"}\n```'
                      '\n```karl-item\n{"name": "Lait", "quantity": "2", "category": "Frais"}\n```'
                      '\n```karl-item\n{"name": "Pain", "category": "Boulangerie"}\n```'
                      '\n```karl-memory\n{"text": "Allergique aux noix"}\n```')
        with patch.object(assistant, 'complete', AsyncMock(return_value=reply_text)):
            reply = self.ask(str(uuid4())).json()['message']
        self.assertEqual(reply['content'], 'Voilà.')
        self.assertEqual([proposal['kind'] for proposal in reply['proposals']], ['task', 'item', 'memory'])
        self.assertEqual(reply['proposals'][0]['assignee_id'], session['user']['id'])
        self.assertEqual(self.client.get('/api/family/tasks').json()['tasks'], [])
        self.assertEqual(self.client.get('/api/family/assistant/memory').json()['memory'], [])
        path = f"/api/family/assistant/messages/{reply['id']}/accept"
        ids = [self.client.post(path, headers=self.headers, json={'index': index}).json()['id'] for index in range(3)]
        self.assertEqual(self.client.post(path, headers=self.headers, json={'index': 0}).json()['id'], ids[0])
        self.assertEqual([task['title'] for task in self.client.get('/api/family/tasks').json()['tasks']], ['Réviser'])
        self.assertEqual([item['name'] for item in self.client.get('/api/family/items').json()['items']], ['Lait'])
        memory = self.client.get('/api/family/assistant/memory').json()['memory']
        self.assertEqual([row['text'] for row in memory], ['Allergique aux noix'])
        self.assertEqual(self.client.post('/api/family/assistant/memory', headers=self.headers, json={'text': 'Couche-tôt'}).status_code, 201)

        with patch.object(assistant, 'complete', AsyncMock(return_value='ok')) as complete:
            self.ask(str(uuid4()))
        context = complete.call_args.args[0][0]['content']
        self.assertIn('Allergique aux noix', context)
        self.assertIn('Réviser', context)
        self.assertIn('Lait (2)', context)
        self.assertIn('Ce que tu ne fais jamais : acheter', context)

        self.use(self.parent_cookie, self.parent['csrf'])
        self.assertEqual(self.client.get('/api/family/assistant/memory').json()['memory'], [])
        self.assertEqual(self.client.delete('/api/family/assistant/memory/' + memory[0]['id'], headers=self.headers).status_code, 404)
        with patch.object(assistant, 'complete', AsyncMock(return_value='ok')) as complete:
            self.ask(str(uuid4()))
        self.assertNotIn('Allergique', complete.call_args.args[0][0]['content'])
        self.use(cookie, csrf)
        self.assertEqual(self.client.delete('/api/family/assistant/memory/' + memory[0]['id'], headers=self.headers).status_code, 200)
        self.assertEqual([row['text'] for row in self.client.get('/api/family/assistant/memory').json()['memory']], ['Couche-tôt'])


    def test_meal_proposals_link_to_family_recipes_once_confirmed(self):
        self.client.post('/api/family/recipes', headers=self.headers, json={'title': 'Crêpes', 'ingredients': ['4 oeufs']}).raise_for_status()
        text = ('Menu :\n```karl-meal\n{"day": "2026-11-02", "slot": "soir", "title": "crêpes", "servings": 5}\n```'
                '\n```karl-meal\n{"day": "2026-11-03", "slot": "midi", "title": "Salade"}\n```'
                '\n```karl-meal\n{"day": "pas une date", "title": "X"}\n```')
        with patch.object(assistant, 'complete', AsyncMock(return_value=text)) as complete:
            reply = self.ask(str(uuid4())).json()['message']
        self.assertIn('Recettes du carnet familial : Crêpes.', complete.call_args.args[0][0]['content'])
        self.assertEqual([(p['kind'], p['slot']) for p in reply['proposals']], [('meal', 'dinner'), ('meal', 'lunch')])
        week = lambda: self.client.get('/api/family/meals?first=2026-11-02&last=2026-11-08').json()['meals']
        self.assertEqual(week(), [])
        path = f"/api/family/assistant/messages/{reply['id']}/accept"
        for index in (0, 1, 0):
            self.assertEqual(self.client.post(path, headers=self.headers, json={'index': index}).status_code, 201)
        self.assertEqual(sorted((m['day'], m['title'], m['servings'], m['has_recipe']) for m in week()),
                         [('2026-11-02', 'Crêpes', 5, True), ('2026-11-03', 'Salade', 4, False)])


    def test_recipe_proposals_are_parsed_before_reaching_the_book(self):
        text = ('```karl-recipe\n{"title": "Velouté", "servings": 2, "ingredients": ["500 g de carottes", "1 oignon"], "notes": "Mixer."}\n```'
                '\n```karl-recipe\n{"title": "Illisible", "ingredients": ["200 g"]}\n```')
        with patch.object(assistant, 'complete', AsyncMock(return_value=text)):
            reply = self.ask(str(uuid4())).json()['message']
        self.assertEqual([p['title'] for p in reply['proposals']], ['Velouté'])
        self.assertEqual(self.client.get('/api/family/recipes').json()['recipes'], [])
        self.client.post(f"/api/family/assistant/messages/{reply['id']}/accept", headers=self.headers, json={'index': 0}).raise_for_status()
        [recipe] = self.client.get('/api/family/recipes').json()['recipes']
        self.assertEqual((recipe['title'], recipe['servings'], recipe['notes']), ('Velouté', 2, 'Mixer.'))
        self.assertEqual([(i['name'], i['quantity'], i['unit']) for i in recipe['ingredients']], [('carottes', 500.0, 'g'), ('oignon', 1.0, '')])


    def test_context_flags_late_and_today_tasks(self):
        me = self.parent['user']['id']
        for title, due in [('Payer la cantine', '2020-01-01'), ('Arroser', datetime.now(assistant.PARIS).date().isoformat())]:
            self.client.post('/api/family/tasks', headers=self.headers, json={'title': title, 'assignee_id': me, 'due_date': due}).raise_for_status()
        with patch.object(assistant, 'complete', AsyncMock(return_value='ok')) as complete:
            self.ask(str(uuid4()))
        context = complete.call_args.args[0][0]['content']
        self.assertIn('Payer la cantine (EN RETARD, prévue le 2020-01-01)', context)
        self.assertIn('Arroser (aujourd’hui)', context)


if __name__ == '__main__':
    unittest.main()
