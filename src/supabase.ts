import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://eftkphzrlvbblqdqhhuv.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmdGtwaHpybHZiYmxxZHFoaHV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3OTY5MDAsImV4cCI6MjEwMDM3MjkwMH0.lQDuQ8GUqSovUvLMegLKHWyyLyL-7efAgqIbmtGAQiY";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
