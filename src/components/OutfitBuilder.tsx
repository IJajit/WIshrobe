import React, { useState, useEffect } from "react";
import { X, Sparkles, Check, Grid, Layers, Trash2, RefreshCw, Star, Info } from "lucide-react";
import { Profile, ClothingItem, Outfit } from "../types";

interface OutfitBuilderProps {
  userId: string;
  profile: Profile;
  onClose: () => void;
  onOutfitSaved: () => void;
  startingItem?: ClothingItem | null; // optional item to build around
  initialOutfit?: Outfit | null; // optional existing outfit to edit
}

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

interface SuggestedOutfit {
  name: string;
  itemIds: string[];
  occasion: string;
  stylistNotes: string;
}

export default function OutfitBuilder({
  userId,
  profile,
  onClose,
  onOutfitSaved,
  startingItem,
  initialOutfit,
}: OutfitBuilderProps) {
  const [catalog, setCatalog] = useState<ClothingItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);

  // Outfit design state
  const [selectedItems, setSelectedItems] = useState<ClothingItem[]>([]);
  const [itemScales, setItemScales] = useState<Record<string, number>>(() => initialOutfit?.itemScales || {});
  const [outfitName, setOutfitName] = useState("");
  const [occasionTag, setOccasionTag] = useState("Casual");

  // Category filter for the selector tray
  const [activeTab, setActiveTab] = useState<string>("Tops");

  // AI suggestion state
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<SuggestedOutfit[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load catalog of items scoped to this profile
  useEffect(() => {
    if (!userId || !profile.id) return;

    const loadCatalog = async () => {
      try {
        const storageKey = `wishrobe_items_${profile.id}`;
        const localRaw = localStorage.getItem(storageKey);
        const localList: ClothingItem[] = localRaw ? JSON.parse(localRaw) : [];
        if (localList.length > 0) {
          setCatalog(localList);
          setIsLoadingCatalog(false);
        }

        const res = await fetch(`/api/items?profileId=${profile.id}`, {
          headers: {
            "X-User-Uid": userId,
          },
        });
        if (res.ok) {
          const list: ClothingItem[] = await res.json();
          const combined = [...localList];
          for (const item of list) {
            if (!combined.some((c) => c.id === item.id)) {
              combined.push(item);
            }
          }
          setCatalog(combined);
        }

        // Handle initial outfit editing or starting item pre-selection
        if (initialOutfit) {
          setOutfitName(initialOutfit.name);
          setOccasionTag(initialOutfit.occasion);
          const currentList = localList.length > 0 ? localList : [];
          const matched = currentList.filter((item) => initialOutfit.itemIds.includes(item.id));
          setSelectedItems(matched);
        } else if (startingItem) {
          setSelectedItems([startingItem]);
        }
      } catch (err) {
        console.error("Error loading items for builder:", err);
      } finally {
        setIsLoadingCatalog(false);
      }
    };

    loadCatalog();
  }, [userId, profile, startingItem]);

  // Remove background details and compute snapped coordinate styles for a flat-lay
  const getItemLayerStyle = (category: string) => {
    switch (category) {
      case "Accessories":
        return {
          zIndex: 50,
          top: "6%",
          left: "66%",
          width: "28%",
          height: "28%",
          transform: "rotate(4deg)",
        };
      case "Outerwear":
        return {
          zIndex: 40,
          top: "14%",
          left: "22%",
          width: "56%",
          height: "44%",
        };
      case "Tops":
      case "Dresses":
      case "Full body & sets":
        return {
          zIndex: 30,
          top: "16%",
          left: "26%",
          width: "48%",
          height: "40%",
        };
      case "Bottoms":
      case "Skirts":
        return {
          zIndex: 20,
          top: "44%",
          left: "28%",
          width: "44%",
          height: "38%",
        };
      case "Shoes":
        return {
          zIndex: 10,
          top: "74%",
          left: "35%",
          width: "30%",
          height: "22%",
        };
      default:
        return {
          zIndex: 25,
          top: "30%",
          left: "30%",
          width: "40%",
          height: "40%",
        };
    }
  };

  const handleSelectItem = (item: ClothingItem) => {
    setSelectedItems((prev) => {
      // Rule: Can replace existing item in same category, EXCEPT for accessories/outerwear where multiple are allowed,
      // or we just replace for Tops/Bottoms to keep a neat flat-lay.
      const isSingleChoiceCategory = ["Tops", "Bottoms", "Skirts", "Dresses", "Full body & sets", "Shoes"].includes(item.category);
      
      if (isSingleChoiceCategory) {
        // If they pick Dresses or Full body & sets, remove Tops and Bottoms/Skirts to avoid clashing layers
        if (item.category === "Dresses" || item.category === "Full body & sets") {
          return [...prev.filter((i) => !["Tops", "Bottoms", "Skirts", "Dresses", "Full body & sets"].includes(i.category)), item];
        }
        // If they pick Tops or Bottoms, remove Dresses or Full body & sets
        if (item.category === "Tops" || item.category === "Bottoms" || item.category === "Skirts") {
          return [...prev.filter((i) => i.category !== item.category && i.category !== "Dresses" && i.category !== "Full body & sets"), item];
        }
        return [...prev.filter((i) => i.category !== item.category), item];
      } else {
        // For Accessories / Outerwear, toggles selection
        const alreadyHas = prev.find((i) => i.id === item.id);
        if (alreadyHas) {
          return prev.filter((i) => i.id !== item.id);
        }
        return [...prev, item];
      }
    });
  };

  const handleRemoveItemFromCanvas = (id: string) => {
    setSelectedItems((prev) => prev.filter((item) => item.id !== id));
  };

  const triggerAiSuggestions = async () => {
    if (catalog.length < 2) {
      setAiError("You need at least 2 items in your wardrobe for Gemini to suggest coordinates!");
      return;
    }

    setIsAiLoading(true);
    setAiError(null);
    setAiSuggestions([]);

    // If starting item is on canvas, pass its ID to build around
    const seedItemId = selectedItems.length > 0 ? selectedItems[0].id : undefined;

    // If AI server call fails or API key is not configured, generate smart outfit pairing locally with proper outfit logic
    const fallbackLocalSuggestions = (): SuggestedOutfit[] => {
      if (catalog.length < 2) return [];
      const tops = catalog.filter((i) => i.category === "Tops");
      const bottoms = catalog.filter((i) => i.category === "Bottoms" || i.category === "Skirts");
      const dresses = catalog.filter((i) => i.category === "Dresses" || i.category === "Full body & sets");
      const shoes = catalog.filter((i) => i.category === "Shoes");
      const outerwear = catalog.filter((i) => i.category === "Outerwear");
      const accessories = catalog.filter((i) => i.category === "Accessories");

      const seedItem = selectedItems.length > 0 ? selectedItems[0] : null;
      const suggestions: SuggestedOutfit[] = [];

      // Helper to validate that an outfit has valid combination logic (e.g. Top + Bottom/Skirt, or Dress/Full body)
      const isValidOutfit = (itemIds: string[]) => {
        const selected = itemIds.map((id) => catalog.find((c) => c.id === id)).filter((c): c is ClothingItem => !!c);
        const categories = selected.map((s) => s.category);
        const hasTop = categories.includes("Tops");
        const hasBottom = categories.includes("Bottoms") || categories.includes("Skirts");
        const hasDress = categories.includes("Dresses") || categories.includes("Full body & sets");
        
        // Ensure no multiple tops or multiple bottoms in the same outfit
        const topCount = categories.filter((c) => c === "Tops").length;
        const bottomCount = categories.filter((c) => c === "Bottoms" || c === "Skirts").length;

        return (hasDress || (hasTop && hasBottom)) && topCount <= 1 && bottomCount <= 1;
      };

      if (seedItem) {
        if (seedItem.category === "Tops") {
          const partnerBottom = bottoms[0];
          if (partnerBottom) {
            const items = [seedItem.id, partnerBottom.id];
            if (shoes[0]) items.push(shoes[0].id);
            if (accessories[0]) items.push(accessories[0].id);
            if (isValidOutfit(items)) {
              suggestions.push({
                name: `${seedItem.subcategory || "Top"} & ${partnerBottom.subcategory || "Bottom"} Look`,
                itemIds: items,
                occasion: "Casual",
                stylistNotes: `Styled your ${seedItem.subcategory || "top"} with matching ${partnerBottom.subcategory || "bottoms"}.`,
              });
            }
          }
        } else if (seedItem.category === "Bottoms" || seedItem.category === "Skirts") {
          const partnerTop = tops[0];
          if (partnerTop) {
            const items = [partnerTop.id, seedItem.id];
            if (shoes[0]) items.push(shoes[0].id);
            if (accessories[0]) items.push(accessories[0].id);
            if (isValidOutfit(items)) {
              suggestions.push({
                name: `${partnerTop.subcategory || "Top"} & ${seedItem.subcategory || "Bottom"} Look`,
                itemIds: items,
                occasion: "Casual",
                stylistNotes: `Styled your ${seedItem.subcategory || "bottom"} with ${partnerTop.subcategory || "top"}.`,
              });
            }
          }
        } else if (seedItem.category === "Dresses" || seedItem.category === "Full body & sets") {
          const items = [seedItem.id];
          if (outerwear[0]) items.push(outerwear[0].id);
          if (shoes[0]) items.push(shoes[0].id);
          if (accessories[0]) items.push(accessories[0].id);
          suggestions.push({
            name: `${seedItem.subcategory || "Dress"} Style`,
            itemIds: items,
            occasion: "Casual",
            stylistNotes: `Complete look centered around your ${seedItem.subcategory || "dress"}.`,
          });
        }
      }

      // Default fallback outfit if seed item pairing wasn't enough
      if (suggestions.length === 0 && tops.length > 0 && bottoms.length > 0) {
        const items = [tops[0].id, bottoms[0].id];
        if (outerwear[0]) items.push(outerwear[0].id);
        else if (shoes[0]) items.push(shoes[0].id);
        if (isValidOutfit(items)) {
          suggestions.push({
            name: "Signature Everyday Look",
            itemIds: items,
            occasion: "Casual",
            stylistNotes: "A clean, effortless daily combination created from your closet basics.",
          });
        }
      }

      // Additional fallback with dress/full body or second top-bottom set
      if (dresses.length > 0 && !suggestions.some((s) => s.itemIds.includes(dresses[0].id))) {
        const items = [dresses[0].id];
        if (shoes[0]) items.push(shoes[0].id);
        suggestions.push({
          name: `${dresses[0].subcategory || "Full Body"} Ensemble`,
          itemIds: items,
          occasion: "Casual",
          stylistNotes: "An elegant full-body look.",
        });
      } else if (tops.length > 1 && bottoms.length > 1) {
        const items = [tops[1].id, bottoms[1].id];
        if (isValidOutfit(items) && !suggestions.some((s) => s.itemIds.includes(tops[1].id))) {
          suggestions.push({
            name: "Weekend Casual Look",
            itemIds: items,
            occasion: "Casual",
            stylistNotes: "A relaxed weekend pairing.",
          });
        }
      }

      return suggestions;
    };

    try {
      const response = await fetch("/api/suggest-outfits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: catalog,
          startingItemId: seedItemId,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();
      if (Array.isArray(data.outfits) && data.outfits.length > 0) {
        setAiSuggestions(data.outfits);
      } else {
        const localFallback = fallbackLocalSuggestions();
        if (localFallback.length > 0) {
          setAiSuggestions(localFallback);
        } else {
          setAiError("Gemini couldn't find a perfect pairing right now. Try adding more items to your closet!");
        }
      }
    } catch (err: any) {
      console.warn("AI coordinate API fallback to local smart styling:", err);
      const localFallback = fallbackLocalSuggestions();
      if (localFallback.length > 0) {
        setAiSuggestions(localFallback);
      } else {
        setAiError("Failed to coordinate AI suggestions. Please check your network.");
      }
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleApplyAiOutfit = (suggested: SuggestedOutfit) => {
    const loadedItems: ClothingItem[] = [];
    suggested.itemIds.forEach((id) => {
      const match = catalog.find((item) => item.id === id);
      if (match) loadedItems.push(match);
    });

    if (loadedItems.length > 0) {
      setSelectedItems(loadedItems);
      setOutfitName(suggested.name);
      setOccasionTag(suggested.occasion);
    }
  };

  const handleSaveOutfit = async () => {
    if (selectedItems.length === 0) return;
    
    // Auto-generate name if left blank
    const nameToSave = outfitName.trim() || `${occasionTag} Look ${new Date().toLocaleDateString()}`;

    setIsSaving(true);
    setSaveError(null);

    try {
      const outfitId = initialOutfit ? initialOutfit.id : `outfit-${Date.now()}`;
      const outfitData: Outfit = {
        id: outfitId,
        profileId: profile.id,
        name: nameToSave,
        itemIds: selectedItems.map((item) => item.id),
        itemScales,
        occasion: occasionTag,
        createdAt: initialOutfit ? initialOutfit.createdAt : new Date().toISOString(),
      };

      // 1. Save to localStorage immediately (instant response)
      const storageKey = `local_outfits_${profile.id}`;
      const localRaw = localStorage.getItem(storageKey);
      const existingOutfits: Outfit[] = localRaw ? JSON.parse(localRaw) : [];

      let updatedOutfits: Outfit[];
      if (initialOutfit) {
        updatedOutfits = existingOutfits.map((o) => (o.id === outfitId ? outfitData : o));
      } else {
        updatedOutfits = [outfitData, ...existingOutfits];
      }
      localStorage.setItem(storageKey, JSON.stringify(updatedOutfits));

      onOutfitSaved();
      onClose();
      setIsSaving(false);

      // 2. Sync to server in background
      fetch(initialOutfit ? `/api/outfits/${initialOutfit.id}` : "/api/outfits", {
        method: initialOutfit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Uid": userId,
        },
        body: JSON.stringify(outfitData),
      }).catch(() => {});

    } catch (err: any) {
      console.error("Save outfit error:", err);
      setSaveError("Failed to save outfit. Please try again.");
      setIsSaving(false);
    }
  };

  const filteredCatalog = catalog.filter((item) => item.category === activeTab);

  return (
    <div id="outfit-builder" className="fixed inset-0 bg-white z-50 flex flex-col md:max-w-md md:mx-auto md:border-x md:border-slate-100 shadow-2xl">
      {/* Sticky Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white">
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-slate-50 transition"
        >
          <X className="w-5 h-5 stroke-[2.5]" />
        </button>
        <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest">
          Outfit Builder
        </h2>
        <button
          type="button"
          onClick={triggerAiSuggestions}
          disabled={isAiLoading || catalog.length < 2}
          className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-100 rounded-full text-xs font-bold transition flex items-center gap-1 disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500" />
          AI Suggest
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {/* Canvas & Wardrobe split */}
        <div className="p-4 space-y-4">
          
          {/* AI Suggestion Area */}
          {(isAiLoading || aiSuggestions.length > 0 || aiError) && (
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 p-4 rounded-3xl border border-emerald-100 space-y-3">
              {aiSuggestions.length > 0 && (
                <div className="flex items-center justify-end">
                  <button
                    onClick={() => setAiSuggestions([])}
                    className="text-[10px] text-emerald-600 hover:underline font-bold"
                  >
                    Clear
                  </button>
                </div>
              )}

              {isAiLoading && (
                <div className="flex items-center gap-2.5 py-4 text-xs text-emerald-700 animate-pulse font-medium">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating suggestions...
                </div>
              )}

              {aiError && (
                <div className="text-xs text-rose-700 p-2 bg-rose-50 rounded-xl flex items-start gap-1.5 border border-rose-100">
                  <Info className="w-4 h-4 shrink-0" />
                  {aiError}
                </div>
              )}

              {aiSuggestions.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {aiSuggestions.map((s, idx) => (
                    <div
                      key={idx}
                      className="bg-white p-3 rounded-2xl border border-emerald-100/50 hover:shadow-sm transition flex items-center justify-between gap-3"
                    >
                      <span className="text-xs font-bold text-gray-900">{s.name}</span>
                      <button
                        onClick={() => handleApplyAiOutfit(s)}
                        className="px-3 py-1 bg-black text-white hover:bg-zinc-800 text-[10px] font-bold rounded-full transition shrink-0"
                      >
                        View
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Layered Visualization Canvas */}
          <div className="relative h-96 w-full rounded-3xl bg-[#F9FAFB] overflow-hidden border border-[#F0F0F0] flex items-center justify-center">
            {/* Magazine Flat-lay Backdrop Grid */}
            <div className="absolute inset-0 pattern-grid pointer-events-none opacity-40"></div>

            {selectedItems.length === 0 ? (
              <div className="text-center px-6 space-y-2 z-10">
                <Layers className="w-10 h-10 text-gray-400 mx-auto" />
                <h4 className="text-sm font-bold text-gray-800">Your Outfit Canvas</h4>
                <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                  Select pieces from the collection tray below. They will snap into a layered flat-lay, stacking jacket over t-shirt, pants, and sneakers.
                </p>
              </div>
            ) : (
              /* Flat-lay layered items */
              <div className="absolute inset-0">
                {selectedItems.map((item) => {
                  const style = getItemLayerStyle(item.category);
                  return (
                    <div
                      key={item.id}
                      style={{
                        position: "absolute",
                        ...style,
                      } as React.CSSProperties}
                      className="transition-all duration-300 hover:scale-105 group"
                    >
                      {/* Delete button */}
                      <button
                        onClick={() => handleRemoveItemFromCanvas(item.id)}
                        className="absolute top-1 right-1 bg-white text-rose-500 p-1 rounded-full shadow-md z-30 opacity-0 group-hover:opacity-100 transition duration-150 border border-slate-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      {/* Image representation */}
                      <div className="w-full h-full p-2 bg-transparent rounded-2xl flex items-center justify-center relative">
                        <img
                          src={item.imageUrl}
                          alt={item.subcategory}
                          referrerPolicy="no-referrer"
                          style={{
                            transform: `scale(${(itemScales[item.id] !== undefined ? itemScales[item.id] : (item.customZoom || 1.0))}) translateY(${item.customOffsetY || 0}px)`,
                          }}
                          className="max-w-full max-h-full object-contain filter drop-shadow-lg transition-transform duration-150"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Selected items count badge */}
            {selectedItems.length > 0 && (
              <div className="absolute bottom-3 left-4 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full text-[10px] font-black text-gray-700 shadow-sm border border-slate-100 flex items-center gap-1 z-30">
                <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                {selectedItems.length} Pieces
              </div>
            )}
          </div>

          {/* Form details section */}
          {selectedItems.length > 0 && (
            <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100 space-y-3.5">
              <h3 className="text-xs font-black text-gray-500 uppercase tracking-wider">
                Outfit Details
              </h3>

              {saveError && (
                <div className="p-2.5 text-xs bg-rose-50 text-rose-800 rounded-xl border border-rose-100">
                  {saveError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    Outfit Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Summer Chic, Office Cozy"
                    value={outfitName}
                    onChange={(e) => setOutfitName(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    Occasion / Season Tag
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Casual Sunday, Winter Layer"
                    value={occasionTag}
                    onChange={(e) => setOccasionTag(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Individual Piece Zoom Adjustment Sliders */}
              <div className="space-y-2 pt-2 border-t border-slate-200/60">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block">
                  Piece Scale & Sizing Controls
                </label>
                <div className="space-y-2">
                  {selectedItems.map((item) => {
                    const currentScale = itemScales[item.id] !== undefined ? itemScales[item.id] : (item.customZoom || 1.0);
                    return (
                      <div key={item.id} className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <img src={item.imageUrl} alt={item.subcategory} className="w-7 h-7 object-contain rounded-md shrink-0 bg-slate-50 border border-slate-100" />
                          <span className="text-[11px] font-semibold text-gray-800 truncate">{item.subcategory}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="range"
                            min="0.5"
                            max="3.0"
                            step="0.05"
                            value={currentScale}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setItemScales((prev) => ({ ...prev, [item.id]: val }));
                            }}
                            className="w-24 accent-black cursor-pointer h-1 bg-slate-200 rounded"
                          />
                          <span className="text-[10px] font-semibold text-gray-600 w-9 text-right">
                            {Math.round(currentScale * 100)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Wardrobe tray selector */}
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest flex items-center gap-1.5">
              <Grid className="w-4 h-4 text-gray-500" />
              Your Wardrobe Catalog
            </h3>

            {/* Category horizontal scroller */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none select-none">
              {CATEGORIES.map((cat) => {
                const count = catalog.filter((i) => i.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveTab(cat)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-full border shrink-0 transition ${
                      activeTab === cat
                        ? "bg-black text-white border-black"
                        : "bg-slate-50 text-gray-500 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {cat} ({count})
                  </button>
                );
              })}
            </div>

            {/* Selection items grid */}
            {isLoadingCatalog ? (
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="aspect-square bg-slate-50 border border-slate-100 rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400 bg-slate-50 rounded-2xl border border-slate-100">
                No {activeTab} added to this profile yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {filteredCatalog.map((item) => {
                  const isSelected = selectedItems.some((si) => si.id === item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      className={`relative aspect-square rounded-2xl p-2 flex items-center justify-center transition border ${
                        isSelected
                          ? "bg-emerald-50/50 border-emerald-400 ring-2 ring-emerald-500/20"
                          : "bg-[#F3F2F7] hover:bg-[#EAEAEA] border-transparent hover:shadow-sm"
                      }`}
                    >
                      <img
                        src={item.imageUrl}
                        alt={item.subcategory}
                        referrerPolicy="no-referrer"
                        className="max-w-full max-h-full object-contain filter drop-shadow-sm"
                      />
                      
                      {isSelected && (
                        <div className="absolute top-1 right-1 bg-emerald-500 text-white p-0.5 rounded-full z-10 shadow">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Floating Save controls */}
      {selectedItems.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-100 bg-white/90 backdrop-blur-md z-40 flex gap-3">
          <button
            type="button"
            onClick={() => setSelectedItems([])}
            className="px-4 py-3 bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-2xl text-xs transition"
          >
            Clear Look
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveOutfit}
            className="flex-1 py-3 bg-black text-white hover:bg-zinc-800 font-bold rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-1.5"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving Outfit...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Save Outfit
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
