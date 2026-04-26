/**
 * NetFlow — Quiet spell corrector for the search prompt field.
 *
 * Design goals:
 *   • Completely silent — no toast, no red underline, no Grammarly icon
 *   • Corrects only unambiguous single-edit-distance typos (e.g. "dalls" → "dallas")
 *   • Never changes proper nouns, ZIP codes, dollar amounts, or numbers
 *   • Zero external dependencies — runs entirely in the browser
 *   • Fast enough to run on every keystroke after a 600ms debounce
 */

// ── Real-estate + US geography vocabulary ──────────────────────
const VOCAB = new Set([
  // Investment strategies
  "ltr","str","brrrr","flip","rental","rehab","wholesale","multifamily",
  // Property types
  "sfh","condo","townhouse","duplex","triplex","fourplex","apartment",
  "single","family","multi","house","home","homes","property","properties",
  // Search qualifiers
  "bed","beds","bedroom","bedrooms","bath","baths","bathroom","bathrooms",
  "under","below","above","near","in","at","around","about","for","with",
  "sqft","acres","lot","garage","pool","basement","investment","deal",
  "long","term","short","vacation","airbnb","vrbo","fix","and","the","a",
  // US states (full + abbrev)
  "texas","california","florida","new","york","washington","colorado",
  "arizona","georgia","carolina","tennessee","nevada","oregon","illinois",
  "ohio","pennsylvania","virginia","massachusetts","michigan","minnesota",
  "missouri","wisconsin","indiana","kentucky","louisiana","mississippi",
  "arkansas","oklahoma","kansas","nebraska","dakota","wyoming","montana",
  "idaho","mexico","utah","hawaii","alaska","rhode","island","connecticut",
  "hampshire","vermont","maine","delaware","maryland","jersey",
  "tx","ca","fl","ny","wa","co","az","ga","nc","sc","tn","nv","or",
  "il","oh","pa","va","ma","mi","mn","mo","wi","in","ky","la","ms",
  "ar","ok","ks","ne","nd","sd","wy","mt","id","nm","ut","hi","ak",
  "ri","ct","nh","vt","me","de","md","wv","dc","al",
  // Major US cities (lowercase, no spaces)
  "mckinney","frisco","plano","allen","prosper","celina","dallas","houston",
  "antonio","austin","worth","paso","arlington","christi","lubbock","laredo",
  "garland","irving","amarillo","brownsville","pasadena","mesquite","killeen",
  "angeles","chicago","phoenix","philadelphia","diego","jose","jacksonville",
  "columbus","charlotte","indianapolis","francisco","seattle","denver",
  "nashville","boston","portland","vegas","memphis","louisville","baltimore",
  "miami","atlanta","tampa","orlando","raleigh","richmond","minneapolis",
  "kansas","omaha","cleveland","pittsburgh","cincinnati","louis","orleans",
  "lake","albuquerque","tucson","bakersfield","fresno","sacramento","beach",
  "mesa","springs","wichita","spokane","boise","springs","colorado",
]);

/** Generate all strings at edit-distance 1 from word (inserts/deletes/replaces/transposes). */
function edits1(word: string): string[] {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  const res: string[] = [];
  for (let i = 0; i <= word.length; i++) {
    const l = word.slice(0, i), r = word.slice(i);
    if (r)             res.push(l + r.slice(1));                         // delete
    if (r.length > 1)  res.push(l + r[1] + r[0] + r.slice(2));          // transpose
    for (const c of alpha) {
      if (r)           res.push(l + c + r.slice(1));                     // replace
                       res.push(l + c + r);                              // insert
    }
  }
  return res;
}

/** Correct a single word. Returns original if no correction found. */
function correctWord(word: string): string {
  const w = word.toLowerCase();
  // Skip: already correct, too short, numbers, ZIP, dollar amounts, state abbreviations used alone
  if (w.length <= 2)         return word;
  if (VOCAB.has(w))          return word;
  if (/^\d+[k]?$/.test(w))   return word;   // 450000, 400k
  if (/^\$/.test(w))          return word;   // $400k
  if (/^\d{5}$/.test(w))     return word;   // ZIP

  const candidates = edits1(w).filter(c => VOCAB.has(c));
  // Only apply if exactly ONE candidate exists (unambiguous correction)
  if (candidates.length !== 1) return word;

  // Preserve capitalisation of first letter
  const corrected = candidates[0];
  return word[0] >= "A" && word[0] <= "Z"
    ? corrected[0].toUpperCase() + corrected.slice(1)
    : corrected;
}

/**
 * Silently correct an entire search prompt string.
 * Preserves all whitespace, punctuation, and token order.
 * Only corrects tokens with exactly one unambiguous correction.
 */
export function silentCorrect(text: string): string {
  // Split on whitespace boundaries, preserving the whitespace tokens themselves
  return text.split(/(\s+)/).map(token =>
    /\s/.test(token) ? token : correctWord(token)
  ).join("");
}

/**
 * Returns true if the corrected text differs from the original.
 * Used by the prompt field to apply corrections silently on blur.
 */
export function needsCorrection(text: string): boolean {
  return silentCorrect(text) !== text;
}
