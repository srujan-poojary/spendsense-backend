import { ENV } from "../config/env";

export interface ReceiptItem {
  name: string;
  price: number;
}

export interface ExtractedReceipt {
  merchant: string;
  category: string;
  purchase_date: string;
  amount: number;
  items: ReceiptItem[];
  confidence?: string;
}

const ALLOWED_CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Shopping",
  "Transport",
  "Entertainment",
  "Utilities",
  "Healthcare",
  "Education",
  "Travel",
  "Subscriptions",
  "Other",
];

/**
 * Clean potential markdown wrappers and extract valid JSON string
 */
function cleanJsonString(raw: string): string {
  let cleaned = raw.trim();
  // Remove markdown code fences like ```json ... ``` or ``` ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  }
  return cleaned.trim();
}

/**
 * Format date to YYYY-MM-DD
 */
function sanitizeDate(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString().split("T")[0];

  // Handle DD/MM/YY or DD/MM/YYYY
  if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(dateStr)) {
    const parts = dateStr.split(/[\/\-\.]/);
    let day = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return new Date().toISOString().split("T")[0];
  }
  return parsed.toISOString().split("T")[0];
}

/**
 * Scan receipt image using Google Gemini Multimodal API
 * Keeps GEMINI_API_KEY completely private on the server.
 */
export async function analyzeReceiptWithGemini(
  base64Data: string,
  mimeType: string = "image/jpeg"
): Promise<ExtractedReceipt> {
  if (!ENV.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured on the backend server. Please check your backend/.env file."
    );
  }

  // Strip prefix data URI if present (e.g. data:image/png;base64,...)
  const pureBase64 = base64Data.replace(/^data:image\/[a-zA-Z]+;base64,/, "");

  const prompt = `You are a high-precision financial OCR intelligence model.
Analyze this receipt image and extract the exact transaction details into STRICT JSON format with this exact schema:
{
  "merchant": "Exact business / restaurant / store name from the top header",
  "category": "Food & Dining | Groceries | Shopping | Transport | Entertainment | Utilities | Healthcare | Education | Travel | Subscriptions | Other",
  "purchase_date": "YYYY-MM-DD",
  "amount": 0.00,
  "items": [
    {
      "name": "Item description or name",
      "price": 0.00
    }
  ]
}

STRICT INSTRUCTIONS:
1. Return ONLY pure valid JSON. No conversational text, no markdown backticks, no code fences.
2. "merchant": The actual store, cafe, restaurant, or business name (check top header, logo, or footer).
3. "amount": The Grand Total / Final payable amount (as a valid number, e.g. 4770.00). Do NOT include currency symbols.
4. "purchase_date": Format as YYYY-MM-DD. If formatted as DD/MM/YY, convert properly (e.g. 22/02/26 -> 2026-02-22).
5. "items": Extract all individual items listed on the receipt. For each item's price, extract the total line amount (e.g. if Qty is 2 and Unit Price is 194.00, the line amount is 388.00).
6. "category": Choose the single most accurate category from the allowed list. Restaurants, cafes, eateries must be "Food & Dining". Supermarkets/provisions must be "Groceries".`;

  // Models to try in order of capability/speed
  const modelsToTry = [
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-pro",
  ];

  let rawOutput: string | null = null;
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${ENV.GEMINI_API_KEY}`;
      const payload = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: pureBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      };

      console.log(`[Gemini OCR] Calling ${model}...`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[Gemini OCR] Model ${model} failed (${response.status}):`, errorText);
        lastError = new Error(`Gemini API error (${response.status}): ${errorText}`);
        continue;
      }

      const data = await response.json();
      rawOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawOutput) {
        console.log(`[Gemini OCR] Success with model ${model}`);
        break;
      }
    } catch (err: any) {
      console.warn(`[Gemini OCR] Network error on model ${model}:`, err.message);
      lastError = err;
    }
  }

  if (!rawOutput) {
    throw new Error(
      lastError?.message ||
        "Failed to receive a valid response from Gemini. Please verify your receipt image or Gemini API key."
    );
  }

  // Parse and defensively validate
  let parsed: any;
  try {
    const cleaned = cleanJsonString(rawOutput);
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("[Gemini OCR] JSON parse error on raw output:", rawOutput);
    throw new Error("Gemini returned unstructured data that could not be parsed into JSON.");
  }

  // Sanitize and validate fields
  const merchant = typeof parsed.merchant === "string" && parsed.merchant.trim()
    ? parsed.merchant.trim()
    : "Unspecified Merchant";

  const category = ALLOWED_CATEGORIES.includes(parsed.category)
    ? parsed.category
    : "Other";

  const purchase_date = sanitizeDate(parsed.purchase_date);

  const amount = typeof parsed.amount === "number" && !isNaN(parsed.amount)
    ? Math.abs(parsed.amount)
    : parseFloat(String(parsed.amount || "0").replace(/[^0-9.]/g, "")) || 0;

  let items: ReceiptItem[] = [];
  if (Array.isArray(parsed.items) && parsed.items.length > 0) {
    items = parsed.items.map((i: any) => ({
      name: String(i.name || "Item").trim(),
      price: typeof i.price === "number" && !isNaN(i.price)
        ? Math.abs(i.price)
        : parseFloat(String(i.price || "0").replace(/[^0-9.]/g, "")) || 0,
    }));
  } else {
    items = [{ name: merchant, price: amount }];
  }

  return {
    merchant,
    category,
    purchase_date,
    amount,
    items,
    confidence: "high",
  };
}

