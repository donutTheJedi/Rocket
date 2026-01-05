# Rocket
A 2D simulation of orbital mechanics and rocket launch from earth

# Guidance System Flowchart

Copy the mermaid code block below directly into your README.md — GitHub will render it automatically.

```mermaid
flowchart TD
    subgraph INIT["⚡ INITIALIZATION"]
        Start([Guidance Loop]) --> Gather[Gather State<br/>Position, Velocity, Altitude]
        Gather --> Predict[Predict Orbit<br/>Apoapsis, Periapsis, SMA]
    end

    subgraph ATMO["🌍 ATMOSPHERIC PHASE · Alt < 70km"]
        Predict --> AtmoCheck{Alt < 70km?}
        AtmoCheck -->|Yes| TimeCheck{T < 10s?}
        TimeCheck -->|Yes| Vertical["Vertical Ascent<br/>Pitch = 90°"]
        TimeCheck -->|No| KickCheck{T < 13s?}
        KickCheck -->|Yes| PitchKick["Pitch Kick<br/>Initiate gravity turn"]
        KickCheck -->|No| MaxQCheck{Q > 80% MaxQ?}
        MaxQCheck -->|Yes| MaxQ["Max-Q Protection<br/>Follow prograde"]
        MaxQCheck -->|No| AtmoGuidance["Atmospheric Guidance<br/>• Prograde following<br/>• Turn rate limiting<br/>• Min vVertical check"]
    end

    subgraph VACUUM["🌌 VACUUM PHASE · Alt ≥ 70km"]
        AtmoCheck -->|No| CalcFPA["Calculate Target FPA<br/>f(progress, target altitude)"]
        
        CalcFPA --> Case0{Pe < 0 AND<br/>Ap ≥ target?}
        Case0 -->|Yes| Emergency["🚨 CASE 0: EMERGENCY<br/>Burn horizontal, full throttle"]
        
        Case0 -->|No| Case1{Ap < target?}
        Case1 -->|Yes| RaiseApo["📈 CASE 1: RAISE APOAPSIS<br/>Burn with FPA guidance"]
        
        Case1 -->|No| Case2{Pe < 100km?}
        Case2 -->|Yes| DescendCheck{Descending?}
        DescendCheck -->|Yes| EmergencyPe["🚨 CASE 2a: EMERGENCY<br/>Burn prograde NOW"]
        DescendCheck -->|No| CoastToApo["⏳ CASE 2b: COAST TO APO<br/>Then burn prograde"]
        
        Case2 -->|No| Case3{Ap > target?}
        Case3 -->|Yes| CoastToPe["⏳ CASE 3: COAST TO PE<br/>Then retrograde burn"]
        
        Case3 -->|No| Case4{Pe < target?}
        Case4 -->|Yes| CircCheck{Near Apo?}
        CircCheck -->|Yes| Circ["🔄 CASE 4a: CIRCULARIZE<br/>Burn prograde at Apo"]
        CircCheck -->|No| CoastCirc["⏳ CASE 4b: COAST<br/>Wait for apoapsis"]
        
        Case4 -->|No| Achieved["✅ CASE 5: ORBIT ACHIEVED"]
    end

    subgraph OUTPUT["📤 OUTPUT"]
        Vertical & PitchKick & MaxQ & AtmoGuidance --> Constrain
        Emergency & RaiseApo & EmergencyPe --> Constrain
        CoastToApo & CoastToPe & Circ & CoastCirc & Achieved --> Constrain
        
        Constrain["Apply Constraints<br/>Pitch: -5° to 90°<br/>Rate: 3°/s max"] --> Return(["Return Command"])
    end
```

## Guidance Cases Summary

| Case | Condition | Action |
|------|-----------|--------|
| **0** | Pe < 0, Ap ≥ target | 🚨 Emergency horizontal burn |
| **1** | Ap < target | 📈 Raise apoapsis with FPA guidance |
| **2a** | Pe < 100km, descending | 🚨 Emergency prograde burn |
| **2b** | Pe < 100km, ascending | ⏳ Coast to Apo, then prograde |
| **3** | Ap > target | ⏳ Coast to Pe, then retrograde |
| **4a** | Pe < target, near Apo | 🔄 Circularize prograde |
| **4b** | Pe < target, far from Apo | ⏳ Coast to apoapsis |
| **5** | Both within tolerance | ✅ Orbit achieved |

## Key Parameters

- **Atmosphere limit**: 70 km
- **Safe periapsis**: 100 km (above atmosphere with margin)
- **Target orbit**: Configurable (default ~400 km circular)
- **Pitch constraints**: -5° to +90°
- **Max pitch rate**: 3°/s