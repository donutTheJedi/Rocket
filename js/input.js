import { ROCKET_CONFIG } from './constants.js';
import { state, initState, getAltitude } from './state.js';
import { resetGuidance } from './guidance.js';
import { addEvent } from './events.js';
import { updateTelemetry } from './telemetry.js';
import { getCanvas, resize } from './renderer.js';

// Speed settings
const speeds = [1, 2, 5, 10, 25, 50, 100, 500, 1000];
let speedIdx = 0;

// Active burn button tracking
let activeBurnButton = null;

// Stop the current burn
function stopBurn() {
    if (state.burnMode && state.burnStartTime !== null) {
        const burnNames = {
            'prograde': 'PROGRADE',
            'retrograde': 'RETROGRADE',
            'normal': 'NORMAL',
            'anti-normal': 'ANTI-NORMAL',
            'radial': 'RADIAL',
            'anti-radial': 'ANTI-RADIAL'
        };
        const duration = (state.time - state.burnStartTime).toFixed(1);
        addEvent(`${burnNames[state.burnMode]} burn ended (${duration}s)`);
        state.burnMode = null;
        state.burnStartTime = null;
        state.engineOn = false;
        activeBurnButton = null;
    }
}

// Setup burn button event handlers
function setupBurnButton(buttonId, burnMode) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const pitchProgramComplete = state.time > 600 || (!state.engineOn && getAltitude() > 150000);
        if (pitchProgramComplete && getAltitude() > 150000) {
            if (state.burnMode) {
                stopBurn();
            }
            state.burnMode = burnMode;
            state.burnStartTime = state.time;
            activeBurnButton = btn;
            addEvent(`${burnMode.toUpperCase()} burn started`);
        }
    });
    btn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        if (state.burnMode === burnMode) {
            stopBurn();
        }
    });
    btn.addEventListener('mouseleave', () => {
        if (state.burnMode === burnMode && activeBurnButton === btn) {
            stopBurn();
        }
    });
}

// Initialize all input handlers
export function initInput() {
    // Window resize
    window.addEventListener('resize', resize);
    
    // Launch button
    document.getElementById('launch-btn').addEventListener('click', () => {
        if (!state.running && state.time === 0) {
            console.log("console running")
            state.running = true;
            state.engineOn = true;
            addEvent("LIFTOFF!");
            document.getElementById('launch-btn').disabled = true;
            document.getElementById('launch-btn').style.display = 'none';
            document.getElementById('pause-btn').style.display = 'inline-block';
        }
    });
    
    // Pause button
    document.getElementById('pause-btn').addEventListener('click', () => {
        if (state.running) {
            state.running = false;
            document.getElementById('pause-btn').textContent = 'RESUME';
            addEvent("PAUSED");
        } else {
            state.running = true;
            document.getElementById('pause-btn').textContent = 'PAUSE';
            addEvent("RESUMED");
        }
    });
    
    // Reset button
    document.getElementById('reset-btn').addEventListener('click', () => {
        initState();
        resetGuidance();
        document.getElementById('launch-btn').disabled = false;
        document.getElementById('launch-btn').style.display = 'inline-block';
        document.getElementById('pause-btn').style.display = 'none';
        document.getElementById('pause-btn').textContent = 'PAUSE';
        updateTelemetry();
    });
    
    // Speed button
    document.getElementById('speed-btn').addEventListener('click', () => {
        speedIdx = (speedIdx + 1) % speeds.length;
        state.timeWarp = speeds[speedIdx];
        document.getElementById('speed-btn').textContent = speeds[speedIdx] + 'x';
    });
    
    // Zoom out button
    document.getElementById('zoom-out-btn').addEventListener('click', () => {
        state.manualZoom /= 2.0;
        if (state.manualZoom < 0.1) state.manualZoom = 0.1;
    });
    
    // Zoom in button
    document.getElementById('zoom-in-btn').addEventListener('click', () => {
        state.manualZoom *= 2.0;
        if (state.cameraMode === 'rocket' && state.manualZoom > 10000) state.manualZoom = 10000;
    });
    
    // Auto zoom button
    document.getElementById('zoom-auto-btn').addEventListener('click', () => {
        state.autoZoom = !state.autoZoom;
        document.getElementById('zoom-auto-btn').textContent = state.autoZoom ? 'AUTO ZOOM' : 'MANUAL ZOOM';
        if (!state.autoZoom) {
            state.manualZoom = 1.0;
        }
    });
    
    // Camera button
    document.getElementById('camera-btn').addEventListener('click', () => {
        state.cameraMode = state.cameraMode === 'rocket' ? 'earth' : 'rocket';
        document.getElementById('camera-btn').textContent = state.cameraMode === 'rocket' ? 'FOLLOW ROCKET' : 'CENTER EARTH';
        if (state.cameraMode === 'earth') {
            state.manualZoom = 1.0;
            state.autoZoom = false;
        }
    });
    
    // Mouse wheel zoom
    const canvas = getCanvas();
    if (canvas) {
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 1/1.3 : 1.3;
            state.manualZoom *= zoomFactor;
            if (state.manualZoom < 0.1) state.manualZoom = 0.1;
            if (state.cameraMode === 'rocket' && state.manualZoom > 10000) state.manualZoom = 10000;
        });
    }
    
    // Global mouseup listener for burn buttons
    document.addEventListener('mouseup', () => {
        if (state.burnMode && activeBurnButton) {
            stopBurn();
        }
    });
    
    // Setup burn buttons
    setupBurnButton('burn-prograde-btn', 'prograde');
    setupBurnButton('burn-retrograde-btn', 'retrograde');
    setupBurnButton('burn-normal-btn', 'normal');
    setupBurnButton('burn-anti-normal-btn', 'anti-normal');
    setupBurnButton('burn-radial-btn', 'radial');
    setupBurnButton('burn-anti-radial-btn', 'anti-radial');
    
    // Refuel button
    document.getElementById('refuel-btn').addEventListener('click', () => {
        if (state.currentStage < ROCKET_CONFIG.stages.length) {
            const refuelAmount = 5000;
            state.propellantRemaining[state.currentStage] += refuelAmount;
            if (state.propellantRemaining[state.currentStage] > ROCKET_CONFIG.stages[state.currentStage].propellantMass) {
                state.propellantRemaining[state.currentStage] = ROCKET_CONFIG.stages[state.currentStage].propellantMass;
            }
            addEvent(`Refueled: +${refuelAmount} kg propellant`);
        }
    });
}



