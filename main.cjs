const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createNeurosity } = require('./src/neurosity.js');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const THREE = require('three');
require('dotenv').config();

const {
    calcMedian,
    calcMAD,
    calcRobustStats,
    createSlidingWindow,
    addSampleToWindow,
    resetArtifactTimers
} = require('./src/dataUtils.cjs');

const EMOTION_COLORS = {
    happy:   { r: 255, g: 255, b: 0 },
    angry:   { r: 255, g: 0,   b: 0 },
    relaxed: { r: 0,   g: 0,   b: 255 },
    bored:   { r: 0,   g: 255, b: 0 }
};
const CHANNEL_NAMES = ["F5", "F6", "C3", "C4", "P7", "P8", "O1", "O2"];
const ALL_BANDS = ["delta", "theta", "alpha", "beta", "gamma"];

let previousSessionPhase = null;

class SessionManager {
    constructor() {
        this.devices = [
            {
                name: "Crown A",
                deviceId: process.env.DEVICE_ID_A,
                email: process.env.EMAIL_A,
                password: process.env.PASSWORD_A
            },
            {
                name: "Crown B",
                deviceId: process.env.DEVICE_ID_B,
                email: process.env.EMAIL_B,
                password: process.env.PASSWORD_B
            }
        ];
        this.currentDeviceIdx = null;
        this.neurosity = null;
        this.arduinoPort = null;
        this.arduinoParser = null;
        this.mainWindow = null;

        this.sessionPhase = "idle";
        this.liveSubscription = null;
        this.signalQualitySubscription = null;
        this.accelerometerSubscription = null;

        this.slidingWindow = null;
        this.heldChannels = {};
        this.heldChannelTimers = {};
        this.artifactAlertActive = false;

        this.valenceBuffer = [];
        this.arousalBuffer = [];
        this.lastValence = 0;
        this.lastArousal = 0;
        this.lastEmotion = null;

        this.rainbowInterval = null;
        this.rainbowPhase = 0;
        this.manualLEDOverride = null;

        this.menuToggles = {
            signalQuality: false,
            sphereVisibility: false
        };

        this.SAMPLING_RATE = 4;
        this.SLIDING_WINDOW_SECONDS = 10;
        this.SLIDING_WINDOW_SIZE = this.SLIDING_WINDOW_SECONDS * this.SAMPLING_RATE;
        this.ARTIFACT_Z_THRESHOLD = 3;
        this.ARTIFACT_SINGLE_CHANNEL_SECONDS = 8;
        this.ARTIFACT_MULTI_CHANNEL_SECONDS = 5;

        this.VALENCE_WINDOW_SIZE = 20 * 4;
        this.VALENCE_STEP = 10 * 4;
        this.AROUSAL_WINDOW_SIZE = 10 * 4;
        this.AROUSAL_STEP = 5 * 4;
    }

    async connectDevice(idx) {
        console.log("Connecting to device", idx);
        await this.disconnectDevice();
        this.currentDeviceIdx = idx;
        const device = this.devices[idx];
        this.neurosity = createNeurosity(device.deviceId);
        await this.neurosity.login({ email: device.email, password: device.password });
        this.emit('device-connected', device.name);
        this.subscribeStreamsWithBuffer();
    }
    async disconnectDevice() {
        if (this.liveSubscription) this.liveSubscription.unsubscribe();
        if (this.signalQualitySubscription) this.signalQualitySubscription.unsubscribe();
        if (this.accelerometerSubscription) this.accelerometerSubscription.unsubscribe();
        this.neurosity = null;
    }

    async resetSession() {
        if (!this.neurosity) return;
        if (this.liveSubscription) this.liveSubscription.unsubscribe();

        this.clearDataBuffers();
        this.safeEmitPhase("buffering");
        this.startRainbow();

        const minBufferDisplayMs = 2000;
        let bufferSamples = [];
        let bufferStartTime = Date.now();

        this.liveSubscription = this.neurosity.brainwaves("powerByBand").subscribe({
            next: sample => {
                // Ensure all bands are present in every sample
                ALL_BANDS.forEach(band => {
                    if (!sample.data[band]) {
                        sample.data[band] = Array(CHANNEL_NAMES.length).fill(0);
                    }
                });
                bufferSamples.push(sample);

                // Emit buffer progress to renderer
                const progress = Math.min(bufferSamples.length / this.SLIDING_WINDOW_SIZE, 1);
                this.emit('buffer-progress', progress);

                const elapsed = (Date.now() - bufferStartTime) / 1000;
                if (bufferSamples.length >= this.SLIDING_WINDOW_SIZE && elapsed >= this.SLIDING_WINDOW_SECONDS) {
                    const channelCount = CHANNEL_NAMES.length;
                    this.slidingWindow = createSlidingWindow(ALL_BANDS, channelCount, this.SLIDING_WINDOW_SIZE);
                    const { heldChannels, heldChannelTimers } = resetArtifactTimers(ALL_BANDS, channelCount);
                    this.heldChannels = heldChannels;
                    this.heldChannelTimers = heldChannelTimers;
                    bufferSamples.forEach(sample => addSampleToWindow(this.slidingWindow, sample, this.SLIDING_WINDOW_SIZE));
                    this.emit('baseline-complete');
                    const timeSinceBufferStart = Date.now() - bufferStartTime;
                    const delay = Math.max(0, minBufferDisplayMs - timeSinceBufferStart);
                    setTimeout(() => {
                        this.safeEmitPhase("live");
                        this.startLiveNormalization(ALL_BANDS, channelCount);
                        this.liveSubscription.unsubscribe();
                    }, delay);
                }
            },
            error: err => this.emit('neurosity-error', err.message || String(err))
        });
    }

