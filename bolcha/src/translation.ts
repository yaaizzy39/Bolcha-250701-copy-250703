// Utility to call custom GAS translation API endpoints in a round-robin fashion
// GAS endpoint list is provided via `VITE_GAS_ENDPOINTS` (comma-separated URLs)
// Additionally, admin can manage endpoints via Firestore doc `admin/config` field `gasEndpoints`.


const initialEndpoints = (import.meta.env.VITE_GAS_ENDPOINTS as string | undefined)
  ?.split(/[, ]+/)
  .filter(Boolean) || [];

const endpoints: string[] = [...initialEndpoints];

import { db, auth } from "./firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

let primary = 0;           // index of the preferred endpoint
let failStreak = 0;        // consecutive failures of the current primary
const FAIL_THRESHOLD = 2;  // switch primary after this many consecutive failures

// simple promise queue to ensure only one request at a time
let chain: Promise<any> = Promise.resolve();

// ---------- Simple client-side cache (sessionStorage + in-memory) ----------
const CACHE_KEY = 'tranCache';
const _initCache: Record<string, string> = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
})();
const cache = new Map<string, string>(Object.entries(_initCache));
function saveCache() {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    /* ignore quota errors */
  }
}

// Runtime load of endpoints from Firestore (admin-configurable)
if (!(globalThis as any).__TRAN_CFG_LISTENER__) {
  (globalThis as any).__TRAN_CFG_LISTENER__ = true;
  try {

  onAuthStateChanged(auth, (user) => {
    if (!user) return; // wait until sign-in
    const cfgRef = doc(db, "admin", "config");
    onSnapshot(
      cfgRef,
      (snap) => {
      const data = snap.data();
      if (data && Array.isArray(data.gasEndpoints)) {
        if (data.gasEndpoints.length) {
          endpoints.splice(0, endpoints.length, ...data.gasEndpoints.filter(Boolean));
          console.info("[translation] endpoints updated from Firestore", endpoints);
        } else {
          endpoints.splice(0, endpoints.length, ...initialEndpoints);
          console.info("[translation] endpoints reset to .env list", endpoints);
        }
        primary = 0;
        failStreak = 0;
      }
      },
      (err) => {
        if (err.code === 'permission-denied') {
          console.debug('[translation] admin/config listener blocked: permission-denied');
        } else {
          console.error('[translation] admin/config listener error', err);
        }
      }
    );
  });
} catch {
  /* ignore if Firebase not ready */
}
}


// Try translating via one endpoint: POST first, then GET fallback
async function attemptTranslate(
  url: string,
  text: string,
  targetLang: string
): Promise<string | null> {
  try {
    const postRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, target: targetLang }),
    });
    if (postRes.ok) {
      const maybeJson = await safeParse(postRes);
      return handleResult(maybeJson, text);
    }
    console.warn(`[translation debug] POST request to ${url} failed with status: ${postRes.status}`);
  } catch (e) {
    console.error(`[translation debug] Error during POST request to ${url}:`, e);
  }

  try {
    const params = new URLSearchParams({ text, target: targetLang });
    const getRes = await fetch(`${url}?${params.toString()}`);
    if (getRes.ok) {
      const maybeJson = await safeParse(getRes);
      return handleResult(maybeJson, text);
    }
    console.warn(`[translation debug] GET request to ${url} failed with status: ${getRes.status}`);
  } catch (e) {
    console.error(`[translation debug] Error during GET request to ${url}:`, e);
  }
  return null;
}

async function doTranslate(text: string, targetLang: string): Promise<string | null> {
  if (!endpoints.length) {
    console.warn("No GAS endpoints configured");
    return null;
  }
  // Iterate over endpoints, starting with the current primary, until one succeeds
  for (let i = 0; i < endpoints.length; i++) {
    const idx = (primary + i) % endpoints.length;
    const url = endpoints[idx];

    const maybe = await attemptTranslate(url, text, targetLang);
    if (maybe !== null) {
      // Success → promote this index to be the primary
      primary = idx;
      failStreak = 0;
      return maybe;
    }
  }

  // All endpoints failed this round
  failStreak += 1;
  if (failStreak >= FAIL_THRESHOLD) {
    primary = (primary + 1) % endpoints.length; // shift to next endpoint
    failStreak = 0;
  }
  return null;
}