export interface IntelligenceCard {
  type: "alert" | "itemized" | "runway" | "savings";
  icon: string;
  title: string;
  detail: string;
  badge?: string;
}

export interface SpendingIntelligence {
  headline: string;
  summary: string;
  healthScore: number;
  healthLabel: "Optimal" | "Healthy" | "Attention" | "Critical";
  cards: IntelligenceCard[];
  actionableTip: string;
  dominantMerchant: string;
  dominantCategory: string;
  discretionaryRatio: number;
}

/**
 * Intelligent deterministic analyzer that operates on transaction data and line items.
 * Guaranteed zero-latency, high-precision financial intelligence.
 */
export function generateDeterministicIntelligence(
  expenses: any[],
  monthlyBudget: number = 20000,
  effectiveCycleSpent: number = 0
): SpendingIntelligence {
  if (!expenses || expenses.length === 0) {
    return {
      headline: "No Transactions Recorded Yet",
      summary: "Upload your first receipt to generate spending insights and itemized categorization.",
      healthScore: 98,
      healthLabel: "Optimal",
      cards: [
        {
          type: "runway",
          icon: "bi-shield-check",
          title: "Budget Fully Preserved",
          detail: `Your entire monthly budget of ₹${monthlyBudget.toLocaleString("en-IN")} remains available.`,
          badge: "Full Runway",
        },
      ],
      actionableTip: "Scan your latest grocery, coffee, or dining receipt to test instant line-item extraction.",
      dominantMerchant: "None",
      dominantCategory: "None",
      discretionaryRatio: 0,
    };
  }

  const totalLifetime = expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
  const activeSpend = effectiveCycleSpent > 0 ? effectiveCycleSpent : totalLifetime;
  const budgetRemaining = Math.max(0, monthlyBudget - activeSpend);
  const budgetBurnPercent = monthlyBudget > 0 ? (activeSpend / monthlyBudget) * 100 : 0;

  // Category Aggregates
  const catSums: Record<string, number> = {};
  expenses.forEach((e) => {
    const c = e.category || "Other";
    catSums[c] = (catSums[c] || 0) + (Number(e.amount) || 0);
  });

  let topCat = "Other";
  let topCatSum = 0;
  for (const [c, sum] of Object.entries(catSums)) {
    if (sum > topCatSum) {
      topCat = c;
      topCatSum = sum;
    }
  }

  const topCatShare = totalLifetime > 0 ? Math.round((topCatSum / totalLifetime) * 100) : 0;

  // Discretionary calculation (Food & Dining, Shopping, Entertainment, Subscriptions)
  const discretionaryCategories = ["Food & Dining", "Shopping", "Entertainment", "Subscriptions", "Travel"];
  const discretionarySum = Object.entries(catSums).reduce((acc, [c, sum]) => {
    return discretionaryCategories.includes(c) ? acc + sum : acc;
  }, 0);
  const discretionaryRatio = totalLifetime > 0 ? Math.round((discretionarySum / totalLifetime) * 100) : 0;

  // Find single largest transaction
  const sortedByAmt = [...expenses].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  const largest = sortedByAmt[0];
  const largestAmt = Number(largest?.amount) || 0;
  const largestBudgetShare = monthlyBudget > 0 ? Math.round((largestAmt / monthlyBudget) * 100) : 0;

  // Line-Item deep inspection: Beverages & Coffee, impulse add-ons
  const beverageKeywords = [
    "coffee", "latte", "tea", "cooler", "shake", "milk", "frappe",
    "beer", "wine", "juice", "drink", "soda", "cappuccino", "espresso", "water"
  ];

  let beverageCount = 0;
  let beverageTotal = 0;
  const beverageExamples: string[] = [];

  expenses.forEach((e) => {
    if (Array.isArray(e.items)) {
      e.items.forEach((item: any) => {
        const name = String(item.name || "").toLowerCase();
        const price = Number(item.price) || 0;
        if (beverageKeywords.some((kw) => name.includes(kw))) {
          beverageCount++;
          beverageTotal += price;
          if (beverageExamples.length < 3) {
            beverageExamples.push(item.name);
          }
        }
      });
    }
  });

  // Assemble dynamic insight cards
  const cards: IntelligenceCard[] = [];

  // Card 1: High-ticket transaction alert
  if (largest && largestBudgetShare >= 15) {
    cards.push({
      type: "alert",
      icon: "bi-lightning-charge",
      title: "Single High-Ticket Outing",
      detail: `${largest.merchant} (₹${largestAmt.toLocaleString("en-IN")}) consumed ${largestBudgetShare}% of your ₹${monthlyBudget.toLocaleString("en-IN")} monthly budget in one visit.`,
      badge: `${largestBudgetShare}% of Budget`,
    });
  } else if (largest) {
    cards.push({
      type: "alert",
      icon: "bi-tag",
      title: "Primary Outing",
      detail: `Largest purchase was at ${largest.merchant} (₹${largestAmt.toLocaleString("en-IN")}), accounting for ${Math.round((largestAmt / totalLifetime) * 100)}% of tracked spend.`,
    });
  }

  // Card 2: Line-Item itemized intelligence (Beverages / Extras)
  if (beverageCount > 0 && beverageTotal > 0) {
    const bevPercentOfTotal = Math.round((beverageTotal / totalLifetime) * 100);
    cards.push({
      type: "itemized",
      icon: "bi-cup-hot",
      title: "Beverage & Add-On Impact",
      detail: `${beverageCount} specialty drinks (${beverageExamples.join(", ")}) totaled ₹${beverageTotal.toLocaleString("en-IN")}, making up ${bevPercentOfTotal}% of your expenses.`,
      badge: `₹${beverageTotal.toLocaleString("en-IN")} in drinks`,
    });
  } else {
    cards.push({
      type: "itemized",
      icon: "bi-diagram-3",
      title: "Category Concentration",
      detail: `${topCat} represents ${topCatShare}% of all recorded spending (₹${topCatSum.toLocaleString("en-IN")}).`,
      badge: `${topCatShare}% Share`,
    });
  }

  // Card 3: Budget Runway & Discretionary Balance
  if (budgetRemaining > 0) {
    cards.push({
      type: "runway",
      icon: "bi-shield-check",
      title: "Runway & Pacing",
      detail: `₹${budgetRemaining.toLocaleString("en-IN")} buffer remaining. Discretionary spending currently sits at ${discretionaryRatio}% of total outflows.`,
      badge: `₹${budgetRemaining.toLocaleString("en-IN")} Left`,
    });
  } else {
    cards.push({
      type: "alert",
      icon: "bi-exclamation-triangle",
      title: "Budget Threshold Exceeded",
      detail: `Spending has surpassed your monthly target by ₹${Math.abs(budgetRemaining).toLocaleString("en-IN")}. Freeze discretionary dining.`,
      badge: "Over Budget",
    });
  }

  // Determine Health Score
  let healthScore = 92;
  let healthLabel: "Optimal" | "Healthy" | "Attention" | "Critical" = "Optimal";

  if (budgetBurnPercent > 100) {
    healthScore = 48;
    healthLabel = "Critical";
  } else if (budgetBurnPercent > 80) {
    healthScore = 71;
    healthLabel = "Attention";
  } else if (discretionaryRatio > 85 && budgetBurnPercent > 20) {
    healthScore = 84;
    healthLabel = "Healthy";
  }

  // Headline & Narrative
  let headline = "";
  if (topCatShare >= 75) {
    headline = `Heavy ${topCat} Concentration (${topCatShare}%) — ${largest?.merchant || "Dining"} Outing Drove Spend`;
  } else if (budgetBurnPercent > 75) {
    headline = `Pacing Notice: ${Math.round(budgetBurnPercent)}% of Monthly Target Burned`;
  } else {
    headline = `Spending Well-Controlled: ₹${budgetRemaining.toLocaleString("en-IN")} Safety Margin Available`;
  }

  const summary = `You have logged ₹${totalLifetime.toLocaleString("en-IN")} across ${expenses.length} receipt${expenses.length > 1 ? "s" : ""}. ${topCat} is your primary expenditure category (${topCatShare}%). Discretionary spending represents ${discretionaryRatio}% of your outflows.`;

  let actionableTip = "";
  if (beverageTotal >= 800) {
    actionableTip = `Target Add-Ons: Specialty drinks and coffees accounted for ₹${beverageTotal.toLocaleString("en-IN")}. Capping restaurant drinks to 1 per outing could unlock ~₹${Math.round(beverageTotal * 0.5).toLocaleString("en-IN")} in monthly savings.`;
  } else if (largestBudgetShare >= 20) {
    actionableTip = `Pacing Strategy: Single visits exceeding 20% of your budget accelerate monthly burn. Space large group dining sessions across multiple pay cycles.`;
  } else {
    actionableTip = `Maintain Velocity: Your current burn rate provides steady buffer. Continue logging receipts to build reliable multi-week category baselines.`;
  }

  return {
    headline,
    summary,
    healthScore,
    healthLabel,
    cards,
    actionableTip,
    dominantMerchant: largest?.merchant || "None",
    dominantCategory: topCat,
    discretionaryRatio,
  };
}

