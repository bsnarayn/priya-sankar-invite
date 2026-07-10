/**
 * immich-upload.ts
 * Shared upload logic for PhotoUpload.astro and camera.astro.
 *
 * Usage (in a <script> tag):
 *   import { uploadToImmich, buildUploadForm } from "@lib/immich-upload";
 */

import imageCompression from "browser-image-compression";

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
    form.append("assetData", compressed);

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

export async function compressImage(
    file: File,
    maxPx = 4096,
    quality = 0.9,
): Promise<File> {
    // Skip if already small or an unsupported type
    if (file.size < 500_000) return file;

    try {
        // Runs in a Web Worker so it doesn't block the UI thread on large
        // camera photos, and preserves EXIF (orientation/GPS/timestamp) on
        // JPEGs via the preserveExif option.
        const compressed = await imageCompression(file, {
            maxWidthOrHeight: maxPx,
            initialQuality: quality,
            useWebWorker: true,
            preserveExif: true,
            fileType: "image/jpeg",
        });
        return new File(
            [compressed],
            file.name.replace(/\.\w+$/, ".jpg"),
            { type: "image/jpeg", lastModified: file.lastModified },
        );
    } catch {
        return file; // fall back to the original on any compression failure
    }
}