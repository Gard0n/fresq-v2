// FRESQ V2 - Minimal Step-by-Step Interface

// ===== GLOBAL STATE =====
let gridW = 200;
let gridH = 200;
let palette = [];
let cells = new Map();
let cellTimestamps = new Map();

// User authentication
let currentUser = null; // {id, email}
let userCodes = []; // Array of {code, x, y, color}
let currentCode = null;
let myCell = null;

// UI state
let currentStep = 1; // 1, 2, or 3
let activeColor = 1;
let isObserverMode = false;
let magnifierActive = false;

// Theme state
let currentTheme = localStorage.getItem('fresq_theme') || 'dark';

// Canvas & rendering
const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');
const backgroundCanvas = document.getElementById('background-canvas');
const backgroundCtx = backgroundCanvas ? backgroundCanvas.getContext('2d') : null;
const CELL_SIZE = 3;

// Zoom & Pan
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };

// Animation
let newCells = new Map();

// WebSockets
let socket = null;
let isConnected = false;

// Setup flag
let isZoomPanSetup = false;

// ===== UTILITY FUNCTIONS =====
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Mobile utilities
function hapticFeedback(type = 'light') {
  if ('vibrate' in navigator) {
    const patterns = {
      light: 10,
      medium: 20,
      heavy: 50,
      success: [10, 50, 10],
      error: [50, 100, 50]
    };
    navigator.vibrate(patterns[type] || patterns.light);
  }
}

function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         (window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

function isTouch() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// Prevent double-tap zoom on specific elements
function preventDoubleTapZoom(element) {
  let lastTap = 0;
  element.addEventListener('touchend', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 500 && tapLength > 0) {
      e.preventDefault();
    }
    lastTap = currentTime;
  }, { passive: false });
}

// Theme management
function initTheme() {
  // Check system preference if no saved theme
  if (!localStorage.getItem('fresq_theme')) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    currentTheme = prefersDark ? 'dark' : 'light';
  }

  applyTheme(currentTheme);

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('fresq_theme')) {
      currentTheme = e.matches ? 'dark' : 'light';
      applyTheme(currentTheme);
    }
  });
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  // Update meta theme-color for mobile browsers
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme === 'light' ? '#f5f7fa' : '#0a0e1a');
  }

  // Update button icon
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.textContent = theme === 'light' ? '🌙' : '☀️';
    themeBtn.title = theme === 'light' ? 'Mode sombre' : 'Mode clair';
  }

  // Redraw canvas with new theme
  if (ctx) {
    draw();
  }
}

function toggleTheme() {
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  localStorage.setItem('fresq_theme', newTheme);
  hapticFeedback('light');
}

// ===== SCREENS =====
const step1Screen = document.getElementById('step1-screen');
const canvasScreen = document.getElementById('canvas-screen');
const toolsMenuBtn = document.getElementById('tools-menu-btn');
const toolsOverlay = document.getElementById('tools-overlay');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

// ===== STEP 1 ELEMENTS (Email Login) =====
const emailInputStep1 = document.getElementById('email-input-step1');
const submitEmailBtn = document.getElementById('submit-email-btn');
const step1Status = document.getElementById('step1-status');

// ===== STEP 2 ELEMENTS (Code Management) =====
const step2Controls = document.getElementById('step2-controls');
const myCodesSection = document.getElementById('my-codes-section');
const myCodesList = document.getElementById('my-codes-list');
const noCodesMsg = document.getElementById('no-codes-msg');
const newCodeInput = document.getElementById('new-code-input');
const addCodeBtn = document.getElementById('add-code-btn');
const addCodeStatus = document.getElementById('add-code-status');

// ===== STEP 3 ELEMENTS (Cell Selection + Color) =====
const step3Controls = document.getElementById('step3-controls');
const step3Palette = document.getElementById('step3-palette');
const confirmPaintBtn = document.getElementById('confirm-paint-btn');
const step3Info = document.getElementById('step3-info');

// ===== STATS DISPLAY (à côté du bouton tools) =====
const statsDisplay = document.getElementById('stats-display');
const statPaintedH24 = document.getElementById('stat-painted-h24');
const statPercentH24 = document.getElementById('stat-percent-h24');

