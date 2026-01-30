// FRESQ V2 - Admin Dashboard
// Client-side logic for admin panel

// ===== GLOBAL STATE =====
let token = localStorage.getItem('admin_token');
let currentAdmin = null;
let currentTab = 'dashboard';
let palette = [];

// ===== ELEMENTS =====
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const adminEmailInput = document.getElementById('admin-email');
const adminPasswordInput = document.getElementById('admin-password');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const adminEmailDisplay = document.getElementById('admin-email-display');
const logoutBtn = document.getElementById('logout-btn');

// Stats
const statUsers = document.getElementById('stat-users');
const statCodes = document.getElementById('stat-codes');
const statClaimed = document.getElementById('stat-claimed');
const statPainted = document.getElementById('stat-painted');
const statPercent = document.getElementById('stat-percent');
const stat24h = document.getElementById('stat-24h');

// ===== AUTHENTICATION =====
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = adminEmailInput.value.trim();
  const password = adminPasswordInput.value;

  if (!email || !password) {
    showLoginError('Email et mot de passe requis');
    return;
  }

  try {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Connexion...';
    loginError.textContent = '';

    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!data.ok) {
      showLoginError('Email ou mot de passe invalide');
      return;
    }

    token = data.token;
    currentAdmin = data.admin;
    localStorage.setItem('admin_token', token);

    showDashboard();
  } catch (err) {
    console.error('Login error:', err);
    showLoginError('Erreur de connexion');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Se connecter';
  }
});

function showLoginError(msg) {
  loginError.textContent = msg;
}

logoutBtn.addEventListener('click', async () => {
  if (!confirm('Voulez-vous vraiment vous déconnecter ?')) return;

  try {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) {
    console.error('Logout error:', err);
  }

  token = null;
  currentAdmin = null;
  localStorage.removeItem('admin_token');

  dashboardScreen.style.display = 'none';
  loginScreen.style.display = 'flex';
  adminEmailInput.value = '';
  adminPasswordInput.value = '';
});

async function checkAuth() {
  if (!token) return false;

  try {
    const res = await fetch('/api/admin/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      currentAdmin = data.admin;
      return true;
    }
  } catch (err) {
    console.error('Auth check error:', err);
  }

  token = null;
  localStorage.removeItem('admin_token');
  return false;
}

function showDashboard() {
  loginScreen.style.display = 'none';
  dashboardScreen.style.display = 'block';
  adminEmailDisplay.textContent = currentAdmin.email;

  loadDashboard();
}

// ===== TAB NAVIGATION =====
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    switchTab(tabName);
  });
});

function switchTab(tabName) {
  currentTab = tabName;

  // Update tab buttons
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  // Update panels
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${tabName}`);
  });

  // Load tab content
  switch (tabName) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'users':
      loadUsers();
      break;
    case 'codes':
      loadCodes();
      break;
    case 'grid':
      loadGrid();
      break;
    case 'config':
      loadConfig();
      break;
  }
}

// ===== API HELPER =====
async function apiCall(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };

  const res = await fetch(endpoint, {
    ...options,
    headers
  });

  if (res.status === 401) {
    alert('Session expirée. Veuillez vous reconnecter.');
    location.reload();
    throw new Error('Unauthorized');
  }

  return res.json();
}

// ===== DASHBOARD TAB =====
async function loadDashboard() {
  try {
    // Load stats
    const stats = await apiCall('/api/admin/stats');

    statUsers.textContent = stats.total_users.toLocaleString();
    statCodes.textContent = stats.total_codes.toLocaleString();
    statClaimed.textContent = stats.claimed_codes.toLocaleString();
    statPainted.textContent = stats.painted_cells.toLocaleString();
    statPercent.textContent = stats.percent_painted + '%';
    stat24h.textContent = stats.painted_24h.toLocaleString();

    // Load detailed stats
    const detailed = await apiCall('/api/admin/stats/detailed');

    // Render recent activity
    const container = document.getElementById('recent-activity-container');

    if (!detailed.recentActivity || detailed.recentActivity.length === 0) {
      container.innerHTML = '<div class="empty">Aucune activité récente</div>';
      return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Code</th>
          <th>Utilisateur</th>
          <th>Position</th>
          <th>Couleur</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        ${detailed.recentActivity.map(activity => `
          <tr>
            <td><code>${activity.code}</code></td>
            <td>${activity.email || '<em>Non assigné</em>'}</td>
            <td>${activity.x}, ${activity.y}</td>
            <td><span class="color-preview" style="background: ${palette[activity.color - 1] || '#888'}"></span> Couleur ${activity.color}</td>
            <td>${new Date(activity.updated_at).toLocaleString('fr-FR')}</td>
          </tr>
        `).join('')}
      </tbody>
    `;

    container.innerHTML = '';
    container.appendChild(table);
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

// ===== USERS TAB =====
let usersPage = 1;
let usersSearch = '';

document.getElementById('users-search-btn').addEventListener('click', () => {
  usersSearch = document.getElementById('users-search').value;
  usersPage = 1;
  loadUsers();
});

document.getElementById('users-search').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('users-search-btn').click();
  }
});

