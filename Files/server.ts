import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { db } from "./src/db/index.ts";
import { users, profiles, items, outfits } from "./src/db/schema.ts";
import { eq, and } from "drizzle-orm";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase JSON payload limit to handle base64 image uploads
app.use(express.json({ limit: "20mb" }));

// Helper to lazily initialize Supabase client
let supabaseClient: any = null;
function getSupabaseClient() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
    if (url && key) {
      supabaseClient = createClient(url, key);
    }
  }
  return supabaseClient;
}

// Helper to extract user ID from headers to support both real Firebase users and Local Sandbox
const getUserId = (req: express.Request): string => {
  const uidHeader = req.headers["x-user-uid"];
  if (uidHeader && typeof uidHeader === "string") {
    return uidHeader;
  }
  throw new Error("Unauthorized: Missing User ID header");
};

// Helper to lazily initialize GoogleGenAI client
let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required but missing.");
    }
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

/**
 * Supabase Auth API Configurations
 */
app.get("/api/auth/config", (req, res) => {
  const hasSupabase = !!(process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY));
  res.json({
    hasSupabase,
    supabaseUrl: process.env.SUPABASE_URL || null,
  });
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      res.status(400).json({ error: "Supabase integration is not fully configured on the server. Please check your environment variables." });
      return;
    }

    const { data, error } = await client.auth.signUp({ email, password });
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (data.user) {
      const uid = data.user.id;
      // Sync to local Drizzle database
      const existing = await db.select().from(users).where(eq(users.uid, uid));
      if (existing.length === 0) {
        await db.insert(users).values({
          uid,
          email: data.user.email || email,
          createdAt: new Date().toISOString()
        });
      }
      res.json({ uid, email: data.user.email });
    } else {
      res.status(400).json({ error: "User creation was not completed. Please verify email if confirmation is enabled in your Supabase dashboard." });
    }
  } catch (error: any) {
    console.error("Supabase sign up error:", error);
    res.status(500).json({ error: error.message || "Failed to sign up via Supabase." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      res.status(400).json({ error: "Supabase integration is not fully configured on the server." });
      return;
    }

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (data.user) {
      const uid = data.user.id;
      // Sync to local Drizzle database
      const existing = await db.select().from(users).where(eq(users.uid, uid));
      if (existing.length === 0) {
        await db.insert(users).values({
          uid,
          email: data.user.email || email,
          createdAt: new Date().toISOString()
        });
      }
      res.json({ uid, email: data.user.email });
    } else {
      res.status(400).json({ error: "Sign in failed to retrieve user session." });
    }
  } catch (error: any) {
    console.error("Supabase sign in error:", error);
    res.status(500).json({ error: error.message || "Failed to sign in via Supabase." });
  }
});

/**
 * Sync logged-in user credentials
 */
app.post("/api/users/sync", async (req, res) => {
  try {
    const { uid, email } = req.body;
    if (!uid || !email) {
      res.status(400).json({ error: "uid and email are required" });
      return;
    }
    
    const existing = await db.select().from(users).where(eq(users.uid, uid));
    if (existing.length === 0) {
      await db.insert(users).values({
        uid,
        email,
        createdAt: new Date().toISOString()
      });
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("User sync error:", error);
    res.status(500).json({ error: error.message || "Failed to sync user." });
  }
});

/**
 * Profiles APIs
 */
app.get("/api/profiles", async (req, res) => {
  try {
    const userId = getUserId(req);
    
    // Auto-sync/upsert the user if they don't exist yet
    const existingUser = await db.select().from(users).where(eq(users.uid, userId));
    if (existingUser.length === 0) {
      const email = userId.includes("local-user-") 
        ? `${userId.replace("local-user-", "")}@sandbox.local` 
        : "user@applet.io";
      await db.insert(users).values({
        uid: userId,
        email,
        createdAt: new Date().toISOString()
      });
    }

    const list = await db.select().from(profiles).where(eq(profiles.userId, userId));
    res.json(list);
  } catch (error: any) {
    console.error("Get profiles error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch profiles." });
  }
});

app.post("/api/profiles", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id, name, avatarColor, createdAt } = req.body;
    
    if (!name || !avatarColor) {
      res.status(400).json({ error: "name and avatarColor are required" });
      return;
    }

    const profileId = id || `p-${Date.now()}`;
    await db.insert(profiles).values({
      id: profileId,
      userId,
      name,
      avatarColor,
      createdAt: createdAt || new Date().toISOString()
    });
    res.json({ id: profileId, name, avatarColor });
  } catch (error: any) {
    console.error("Create profile error:", error);
    res.status(500).json({ error: error.message || "Failed to create profile." });
  }
});

/**
 * Clothing Items APIs
 */
