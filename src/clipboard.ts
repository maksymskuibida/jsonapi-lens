import { t } from "./i18n/index.js";
import { toast } from "./ui.js";

/**
 * Copy text, reporting what was copied.
 *
 * `navigator.clipboard` needs a secure context, which rules it out on plain
 * HTTP, so there is a `execCommand` fallback. Both paths report through the same
 * toast so a copy never silently does nothing.
 */
export async function copyText(text: string, what: string): Promise<boolean> {
  const ok = await write(text);
  if (ok) {
    const preview = text.length > 48 ? text.slice(0, 47) + "…" : text;
    toast(t().toast.copied(what, preview.replace(/\s+/g, " ")));
  } else {
    toast(t().toast.copyFailed(what), "error");
  }
  return ok;
}

/** Copy without a preview in the toast — for large blobs where a preview is noise. */
export async function copyBlob(text: string, what: string): Promise<boolean> {
  const ok = await write(text);
  toast(
    ok ? t().toast.copiedLarge(what, text.length) : t().toast.copyFailed(what),
    ok ? "info" : "error",
  );
  return ok;
}

async function write(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Trigger a download of `text` as a file. Stays entirely in the browser. */
export function downloadText(text: string, filename: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on the next tick so the download has taken the reference.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
