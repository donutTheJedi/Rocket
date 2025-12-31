import { EARTH_RADIUS, ROCKET_CONFIG } from './constants.js';
import { state, getAltitude, getTotalMass, getPitch } from './state.js';
import { getAtmosphericDensity, getCurrentThrust, getAirspeed } from './physics.js';
import { formatTime, formatTMinus, getNextEvent } from './events.js';

// Update all telemetry displays
export function updateTelemetry() {
    const altitude = getAltitude();
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    
    const localUp = { x: state.x / r, y: state.y / r };
    const vVert = state.vx * localUp.x + state.vy * localUp.y;
    const vHoriz = Math.sqrt(Math.max(0, velocity * velocity - vVert * vVert));
    const downrange = Math.atan2(state.x, state.y) * EARTH_RADIUS;
    
    document.getElementById('time').textContent = formatTime(state.time);
    
    // Update T-minus countdown (central display)
    const nextEvent = getNextEvent();
    const tminusDisplay = document.getElementById('tminus-display');
    if (nextEvent && state.running && state.time > 0) {
        tminusDisplay.style.display = 'block';
        document.getElementById('tminus-time').textContent = 'T- ' + formatTMinus(nextEvent.time);
        document.getElementById('tminus-event-name').textContent = nextEvent.name.toUpperCase();
    } else {
        tminusDisplay.style.display = 'none';
    }
    document.getElementById('stage').textContent = state.currentStage + 1;
    document.getElementById('altitude').textContent = (altitude / 1000).toFixed(2) + ' km';
    document.getElementById('downrange').textContent = (downrange / 1000).toFixed(1) + ' km';
    document.getElementById('velocity').textContent = velocity.toFixed(0) + ' m/s';
    document.getElementById('vvel').textContent = vVert.toFixed(0) + ' m/s';
    document.getElementById('hvel').textContent = vHoriz.toFixed(0) + ' m/s';
    
    const throttle = state.guidanceThrottle !== undefined ? state.guidanceThrottle : 1.0;
    const thrust = getCurrentThrust(altitude, throttle);
    const mass = getTotalMass();
    document.getElementById('accel').textContent = (thrust / mass / 9.81).toFixed(2) + ' G';
    document.getElementById('maxq').textContent = (state.maxQ / 1000).toFixed(2) + ' kPa';
    const { airspeed: airspeedForDisplay } = getAirspeed();
    document.getElementById('dynpress').textContent = (0.5 * getAtmosphericDensity(altitude) * airspeedForDisplay * airspeedForDisplay / 1000).toFixed(2) + ' kPa';
    document.getElementById('mass').textContent = mass.toFixed(0) + ' kg';
    
    const stage = ROCKET_CONFIG.stages[state.currentStage];
    if (stage) {
        document.getElementById('propellant').textContent = (state.propellantRemaining[state.currentStage] / stage.propellantMass * 100).toFixed(1) + '%';
    }
    document.getElementById('thrust').textContent = (thrust / 1000).toFixed(0) + ' kN';
    
    const pitch = getPitch(state.time);
    document.getElementById('pitch').textContent = pitch.toFixed(1) + '°';
    document.getElementById('target-pitch').textContent = pitch.toFixed(1) + '°';
    document.getElementById('current-pitch').textContent = pitch.toFixed(1) + '°';
    document.getElementById('pitch-bar').style.width = (pitch / 90 * 100) + '%';
    
    document.getElementById('apoapsis').textContent = state.apoapsis === Infinity ? 'ESCAPE' : (state.apoapsis / 1000).toFixed(1) + ' km';
    document.getElementById('periapsis').textContent = (state.periapsis / 1000).toFixed(1) + ' km';
    
    // Show guidance strategy and burn type if available
    const guidanceInfo = document.getElementById('guidance-info');
    if (guidanceInfo) {
        if (state.guidanceDebug && state.guidancePhase === 'vacuum-guidance' && state.engineOn) {
            const strategy = state.guidanceDebug.useDirectAscent ? 'Direct Ascent' : 'Traditional';
            const burnType = state.guidanceIsRetrograde ? 'RETROGRADE' : 'PROGRADE';
            guidanceInfo.textContent = `Strategy: ${strategy} | Burn: ${burnType}`;
            guidanceInfo.style.display = 'block';
        } else {
            guidanceInfo.style.display = 'none';
        }
    }
    
    // Show/hide burn controls when in orbit and pitch program is complete
    const pitchProgramComplete = state.time > 600 || (!state.engineOn && altitude > 150000);
    const inOrbit = altitude > 150000 && state.currentStage < ROCKET_CONFIG.stages.length && pitchProgramComplete;
    const burnControls = document.getElementById('burn-controls');
    if (inOrbit) {
        burnControls.style.display = 'block';
    } else {
        burnControls.style.display = 'none';
        // Clear burn mode if not in orbit or pitch program still running
        if (state.burnMode) {
            state.burnMode = null;
            state.burnStartTime = null;
        }
    }
    
    // Update active burn button and burn status
    const burnButtons = ['prograde', 'retrograde', 'normal', 'anti-normal', 'radial', 'anti-radial'];
    burnButtons.forEach(mode => {
        const btn = document.getElementById(`burn-${mode}-btn`);
        if (btn) {
            if (state.burnMode === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
    
    // Update burn status display
    const burnStatus = document.getElementById('burn-status');
    if (state.burnMode && state.burnStartTime !== null) {
        const burnDuration = state.time - state.burnStartTime;
        const burnNames = {
            'prograde': 'PROGRADE',
            'retrograde': 'RETROGRADE',
            'normal': 'NORMAL',
            'anti-normal': 'ANTI-NORMAL',
            'radial': 'RADIAL',
            'anti-radial': 'ANTI-RADIAL'
        };
        burnStatus.innerHTML = `
            <div style="color: #0ff; font-weight: bold;">BURNING: ${burnNames[state.burnMode]}</div>
            <div style="color: #0f0;">Duration: ${burnDuration.toFixed(1)}s</div>
        `;
    } else {
        burnStatus.innerHTML = '<div>Hold button to burn</div>';
    }
}

