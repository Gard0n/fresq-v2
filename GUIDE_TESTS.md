# FRESQ V2 - Guide Tests Complet

## 🔧 Configuration Initiale

### 1. Créer un compte admin

**Dans Supabase → SQL Editor**, exécute [create_admin.sql](file:///Users/grdn/Desktop/Perso/Perso/Code/FRESQ-V2/server/create_admin.sql):

```sql
-- Créer les tables admins et admin_sessions
-- Ajouter admin@fresq.com / admin123
```

### 2. Tester la connexion admin

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email": "admin@fresq.com", "password": "admin123"}' \
  | jq '.'
```

Tu devrais recevoir un token.

---

## 🎨 Test Interface Principale

### 1. Vider le cache et recharger
- Ouvre http://localhost:3000
- **Cmd+Shift+R** pour forcer le rechargement
- Vérifie que la barre de codes est horizontale

### 2. Tester ajout automatique de code
1. Connexion avec un email
2. Ajoute un code
3. **✨ Maintenant ça lance automatiquement le mode peinture !**
4. Choisis ta case et ta couleur

---

## 📦 Test Interface Admin & Packs

### 1. Connexion Admin
1. Ouvre http://localhost:3000/admin.html
2. Login: `admin@fresq.com` / `admin123`
3. Tu devrais voir tous les onglets dont **📦 Packs** et **📖 Concept**

### 2. Onglet Packs
- **Stats globales** : achats, revenus, best-seller, packs configurés
- **Configuration des packs** : table des 5 packs (solo → ultra)
  - Toggle actif/inactif
- **Statistiques ventes** : ventes par pack

### 3. Créer un pack de test

**Option A: Via API (avec token admin)**
```bash
# 1. Login pour obtenir le token
TOKEN=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email": "admin@fresq.com", "password": "admin123"}' \
  | jq -r '.token')

# 2. Créer achat pack pour un email test
curl -X POST http://localhost:3000/api/pack/purchase \
  -H 'Content-Type: application/json' \
  -d '{"email": "pack-test@fresq.com", "packKey": "mini"}'

# 3. Confirmer le paiement (génère les codes)
curl -X POST http://localhost:3000/api/admin/pack/ORDER-XXX-XXX/confirm \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.'
```

**Option B: Via SQL direct (plus rapide pour tester)**
```sql
-- 1. Créer un utilisateur
INSERT INTO users (email) VALUES ('pack-test@fresq.com')
ON CONFLICT (email) DO NOTHING
RETURNING id;

-- 2. Créer un ticket pack Mini (6 codes: 5+1)
INSERT INTO tickets (
  order_id,
  email,
  user_id,
  amount,
  quantity,
  base_quantity,
  bonus_quantity,
  status,
  tier_id
)
VALUES (
  'TEST-PACK-MINI-001',
  'pack-test@fresq.com',
  (SELECT id FROM users WHERE email = 'pack-test@fresq.com'),
  10.00,
  6,
  5,
  1,
  'paid',
  1
);

-- 3. Générer 5 codes purchased + 1 code bonus
-- Code purchased 1
INSERT INTO codes (code, user_id, source)
VALUES ('PACK-TEST-001', (SELECT id FROM users WHERE email = 'pack-test@fresq.com'), 'purchased');

-- Code purchased 2
INSERT INTO codes (code, user_id, source)
VALUES ('PACK-TEST-002', (SELECT id FROM users WHERE email = 'pack-test@fresq.com'), 'purchased');

-- Code purchased 3
INSERT INTO codes (code, user_id, source)
VALUES ('PACK-TEST-003', (SELECT id FROM users WHERE email = 'pack-test@fresq.com'), 'purchased');

-- Code purchased 4
INSERT INTO codes (code, user_id, source)
VALUES ('PACK-TEST-004', (SELECT id FROM users WHERE email = 'pack-test@fresq.com'), 'purchased');

-- Code purchased 5
INSERT INTO codes (code, user_id, source)
VALUES ('PACK-TEST-005', (SELECT id FROM users WHERE email = 'pack-test@fresq.com'), 'purchased');

-- Code BONUS
INSERT INTO codes (code, user_id, source)
VALUES ('PACK-TEST-BONUS', (SELECT id FROM users WHERE email = 'pack-test@fresq.com'), 'pack_bonus');

-- 4. Vérifier
SELECT c.code, c.source, c.cell_x, c.cell_y
FROM codes c
JOIN users u ON u.id = c.user_id
WHERE u.email = 'pack-test@fresq.com';
```

### 4. Tester avec l'utilisateur pack

1. **Interface principale** → http://localhost:3000
2. Connexion avec `pack-test@fresq.com`
3. **Vérifier** : Les 6 codes apparaissent en badges horizontaux
4. Cliquer sur un code → Mode peinture
5. Peindre une case avec un code purchased
6. Peindre une case avec le code bonus
7. **Les deux doivent fonctionner !**

---

## ✅ Checklist Validation Système Packs

### Backend
- [x] Migration SQL exécutée
- [x] 5 packs configurés (solo → ultra)
- [x] API packs fonctionnelle
- [ ] Admin créé et login fonctionne
- [ ] Pack créé de test

### Interface Principale
- [ ] Barre de codes horizontale (après Cmd+Shift+R)
- [ ] Ajout code lance automatiquement mode peinture
- [ ] Badges cliquables avec hover effect
- [ ] Codes purchased fonctionnent
- [ ] Codes bonus fonctionnent

### Interface Admin
- [ ] Login admin OK
- [ ] Onglet Packs visible
- [ ] Stats globales affichées
- [ ] Table configuration affichée
- [ ] Table ventes affichée
- [ ] Onglet Concept visible avec doc

### Flow Complet Pack
- [ ] Achat pack créé (pending)
- [ ] Confirmation génère codes (purchased + bonus séparés)
- [ ] Codes visibles sur interface utilisateur
- [ ] Peinture fonctionne avec les 2 types
- [ ] Loterie inclut tous les codes peints
- [ ] Palier compte uniquement base_quantity

---

## 🎯 Tests Spécifiques Système

### Test 1: Tracking base vs bonus
```sql
-- Vérifier un ticket pack
SELECT
  order_id,
  quantity as "Total",
  base_quantity as "Payés",
  bonus_quantity as "Bonus",
  amount as "Prix"
FROM tickets
WHERE quantity > 1
LIMIT 5;

-- Vérifier les codes associés
SELECT
  c.code,
  c.source,
  CASE WHEN c.cell_x IS NOT NULL THEN 'Peint' ELSE 'Non peint' END as "Statut"
FROM codes c
JOIN users u ON u.id = c.user_id
WHERE u.email = 'pack-test@fresq.com';
```

### Test 2: Palier upgrade (compte base_quantity uniquement)
```sql
-- Total tickets payés (pour calcul palier)
SELECT SUM(base_quantity) as "Tickets Payés (pour palier)"
FROM tickets
WHERE status = 'paid';

-- Total tickets avec bonus (NE COMPTE PAS)
SELECT SUM(quantity) as "Tickets Total (avec bonus)"
FROM tickets
WHERE status = 'paid';
```

### Test 3: Loterie (tous les codes participent)
```sql
-- Tous les codes éligibles pour loterie
-- (ceux avec case peinte, tous sources)
SELECT
  c.code,
  c.source,
  c.cell_x,
  c.cell_y,
  u.email
FROM codes c
JOIN users u ON u.id = c.user_id
WHERE c.cell_x IS NOT NULL
  AND c.cell_y IS NOT NULL
ORDER BY c.source, c.code;
```

---

## 🚀 Prochaines Étapes

Après validation complète:
1. **Intégration Stripe** pour paiements réels
2. **Emails de confirmation** d'achat avec codes
3. **Emails de notification** de gain loterie
4. **Dashboard analytics** pour suivi ventes
5. **Tests utilisateurs beta**

---

## 📝 Notes

- Password admin par défaut: `admin123` (à changer en prod!)
- Les codes bonus participent à la loterie
- Seuls les tickets payés comptent pour les paliers
- Remboursement de packs bloqué
