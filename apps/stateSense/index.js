import { createNeurosity } from '../../src/neurosity.js';
import { verifyEnvs, getCredentials } from '../../src/auth.js';
import { setupGracefulExit } from '../../src/gracefulExit.js';
import open from 'open';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import selfsigned from 'selfsigned';
import { WebSocketServer } from 'ws';
import fs from 'fs';

// Authentication and device setup
const { deviceId, email, password } = getCredentials();
verifyEnvs(email, password, deviceId);

// Instantiate Neurosity client
const neurosity = createNeurosity(deviceId);

// Baseline collection settings
const BASELINE_DURATION_SEC = 5;
const baselineData = [];
let baselineAverages = null;
let liveSubscription = null;

// Function to overwrite and nullify sensitive data arrays
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

// Function to nullify sensitive data objects
function secureClearObject(obj) {
    if (typeof obj !== "object" || obj === null) return;
    for (const key in obj) {
        obj[key] = "cleared";
    }
}

// Secure cleanup function for all sensitive data
function secureCleanupAndExit(code = 0) {
    try {
        secureClearArray(baselineData);
        secureClearObject(baselineAverages);
        baselineAverages = null;
        if (global.gc) global.gc();
    } catch (e) {
        // Ignore errors during cleanup
    }
    process.exit(code);
}

// --- Encrypted WebSocket Server Setup (wss://) ---
const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { days: 365 });

const server = https.createServer({
    key: pems.private,
    cert: pems.cert
});

// Serve visualization.html over HTTPS
server.on('request', (req, res) => {
    if (req.url === '/' || req.url === '/visualization.html') {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const vizPath = path.join(__dirname, 'visualization.html');
        fs.readFile(vizPath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Not found');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(8081);

const wss = new WebSocketServer({ server });
function broadcastNormalized(normalized) {
    const msg = JSON.stringify(normalized);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
}

// Subscribe to accelerometer data and broadcast to clients
const accelSubscription = neurosity.accelerometer().subscribe((accelData) => {
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(JSON.stringify({ type: "accel", accel: accelData }));
    });
});
setupGracefulExit({
    unsubscribe: () => {
        accelSubscription.unsubscribe();
        secureCleanupAndExit(0);
    }
});

// Function to calculate baseline averages from collected data
const calculateBaselineAverages = (baselineData) => {
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
};

// Function to normalize a sample against baseline averages
const normalizeSample = (sample, baselineAverages) => {
    const bandNames = Object.keys(baselineAverages);
    const normalized = {};
    bandNames.forEach(band => {
        normalized[band] = sample.data[band].map((val, idx) => {
            const baseline = baselineAverages[band][idx];
            return baseline !== 0 ? val / baseline : 0;
        });
    });
    return normalized;
};


// Save the certificate to disk for manual installation
fs.writeFileSync('localhost-cert.pem', pems.cert);

// Main function to handle login, data collection, and visualization

const main = async () => {
    try {
        await neurosity.login({ email, password });
        console.log('Logged in. Collecting baseline data...');

        let timerStarted = false;

        const subscription = neurosity.brainwaves("powerByBand").subscribe((data) => {
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

                            const __filename = fileURLToPath(import.meta.url);
                            const __dirname = path.dirname(__filename);
                            const vizPath = path.join(__dirname, 'visualization.html');
                            open('https://localhost:8081/visualization.html');

                            liveSubscription = neurosity.brainwaves("powerByBand").subscribe((liveData) => {
                                if (
                                    liveData &&
                                    typeof liveData === "object" &&
                                    liveData.data &&
                                    typeof liveData.data === "object" &&
                                    Object.keys(liveData.data).length > 0
                                ) {
                                    const normalized = normalizeSample(liveData, baselineAverages);
                                    broadcastNormalized(normalized);
                                }
                            });

                            // Hard timer for 5 minutes
                            setTimeout(() => {
                                console.log("Live visualization time limit reached (5 minutes). Exiting program.");
                                if (liveSubscription) liveSubscription.unsubscribe();
                                secureCleanupAndExit(0);
                            }, 5 * 60 * 1000);

                            setupGracefulExit({
                                unsubscribe: () => {
                                    if (liveSubscription) liveSubscription.unsubscribe();
                                    secureCleanupAndExit(0);
                                }
                            });
                        } else {
                            secureCleanupAndExit(1);
                        }
                    }, BASELINE_DURATION_SEC * 1000);
                }
            }
        });

        setupGracefulExit({
            unsubscribe: () => {
                subscription.unsubscribe();
                secureCleanupAndExit(0);
            }
        });

    } catch (err) {
        console.error("Fatal error:", err);
        secureCleanupAndExit(1);
    }
};

main();