// ===== TOOLS OVERLAY ELEMENTS =====
const statPainted = document.getElementById('stat-painted');
const statPercent = document.getElementById('stat-percent');
const navXOverlay = document.getElementById('nav-x-overlay');
const navYOverlay = document.getElementById('nav-y-overlay');
const navGoOverlay = document.getElementById('nav-go-overlay');
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas.getContext('2d');
const zoomInOverlay = document.getElementById('zoom-in-overlay');
const zoomOutOverlay = document.getElementById('zoom-out-overlay');
const zoomResetOverlay = document.getElementById('zoom-reset-overlay');
const magnifierToggleOverlay = document.getElementById('magnifier-toggle-overlay');
const observerToggleOverlay = document.getElementById('observer-toggle-overlay');
const exportPngOverlay = document.getElementById('export-png-overlay');
const logoutBtn = document.getElementById('logout-btn');
const closeToolsBtn = document.getElementById('close-tools-btn');

// ===== SHARED ELEMENTS =====
const zoomLevelEl = document.getElementById('zoom-level');
const coordsTooltip = document.getElementById('coords-tooltip');
const magnifier = document.getElementById('magnifier');
const magnifierCanvas = document.getElementById('magnifier-canvas');
const magnifierCtx = magnifierCanvas.getContext('2d');

// ===== INIT =====
async function init() {
  // Initialize theme first
  initTheme();

  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    gridW = config.grid_w;
    gridH = config.grid_h;
    palette = config.palette;

    await loadState();
    setupPalette();
    setupMinimap();
    connectWebSocket();

    // Redraw background when window resizes (debounced)
    window.addEventListener('resize', debounce(() => {
      if (currentStep === 1) {
        drawBackgroundFresque();
      }
    }, 150));

    // Check for existing session
    const savedUser = loadUserSession();
    if (savedUser) {
      // Try to restore session
      try {
        const res = await fetch('/api/user/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: savedUser.email })
        });
        const data = await res.json();
        if (data.ok) {
          currentUser = data.user;
          userCodes = data.codes;
          showStep(2);
          return;
        }
      } catch (err) {
        console.error('Session restore error:', err);
      }
    }

    // Show step 1 by default
    showStep(1);

    // Force redraw background after a short delay to ensure everything is loaded
    setTimeout(() => {
      if (currentStep === 1) {
        drawBackgroundFresque();
      }
    }, 100);
  } catch (err) {
    console.error('Init error:', err);
    showStep1Status('Erreur de chargement', 'error');
  }
}

// ===== USER SESSION MANAGEMENT =====
function saveUserSession() {
  if (currentUser) {
    localStorage.setItem('fresq_user_session', JSON.stringify(currentUser));
  }
}

function loadUserSession() {
  const stored = localStorage.getItem('fresq_user_session');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (err) {
      console.error('Error loading user session:', err);
      return null;
    }
  }
  return null;
}

function updateMyCodesList() {
  if (!userCodes || userCodes.length === 0) {
    myCodesList.innerHTML = '';
    noCodesMsg.style.display = 'block';
    return;
  }

  noCodesMsg.style.display = 'none';
  myCodesList.innerHTML = '';

  userCodes.forEach((codeData) => {
    const div = document.createElement('div');
    div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(42, 63, 95, 0.3); border-radius: 6px; border: 1px solid #2a3f5f;';

    const isPainted = codeData.x !== null && codeData.color !== null;
    const colorHex = isPainted ? palette[codeData.color - 1] : '#888';

    div.innerHTML = `
      <div style="display: flex; gap: 12px; align-items: center; flex: 1;">
        <div style="width: 20px; height: 20px; background: ${colorHex}; border-radius: 4px; border: 1px solid #444;"></div>
        <span style="font-size: 13px; color: #aaa;">${codeData.code}</span>
        ${isPainted ? `<span style="font-size: 12px; color: #666;">(${codeData.x}, ${codeData.y})</span>` : '<span style="font-size: 12px; color: #666;">Non assigné</span>'}
      </div>
      <button class="repaint-btn" data-code="${codeData.code}" style="padding: 6px 16px; font-size: 12px; background: linear-gradient(135deg, #2a4 0%, #1a3 100%); border: 1px solid #3b5; color: #fff; border-radius: 4px; cursor: pointer;">
        ${isPainted ? '🎨 Repeindre' : '➕ Peindre'}
      </button>
    `;

    myCodesList.appendChild(div);
  });

  // Add event listeners to repaint buttons
  document.querySelectorAll('.repaint-btn').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;
      startPaintingWithCode(code);
    };
  });
}

