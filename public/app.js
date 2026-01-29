// FRESQ V2 - Client avec Zoom & Pan & UX améliorée

const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');
const codeInput = document.getElementById('code-input');
const validateBtn = document.getElementById('validate-btn');
const paintBtn = document.getElementById('paint-btn');
const paletteEl = document.getElementById('palette');
const statusEl = document.getElementById('status');
const centerBtn = document.getElementById('center-btn');
const resetZoomBtn = document.getElementById('reset-zoom-btn');
const zoomLevelEl = document.getElementById('zoom-level');
const pollStatusEl = document.getElementById('poll-status');
const statsTextEl = document.getElementById('stats-text');
const progressBarEl = document.getElementById('progress-bar');
const progressPercentEl = document.getElementById('progress-percent');
const observerBtn = document.getElementById('observer-btn');
const observerBadge = document.getElementById('observer-badge');
const codeRow = document.getElementById('code-row');
const paintRow = document.getElementById('paint-row');
const coordsTooltip = document.getElementById('coords-tooltip');
const exportBtn = document.getElementById('export-btn');
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas.getContext('2d');

let gridW = 200;
let gridH = 200;
let palette = [];
let cells = new Map();
let currentCode = null;
let myCell = null;
let activeColor = 1;
let isObserverMode = false;

const CELL_SIZE = 3;

// Zoom & Pan
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };

// Animation for new cells
let newCells = new Map(); // key -> timestamp

// ===== INIT =====
async function init() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    gridW = config.grid_w;
    gridH = config.grid_h;
    palette = config.palette;

    setupCanvas();
    setupPalette();
    setupZoomPan();
    setupKeyboardShortcuts();
    setupMinimap();
    loadState();
  } catch (err) {
    setStatus('Erreur de chargement', 'error');
    console.error(err);
  }
}

function setupCanvas() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  draw();
}

function resizeCanvas() {
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();

  canvas.width = rect.width - 4; // -4 for border
  canvas.height = rect.height - 4;

  // Centrer la grille
  offsetX = (canvas.width - gridW * CELL_SIZE) / 2;
  offsetY = (canvas.height - gridH * CELL_SIZE) / 2;

  draw();
}

function setupMinimap() {
  minimapCanvas.width = 200;
  minimapCanvas.height = 200;

  // Click on minimap to jump to location
  minimapCanvas.addEventListener('click', (e) => {
    const rect = minimapCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Convert to grid coordinates
    const targetX = x * gridW * CELL_SIZE;
    const targetY = y * gridH * CELL_SIZE;

    // Center on this point
    offsetX = canvas.width / 2 - targetX * scale;
    offsetY = canvas.height / 2 - targetY * scale;

    draw();
  });
}

function drawMinimap() {
  const minimapScale = Math.min(
    minimapCanvas.width / (gridW * CELL_SIZE),
    minimapCanvas.height / (gridH * CELL_SIZE)
  );

  minimapCtx.fillStyle = '#000';
  minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

  // Draw cells on minimap
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

  // Draw viewport rectangle
  const viewportX = -offsetX / scale * minimapScale;
  const viewportY = -offsetY / scale * minimapScale;
  const viewportW = (canvas.width / scale) * minimapScale;
  const viewportH = (canvas.height / scale) * minimapScale;

  minimapCtx.strokeStyle = '#6FE6FF';
  minimapCtx.lineWidth = 2;
  minimapCtx.strokeRect(viewportX, viewportY, viewportW, viewportH);
}

function setupPalette() {
  palette.forEach((color, i) => {
    const div = document.createElement('div');
    div.className = 'color';
    div.style.background = color;
    if (i === 0) div.classList.add('active');
    div.onclick = () => {
      document.querySelectorAll('.color').forEach(d => d.classList.remove('active'));
      div.classList.add('active');
      activeColor = i + 1;
    };
    paletteEl.appendChild(div);
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ignore if typing in input
    if (e.target.tagName === 'INPUT') return;

    // Numbers 1-9 for color selection, 0 for 10th color
    if (e.key >= '1' && e.key <= '9') {
      const colorIndex = parseInt(e.key) - 1;
      if (colorIndex < palette.length) {
        activeColor = colorIndex + 1;
        document.querySelectorAll('.color').forEach((el, i) => {
          el.classList.toggle('active', i === colorIndex);
        });
        e.preventDefault();
      }
    } else if (e.key === '0' && palette.length >= 10) {
      // 0 key selects the 10th color
      activeColor = 10;
      document.querySelectorAll('.color').forEach((el, i) => {
        el.classList.toggle('active', i === 9);
      });
      e.preventDefault();
    }

    // Space to paint
    if (e.key === ' ' && !paintBtn.disabled) {
      paintBtn.click();
      e.preventDefault();
    }

    // Arrow keys to pan
    const panSpeed = 50;
    if (e.key === 'ArrowLeft') {
      offsetX += panSpeed;
      draw();
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      offsetX -= panSpeed;
      draw();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      offsetY += panSpeed;
      draw();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      offsetY -= panSpeed;
      draw();
      e.preventDefault();
    }
  });
}

