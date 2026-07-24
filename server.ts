import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase JSON payload limit to handle base64 image uploads
app.use(express.json({ limit: "20mb" }));

// Restore original URL from Vercel rewrite header so Express routes match
app.use((req, _res, next) => {
  const source = req.headers["x-vercel-rewrite-source"];
  if (source && typeof source === "string") {
    req.url = source;
  }
  next();
});

// Helper to lazily initialize Supabase client
let supabaseClient: any = null;
function getSupabaseClient() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL || "https://eftkphzrlvbblqdqhhuv.supabase.co";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmdGtwaHpybHZiYmxxZHFoaHV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3OTY5MDAsImV4cCI6MjEwMDM3MjkwMH0.lQDuQ8GUqSovUvLMegLKHWyyLyL-7efAgqIbmtGAQiY";
    if (url && key) {
      supabaseClient = createClient(url, key);
    }
  }
  return supabaseClient;
}

// Helper to extract user ID from headers to support both Supabase Auth users and Local Sandbox
const getUserId = (req: express.Request): string => {
  const uidHeader = req.headers["x-user-uid"];
  if (uidHeader && typeof uidHeader === "string") {
    return uidHeader;
  }
  throw new Error("Unauthorized: Missing User ID header");
};

// Helper to lazily initialize GoogleGenAI client
let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return null;
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
      // Sync to Supabase public.users table via REST API client
      const { data: existing } = await client.from("users").select().eq("uid", uid);
      if (!existing || existing.length === 0) {
        await client.from("users").insert({
          uid,
          email: data.user.email || email,
          created_at: new Date().toISOString()
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
      // Sync to Supabase public.users table via REST API client
      const { data: existing } = await client.from("users").select().eq("uid", uid);
      if (!existing || existing.length === 0) {
        await client.from("users").insert({
          uid,
          email: data.user.email || email,
          created_at: new Date().toISOString()
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
    
    const client = getSupabaseClient();
    const { data: existing } = await client.from("users").select().eq("uid", uid);
    if (!existing || existing.length === 0) {
      await client.from("users").insert({
        uid,
        email,
        created_at: new Date().toISOString()
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
    const client = getSupabaseClient();
    
    // Auto-sync/upsert the user if they don't exist yet
    const { data: existingUser } = await client.from("users").select().eq("uid", userId);
    if (!existingUser || existingUser.length === 0) {
      const email = userId.includes("local-user-") 
        ? `${userId.replace("local-user-", "")}@sandbox.local` 
        : "user@applet.io";
      await client.from("users").insert({
        uid: userId,
        email,
        created_at: new Date().toISOString()
      });
    }

    const { data: list, error } = await client.from("profiles").select().eq("user_id", userId);
    if (error) throw error;
    
    // Map db snake_case columns to camelCase expected by client
    const formatted = (list || []).map((p: any) => ({
      id: p.id,
      userId: p.user_id,
      name: p.name,
      avatarColor: p.avatar_color,
      createdAt: p.created_at
    }));
    res.json(formatted);
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
    const client = getSupabaseClient();
    const { error } = await client.from("profiles").insert({
      id: profileId,
      user_id: userId,
      name,
      avatar_color: avatarColor,
      created_at: createdAt || new Date().toISOString()
    });
    if (error) throw error;

    res.json({ id: profileId, name, avatarColor });
  } catch (error: any) {
    console.error("Create profile error:", error);
    res.status(500).json({ error: error.message || "Failed to create profile." });
  }
});

app.put("/api/profiles/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profileId = req.params.id;
    const { name, avatarColor } = req.body;

    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const client = getSupabaseClient();
    const updateData: any = { name };
    if (avatarColor) updateData.avatar_color = avatarColor;

    const { error } = await client.from("profiles").update(updateData).eq("id", profileId);
    if (error) throw error;

    res.json({ id: profileId, name, avatarColor });
  } catch (error: any) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: error.message || "Failed to update profile." });
  }
});

app.delete("/api/profiles/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profileId = req.params.id;
    const client = getSupabaseClient();

    // First delete associated wardrobe items & outfits for clean cascade
    await client.from("items").delete().eq("profile_id", profileId);
    await client.from("outfits").delete().eq("profile_id", profileId);

    // Delete profile
    const { error } = await client.from("profiles").delete().eq("id", profileId);
    if (error) throw error;

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete profile error:", error);
    res.status(500).json({ error: error.message || "Failed to delete profile." });
  }
});