// New function to handle line breaks with placeholders
async function doTranslateWithLineBreaks(text: string, targetLang: string): Promise<string | null> {
  // If text has no line breaks, use original function
  if (!text.includes('\n')) {
    return await doTranslate(text, targetLang);
  }
  
  console.log('[Translation] Processing text with line breaks:', { 
    originalText: text, 
    lineBreakCount: (text.match(/\n/g) || []).length 
  });
  
  // Use multiple simple placeholders to increase survival chance
  const placeholders = [
    `[LB${Date.now()}]`,
    `|LB${Date.now()}|`,
    `<LB${Date.now()}>`,
    `{LB${Date.now()}}`,
    `--LB${Date.now()}--`
  ];
  
  const selectedPlaceholder = placeholders[Math.floor(Math.random() * placeholders.length)];
  
  // Replace all line breaks with placeholder
  const textWithPlaceholders = text.replace(/\n/g, selectedPlaceholder);
  
  console.log('[Translation] Text with placeholders:', textWithPlaceholders);
  
  // Translate the text with placeholders
  const translatedWithPlaceholders = await doTranslate(textWithPlaceholders, targetLang);
  
  if (translatedWithPlaceholders === null) {
    return null;
  }
  
  console.log('[Translation] Translated with placeholders:', translatedWithPlaceholders);
  
  // Restore line breaks from placeholders
  let finalTranslated = translatedWithPlaceholders.replace(new RegExp(escapeRegExp(selectedPlaceholder), 'g'), '\n');
  
  // Additional fallback: if placeholders were lost, try to preserve line structure
  if (!finalTranslated.includes('\n') && text.includes('\n')) {
    console.log('[Translation] Line break placeholders were lost, attempting to preserve structure');
    finalTranslated = preserveBlankLines(text, finalTranslated);
  }
  
  console.log('[Translation] Final translated text:', { 
    finalText: finalTranslated, 
    lineBreakCount: (finalTranslated.match(/\n/g) || []).length 
  });
  
  return finalTranslated;
}

// Helper function to escape regular expression special characters
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


export function translateText(text: string, targetLang: string): Promise<string | null> {
  const cacheKey = `${targetLang}:${text}`;
  if (cache.has(cacheKey)) {
    return Promise.resolve(cache.get(cacheKey)!);
  }
  const next = chain.then(async () => {
    const res = await doTranslateWithLineBreaks(text, targetLang);
    if (res !== null) {
      cache.set(cacheKey, res);
      saveCache();
    }
    // small delay between requests to avoid hitting quota hard
    await new Promise((r) => setTimeout(r, 300));
    return res;
  });
  // update chain but swallow result so the queue never rejects
  chain = next.then(
    () => {},
    () => {}
  );
  return next;
}


function handleResult(maybeJson: string | null, text: string): string | null {
  if (typeof maybeJson === "string") {
    return preserveBlankLines(text, maybeJson);
  }
  return maybeJson;
}

async function safeParse(res: Response): Promise<string | null> {
  try {
    const txt = await res.text();
    console.log("[translation debug] GAS Response Status:", res.status);
    console.log("[translation debug] GAS Response Body:", txt);
    if (!txt) return null;

    // Heuristic to detect if the response is HTML, which is unexpected.
    // It might be a fallback page from a proxy or a misconfigured endpoint.
    if (txt.trim().startsWith("<") && txt.includes("html")) {
      console.warn("[translation] Received an unexpected HTML response. Check VITE_GAS_ENDPOINTS.");
      return null; // Ignore HTML responses
    }

    let raw: string | null = null;
    try {
      // Prefer JSON parsing
      const obj = JSON.parse(txt);
      const maybeText = obj.translatedText || obj.text || obj.translation || null;
      if (typeof maybeText === "string") {
        raw = maybeText;
      } else {
        return maybeText;
      }
    } catch {
      // Fallback for non-JSON responses
      raw = txt;
    }

    if (raw) {
      // First, decode common HTML entities that might be in a plain text response
      const decoded = raw
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");

      // Normalize newlines and <br> tags, then strip any remaining HTML tags.
      const cleaned = decoded
        .replace(/\\n/g, "\n") // unescape \n
        .replace(/<br\s*\/?>/gi, "\n") // <br> to newline
        .replace(/<\/p>\s*<p>/gi, "\n\n") // paragraph breaks
        .replace(/<[^>]*>/g, "") // strip all other tags
        .replace(/\r\n/g, "\n") // normalize Windows line endings
        .replace(/\r/g, "\n") // normalize Mac line endings
        // Keep placeholders intact - don't trim them
        .replace(/\s*(\[LB\d+\]|\|LB\d+\||<LB\d+>|\{LB\d+\}|--LB\d+--)\s*/g, '$1') // preserve line break placeholders
        .trim();

      return cleaned;
    }
    return null;
  } catch (e) {
    console.error("[translation debug] Error in safeParse:", e);
    return null;
  }
}

// keep blank-line count same as source
function preserveBlankLines(src: string, dest: string): string {
  const s = src.split("\n");
  const d = dest.split("\n");
  const out: string[] = [];
  let j = 0;
  
  // If source and destination have similar line counts, preserve structure
  if (Math.abs(s.length - d.length) <= 1) {
    for (let i = 0; i < s.length; i++) {
      if (s[i].trim() === "") {
        out.push("");
        if (d[j]?.trim() === "") j++;
      } else {
        out.push(d[j] ?? "");
        j++;
      }
    }
    while (j < d.length) out.push(d[j++]);
  } else {
    // If line counts are very different, just preserve the translated structure
    // but ensure we maintain at least some line break structure
    for (let i = 0; i < s.length; i++) {
      if (s[i].trim() === "") {
        out.push("");
      } else if (j < d.length) {
        out.push(d[j]);
        j++;
      }
    }
    // Add any remaining translated lines
    while (j < d.length) out.push(d[j++]);
  }
  
  return out.join("\n");
}