// ===== STEP NAVIGATION =====
function showStep(step) {
  currentStep = step;

  // Hide all screens
  step1Screen.classList.add('hidden');
  canvasScreen.classList.add('hidden');
  step2Controls.classList.add('hidden');
  step3Controls.classList.add('hidden');
  toolsMenuBtn.classList.add('hidden');
  statsDisplay.classList.add('hidden');

  if (step === 1) {
    // Step 1: Email login
    step1Screen.classList.remove('hidden');
    drawBackgroundFresque();
  } else if (step === 2) {
    // Step 2: Code management + grid view
    canvasScreen.classList.remove('hidden');
    step2Controls.classList.remove('hidden');
    toolsMenuBtn.classList.remove('hidden');
    statsDisplay.classList.remove('hidden');
    updateMyCodesList();
    // Setup canvas only if not already done
    if (!isZoomPanSetup) {
      setupCanvas();
    } else {
      resizeCanvas();
    }
    draw();
  } else if (step === 3) {
    // Step 3: Cell selection + color palette
    canvasScreen.classList.remove('hidden');
    step3Controls.classList.remove('hidden');
    toolsMenuBtn.classList.remove('hidden');
    statsDisplay.classList.remove('hidden');
    // Setup canvas if not already done
    if (!isZoomPanSetup) {
      setupCanvas();
    } else {
      resizeCanvas();
    }
    updateConfirmButton();
    draw();
  }
}

// Draw fresque in background of step 1
function drawBackgroundFresque() {
  if (!backgroundCanvas || !backgroundCtx) return;

  // Set canvas to full window size
  backgroundCanvas.width = window.innerWidth;
  backgroundCanvas.height = window.innerHeight;

  const canvasWidth = backgroundCanvas.width;
  const canvasHeight = backgroundCanvas.height;

  // Calculate scale to fit grid
  const scaleX = canvasWidth / (gridW * CELL_SIZE);
  const scaleY = canvasHeight / (gridH * CELL_SIZE);
  const scale = Math.min(scaleX, scaleY);

  // Center the grid
  const gridPixelWidth = gridW * CELL_SIZE * scale;
  const gridPixelHeight = gridH * CELL_SIZE * scale;
  const offsetX = (canvasWidth - gridPixelWidth) / 2;
  const offsetY = (canvasHeight - gridPixelHeight) / 2;

  // Clear background
  backgroundCtx.fillStyle = '#0a0e1a';
  backgroundCtx.fillRect(0, 0, canvasWidth, canvasHeight);

  backgroundCtx.save();
  backgroundCtx.translate(offsetX, offsetY);
  backgroundCtx.scale(scale, scale);

  // Draw all cells (gray for empty, colored for painted)
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const key = `${x},${y}`;
      const color = cells.get(key);

      if (color) {
        // Painted cell
        backgroundCtx.fillStyle = palette[color - 1];
      } else {
        // Empty cell - gray
        backgroundCtx.fillStyle = '#1a1a1a';
      }

      backgroundCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  backgroundCtx.restore();
}

function showStep1Status(msg, type = 'info') {
  step1Status.textContent = msg;
  step1Status.className = 'status-msg';
  if (type === 'error') step1Status.classList.add('error');
  if (type === 'success') step1Status.classList.add('success');
}

// ===== STEP 1: EMAIL LOGIN =====
submitEmailBtn.onclick = async () => {
  const email = emailInputStep1.value.trim().toLowerCase();
  if (!email) return;

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showStep1Status('Email invalide', 'error');
    return;
  }

  try {
    showStep1Status('Connexion...', 'info');

    const res = await fetch('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (!data.ok) {
      showStep1Status('Erreur de connexion', 'error');
      return;
    }

    currentUser = data.user;
    userCodes = data.codes;
    saveUserSession();

    showStep1Status('Connexion réussie !', 'success');
    setTimeout(() => showStep(2), 500);
  } catch (err) {
    showStep1Status('Erreur de connexion', 'error');
    console.error(err);
  }
};

// Enter key to submit email
emailInputStep1.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') submitEmailBtn.click();
});

// ===== STEP 2: CODE MANAGEMENT =====
function showAddCodeStatus(msg, type = 'info') {
  addCodeStatus.textContent = msg;
  addCodeStatus.style.color = type === 'error' ? '#ff6b6b' : type === 'success' ? '#6FE6FF' : '#888';
}