// Fallback in-memory state overrides cache for custom zoom & position
const localItemOverrides = new Map<string, { customZoom?: number; customOffsetY?: number }>();

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

    const client = getSupabaseClient();
    const { data: list, error } = await client.from("items").select().eq("profile_id", profileId);
    if (error) throw error;

    const formatted = (list || []).map((item: any) => {
      const override = localItemOverrides.get(item.id) || {};
      return {
        id: item.id,
        userId: item.user_id,
        profileId: item.profile_id,
        imageUrl: item.image_url,
        category: item.category,
        subcategory: item.subcategory,
        colors: item.colors,
        season: item.season,
        occasion: item.occasion,
        customZoom: override.customZoom !== undefined ? override.customZoom : (item.custom_zoom || 1.0),
        customOffsetY: override.customOffsetY !== undefined ? override.customOffsetY : (item.custom_offset_y || 0),
        createdAt: item.created_at,
        timesWorn: item.times_worn || 0,
        lastWornAt: item.last_worn_at || null
      };
    });

    res.json(formatted);
  } catch (error: any) {
    console.error("Get items error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch items." });
  }
});

app.post("/api/items", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id, profileId, imageUrl, category, subcategory, colors, season, occasion, customZoom, customOffsetY, createdAt } = req.body;
    
    if (!profileId || !imageUrl || !category || !subcategory) {
      res.status(400).json({ error: "profileId, imageUrl, category and subcategory are required" });
      return;
    }

    const itemInsert: any = {
      id: id || `item-${Date.now()}`,
      user_id: userId,
      profile_id: profileId,
      image_url: imageUrl,
      category,
      subcategory,
      colors: Array.isArray(colors) ? colors : [],
      season: Array.isArray(season) ? season : [],
      occasion: Array.isArray(occasion) ? occasion : [],
      created_at: createdAt || new Date().toISOString(),
      times_worn: 0,
      last_worn_at: null
    };

    const client = getSupabaseClient();
    const { error } = await client.from("items").insert(itemInsert);
    if (error) throw error;

    res.json({
      id: itemInsert.id,
      userId: itemInsert.user_id,
      profileId: itemInsert.profile_id,
      imageUrl: itemInsert.image_url,
      category: itemInsert.category,
      subcategory: itemInsert.subcategory,
      colors: itemInsert.colors,
      season: itemInsert.season,
      occasion: itemInsert.occasion,
      customZoom: customZoom || 1.0,
      customOffsetY: customOffsetY || 0,
      createdAt: itemInsert.created_at,
      timesWorn: itemInsert.times_worn,
      lastWornAt: itemInsert.last_worn_at
    });
  } catch (error: any) {
    console.error("Create item error:", error);
    res.status(500).json({ error: error.message || "Failed to create item." });
  }
});

app.put("/api/items/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const itemId = req.params.id;
    const { timesWorn, lastWornAt, category, subcategory, colors, season, occasion, customZoom, customOffsetY } = req.body;

    const updateData: any = {};
    if (timesWorn !== undefined) updateData.times_worn = timesWorn;
    if (lastWornAt !== undefined) updateData.last_worn_at = lastWornAt;
    if (category !== undefined) updateData.category = category;
    if (subcategory !== undefined) updateData.subcategory = subcategory;
    if (colors !== undefined) updateData.colors = colors;
    if (season !== undefined) updateData.season = season;
    if (occasion !== undefined) updateData.occasion = occasion;
    if (customZoom !== undefined || customOffsetY !== undefined) {
      const existing = localItemOverrides.get(itemId) || {};
      localItemOverrides.set(itemId, {
        customZoom: customZoom !== undefined ? customZoom : existing.customZoom,
        customOffsetY: customOffsetY !== undefined ? customOffsetY : existing.customOffsetY,
      });
    }

    const client = getSupabaseClient();
    if (client && Object.keys(updateData).length > 0) {
      const { error } = await client.from("items").update(updateData).eq("id", itemId);
      if (error) {
        console.warn("Supabase update item warning:", error.message);
      }
    }

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
    const client = getSupabaseClient();
    const { error } = await client.from("items").delete().eq("id", itemId).eq("user_id", userId);
    if (error) throw error;

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete item error:", error);
    res.status(500).json({ error: error.message || "Failed to delete item." });
  }
});

