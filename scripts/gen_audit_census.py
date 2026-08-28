"""Generate the HARDENING_6 inventory and semantic-review certificate.

The old H5 generator treated enumeration, hashing, and pathname classification
as semantic review. That is not a meaningful certification boundary. This
generator deliberately separates those concerns:

* inventory rows come from ``git ls-files`` and the current working-tree blob;
* semantic-review rows come only from an explicit review ledger;
* a review is accepted only when its exact blob hash and non-generic evidence
  fields match the current inventory.

The historical ``HARDENING_5-AUDIT.md`` is never rewritten by this script.
Use ``--output``/``--machine-output`` to write a prospective H6 certificate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import subprocess
from collections import Counter
from typing import Any


SCHEMA = "inspector-h6-audit/1"
DEFAULT_MARKDOWN = pathlib.Path(".inspector/state/HARDENING_6-AUDIT.md")
CERTIFICATION_ARTIFACTS = {
    ".inspector/state/HARDENING_5-AUDIT.md",
    ".inspector/state/HARDENING_6-AUDIT.md",
    ".inspector/state/HARDENING_6-AUDIT.json",
    ".inspector/state/HARDENING_6-SEMANTIC-REVIEW.json",
}


def tracked_files() -> list[str]:
    proc = subprocess.run(
        ["git", "ls-files", "-z"],
        capture_output=True,
        check=True,
    )
    return sorted(p.decode("utf-8") for p in proc.stdout.split(b"\0") if p)


def blob_hash(path: str) -> str:
    data = pathlib.Path(path).read_bytes()
    digest = hashlib.sha1()
    digest.update(f"blob {len(data)}\0".encode("ascii"))
    digest.update(data)
    return digest.hexdigest()


def classify(path: str) -> tuple[str, str, bool, str | None]:
    """Return category, review scope, authored flag, and exclusion reason."""

    normalized = path.replace("\\", "/")
    if normalized in CERTIFICATION_ARTIFACTS:
        return (
            "audit-certification-artifact",
            "excluded",
            False,
            "generated inventory/certificate metadata; validated by the H6 gate itself",
        )
    if normalized.endswith(".log") and (
        normalized.startswith(".inspector/") or normalized.startswith(".agent/")
    ):
        return (
            "generated-evidence-log",
            "excluded",
            False,
            "generated run/checkpoint evidence log; retained for provenance, not authored behavior",
        )
    if normalized.startswith(".inspector/ga-work/") or normalized.startswith(".inspector/rc-work/"):
        return (
            "generated-evidence-artifact",
            "excluded",
            False,
            "generated field-proof/evidence artifact; retained for provenance, not authored behavior",
        )
    if normalized.startswith("packages/"):
        if ".integration.test." in normalized or ".hardening.test." in normalized or ".test." in normalized:
            return "package-test", "authored", True, None
        if normalized.endswith((".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".ps1")):
            return "package-runtime", "authored", True, None
        if normalized.endswith((".json", ".yaml", ".yml")):
            return "package-config", "authored", True, None
        return "package-documentation-or-asset", "authored", True, None
    if normalized.startswith("docs/"):
        return "documentation", "authored", True, None
    if normalized.startswith("specs/") or normalized.startswith("openspec/"):
        return "specification", "authored", True, None
    if normalized.startswith((".agent/", ".agents/", ".github/", ".opencode/", ".claude/", ".kimi-code/")):
        return "tooling-and-ci-config", "authored", True, None
    if normalized.startswith("scripts/"):
        return "repository-script", "authored", True, None
    if normalized.startswith(".inspector/"):
        return "durable-state-or-ledger", "authored", True, None
    if normalized.startswith("dogfood/"):
        return "dogfood-fixture", "authored", True, None
    if normalized.endswith((".md", ".txt")):
        return "root-documentation", "authored", True, None
    return "root-config", "authored", True, None


def load_reviews(path: pathlib.Path | None) -> dict[str, dict[str, Any]]:
    if path is None or not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema") != "inspector-h6-semantic-review/1":
        raise ValueError("semantic review ledger has an unsupported schema")
    reviews = raw.get("reviews")
    if not isinstance(reviews, list):
        raise ValueError("semantic review ledger requires a reviews array")
    result: dict[str, dict[str, Any]] = {}
    for item in reviews:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("every semantic review entry requires a path")
        path_key = item["path"].replace("\\", "/")
        if path_key in result:
            raise ValueError(f"duplicate semantic review entry: {path_key}")
        result[path_key] = item
    return result


def valid_review(entry: dict[str, Any], expected_blob: str) -> tuple[bool, str]:
    if entry.get("blob") != expected_blob:
        return False, "stale or mismatched exact blob hash"
    if not isinstance(entry.get("reviewer"), str) or not entry["reviewer"].strip():
        return False, "missing reviewer"
    maps = entry.get("system_maps")
    if not isinstance(maps, list) or not maps or not all(isinstance(m, str) and m.strip() for m in maps):
        return False, "semantic review requires one or more named system maps"
    targets = entry.get("review_targets")
    if not isinstance(targets, list) or not targets or not all(isinstance(t, str) and len(t.strip()) >= 8 for t in targets):
        return False, "semantic review requires concrete inspected behavior targets"
    basis = entry.get("basis")
    if not isinstance(basis, str) or len(basis.strip()) < 24:
        return False, "semantic review basis is missing or too generic"
    if basis.strip().lower() in {"reviewed", "runtime source reviewed", "no findings"}:
        return False, "semantic review basis is generic"
    rationale = entry.get("rationale")
    if not isinstance(rationale, str) or len(rationale.strip()) < 12:
        return False, "semantic review rationale is missing"
    return True, ""


def make_inventory(reviews: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    tracked = tracked_files()
    tracked_keys = {path.replace("\\", "/") for path in tracked}
    unexpected = sorted(set(reviews) - tracked_keys)
    if unexpected:
        raise ValueError(
            "semantic review ledger contains paths that are not tracked: "
            + ", ".join(unexpected)
        )
    for path in tracked:
        category, scope, authored, exclusion = classify(path)
        current_blob = blob_hash(path)
        review = reviews.get(path.replace("\\", "/"))
        status = "EXCLUDED" if scope == "excluded" else "UNREVIEWED"
        review_error = None
        if authored and review is not None:
            accepted, review_error = valid_review(review, current_blob)
            if accepted:
                status = "REVIEWED"
                review_error = None
        rows.append(
            {
                "path": path.replace("\\", "/"),
                "blob": current_blob,
                "category": category,
                "scope": scope,
                "authored": authored,
                "review_status": status,
                "exclusion_reason": exclusion,
                "semantic_review": review if status == "REVIEWED" else None,
                "review_error": review_error,
            }
        )
    return rows


def render_markdown(rows: list[dict[str, Any]], review_ledger: str | None) -> str:
    counts = Counter(row["review_status"] for row in rows)
    authored = [row for row in rows if row["authored"]]
    lines = [
        "# HARDENING_6 — Exact-Blob Inventory and Semantic-Review Certificate",
        "",
        "This is a prospective H6 certificate. Inventory and semantic review are",
        "separate: hashing/enumeration/path classification never creates `REVIEWED`.",
        "A reviewed authored row requires an explicit ledger entry whose exact blob",
        "hash matches the current working tree and whose evidence names system maps,",
        "a content/behavior review basis, and a no-finding/finding rationale.",
        "",
        "## Coverage summary",
        "",
        f"- tracked blobs: **{len(rows)}**",
        f"- authored review scope: **{len(authored)}**",
        f"- reviewed: **{counts['REVIEWED']}**",
        f"- unreviewed: **{counts['UNREVIEWED']}**",
        f"- excluded by explicit rule: **{counts['EXCLUDED']}**",
        f"- semantic review ledger: `{review_ledger or '(none — all authored rows remain UNREVIEWED)'}`",
        "",
        "## Inventory and semantic-review evidence",
        "",
        "| Path | Exact blob | Category | Scope | Status | Evidence basis |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        review = row["semantic_review"]
        if row["review_status"] == "REVIEWED" and review:
            basis = f"maps: {', '.join(review['system_maps'])}; {review['basis']}"
        elif row["review_status"] == "EXCLUDED":
            basis = row["exclusion_reason"] or "explicitly excluded"
        else:
            basis = row["review_error"] or "no exact-blob semantic review evidence"
        safe = str(basis).replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| `{row['path']}` | `{row['blob']}` | {row['category']} | {row['scope']} | **{row['review_status']}** | {safe} |"
        )
    lines.extend(
        [
            "",
            "## Mechanical certification rule",
            "",
            "The H6 repo-contract gate compares this inventory with `git ls-files` and",
            "fails on a missing path, an exact-blob mismatch, malformed review evidence,",
            "or any authored row that is not `REVIEWED`. Certification artifacts and",
            "generated evidence logs remain inventory-visible but are excluded only by",
            "the explicit rules recorded in each row.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_MARKDOWN)
    parser.add_argument("--machine-output", type=pathlib.Path, default=None)
    parser.add_argument("--review-ledger", type=pathlib.Path, default=None)
    parser.add_argument("--no-markdown", action="store_true", help="write only the machine-readable inventory")
    args = parser.parse_args()

    reviews = load_reviews(args.review_ledger)
    rows = make_inventory(reviews)
    machine = {
        "schema": SCHEMA,
        "generated_from": "git ls-files + current working-tree blob bytes",
        "review_ledger": str(args.review_ledger) if args.review_ledger else None,
        "rows": rows,
    }
    if not args.no_markdown:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            render_markdown(rows, str(args.review_ledger) if args.review_ledger else None),
            encoding="utf-8",
            newline="\n",
        )
    if args.machine_output is not None:
        args.machine_output.parent.mkdir(parents=True, exist_ok=True)
        args.machine_output.write_text(
            json.dumps(machine, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    print(
        "wrote",
        args.machine_output if args.no_markdown and args.machine_output is not None else args.output,
        "tracked",
        len(rows),
        "reviewed",
        sum(row["review_status"] == "REVIEWED" for row in rows),
        "unreviewed",
        sum(row["review_status"] == "UNREVIEWED" for row in rows),
    )


if __name__ == "__main__":
    main()
