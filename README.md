# KARL

PWA React/TypeScript + FastAPI/SQLite : espace familial « Carnet » (planning, courses, tâches) et assistant personnel Hermes séparé. Polices embarquées sous licence OFL. Aucun service supplémentaire pour le planning, les courses et les tâches.

## Démarrer en local

Python 3.11+ et Node 22.12+.

```sh
cd frontend
npm ci
npm run build
cd ../backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Renseigner les secrets et KARL_PUBLIC_ORIGIN, puis :
set -a; . ./.env; set +a
uvicorn app.main:app --host 127.0.0.1 --port 18000 --no-access-log
```

Ouvrir `http://127.0.0.1:18000`. Pour Vite en développement : `npm run dev`, backend sur 8000 et `KARL_PUBLIC_ORIGIN=http://localhost:5173` (utiliser exactement cette adresse). Une seule instance/worker FastAPI. Sauvegarder le fichier SQLite avant une mise à jour.

## Espace familial

Premier accès : **Espace personnel** → saisir `KARL_ACCESS_TOKEN` → bouton **Ouvrir la famille** dans l’en-tête. Le propriétaire peut renseigner son prénom/adresse et inviter les proches depuis son prénom dans l’en-tête familial. Choisir Administrateur pour le coparent, Membre pour les autres ; aucun compte réel n’est précréé dans le dépôt.

Chaque invitation privée expire après 7 jours et ne sert qu’une fois. Son secret reste dans le fragment du lien et n’est pas envoyé dans l’URL au serveur. Une session individuelle dure jusqu’à 30 jours (cookie HttpOnly, Secure en HTTPS, SameSite=Lax, secret haché en base). Les écritures exigent une origine exacte et un jeton CSRF. Désactiver un membre révoque ses sessions/invitations. Les membres peuvent créer des activités, cocher les courses/tâches ; seuls l’auteur et les administrateurs modifient/retirent une activité. Les retraits sont annulables. Les versions détectent les modifications simultanées ; aucune écriture n’est rejouée automatiquement.

Accueil du jour, liste de courses avec quantités/rayons (un produit encore à prendre n’est jamais ajouté une seconde fois, même écrit au pluriel ou sans accent ; nom, quantité et rayon modifiables ; **Vider le panier** retire d’un coup les articles cochés, annulable), planning hebdomadaire avec participants/accompagnement et répétition à la semaine, tâches attribuées avec échéance. Actualisation toutes les 15 secondes dans l’onglet visible. Le planning est stocké dans KARL ; export `.ics` ponctuel des 9 prochaines semaines. **Aucune synchronisation Google Agenda ni notification automatique dans ce lot.** Hors ligne, aucune écriture ; les données déjà affichées restent seulement en mémoire.

### Interface famille

Direction « Carnet » : papier clair, encre, accent cobalt ; mode sombre automatique selon le réglage de l’appareil. Atkinson Hyperlegible pour le texte, Fraunces pour les titres. Tokens de design en tête de `frontend/src/family/family.css`.

- Onglets en bas sous le pouce (Aujourd’hui, Planning, Courses, Tâches, Moi), barre latérale à partir de 960 px.
- Aujourd’hui : résumé en une phrase, fil du jour avec la ligne « Maintenant », ajout rapide aux courses, tâches attribuées.
- Planning : bande de la semaine, vue Liste ou Couloirs (une ligne par personne ; plein = participe, hachuré + voiture = accompagne).
- Chaque membre garde un symbole fixe (forme + initiale + couleur, colonne `badge` ajoutée automatiquement au démarrage, sans perte de données) : aucune information ne repose sur la couleur seule.
- Hors ligne : dernières données affichées en lecture seule, aucune écriture mise en attente. Mise à jour de l’app signalée par un bandeau, saisies en cours conservées dans l’onglet.
- Objectif WCAG 2.2 AA : contrastes des tokens ≥ 4,5:1 (texte) et ≥ 3:1 (contrôles), focus visible, navigation clavier, `prefers-reduced-motion`, zones tactiles ≥ 44 px.

L’espace personnel est chargé à la demande ; ses styles sont isolés dans une couche CSS.

### Connexion Google facultative