function setupZoomPan() {
  // Zoom avec molette
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

  // Pan avec clic-drag
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

    // Update coordinates tooltip
    const rect = canvas.getBoundingClientRect();
    const { x, y } = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);

    if (x >= 0 && y >= 0 && x < gridW && y < gridH) {
      coordsTooltip.textContent = `x: ${x}, y: ${y}`;
      coordsTooltip.classList.add('visible');
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

  // Désactiver menu contextuel
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function loadState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();

    cells.clear();
    data.cells.forEach(cell => {
      cells.set(`${cell.x},${cell.y}`, cell.color);
    });

    updateCellsCount();
    draw();
    setStatus(`Grille chargée - ${data.cells.length} cases`, 'success');
  } catch (err) {
    console.error('Load state error:', err);
  }
}

function draw() {
  // Clear
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Background grid
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, gridW * CELL_SIZE, gridH * CELL_SIZE);

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

  // Cells with animation
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
        // Pulse effect for 1 second
        const pulse = Math.sin((age / 1000) * Math.PI * 4) * 0.3 + 0.7;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.restore();

        // Continue animating
        requestAnimationFrame(() => draw());
      } else {
        // Remove from animation list
        newCells.delete(key);
      }
    }
  });

  // My cell highlight
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

  // Update minimap
  drawMinimap();
}

function screenToGrid(screenX, screenY) {
  const worldX = (screenX - offsetX) / scale;
  const worldY = (screenY - offsetY) / scale;
  const gridX = Math.floor(worldX / CELL_SIZE);
  const gridY = Math.floor(worldY / CELL_SIZE);
  return { x: gridX, y: gridY };
}

// ===== OBSERVER MODE =====
observerBtn.onclick = () => {
  isObserverMode = true;
  observerBadge.classList.remove('hidden');

  // Hide code input and paint controls
  codeInput.disabled = true;
  validateBtn.disabled = true;
  observerBtn.disabled = true;
  paintRow.style.opacity = '0.3';
  paintRow.style.pointerEvents = 'none';

  setStatus('Mode observateur activé - Vue seule', 'success');
};

// ===== EVENTS =====
validateBtn.onclick = async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (!code) return;

  try {
    const res = await fetch('/api/code/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    if (!data.ok) {
      setStatus('Code invalide', 'error');
      return;
    }

    currentCode = code;

    if (data.assigned) {
      myCell = { x: data.assigned.x, y: data.assigned.y };
      setStatus(`Code validé - Case (${myCell.x}, ${myCell.y})`, 'success');
      paintBtn.disabled = false;
      centerBtn.disabled = false;

      // Centrer sur ma case
      offsetX = canvas.width / 2 - (myCell.x * CELL_SIZE + CELL_SIZE / 2) * scale;
      offsetY = canvas.height / 2 - (myCell.y * CELL_SIZE + CELL_SIZE / 2) * scale;
    } else {
      setStatus('Code validé - Clique sur une case', 'success');
      paintBtn.disabled = true;
    }

    draw();
  } catch (err) {
    setStatus('Erreur de validation', 'error');
    console.error(err);
  }
};

canvas.onclick = async (e) => {
  if (isPanning || isObserverMode) return;

  if (!currentCode) {
    setStatus('Entre un code d\'abord', 'error');
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const { x, y } = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);

  if (x < 0 || y < 0 || x >= gridW || y >= gridH) return;

  try {
    const res = await fetch('/api/cell/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: currentCode, x, y })
    });
    const data = await res.json();

    if (!data.ok) {
      setStatus(data.error === 'cell_taken' ? 'Case déjà prise' : 'Erreur', 'error');
      return;
    }

    myCell = { x, y };
    setStatus(`Case (${x}, ${y}) réclamée`, 'success');
    paintBtn.disabled = false;
    centerBtn.disabled = false;
    draw();
  } catch (err) {
    setStatus('Erreur de claim', 'error');
    console.error(err);
  }
};