app.get("/api/items", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profileId = req.query.profileId as string;
    if (!profileId) {
      res.status(400).json({ error: "profileId parameter is required" });
      return;
    }

    const list = await db.select().from(items).where(
      and(
        eq(items.userId, userId),
        eq(items.profileId, profileId)
      )
    );
    res.json(list);
  } catch (error: any) {
    console.error("Get items error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch items." });
  }
});

app.post("/api/items", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id, profileId, imageUrl, category, subcategory, colors, season, occasion, createdAt } = req.body;
    
    if (!profileId || !imageUrl || !category || !subcategory) {
      res.status(400).json({ error: "profileId, imageUrl, category and subcategory are required" });
      return;
    }

    const itemInsert = {
      id: id || `item-${Date.now()}`,
      userId,
      profileId,
      imageUrl,
      category,
      subcategory,
      colors: Array.isArray(colors) ? colors : [],
      season: Array.isArray(season) ? season : [],
      occasion: Array.isArray(occasion) ? occasion : [],
      createdAt: createdAt || new Date().toISOString(),
      timesWorn: 0,
      lastWornAt: null
    };

    await db.insert(items).values(itemInsert);
    res.json(itemInsert);
  } catch (error: any) {
    console.error("Create item error:", error);
    res.status(500).json({ error: error.message || "Failed to create item." });
  }
});

app.put("/api/items/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const itemId = req.params.id;
    const { timesWorn, lastWornAt, category, subcategory, colors, season, occasion } = req.body;

    const updateData: any = {};
    if (timesWorn !== undefined) updateData.timesWorn = timesWorn;
    if (lastWornAt !== undefined) updateData.lastWornAt = lastWornAt;
    if (category !== undefined) updateData.category = category;
    if (subcategory !== undefined) updateData.subcategory = subcategory;
    if (colors !== undefined) updateData.colors = colors;
    if (season !== undefined) updateData.season = season;
    if (occasion !== undefined) updateData.occasion = occasion;

    await db.update(items).set(updateData).where(
      and(
        eq(items.id, itemId),
        eq(items.userId, userId)
      )
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error("Update item error:", error);
    res.status(500).json({ error: error.message || "Failed to update item." });
  }
});

app.delete("/api/items/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const itemId = req.params.id;
    await db.delete(items).where(
      and(
        eq(items.id, itemId),
        eq(items.userId, userId)
      )
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete item error:", error);
    res.status(500).json({ error: error.message || "Failed to delete item." });
  }
});

/**
 * Outfits APIs
 */
app.get("/api/outfits", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profileId = req.query.profileId as string;
    if (!profileId) {
      res.status(400).json({ error: "profileId parameter is required" });
      return;
    }

    const list = await db.select().from(outfits).where(
      and(
        eq(outfits.userId, userId),
        eq(outfits.profileId, profileId)
      )
    );
    res.json(list);
  } catch (error: any) {
    console.error("Get outfits error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch outfits." });
  }
});

app.post("/api/outfits", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id, profileId, name, itemIds, occasion, createdAt } = req.body;

    if (!profileId || !name || !itemIds) {
      res.status(400).json({ error: "profileId, name and itemIds are required" });
      return;
    }

    const outfitInsert = {
      id: id || `outfit-${Date.now()}`,
      userId,
      profileId,
      name,
      itemIds: Array.isArray(itemIds) ? itemIds : [],
      occasion,
      createdAt: createdAt || new Date().toISOString(),
      timesWorn: 0,
      lastWornAt: null
    };

    await db.insert(outfits).values(outfitInsert);
    res.json(outfitInsert);
  } catch (error: any) {
    console.error("Create outfit error:", error);
    res.status(500).json({ error: error.message || "Failed to create outfit." });
  }
});

app.post("/api/outfits/:id/wear", async (req, res) => {
  try {
    const userId = getUserId(req);
    const outfitId = req.params.id;
    const { itemIds, lastWornAt } = req.body;

    // 1. Update outfit worn count and date
    const existingOutfitList = await db.select().from(outfits).where(
      and(
        eq(outfits.id, outfitId),
        eq(outfits.userId, userId)
      )
    );
    if (existingOutfitList.length > 0) {
      const o = existingOutfitList[0];
      await db.update(outfits).set({
        timesWorn: o.timesWorn + 1,
        lastWornAt
      }).where(eq(outfits.id, outfitId));
    }

    // 2. Update each of the component items
    if (Array.isArray(itemIds)) {
      for (const itemId of itemIds) {
        const existingItemList = await db.select().from(items).where(
          and(
            eq(items.id, itemId),
            eq(items.userId, userId)
          )
        );
        if (existingItemList.length > 0) {
          const item = existingItemList[0];
          await db.update(items).set({
            timesWorn: item.timesWorn + 1,
            lastWornAt
          }).where(eq(items.id, itemId));
        }
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Wear outfit error:", error);
    res.status(500).json({ error: error.message || "Failed to register wear." });
  }
});

app.put("/api/outfits/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const outfitId = req.params.id;
    const { timesWorn, lastWornAt } = req.body;

    const updateData: any = {};
    if (timesWorn !== undefined) updateData.timesWorn = timesWorn;
    if (lastWornAt !== undefined) updateData.lastWornAt = lastWornAt;

    await db.update(outfits).set(updateData).where(
      and(
        eq(outfits.id, outfitId),
        eq(outfits.userId, userId)
      )
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error("Update outfit error:", error);
    res.status(500).json({ error: error.message || "Failed to update outfit." });
  }
});

app.delete("/api/outfits/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const outfitId = req.params.id;
    await db.delete(outfits).where(
      and(
        eq(outfits.id, outfitId),
        eq(outfits.userId, userId)
      )
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete outfit error:", error);
    res.status(500).json({ error: error.message || "Failed to delete outfit." });
  }
});

