import base64
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import family_auth
from app.main import app
from app.store import database


class FamilyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.jwk = {**json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.key.public_key())), "kid": "test-key", "alg": "RS256"}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"KARL_DB_PATH": str(Path(self.temp.name) / "family.db"),
            "KARL_ACCESS_TOKEN": "owner-test-secret", "KARL_PUBLIC_ORIGIN": "http://localhost",
            "KARL_FAMILY_OWNER_NAME": "Parent", "GOOGLE_CLIENT_ID": "client.test", "GOOGLE_CLIENT_SECRET": "secret.test"})
        self.env.start()
        self.client = TestClient(app, base_url="http://localhost")
        self.client.__enter__()
        self.headers = {"Origin": "http://localhost"}
        self.client.post('/api/family/bootstrap', headers={**self.headers, 'Authorization': 'Bearer owner-test-secret'}).raise_for_status()
        self.session = self.client.get('/api/auth/session').json()
        self.headers['X-CSRF-Token'] = self.session['csrf']

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.temp.cleanup()

    def invite(self, email='teen@example.test', role='member'):
        response = self.client.post('/api/family/invitations', headers=self.headers, json={'name': 'Proche', 'email': email, 'role': role})
        self.assertEqual(response.status_code, 200, response.text)
        return parse_qs(urlsplit(response.json()['url']).fragment)['invitation'][0]

    def accept(self, token):
        response = self.client.post('/api/auth/invitation', headers=self.headers, json={'token': token})
        self.assertEqual(response.status_code, 200, response.text)
        session = self.client.get('/api/auth/session').json()
        self.headers['X-CSRF-Token'] = session['csrf']
        return session

    def test_cookie_identity_has_no_access_to_personal_data_or_hermes(self):
        self.accept(self.invite())
        for path in ['/api/health', '/api/status', '/api/dashboard', '/api/conversations']:
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.post('/api/chat', json={'message': 'hello', 'conversation_id': '00000000-0000-0000-0000-000000000000'}).status_code, 401)
        for path in ['/api/family/invitations', '/api/family/bootstrap']:
            self.assertIn(self.client.post(path, headers=self.headers, json={'name': 'X', 'email': 'x@example.test'}).status_code, [401, 403])
        members = self.client.get('/api/family/members').json()['members']
        self.assertTrue(all('email' not in row for row in members))

    def test_each_member_keeps_a_distinct_badge_through_deactivation(self):
        self.assertEqual(self.session['user']['badge'], 0)
        teen = self.accept(self.invite())
        self.client.post('/api/family/bootstrap', headers=self.headers | {'Authorization': 'Bearer owner-test-secret'})
        self.headers['X-CSRF-Token'] = self.client.get('/api/auth/session').json()['csrf']
        self.invite('other@example.test')
        self.client.patch('/api/family/members/' + teen['user']['id'], headers=self.headers, json={'active': False})
        self.invite('third@example.test')
        badges = {row['name'] + str(row['badge']) for row in self.client.get('/api/family/members').json()['members']}
        with database() as db:
            rows = db.execute('SELECT email, badge FROM family_members ORDER BY badge').fetchall()
        self.assertEqual([row['badge'] for row in rows], [0, 1, 2, 3])
        self.assertEqual(rows[1]['email'], 'teen@example.test')
        self.assertEqual(len(badges), 4)

    def test_badge_migration_backfills_an_existing_database_without_losing_rows(self):
        with database() as db, db:
            db.execute("INSERT INTO family_members(id,name,email,role) VALUES('legacy','Ancien','legacy@example.test','member')")
            db.execute('ALTER TABLE family_members DROP COLUMN badge')
        family_auth.initialize()
        with database() as db:
            rows = db.execute('SELECT id, badge FROM family_members ORDER BY badge').fetchall()
        self.assertEqual([row['badge'] for row in rows], [0, 1])
        self.assertEqual(rows[1]['id'], 'legacy')

    def test_sessions_are_hashed_persistent_expiring_and_revocable(self):
        response = self.client.get('/api/auth/session')
        cookie = self.client.cookies.get('karl_family')
        with database() as db:
            row = db.execute('SELECT * FROM family_sessions').fetchone()
        self.assertNotEqual(cookie, row['token_hash'])
        self.assertEqual(row['token_hash'], family_auth.digest(cookie))
        self.assertGreater(row['expires_at'], time.time() + 29 * 86400)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        with database() as db, db:
            db.execute('UPDATE family_sessions SET expires_at=0')
        self.assertIsNone(self.client.get('/api/auth/session').json()['user'])
        self.assertEqual(self.client.get('/api/family/items').status_code, 401)

    def test_origin_and_csrf_are_required_for_mutation_including_invite_login(self):
        for headers in [{}, {'Origin': 'https://attacker.test', 'X-CSRF-Token': self.session['csrf']}, self.headers | {'X-CSRF-Token': 'wrong'}]:
            self.assertEqual(self.client.post('/api/family/items', headers=headers, json={'name': 'Pain'}).status_code, 403)
        token = self.invite()
        self.assertEqual(self.client.post('/api/auth/invitation', headers={'Origin': 'https://attacker.test'}, json={'token': token}).status_code, 403)
        self.assertEqual(self.client.post('/api/family/bootstrap', headers={'Authorization': 'Bearer owner-test-secret'}).status_code, 403)
        self.accept(token)

    def test_invitation_is_single_use_replaced_and_expiring(self):
        old = self.invite()
        new = self.invite()
        self.assertEqual(self.client.post('/api/auth/invitation', headers=self.headers, json={'token': old}).status_code, 401)
        self.accept(new)
        self.assertEqual(self.client.post('/api/auth/invitation', headers=self.headers, json={'token': new}).status_code, 401)
        self.client.post('/api/family/bootstrap', headers=self.headers | {'Authorization': 'Bearer owner-test-secret'})
        self.headers['X-CSRF-Token'] = self.client.get('/api/auth/session').json()['csrf']
        token = self.invite('other@example.test')
        with database() as db, db:
            db.execute('UPDATE family_invites SET expires_at=0')
        self.assertEqual(self.client.post('/api/auth/invitation', headers=self.headers, json={'token': token}).status_code, 401)

    def test_admin_can_revoke_a_member_all_sessions_and_links(self):
        parent_cookie = self.client.cookies.get('karl_family')
        token = self.invite()
        teen = self.accept(token)
        teen_cookie = self.client.cookies.get('karl_family')
        self.client.cookies.set('karl_family', parent_cookie, domain='localhost.local', path='/api')
        self.headers['X-CSRF-Token'] = self.session['csrf']
        result = self.client.patch('/api/family/members/' + teen['user']['id'], headers=self.headers, json={'active': False})
        self.assertEqual(result.status_code, 200, result.text)
        self.client.cookies.set('karl_family', teen_cookie, domain='localhost.local', path='/api')
        self.assertEqual(self.client.get('/api/family/items').status_code, 401)

    def test_shopping_collaboration_conflicts_and_reversible_removal(self):
        item_id = self.client.post('/api/family/items', headers=self.headers, json={'name': '  Pommes  ', 'quantity': '1 kg', 'category': 'Fruits et légumes'}).json()['id']
        self.accept(self.invite())
        self.assertEqual(self.client.patch('/api/family/items/' + item_id, headers=self.headers, json={'version': 1, 'checked': True}).status_code, 200)
        stale = self.client.patch('/api/family/items/' + item_id, headers=self.headers, json={'version': 1, 'checked': False})
        self.assertEqual(stale.status_code, 409)
        item = self.client.get('/api/family/items').json()['items'][0]
        self.assertEqual((item['name'], item['checked'], item['version']), ('Pommes', 1, 2))
        self.client.patch('/api/family/items/' + item_id, headers=self.headers, json={'version': 2, 'deleted': True})
        self.assertEqual(self.client.get('/api/family/items').json()['items'], [])
        self.client.patch('/api/family/items/' + item_id, headers=self.headers, json={'version': 3, 'deleted': False})
        self.assertEqual(len(self.client.get('/api/family/items').json()['items']), 1)
        for payload in [{'name': ' '}, {'name': 'Pain', 'category': 'invalid'}]:
            self.assertEqual(self.client.post('/api/family/items', headers=self.headers, json=payload).status_code, 422)

    def event_payload(self):
        return {'title': 'Activité', 'starts_at': '2026-10-18T17:00:00+02:00', 'ends_at': '2026-10-18T18:00:00+02:00',
                'attendees': [self.session['user']['id']], 'driver_id': self.session['user']['id'], 'recurrence': 'weekly'}

    def test_weekly_planning_keeps_paris_time_across_dst_and_can_be_edited(self):
        payload = self.event_payload()
        response = self.client.post('/api/family/events', headers=self.headers, json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        event_id = response.json()['id']
        rows = self.client.get('/api/family/events?first=2026-10-18&last=2026-10-26').json()['events']
        self.assertEqual([row['starts_at'] for row in rows], ['2026-10-18T17:00:00+02:00', '2026-10-25T17:00:00+01:00'])
        self.assertEqual(rows[0]['series_starts_at'], rows[1]['series_starts_at'])
        self.assertEqual(self.client.put('/api/family/events/' + event_id, headers=self.headers, json=payload | {'version': 1, 'title': 'Nouveau titre'}).status_code, 200)
        self.assertEqual(self.client.put('/api/family/events/' + event_id, headers=self.headers, json=payload | {'version': 1}).status_code, 409)
        payload['attendees'] = ['not-a-member']
        self.assertEqual(self.client.post('/api/family/events', headers=self.headers, json=payload).status_code, 422)
        self.assertEqual(self.client.get('/api/family/events?first=2026-10-18&last=2027-10-26').status_code, 422)

    def test_editing_a_future_occurrence_preserves_the_series_anchor_and_past_occurrences(self):
        payload = self.event_payload()
        event_id = self.client.post('/api/family/events', headers=self.headers, json=payload).json()['id']
        future = self.client.get('/api/family/events?first=2026-11-02&last=2026-11-08').json()['events'][0]
        response = self.client.put('/api/family/events/' + event_id, headers=self.headers, json=payload | {
            'starts_at': future['series_starts_at'], 'ends_at': future['series_ends_at'],
            'title': 'Titre corrigé', 'version': future['version']})
        self.assertEqual(response.status_code, 200)
        original = self.client.get('/api/family/events?first=2026-10-18&last=2026-10-18').json()['events']
        self.assertEqual(len(original), 1)
        self.assertEqual(original[0]['title'], 'Titre corrigé')

    def test_child_can_create_but_cannot_change_others_events(self):
        event_id = self.client.post('/api/family/events', headers=self.headers, json=self.event_payload()).json()['id']
        teen = self.accept(self.invite())
        self.assertEqual(self.client.patch('/api/family/events/' + event_id, headers=self.headers, json={'version': 1, 'deleted': True}).status_code, 403)
        self.assertEqual(self.client.put('/api/family/events/' + event_id, headers=self.headers, json=self.event_payload() | {'version': 1}).status_code, 403)
        payload = self.event_payload() | {'attendees': [teen['user']['id']], 'driver_id': None}
        self.assertEqual(self.client.post('/api/family/events', headers=self.headers, json=payload).status_code, 201)

    def test_tasks_shared_completion_conflicts_and_creator_controls(self):
        task_id = self.client.post('/api/family/tasks', headers=self.headers, json={'title': 'Préparer le sac', 'assignee_id': self.session['user']['id'], 'due_date': '2026-10-19'}).json()['id']
        self.accept(self.invite())
        self.assertEqual(self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 1, 'done': True}).status_code, 200)
        self.assertEqual(self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 1, 'done': False}).status_code, 409)
        self.assertEqual(self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 2, 'deleted': True}).status_code, 403)
        self.assertEqual(self.client.get('/api/family/tasks').json()['tasks'][0]['done'], 1)

    def test_invitations_can_inform_or_ask_and_a_new_time_asks_again(self):
        parent_cookie, parent_csrf = self.client.cookies.get('karl_family'), self.session['csrf']
        teen = self.accept(self.invite())
        teen_cookie, teen_csrf = self.client.cookies.get('karl_family'), self.headers['X-CSRF-Token']
        me, kid = self.session['user']['id'], teen['user']['id']

        def as_(cookie, csrf):
            self.client.cookies.clear()
            self.client.cookies.set('karl_family', cookie, domain='localhost.local', path='/api')
            self.headers['X-CSRF-Token'] = csrf
        as_(parent_cookie, parent_csrf)
        informed = self.client.post('/api/family/events', headers=self.headers, json=self.event_payload() | {'attendees': [me, kid]}).json()['id']
        asked = self.client.post('/api/family/events', headers=self.headers, json=self.event_payload() | {
            'title': 'Dîner chez Mamie', 'attendees': [me, kid], 'ask': True}).json()['id']
        events = {row['id']: row for row in self.client.get('/api/family/events?first=2026-10-19&last=2026-10-25').json()['events']}
        self.assertEqual(events[informed]['replies'], {})
        self.assertEqual(events[asked]['replies'], {kid: 'pending'})
        self.assertEqual(self.client.get('/api/family/events/pending').json()['events'], [])
        self.assertEqual(self.client.post(f'/api/family/events/{asked}/reply', headers=self.headers, json={'answer': 'yes'}).status_code, 404)
        as_(teen_cookie, teen_csrf)
        self.assertEqual([row['id'] for row in self.client.get('/api/family/events/pending').json()['events']], [asked])
        self.client.post(f'/api/family/events/{asked}/reply', headers=self.headers, json={'answer': 'no'}).raise_for_status()
        self.assertEqual(self.client.get('/api/family/events/pending').json()['events'], [])
        as_(parent_cookie, parent_csrf)
        row = next(r for r in self.client.get('/api/family/events?first=2026-10-19&last=2026-10-25').json()['events'] if r['id'] == asked)
        self.assertEqual(row['replies'], {kid: 'no'})
        same = self.event_payload() | {'title': 'Dîner chez Mamie !', 'attendees': [me, kid], 'ask': True, 'version': row['version']}
        self.client.put('/api/family/events/' + asked, headers=self.headers, json=same).raise_for_status()
        row = next(r for r in self.client.get('/api/family/events?first=2026-10-19&last=2026-10-25').json()['events'] if r['id'] == asked)
        self.assertEqual(row['replies'], {kid: 'no'})
        later = same | {'starts_at': '2026-10-20T19:00:00+02:00', 'ends_at': '2026-10-20T21:00:00+02:00', 'version': row['version']}
        self.client.put('/api/family/events/' + asked, headers=self.headers, json=later).raise_for_status()
        row = next(r for r in self.client.get('/api/family/events?first=2026-10-19&last=2026-10-25').json()['events'] if r['id'] == asked)
        self.assertEqual(row['replies'], {kid: 'pending'})
        self.client.put('/api/family/events/' + asked, headers=self.headers, json=later | {'ask': False, 'version': row['version']}).raise_for_status()
        row = next(r for r in self.client.get('/api/family/events?first=2026-10-19&last=2026-10-25').json()['events'] if r['id'] == asked)
        self.assertEqual(row['replies'], {})

    def test_key_task_reported_done_by_a_member_waits_for_a_parent(self):
        parent_cookie, parent_csrf = self.client.cookies.get('karl_family'), self.session['csrf']
        task_id = self.client.post('/api/family/tasks', headers=self.headers, json={'title': 'Ranger la chambre', 'key_task': True}).json()['id']
        task = lambda: next(row for row in self.client.get('/api/family/tasks').json()['tasks'] if row['id'] == task_id)
        teen = self.accept(self.invite())
        teen_cookie, teen_csrf = self.client.cookies.get('karl_family'), self.headers['X-CSRF-Token']
        self.assertEqual(self.client.post('/api/family/tasks', headers=self.headers, json={'title': 'X', 'key_task': True}).status_code, 403)
        self.assertEqual(self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 1, 'done': True}).status_code, 200)
        self.assertEqual((task()['done'], task()['submitted_by']), (0, teen['user']['id']))
        self.assertEqual(self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 2, 'review': 'approve'}).status_code, 403)

        def as_parent():
            self.client.cookies.clear()
            self.client.cookies.set('karl_family', parent_cookie, domain='localhost.local', path='/api')
            self.headers['X-CSRF-Token'] = parent_csrf
        as_parent()
        self.assertEqual(self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 2, 'review': 'reject'}).status_code, 200)
        self.assertEqual((task()['done'], task()['submitted_by']), (0, None))
        self.assertEqual(self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 3, 'review': 'approve'}).status_code, 409)
        self.client.cookies.clear()
        self.client.cookies.set('karl_family', teen_cookie, domain='localhost.local', path='/api')
        self.headers['X-CSRF-Token'] = teen_csrf
        self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 3, 'done': True}).raise_for_status()
        as_parent()
        self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 4, 'review': 'approve'}).raise_for_status()
        self.assertEqual((task()['done'], task()['validated_by']), (1, self.session['user']['id']))
        self.client.cookies.clear()
        self.client.cookies.set('karl_family', teen_cookie, domain='localhost.local', path='/api')
        self.headers['X-CSRF-Token'] = teen_csrf
        self.assertEqual(self.client.patch('/api/family/tasks/' + task_id, headers=self.headers, json={'version': 5, 'done': False}).status_code, 403)

    def test_calendar_export_is_private_folded_and_cannot_inject_properties(self):
        payload = self.event_payload() | {'title': 'Événement très long ' * 20 + '\nATTENDEE:attacker', 'location': 'Salle, A;B'}
        self.client.post('/api/family/events', headers=self.headers, json=payload)
        response = self.client.get('/api/family/calendar.ics')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertIn('BEGIN:VCALENDAR', response.text)
        self.assertNotIn('\r\nATTENDEE:', response.text)
        self.assertTrue(all(len(line.encode()) <= 75 for line in response.text.split('\r\n')))
        self.client.cookies.clear()
        self.assertEqual(self.client.get('/api/family/calendar.ics').status_code, 401)

    def google_start(self):
        result = self.client.get('/api/auth/google/start', follow_redirects=False)
        self.assertEqual(result.status_code, 303)
        params = parse_qs(urlsplit(result.headers['location']).query)
        with database() as db:
            flow = dict(db.execute('SELECT * FROM family_oauth WHERE token_hash=?', (family_auth.digest(self.client.cookies.get(family_auth.FLOW)),)).fetchone())
        return params, flow

    def google_transport(self, flow, overrides=None):
        claims = {'iss': 'https://accounts.google.com', 'aud': 'client.test', 'sub': 'stable-user-123', 'email': 'teen@example.test',
                  'email_verified': True, 'nonce': flow['nonce'], 'iat': int(time.time()), 'exp': int(time.time()) + 600}
        claims.update(overrides or {})
        signed = jwt.encode(claims, self.key, algorithm='RS256', headers={'kid': 'test-key'})
        def handle(request):
            if request.url.path == '/token':
                self.assertIn(flow['verifier'].encode(), request.content)
                return httpx.Response(200, json={'id_token': signed, 'access_token': 'NOT_SAVED'})
            self.assertEqual(str(request.url), 'https://www.googleapis.com/oauth2/v3/certs')
            return httpx.Response(200, json={'keys': [self.jwk]})
        actual = httpx.AsyncClient
        return patch.object(family_auth.httpx, 'AsyncClient', side_effect=lambda **kw: actual(transport=httpx.MockTransport(handle), **kw))

    def test_google_login_requires_allowlist_signed_identity_state_nonce_and_pkce(self):
        self.invite()
        params, flow = self.google_start()
        self.assertEqual(params['scope'], ['openid email'])
        self.assertEqual(params['code_challenge_method'], ['S256'])
        with self.google_transport(flow):
            response = self.client.get('/api/auth/google/callback', params={'state': params['state'][0], 'code': 'code'}, follow_redirects=False)
        self.assertEqual(response.headers['location'], '/')
        self.assertEqual(self.client.get('/api/auth/session').json()['user']['role'], 'member')
        with database() as db:
            self.assertFalse(db.execute('SELECT 1 FROM family_oauth').fetchone())
            self.assertEqual(db.execute('SELECT google_sub FROM family_members WHERE email=?', ('teen@example.test',)).fetchone()[0], 'stable-user-123')
        replay = self.client.get('/api/auth/google/callback', params={'state': params['state'][0], 'code': 'code'}, follow_redirects=False)
        self.assertIn('google_denied', replay.headers['location'])

    def test_google_rejects_wrong_audience_issuer_expiry_nonce_unverified_email_and_uninvited_user(self):
        self.invite()
        for overrides in [{'aud': 'attacker'}, {'iss': 'https://attacker.test'}, {'exp': 0}, {'nonce': 'wrong'}, {'email_verified': False}, {'email': 'stranger@example.test'}]:
            params, flow = self.google_start()
            with self.google_transport(flow, overrides):
                response = self.client.get('/api/auth/google/callback', params={'state': params['state'][0], 'code': 'code'}, follow_redirects=False)
            self.assertIn('auth_error=', response.headers['location'])
        params, flow = self.google_start()
        with patch.object(family_auth, 'google_identity', side_effect=AssertionError('Must not exchange an invalid flow')):
            response = self.client.get('/api/auth/google/callback', params={'state': 'wrong', 'code': 'code'}, follow_redirects=False)
        self.assertIn('google_denied', response.headers['location'])


if __name__ == '__main__':
    unittest.main()
