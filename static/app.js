// State variables
let webcamStream = null;
let isDetecting = false;
let detectionIntervalId = null;
let isServerOnline = false;

// Stability filtering variables
let lastPredictions = []; // Array of last N predictions
const STABILITY_THRESHOLD = 4; // Number of consecutive frames needed to commit
const CONFIDENCE_COMMIT_THRESHOLD = 0.82; // Minimum confidence to commit a letter
let lastCommittedLetter = ""; // To prevent duplicate repeating letters
let consecutiveLowConfidenceCount = 0;

// UI Elements
const webcamElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay-canvas');
const ctx = canvasElement.getContext('2d');
const cameraOverlay = document.getElementById('camera-overlay');
const scanLine = document.getElementById('scan-line');
const btnToggleCam = document.getElementById('btn-toggle-cam');

const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');

const currentLetterEl = document.getElementById('current-letter');
const currentConfidenceEl = document.getElementById('current-confidence');
const confidenceBar = document.getElementById('confidence-bar');

const translatedTextEl = document.getElementById('translated-text');
const btnSpace = document.getElementById('btn-space');
const btnBackspace = document.getElementById('btn-backspace');
const btnClear = document.getElementById('btn-clear');
const btnSpeak = document.getElementById('btn-speak');
const detectionFeed = document.getElementById('detection-feed');
const btnClearFeed = document.getElementById('btn-clear-feed');

const referenceToggle = document.getElementById('reference-toggle');
const referenceContent = document.getElementById('reference-content');
const refChevron = document.getElementById('ref-chevron');

// Audio Feedback (Synthesized beep)
let audioCtx = null;
function playBeep(freq = 600, duration = 0.08) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.log("Audio not supported or blocked by browser policy");
    }
}

// Check Server Connection on Load
async function checkServerHealth() {
    try {
        // Send a dummy light request or check root
        const res = await fetch('/');
        if (res.ok) {
            setServerStatus(true, "Server Terhubung (Ready)");
        } else {
            setServerStatus(false, "Server Bermasalah");
        }
    } catch (e) {
        setServerStatus(false, "Server Offline. Jalankan app.py!");
    }
}

function setServerStatus(online, text) {
    isServerOnline = online;
    if (online) {
        statusBadge.className = 'status-badge status-online';
        statusText.innerText = text;
    } else {
        statusBadge.className = 'status-badge status-offline';
        statusText.innerText = text;
    }
}

// Toggle reference accordion
referenceToggle.addEventListener('click', () => {
    referenceContent.classList.toggle('collapsed');
    refChevron.classList.toggle('rotated');
});

// Webcam Controls
btnToggleCam.addEventListener('click', async () => {
    if (webcamStream) {
        stopWebcam();
    } else {
        await startWebcam();
    }
});

async function startWebcam() {
    try {
        btnToggleCam.disabled = true;
        btnToggleCam.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menghubungkan...';
        
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            },
            audio: false
        });
        
        webcamElement.srcObject = webcamStream;
        cameraOverlay.classList.add('hidden');
        scanLine.classList.remove('hidden');
        
        btnToggleCam.disabled = false;
        btnToggleCam.className = 'btn btn-outline btn-danger';
        btnToggleCam.innerHTML = '<i class="fa-solid fa-stop"></i> Hentikan Kamera';
        
        // Wait for video metadata to load to set canvas size
        webcamElement.onloadedmetadata = () => {
            canvasElement.width = webcamElement.videoWidth;
            canvasElement.height = webcamElement.videoHeight;
            drawScanningIndicator();
        };

        // Start processing frames
        startDetectionLoop();
    } catch (err) {
        console.error("Error accessing webcam:", err);
        alert("Gagal mengakses kamera. Pastikan izin kamera telah diberikan.");
        btnToggleCam.disabled = false;
        btnToggleCam.className = 'btn btn-primary';
        btnToggleCam.innerHTML = '<i class="fa-solid fa-camera"></i> Mulai Kamera';
    }
}

function stopWebcam() {
    stopDetectionLoop();
    
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    webcamElement.srcObject = null;
    cameraOverlay.classList.remove('hidden');
    scanLine.classList.add('hidden');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    btnToggleCam.className = 'btn btn-primary';
    btnToggleCam.innerHTML = '<i class="fa-solid fa-camera"></i> Mulai Kamera';
    
    // Reset prediction UI
    resetPredictionUI();
}

