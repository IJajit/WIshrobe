export default async function handler(req: any, res: any) {
  const results: any = {};
  try { await import("dotenv"); results.dotenv = "ok"; } catch (e: any) { results.dotenv = e.message; }
  try { await import("@google/genai"); results.genai = "ok"; } catch (e: any) { results.genai = e.message; }
  try { await import("@supabase/supabase-js"); results.supabase = "ok"; } catch (e: any) { results.supabase = e.message; }
  try { const mod = await import("express"); const app = mod.default(); app.get("/x", (r: any, s: any) => s.json({})); results.express = "ok"; } catch (e: any) { results.express = e.message; }
  try { const mod = await import("../server"); results.server = typeof mod.default === "function" ? "ok" : "no-default"; } catch (e: any) { results.server = e.message; }
  res.status(200).json(results);
}