    // Startup Sequence
    async subscribeStreamsWithBuffer() {
        console.log("Subscribing to streams");
        if (this.liveSubscription) this.liveSubscription.unsubscribe();
        if (this.signalQualitySubscription) this.signalQualitySubscription.unsubscribe();
        if (this.accelerometerSubscription) this.accelerometerSubscription.unsubscribe();

        this.accelerometerSubscription = this.neurosity.accelerometer().subscribe({
            next: data => {
                this.emit('accelerometer-data', { x: data.x, y: data.y, z: data.z });
            },
            error: err => this.emit('neurosity-error', err.message || String(err))
        });

        this.signalQualitySubscription = this.neurosity.signalQuality().subscribe({
            next: data => this.emit('signal-quality', data),
            error: err => this.emit('neurosity-error', err.message || String(err))
        });

        // --- Startup Sequence ---
        this.safeEmitPhase("relax");
        ipcMain.removeAllListeners('placement-complete');
        setTimeout(() => {
            this.safeEmitPhase("placement");
            ipcMain.once('placement-complete', () => {
                this.clearDataBuffers();
                this.safeEmitPhase("buffering");
                this.startRainbow();

                const minBufferDisplayMs = 2000;
                let bufferSamples = [];
                let bufferStartTime = Date.now();

                this.liveSubscription = this.neurosity.brainwaves("powerByBand").subscribe({
                    next: sample => {
                        ALL_BANDS.forEach(band => {
                            if (!sample.data[band]) {
                                sample.data[band] = Array(CHANNEL_NAMES.length).fill(0);
                            }
                        });
                        bufferSamples.push(sample);

                        // Emit buffer progress to renderer
                        const progress = Math.min(bufferSamples.length / this.SLIDING_WINDOW_SIZE, 1);
                        this.emit('buffer-progress', progress);

                        const elapsed = (Date.now() - bufferStartTime) / 1000;
                        if (bufferSamples.length >= this.SLIDING_WINDOW_SIZE && elapsed >= this.SLIDING_WINDOW_SECONDS) {
                            const channelCount = CHANNEL_NAMES.length;
                            this.slidingWindow = createSlidingWindow(ALL_BANDS, channelCount, this.SLIDING_WINDOW_SIZE);
                            const { heldChannels, heldChannelTimers } = resetArtifactTimers(ALL_BANDS, channelCount);
                            this.heldChannels = heldChannels;
                            this.heldChannelTimers = heldChannelTimers;
                            bufferSamples.forEach(sample => addSampleToWindow(this.slidingWindow, sample, this.SLIDING_WINDOW_SIZE));
                            this.emit('baseline-complete');
                            const timeSinceBufferStart = Date.now() - bufferStartTime;
                            const delay = Math.max(0, minBufferDisplayMs - timeSinceBufferStart);
                            setTimeout(() => {
                                this.safeEmitPhase("live");
                                this.startLiveNormalization(ALL_BANDS, channelCount);
                                this.liveSubscription.unsubscribe();
                            }, delay);
                        }
                    },
                    error: err => this.emit('neurosity-error', err.message || String(err))
                });
            });
        }, 5000); // 5 seconds relax phase
    }

    async restartSession() {
    }
    clearAllState() {
        this.clearDataBuffers();
        this.menuToggles = { signalQuality: false, sphereVisibility: false };
        this.manualLEDOverride = null;
        this.sessionPhase = "idle";
        this.lastEmotion = null;
        this.stopRainbow();
        this.emit('reset-ui');
    }
    clearDataBuffers() {
        this.slidingWindow = null;
        this.heldChannels = {};
        this.heldChannelTimers = {};
        this.artifactAlertActive = false;
        this.valenceBuffer = [];
        this.arousalBuffer = [];
        this.lastValence = 0;
        this.lastArousal = 0;
    }