// Add new code button
addCodeBtn.onclick = async () => {
  const code = newCodeInput.value.trim().toUpperCase();
  if (!code) return;

  if (!currentUser) {
    showAddCodeStatus('Erreur: utilisateur non connecté', 'error');
    return;
  }

  try {
    showAddCodeStatus('Validation...', 'info');

    const res = await fetch('/api/user/claim-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, code })
    });
    const data = await res.json();

    if (!data.ok) {
      if (data.error === 'invalid_code') {
        showAddCodeStatus('Code invalide', 'error');
      } else if (data.error === 'code_already_owned') {
        showAddCodeStatus('Code déjà utilisé par un autre utilisateur', 'error');
      } else if (data.error === 'too_many_requests') {
        showAddCodeStatus('Trop de requêtes, attendez un instant', 'error');
      } else {
        showAddCodeStatus('Erreur', 'error');
      }
      return;
    }

    // Add code to user's codes list
    userCodes.push({
      code: data.code,
      x: data.assigned?.x || null,
      y: data.assigned?.y || null,
      color: data.assigned?.color || null
    });

    updateMyCodesList();
    newCodeInput.value = '';
    showAddCodeStatus('Code ajouté !', 'success');

    // If code is already assigned, ask to repaint, otherwise start painting
    if (data.assigned) {
      showAddCodeStatus(`Code ajouté ! Case (${data.assigned.x}, ${data.assigned.y})`, 'success');
    } else {
      showAddCodeStatus('Code ajouté ! Clique sur "Peindre" pour choisir une case', 'success');
    }
  } catch (err) {
    showAddCodeStatus('Erreur', 'error');
    console.error(err);
  }
};

// Enter key to add code
newCodeInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addCodeBtn.click();
});

// Function to start painting with a specific code
function startPaintingWithCode(code) {
  const codeData = userCodes.find(c => c.code === code);
  if (!codeData) return;

  currentCode = code;

  if (codeData.x !== null) {
    // Code has a cell assigned
    myCell = { x: codeData.x, y: codeData.y };
  } else {
    // Code doesn't have a cell yet
    myCell = null;
  }

  // Go to step 3
  showStep(3);
}

// ===== STEP 3: CELL SELECTION + COLOR =====
function setupPalette() {
  step3Palette.innerHTML = '';
  palette.forEach((color, i) => {
    const div = document.createElement('div');
    div.className = 'color';
    div.style.background = color;
    if (i === 0) div.classList.add('active');
    div.onclick = () => {
      document.querySelectorAll('#step3-palette .color').forEach(d => d.classList.remove('active'));
      div.classList.add('active');
      activeColor = i + 1;
      updateConfirmButton();
    };
    step3Palette.appendChild(div);
  });
}

function updateConfirmButton() {
  confirmPaintBtn.disabled = !myCell || !activeColor;
}

function showStep3Info(msg, type = 'info') {
  step3Info.textContent = msg;
  step3Info.style.color = type === 'error' ? '#ff6b6b' : type === 'success' ? '#6FE6FF' : '#888';
}

confirmPaintBtn.onclick = async () => {
  if (!currentCode || !myCell || !activeColor) return;

  hapticFeedback('medium');

  try {
    showStep3Info('Peinture en cours...', 'info');

    const res = await fetch('/api/cell/paint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: currentCode, color: activeColor })
    });
    const data = await res.json();

    if (!data.ok) {
      hapticFeedback('error');
      showStep3Info('Erreur de peinture', 'error');
      return;
    }

    const key = `${data.x},${data.y}`;
    cells.set(key, data.color);
    cellTimestamps.set(key, Date.now());
    newCells.set(key, Date.now());

    // Update user codes list
    const codeIndex = userCodes.findIndex(c => c.code === currentCode);
    if (codeIndex !== -1) {
      userCodes[codeIndex].x = data.x;
      userCodes[codeIndex].y = data.y;
      userCodes[codeIndex].color = data.color;
    }

    updateCellsCount();
    draw();

    hapticFeedback('success');
    showStep3Info('Case peinte !', 'success');

    // Go back to step 2 after short delay
    setTimeout(() => {
      currentCode = null;
      myCell = null;
      activeColor = 1;
      showStep(2);
    }, 1000);
  } catch (err) {
    showStep3Info('Erreur de peinture', 'error');
    console.error(err);
  }
};

