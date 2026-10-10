# Aura Duel, fiche technique d'implémentation

Oct 10, 2026 · @Arthur Fondeville

## Vue d'ensemble

Aura Duel est un jeu web mobile en duel 1 contre 1 : deux joueurs se font face en visio, et le premier qui sourit, rit ou bouge perd son aura. Le nom est provisoire.

Le concept reprend la règle implicite du meme "aura farming" : moins l'effort se voit, plus on gagne d'aura. Chaque joueur peut provoquer l'autre avec son visage et une soundboard limitée, mais chaque provocation augmente son propre risque de craquer.

**Cible.** 16 à 25 ans, entre amis, sur smartphone. Usage prévu : partage d'un lien de salon privé.

**Périmètre du MVP.**

- Salon privé à deux joueurs, rejoint par code ou lien
- Flux vidéo et audio en direct entre les deux téléphones (WebRTC)
- Arbitrage automatique du visage de chaque joueur par détection faciale locale
- Score d'aura en temps réel, partie en 3 manches
- Soundboard de 6 sons fournis, avec munitions et recharge
- Écran de résultat partageable en image

**Hors MVP.** Matchmaking public, comptes utilisateurs, classement global, sons enregistrés par les joueurs (phase 2), mode même pièce sur un seul téléphone (phase 3).

**Hypothèse prise.** Les joueurs sont à distance, chacun sur son téléphone. Si l'usage principal se révèle être en présentiel, le mode un seul téléphone évite toute la couche WebRTC et devient prioritaire.

## Règles du jeu

Une partie se joue au meilleur des 3 manches ; une manche dure 60 secondes maximum. Toutes les valeurs ci-dessous sont des valeurs de départ à exposer dans un fichier de configuration unique (`gameConfig.ts`) pour les ajuster en playtest.

**Déroulé d'une manche.**

1. Compte à rebours de 3 secondes, puis 2 secondes de grâce sans pénalité.
2. Chaque joueur démarre à 1000 d'aura et gagne +10 d'aura par seconde tant qu'il reste neutre et immobile (le "farming").
3. La manche s'arrête immédiatement si un joueur craque (rire détecté) ou tombe à 0 d'aura ; il perd la manche.
4. Au bout de 60 secondes, le joueur avec le plus d'aura gagne la manche. En cas d'égalité à moins de 50 points, mort subite de 15 secondes.

**Pénalités faciales.** Les blendshapes sont les coefficients d'expression renvoyés par MediaPipe, entre 0 et 1. Un événement ne compte que s'il dépasse le seuil pendant la durée indiquée, pour éviter les faux positifs.

| Événement | Condition de détection | Durée mini | Effet |
| --- | --- | --- | --- |
| Sourire léger | moyenne mouthSmileLeft/Right > 0,35 | 300 ms | -150 aura, cooldown 1,5 s |
| Sourire franc | moyenne mouthSmileLeft/Right > 0,60 | 300 ms | -400 aura, cooldown 1,5 s |
| Rire (craquage) | sourire > 0,50 et jawOpen > 0,45 | 400 ms | -1000 aura, fin de manche |
| Mouvement de tête | déplacement du nez > 8 % de la largeur du visage vs calibration | 500 ms | -50 aura par seconde |
| Visage perdu | aucun visage détecté | 1 s | -200 aura puis -100 par seconde, alerte à l'écran |

Les clignements sont ignorés. Une grimace bouche ouverte sans sourire n'est pas pénalisée : c'est l'arme principale du joueur, et la condition du rire exige les deux signaux combinés.

**Soundboard.** Chaque joueur dispose de 3 munitions par manche, avec 8 secondes de recharge entre deux sons. Un son se joue sur les deux téléphones en même temps, le lanceur risque donc aussi de craquer. Chaque son lancé coûte 50 d'aura (taxe "try hard").

