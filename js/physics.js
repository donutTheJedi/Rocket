import { 
    G, 
    EARTH_MASS, 
    EARTH_ROTATION,
    ATM_SCALE_HEIGHT, 
    SEA_LEVEL_PRESSURE, 
    SEA_LEVEL_DENSITY,
    ROCKET_CONFIG 
} from './constants.js';
import { state, getTotalMass } from './state.js';

/**
 * ============================================================================
 * US Standard Atmosphere 1976 Model
 * ============================================================================
 * 
 * Implements the atmospheric model from 0 to 86 km geometric altitude.
 * Uses piecewise linear temperature profiles with geopotential altitude corrections.
 * 
 * PRIMARY REFERENCE
 * U.S. Standard Atmosphere, 1976
 * Published by: NOAA, NASA, and USAF
 * Document: NOAA-S/T 76-1562
 */

// Effective Earth radius for geopotential altitude conversion
// Source: US Std Atm 1976, defined for geopotential height relationship
const EARTH_RADIUS_GEOPOTENTIAL = 6356766;        // m

// Standard acceleration of gravity at sea level
const G0 = 9.80665;                  // m/s²

// Mean molar mass of dry air (molecular weight)
const M0 = 0.0289644;                // kg/mol

// Universal gas constant
const R_STAR = 8.31447;              // J/(mol·K)

// Sea-level reference values (from US Std Atm 1976, Table 3)
const T0 = 288.15;                   // Temperature (K) = 15°C
const P0 = 101325;                   // Pressure (Pa) = 1 atm
const RHO0 = 1.225;                  // Density (kg/m³)

/**
 * Atmospheric layer definitions (from US Std Atm 1976, Table 4)
 * Each layer has: base geopotential altitude (m), base temperature (K), 
 *                 temperature lapse rate (K/m), base pressure (Pa)
 */
const LAYERS = [
    { h: 0,     T: 288.15,  L: -0.0065,  P: 101325 },      // Troposphere base
    { h: 11000, T: 216.65,  L: 0,        P: 22632.1 },     // Tropopause base
    { h: 20000, T: 216.65,  L: 0.001,    P: 5474.89 },     // Stratosphere I base
    { h: 32000, T: 228.65,  L: 0.0028,   P: 868.019 },     // Stratosphere II base
    { h: 47000, T: 270.65,  L: 0,        P: 110.906 },     // Stratopause base
    { h: 51000, T: 270.65,  L: -0.0028,  P: 66.9389 },     // Mesosphere I base
    { h: 71000, T: 214.65,  L: -0.002,   P: 3.95642 }      // Mesosphere II base
];

const MAX_GEOPOTENTIAL = 84852;  // Maximum valid geopotential altitude (m)

/**
 * Convert geometric altitude to geopotential altitude
 * @param {number} z - Geometric altitude (m)
 * @returns {number} Geopotential altitude (m)
 */
function geometricToGeopotential(z) {
    return (EARTH_RADIUS_GEOPOTENTIAL * z) / (EARTH_RADIUS_GEOPOTENTIAL + z);
}

/**
 * Find the atmospheric layer index for a given geopotential altitude
 * @param {number} h - Geopotential altitude (m)
 * @returns {number} Layer index (0-6)
 */
function getLayerIndex(h) {
    for (let i = LAYERS.length - 1; i >= 0; i--) {
        if (h >= LAYERS[i].h) return i;
    }
    return 0;
}

/**
 * Calculate atmospheric temperature at a given geopotential altitude
 * @param {number} h - Geopotential altitude (m)
 * @returns {number} Temperature (K)
 */
function getTemperatureAtGeopotential(h) {
    const i = getLayerIndex(h);
    const layer = LAYERS[i];
    return layer.T + layer.L * (h - layer.h);
}

/**
 * Calculate atmospheric pressure at a given geopotential altitude
 * Uses different formulas for isothermal vs. gradient layers
 * @param {number} h - Geopotential altitude (m)
 * @returns {number} Pressure (Pa)
 */
function getPressureAtGeopotential(h) {
    const i = getLayerIndex(h);
    const layer = LAYERS[i];
    const deltaH = h - layer.h;
    
    if (Math.abs(layer.L) < 1e-10) {
        // Isothermal layer: P = P_b * exp(-g0*M0*(h-h_b)/(R*T_b))
        const exponent = -G0 * M0 * deltaH / (R_STAR * layer.T);
        return layer.P * Math.exp(exponent);
    } else {
        // Gradient layer: P = P_b * (T_b / T)^(g0*M0/(R*L))
        const T = layer.T + layer.L * deltaH;
        const exponent = G0 * M0 / (R_STAR * layer.L);
        return layer.P * Math.pow(layer.T / T, exponent);
    }
}