// Canvas click handler for step 3 (cell selection)
canvas.onclick = async (e) => {
  if (currentStep !== 3 || isPanning || isObserverMode) return;

  if (!currentCode) {
    showStep3Info('Erreur: pas de code', 'error');
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const { x, y } = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);

  if (x < 0 || y < 0 || x >= gridW || y >= gridH) return;

  // If already have a cell, can repaint the same cell or show message
  if (myCell) {
    if (myCell.x === x && myCell.y === y) {
      hapticFeedback('light');
      showStep3Info(`Case (${x}, ${y}) sélectionnée - Choisis ta couleur`, 'success');
      return;
    } else {
      hapticFeedback('light');
      showStep3Info(`Ce code possède déjà la case (${myCell.x}, ${myCell.y})`, 'info');
      return;
    }
  }

  // Claim new cell
  try {
    const res = await fetch('/api/cell/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: currentCode, x, y })
    });
    const data = await res.json();

    if (!data.ok) {
      showStep3Info(data.error === 'cell_taken' ? 'Case déjà prise' : 'Erreur', 'error');
      return;
    }

    myCell = { x, y };
    showStep3Info(`Case (${x}, ${y}) sélectionnée - Choisis ta couleur`, 'success');
    updateConfirmButton();

    // Center on claimed cell
    offsetX = canvas.width / 2 - (myCell.x * CELL_SIZE + CELL_SIZE / 2) * scale;
    offsetY = canvas.height / 2 - (myCell.y * CELL_SIZE + CELL_SIZE / 2) * scale;
    draw();
  } catch (err) {
    showStep3Info('Erreur de sélection', 'error');
    console.error(err);
  }
};

// ===== CANVAS SETUP =====
function setupCanvas() {
  resizeCanvas();
  window.removeEventListener('resize', resizeCanvas);
  window.addEventListener('resize', resizeCanvas);
  setupZoomPan();
}

function resizeCanvas() {
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();

  canvas.width = rect.width - 4;
  canvas.height = rect.height - 4;

  offsetX = (canvas.width - gridW * CELL_SIZE) / 2;
  offsetY = (canvas.height - gridH * CELL_SIZE) / 2;

  draw();
}

function setupZoomPan() {
  // Only setup once to avoid duplicates
  if (isZoomPanSetup) return;
  isZoomPanSetup = true;

  // Touch support
  let touchStartDist = 0;
  let touchStartScale = 1;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isPanning = true;
      const touch = e.touches[0];
      panStart = { x: touch.clientX - offsetX, y: touch.clientY - offsetY };
      e.preventDefault();
    } else if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      touchStartDist = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      touchStartScale = scale;
      e.preventDefault();
    }
  });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && isPanning) {
      const touch = e.touches[0];
      offsetX = touch.clientX - panStart.x;
      offsetY = touch.clientY - panStart.y;
      draw();
      e.preventDefault();
    } else if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDist = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      const newScale = Math.max(0.5, Math.min(10, touchStartScale * (currentDist / touchStartDist)));

      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      const rect = canvas.getBoundingClientRect();
      const worldX = (centerX - rect.left - offsetX) / scale;
      const worldY = (centerY - rect.top - offsetY) / scale;

      offsetX = centerX - rect.left - worldX * newScale;
      offsetY = centerY - rect.top - worldY * newScale;
      scale = newScale;

      updateZoomIndicator();
      draw();
      e.preventDefault();
    }
  });

  canvas.addEventListener('touchend', () => {
    isPanning = false;
  });

  // Mouse wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (mouseX - offsetX) / scale;
    const worldY = (mouseY - offsetY) / scale;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.5, Math.min(10, scale * delta));

    offsetX = mouseX - worldX * newScale;
    offsetY = mouseY - worldY * newScale;
    scale = newScale;

    updateZoomIndicator();
    draw();
  });

  // Mouse drag pan
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      isPanning = true;
      panStart = { x: e.clientX - offsetX, y: e.clientY - offsetY };
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isPanning) {
      offsetX = e.clientX - panStart.x;
      offsetY = e.clientY - panStart.y;
      draw();
    }

    // Tooltip
    const rect = canvas.getBoundingClientRect();
    const { x, y } = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);

    if (x >= 0 && y >= 0 && x < gridW && y < gridH) {
      const key = `${x},${y}`;
      const hasPaint = cells.has(key);
      const timestamp = cellTimestamps.get(key);

      let tooltipHTML = `x: ${x}, y: ${y}`;

      if (hasPaint && timestamp) {
        const minutesAgo = Math.floor((Date.now() - timestamp) / 60000);
        const timeStr = minutesAgo < 1 ? 'à l\'instant' :
                        minutesAgo === 1 ? 'il y a 1 min' :
                        minutesAgo < 60 ? `il y a ${minutesAgo} min` :
                        `il y a ${Math.floor(minutesAgo / 60)}h`;
        tooltipHTML += `<div class="time">Peint ${timeStr}</div>`;
      }

      coordsTooltip.innerHTML = tooltipHTML;
      coordsTooltip.classList.add('visible');

      if (magnifierActive) {
        updateMagnifier(e.clientX, e.clientY, x, y);
      }
    } else {
      coordsTooltip.classList.remove('visible');
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = 'crosshair';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = 'crosshair';
    }
    coordsTooltip.classList.remove('visible');
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ===== RENDERING =====
async function loadState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();

    cells.clear();
    cellTimestamps.clear();
    const now = Date.now();

    data.cells.forEach(cell => {
      const key = `${cell.x},${cell.y}`;
      cells.set(key, cell.color);
      cellTimestamps.set(key, now);
    });

    updateCellsCount();
  } catch (err) {
    console.error('Load state error:', err);
  }
}

