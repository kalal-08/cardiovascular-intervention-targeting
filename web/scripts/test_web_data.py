"""Regression checks for the public-data boundary; no participant inputs."""
import copy
import json
import unittest

import export_web_data as export


class PublicDataChecks(unittest.TestCase):
    def test_rejects_non_whitelisted_village_field(self):
        rows = [{"village_id": "1", "participant_id": "private"}]
        with self.assertRaisesRegex(ValueError, "fields"):
            export.validate_rows("villages", rows, {})

    def test_real_sources_reconcile_and_output_is_repeatable(self):
        first, report = export.prepare()
        second, _ = export.prepare()
        self.assertEqual(first, second)
        self.assertEqual(report["targets_passed"], 141)
        self.assertEqual(report["targets_not_applicable"], 0)

    def test_rejects_changed_village_signals(self):
        payloads, _ = export.prepare()
        data = export.decode_datasets(payloads)
        changed = copy.deepcopy(data)
        changed["villages"][0]["grf_predicted_benefit"] += 0.01
        with self.assertRaises(ValueError):
            export.reconcile(changed)

    def test_rejects_changed_state_specific_finding(self):
        payloads, _ = export.prepare()
        data = export.decode_datasets(payloads)
        data["robustness"][0]["single_village_influence"] = "invented"
        with self.assertRaisesRegex(ValueError, "state-specific"):
            export.reconcile(data)

    def test_rejects_invalid_keys_nulls_categories_and_numbers(self):
        payloads, _ = export.prepare()
        schemas = json.loads(payloads["schemas.json"])["$defs"]
        for name, field, value in [("villages", "village_id", "0"),
                                   ("villages", "n_randomized", None),
                                   ("villages", "baseline_risk", float("nan")),
                                   ("policies", "policy", "unknown")]:
            with self.subTest(field=field):
                rows = copy.deepcopy(export.decode_datasets(payloads)[name])
                rows[0][field] = value
                with self.assertRaises(ValueError):
                    export.validate_rows(name, rows, schemas[name])
        rows = export.decode_datasets(payloads)["villages"]
        rows[1] = rows[0].copy()
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            export.validate_rows("villages", rows, schemas["villages"])

    def test_page_one_two_three_display_checkpoints(self):
        payloads, _ = export.prepare()
        data = export.decode_datasets(payloads)
        summary = data["overview"][0]
        self.assertEqual([f'{summary[field]:.3f}' for field in
                          ("treatment_effect_estimate", "treatment_effect_ci_lower", "treatment_effect_ci_upper")],
                         ["-1.880", "-2.564", "-1.196"])
        self.assertEqual(f'{100 * summary["evaluation_participants"] / 4533:.1f}', "99.4")
        self.assertEqual(f'{100 * summary["missing_primary_outcome"] / 4533:.1f}', "0.6")
        for field, digits, bounds in [("baseline_risk", 2, ("13.07", "23.31")),
                                      ("grf_predicted_benefit", 3, ("1.399", "2.823")),
                                      ("simple_predicted_benefit", 3, ("1.147", "3.277"))]:
            values = [r[field] for r in data["villages"]]
            self.assertEqual(tuple(format(v, f".{digits}f") for v in (min(values), max(values))), bounds)
        validation = {r["validation_id"]: r for r in data["validation"]}
        checks = {
            "rate:within_fold:AUTOC:grf": ("0.6382", "0.1131", "1.1634"),
            "rate:within_fold:AUTOC:simple": ("0.7310", "0.3434", "1.1186"),
            "rate:within_fold:AUTOC:baseline_risk": ("0.8818", "0.3345", "1.4291"),
            "rate:within_fold:AUTOC:random": ("0.0213", "-0.2512", "0.2938"),
            "calibration:grf": ("0.9160", "0.1510", "1.6810"),
            "calibration:simple": ("0.8820", "0.4707", "1.2934"),
        }
        for key, expected in checks.items():
            self.assertEqual(tuple(f'{validation[key][field]:.4f}' for field in ("estimate", "ci_lower", "ci_upper")), expected)
        for metric, expected in [("priority_spearman", ["0.6191", "0.6820", "0.7249"]),
                                 ("village_signal_spearman", ["0.3349", "0.4305", "0.4649"])]:
            self.assertEqual(sorted(f'{r["estimate"]:.4f}' for r in validation.values() if r["metric"] == metric), expected)


if __name__ == "__main__":
    unittest.main()
