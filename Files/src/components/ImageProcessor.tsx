import React, { useEffect, useRef, useState } from "react";
import { Sliders, Check, Wand2, RefreshCw } from "lucide-react";

interface ImageProcessorProps {
  imageSrc: string; // original base64 or object URL
  onProcessed: (processedBase64: string) => void;
  isLoadingTags: boolean;
  tagsError: string | null;
}

export default function ImageProcessor({
  imageSrc,
  onProcessed,
  isLoadingTags,
  tagsError,
}: ImageProcessorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [sensitivity, setSensitivity] = useState<number>(35);
  const [targetColor, setTargetColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [useBackgroundRemoval, setUseBackgroundRemoval] = useState<boolean>(true);

  // Load image and compute initial cutout
  useEffect(() => {
    if (!imageSrc) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageRef.current = img;
      // Extract default background color from corners
      processImage(img);
    };
    img.src = imageSrc;
  }, [imageSrc, sensitivity, targetColor, useBackgroundRemoval]);

  const processImage = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsProcessing(true);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas dimensions (scale down for processing efficiency)
    const maxDim = 600;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    canvas.width = width;
    canvas.height = height;

    // Draw original image
    ctx.drawImage(img, 0, 0, width, height);

    if (!useBackgroundRemoval) {
      // Just output original resized
      const finalBase64 = canvas.toDataURL("image/png");
      onProcessed(finalBase64);
      setIsProcessing(false);
      return;
    }

    try {
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      // If no target color selected yet, sample corners
      let keyColor = targetColor;
      if (!keyColor) {
        // Sample top-left, top-right, bottom-left, bottom-right
        const cornerSamples = [
          getPixel(data, width, 0, 0),
          getPixel(data, width, width - 1, 0),
          getPixel(data, width, 0, height - 1),
          getPixel(data, width, width - 1, height - 1),
        ];
        
        // Average the corners to get the dominant background color
        const avgR = Math.round(cornerSamples.reduce((sum, p) => sum + p.r, 0) / 4);
        const avgG = Math.round(cornerSamples.reduce((sum, p) => sum + p.g, 0) / 4);
        const avgB = Math.round(cornerSamples.reduce((sum, p) => sum + p.b, 0) / 4);
        
        keyColor = { r: avgR, g: avgG, b: avgB };
      }

      // Key out matching pixels
      const sensSq = sensitivity * sensitivity * 3; // normalized distance

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Euclidean distance
        const diffR = r - keyColor.r;
        const diffG = g - keyColor.g;
        const diffB = b - keyColor.b;
        const distSq = diffR * diffR + diffG * diffG + diffB * diffB;

        if (distSq < sensSq) {
          // Calculate softness/feathering near the threshold limit
          const ratio = distSq / sensSq;
          if (ratio < 0.8) {
            data[i + 3] = 0; // Fully transparent
          } else {
            // Smooth gradient
            const alpha = Math.round(((ratio - 0.8) / 0.2) * 255);
            data[i + 3] = Math.min(data[i + 3], alpha);
          }
        }
      }

      // Put processed pixels back
      ctx.putImageData(imageData, 0, 0);

      // Save processed image back
      const finalBase64 = canvas.toDataURL("image/png");
      onProcessed(finalBase64);
    } catch (err) {
      console.error("Canvas processing error, falling back to original:", err);
      const finalBase64 = canvas.toDataURL("image/png");
      onProcessed(finalBase64);
    }

    setIsProcessing(false);
  };

  const getPixel = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
    const idx = (y * width + x) * 4;
    return {
      r: data[idx],
      g: data[idx + 1],
      b: data[idx + 2],
    };
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !imageRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Calculate click coordinates mapped to canvas internal resolution
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      // Temporarily draw clean image to get true original color
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (tempCtx && imageRef.current) {
        tempCtx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
        const pixelData = tempCtx.getImageData(x, y, 1, 1).data;
        const color = { r: pixelData[0], g: pixelData[1], b: pixelData[2] };
        setTargetColor(color);
      }
    } catch (err) {
      console.error("Click sampling error:", err);
    }
  };

  const resetTargetColor = () => {
    setTargetColor(null);
  };

  return (
    <div id="image-processor" className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-emerald-500" />
          Background Cleanup Look
        </label>
        <button
          type="button"
          onClick={() => setUseBackgroundRemoval(!useBackgroundRemoval)}
          className={`px-3 py-1 text-xs font-semibold rounded-full transition ${
            useBackgroundRemoval
              ? "bg-emerald-100 text-emerald-800"
              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          }`}
        >
          {useBackgroundRemoval ? "Clean Cutout (Active)" : "Original Photo"}
        </button>
      </div>

      {/* Preview box */}
      <div className="relative rounded-2xl overflow-hidden aspect-square flex items-center justify-center bg-radial from-slate-100 to-slate-200 border border-gray-100">
        {/* Soft lavender/gray flat-lay background representation */}
        <div className="absolute inset-0 bg-[#F0F2F9] opacity-90 pattern-grid pointer-events-none"></div>

        {/* The active canvas */}
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="relative max-w-full max-h-full object-contain cursor-crosshair z-10 drop-shadow-xl"
          style={{ display: "block" }}
        />

        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-20">
            <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
          </div>
        )}
      </div>

      {useBackgroundRemoval && (
        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1.5 font-medium text-gray-700">
              <Sliders className="w-3.5 h-3.5" />
              Adjust Cutout Sensitivity
            </span>
            <span className="font-mono text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              {sensitivity}%
            </span>
          </div>
          
          <input
            type="range"
            min="10"
            max="120"
            value={sensitivity}
            onChange={(e) => setSensitivity(parseInt(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
          />

          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-gray-400">
              💡 {targetColor ? "Custom keyed color." : "Auto-sampled corners. Tap anywhere on photo to remove that color."}
            </p>
            {targetColor && (
              <button
                type="button"
                onClick={resetTargetColor}
                className="text-[11px] font-semibold text-emerald-600 hover:underline flex items-center gap-0.5"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading tags status */}
      {isLoadingTags && (
        <div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-xl border border-amber-100 animate-pulse flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Analyzing wardrobe image with Gemini and auto-tagging item...
        </div>
      )}

      {tagsError && (
        <div className="bg-rose-50 text-rose-800 text-xs p-3 rounded-xl border border-rose-100">
          ⚠️ Could not auto-tag: {tagsError}. Feel free to tag manually below!
        </div>
      )}
    </div>
  );
}