function draw() {
  if (!ctx) return;

  // Get theme-aware colors from CSS variables
  const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
  const emptyCellColor = currentTheme === 'light' ? '#e8ecf1' : '#1a1a1a';
  const gridLineColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-line').trim();

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Background grid with gray for empty cells (steps 2 and 3)
  if (currentStep === 2 || currentStep === 3) {
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const key = `${x},${y}`;
        if (!cells.has(key)) {
          ctx.fillStyle = emptyCellColor;
          ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }
  }

  // Grid lines
  if (scale > 0.8) {
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.5 / scale;
    for (let x = 0; x <= gridW; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL_SIZE, 0);
      ctx.lineTo(x * CELL_SIZE, gridH * CELL_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y <= gridH; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL_SIZE);
      ctx.lineTo(gridW * CELL_SIZE, y * CELL_SIZE);
      ctx.stroke();
    }
  }

  // Painted cells
  const now = Date.now();
  cells.forEach((color, key) => {
    const [x, y] = key.split(',').map(Number);
    ctx.fillStyle = palette[color - 1];
    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

    // Animate new cells
    const newCellTime = newCells.get(key);
    if (newCellTime) {
      const age = now - newCellTime;
      if (age < 1000) {
        const pulse = Math.sin((age / 1000) * Math.PI * 4) * 0.3 + 0.7;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.restore();
        requestAnimationFrame(() => draw());
      } else {
        newCells.delete(key);
      }
    }
  });

  // Highlight my cell
  if (myCell) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(
      myCell.x * CELL_SIZE,
      myCell.y * CELL_SIZE,
      CELL_SIZE,
      CELL_SIZE
    );
  }

  ctx.restore();

  drawMinimap();
}

function screenToGrid(screenX, screenY) {
  const worldX = (screenX - offsetX) / scale;
  const worldY = (screenY - offsetY) / scale;
  const gridX = Math.floor(worldX / CELL_SIZE);
  const gridY = Math.floor(worldY / CELL_SIZE);
  return { x: gridX, y: gridY };
}

function updateZoomIndicator() {
  zoomLevelEl.textContent = Math.round(scale * 100) + '%';
}

function updateCellsCount() {
  const total = gridW * gridH;
  const painted = cells.size;
  const percent = ((painted / total) * 100).toFixed(1);

  // Update stats in overlay
  statPainted.textContent = painted.toLocaleString('fr-FR');
  statPercent.textContent = `${percent}%`;

  // Update stats H24
  statPaintedH24.textContent = painted.toLocaleString('fr-FR');
  statPercentH24.textContent = `${percent}%`;
}

// ===== MINIMAP =====
function setupMinimap() {
  minimapCanvas.width = 200;
  minimapCanvas.height = 200;

  minimapCanvas.addEventListener('click', (e) => {
    const rect = minimapCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const targetX = x * gridW * CELL_SIZE;
    const targetY = y * gridH * CELL_SIZE;

    offsetX = canvas.width / 2 - targetX * scale;
    offsetY = canvas.height / 2 - targetY * scale;

    draw();
  });
}

function drawMinimap() {
  if (!minimapCtx) return;

  const minimapScale = Math.min(
    minimapCanvas.width / (gridW * CELL_SIZE),
    minimapCanvas.height / (gridH * CELL_SIZE)
  );

  minimapCtx.fillStyle = '#000';
  minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

  cells.forEach((color, key) => {
    const [x, y] = key.split(',').map(Number);
    minimapCtx.fillStyle = palette[color - 1];
    minimapCtx.fillRect(
      x * CELL_SIZE * minimapScale,
      y * CELL_SIZE * minimapScale,
      CELL_SIZE * minimapScale,
      CELL_SIZE * minimapScale
    );
  });

  // Viewport rectangle
  const viewportX = -offsetX / scale * minimapScale;
  const viewportY = -offsetY / scale * minimapScale;
  const viewportW = (canvas.width / scale) * minimapScale;
  const viewportH = (canvas.height / scale) * minimapScale;

  minimapCtx.strokeStyle = '#6FE6FF';
  minimapCtx.lineWidth = 2;
  minimapCtx.strokeRect(viewportX, viewportY, viewportW, viewportH);
}

