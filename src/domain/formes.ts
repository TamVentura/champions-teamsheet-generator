// Champions displays base species names, never alternate-forme suffixes. This regex strips those
// suffixes so both name-matching (extract.ts) and species inference (speciesInference.ts) restrict
// to base formes. Genuine hyphenated names (Kommo-o, Ho-Oh, Porygon-Z, Type: Null, Mr. Mime, …)
// lack these tokens and stay.
export const FORME_SUFFIX =
  /-(Mega|Mega-[XY]|Gmax|Alola|Galar|Hisui|Paldea|Therian|Origin|Primal|Zen|Totem|Crowned|Eternamax|Bloodmoon|Ash|Bond|Blade|Starter|Low-Key|Sunshine|Rainy|Snowy|Sunny|Noice|Hangry|Busted|Four|Complete|Neutral|Eternal|Antique|Masterpiece|Artisan|Roaming|Cornerstone|Hearthflame|Wellspring|Teal|Droopy|Stretchy|Pom-Pom|Sensu|Resolute|Pirouette|Original|School|Gorging|Gulping|Three-Segment|Dada|F|Female)(-(Tera|Gmax))?$/;

/** True when `name` is a base forme (no Mega/Gmax/regional/etc. suffix). */
export function isBaseForme(name: string): boolean {
  return !FORME_SUFFIX.test(name);
}
