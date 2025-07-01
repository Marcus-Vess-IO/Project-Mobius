import { createNeurosity } from '../../src/neurosity.js';
import { verifyEnvs, getCredentials } from '../../src/auth.js';
import { setupGracefulExit } from '../../src/gracefulExit.js';
import { WebSocketServer } from 'ws';
import open from 'open';
import path from 'path';
import { fileURLToPath } from 'url';

// Authentication and device setup
const { deviceId, email, password } = getCredentials();
verifyEnvs(email, password, deviceId);

// Instantiate Neurosity client
const neurosity = createNeurosity(deviceId);

// Baseline collection settings
const BASELINE_DURATION_SEC = 5;
const baselineData = [];

// WebSocket server for visualization
const wss = new WebSocketServer({ port: 8081 });
function broadcastNormalized(normalized) {
    const msg = JSON.stringify(normalized);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
}

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
            // Avoid division by zero
            return baseline !== 0 ? val / baseline : 0;
        });
    });
    return normalized;
};

// Main function to handle login, data collection, and visualization
const main = async () => {
    try {
        await neurosity.login({ email, password });
        console.log('Logged in. Collecting baseline data...');

        let timerStarted = false;
        let baselineAverages = null;

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

                        // Now filter for valid samples
                        const validBaselineData = baselineData.filter(
                            d =>
                                d &&
                                typeof d === "object" &&
                                d.data &&
                                typeof d.data === "object" &&
                                Object.keys(d.data).length > 0
                        );

                        if (validBaselineData.length > 0) {
                            // Calculate averages from valid baseline data
                            baselineAverages = calculateBaselineAverages(validBaselineData);

                            // Start live normalization after baseline is collected
                            console.log("Starting live normalization...");
                            
                            // Open visualization.html in the default browser
                            const __filename = fileURLToPath(import.meta.url);
                            const __dirname = path.dirname(__filename);
                            const vizPath = path.join(__dirname, 'visualization.html');
                            open(vizPath);

                            const liveSubscription = neurosity.brainwaves("powerByBand").subscribe((liveData) => {
                                if (
                                    liveData &&
                                    typeof liveData === "object" &&
                                    liveData.data &&
                                    typeof liveData.data === "object" &&
                                    Object.keys(liveData.data).length > 0
                                ) {
                                    const normalized = normalizeSample(liveData, baselineAverages);
                                    broadcastNormalized(normalized); // Send to all connected clients
                                }
                            });
                            setupGracefulExit(liveSubscription);

                            // Add a hard timer for 5 minutes (300,000 ms)
                            setTimeout(() => {
                                console.log("Live visualization time limit reached (5 minutes). Exiting program.");
                                liveSubscription.unsubscribe();
                                process.exit(0);
                            }, 5 * 60 * 1000);
                        }
                        // Do not exit here, keep running for live normalization
                    }, BASELINE_DURATION_SEC * 1000);
                }
            }
        });

        setupGracefulExit(subscription);
        
    } catch (err) {
        console.error("Fatal error:", err);
        process.exit(1);
    }
};

main();