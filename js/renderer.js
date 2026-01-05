import { G, EARTH_MASS, EARTH_RADIUS, KARMAN_LINE } from './constants.js';
import { state, getAltitude } from './state.js';
import { computeGuidance } from './guidance.js';

// Canvas and context (set by init)
let canvas = null;
let ctx = null;

// Initialize renderer with canvas element
export function initRenderer(canvasElement) {
    canvas = canvasElement;
    ctx = canvas.getContext('2d');
}

// Get canvas element
export function getCanvas() {
    return canvas;
}

// Resize canvas to window
export function resize() {
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
}

// Main render function
export function render() {
    if (!ctx || !canvas) return;
    
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const altitude = getAltitude();
    
    // ZOOM: Start at 2 m/px (very close), smoothly zoom out as altitude increases
    const minMPP = 2;
    const maxMPP = state.cameraMode === 'earth' ? Infinity : (EARTH_RADIUS * 20 / Math.min(canvas.width, canvas.height));
    
    let autoMetersPerPixel;
    if (state.cameraMode === 'earth') {
        const defaultEarthZoom = EARTH_RADIUS * 2.5 / Math.min(canvas.width, canvas.height);
        autoMetersPerPixel = defaultEarthZoom;
    } else if (altitude < 500) {
        autoMetersPerPixel = minMPP;
    } else {
        const zoomProgress = Math.min(1, Math.log10(altitude / 500) / 6);
        autoMetersPerPixel = minMPP * Math.pow(maxMPP / minMPP, zoomProgress);
    }
    
    const metersPerPixel = (state.cameraMode === 'earth' || !state.autoZoom) 
        ? autoMetersPerPixel / state.manualZoom 
        : autoMetersPerPixel / state.manualZoom;
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Stars
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 200; i++) {
        const sx = (Math.sin(i * 567.89 + 1000) * 0.5 + 0.5) * canvas.width;
        const sy = (Math.cos(i * 123.45 + 500) * 0.5 + 0.5) * canvas.height;
        ctx.fillRect(sx, sy, Math.random() > 0.85 ? 2 : 1, 1);
    }
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(1 / metersPerPixel, -1 / metersPerPixel);
    
    // Camera: either follow rocket or center on Earth
    if (state.cameraMode === 'earth') {
        ctx.translate(0, 0);
    } else {
        ctx.translate(-state.x, -state.y);
    }
    
    // Earth
    ctx.beginPath();
    ctx.arc(0, 0, EARTH_RADIUS, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(-EARTH_RADIUS * 0.3, EARTH_RADIUS * 0.3, 0, 0, 0, EARTH_RADIUS);
    grad.addColorStop(0, '#3a7d32');
    grad.addColorStop(0.6, '#1a5a1a');
    grad.addColorStop(1, '#0a3a0a');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#2a8a2a';
    ctx.lineWidth = metersPerPixel * 2;
    ctx.stroke();
    
    // City visualization - fades as altitude increases
    // City fades from fully visible at ground level to invisible at 100km
    const fadeStartAlt = 0;
    const fadeEndAlt = 100000; // 100km
    const cityOpacity = Math.max(0, 1 - (altitude - fadeStartAlt) / (fadeEndAlt - fadeStartAlt));
    
    if (cityOpacity > 0 && metersPerPixel < 100) {
        // Launch site is at (0, EARTH_RADIUS)
        // Keep rocket area clear (about 800m clear zone)
        const rocketClearZone = 3400; // meters
        const cityStartX = rocketClearZone + 1000; // Start city 1km to the right of clear zone
        const cityEndX = cityStartX + 50000; // 9km of city to the right
        const cityY = EARTH_RADIUS;
        
        ctx.save();
        ctx.globalAlpha = cityOpacity;
        
        // Generate dense cityscape - lots of buildings spanning 9km
        const buildings = [];
        let currentX = cityStartX;
        
        // Generate buildings in rows (multiple rows for density)
        while (currentX < cityEndX) {
            // Determine building size (varied for realism)
            const randSeed = currentX * 0.0001; // Use position as seed for deterministic randomness
            const hash = Math.floor(Math.abs(Math.sin(randSeed)) * 1000000) % 1000;
            
            // Building width: 40-100m (most buildings 50-80m)
            const widthOptions = [45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
            const width = widthOptions[hash % widthOptions.length];
            
            // Building height: varies by area (downtown taller, suburbs shorter)
            const distanceFromStart = currentX - cityStartX;
            const cityProgress = distanceFromStart / 9000; // 0 to 1
            
            let height;
            if (cityProgress < 0.2) {
                // Closer to rocket: shorter buildings (suburbs)
                height = 100 + (hash % 100);
            } else if (cityProgress < 0.6) {
                // Middle: medium buildings (urban)
                height = 150 + (hash % 150);
            } else {
                // Far end: tall buildings (downtown)
                height = 200 + (hash % 200);
            }
            
            buildings.push({
                x: currentX,
                width: width,
                height: height,
                hash: hash
            });
            
            // Spacing: buildings are close together (city density)
            // Some small gaps, but mostly touching
            const spacing = width + (hash % 20); // 0-19m spacing
            currentX += spacing;
        }
        
        // Draw all buildings
        for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i];
            const x = b.x;
            const y = cityY;
            
            // Building base (on Earth surface) - varied colors for depth
            const hue = (b.hash * 17) % 360;
            const brightness = 25 + (b.hash % 4) * 12;
            ctx.fillStyle = `hsl(${hue}, 25%, ${brightness}%)`;
            ctx.fillRect(x - b.width/2, y, b.width, b.height);
            
            // Building outline for definition
            ctx.strokeStyle = '#222';
            ctx.lineWidth = Math.max(metersPerPixel * 0.3, 0.5);
            ctx.strokeRect(x - b.width/2, y, b.width, b.height);
            
            // Building windows (deterministic pattern)
            ctx.fillStyle = '#ffaa00';
            const windowRows = Math.floor(b.height / 30);
            const windowsPerRow = Math.floor(b.width / 20);
            for (let row = 0; row < windowRows; row++) {
                for (let col = 0; col < windowsPerRow; col++) {
                    // Deterministic pattern: light windows based on position hash
                    const windowHash = (b.hash * 31 + row * 17 + col * 13) % 100;
                    if (windowHash > 35) { // ~65% of windows lit
                        ctx.fillRect(
                            x - b.width/2 + 5 + col * 20,
                            y + 5 + row * 30,
                            8, 15
                        );
                    }
                }
            }
        }
        
        ctx.restore();
    }
    
    // Ground detail when close
    if (metersPerPixel < 20) {
        ctx.fillStyle = '#555';
        ctx.fillRect(-30, EARTH_RADIUS - 1, 60, 2);
        ctx.fillStyle = '#777';
        ctx.fillRect(-25, EARTH_RADIUS, 4, 60);
    }
    
    // Atmosphere layers (when zoomed out)
    if (metersPerPixel > 50) {
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(0, 0, EARTH_RADIUS + (i + 1) * 25000, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(100, 150, 255, ${0.1 - i * 0.02})`;
            ctx.lineWidth = 20000;
            ctx.stroke();
        }
    }
    
    // Karman line
    if (metersPerPixel > 200) {
        ctx.beginPath();
        ctx.arc(0, 0, EARTH_RADIUS + KARMAN_LINE, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
        ctx.lineWidth = 1500;
        ctx.setLineDash([15000, 15000]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Trail
    if (state.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(state.trail[0].x, state.trail[0].y);
        for (let i = 1; i < state.trail.length; i++) {
            ctx.lineTo(state.trail[i].x, state.trail[i].y);
        }
        ctx.strokeStyle = 'rgba(255, 120, 0, 0.8)';
        ctx.lineWidth = Math.max(metersPerPixel * 2, 2);
        ctx.stroke();
    }
    
    // Rocket - ACTUAL SIZE 70m x 3.7m
    const rocketLen = 70;
    const rocketWid = 3.7;
    
    ctx.save();
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const localUp = { x: state.x / r, y: state.y / r };
    const localEast = { x: localUp.y, y: -localUp.x };
    ctx.translate(state.x + localUp.x * rocketLen * 0.5, state.y + localUp.y * rocketLen * 0.5);
    
    // Calculate rocket orientation
    // In orbital mode when not burning, point along velocity (prograde)
    // When burning, point along thrust direction
    // Otherwise, use guidance or pitch
    let rocketDir;
    const currentAltitude = getAltitude();
    const pitchProgramComplete = state.gameMode === 'orbital' || state.time > 600 || (!state.engineOn && currentAltitude > 150000);
    
    if (state.burnMode && pitchProgramComplete && currentAltitude > 150000) {
        // Burning: point along thrust direction
        const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        rocketDir = velocity > 0 ? { x: state.vx / velocity, y: state.vy / velocity } : { x: localEast.x, y: localEast.y };
    } else if (state.gameMode === 'orbital') {
        // Orbital mode, not burning: point along velocity (prograde)
        const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        rocketDir = velocity > 0 ? { x: state.vx / velocity, y: state.vy / velocity } : { x: localEast.x, y: localEast.y };
    } else {
        // Use pitch to determine direction
        const pitch = state.guidancePitch !== undefined ? state.guidancePitch : 90.0;
        // In manual mode, use manual pitch
        if (state.gameMode === 'manual' && state.manualPitch !== null) {
            const pitchRad = state.manualPitch * Math.PI / 180;
            rocketDir = {
                x: Math.cos(pitchRad) * localEast.x + Math.sin(pitchRad) * localUp.x,
                y: Math.cos(pitchRad) * localEast.y + Math.sin(pitchRad) * localUp.y
            };
        } else {
            // Use guidance pitch
            const pitchRad = pitch * Math.PI / 180;
            rocketDir = {
                x: Math.cos(pitchRad) * localEast.x + Math.sin(pitchRad) * localUp.x,
                y: Math.cos(pitchRad) * localEast.y + Math.sin(pitchRad) * localUp.y
            };
        }
    }
    
    const rocketAngle = Math.atan2(rocketDir.y, rocketDir.x) - Math.PI / 2;
    ctx.rotate(rocketAngle);
    
    // Make rocket visible even when zoomed out
    const minPixelSize = 12;
    const scale = Math.max(1, minPixelSize * metersPerPixel / rocketLen);
    const drawLen = rocketLen * scale;
    const drawWid = rocketWid * scale;
    
    // Body
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(-drawWid/2, -drawLen * 0.4, drawWid, drawLen * 0.8);
    
    // Nose
    ctx.beginPath();
    ctx.moveTo(-drawWid/2, drawLen * 0.4);
    ctx.lineTo(0, drawLen * 0.55);
    ctx.lineTo(drawWid/2, drawLen * 0.4);
    ctx.fillStyle = '#d33';
    ctx.fill();
    
    // Fins
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.moveTo(-drawWid/2, -drawLen * 0.35);
    ctx.lineTo(-drawWid * 0.9, -drawLen * 0.45);
    ctx.lineTo(-drawWid/2, -drawLen * 0.2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(drawWid/2, -drawLen * 0.35);
    ctx.lineTo(drawWid * 0.9, -drawLen * 0.45);
    ctx.lineTo(drawWid/2, -drawLen * 0.2);
    ctx.fill();
    
    // Flame
    if (state.engineOn && state.propellantRemaining[state.currentStage] > 0) {
        const flameLen = drawLen * (0.5 + Math.random() * 0.25);
        ctx.beginPath();
        ctx.moveTo(-drawWid * 0.2, -drawLen * 0.4);
        ctx.quadraticCurveTo(-drawWid * 0.35, -drawLen * 0.4 - flameLen * 0.5, 0, -drawLen * 0.4 - flameLen);
        ctx.quadraticCurveTo(drawWid * 0.35, -drawLen * 0.4 - flameLen * 0.5, drawWid * 0.2, -drawLen * 0.4);
        ctx.fillStyle = `rgb(255, ${80 + Math.random() * 60}, 0)`;
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(-drawWid * 0.1, -drawLen * 0.4);
        ctx.quadraticCurveTo(-drawWid * 0.15, -drawLen * 0.4 - flameLen * 0.35, 0, -drawLen * 0.4 - flameLen * 0.6);
        ctx.quadraticCurveTo(drawWid * 0.15, -drawLen * 0.4 - flameLen * 0.35, drawWid * 0.1, -drawLen * 0.4);
        ctx.fillStyle = `rgb(255, ${200 + Math.random() * 55}, ${100 + Math.random() * 80})`;
        ctx.fill();
    }
    
    ctx.restore();
    
    // Draw thrust vector arrow
    if (state.engineOn && state.propellantRemaining[state.currentStage] > 0) {
        const arrowLength = 100;
        const arrowHeadSize = 12;
        
        ctx.save();
        const rArrow = Math.sqrt(state.x * state.x + state.y * state.y);
        const localUpArrow = { x: state.x / rArrow, y: state.y / rArrow };
        ctx.translate(state.x + localUpArrow.x * rocketLen * 0.5, state.y + localUpArrow.y * rocketLen * 0.5);
        
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(thrustDir.x * arrowLength, thrustDir.y * arrowLength);
        ctx.strokeStyle = '#0ff';
        ctx.lineWidth = metersPerPixel * 3;
        ctx.stroke();
        
        const arrowX = thrustDir.x * arrowLength;
        const arrowY = thrustDir.y * arrowLength;
        const arrowAngle = Math.atan2(thrustDir.y, thrustDir.x);
        
        const tipX = arrowX;
        const tipY = arrowY;
        const baseOffset = arrowHeadSize * 0.8;
        const baseX = arrowX - baseOffset * Math.cos(arrowAngle);
        const baseY = arrowY - baseOffset * Math.sin(arrowAngle);
        const wingOffset = arrowHeadSize * 0.5;
        
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
            baseX + wingOffset * Math.cos(arrowAngle + Math.PI / 2),
            baseY + wingOffset * Math.sin(arrowAngle + Math.PI / 2)
        );
        ctx.lineTo(
            baseX + wingOffset * Math.cos(arrowAngle - Math.PI / 2),
            baseY + wingOffset * Math.sin(arrowAngle - Math.PI / 2)
        );
        ctx.closePath();
        ctx.fillStyle = '#0ff';
        ctx.fill();
        
        ctx.restore();
    }
    
    // Orbit prediction
    const v = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    const mu = G * EARTH_MASS;
    const energy = (v * v / 2) - (mu / r);
    if (altitude > 10000 && energy < 0) {
        const a = -mu / (2 * energy);
        const h = state.x * state.vy - state.y * state.vx;
        const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
        if (e < 1 && a > 0 && a < EARTH_RADIUS * 50 && e >= 0) {
            const v2 = v * v;
            const rVec = { x: state.x, y: state.y };
            const vVec = { x: state.vx, y: state.vy };
            
            const rDotV = rVec.x * vVec.x + rVec.y * vVec.y;
            const eVec = {
                x: ((v2 - mu / r) * rVec.x - rDotV * vVec.x) / mu,
                y: ((v2 - mu / r) * rVec.y - rDotV * vVec.y) / mu
            };
            
            let periapsisAngle;
            if (e < 0.001) {
                periapsisAngle = Math.atan2(rVec.y, rVec.x);
            } else {
                periapsisAngle = Math.atan2(eVec.y, eVec.x);
            }
            
            ctx.beginPath();
            let firstPoint = true;
            let lastValidPoint = null;
            
            if (e < 0.001) {
                const radius = a;
                if (radius > EARTH_RADIUS && radius < EARTH_RADIUS * 50) {
                    ctx.arc(0, 0, radius, 0, Math.PI * 2);
                }
            } else {
                const theta0 = periapsisAngle;
                for (let ang = 0; ang <= Math.PI * 2 + 0.05; ang += 0.01) {
                    const rOrb = a * (1 - e * e) / (1 + e * Math.cos(ang));
                    if (rOrb > EARTH_RADIUS && rOrb < EARTH_RADIUS * 50 && isFinite(rOrb)) {
                        const xO = rOrb * Math.cos(ang + theta0);
                        const yO = rOrb * Math.sin(ang + theta0);
                        if (isFinite(xO) && isFinite(yO)) {
                            if (firstPoint) {
                                ctx.moveTo(xO, yO);
                                firstPoint = false;
                                lastValidPoint = { x: xO, y: yO };
                            } else {
                                if (lastValidPoint) {
                                    const dx = xO - lastValidPoint.x;
                                    const dy = yO - lastValidPoint.y;
                                    const dist = Math.sqrt(dx * dx + dy * dy);
                                    if (dist < EARTH_RADIUS * 10) {
                                        ctx.lineTo(xO, yO);
                                        lastValidPoint = { x: xO, y: yO };
                                    }
                                } else {
                                    ctx.lineTo(xO, yO);
                                    lastValidPoint = { x: xO, y: yO };
                                }
                            }
                        }
                    }
                }
            }
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
            ctx.lineWidth = Math.max(metersPerPixel * 3, 2);
            ctx.setLineDash([metersPerPixel * 20, metersPerPixel * 10]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    
    ctx.restore();
    ctx.restore();
    
    // Info
    ctx.fillStyle = '#555';
    ctx.font = '11px Courier New';
    ctx.fillText(`${metersPerPixel < 1000 ? metersPerPixel.toFixed(1) + ' m/px' : (metersPerPixel/1000).toFixed(2) + ' km/px'}`, 10, canvas.height - 10);
}