Les invitations fonctionnent sans Google. Pour activer la reconnexion Google, créer un client OAuth **Application Web** dans votre projet Google et définir `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `KARL_PUBLIC_ORIGIN`. Déclarer exactement cette redirection : `<KARL_PUBLIC_ORIGIN>/api/auth/google/callback`. Autoriser les comptes de test dans Google si le projet est en mode test. Ajouter les adresses des proches dans KARL ; renseigner d’abord l’adresse du propriétaire via son profil. Ne jamais mettre les secrets dans le frontend ou Git.

Flux serveur avec code d’autorisation, PKCE, état lié au navigateur, nonce, vérification de signature RS256, émetteur, destinataire et expiration du jeton. Seules les adresses invitées et vérifiées sont admises ; association ensuite à l’identifiant Google stable. Scopes `openid email` uniquement ; aucune lecture de Gmail/Agenda et aucun jeton Google conservé. [Documentation Google](https://developers.google.com/identity/openid-connect/openid-connect).

## Invitations au planning

Quand une activité concerne d’autres membres (participants ou accompagnateur), son auteur choisit **Informer** (ajout direct, comme avant) ou **Demander leur réponse**. Chaque invité voit alors l’invitation sur son Accueil et répond **Accepter** ou **Décliner** (table `family_event_replies`, colonne `ask`, ajoutées automatiquement). Les réponses s’affichent sur l’activité, en toutes lettres ; dans les couloirs, une réponse attendue est en pointillés avec une horloge et un invité qui décline n’apparaît plus. Changer le jour ou l’heure redemande une réponse à tous.

## Tâches clés

Un administrateur peut marquer une tâche comme **tâche clé**. Quand un membre la coche, elle passe « à valider » (colonnes `submitted_by`/`submitted_at`, ajoutées automatiquement) au lieu de « fait » ; un administrateur la **valide** (`validated_by`) ou la renvoie **à refaire**, depuis l’Accueil ou l’écran Tâches. Une tâche clé validée ne peut être rouverte que par un administrateur ; un membre ne peut pas créer de tâche clé.

## Tâches hebdomadaires et modifications

L’auteur d’une tâche ou un parent peut en modifier le titre, la personne et la date (crayon sur la ligne).

Une tâche datée peut être marquée **Chaque semaine** : une fois faite (ou validée pour une tâche clé), KARL crée la même tâche sept jours après sa date, une seule fois. La rouvrir retire cette copie si personne n’y a touché ; retirer une ancienne semaine terminée ne touche pas à la suivante. Colonnes `repeat` et `next_id`, ajoutées automatiquement.

## Météo de la famille

Carte en tête de l’Accueil, visible par tous les membres : température extérieure de la station Bresser (dernier relevé, signalé s’il a plus de 90 minutes), prévision du jour (ciel, min/max, pluie, vent, matin/après-midi/soir) et couleur Tempo du lendemain avec un conseil d’usage. Station et Tempo viennent de la même projection en lecture seule que le dashboard personnel (`HERMES_CRON_DIR`) ; seuls ces deux relevés sont exposés aux comptes familiaux, jamais les tâches ni les rapports.

Prévision : [Open-Meteo](https://open-meteo.com/) (modèle `meteofrance_seamless`, sans clé), en cache 30 minutes. Définir `KARL_WEATHER_LAT`, `KARL_WEATHER_LON` et éventuellement `KARL_WEATHER_PLACE` (libellé affiché). Sans coordonnées, la carte indique « Prévisions à configurer ».

## Repas

Écran **Courses → Repas** : menu de la semaine (midi/soir, nombre de personnes) et carnet de recettes partagé. Une recette s’écrit avec un ingrédient par ligne (« 250 g de farine », « 2 c. à s. d’huile », « sel ») ; KARL reconnaît les unités usuelles et devine le rayon. **Courses du menu** additionne les ingrédients de la semaine en tenant compte des portions (g/kg et ml/cl/l regroupés), puis montre ce qui est déjà coché à prendre sur la liste : ces produits ne sont jamais ajoutés deux fois. Rien n’est ajouté sans validation. Tables `family_recipes` et `family_meals`, créées automatiquement.

Les portions proposées par défaut correspondent au nombre de membres actifs. Au-delà de six recettes, un champ de recherche filtre le carnet par titre ou ingrédient. Toucher une recette l’affiche avec ses quantités recalculées pour le nombre de personnes choisi ; **Ajouter aux courses** y envoie ses ingrédients sans planifier de repas, avec la même règle anti-doublon. Toucher un plat prévu permet de changer midi/soir et le nombre de personnes. **Reprendre la semaine précédente** recopie le menu sans écraser un créneau déjà rempli. L’Accueil affiche le menu du jour et signale les ingrédients du menu des 7 prochains jours qui ne sont pas encore sur la liste.

**E.Leclerc Drive : non relié.** L’intégration Drive ne se trouve pas dans ce dépôt. En attendant, **Copier la liste pour le Drive** copie la liste restante, classée par rayon. KARL ne passe aucune commande et n’effectue aucun achat. Dans l’espace personnel du propriétaire, **Préparer mon panier Drive avec la liste de la famille** pré-remplit une demande à son propre Hermes (liste restante + consignes : ajouter au panier seulement, ne jamais valider ni payer, pas de doublon, alternatives proposées et non choisies). Rien n’est envoyé avant que le propriétaire relise et touche Envoyer ; le résultat dépend des outils Drive dont dispose ce Hermes. Route `GET /api/drive/list`, réservée à la clé KARL personnelle.

## Hermes pour chaque membre

Onglet « Hermes » de l’espace famille : chaque membre a ses propres conversations, illisibles par les autres, propriétaire compris (404 identique à une conversation inexistante). Suppression possible par le membre ; un administrateur peut couper l’assistant d’un membre sans toucher à ses autres accès.

- Branché sur un **profil Hermes dédié à la famille** (`HERMES_FAMILY_API_URL`, par défaut `http://127.0.0.1:8643/v1`, `HERMES_FAMILY_API_KEY`, `HERMES_FAMILY_MODEL`). Jamais de repli sur le Hermes personnel : sans clé famille, l’onglet affiche « bientôt disponible ». Ce profil doit avoir sa propre mémoire désactivée ou vide et aucun outil terminal/fichiers : KARL fournit le contexte à chaque tour.
- Contexte envoyé par tour : prénom, date et heure de Paris, prénoms de la famille, agenda du membre sur 14 jours, 20 derniers messages du fil. Rien d’autre de la base.
- Planning : Hermes peut seulement **proposer** une activité (bloc `karl-event`) ; KARL la valide et l’enregistre uniquement quand le membre touche « Ajouter au planning » (idempotent).
- Assistant personnel : Hermes reçoit aussi les tâches ouvertes attribuées au membre, la liste de courses restante, le menu des 7 prochains jours et ce que le membre lui a demandé de retenir (« Moi » → **Hermes et toi** : jusqu’à 50 informations, privées, modifiables et effaçables ; table `family_memory`). Il connaît aussi les titres du carnet de recettes et peut proposer une activité, une tâche (éventuellement hebdomadaire), un article, un repas, une recette pour le carnet ou une information à retenir (blocs `karl-event`, `karl-task`, `karl-item`, `karl-meal`, `karl-recipe`, `karl-memory`, dix au plus par réponse ; un repas reprend la recette du même nom) ; chaque proposition n’est enregistrée qu’après un toucher du membre. Il n’a aucun moyen d’acheter, de commander, d’envoyer un e-mail ou de supprimer un fichier, et sa consigne le lui rappelle.
- Limite `KARL_ASSISTANT_DAILY_LIMIT` messages par membre et par jour (60 par défaut), une réponse à la fois par membre.

