import { G, EARTH_MASS, EARTH_RADIUS, ROCKET_CONFIG, GUIDANCE_CONFIG } from './constants.js';
import { getTotalMass } from './state.js';
import { getAtmosphericDensity, getAirspeed, getGravity } from './physics.js';
import { predictOrbit, computeRemainingDeltaV } from './orbital.js';

// Guidance state
export let guidanceState = {
    phase: 'pre-launch',
    lastCommandedPitch: 90,
    throttle: 1.0,
    lastFlightPathAngle: 90,
    isRetrograde: false,
    circularizationBurnStarted: false,
    retrogradeBurnStarted: false,
};

// Reset guidance state
export function resetGuidance() {
    guidanceState = {
        phase: 'pre-launch',
        lastCommandedPitch: 90,
        throttle: 1.0,
        lastFlightPathAngle: 90,
        isRetrograde: false,
        circularizationBurnStarted: false,
        retrogradeBurnStarted: false,
    };
}

// ============================================================================
// MAIN GUIDANCE FUNCTION
// ============================================================================
export function computeGuidance(state, dt) {
    
    // ========================================================================
    // STEP 1: GATHER CURRENT STATE
    // ========================================================================
    
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const altitude = r - EARTH_RADIUS;
    const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    
    // Local reference frame (changes as we move around Earth)
    const localUp = { x: state.x / r, y: state.y / r };
    const localEast = { x: localUp.y, y: -localUp.x };
    
    // Decompose velocity into vertical and horizontal components
    const vVertical = state.vx * localUp.x + state.vy * localUp.y;
    const vHorizontal = state.vx * localEast.x + state.vy * localEast.y;
    
    // Flight path angle (angle of velocity from horizontal)
    // 90° = straight up, 0° = horizontal, negative = descending
    const flightPathAngle = Math.atan2(vVertical, vHorizontal) * 180 / Math.PI;
    
    // Dynamic pressure (for max Q check)
    const airDensity = getAtmosphericDensity(altitude);
    const { airspeed } = getAirspeed();
    const dynamicPressure = 0.5 * airDensity * airspeed * airspeed;
    
    // ========================================================================
    // STEP 2: PREDICT ORBIT (vacuum assumption)
    // ========================================================================
    // "If I cut engines right now, what orbit am I on?"
    
    const orbit = predictOrbit(state);
    
    // ========================================================================
    // STEP 3: COMPUTE TARGET PARAMETERS
    // ========================================================================
    
    // Circular orbit velocity at target altitude
    const targetRadius = EARTH_RADIUS + GUIDANCE_CONFIG.targetAltitude;
    const mu = G * EARTH_MASS;
    const vCircular = Math.sqrt(mu / targetRadius);
    
    // How much more horizontal velocity do we need?
    const velocityDeficit = vCircular - vHorizontal;
    
    // Remaining delta-v from propellant
    const remainingDeltaV = computeRemainingDeltaV(state);
    
    // ========================================================================
    // STEP 4: PRIORITY-BASED GUIDANCE LOGIC
    // ========================================================================
    
    let commandedPitch;
    let commandedThrottle = 1.0;
    let phase;
    let debugInfo = {};
    
    // ------------------------------------------------------------------------
    // PRIORITY 1: HEIGHT — Get out of atmosphere
    // ------------------------------------------------------------------------
    
    if (altitude < GUIDANCE_CONFIG.atmosphereLimit) {
        
        // Sub-case: Very early flight (first few seconds)
        if (state.time < GUIDANCE_CONFIG.pitchKickStart) {
            phase = 'vertical-ascent';
            commandedPitch = 90;
            debugInfo.reason = 'Clearing pad — vertical';
        }
        
        // Sub-case: Pitch kick (gradual tilt to start gravity turn)
        else if (state.time < GUIDANCE_CONFIG.pitchKickEnd) {
            phase = 'pitch-kick';
            const progress = (state.time - GUIDANCE_CONFIG.pitchKickStart) / 
                           (GUIDANCE_CONFIG.pitchKickEnd - GUIDANCE_CONFIG.pitchKickStart);
            // Smooth cosine interpolation
            const smoothProgress = (1 - Math.cos(progress * Math.PI)) / 2;
            commandedPitch = 90 - smoothProgress * (90 - GUIDANCE_CONFIG.initialPitch);
            debugInfo.reason = 'Pitch kick — initiating gravity turn';
        }
        
        // Sub-case: In atmosphere, past pitch kick
        else {
            // ============================================================
            // ATMOSPHERIC PHASE — PRIORITY IS ESCAPE, NOT ORBIT SHAPING
            // ============================================================
            
            // PRIORITY 2: MAX Q — Protect structure
            if (dynamicPressure > GUIDANCE_CONFIG.maxQ * 0.8) {
                phase = 'max-q-protection';
                commandedPitch = flightPathAngle;
                debugInfo.reason = 'Max Q — following prograde exactly';
                debugInfo.q = dynamicPressure;
            }
            else {
                phase = 'atmospheric-ascent';
                
                // ============================================================
                // ALTITUDE-BASED MINIMUM PITCH CONSTRAINT
                // ============================================================
                
                const altitudeFraction = Math.min(1.0, altitude / GUIDANCE_CONFIG.atmosphereLimit);
                const minPitchForAltitude = 90 - altitudeFraction * altitudeFraction * 80; // Smooth quadratic curve
                
                // ============================================================
                // PROGRADE FOLLOWING WITH CONSTRAINTS
                // ============================================================
                
                // Start with prograde (minimizes angle of attack)
                let basePitch = flightPathAngle;
                
                // Calculate natural gravity turn rate
                const g = getGravity(r);
                const gamma = flightPathAngle * Math.PI / 180;
                const naturalTurnRate = (g * Math.cos(gamma) / velocity) * 180 / Math.PI;  // deg/sec
                
                // Measure actual turn rate
                const actualTurnRate = dt > 0 ? (guidanceState.lastFlightPathAngle - flightPathAngle) / dt : 0;
                
                // Store for next frame
                guidanceState.lastFlightPathAngle = flightPathAngle;
                
                // CONSTRAINT 1: Turn rate limiting
                let correction = 0;
                const turnRateExcess = actualTurnRate - naturalTurnRate;
                
                if (turnRateExcess > 0.5) {
                    correction = Math.min(5, turnRateExcess * 2);
                    debugInfo.reason = 'Turn rate excess — resisting';
                    debugInfo.turnRateExcess = turnRateExcess;
                }
                
                // CONSTRAINT 2: Minimum pitch for altitude (soft constraint)
                if (basePitch + correction < minPitchForAltitude) {
                    const deficit = minPitchForAltitude - (basePitch + correction);
                    correction += deficit * 0.3;
                    debugInfo.reason = 'Altitude minimum pitch — gentle correction';
                }
                
                // Final hard constraint
                commandedPitch = Math.max(minPitchForAltitude, basePitch + correction);
                
                debugInfo.basePitch = basePitch;
                debugInfo.correction = correction;
                debugInfo.minPitchForAltitude = minPitchForAltitude;
                debugInfo.naturalTurnRate = naturalTurnRate;
                debugInfo.actualTurnRate = actualTurnRate;
            }
        }
    }
    
    // ------------------------------------------------------------------------
    // ABOVE ATMOSPHERE: Active guidance
    // ------------------------------------------------------------------------
    
    else {
        phase = 'vacuum-guidance';
        
        // Start with prograde as baseline
        let basePitch = flightPathAngle;
        let correction = 0;
        
        const apoapsisError = orbit.apoapsis - GUIDANCE_CONFIG.targetAltitude;
        const periapsisError = orbit.periapsis - GUIDANCE_CONFIG.targetAltitude;
        
        debugInfo.apoapsisError = apoapsisError;
        debugInfo.periapsisError = periapsisError;
        debugInfo.eccentricity = orbit.eccentricity;
        
        // ================================================================
        // ORBIT CORRECTION LOGIC
        // ================================================================
        
        // Are we still ascending? (vertical velocity positive)
        const isAscending = vVertical > 0;
        
        // ================================================================
        // ESTIMATE TIME TO APOAPSIS
        // ================================================================
        const altitudeToApoapsis = orbit.apoapsis - altitude;
        let timeToApoapsis = 0;
        
        if (isAscending && altitudeToApoapsis > 0) {
            timeToApoapsis = altitudeToApoapsis / Math.max(1, vVertical);
        } else if (!isAscending) {
            timeToApoapsis = 0;
        }
        
        // ================================================================
        // CALCULATE CIRCULARIZATION DELTA-V
        // ================================================================
        const r_apo = EARTH_RADIUS + orbit.apoapsis;
        const v_circular = Math.sqrt(mu / r_apo);
        
        const v_at_apo = orbit.semiMajorAxis > 0 
            ? Math.sqrt(mu * (2 / r_apo - 1 / orbit.semiMajorAxis))
            : velocity;
        
        const circularizationDeltaV = Math.max(0, v_circular - v_at_apo);
        
        // ================================================================
        // CALCULATE BURN TIME FOR CIRCULARIZATION
        // ================================================================
        let circularizationBurnTime = 0;
        if (state.currentStage < ROCKET_CONFIG.stages.length) {
            const stage = ROCKET_CONFIG.stages[state.currentStage];
            const currentMass = getTotalMass();
            const thrust = stage.thrustVac;
            
            if (thrust > 0) {
                circularizationBurnTime = circularizationDeltaV * currentMass / thrust;
            }
        }
        
        const burnStartTimeBeforeApo = circularizationBurnTime / 2;
        const shouldStartCircularization = timeToApoapsis <= burnStartTimeBeforeApo && 
                                           circularizationBurnTime > 0 &&
                                           orbit.periapsis < GUIDANCE_CONFIG.targetAltitude;
        
        const nearApoapsis = (altitudeToApoapsis < 50000 && !isAscending) || timeToApoapsis < 5;
        
        debugInfo.timeToApoapsis = timeToApoapsis;
        debugInfo.circDeltaV = circularizationDeltaV;
        debugInfo.circBurnTime = circularizationBurnTime;
        debugInfo.burnStartTime = burnStartTimeBeforeApo;
        
        // ================================================================
        // STRATEGY SELECTION: Direct Ascent vs Traditional Apoapsis-First
        // ================================================================
        
        const apoError = orbit.apoapsis - GUIDANCE_CONFIG.targetAltitude;
        const periError = orbit.periapsis - GUIDANCE_CONFIG.targetAltitude;
        
        const tolerance = 10000; // 10km
        
        // Determine if we should use direct ascent strategy
        const useDirectAscent = GUIDANCE_CONFIG.targetAltitude < 250000 || 
                                (circularizationBurnTime > 0 && 
                                 circularizationBurnTime > 60 && 
                                 apoError < tolerance);
        
        debugInfo.useDirectAscent = useDirectAscent;
        
        // ================================================================
        // DIRECT ASCENT STRATEGY (for low orbits / long circularization burns)
        // ================================================================
        
        if (useDirectAscent && periError < -tolerance) {
            // PHASE 1: Periapsis below target — burn prograde to raise it
            guidanceState.isRetrograde = false;
            
            const periDeficit = -periError;
            
            // Burn prograde to raise periapsis
            correction = 0; // Follow prograde
            
            if (periDeficit < 50000) {
                commandedThrottle = Math.max(0.1, periDeficit / 50000);
                debugInfo.reason = 'Direct ascent — raising periapsis (throttled, ' + (periDeficit/1000).toFixed(0) + 'km to go)';
            } else {
                commandedThrottle = 1.0;
                debugInfo.reason = 'Direct ascent — raising periapsis to target';
            }
        }
        
        // ================================================================
        // TRADITIONAL APOAPSIS-FIRST STRATEGY (for high orbits)
        // ================================================================
        
        else if (!useDirectAscent && apoError < -tolerance) {
            // PHASE 1: Apoapsis below target — raise it
            guidanceState.isRetrograde = false;
            
            const deficit = -apoError;
            
            correction = Math.max(-GUIDANCE_CONFIG.maxPitchCorrection, -deficit / 50000 * 10);
            
            if (deficit < 50000) {
                commandedThrottle = Math.max(0.1, deficit / 50000);
                debugInfo.reason = 'Raising apoapsis — throttling down (' + (deficit/1000).toFixed(0) + 'km to go)';
            } else {
                commandedThrottle = 1.0;
                debugInfo.reason = 'Raising apoapsis — full throttle';
            }
        }
        // PHASE 2 (Traditional): Apoapsis at or above target, periapsis below — circularize
        else if (!useDirectAscent && periError < -tolerance) {
            guidanceState.isRetrograde = false;
            
            const periDeficit = -periError;
            
            if (shouldStartCircularization || nearApoapsis) {
                correction = 0;  // Prograde
                
                if (periDeficit < 50000) {
                    commandedThrottle = Math.max(0.1, periDeficit / 50000);
                    debugInfo.reason = 'Circularizing — throttling down (' + (periDeficit/1000).toFixed(0) + 'km Pe to go)';
                } else {
                    commandedThrottle = 1.0;
                    debugInfo.reason = nearApoapsis 
                        ? 'At apoapsis — circularizing' 
                        : 'Starting circularization (T-' + timeToApoapsis.toFixed(0) + 's to apo)';
                }
            }
            else {
                // Coast to burn start time (works for both ascending and descending)
                commandedThrottle = 0;
                correction = 0;
                if (isAscending) {
                    debugInfo.reason = 'Coasting to burn start (T-' + timeToApoapsis.toFixed(0) + 's, burn at T-' + burnStartTimeBeforeApo.toFixed(0) + 's)';
                } else {
                    debugInfo.reason = 'Coasting to apoapsis (T-' + timeToApoapsis.toFixed(0) + 's, burn at T-' + burnStartTimeBeforeApo.toFixed(0) + 's)';
                }
            }
        }
        // PHASE 3: Periapsis at/above target, apoapsis too high — retrograde at periapsis
        // (Used by both direct ascent and traditional strategies)
        else if (periError >= -tolerance && apoError > tolerance) {
            const altitudeToPeriapsis = altitude - orbit.periapsis;
            let timeToPeriapsis = 0;
            
            if (!isAscending && altitudeToPeriapsis > 0) {
                timeToPeriapsis = altitudeToPeriapsis / Math.max(1, -vVertical);
            } else if (isAscending) {
                timeToPeriapsis = Infinity;
            }
            
            const r_peri = EARTH_RADIUS + orbit.periapsis;
            const r_target = EARTH_RADIUS + GUIDANCE_CONFIG.targetAltitude;
            
            const v_circ_target = Math.sqrt(mu / r_target);
            
            const v_at_peri = orbit.semiMajorAxis > 0
                ? Math.sqrt(mu * (2 / r_peri - 1 / orbit.semiMajorAxis))
                : velocity;
            
            const a_target = (r_peri + r_target) / 2;
            const v_peri_target = Math.sqrt(mu * (2 / r_peri - 1 / a_target));
            
            const retrogradeDeltaV = Math.max(0, v_at_peri - v_peri_target);
            
            let retrogradeBurnTime = 0;
            if (state.currentStage < ROCKET_CONFIG.stages.length && retrogradeDeltaV > 0) {
                const stage = ROCKET_CONFIG.stages[state.currentStage];
                const currentMass = getTotalMass();
                const thrust = stage.thrustVac;
                
                if (thrust > 0) {
                    retrogradeBurnTime = retrogradeDeltaV * currentMass / thrust;
                }
            }
            
            const burnStartTimeBeforePeri = retrogradeBurnTime / 2;
            const shouldStartRetrograde = !isAscending &&
                                          timeToPeriapsis <= burnStartTimeBeforePeri && 
                                          timeToPeriapsis < Infinity &&
                                          retrogradeBurnTime > 0;
            
            debugInfo.timeToPeriapsis = timeToPeriapsis;
            debugInfo.retroDeltaV = retrogradeDeltaV;
            debugInfo.retroBurnTime = retrogradeBurnTime;
            debugInfo.retroBurnStartTime = burnStartTimeBeforePeri;
            
            if (shouldStartRetrograde) {
                guidanceState.isRetrograde = true;
                correction = 0;
                
                const apoExcess = apoError;
                if (apoExcess < 50000) {
                    commandedThrottle = Math.max(0.1, apoExcess / 50000);
                    debugInfo.reason = 'Retrograde at periapsis — throttling down (' + (apoExcess/1000).toFixed(0) + 'km Ap excess)';
                } else {
                    commandedThrottle = 1.0;
                    debugInfo.reason = 'Starting retrograde burn (T-' + timeToPeriapsis.toFixed(0) + 's to peri)';
                }
            }
            else {
                guidanceState.isRetrograde = false;
                commandedThrottle = 0;
                correction = 0;
                debugInfo.reason = 'Coasting to retrograde burn (T-' + timeToPeriapsis.toFixed(0) + 's, burn at T-' + burnStartTimeBeforePeri.toFixed(0) + 's)';
            }
        }
        // PHASE 4: Both apoapsis and periapsis within tolerance
        else {
            guidanceState.isRetrograde = false;
            commandedThrottle = 0;
            correction = 0;
            debugInfo.reason = 'Orbit achieved — coasting';
            
            // Reset burn flags so they can trigger again if target changes
            guidanceState.circularizationBurnStarted = false;
            guidanceState.retrogradeBurnStarted = false;
        }
        
        debugInfo.apoError = apoError;
        debugInfo.periError = periError;
        
        commandedPitch = basePitch + correction;
        debugInfo.correction = correction;
        debugInfo.isAscending = isAscending;
        debugInfo.nearApoapsis = nearApoapsis;
        
        // --------------------------------------------------------------------
        // PRIORITY 4: VELOCITY — Throttle control
        // --------------------------------------------------------------------
        
        if (commandedThrottle !== 0) {
            const orbitIsClose = Math.abs(apoapsisError) < 50000 && orbit.periapsis > 0;
            
            if (orbitIsClose && remainingDeltaV > velocityDeficit * GUIDANCE_CONFIG.throttleDownMargin) {
                const idealThrottle = velocityDeficit / remainingDeltaV;
                commandedThrottle = Math.max(GUIDANCE_CONFIG.minThrottle, idealThrottle);
                debugInfo.throttleReason = 'Throttling down for precision';
            }
            else {
                commandedThrottle = 1.0;
                debugInfo.throttleReason = 'Full throttle';
            }
        }
        else {
            if (!debugInfo.throttleReason) {
                debugInfo.throttleReason = 'Coasting';
            }
        }
    }
    
    // ========================================================================
    // STEP 5: APPLY CONSTRAINTS
    // ========================================================================
    
    // Clamp pitch to valid range
    commandedPitch = Math.max(-5, Math.min(90, commandedPitch));
    
    // Rate limiting — rocket can only rotate so fast
    if (dt > 0) {
        const maxChange = GUIDANCE_CONFIG.maxPitchRate * dt;
        const desiredChange = commandedPitch - guidanceState.lastCommandedPitch;
        
        if (Math.abs(desiredChange) > maxChange) {
            commandedPitch = guidanceState.lastCommandedPitch + 
                            Math.sign(desiredChange) * maxChange;
        }
    }
    
    // Store for next frame
    guidanceState.lastCommandedPitch = commandedPitch;
    guidanceState.phase = phase;
    guidanceState.throttle = commandedThrottle;
    
    // ========================================================================
    // STEP 6: CONVERT TO THRUST VECTOR
    // ========================================================================
    
    let thrustDir;
    if (guidanceState.isRetrograde) {
        // Retrograde burn: thrust opposite to velocity vector
        const velocityMag = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        if (velocityMag > 0) {
            thrustDir = {
                x: -state.vx / velocityMag,
                y: -state.vy / velocityMag
            };
        } else {
            thrustDir = { x: -localEast.x, y: -localEast.y };
        }
    } else {
        // Normal prograde/guided thrust
        const pitchRad = commandedPitch * Math.PI / 180;
        thrustDir = {
            x: Math.cos(pitchRad) * localEast.x + Math.sin(pitchRad) * localUp.x,
            y: Math.cos(pitchRad) * localEast.y + Math.sin(pitchRad) * localUp.y
        };
    }
    
    // Normalize
    const mag = Math.sqrt(thrustDir.x * thrustDir.x + thrustDir.y * thrustDir.y);
    if (mag > 0) {
        thrustDir.x /= mag;
        thrustDir.y /= mag;
    }
    
    return {
        pitch: commandedPitch,
        thrustDir: thrustDir,
        throttle: commandedThrottle,
        phase: phase,
        debug: debugInfo,
        orbit: orbit,
        velocityDeficit: velocityDeficit,
        remainingDeltaV: remainingDeltaV,
    };
}

