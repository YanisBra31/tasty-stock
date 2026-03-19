# TASTY STOCK — Guide de mise en ligne
## Stack : Supabase (base de données + auth) + Vercel (hébergement) — 100% gratuit

---

## ÉTAPE 1 — Créer le projet Supabase

1. Allez sur **https://supabase.com** → "Start your project" → connectez-vous avec GitHub
2. Cliquez **"New project"**
   - Nom : `tasty-stock`
   - Mot de passe DB : choisissez-en un fort (notez-le)
   - Région : `West EU (Ireland)` — plus proche de Toulouse
3. Attendez ~2 minutes que le projet se lance

---

## ÉTAPE 2 — Créer les tables (schéma SQL)

1. Dans votre projet Supabase, allez dans **SQL Editor** (menu gauche)
2. Cliquez **"New query"**
3. Copiez-collez tout le contenu du fichier **`schema.sql`**
4. Cliquez **"Run"** (ou Ctrl+Entrée)
5. Vous devez voir : `Success. No rows returned`

---

## ÉTAPE 3 — Récupérer vos clés API

1. Dans Supabase, allez dans **Settings → API**
2. Copiez :
   - **Project URL** → ressemble à `https://abcdefgh.supabase.co`
   - **anon / public key** → longue chaîne commençant par `eyJ...`

3. Ouvrez le fichier **`supabase.js`** et remplacez :
   ```js
   const SUPABASE_URL  = 'https://VOTRE_PROJECT_ID.supabase.co';  // ← votre URL
   const SUPABASE_ANON = 'VOTRE_ANON_KEY';                         // ← votre clé
   ```

---

## ÉTAPE 4 — Créer votre premier utilisateur admin

La création d'utilisateurs passe par Supabase Auth.
Deux options :

### Option A — Via le dashboard Supabase (recommandé pour commencer)
1. Allez dans **Authentication → Users**
2. Cliquez **"Add user"** → "Create new user"
3. Email : `yanis@tastystock.app` (ou votre vrai email)
4. Password : votre mot de passe
5. Cliquez **"Create user"**
6. Allez dans **Table Editor → profiles** : votre profil a été créé automatiquement
7. Cliquez sur la ligne, changez `role` à `Administrateur`

### Option B — Via SQL
```sql
-- Dans SQL Editor, après avoir créé le user via l'interface :
UPDATE public.profiles
SET name = 'Yanis', role = 'Administrateur'
WHERE id = 'UUID_DU_USER';  -- récupérez l'UUID dans Authentication > Users
```

---

## ÉTAPE 5 — Configurer l'Auth Supabase

1. Allez dans **Authentication → Settings**
2. **Site URL** : mettez `http://localhost:3000` pour l'instant (on mettra Vercel après)
3. **Disable email confirmations** : activez cette option pour éviter d'avoir à confirmer l'email à chaque création de compte (pratique en interne)
   - Settings → Auth → Toggle "Enable email confirmations" → OFF

---

## ÉTAPE 6 — Tester en local

Ouvrez un terminal dans le dossier du projet :

```bash
# Option 1 — Python (installé sur Mac/Linux par défaut)
python3 -m http.server 3000

# Option 2 — Node.js
npx serve . -p 3000

# Option 3 — VS Code
# Installez l'extension "Live Server" et cliquez "Go Live"
```

Ouvrez **http://localhost:3000** dans votre navigateur.
Connectez-vous avec l'email et mot de passe créés à l'étape 4.

---

## ÉTAPE 7 — Déployer sur Vercel

### Prérequis
- Un compte GitHub (gratuit)
- Un compte Vercel (gratuit, connecté à GitHub)

### a) Mettre le code sur GitHub
```bash
cd tasty-stock-online

git init
git add .
git commit -m "initial: tasty stock online"

# Créez un repo sur github.com puis :
git remote add origin https://github.com/VOTRE_USERNAME/tasty-stock.git
git push -u origin main
```

### b) Déployer sur Vercel
1. Allez sur **https://vercel.com** → "Add New Project"
2. Importez votre repo GitHub `tasty-stock`
3. Framework : **"Other"** (c'est du HTML/JS pur)
4. Cliquez **"Deploy"**
5. Votre site est en ligne sur `https://tasty-stock-XXXX.vercel.app`

### c) Mettre à jour l'URL dans Supabase
1. Retournez dans Supabase → **Authentication → Settings**
2. Mettez votre URL Vercel dans **Site URL** :
   `https://tasty-stock-XXXX.vercel.app`
3. Ajoutez aussi dans **Redirect URLs** :
   `https://tasty-stock-XXXX.vercel.app/**`

---

## ÉTAPE 8 — Domaine personnalisé (optionnel)

Si vous avez un domaine (ex: `stock.tasty-restaurant.fr`) :

1. Dans Vercel → Settings → Domains → Add domain
2. Suivez les instructions pour pointer votre DNS vers Vercel
3. Mettez à jour l'URL dans Supabase Auth Settings

---

## STRUCTURE DES FICHIERS

```
tasty-stock-online/
├── index.html      — Interface HTML
├── style.css       — Styles (inchangé)
├── supabase.js     — ⚙️ Couche données (CONFIGUREZ VOS CLÉS ICI)
├── app.js          — Logique applicative (async/Supabase)
├── export.js       — Export CSV et PDF
└── schema.sql      — Schéma de base de données (à exécuter 1 fois)
```

---

## CONNEXION : comment les identifiants fonctionnent

Avec Supabase Auth, les identifiants sont des **emails**.

L'app accepte deux formats dans le champ "identifiant" :
- Email complet : `yanis@gmail.com`
- Pseudo court : `yanis` → converti automatiquement en `yanis@tastystock.app`

Pour utiliser les pseudos courts, créez les comptes avec l'email fictif :
- Yanis → `yanis@tastystock.app`
- Marie → `marie@tastystock.app`

---

## SÉCURITÉ — Points importants

✅ **La clé `anon` est publique** — c'est normal, elle est protégée par le RLS (Row Level Security) activé dans le schema.

✅ **RLS activé** — seuls les utilisateurs connectés peuvent lire/écrire les données.

⚠️ **Ne jamais exposer la clé `service_role`** — elle bypasse le RLS. Gardez-la uniquement dans le dashboard Supabase.

⚠️ **HTTPS obligatoire en production** — Vercel fournit le HTTPS automatiquement.

---

## MISES À JOUR DU CODE

Pour mettre à jour le site après modification :
```bash
git add .
git commit -m "update: description de la modification"
git push
```
Vercel redéploie automatiquement en ~30 secondes.

---

## DÉPANNAGE FRÉQUENT

| Problème | Solution |
|---|---|
| "Bibliothèque PDF non chargée" | Connexion internet requise (CDN) |
| Login ne fonctionne pas | Vérifiez SUPABASE_URL et SUPABASE_ANON dans supabase.js |
| "row-level security policy" | Vérifiez que le schema.sql a bien été exécuté |
| Stock vide après login | Créez d'abord un restaurant dans "Restaurants" |
| Email de confirmation bloquant | Désactivez-le dans Supabase Auth Settings |
