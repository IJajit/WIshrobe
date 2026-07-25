import React, { useEffect, useState, useRef } from "react";
import { Wand2, RefreshCw, AlertCircle, RotateCw, Eraser, Paintbrush, Undo2, ZoomIn, ZoomOut, Maximize2, Crop, X, Check } from "lucide-react";
import { removeBackground } from "@imgly/background-removal";

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
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [useBackgroundRemoval, setUseBackgroundRemoval] = useState<boolean>(true);
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Cached Cutout vs Original references for instantaneous toggling & uncropped restore
  const cachedCutoutRef = useRef<string | null>(null);
  const uncroppedOriginalRef = useRef<string | null>(null);
  const isCutoutGeneratedRef = useRef<boolean>(false);

  // Rotation, Eraser Brush & Zoom states
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [isErasing, setIsErasing] = useState<boolean>(false);
  const [brushSize, setBrushSize] = useState<number>(20);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);

  // Crop modal states
  const [showCropModal, setShowCropModal] = useState<boolean>(false);
  const [cropTop, setCropTop] = useState<number>(0);
  const [cropBottom, setCropBottom] = useState<number>(0);
  const [cropLeft, setCropLeft] = useState<number>(0);
  const [cropRight, setCropRight] = useState<number>(0);

  // Undo history stack
  const [historyStack, setHistoryStack] = useState<string[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleResetCrop = () => {
    setCropTop(0);
    setCropBottom(0);
    setCropLeft(0);
    setCropRight(0);

    // Restore uncropped original image snapshot if applied previously
    const originalUncropped = uncroppedOriginalRef.current;
    if (originalUncropped) {
      saveStateToHistory();
      setCutoutUrl(originalUncropped);
      if (useBackgroundRemoval) {
        cachedCutoutRef.current = originalUncropped;
      }
      onProcessed(originalUncropped);
    }
    setShowCropModal(false);
  };

  const handleApplyCrop = () => {
    saveStateToHistory();
    const sourceImageSrc = uncroppedOriginalRef.current || cutoutUrl;
    if (!sourceImageSrc) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const width = img.width;
      const height = img.height;

      const startX = Math.round((cropLeft / 100) * width);
      const startY = Math.round((cropTop / 100) * height);
      const cropW = Math.max(10, width - startX - Math.round((cropRight / 100) * width));
      const cropH = Math.max(10, height - startY - Math.round((cropBottom / 100) * height));

      const croppedCanvas = document.createElement("canvas");
      croppedCanvas.width = cropW;
      croppedCanvas.height = cropH;

      const ctx = croppedCanvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, startX, startY, cropW, cropH, 0, 0, cropW, cropH);
        const croppedBase64 = croppedCanvas.toDataURL("image/png");
        setCutoutUrl(croppedBase64);
        if (useBackgroundRemoval) {
          cachedCutoutRef.current = croppedBase64;
        }
        onProcessed(croppedBase64);
      }
      setShowCropModal(false);
    };
    img.src = sourceImageSrc;
  };

  // Run neural AI background removal ONCE upon initial photo load, then cache result
  useEffect(() => {
    if (!imageSrc) return;

    let isSubscribed = true;

    async function performCutout() {
      setIsProcessing(true);
      setErrorMsg(null);

      try {
        // Run neural AI background removal directly on the client
        const blob = await removeBackground(imageSrc, {
          progress: (key, current, total) => {},
        });

        if (!isSubscribed) return;

        // Convert blob output to Image & clean up secondary background objects
        const img = new Image();
        const blobUrl = URL.createObjectURL(blob);
        img.crossOrigin = "anonymous";
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);

          // Downsample to max 800px before CPU-heavy pixel ops & PNG encoding
          const MAX_DIM = 800;
          const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);

          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            const width = canvas.width;
            const height = canvas.height;
            const totalPixels = width * height;
            const visited = new Uint8Array(totalPixels);

            // Find all connected components of visible pixels (alpha > 30)
            let largestComponent: number[] = [];
            
            for (let i = 0; i < totalPixels; i++) {
              if (visited[i] || data[i * 4 + 3] <= 30) continue;

              const currentComponent: number[] = [];
              const queue: number[] = [i];
              visited[i] = 1;

              let qHead = 0;
              while (qHead < queue.length) {
                const currIdx = queue[qHead++];
                currentComponent.push(currIdx);

                const cx = currIdx % width;
                const cy = Math.floor(currIdx / width);

                const neighbors = [
                  cx > 0 ? currIdx - 1 : -1,
                  cx < width - 1 ? currIdx + 1 : -1,
                  cy > 0 ? currIdx - width : -1,
                  cy < height - 1 ? currIdx + width : -1,
                ];

                for (const nIdx of neighbors) {
                  if (nIdx !== -1 && !visited[nIdx] && data[nIdx * 4 + 3] > 30) {
                    visited[nIdx] = 1;
                    queue.push(nIdx);
                  }
                }
              }

              if (currentComponent.length > largestComponent.length) {
                largestComponent = currentComponent;
              }
            }

            // Erase any small disconnected components (like slippers, feet, extraneous items)
            if (largestComponent.length > 0) {
              const keepSet = new Uint8Array(totalPixels);
              for (const idx of largestComponent) {
                keepSet[idx] = 1;
              }
              for (let i = 0; i < totalPixels; i++) {
                if (!keepSet[i]) {
                  data[i * 4 + 3] = 0; // Transparent
                }
              }
              ctx.putImageData(imageData, 0, 0);
            }

            // Calculate tight bounding box of visible pixels (alpha > 30) to crop excess transparent margin
            let minX = width, minY = height, maxX = 0, maxY = 0;
            let hasVisible = false;

            const finalData = ctx.getImageData(0, 0, width, height).data;
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                const alpha = finalData[(y * width + x) * 4 + 3];
                if (alpha > 30) {
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                  if (y < minY) minY = y;
                  if (y > maxY) maxY = y;
                  hasVisible = true;
                }
              }
            }

            let cleanBase64 = canvas.toDataURL("image/png");

            // If visible clothing pixels found, crop canvas tightly around bounding box with small 4% margin
            if (hasVisible && maxX > minX && maxY > minY) {
              const cropW = maxX - minX + 1;
              const cropH = maxY - minY + 1;
              const croppedCanvas = document.createElement("canvas");
              const pad = Math.max(10, Math.round(Math.max(cropW, cropH) * 0.04));
              croppedCanvas.width = cropW + pad * 2;
              croppedCanvas.height = cropH + pad * 2;

              const croppedCtx = croppedCanvas.getContext("2d");
              if (croppedCtx) {
                croppedCtx.drawImage(
                  canvas,
                  minX, minY, cropW, cropH,
                  pad, pad, cropW, cropH
                );
                cleanBase64 = croppedCanvas.toDataURL("image/png");
              }
            }

            if (!isSubscribed) return;
            cachedCutoutRef.current = cleanBase64;
            uncroppedOriginalRef.current = cleanBase64;
            isCutoutGeneratedRef.current = true;
            setCutoutUrl(cleanBase64);
            setHistoryStack([cleanBase64]);
            onProcessed(cleanBase64);
            setIsProcessing(false);
          } catch (cleanErr) {
            console.warn("Component filtering fallback:", cleanErr);
            const rawBase64 = canvas.toDataURL("image/png");
            if (!isSubscribed) return;
            cachedCutoutRef.current = rawBase64;
            isCutoutGeneratedRef.current = true;
            setCutoutUrl(rawBase64);
            setHistoryStack([rawBase64]);
            onProcessed(rawBase64);
            setIsProcessing(false);
          }
        };
        img.src = blobUrl;
      } catch (err: any) {
        console.error("AI Neural background removal failed:", err);
        if (!isSubscribed) return;
        setErrorMsg("Automatic AI cutout encountered an issue. Displaying original photo.");
        cachedCutoutRef.current = imageSrc;
        setCutoutUrl(imageSrc);
        setHistoryStack([imageSrc]);
        onProcessed(imageSrc);
        setIsProcessing(false);
      }
    }

    performCutout();

    return () => {
      isSubscribed = false;
    };
  }, [imageSrc]);

  // Handle Instant Toggle between Cutout and Original without re-running AI background removal
  const handleToggleBackgroundRemoval = () => {
    const nextState = !useBackgroundRemoval;
    setUseBackgroundRemoval(nextState);

    if (nextState) {
      // Toggle back to cutout (instant from cache or history)
      const cutoutVersion = cachedCutoutRef.current || imageSrc;
      setCutoutUrl(cutoutVersion);
      onProcessed(cutoutVersion);
    } else {
      // Toggle to original image
      setCutoutUrl(imageSrc);
      onProcessed(imageSrc);
    }
  };

  // Helper function to draw cutoutUrl onto canvas
  const drawCutoutToCanvas = (src: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    // Only set crossOrigin if src is an HTTP/HTTPS remote URL
    if (src.startsWith("http://") || src.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      if (img.width > 0 && img.height > 0) {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      }
    };
    img.src = src;
  };

  // Load cutoutUrl onto local interactive editing canvas whenever cutoutUrl changes
  useEffect(() => {
    if (!cutoutUrl) return;
    drawCutoutToCanvas(cutoutUrl);
  }, [cutoutUrl]);

  // Push current canvas state onto history stack
  const saveStateToHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const currentBase64 = canvas.toDataURL("image/png");
    setHistoryStack((prev) => [...prev, currentBase64]);
  };

  // Undo last action
  const handleUndo = () => {
    if (historyStack.length <= 1) return;
    const newStack = [...historyStack];
    newStack.pop(); // remove current state
    const previousState = newStack[newStack.length - 1];
    setHistoryStack(newStack);
    setCutoutUrl(previousState);
    if (useBackgroundRemoval) {
      cachedCutoutRef.current = previousState;
    }
    onProcessed(previousState);
  };

  // Handle Rotation 90 Degrees Clockwise
  const handleRotate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx) return;

      tempCanvas.width = img.height;
      tempCanvas.height = img.width;

      tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
      tempCtx.rotate((90 * Math.PI) / 180);
      tempCtx.drawImage(img, -img.width / 2, -img.height / 2);

      const rotatedDataUrl = tempCanvas.toDataURL("image/png");
      setCutoutUrl(rotatedDataUrl);
      if (useBackgroundRemoval) {
        cachedCutoutRef.current = rotatedDataUrl;
      }
      setHistoryStack((prev) => [...prev, rotatedDataUrl]);
      onProcessed(rotatedDataUrl);
    };
    img.src = canvas.toDataURL("image/png");
  };

  // Pan dragging state when zoomed in
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<"eraser" | "brush" | "pan">("eraser");
  const startPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Toggle Eraser Mode - Redraw canvas when opening eraser mode
  const handleToggleEraser = () => {
    if (isErasing) {
      setIsErasing(false);
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
    } else {
      setIsErasing(true);
      if (cutoutUrl) {
        setTimeout(() => drawCutoutToCanvas(cutoutUrl), 50);
      }
    }
  };

  // Pan event handlers for dragging zoomed image on desktop or phone
  const handlePanStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isErasing || zoomLevel <= 1) return;
    const isTouch = "touches" in e;
    // Allow panning if Pan tool is active, or if touch with 2 fingers, or middle click
    if (activeTool === "pan" || ("button" in e && e.button === 1) || (isTouch && e.touches.length > 1)) {
      setIsPanning(true);
      const clientX = isTouch ? e.touches[0].clientX : e.clientX;
      const clientY = isTouch ? e.touches[0].clientY : e.clientY;
      startPanRef.current = { x: clientX - panOffset.x, y: clientY - panOffset.y };
    }
  };

  const handlePanMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isPanning || zoomLevel <= 1) return;
    const isTouch = "touches" in e;
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    setPanOffset({
      x: clientX - startPanRef.current.x,
      y: clientY - startPanRef.current.y,
    });
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

  // Canvas Eraser Drawing Handlers (Accurately scaled for Zoom & Pan)
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const startErasing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isErasing || activeTool === "pan") return;
    saveStateToHistory(); // Save 1 step snapshot BEFORE starting the brush stroke
    setIsDrawing(true);
    eraseAt(e);
  };

  const drawErase = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isErasing) return;
    eraseAt(e);
  };

  const stopErasing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    // Commit current canvas state to parent state
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updatedBase64 = canvas.toDataURL("image/png");
    setCutoutUrl(updatedBase64);
    if (useBackgroundRemoval) {
      cachedCutoutRef.current = updatedBase64;
    }
    onProcessed(updatedBase64);
  };

  const eraseAt = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCanvasCoords(e);
    ctx.save();
    if (activeTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, brushSize, 0, Math.PI * 2, false);
      ctx.fill();
    } else if (activeTool === "brush" && uncroppedOriginalRef.current) {
      // Brush mode: Restore pixels from original image within circular radius
      const origImg = new Image();
      origImg.src = uncroppedOriginalRef.current;
      if (origImg.complete) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, brushSize, 0, Math.PI * 2, false);
        ctx.clip();
        ctx.drawImage(origImg, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }
    ctx.restore();
  };

  const [enableStudioFilter, setEnableStudioFilter] = useState<boolean>(true);

  return (
    <div id="image-processor" className="space-y-4 font-sans">
      {/* Neural AI Cutout Preview Box - Perfectly centered normal view */}
      <div
        ref={containerRef}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onTouchStart={handlePanStart}
        onTouchMove={handlePanMove}
        onTouchEnd={handlePanEnd}
        className="relative rounded-2xl overflow-hidden aspect-square flex items-center justify-center bg-[#F8F9FA] border border-gray-200 shadow-inner select-none touch-none"
      >
        {/* Soft professional studio mannequin backdrop */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#F9FAFB] to-[#EEF2F6] pointer-events-none"></div>

        {/* Canvas container: Scale zoom strictly when editing, centered normal view otherwise */}
        <div
          className="w-full h-full flex items-center justify-center p-3 transition-transform duration-150 ease-out"
          style={{
            transform: isErasing
              ? `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`
              : "none",
          }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={(e) => {
              if (activeTool === "pan") handlePanStart(e);
              else startErasing(e);
            }}
            onMouseMove={(e) => {
              if (isPanning) handlePanMove(e);
              else drawErase(e);
            }}
            onMouseUp={(e) => {
              if (isPanning) handlePanEnd();
              else stopErasing();
            }}
            onMouseLeave={(e) => {
              if (isPanning) handlePanEnd();
              else stopErasing();
            }}
            onTouchStart={(e) => {
              if (activeTool === "pan" || e.touches.length > 1) handlePanStart(e);
              else startErasing(e);
            }}
            onTouchMove={(e) => {
              if (isPanning) handlePanMove(e);
              else drawErase(e);
            }}
            onTouchEnd={() => {
              if (isPanning) handlePanEnd();
              else stopErasing();
            }}
            className={`max-w-full max-h-full object-contain z-10 transition-all duration-300 ${
              isErasing && activeTool === "pan"
                ? isPanning ? "cursor-grabbing" : "cursor-grab"
                : isErasing
                ? "cursor-crosshair"
                : ""
            } ${
              enableStudioFilter
                ? "contrast-[1.08] saturate-[1.06] brightness-[1.02] drop-shadow-[0_12px_24px_rgba(0,0,0,0.14)]"
                : "drop-shadow-md"
            }`}
          />
        </div>

        {isErasing && (
          <div className="absolute top-3 left-3 bg-black/80 text-white text-[10px] font-medium px-3 py-1.5 rounded-full z-20 shadow-md flex items-center gap-1.5 backdrop-blur-sm">
            <Eraser className="w-3.5 h-3.5 text-amber-400" />
            <span>Edit Mode ({zoomLevel}x Zoom)</span>
          </div>
        )}

        {isProcessing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 z-20 space-y-3 px-4 text-center">
            <RefreshCw className="w-9 h-9 text-emerald-500 animate-spin" />
            <div>
              <p className="text-xs font-medium text-gray-800">Removing Background...</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Neural AI is isolating your clothing item cleanly.</p>
            </div>
          </div>
        )}
      </div>

      {/* Expanded Edit Tools Panel when Edit Cutout mode is active */}
      {isErasing ? (
        <div className="bg-slate-50 border border-slate-200 p-3 rounded-2xl space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-gray-700 flex items-center gap-1 shrink-0">
              <Eraser className="w-3.5 h-3.5 text-gray-500" />
              Brush Size: {brushSize}px
            </span>
            <input
              type="range"
              min="5"
              max="60"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="flex-1 accent-emerald-600 cursor-pointer max-w-[160px]"
            />
          </div>

          <div className="space-y-2.5 pt-2 border-t border-slate-200">
            {/* Top row: Zoom (- / +) and Undo/Done */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-gray-500 mr-0.5">Zoom:</span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
                  disabled={zoomLevel <= 1}
                  className="p-1 bg-white text-gray-700 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-100 transition"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-bold text-gray-800 px-1.5">{zoomLevel}x</span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(3, +(z + 0.5).toFixed(1)))}
                  disabled={zoomLevel >= 3}
                  className="p-1 bg-white text-gray-700 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-100 transition"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={historyStack.length <= 1}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-xl border flex items-center gap-1 transition ${
                    historyStack.length > 1
                      ? "bg-white text-gray-700 border-slate-200 hover:bg-slate-100 shadow-xs"
                      : "bg-slate-100 text-gray-400 border-slate-200 cursor-not-allowed"
                  }`}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Undo</span>
                </button>
                <button
                  type="button"
                  onClick={handleToggleEraser}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] rounded-xl shadow-xs transition flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Done</span>
                </button>
              </div>
            </div>

            {/* Tool Selection Bar: Eraser, Brush (Restore), Pan & Reset */}
            <div className="flex items-center justify-between bg-white p-1.5 rounded-xl border border-slate-200 animate-in fade-in duration-150">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-[10px] font-medium text-gray-400 px-0.5">Tool:</span>
                <button
                  type="button"
                  onClick={() => setActiveTool("eraser")}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition shrink-0 ${
                    activeTool === "eraser"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                      : "bg-slate-50 text-gray-700 border-slate-200 hover:bg-slate-100"
                  }`}
                  title="Eraser Tool (Remove pixels)"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>Eraser</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool("brush")}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition shrink-0 ${
                    activeTool === "brush"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                      : "bg-slate-50 text-gray-700 border-slate-200 hover:bg-slate-100"
                  }`}
                  title="Brush Tool (Restore original pixels)"
                >
                  <Paintbrush className="w-3.5 h-3.5" />
                  <span>Brush</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool("pan")}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition shrink-0 ${
                    activeTool === "pan"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                      : "bg-slate-50 text-gray-700 border-slate-200 hover:bg-slate-100"
                  }`}
                  title="Pan Tool (Move Zoomed Image)"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Pan</span>
                </button>
              </div>

              {zoomLevel > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setZoomLevel(1);
                    setPanOffset({ x: 0, y: 0 });
                    setActiveTool("eraser");
                  }}
                  className="text-[10px] font-medium text-gray-600 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg border border-slate-200 transition shrink-0 ml-1"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Normal Grid of feature action buttons - Uniform appearance with green text when active */
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleToggleBackgroundRemoval}
            className={`py-2.5 px-2.5 text-[11px] font-medium rounded-xl border transition flex items-center justify-center gap-1.5 bg-slate-100 border-slate-200 hover:bg-slate-200 ${
              useBackgroundRemoval ? "text-emerald-600 font-semibold" : "text-gray-700"
            }`}
          >
            <Wand2 className={`w-3.5 h-3.5 shrink-0 ${useBackgroundRemoval ? "text-emerald-600" : "text-gray-500"}`} />
            <span>Transparent Cut Out</span>
          </button>

          <button
            type="button"
            onClick={() => setEnableStudioFilter(!enableStudioFilter)}
            className={`py-2.5 px-2.5 text-[11px] font-medium rounded-xl border transition flex items-center justify-center gap-1.5 bg-slate-100 border-slate-200 hover:bg-slate-200 ${
              enableStudioFilter ? "text-emerald-600 font-semibold" : "text-gray-700"
            }`}
          >
            <Wand2 className={`w-3.5 h-3.5 shrink-0 ${enableStudioFilter ? "text-emerald-600" : "text-gray-500"}`} />
            <span>Studio Lighting</span>
          </button>

          <button
            type="button"
            onClick={handleRotate}
            className="py-2.5 px-2.5 text-[11px] font-medium text-gray-700 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 transition flex items-center justify-center gap-1.5"
          >
            <RotateCw className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <span>Rotate</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCropModal(true)}
            className="py-2.5 px-2.5 text-[11px] font-medium text-gray-700 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 transition flex items-center justify-center gap-1.5"
          >
            <Crop className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <span>Crop Image</span>
          </button>

          <button
            type="button"
            onClick={handleToggleEraser}
            className="col-span-2 py-2.5 px-2.5 text-[11px] font-medium text-gray-700 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 transition flex items-center justify-center gap-1.5"
          >
            <Eraser className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <span>Edit Cutout</span>
          </button>
        </div>
      )}

      {/* Visual Live On-Image Crop Overlay Container */}
      {showCropModal && cutoutUrl && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm flex flex-col items-center space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            
            <div className="w-full flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                <Crop className="w-4 h-4 text-emerald-600" />
                Visual Image Crop
              </h3>
              <button
                type="button"
                onClick={() => setShowCropModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-gray-500 text-center">
              Drag the crop handles on the image to trim your photo visually.
            </p>

            {/* Interactive Image Frame with Crop Overlay */}
            <div className="relative w-64 h-64 bg-slate-100 rounded-2xl overflow-hidden flex items-center justify-center border border-slate-200 select-none shadow-inner">
              <img
                src={uncroppedOriginalRef.current || cutoutUrl}
                alt="Crop preview"
                className="w-full h-full object-contain pointer-events-none"
              />

              {/* Shaded dark mask outside crop box */}
              <div
                className="absolute inset-0 bg-black/50 pointer-events-none transition-all duration-75"
                style={{
                  clipPath: `polygon(
                    0% 0%, 100% 0%, 100% 100%, 0% 100%,
                    0% ${cropTop}%, ${cropLeft}% ${cropTop}%, ${cropLeft}% ${100 - cropBottom}%,
                    ${100 - cropRight}% ${100 - cropBottom}%, ${100 - cropRight}% ${cropTop}%, 0% ${cropTop}%
                  )`
                }}
              />

              {/* Active Visual Crop Box Border */}
              <div
                className="absolute border-2 border-dashed border-white shadow-lg pointer-events-none"
                style={{
                  top: `${cropTop}%`,
                  bottom: `${cropBottom}%`,
                  left: `${cropLeft}%`,
                  right: `${cropRight}%`,
                }}
              >
                <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-black rounded-full"></div>
                <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-black rounded-full"></div>
                <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-black rounded-full"></div>
                <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-black rounded-full"></div>
              </div>
            </div>

            {/* Fine-Tuning Margin Drag Controls */}
            <div className="w-full space-y-2 text-[10px]">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 p-2 rounded-xl border border-slate-200">
                  <div className="flex justify-between font-semibold text-gray-700 mb-1">
                    <span>Top Trim</span>
                    <span>{cropTop}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={cropTop}
                    onChange={(e) => setCropTop(Number(e.target.value))}
                    className="w-full accent-black h-1 bg-slate-200 rounded cursor-pointer"
                  />
                </div>

                <div className="bg-slate-50 p-2 rounded-xl border border-slate-200">
                  <div className="flex justify-between font-semibold text-gray-700 mb-1">
                    <span>Bottom Trim</span>
                    <span>{cropBottom}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={cropBottom}
                    onChange={(e) => setCropBottom(Number(e.target.value))}
                    className="w-full accent-black h-1 bg-slate-200 rounded cursor-pointer"
                  />
                </div>

                <div className="bg-slate-50 p-2 rounded-xl border border-slate-200">
                  <div className="flex justify-between font-semibold text-gray-700 mb-1">
                    <span>Left Trim</span>
                    <span>{cropLeft}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={cropLeft}
                    onChange={(e) => setCropLeft(Number(e.target.value))}
                    className="w-full accent-black h-1 bg-slate-200 rounded cursor-pointer"
                  />
                </div>

                <div className="bg-slate-50 p-2 rounded-xl border border-slate-200">
                  <div className="flex justify-between font-semibold text-gray-700 mb-1">
                    <span>Right Trim</span>
                    <span>{cropRight}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={cropRight}
                    onChange={(e) => setCropRight(Number(e.target.value))}
                    className="w-full accent-black h-1 bg-slate-200 rounded cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="w-full flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleResetCrop}
                className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-gray-700 font-semibold rounded-xl text-xs flex-1 transition"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleApplyCrop}
                className="py-2.5 px-4 bg-black text-white hover:bg-zinc-800 font-semibold rounded-xl text-xs flex-1 shadow-md transition"
              >
                Apply Crop
              </button>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-xl border border-amber-100 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Loading tags status */}
      {isLoadingTags && (
        <div className="bg-emerald-50 text-emerald-800 text-xs p-3 rounded-xl border border-emerald-100 animate-pulse flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
          Auto-detecting category & details with Gemini...
        </div>
      )}

      {tagsError && (
        <div className="bg-rose-50 text-rose-800 text-xs p-3 rounded-xl border border-rose-100">
          ⚠️ {tagsError}
        </div>
      )}
    </div>
  );
}


