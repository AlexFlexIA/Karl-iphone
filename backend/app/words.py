"""Name matching shared by the shopping list and the menu totals."""
import re
import unicodedata


def plain(value):
    value = unicodedata.normalize("NFKD", value.casefold().replace("œ", "oe").replace("æ", "ae"))
    return " ".join("".join(c for c in value if not unicodedata.combining(c)).replace("’", "'").split())


def key_of(name):
    """Singular, accent-free form so « Tomates » and « tomate » end up on one line."""
    return " ".join(word[:-1] if len(word) > 3 and word[-1] in "sx" else word for word in re.split(r"[\s\-]+", plain(name)))


# A small, editable guess so generated items land in a sensible aisle; anything else goes to « Autres ».
AISLES = {
    "Fruits et légumes": "pomme poire banane citron orange fraise tomate carotte courgette oignon echalote ail salade poireau "
                         "pomme de terre patate champignon poivron aubergine epinard brocoli chou concombre avocat persil "
                         "basilic coriandre ciboulette herbes legume fruit haricot courge potiron navet radis",
    "Frais": "lait beurre creme oeuf yaourt fromage gruyere emmental parmesan mozzarella feta comte jambon lardon poulet "
             "boeuf veau porc dinde steak viande saumon cabillaud poisson crevette feuilletee brisee",
    "Maison": "lessive adoucissant eponge vaisselle savon shampoing dentifrice brosse poubelle essuie papier mouchoir javel nettoyant "
              "pile ampoule couche lingette deodorant gel douche",
    "Épicerie": "farine sucre sel poivre huile vinaigre riz pates spaghetti semoule lentille pois chiche quinoa chocolat "
                "levure miel moutarde bouillon epice cumin curry paprika thym laurier conserve sauce tomate concentre "
                "biscuit cereale cafe confiture coco amande noix",
}


def aisle_of(name):
    words = set(key_of(name).split())
    for aisle, vocabulary in AISLES.items():
        if words & {key_of(term) for term in vocabulary.split()}:
            return aisle
    return "Autres"