/**
 * Get complete atmospheric properties at a given geometric altitude
 * @param {number} altitude - Geometric altitude (m)
 * @returns {Object} { temperature, pressure, density, speedOfSound, dynamicViscosity }
 */
export function getAtmosphericProperties(altitude) {
    // Handle negative altitudes (below sea level)
    if (altitude < 0) {
        altitude = 0;
    }
    
    // Convert to geopotential altitude
    const h = geometricToGeopotential(altitude);
    
    // Handle altitudes above model validity (86 km geometric ≈ 84.852 km geopotential)
    if (h > MAX_GEOPOTENTIAL) {
        // Return exponential extrapolation for very high altitudes
        const hClamped = MAX_GEOPOTENTIAL;
        const T = getTemperatureAtGeopotential(hClamped);
        const P = getPressureAtGeopotential(hClamped);
        
        // Simple exponential decay above 86 km
        const scaleHeight = R_STAR * T / (M0 * G0);
        const extraH = h - MAX_GEOPOTENTIAL;
        const Pextra = P * Math.exp(-extraH / scaleHeight);
        const rho = (Pextra * M0) / (R_STAR * T);
        
        return {
            temperature: T,
            pressure: Pextra,
            density: rho,
            speedOfSound: Math.sqrt(1.4 * R_STAR * T / M0),
            dynamicViscosity: getSutherlandViscosity(T),
            geopotentialAltitude: h,
            layer: 6,
            isExtrapolated: true
        };
    }
    
    // Calculate properties within model validity
    const T = getTemperatureAtGeopotential(h);
    const P = getPressureAtGeopotential(h);
    const rho = (P * M0) / (R_STAR * T);  // Ideal gas law
    
    return {
        temperature: T,                                    // K
        pressure: P,                                       // Pa
        density: rho,                                      // kg/m³
        speedOfSound: Math.sqrt(1.4 * R_STAR * T / M0),   // m/s (gamma = 1.4 for air)
        dynamicViscosity: getSutherlandViscosity(T),       // Pa·s
        geopotentialAltitude: h,
        layer: getLayerIndex(h),
        isExtrapolated: false
    };
}

/**
 * Get atmospheric density using US Standard Atmosphere 1976
 * Drop-in replacement for simple exponential model
 * @param {number} altitude - Geometric altitude (m)
 * @returns {number} Air density (kg/m³)
 */
export function getAtmosphericDensity(altitude) {
    return getAtmosphericProperties(altitude).density;
}

/**
 * Get atmospheric pressure at altitude using US Standard Atmosphere 1976
 * @param {number} altitude - Geometric altitude (m)
 * @returns {number} Pressure (Pa)
 */
export function getAtmosphericPressure(altitude) {
    return getAtmosphericProperties(altitude).pressure;
}

/**
 * ============================================================================
 * SUTHERLAND'S VISCOSITY LAW
 * ============================================================================
 * Calculate dynamic viscosity using Sutherland's formula (1893)
 * 
 * Formula: μ = μ₀ * (T/T₀)^(3/2) * (T₀ + S)/(T + S)
 * 
 * Constants for air:
 *   μ₀ = 1.716e-5 Pa·s (reference viscosity)
 *   T₀ = 273.15 K (reference temperature)
 *   S  = 110.4 K (Sutherland's constant for air)
 * 
 * @param {number} T - Temperature (K)
 * @returns {number} Dynamic viscosity (Pa·s)
 */
function getSutherlandViscosity(T) {
    const mu0 = 1.716e-5;    // Reference viscosity (Pa·s)
    const T0 = 273.15;       // Reference temperature (K)
    const S = 110.4;         // Sutherland's constant for air (K)
    
    return mu0 * Math.pow(T / T0, 1.5) * (T0 + S) / (T + S);
}

/**
 * Calculate Mach number
 * @param {number} velocity - Velocity (m/s)
 * @param {number} altitude - Geometric altitude (m)
 * @returns {number} Mach number
 */
export function getMachNumber(velocity, altitude) {
    const atm = getAtmosphericProperties(altitude);
    return velocity / atm.speedOfSound;
}

/**
 * Calculate dynamic pressure (q)
 * @param {number} altitude - Geometric altitude (m)
 * @param {number} velocity - Velocity (m/s)
 * @returns {number} Dynamic pressure (Pa)
 */
export function getDynamicPressure(altitude, velocity) {
    const rho = getAtmosphericDensity(altitude);
    return 0.5 * rho * velocity * velocity;
}