    startRainbow() {
        if (this.rainbowInterval) return;
        this.rainbowInterval = setInterval(() => {
            this.rainbowPhase += 0.08;
            const r = Math.round(127 * (Math.sin(this.rainbowPhase) + 1));
            const g = Math.round(127 * (Math.sin(this.rainbowPhase + 2) + 1));
            const b = Math.round(127 * (Math.sin(this.rainbowPhase + 4) + 1));
            if (this.arduinoPort) this.arduinoPort.write(`${r},${g},${b}\n`);
        }, 80);
    }
    stopRainbow() {
        if (this.rainbowInterval) {
            clearInterval(this.rainbowInterval);
            this.rainbowInterval = null;
        }
        if (this.arduinoPort) this.arduinoPort.write("0,0,0\n");
    }
    setLEDColor(r, g, b) {
        this.stopRainbow();
        if (this.arduinoPort) this.arduinoPort.write(`${r},${g},${b}\n`);
    }
    setManualLEDOverride(color) {
        this.manualLEDOverride = color;
        if (color) {
            this.setLEDColor(color.r, color.g, color.b);
        }
    }

    startLiveNormalization(bandNames, channelCount) {
        if (!this.neurosity) return;
        let prevValid = null;
        this.liveSubscription = this.neurosity.brainwaves("powerByBand").subscribe({
            next: sample => {
                // Ensure all bands are present
                ALL_BANDS.forEach(band => {
                    if (!sample.data[band]) {
                        sample.data[band] = Array(channelCount).fill(0);
                    }
                });

                addSampleToWindow(this.slidingWindow, sample, this.SLIDING_WINDOW_SIZE);

                // --- Artifact rejection and normalization for visualization ---
                const normalized = {};
                let heldCount = 0;
                let heldChannelsList = [];
                ALL_BANDS.forEach(band => {
                    normalized[band] = [];
                    for (let c = 0; c < channelCount; c++) {
                        const arr = this.slidingWindow[band][c];
                        const { median, mad } = calcRobustStats(arr);
                        const z = mad ? (sample.data[band][c] - median) / mad : 0;
                        if (Math.abs(z) > this.ARTIFACT_Z_THRESHOLD) {
                            this.heldChannels[band][c] = true;
                            this.heldChannelTimers[band][c]++;
                            heldCount++;
                            heldChannelsList.push({ band, channel: c, timer: this.heldChannelTimers[band][c] });
                            normalized[band][c] = prevValid && prevValid[band] ? prevValid[band][c] : 0;
                        } else {
                            this.heldChannels[band][c] = false;
                            this.heldChannelTimers[band][c] = 0;
                            normalized[band][c] = z;
                        }
                    }
                });
                prevValid = normalized;

                // Artifact alert logic
                let maxHeld = 0;
                let multiHeld = 0;
                for (const band of ALL_BANDS) {
                    for (let c = 0; c < channelCount; c++) {
                        if (this.heldChannelTimers[band][c] >= this.ARTIFACT_SINGLE_CHANNEL_SECONDS) maxHeld++;
                        if (this.heldChannelTimers[band][c] >= this.ARTIFACT_MULTI_CHANNEL_SECONDS) multiHeld++;
                    }
                }
                if (!this.artifactAlertActive && (maxHeld >= 1 || multiHeld >= 2)) {
                    this.artifactAlertActive = true;
                    this.emit('artifact-alert');
                }
                if (this.artifactAlertActive && maxHeld === 0 && multiHeld < 2) {
                    this.artifactAlertActive = false;
                }

                this.emit('normalized-data', normalized);

                // --- MindSight Mood Detection ---
                this.valenceBuffer.push(sample);
                this.arousalBuffer.push(sample);
                if (this.valenceBuffer.length > this.VALENCE_WINDOW_SIZE)
                    this.valenceBuffer.shift();
                if (this.arousalBuffer.length > this.AROUSAL_WINDOW_SIZE)
                    this.arousalBuffer.shift();

                if (this.valenceBuffer.length === this.VALENCE_WINDOW_SIZE) {
                    const valenceScores = this.valenceBuffer
                        .map(s => this.computeValenceSample(s, CHANNEL_NAMES))
                        .filter(v => typeof v === "number" && isFinite(v));
                    const valence = this.mean(valenceScores);
                    this.lastValence = valence;

                    let arousalValue = 0;
                    if (this.arousalBuffer.length === this.AROUSAL_WINDOW_SIZE) {
                        const arousalScores = this.arousalBuffer
                            .map(s => this.computeArousalSample(s))
                            .filter(v => typeof v === "number" && isFinite(v));
                        arousalValue = this.mean(arousalScores);
                        this.lastArousal = arousalValue;
                    } else {
                        const arousalScores = this.valenceBuffer
                            .map(s => this.computeArousalSample(s))
                            .filter(v => typeof v === "number" && isFinite(v));
                        arousalValue = this.mean(arousalScores);
                        this.lastArousal = arousalValue;
                    }

                    const emotion = this.getEmotion(valence, arousalValue);
                    if (emotion !== this.lastEmotion && !this.manualLEDOverride) {
                        this.lastEmotion = emotion;
                        const { r, g, b } = EMOTION_COLORS[emotion];
                        this.setLEDColor(r, g, b);
                    }
                    this.emit('mood', { valence, arousal: arousalValue, emotion });

                    this.valenceBuffer = this.valenceBuffer.slice(this.VALENCE_STEP);
                    this.arousalBuffer = this.arousalBuffer.slice(this.AROUSAL_STEP);
                }
            },
            error: err => this.emit('neurosity-error', err.message || String(err))
        });
    }
    mean(arr) {
        if (!arr || !arr.length) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }
    computeValenceSample(sample, chNames) {
        if (!sample || !sample.data || !Array.isArray(sample.data.alpha)) return 0;
        const alpha = sample.data.alpha;
        const leftIdx = chNames.indexOf("F5");
        const rightIdx = chNames.indexOf("F6");
        if (leftIdx === -1 || rightIdx === -1) return 0;
        const safeAlphaLeft = Math.max(alpha[leftIdx], 1e-6);
        const safeAlphaRight = Math.max(alpha[rightIdx], 1e-6);
        return Math.log(safeAlphaRight) - Math.log(safeAlphaLeft);
    }
    computeArousalSample(sample) {
        if (!sample || !sample.data || !Array.isArray(sample.data.beta) || !Array.isArray(sample.data.alpha)) return 0;
        const beta = sample.data.beta;
        const alpha = sample.data.alpha;
        return this.mean(beta) / Math.max(this.mean(alpha), 1e-6);
    }
    getEmotion(valence, arousal) {
        if (valence >= 0 && arousal >= 0) return "happy";
        if (valence < 0 && arousal >= 0)  return "angry";
        if (valence < 0 && arousal < 0)   return "bored";
        if (valence >= 0 && arousal < 0)  return "relaxed";
        return "relaxed";
    }
    emit(channel, data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, data);
        }
    }
    safeEmitPhase(phase) {
        this.sessionPhase = phase;
        this.emit('session-phase', phase);
    }
}

