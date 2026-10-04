"""Deterministic public export from Phase-12A aggregates, never participant data."""
import argparse
import csv
import hashlib
import importlib.util
import json
import math
import os
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
ROOT = WEB.parent
OUTPUT = WEB / "public" / "data"
VERSION = "1.0.0"
POLICIES = ("grf", "simple", "baseline_risk")
ANCHORS = (13, 32, 64, 95, 127)
DIMENSIONS = ("age", "sex", "income", "education", "occupation")
# Exact 12C.0 whitelist: fields not listed here can never enter an output row.
CONTRACT = {
    "overview": ("bi_intervention_summary", 1, "summary_id randomized_participants evaluation_participants missing_primary_outcome villages intervention_participants control_participants intervention_villages control_villages primary_outcome outcome_unit treatment_effect_estimate treatment_effect_ci_lower treatment_effect_ci_upper effect_favorable_direction benefit_sign_convention analysis_population reproduction_status final_policy_conclusion"),
    "villages": ("bi_village_priority", 127, "village_id n_randomized baseline_risk grf_predicted_benefit simple_predicted_benefit grf_candidate_rank simple_candidate_rank baseline_risk_candidate_rank"),
    "validation": ("bi_hte_validation", 15, "validation_id metric model_or_comparison normalization estimate ci_lower ci_upper classification unit scientific_category"),
    "subgroups": ("bi_classical_subgroup_effects", 13, "subgroup_effect_id moderator moderator_label subgroup analysis_n treatment_effect ci_lower ci_upper reconstruction_status unit favorable_direction scientific_category"),
    "rollout": ("bi_rollout_capacity", 384, "policy capacity_villages n_selected_randomized point_population_rollout_value point_random_expected_value point_gain_vs_random population_value_ci_lower population_value_ci_upper gain_ci_lower gain_ci_upper interval_type bootstrap_replicates is_fixed_anchor"),
    "anchors": ("bi_rollout_anchor", 15, "policy capacity_villages point_population_rollout_value population_value_ci_lower population_value_ci_upper point_random_expected_value point_gain_vs_random gain_ci_lower gain_ci_upper interval_type bootstrap_replicates policy_vs_random_classification capacity_advantage_label selected_villages n_selected_randomized randomized_coverage n_selected_evaluation evaluation_coverage anchor_role"),
    "overlap": ("bi_policy_overlap", 15, "capacity_villages comparison policy_left policy_right shared_villages jaccard_overlap scientific_category"),
    "robustness": ("bi_policy_robustness", 12, "policy capacity_villages phase11a_point_gain_vs_random phase11a_gain_ci_lower phase11a_gain_ci_upper phase11a_gain_classification phase11a_capacity_advantage_label raw_ranking_stability equal_village_consistency single_village_influence scientific_category"),
    "coverage": ("bi_equity_coverage", 150, "policy capacity_villages capacity_role dimension dimension_label category n_subgroup_total n_subgroup_covered subgroup_coverage n_overall_covered overall_randomized_coverage coverage_gap analysis_note scientific_category"),
    "policies": ("dim_policy", 3, "policy policy_label scientific_category"),
    "capacities": ("dim_capacity", 128, "capacity_villages is_fixed_anchor capacity_role"),
}
VALIDATION_ROWS = {
    ("AUTOC", "within_fold"), ("calibration_slope", "fold_adjusted"),
    ("evidence_classification", "predeclared_rule"),
    ("priority_spearman", "raw_participant_scores"),
    ("village_signal_spearman", "village_aggregate"),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def encode(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8")


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


def verify_frozen_sources():
    whitelist = (ROOT / "powerbi/README.md").read_text(encoding="utf-8")
    for _, (table, _, fields) in CONTRACT.items():
        lines = [line for line in whitelist.splitlines() if line.startswith(f"| `{table}`, ")]
        require(len(lines) == 1, f"Missing canonical whitelist: {table}")
        allowed = re.findall(r"`([^`]+)`", lines[0].split("|")[2])
        require(allowed == fields.split(), f"Canonical whitelist mismatch: {table}")
    freeze = json.loads((ROOT / "powerbi/phase12b_freeze_20261001.json").read_text())
    paths = sorted((ROOT / "powerbi/data").glob("*.csv"))
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    expected = freeze["groups"]["powerbi/data"]
    require(len(paths) == expected["files"] and digest.hexdigest() == expected["sha256"],
            "Frozen aggregate fingerprint changed; no export is permitted")
    # Reuse the existing read-only source validator without invoking analytical generation.
    spec = importlib.util.spec_from_file_location("frozen_inputs", ROOT / "powerbi/validate_frozen_inputs.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.validate()
    return expected["sha256"]


def convert(value, column):
    if value == "":
        require(column["nullable"].lower() == "true", f"Unexpected null: {column['column_name']}")
        return None
    kind = column["power_query_type"]
    if column["column_name"] == "village_id":
        return str(int(value))
    if kind == "Whole Number":
        return int(value)
    if kind == "Decimal Number":
        result = float(value)
        require(math.isfinite(result), "Non-finite source value")
        return result
    if kind == "True/False":
        require(value.lower() in ("true", "false"), "Invalid boolean")
        return value.lower() == "true"
    require(kind == "Text", f"Unknown dictionary type: {kind}")
    return value


def row_schema(rows, columns):
    properties = {}
    for field, column in columns.items():
        kind = {"Whole Number": "integer", "Decimal Number": "number",
                "True/False": "boolean", "Text": "string"}[column["power_query_type"]]
        if field == "village_id":
            kind = "string"
        nullable = column["nullable"].lower() == "true"
        unit = column["metric_unit"]
        favorability = column["favorability"]
        if kind == "string":
            unit = "identifier" if field.endswith("_id") else "text/category"
        elif field == "baseline_risk":
            unit = "percent"
        elif "rank" in field:
            unit = "ordinal rank"
            favorability = "lower rank is earlier in that policy's frozen ordering; not a recommendation"
        elif kind == "integer":
            unit = "count"
        elif field.endswith("coverage") or field == "coverage_gap" or field == "jaccard_overlap":
            unit = "proportion"
        elif kind == "number" and field not in ("estimate", "ci_lower", "ci_upper"):
            unit = "percentage points"
        definition = {"type": [kind, "null"] if nullable else kind, "x-unit": unit,
                      "x-favorability": favorability}
        if kind == "string":
            if field == "village_id":
                definition["pattern"] = "^[1-9][0-9]*$"
            else:
                definition["enum"] = sorted({row[field] for row in rows if row[field] is not None})
                if nullable:
                    definition["enum"].append(None)
        properties[field] = definition
    return {"type": "object", "additionalProperties": False,
            "required": list(columns), "properties": properties}


def validate_rows(name, rows, schema):
    fields = CONTRACT[name][2].split()
    for row in rows:
        require(set(row) == set(fields), f"Non-whitelisted or missing fields: {name}")
    require(len(rows) == CONTRACT[name][1], f"Incorrect row count: {name}")
    definition = schema["properties"]["rows"]["items"]
    for row in rows:
        for field, value in row.items():
            rule = definition["properties"][field]
            kinds = rule["type"] if isinstance(rule["type"], list) else [rule["type"]]
            actual = ("null" if value is None else "boolean" if type(value) is bool else
                      "integer" if type(value) is int else "number" if type(value) is float else "string")
            require(actual in kinds or actual == "integer" and "number" in kinds, f"Invalid type: {name}.{field}")
            if actual == "number":
                require(math.isfinite(value), f"Non-finite number: {name}.{field}")
            if "enum" in rule:
                require(value in rule["enum"], f"Unknown category: {name}.{field}")
            if "pattern" in rule and value is not None:
                require(re.fullmatch(rule["pattern"], value) is not None, f"Invalid identifier: {name}.{field}")
    keys = schema["x-primary-key"]
    require(len({tuple(row[key] for key in keys) for row in rows}) == len(rows), f"Duplicate key: {name}")


def near(left, right, message, tolerance=1e-12):
    require(abs(left - right) <= tolerance, message)


def reconcile(data):
    summary = data["overview"][0]
    anchor = {(r["policy"], r["capacity_villages"]): r for r in data["anchors"]}
    require(set(anchor) == {(p, k) for p in POLICIES for k in ANCHORS}, "Incomplete anchors")
    validation = data["validation"]
    metrics = {"rollout_value": "point_population_rollout_value", "random_expected": "point_random_expected_value",
               "gain_vs_random": "point_gain_vs_random", "value_ci_lower": "population_value_ci_lower",
               "value_ci_upper": "population_value_ci_upper", "gain_ci_lower": "gain_ci_lower",
               "gain_ci_upper": "gain_ci_upper", "capacity_label": "capacity_advantage_label"}
    targets = read_csv(ROOT / "powerbi/reconciliation_targets.csv")
    passed = []
    for target in targets:
        parts = target["target_id"].split(".")
        if parts[0] == "study":
            actual = summary[parts[1]]
        elif parts[0] == "effect":
            actual = summary["treatment_effect_" + parts[1]]
        elif parts[0] == "hte":
            metric = {"autoc": "AUTOC", "calibration": "calibration_slope", "classification": "evidence_classification"}[parts[1]]
            rows = [r for r in validation if r["metric"] == metric and r["model_or_comparison"] == parts[2]]
            require(len(rows) == 1, f"Ambiguous target: {target['target_id']}")
            actual = rows[0]["classification" if parts[1] == "classification" else "estimate"]
        elif parts[0] == "anchor":
            actual = anchor[parts[1], int(parts[2][1:])][metrics[parts[3]]]
        elif target["target_id"] == "policy.final_conclusion":
            actual = summary["final_policy_conclusion"]
        else:
            raise ValueError(f"Unmapped reconciliation target: {target['target_id']}")
        if target["expected_numeric"]:
            near(actual, float(target["expected_numeric"]), f"Target mismatch: {target['target_id']}",
                 float(target["numeric_tolerance"]))
        else:
            require(actual == target["expected_text"], f"Text mismatch: {target['target_id']}")
        passed.append(target["target_id"])
    require(len(passed) == len(set(passed)) == 141, "Incomplete target system")
    villages = data["villages"]
    source_villages = {r["village_id"]: r for r in read_csv(ROOT / "powerbi/data/bi_village_priority.csv")}
    require(len(villages) == 127 and len({r["village_id"] for r in villages}) == 127, "Village grain")
    require(sum(r["n_randomized"] for r in villages) == summary["randomized_participants"] == 4533, "Village population")
    for policy, first, last in [("grf", ["66", "47", "55"], "121"),
                                ("simple", ["33", "71", "47"], "80"),
                                ("baseline_risk", ["106", "33", "47"], "12")]:
        rank = policy + "_candidate_rank"
        ordered = sorted(villages, key=lambda r: r[rank])
        require([r[rank] for r in ordered] == list(range(1, 128)), f"Rank permutation: {policy}")
        require([r["village_id"] for r in ordered[:3]] == first and ordered[-1]["village_id"] == last, f"Ranking checkpoints: {policy}")
        for row in ordered:
            source = source_villages[row["village_id"]]
            for field in CONTRACT["villages"][2].split()[1:]:
                near(row[field], float(source[field]), f"Fixed village source signal: {field}", 0)
            require(13 <= row["baseline_risk"] <= 24 and 1 <= row["grf_predicted_benefit"] <= 3.5
                    and 1 <= row["simple_predicted_benefit"] <= 3.5, "Village signal scale")
    curves = {(r["policy"], r["capacity_villages"]): r for r in data["rollout"]}
    require(set(curves) == {(p, k) for p in POLICIES for k in range(128)}, "Curve domain")
    require([r["capacity_villages"] for r in data["capacities"]] == list(range(128)), "Capacity dimension")
    require({r["policy"] for r in data["policies"]} == set(POLICIES), "Policy dimension")
    for (policy, k), row in curves.items():
        near(row["point_population_rollout_value"] - row["point_random_expected_value"], row["point_gain_vs_random"], "Curve sign")
        require(row["population_value_ci_lower"] <= row["population_value_ci_upper"]
                and row["gain_ci_lower"] <= row["gain_ci_upper"], "Curve interval bounds")
        require(row["is_fixed_anchor"] == (k in ANCHORS), "Anchor flag")
        require(0 <= row["n_selected_randomized"] <= 4533, "Curve coverage range")
        if k in ANCHORS:
            for field in ("point_population_rollout_value", "point_random_expected_value", "point_gain_vs_random",
                          "population_value_ci_lower", "population_value_ci_upper", "gain_ci_lower", "gain_ci_upper", "n_selected_randomized"):
                near(row[field], anchor[policy, k][field], "Anchor/curve join")
        if k in (0, 127):
            require(row["point_gain_vs_random"] == 0, "Endpoint gain")
        if k == 127:
            near(row["point_population_rollout_value"], 1.8640556239554664, "Full reconciliation")
            require(row["n_selected_randomized"] == 4533, "Full coverage")
    robust = {(r["policy"], r["capacity_villages"]): r for r in data["robustness"]}
    source_robust = {(r["policy"], int(r["capacity_villages"])): r
                     for r in read_csv(ROOT / "powerbi/data/bi_policy_robustness.csv")}
    require(set(robust) == {(p, k) for p in POLICIES for k in ANCHORS[:-1]}, "Robustness domain; K127 has no record")
    for key, row in robust.items():
        for field, source in [("phase11a_point_gain_vs_random", "point_gain_vs_random"),
                              ("phase11a_gain_ci_lower", "gain_ci_lower"), ("phase11a_gain_ci_upper", "gain_ci_upper")]:
            near(row[field], anchor[key][source], "Robustness/anchor join")
        require(-0.7 <= row["phase11a_gain_ci_lower"] <= 0 <= row["phase11a_gain_ci_upper"] <= 0.7, "Gain interval includes zero and fits fixed scale")
        for field in ("raw_ranking_stability", "equal_village_consistency", "single_village_influence"):
            require(row[field] == source_robust[key][field], f"Frozen state-specific finding: {field}")
    pairs = {"grf_vs_simple", "grf_vs_baseline_risk", "simple_vs_baseline_risk"}
    overlap = {(r["comparison"], r["capacity_villages"]): r for r in data["overlap"]}
    require(set(overlap) == {(p, k) for p in pairs for k in ANCHORS}, "All overlap pairs")
    for (_, k), row in overlap.items():
        require(row["policy_left"] in POLICIES and row["policy_right"] in POLICIES, "Overlap policy join")
        require(0 <= row["shared_villages"] <= k, "Shared count")
        near(row["jaccard_overlap"], row["shared_villages"] / (2 * k - row["shared_villages"]), "Jaccard agreement")
        if k == 127:
            require(row["jaccard_overlap"] == 1 and row["shared_villages"] == 127, "Full overlap")
    contexts = {}
    for row in data["coverage"]:
        contexts.setdefault((row["policy"], row["capacity_villages"], row["dimension"]), []).append(row)
    require(set(contexts) == {(p, k, d) for p in POLICIES for k in ANCHORS for d in DIMENSIONS}, "Coverage states")
    for (policy, k, dimension), rows in contexts.items():
        require(len(rows) == len({r["category"] for r in rows}) == 2, "Two coverage categories")
        require(sum(r["n_subgroup_total"] for r in rows) == 4533, "Subgroup denominators")
        covered = anchor[policy, k]["n_selected_randomized"]
        require(sum(r["n_subgroup_covered"] for r in rows) == covered, "Subgroup covered totals")
        for row in rows:
            require(0 <= row["n_subgroup_covered"] <= row["n_subgroup_total"] and row["n_overall_covered"] == covered, "Covered count/invariance")
            near(row["subgroup_coverage"], row["n_subgroup_covered"] / row["n_subgroup_total"], "Subgroup share")
            near(row["overall_randomized_coverage"], covered / 4533, "Overall share/invariance")
            near(row["coverage_gap"], row["subgroup_coverage"] - row["overall_randomized_coverage"], "Coverage gap")
            if k == 127:
                require(row["subgroup_coverage"] == 1 and row["coverage_gap"] == 0, "Full subgroup reconciliation")
    require(anchor["simple", 64]["n_selected_randomized"] == 2299
            and anchor["grf", 64]["n_selected_randomized"] == 2300, "Default coverage checkpoints")
    for name in ("validation", "subgroups"):
        for row in data[name]:
            if row["ci_lower"] is not None:
                require(row["ci_upper"] is not None and row["ci_lower"] <= row["ci_upper"], "Evidence interval")
    return {"targets_checked": len(passed), "targets_passed": len(passed), "targets_not_applicable": 0,
            "target_ids": passed, "coverage_contexts": 75, "ranking_policies": 3, "gain_intervals_including_zero": 12}


def prepare():
    group_hash = verify_frozen_sources()
    dictionary = read_csv(ROOT / "powerbi/data_dictionary.csv")
    data, definitions, sources, payloads = {}, {}, {}, {}
    for name, (table, count, fields) in CONTRACT.items():
        fields = fields.split()
        source = ROOT / "powerbi/data" / f"{table}.csv"
        raw = read_csv(source)
        metadata = {c["column_name"]: c for c in dictionary if c["table_name"] == table}
        if name == "validation":
            # The frozen mixed-row CSV dictionary uses Text here. Browser numerics
            # remain numbers; evidence rows retain the source's explicit nulls.
            for field in ("estimate", "ci_lower", "ci_upper"):
                metadata[field] = {**metadata[field], "power_query_type": "Decimal Number", "metric_unit": "row.unit"}
        require(set(fields) <= set(metadata), f"Unknown whitelist field: {table}")
        if name == "validation":
            raw = [r for r in raw if (r["metric"], r["normalization"]) in VALIDATION_ROWS]
        rows = [{field: convert(row[field], metadata[field]) for field in fields} for row in raw]
        keys = metadata[fields[0]]["primary_key"].split(" + ")
        def order(row):
            return tuple(int(row[k]) if k == "village_id" else POLICIES.index(row[k]) if k == "policy" else row[k] for k in keys)
        rows.sort(key=order)
        row_definition = row_schema(rows, {field: metadata[field] for field in fields})
        definition = {"type": "object", "additionalProperties": False,
                      "required": ["schema_name", "schema_version", "rows"],
                      "properties": {"schema_name": {"const": name}, "schema_version": {"const": VERSION},
                                     "rows": {"type": "array", "minItems": count, "maxItems": count, "items": row_definition}},
                      "x-primary-key": keys, "x-grain": metadata[fields[0]]["grain"],
                      "x-order": keys, "x-source": source.name,
                      "x-row-selection": sorted([list(pair) for pair in VALIDATION_ROWS]) if name == "validation" else "all source rows"}
        validate_rows(name, rows, definition)
        data[name], definitions[name] = rows, definition
        sources[name] = {"name": source.name, "sha256": sha(source.read_bytes())}
        payloads[f"{name}.json"] = encode({"schema_name": name, "schema_version": VERSION, "rows": rows})
    report = reconcile(data)
    schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "schema_version": VERSION, "$defs": definitions}
    payloads["schemas.json"] = encode(schema)
    manifest = {"schema_version": VERSION, "export_version": VERSION, "contract_version": "12C.0",
                "generator": "web/scripts/export_web_data.py", "source_group_sha256": group_hash,
                "dictionary_sha256": sha((ROOT / "powerbi/data_dictionary.csv").read_bytes()),
                "targets_sha256": sha((ROOT / "powerbi/reconciliation_targets.csv").read_bytes()),
                "schemas": {"file": "schemas.json", "sha256": sha(payloads["schemas.json"])},
                "reconciliation": report, "datasets": {
                    name: {"file": f"{name}.json", "rows": len(rows), "sha256": sha(payloads[f"{name}.json"]),
                           "source": sources[name], "schema": name} for name, rows in data.items()}}
    payloads["manifest.json"] = encode(manifest)
    return payloads, report


def decode_datasets(payloads):
    return {name: json.loads(payloads[f"{name}.json"])["rows"] for name in CONTRACT}


def typescript(payloads):
    definitions = json.loads(payloads["schemas.json"])["$defs"]
    lines = ['// Generated by scripts/export_web_data.py. Do not hand-edit.',
             f'export interface PublicDataset<Name extends string, Row> {{ readonly schema_name: Name; readonly schema_version: "{VERSION}"; readonly rows: readonly Row[]; }}', '']
    for name, definition in definitions.items():
        lines.append(f"export interface {name.title()}Row {{")
        for field, rule in definition["properties"]["rows"]["items"]["properties"].items():
            kinds = rule["type"] if isinstance(rule["type"], list) else [rule["type"]]
            value_type = " | ".join({"integer": "number", "number": "number", "string": "string", "boolean": "boolean", "null": "null"}[k] for k in kinds)
            if "enum" in rule:
                value_type = " | ".join(json.dumps(value, ensure_ascii=False) for value in rule["enum"])
            lines.append(f"  readonly {field}: {value_type};")
        lines.append("}\n")
    lines.append("export interface WebDatasets {")
    lines.extend(f'  readonly {name}: PublicDataset<"{name}", {name.title()}Row>;' for name in CONTRACT)
    lines.append("}\n")
    return "\n".join(lines).encode("utf-8")


def validate_disk(payloads):
    require(OUTPUT.exists(), "Public data missing; run data:generate")
    require({p.name for p in OUTPUT.iterdir()} == set(payloads), "Unexpected/missing public data file")
    for name, expected in payloads.items():
        require((OUTPUT / name).read_bytes() == expected, f"Stale, invalid or modified output: {name}")
    require((WEB / "src/data.generated.ts").read_bytes() == typescript(payloads), "Stale TypeScript data types")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("generate", "validate"))
    args = parser.parse_args()
    payloads, report = prepare()
    if args.mode == "generate":
        if OUTPUT.exists():
            require({p.name for p in OUTPUT.iterdir()} <= set(payloads), "Unowned public files present; refusing overwrite/cleanup")
        OUTPUT.mkdir(parents=True, exist_ok=True)
        # Validation completes before any writes; manifest is published last.
        for name, payload in payloads.items():
            target = OUTPUT / name
            temporary = target.with_suffix(".json.tmp")
            with temporary.open("wb") as handle:
                handle.write(payload)
            os.replace(temporary, target)
        (WEB / "src/data.generated.ts").write_bytes(typescript(payloads))
    validate_disk(payloads)
    print(json.dumps({"status": "PASS", "targets_passed": report["targets_passed"],
                      "targets_not_applicable": report["targets_not_applicable"],
                      "coverage_contexts": report["coverage_contexts"],
                      "datasets": {name: value[1] for name, value in CONTRACT.items()}}))


if __name__ == "__main__":
    main()
