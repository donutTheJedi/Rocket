import { EARTH_RADIUS, EARTH_ROTATION, ROCKET_CONFIG, G, EARTH_MASS } from './constants.js';
import { addEvent } from './events.js';

// Game state object
export const state = {
    running: false,
    time: 0,
    timeWarp: 1,
    x: 0,
    y: EARTH_RADIUS,
    vx: 0,
    vy: 0,
    currentStage: 0,
    propellantRemaining: [ROCKET_CONFIG.stages[0].propellantMass, ROCKET_CONFIG.stages[1].propellantMass],
    fairingJettisoned: false,
    maxQ: 0,
    events: [],
    apoapsis: 0,
    periapsis: 0,
    engineOn: false,
    trail: [],
    manualZoom: 1.0,
    autoZoom: true,
    cameraMode: 'rocket', // 'rocket' or 'earth'
    burnMode: null, // null, 'prograde', 'retrograde', 'normal', 'anti-normal', 'radial', 'anti-radial'
    burnStartTime: null, // Time when current burn started
    manualBurnPerformed: false, // Set to true after user performs any manual burn
    guidancePhase: 'pre-launch',
    guidancePitch: 90.0,
    guidanceThrottle: 1.0,
    // New mode management
    gameMode: null, // null | 'manual' | 'guided' | 'orbital'
    manualPitch: null, // null | number (null = use guidance, number = manual pitch angle)
    targetAltitude: 500000, // for guided mode, default 500km
    orbitalSpawnAltitude: 500000, // for orbital mode, default 500km
    guidanceRecommendation: null // stores current guidance pitch for manual mode
};

// Initialize/reset state
export function initState() {
    // Initialize rocket at pad position
    const x0 = 0;
    const y0 = EARTH_RADIUS;
    
    // Atmospheric velocity at rocket's position (rotating with Earth)
    // Rocket should start with this velocity so airspeed is ~0
    // Earth rotates counterclockwise (eastward)
    const atmVx0 = EARTH_ROTATION * y0;  // perpendicular to position vector (eastward)
    const atmVy0 = -EARTH_ROTATION * x0;
    
    state.running = false;
    state.time = 0;
    state.timeWarp = 1;
    state.x = x0;
    state.y = y0;
    state.vx = atmVx0;  // Match atmospheric velocity so airspeed is ~0
    state.vy = atmVy0;
    state.currentStage = 0;
    state.propellantRemaining = [ROCKET_CONFIG.stages[0].propellantMass, ROCKET_CONFIG.stages[1].propellantMass];
    state.fairingJettisoned = false;
    state.maxQ = 0;
    state.events = [];
    state.apoapsis = 0;
    state.periapsis = 0;
    state.engineOn = false;
    state.trail = [];
    state.manualZoom = 1.0;
    state.autoZoom = true;
    state.cameraMode = 'rocket';
    state.burnMode = null;
    state.burnStartTime = null;
    state.manualBurnPerformed = false;
    state.guidancePhase = 'pre-launch';
    state.guidancePitch = 90.0;
    state.guidanceThrottle = 1.0;
    
    // Preserve gameMode, but reset mode-specific state
    if (state.gameMode === 'manual') {
        state.manualPitch = 90;
    } else {
        state.manualPitch = null;
    }
    state.guidanceRecommendation = null;
    
    const eventList = document.getElementById('event-list');
    if (eventList) {
        eventList.innerHTML = '';
    }
}

// Reset current mission without changing mode
export function resetCurrentMission() {
    if (state.gameMode === 'orbital') {
        spawnInOrbit(state.orbitalSpawnAltitude);
    } else {
        initState();
    }
}

// Spawn rocket in circular orbit
export function spawnInOrbit(altitude = 500000) {
    const r = EARTH_RADIUS + altitude;
    const mu = G * EARTH_MASS;
    
    // Circular orbit velocity: v = sqrt(G*M/r)
    const vCircular = Math.sqrt(mu / r);
    
    // Position at altitude above Earth (eastward)
    const x0 = 0;
    const y0 = r;
    
    // Velocity horizontal (eastward) with correct magnitude
    const vx0 = vCircular;
    const vy0 = 0;
    
    state.running = true;
    state.time = 0;
    state.timeWarp = 1;
    state.x = x0;
    state.y = y0;
    state.vx = vx0;
    state.vy = vy0;
    state.currentStage = 1; // Start with stage 2 (second stage)
    // Give 10% fuel for orbital mode
    state.propellantRemaining = [0, ROCKET_CONFIG.stages[1].propellantMass * 0.1]; // Stage 1 empty, stage 2 at 10%
    state.fairingJettisoned = true; // Already in space
    state.maxQ = 0;
    state.events = [];
    state.apoapsis = altitude;
    state.periapsis = altitude;
    state.engineOn = false;
    state.trail = [];
    state.manualZoom = 1.0;
    state.autoZoom = true;
    state.cameraMode = 'rocket';
    state.burnMode = null;
    state.burnStartTime = null;
    state.manualBurnPerformed = false;
    state.guidancePhase = 'orbit';
    state.guidancePitch = 0.0;
    state.guidanceThrottle = 0.0;
    state.manualPitch = null;
    state.guidanceRecommendation = null;
    
    const eventList = document.getElementById('event-list');
    if (eventList) {
        eventList.innerHTML = '';
    }
    
    addEvent(`Spawned in orbit at ${(altitude / 1000).toFixed(0)}km`);
}

// Get total rocket mass
export function getTotalMass() {
    let mass = ROCKET_CONFIG.payload;
    if (!state.fairingJettisoned) mass += ROCKET_CONFIG.fairingMass;
    for (let i = state.currentStage; i < ROCKET_CONFIG.stages.length; i++) {
        mass += ROCKET_CONFIG.stages[i].dryMass + state.propellantRemaining[i];
    }
    return mass;
}

// Get current altitude
export function getAltitude() {
    return Math.sqrt(state.x * state.x + state.y * state.y) - EARTH_RADIUS;
}

// Get pitch (from guidance system or default)
export function getPitch(time) {
    // In manual mode, use manual pitch if set
    if (state.gameMode === 'manual' && state.manualPitch !== null) {
        return state.manualPitch;
    }
    // Use guidance system pitch (pitch from horizontal: 0° = east, 90° = up)
    // Convert to pitch from vertical for backward compatibility (90° = up, 0° = horizontal)
    if (state.guidancePitch !== undefined) {
        return state.guidancePitch; // Guidance system already uses correct convention
    }
    // Fallback if guidance hasn't run yet
    return 90.0;
}

