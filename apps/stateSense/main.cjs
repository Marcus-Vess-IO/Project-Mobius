const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Import backend logic
const { createNeurosity } = require('../../src/neurosity.js');
const { verifyEnvs, getCredentials } = require('../../src/auth.js');

// --- Authentication and device setup ---
const { deviceId, email, password } = getCredentials();
verifyEnvs(email, password, deviceId);

// --- Globals ---
let mainWindow = null;
let liveSubscription = null;
const BASELINE_DURATION_SEC = 5;
const baselineData = [];
let baselineAverages = null;

// --- Secure cleanup helpers ---
function secureClearArray(arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
        if (typeof arr[i] === "object" && arr[i] !== null) {
            for (const key in arr[i]) {
                arr[i][key] = "cleared";
            }
        }
        arr[i] = "cleared";
    }
    arr.length = 0;
}
function secureClearObject(obj) {
    if (typeof obj !== "object" || obj === null) return;
    for (const key in obj) {
        obj[key] = "cleared";
    }
}
function secureCleanupAndExit(code = 0) {
    try {
        secureClearArray(baselineData);
        secureClearObject(baselineAverages);
        baselineAverages = null;
        if (global.gc) global.gc();
    } catch (e) {
        console.error("Cleanup error:", e);
    }
    process.exit(code);
}

// --- Baseline and normalization helpers ---
function calculateBaselineAverages(baselineData) {
    if (baselineData.length === 0) return null;
    const bandNames = Object.keys(baselineData[0].data);
    const channelCount = baselineData[0].data[bandNames[0]].length;
    const sums = {};
    const counts = baselineData.length;
    bandNames.forEach(band => {
        sums[band] = Array(channelCount).fill(0);
    });
    baselineData.forEach(sample => {
        bandNames.forEach(band => {
            sample.data[band].forEach((val, idx) => {
                sums[band][idx] += val;
            });
        });
    });
    const averages = {};
    bandNames.forEach(band => {
        averages[band] = sums[band].map(sum => sum / counts);
    });
    return averages;
}
function normalizeSample(sample, baselineAverages) {
    const bandNames = Object.keys(baselineAverages);
    const normalized = {};
    bandNames.forEach(band => {
        normalized[band] = sample.data[band].map((val, idx) => {
            const baseline = baselineAverages[band][idx];
            return baseline !== 0 ? val / baseline : 0;
        });
    });
    return normalized;
}

// --- Neurosity backend logic ---
async function startNeurosityBackend(ipcSender) {
    const neurosity = createNeurosity(deviceId);
    try {
        await neurosity.login({ email, password });
        console.log('Logged in. Collecting baseline data...');

        let timerStarted = false;

        // --- Accelerometer subscription ---
        neurosity.accelerometer().subscribe({
            next: (accelData) => {
                // Forward to renderer
                if (ipcSender && !ipcSender.isDestroyed()) {
                    ipcSender.webContents.send('accelerometer-data', accelData);
                }
            },
            error: (err) => {
                console.error("Accelerometer subscription error:", err);
                if (ipcSender && !ipcSender.isDestroyed()) {
                    ipcSender.webContents.send('neurosity-error', err.message || String(err));
                }
            }
        });

        // --- Signal Quality subscription ---
        neurosity.signalQuality().subscribe({
            next: (qualityData) => {
                // Forward to renderer
                if (ipcSender && !ipcSender.isDestroyed()) {
                    ipcSender.webContents.send('signal-quality', qualityData);
                }
            },
            error: (err) => {
                console.error("Signal quality subscription error:", err);
                if (ipcSender && !ipcSender.isDestroyed()) {
                    ipcSender.webContents.send('neurosity-error', err.message || String(err));
                }
            }
        });

        // --- Brainwaves subscription ---
        const subscription = neurosity.brainwaves("powerByBand").subscribe({
            next: (data) => {
                if (
                    data &&
                    typeof data === "object" &&
                    data.data &&
                    typeof data.data === "object" &&
                    Object.keys(data.data).length > 0
                ) {
                    baselineData.push(data);
                    if (!timerStarted) {
                        timerStarted = true;
                        setTimeout(() => {
                            subscription.unsubscribe();
                            console.log("\nBaseline collection complete.");

                            const validBaselineData = baselineData.filter(
                                d =>
                                    d &&
                                    typeof d === "object" &&
                                    d.data &&
                                    typeof d.data === "object" &&
                                    Object.keys(d.data).length > 0
                            );

                            if (validBaselineData.length > 0) {
                                baselineAverages = calculateBaselineAverages(validBaselineData);

                                console.log("Starting live normalization...");

                                liveSubscription = neurosity.brainwaves("powerByBand").subscribe({
                                    next: (liveData) => {
                                        if (
                                            liveData &&
                                            typeof liveData === "object" &&
                                            liveData.data &&
                                            typeof liveData.data === "object" &&
                                            Object.keys(liveData.data).length > 0
                                        ) {
                                            const normalized = normalizeSample(liveData, baselineAverages);
                                            if (ipcSender && !ipcSender.isDestroyed()) {
                                                ipcSender.webContents.send('normalized-data', normalized);
                                            }
                                        }
                                    },
                                    error: (err) => {
                                        console.error("Live brainwave subscription error:", err);
                                        if (ipcSender && !ipcSender.isDestroyed()) {
                                            ipcSender.webContents.send('neurosity-error', err.message || String(err));
                                        }
                                    }
                                });

                                setTimeout(() => {
                                    console.log("Live visualization time limit reached (5 minutes). Exiting program.");
                                    if (liveSubscription) liveSubscription.unsubscribe();
                                    secureCleanupAndExit(0);
                                }, 5 * 60 * 1000);

                            } else {
                                secureCleanupAndExit(1);
                            }
                        }, BASELINE_DURATION_SEC * 1000);
                    }
                }
            },
            error: (err) => {
                console.error("Baseline brainwave subscription error:", err);
                if (ipcSender && !ipcSender.isDestroyed()) {
                    ipcSender.webContents.send('neurosity-error', err.message || String(err));
                }
                secureCleanupAndExit(1);
            }
        });

    } catch (err) {
        console.error("Fatal error:", err);
        if (ipcSender && !ipcSender.isDestroyed()) {
            ipcSender.webContents.send('neurosity-error', err.message || String(err));
        }
        secureCleanupAndExit(1);
    }
}

// --- Electron app setup ---
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'visualization.html'));

    mainWindow.webContents.on('did-finish-load', () => {
        startNeurosityBackend(mainWindow);
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});