/**
 * Dependency-free parser for uiautomator XML dumps. Produces the semantic
 * element shape consumed by the Inspector observation model.
 */
export interface AndroidUiElement {
  tag: string;
  role: string;
  name?: string;
  id?: string;
  hidden?: boolean;
  disabled?: boolean;
  value?: string;
  text?: string;
  /** Center point used for semantic tap targeting. */
  center: { x: number; y: number };
}

export function parseUiautomatorDump(xml: string): AndroidUiElement[] {
  const out: AndroidUiElement[] = [];
  const nodeRe = /<node\s+([^>]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(xml)) !== null) {
    const attrs = new Map<string, string>();
    const attrRe = /([a-zA-Z-]+)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[1] ?? "")) !== null) {
      attrs.set(a[1] ?? "", a[2] ?? "");
    }
    const resId = attrs.get("resource-id") ?? "";
    if (!resId.includes(":id/")) continue; // skip container nodes without ids
    const cls = attrs.get("class") ?? "";
    const boundsRaw = attrs.get("bounds") ?? "";
    const bm = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(boundsRaw);
    if (!bm) continue;
    const x1 = Number(bm[1]);
    const y1 = Number(bm[2]);
    const x2 = Number(bm[3]);
    const y2 = Number(bm[4]);
    const id = resId.split(":id/")[1] ?? resId;
    const text = attrs.get("text") ?? "";
    const isField = cls.endsWith("EditText");
    // Derive visibility from geometry: zero-area bounds mean the node is not
    // rendered (uiautomator dumps omit most invisible nodes entirely).
    const hidden = x2 <= x1 || y2 <= y1;
    out.push({
      tag: "node",
      role: cls.endsWith("Button")
        ? "button"
        : isField
          ? "input"
          : "text",
      name: attrs.get("content-desc") || text || id,
      id,
      hidden,
      disabled: attrs.get("enabled") === "false",
      value: isField ? text : undefined,
      text: isField ? undefined : text,
      center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
    });
  }
  return out;
}