/**
 * Outfits APIs
 */
const localOutfitScales = new Map<string, Record<string, number>>();
const localOutfitsCache = new Map<string, any>();

app.get("/api/outfits", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profileId = req.query.profileId as string;
    if (!profileId) {
      res.status(400).json({ error: "profileId parameter is required" });
      return;
    }

    const client = getSupabaseClient();
    const { data: list, error } = await client.from("outfits").select().eq("profile_id", profileId);

    let rawList = list || [];
    if (error) {
      console.warn("Supabase fetch outfits warning, using local cache fallback:", error.message);
      rawList = Array.from(localOutfitsCache.values()).filter((o) => o.profile_id === profileId || o.profileId === profileId);
    }

    // Merge any locally edited outfits from cache
    const listMap = new Map<string, any>();
    for (const item of rawList) {
      listMap.set(item.id, item);
    }
    for (const [id, cached] of localOutfitsCache.entries()) {
      if (cached.profile_id === profileId || cached.profileId === profileId) {
        listMap.set(id, cached);
      }
    }

    const formatted = Array.from(listMap.values()).map((o: any) => ({
      id: o.id,
      userId: o.user_id || o.userId,
      profileId: o.profile_id || o.profileId,
      name: o.name,
      itemIds: o.item_ids || o.itemIds || [],
      itemScales: localOutfitScales.get(o.id) || o.item_scales || o.itemScales || {},
      occasion: o.occasion,
      createdAt: o.created_at || o.createdAt,
      timesWorn: o.times_worn || o.timesWorn || 0,
      lastWornAt: o.last_worn_at || o.lastWornAt || null
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error("Get outfits error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch outfits." });
  }
});

app.post("/api/outfits", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id, profileId, name, itemIds, itemScales, occasion, createdAt } = req.body;

    if (!profileId || !name || !itemIds) {
      res.status(400).json({ error: "profileId, name and itemIds are required" });
      return;
    }

    const outfitId = id || `outfit-${Date.now()}`;
    if (itemScales) {
      localOutfitScales.set(outfitId, itemScales);
    }

    const outfitInsert: any = {
      id: outfitId,
      user_id: userId,
      profile_id: profileId,
      name,
      item_ids: Array.isArray(itemIds) ? itemIds : [],
      item_scales: itemScales || {},
      occasion,
      created_at: createdAt || new Date().toISOString(),
      times_worn: 0,
      last_worn_at: null
    };

    localOutfitsCache.set(outfitId, outfitInsert);

    const client = getSupabaseClient();
    if (client) {
      const { error } = await client.from("outfits").insert(outfitInsert);
      if (error) console.warn("Supabase create outfit warning:", error.message);
    }

    res.json({
      id: outfitInsert.id,
      userId: outfitInsert.user_id,
      profileId: outfitInsert.profile_id,
      name: outfitInsert.name,
      itemIds: outfitInsert.item_ids,
      itemScales: itemScales || {},
      occasion: outfitInsert.occasion,
      createdAt: outfitInsert.created_at,
      timesWorn: outfitInsert.times_worn,
      lastWornAt: outfitInsert.last_worn_at
    });
  } catch (error: any) {
    console.error("Create outfit error:", error);
    res.status(500).json({ error: error.message || "Failed to create outfit." });
  }
});

