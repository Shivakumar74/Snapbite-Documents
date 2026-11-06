# 📡 Snapbite (NutriPulse 360) — API Specification & Contract Design

> **Base URL**: `https://api.snapbite.health` (or `https://<project-ref>.supabase.co/functions/v1`)  
> **API Version**: `v1`  
> **Standard Format**: JSON (`application/json`)  
> **Authentication**: Bearer JWT (`Authorization: Bearer <session_token>`)  

---

## 📌 Overview
This document specifies the core REST API contracts powering the Snapbite platform. All endpoints enforce strict payload validation, standardized error envelopes, and automated rate-limiting.

---

## Standard Error Response Envelope
Every failed request returns a uniform JSON error payload:

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Detailed human-readable explanation of error.",
    "field": "optional_invalid_field_name",
    "timestamp": "2026-11-05T17:30:00Z"
  }
}
```

---

## 1. Ephemeral Multimodal Food Scan & Macro Inference

### `POST /api/logs/food`
Uploads an in-memory food plate photo or barcode string along with the user's active medication list. The server passes the image ephemerally to Google Gemini 3.8 Flash LTS (`thinkingBudget: 0`), cross-references ingredients against the 4-layer Clinical Safety Engine, persists the nutritional entry to PostgreSQL, and immediately frees the image buffer from RAM.

#### Headers
| Key | Type | Description |
| :--- | :--- | :--- |
| `Authorization` | `string` (Required) | `Bearer <JWT_TOKEN>` |
| `Content-Type` | `string` (Required) | `application/json` |

#### Request Body
```json
{
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "mimeType": "image/jpeg",
  "moodBefore": "Energized",
  "activeMedications": [
    "Atorvastatin",
    "Warfarin",
    "Metformin"
  ],
  "declaredAllergies": [
    "Peanuts",
    "Shellfish"
  ]
}
```

#### TypeScript Request Interface
```typescript
interface FoodScanRequest {
  imageBase64: string;           // Base64 encoded byte stream (max 10MB)
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  moodBefore?: string;           // "Energized" | "Tired" | "Stressed" | "Neutral"
  activeMedications: string[];   // Active generic or trade drug names
  declaredAllergies?: string[];  // Patient food allergy flags
}
```

#### Success Response: `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "e4f8d220-4357-4b95-bf31-98834927b58c",
    "mealName": "Mediterranean Salmon & Steamed Broccoli",
    "estimatedCalories": 580,
    "macros": {
      "proteinGrams": 46,
      "carbsGrams": 22,
      "fatsGrams": 32,
      "proteinPercent": 32,
      "carbsPercent": 15,
      "fatsPercent": 53
    },
    "qualityScore": "GREEN",
    "energyTag": "High Protein",
    "isLeafyGreen": true,
    "identifiedIngredients": [
      "Atlantic Salmon fillet",
      "Olive oil",
      "Steamed broccoli florets",
      "Garlic clove",
      "Lemon zest"
    ],
    "clinicalAdvisory": {
      "hasHazard": false,
      "severity": "NORMAL",
      "advisoryMessage": "Meal safely cleared: No hazardous CYP3A4 or Vitamin K contraindications detected for active Atorvastatin and Warfarin regimens."
    },
    "loggedAt": "2026-11-05T17:35:12.842Z"
  }
}
```

#### Hazard Detected Response: `201 Created` (With Clinical Flag)
If the meal contains a contraindicated food (e.g., patient on Warfarin eating concentrated raw kale):
```json
{
  "success": true,
  "data": {
    "id": "a9b1c3d4-7890-4123-bcde-0123456789ab",
    "mealName": "Raw Kale & Spinach Power Salad with Citrus Dressing",
    "estimatedCalories": 310,
    "macros": {
      "proteinGrams": 9,
      "carbsGrams": 28,
      "fatsGrams": 18,
      "proteinPercent": 12,
      "carbsPercent": 36,
      "fatsPercent": 52
    },
    "qualityScore": "RED",
    "energyTag": "Light",
    "isLeafyGreen": true,
    "clinicalAdvisory": {
      "hasHazard": true,
      "severity": "CRITICAL",
      "interactingDrug": "Warfarin",
      "interactingNutrient": "High-Dose Vitamin K",
      "title": "Severe Anticoagulant Antagonism Detected",
      "description": "Concentrated raw kale delivers supraphysiological levels of Vitamin K, directly antagonizing Warfarin's mechanism and destabilizing prothrombin time (INR).",
      "actionableGuidance": "Avoid concentrated raw kale salads while on Warfarin. Consult your prescribing physician or hematologist before modifying green vegetable intake."
    },
    "loggedAt": "2026-11-05T17:40:00.100Z"
  }
}
```

#### Status Codes & Error Responses
- `400 Bad Request`: Image base64 string corrupted, invalid mime type, or unparseable input.
- `401 Unauthorized`: Missing or expired Bearer token.
- `429 Too Many Requests`: User has exhausted daily free-tier scan quota (5 free scans/day exceeded).
- `500 Internal Server Error`: Upstream AI model timeout or database persistence failure.

---

## 2. Adaptive AI Meal Planner & Cultural Synthesis

### `POST /api/planner`
Generates or swaps personalized 7-day nutritional plans synthesized across daily caloric limits, cultural cuisine, allergies, and patient medications. Powered by Google Gemini 3.8 Flash LTS with a calibrated `128`-token clinical reasoning scratchpad and automatic fallback to `gemini-3.1-flash-lite` on upstream load.

#### Headers
| Key | Type | Description |
| :--- | :--- | :--- |
| `Authorization` | `string` (Required) | `Bearer <JWT_TOKEN>` |
| `Content-Type` | `string` (Required) | `application/json` |

#### Request Body (Generate Action)
```json
{
  "action": "generate",
  "userId": "cuid_user_8716321948",
  "targetDays": 7,
  "culturalCuisine": "South Indian",
  "dietaryType": "Vegetarian",
  "calorieBudget": 1950,
  "excludedAllergens": ["Gluten", "Dairy"]
}
```

#### TypeScript Request Interface
```typescript
interface PlannerRequest {
  action: 'generate' | 'clear' | 'swap' | 'alternatives';
  userId: string;
  targetDays?: number;           // Defaults to 7 days
  culturalCuisine?: string;      // e.g., "South Indian", "Mediterranean", "Mexican"
  dietaryType?: string;          // "Vegetarian" | "Vegan" | "Keto" | "None"
  calorieBudget?: number;        // Total target kcal/day
  dayName?: string;              // Required for 'swap' (e.g., "Wednesday")
  mealType?: string;             // "Breakfast" | "Lunch" | "Dinner" | "Snack"
  newMeal?: object;              // Required for 'swap' action
  currentMealName?: string;      // Required for 'alternatives' action
}
```

#### Success Response: `200 OK`
```json
{
  "success": true,
  "mealPlan": {
    "generatedAt": "2026-11-05T17:45:00.000Z",
    "calorieBudget": 1950,
    "cuisine": "South Indian",
    "days": [
      {
        "day": "Monday",
        "dailyTotals": { "calories": 1940, "protein": 78, "carbs": 240, "fats": 76 },
        "meals": [
          {
            "type": "Breakfast",
            "name": "Steamed Ragi Idli with Sambar & Flaxseed Podi",
            "calories": 420,
            "protein": 16,
            "carbs": 68,
            "fats": 10,
            "prepTimeMinutes": 20,
            "contraindicationNotes": "Safe for active Levothyroxine regimen (dairy excluded at breakfast)."
          },
          {
            "type": "Lunch",
            "name": "Millet Curd Rice Bowl with Tempered Mustard & Cucumber",
            "calories": 610,
            "protein": 24,
            "carbs": 82,
            "fats": 21,
            "prepTimeMinutes": 25
          },
          {
            "type": "Dinner",
            "name": "Spiced Lentil Tadka with Brown Rice & Stir-Fried Okra",
            "calories": 680,
            "protein": 28,
            "carbs": 90,
            "fats": 24,
            "prepTimeMinutes": 30
          },
          {
            "type": "Snack",
            "name": "Roasted Makhana (Fox Nuts) with Turmeric & Chaat Masala",
            "calories": 230,
            "protein": 10,
            "carbs": 28,
            "fats": 8,
            "prepTimeMinutes": 5
          }
        ]
      }
    ]
  }
}
```

---

## 3. User Authentication & Clinical Profile Baseline

### `POST /api/auth/register`
Creates a new patient profile, hashes credentials with Bcrypt ($10$ rounds), sets up default DPDP consent flags, and initializes baseline biometric targets.

#### Request Body
```json
{
  "name": "Alex Mercer",
  "email": "alex.mercer@example.com",
  "password": "SecurePassword#2026",
  "age": 34,
  "gender": "Male",
  "height": 178.5,
  "currentWeight": 76.0,
  "targetWeight": 72.0,
  "activityLevel": "Moderate",
  "wellnessGoal": "Fat Loss & Metabolic Health",
  "regionOrCountry": "India",
  "ethnicityOrCuisine": "South Indian",
  "dietaryType": "None"
}
```

#### Success Response: `201 Created`
```json
{
  "success": true,
  "user": {
    "id": "clx891ab0000008l34f9a7z1e",
    "name": "Alex Mercer",
    "email": "alex.mercer@example.com",
    "subscriptionTier": "FREE",
    "freeScansLeft": 5,
    "freeGenerationsLeft": 3,
    "hydrationGoal": 3.0,
    "targetCalories": 2150,
    "targetProtein": 135,
    "targetCarbs": 240,
    "targetFats": 72,
    "createdAt": "2026-11-05T17:50:00.000Z"
  }
}
```

#### Error Response: `409 Conflict` (Email Already Exists)
```json
{
  "success": false,
  "error": {
    "code": "USER_ALREADY_EXISTS",
    "message": "An account registered with this email address already exists.",
    "field": "email"
  }
}
```

---

## 4. Habit Logging & Micro-Streak Recovery

### `POST /api/habits/log`
Records daily health habit completions (e.g., "Drink 2.5L Water", "Take Evening Statins", "10,000 Steps"). Features a micro-recovery algorithm preventing total streak resets if a single day is recovered within 24 hours.

#### Request Body
```json
{
  "userHabitId": "hab_8971239841",
  "loggedDate": "2026-11-05",
  "status": "COMPLETED",
  "amount": 2.5
}
```

#### Success Response: `200 OK`
```json
{
  "success": true,
  "data": {
    "logId": "log_5541092831",
    "currentStreak": 14,
    "longestStreak": 21,
    "status": "COMPLETED",
    "isMilestoneAchieved": true,
    "milestoneBadge": "Two-Week Consistency Champion"
  }
}
```
