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

/**
 * Sends a photo through wedding-planner-api's server-side normalize step
 * (HEIC/HEIF decode + resize, see that repo's image-normalize.ts) via the
 * invite site's own Worker. Replaces an earlier client-side
 * browser-image-compression step, which relied on the browser being able to
 * decode the source format into a <canvas> -- true for JPEG/PNG everywhere,
 * but HEIC/HEIF (the default photo format on iPhone) only decodes in
 * Safari, so every other browser was silently uploading the untouched
 * original. Doing this server-side, after the bytes are already safely
 * received, is the only place guaranteed to work regardless of
 * device/browser/picker.
 */
export async function compressImage(file: File): Promise<File> {
    // Skip if already small -- not worth the round trip.
    if (file.size < 500_000) return file;

    try {
        const form = new FormData();
        form.append("file", file, file.name);
        const res = await fetch("/api/webhook/photo-normalize", {
            method: "POST",
            body: form,
        });
        if (!res.ok) return file; // fall back to the original on any server error

        const filename = decodeURIComponent(res.headers.get("X-Normalized-Filename") ?? file.name);
        const blob = await res.blob();
        return new File([blob], filename, { type: "image/jpeg", lastModified: file.lastModified });
    } catch {
        return file; // fall back to the original on any network failure
    }
}