## Assistant personnel et Hermes

La clé KARL personnelle reste distincte des sessions familiales, en mémoire dans l’onglet personnel. Les comptes familiaux, y compris administrateurs, ne donnent pas accès au chat, à l’historique ou aux crons personnels. Aucune commande ou notification envoyée à Telegram par les fonctions familiales.

L’adaptateur utilise `/v1/models` et `/v1/chat/completions` de l’[API Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) : `HERMES_API_URL`, `HERMES_API_KEY`, `HERMES_MODEL`. Les conversations KARL sont indépendantes ; les 20 derniers messages sont transmis par tour. Voix native du navigateur ou micro du clavier iPhone ; aucun moteur audio ajouté au VPS.

Les dashboards personnels Aujourd’hui/Maison lisent `HERMES_CRON_DIR` ; depuis un Mac, définir aussi `HERMES_CRON_SSH_HOST` et éventuellement `HERMES_CRON_READ_USER` (droits préexistants). Projection en lecture seule des tâches et derniers rapports Bresser/Tempo ; aucun prompt, destinataire, rapport brut ou secret renvoyé. Cache 20 secondes, relevés anciens/pannes signalés, aucune tâche exécutée. Mesures Linky non intégrées.

## Vérifier

`cd backend && .venv/bin/python -m unittest discover -s tests -v` puis `cd frontend && npm run build`.

Tests isolés, sans Google réel ni lancement Hermes. Installation iPhone : Safari → Partager → Sur l’écran d’accueil, depuis une adresse HTTPS accessible. Le service worker conserve uniquement le cadre public, jamais les API. Aucun déploiement ou changement du gateway Hermes/Telegram par ce code.
