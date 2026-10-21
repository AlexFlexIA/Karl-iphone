import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient

from app.main import app
from app.meals import label, parse_line


class ParsingTests(unittest.TestCase):
    def test_lines_become_name_quantity_unit_and_aisle(self):
        self.assertEqual(parse_line("200 g de farine"),
                         {"line": "200 g de farine", "name": "farine", "quantity": 200.0, "unit": "g", "category": "Épicerie"})
        self.assertEqual({key: parse_line("2 c. à s. d’huile d’olive")[key] for key in ("name", "quantity", "unit")},
                         {"name": "huile d’olive", "quantity": 2.0, "unit": "c. à s."})
        self.assertEqual(parse_line("½ citron")["quantity"], 0.5)
        self.assertEqual(parse_line("1,5 l lait")["unit"], "l")
        self.assertEqual(parse_line("2 lardons")["unit"], "")
        self.assertEqual(parse_line("sel")["quantity"], None)
        self.assertIsNone(parse_line("  "))
        with self.assertRaises(ValueError):
            parse_line("200 g")

    def test_labels_switch_to_larger_units(self):
        self.assertEqual(label(1500, "g"), "1,5 kg")
        self.assertEqual(label(750, "ml"), "750 ml")
        self.assertEqual(label(2, "boîte"), "2 boîtes")
        self.assertEqual(label(None, ""), "")


class MealTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"KARL_DB_PATH": str(Path(self.temp.name) / "family.db"),
            "KARL_ACCESS_TOKEN": "owner-test-secret", "KARL_PUBLIC_ORIGIN": "http://localhost", "KARL_FAMILY_OWNER_NAME": "Parent"})
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

    def post(self, path, body):
        return self.client.post('/api/family/' + path, headers=self.headers, json=body)

    def recipe(self, title, servings, ingredients):
        response = self.post('recipes', {'title': title, 'servings': servings, 'ingredients': ingredients})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    def preview(self):
        return self.client.get('/api/family/meals/shopping?first=2026-11-02&last=2026-11-08').json()

    def test_menu_adds_up_scaled_ingredients_and_skips_what_is_already_listed(self):
        crepes = self.recipe('Crêpes', 4, ['250 g de farine', '4 oeufs', '0,5 l de lait', 'sel'])
        quiche = self.recipe('Quiche', 6, ['3 œufs', '20 cl de crème', '1 pâte brisée', '200 g de lardons'])
        for day, recipe, servings in [('2026-11-02', crepes, 8), ('2026-11-04', quiche, 6)]:
            self.assertEqual(self.post('meals', {'day': day, 'slot': 'dinner', 'recipe_id': recipe, 'servings': servings}).status_code, 201)
        self.post('meals', {'day': '2026-11-05', 'slot': 'lunch', 'title': 'Restes'})
        self.post('meals', {'day': '2026-11-20', 'recipe_id': crepes, 'servings': 4})
        self.post('items', {'name': 'Lait', 'quantity': '1 bouteille', 'category': 'Frais'})

        preview = self.preview()
        lines = {line['key']: line for line in preview['lines']}
        self.assertEqual(preview['without_recipe'], 1)
        self.assertEqual(lines['oeuf']['quantity'], '11')
        self.assertEqual(sorted(lines['oeuf']['sources']), ['Crêpes', 'Quiche'])
        self.assertEqual(lines['farine']['quantity'], '500 g')
        self.assertEqual(lines['farine']['category'], 'Épicerie')
        self.assertEqual(lines['lait']['quantity'], '1 l')
        self.assertEqual(lines['lait']['on_list'], '1 bouteille')
        self.assertEqual(lines['creme']['quantity'], '200 ml')
        self.assertEqual(lines['sel']['quantity'], '')

        added = self.post('meals/shopping', {'first': '2026-11-02', 'last': '2026-11-08', 'keys': ['oeuf', 'farine', 'lait']})
        self.assertEqual(added.json(), {'added': 2, 'skipped': 1})
        again = self.post('meals/shopping', {'first': '2026-11-02', 'last': '2026-11-08', 'keys': ['oeuf', 'farine']})
        self.assertEqual(again.json(), {'added': 0, 'skipped': 2})
        items = {item['name']: item for item in self.client.get('/api/family/items').json()['items']}
        self.client.patch('/api/family/items/' + items['Farine']['id'], headers=self.headers, json={'version': 1, 'checked': True}).raise_for_status()
        self.assertEqual({line['key']: line['on_list'] for line in self.preview()['lines']}['farine'], 'dans le panier')
        self.assertEqual(items['Oeufs']['quantity'], '11')
        self.assertEqual(items['Oeufs']['category'], 'Frais')
        self.assertEqual(len(items), 3)

    def test_validation_permissions_and_versions(self):
        response = self.post('recipes', {'title': 'Soupe', 'ingredients': ['1 kg de carottes', '3 g']})
        self.assertEqual(response.status_code, 422)
        self.assertIn('Ingrédient 2', response.json()['detail'])
        self.assertEqual(self.post('meals', {'day': '2026-11-02'}).status_code, 422)
        self.assertEqual(self.post('meals', {'day': '2026-11-02', 'recipe_id': 'nope'}).status_code, 422)
        self.assertEqual(self.client.get('/api/family/meals?first=2026-01-01&last=2026-12-31').status_code, 422)
        recipe = self.recipe('Soupe', 4, ['1 kg de carottes'])
        meal = self.post('meals', {'day': '2026-11-02', 'recipe_id': recipe}).json()['id']

        url = self.post('invitations', {'name': 'Proche', 'email': 'teen@example.test'}).json()['url']
        self.client.post('/api/auth/invitation', headers=self.headers, json={'token': parse_qs(urlsplit(url).fragment)['invitation'][0]}).raise_for_status()
        self.headers['X-CSRF-Token'] = self.client.get('/api/auth/session').json()['csrf']
        self.assertEqual(self.client.put('/api/family/recipes/' + recipe, headers=self.headers,
                                         json={'title': 'Autre', 'version': 1}).status_code, 403)
        self.assertEqual(self.client.patch('/api/family/meals/' + meal, headers=self.headers, json={'version': 1, 'deleted': True}).status_code, 403)
        self.assertEqual(self.post('meals/shopping', {'first': '2026-11-02', 'last': '2026-11-02', 'keys': ['carotte']}).json()['added'], 1)

        self.client.cookies.clear()
        self.client.cookies.set('karl_family', self.parent_cookie, domain='localhost.local', path='/api')
        self.headers['X-CSRF-Token'] = self.parent['csrf']
        edit = lambda version: self.client.put('/api/family/recipes/' + recipe, headers=self.headers,
                                               json={'title': 'Velouté', 'servings': 2, 'ingredients': ['500 g de carottes'], 'version': version})
        self.assertEqual(edit(1).status_code, 200)
        change = lambda version: self.client.put('/api/family/meals/' + meal, headers=self.headers, json={'version': version, 'slot': 'lunch', 'servings': 6})
        self.assertEqual(change(1).status_code, 200)
        self.assertEqual(change(1).status_code, 409)
        self.assertEqual(edit(1).status_code, 409)
        meals = self.client.get('/api/family/meals?first=2026-11-02&last=2026-11-02').json()['meals']
        self.assertEqual([(row['title'], row['has_recipe']) for row in meals], [('Velouté', True)])
        self.assertEqual(self.client.patch('/api/family/recipes/' + recipe, headers=self.headers, json={'version': 2, 'deleted': True}).status_code, 200)
        self.assertEqual(self.client.get('/api/family/recipes').json()['recipes'], [])
        self.assertEqual(self.client.get('/api/family/meals?first=2026-11-02&last=2026-11-02').json()['meals'][0]['has_recipe'], False)
        self.assertEqual(self.client.patch('/api/family/meals/' + meal, headers=self.headers, json={'version': 2, 'deleted': True}).status_code, 200)
        self.assertEqual(self.client.post('/api/family/recipes', headers={'Origin': 'http://localhost'}, json={'title': 'x'}).status_code, 403)


    def test_copying_a_week_fills_only_empty_slots(self):
        soup = self.recipe('Soupe', 4, ['1 kg de carottes'])
        self.post('meals', {'day': '2026-11-02', 'slot': 'dinner', 'recipe_id': soup, 'servings': 3})
        self.post('meals', {'day': '2026-11-03', 'slot': 'lunch', 'title': 'Cantine'})
        self.post('meals', {'day': '2026-11-10', 'slot': 'lunch', 'title': 'Pique-nique'})
        self.assertEqual(self.post('meals/copy', {'source': '2026-11-02', 'target': '2026-11-05'}).status_code, 422)
        self.assertEqual(self.post('meals/copy', {'source': '2026-11-02', 'target': '2026-11-09'}).json(), {'copied': 1})
        week = self.client.get('/api/family/meals?first=2026-11-09&last=2026-11-15').json()['meals']
        self.assertEqual(sorted((row['day'], row['title'], row['servings'], row['has_recipe']) for row in week),
                         [('2026-11-09', 'Soupe', 3, True), ('2026-11-10', 'Pique-nique', 4, False)])


    def test_a_recipe_goes_to_the_list_without_being_planned(self):
        soup = self.recipe('Soupe', 4, ['1 kg de carottes', '2 oignons', 'sel'])
        self.post('items', {'name': 'Sel'})
        preview = self.client.get(f'/api/family/recipes/{soup}/shopping?servings=6').json()['lines']
        self.assertEqual({line['key']: (line['quantity'], line['on_list']) for line in preview},
                         {'carotte': ('1,5 kg', None), 'oignon': ('3', None), 'sel': ('', 'sur la liste')})
        added = self.post(f'recipes/{soup}/shopping', {'servings': 6, 'keys': ['carotte', 'sel']})
        self.assertEqual(added.json(), {'added': 1, 'skipped': 1})
        self.assertEqual(self.client.get('/api/family/recipes/nope/shopping?servings=2').status_code, 404)


    def test_the_list_refuses_a_second_line_for_the_same_product_and_edits_details(self):
        first = self.post('items', {'name': 'Tomates', 'quantity': '1 kg'}).json()
        again = self.post('items', {'name': 'tomate'}).json()
        self.assertEqual((first['duplicate'], again), (False, {'id': first['id'], 'duplicate': True}))
        change = lambda body: self.client.patch('/api/family/items/' + first['id'], headers=self.headers, json=body)
        self.assertEqual(change({'version': 1, 'quantity': '2 kg', 'category': 'Fruits et légumes', 'name': 'Tomates cerises'}).status_code, 200)
        self.assertEqual(change({'version': 1, 'quantity': '3 kg'}).status_code, 409)
        self.assertEqual(change({'version': 2, 'name': '  '}).status_code, 422)
        [item] = self.client.get('/api/family/items').json()['items']
        self.assertEqual((item['name'], item['quantity'], item['category'], item['version']), ('Tomates cerises', '2 kg', 'Fruits et légumes', 2))
        change({'version': 2, 'checked': True}).raise_for_status()
        self.assertFalse(self.post('items', {'name': 'Tomates cerises'}).json()['duplicate'])


    def test_weekly_tasks_come_back_once_and_withdraw_on_reopen(self):
        self.assertEqual(self.post('tasks', {'title': 'Poubelles', 'repeat': 'weekly'}).status_code, 422)
        task = self.post('tasks', {'title': 'Poubelles', 'repeat': 'weekly', 'due_date': '2026-11-02'}).json()['id']
        tasks = lambda: sorted((t['due_date'], t['done']) for t in self.client.get('/api/family/tasks').json()['tasks'])
        change = lambda version, done: self.client.patch('/api/family/tasks/' + task, headers=self.headers, json={'version': version, 'done': done})
        change(1, True).raise_for_status()
        self.assertEqual(tasks(), [('2026-11-02', 1), ('2026-11-09', 0)])
        change(2, False).raise_for_status()
        self.assertEqual(tasks(), [('2026-11-02', 0)])
        change(3, True).raise_for_status()
        change(4, True).raise_for_status()
        self.assertEqual(tasks(), [('2026-11-02', 1), ('2026-11-09', 0)])
        self.client.patch('/api/family/tasks/' + task, headers=self.headers, json={'version': 5, 'deleted': True}).raise_for_status()
        self.assertEqual(tasks(), [('2026-11-09', 0)])


if __name__ == '__main__':
    unittest.main()
