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

Chat texte et historique SQLite ; tableau de bord KARL ; lecture des réponses via la voix du navigateur si disponible. Pour dicter, utiliser le micro du clavier iPhone. La voix serveur et le dashboard des tâches Hermes restent à ajouter. Installation iPhone via Safari → Partager → Sur l'écran d'accueil ; HTTPS requis hors localhost. Hors ligne, seul le cadre de l'application est disponible.

## Informations Hermes à confirmer

- Version installée, API déjà activée, URL locale `/v1` (ou `/p/<profil>/v1`), clé et nom de modèle/profil.
- Contrat `/chat/completions`, limite de contexte, durée des tâches et besoin de partager les sessions existantes.
- Domaine/HTTPS existant ; pour la suite, transcription/synthèse disponibles et langues souhaitées.

Adaptateur basé sur l'[API officielle Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), à valider contre la version VPS. Conversations KARL indépendantes ; les 20 derniers messages sont transmis par tour. La clé Hermes reste côté serveur. La clé KARL, distincte, donne accès à ce compte personnel et reste en mémoire dans le navigateur. Un seul worker ; un tour à la fois. Le dashboard indique la configuration, pas la disponibilité réelle d'Hermes. Ne pas publier sans HTTPS.

Vérifications : `cd backend && .venv/bin/python -m unittest discover -s tests` et `cd frontend && npm run build`. Aucun déploiement ni modification d'Hermes.
