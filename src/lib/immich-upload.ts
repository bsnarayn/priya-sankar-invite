/**
 * immich-upload.ts
 * Shared upload logic for PhotoUpload.astro and camera.astro.
 *
 * Usage (in a <script> tag):
 *   import { uploadToImmich, buildUploadForm } from "@lib/immich-upload";
 */

import piexif from "piexifjs";

export interface ImmichConfig {
    base: string;   // e.g. "https://photos.sankaranarayan.in"
    slug: string;   // share slug
    deviceId?: string; // defaults to "WEB"
    userId?: string;   // optional — prefixed to deviceAssetId for traceability
}

/**
 * Uploads a single File to an Immich shared album.
 * Returns true on success (HTTP 200 or 201), false otherwise.
 */
export async function uploadToImmich(
    file: File,
    config: ImmichConfig,
): Promise<boolean> {
    if (!config.base || !config.slug) return false;

    const compressed = await compressImage(file);

    const ts = Date.now();
    const now = new Date(file.lastModified || ts).toISOString();
    const endpoint = `${config.base}/api/assets?slug=${encodeURIComponent(config.slug)}`;
    const assetId = config.userId
        ? `${config.userId}-${ts}`
        : `${config.deviceId ?? "WEB"}-${file.name}-${ts}`;

    const form = new FormData();
    form.append("deviceAssetId", assetId);
    form.append("deviceId", config.deviceId ?? "WEB");
    form.append("fileCreatedAt", now);
    form.append("fileModifiedAt", now);
    form.append("isFavorite", "false");
    form.append("duration", "0:00:00.000000");
    form.append("assetData", file);

    try {
        const res = await fetch(endpoint, { method: "POST", body: form });
        // Immich returns 201 for new assets, 200 for duplicates — both are success
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Uploads multiple files sequentially.
 * Calls onProgress(uploaded, total) after each attempt.
 * Returns count of successfully uploaded files.
 */
export async function uploadFiles(
    files: File[],
    config: ImmichConfig,
    onProgress?: (uploaded: number, total: number) => void,
): Promise<number> {
    let uploaded = 0;
    for (const file of files) {
        const ok = await uploadToImmich(file, config);
        if (ok) uploaded++;
        onProgress?.(uploaded, files.length);
    }
    return uploaded;
}

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function dataUrlToFile(dataUrl: string, original: File): File {
    const base64 = dataUrl.split(",")[1] ?? "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], original.name.replace(/\.\w+$/, ".jpg"), {
        type: "image/jpeg",
        lastModified: original.lastModified,
    });
}

export async function compressImage(
    file: File,
    maxPx = 2400,
    quality = 0.82,
): Promise<File> {
    // Skip if already small or an unsupported type
    if (file.size < 500_000) return file;

    // Canvas re-encoding strips all metadata, so read the original's EXIF
    // (only JPEGs carry it in a form piexif can read) before resizing, and
    // re-insert it into the compressed output below.
    let exifBytes: string | null = null;
    if (/^image\/jpe?g$/i.test(file.type)) {
        try {
            const originalDataUrl = await fileToDataUrl(file);
            exifBytes = piexif.dump(piexif.load(originalDataUrl));
        } catch {
            exifBytes = null; // no EXIF present, or unreadable
        }
    }

    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            const { naturalWidth: w, naturalHeight: h } = img;
            const scale = Math.min(1, maxPx / Math.max(w, h));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);

            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            let dataUrl = canvas.toDataURL("image/jpeg", quality);

            if (exifBytes) {
                try {
                    dataUrl = piexif.insert(exifBytes, dataUrl);
                } catch {
                    // fall back to the compressed image without EXIF
                }
            }

            resolve(dataUrlToFile(dataUrl, file));
        };

        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}