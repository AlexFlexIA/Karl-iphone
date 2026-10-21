import unittest

from app.words import aisle_of, key_of, plain


class WordTests(unittest.TestCase):
    def test_same_product_whatever_the_spelling(self):
        for first, second in [("Tomates", "tomate"), ("Œufs", "oeuf"), ("Pâtes", "pates"), ("Pommes de terre", "pomme de terre"),
                              ("Crème fraîche", "creme fraiche"), ("Choux-fleurs", "chou fleur"), ("  Lait   entier ", "lait entier")]:
            self.assertEqual(key_of(first), key_of(second), (first, second))

    def test_a_final_e_acute_keeps_products_apart(self):
        self.assertNotEqual(key_of("Pâté"), key_of("Pâtes"))
        self.assertEqual(key_of("Purée"), key_of("purées"))
        self.assertEqual(key_of("Café"), key_of("cafés"))
        self.assertEqual(aisle_of("Café moulu"), "Épicerie")
        self.assertEqual(aisle_of("Purée de tomates"), "Épicerie")

    def test_short_words_and_apostrophes_are_kept(self):
        self.assertEqual(key_of("riz"), "riz")
        self.assertEqual(key_of("ail"), "ail")
        self.assertNotEqual(key_of("pois"), key_of("poids"))
        self.assertEqual(plain("Huile d’olive"), "huile d'olive")

    def test_aisles(self):
        cases = {"Bananes": "Fruits et légumes", "Yaourts nature": "Frais", "Riz basmati": "Épicerie",
                 "Liquide vaisselle": "Maison", "Papier cadeau": "Maison", "Bougies": "Autres", "": "Autres",
                 "Farine de blé": "Épicerie", "Sucre de canne": "Épicerie", "Huile de tournesol": "Épicerie", "Sel de mer": "Épicerie",
                 "Lait de coco": "Épicerie", "Liquide de vaisselle": "Maison", "Gel de douche": "Maison", "Gel coiffant": "Autres",
                 "Sauce tomate": "Épicerie", "Pommes de terre": "Fruits et légumes", "Pois chiches": "Épicerie",
                 "Pâte feuilletée": "Frais", "Pâtes": "Épicerie", "Huile d’olive": "Épicerie", "Sacs poubelle": "Maison"}
        for name, aisle in cases.items():
            self.assertEqual(aisle_of(name), aisle, name)


if __name__ == "__main__":
    unittest.main()
