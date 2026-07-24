import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { Profile, ClothingItem, Outfit } from "./types";
import AuthScreen from "./components/AuthScreen";
import ProfileSwitcher from "./components/ProfileSwitcher";
import AddItemFlow from "./components/AddItemFlow";
import OutfitBuilder from "./components/OutfitBuilder";
import { 
  Shirt, 
  Layers, 
  Plus, 
  RefreshCw, 
  Sparkles, 
  Calendar, 
  Check, 
  Filter, 
  Grid, 
  List, 
  ArrowUpDown, 
  ChevronRight, 
  Clock, 
  CheckCircle, 
  LogOut, 
  User, 
  Tag, 
  X,
  Sparkle,
  Trash2,
  Edit
} from "lucide-react";

const CATEGORIES = [
  "Tops",
  "Bottoms",
  "Skirts",
  "Dresses",
  "Full body & sets",
  "Outerwear",
  "Shoes",
  "Accessories",
];

export default function App() {
  const [user, setUser] = useState<any>(() => {
    const stored = localStorage.getItem("supabase_user");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<"items" | "outfits">("items");

  // Filters & layout state
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"recent" | "worn" | "alpha">("recent");
  const [isGridView, setIsGridView] = useState<boolean>(true);

  // Data states
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // UI state
  const [showCreateActionSheet, setShowCreateActionSheet] = useState<boolean>(false);
  const [showAddItem, setShowAddItem] = useState<boolean>(false);
  const [showOutfitBuilder, setShowOutfitBuilder] = useState<boolean>(false);
  
  // Selected detail cards
  const [selectedItemDetail, setSelectedItemDetail] = useState<ClothingItem | null>(null);
  const [isEditingTags, setIsEditingTags] = useState<boolean>(false);
  const [newTagInput, setNewTagInput] = useState<string>("");
  const [selectedOutfitDetail, setSelectedOutfitDetail] = useState<Outfit | null>(null);
  const [builderWithItem, setBuilderWithItem] = useState<ClothingItem | null>(null);

  const [editingOutfit, setEditingOutfit] = useState<Outfit | null>(null);

  // User session sync helper
  useEffect(() => {
    if (user?.uid && user?.email) {
      fetch("/api/users/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
        }),
      }).catch(() => {});
    }
  }, [user]);

  // Fetch PostgreSQL records whenever profile or tab swaps
  useEffect(() => {
    if (!user || !activeProfile) return;
    loadData();
  }, [user, activeProfile, activeTab]);

  const loadData = async () => {
    if (!user || !activeProfile) return;
    setIsLoading(true);

    try {
      if (activeTab === "items") {
        const storageKey = `wishrobe_items_${activeProfile.id}`;

        // Load localStorage cache first (has image data)
        const latestLocalRaw = localStorage.getItem(storageKey);
        const latestLocal: ClothingItem[] = latestLocalRaw ? JSON.parse(latestLocalRaw) : [];
        const localById = new Map(latestLocal.map((i) => [i.id, i]));

        // 1. Query Supabase for metadata only (skip image_url — it's huge base64)
        try {
          const { data: dbItems, error } = await supabase
            .from("items")
            .select("id, user_id, profile_id, category, subcategory, colors, season, occasion, created_at, custom_zoom, custom_offset_y")
            .eq("profile_id", activeProfile.id)
            .order("created_at", { ascending: false });

          if (!error && dbItems) {
            // Map DB rows, using localStorage for image_url (avoids re-fetching huge images)
            const dbMapped: ClothingItem[] = dbItems.map((item: any) => {
              const cached = localById.get(item.id);
              return {
                id: item.id,
                userId: item.user_id,
                profileId: item.profile_id,
                imageUrl: cached?.imageUrl || "",   // from localStorage or empty
                category: item.category,
                subcategory: item.subcategory,
                colors: item.colors || [],
                season: item.season || [],
                occasion: item.occasion || [],
                createdAt: item.created_at,
                customZoom: item.custom_zoom ?? 1.0,
                customOffsetY: item.custom_offset_y ?? 0,
              };
            });

            // Add any local-only items not yet in Supabase
            const serverIds = new Set(dbMapped.map((i) => i.id));
            const localOnly = latestLocal.filter((i) => !serverIds.has(i.id));
            const finalItems = [...dbMapped, ...localOnly];

            localStorage.setItem(storageKey, JSON.stringify(finalItems));
            const mergedRestored = finalItems.map((item) => {
              const savedZoom = localStorage.getItem(`item_zoom_${item.id}`);
              const savedOffsetY = localStorage.getItem(`item_offset_y_${item.id}`);
              return {
                ...item,
                customZoom: savedZoom !== null ? parseFloat(savedZoom) : (item.customZoom || 1.0),
                customOffsetY: savedOffsetY !== null ? parseInt(savedOffsetY) : (item.customOffsetY || 0),
              };
            });
            setItems(mergedRestored);
            setIsLoading(false);

            // Sequentially fetch + compress images for items added from other devices
            const missingImages = dbMapped.filter((i) => !i.imageUrl);
            if (missingImages.length > 0) {
              // Helper: compress a dataUrl to WebP <300KB
              const recompress = (dataUrl: string): Promise<string> =>
                new Promise((resolve) => {
                  const img = new window.Image();
                  img.onload = () => {
                    const MAX = 350;
                    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                    const w = Math.round(img.width * scale);
                    const h = Math.round(img.height * scale);
                    const c = document.createElement("canvas");
                    c.width = w; c.height = h;
                    const ctx = c.getContext("2d")!;
                    ctx.drawImage(img, 0, 0, w, h);
                    const webp = c.toDataURL("image/webp", 0.75);
                    if (webp.startsWith("data:image/webp")) { resolve(webp); return; }
                    // Fallback: JPEG on white bg
                    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
                    resolve(c.toDataURL("image/jpeg", 0.8));
                  };
                  img.onerror = () => resolve(dataUrl);
                  img.src = dataUrl;
                });

              // Sequential fetch to respect Supabase 6MB row limit
              (async () => {
                for (const item of missingImages) {
                  try {
                    const { data } = await supabase
                      .from("items")
                      .select("id, image_url")
                      .eq("id", item.id)
                      .single();
                    if (!data?.image_url) continue;

                    // Compress to small size
                    const compressed = await recompress(data.image_url);

                    // Re-save compressed version to Supabase so future cross-device loads are fast
                    if (compressed !== data.image_url) {
                      supabase.from("items").update({ image_url: compressed }).eq("id", item.id).then(() => {});
                    }

                    // Update state and localStorage immediately as each image loads
                    setItems((prev) => {
                      const updated = prev.map((p) =>
                        p.id === item.id ? { ...p, imageUrl: compressed } : p
                      );
                      localStorage.setItem(storageKey, JSON.stringify(updated));
                      return updated;
                    });
                  } catch {
                    // Skip this item if fetch fails
                  }
                }
              })();
            }

            return;
          }
        } catch (e) {
          console.warn("Supabase items fetch failed, falling back to local:", e);
        }

        const localRaw = localStorage.getItem(storageKey);
        const localList: ClothingItem[] = localRaw ? JSON.parse(localRaw) : [];
        const restored = localList.map((item) => {
          const savedZoom = localStorage.getItem(`item_zoom_${item.id}`);
          const savedOffsetY = localStorage.getItem(`item_offset_y_${item.id}`);
          return {
            ...item,
            customZoom: savedZoom !== null ? parseFloat(savedZoom) : (item.customZoom || 1.0),
            customOffsetY: savedOffsetY !== null ? parseInt(savedOffsetY) : (item.customOffsetY || 0),
          };
        });
        setItems(restored);
        setIsLoading(false);
      } else {
        // Outfits — try server first to sync cross-device, or fall back to local
        try {
          const res = await fetch(`/api/outfits?profileId=${activeProfile.id}`, {
            headers: { "X-User-Uid": user.uid },
          });
          if (res.ok) {
            const list: Outfit[] = await res.json();
            const storedOutfitsRaw = localStorage.getItem(`local_outfits_${activeProfile.id}`);
            const localOutfits: Outfit[] = storedOutfitsRaw ? JSON.parse(storedOutfitsRaw) : [];
            const localOutfitIds = new Set(localOutfits.map((o) => o.id));
            const serverOnly = list.filter((o) => !localOutfitIds.has(o.id));
            const mergedOutfits = [...localOutfits, ...serverOnly];

            setOutfits(mergedOutfits);
            localStorage.setItem(`local_outfits_${activeProfile.id}`, JSON.stringify(mergedOutfits));
            setIsLoading(false);
            return;
          }
        } catch {
          // Server offline fallback
        }

        const storedOutfits = localStorage.getItem(`local_outfits_${activeProfile.id}`);
        if (storedOutfits) setOutfits(JSON.parse(storedOutfits));
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Error loading wardrobe data:", err);
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setActiveProfile(null);
    setItems([]);
    setOutfits([]);
  };

  // Update item details (name/subcategory, category, tags, zoom, offset)
  const handleUpdateItem = async (item: ClothingItem, updates: Partial<ClothingItem>) => {
    try {
      const updatedItem = { ...item, ...updates };

      // Save zoom & offset to persistent localStorage
      if (updates.customZoom !== undefined) {
        localStorage.setItem(`item_zoom_${item.id}`, updates.customZoom.toString());
      }
      if (updates.customOffsetY !== undefined) {
        localStorage.setItem(`item_offset_y_${item.id}`, updates.customOffsetY.toString());
      }

      setItems((prev) => prev.map((i) => (i.id === item.id ? updatedItem : i)));
      setSelectedItemDetail(updatedItem);

      // Persist update to localStorage
      try {
        const storageKey = `wishrobe_items_${item.profileId}`;
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const list: ClothingItem[] = JSON.parse(raw);
          const updated = list.map((i) => (i.id === item.id ? updatedItem : i));
          localStorage.setItem(storageKey, JSON.stringify(updated));
        }
      } catch {}

      // Sync to server in background
      try {
        await fetch(`/api/items/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-User-Uid": user.uid },
          body: JSON.stringify(updates),
        });
      } catch {
        // Server unavailable — localStorage update is sufficient
      }
    } catch (err) {
      console.error("Error updating item:", err);
    }
  };

  // Add custom tag to item
  const handleAddCustomTag = async (item: ClothingItem, newTag: string) => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    const currentOccasions = item.occasion || [];
    if (currentOccasions.includes(trimmed)) return;
    
    const updatedOccasions = [...currentOccasions, trimmed];
    await handleUpdateItem(item, { occasion: updatedOccasions });
    setNewTagInput("");
  };

  // Remove tag from clothing item
  const handleRemoveItemTag = async (item: ClothingItem, tagType: "color" | "season" | "occasion", tagValue: string) => {
    const updatedColors = tagType === "color" ? item.colors.filter((c) => c !== tagValue) : item.colors;
    const updatedSeason = tagType === "season" ? item.season.filter((s) => s !== tagValue) : item.season;
    const updatedOccasion = tagType === "occasion" ? item.occasion.filter((o) => o !== tagValue) : item.occasion;

    await handleUpdateItem(item, {
      colors: updatedColors,
      season: updatedSeason,
      occasion: updatedOccasion,
    });
  };

  // Delete item from closet
  const handleDeleteItem = async (itemId: string) => {
    try {
      const itemToDelete = items.find((i) => i.id === itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      setSelectedItemDetail(null);

      // Persist delete to localStorage
      if (itemToDelete) {
        try {
          const storageKey = `wishrobe_items_${itemToDelete.profileId}`;
          const raw = localStorage.getItem(storageKey);
          if (raw) {
            const list: ClothingItem[] = JSON.parse(raw);
            localStorage.setItem(storageKey, JSON.stringify(list.filter((i) => i.id !== itemId)));
          }
        } catch {}
      }

      // Sync to server in background
      try {
        await fetch(`/api/items/${itemId}`, {
          method: "DELETE",
          headers: { "X-User-Uid": user.uid },
        });
      } catch {
        // Server unavailable — localStorage delete is sufficient
      }
    } catch (err) {
      console.error("Error deleting item:", err);
    }
  };

  // Synchronized logging wear for single item
  const handleLogItemWorn = async (item: ClothingItem) => {
    try {
      const updatedTimes = (item.timesWorn || 0) + 1;
      const updatedDate = new Date().toISOString();

      const res = await fetch(`/api/items/${item.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-User-Uid": user.uid,
        },
        body: JSON.stringify({
          timesWorn: updatedTimes,
          lastWornAt: updatedDate,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      // Update state locally
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, timesWorn: updatedTimes, lastWornAt: updatedDate } : i))
      );
      setSelectedItemDetail((prev) =>
        prev && prev.id === item.id ? { ...prev, timesWorn: updatedTimes, lastWornAt: updatedDate } : prev
      );
    } catch (err) {
      console.error("Error logging item wear:", err);
    }
  };

  // Synchronized logging wear for outfits & nested pieces
  const handleLogOutfitWorn = async (outfit: Outfit) => {
    try {
      const updatedDate = new Date().toISOString();
      const updatedOutfitTimes = (outfit.timesWorn || 0) + 1;

      const res = await fetch(`/api/outfits/${outfit.id}/wear`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Uid": user.uid,
        },
        body: JSON.stringify({
          itemIds: outfit.itemIds,
          lastWornAt: updatedDate,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      // Update state local variables for outfit
      setOutfits((prev) =>
        prev.map((o) =>
          o.id === outfit.id ? { ...o, timesWorn: updatedOutfitTimes, lastWornAt: updatedDate } : o
        )
      );
      setSelectedOutfitDetail((prev) =>
        prev && prev.id === outfit.id ? { ...prev, timesWorn: updatedOutfitTimes, lastWornAt: updatedDate } : prev
      );

      // Update local items state for the component items
      setItems((prev) =>
        prev.map((i) => {
          if (outfit.itemIds.includes(i.id)) {
            return { ...i, timesWorn: (i.timesWorn || 0) + 1, lastWornAt: updatedDate };
          }
          return i;
        })
      );
    } catch (err) {
      console.error("Error logging outfit wear:", err);
    }
  };

  // Delete outfit from wardrobe
  const handleDeleteOutfit = async (outfitId: string) => {
    try {
      setOutfits((prev) => prev.filter((o) => o.id !== outfitId));
      setSelectedOutfitDetail(null);

      await fetch(`/api/outfits/${outfitId}`, {
        method: "DELETE",
        headers: {
          "X-User-Uid": user.uid,
        },
      });
    } catch (err) {
      console.error("Error deleting outfit:", err);
    }
  };

  // Extract all unique custom tags, occasions AND seasons for filter dropdown
  const allAvailableTags = Array.from(
    new Set([
      ...items.flatMap((item) => item.occasion || []),
      ...items.flatMap((item) => item.season || []),
    ])
  ).filter(Boolean);

  // Item sorting / filtering logic
  const getProcessedItems = () => {
    let list = [...items];

    // 1. Filter by category
    if (selectedCategory) {
      list = list.filter((i) => i.category === selectedCategory);
    }

    // 2. Filter by tag/occasion/season
    if (selectedTagFilter) {
      list = list.filter(
        (i) =>
          (i.occasion || []).includes(selectedTagFilter) ||
          (i.season || []).includes(selectedTagFilter)
      );
    }

    // 3. Sort
    if (sortBy === "recent") {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === "worn") {
      list.sort((a, b) => (b.timesWorn || 0) - (a.timesWorn || 0));
    } else if (sortBy === "alpha") {
      list.sort((a, b) => (b.subcategory || "").localeCompare(a.subcategory || ""));
    }

    return list;
  };

  // Format date helper
  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return "Never";
    const date = new Date(isoStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  };

  if (!user) {
    return (
      <AuthScreen
        onSuccess={(userObj) => {
          // If switching to a new user, reset local cached profile ID so the app loads the new account's profiles from server
          const prevUser = localStorage.getItem("supabase_user");
          if (prevUser) {
            try {
              const parsed = JSON.parse(prevUser);
              if (parsed.uid !== userObj.uid) {
                // Clear active profile reference for previous user
                Object.keys(localStorage).forEach((key) => {
                  if (key.startsWith("wishrobe_active_profile_")) {
                    localStorage.removeItem(key);
                  }
                });
              }
            } catch {}
          }
          localStorage.setItem("supabase_user", JSON.stringify(userObj));
          setUser(userObj);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F1F5] py-0 md:py-8 flex flex-col justify-center items-center select-none">
      <div className="w-full max-w-md bg-white text-[#1A1A1A] font-sans flex flex-col min-h-screen md:min-h-[820px] md:h-[820px] md:rounded-[48px] md:shadow-2xl md:border-[8px] md:border-[#1A1A1A] relative overflow-hidden pb-24">
        
        {/* Device Top Bar notch effect for desktop frame */}
        <div className="hidden md:flex h-6 w-full justify-between items-center px-8 mt-2 select-none pointer-events-none">
          <span className="text-[11px] font-bold text-gray-400">9:41</span>
          <div className="w-16 h-4 bg-[#1A1A1A] rounded-b-xl absolute left-1/2 -translate-x-1/2 top-0"></div>
          <div className="flex gap-1 items-center">
            <span className="text-[10px] text-gray-400 font-bold">5G</span>
            <div className="w-4 h-2.5 border border-gray-300 rounded-sm p-[1px] flex items-center">
              <div className="w-full h-full bg-gray-400 rounded-2xs"></div>
            </div>
          </div>
        </div>

        {/* Top Header sticky */}
        <header className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-[#F3F2F7] px-6 py-4 flex items-center justify-between z-40 select-none">
          <div className="flex items-center gap-1.5">
            <h1 className="text-sm font-black tracking-widest uppercase flex items-center gap-1 text-[#1A1A1A]">
              Wishrobe
              <Sparkle className="w-3.5 h-3.5 text-[#1A1A1A] fill-[#1A1A1A]" />
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <ProfileSwitcher
              userId={user.uid}
              activeProfile={activeProfile}
              onProfileChange={(p) => {
                setActiveProfile(p);
                if (user?.uid && p?.id) {
                  localStorage.setItem(`wishrobe_active_profile_${user.uid}`, p.id);
                }
              }}
            />

            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-[#F3F2F7] transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Container inside the fixed Frame */}
        <div className="flex-1 overflow-y-auto no-scrollbar">

          {/* Segmented active Tab controller ("Items | Outfits") */}
          <div className="px-6 pt-5 pb-3">
            <div className="bg-[#F3F2F7] p-1 rounded-full flex relative">
              <button
                onClick={() => setActiveTab("items")}
                className={`flex-1 py-2 text-xs font-bold rounded-full transition flex items-center justify-center gap-1.5 ${
                  activeTab === "items" ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#7F7F8E] hover:text-[#1A1A1A]"
                }`}
              >
                <Shirt className="w-3.5 h-3.5" />
                Items
              </button>
              <button
                onClick={() => setActiveTab("outfits")}
                className={`flex-1 py-2 text-xs font-bold rounded-full transition flex items-center justify-center gap-1.5 ${
                  activeTab === "outfits" ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#7F7F8E] hover:text-[#1A1A1A]"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Outfits
              </button>
            </div>
          </div>

          {activeTab === "items" ? (
            /* Items Tab View */
            <div className="flex-1 flex flex-col">
              {/* Horizontal scroll category chips */}
              <div className="px-6 py-2 flex gap-1.5 overflow-x-auto scrollbar-none select-none">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`px-4 py-1.5 text-xs font-medium rounded-full border shrink-0 transition ${
                    selectedCategory === null
                      ? "bg-[#1A1A1A] text-white border-[#1A1A1A] font-bold"
                      : "bg-transparent text-[#7F7F8E] border-[#E5E5E5] hover:bg-[#F3F2F7] hover:text-[#1A1A1A]"
                  }`}
                >
                  All ({items.length})
                </button>
                {CATEGORIES.map((cat) => {
                  const count = items.filter((i) => i.category === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-4 py-1.5 text-xs font-medium rounded-full border shrink-0 transition ${
                        selectedCategory === cat
                          ? "bg-[#1A1A1A] text-white border-[#1A1A1A] font-bold"
                          : "bg-transparent text-[#7F7F8E] border-[#E5E5E5] hover:bg-[#F3F2F7] hover:text-[#1A1A1A]"
                      }`}
                    >
                      {cat} ({count})
                    </button>
                  );
                })}
              </div>

              {/* List layout control, tag filter, and sorting selection bar */}
              <div className="px-6 py-3 flex items-center justify-between border-b border-[#F3F2F7] gap-2">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {/* Sorting dropdown */}
                  <div className="flex items-center gap-1 bg-[#F3F2F7] border border-[#E5E5E5]/30 px-3 py-1.5 rounded-full shrink-0">
                    <ArrowUpDown className="w-3 h-3 text-gray-500" />
                    <select
                      value={sortBy}
                      onChange={(e: any) => setSortBy(e.target.value)}
                      className="bg-transparent text-[11px] font-medium text-gray-700 outline-none cursor-pointer"
                    >
                      <option value="recent">Most recent</option>
                      <option value="alpha">Z to A</option>
                      <option value="worn">Most worn</option>
                    </select>
                  </div>

                  {/* Tag filter dropdown */}
                  <div className="flex items-center gap-1 bg-[#F3F2F7] border border-[#E5E5E5]/30 px-3 py-1.5 rounded-full shrink-0">
                    <Filter className="w-3 h-3 text-gray-500" />
                    <select
                      value={selectedTagFilter || ""}
                      onChange={(e: any) => setSelectedTagFilter(e.target.value || null)}
                      className="bg-transparent text-[11px] font-medium text-gray-700 outline-none cursor-pointer max-w-[100px] truncate"
                    >
                      <option value="">All Tags</option>
                      {allAvailableTags.map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  onClick={() => setIsGridView(!isGridView)}
                  className="p-2 bg-[#F3F2F7] border border-[#E5E5E5]/30 text-[#1A1A1A] rounded-full hover:bg-[#EAEAEA] transition shrink-0"
                  title={isGridView ? "List View" : "Grid View"}
                >
                  {isGridView ? <List className="w-3.5 h-3.5" /> : <Grid className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Main items panel */}
              {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center py-24 gap-3">
                  <RefreshCw className="w-6 h-6 text-gray-300 animate-spin" />
                  <span className="text-xs text-gray-400 font-medium tracking-wide">Fetching closet items...</span>
                </div>
              ) : getProcessedItems().length === 0 ? (
                /* Elegant empty state */
                <div className="flex-1 flex flex-col items-center justify-center text-center px-10 py-24 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-[#F3F2F7] text-[#7F7F8E] flex items-center justify-center">
                    <Shirt className="w-6 h-6 stroke-[1.5]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#1A1A1A] uppercase tracking-wider">No items found</h3>
                    <p className="text-xs text-[#7F7F8E] max-w-xs mt-2.5 leading-relaxed">
                      No clothing items match your filter criteria.
                    </p>
                  </div>
                </div>
              ) : isGridView ? (
                /* 2-Column Large Image Grid for maximum item visibility */
                <div className="p-6 grid grid-cols-2 gap-4">
                {getProcessedItems().map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItemDetail(item)}
                    className="group flex flex-col text-left space-y-2 focus:outline-none"
                  >
                    {/* Photo container with large perfectly-centered clothing graphic */}
                    <div className="relative aspect-square w-full rounded-3xl bg-[#F3F2F7] hover:bg-[#EAECE4] transition overflow-hidden flex items-center justify-center p-1 border border-transparent hover:border-[#E5E5E5] shadow-xs">
                      <img
                        src={item.imageUrl}
                        alt={item.subcategory}
                        referrerPolicy="no-referrer"
                        style={{
                          transform: `scale(${item.customZoom || 1.0}) translateY(${item.customOffsetY || 0}px)`,
                        }}
                        className="w-full h-full object-contain object-center filter drop-shadow-md group-hover:scale-115 transition duration-300 origin-center"
                      />
                    </div>
                    <div className="px-1">
                      <h4 className="text-xs font-semibold text-[#1A1A1A] truncate leading-snug">
                        {item.subcategory}
                      </h4>
                      <span className="text-[10px] text-[#7F7F8E] capitalize font-normal block leading-none mt-0.5">
                        {item.category}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              ) : (
                /* List Row View */
                <div className="p-6 space-y-2">
                  {getProcessedItems().map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItemDetail(item)}
                      className="w-full flex items-center justify-between p-3 bg-[#F3F2F7]/55 hover:bg-[#F3F2F7] border border-[#F0F0F0] rounded-2xl transition text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-14 h-14 rounded-xl bg-[#F3F2F7] border border-[#E5E5E5]/40 flex items-center justify-center p-1 overflow-hidden">
                          <img
                            src={item.imageUrl}
                            alt={item.subcategory}
                            referrerPolicy="no-referrer"
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-[#1A1A1A] leading-snug">{item.subcategory}</h4>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#7F7F8E] font-normal capitalize tracking-wide">
                            <span>{item.category}</span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#7F7F8E]" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Outfits Tab View */
            <div className="flex-1 flex flex-col">
              {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center py-24 gap-3">
                  <RefreshCw className="w-6 h-6 text-gray-300 animate-spin" />
                  <span className="text-xs text-gray-400 font-medium tracking-wide">Fetching outfits...</span>
                </div>
              ) : outfits.length === 0 ? (
                /* Empty State */
                <div className="flex-1 flex flex-col items-center justify-center text-center px-10 py-24 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-[#F3F2F7] text-[#7F7F8E] flex items-center justify-center">
                    <Layers className="w-6 h-6 stroke-[1.5]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-[#1A1A1A] uppercase tracking-wider">No outfits saved</h3>
                  </div>
                </div>
              ) : (
                /* Saved Outfits Grid */
                <div className="p-6 grid grid-cols-2 gap-4">
                  {outfits.map((outfit) => {
                    // Gather matching component images
                    const matchingImages = outfit.itemIds
                      .map((id) => items.find((i) => i.id === id)?.imageUrl)
                      .filter((url): url is string => !!url)
                      .slice(0, 3); // take up to 3 for a small clean overlay look

                    return (
                      <button
                        key={outfit.id}
                        onClick={() => setSelectedOutfitDetail(outfit)}
                        className="flex flex-col text-left space-y-2 group"
                      >
                        {/* Compact overlapping collage preview representation */}
                        <div className="relative aspect-square w-full rounded-3xl bg-[#F3F2F7] border border-[#E5E5E5]/50 overflow-hidden flex items-center justify-center shadow-sm hover:shadow-md transition duration-200">
                          
                          {matchingImages.length === 0 ? (
                            <div className="text-gray-400 text-xs font-bold uppercase tracking-wider">Empty</div>
                          ) : matchingImages.length === 1 ? (
                            <img
                              src={matchingImages[0]}
                              alt="Outfit piece"
                              referrerPolicy="no-referrer"
                              className="w-[75%] h-[75%] object-contain filter drop-shadow-md"
                            />
                          ) : (
                            /* Balanced flat collage placement overlay */
                            <div className="absolute inset-0 p-3 flex flex-wrap gap-1.5 items-center justify-center bg-[#F3F2F7]">
                              {matchingImages.map((imgUrl, i) => (
                                <div
                                  key={i}
                                  className={`rounded-xl overflow-hidden bg-white/70 border border-[#E5E5E5]/40 flex items-center justify-center p-1 shadow-2xs ${
                                    matchingImages.length === 2 ? "w-[45%] h-[75%]" : "w-[44%] h-[44%]"
                                  }`}
                                >
                                  <img
                                    src={imgUrl}
                                    alt="piece"
                                    referrerPolicy="no-referrer"
                                    className="max-w-full max-h-full object-contain filter drop-shadow"
                                  />
                                </div>
                              ))}
                              {outfit.itemIds.length > 3 && (
                                <div className="w-[44%] h-[44%] rounded-xl bg-white/40 border border-dashed border-[#E5E5E5] flex items-center justify-center text-[10px] font-bold text-[#7F7F8E]">
                                  +{outfit.itemIds.length - 3}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="px-1">
                          <h4 className="text-xs font-semibold text-[#1A1A1A] leading-snug truncate">
                            {outfit.name}
                          </h4>
                          <span className="text-[10px] text-[#7F7F8E] font-normal capitalize block leading-none mt-0.5">
                            {outfit.occasion}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Floating Pill Create Button (bottom right, mint/green fill) */}
        {/* Changed to absolute so it remains pinned gracefully inside the device mock screen layout */}
        <div className="absolute bottom-6 right-6 z-40">
          <button
            onClick={() => setShowCreateActionSheet(true)}
            className="bg-[#D1FAE5] hover:bg-[#A7F3D0] text-[#065F46] border border-[#A7F3D0]/30 px-5 py-3 rounded-full flex items-center gap-1.5 shadow-lg active:scale-95 transition tracking-wide text-xs uppercase font-bold"
          >
            <span className="text-lg font-light leading-none">+</span>
            <span>Add</span>
          </button>
        </div>
      </div>


      {/* --------------------- MODALS & VIEWS --------------------- */}

      {/* Create Action Sheet Bottom-Drawer Overlay */}
      {showCreateActionSheet && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end justify-center">
          <div
            className="fixed inset-0"
            onClick={() => setShowCreateActionSheet(false)}
          />
          <div className="relative bg-white w-full max-w-md rounded-t-3xl p-6 space-y-4 shadow-2xl animate-in slide-in-from-bottom duration-200">
            {/* Top drawer line */}
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto" />
            
            <div className="space-y-1">
              <h3 className="text-base font-black text-gray-900">Add to Closet</h3>
              <p className="text-xs text-gray-400">Choose which action you'd like to perform today.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => {
                  setShowAddItem(true);
                  setShowCreateActionSheet(false);
                }}
                className="flex flex-col items-center justify-center gap-2 p-5 bg-slate-50 border border-slate-100 rounded-2xl hover:bg-slate-100 transition"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                </div>
                <span className="text-xs font-bold text-gray-800">Add Item</span>
              </button>

              <button
                onClick={() => {
                  setBuilderWithItem(null);
                  setShowOutfitBuilder(true);
                  setShowCreateActionSheet(false);
                }}
                className="flex flex-col items-center justify-center gap-2 p-5 bg-slate-50 border border-slate-100 rounded-2xl hover:bg-slate-100 transition"
              >
                <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Layers className="w-5 h-5 stroke-[2.5]" />
                </div>
                <span className="text-xs font-bold text-gray-800">Create Outfit</span>
              </button>
            </div>

            <button
              onClick={() => setShowCreateActionSheet(false)}
              className="w-full py-3 bg-slate-50 hover:bg-slate-100 text-gray-500 font-bold rounded-xl text-xs transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add Item Full-screen View */}
      {showAddItem && activeProfile && (
        <AddItemFlow
          userId={user.uid}
          profile={activeProfile}
          onClose={() => setShowAddItem(false)}
          onItemAdded={() => {
            loadData();
          }}
        />
      )}

      {/* Outfit Builder Full-screen View */}
      {showOutfitBuilder && activeProfile && (
        <OutfitBuilder
          userId={user.uid}
          profile={activeProfile}
          startingItem={builderWithItem}
          initialOutfit={editingOutfit}
          onClose={() => {
            setShowOutfitBuilder(false);
            setBuilderWithItem(null);
            setEditingOutfit(null);
          }}
          onOutfitSaved={() => {
            loadData();
          }}
        />
      )}

      {/* Item Details Popover Card */}
      {selectedItemDetail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-5">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-150 shadow-2xl relative flex flex-col max-h-[85vh]">
            
            {/* Top header controls */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-30 pointer-events-none">
              <button
                type="button"
                onClick={() => setIsEditingTags(!isEditingTags)}
                className={`pointer-events-auto w-8 h-8 rounded-full border shadow-md flex items-center justify-center transition-colors ${
                  isEditingTags
                    ? "bg-black text-white border-black"
                    : "bg-white/80 hover:bg-white text-gray-600 border-slate-100"
                }`}
                title={isEditingTags ? "Save changes" : "Edit item"}
              >
                {isEditingTags ? (
                  <Check className="w-4 h-4 stroke-[2.5]" />
                ) : (
                  <Edit className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                onClick={() => setSelectedItemDetail(null)}
                className="pointer-events-auto bg-white/80 hover:bg-white text-gray-500 p-2 rounded-full border border-slate-100 shadow-md transition"
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>

            {/* Graphic image - Extra large prominent centered view */}
            <div className="bg-[#F0F2F9] pt-10 pb-4 px-4 h-80 relative flex items-center justify-center border-b border-slate-100 overflow-hidden shrink-0">
              <img
                src={selectedItemDetail.imageUrl}
                alt={selectedItemDetail.subcategory}
                referrerPolicy="no-referrer"
                style={{
                  transform: `scale(${(selectedItemDetail.customZoom || 1.0) * 1.35}) translateY(${selectedItemDetail.customOffsetY || 0}px)`,
                }}
                className="max-w-full max-h-full object-contain filter drop-shadow-xl transition-transform duration-200 origin-center"
              />
            </div>

            {/* Text description details */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                {isEditingTags ? (
                  <div className="space-y-3 w-full">
                    <div>
                      <label className="text-[10px] font-medium text-gray-500 block mb-1">
                        Category
                      </label>
                      <select
                        value={selectedItemDetail.category}
                        onChange={(e) =>
                          handleUpdateItem(selectedItemDetail, { category: e.target.value })
                        }
                        className="w-full text-[11px] font-medium text-gray-800 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-black transition"
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-medium text-gray-500 block mb-1">
                        Item name
                      </label>
                      <input
                        type="text"
                        value={selectedItemDetail.subcategory}
                        onChange={(e) =>
                          handleUpdateItem(selectedItemDetail, { subcategory: e.target.value })
                        }
                        className="w-full text-[11px] font-medium text-gray-900 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-black transition"
                        placeholder="Item name (e.g. Denim Jacket)"
                      />
                    </div>

                    {/* Custom Zoom Scale slider */}
                    <div className="bg-slate-50 border border-slate-200/60 p-3 rounded-2xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-semibold text-gray-700">
                          Closet Display Zoom
                        </label>
                        <span className="text-[10px] font-semibold text-gray-900 bg-slate-200/70 px-2 py-0.5 rounded-md">
                          {Math.round((selectedItemDetail.customZoom || 1.0) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="3.0"
                        step="0.05"
                        value={selectedItemDetail.customZoom || 1.0}
                        onChange={(e) =>
                          handleUpdateItem(selectedItemDetail, { customZoom: parseFloat(e.target.value) })
                        }
                        className="w-full accent-black cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                      />
                    </div>

                    {/* Custom Vertical Position Slider */}
                    <div className="bg-slate-50 border border-slate-200/60 p-3 rounded-2xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-semibold text-gray-700">
                          Vertical Alignment (Up / Down)
                        </label>
                        <span className="text-[10px] font-semibold text-gray-900 bg-slate-200/70 px-2 py-0.5 rounded-md">
                          {selectedItemDetail.customOffsetY || 0}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-60"
                        max="60"
                        step="2"
                        value={selectedItemDetail.customOffsetY || 0}
                        onChange={(e) =>
                          handleUpdateItem(selectedItemDetail, { customOffsetY: parseInt(e.target.value) })
                        }
                        className="w-full accent-black cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className="text-[10px] font-medium text-gray-500 block leading-none">
                      {selectedItemDetail.category}
                    </span>
                    <h3 className="text-base font-bold text-gray-900 mt-1">
                      {selectedItemDetail.subcategory}
                    </h3>
                  </div>
                )}
              </div>

              {/* Tag fields */}
              <div className="space-y-2">
                {isEditingTags && (
                  <label className="text-[10px] font-medium text-gray-500 block mb-1">
                    Tags & details
                  </label>
                )}

                {isEditingTags && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <input
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddCustomTag(selectedItemDetail, newTagInput);
                        }
                      }}
                      placeholder="Add a new tag..."
                      className="flex-1 text-[11px] font-medium text-gray-900 bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-black transition"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddCustomTag(selectedItemDetail, newTagInput)}
                      className="bg-black text-white text-[11px] font-semibold px-3 py-1.5 rounded-xl hover:bg-zinc-800 transition"
                    >
                      Add
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {/* Colors */}
                  {selectedItemDetail.colors?.map((c) => (
                    <span
                      key={c}
                      className="text-[10px] font-medium text-gray-700 bg-slate-100 px-2.5 py-1 rounded-lg flex items-center gap-1.5 border border-slate-200"
                    >
                      {c}
                      {isEditingTags && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItemTag(selectedItemDetail, "color", c)}
                          className="hover:bg-slate-200 p-0.5 rounded-full text-gray-400 hover:text-gray-600 transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {/* Seasons */}
                  {selectedItemDetail.season?.map((s) => (
                    <span
                      key={s}
                      className="text-[10px] font-medium text-gray-700 bg-slate-100 px-2.5 py-1 rounded-lg flex items-center gap-1.5 border border-slate-200"
                    >
                      {s}
                      {isEditingTags && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItemTag(selectedItemDetail, "season", s)}
                          className="hover:bg-slate-200 p-0.5 rounded-full text-gray-400 hover:text-gray-600 transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {/* Occasions */}
                  {selectedItemDetail.occasion?.map((o) => (
                    <span
                      key={o}
                      className="text-[10px] font-medium text-gray-700 bg-slate-100 px-2.5 py-1 rounded-lg flex items-center gap-1.5 border border-slate-200"
                    >
                      {o}
                      {isEditingTags && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItemTag(selectedItemDetail, "occasion", o)}
                          className="hover:bg-slate-200 p-0.5 rounded-full text-gray-400 hover:text-gray-600 transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Buttons: Coordinate AI Outfit & Remove from closet side by side */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => {
                    setBuilderWithItem(selectedItemDetail);
                    setShowOutfitBuilder(true);
                    setSelectedItemDetail(null);
                  }}
                  className="py-2.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-semibold rounded-2xl text-[10px] transition flex items-center justify-center gap-1.5 border border-emerald-100 text-center"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500 flex-shrink-0" />
                  <span>Coordinate AI Outfit</span>
                </button>

                <button
                  onClick={() => handleDeleteItem(selectedItemDetail.id)}
                  className="py-2.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-2xl text-[10px] transition flex items-center justify-center gap-1.5 border border-rose-100 text-center"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />
                  <span>Remove from closet</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Outfit Details Popover Card */}
      {selectedOutfitDetail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-5">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-150 shadow-2xl relative flex flex-col max-h-[85vh]">
            
            {/* Header close */}
            <button
              onClick={() => setSelectedOutfitDetail(null)}
              className="absolute top-4 right-4 bg-white/80 hover:bg-white text-gray-500 p-2 rounded-full border border-slate-100 shadow-md z-30 transition"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>

            {/* Collage Header representation */}
            <div className="bg-[#F0F2F9] p-6 aspect-[4/3] relative flex items-center justify-center border-b border-slate-100 overflow-hidden">
              <div className="absolute inset-0 pattern-grid pointer-events-none opacity-40"></div>
              
              <div className="flex gap-2.5 items-center justify-center max-w-[80%] max-h-[80%] z-10">
                {selectedOutfitDetail.itemIds.slice(0, 3).map((itemId) => {
                  const it = items.find((i) => i.id === itemId);
                  if (!it) return null;
                  return (
                    <div key={itemId} className="w-16 h-16 rounded-xl bg-white/80 border border-slate-200/50 flex items-center justify-center p-1 shadow-sm">
                      <img src={it.imageUrl} alt="piece" referrerPolicy="no-referrer" className="max-w-full max-h-full object-contain filter drop-shadow" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Content Body details */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <span className="text-[10px] font-medium text-gray-500 block leading-none">
                  Outfit
                </span>
                <h3 className="text-base font-bold text-gray-900 mt-1">
                  {selectedOutfitDetail.name}
                </h3>
              </div>

              {/* Occasion / details pill */}
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] font-medium text-gray-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                  {selectedOutfitDetail.occasion}
                </span>
              </div>

              {/* Component pieces list representation */}
              <div className="space-y-2 pt-1">
                <label className="text-[10px] font-medium text-gray-500 block">
                  Included Pieces ({selectedOutfitDetail.itemIds.length})
                </label>
                <div className="space-y-1.5">
                  {selectedOutfitDetail.itemIds.map((itemId) => {
                    const it = items.find((i) => i.id === itemId);
                    if (!it) return null;
                    return (
                      <div key={itemId} className="flex items-center gap-2.5 p-2 bg-slate-50 border border-slate-100 rounded-xl">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-0.5 overflow-hidden">
                          <img src={it.imageUrl} alt="piece" referrerPolicy="no-referrer" className="max-w-full max-h-full object-contain" />
                        </div>
                        <span className="text-[11px] font-bold text-gray-700">{it.subcategory}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action buttons: Edit Outfit & Delete Outfit */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => {
                    setEditingOutfit(selectedOutfitDetail);
                    setSelectedOutfitDetail(null);
                    setShowOutfitBuilder(true);
                  }}
                  className="py-2.5 px-2 bg-slate-100 hover:bg-slate-200 text-gray-800 font-semibold rounded-2xl text-[10px] transition flex items-center justify-center gap-1.5 border border-slate-200 text-center"
                >
                  <Edit className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                  <span>Edit Outfit</span>
                </button>

                <button
                  onClick={() => {
                    handleDeleteOutfit(selectedOutfitDetail.id);
                    setSelectedOutfitDetail(null);
                  }}
                  className="py-2.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-2xl text-[10px] transition flex items-center justify-center gap-1.5 border border-rose-100 text-center"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />
                  <span>Delete Outfit</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
