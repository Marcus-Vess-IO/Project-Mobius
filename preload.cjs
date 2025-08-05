const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    onBaselineComplete: (callback) => ipcRenderer.on('baseline-complete', callback),
    onSessionPhase: (callback) => ipcRenderer.on('session-phase', callback),
    onNormalizedData: (callback) => ipcRenderer.on('normalized-data', callback),
    onMood: (callback) => ipcRenderer.on('mood', callback),
    onArtifactAlert: (callback) => ipcRenderer.on('artifact-alert', callback),
    onNeurosityError: (callback) => ipcRenderer.on('neurosity-error', callback),
    onDeviceConnected: (callback) => ipcRenderer.on('device-connected', callback),
    onResetUI: (callback) => ipcRenderer.on('reset-ui', callback),
    onAccelerometerData: (callback) => ipcRenderer.on('accelerometer-data', callback),
    onBufferProgress: (callback) => ipcRenderer.on('buffer-progress', callback)
});