// FRESQ V2 - Admin Panel

let token = localStorage.getItem('admin_token');

const loginForm = document.getElementById('login-form');
const adminPanel = document.getElementById('admin-panel');
const loginBtn = document.getElementById('login-btn');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginStatus = document.getElementById('login-status');

const generateBtn = document.getElementById('generate-btn');
const countInput = document.getElementById('count');
const generateStatus = document.getElementById('generate-status');
const refreshBtn = document.getElementById('refresh-btn');
const downloadBtn = document.getElementById('download-btn');
const codesList = document.getElementById('codes-list');
const totalCodesEl = document.getElementById('total-codes');
const assignedCodesEl = document.getElementById('assigned-codes');
const loadCellsBtn = document.getElementById('load-cells-btn');
const cellsGrid = document.getElementById('cells-grid');
const filterXInput = document.getElementById('filter-x');
const filterYInput = document.getElementById('filter-y');
const filterBtn = document.getElementById('filter-btn');
const clearFilterBtn = document.getElementById('clear-filter-btn');

let allCodes = [];
let allCells = [];
let filteredCells = [];

// Check if already logged in
if (token) {
  checkAuth();
}

loginBtn.onclick = async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!data.ok) {
      loginStatus.textContent = 'Login failed';
      return;
    }

    token = data.token;
    localStorage.setItem('admin_token', token);
    showAdmin();
  } catch (err) {
    loginStatus.textContent = 'Error: ' + err.message;
  }
};

async function checkAuth() {
  try {
    const res = await fetch('/api/admin/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      showAdmin();
    } else {
      token = null;
      localStorage.removeItem('admin_token');
    }
  } catch (err) {
    console.error(err);
  }
}

function showAdmin() {
  loginForm.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  loadCodes();
  loadStats();
}

generateBtn.onclick = async () => {
  const count = parseInt(countInput.value);

  try {
    const res = await fetch('/api/admin/codes/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ count })
    });

    const data = await res.json();

    if (!data.ok) {
      generateStatus.textContent = 'Error generating codes';
      return;
    }

    generateStatus.textContent = `${data.generated} codes générés`;
    loadCodes();
    loadStats();
  } catch (err) {
    generateStatus.textContent = 'Error: ' + err.message;
  }
};

refreshBtn.onclick = () => {
  loadCodes();
  loadStats();
};