app.put("/api/outfits/:id", async (req, res) => {
  try {
    const outfitId = req.params.id;
    const { name, itemIds, itemScales, occasion } = req.body;

    if (itemScales) {
      localOutfitScales.set(outfitId, itemScales);
    }

    const existing = localOutfitsCache.get(outfitId) || {};
    const updatedOutfit = {
      ...existing,
      id: outfitId,
      name: name !== undefined ? name : existing.name,
      item_ids: itemIds !== undefined ? itemIds : (existing.item_ids || existing.itemIds),
      item_scales: itemScales !== undefined ? itemScales : (existing.item_scales || existing.itemScales),
      occasion: occasion !== undefined ? occasion : existing.occasion,
    };
    localOutfitsCache.set(outfitId, updatedOutfit);

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (itemIds !== undefined) updateData.item_ids = itemIds;
    if (itemScales !== undefined) updateData.item_scales = itemScales;
    if (occasion !== undefined) updateData.occasion = occasion;

    const client = getSupabaseClient();
    if (client) {
      const { error } = await client.from("outfits").update(updateData).eq("id", outfitId);
      if (error) console.warn("Supabase update outfit warning:", error.message);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Update outfit error:", error);
    res.status(500).json({ error: error.message || "Failed to update outfit." });
  }
});

app.post("/api/outfits/:id/wear", async (req, res) => {
  try {
    const userId = getUserId(req);
    const outfitId = req.params.id;
    const { itemIds, lastWornAt } = req.body;

    const client = getSupabaseClient();
    
    // 1. Update outfit worn count and date
    const { data: existingOutfitList } = await client.from("outfits").select().eq("id", outfitId).eq("user_id", userId);
    if (existingOutfitList && existingOutfitList.length > 0) {
      const o = existingOutfitList[0];
      await client.from("outfits").update({
        times_worn: (o.times_worn || 0) + 1,
        last_worn_at: lastWornAt
      }).eq("id", outfitId);
    }

    // 2. Update each of the component items
    if (Array.isArray(itemIds)) {
      for (const itemId of itemIds) {
        const { data: existingItemList } = await client.from("items").select().eq("id", itemId).eq("user_id", userId);
        if (existingItemList && existingItemList.length > 0) {
          const item = existingItemList[0];
          await client.from("items").update({
            times_worn: (item.times_worn || 0) + 1,
            last_worn_at: lastWornAt
          }).eq("id", itemId);
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
    if (timesWorn !== undefined) updateData.times_worn = timesWorn;
    if (lastWornAt !== undefined) updateData.last_worn_at = lastWornAt;

    const client = getSupabaseClient();
    const { error } = await client.from("outfits").update(updateData).eq("id", outfitId).eq("user_id", userId);
    if (error) throw error;

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
    const client = getSupabaseClient();
    const { error } = await client.from("outfits").delete().eq("id", outfitId).eq("user_id", userId);
    if (error) throw error;

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete outfit error:", error);
    res.status(500).json({ error: error.message || "Failed to delete outfit." });
  }
});

/**
 * API to auto-tag & extract clothing item using Gemini AI Vision
 */
app.post("/api/auto-tag", async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64 || !mimeType) {
      res.status(400).json({ error: "imageBase64 and mimeType are required." });
      return;
    }

    const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;

    const ai = getAiClient();
    if (!ai) {
      res.status(400).json({ error: "GEMINI_API_KEY is missing on server. Fallback to image analyzer." });
      return;
    }

    const prompt = `You are an expert fashion stylist and image recognition model.
Analyze the attached photo containing a clothing item.
Be extremely careful to distinguish between tops, bottoms (pants/trousers/jeans/shorts), dresses, outerwear, and footwear based on their shape:
- If the item is pants, jeans, trousers, shorts, or leggings, Category MUST be "Bottoms".
- If the item is a shirt, t-shirt, sweater, blouse, or hoodie, Category MUST be "Tops".
- If the item is a coat, jacket, or blazer, Category MUST be "Outerwear".

Return ONLY a valid JSON object matching this structure:
{
  "category": "Bottoms",
  "subcategory": "Pants",
  "colors": ["Black"],
  "season": ["Spring", "Autumn", "Winter"],
  "occasion": ["Casual"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64Data, mimeType: mimeType } },
            { text: prompt },
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
      model: "gemini-2.0-flash",
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
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Failed to init Vite middleware:", e);
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (process.env.VERCEL !== "1") {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

const isVercel = process.env.VERCEL === "1";
if (!isVercel) {
  setupServer();
}

export default app;
