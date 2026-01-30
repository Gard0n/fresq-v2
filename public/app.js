// FRESQ V2 - Minimal Step-by-Step Interface

// ===== GLOBAL STATE =====
let gridW = 200;
let gridH = 200;
let palette = [];
let cells = new Map();
let cellTimestamps = new Map();

// Multi-code support
let userCodes = new Map(); // Map<code, {x, y, color}>
let currentCode = null;
let myCell = null;

// UI state
let currentStep = 1; // 1, 2, or 3
let activeColor = 1;
let isObserverMode = false;
let magnifierActive = false;

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

// ===== SCREENS =====
const step1Screen = document.getElementById('step1-screen');
const canvasScreen = document.getElementById('canvas-screen');
const toolsMenuBtn = document.getElementById('tools-menu-btn');
const toolsOverlay = document.getElementById('tools-overlay');

// ===== STEP 1 ELEMENTS =====
const codeInputStep1 = document.getElementById('code-input-step1');
const submitCodeBtn = document.getElementById('submit-code-btn');
const step1Status = document.getElementById('step1-status');
const myCellsPanel = document.getElementById('my-cells-panel');
const myCellsList = document.getElementById('my-cells-list');

// Canvas screen panels
const myCellsPanelCanvas = document.getElementById('my-cells-panel-canvas');
const myCellsListCanvas = document.getElementById('my-cells-list-canvas');

// ===== STEP 2 ELEMENTS =====
const step2Controls = document.getElementById('step2-controls');
const step2Palette = document.getElementById('step2-palette');
const confirmPaintBtn = document.getElementById('confirm-paint-btn');
const step2Info = document.getElementById('step2-info');

// ===== STEP 3 ELEMENTS =====
const step3Controls = document.getElementById('step3-controls');
const repaintBtn = document.getElementById('repaint-btn');
const newCodeBtn = document.getElementById('new-code-btn');

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
const closeToolsBtn = document.getElementById('close-tools-btn');

// ===== SHARED ELEMENTS =====
const zoomLevelEl = document.getElementById('zoom-level');
const coordsTooltip = document.getElementById('coords-tooltip');
const magnifier = document.getElementById('magnifier');
const magnifierCanvas = document.getElementById('magnifier-canvas');
const magnifierCtx = magnifierCanvas.getContext('2d');

// ===== INIT =====
async function init() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    gridW = config.grid_w;
    gridH = config.grid_h;
    palette = config.palette;

    loadUserCodes();
    await loadState();
    setupPalette();
    setupMinimap();
    connectWebSocket();

    // Redraw background when window resizes
    window.addEventListener('resize', () => {
      if (currentStep === 1) {
        drawBackgroundFresque();
      }
    });

    // Show step 1 by default
    showStep(1);
  } catch (err) {
    console.error('Init error:', err);
    showStep1Status('Erreur de chargement', 'error');
  }
}

// ===== LOCAL STORAGE FOR MULTI-CODE =====
function loadUserCodes() {
  const stored = localStorage.getItem('fresq_user_codes');
  if (stored) {
    try {
      const data = JSON.parse(stored);
      userCodes = new Map(Object.entries(data));
      updateMyCellsPanel();
    } catch (err) {
      console.error('Error loading user codes:', err);
    }
  }
}

function saveUserCodes() {
  const data = Object.fromEntries(userCodes);
  localStorage.setItem('fresq_user_codes', JSON.stringify(data));
  updateMyCellsPanel();
}

function updateMyCellsPanel() {
  if (userCodes.size === 0) {
    myCellsPanel.classList.add('hidden');
    myCellsPanelCanvas.classList.add('hidden');
    return;
  }

  // Update both panels (step 1 and canvas screen)
  const updatePanel = (listEl) => {
    listEl.innerHTML = '';
    userCodes.forEach((cell, code) => {
      const div = document.createElement('div');
      div.className = 'my-cell-item';
      const colorHex = palette[cell.color - 1] || '#888';
      div.innerHTML = `
        <div style="display: flex; gap: 8px; align-items: center;">
          <div style="width: 16px; height: 16px; background: ${colorHex}; border-radius: 3px;"></div>
          <span>(${cell.x}, ${cell.y})</span>
        </div>
      `;
      listEl.appendChild(div);
    });
  };

  myCellsPanel.classList.remove('hidden');
  updatePanel(myCellsList);
  updatePanel(myCellsListCanvas);
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
  myCellsPanelCanvas.classList.add('hidden');

  if (step === 1) {
    step1Screen.classList.remove('hidden');
    updateMyCellsPanel();
    drawBackgroundFresque();
  } else if (step === 2) {
    canvasScreen.classList.remove('hidden');
    step2Controls.classList.remove('hidden');
    toolsMenuBtn.classList.remove('hidden');
    myCellsPanelCanvas.classList.remove('hidden');
    updateMyCellsPanel();
    setupCanvas();
    draw();
  } else if (step === 3) {
    canvasScreen.classList.remove('hidden');
    step3Controls.classList.remove('hidden');
    toolsMenuBtn.classList.remove('hidden');
    myCellsPanelCanvas.classList.remove('hidden');
    updateMyCellsPanel();
    // Setup canvas if not already done
    if (!isZoomPanSetup) {
      setupCanvas();
    } else {
      resizeCanvas();
    }
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

// ===== STEP 1: CODE INPUT =====
submitCodeBtn.onclick = async () => {
  const code = codeInputStep1.value.trim().toUpperCase();
  if (!code) return;

  try {
    const res = await fetch('/api/code/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    if (!data.ok) {
      showStep1Status('Code invalide', 'error');
      return;
    }

    currentCode = code;

    if (data.assigned) {
      // Code already has a cell assigned
      myCell = { x: data.assigned.x, y: data.assigned.y };

      // Check if cell is painted
      const key = `${myCell.x},${myCell.y}`;
      const color = cells.get(key);

      if (color) {
        // Cell is painted, save to user codes and go to step 3
        userCodes.set(code, { x: myCell.x, y: myCell.y, color });
        saveUserCodes();
        showStep(3);
      } else {
        // Cell claimed but not painted, go to step 2
        showStep(2);
      }
    } else {
      // New code, no cell assigned yet - go to step 2
      showStep(2);
    }
  } catch (err) {
    showStep1Status('Erreur de validation', 'error');
    console.error(err);
  }
};

// Enter key to submit code
codeInputStep1.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') submitCodeBtn.click();
});

