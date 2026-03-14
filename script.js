// --- 1. Estado e Configurações ---
const state = {
    selectedType: null,
    markers: [],
    lines: [],
    map: null,
    isMeasuring: false,
    isFencing: false,
    isPiping: false,
    measurePoints: [],
    tempPoints: [],
    measureLine: null,
    measureArea: null,
    gridVisible: false,
    autoSatelliteZoom: 19
};

const objectConfigs = {
    house: { icon: 'fa-home', name: 'Casa', color: '#4ade80', cat: 'build' },
    garage: { icon: 'fa-warehouse', name: 'Garagem', color: '#60a5fa', cat: 'build' },
    'water-tank': { icon: 'fa-faucet-drip', name: 'Caixa d\'Água', color: '#38bdf8', cat: 'infra' },
    irrigation: { icon: 'fa-sprinkler', name: 'Sist. Irrigação', color: '#2dd4bf', cat: 'infra' },
    plantation: { icon: 'fa-seedling', name: 'Plantação', color: '#a3e635', cat: 'nature' },
    coconut: { icon: 'fa-tree', name: 'Coqueiro', color: '#22c55e', cat: 'nature' },
    cashew: { icon: 'fa-leaf', name: 'Cajueiro', color: '#84cc16', cat: 'nature' },
    mango: { icon: 'fa-spa', name: 'Mangueira', color: '#15803d', cat: 'nature' },
    well: { icon: 'fa-bore-hole', name: 'Poço', color: '#fbbf24', cat: 'infra' },
    light: { icon: 'fa-lightbulb', name: 'Poste', color: '#fef08a', cat: 'infra' },
    fence: { name: 'Cerca', color: '#78350f', isLine: true },
    pipe: { name: 'Tubulação', color: '#3b82f6', isLine: true }
};

// --- 2. Inicialização do Mapa ---
function initMap() {
    const savedView = JSON.parse(localStorage.getItem('tp_view')) || { center: [-3.4111, -39.0306], zoom: 18 };
    state.map = L.map('map', { zoomControl: true, attributionControl: false, maxZoom: 22 }).setView(savedView.center, savedView.zoom);

    const baseLayers = {
        "Modo Escuro": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 22 }),
        "Satélite": L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', { maxZoom: 22, subdomains: ['mt0','mt1','mt2','mt3'] })
    };
    baseLayers["Modo Escuro"].addTo(state.map);
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(state.map);

    state.map.on('moveend zoomend', () => {
        const zoom = state.map.getZoom();
        localStorage.setItem('tp_view', JSON.stringify({ center: [state.map.getCenter().lat, state.map.getCenter().lng], zoom }));
        // Auto-Satélite (Modo 3)
        if (zoom >= state.autoSatelliteZoom && !state.map.hasLayer(baseLayers["Satélite"])) {
            state.map.removeLayer(baseLayers["Modo Escuro"]);
            baseLayers["Satélite"].addTo(state.map);
        }
    });

    state.map.on('click', (e) => {
        if (state.isMeasuring) handleMeasure(e.latlng);
        else if (state.isFencing) handleLineAction(e.latlng, 'fence');
        else if (state.isPiping) handleLineAction(e.latlng, 'pipe');
        else if (state.selectedType) addObject(e.latlng);
    });

    // Delegar popups para evitar perda de listener (Modo estável)
    state.map.on('popupopen', (e) => {
        const source = e.popup._source;
        if (!source || !source.entityData) return;
        setupPopupListeners(source);
    });

    loadAll();
}

// --- 3. Gerenciamento de Entidades (Objetos e Linhas) ---
function addObject(latlng, type = state.selectedType, id = Date.now(), data = null) {
    const config = objectConfigs[type];
    const marker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'custom-marker',
            html: `<div class="marker-content" style="border-color:${config.color}; color:${config.color}"><i class="fas ${config.icon}"></i></div>`,
            iconSize: [40, 40], iconAnchor: [20, 20]
        }),
        draggable: true
    }).addTo(state.map);

    const entityData = data || { id, type, latlng: [latlng.lat, latlng.lng], customName: config.name };
    marker.entityData = entityData;

    if (type === 'light') { // Efeito de Luz
        marker.lightLayer = L.circle(latlng, { radius: 15, color: '#fef08a', fillOpacity: 0.15, weight: 1, interactive: false }).addTo(state.map);
        marker.on('drag', (e) => marker.lightLayer.setLatLng(e.latlng));
    }

    updateEntityVisuals(marker);
    marker.on('dragend', () => { entityData.latlng = [marker.getLatLng().lat, marker.getLatLng().lng]; saveAll(); });
    marker.on('click', (e) => { L.DomEvent.stopPropagation(e); showSidebarInfo(marker); });

    if (!data) { state.markers.push({ instance: marker, data: entityData }); saveAll(); }
}

