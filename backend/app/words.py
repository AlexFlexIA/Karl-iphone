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
                         "patate champignon poivron aubergine epinard brocoli chou concombre avocat persil "
                         "basilic coriandre ciboulette herbe legume fruit haricot courge potiron navet radis",
    "Frais": "lait beurre creme oeuf yaourt fromage gruyere emmental parmesan mozzarella feta comte jambon lardon poulet "
             "boeuf veau porc dinde steak viande saumon cabillaud poisson crevette",
    "Maison": "lessive adoucissant eponge savon shampoing dentifrice brosse poubelle essuie papier mouchoir javel nettoyant "
              "pile ampoule couche lingette deodorant",
    "Épicerie": "farine sucre sel poivre huile vinaigre riz pate spaghetti semoule lentille quinoa chocolat "
                "levure miel moutarde bouillon epice cumin curry paprika thym laurier conserve sauce concentre "
                "biscuit cereale cafe confiture amande noix",
}
# Whole phrases win over single words: « pomme de terre » is not a « pomme », « lait de coco » is not « lait ».
PHRASES = {"pomme de terre": "Fruits et légumes", "lait de coco": "Épicerie", "pois chiche": "Épicerie",
           "pate feuilletee": "Frais", "pate brisee": "Frais", "gel douche": "Maison", "liquide vaisselle": "Maison",
           "papier toilette": "Maison", "sac poubelle": "Maison"}
STOPWORDS = {"de", "d'", "du", "des", "la", "le", "les", "a", "au", "aux", "en", "et"}


def significant(name):
    return [word for word in key_of(name).replace("d'", "").split() if word not in STOPWORDS]


def aisle_of(name):
    """Phrase first, then the head noun (the first word: « sauce tomate » is a sauce), then any other word."""
    words = significant(name)
    text = " " + " ".join(words) + " "
    for phrase, aisle in PHRASES.items():
        if " " + " ".join(significant(phrase)) + " " in text:
            return aisle
    vocabulary = {aisle: {key_of(term) for term in terms.split()} for aisle, terms in AISLES.items()}
    for word in words:
        for aisle, terms in vocabulary.items():
            if word in terms:
                return aisle
    return "Autres"
