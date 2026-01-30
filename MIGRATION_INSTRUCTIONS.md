# Migration V2.7 - Système d'authentification par email

## ⚠️ IMPORTANT : Migration de base de données requise

Avant de déployer cette version, tu DOIS exécuter la migration SQL sur ta base de données Supabase.

## Instructions

1. Va sur [Supabase Dashboard](https://app.supabase.com)
2. Sélectionne ton projet FRESQ
3. Va dans l'onglet **SQL Editor**
4. Copie-colle le contenu du fichier `server/migration_add_users.sql`
5. Clique sur **Run** pour exécuter la migration

## Ce que fait la migration

- Crée une table `users` pour stocker les emails des utilisateurs
- Ajoute une colonne `user_id` dans la table `codes` pour lier les codes aux utilisateurs
- Crée les index nécessaires pour optimiser les performances

## Nouveau flux utilisateur

### Avant (V2.6)
1. Étape 1 : Entrer un code
2. Étape 2 : Sélectionner une case + couleur
3. Étape 3 : Vue de la grille (repeindre ou nouveau code)

### Après (V2.7)
1. **Étape 1** : Se connecter avec son email
2. **Étape 2** : Voir la grille + gérer ses codes (ajouter un nouveau code OU repeindre un code existant)
3. **Étape 3** : Sélectionner une case + couleur
4. **Retour à l'étape 2** après avoir peint

## Avantages

- Un utilisateur peut gérer plusieurs codes avec un seul email
- Sauvegarde automatique de la session
- Interface plus intuitive avec gestion centralisée des codes
- Pas besoin de se souvenir de ses codes, juste de son email