function handleLineAction(latlng, type) {
    state.tempPoints.push(latlng);
    const dot = L.circle(latlng, { radius: 2, color: objectConfigs[type].color }).addTo(state.map);
    if (state.tempPoints.length > 1) {
        createLineEntity(state.tempPoints, type);
        state.tempPoints = [];
        state.map.eachLayer(l => { if (l instanceof L.Circle && l.options.radius === 2) state.map.removeLayer(l); });
    }
}

function createLineEntity(pts, type, id = Date.now(), data = null) {
    const config = objectConfigs[type];
    const line = L.polyline(pts, { color: config.color, weight: type === 'fence' ? 6 : 4, dashArray: type === 'pipe' ? '5,10' : null }).addTo(state.map);
    
    const entityData = data || { id, type, points: pts.map(p => [p.lat, p.lng]), customName: config.name, length: calculatePathDistance(pts) };
    line.entityData = entityData;

    updateEntityVisuals(line);
    line.on('click', (e) => { L.DomEvent.stopPropagation(e); showSidebarInfo(line); });

    if (!data) { state.lines.push({ instance: line, data: entityData }); saveAll(); }
}

function updateEntityVisuals(instance) {
    const d = instance.entityData;
    const tooltip = `<strong>${d.customName}</strong>${d.length ? `<br><small>${d.length.toFixed(1)}m</small>` : ''}`;
    instance.bindTooltip(tooltip, { direction: 'top', className: 'custom-tooltip' });
    
    const popup = `
        <div class="popup-box" style="min-width:180px;">
            <input type="text" id="p-name-${d.id}" value="${d.customName}" style="width:100%; background:#222; color:#fff; border:1px solid #444; padding:5px; border-radius:4px; margin-bottom:10px;">
            <div style="display:flex; gap:5px;">
                <button id="p-del-${d.id}" style="width:40px; background:#ef4444; color:#fff; border-radius:4px;"><i class="fas fa-trash"></i></button>
                <button id="p-ok-${d.id}" style="flex:1; background:var(--primary); font-weight:bold; border-radius:4px;">OK</button>
            </div>
        </div>
    `;
    instance.bindPopup(popup, { closeButton: false });
}

function setupPopupListeners(instance) {
    const d = instance.entityData;
    const inp = document.getElementById(`p-name-${d.id}`);
    const del = document.getElementById(`p-del-${d.id}`);
    const ok = document.getElementById(`p-ok-${d.id}`);

    if (inp) inp.oninput = (e) => { d.customName = e.target.value; updateEntityVisuals(instance); saveAll(); };
    if (ok) ok.onclick = () => instance.closePopup();
    if (del) {
        let confirmMode = false;
        del.onclick = (e) => {
            L.DomEvent.stopPropagation(e);
            if (!confirmMode) {
                confirmMode = true; del.innerHTML = 'SIM?'; del.style.background = '#991b1b';
                setTimeout(() => { if(del){ confirmMode = false; del.innerHTML = '<i class="fas fa-trash"></i>'; del.style.background = '#ef4444'; } }, 3000);
            } else { deleteEntity(instance); }
        };
    }
}

function deleteEntity(instance) {
    const d = instance.entityData;
    state.map.removeLayer(instance);
    if (instance.lightLayer) state.map.removeLayer(instance.lightLayer);
    state.markers = state.markers.filter(m => m.data.id !== d.id);
    state.lines = state.lines.filter(l => l.data.id !== d.id);
    saveAll();
    showSidebarInfo(null);
}

