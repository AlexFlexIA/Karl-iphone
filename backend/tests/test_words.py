import unittest

from app.words import aisle_of, key_of, plain


class WordTests(unittest.TestCase):
    def test_same_product_whatever_the_spelling(self):
        for first, second in [("Tomates", "tomate"), ("Œufs", "oeuf"), ("Pâtes", "pates"), ("Pommes de terre", "pomme de terre"),
                              ("Crème fraîche", "creme fraiche"), ("Choux-fleurs", "chou fleur"), ("  Lait   entier ", "lait entier")]:
            self.assertEqual(key_of(first), key_of(second), (first, second))

    def test_short_words_and_apostrophes_are_kept(self):
        self.assertEqual(key_of("riz"), "riz")
        self.assertEqual(key_of("ail"), "ail")
        self.assertNotEqual(key_of("pois"), key_of("poids"))
        self.assertEqual(plain("Huile d’olive"), "huile d'olive")

    def test_aisles(self):
        cases = {"Bananes": "Fruits et légumes", "Yaourts nature": "Frais", "Riz basmati": "Épicerie",
                 "Liquide vaisselle": "Maison", "Papier cadeau": "Maison", "Bougies": "Autres", "": "Autres"}
        for name, aisle in cases.items():
            self.assertEqual(aisle_of(name), aisle, name)


if __name__ == "__main__":
    unittest.main()
