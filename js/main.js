import { EARTH_RADIUS, EARTH_ROTATION, KARMAN_LINE, ROCKET_CONFIG, GUIDANCE_CONFIG } from './constants.js';
import { state, initState, getAltitude, getTotalMass, resetCurrentMission, spawnInOrbit } from './state.js';
import { getGravity, getCurrentThrust, getMassFlowRate, getAtmosphericDensity, getAirspeed, getDrag } from './physics.js';
import { calculateOrbitalElements } from './orbital.js';
import { computeGuidance, guidanceState, resetGuidance } from './guidance.js';
import { addEvent } from './events.js';
import { updateTelemetry } from './telemetry.js';
import { initRenderer, resize, render } from './renderer.js';
import { initInput } from './input.js';

// Update physics simulation
function update(dt) {
    if (!state.running) return;
    
    // Update manual pitch if in manual mode (use original dt before time warp for consistent turning speed)
    if (window.updateManualPitch) {
        window.updateManualPitch(dt);
    }
    
    dt *= state.timeWarp;
    const maxDt = 1.0;
    if (dt > maxDt) {
        dt = maxDt;
    }
    const altitude = getAltitude();
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    
    if (r < EARTH_RADIUS && state.time > 1) {
        state.running = false;
        addEvent("MISSION FAILURE - Ground impact");
        return;
    }
    
    const mass = getTotalMass();
    
    // Gravity pointing toward Earth center
    const gravity = getGravity(r);
    const gx = -gravity * state.x / r;
    const gy = -gravity * state.y / r;
    
    // Local reference frame
    const localUp = { x: state.x / r, y: state.y / r };
    const localEast = { x: localUp.y, y: -localUp.x };
    
    // Calculate orbital directions if in orbit
    let thrustDir;
    // In orbital mode, always allow burns. Otherwise, check pitch program completion.
    const pitchProgramComplete = state.gameMode === 'orbital' || state.time > 600 || (!state.engineOn && altitude > 150000);
    if (state.burnMode && pitchProgramComplete && altitude > 150000) {
        const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        const prograde = velocity > 0 ? { x: state.vx / velocity, y: state.vy / velocity } : { x: 0, y: 0 };
        const radial = localUp;
        const h = state.x * state.vy - state.y * state.vx;
        const normal = h > 0 ? { x: -localUp.y, y: localUp.x } : { x: localUp.y, y: -localUp.x };
        
        switch (state.burnMode) {
            case 'prograde':
                thrustDir = prograde;
                break;
            case 'retrograde':
                thrustDir = { x: -prograde.x, y: -prograde.y };
                break;
            case 'normal':
                thrustDir = normal;
                break;
            case 'anti-normal':
                thrustDir = { x: -normal.x, y: -normal.y };
                break;
            case 'radial':
                thrustDir = radial;
                break;
            case 'anti-radial':
                thrustDir = { x: -radial.x, y: -radial.y };
                break;
            default:
                thrustDir = prograde;
        }
    } else {
        // Closed-loop guidance system (will be called per sub-step for accuracy)
        thrustDir = null; // Will be computed in sub-stepping loop
    }
    
    // Enable engine for burn modes
    // In orbital mode, always allow burns if conditions are met
    if (state.burnMode && pitchProgramComplete && !state.engineOn && altitude > 150000 && 
        state.currentStage < ROCKET_CONFIG.stages.length && 
        state.propellantRemaining[state.currentStage] > 0) {
        state.engineOn = true;
    }
    
    // Adaptive sub-stepping
    const inOrbit = altitude > 150000 && !state.engineOn;
    const maxStepSize = inOrbit ? 0.01 : 0.05;
    const steps = Math.max(1, Math.ceil(dt / maxStepSize));
    const maxSteps = 1000;
    const actualSteps = Math.min(steps, maxSteps);
    const actualStepDt = dt / actualSteps;
    
    for (let step = 0; step < actualSteps; step++) {
        const rStep = Math.sqrt(state.x * state.x + state.y * state.y);
        const altitudeStep = rStep - EARTH_RADIUS;
        const velocityStep = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        
        // Recalculate local reference frame for each sub-step (position changes)
        const localUpStep = { x: state.x / rStep, y: state.y / rStep };
        const localEastStep = { x: localUpStep.y, y: -localUpStep.x };
        
        // Compute guidance for each sub-step if not in burn mode
        let thrustDirStep = thrustDir;
        let throttleStep = 1.0;
        
        // If in burn mode, recalculate thrust direction for each sub-step (velocity changes)
        if (thrustDir && state.burnMode) {
            const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
            const prograde = velocity > 0 ? { x: state.vx / velocity, y: state.vy / velocity } : { x: 0, y: 0 };
            const radial = localUpStep;
            const h = state.x * state.vy - state.y * state.vx;
            const normal = h > 0 ? { x: -localUpStep.y, y: localUpStep.x } : { x: localUpStep.y, y: -localUpStep.x };
            
            switch (state.burnMode) {
                case 'prograde':
                    thrustDirStep = prograde;
                    break;
                case 'retrograde':
                    thrustDirStep = { x: -prograde.x, y: -prograde.y };
                    break;
                case 'normal':
                    thrustDirStep = normal;
                    break;
                case 'anti-normal':
                    thrustDirStep = { x: -normal.x, y: -normal.y };
                    break;
                case 'radial':
                    thrustDirStep = radial;
                    break;
                case 'anti-radial':
                    thrustDirStep = { x: -radial.x, y: -radial.y };
                    break;
                default:
                    thrustDirStep = prograde;
            }
        }
        
        if (!thrustDir) {
            // Skip guidance in orbital mode (user uses burn controls)
            if (state.gameMode === 'orbital') {
                // No thrust in orbital mode unless using burn controls
                thrustDirStep = { x: 0, y: 0 };
                throttleStep = 0;
            } else {
                // Guidance mode - update every sub-step for accuracy
                const guidance = computeGuidance(state, actualStepDt);
                
                // In manual mode, use manual pitch for thrust direction but store guidance recommendation
                if (state.gameMode === 'manual' && state.manualPitch !== null) {
                    // Store guidance recommendation
                    state.guidanceRecommendation = guidance.pitch;
                    
                    // Use manual pitch for thrust direction (with current local frame)
                    const pitchRad = state.manualPitch * Math.PI / 180;
                    thrustDirStep = {
                        x: Math.cos(pitchRad) * localEastStep.x + Math.sin(pitchRad) * localUpStep.x,
                        y: Math.cos(pitchRad) * localEastStep.y + Math.sin(pitchRad) * localUpStep.y
                    };
                    throttleStep = guidance.throttle; // Still use guidance throttle
                } else {
                    // Normal guidance mode
                    thrustDirStep = guidance.thrustDir;
                    throttleStep = guidance.throttle;
                }
                
                // Update state with latest guidance (will be overwritten each sub-step, last one persists)
                state.guidancePhase = guidance.phase;
                state.guidancePitch = guidance.pitch;
                state.guidanceThrottle = guidance.throttle;
                state.guidanceDebug = guidance.debug;
                state.guidanceIsRetrograde = guidanceState.isRetrograde;
                
                // Detect and log burn start events (only on first sub-step to avoid spam)
                if (step === 0 && guidance.phase === 'vacuum-guidance' && guidance.debug && guidance.debug.reason) {
                    const reason = guidance.debug.reason;
                    const useDirectAscent = guidance.debug.useDirectAscent;
                    
                    // Direct ascent strategy: Prograde burn to raise periapsis (check this FIRST)
                    if (useDirectAscent && 
                        (reason.includes('Direct ascent') && reason.includes('raising periapsis')) && 
                        !guidanceState.circularizationBurnStarted && 
                        state.engineOn && 
                        guidance.throttle > 0) {
                        guidanceState.circularizationBurnStarted = true;  // Reuse flag to prevent re-triggering
                        addEvent(`Direct ascent burn - raising periapsis to target`);
                    }
                    // Traditional strategy: Circularization burn at apoapsis (only if NOT direct ascent)
                    // Only announce if more than 25 minutes have passed (avoids false positives during ascent)
                    else if (!useDirectAscent && 
                        state.time >= 1500 && 
                        (reason.includes('Starting circularization') || reason.includes('circularizing')) && 
                        !guidanceState.circularizationBurnStarted && 
                        state.engineOn && 
                        guidance.throttle > 0) {
                        guidanceState.circularizationBurnStarted = true;
                        const deltaV = guidance.debug.circDeltaV || 0;
                        const burnTime = guidance.debug.circBurnTime || 0;
                        addEvent(`Circularization burn start (Δv: ${(deltaV/1000).toFixed(1)} km/s, ${burnTime.toFixed(1)}s)`);
                    }
                    
                    // Retrograde burn at periapsis (both strategies)
                    if (reason.includes('Starting retrograde burn') && 
                        !guidanceState.retrogradeBurnStarted && 
                        state.engineOn && 
                        guidance.throttle > 0) {
                        guidanceState.retrogradeBurnStarted = true;
                        const deltaV = guidance.debug.retroDeltaV || 0;
                        const burnTime = guidance.debug.retroBurnTime || 0;
                        addEvent(`Retrograde burn start (Δv: ${(deltaV/1000).toFixed(1)} km/s, ${burnTime.toFixed(1)}s)`);
                    }
                }
            }
        } else {
            // Manual burn mode - use fixed thrust direction from above
            throttleStep = 1.0;
        }
        
        const gravityStep = getGravity(rStep);
        const gxStep = -gravityStep * state.x / rStep;
        const gyStep = -gravityStep * state.y / rStep;
        
        const thrustStep = getCurrentThrust(altitudeStep, throttleStep);
        const thrustAccelStep = thrustStep / mass;
        const taxStep = thrustAccelStep * thrustDirStep.x;
        const tayStep = thrustAccelStep * thrustDirStep.y;
        
        const atmVxStep = EARTH_ROTATION * state.y;
        const atmVyStep = -EARTH_ROTATION * state.x;
        const airVxStep = state.vx - atmVxStep;
        const airVyStep = state.vy - atmVyStep;
        const airspeedStep = Math.sqrt(airVxStep * airVxStep + airVyStep * airVyStep);
        const dragStep = getDrag(altitudeStep, airspeedStep);
        const dragAccelStep = airspeedStep > 0 ? dragStep / mass : 0;
        const daxStep = airspeedStep > 0 ? -dragAccelStep * airVxStep / airspeedStep : 0;
        const dayStep = airspeedStep > 0 ? -dragAccelStep * airVyStep / airspeedStep : 0;
        
        const axStep = gxStep + taxStep + daxStep;
        const ayStep = gyStep + tayStep + dayStep;
        
        // Symplectic Euler integrator
        state.vx += axStep * actualStepDt;
        state.vy += ayStep * actualStepDt;
        state.x += state.vx * actualStepDt;
        state.y += state.vy * actualStepDt;
        
        // Propellant consumption per sub-step (using actual throttle for this step)
        if (state.engineOn && state.currentStage < ROCKET_CONFIG.stages.length) {
            state.propellantRemaining[state.currentStage] -= getMassFlowRate(altitudeStep, throttleStep) * actualStepDt;
        }
    }
    
    // Check for stage depletion after all sub-steps
    if (state.currentStage < ROCKET_CONFIG.stages.length && 
        state.propellantRemaining[state.currentStage] <= 0) {
        state.propellantRemaining[state.currentStage] = 0;
        if (state.currentStage === 0) {
            addEvent("MECO");
            state.currentStage = 1;
            addEvent("Stage separation");
            addEvent("SES-1");
        } else {
            addEvent("SECO");
            state.engineOn = false;
            if (state.burnMode) {
                const burnNames = {
                    'prograde': 'PROGRADE',
                    'retrograde': 'RETROGRADE',
                    'normal': 'NORMAL',
                    'anti-normal': 'ANTI-NORMAL',
                    'radial': 'RADIAL',
                    'anti-radial': 'ANTI-RADIAL'
                };
                const duration = state.burnStartTime ? (state.time - state.burnStartTime).toFixed(1) : '0.0';
                addEvent(`${burnNames[state.burnMode]} burn ended - out of propellant (${duration}s)`);
                state.burnMode = null;
                state.burnStartTime = null;
            }
        }
    }
    
    // Turn off burn mode if engine turns off
    if (state.burnMode && !state.engineOn && state.burnStartTime !== null) {
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
    }
    
    // Update burn duration tracking
    if (state.burnMode && state.burnStartTime === null) {
        state.burnStartTime = state.time;
    }
    
    if (!state.fairingJettisoned && altitude > ROCKET_CONFIG.fairingJettisonAlt) {
        state.fairingJettisoned = true;
        addEvent("Fairing jettison");
    }
    
    // Dynamic pressure
    const { airspeed: airspeedForQ } = getAirspeed();
    const dynPress = 0.5 * getAtmosphericDensity(altitude) * airspeedForQ * airspeedForQ;
    if (dynPress > state.maxQ) state.maxQ = dynPress;
    
    calculateOrbitalElements();
    
    // Add to trail
    if (state.time % 0.1 < dt * state.timeWarp) {
        state.trail.push({ x: state.x, y: state.y });
        if (state.trail.length > 10000) state.trail.shift();
    }
    
    // Gravity turn events
    if (state.time >= 10.0 && !state.events.some(e => e.text.includes("Gravity turn kick"))) {
        addEvent("Gravity turn kick");
    }
    if (state.time >= 13.0 && !state.events.some(e => e.text.includes("Gravity turn active"))) {
        addEvent("Gravity turn active - thrusting prograde");
    }
    
    if (altitude >= KARMAN_LINE && !state.events.some(e => e.text.includes("Kármán"))) {
        addEvent("Kármán line - SPACE!");
    }
    
    state.time += dt;
    updateTelemetry();
}