function resetPredictionUI() {
    currentLetterEl.innerText = '-';
    currentConfidenceEl.innerText = '0%';
    confidenceBar.style.width = '0%';
    lastPredictions = [];
}

// Real-time Detection Loop
function startDetectionLoop() {
    isDetecting = true;
    // Query model 4 times per second (every 250ms)
    detectionIntervalId = setInterval(captureAndPredict, 250);
}

function stopDetectionLoop() {
    isDetecting = false;
    if (detectionIntervalId) {
        clearInterval(detectionIntervalId);
        detectionIntervalId = null;
    }
}

// Drawing scanning indicator
function drawScanningIndicator() {
    if (!webcamStream) return;
    
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Draw visual corner brackets to guide user
    const w = canvasElement.width;
    const h = canvasElement.height;
    const boxSize = Math.min(w, h) * 0.75;
    const x = (w - boxSize) / 2;
    const y = (h - boxSize) / 2;
    
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.4)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    
    const len = 30; // Length of brackets
    
    // Top Left
    ctx.beginPath(); ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    // Top Right
    ctx.beginPath(); ctx.moveTo(x + boxSize, y + len); ctx.lineTo(x + boxSize, y); ctx.lineTo(x + boxSize - len, y); ctx.stroke();
    // Bottom Left
    ctx.beginPath(); ctx.moveTo(x, y + boxSize - len); ctx.lineTo(x, y + boxSize); ctx.lineTo(x + len, y + boxSize); ctx.stroke();
    // Bottom Right
    ctx.beginPath(); ctx.moveTo(x + boxSize, y + boxSize - len); ctx.lineTo(x + boxSize, y + boxSize); ctx.lineTo(x + boxSize - len, y + boxSize); ctx.stroke();
    
    if (isDetecting) {
        requestAnimationFrame(drawScanningIndicator);
    }
}

