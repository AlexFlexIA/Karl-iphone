# Journal des améliorations — branche `claude/bold-cannon-4xnakh`

Version de test seulement : rien n’est déployé, `main` et la production sont inchangés.
Chaque ligne correspond à un commit testé (tests automatiques, build, parcours navigateur au format iPhone).

## Livraison initiale
- Repas : recettes, menu de la semaine, courses du menu ajustées aux portions, sans doublon avec la liste.
- Hermes pour chaque membre : mémoire privée et modifiable, propositions (activité, tâche, article, information) à confirmer d’un toucher, règles affichées dans « Moi ».

## Cycle 1 — fonctions repas et liste (29 tours)
- Menu du jour sur l’Accueil, recettes lisibles avec quantités recalculées, reprise de la semaine précédente.
- Hermes propose repas et recettes à partir du carnet familial ; idées de demandes.
- Ingrédients manquants signalés sur l’Accueil ; en-têtes qui ne débordent plus à 320 px.
- Repas modifiables (midi/soir, personnes) ; recette envoyée aux courses sans la planifier.
- Article déjà coché compté comme acheté ; jamais deux lignes pour le même produit ; article modifiable.
- Recherche dans le carnet ; reprise après coupure réseau ; réponses tardives d’une autre semaine ignorées.
- Accessibilité WCAG 2.2 AA vérifiée (axe) sur tous les nouveaux écrans, clair et sombre.
- Tâches hebdomadaires ; tâches modifiables ; Hermes connaît les tâches en retard, familiales et à valider.
- Vider le panier (annulable) ; menu du jour sous le Planning ; guide de test dans le README.
- Propriétaire : demande « Préparer mon panier Drive » pré-remplie pour son Hermes, sauvegarde JSON sans secrets ni données Hermes privées des membres.
- Rayon deviné d’après le nom (produits ménagers compris) ; tout cocher/décocher ; écran gardé allumé en magasin.

## Cycle 2 — assistant personnel (5 tours)
- « Tout accepter » pour plusieurs propositions d’Hermes.
- Rappels à l’heure sur les tâches : Accueil, bandeau et notification facultative pendant que KARL est ouvert.
- Contexte famille facultatif pour le Hermes personnel du propriétaire (jamais les fils ni mémoires privés).
- Carte « Ta semaine » sur l’Accueil ; conversations Hermes renommables.

## Cycle 3 — solidité et qualité
- Test de parcours navigateur dans le dépôt (`frontend/e2e/smoke.mjs`).
- Recherche « déjà sur la liste » mise en commun ; renommer un article ne crée plus de doublon.
- Longueur des lignes d’ingrédients plafonnée.
- Transparence : chaque proposition d’Hermes peut dire pourquoi ; l’écran Hermes détaille ce qu’il voit. README remis en cohérence ; tests du rapprochement des noms et des rayons.

### Relecture de code complète (10 défauts trouvés, 10 corrigés, chacun avec un test)
- « 1/2 citron » lu comme 1 « /2 citron » ; lignes d’ingrédients tronquées sans prévenir.
- Rayon deviné faux dès qu’un nom contient « de » (« farine de blé » rangée en légumes).
- Supprimer une conversation Hermes rendait des messages au quota du jour.
- Annuler un retrait, décocher ou restaurer pouvait recréer un doublon sur la liste.
- Une réponse tardive d’Hermes s’affichait dans une autre conversation.
- Défauts antérieurs : météo « indisponible » jusqu’à 30 min après minuit ; activité de nuit absente le lendemain matin ; activité impossible à modifier si un membre a été désactivé.
- Un seul appel Hermes partagé entre profils ; propositions de tâches revérifiées à l’acceptation.

## Toujours bloqué
- Intégration E.Leclerc Drive et déploiement : le code (`karl-deploy`, serveur `mcp-leclerc-drive`) n’est pas accessible depuis cette session (GitHub répond « introuvable »).
