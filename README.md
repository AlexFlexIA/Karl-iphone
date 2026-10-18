# KARL

Socle MVP personnel : React/TypeScript → FastAPI (auth + SQLite) → API Hermes sur le même VPS. Une seule instance FastAPI sert aussi la PWA compilée. Aucun service payant supplémentaire.

## Local

Python 3.11+ et Node 22.12+.

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Renseigner .env, puis charger les variables :
set -a; . ./.env; set +a
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Autre terminal : `cd frontend && npm ci && npm run dev`, puis ouvrir l'adresse affichée et saisir la clé KARL. `npm run build` prépare la PWA servie par FastAPI sur le port 8000 au prochain démarrage.

Interface néo-punk bleue, chat texte, historique paginé avec reprise des conversations et dashboard vérifiant réellement l’API Hermes. Lecture vocale avec arrêt ; bouton de dictée si le navigateur le permet, sinon micro du clavier iPhone. La dictée peut passer par le service vocal du navigateur ; aucun moteur audio n’est installé sur le VPS. Le suivi des tâches Hermes reste à ajouter. Installation iPhone via Safari → Partager → Sur l'écran d'accueil ; HTTPS requis hors localhost. Hors ligne, seul le cadre de l'application est disponible.

## Informations Hermes à confirmer

- Version installée, API déjà activée, URL locale `/v1` (ou `/p/<profil>/v1`), clé et nom de modèle/profil.
- Contrat `/chat/completions`, limite de contexte, durée des tâches et besoin de partager les sessions existantes.
- Domaine/HTTPS existant ; pour la suite, transcription/synthèse disponibles et langues souhaitées.

Adaptateur basé sur l'[API officielle Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), à valider contre la version VPS. Conversations KARL indépendantes ; les 20 derniers messages sont transmis par tour. La clé Hermes reste côté serveur. La clé KARL, distincte, donne accès à ce compte personnel et reste en mémoire dans le navigateur. Un seul worker ; un tour à la fois. Le dashboard sonde `/v1/models` sans lancer d’inférence et affiche la date du contrôle ; il ne suit pas les autres activités Hermes. Ne pas publier sans HTTPS.

Vérifications : `cd backend && .venv/bin/python -m unittest discover -s tests` et `cd frontend && npm run build`. Aucun déploiement ni modification d'Hermes.

Les polices Barlow Condensed et Sora sont embarquées sous licence OFL (voir `frontend/public/fonts`). Aucun chargement de police auprès d’un tiers pendant l’utilisation.