// For comparison: original simple exponential model
export function getAtmosphericDensitySimple(altitude) {
    const rho0 = 1.225;           // Sea level density (kg/m³)
    const H = 8500;               // Scale height (m)
    return rho0 * Math.exp(-altitude / H);
}

/**
 * Compare the two atmospheric models
 * Useful for validation and understanding the differences
 * @param {number} altitude - Geometric altitude (m)
 * @returns {Object} Comparison data
 */
export function compareModels(altitude) {
    const usStd = getAtmosphericDensity(altitude);
    const simple = getAtmosphericDensitySimple(altitude);
    const percentDiff = ((usStd - simple) / usStd) * 100;
    
    return {
        altitude,
        usStandardDensity: usStd,
        simpleDensity: simple,
        percentDifference: percentDiff
    };
}

// Get gravity at radius r
export function getGravity(r) {
    return G * EARTH_MASS / (r * r);
}

// Get current thrust (adjusted for altitude and throttle)
export function getCurrentThrust(altitude, throttle = 1.0) {
    if (!state.engineOn || state.currentStage >= ROCKET_CONFIG.stages.length) return 0;
    if (state.propellantRemaining[state.currentStage] <= 0) return 0;
    
    const stage = ROCKET_CONFIG.stages[state.currentStage];
    const pressureRatio = getAtmosphericPressure(altitude) / SEA_LEVEL_PRESSURE;
    const baseThrust = stage.thrust * pressureRatio + stage.thrustVac * (1 - pressureRatio);
    return baseThrust * throttle;
}

// Get mass flow rate
export function getMassFlowRate(altitude, throttle = 1.0) {
    if (!state.engineOn || state.currentStage >= ROCKET_CONFIG.stages.length) return 0;
    if (state.propellantRemaining[state.currentStage] <= 0) return 0;
    
    const stage = ROCKET_CONFIG.stages[state.currentStage];
    const pressureRatio = getAtmosphericPressure(altitude) / SEA_LEVEL_PRESSURE;
    const isp = stage.isp * pressureRatio + stage.ispVac * (1 - pressureRatio);
    return getCurrentThrust(altitude, throttle) / (isp * 9.81);
}

// Get airspeed (velocity relative to atmosphere)
export function getAirspeed() {
    // Atmospheric velocity at rocket's position (rotating with Earth)
    // Earth rotates counterclockwise (eastward), so velocity is perpendicular to position vector
    const atmVx = EARTH_ROTATION * state.y;  // perpendicular to position vector (eastward)
    const atmVy = -EARTH_ROTATION * state.x;
    
    // Airspeed (velocity relative to atmosphere)
    const airVx = state.vx - atmVx;
    const airVy = state.vy - atmVy;
    const airspeed = Math.sqrt(airVx * airVx + airVy * airVy);
    
    return { airspeed, airVx, airVy };
}

/**
 * ============================================================================
 * MACH-DEPENDENT DRAG COEFFICIENT MODEL
 * ============================================================================
 * 
 * Based on Saturn V wind tunnel data (NASA TM X-53770) scaled for slender
 * launch vehicles using fineness ratio (length/diameter).
 * 
 * Key phenomena modeled:
 * - Subsonic: Skin friction dominates, Cd relatively constant
 * - Transonic (M 0.8-1.2): Sharp drag rise due to shock wave formation
 * - Supersonic: Gradual decrease as shocks stabilize
 * - Hypersonic: Asymptotic approach to minimum
 * 
 * REFERENCES:
 * [1] NASA TM X-53770, "Results of several experimental investigations of the
 *     static aerodynamic characteristics for the Apollo/Saturn V launch vehicle"
 *     Walker, C.E., Marshall Space Flight Center, 1968
 * [2] Braeunig, R.A., "Basics of Space Flight: Aerodynamics"
 *     http://braeunig.us/space/aerodyn_wip.htm
 * [3] "Drag Coefficient Prediction, Chapter 1" (DATCOM-derived methods)
 *     http://www.braeunig.us/space/pdf/Drag_Coefficient_Prediction.pdf
 * 
 * @param {number} mach - Mach number
 * @returns {number} Drag coefficient (referenced to cross-sectional area)
 */