// --- 4. Ferramentas e UI ---
function initControls() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => btn.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.querySelectorAll('.obj-btn').forEach(item => {
            item.style.display = (tab === 'all' || item.dataset.cat === tab || item.dataset.type === 'null') ? 'flex' : 'none';
        });
    });

    // Seleção de Objetos
    document.querySelectorAll('.obj-btn').forEach(btn => btn.onclick = (e) => {
        e.stopPropagation();
        const type = btn.dataset.type;
        resetSelection();
        if (type !== 'null') {
            state.selectedType = type;
            btn.classList.add('active');
            document.getElementById('map').classList.add('cursor-add');
        } else {
            btn.classList.add('active');
        }
    });

    // Ferramentas de Linha e Medição
    document.getElementById('measure-btn').onclick = (e) => { e.stopPropagation(); resetSelection(); state.isMeasuring = true; e.target.closest('button').classList.add('active'); document.getElementById('map').classList.add('cursor-measure'); };
    document.getElementById('fence-btn').onclick = (e) => { e.stopPropagation(); resetSelection(); state.isFencing = true; e.target.closest('button').classList.add('active'); document.getElementById('map').classList.add('cursor-add'); showToast("Clique em dois pontos para cercar"); };
    document.getElementById('pipe-btn').onclick = (e) => { e.stopPropagation(); resetSelection(); state.isPiping = true; e.target.closest('button').classList.add('active'); document.getElementById('map').classList.add('cursor-add'); showToast("Clique em dois pontos para o cano"); };
    
    document.getElementById('grid-btn').onclick = toggleGrid;
    document.getElementById('list-btn').onclick = showInventory;
    document.getElementById('export-btn').onclick = () => window.print();
    document.getElementById('save-btn').onclick = () => { saveAll(); showToast("Salvo!"); };
    document.getElementById('clear-btn').onclick = () => { if(confirm("Limpar tudo?")) { localStorage.clear(); location.reload(); }};
    
    // Backup e Importação
    document.getElementById('backup-btn').onclick = exportBackup;
    document.getElementById('import-btn').onclick = () => document.getElementById('import-input').click();
    document.getElementById('import-input').onchange = importBackup;
}

function resetSelection() {
    state.selectedType = null;
    state.isMeasuring = state.isFencing = state.isPiping = false;
    state.tempPoints = [];
    state.measurePoints = [];
    if (state.measureLine) state.map.removeLayer(state.measureLine);
    if (state.measureArea) state.map.removeLayer(state.measureArea);
    document.querySelectorAll('.obj-btn, .tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.obj-btn[data-type="null"]').classList.add('active');
    document.getElementById('map').classList.remove('cursor-add', 'cursor-measure');
}

function handleMeasure(latlng) {
    if (state.measurePoints.length > 2 && state.map.distance(latlng, state.measurePoints[0]) < 15) {
        state.measureArea = L.polygon(state.measurePoints, { color: '#4ade80', weight: 2, fillOpacity: 0.2 }).addTo(state.map);
        const area = calculatePolygonArea(state.measurePoints);
        L.popup().setLatLng(state.measurePoints[0]).setContent(`🎯 Área: ${area.toFixed(1)} m²`).openOn(state.map);
        state.measurePoints = []; return;
    }
    state.measurePoints.push(latlng);
    L.circle(latlng, { radius: 2, color: '#4ade80' }).addTo(state.map);
    if (state.measurePoints.length > 1) {
        if (state.measureLine) state.map.removeLayer(state.measureLine);
        state.measureLine = L.polyline(state.measurePoints, { color: '#4ade80', weight: 3, dashArray: '5,10' }).addTo(state.map);
        L.popup().setLatLng(latlng).setContent(`Distância: ${calculatePathDistance(state.measurePoints).toFixed(1)}m`).openOn(state.map);
    }
}

// --- 5. Lógica de Apoio (Cálculos, Backup, Inventário) ---
function calculatePathDistance(pts) {
    let d = 0;
    for(let i=1; i<pts.length; i++) d += state.map.distance(L.latLng(pts[i-1]), L.latLng(pts[i]));
    return d;
}

function calculatePolygonArea(pts) {
    let area = 0; const R = 6378137;
    const coords = pts.map(p => ({ x: R * p.lng * Math.PI / 180 * Math.cos(p.lat * Math.PI / 180), y: R * p.lat * Math.PI / 180 }));
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) area += (coords[j].x + coords[i].x) * (coords[j].y - coords[i].y);
    return Math.abs(area / 2);
}