// Game loop
let lastTime = 0;
function loop(time) {
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    update(dt);
    render();
    requestAnimationFrame(loop);
}

// Menu functions
function showMenu() {
    const menuPanel = document.getElementById('menu-panel');
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuPanel && menuOverlay) {
        menuPanel.style.display = 'block';
        menuOverlay.style.display = 'block';
        setTimeout(() => {
            menuPanel.classList.add('show');
        }, 10);
        const wasRunning = state.running;
        state.running = false;
        updateCurrentModeDisplay();
        updateUIForMode();
        if (wasRunning) {
            const pauseBtn = document.getElementById('pause-btn');
            if (pauseBtn) {
                pauseBtn.textContent = 'PAUSE';
            }
        }
    }
}

function hideMenu() {
    const menuPanel = document.getElementById('menu-panel');
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuPanel && menuOverlay) {
        menuPanel.classList.remove('show');
        setTimeout(() => {
            menuPanel.style.display = 'none';
            menuOverlay.style.display = 'none';
        }, 300);
    }
}

function updateCurrentModeDisplay() {
    const modeDisplay = document.getElementById('current-mode-display');
    if (modeDisplay) {
        if (state.gameMode === 'manual') {
            modeDisplay.textContent = 'Current Mode: Manual Control';
        } else if (state.gameMode === 'guided') {
            modeDisplay.textContent = `Current Mode: Guided Launch (${(state.targetAltitude / 1000).toFixed(0)}km target)`;
        } else if (state.gameMode === 'orbital') {
            modeDisplay.textContent = `Current Mode: Orbital (${(state.orbitalSpawnAltitude / 1000).toFixed(0)}km)`;
        } else {
            modeDisplay.textContent = 'No mission selected';
        }
    }
}

