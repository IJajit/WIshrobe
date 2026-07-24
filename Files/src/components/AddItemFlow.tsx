import React, { useState, useRef } from "react";
import { Camera, Image as ImageIcon, X, ArrowRight, ArrowLeft, Check, Sparkles, AlertCircle } from "lucide-react";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase";
import { Profile, ClothingItem } from "../types";
import ImageProcessor from "./ImageProcessor";

interface AddItemFlowProps {
  userId: string;
  profile: Profile;
  onClose: () => void;
  onItemAdded: () => void;
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

const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];

export default function AddItemFlow({
  userId,
  profile,
  onClose,
  onItemAdded,
}: AddItemFlowProps) {
  const [step, setStep] = useState<1 | 2>(1); // 1: Photo selection & Processing, 2: Tagging Confirmation
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);

  // Auto-tag state
  const [category, setCategory] = useState<string>("Tops");
  const [subcategory, setSubcategory] = useState<string>("");
  const [colors, setColors] = useState<string[]>([]);
  const [season, setSeason] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<string[]>([]);

  // Editing helpers
  const [newColor, setNewColor] = useState("");
  const [newOccasion, setNewOccasion] = useState("");

  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setRawImage(base64);
      setProcessedImage(base64); // initially same
      triggerGeminiAutoTag(base64, file.type);
    };
    reader.readAsDataURL(file);
  };

  const triggerGeminiAutoTag = async (imageBase64: string, mimeType: string) => {
    setIsLoadingTags(true);
    setTagsError(null);

    try {
      const res = await fetch("/api/auto-tag", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageBase64,
          mimeType,
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const tags = await res.json();
      
      // Update form fields with auto-detected values
      if (tags.category && CATEGORIES.includes(tags.category)) {
        setCategory(tags.category);
      }
      if (tags.subcategory) {
        setSubcategory(tags.subcategory);
      }
      if (Array.isArray(tags.colors)) {
        setColors(tags.colors);
      }
      if (Array.isArray(tags.season)) {
        setSeason(tags.season);
      }
      if (Array.isArray(tags.occasion)) {
        setOccasions(tags.occasion);
      }
    } catch (err: any) {
      console.error("Auto-tagging failure:", err);
      setTagsError("Gemini auto-tagging timed out or failed. You can enter tags manually below!");
    } finally {
      setIsLoadingTags(false);
    }
  };

  const handleSave = async () => {
    if (!processedImage) return;
    setIsSaving(true);
    setSaveError(null);

    let finalImageUrl = processedImage;

    try {
      // 1. Attempt to upload the image to Firebase Storage
      try {
        const itemFilename = `${Date.now()}_item.png`;
        const storageRef = ref(storage, `wardrobe/${userId}/${profile.id}/${itemFilename}`);
        // uploadString supports base64 Data URLs perfectly
        await uploadString(storageRef, processedImage, "data_url");
        finalImageUrl = await getDownloadURL(storageRef);
      } catch (storageErr) {
        console.warn("Storage upload failed (possibly rules/limits), saving as direct inline payload:", storageErr);
        // Fallback to storing base64 inline (valid, robust fallback!)
        finalImageUrl = processedImage;
      }

      // 2. Add document to Cloud SQL Database via API
      const itemData = {
        id: `item-${Date.now()}`,
        profileId: profile.id,
        imageUrl: finalImageUrl,
        category,
        subcategory: subcategory.trim() || `${category} Item`,
        colors,
        season,
        occasion: occasions,
        createdAt: new Date().toISOString(),
      };

      const res = await fetch("/api/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Uid": userId,
        },
        body: JSON.stringify(itemData),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      onItemAdded();
      onClose();
    } catch (err: any) {
      console.error("Save item error:", err);
      setSaveError("Failed to save clothing item. Please check your network connection.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSeason = (s: string) => {
    setSeason((prev) =>
      prev.includes(s) ? prev.filter((item) => item !== s) : [...prev, s]
    );
  };

  const addColor = () => {
    if (newColor.trim() && !colors.includes(newColor.trim())) {
      setColors((prev) => [...prev, newColor.trim()]);
      setNewColor("");
    }
  };

  const removeColor = (colorToRemove: string) => {
    setColors((prev) => prev.filter((c) => c !== colorToRemove));
  };

  const addOccasion = () => {
    if (newOccasion.trim() && !occasions.includes(newOccasion.trim())) {
      setOccasions((prev) => [...prev, newOccasion.trim()]);
      setNewOccasion("");
    }
  };

  const removeOccasion = (occToRemove: string) => {
    setOccasions((prev) => prev.filter((o) => o !== occToRemove));
  };

  return (
    <div id="add-item-flow" className="fixed inset-0 bg-white z-50 flex flex-col md:max-w-md md:mx-auto md:border-x md:border-slate-100 shadow-2xl">
      {/* Sticky Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-slate-50 transition"
        >
          <X className="w-5 h-5 stroke-[2.5]" />
        </button>
        <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest">
          Add Clothing Item
        </h2>
        <div className="w-8"></div> {/* Spacer */}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {!rawImage ? (
          /* Step 0: Empty Upload State */
          <div className="h-[70vh] flex flex-col items-center justify-center text-center space-y-6 px-4">
            <div className="w-20 h-20 rounded-3xl bg-[#F3F2F7] text-gray-400 flex items-center justify-center">
              <Camera className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Upload your piece</h3>
              <p className="text-xs text-gray-400 max-w-xs mx-auto mt-1.5">
                Take a clean flat-lay photo of your clothing item or choose one from your gallery. Gemini will auto-clean the background and tag it!
              </p>
            </div>

            <div className="w-full space-y-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.setAttribute("capture", "environment");
                    fileInputRef.current.click();
                  }
                }}
                className="w-full py-4 bg-black text-white hover:bg-zinc-800 font-bold rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" />
                Take Photo (Camera)
              </button>

              <button
                type="button"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.removeAttribute("capture");
                    fileInputRef.current.click();
                  }
                }}
                className="w-full py-4 bg-slate-50 border border-slate-200 text-gray-700 hover:bg-slate-100 font-bold rounded-2xl text-xs transition flex items-center justify-center gap-2"
              >
                <ImageIcon className="w-4 h-4 text-gray-400" />
                Choose from Gallery
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </div>
        ) : step === 1 ? (
          /* Step 1: Background Removal & Preview */
          <div className="space-y-6">
            <ImageProcessor
              imageSrc={rawImage}
              onProcessed={setProcessedImage}
              isLoadingTags={isLoadingTags}
              tagsError={tagsError}
            />

            <div className="pt-4 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setRawImage(null);
                  setProcessedImage(null);
                }}
                className="flex-1 py-3.5 bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-2xl text-xs transition"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 py-3.5 bg-black text-white hover:bg-zinc-800 font-bold rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-2"
              >
                Next: Verify Tags
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          /* Step 2: Edit & Confirm Tags Form */
          <div className="space-y-6">
            {/* Cutout thumbnail */}
            <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <img
                src={processedImage || rawImage}
                alt="Cutout Thumbnail"
                className="w-20 h-20 object-contain rounded-xl bg-white border border-slate-100 shadow-sm"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 uppercase tracking-widest">
                  <Sparkles className="w-3.5 h-3.5" />
                  Gemini Styled
                </div>
                <h4 className="text-sm font-bold text-gray-800 mt-0.5">
                  Confirm Item Details
                </h4>
                <p className="text-[11px] text-gray-400 leading-snug">
                  Please verify Gemini's suggested tags below before adding this item to your closet.
                </p>
              </div>
            </div>

            {saveError && (
              <div className="p-3 text-xs bg-rose-50 text-rose-800 rounded-xl border border-rose-100 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {saveError}
              </div>
            )}

            {/* Category Select */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Category
              </label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`py-2 px-3 text-xs rounded-xl border text-left font-semibold transition ${
                      category === cat
                        ? "bg-black text-white border-black"
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Subcategory Name */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Piece Name / Subcategory
              </label>
              <input
                type="text"
                placeholder="e.g. Slim Denim Jacket, Crewneck T-Shirt"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Colors Tags */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Colors
              </label>
              <div className="flex flex-wrap gap-1.5">
                {colors.map((color) => (
                  <span
                    key={color}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-gray-700 text-xs font-semibold rounded-full transition cursor-pointer"
                    onClick={() => removeColor(color)}
                  >
                    {color}
                    <X className="w-3 h-3 text-gray-400" />
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add color (e.g. Olive Green)"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addColor())}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={addColor}
                  className="px-4 bg-slate-100 hover:bg-slate-200 text-gray-700 font-bold rounded-xl text-xs"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Season Suitability */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Season suitability
              </label>
              <div className="flex gap-1.5">
                {SEASONS.map((s) => {
                  const isActive = season.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSeason(s)}
                      className={`flex-1 py-2 text-xs font-semibold rounded-xl border transition ${
                        isActive
                          ? "bg-emerald-50 text-emerald-800 border-emerald-400"
                          : "bg-white text-gray-500 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Occasions / Weather Tags */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Occasions / Weather Suitability
              </label>
              <div className="flex flex-wrap gap-1.5">
                {occasions.map((occ) => (
                  <span
                    key={occ}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full transition cursor-pointer"
                    onClick={() => removeOccasion(occ)}
                  >
                    {occ}
                    <X className="w-3 h-3 text-emerald-500" />
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add tag (e.g. Formal, Rain)"
                  value={newOccasion}
                  onChange={(e) => setNewOccasion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addOccasion())}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={addOccasion}
                  className="px-4 bg-slate-100 hover:bg-slate-200 text-gray-700 font-bold rounded-xl text-xs"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="py-3.5 px-4 bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-2xl text-xs transition flex items-center gap-1"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="flex-1 py-3.5 bg-black text-white hover:bg-zinc-800 font-bold rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Adding to closet...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save to Wardrobe
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline loader icon
function RefreshCw(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}
