"use strict";

// This single script handles both the login page and the dashboard.

// ===================================
// PAGE ROUTING & INITIALIZATION
// ===================================
document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("auth-container")) {
        if (localStorage.getItem("token")) {
            window.location.href = "/";
            return;
        }
        handleAuthPage();
    } else if (document.querySelector(".layout")) {
        initializeApp();
    }
});

async function initializeApp() {
    const API_BASE = "/api";
    const token = localStorage.getItem("token");
    try {
        if (!token) throw new Error("No token found");
        const res = await fetch(`${API_BASE}/verify_token`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Token is invalid or expired");
        setupDashboard();
    } catch (error) {
        localStorage.clear();
        window.location.href = "/login";
    }
}

// ===================================
// AUTHENTICATION PAGE LOGIC
// ===================================
function handleAuthPage() {
    const API_BASE = "/api";
    const form = document.getElementById('auth-form');
    const title = document.getElementById('form-title');
    const usernameGroup = document.getElementById('username-group');
    const submitButton = document.getElementById('submit-button');
    const toggleAction = document.getElementById('toggle-action');
    const toggleText = document.getElementById('toggle-text');
    let isLoginMode = false;

    const setAuthMode = (loginMode) => {
        isLoginMode = loginMode;
        usernameGroup.style.display = loginMode ? 'none' : 'block';
        title.textContent = loginMode ? 'Login' : 'Create Account';
        submitButton.textContent = loginMode ? 'Login' : 'Register';
        toggleText.textContent = loginMode ? 'New user?' : 'Existing user?';
        toggleAction.textContent = loginMode ? 'Create an account' : 'Login';
    };

    toggleAction.addEventListener('click', (e) => {
        e.preventDefault();
        setAuthMode(!isLoginMode);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const username = document.getElementById('username').value.trim();
        const endpoint = isLoginMode ? `${API_BASE}/login` : `${API_BASE}/register`;
        const body = isLoginMode ? { email, password } : { username, email, password };

        if ((isLoginMode && (!email || !password)) || (!isLoginMode && (!username || !email || !password))) {
            return alert('All fields are required.');
        }

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            localStorage.setItem("token", data.access_token);
            localStorage.setItem("username", data.username);
            window.location.href = "/";
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    });

    setAuthMode(false); // Default to Register
}

// ===================================
// DASHBOARD LOGIC
// ===================================
function setupDashboard() {
    const API_BASE = "/api";
    const ZONE_COLORS = ['rgba(56, 189, 248, 0.7)', 'rgba(232, 121, 249, 0.7)', 'rgba(74, 222, 128, 0.7)', 'rgba(251, 191, 36, 0.7)'];
    let state = {
        isDrawing: false,
        previewMode: false,
        analysisRunning: false,
        drawPoints: [],
        savedZones: [],
        analysisInterval: null,
        charts: { population: null },
        uploadedVideoURL: null
    };

    const DOMElements = {
        videoFeedView: document.getElementById('video-feed-view'),
        visualizationsView: document.getElementById('live-analysis-view'),
        videoPlaceholder: document.getElementById('video-placeholder'),
        videoWrapper: document.getElementById('videoWrapper'), // <-- ADDED THIS
        videoFeed: document.getElementById('videoFeed'),
        videoUploadInput: document.getElementById('videoUploadInput'),
        canvas: document.getElementById('zoneCanvas'),
        canvasNote: document.getElementById('canvas-note'),
        btnCamera: document.getElementById('btn-camera'),
        btnVideoFeed: document.getElementById('btn-video-feed'),
        btnZoneManipulation: document.getElementById('btn-zone-manipulation'),
        zoneMenuContainer: document.querySelector('.zone-menu-container'),
        btnZoneCreate: document.getElementById('btn-zone-create'),
        btnZonePreview: document.getElementById('btn-zone-preview'),
        btnZoneDelete: document.getElementById('btn-zone-delete'),
        zoneDeleteSelect: document.getElementById('zone-list-delete'),
        btnVisualizations: document.getElementById('btn-live-analysis'),
        btnLogout: document.getElementById('btn-logout'),
        statusText: document.getElementById('status-text'),
        totalPeopleText: document.getElementById('total-people-text'),
        populationChartCanvas: document.getElementById('population-chart'),
        analysisOverlayFrame: document.getElementById('analysisOverlayFrame'),
        analysisHeatmapFrame: document.getElementById('analysisHeatmapFrame'),
        zoneOccupancyList: document.getElementById('zone-occupancy-list'),
        alertBox: document.getElementById('alert-box'),
        usernameDisplay: document.getElementById('usernameDisplay'),
        zoneNameModal: document.getElementById('zone-name-modal'),
        zoneNameInput: document.getElementById('zone-name-input'),
        modalSaveBtn: document.getElementById('modal-save-btn'),
        modalCancelBtn: document.getElementById('modal-cancel-btn'),
        notificationContainer: document.getElementById('notification-container')
    };
    const ctx = DOMElements.canvas.getContext('2d');
    const authHeaders = () => ({ "Authorization": `Bearer ${localStorage.getItem("token")}` });

    // (The rest of the functions are unchanged until handleVideoFileSelect)

    const showNotification = (message, type = 'info') => {
        const notif = document.createElement('div');
        notif.className = `notification ${type}`;
        notif.textContent = message;
        DOMElements.notificationContainer.appendChild(notif);
        setTimeout(() => notif.classList.add('show'), 10);
        setTimeout(() => {
            notif.classList.remove('show');
            notif.addEventListener('transitionend', () => notif.remove());
        }, 3000);
    };

    const askZoneName = () => {
        return new Promise((resolve) => {
            DOMElements.zoneNameModal.style.display = 'flex';
            DOMElements.zoneNameInput.value = '';
            DOMElements.zoneNameInput.focus();
            const onSave = () => { cleanup(); resolve(DOMElements.zoneNameInput.value.trim()); };
            const onCancel = () => { cleanup(); resolve(null); };
            const cleanup = () => {
                DOMElements.modalSaveBtn.removeEventListener('click', onSave);
                DOMElements.modalCancelBtn.removeEventListener('click', onCancel);
                DOMElements.zoneNameModal.style.display = 'none';
            };
            DOMElements.modalSaveBtn.addEventListener('click', onSave);
            DOMElements.modalCancelBtn.addEventListener('click', onCancel);
        });
    };
    
    function setupEventListeners() {
        DOMElements.btnCamera.addEventListener('click', handleCameraFeed);
        DOMElements.btnVideoFeed.addEventListener('click', handleVideoFeedView);
        DOMElements.btnZoneManipulation.addEventListener('click', toggleZoneMenu);
        DOMElements.btnVisualizations.addEventListener('click', handleVisualizationsView);
        DOMElements.btnZoneCreate.addEventListener('click', enableDrawingMode);
        DOMElements.btnZonePreview.addEventListener('click', enablePreviewMode);
        DOMElements.btnZoneDelete.addEventListener('click', deleteSelectedZone);
        DOMElements.videoPlaceholder.addEventListener('click', () => DOMElements.videoUploadInput.click());
        DOMElements.videoUploadInput.addEventListener('change', handleVideoFileSelect);
        DOMElements.canvas.addEventListener('mousedown', onPointerDown);
        DOMElements.canvas.addEventListener('mousemove', onPointerMove);
        DOMElements.canvas.addEventListener('mouseup', onPointerUp);
        DOMElements.canvas.addEventListener('mouseleave', onPointerUp);
        DOMElements.btnLogout.addEventListener('click', logout);
        DOMElements.videoFeed.onloadedmetadata = resizeCanvas;
        window.onresize = resizeCanvas;
    }

    function setActiveButton(activeBtn) {
        [DOMElements.btnCamera, DOMElements.btnVideoFeed, DOMElements.btnVisualizations].forEach(btn => btn.classList.remove('active'));
        if (activeBtn) activeBtn.classList.add('active');
    }

    function switchView(view) {
        DOMElements.videoFeedView.style.display = (view === 'video') ? 'flex' : 'none';
        DOMElements.visualizationsView.style.display = (view === 'analysis') ? 'flex' : 'none';
    }

    function handleCameraFeed() {
        setActiveButton(DOMElements.btnCamera);
        switchView('video');
        if (state.analysisRunning) stopAnalysis();
        disableAllModes();
        showNotification("Camera feature is not yet implemented.", "info");
    }

    function handleVideoFeedView() {
        setActiveButton(DOMElements.btnVideoFeed);
        switchView('video');
        if (state.analysisRunning) stopAnalysis();
        disableAllModes();
        DOMElements.canvasNote.textContent = "";
    }

    async function handleVisualizationsView() {
        setActiveButton(DOMElements.btnVisualizations);
        switchView('analysis');
        disableAllModes();
        await startAnalysisHandler();
    }
    
    function toggleZoneMenu() { DOMElements.zoneMenuContainer.classList.toggle('open'); }

    async function handleVideoFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (state.uploadedVideoURL) URL.revokeObjectURL(state.uploadedVideoURL);
        if (state.analysisRunning) stopAnalysis();
        state.uploadedVideoURL = URL.createObjectURL(file);
        DOMElements.videoFeed.src = state.uploadedVideoURL;
        
        // --- FIX IS HERE ---
        DOMElements.videoPlaceholder.style.display = 'none';
        DOMElements.videoWrapper.style.display = 'block'; // This line makes the video visible
        // --- END FIX ---

        const formData = new FormData();
        formData.append("video", file);
        try {
            showNotification("Uploading video...", "info");
            const res = await fetch(`${API_BASE}/upload_video`, { method: "POST", headers: authHeaders(), body: formData });
            if (!res.ok) throw new Error((await res.json()).error);
            showNotification("Video uploaded. You can now use 'Zone Manipulation'.", "success");
        } catch (err) { showNotification(`Video upload failed: ${err.message}`, "error"); }
    }

    function resizeCanvas() {
        if (DOMElements.videoFeed.videoWidth > 0) {
            DOMElements.canvas.width = DOMElements.videoFeed.clientWidth;
            DOMElements.canvas.height = DOMElements.videoFeed.clientHeight;
            drawAll();
        }
    }
    
    function onPointerDown(e) {
        if (!state.isDrawing) return;
        const rect = DOMElements.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        state.drawPoints = [{ x, y }, { x, y }];
        drawAll();
    }
    function onPointerMove(e) {
        if (!state.isDrawing || state.drawPoints.length === 0) return;
        const rect = DOMElements.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        state.drawPoints[1] = { x, y };
        drawAll();
    }
    async function onPointerUp() {
        if (!state.isDrawing || state.drawPoints.length < 2) return;
        state.isDrawing = false;
        const x1 = Math.min(state.drawPoints[0].x, state.drawPoints[1].x);
        const y1 = Math.min(state.drawPoints[0].y, state.drawPoints[1].y);
        const x2 = Math.max(state.drawPoints[0].x, state.drawPoints[1].x);
        const y2 = Math.max(state.drawPoints[0].y, state.drawPoints[1].y);
        if (Math.abs(x1 - x2) < 5 || Math.abs(y1 - y2) < 5) {
             disableAllModes(); return;
        }
        const polygon = [{x:x1, y:y1}, {x:x2, y:y1}, {x:x2, y:y2}, {x:x1, y:y2}];
        const zoneName = await askZoneName();
        if (zoneName) await saveZone(zoneName, polygon);
        disableAllModes();
    }

    function enableDrawingMode() {
        if (!state.uploadedVideoURL) return showNotification("Upload a video first to create a zone.", "error");
        handleVideoFeedView();
        state.isDrawing = true; state.previewMode = false;
        DOMElements.canvas.style.pointerEvents = 'auto';
        DOMElements.canvasNote.textContent = `Click and drag to draw a rectangular zone.`;
        state.drawPoints = []; drawAll();
    }

    async function enablePreviewMode() {
        if (!state.uploadedVideoURL) return showNotification("Upload a video first to preview zones.", "error");
        handleVideoFeedView();
        state.isDrawing = false; state.previewMode = true;
        DOMElements.canvas.style.pointerEvents = 'none';
        DOMElements.canvasNote.textContent = "Previewing saved zones.";
        await loadZones(); drawAll();
    }

    function disableAllModes() {
        state.isDrawing = false; state.previewMode = false;
        DOMElements.canvas.style.pointerEvents = 'none';
        DOMElements.canvasNote.textContent = "";
        state.drawPoints = []; drawAll();
    }
    
    function drawAll() {
        ctx.clearRect(0, 0, DOMElements.canvas.width, DOMElements.canvas.height);
        drawZonesOnCanvas();
    }

    function drawZonesOnCanvas(){
        if (state.previewMode && state.savedZones.length > 0) {
            const scaledZones = state.savedZones.map(zone => ({ ...zone, coordinates: zone.coordinates.map(p => ({ x: (p.x / 1000) * DOMElements.canvas.width, y: (p.y / 1000) * DOMElements.canvas.height })) }));
            scaledZones.forEach((zone, i) => drawPolygon(zone.coordinates, ZONE_COLORS[i % ZONE_COLORS.length], zone.name));
        }
        if (state.isDrawing && state.drawPoints.length === 2) {
            const [p1, p2] = state.drawPoints;
            const rectPoints = [{x:p1.x, y:p1.y}, {x:p2.x, y:p1.y}, {x:p2.x, y:p2.y}, {x:p1.x, y:p2.y}];
            drawPolygon(rectPoints, 'rgba(56, 189, 248, 0.4)', 'Drawing...');
        }
    }
    
    function drawPolygon(points, color, name = '') {
        if (points.length === 0) return;
        ctx.fillStyle = color;
        ctx.strokeStyle = color.replace('0.7', '1').replace('0.4', '1');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for(let i=1; i<points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (name) {
            const centerX = points.reduce((s, p) => s + p.x, 0) / points.length;
            const centerY = points.reduce((s, p) => s + p.y, 0) / points.length;
            ctx.font = "bold 16px Poppins"; ctx.fillStyle = "#fff";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(name, centerX, centerY);
        }
    }

    async function saveZone(name, polygon) {
        const scaledCoords = polygon.map(p => ({ x: Math.round((p.x / DOMElements.canvas.width) * 1000), y: Math.round((p.y / DOMElements.canvas.height) * 1000) }));
        try {
            await fetch(`${API_BASE}/zones`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name, coordinates: scaledCoords }) });
            showNotification("Zone saved successfully!", "success");
            await loadZones();
        } catch (err) { showNotification(`Error saving zone: ${err.message}`, "error"); }
    }

    async function loadZones() {
        try {
            const res = await fetch(`${API_BASE}/zones`, { headers: authHeaders() });
            state.savedZones = (await res.json()).zones || [];
            updateDeleteDropdown();
        } catch (err) { console.error("Failed to load zones:", err); }
    }

    function updateDeleteDropdown() {
        DOMElements.zoneDeleteSelect.innerHTML = '';
        if (state.savedZones.length === 0) {
            const option = document.createElement('option');
            option.textContent = 'No zones';
            DOMElements.zoneDeleteSelect.appendChild(option);
        } else {
            state.savedZones.forEach(zone => {
                const option = document.createElement('option');
                option.value = zone.id;
                option.textContent = zone.name;
                DOMElements.zoneDeleteSelect.appendChild(option);
            });
        }
    }

    async function deleteSelectedZone() {
        const zoneId = DOMElements.zoneDeleteSelect.value;
        if (!zoneId || state.savedZones.length === 0) return showNotification("No zone selected.", "error");
        if (!confirm(`Are you sure you want to delete this zone?`)) return;
        try {
            await fetch(`${API_BASE}/zones/${zoneId}`, { method: 'DELETE', headers: authHeaders() });
            showNotification("Zone deleted successfully.", "success");
            await loadZones();
        } catch (err) { showNotification(`Error deleting zone: ${err.message}`, "error"); }
    }

    async function startAnalysisHandler() {
        if (state.analysisRunning) {
            stopAnalysis();
            showNotification("Analysis stopped.", "info");
            return;
        }
        if (!state.uploadedVideoURL) {
            showNotification("Upload a video before starting analysis.", "error");
            handleVideoFeedView(); 
            return;
        }
        
        try {
            const res = await fetch(`${API_BASE}/analysis/start`, { method: 'POST', headers: authHeaders() });
            if (!res.ok) throw new Error((await res.json()).error);
            showNotification("Analysis started successfully.", "success");
            resetChart();
            startAnalysis();
        } catch (err) {
            showNotification(`Failed to start analysis: ${err.message}`, "error");
            handleVideoFeedView();
        }
    }

    function startAnalysis() {
        if (state.analysisInterval) return;
        state.analysisInterval = setInterval(fetchFrameData, 500); // 2 FPS
        state.analysisRunning = true;
        DOMElements.statusText.textContent = "Running";
        DOMElements.btnVisualizations.innerHTML = "<i class='bx bx-stop-circle'></i> Stop Analysis";
    }

    function stopAnalysis() {
        if (state.analysisInterval) { clearInterval(state.analysisInterval); state.analysisInterval = null; }
        state.analysisRunning = false;
        DOMElements.statusText.textContent = "Idle";
        DOMElements.totalPeopleText.textContent = "0";
        DOMElements.btnVisualizations.innerHTML = "<i class='bx bx-line-chart'></i> Live Analysis";
    }

    async function fetchFrameData() {
        if (!state.analysisRunning) return;
        try {
            const res = await fetch(`${API_BASE}/analysis/frame`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`Server responded with status: ${res.status}`);
            const data = await res.json();
            if (data.end_of_stream) { stopAnalysis(); return showNotification("Video analysis finished.", "success"); }
            if (data.error) throw new Error(data.error);

            DOMElements.totalPeopleText.textContent = data.current_count;
            checkAlerts(data.zone_data);
            DOMElements.analysisOverlayFrame.src = `data:image/jpeg;base64,${data.frame_base64}`;
            DOMElements.analysisHeatmapFrame.src = `data:image/jpeg;base64,${data.heatmap_base64}`;
            updateOccupancyList(data.zone_data);
            updateChart(data.zone_data);
            
        } catch (err) { console.error("Error fetching frame data:", err); stopAnalysis(); showNotification("An error occurred during analysis.", "error");}
    }
        
    function initializeChart() {
        state.charts.population = new Chart(DOMElements.populationChartCanvas, {
            type: 'line', data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#e2e8f0' }, grid: { color: '#334155' } }, x: { ticks: { color: '#e2e8f0' }, grid: { color: '#334155' } } }, plugins: { legend: { labels: { color: '#e2e8f0' } } } }
        });
    }

    function resetChart() {
        const chart = state.charts.population;
        chart.data.labels = [];
        chart.data.datasets = state.savedZones.map((zone, index) => ({
            label: zone.name, data: [],
            borderColor: ZONE_COLORS[index % ZONE_COLORS.length],
            backgroundColor: ZONE_COLORS[index % ZONE_COLORS.length].replace('0.7', '0.2'),
            fill: true, tension: 0.4
        }));
        chart.update();
    }
        
    function updateChart(zone_data) {
        const chart = state.charts.population;
        const now = new Date();
        const timeLabel = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        if(chart.data.labels.length > 20) chart.data.labels.shift();
        chart.data.labels.push(timeLabel);
        chart.data.datasets.forEach(dataset => {
            if(dataset.data.length > 20) dataset.data.shift();
            const zone = state.savedZones.find(z => z.name === dataset.label);
            const count = (zone && zone_data[zone.id]) ? zone_data[zone.id].count : 0;
            dataset.data.push(count);
        });
        chart.update('none');
    }

    function updateOccupancyList(zone_data) {
        DOMElements.zoneOccupancyList.innerHTML = "";
        const allZones = [...state.savedZones];
        if (allZones.length === 0) {
            DOMElements.zoneOccupancyList.innerHTML = "<li>No zones defined.</li>";
            return;
        }
        allZones.forEach(zone => {
            const count = zone_data[zone.id] ? zone_data[zone.id].count : 0;
            const li = document.createElement("li");
            li.className = 'zone-occupancy-item';
            li.innerHTML = `<span class="name">${zone.name}</span><span class="count">${count}</span>`;
            DOMElements.zoneOccupancyList.appendChild(li);
        });
    }
        
    function checkAlerts(zone_data) {
        const ZONE_CAPACITIES = { default: 15, "Main Entrance": 20, "Retail Area": 25 };
        const alertBox = DOMElements.alertBox;
        let highAlert = false;
        for (const zoneId in zone_data) {
            const zone = zone_data[zoneId];
            const capacity = ZONE_CAPACITIES[zone.name] || ZONE_CAPACITIES.default;
            if (zone.count > capacity) {
                alertBox.className = 'alert-box alert-danger';
                alertBox.innerHTML = `<i class='bx bxs-error-alt'></i> CRITICAL: ${zone.name} over capacity! (${zone.count}/${capacity})`;
                highAlert = true;
                break;
            }
        }
        if (!highAlert) {
            alertBox.className = 'alert-box alert-info';
            alertBox.innerHTML = `<i class='bx bxs-info-circle'></i> System is nominal. No alerts.`;
        }
    }
        
    function logout() {
        localStorage.clear();
        window.location.href = "/login";
    }

    // --- Initial Kick-off ---
    setupEventListeners();
    DOMElements.usernameDisplay.textContent = localStorage.getItem("username") || "User";
    loadZones();
    initializeChart();
    DOMElements.btnVideoFeed.click();
}