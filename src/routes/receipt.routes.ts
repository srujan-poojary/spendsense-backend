import { Router, Request, Response } from "express";
import { analyzeReceiptWithGemini } from "../services/gemini.service";

const router = Router();

/**
 * POST /api/receipts/scan
 * Multimodal Gemini receipt OCR endpoint.
 * Supports both authenticated users and demo sandbox users testing without login.
 * Accepts application/json with { "image": "base64...", "mimeType": "image/jpeg" }
 */
router.post(
  "/scan",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { image, mimeType } = req.body || {};

      if (!image) {
        res.status(400).json({
          error: "Bad Request",
          message: "No receipt image data provided. Please provide an image base64 string.",
        });
        return;
      }

      console.log(`[Receipt Scan API] Received receipt image (~${Math.round(image.length / 1024)} KB base64). Running Gemini Vision...`);
      const extracted = await analyzeReceiptWithGemini(
        image,
        mimeType || "image/jpeg"
      );

      console.log(`[Receipt Scan API] ✅ Extracted ${extracted.merchant} (₹${extracted.amount}) with ${extracted.items.length} line items.`);

      res.json({
        success: true,
        data: extracted,
      });
    } catch (err: any) {
      console.error("[Receipt Scan API] ❌ Error:", err.message);
      res.status(500).json({
        error: "Scan Failed",
        message: err.message || "An error occurred while analyzing the receipt.",
      });
    }
  }
);

export default router;