// Capture frame and send to API
async function captureAndPredict() {
    if (!webcamStream || !isDetecting) return;
    
    // Create a temporary canvas to resize image to 224x224
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 224;
    tempCanvas.height = 224;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Crop center square of video to maintain aspect ratio and match gesture focus
    const videoWidth = webcamElement.videoWidth;
    const videoHeight = webcamElement.videoHeight;
    const size = Math.min(videoWidth, videoHeight);
    const sx = (videoWidth - size) / 2;
    const sy = (videoHeight - size) / 2;
    
    // Draw cropped square onto the 224x224 canvas
    tempCtx.drawImage(webcamElement, sx, sy, size, size, 0, 0, 224, 224);
    
    // Convert to base64 JPEG
    const base64Image = tempCanvas.toDataURL('image/jpeg', 0.85);
    
    try {
        const response = await fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64Image })
        });
        
        if (!response.ok) {
            throw new Error(`Inference API returned status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Update connection status
        setServerStatus(true, "Server Terhubung (Active)");
        
        // Update Real-time UI
        updatePredictionUI(data.letter, data.confidence);
        
        // Apply debounce and stability filtering
        filterAndCommitPrediction(data.letter, data.confidence);
        
    } catch (e) {
        console.error("Prediction failed:", e);
        setServerStatus(false, "Koneksi Terputus / Error API");
    }
}

function updatePredictionUI(letter, confidence) {
    currentLetterEl.innerText = letter;
    const confPercent = Math.round(confidence * 100);
    currentConfidenceEl.innerText = `${confPercent}%`;
    confidenceBar.style.width = `${confPercent}%`;
    
    // Dynamic color depending on confidence
    if (confidence >= CONFIDENCE_COMMIT_THRESHOLD) {
        confidenceBar.style.background = 'var(--secondary)';
        currentLetterEl.style.color = 'var(--secondary)';
    } else if (confidence > 0.5) {
        confidenceBar.style.background = 'var(--primary)';
        currentLetterEl.style.color = 'var(--primary)';
    } else {
        confidenceBar.style.background = 'var(--danger)';
        currentLetterEl.style.color = 'var(--text-muted)';
    }
}

// Stability & Debounce filtering
function filterAndCommitPrediction(letter, confidence) {
    // 1. If confidence is low, register as neutral/noise
    if (confidence < 0.5) {
        lastPredictions.push("?");
        consecutiveLowConfidenceCount++;
        
        // If hand is removed for 5 frames (approx 1.25s), allow repeating the same letter again
        if (consecutiveLowConfidenceCount >= 5) {
            lastCommittedLetter = "";
        }
    } else {
        lastPredictions.push(letter);
        consecutiveLowConfidenceCount = 0;
    }
    
    // Keep array size capped
    if (lastPredictions.length > STABILITY_THRESHOLD) {
        lastPredictions.shift();
    }
    
    // 2. Check if we have enough stable predictions
    if (lastPredictions.length === STABILITY_THRESHOLD) {
        // Are all items in the history the same letter and not neutral?
        const first = lastPredictions[0];
        const allSame = lastPredictions.every(val => val === first && val !== "?");
        
        if (allSame && first !== lastCommittedLetter && confidence >= CONFIDENCE_COMMIT_THRESHOLD) {
            commitLetter(first, confidence);
        }
    }
}

function commitLetter(letter, confidence) {
    lastCommittedLetter = letter;
    lastPredictions = []; // Reset stability array to wait for next gesture
    
    playBeep(650, 0.1); // Success audio cue
    
    // Append to output textbox
    appendLetterToText(letter);
    
    // Add to history list feed
    addHistoryItem(letter, confidence);
    
    // Flash visual indicator on canvas
    flashCanvasBorder();
}

function appendLetterToText(letter) {
    if (translatedTextEl.classList.contains('empty') || translatedTextEl.innerText === "Mulai peragakan isyarat...") {
        translatedTextEl.innerText = letter;
        translatedTextEl.classList.remove('empty');
    } else {
        translatedTextEl.innerText += letter;
    }
}

function addHistoryItem(letter, confidence) {
    // Remove placeholder if present
    const placeholder = detectionFeed.querySelector('.feed-placeholder');
    if (placeholder) {
        placeholder.remove();
    }
    
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const confPercent = Math.round(confidence * 100);
    
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `
        <span class="letter">${letter}</span>
        <span class="meta-time">${timeStr}</span>
        <span class="meta-conf">${confPercent}% cocok</span>
    `;
    
    detectionFeed.prepend(item);
    
    // Limit log to last 15 items
    if (detectionFeed.children.length > 15) {
        detectionFeed.removeChild(detectionFeed.lastChild);
    }
}

function flashCanvasBorder() {
    canvasElement.style.boxShadow = '0 0 25px var(--secondary-glow)';
    canvasElement.style.borderColor = 'var(--secondary)';
    setTimeout(() => {
        canvasElement.style.boxShadow = 'none';
        canvasElement.style.borderColor = 'rgba(255, 255, 255, 0.05)';
    }, 450);
}

// Workspace actions
btnSpace.addEventListener('click', () => {
    playBeep(450, 0.06);
    if (!translatedTextEl.classList.contains('empty') && translatedTextEl.innerText !== "Mulai peragakan isyarat...") {
        translatedTextEl.innerText += " ";
    }
});

btnBackspace.addEventListener('click', () => {
    playBeep(400, 0.06);
    if (translatedTextEl.classList.contains('empty') || translatedTextEl.innerText === "Mulai peragakan isyarat...") return;
    
    const txt = translatedTextEl.innerText;
    if (txt.length <= 1) {
        clearText();
    } else {
        translatedTextEl.innerText = txt.substring(0, txt.length - 1);
    }
});

btnClear.addEventListener('click', () => {
    playBeep(300, 0.12);
    clearText();
});

btnClearFeed.addEventListener('click', () => {
    playBeep(350, 0.08);
    clearFeed();
});

function clearFeed() {
    detectionFeed.innerHTML = '<div class="feed-placeholder">Belum ada huruf yang tersimpan</div>';
    lastCommittedLetter = "";
}

function clearText() {
    translatedTextEl.innerText = "Mulai peragakan isyarat...";
    translatedTextEl.classList.add('empty');
    lastCommittedLetter = "";
}

btnSpeak.addEventListener('click', () => {
    if (translatedTextEl.classList.contains('empty') || translatedTextEl.innerText === "Mulai peragakan isyarat...") return;
    
    const speakText = translatedTextEl.innerText.trim();
    if (!speakText) return;
    
    // Web Speech API
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(speakText);
        utterance.lang = 'id-ID'; // Set language to Indonesian
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
    } else {
        alert("Text-to-speech tidak didukung di browser ini.");
    }
});

// Run server check on startup
checkServerHealth();
// Set up polling for server health status when camera is off
setInterval(() => {
    if (!webcamStream) {
        checkServerHealth();
    }
}, 5000);