downloadBtn.onclick = () => {
  const text = allCodes.map(c => c.code).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fresq_codes_${Date.now()}.txt`;
  a.click();
};

async function loadCodes() {
  try {
    const res = await fetch('/api/admin/codes?limit=100', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    allCodes = data.codes;

    codesList.innerHTML = allCodes
      .map(c => `<div class="code-item">${c.code}${c.x !== null ? ` - (${c.x}, ${c.y}) - Couleur ${c.color}` : ' - Non assigné'}</div>`)
      .join('');
  } catch (err) {
    console.error(err);
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    totalCodesEl.textContent = data.counts.total_codes;
    assignedCodesEl.textContent = data.counts.assigned_codes;
  } catch (err) {
    console.error(err);
  }
}

// ===== MODERATION =====
loadCellsBtn.onclick = async () => {
  try {
    const res = await fetch('/api/admin/cells?limit=1000', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    allCells = data.cells;
    filteredCells = allCells;
    renderCells(filteredCells);
  } catch (err) {
    console.error(err);
    cellsGrid.innerHTML = '<p style="color: #f44;">Erreur de chargement</p>';
  }
};

filterBtn.onclick = () => {
  const x = filterXInput.value.trim();
  const y = filterYInput.value.trim();

  if (x === '' && y === '') {
    filteredCells = allCells;
  } else {
    filteredCells = allCells.filter(cell => {
      if (x !== '' && cell.x !== parseInt(x)) return false;
      if (y !== '' && cell.y !== parseInt(y)) return false;
      return true;
    });
  }

  renderCells(filteredCells);
};

clearFilterBtn.onclick = () => {
  filterXInput.value = '';
  filterYInput.value = '';
  filteredCells = allCells;
  renderCells(filteredCells);
};

function renderCells(cells) {
  if (cells.length === 0) {
    cellsGrid.innerHTML = '<p style="color: #888;">Aucune cellule trouvée</p>';
    return;
  }

  cellsGrid.innerHTML = cells
    .map(cell => `
      <div style="display: flex; align-items: center; padding: 8px; border-bottom: 1px solid #333; gap: 10px;">
        <span style="font-family: monospace; flex: 1;">
          (${cell.x}, ${cell.y}) - Couleur ${cell.color || 'N/A'}
        </span>
        <span style="color: #888; font-size: 11px;">
          ${new Date(cell.updated_at).toLocaleString('fr-FR')}
        </span>
        <button onclick="resetCellColor(${cell.x}, ${cell.y})" style="padding: 4px 8px; font-size: 11px; background: #f80; margin: 0;">
          Reset Couleur
        </button>
        <button onclick="deleteCell(${cell.x}, ${cell.y})" style="padding: 4px 8px; font-size: 11px; background: #f44; margin: 0;">
          Supprimer
        </button>
      </div>
    `)
    .join('');
}

async function deleteCell(x, y) {
  if (!confirm(`Supprimer la cellule (${x}, ${y}) ? Le code sera libéré.`)) {
    return;
  }

  try {
    const res = await fetch('/api/admin/cell/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ x, y })
    });

    const data = await res.json();

    if (data.ok) {
      alert(`Cellule supprimée. Code ${data.code} libéré.`);
      loadCellsBtn.click(); // Reload
      loadStats();
    } else {
      alert('Erreur: ' + data.error);
    }
  } catch (err) {
    alert('Erreur: ' + err.message);
  }
}

async function resetCellColor(x, y) {
  if (!confirm(`Réinitialiser la couleur de la cellule (${x}, ${y}) ?`)) {
    return;
  }

  try {
    const res = await fetch('/api/admin/cell/reset-color', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ x, y })
    });

    const data = await res.json();

    if (data.ok) {
      alert('Couleur réinitialisée');
      loadCellsBtn.click(); // Reload
    } else {
      alert('Erreur: ' + data.error);
    }
  } catch (err) {
    alert('Erreur: ' + err.message);
  }
}

// Make functions global for onclick handlers
window.deleteCell = deleteCell;
window.resetCellColor = resetCellColor;

// ===== EXPORTS =====
const exportCodesCSV = document.getElementById('export-codes-csv');
const exportCodesJSON = document.getElementById('export-codes-json');
const exportCellsCSV = document.getElementById('export-cells-csv');
const exportCellsJSON = document.getElementById('export-cells-json');
const exportFullJSON = document.getElementById('export-full-json');

exportCodesCSV.onclick = () => {
  window.open(`/api/admin/export/codes?format=csv&token=${token}`, '_blank');
};

exportCodesJSON.onclick = async () => {
  try {
    const res = await fetch('/api/admin/export/codes?format=json', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    downloadJSON(data, `fresq_codes_${Date.now()}.json`);
  } catch (err) {
    alert('Erreur: ' + err.message);
  }
};

exportCellsCSV.onclick = () => {
  window.open(`/api/admin/export/cells?format=csv&token=${token}`, '_blank');
};

exportCellsJSON.onclick = async () => {
  try {
    const res = await fetch('/api/admin/export/cells?format=json', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    downloadJSON(data, `fresq_cells_${Date.now()}.json`);
  } catch (err) {
    alert('Erreur: ' + err.message);
  }
};

exportFullJSON.onclick = async () => {
  try {
    const res = await fetch('/api/admin/export/full', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    downloadJSON(data, `fresq_full_backup_${Date.now()}.json`);
  } catch (err) {
    alert('Erreur: ' + err.message);
  }
};

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