async function loadUsers() {
  const container = document.getElementById('users-table-container');
  container.innerHTML = '<div class="loading">Chargement...</div>';

  try {
    const data = await apiCall(`/api/admin/users?search=${encodeURIComponent(usersSearch)}&page=${usersPage}&limit=50`);

    if (data.users.length === 0) {
      container.innerHTML = '<div class="empty">Aucun utilisateur trouvé</div>';
      return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>ID</th>
          <th>Email</th>
          <th>Codes</th>
          <th>Peint</th>
          <th>Date création</th>
          <th>Statut</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.users.map(user => `
          <tr>
            <td>#${user.id}</td>
            <td>${user.email}</td>
            <td>${user.codes_count}</td>
            <td>${user.painted_count}</td>
            <td>${new Date(user.created_at).toLocaleDateString('fr-FR')}</td>
            <td>${user.is_banned ? '<span class="badge danger">Banni</span>' : '<span class="badge success">Actif</span>'}</td>
            <td>
              <button class="btn-sm" onclick="viewUser(${user.id})">👁️ Voir</button>
              ${user.is_banned ?
                `<button class="btn-sm" onclick="unbanUser(${user.id})">✅ Débannir</button>` :
                `<button class="btn-sm danger" onclick="banUser(${user.id})">🚫 Bannir</button>`
              }
              <button class="btn-sm danger" onclick="clearUserCells(${user.id})">🗑️ Effacer cells</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;

    container.innerHTML = '';
    container.appendChild(table);

    // Add pagination
    if (data.totalPages > 1) {
      const pagination = document.createElement('div');
      pagination.className = 'pagination';
      pagination.innerHTML = `
        <button ${usersPage === 1 ? 'disabled' : ''} onclick="usersPage--; loadUsers()">◀ Précédent</button>
        <span>Page ${usersPage} / ${data.totalPages}</span>
        <button ${usersPage === data.totalPages ? 'disabled' : ''} onclick="usersPage++; loadUsers()">Suivant ▶</button>
      `;
      container.appendChild(pagination);
    }
  } catch (err) {
    console.error('Users load error:', err);
    container.innerHTML = '<div class="empty">Erreur de chargement</div>';
  }
}

async function viewUser(userId) {
  try {
    const data = await apiCall(`/api/admin/users/${userId}`);
    alert(`Utilisateur: ${data.user.email}\nCodes: ${data.codes.length}\nBanni: ${data.user.is_banned ? 'Oui' : 'Non'}`);
  } catch (err) {
    alert('Erreur lors de la récupération des informations');
  }
}

async function banUser(userId) {
  if (!confirm('Voulez-vous vraiment bannir cet utilisateur ?')) return;

  try {
    await apiCall(`/api/admin/users/${userId}/ban`, { method: 'POST' });
    alert('Utilisateur banni');
    loadUsers();
  } catch (err) {
    alert('Erreur lors du bannissement');
  }
}

async function unbanUser(userId) {
  try {
    await apiCall(`/api/admin/users/${userId}/unban`, { method: 'POST' });
    alert('Utilisateur débanni');
    loadUsers();
  } catch (err) {
    alert('Erreur lors du débannissement');
  }
}

async function clearUserCells(userId) {
  if (!confirm('Voulez-vous vraiment effacer toutes les cases de cet utilisateur ? Cette action est irréversible.')) return;

  try {
    const data = await apiCall(`/api/admin/users/${userId}/clear-cells`, { method: 'POST' });
    alert(`${data.clearedCount} case(s) effacée(s)`);
    loadUsers();
    loadDashboard();
  } catch (err) {
    alert('Erreur lors de l\'effacement');
  }
}

// ===== CODES TAB =====
let codesPage = 1;
let codesFilter = 'all';

document.getElementById('codes-filter-btn').addEventListener('click', () => {
  codesFilter = document.getElementById('codes-filter').value;
  codesPage = 1;
  loadCodes();
});

document.getElementById('generate-codes-btn').addEventListener('click', async () => {
  const count = parseInt(document.getElementById('generate-count').value);

  if (!count || count < 1 || count > 10000) {
    alert('Nombre invalide (1-10000)');
    return;
  }

  if (!confirm(`Générer ${count} nouveaux codes ?`)) return;

  try {
    const btn = document.getElementById('generate-codes-btn');
    btn.disabled = true;
    btn.textContent = 'Génération...';

    const data = await apiCall('/api/admin/codes/generate', {
      method: 'POST',
      body: JSON.stringify({ count })
    });

    alert(`${data.generated} codes générés avec succès !`);
    loadCodes();
  } catch (err) {
    alert('Erreur lors de la génération');
  } finally {
    const btn = document.getElementById('generate-codes-btn');
    btn.disabled = false;
    btn.textContent = '➕ Générer codes';
  }
});

document.getElementById('export-codes-btn').addEventListener('click', async () => {
  const filter = document.getElementById('codes-filter').value;
  const url = `/api/admin/codes/export?filter=${filter}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `codes_${filter}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    alert('Erreur lors de l\'export');
  }
});

async function loadCodes() {
  const container = document.getElementById('codes-table-container');
  container.innerHTML = '<div class="loading">Chargement...</div>';

  try {
    const data = await apiCall(`/api/admin/codes?filter=${codesFilter}&page=${codesPage}&limit=100`);

    if (data.codes.length === 0) {
      container.innerHTML = '<div class="empty">Aucun code trouvé</div>';
      return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Code</th>
          <th>Utilisateur</th>
          <th>Position</th>
          <th>Couleur</th>
          <th>Date création</th>
        </tr>
      </thead>
      <tbody>
        ${data.codes.map(code => `
          <tr>
            <td><code>${code.code}</code></td>
            <td>${code.email || '<em>Non réclamé</em>'}</td>
            <td>${code.x !== null ? `${code.x}, ${code.y}` : '-'}</td>
            <td>${code.color ? `Couleur ${code.color}` : '-'}</td>
            <td>${new Date(code.created_at).toLocaleDateString('fr-FR')}</td>
          </tr>
        `).join('')}
      </tbody>
    `;

    container.innerHTML = '';
    container.appendChild(table);

    // Add pagination
    if (data.totalPages > 1) {
      const pagination = document.createElement('div');
      pagination.className = 'pagination';
      pagination.innerHTML = `
        <button ${codesPage === 1 ? 'disabled' : ''} onclick="codesPage--; loadCodes()">◀ Précédent</button>
        <span>Page ${codesPage} / ${data.totalPages}</span>
        <button ${codesPage === data.totalPages ? 'disabled' : ''} onclick="codesPage++; loadCodes()">Suivant ▶</button>
      `;
      container.appendChild(pagination);
    }
  } catch (err) {
    console.error('Codes load error:', err);
    container.innerHTML = '<div class="empty">Erreur de chargement</div>';
  }
}

// ===== GRID TAB =====
document.getElementById('view-cell-btn').addEventListener('click', async () => {
  const x = parseInt(document.getElementById('cell-x').value);
  const y = parseInt(document.getElementById('cell-y').value);

  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 200 || y >= 200) {
    alert('Coordonnées invalides (0-199)');
    return;
  }

  try {
    const data = await apiCall(`/api/admin/grid/cell/${x}/${y}`);
    const container = document.getElementById('cell-info-container');

    if (!data.cell) {
      container.innerHTML = '<div class="empty">Case vide (non peinte)</div>';
      return;
    }

    container.innerHTML = `
      <div class="section" style="margin-top: 20px;">
        <h3>Informations de la case (${x}, ${y})</h3>
        <p><strong>Code:</strong> ${data.cell.code}</p>
        <p><strong>Utilisateur:</strong> ${data.cell.email || '<em>Non assigné</em>'}</p>
        <p><strong>Couleur:</strong> <span class="color-preview" style="background: ${palette[data.cell.color - 1] || '#888'}"></span> Couleur ${data.cell.color}</p>
        <p><strong>Dernière modification:</strong> ${new Date(data.cell.updated_at).toLocaleString('fr-FR')}</p>
      </div>
    `;
  } catch (err) {
    alert('Erreur lors de la récupération des informations');
  }
});

document.getElementById('clear-cell-btn').addEventListener('click', async () => {
  const x = parseInt(document.getElementById('cell-x').value);
  const y = parseInt(document.getElementById('cell-y').value);

  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 200 || y >= 200) {
    alert('Coordonnées invalides (0-199)');
    return;
  }

  if (!confirm(`Voulez-vous vraiment effacer la case (${x}, ${y}) ?`)) return;

  try {
    await apiCall(`/api/admin/grid/cell/${x}/${y}/clear`, { method: 'POST' });
    alert('Case effacée');
    document.getElementById('cell-info-container').innerHTML = '';
  } catch (err) {
    alert('Erreur lors de l\'effacement');
  }
});

