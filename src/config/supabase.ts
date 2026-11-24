import { createClient } from "@supabase/supabase-js";
import { ENV } from "./env";

if (!ENV.SUPABASE_URL) {
  console.warn("[Supabase Config] Missing SUPABASE_URL in environment.");
}

// Service role client for privileged backend queries (bypasses RLS safely after authMiddleware verification)
export const supabaseAdmin = createClient(
  ENV.SUPABASE_URL,
  ENV.SUPABASE_SECRET_KEY || "placeholder-secret-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