/**
 * Generate deep AI spending commentary using Google Gemini 2.5 Flash
 */
export async function generateLiveGeminiInsights(
  expenses: any[],
  monthlyBudget: number = 20000,
  effectiveCycleSpent: number = 0
): Promise<SpendingIntelligence> {
  const base = generateDeterministicIntelligence(expenses, monthlyBudget, effectiveCycleSpent);
  if (!ENV.GEMINI_API_KEY || expenses.length === 0) {
    return base;
  }

  try {
    const summaryData = expenses.slice(0, 10).map((e) => ({
      merchant: e.merchant,
      category: e.category,
      amount: e.amount,
      date: e.purchase_date,
      items: (e.items || []).slice(0, 8).map((i: any) => `${i.name} (₹${i.price})`),
    }));

    const prompt = `You are the AI Spending Intelligence Engine inside SpendSense.
Analyze these real user transactions against a monthly budget of ₹${monthlyBudget} (in Indian Rupees):
Transactions:
${JSON.stringify(summaryData, null, 2)}

Provide strict JSON conforming to this schema (do NOT include markdown fences):
{
  "headline": "Punchy, executive headline under 12 words mentioning the key driver merchant or category",
  "summary": "2 crisp sentences summarizing the expenditure, burn rate, and discretionary proportion.",
  "healthScore": 85,
  "healthLabel": "Optimal | Healthy | Attention | Critical",
  "actionableTip": "Concrete, intelligent financial advice citing specific merchants or item groups (e.g. coffee/drinks)."
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${ENV.GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(cleanJsonString(text));
        return {
          ...base,
          headline: parsed.headline || base.headline,
          summary: parsed.summary || base.summary,
          healthScore: typeof parsed.healthScore === "number" ? parsed.healthScore : base.healthScore,
          healthLabel: parsed.healthLabel || base.healthLabel,
          actionableTip: parsed.actionableTip || base.actionableTip,
        };
      }
    }
  } catch (err: any) {
    console.warn("[Gemini Insights] Live call skipped, using deterministic engine:", err.message);
  }

  return base;
}
