import { Router, Response } from "express";
import { authMiddleware, type AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  getUserExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  getDashboardStats,
  getLiveAiInsights,
} from "../services/expense.service";

const router = Router();

// Protect all expense routes
router.use(authMiddleware);

/**
 * GET /api/expenses
 * Query params: search, category, sort
 */
router.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const search = req.query.search as string | undefined;
    const category = req.query.category as string | undefined;
    const sort = req.query.sort as "newest" | "oldest" | "highest" | "lowest" | undefined;

    const expenses = await getUserExpenses(userId, { search, category, sort });
    res.json({ success: true, data: expenses });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch expenses", message: err.message });
  }
});

/**
 * GET /api/expenses/stats
 * Dashboard aggregated calculations
 */
router.get("/stats", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const budgetParam = Number(req.query.budget);
    const budget = !isNaN(budgetParam) && budgetParam > 0 ? budgetParam : 20000;

    const stats = await getDashboardStats(userId, budget);
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch dashboard stats", message: err.message });
  }
});

/**
 * GET /api/expenses/ai-insights
 * Trigger live Gemini reasoning on user expenses
 */
router.get("/ai-insights", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const budgetParam = Number(req.query.budget);
    const budget = !isNaN(budgetParam) && budgetParam > 0 ? budgetParam : 20000;

    const insights = await getLiveAiInsights(userId, budget);
    res.json({ success: true, data: insights });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate AI insights", message: err.message });
  }
});

/**
 * GET /api/expenses/:id
 */
router.get("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const id = String(req.params.id);
    const expense = await getExpenseById(id, userId);
    res.json({ success: true, data: expense });
  } catch (err: any) {
    res.status(404).json({ error: "Expense not found", message: err.message });
  }
});

/**
 * POST /api/expenses
 */
router.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const { merchant, category, amount, items, purchase_date, receipt_url } = req.body;

    if (!merchant || amount === undefined) {
      res.status(400).json({
        error: "Validation Error",
        message: "Merchant name and amount are required.",
      });
      return;
    }

    const created = await createExpense(userId, {
      merchant,
      category,
      amount,
      items,
      purchase_date,
      receipt_url,
    });

    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create expense", message: err.message });
  }
});

/**
 * PUT /api/expenses/:id
 */
router.put("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const id = String(req.params.id);
    const updated = await updateExpense(id, userId, req.body);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update expense", message: err.message });
  }
});

/**
 * DELETE /api/expenses/:id
 */
router.delete("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const id = String(req.params.id);
    const result = await deleteExpense(id, userId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete expense", message: err.message });
  }
});

export default router;