// ===== MAGNIFIER =====
function updateMagnifier(mouseX, mouseY, gridX, gridY) {
  const magnifierSize = 150;

  magnifier.style.left = (mouseX + 20) + 'px';
  magnifier.style.top = (mouseY + 20) + 'px';

  magnifierCanvas.width = magnifierSize;
  magnifierCanvas.height = magnifierSize;

  magnifierCtx.fillStyle = '#0a0e1a';
  magnifierCtx.fillRect(0, 0, magnifierSize, magnifierSize);

  const radius = 3;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = gridX + dx;
      const cy = gridY + dy;

      if (cx >= 0 && cx < gridW && cy >= 0 && cy < gridH) {
        const key = `${cx},${cy}`;
        const color = cells.get(key);

        const cellSize = magnifierSize / (radius * 2 + 1);
        const px = (dx + radius) * cellSize;
        const py = (dy + radius) * cellSize;

        if (color) {
          magnifierCtx.fillStyle = palette[color - 1];
        } else {
          magnifierCtx.fillStyle = '#1a1a1a';
        }

        magnifierCtx.fillRect(px, py, cellSize, cellSize);

        magnifierCtx.strokeStyle = '#444';
        magnifierCtx.lineWidth = 1;
        magnifierCtx.strokeRect(px, py, cellSize, cellSize);

        if (dx === 0 && dy === 0) {
          magnifierCtx.strokeStyle = '#6FE6FF';
          magnifierCtx.lineWidth = 2;
          magnifierCtx.strokeRect(px, py, cellSize, cellSize);
        }
      }
    }
  }
}

// ===== TOOLS OVERLAY =====
toolsMenuBtn.onclick = () => {
  toolsOverlay.classList.add('visible');
};

closeToolsBtn.onclick = () => {
  toolsOverlay.classList.remove('visible');
};

toolsOverlay.onclick = (e) => {
  if (e.target === toolsOverlay) {
    toolsOverlay.classList.remove('visible');
  }
};

// Theme toggle
themeToggleBtn.onclick = () => {
  toggleTheme();
};

// Navigation
navGoOverlay.onclick = () => {
  const x = parseInt(navXOverlay.value);
  const y = parseInt(navYOverlay.value);

  if (isNaN(x) || isNaN(y) || x < 0 || x >= gridW || y < 0 || y >= gridH) {
    return;
  }

  offsetX = canvas.width / 2 - (x * CELL_SIZE + CELL_SIZE / 2) * scale;
  offsetY = canvas.height / 2 - (y * CELL_SIZE + CELL_SIZE / 2) * scale;
  draw();
  toolsOverlay.classList.remove('visible');
};

// Zoom
zoomInOverlay.onclick = () => {
  scale = Math.min(10, scale * 1.2);
  updateZoomIndicator();
  draw();
};

zoomOutOverlay.onclick = () => {
  scale = Math.max(0.5, scale / 1.2);
  updateZoomIndicator();
  draw();
};

zoomResetOverlay.onclick = () => {
  scale = 1;
  offsetX = (canvas.width - gridW * CELL_SIZE) / 2;
  offsetY = (canvas.height - gridH * CELL_SIZE) / 2;
  updateZoomIndicator();
  draw();
};

// Magnifier
magnifierToggleOverlay.onclick = () => {
  magnifierActive = !magnifierActive;
  if (magnifierActive) {
    magnifier.style.display = 'block';
    magnifierToggleOverlay.textContent = '🔍 Désactiver la loupe';
  } else {
    magnifier.style.display = 'none';
    magnifierToggleOverlay.textContent = '🔍 Activer la loupe';
  }
};

// Observer mode
observerToggleOverlay.onclick = () => {
  isObserverMode = !isObserverMode;
  if (isObserverMode) {
    observerToggleOverlay.textContent = '👁️ Quitter Observateur';
  } else {
    observerToggleOverlay.textContent = '👁️ Mode Observateur';
  }
};

