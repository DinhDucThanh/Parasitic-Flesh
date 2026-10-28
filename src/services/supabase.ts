import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** The row written to `player_runs` when a run ends. */
export interface RunRecord {
  sector_reached: string;
  bodies_hijacked: number;
  enemies_neutralized: number;
  survival_time_seconds: number;
  cause_of_death: string | null;
}

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Optional by design: a clone without a .env still plays normally, it just
 * never reports runs. The publishable key is safe to ship in the client.
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/**
 * Fire-and-forget telemetry. Network failures are logged and swallowed so a
 * dropped connection can never interrupt or crash the game.
 * Returns true when the row was accepted.
 */
export async function saveRunStats(stats: RunRecord): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from("player_runs").insert(stats);
    if (error) {
      console.warn("[supabase] run not saved:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[supabase] run not saved:", error instanceof Error ? error.message : error);
    return false;
  }
}
