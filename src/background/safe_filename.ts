// Names from mail are untrusted. The result is one path segment that no platform reads as a path, a device or a hidden file.

const MAX_LENGTH = 100;
// Bidirectional controls and zero-width marks can dress "gpj.exe" up as "exe.jpg" in a file list.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿/\\:*?"<>|]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** One safe path segment from `raw`. `fallback` stands in when nothing is left. */
export function safe_filename(raw: string, fallback: string): string {
    const cleaned = raw.replace(UNSAFE, "_").replace(/\s+/g, " ").trim().replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
    const capped = cap_length(cleaned);
    if (capped === "") return fallback;
    return RESERVED.test(capped) ? `_${capped}` : capped;
}

// A cut that keeps a short extension, so a long name still opens with the same program.
function cap_length(name: string): string {
    if (name.length <= MAX_LENGTH) return name;
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    return name.slice(0, MAX_LENGTH - extension.length).replace(/[.\s]+$/, "") + extension;
}