// Export
exportPngOverlay.onclick = () => {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = gridW * CELL_SIZE;
  exportCanvas.height = gridH * CELL_SIZE;
  const exportCtx = exportCanvas.getContext('2d');

  exportCtx.fillStyle = '#000';
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  cells.forEach((color, key) => {
    const [x, y] = key.split(',').map(Number);
    exportCtx.fillStyle = palette[color - 1];
    exportCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  });

  exportCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fresq_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  });

  toolsOverlay.classList.remove('visible');
};

// Logout
logoutBtn.onclick = () => {
  if (confirm('Voulez-vous vraiment vous déconnecter ?')) {
    localStorage.removeItem('fresq_user_session');
    currentUser = null;
    userCodes = [];
    currentCode = null;
    myCell = null;
    activeColor = 1;
    isZoomPanSetup = false;
    emailInputStep1.value = '';
    showStep(1);
    toolsOverlay.classList.remove('visible');
  }
};

// ===== WEBSOCKETS =====
function connectWebSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('🔌 WebSocket connected');
    isConnected = true;
  });

  socket.on('disconnect', () => {
    console.log('🔌 WebSocket disconnected');
    isConnected = false;
  });

  socket.on('cell:painted', (data) => {
    const key = `${data.x},${data.y}`;
    const now = Date.now();
    cells.set(key, data.color);
    cellTimestamps.set(key, now);
    newCells.set(key, now);
    draw();
    updateCellsCount();
    // Update background if on step 1
    if (currentStep === 1) {
      drawBackgroundFresque();
    }
  });

  socket.on('cell:deleted', (data) => {
    const key = `${data.x},${data.y}`;
    cells.delete(key);
    cellTimestamps.delete(key);
    draw();
    updateCellsCount();
    // Update background if on step 1
    if (currentStep === 1) {
      drawBackgroundFresque();
    }
  });
}

// ===== BEFOREUNLOAD WARNING =====
window.addEventListener('beforeunload', (e) => {
  // Warn if user is in step 3 with a cell selected
  if (currentStep === 3 && myCell) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  // Ignore if typing in input field
  if (e.target.tagName === 'INPUT') return;

  // Step 3: Color selection shortcuts (1-0)
  if (currentStep === 3 && !e.ctrlKey && !e.metaKey) {
    // Number keys 1-9, 0
    if (e.key >= '1' && e.key <= '9') {
      const colorIndex = parseInt(e.key) - 1;
      if (colorIndex < palette.length) {
        activeColor = colorIndex + 1;
        document.querySelectorAll('#step3-palette .color').forEach((d, i) => {
          d.classList.toggle('active', i === colorIndex);
        });
        updateConfirmButton();
      }
    } else if (e.key === '0' && palette.length >= 10) {
      activeColor = 10;
      document.querySelectorAll('#step3-palette .color').forEach((d, i) => {
        d.classList.toggle('active', i === 9);
      });
      updateConfirmButton();
    }

    // Enter to confirm
    if (e.key === 'Enter' && !confirmPaintBtn.disabled) {
      confirmPaintBtn.click();
    }

    // Escape to cancel and go back to step 2
    if (e.key === 'Escape') {
      currentCode = null;
      myCell = null;
      activeColor = 1;
      showStep(2);
    }
  }

  // Step 2: Escape to go back to step 1 (logout)
  if (currentStep === 2 && e.key === 'Escape') {
    if (confirm('Retourner à la page de connexion ?')) {
      showStep(1);
    }
  }
});

// ===== MOBILE INITIALIZATION =====
if (isMobile()) {
  console.log('📱 Mobile device detected');

  // Prevent double-tap zoom on canvas
  preventDoubleTapZoom(canvas);

  // Prevent double-tap zoom on buttons
  document.querySelectorAll('button').forEach(btn => preventDoubleTapZoom(btn));

  // Optimize for mobile
  if (isTouch()) {
    document.body.classList.add('touch-device');
  }

  // Handle orientation changes
  window.addEventListener('orientationchange', debounce(() => {
    resizeCanvas();
    hapticFeedback('light');
  }, 200));

  // Warn about landscape for better experience
  if (window.innerHeight > window.innerWidth) {
    setTimeout(() => {
      if (currentStep === 2 || currentStep === 3) {
        console.log('💡 Tip: Rotate to landscape for better experience');
      }
    }, 3000);
  }
}

// Add light haptic feedback to all buttons
document.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => hapticFeedback('light'), { passive: true });
});

// ===== START =====
init();