function startMission(mode, options = {}) {
    if (mode === 'manual') {
        state.gameMode = 'manual';
        state.manualPitch = 90;
        initState();
        resetGuidance();
        hideMenu();
    } else if (mode === 'guided') {
        const targetAlt = options.targetAltitude || 500000;
        state.gameMode = 'guided';
        state.targetAltitude = targetAlt;
        GUIDANCE_CONFIG.targetAltitude = targetAlt;
        initState();
        resetGuidance();
        hideMenu();
    } else if (mode === 'orbital') {
        const altitude = options.altitude || 500000;
        state.gameMode = 'orbital';
        state.orbitalSpawnAltitude = altitude;
        spawnInOrbit(altitude);
        resetGuidance();
        hideMenu();
    }
    updateUIForMode();
}

function updateUIForMode() {
    const launchBtn = document.getElementById('launch-btn');
    const manualControls = document.getElementById('manual-pitch-controls');
    const pitchProgram = document.getElementById('pitch-program');
    
    if (state.gameMode === 'manual') {
        if (manualControls) manualControls.style.display = 'block';
        if (pitchProgram) pitchProgram.style.display = 'none';
    } else {
        if (manualControls) manualControls.style.display = 'none';
        if (pitchProgram && state.gameMode !== 'orbital') {
            pitchProgram.style.display = 'block';
        } else if (pitchProgram) {
            pitchProgram.style.display = 'none';
        }
    }
    
    // Show launch button only for manual and guided modes
    if (launchBtn) {
        if (state.gameMode === 'orbital') {
            launchBtn.style.display = 'none';
        } else if (state.gameMode !== null) {
            launchBtn.style.display = 'inline-block';
        }
    }
}

