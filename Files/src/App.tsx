import React, { useState, useEffect } from "react";
import { Profile, ClothingItem, Outfit } from "./types";
import AuthScreen from "./components/AuthScreen";
import ProfileSwitcher from "./components/ProfileSwitcher";
import AddItemFlow from "./components/AddItemFlow";
import OutfitBuilder from "./components/OutfitBuilder";
import { supabase } from "./supabase";
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
  Sparkle
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
  const [user, setUser] = useState<any>(null);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<"items" | "outfits">("items");

  // Filters & layout state
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
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
  const [selectedOutfitDetail, setSelectedOutfitDetail] = useState<Outfit | null>(null);
  const [builderWithItem, setBuilderWithItem] = useState<ClothingItem | null>(null);

  // Supabase Auth Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        handleUserSession(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        handleUserSession(session.user);
      } else {
        setUser(null);
        setActiveProfile(null);
        setItems([]);
        setOutfits([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleUserSession = (sbUser: any) => {
    const userObj = { uid: sbUser.id, email: sbUser.email || "user@supabase.io" };
    setUser(userObj);
    fetch("/api/users/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: sbUser.id, email: sbUser.email }),
    }).catch((err) => console.error("Error syncing user to backend DB:", err));
  };

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
        const res = await fetch(`/api/items?profileId=${activeProfile.id}`, {
          headers: {
            "X-User-Uid": user.uid,
          },
        });
        if (!res.ok) throw new Error(await res.text());
        const list: ClothingItem[] = await res.json();
        setItems(list);
      } else {
        const res = await fetch(`/api/outfits?profileId=${activeProfile.id}`, {
          headers: {
            "X-User-Uid": user.uid,
          },
        });
        if (!res.ok) throw new Error(await res.text());
        const list: Outfit[] = await res.json();
        setOutfits(list);
      }
    } catch (err) {
      console.error("Error loading SQL Wardrobe data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Supabase signOut error:", err);
    }
    setUser(null);
    setActiveProfile(null);
    setItems([]);
    setOutfits([]);
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

  // Item sorting / filtering logic
  const getProcessedItems = () => {
    let list = [...items];

    // 1. Filter by category
    if (selectedCategory) {
      list = list.filter((i) => i.category === selectedCategory);
    }

    // 2. Sort
    if (sortBy === "recent") {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === "worn") {
      list.sort((a, b) => (b.timesWorn || 0) - (a.timesWorn || 0));
    } else if (sortBy === "alpha") {
      list.sort((a, b) => (a.subcategory || "").localeCompare(b.subcategory || ""));
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
        onSuccess={(uid) => {
          const userObj = { uid };
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
          <ProfileSwitcher
            userId={user.uid}
            activeProfile={activeProfile}
            onProfileChange={setActiveProfile}
          />

          <div className="flex items-center gap-1.5">
            <h1 className="text-sm font-black tracking-widest uppercase flex items-center gap-1 text-[#1A1A1A]">
              Wardrobe
              <Sparkle className="w-3.5 h-3.5 text-[#1A1A1A] fill-[#1A1A1A]" />
            </h1>
          </div>

          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-[#F3F2F7] transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
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

              {/* List layout control and sorting selection bar */}
              <div className="px-6 py-3 flex items-center justify-between border-b border-[#F3F2F7]">
                <div className="flex items-center gap-1 bg-[#F3F2F7] border border-[#E5E5E5]/30 px-3 py-1.5 rounded-full">
                  <ArrowUpDown className="w-3 h-3 text-gray-500" />
                  <select
                    value={sortBy}
                    onChange={(e: any) => setSortBy(e.target.value)}
                    className="bg-transparent text-[11px] font-bold text-gray-700 outline-none cursor-pointer"
                  >
                    <option value="recent">Most Recent</option>
                    <option value="worn">Most Worn</option>
                    <option value="alpha">A – Z</option>
                  </select>
                </div>

                <button
                  onClick={() => setIsGridView(!isGridView)}
                  className="p-2 bg-[#F3F2F7] border border-[#E5E5E5]/30 text-[#1A1A1A] rounded-full hover:bg-[#EAEAEA] transition"
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
                    <h3 className="text-sm font-black text-[#1A1A1A] uppercase tracking-wider">No items added</h3>
                    <p className="text-xs text-[#7F7F8E] max-w-xs mt-2.5 leading-relaxed">
                      Catalog your closet by snapping clothing items. Tap the mint <b>Create</b> button to begin.
                    </p>
                  </div>
                </div>
              ) : isGridView ? (
                /* 3-Column Image Grid */
                <div className="p-6 grid grid-cols-3 gap-3">
                  {getProcessedItems().map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItemDetail(item)}
                      className="group flex flex-col text-left space-y-2 focus:outline-none"
                    >
                      {/* Photo with soft cool gray background layout */}
                      <div className="relative aspect-square w-full rounded-2xl bg-[#F3F2F7] hover:bg-[#EAECE4] transition overflow-hidden flex items-center justify-center p-2.5 border border-transparent hover:border-[#E5E5E5]">
                        <img
                          src={item.imageUrl}
                          alt={item.subcategory}
                          referrerPolicy="no-referrer"
                          className="max-w-[85%] max-h-[85%] object-contain filter drop-shadow-sm group-hover:scale-105 transition duration-300"
                        />
                        {item.timesWorn > 0 && (
                          <div className="absolute bottom-1.5 right-1.5 bg-white text-[#1A1A1A] text-[8px] font-bold px-2 py-0.5 rounded-full border border-[#E5E5E5] shadow-xs flex items-center gap-0.5 select-none">
                            Worn {item.timesWorn}x
                          </div>
                        )}
                      </div>
                      <div className="px-0.5">
                        <h4 className="text-[11px] font-bold text-[#1A1A1A] truncate leading-snug">
                          {item.subcategory}
                        </h4>
                        <span className="text-[9px] text-[#7F7F8E] uppercase tracking-widest font-semibold block leading-none mt-0.5">
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
                        <div className="w-12 h-12 rounded-xl bg-[#F3F2F7] border border-[#E5E5E5]/40 flex items-center justify-center p-1.5 overflow-hidden">
                          <img
                            src={item.imageUrl}
                            alt={item.subcategory}
                            referrerPolicy="no-referrer"
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-[#1A1A1A] leading-snug">{item.subcategory}</h4>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#7F7F8E] font-medium uppercase tracking-wider">
                            <span>{item.category}</span>
                            <span>•</span>
                            <span>Worn {item.timesWorn || 0}x</span>
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
                    <p className="text-xs text-[#7F7F8E] max-w-xs mt-2.5 leading-relaxed">
                      Combine items to visualize looks. Tap the mint <b>Create</b> button to assemble a new outfit canvas.
                    </p>
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

                          {outfit.timesWorn > 0 && (
                            <div className="absolute top-2.5 left-2.5 bg-white text-[#1A1A1A] border border-[#E5E5E5] px-2 py-0.5 rounded-full text-[8px] font-bold shadow-xs">
                              Worn {outfit.timesWorn}x
                            </div>
                          )}
                        </div>

                        <div className="px-1">
                          <h4 className="text-xs font-bold text-[#1A1A1A] leading-snug truncate">
                            {outfit.name}
                          </h4>
                          <span className="inline-block text-[9px] font-bold text-[#7F7F8E] uppercase tracking-wider mt-0.5">
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
            <span>Create</span>
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
          onClose={() => {
            setShowOutfitBuilder(false);
            setBuilderWithItem(null);
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
            
            {/* Header close */}
            <button
              onClick={() => setSelectedItemDetail(null)}
              className="absolute top-4 right-4 bg-white/80 hover:bg-white text-gray-500 p-2 rounded-full border border-slate-100 shadow-md z-30 transition"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>

            {/* Graphic image */}
            <div className="bg-[#F0F2F9] p-8 aspect-square relative flex items-center justify-center border-b border-slate-100">
              <img
                src={selectedItemDetail.imageUrl}
                alt={selectedItemDetail.subcategory}
                referrerPolicy="no-referrer"
                className="max-w-[70%] max-h-[70%] object-contain filter drop-shadow-xl"
              />
            </div>

            {/* Text description details */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block leading-none">
                  {selectedItemDetail.category}
                </span>
                <h3 className="text-lg font-black text-gray-900 mt-1">
                  {selectedItemDetail.subcategory}
                </h3>
              </div>

              {/* Tag fields */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {/* Colors */}
                  {selectedItemDetail.colors?.map((c) => (
                    <span key={c} className="text-[10px] font-bold text-gray-600 bg-slate-100 px-2 py-0.5 rounded-md">
                      🎨 {c}
                    </span>
                  ))}
                  {/* Seasons */}
                  {selectedItemDetail.season?.map((s) => (
                    <span key={s} className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md">
                      ☀ {s}
                    </span>
                  ))}
                  {/* Occasions */}
                  {selectedItemDetail.occasion?.map((o) => (
                    <span key={o} className="text-[10px] font-bold text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded-md">
                      🏷️ {o}
                    </span>
                  ))}
                </div>
              </div>

              {/* Wear analytics tracker card */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 grid grid-cols-2 gap-4">
                <div className="text-left">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    Times Worn
                  </span>
                  <span className="text-xl font-black text-gray-800 block mt-1">
                    {selectedItemDetail.timesWorn || 0} times
                  </span>
                </div>
                <div className="text-left border-l border-slate-200 pl-4">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                    Last Worn
                  </span>
                  <span className="text-xs font-bold text-gray-700 block mt-1.5">
                    {formatDate(selectedItemDetail.lastWornAt)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  onClick={() => handleLogItemWorn(selectedItemDetail)}
                  className="w-full py-3 bg-black hover:bg-zinc-800 text-white font-bold rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-1.5"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400 fill-emerald-400" />
                  Log as worn today
                </button>

                <button
                  onClick={() => {
                    setBuilderWithItem(selectedItemDetail);
                    setShowOutfitBuilder(true);
                    setSelectedItemDetail(null);
                  }}
                  className="w-full py-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold rounded-2xl text-xs transition flex items-center justify-center gap-1.5 border border-emerald-100"
                >
                  <Sparkles className="w-4 h-4 text-emerald-500 fill-emerald-500" />
                  Coordinate AI Outfit with this
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
                <span className="inline-block text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase tracking-wider">
                  {selectedOutfitDetail.occasion}
                </span>
                <h3 className="text-base font-black text-gray-900 mt-1.5">
                  {selectedOutfitDetail.name}
                </h3>
              </div>

              {/* Component pieces list representation */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">
                  Included Pieces ({selectedOutfitDetail.itemIds.length})
                </span>
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

              {/* Outfit analytics times */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 grid grid-cols-2 gap-4">
                <div className="text-left">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    Times Worn
                  </span>
                  <span className="text-xl font-black text-gray-800 block mt-1">
                    {selectedOutfitDetail.timesWorn || 0} times
                  </span>
                </div>
                <div className="text-left border-l border-slate-200 pl-4">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                    Last Worn
                  </span>
                  <span className="text-xs font-bold text-gray-700 block mt-1.5">
                    {formatDate(selectedOutfitDetail.lastWornAt)}
                  </span>
                </div>
              </div>

              <button
                onClick={() => handleLogOutfitWorn(selectedOutfitDetail)}
                className="w-full py-3 bg-black hover:bg-zinc-800 text-white font-bold rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-1.5"
              >
                <CheckCircle className="w-4 h-4 text-emerald-400 fill-emerald-400" />
                Log outfit as worn today
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
