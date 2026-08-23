/**
 * SPEC-009 W7: UIAutomator hierarchy parsing + semantic selector resolution.
 */
import { describe, it, expect } from "vitest";
import { parseUiautomatorDump, resolveElement } from "./uiautomator.js";

const NESTED = `<?xml version='1.0'?><hierarchy rotation="0">
<nodes>
<node index="0" text="" resource-id="com.android.settings:id/recycler" class="androidx.recyclerview.widget.RecyclerView" bounds="[0,100][1080,2200]" clickable="true" enabled="true" scrollable="true">
  <node index="0" text="" resource-id="" class="android.widget.LinearLayout" bounds="[0,100][1080,300]" clickable="true" enabled="true">
    <node index="0" text="Network &amp; internet" resource-id="" class="android.widget.TextView" bounds="[60,170][900,230]" enabled="true"/>
  </node>
  <node index="1" text="Connected devices" resource-id="" class="android.widget.TextView" bounds="[60,300][900,360]" enabled="true"/>
  <node index="2" text="App settings" resource-id="com.android.settings:id/app_settings" class="android.widget.TextView" bounds="[60,360][900,420]" enabled="true"/>
</node>
</nodes></hierarchy>`;

describe("W7 hierarchy parser", () => {
  it("walks nested nodes and preserves id-less clickables with paths", () => {
    const els = parseUiautomatorDump(NESTED);
    // recycler + linear layout + two text children + app settings
    expect(els.length).toBe(5);
    const recycler = els.find((e) => e.id === "recycler");
    expect(recycler?.scrollable).toBe(true);
    expect(recycler?.clickable).toBe(true);
    expect(recycler?.path).toBe("0");
    const layout = els.find((e) => e.className === "LinearLayout");
    expect(layout?.clickable).toBe(true);
    expect(layout?.path).toBe("0/0");
    const network = els.find((e) => e.text === "Network & internet");
    expect(network?.path).toBe("0/0/0");
    expect(network?.center.y).toBe(200);
  });

  it("decodes entities in text", () => {
    const els = parseUiautomatorDump(NESTED);
    expect(els.some((e) => e.text === "Network & internet")).toBe(true);
  });
});

describe("W7 semantic selector resolution", () => {
  const els = parseUiautomatorDump(NESTED);

  it("resource-id scheme", () => {
    expect(resolveElement(els, "#app_settings")?.text).toBe("App settings");
  });

  it("text+class scheme resolves id-less rows", () => {
    const el = resolveElement(els, "~text:Connected devices|TextView");
    expect(el?.path).toBe("0/1");
  });

  it("structural path is a last-resort identity", () => {
    expect(resolveElement(els, "%path=0/0")?.className).toBe("LinearLayout");
  });

  it("duplicate labels disambiguate via @nth", () => {
    const xml = `<hierarchy><node index="0" text="Row" resource-id="" class="android.widget.TextView" bounds="[0,0][10,10]"/>
<node index="1" text="Row" resource-id="" class="android.widget.TextView" bounds="[0,20][10,30]"/></hierarchy>`;
    const dup = parseUiautomatorDump(xml);
    expect(resolveElement(dup, "~text:Row|TextView")?.center.y).toBe(5);
    expect(resolveElement(dup, "~text:Row|TextView@1")?.center.y).toBe(25);
  });

  it("stale screen -> selector no longer resolvable (undefined, not a guess)", () => {
    expect(resolveElement(parseUiautomatorDump("<hierarchy/>"), "~text:Connected devices|TextView")).toBeUndefined();
    expect(resolveElement(els, "%path=9/9/9")).toBeUndefined();
  });

  it("hidden/disabled nodes are excluded from resolution", () => {
    const xml = `<hierarchy><node index="0" text="Ghost" resource-id="com.x:id/ghost" class="android.widget.Button" bounds="[0,0][0,0]" enabled="true"/></hierarchy>`;
    const els2 = parseUiautomatorDump(xml);
    expect(resolveElement(els2, "#ghost")).toBeUndefined();
  });
});