export function getMachDragCoefficient(mach) {
    // Fineness ratio from rocket config
    const finenessRatio = ROCKET_CONFIG.totalLength / ROCKET_CONFIG.stages[0].diameter;
    
    // Fineness ratio adjustment factor
    // Higher L/D = lower drag coefficient (more streamlined)
    // Reference: L/D = 11 (Saturn V), baseline Cd values
    // Adjustment scales linearly with inverse fineness ratio
    const finenessAdjustment = Math.min(1.0, 11 / finenessRatio);
    
    let baseCd;
    
    if (mach < 0.6) {
        // Low subsonic: constant, skin friction dominated
        baseCd = 0.30;
    }
    else if (mach < 0.8) {
        // Subsonic approaching transonic: slight increase begins
        const t = (mach - 0.6) / 0.2;
        baseCd = 0.30 + t * 0.02;
    }
    else if (mach < 1.0) {
        // Transonic drag rise: rapid increase due to shock formation
        // Smooth cubic interpolation for realistic transition
        const t = (mach - 0.8) / 0.2;
        const smoothT = t * t * (3 - 2 * t);  // Smoothstep
        baseCd = 0.32 + smoothT * 0.18;  // Rise from 0.32 to 0.50
    }
    else if (mach < 1.2) {
        // Transonic peak region: maximum drag around M = 1.05
        if (mach < 1.05) {
            baseCd = 0.50 + (mach - 1.0) * 0.4;  // Slight rise to peak ~0.52
        } else {
            baseCd = 0.52 - (mach - 1.05) * 0.4;  // Decrease from peak
        }
    }
    else if (mach < 2.0) {
        // Supersonic: gradual decrease as shocks become more oblique
        const t = (mach - 1.2) / 0.8;
        baseCd = 0.46 - t * 0.10;  // Decrease from 0.46 to 0.36
    }
    else if (mach < 3.0) {
        // High supersonic: continued decrease
        const t = (mach - 2.0) / 1.0;
        baseCd = 0.36 - t * 0.06;  // Decrease from 0.36 to 0.30
    }
    else if (mach < 5.0) {
        // Approaching hypersonic: slow decrease
        const t = (mach - 3.0) / 2.0;
        baseCd = 0.30 - t * 0.05;  // Decrease from 0.30 to 0.25
    }
    else {
        // Hypersonic: asymptotic minimum
        baseCd = 0.22 + 0.03 * Math.exp(-(mach - 5.0) / 3.0);
    }
    
    return baseCd * finenessAdjustment;
}

/**
 * Get drag force using US Standard Atmosphere 1976 with Mach-dependent Cd
 * @param {number} altitude - Geometric altitude (m)
 * @param {number} airspeed - Airspeed (m/s)
 * @param {Object} stage - Optional rocket stage configuration (if not provided, uses current stage from state)
 * @returns {number} Drag force (N)
 */
export function getDrag(altitude, airspeed, stage = null) {
    // Use provided stage or get from state
    if (!stage) {
        if (state.currentStage >= ROCKET_CONFIG.stages.length) return 0;
        stage = ROCKET_CONFIG.stages[state.currentStage];
    }
    
    const atm = getAtmosphericProperties(altitude);
    const density = atm.density;
    const speedOfSound = atm.speedOfSound;
    const area = Math.PI * (stage.diameter / 2) ** 2;
    
    // Calculate Mach number
    const mach = airspeed / speedOfSound;
    
    // Get Mach-dependent drag coefficient
    const Cd = getMachDragCoefficient(mach);
    
    return 0.5 * density * airspeed * airspeed * Cd * area;
}

/**
 * Get current drag coefficient (for telemetry display)
 * @param {number} altitude - Geometric altitude (m)
 * @param {number} airspeed - Airspeed (m/s)
 * @returns {Object} { cd, mach } - Current drag coefficient and Mach number
 */
export function getCurrentDragCoefficient(altitude, airspeed) {
    // Safety check for valid inputs
    if (!isFinite(altitude) || altitude < 0) {
        return { cd: 0, mach: 0 };
    }
    
    // Allow airspeed to be 0 (rocket on ground before launch)
    if (!isFinite(airspeed)) {
        return { cd: 0, mach: 0 };
    }
    
    const atm = getAtmosphericProperties(altitude);
    
    // Safety check for speed of sound
    if (!isFinite(atm.speedOfSound) || atm.speedOfSound <= 0) {
        return { cd: 0, mach: 0 };
    }
    
    // Calculate Mach number (can be 0 if airspeed is 0)
    const mach = airspeed / atm.speedOfSound;
    
    // Get drag coefficient (works even for Mach 0)
    const cd = getMachDragCoefficient(mach);
    
    // Ensure we return valid numbers
    return { 
        cd: isFinite(cd) && cd >= 0 ? cd : 0, 
        mach: isFinite(mach) && mach >= 0 ? mach : 0 
    };
}