**Fin de partie.** Premier à 2 manches gagnées. L'écran de résultat affiche le score d'aura cumulé, le moment du craquage (capture figée du flux du perdant si les deux joueurs l'ont accepté au départ) et un bouton revanche.

## Parcours utilisateur et écrans

Le parcours compte 7 écrans, découpés en routes ; l'objectif est d'arriver en partie en moins de 45 secondes depuis l'ouverture du lien.

| Route | Écran | Contenu | Sortie |
| --- | --- | --- | --- |
| `/` | Accueil | Logo, bouton "Créer un duel", champ code à 6 caractères, bouton "Rejoindre" | Création ou saisie du code |
| `/r/:code` | Préparation | Explication des règles en 3 visuels, case "J'accepte que le moment de mon craquage soit capturé", bouton "Activer caméra et micro" | Tap utilisateur (débloque aussi l'audio) |
| `/r/:code` | Permissions refusées | Message clair par navigateur pour réactiver caméra et micro, bouton réessayer | Retour préparation |
| `/r/:code` | Calibration | Aperçu de sa caméra avec ovale de cadrage, consigne "Visage neutre, ne bouge pas" pendant 3 s | Calibration validée |
| `/r/:code` | Salon d'attente | Lien et code à partager (Web Share API), statut de l'adversaire, bouton "Prêt" | Les deux joueurs prêts |
| `/r/:code` | Partie | Flux adverse plein écran, son propre flux en vignette, jauges d'aura, minuteur, soundboard | Fin de manche puis fin de partie |
| `/r/:code` | Résultat | Vainqueur, scores, capture du craquage, boutons "Revanche" et "Partager" | Revanche (retour calibration rapide) ou accueil |

Tout se joue en portrait, à une main. La soundboard est en bas de l'écran, dans la zone du pouce. Une déconnexion en cours de partie affiche une surcouche "Adversaire déconnecté" pendant 15 secondes de tentative de reconnexion, puis la victoire par forfait.

## Stack technique et structure du projet

Le projet est une SPA statique en React et TypeScript, entièrement hébergée sur Vercel et sans Supabase : des Vercel Functions assurent la signalisation en WebSocket, la gestion des salons et les identifiants TURN, et un Redis installé depuis le Vercel Marketplace porte l'état des salons.

| Couche | Choix | Rôle |
| --- | --- | --- |
| Build | Vite + React + TypeScript strict | SPA, HMR, build statique |
| État | Zustand | Machine d'état de la partie, scores, statut réseau |
| Style | CSS Modules + variables CSS | Thème unique sombre, animations en CSS et Canvas |
| Données | Redis installé depuis le Vercel Marketplace (Upstash) | Salons, jetons de joueur, relais pub/sub entre instances, résumé des parties, expirations natives |
| Temps réel | Vercel Function WebSocket `api/signal.ts` (bibliothèque `ws`) | Signalisation WebRTC, présence dans le salon, événements critiques en secours |
| Serveur | Vercel Functions `api/rooms.ts` et `api/turn-credentials.ts` | Création et jonction de salon, identifiants TURN temporaires |
| Identité | Jeton de joueur aléatoire par salon, aucun compte | Autorise la connexion WebSocket et les actions réservées à l'hôte |
| Média | WebRTC natif (`RTCPeerConnection`) | Vidéo, audio, DataChannel pour les événements de jeu |
| Relais | TURN managé (Cloudflare TURN, Metered ou Open Relay pour le prototype) | Connexion quand le pair à pair direct échoue |
| Vision | `@mediapipe/tasks-vision` (Face Landmarker) | Blendshapes et points du visage, en local |
| Audio | Web Audio API | Lecture des sons, mixage, déblocage autoplay |
| Tests | Vitest + Playwright | Logique de score en unitaire, parcours en E2E |
| Hébergement | Vercel, déploiement depuis GitHub | HTTPS obligatoire pour `getUserMedia` |

**Pourquoi WebSocket sur Vercel et Redis.** Les Vercel Functions servent des connexions WebSocket depuis la bêta publique du 22 juin 2026, avec des bibliothèques Node standard comme `ws` ([Vercel changelog](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)). Une connexion reste rattachée à une seule instance de fonction et se ferme à la durée maximale ; Vercel recommande un Redis du Marketplace pour l'état durable entre connexions ([Vercel KB](https://vercel.com/guides/do-vercel-serverless-functions-support-websocket-connections)). Les deux joueurs pouvant tomber sur deux instances différentes, chaque instance s'abonne en pub/sub Redis au canal `room:{code}` et relaie les messages à ses sockets.

**Repli obligatoire.** La fonctionnalité étant en bêta, implémenter dès le MVP une signalisation de secours par polling HTTP (`api/signal-poll.ts`, une boîte aux lettres Redis par joueur, lecture toutes les 500 ms), activable par `gameConfig.ts` ou automatiquement si le WebSocket échoue 2 fois. Le volume est faible : une offre, une réponse et une dizaine de candidats ICE, après quoi le DataChannel prend le relais.

Toutes les dépendances sont épinglées à une version exacte dans `package.json`. Le modèle `face_landmarker.task` et les fichiers WASM de MediaPipe sont servis depuis `/public` plutôt que depuis un CDN, pour maîtriser la version et le cache.

**Structure.**

```
src/
  app/            routes, layout, providers
  game/
    gameConfig.ts       toutes les valeurs ajustables
    machine.ts          machine d'état (lobby, calibration, countdown, round, roundEnd, matchEnd)
    scoring.ts          fonctions pures de calcul d'aura
    store.ts            store Zustand
  vision/
    faceWorker.ts       Face Landmarker dans un Web Worker
    detector.ts         lecture des blendshapes, lissage, détection d'événements
    calibration.ts      position et expression neutres de référence
  net/
    signaling.ts        client WebSocket de signalisation, repli polling
    peer.ts             RTCPeerConnection, ICE, reconnexion
    protocol.ts         types des messages (signalisation et DataChannel), partagés avec api/
  audio/
    soundboard.ts       chargement, lecture synchronisée, munitions
    unlock.ts           déblocage AudioContext au premier tap
  ui/
    components/   AuraGauge, VideoFrame, CrackEffect, SoundButton, Countdown
    screens/      Home, Prepare, Calibrate, Lobby, Match, Result
api/
  rooms.ts              POST création, POST jonction, PATCH statut, POST résultat de partie
  signal.ts             serveur WebSocket de signalisation
  signal-poll.ts        signalisation de secours en polling
  turn-credentials.ts   identifiants TURN temporaires
  _lib/
    redis.ts            client Redis et abonné pub/sub
    tokens.ts           génération et vérification des jetons de joueur
    rateLimit.ts        limites par IP hachée
public/
  mediapipe/      modèle .task et WASM
  sounds/         sons CC0 en .mp3 et .ogg
vercel.json
```

**Déploiement Vercel.**

- Projet Vercel relié au dépôt GitHub : `main` déploie en production, chaque pull request génère une URL de preview en HTTPS, utilisable directement sur téléphone pour tester caméra et micro.
- Preset Vite, commande `vite build`, dossier de sortie `dist`, Fluid compute activé (requis pour les WebSockets).
- Durée maximale de `api/signal.ts` réglée au plafond du plan dans `vercel.json` ; le client rouvre la connexion automatiquement si elle se ferme.
- `vercel.json` avec une réécriture de toutes les routes vers `index.html` (SPA), en excluant `/api/*`, sinon `/r/:code` renvoie une 404 au rechargement.
- En-têtes dans `vercel.json` : `Content-Type: application/wasm` pour les fichiers .wasm, cache long (`max-age=31536000, immutable`) sur `/mediapipe/*` et `/sounds/*` avec noms de fichiers versionnés, et `Permissions-Policy: camera=(self), microphone=(self)`.
- Redis installé depuis l'onglet Storage du projet Vercel ; l'intégration injecte automatiquement ses identifiants en variables d'environnement ([Vercel](https://vercel.com/docs/marketplace-storage)). Une base Redis distincte pour l'environnement Preview.
- Aucune variable `VITE_` n'est nécessaire : le client appelle uniquement `/api` sur le même domaine. Identifiants Redis et clé du fournisseur TURN restent côté serveur.
- Aucune migration de schéma : la structure des clés Redis est définie dans `api/_lib/redis.ts`.

## Architecture réseau

Les deux téléphones s'échangent vidéo, audio et événements de jeu en pair à pair via WebRTC ; Supabase ne sert qu'à se trouver et à négocier la connexion.

**Signalisation.** Le client crée ou rejoint un salon via `api/rooms.ts`, reçoit un jeton de joueur, puis ouvre `wss://<domaine>/api/signal?code=XXXXXX&token=...`. Le serveur vérifie le jeton, refuse un troisième joueur, publie la présence (`peer-joined`, `peer-left`) et relaie `offer`, `answer` et `ice-candidate` via le pub/sub Redis. Implémenter le modèle "perfect negotiation" de WebRTC : le créateur du salon est le pair "impolite", l'invité le pair "polite", pour gérer les offres croisées sans blocage. Un ping applicatif toutes les 20 secondes maintient la connexion ouverte.

**ICE et TURN.** Le TURN est obligatoire dès le MVP, pas une optimisation : selon les données de production, environ 10 à 25 % des sessions WebRTC ne parviennent pas à établir de connexion directe ([Fora Soft](https://www.forasoft.com/learn/video-streaming/glossary/terms-streaming/turn)), et sur réseau mobile un relais est nécessaire presque systématiquement ([Talky](https://about.talky.io/help/connection)). La configuration `iceServers` liste un STUN public puis le TURN en UDP 3478, TCP 3478 et TLS 443. Les identifiants TURN viennent de la Vercel Function `turn-credentials`, avec une durée de vie de 1 heure ; ils ne sont jamais écrits en dur côté client. Pour le prototype, Open Relay offre 20 Go par mois gratuitement ([Metered](https://www.metered.ca/blog/what-is-a-turn-server/)).

**Média.** Caméra frontale en 480 × 640, 24 images par seconde. Plafonner le débit vidéo à 600 kbit/s via `RTCRtpSender.setParameters` pour limiter le coût TURN et la chauffe. Audio avec `echoCancellation`, `noiseSuppression` et `autoGainControl` activés, indispensables puisque les sons de la soundboard sortent du haut-parleur.

**Autorité.** Le créateur du salon (hôte) fait autorité sur le temps : compte à rebours, début et fin de manche, décision de vainqueur. Chaque client fait autorité sur ses propres pénalités, détectées sur son propre visage, et les envoie à l'autre. Une synchronisation d'horloge simple (échange de 5 pings au début, calcul du décalage médian) permet d'exprimer tous les instants dans l'horloge de l'hôte.

**DataChannel.** Un canal `game`, ordonné et fiable. Messages JSON typés dans `protocol.ts` :

| Type | Émetteur | Charge utile | Usage |
| --- | --- | --- | --- |
| `hello` | les deux | version du protocole, consentement capture | Vérifier la compatibilité |
| `ping` / `pong` | les deux | horodatages | Synchronisation d'horloge |
| `ready` | les deux | calibration validée | Lancer la partie |
| `roundStart` | hôte | numéro de manche, `startAt` | Compte à rebours synchronisé |
| `penalty` | joueur pénalisé | type d'événement, montant, horodatage | Mise à jour du score adverse |
| `aura` | les deux, toutes les 500 ms | score courant | Correction de dérive |
| `sound` | lanceur | id du son, `playAt` (+150 ms) | Lecture simultanée sur les deux appareils |
| `crack` | joueur qui craque | horodatage | Fin de manche immédiate |
| `roundEnd` / `matchEnd` | hôte | vainqueur, scores | Transition d'écran |
| `rematch` | les deux | aucune | Revanche |

**Reconnexion.** Sur `iceconnectionstatechange` à `disconnected`, attendre 3 secondes puis lancer un ICE restart via la signalisation. Au-delà de 15 secondes sans connexion, l'hôte déclare la victoire par forfait. Si le DataChannel tombe mais que le WebSocket de signalisation est vivant, les messages critiques (`crack`, `roundEnd`) repassent par lui.

## Détection faciale

Chaque téléphone analyse uniquement son propre flux caméra avec le Face Landmarker de MediaPipe, qui renvoie pour chaque visage 478 points et 52 blendshapes ([Google AI Edge](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)). Aucune donnée faciale ne quitte l'appareil ; seuls les événements de pénalité sont transmis.

**Configuration.** `runningMode: "VIDEO"`, `numFaces: 1`, `outputFaceBlendshapes: true`, `outputFacialTransformationMatrixes: false`, délégué GPU avec repli CPU si l'initialisation échoue. Fréquence d'inférence cible : 15 analyses par seconde, indépendante du framerate vidéo.

**Thread.** La documentation de Google recommande un Web Worker pour éviter que `detect()` bloque l'interface. Envoyer chaque image au worker via `createImageBitmap` sur l'élément vidéo local, en objet transférable. Si le worker ne peut pas initialiser le délégué GPU (cas possible sur certaines versions d'iOS Safari), basculer sur le thread principal à 10 analyses par seconde. Tester les deux chemins.

**Calibration.** Pendant 3 secondes avant la première manche, le joueur garde un visage neutre. On enregistre la moyenne de chaque blendshape utile et la position de référence du nez (point 1), normalisée par la largeur du visage (distance entre les points 234 et 454). Les seuils du tableau des règles s'appliquent ensuite au-dessus de cette référence : seuil effectif = référence + seuil, plafonné à 0,9. Cela neutralise les visages qui sourient légèrement au repos. La calibration échoue et se relance si le visage n'est pas détecté sur au moins 80 % des images.

**Traitement du signal.**

1. Lissage exponentiel de chaque blendshape, coefficient 0,4.
2. Moyenne gauche et droite pour les paires (sourire), afin de ne pas pénaliser une asymétrie de visage.
3. Détection d'événement par seuil maintenu sur la durée minimale, avec hystérésis : l'événement se termine quand la valeur redescend sous 80 % du seuil.
4. Cooldown par type d'événement pour éviter qu'un sourire tenu soit compté en rafale.
5. Pendant les 2 secondes de grâce et le compte à rebours, détection active mais sans pénalité, pour afficher l'état "neutre" ou "tu souris" en aide.

**Mode debug.** Un paramètre d'URL `?debug=1` affiche en surimpression les valeurs lissées, les seuils effectifs et les événements. C'est l'outil principal pour ajuster `gameConfig.ts` en playtest.

## Audio

La soundboard du MVP contient 6 sons fournis, tous sous licence CC0 ou enregistrés par l'équipe ; aucun extrait de meme sous droits n'est intégré, ni en MVP ni plus tard.

**Déblocage.** Les navigateurs mobiles bloquent l'audio sans geste utilisateur. Créer l'`AudioContext` et appeler `resume()` dans le gestionnaire du tap "Activer caméra et micro", puis jouer un buffer silencieux de 50 ms pour confirmer le déblocage. Si `audioContext.state` n'est pas `running` au moment du "Prêt", afficher un bouton "Activer le son".

**iOS et bouton silencieux.** Sur iPhone, le son Web Audio peut être coupé quand le bouton latéral est en mode silencieux. Utiliser `navigator.audioSession.type = "playback"` quand l'API existe, et sinon afficher un rappel "Sors du mode silencieux" dans l'écran de préparation. Comportement à vérifier sur appareil réel.

**Chargement.** Tous les sons sont chargés et décodés (`decodeAudioData`) pendant le salon d'attente, au format .mp3 avec repli .ogg, 1,5 seconde maximum chacun, normalisés au même volume perçu. Poids total visé : moins de 300 Ko.

**Lecture synchronisée.** Au tap, le lanceur envoie `sound` avec `playAt` = maintenant + 150 ms dans l'horloge de l'hôte. Les deux appareils programment la lecture via `AudioBufferSourceNode.start()` à l'instant converti. Le bouton affiche immédiatement l'état recharge, sans attendre la lecture.

**Interaction avec le micro.** Les sons sortent du haut-parleur et sont captés par le micro ; l'annulation d'écho de `getUserMedia` doit rester activée. Pendant la lecture d'un son, réduire de moitié le volume du flux audio adverse pour garder le son lisible.

**Phase 2, sons personnels.** Chaque joueur peut enregistrer jusqu'à 3 sons de 3 secondes via `MediaRecorder`. Les sons restent stockés en local dans IndexedDB et sont envoyés à l'adversaire par le DataChannel au début de la partie (100 Ko maximum par son). Rien n'est stocké côté serveur.

## Interface et direction artistique

Le contenu visuel principal est le visage de l'adversaire ; l'interface se limite à un cadre, un halo, des compteurs et l'effet de craquage. Aucune illustration ni sprite animé n'est requis.

**Composition de l'écran de partie.** Flux adverse en plein écran recadré (`object-fit: cover`). Son propre flux en vignette ronde de 96 px en haut à droite, en miroir. Jauges d'aura en haut, celle de l'adversaire à gauche, la sienne à droite, avec la valeur numérique. Minuteur centré en haut. Soundboard en bas : une rangée de 3 boutons de 64 px minimum, avec munitions restantes et anneau de recharge.

**Halo d'aura.** Un pseudo-élément autour du flux adverse porte un dégradé radial pré-calculé en CSS. Son intensité suit l'aura de l'adversaire. N'animer que `opacity` et `transform` pour rester sur le compositeur ; proscrire `box-shadow` et `filter: blur()` animés, trop coûteux sur mobile.

**Feedback d'aura.** Chaque variation affiche un compteur flottant en typographie cinétique : "+10" discret pendant le farming, "-150" et "-400" gros et secs, "-1000" plein écran. Pool de 10 éléments DOM réutilisés, animés en CSS.

**Craquage.** Au message `crack`, figer la dernière image du flux du perdant dans un canvas (`drawImage` depuis l'élément vidéo), superposer une texture de fissure en SVG pré-dessinée, puis 400 ms de tremblement d'écran et un décalage RVB léger. Cette image figée alimente l'écran de résultat si les deux joueurs ont donné leur consentement.

**Tokens.**

| Token | Valeur de départ | Usage |
| --- | --- | --- |
| `--bg` | #0B0B0F | Fond |
| `--fg` | #F5F5F7 | Texte |
| `--aura-me` | #7CF7FF | Halo et jauge du joueur |
| `--aura-opp` | #FF5CF4 | Halo et jauge de l'adversaire |
| `--loss` | #FF3B30 | Pénalités, craquage |
| `--radius` | 20px | Boutons, vignette |
| `--font-display` | grotesque condensée grasse, auto-hébergée, à choisir | Compteurs et titres |
| `--font-ui` | system-ui | Interface |

Les couleurs ne portent jamais seules l'information : chaque jauge a aussi une étiquette "Toi" ou le pseudo adverse. Respecter `prefers-reduced-motion` en remplaçant tremblements et décalages RVB par un simple fondu. Les vibrations (`navigator.vibrate`) sont un bonus Android uniquement, absentes sur iOS Safari.

## Modèle de données Redis

Toutes les données sont éphémères et vivent dans Redis avec une expiration ; il n'y a ni base SQL, ni compte utilisateur, ni image, ni son, ni donnée faciale stockés.

| Clé | Type | Contenu | Expiration |
| --- | --- | --- | --- |
| `room:{code}` | hash | `status` (waiting, playing, finished), `hostTokenHash`, `guestTokenHash`, `createdAt` | 2 h |
| `room:{code}` (canal) | pub/sub | Messages de signalisation et de présence | aucune |
| `room:{code}:inbox:{host\|guest}` | liste | Messages en attente pour le repli polling | 2 h |
| `match:{id}` | chaîne JSON | `code`, `winner` (host, guest, forfeit\_host, forfeit\_guest), `rounds` \[{winner, hostAura, guestAura, endedBy, durationMs}\], `createdAt` | 30 jours |
| `ratelimit:create:{ipHash}` | compteur | Créations de salon dans l'heure | 1 h |

**Codes de salon.** 6 caractères sans ambiguïté visuelle (alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`), générés dans `api/rooms.ts` et réservés avec `SET ... NX EX 7200`, nouvel essai en cas de collision.

**Contrôle d'accès.** À la création et à la jonction, le serveur génère un jeton aléatoire de 32 octets, renvoie le jeton au client et ne stocke que son empreinte SHA-256. Le client le garde en `sessionStorage` pour survivre à un rechargement. La jonction est atomique (script Lua ou `HSETNX` sur `guestTokenHash`) pour qu'un seul invité obtienne la place. Changer le statut et enregistrer le résultat exigent le jeton de l'hôte.

**Nettoyage.** Aucun traitement planifié : les expirations Redis suppriment salons, boîtes aux lettres et parties automatiquement.

## Sécurité, vie privée, anti-triche

La règle structurante : aucun flux vidéo entre inconnus. Le jeu fonctionne uniquement par salons privés, rejoints par code ou lien partagé volontairement ; il n'y a ni matchmaking, ni liste de salons publics.

**Vie privée.**

- Les flux vidéo et audio ne passent jamais par un serveur de l'application ; seul le relais TURN les transporte, chiffrés de bout en bout par DTLS-SRTP.
- Aucun enregistrement des flux. La capture figée du craquage reste dans la mémoire du navigateur et n'existe que si les deux joueurs l'ont acceptée ; elle ne quitte l'appareil que si l'utilisateur la partage lui-même.
- L'analyse faciale sert à lire des expressions, pas à identifier quelqu'un ; elle tourne en local et rien n'est conservé. Le dire explicitement dans l'écran de préparation et dans une page `/confidentialite`.
- Un bouton "Quitter" toujours visible coupe immédiatement caméra, micro et connexion, et libère les pistes (`track.stop()`).

**Abus.** Limite de 10 créations de salon par heure et par adresse IP hachée, appliquée dans `api/rooms.ts`. Un salon refuse tout troisième participant. Un salon expire 2 heures après création. Le serveur WebSocket rejette les messages de plus de 16 Ko et plus de 50 messages par seconde par connexion.

**Anti-triche.** Chaque joueur arbitre son propre visage, la triche est donc possible (code modifié, caméra masquée, vidéo virtuelle). C'est un choix assumé pour un jeu entre amis. Garde-fous minimaux : la pénalité "visage perdu" rend la caméra masquée perdante, l'adversaire voit le flux et peut juger, et un client qui n'envoie aucun message `aura` pendant 3 secondes est considéré déconnecté. Un arbitrage croisé (chaque client analyse aussi le flux reçu) est possible plus tard mais doublerait la charge de calcul.

## Performance et compatibilité mobile

Le point critique est la charge simultanée : encoder un flux, en décoder un autre et faire tourner la détection faciale sur le même téléphone. Les cibles ci-dessous doivent tenir sur un téléphone milieu de gamme de 2021 (iPhone 12, Pixel 6a).

| Indicateur | Cible | Mesure |
| --- | --- | --- |
| Interface | 60 images/s, 30 minimum | Performance panel, overlay debug |
| Inférence faciale | 15 analyses/s, 10 minimum | Compteur dans `?debug=1` |
| Latence d'une pénalité à l'écran adverse | moins de 300 ms | Horodatages du protocole |
| Temps jusqu'à l'écran de préparation | moins de 2 s en 4G | Lighthouse mobile |
| Bundle JS initial | moins de 200 Ko gzip, MediaPipe chargé à la demande | Rapport de build Vite |
| Partie de 3 manches | aucune coupure thermique | Test sur appareil réel, 5 parties d'affilée |

**Dégradation automatique.** Si l'interface passe sous 30 images/s pendant 3 secondes, descendre l'inférence à 10 analyses/s, puis la vidéo envoyée à 360 × 480 et 400 kbit/s, puis désactiver le décalage RVB et le halo animé.

**Navigateurs supportés.** iOS Safari 16.4 et plus, Chrome Android des deux dernières versions majeures. Les navigateurs intégrés (Instagram, TikTok, Snapchat) gèrent mal `getUserMedia` : les détecter par user agent et afficher "Ouvre ce lien dans Safari ou Chrome" avec un bouton de copie du lien. Point important puisque le lien sera souvent partagé dans ces applications.

**Détails d'implémentation à ne pas oublier.**

- Attributs `playsinline`, `autoplay` et `muted` sur la vidéo locale, `playsinline` et `autoplay` sur la vidéo distante.
- Wake Lock API (`navigator.wakeLock.request("screen")`) pendant la partie pour empêcher la mise en veille.
- Événement `visibilitychange` : si l'application passe en arrière-plan pendant une manche, la manche est perdue après 5 secondes.
- Verrouillage visuel en portrait : en paysage, afficher "Tourne ton téléphone".
- Libérer caméra, micro, worker et `AudioContext` en quittant la route de partie.

## Plan d'implémentation par phases

L'ordre est choisi pour lever le risque le plus fort en premier : la détection faciale sur mobile, testée en solo, avant toute ligne de réseau. Instruction pour Claude Code : travailler une phase à la fois, s'arrêter à chaque critère de passage et attendre validation avant la phase suivante.

**Phase 0, socle.**

- [ ] Projet Vite + React + TypeScript strict, ESLint, Prettier, Vitest, Playwright
- [ ] Structure de dossiers de la section Stack, `gameConfig.ts` avec toutes les valeurs des règles
- [ ] Déploiement Vercel depuis GitHub, HTTPS actif, Fluid compute activé, `vercel.json`
- [ ] Redis installé depuis le Vercel Marketplace et relié au projet, base Preview séparée, `api/_lib/redis.ts` opérationnel

Passage : l'URL de déploiement s'ouvre sur un téléphone réel.

**Phase 1, vision en solo.**

- [ ] Accès caméra frontale, écran Préparation et gestion du refus de permission
- [ ] Face Landmarker dans un worker, repli thread principal
- [ ] Calibration, lissage, détection d'événements, cooldowns
- [ ] `scoring.ts` en fonctions pures, couvert à 90 % par des tests unitaires
- [ ] Mode bac à sable `/solo` : une manche de 60 s contre le chronomètre, jauge d'aura, overlay `?debug=1`

Passage : sur iPhone et Android, un sourire est détecté en moins de 500 ms, un visage neutre ne déclenche aucune pénalité pendant 60 s, l'inférence tient 15 analyses/s.

**Phase 2, réseau.**

- [ ] `api/rooms.ts` : création, jonction atomique, jetons, limite de débit
- [ ] `api/signal.ts` : WebSocket, vérification du jeton, présence, relais pub/sub Redis entre instances
- [ ] `api/signal-poll.ts` et bascule automatique côté client
- [ ] `RTCPeerConnection` avec perfect negotiation, `api/turn-credentials.ts`
- [ ] DataChannel `game`, types de `protocol.ts`, synchronisation d'horloge
- [ ] Reconnexion WebSocket et ICE restart

Passage : deux téléphones, l'un en Wi-Fi et l'autre en 4G, se voient et s'entendent en moins de 5 s après "Prêt", 10 fois sur 10.

**Phase 3, boucle de jeu.**

- [ ] Machine d'état complète, hôte autoritaire sur le temps
- [ ] Envoi des pénalités, correction de dérive par `aura`, craquage, mort subite
- [ ] Écran Résultat et revanche, forfait sur déconnexion

Passage : une partie complète de 3 manches se joue sans désynchronisation de score supérieure à 50 points.

**Phase 4, audio.**

- [ ] Déblocage `AudioContext`, gestion du mode silencieux iOS
- [ ] Soundboard, munitions, recharge, taxe d'aura
- [ ] Lecture synchronisée via `playAt`

Passage : un son se joue sur les deux appareils avec moins de 100 ms d'écart perçu.

**Phase 5, interface.**

- [ ] Tokens, halo, compteurs cinétiques, effet de craquage, capture figée consentie
- [ ] Dégradation automatique, `prefers-reduced-motion`, détection des navigateurs intégrés
- [ ] Partage du résultat en image (Web Share API avec fichier, repli téléchargement)

Passage : les cibles du tableau de performance sont tenues sur les deux appareils de référence.

**Après le MVP.** Phase 6 : sons enregistrés par les joueurs. Phase 7 : mode même pièce, un seul téléphone, caméra frontale et détection de 2 visages (`numFaces: 2`), sans WebRTC.

## Critères d'acceptation et tests

Le MVP est accepté quand une partie complète se joue entre un iPhone et un Android sur réseaux différents, sans intervention technique, 10 fois sur 10.

**Tests unitaires (Vitest).** `scoring.ts` et `detector.ts` reçoivent des séquences de blendshapes simulées, horodatées. Cas obligatoires : visage neutre stable, sourire bref sous la durée minimale (aucune pénalité), sourire tenu (une seule pénalité grâce au cooldown), rire, grimace bouche ouverte sans sourire (aucune pénalité), visage perdu, sourire au repos neutralisé par la calibration, égalité et mort subite.

**Tests E2E (Playwright).** Deux contextes Chromium lancés avec `--use-fake-device-for-media-stream` et `--use-fake-ui-for-media-stream`. Scénarios : création et jonction de salon, refus d'un troisième joueur, connexion WebRTC établie, partie complète avec pénalités injectées via un hook de test, déconnexion et forfait, revanche.

**Tests sur appareils réels.**

| Appareil | Navigateur | Réseau | À vérifier |
| --- | --- | --- | --- |
| iPhone récent | Safari | 4G | Permissions, mode silencieux, worker GPU, chauffe |
| iPhone 12 ou équivalent | Safari | Wi-Fi | Cibles de performance |
| Android milieu de gamme | Chrome | 4G | Relais TURN, dégradation automatique |
| Android récent | Chrome | Wi-Fi du campus | Réseau filtré, TURN en TLS 443 |
| N'importe lequel | Navigateur intégré Instagram | 4G | Message "Ouvre dans Safari ou Chrome" |

**Playtest.** 5 duels entre personnes différentes, overlay debug actif, pour ajuster les seuils de `gameConfig.ts`. Critère : aucun joueur ne conteste plus d'une pénalité par partie.

## Questions ouvertes

- [ ] Usage principal à distance ou dans la même pièce ? La réponse peut inverser la priorité entre le MVP réseau et le mode un seul téléphone.
- [ ] Nom définitif du jeu et choix de la police d'affichage.
- [ ] Fournisseur TURN de production (Cloudflare, Metered ou coturn auto-hébergé) et budget mensuel accepté.
- [ ] Liste et origine exacte des 6 sons du MVP.
- [ ] Usage prévu sur le campus Ynov : si oui, tester tôt le Wi-Fi de l'école, souvent filtré.

## Sources

- [Face landmark detection guide for Web, Google AI Edge](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [Liste des 52 blendshapes du Face Landmarker, exemple jweb-face-landmarker](https://github.com/lysdexic-audio/jweb-face-landmarker)
- [TURN, Fora Soft](https://www.forasoft.com/learn/video-streaming/glossary/terms-streaming/turn)
- [Connexion et serveurs TURN, Talky](https://about.talky.io/help/connection)
- [What is a TURN server, Metered](https://www.metered.ca/blog/what-is-a-turn-server/)
- [WebSocket support now in Public Beta, Vercel changelog](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)
- [WebSockets dans les Vercel Functions, documentation](https://vercel.com/docs/functions/websockets)
- [Do Vercel Functions support WebSocket connections, Vercel KB](https://vercel.com/guides/do-vercel-serverless-functions-support-websocket-connections)
- [Storage on Vercel Marketplace](https://vercel.com/docs/marketplace-storage)
