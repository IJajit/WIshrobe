export default function handler(req: any, res: any) {
  try {
    const results: any = {};
    try {
      require("dotenv");
      results.dotenv = "ok";
    } catch (e: any) {
      results.dotenv = e.message;
    }
    try {
      require("@google/genai");
      results.genai = "ok";
    } catch (e: any) {
      results.genai = e.message;
    }
    try {
      require("@supabase/supabase-js");
      results.supabase = "ok";
    } catch (e: any) {
      results.supabase = e.message;
    }
    try {
      const express = require("express");
      const app = express();
      app.get("/test", (r: any, s: any) => s.json({}));
      results.express = "ok";
    } catch (e: any) {
      results.express = e.message;
    }
    res.status(200).json(results);
  } catch (e: any) {
    res.status(500).json({ fatal: e.message });
  }
}
