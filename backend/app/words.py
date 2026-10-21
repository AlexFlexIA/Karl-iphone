"""Name matching shared by the shopping list and the menu totals."""
import re
import unicodedata


def plain(value):
    value = unicodedata.normalize("NFKD", value.casefold().replace("œ", "oe").replace("æ", "ae"))
    return " ".join("".join(c for c in value if not unicodedata.combining(c)).replace("’", "'").split())


def key_of(name):
    """Singular, accent-free form so « Tomates » and « tomate » end up on one line."""
    return " ".join(word[:-1] if len(word) > 3 and word[-1] in "sx" else word for word in re.split(r"[\s\-]+", plain(name)))
