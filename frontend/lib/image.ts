/**
 * On-device photo shrinking before upload (2G / low-bandwidth friendly, and keeps the free-tier
 * backend's memory flat). Phone photos are resized on a <canvas> to at most MAX_SIDE px and re-encoded
 * as JPEG. Images that are already small are sent untouched: re-encoding them gains nothing and would
 * strip metadata the server's forensics use (e.g. editing-software tags).
 */
export const MAX_SIDE = 1024;
export const JPEG_QUALITY = 0.82;
const SMALL_ENOUGH_BYTES = 1_500_000;

export interface ShrinkResult {
  file: File;
  originalBytes: number;
  finalBytes: number;
  width: number;
  height: number;
  resized: boolean;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" }); // honour camera EXIF rotation
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shrinkForUpload(file: File, maxSide = MAX_SIDE, quality = JPEG_QUALITY): Promise<ShrinkResult> {
  const keep = (w = 0, h = 0): ShrinkResult => ({ file, originalBytes: file.size, finalBytes: file.size, width: w, height: h, resized: false });
  if (!file.type.startsWith("image/") || typeof document === "undefined") return keep();
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await loadBitmap(file);
  } catch {
    return keep(); // undecodable in the browser: let the server judge it
  }
  const w = "naturalWidth" in src ? src.naturalWidth : src.width;
  const h = "naturalHeight" in src ? src.naturalHeight : src.height;
  if (Math.max(w, h) <= maxSide && file.size <= SMALL_ENOUGH_BYTES) {
    if ("close" in src) src.close();
    return keep(w, h);
  }
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return keep(w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, tw, th);
  if ("close" in src) src.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
  canvas.width = canvas.height = 0; // release the bitmap memory early on low-end phones
  if (!blob || blob.size >= file.size) return keep(w, h);
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { file: new File([blob], name, { type: "image/jpeg" }), originalBytes: file.size, finalBytes: blob.size, width: tw, height: th, resized: true };
}

export function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1000))} KB`;
}
