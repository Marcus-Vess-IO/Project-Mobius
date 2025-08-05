// --- Robust statistics helpers ---
function calcMedian(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calcMAD(arr, median) {
    if (!arr.length) return 1;
    const deviations = arr.map(x => Math.abs(x - median));
    const mad = calcMedian(deviations);
    // Consistency constant for normal distribution
    return mad * 1.4826 || 1;
}

function calcRobustStats(arr) {
    if (!arr.length) return { median: 0, mad: 1 };
    const median = calcMedian(arr);
    const mad = calcMAD(arr, median);
    return { median, mad };
}

// --- Sliding window helper ---
function createSlidingWindow(bandNames, channelCount, windowSize) {
    const window = {};
    bandNames.forEach(band => {
        window[band] = [];
        for (let i = 0; i < channelCount; i++) {
            window[band][i] = [];
        }
    });
    return window;
}

function addSampleToWindow(window, sample, windowSize) {
    const bandNames = Object.keys(sample.data);
    bandNames.forEach(band => {
        sample.data[band].forEach((val, idx) => {
            window[band][idx].push(val);
            if (window[band][idx].length > windowSize) {
                window[band][idx].shift();
            }
        });
    });
}

// --- Artifact timers ---
function resetArtifactTimers(bandNames, channelCount) {
    const heldChannels = {};
    const heldChannelTimers = {};
    bandNames.forEach(band => {
        heldChannels[band] = Array(channelCount).fill(false);
        heldChannelTimers[band] = Array(channelCount).fill(0);
    });
    return { heldChannels, heldChannelTimers };
}

module.exports = {
    calcMedian,
    calcMAD,
    calcRobustStats,
    createSlidingWindow,
    addSampleToWindow,
    resetArtifactTimers
};