// Export for use in input.js
window.updateUIForMode = updateUIForMode;

// Initialize menu event handlers
function initMenu() {
    const menuBtn = document.getElementById('menu-btn');
    const menuCloseBtn = document.getElementById('menu-close-btn');
    const menuOverlay = document.getElementById('menu-overlay');
    const startManualBtn = document.getElementById('start-manual-btn');
    const startGuidedBtn = document.getElementById('start-guided-btn');
    const startOrbitalBtn = document.getElementById('start-orbital-btn');
    const presetBtns = document.querySelectorAll('.preset-btn');
    
    if (menuBtn) {
        menuBtn.addEventListener('click', showMenu);
    }
    
    if (menuCloseBtn) {
        menuCloseBtn.addEventListener('click', hideMenu);
    }
    
    if (menuOverlay) {
        menuOverlay.addEventListener('click', hideMenu);
    }
    
    if (startManualBtn) {
        startManualBtn.addEventListener('click', () => {
            startMission('manual');
        });
    }
    
    if (startGuidedBtn) {
        startGuidedBtn.addEventListener('click', () => {
            const input = document.getElementById('target-altitude-input');
            const targetAlt = input ? parseFloat(input.value) * 1000 : 500000;
            startMission('guided', { targetAltitude: targetAlt });
        });
    }
    
    if (startOrbitalBtn) {
        startOrbitalBtn.addEventListener('click', () => {
            const activePreset = document.querySelector('.preset-btn.active');
            const altitude = activePreset ? parseFloat(activePreset.dataset.altitude) * 1000 : 500000;
            startMission('orbital', { altitude: altitude });
        });
    }
    
    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            presetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// Initialize application
function init() {
    const canvas = document.getElementById('canvas');
    initRenderer(canvas);
    resize();
    initState();
    resetGuidance();
    initInput();
    initMenu();
    showMenu(); // Show menu on startup
    updateTelemetry();
    requestAnimationFrame(loop);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

