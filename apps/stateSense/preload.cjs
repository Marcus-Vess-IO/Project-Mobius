const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onNormalizedData: () => {
        ipcRenderer.on('normalized-data', (event, data) => {
            window.dispatchEvent(new CustomEvent('normalized-data', { detail: data }));
        });
    },
    onNeurosityError: () => {
        ipcRenderer.on('neurosity-error', (event, errorMsg) => {
            window.dispatchEvent(new CustomEvent('neurosity-error', { detail: errorMsg }));
        });
    },
    onAccelerometerData: () => {
        ipcRenderer.on('accelerometer-data', (event, accelData) => {
            window.dispatchEvent(new CustomEvent('accelerometer-data', { detail: accelData }));
        });
    },
    onSignalQuality: () => {
        ipcRenderer.on('signal-quality', (event, data) => {
            window.dispatchEvent(new CustomEvent('signal-quality', { detail: data }));
        });
    }
});