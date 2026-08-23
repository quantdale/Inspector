import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { CampaignConfigError, validateCampaignManifest, type CampaignManifestConfig } from "./work-item.js";

/** Versioned campaign manifest document (M12 F2). */
export const CAMPAIGN_MANIFEST_SCHEMA = "inspector-campaign-manifest/1";

export interface LoadedManifest {
  config: CampaignManifestConfig;
  /** Absolute path of the source file. */
  path: string;
  /** SHA-256 of the raw bytes, recorded for audit/provenance. */
  sha256: string;
}

function parseDocument(text: string, path: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new CampaignConfigError([{ path: "$", code: "manifest-empty", message: `manifest ${path} is empty` }]);
  }
  if (path.endsWith(".json") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new CampaignConfigError([
        { path: "$", code: "manifest-parse", message: `manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    }
  }
  try {
    return parseYaml(text);
  } catch (err) {
    throw new CampaignConfigError([
      { path: "$", code: "manifest-parse", message: `manifest is not valid YAML: ${err instanceof Error ? err.message : String(err)}` },
    ]);
  }
}

/**
 * Load and fully validate a campaign manifest from a YAML or JSON file.
 * Validation happens before any work starts; corrupt manifests fail closed
 * with deterministic {@link CampaignConfigError} issues.
 */
export function loadCampaignManifest(path: string): LoadedManifest {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (err) {
    throw new CampaignConfigError([
      { path: "$", code: "manifest-unreadable", message: `cannot read manifest ${path}: ${err instanceof Error ? err.message : String(err)}` },
    ]);
  }
  const doc = parseDocument(raw.toString("utf8"), path);
  const config = validateCampaignManifest(doc);
  return {
    config,
    path,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}