document.getElementById('reset-grid-btn').addEventListener('click', async () => {
  if (!confirm('⚠️ ATTENTION: Voulez-vous vraiment réinitialiser TOUTE la grille ? Cette action est IRRÉVERSIBLE et effacera TOUTES les cases peintes !')) return;
  if (!confirm('Êtes-vous VRAIMENT sûr ? Tapez OK dans la console pour confirmer.')) return;

  try {
    await apiCall('/api/admin/grid/reset', { method: 'POST' });
    alert('Grille réinitialisée');
    loadDashboard();
  } catch (err) {
    alert('Erreur lors de la réinitialisation');
  }
});

function loadGrid() {
  // Grid tab is loaded on demand when buttons are clicked
}

// ===== CONFIG TAB =====
async function loadConfig() {
  try {
    const data = await apiCall('/api/admin/config');
    palette = data.config.palette;

    const editor = document.getElementById('palette-editor');
    editor.innerHTML = '';

    palette.forEach((color, i) => {
      const div = document.createElement('div');
      div.className = 'color-input-group';
      div.innerHTML = `
        <label>Couleur ${i + 1}</label>
        <input type="color" value="${color}" data-index="${i}" class="color-picker">
        <input type="text" value="${color}" data-index="${i}" class="color-hex" maxlength="7">
      `;
      editor.appendChild(div);
    });

    // Add event listeners
    document.querySelectorAll('.color-picker').forEach(picker => {
      picker.addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        const hex = e.target.value;
        palette[index] = hex;
        document.querySelector(`.color-hex[data-index="${index}"]`).value = hex;
      });
    });

    document.querySelectorAll('.color-hex').forEach(input => {
      input.addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        let hex = e.target.value.toUpperCase();
        if (!/^#[0-9A-F]{6}$/i.test(hex)) return;
        palette[index] = hex;
        document.querySelector(`.color-picker[data-index="${index}"]`).value = hex;
      });
    });
  } catch (err) {
    console.error('Config load error:', err);
  }
}

document.getElementById('save-palette-btn').addEventListener('click', async () => {
  if (!confirm('Voulez-vous vraiment modifier la palette de couleurs ? Cela affectera toute la grille.')) return;

  try {
    const btn = document.getElementById('save-palette-btn');
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';

    await apiCall('/api/admin/config/palette', {
      method: 'POST',
      body: JSON.stringify({ palette })
    });

    alert('Palette enregistrée avec succès !');
  } catch (err) {
    alert('Erreur lors de l\'enregistrement');
  } finally {
    const btn = document.getElementById('save-palette-btn');
    btn.disabled = false;
    btn.textContent = '💾 Enregistrer la palette';
  }
});

// ===== INITIALIZATION =====
(async function init() {
  // Check if already logged in
  const isAuth = await checkAuth();

  if (isAuth) {
    // Load palette first
    try {
      const config = await fetch('/api/config');
      const data = await config.json();
      palette = data.palette;
    } catch (err) {
      console.error('Failed to load palette:', err);
    }

    showDashboard();
  } else {
    loginScreen.style.display = 'flex';
    dashboardScreen.style.display = 'none';
  }
})();
