import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { ENV, validateEnv } from "./config/env";
import receiptRoutes from "./routes/receipt.routes";
import expenseRoutes from "./routes/expense.routes";

validateEnv();

const app = express();

// Parse allowed CORS origins
const originList = ENV.FRONTEND_URL.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      // Allow localhost, vercel deployments, netlify, or configured URLs
      if (
        originList.includes(origin) ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        /\.vercel\.app$/.test(origin) ||
        /\.netlify\.app$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive for local dev/demo
    },
    credentials: true,
  })
);

// High limit for base64 receipt images
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Health Check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "SpendSense Backend",
    timestamp: new Date().toISOString(),
    geminiConfigured: Boolean(ENV.GEMINI_API_KEY),
    supabaseConfigured: Boolean(ENV.SUPABASE_URL),
  });
});

// Mount Routes
app.use("/api/receipts", receiptRoutes);
app.use("/api/expenses", expenseRoutes);

// Serve Frontend static files if present (for local monolithic dev)
const candidateFrontendPaths = [
  path.resolve(__dirname, "../../spendsense-frontend"),
  path.resolve(__dirname, "../../frontend"),
  path.resolve(__dirname, "../frontend"),
];
const frontendPath = candidateFrontendPaths.find((p) => fs.existsSync(p)) || candidateFrontendPaths[0];
app.use(express.static(frontendPath));

// API root welcome
app.get("/api", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "SpendSense API",
    health: "/api/health",
  });
});

// Favicon route
app.get(["/favicon.ico", "/favicon.svg"], (_req: Request, res: Response) => {
  res.type("image/svg+xml").sendFile(path.join(frontendPath, "favicon.svg"));
});

// Explicit multi-page routes for clean URLs
app.get("/dashboard", (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, "dashboard.html"));
});

app.get("/scan", (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, "scan.html"));
});

app.get("/transactions", (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, "transactions.html"));
});

app.get("/analytics", (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, "analytics.html"));
});

app.get("/settings", (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, "settings.html"));
});

// Catch-all route to serve index.html
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }
  res.sendFile(path.join(frontendPath, "index.html"), (err) => {
    if (err) {
      next();
    }
  });
});

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[SpendSense Global Error]", err);
  res.status(err.status || 500).json({
    error: "Internal Server Error",
    message: err.message || "An unexpected error occurred.",
  });
});

const PORT = ENV.PORT;
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 SpendSense Backend running on port ${PORT}`);
    console.log(`📍 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`🔐 Gemini Key: ${ENV.GEMINI_API_KEY ? "CONFIGURED (Hidden on server)" : "MISSING"}`);
    console.log(`⚡ Supabase: ${ENV.SUPABASE_URL ? "CONNECTED" : "MISSING"}`);
    console.log(`==================================================\n`);
  });
}

export default app;
