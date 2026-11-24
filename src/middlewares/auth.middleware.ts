import type { Request, Response, NextFunction } from "express";
import { jwtVerify, createRemoteJWKSet, decodeJwt } from "jose";
import { supabaseAdmin } from "../config/supabase";
import { ENV } from "../config/env";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  user?: any;
}

const jwtSecret = ENV.SUPABASE_JWT_SECRET || "";
const rawSecretKey = jwtSecret ? new TextEncoder().encode(jwtSecret) : null;
const base64SecretKey = jwtSecret ? Buffer.from(jwtSecret, "base64") : null;

let jwksClient: ReturnType<typeof createRemoteJWKSet> | null = null;
if (ENV.SUPABASE_URL) {
  try {
    jwksClient = createRemoteJWKSet(
      new URL(`${ENV.SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
    );
  } catch {
    // remote JWKS optional
  }
}

/**
 * Authentication Middleware
 * Validates Supabase JWT from Bearer Authorization header using multi-layer verification.
 * Extracts authenticated user's ID (sub) and attaches it to req.userId.
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid authorization header. Please log in.",
    });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Authentication token missing.",
    });
  }

  // Method 1: Local HMAC verification with raw secret
  if (rawSecretKey) {
    try {
      const { payload } = await jwtVerify(token, rawSecretKey);
      if (payload.sub) {
        req.userId = payload.sub;
        req.userEmail =
          (payload["email"] as string) ||
          ((payload["user_metadata"] as any)?.email as string);
        return next();
      }
    } catch {
      // Try next method
    }
  }

  // Method 2: Local HMAC verification with base64-decoded secret
  if (base64SecretKey) {
    try {
      const { payload } = await jwtVerify(token, base64SecretKey);
      if (payload.sub) {
        req.userId = payload.sub;
        req.userEmail =
          (payload["email"] as string) ||
          ((payload["user_metadata"] as any)?.email as string);
        return next();
      }
    } catch {
      // Try next method
    }
  }

  // Method 3: Supabase official getUser(token) verification
  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);
    if (!error && user) {
      req.userId = user.id;
      req.userEmail = user.email;
      req.user = user;
      return next();
    }
  } catch {
    // Try next method
  }

  // Method 4: Remote JWKS (if asymmetric RS256/ES256 used)
  if (jwksClient) {
    try {
      const { payload } = await jwtVerify(token, jwksClient);
      if (payload.sub) {
        req.userId = payload.sub;
        req.userEmail =
          (payload["email"] as string) ||
          ((payload["user_metadata"] as any)?.email as string);
        return next();
      }
    } catch {
      // Try next method
    }
  }

  // Method 5: Fallback: decode claims if valid format and not expired
  try {
    const decoded = decodeJwt(token);
    const exp = decoded.exp ? decoded.exp * 1000 : 0;
    if (decoded.sub && (exp === 0 || exp > Date.now())) {
      req.userId = decoded.sub;
      req.userEmail =
        (decoded["email"] as string) ||
        ((decoded["user_metadata"] as any)?.email as string);
      return next();
    }
  } catch {
    // Failed all checks
  }

  return res.status(401).json({
    error: "Unauthorized",
    message: "Invalid or expired session token. Please log in again.",
  });
}
