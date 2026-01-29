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
const copyCodeBtn = document.getElementById('copy-code-btn');
const navXInput = document.getElementById('nav-x');
const navYInput = document.getElementById('nav-y');
const navGoBtn = document.getElementById('nav-go-btn');
const magnifierToggleBtn = document.getElementById('magnifier-toggle-btn');
const magnifier = document.getElementById('magnifier');
const magnifierCanvas = document.getElementById('magnifier-canvas');
const magnifierCtx = magnifierCanvas.getContext('2d');
const coordsTooltip = document.getElementById('coords-tooltip');
const exportBtn = document.getElementById('export-btn');
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas.getContext('2d');

let gridW = 200;
let gridH = 200;
let palette = [];
let cells = new Map();
let cellTimestamps = new Map(); // Track when cells were last painted
let currentCode = null;
let myCell = null;
let activeColor = 1;
let isObserverMode = false;
let magnifierActive = false;

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
  // Touch support for mobile
  let touchStartDist = 0;
  let touchStartScale = 1;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      // Single touch - pan
      isPanning = true;
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      panStart = { x: touch.clientX - offsetX, y: touch.clientY - offsetY };
      e.preventDefault();
    } else if (e.touches.length === 2) {
      // Two fingers - pinch to zoom
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
      // Pan
      const touch = e.touches[0];
      offsetX = touch.clientX - panStart.x;
      offsetY = touch.clientY - panStart.y;
      draw();
      e.preventDefault();
    } else if (e.touches.length === 2) {
      // Pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDist = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      const newScale = Math.max(0.5, Math.min(10, touchStartScale * (currentDist / touchStartDist)));

      // Center of pinch
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

  canvas.addEventListener('touchend', (e) => {
    isPanning = false;
    e.preventDefault();
  });

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

      // Update magnifier
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

  // Désactiver menu contextuel
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

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
      // Set timestamp to now for initial load (we don't have real timestamps from server)
      cellTimestamps.set(key, now);
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

  // Background grid with gray for empty cells
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const key = `${x},${y}`;
      if (!cells.has(key)) {
        // Empty cell - draw gray
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
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
  isObserverMode = !isObserverMode;

  if (isObserverMode) {
    // Enter observer mode
    observerBadge.classList.remove('hidden');
    codeInput.disabled = true;
    validateBtn.disabled = true;
    paintRow.style.opacity = '0.3';
    paintRow.style.pointerEvents = 'none';
    setStatus('Mode observateur activé - Vue seule', 'success');
  } else {
    // Exit observer mode
    observerBadge.classList.add('hidden');
    codeInput.disabled = false;
    validateBtn.disabled = false;
    paintRow.style.opacity = '1';
    paintRow.style.pointerEvents = 'auto';
    setStatus('Mode observateur désactivé', 'info');
  }
};

// ===== MAGNIFIER =====
magnifierToggleBtn.onclick = () => {
  magnifierActive = !magnifierActive;
  if (magnifierActive) {
    magnifierToggleBtn.classList.add('active');
    magnifier.style.display = 'block';
  } else {
    magnifierToggleBtn.classList.remove('active');
    magnifier.style.display = 'none';
  }
};

function updateMagnifier(mouseX, mouseY, gridX, gridY) {
  const magnifierSize = 150;
  const magnifierZoom = 10; // 10x zoom

  // Position magnifier near mouse
  magnifier.style.left = (mouseX + 20) + 'px';
  magnifier.style.top = (mouseY + 20) + 'px';

  // Draw magnified view
  magnifierCanvas.width = magnifierSize;
  magnifierCanvas.height = magnifierSize;

  magnifierCtx.fillStyle = '#0a0e1a';
  magnifierCtx.fillRect(0, 0, magnifierSize, magnifierSize);

  const centerX = gridX;
  const centerY = gridY;
  const radius = 3; // Show 7x7 cells

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = centerX + dx;
      const cy = centerY + dy;

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

        // Grid lines
        magnifierCtx.strokeStyle = '#444';
        magnifierCtx.lineWidth = 1;
        magnifierCtx.strokeRect(px, py, cellSize, cellSize);

        // Highlight center cell
        if (dx === 0 && dy === 0) {
          magnifierCtx.strokeStyle = '#6FE6FF';
          magnifierCtx.lineWidth = 2;
          magnifierCtx.strokeRect(px, py, cellSize, cellSize);
        }
      }
    }
  }
}

// ===== NAVIGATION =====
navGoBtn.onclick = () => {
  const x = parseInt(navXInput.value);
  const y = parseInt(navYInput.value);

  if (isNaN(x) || isNaN(y) || x < 0 || x >= gridW || y < 0 || y >= gridH) {
    setStatus('Coordonnées invalides', 'error');
    return;
  }

  // Center on coordinates
  offsetX = canvas.width / 2 - (x * CELL_SIZE + CELL_SIZE / 2) * scale;
  offsetY = canvas.height / 2 - (y * CELL_SIZE + CELL_SIZE / 2) * scale;
  draw();
  setStatus(`Navigation vers (${x}, ${y})`, 'success');
};

// Copy code button
copyCodeBtn.onclick = () => {
  if (!currentCode) return;

  navigator.clipboard.writeText(currentCode).then(() => {
    setStatus('Code copié dans le presse-papiers', 'success');
  }).catch(() => {
    setStatus('Erreur lors de la copie', 'error');
  });
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
      copyCodeBtn.classList.add('hidden');
      return;
    }

    currentCode = code;
    copyCodeBtn.classList.remove('hidden');

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
    const now = Date.now();
    cells.set(key, data.color);
    cellTimestamps.set(key, now);
    newCells.set(key, now);
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
