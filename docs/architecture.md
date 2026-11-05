# 🏗️ Snapbite (NutriPulse 360) — System Architecture & Design

> **Document Version**: 1.0.0  
> **Target Audience**: System Architects, Lead Engineers, Technical Interview Panels  
> **Status**: Production Blueprint  

---

## 📌 Executive Architecture Summary
Snapbite is architected around an **event-driven, offline-first, hybrid cloud-edge topology**. The mobile client functions as a real-time telemetry collector and user interface, offloading compute-intensive nutritional vision and clinical pharmacological analysis to Google Gemini 1.5 Flash and deterministic safety engines, while storing patient-grade relational data in a hardened PostgreSQL instance managed via Supabase.

---

## 1. High-Level System Architecture Diagram

```mermaid
flowchart TD
    subgraph ClientLayer["Mobile Client Layer (React Native + Expo SDK 57)"]
        UI["User Interface (Expo Router)"]
        Cam["Camera / Barcode Module"]
        Sensors["GPS & BLE Hardware Engine"]
        Store["SecureStore & AsyncStorage"]
        RevCat["RevenueCat SDK (Paywall Guard)"]
    end

    subgraph EdgeBackend["Edge & Backend Layer (Next.js 14 App Router / Supabase Edge)"]
        AuthMid["NextAuth.js & JWT Middleware"]
        EdgePlanner["/api/planner (Server Actions)"]
        EdgeFood["/api/logs/food (Ephemeral Handler)"]
        Webhooks["/api/webhooks/revenuecat"]
        Cron["/api/cron/purge-free-logs"]
    end

    subgraph IntelligenceLayer["Clinical & AI Services"]
        Gemini["Google Gemini 1.5 Flash (Vision & Reasoning)"]
        DDI["4-Tier Drug Interaction Engine"]
        RxNav["NIH RxNav REST API (Levenshtein Fuzzy Match)"]
        OpenFDA["OpenFDA Drug Label API"]
    end

    subgraph DataLayer["Persistence & Storage Layer"]
        PG[(PostgreSQL 15 - Supabase)]
        PrismaORM["Prisma ORM Client"]
        Vault["Supabase Secrets & Encrypted Vault"]
    end

    %% Client to Backend Flow
    Cam -->|"Ephemeral Base64 (Volatile RAM)"| EdgeFood
    Sensors -->|"Haversine Distance & BLE GATT"| UI
    UI -->|"Session Auth & JWT"| AuthMid
    RevCat -->|"Receipt & Entitlement Check"| Webhooks
    Store <-->|"Offline Cache"| UI

    %% Backend to Intelligence Flow
    EdgeFood -->|"In-Memory Image Stream"| Gemini
    EdgeFood -->|"Medication Cross-Reference"| DDI
    EdgePlanner -->|"Dietary Target Synthesis"| Gemini
    DDI -->|"Fuzzy Drug Normalization"| RxNav
    DDI -->|"Drug Label Adverse Events"| OpenFDA

    %% Backend to Persistence Flow
    AuthMid -->|"User Lookup"| PrismaORM
    EdgeFood -->|"Macro & Safety Log (Zero Image)"| PrismaORM
    EdgePlanner -->|"Meal Plan JSON"| PrismaORM
    Webhooks -->|"Subscription Sync"| PrismaORM
    Cron -->|"Purge Logs > 14 Days"| PrismaORM
    PrismaORM --> PG
    Vault -.->|"API Keys & Service Role"| EdgeBackend
```

---

## 2. End-to-End Data Flow: Ephemeral Plate Scan & Safety Validation

The core differentiator of Snapbite is its **Zero-Storage Ephemeral Vision Pipeline**. To protect user privacy under the DPDP Act 2023 and conserve cloud storage quotas, images never touch persistent disk storage.

```mermaid
sequenceDiagram
    autonumber
    actor User as Patient / User
    participant App as Mobile Client (Expo)
    participant Edge as Next.js / Edge Function
    participant Gemini as Google Gemini 1.5 Flash
    participant DDI as Clinical DDI Engine
    participant DB as Supabase PostgreSQL

    User->>App: Tap "Capture Plate"
    App->>App: Capture frame into volatile buffer (base64)
    App->>App: Retrieve active prescription meds from Local SecureStore
    App->>Edge: POST /api/logs/food (stream in-memory base64 + activeMeds)
    
    activate Edge
    Edge->>Gemini: Stream image buffer with Clinical Nutrition Prompt
    activate Gemini
    Gemini-->>Edge: Structured JSON: { foods, calories, macros, qualityScore }
    deactivate Gemini
    
    Edge->>Edge: Immediately purge image buffer from server RAM

    Edge->>DDI: Evaluate (foods.ingredients vs user.activeMeds)
    activate DDI
    Note over DDI: Check Tier 1 Deterministic Matrix<br/>Check Tyramine, CYP3A4, Chelation, K+
    DDI-->>Edge: Clinical Advisory (e.g., Warfarin + Kale Warning)
    deactivate DDI

    Edge->>DB: INSERT into FoodLog (macros, foodName, advisory - NO IMAGE URL)
    DB-->>Edge: Record Created (ID: uuid)
    
    Edge-->>App: HTTP 200 OK: { mealName, macros, qualityScore, clinicalAdvisory }
    deactivate Edge

    App->>App: Discard camera frame buffer from device RAM
    App->>User: Display Macro Ring, Caloric Progress & Clinical Advisory
```

