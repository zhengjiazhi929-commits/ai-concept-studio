"""No live Episode, inference stack, production media, or network fixtures."""
import array
import copy
import hashlib
import importlib.util
import math
import tempfile
import unittest
import wave
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("revision_voice",
    Path(__file__).resolve().parents[1] / "scripts/generate-explainer-revision-voice.py")
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


def pcm(values):
    return b"".join(int(v).to_bytes(2, "little", signed=True) for v in values)


def tone(n, level=3000):
    return [int(level * math.sin(i * .13)) for i in range(n)]


def plan():
    return {"schemaVersion": "explainer-revision-plan-v1",
        "chapters": [{"id": "concept", "label": "概念"}],
        "clips": [{"id": "sample", "title": "理解本轮输入", "segments": [
            {"id": "s01", "text": "先判断这次需要什么。", "visual": "question",
                "chapterId": "concept", "pauseAfterMs": 120},
            {"id": "s02", "text": "然后读取相关信息。", "visual": "read",
                "chapterId": "concept", "pauseAfterMs": 0}]}]}


class Contracts(unittest.TestCase):
    def test_valid_plan_returns_ordered_segments(self):
        self.assertEqual([s["id"] for s in DRIVER.validate_plan(plan())], ["s01", "s02"])

    def test_closed_and_capped_plan(self):
        for mutate in [lambda p: p.update(extra=True),
            lambda p: p.update(clips=p["clips"] * 4),
            lambda p: p["clips"][0].update(segments=p["clips"][0]["segments"] * 31),
            lambda p: p["clips"][0]["segments"][0].update(text="字" * 29),
            lambda p: p["clips"][0]["segments"][0].update(text=""),
            lambda p: p["clips"][0]["segments"][0].update(text="边界\n混乱"),
            lambda p: p["clips"][0]["segments"][0].update(chapterId="absent"),
            lambda p: p["clips"][0]["segments"][1].update(id="s01"),
            lambda p: p["clips"][0]["segments"][1].update(pauseAfterMs=1),
            lambda p: p["clips"][0]["segments"][0].update(pauseAfterMs=-1),
            lambda p: p["clips"][0]["segments"][0].update(pauseAfterMs=True),
            lambda p: p["clips"][0]["segments"][0].update(pauseAfterMs=1200)]:
            item = plan(); mutate(item)
            with self.subTest(item=item), self.assertRaises(ValueError):
                DRIVER.validate_plan(item)

    def test_clip_boundary_pause_must_hold_frame_rounding(self):
        p = plan(); clip = copy.deepcopy(p["clips"][0]); clip["id"] = "second"
        for s in clip["segments"]:
            s["id"] += "next"
        p["clips"].append(clip)
        with self.assertRaises(ValueError):
            DRIVER.validate_plan(p)
        p["clips"][0]["segments"][-1]["pauseAfterMs"] = 100
        self.assertEqual(len(DRIVER.validate_plan(p)), 4)

    def test_unknown_assets_cannot_be_rebound_with_a_new_request_hash(self):
        pins = {k: {"sha256": v} for k, v in DRIVER.ASSET_HASHES.items()}
        DRIVER.validate_asset_pins(copy.deepcopy(DRIVER.MODEL), pins)
        for key in DRIVER.ASSET_HASHES:
            altered = copy.deepcopy(pins); altered[key]["sha256"] = "0" * 64
            with self.subTest(key=key), self.assertRaises(ValueError):
                DRIVER.validate_asset_pins(DRIVER.MODEL, altered)
        altered = copy.deepcopy(DRIVER.MODEL); altered["repoId"] = "network/model"
        with self.assertRaises(ValueError):
            DRIVER.validate_asset_pins(altered, pins)

    def test_request_rejects_missing_schema_or_pin_before_import(self):
        with self.assertRaises(ValueError):
            DRIVER.validate_request({"plan": plan()})

    def test_request_hash_duplicate_keys_nonfinite_and_size_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="revision-request-synthetic-") as directory:
            path = Path(directory) / "request.json"
            for data in [b'{"a":1,"a":2}', b'{"a":NaN}', b' ' * (512 * 1024 + 1)]:
                path.write_bytes(data)
                with self.assertRaises(ValueError):
                    DRIVER.read_request(path, hashlib.sha256(data).hexdigest())
            path.write_bytes(b'{"fixture":true}')
            with self.assertRaises(ValueError):
                DRIVER.read_request(path, "0" * 64)
            self.assertEqual(DRIVER.read_request(path, hashlib.sha256(path.read_bytes()).hexdigest()), {"fixture": True})

    def test_trim_only_low_edges_with_fixed_guards(self):
        source = pcm([0] * 12000 + tone(7200) + [0] * 14400)
        result, evidence = DRIVER.trim_pcm_edges(source)
        self.assertEqual(evidence["headRemovedSamples"], 9600)
        self.assertEqual(evidence["tailRemovedSamples"], 10080)
        self.assertEqual(result, source[9600 * 2:(len(source) // 2 - 10080) * 2])
        self.assertEqual(evidence["headGuardSamples"], 2400)
        self.assertEqual(evidence["tailGuardSamples"], 4320)
        self.assertTrue(evidence["retainedPcmBytesIdentical"])

    def test_internal_pause_is_unchanged(self):
        middle = pcm(tone(2400) + [0] * 12000 + tone(2400))
        result, evidence = DRIVER.trim_pcm_edges(pcm([0] * 9600) + middle + pcm([0] * 9600))
        self.assertIn(middle, result)
        self.assertEqual(evidence["interiorRemovedSamples"], 0)

    def test_weak_breath_tail_preserved(self):
        breath = pcm(tone(2400, 95))
        source = pcm([0] * 9600 + tone(2400)) + breath + pcm([0] * 9600)
        result, _ = DRIVER.trim_pcm_edges(source)
        self.assertIn(breath, result)

    def test_no_low_edges_no_trim(self):
        source = pcm(tone(12000))
        result, evidence = DRIVER.trim_pcm_edges(source)
        self.assertEqual(source, result)
        self.assertEqual(evidence["headRemovedSamples"] + evidence["tailRemovedSamples"], 0)

    def test_short_edges_preserved(self):
        source = pcm([0] * 1200 + tone(6000) + [0] * 1200)
        self.assertEqual(DRIVER.trim_pcm_edges(source)[0], source)

    def test_silence_partial_samples_and_clipping_rejected(self):
        for source in [b"", b"x", pcm([0] * 12000), pcm([32767] * 12000), pcm(tone(100))]:
            with self.subTest(length=len(source)), self.assertRaises(ValueError):
                DRIVER.trim_pcm_edges(source)

    def test_frame_tail_alignment_is_only_at_end(self):
        with tempfile.TemporaryDirectory(prefix="revision-voice-synthetic-") as directory:
            dest = Path(directory)
            segments = DRIVER.validate_plan(plan())
            records = []
            for s, n in zip(segments, [7201, 8101]):
                data = pcm(tone(n))
                raw = DRIVER.write_pcm(dest / (s["id"] + ".raw.wav"), data)
                retained, evidence = DRIVER.trim_pcm_edges(data)
                record = DRIVER.write_pcm(dest / (s["id"] + ".trimmed.wav"), retained)
                records.append({**s, "raw": raw, "trimmed": record, "trimEvidence": evidence})
            voice, rows, assembly = DRIVER.assemble_candidate(dest, records)
            self.assertEqual(rows[0]["startSample"], 0)
            self.assertEqual(rows[0]["endSample"], 7201)
            self.assertEqual(rows[1]["startSample"], 7201 + 2880)
            self.assertEqual(rows[1]["endSample"], 18182)
            self.assertEqual(rows[-1]["pauseAfterSamples"], 0)
            self.assertEqual(assembly, {"speechAndPauseSamples": 18182,
                "tailPaddingSamples": 218, "targetSamples": 18400})
            with wave.open(str(dest / voice["file"]), "rb") as f:
                b = f.readframes(f.getnframes())
            self.assertEqual(b, pcm(tone(7201)) + bytes(2880 * 2) + pcm(tone(8101)) + bytes(218 * 2))
            with self.assertRaises(FileExistsError):
                DRIVER.assemble_candidate(dest, records)

    def test_changed_pcm_rejected_before_assembly(self):
        with tempfile.TemporaryDirectory(prefix="revision-voice-synthetic-") as directory:
            dest = Path(directory);s = DRIVER.validate_plan(plan())[0]
            record = DRIVER.write_pcm(dest / "a.wav", pcm(tone(7200)))
            (dest / "a.wav").write_bytes(b"not the original PCM")
            with self.assertRaises(ValueError):
                DRIVER.assemble_candidate(dest, [{**s, "trimmed": record}])

    def test_changed_raw_rejected_even_when_trimmed_remains_valid(self):
        with tempfile.TemporaryDirectory(prefix="revision-raw-evidence-synthetic-") as directory:
            dest = Path(directory);data = pcm(tone(7200))
            raw = DRIVER.write_pcm(dest / "a.raw.wav", data)
            kept, evidence = DRIVER.trim_pcm_edges(data)
            trimmed = DRIVER.write_pcm(dest / "a.trimmed.wav", kept)
            record = {**DRIVER.validate_plan(plan())[-1], "raw": raw, "trimmed": trimmed, "trimEvidence": evidence}
            (dest / raw["file"]).write_bytes(b"changed synthetic original")
            with self.assertRaises(ValueError):
                DRIVER.assemble_candidate(dest, [record])

    def test_forged_trim_evidence_and_unrelated_trimmed_pcm_rejected(self):
        with tempfile.TemporaryDirectory(prefix="revision-trim-evidence-synthetic-") as directory:
            dest = Path(directory);data = pcm([0] * 12000 + tone(7200) + [0] * 12000)
            raw = DRIVER.write_pcm(dest / "a.raw.wav", data)
            kept, evidence = DRIVER.trim_pcm_edges(data)
            trimmed = DRIVER.write_pcm(dest / "a.trimmed.wav", kept)
            record = {**DRIVER.validate_plan(plan())[-1], "raw": raw, "trimmed": trimmed, "trimEvidence": evidence}
            changed = copy.deepcopy(record);changed["trimEvidence"]["headRemovedSamples"] += 1
            with self.assertRaises(ValueError):
                DRIVER.assemble_candidate(dest, [changed])
            unrelated = DRIVER.write_pcm(dest / "other.wav", pcm(tone(len(kept) // 2, 1000)))
            changed = {**record, "trimmed": unrelated}
            with self.assertRaises(ValueError):
                DRIVER.assemble_candidate(dest, [changed])

    def test_cap_is_frame_aligned_and_hard(self):
        self.assertEqual(DRIVER.aligned_sample_count(3_599_999), (3_600_000, 1))
        self.assertEqual(DRIVER.aligned_sample_count(3_600_000), (3_600_000, 0))
        for n in [0, -1, True, 3_600_001]:
            with self.assertRaises(ValueError):
                DRIVER.aligned_sample_count(n)


if __name__ == "__main__":
    unittest.main()
