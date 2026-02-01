# FRESQ V2 - Plan de Test Système Packs

## ✅ Checklist de test

### 1. Base de données (Supabase)
- [ ] Migration exécutée sans erreur
- [ ] Tables modifiées : `tickets`, `codes`
- [ ] Nouvelle table : `pack_configs` avec 5 packs
- [ ] Données existantes migrées correctement

### 2. Backend API
```bash
# Démarrer le serveur
cd server
npm start

# Le serveur devrait démarrer sur http://localhost:3000
```

#### Tests API Packs
```bash
# 1. Lister les packs disponibles
curl http://localhost:3000/api/packs

# Attendu: 5 packs (solo, mini, medium, mega, ultra)

# 2. Stats des packs (admin)
curl http://localhost:3000/api/admin/packs/stats

# Attendu: Stats de chaque pack
```

### 3. Interface Admin

#### Accès
- [ ] Ouvrir http://localhost:3000/admin.html
- [ ] Vérifier que les onglets "📦 Packs" et "📖 Concept" apparaissent

#### Onglet Packs
- [ ] Affichage des stats globales (achats, revenus, best-seller)
- [ ] Table de configuration des packs (5 packs visibles)
- [ ] Toggle actif/inactif fonctionne
- [ ] Table des ventes par pack

#### Onglet Concept
- [ ] Documentation complète du système visible
- [ ] Explications claires sur tracking, loterie, paliers

### 4. Interface Principale

#### UI Codes (Ligne horizontale)
- [ ] Ouvrir http://localhost:3000
- [ ] Se connecter avec un email
- [ ] Vérifier l'affichage : `📌 Mes codes: [badges] [input] [Ajouter]`
- [ ] Les codes s'affichent en badges cliquables
- [ ] Scroll horizontal si beaucoup de codes
- [ ] Input et bouton "Ajouter" à droite

#### Test d'ajout de code
- [ ] Ajouter un code existant
- [ ] Vérifier qu'il apparaît dans la liste horizontale
- [ ] Cliquer sur le badge → doit passer en mode peinture

### 5. Test Flow Complet Pack

#### Scénario: Achat Pack Mini (5+1 = 6 codes)

**Via Admin:**
1. [ ] Créer un achat pack via admin
2. [ ] Vérifier que le ticket a:
   - quantity = 6
   - base_quantity = 5
   - bonus_quantity = 1
   - status = 'pending'
3. [ ] Confirmer le paiement
4. [ ] Vérifier que 6 codes sont générés:
   - 5 avec source='purchased'
   - 1 avec source='pack_bonus'

**Via Interface Principale:**
5. [ ] Se connecter avec l'email du pack
6. [ ] Vérifier que les 6 codes apparaissent dans la barre horizontale
7. [ ] Peindre une case avec un code acheté
8. [ ] Peindre une case avec le code bonus
9. [ ] Les deux doivent fonctionner

### 6. Test Paliers (Tier Upgrade)

#### Vérifier comptage base_quantity uniquement
1. [ ] Noter le palier actuel
2. [ ] Acheter un Pack Mini (5 payés + 1 bonus)
3. [ ] Vérifier que la progression augmente de +5 (pas +6)
4. [ ] Le bonus ne compte PAS dans l'upgrade

### 7. Test Loterie

#### Vérifier participation de tous les codes
1. [ ] Créer un tirage (via admin)
2. [ ] Lancer le tirage
3. [ ] Vérifier que TOUS les codes avec cases peintes participent:
   - Codes purchased ✅
   - Codes pack_bonus ✅
   - Codes referral ✅

### 8. Test Remboursement

#### Vérifier blocage des packs
```bash
# Tenter de rembourser un pack (devrait échouer)
# Via admin → devrait afficher erreur "Cannot refund pack purchases"
```

### 9. Test Mobile/Responsive

- [ ] Ouvrir sur mobile/tablette
- [ ] Barre de codes scroll horizontalement
- [ ] Boutons accessibles
- [ ] Admin responsive

---

## 🐛 Problèmes potentiels

### Si l'API ne démarre pas
```bash
# Vérifier les logs
cd server
npm start

# Erreurs possibles:
# - Migration non exécutée → lancer migration_packs.sql
# - Port 3000 occupé → changer le port
# - Connexion DB → vérifier .env
```

### Si les packs ne s'affichent pas
```sql
-- Vérifier dans Supabase
SELECT * FROM pack_configs;

-- Si vide, réexécuter la migration section 5
```

### Si les codes ne s'affichent pas horizontalement
- Vider le cache du navigateur (Ctrl+Shift+R)
- Vérifier que index.html et app.js sont bien modifiés

---

## 📊 Validation finale

Tout est ✅ si:
1. Migration SQL exécutée sans erreur
2. Serveur démarre sans erreur
3. Admin affiche les 2 nouveaux onglets
4. Codes s'affichent en ligne horizontale
5. Achat pack génère les bons codes (purchased + bonus)
6. Paliers comptent uniquement base_quantity
7. Loterie inclut tous les codes avec cases peintes
8. Remboursement pack bloqué

---

## 🚀 Prochaines étapes

Après validation:
- [ ] Intégration Stripe pour paiements réels
- [ ] Email de confirmation d'achat
- [ ] Email de notification gain loterie
- [ ] Tests utilisateurs beta