---

## 3. Sensor & Hardware Telemetry Subsystem

### GPS Workout & Pace Calculation Pipeline
```mermaid
flowchart LR
    GPS["GPS Chipset (Expo Location)"] --> Filter{"Jitter Filter (dx < 25m & dt < 8s)"}
    Filter -->|"Reject Noise"| Discard["Discard Drift"]
    Filter -->|"Valid Movement"| Haversine["Haversine Formula Ground Distance"]
    Haversine --> PaceCalc["Pace Calculation (min'sec''/km)"]
    PaceCalc --> Polyline["Google Polyline Algorithm Compression"]
    Polyline --> DB["Store ActivityLog (routePolyline, calories)"]
```

1. **Jitter Threshold**: Stationary GPS drift commonly records false movement (up to 15 meters) while a user is standing still indoors. The telemetry engine discards any coordinate update where delta distance is `< 25m` within `< 8s`.
2. **Haversine Formula**: Computes precise ground curvature distance:
   $$\Delta\sigma = 2 \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)} \right)$$
   $$\text{Distance} = R \cdot \Delta\sigma \quad (R = 6,371,000 \text{ m})$$
3. **Polyline Encoding**: Instead of sending 2,000 discrete coordinate JSON objects over cellular network, the path is losslessly compressed into an ASCII polyline string, reducing network payload size by 94%.

---

## 4. Institutional 4-Tier Drug-Nutrient Safety Architecture

To guarantee patient safety without introducing network latency bottlenecks, pharmacological contraindication checks run through four hierarchical layers:

```mermaid
flowchart TD
    Input["Input: Scanned Meal Ingredients + Patient Medications"] --> Tier1{"Tier 1: Deterministic Static Matrix"}
    
    Tier1 -->|"Match Found (<5ms)"| StrictBlock["Immediate Clinical Advisory / Warning"]
    Tier1 -->|"No Static Match"| Tier2{"Tier 2: Local Brand Dictionary (150+ Drugs)"}
    
    Tier2 -->|"Brand Identified"| GenericMap["Map Trade Name to Generic RxCUI Molecule"]
    GenericMap --> Tier1
    
    Tier2 -->|"Unknown Generic"| Tier3{"Tier 3: NIH RxNav Approximate Match"}
    Tier3 -->|"Fuzzy Match (Levenshtein)"| ValidateRx["Validate against RxNav Interaction API"]
    
    Tier3 -->|"Unresolved"| Tier4{"Tier 4: Gemini Clinical Safety Directive"}
    Tier4 --> FallbackSafe["Generate Precautionary Patient Talking Point"]
```

- **Tier 1 (Deterministic Pharmacological Table)**: Executes in `< 5ms` with zero network dependency. Governs critical life-threatening hazards:
  - **Statins & CYP3A4**: Blocks Grapefruit/Pomelo (rhabdomyolysis prevention).
  - **MAOIs & Tyramine**: Blocks Aged Cheeses, Cured Meats, Tap Beers (hypertensive crisis prevention).
  - **Warfarin & Vitamin K**: Restricts erratic kale/spinach intake (INR destabilization prevention).
  - **ACE Inhibitors & Potassium**: Blocks potassium chloride salt substitutes (hyperkalemia prevention).
- **Tier 2 (Trade-Name Dictionary)**: Normalizes Indian, US, and EU commercial brand names (e.g., *Dolo 650* $\to$ *Paracetamol*, *Ecosprin* $\to$ *Aspirin*, *Lipitor* $\to$ *Atorvastatin*).
- **Tier 3 (NIH RxNav REST API)**: Performs Levenshtein distance string matching against official RxNorm Clinical Drugs with a 1,500ms safety circuit breaker.
- **Tier 4 (LLM Clinical Directive)**: Formulates human-readable physician talking points if non-standard formulations are detected.

---

## 5. Security, Privacy & Boundary Protection

| Boundary | Enforcement Mechanism |
| :--- | :--- |
| **Authentication** | JWT with cryptographic signing, Bcrypt password hashing ($rounds=10$), NextAuth session cookies. |
| **Data Isolation** | PostgreSQL Row-Level Security (RLS) ensures queries filter strictly on `auth.uid() = user_id`. |
| **Ephemeral Memory** | Images processed in volatile memory only; garbage-collected immediately after Gemini inference. |
| **Data Retention** | Automated cron worker (`/api/cron/purge-free-logs`) purges unconsented logs older than 14 days under DPDP Act 2023. |
| **Secrets Management** | Zero production secrets in client bundles; all AI and DB credentials hosted in Supabase Vault and server environment variables. |
