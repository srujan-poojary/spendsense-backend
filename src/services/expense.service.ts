import { supabaseAdmin } from "../config/supabase";
import {
  generateDeterministicIntelligence,
  generateLiveGeminiInsights,
  type SpendingIntelligence,
} from "./gemini.service";

export interface ExpenseInput {
  merchant: string;
  category: string;
  amount: number;
  items?: Array<{ name: string; price: number }>;
  purchase_date?: string;
  receipt_url?: string | null;
}

/**
 * Fetch all expenses for a user with optional search, category filter, and sorting
 * Returns empty array safely if database table is not yet initialized.
 */
export async function getUserExpenses(
  userId: string,
  options: {
    search?: string;
    category?: string;
    sort?: "newest" | "oldest" | "highest" | "lowest";
  } = {}
) {
  try {
    let query = supabaseAdmin
      .from("expenses")
      .select("*")
      .eq("user_id", userId);

    if (options.category && options.category !== "All") {
      query = query.eq("category", options.category);
    }

    if (options.search) {
      const s = `%${options.search}%`;
      query = query.or(`merchant.ilike.${s},category.ilike.${s}`);
    }

    switch (options.sort) {
      case "oldest":
        query = query.order("purchase_date", { ascending: true });
        break;
      case "highest":
        query = query.order("amount", { ascending: false });
        break;
      case "lowest":
        query = query.order("amount", { ascending: true });
        break;
      case "newest":
      default:
        query = query.order("purchase_date", { ascending: false }).order("created_at", { ascending: false });
        break;
    }

    const { data, error } = await query;
    if (error) {
      console.warn(`[Supabase Query Notice] ${error.message}`);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.warn(`[getUserExpenses Exception] ${err.message}`);
    return [];
  }
}

/**
 * Get single expense by ID belonging to user
 */
export async function getExpenseById(id: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("expenses")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error) {
    throw new Error(`Expense not found: ${error.message}`);
  }
  return data;
}

/**
 * Create new expense record
 */
export async function createExpense(userId: string, data: ExpenseInput) {
  const amount = Math.abs(Number(data.amount)) || 0;
  const purchaseDate = data.purchase_date || new Date().toISOString().split("T")[0];

  const payload = {
    user_id: userId,
    merchant: data.merchant.trim(),
    category: data.category.trim() || "Other",
    amount,
    items: data.items || [],
    purchase_date: purchaseDate,
    receipt_url: data.receipt_url || null,
  };

  const { data: inserted, error } = await supabaseAdmin
    .from("expenses")
    .insert([payload])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create expense: ${error.message}. Make sure database/schema.sql has been executed in Supabase SQL Editor.`);
  }
  return inserted;
}

/**
 * Update existing expense
 */
export async function updateExpense(
  id: string,
  userId: string,
  data: Partial<ExpenseInput>
) {
  const payload: any = {};
  if (data.merchant !== undefined) payload.merchant = data.merchant.trim();
  if (data.category !== undefined) payload.category = data.category.trim();
  if (data.amount !== undefined) payload.amount = Math.abs(Number(data.amount));
  if (data.items !== undefined) payload.items = data.items;
  if (data.purchase_date !== undefined) payload.purchase_date = data.purchase_date;
  if (data.receipt_url !== undefined) payload.receipt_url = data.receipt_url;

  const { data: updated, error } = await supabaseAdmin
    .from("expenses")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update expense: ${error.message}`);
  }
  return updated;
}

/**
 * Delete expense
 */