// ===== STEP 2: CELL SELECTION =====
function setupPalette() {
  step2Palette.innerHTML = '';
  palette.forEach((color, i) => {
    const div = document.createElement('div');
    div.className = 'color';
    div.style.background = color;
    if (i === 0) div.classList.add('active');
    div.onclick = () => {
      document.querySelectorAll('#step2-palette .color').forEach(d => d.classList.remove('active'));
      div.classList.add('active');
      activeColor = i + 1;
      updateConfirmButton();
    };
    step2Palette.appendChild(div);
  });
}

function updateConfirmButton() {
  confirmPaintBtn.disabled = !myCell || !activeColor;
}

confirmPaintBtn.onclick = async () => {
  if (!currentCode || !myCell || !activeColor) return;

  try {
    const res = await fetch('/api/cell/paint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: currentCode, color: activeColor })
    });
    const data = await res.json();

    if (!data.ok) {
      step2Info.textContent = 'Erreur de peinture';
      step2Info.style.color = '#ff6b6b';
      return;
    }

    const key = `${data.x},${data.y}`;
    cells.set(key, data.color);
    cellTimestamps.set(key, Date.now());
    newCells.set(key, Date.now());

    // Save to user codes
    userCodes.set(currentCode, { x: data.x, y: data.y, color: data.color });
    saveUserCodes();

    updateCellsCount();
    draw();

    // Go to step 3
    showStep(3);
  } catch (err) {
    step2Info.textContent = 'Erreur de peinture';
    step2Info.style.color = '#ff6b6b';
    console.error(err);
  }
};

canvas.onclick = async (e) => {
  if (currentStep !== 2 || isPanning || isObserverMode) return;

  if (!currentCode) {
    step2Info.textContent = 'Erreur: pas de code';
    step2Info.style.color = '#ff6b6b';
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const { x, y } = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);

  if (x < 0 || y < 0 || x >= gridW || y >= gridH) return;

  // If already have a cell, can't claim another
  if (myCell) {
    step2Info.textContent = `Tu as déjà la case (${myCell.x}, ${myCell.y})`;
    step2Info.style.color = '#888';
    return;
  }

  try {
    const res = await fetch('/api/cell/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: currentCode, x, y })
    });
    const data = await res.json();

    if (!data.ok) {
      step2Info.textContent = data.error === 'cell_taken' ? 'Case déjà prise' : 'Erreur';
      step2Info.style.color = '#ff6b6b';
      return;
    }

    myCell = { x, y };
    step2Info.textContent = `Case (${x}, ${y}) sélectionnée - Choisis ta couleur`;
    step2Info.style.color = '#6FE6FF';
    updateConfirmButton();

    // Center on claimed cell
    offsetX = canvas.width / 2 - (myCell.x * CELL_SIZE + CELL_SIZE / 2) * scale;
    offsetY = canvas.height / 2 - (myCell.y * CELL_SIZE + CELL_SIZE / 2) * scale;
    draw();
  } catch (err) {
    step2Info.textContent = 'Erreur de sélection';
    step2Info.style.color = '#ff6b6b';
    console.error(err);
  }
};

// ===== STEP 3: VIEW MODE =====
repaintBtn.onclick = () => {
  // Go back to step 2 to repaint
  showStep(2);
};

newCodeBtn.onclick = () => {
  // Reset current session and go back to step 1
  currentCode = null;
  myCell = null;
  activeColor = 1;
  codeInputStep1.value = '';
  showStep(1);
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

  ctx.fillStyle = '#0a0e1a';
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
          ctx.fillStyle = '#1a1a1a';
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

  statPainted.textContent = painted.toLocaleString('fr-FR');
  statPercent.textContent = `${percent}%`;
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

// ===== START =====
init();
