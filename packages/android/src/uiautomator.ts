/**
 * Dependency-free parser for UIAutomator XML dumps (SPEC-009 W6/W7).
 *
 * Produces the semantic element shape consumed by the Inspector observation
 * model. Unlike the previous leaf-only regex, this walks the FULL nested
 * hierarchy: meaningful clickable/scrollable containers frequently carry no
 * resource-id, so every node is preserved with its attributes plus a stable
 * structural path ("0/2/1" child-ordinal chain) usable as a selector of last
 * resort.
 */

export interface AndroidUiElement {
  tag: string;
  role: string;
  /** content-desc, else text, else short resource-id. */
  name?: string;
  /** Short resource-id (after ":id/"), when present. */
  id?: string;
  /** Full resource-id, when present. */
  resourceId?: string;
  /** content-desc attribute, when present. */
  desc?: string;
  /** Structural child-ordinal path from the root, e.g. "0/2/1". */
  path: string;
  /** Short class name (last segment after "."). */
  className: string;
  clickable: boolean;
  scrollable: boolean;
  longClickable?: boolean;
  checked?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  value?: string;
  text?: string;
  /** Center point derived from bounds - used for ADB taps at action time. */
  center: { x: number; y: number };
}

interface RawAttrs {
  [key: string]: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function parseBounds(raw: string | undefined): { x1: number; y1: number; x2: number; y2: number } | null {
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(raw ?? "");
  if (!m) return null;
  return { x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) };
}

function shortClass(cls: string): string {
  const idx = cls.lastIndexOf(".");
  return idx >= 0 ? cls.slice(idx + 1) : cls;
}

function roleOf(cls: string): string {
  if (cls.endsWith("Button") || cls.endsWith("ImageButton")) return "button";
  if (cls.endsWith("EditText")) return "input";
  if (cls.endsWith("CheckBox") || cls.endsWith("RadioButton") || cls.endsWith("Switch") || cls.endsWith("ToggleButton")) return "toggle";
  if (cls.endsWith("ListView") || cls.endsWith("RecyclerView") || cls.endsWith("ScrollView") || cls.endsWith("GridView")) return "list";
  return "container";
}

/**
 * Deterministic single-pass tokenizer over the machine-generated dump.
 * Handles both self-closing <node .../> and paired <node ...>...</node>,
 * maintaining a stack so every element's structural path is exact.
 */
export function parseUiautomatorDump(xml: string): AndroidUiElement[] {
  const out: AndroidUiElement[] = [];
  // Stack of child counters: counters[i] = how many children node at depth i
  // has consumed so far.
  const counters: number[] = [];
  const pathStack: string[] = [];

  const tokenRe = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml)) !== null) {
    if (m[0] === "</node>") {
      counters.pop();
      pathStack.pop();
      continue;
    }
    const attrText = m[1] ?? "";
    const selfClosing = m[2] === "/";

    const attrs: RawAttrs = {};
    const attrRe = /([a-zA-Z-]+)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(attrText)) !== null) {
      attrs[a[1] ?? ""] = a[2] ?? "";
    }

    const depthIdx = counters.length;
    const ordinal = depthIdx > 0 ? counters[depthIdx - 1] ?? 0 : 0;
    if (!selfClosing) counters.push(0);
    if (depthIdx > 0 && counters[depthIdx - 1] !== undefined) {
      counters[depthIdx - 1] = (counters[depthIdx - 1] ?? 0) + 1;
    }

    const path = [...pathStack, String(ordinal)].join("/");
    if (!selfClosing) pathStack.push(String(ordinal));

    const cls = attrs["class"] ?? "";
    const bounds = parseBounds(attrs["bounds"]);
    if (!bounds) continue; // no geometry -> cannot ever be targeted

    const resId = decodeEntities(attrs["resource-id"] ?? "");
    const text = decodeEntities(attrs["text"] ?? "");
    const desc = decodeEntities(attrs["content-desc"] ?? "");
    const enabled = attrs["enabled"] !== "false";
    const y1 = bounds.y1;

    out.push({
      tag: shortClass(cls),
      role: roleOf(cls),
      name: desc || text || resId.split(":id/")[1] || "",
      id: resId.includes(":id/") ? (resId.split(":id/")[1] ?? "") : undefined,
      resourceId: resId || undefined,
      desc: desc || undefined,
      path,
      className: shortClass(cls),
      clickable: attrs["clickable"] === "true",
      scrollable: attrs["scrollable"] === "true",
      longClickable: attrs["long-clickable"] === "true" || undefined,
      checked: attrs["checkable"] === "true" ? attrs["checked"] === "true" : undefined,
      hidden: bounds.x2 <= bounds.x1 || bounds.y2 <= y1,
      disabled: !enabled,
      value: cls.endsWith("EditText") ? text : undefined,
      text: cls.endsWith("EditText") ? undefined : text,
      center: { x: Math.round((bounds.x1 + bounds.x2) / 2), y: Math.round((y1 + bounds.y2) / 2) },
    });
  }
  return out;
}

/**
 * Resolve a semantic selector against a fresh dump. Selector schemes
 * (priority order used by the explorer):
 *   "#<short-id>"                 -> resource-id match
 *   "@desc:<value>"               -> content-desc exact (+class filter)
 *   "~text:<value>|<classFilter>" -> text exact (+optional class filter)
 *   "%path=<p>"                   -> structural path (last resort)
 * Disambiguation for duplicates: nth occurrence encoded as "<sel>@n".
 */
export function resolveElement(
  elements: AndroidUiElement[],
  selector: string,
): AndroidUiElement | undefined {
  let nth = 0;
  let sel = selector;
  const nthMatch = /^(.*)@(\d+)$/.exec(sel);
  if (nthMatch) {
    sel = nthMatch[1] ?? "";
    nth = Number(nthMatch[2]);
  }

  let matches: AndroidUiElement[];
  if (sel.startsWith("#")) {
    const id = sel.slice(1);
    matches = elements.filter((e) => e.id === id);
  } else if (sel.startsWith("@desc:")) {
    const rest = sel.slice("@desc:".length);
    const [desc, cls] = rest.split("|");
    matches = elements.filter((e) => e.desc === desc && (!cls || e.className === cls));
  } else if (sel.startsWith("~text:")) {
    const rest = sel.slice("~text:".length);
    const [text, cls] = rest.split("|");
    matches = elements.filter((e) => e.text === text && (!cls || e.className === cls));
  } else if (sel.startsWith("%path=")) {
    const p = sel.slice("%path=".length);
    matches = elements.filter((e) => e.path === p);
  } else {
    return undefined;
  }

  const visible = matches.filter((e) => !e.hidden && !e.disabled);
  // Hidden/disabled elements are NEVER resolvable: falling back to them would
  // turn a stale screen into an invisible tap.
  return visible[nth];
}