/**
 * API to auto-tag a clothing item image using Gemini
 */
app.post("/api/auto-tag", async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64 || !mimeType) {
      res.status(400).json({ error: "imageBase64 and mimeType are required." });
      return;
    }

    const ai = getAiClient();
    
    // Clean the base64 string if it contains the data URL prefix
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const prompt = `You are an expert fashion stylist. Analyze the attached clothing item image and determine the following attributes:
1. Category - Must be exactly one of: "Tops", "Bottoms", "Skirts", "Dresses", "Full body & sets", "Outerwear", "Shoes", "Accessories".
2. Subcategory - A descriptive term, e.g., "Denim Jacket", "Graphic T-Shirt", "Chino Pants", "Sneakers".
3. Colors - List of dominant colors, e.g., ["Navy Blue", "White"]. Keep them simple and accurate.
4. Season - List of suitable seasons, chosen from: "Spring", "Summer", "Autumn", "Winter".
5. Occasion - List of suitable occasions or weather tags, e.g., "Casual", "Formal", "Cold Weather", "Warm Weather", "Activewear", "Night Out".

Return ONLY a valid JSON object matching the following structure without any markdown markup:
{
  "category": "Tops",
  "subcategory": "Graphic T-Shirt",
  "colors": ["Black", "Yellow"],
  "season": ["Summer", "Spring"],
  "occasion": ["Casual", "Warm Weather"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "{}";
    const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(cleanedText);
    res.json(result);
  } catch (error: any) {
    console.error("Gemini auto-tagging error:", error);
    res.status(500).json({ error: error.message || "Failed to auto-tag clothing item." });
  }
});

/**
 * API to generate outfits from catalog using Gemini
 */
app.post("/api/suggest-outfits", async (req, res) => {
  try {
    const { items, startingItemId } = req.body;
    if (!items || !Array.isArray(items)) {
      res.status(400).json({ error: "An array of items is required." });
      return;
    }

    if (items.length < 2) {
      res.json({ outfits: [] });
      return;
    }

    const ai = getAiClient();

    // Map items to a lightweight representation to minimize token usage
    const catalogInfo = items.map(item => ({
      id: item.id,
      category: item.category,
      subcategory: item.subcategory,
      colors: item.colors,
      season: item.season,
      timesWorn: item.timesWorn || 0,
      lastWornAt: item.lastWornAt || null
    }));

    const startingItem = startingItemId ? catalogInfo.find(i => i.id === startingItemId) : null;

    const prompt = `You are a high-end fashion stylist. Below is a catalog of clothing items owned by a user:
${JSON.stringify(catalogInfo, null, 2)}

${startingItem ? `The user wants to build an outfit around this specific item: ${JSON.stringify(startingItem)}. This item MUST be included in all suggested outfits.` : ""}

Your task is to propose 2 to 3 complete, stylish outfits using ONLY the items in the catalog. DO NOT invent or add any new items.
For each outfit:
1. Select items that make a complete, coherent look (e.g. at minimum Top + Bottom, or a Dress/Full-body-set, plus appropriate Outerwear, Shoes, or Accessories if they are available in the catalog and fit the style).
2. Apply solid fashion principles for color coordination, layering, and weather/season suitability.
3. Mildly favor items with lower 'timesWorn' or older 'lastWornAt' dates to encourage wardrobe rotation, but prioritize style first.
4. Give each outfit a creative name.
5. Provide brief, friendly "stylistNotes" explaining why the outfit works and for what occasion/season it is suited.

Return ONLY a valid JSON object matching the following structure without any markdown markup:
{
  "outfits": [
    {
      "name": "Creative Outfit Name",
      "itemIds": ["item-id-1", "item-id-2"],
      "occasion": "Casual / Spring Wear",
      "stylistNotes": "Stylist notes explaining why this combination is great..."
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "{}";
    const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(cleanedText);
    res.json(result);
  } catch (error: any) {
    console.error("Gemini outfit builder error:", error);
    res.status(500).json({ error: error.message || "Failed to suggest outfits." });
  }
});

// Setup Vite Dev Server / Static Assets Serving
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupServer();
