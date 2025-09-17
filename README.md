## Overview

This repository contains a full-stack demo application for real-time BCI visualization and mood detection using the Neurosity Crown EEG headset. The app guides users through device selection, headset placement, data buffering, artifact-robust normalization, mood inference, and 3D visualization. It also provides hardware feedback via an Arduino-controlled LED.

---

## Table of Contents

- [Architecture](#architecture)
- [Software Flow](#software-flow)
- [Key Features](#key-features)
- [File Structure](#file-structure)
- [Setup & Installation](#setup--installation)
- [Running the Application](#running-the-application)
- [Hardware Integration](#hardware-integration)
- [Customization](#customization)
- [Troubleshooting](#troubleshooting)
- [Contact](#contact)

---

## Architecture

- **Frontend:** Electron, Three.js, HTML/CSS/JS
- **Backend:** Node.js (Electron main process), Neurosity SDK, SerialPort (Arduino)
- **Hardware:** Neurosity Crown EEG, Arduino Nano Every (BlinkM LED)
- **Data Handling:** Sliding window, robust normalization, artifact rejection, mood inference

---

## Software Flow

1. **Launch**
    - App opens in fullscreen mode.
    - Loads `visualization.html` UI.

2. **Device Selection**
    - Modal prompts user to select a Neurosity Crown device.
    - Credentials are loaded from environment variables.

3. **Startup Sequence**
    - **Relax Phase:** Modal instructs user to remain still (5 seconds).
    - **Placement Assist:** Modal guides user to adjust headset using real-time accelerometer data.
    - **Buffering:** Modal shows progress bar as 10 seconds of EEG data are buffered (4Hz, 40 samples/channel).

4. **Live Session**
    - Maintains a sliding window of brainwave data.
    - Normalizes each sample using robust statistics (median, MAD).
    - Detects artifacts (z-score threshold, held channels).
    - Visualizes dominant frequency bands on a 3D brain mesh.
    - Infers mood/emotion from valence/arousal and displays in UI.
    - Controls LED color via Arduino based on mood or manual override.

5. **User Controls**
    - Sidebar menu for restart, placement assist, sensor spheres, LED mode.
    - Modals for device selection, relax, placement assist, buffering, artifact alerts.

6. **Session Reset & Restart**
    - User can reset session or restart app from menu.
    - All buffers and UI states are cleared on reset.

7. **Error Handling**
    - Device errors and artifact alerts shown as overlays.
    - Serial/connection errors logged and displayed.

---

## Key Features

- **Device selection and authentication**
- **Placement assist with accelerometer feedback**
- **Real-time sample buffering and progress bar**
- **Sliding window normalization and artifact rejection**
- **Mood/emotion inference (valence/arousal)**
- **3D brain visualization (Three.js)**
- **LED feedback via Arduino**
- **Modular UI with menu and modals**
- **Robust error handling**

---

## File Structure

```
hello-world/
├── main.cjs                # Electron main process (Node.js backend)
├── preload.cjs             # Electron preload script (secure API bridge)
├── visualization.html      # Renderer (frontend UI, Three.js visualization)
├── mindSight_NanoEvery.ino # Arduino Nano Every firmware for LED control
├── src/
│   ├── neurosity.js        # Neurosity SDK wrapper
│   └── dataUtils.cjs       # Data pipeline utilities (sliding window, stats)
├── brain.obj               # 3D brain mesh (OBJ format)
├── package.json            # Node/Electron dependencies
├── .env                    # Device credentials (not committed)
└── ...                     # Other assets and configs
```

---

## Setup & Installation

1. **Clone the repository**
    ```sh
    git clone https://github.com/YOUR-ORG/hello-world.git
    cd hello-world
    ```

2. **Install dependencies**
    ```sh
    npm install
    ```

3. **Configure environment variables**
    - Create a `.env` file with your Neurosity device credentials:
      ```
      DEVICE_ID_A=your_device_id_a
      EMAIL_A=your_email_a
      PASSWORD_A=your_password_a
      DEVICE_ID_B=your_device_id_b
      EMAIL_B=your_email_b
      PASSWORD_B=your_password_b
      ```

4. **Connect hardware**
    - Neurosity Crown EEG headset (paired via Neurosity SDK).
    - Arduino Nano Every connected via USB (COM port, default `COM6`).
    - BlinkM LED module connected to Arduino (I2C).

---

## Running the Application

```sh
npm start
```
- App launches in fullscreen.
- Follow on-screen prompts for device selection and placement.
- Data visualization and LED feedback begin after buffering.

---

## Hardware Integration

- **Arduino Nano Every:** Runs `mindSight_NanoEvery.ino` firmware.
    - Listens for serial RGB commands from Electron app.
    - Controls BlinkM LED via I2C.
- **SerialPort:** Configured in `main.cjs` (`COM6`, `115200` baud).
    - Update port as needed for your system.

---

## Customization

- **Brain mesh:** Replace `brain.obj` for different models.
- **LED logic:** Modify color mapping in `main.cjs` and Arduino firmware.
- **Session parameters:** Adjust sampling rate, window size, artifact thresholds in `main.cjs`.
- **UI:** Modify `visualization.html` for custom visuals or controls.

---

## Troubleshooting

- **Device connection issues:** Check `.env` credentials and Neurosity SDK pairing.
- **Serial/LED issues:** Verify Arduino port and BlinkM wiring.
- **Visualization errors:** Ensure `brain.obj` is present and Three.js dependencies are installed.
- **Environment variables:** Never commit `.env` with credentials to public repos.

---

## Contact

For technical questions, please contact Marcus Vess at marcus.vess@iohk.io

---
