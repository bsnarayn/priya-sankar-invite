/**
 * immich-upload.ts
 * Shared upload logic for PhotoUpload.astro and camera.astro.
 *
 * Usage (in a <script> tag):
 *   import { uploadToImmich, buildUploadForm } from "@lib/immich-upload";
 */

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

// immich-upload.ts — add this export

export async function compressImage(
    file: File,
    maxPx = 2400,
    quality = 0.82,
): Promise<File> {
    // Skip if already small or an unsupported type
    if (file.size < 500_000) return file;

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

            canvas.toBlob(
                (blob) => {
                    if (!blob) { resolve(file); return; } // fallback to original
                    resolve(
                        new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
                            type: "image/jpeg",
                            lastModified: file.lastModified,
                        }),
                    );
                },
                "image/jpeg",
                quality,
            );
        };

        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}