function showInventory() {
    const list = {};
    let fLen = 0, pLen = 0;
    state.markers.forEach(m => { const n = objectConfigs[m.data.type].name; list[n] = (list[n] || 0) + 1; });
    state.lines.forEach(l => { if(l.data.type === 'fence') fLen += l.data.length; else pLen += l.data.length; });
    
    let html = '<div style="background:#0f172a; color:#fff; padding:20px; border-radius:10px; border:2px solid var(--primary);">';
    html += '<h3 style="color:var(--primary); margin-bottom:15px;">📋 Inventário</h3>';
    for(const [n, c] of Object.entries(list)) html += `<p>🔹 <strong>${n}</strong>: ${c}</p>`;
    if(fLen) html += `<p>🚧 <strong>Cercas</strong>: ${fLen.toFixed(1)}m</p>`;
    if(pLen) html += `<p>💧 <strong>Canos</strong>: ${pLen.toFixed(1)}m</p>`;
    html += '<button onclick="this.parentElement.remove()" style="width:100%; margin-top:15px; background:var(--primary); padding:8px; border-radius:5px; color:#000; font-weight:bold;">Fechar</button></div>';

    const div = document.createElement('div');
    div.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:3000; width:280px;';
    div.innerHTML = html; document.body.appendChild(div);
}

function toggleGrid() {
    state.gridVisible = !state.gridVisible;
    document.getElementById('grid-btn').classList.toggle('active');
    if (state.gridVisible) {
        const grid = document.createElement('div');
        grid.id = 'g-layer';
        grid.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1000;pointer-events:none;background-image:linear-gradient(#ffffff11 1px,transparent 1px),linear-gradient(90deg,#ffffff11 1px,transparent 1px);background-size:50px 50px;';
        document.getElementById('map').appendChild(grid);
    } else { document.getElementById('g-layer')?.remove(); }
}

function saveAll() {
    localStorage.setItem('tp_markers', JSON.stringify(state.markers.map(m => m.data)));
    localStorage.setItem('tp_lines', JSON.stringify(state.lines.map(l => l.data)));
}

function loadAll() {
    const sm = JSON.parse(localStorage.getItem('tp_markers')) || [];
    const sl = JSON.parse(localStorage.getItem('tp_lines')) || [];
    sm.forEach(d => addObject(L.latLng(d.latlng), d.type, d.id, d));
    sl.forEach(d => createLineEntity(d.points.map(p => L.latLng(p)), d.type, d.id, d));
}

function exportBackup() {
    const data = { markers: state.markers.map(m => m.data), lines: state.lines.map(l => l.data), view: JSON.parse(localStorage.getItem('tp_view')) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `plan_backup_${new Date().toLocaleDateString()}.json`; a.click();
}

function importBackup(e) {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const d = JSON.parse(ev.target.result);
        if(confirm("Substituir mapa atual pelo backup?")) {
            localStorage.setItem('tp_markers', JSON.stringify(d.markers));
            localStorage.setItem('tp_lines', JSON.stringify(d.lines || []));
            location.reload();
        }
    };
    reader.readAsText(file);
}

function showSidebarInfo(instance) {
    const panel = document.getElementById('item-info');
    if (!instance) { panel.innerHTML = '<p class="placeholder-text">Selecione algo no mapa</p>'; return; }
    const d = instance.entityData;
    panel.innerHTML = `
        <div style="padding:10px;">
            <p style="color:var(--primary); font-weight:bold;">${d.customName}</p>
            <input type="text" id="s-edit-name" value="${d.customName}" style="width:100%; margin:10px 0; padding:8px; background:rgba(255,255,255,0.05); color:#fff; border:1px solid #444;">
            <button id="s-del-btn" style="width:100%; background:#ef4444; color:#fff; padding:8px; border-radius:5px;">Excluir</button>
        </div>
    `;
    document.getElementById('s-edit-name').oninput = (e) => { d.customName = e.target.value; updateEntityVisuals(instance); saveAll(); };
    document.getElementById('s-del-btn').onclick = () => { if(confirm("Excluir item?")) deleteEntity(instance); };
}

function showToast(msg) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed; top:20px; right:20px; background:var(--primary); color:#000; padding:10px 20px; border-radius:5px; z-index:4000; font-weight:bold; animation:fadeIn 0.3s;';
    t.innerText = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', () => { initMap(); initControls(); });
