import React, { useState, useRef } from "react";
import { Camera, Image as ImageIcon, X, ArrowRight, ArrowLeft, Check, Sparkles, AlertCircle } from "lucide-react";
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
          mimeType: mimeType || "image/jpeg",
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
      console.warn("Gemini API fallback to local canvas color & aspect ratio detection:", err);
      
      // Analyze image colors and aspect ratio directly from uploaded canvas
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, 100, 100);
          const data = ctx.getImageData(0, 0, 100, 100).data;
          let rSum = 0, gSum = 0, bSum = 0, count = 0;
          for (let i = 0; i < data.length; i += 16) {
            if (data[i + 3] > 50) {
              rSum += data[i];
              gSum += data[i + 1];
              bSum += data[i + 2];
              count++;
            }
          }
          if (count > 0) {
            const avgR = rSum / count;
            const avgG = gSum / count;
            const avgB = bSum / count;

            let colorName = "Black";
            // Detailed RGB Color Spectrum Analysis
            if (avgR > 200 && avgG > 100 && avgB < 80) colorName = "Orange";
            else if (avgR > 180 && avgG < 80 && avgB < 80) colorName = "Red";
            else if (avgR > 180 && avgG > 180 && avgB < 90) colorName = "Yellow";
            else if (avgR < 80 && avgG > 150 && avgB < 90) colorName = "Green";
            else if (avgB > avgR + 30 && avgB > avgG + 30) colorName = "Blue";
            else if (avgR > 130 && avgG < 70 && avgB > 130) colorName = "Purple";
            else if (avgR > 120 && avgG > 90 && avgB < 60) colorName = "Brown";
            else if (avgR < 50 && avgG < 50 && avgB < 50) colorName = "Black";
            else if (avgR > 200 && avgG > 200 && avgB > 200) colorName = "White";
            else if (Math.abs(avgR - avgG) < 20 && Math.abs(avgG - avgB) < 20) colorName = "Grey";

            // Aspect ratio & shape classification:
            // Trousers/pants are significantly taller than wide (aspect ratio height / width >= 1.25)
            const aspectRatio = img.height / (img.width || 1);
            const isTrousers = aspectRatio >= 1.25;
            
            const detectedCat = isTrousers ? "Bottoms" : "Tops";
            let detectedSubcat = "Top";
            if (isTrousers) {
              detectedSubcat = colorName.toLowerCase().includes("blue") ? "Jeans" : "Pants";
            } else {
              detectedSubcat = (colorName === "Orange" || colorName === "Red" || colorName === "Grey") ? "Sweatshirt" : "T-Shirt";
            }

            setCategory(detectedCat);
            setSubcategory(detectedSubcat);
            setColors([colorName]);
            setSeason(["Autumn", "Winter", "Spring"]);
            setOccasions(["Casual"]);
          }
        }
      };
      img.src = imageBase64;
    } finally {
      setIsLoadingTags(false);
    }
  };

  // Compress image to max 600px PNG — preserves transparent cutouts
  const compressImage = (dataUrl: string, maxPx = 600): Promise<string> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  const handleSave = async () => {
    if (!processedImage) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const compressedImage = await compressImage(processedImage);
      const itemId = `item-${Date.now()}`;

      const itemData = {
        id: itemId,
        profileId: profile.id,
        imageUrl: compressedImage,
        category,
        subcategory: subcategory.trim() || `${category} Item`,
        colors,
        season,
        occasion: occasions,
        createdAt: new Date().toISOString(),
        customZoom: 1.0,
        customOffsetY: 0,
      };

      // Save to localStorage immediately — closes the modal instantly
      const storageKey = `wishrobe_items_${profile.id}`;
      const existing = JSON.parse(localStorage.getItem(storageKey) || "[]");
      existing.push(itemData);
      localStorage.setItem(storageKey, JSON.stringify(existing));

      onItemAdded();
      onClose();
      setIsSaving(false);

      // Sync to server in background — non-blocking
      fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Uid": userId },
        body: JSON.stringify(itemData),
      }).catch(() => {});

    } catch (err: any) {
      console.error("Save item error:", err);
      setSaveError("Failed to save item. Please try again.");
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
    <div id="add-item-flow" className="fixed inset-0 bg-white z-50 flex flex-col md:max-w-md md:mx-auto md:border-x md:border-slate-100 shadow-2xl font-sans">
      {/* Sticky Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-slate-50 transition"
        >
          <X className="w-5 h-5 stroke-[2.5]" />
        </button>
        <h2 className="text-xs font-semibold text-gray-800 tracking-wide">
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
              <h3 className="text-lg font-medium text-gray-900">Upload your piece</h3>
              <p className="text-xs text-gray-400 max-w-xs mx-auto mt-1.5 leading-relaxed">
                Take a photo of your clothing item or choose one from your gallery.
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
                className="w-full py-3.5 bg-black text-white hover:bg-zinc-800 font-medium rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-2"
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
                className="w-full py-3.5 bg-slate-100 border border-slate-200 text-gray-700 hover:bg-slate-200 font-medium rounded-2xl text-xs transition flex items-center justify-center gap-2"
              >
                <ImageIcon className="w-4 h-4 text-gray-500" />
                Upload
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
                className="flex-1 py-3 bg-slate-100 border border-slate-200 text-slate-700 font-medium rounded-2xl text-xs transition"
              >
                Upload
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 py-3 bg-black text-white hover:bg-zinc-800 font-medium rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-1.5"
              >
                Next
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          /* Step 2: Edit & Confirm Tags Form */
          <div className="space-y-5">
            {/* Cutout thumbnail */}
            <div className="flex items-center gap-4 bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
              <img
                src={processedImage || rawImage}
                alt="Cutout Thumbnail"
                className="w-16 h-16 object-contain rounded-xl bg-white border border-slate-100 shadow-xs shrink-0"
              />
              <div className="flex-1">
                <h4 className="text-xs font-semibold text-gray-900">
                  Confirm Item Details
                </h4>
                <p className="text-[10px] text-gray-500 leading-normal mt-0.5">
                  Please verify the suggested tags below before adding this item to your closet.
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
              <label className="text-[11px] font-normal text-gray-500 capitalize block mb-1">
                Category
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`py-2 px-3 text-[11px] rounded-xl border text-left font-normal transition ${
                      category === cat
                        ? "bg-black text-white border-black"
                        : "bg-slate-50 text-gray-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Subcategory Name */}
            <div className="space-y-2">
              <label className="text-[11px] font-normal text-gray-500 capitalize block mb-1">
                Name
              </label>
              <input
                type="text"
                placeholder="e.g. Linen Trousers, Crewneck T-Shirt"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-normal focus:outline-none focus:ring-1 focus:ring-black"
              />
            </div>

            {/* Colors Tags */}
            <div className="space-y-2">
              <label className="text-[11px] font-normal text-gray-500 capitalize block mb-1">
                Color
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {colors.map((color) => (
                  <span
                    key={color}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-gray-700 text-[10px] font-normal rounded-full transition cursor-pointer"
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
                  placeholder="Add color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addColor())}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-normal focus:outline-none focus:ring-1 focus:ring-black"
                />
                <button
                  type="button"
                  onClick={addColor}
                  className="px-4 bg-slate-100 hover:bg-slate-200 text-gray-700 font-normal rounded-xl text-xs"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Seasons Suitability */}
            <div className="space-y-2">
              <label className="text-[11px] font-normal text-gray-500 capitalize block mb-1">
                Seasons
              </label>
              <div className="flex gap-1.5">
                {SEASONS.map((s) => {
                  const isActive = season.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSeason(s)}
                      className={`flex-1 py-2 text-[11px] font-normal rounded-xl border transition ${
                        isActive
                          ? "bg-black text-white border-black"
                          : "bg-slate-50 text-gray-600 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Occasions Tags */}
            <div className="space-y-2">
              <label className="text-[11px] font-normal text-gray-500 capitalize block mb-1">
                Occasions
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {occasions.map((occ) => (
                  <span
                    key={occ}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-gray-700 text-[10px] font-normal rounded-full transition cursor-pointer"
                    onClick={() => removeOccasion(occ)}
                  >
                    {occ}
                    <X className="w-3 h-3 text-gray-400" />
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add occasion"
                  value={newOccasion}
                  onChange={(e) => setNewOccasion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addOccasion())}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-normal focus:outline-none focus:ring-1 focus:ring-black"
                />
                <button
                  type="button"
                  onClick={addOccasion}
                  className="px-4 bg-slate-100 hover:bg-slate-200 text-gray-700 font-normal rounded-xl text-xs"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="py-3 px-4 bg-slate-100 border border-slate-200 text-slate-700 font-normal rounded-2xl text-xs transition flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="flex-1 py-3 bg-black text-white hover:bg-zinc-800 font-medium rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
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