export async function deleteExpense(id: string, userId: string) {
  const { error } = await supabaseAdmin
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete expense: ${error.message}`);
  }
  return { success: true, id };
}

/**
 * Calculate deterministic financial statistics for dashboard & analytics
 * Guaranteed to return clean, valid metrics even if 0 expenses exist.
 */
export async function getDashboardStats(userId: string, monthlyBudget: number = 20000) {
  const expenses = await getUserExpenses(userId, { sort: "newest" });

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const dayOfMonth = Math.max(1, now.getDate());

  let totalLifetimeSpent = 0;
  let currentMonthSpent = 0;
  const categoryTotals: Record<string, number> = {};
  const monthlyTotals: Record<string, number> = {};

  for (const exp of expenses) {
    const amt = Number(exp.amount) || 0;
    totalLifetimeSpent += amt;

    const expDate = new Date(exp.purchase_date);
    const m = expDate.getMonth();
    const y = expDate.getFullYear();

    const monthKey = `${y}-${String(m + 1).padStart(2, "0")}`;
    monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + amt;

    // Accumulate category distribution across all recorded expenses
    const cat = exp.category || "Other";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;

    if (m === currentMonth && y === currentYear) {
      currentMonthSpent += amt;
    }
  }

  // Find latest active month with expenses
  const sortedMonths = Object.keys(monthlyTotals).sort();
  const latestMonthKey = sortedMonths[sortedMonths.length - 1]; // e.g. "2026-03" or "2026-02"
  const latestMonthSpent = latestMonthKey ? monthlyTotals[latestMonthKey] || 0 : 0;

  // Active cycle resolution:
  // If user has expenses in the calendar month, use it.
  // If not, use the latest active period so the dashboard metrics are active & alive!
  let effectiveMonthlySpent = currentMonthSpent;
  let billingPeriodLabel = "Current billing period";

  if (currentMonthSpent === 0 && totalLifetimeSpent > 0 && latestMonthKey) {
    effectiveMonthlySpent = latestMonthSpent;
    const [y, mStr] = latestMonthKey.split("-");
    const dateObj = new Date(Number(y), Number(mStr) - 1, 1);
    const monthName = dateObj.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    billingPeriodLabel = `${monthName} (Active cycle)`;
  }

  const budgetRemaining = monthlyBudget - effectiveMonthlySpent;
  const budgetUsagePercent = monthlyBudget > 0 ? (effectiveMonthlySpent / monthlyBudget) * 100 : 0;
  const dailyAverage = effectiveMonthlySpent / dayOfMonth;

  // Top category
  let topCategory = "None";
  let topCategoryAmount = 0;
  for (const [cat, sum] of Object.entries(categoryTotals)) {
    if (sum > topCategoryAmount) {
      topCategory = cat;
      topCategoryAmount = sum;
    }
  }

  // Generate multi-dimensional spending intelligence
  const aiIntelligence = generateDeterministicIntelligence(
    expenses,
    monthlyBudget,
    effectiveMonthlySpent
  );

  return {
    metrics: {
      monthlyBudget,
      currentMonthSpent: Number(effectiveMonthlySpent.toFixed(2)),
      rawCurrentMonthSpent: Number(currentMonthSpent.toFixed(2)),
      billingPeriodLabel,
      budgetRemaining: Number(budgetRemaining.toFixed(2)),
      budgetUsagePercent: Number(budgetUsagePercent.toFixed(1)),
      dailyAverage: Number(dailyAverage.toFixed(2)),
      totalLifetimeSpent: Number(totalLifetimeSpent.toFixed(2)),
      transactionCount: expenses.length,
      topCategory,
      topCategoryAmount,
      insight: aiIntelligence.summary,
      healthScore: aiIntelligence.healthScore,
      healthLabel: aiIntelligence.healthLabel,
    },
    aiIntelligence,
    categoryDistribution: categoryTotals,
    monthlyTrend: monthlyTotals,
    recentExpenses: expenses.slice(0, 5),
  };
}

/**
 * On-demand Live Gemini AI Spending Insights
 */
export async function getLiveAiInsights(userId: string, monthlyBudget: number = 20000) {
  const expenses = await getUserExpenses(userId, { sort: "newest" });
  const stats = await getDashboardStats(userId, monthlyBudget);
  return generateLiveGeminiInsights(
    expenses,
    monthlyBudget,
    stats.metrics.currentMonthSpent
  );
}