paintBtn.onclick = async () => {
  if (!currentCode || !myCell) return;

  try {
    const res = await fetch('/api/cell/paint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: currentCode, color: activeColor })
    });
    const data = await res.json();

    if (!data.ok) {
      setStatus('Erreur de peinture', 'error');
      return;
    }

    const key = `${data.x},${data.y}`;
    cells.set(key, data.color);
    newCells.set(key, Date.now()); // Mark as new for animation
    setStatus(`Case peinte en ${palette[data.color - 1]}`, 'success');
    updateCellsCount();
    draw();
  } catch (err) {
    setStatus('Erreur de peinture', 'error');
    console.error(err);
  }
};

// ===== BOUTONS UTILITAIRES =====
centerBtn.onclick = () => {
  if (!myCell) return;

  offsetX = canvas.width / 2 - (myCell.x * CELL_SIZE + CELL_SIZE / 2) * scale;
  offsetY = canvas.height / 2 - (myCell.y * CELL_SIZE + CELL_SIZE / 2) * scale;
  draw();
};

resetZoomBtn.onclick = () => {
  scale = 1;
  offsetX = (canvas.width - gridW * CELL_SIZE) / 2;
  offsetY = (canvas.height - gridH * CELL_SIZE) / 2;
  updateZoomIndicator();
  draw();
};

exportBtn.onclick = () => {
  // Create an offscreen canvas at original size
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = gridW * CELL_SIZE;
  exportCanvas.height = gridH * CELL_SIZE;
  const exportCtx = exportCanvas.getContext('2d');

  // Draw background
  exportCtx.fillStyle = '#000';
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  // Draw all cells
  cells.forEach((color, key) => {
    const [x, y] = key.split(',').map(Number);
    exportCtx.fillStyle = palette[color - 1];
    exportCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  });

  // Download as PNG
  exportCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fresq_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Image exportée !', 'success');
  });
};

function updateZoomIndicator() {
  zoomLevelEl.textContent = Math.round(scale * 100) + '%';
}

function updateCellsCount() {
  const total = gridW * gridH; // 40,000
  const painted = cells.size;
  const percent = ((painted / total) * 100).toFixed(1);

  statsTextEl.textContent = `${painted.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} cases`;
  progressBarEl.style.width = `${percent}%`;
  progressPercentEl.textContent = `${percent}%`;
}

function setStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.className = '';
  if (type === 'success') statusEl.classList.add('success');
  if (type === 'error') statusEl.classList.add('error');
}

// ===== WEBSOCKETS TEMPS RÉEL =====
let socket = null;
let pollingInterval = null;
let isConnected = false;

function connectWebSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('🔌 WebSocket connected');
    isConnected = true;
    pollStatusEl.style.color = '#2a4';
    pollStatusEl.textContent = '● Live';
    pollStatusEl.title = 'WebSocket connecté';

    // Stop polling when WebSocket is connected
    stopPolling();
  });

  socket.on('disconnect', () => {
    console.log('🔌 WebSocket disconnected');
    isConnected = false;
    pollStatusEl.style.color = '#f80';
    pollStatusEl.textContent = '● Polling';
    pollStatusEl.title = 'Fallback polling actif';

    // Start polling as fallback
    startPolling();
  });

  socket.on('cell:painted', (data) => {
    const key = `${data.x},${data.y}`;
    cells.set(key, data.color);
    newCells.set(key, Date.now());
    draw();
    updateCellsCount();
  });

  socket.on('cell:claimed', (data) => {
    // Just trigger a refresh for now
    console.log('Cell claimed:', data);
  });

  socket.on('cell:deleted', (data) => {
    const key = `${data.x},${data.y}`;
    cells.delete(key);
    draw();
    updateCellsCount();
  });
}

async function pollUpdates() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();

    let hasChanges = false;

    // Comparer et mettre à jour les cellules
    data.cells.forEach(cell => {
      const key = `${cell.x},${cell.y}`;
      const currentColor = cells.get(key);

      if (currentColor !== cell.color) {
        cells.set(key, cell.color);
        newCells.set(key, Date.now());
        hasChanges = true;
      }
    });

    if (hasChanges) {
      draw();
      updateCellsCount();
    }

    pollStatusEl.style.color = '#f80';
  } catch (err) {
    console.error('Poll error:', err);
    pollStatusEl.style.color = '#f44';
  }
}

function startPolling() {
  if (!pollingInterval) {
    pollingInterval = setInterval(pollUpdates, 5000);
    console.log('✅ Fallback polling activé (5s)');
  }
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('⏸️ Polling désactivé');
  }
}

// ===== START =====
init();
connectWebSocket();