const ARDUINO_PORT = 'COM6';
const BAUD_RATE = 115200;
const sessionManager = new SessionManager();

function createWindow() {
    sessionManager.mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        fullscreen: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    sessionManager.mainWindow.loadFile(path.join(__dirname, 'visualization.html'));
    sessionManager.mainWindow.once('ready-to-show', () => {
        sessionManager.mainWindow.show();
    });
}

app.whenReady().then(() => {
    sessionManager.arduinoPort = new SerialPort({ path: ARDUINO_PORT, baudRate: BAUD_RATE });
    sessionManager.arduinoParser = sessionManager.arduinoPort.pipe(new ReadlineParser({ delimiter: '\n' }));
    sessionManager.arduinoPort.on('open', () => console.log('Serial port open:', ARDUINO_PORT));
    sessionManager.arduinoPort.on('error', err => console.error('Serial port error:', err));
    createWindow();
});

app.on('before-quit', () => {
    sessionManager.disconnectDevice();
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// --- IPC handlers ---
ipcMain.on('set-led-override', (event, color) => sessionManager.setManualLEDOverride(color));
ipcMain.on('clear-led-override', () => sessionManager.setManualLEDOverride(null));
ipcMain.on('select-device', (event, idx) => sessionManager.connectDevice(idx));
ipcMain.on('start-baseline', () => sessionManager.subscribeStreamsWithBuffer());

ipcMain.on('start-placement-assist', () => {
    if (sessionManager.sessionPhase !== "placement-assist") {
        previousSessionPhase = sessionManager.sessionPhase;
        sessionManager.safeEmitPhase("placement-assist");
    }
});
ipcMain.on('placement-complete', () => {
    if (sessionManager.sessionPhase === "placement-assist") {
        sessionManager.safeEmitPhase(previousSessionPhase || "live");
    }
    // For startup sequence, handled by subscribeStreamsWithBuffer
});

// --- Full app restart handler ---
ipcMain.on('full-restart', () => {
    app.relaunch();
    app.exit(0);
});

module.exports = { sessionManager };