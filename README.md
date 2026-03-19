# Eval Cours App

Application React avec 2 modes de persistance:

- mode local JSON via [server/index.mjs](/Users/alexandredestere/Desktop/eval-cours-app/server/index.mjs)
- mode Supabase via [supabase/schema.sql](/Users/alexandredestere/Desktop/eval-cours-app/supabase/schema.sql)

## Lancer en local

1. `npm install`
2. Terminal 1: `npm run server`
3. Terminal 2: `npm run dev`

Par defaut:

- front Vite: `http://localhost:5173`
- API + stockage JSON: `http://localhost:8787`

## Lancer avec Supabase

1. Creez un projet Supabase
2. Ouvrez SQL Editor
3. Executez [supabase/schema.sql](/Users/alexandredestere/Desktop/eval-cours-app/supabase/schema.sql)
4. Copiez [.env.example](/Users/alexandredestere/Desktop/eval-cours-app/.env.example) vers `.env.local`
5. Renseignez:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
6. Lancez `npm run dev`

Le PIN coordinateur initial defini dans le SQL est `1234`.

## Donnees persistantes

Le backend stocke les donnees dans [server/data](/Users/alexandredestere/Desktop/eval-cours-app/server/data).

- `config.json`: configuration globale
- `years.json`: promotions
- `years/<id>.json`: UE et reponses pour chaque promotion

En mode Supabase:

- `eval_public_state`: configuration publique + promotions
- `eval_year_content`: structure des UE/cours par promotion
- `eval_responses`: reponses individuelles
- `eval_admin`: hash du PIN coordinateur

## Mise en ligne

1. `npm run build`
2. `npm run server`

Si `dist/` existe, le serveur Node sert aussi l'application front. Vous pouvez aussi heberger le front et l'API separement en definissant `VITE_API_URL`.

## StackBlitz

Le projet est configure pour demarrer dans StackBlitz avec:

- [package.json](/Users/alexandredestere/Desktop/eval-cours-app/package.json) script `start`
- [.stackblitzrc](/Users/alexandredestere/Desktop/eval-cours-app/.stackblitzrc) `startCommand`

Concretement, StackBlitz lancera:

1. `npm run build`
2. `node server/index.mjs`

Important:

- ca fonctionne bien pour une demo partagee par URL
- mais WebContainers s'executent dans le navigateur, pas sur un vrai serveur distant
- donc pour des reponses durables et multi-utilisateurs, StackBlitz seul n'est pas une base de production suffisante

Pour une version durable via StackBlitz:

1. poussez le projet sur GitHub
2. ouvrez-le dans StackBlitz
3. ajoutez un fichier `.env.local` avec vos variables `VITE_SUPABASE_*`
4. laissez StackBlitz lancer l'application

Dans ce mode, l'interface tourne dans StackBlitz mais les donnees restent dans Supabase.
