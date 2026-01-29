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

let allCodes = [];

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
