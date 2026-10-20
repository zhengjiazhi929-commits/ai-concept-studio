"""Synthetic full-revision voice contracts; no model, live Episode or user media."""
import copy
import hashlib
import importlib.util
import math
import tempfile
import unittest
import wave
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("full_revision_voice",
    Path(__file__).resolve().parents[1] / "scripts/generate-explainer-full-revision-voice.py")
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


def plan():
    chapters = [{"id": key, "label": key} for key in DRIVER.CHAPTER_IDS]
    return {"schemaVersion": "explainer-full-revision-plan-v1", "chapters": chapters,
        "scenes": [{"id": "S" + str(i), "title": "合成标题", "chapterId": c["id"],
            "layout": "flow", "items": [{"title": "输入", "body": "合成正文"}], "note": "",
            "segments": [{"id": "s" + str(i), "text": "先判断当前需要什么。",
                "pauseAfterMs": 0 if i == 3 else 120, "focusIndex": 0, "revealCount": 1}]}
            for i, c in enumerate(chapters)]}


def pcm(n, edge=0):
    values = [0] * edge + [int(3000 * math.sin(i * .13)) for i in range(n)] + [0] * edge
    return b"".join(v.to_bytes(2, "little", signed=True) for v in values)


class Contracts(unittest.TestCase):
    def test_complete_plan_flattens_scene_and_chapter_provenance(self):
        rows = DRIVER.validate_plan(plan())
        self.assertEqual([s["sceneId"] for s in rows], ["S0", "S1", "S2", "S3"])
        self.assertEqual([s["chapterId"] for s in rows], list(DRIVER.CHAPTER_IDS))
        self.assertNotIn("clipId", rows[0])

    def test_closed_schema_rejects_unknown_fields(self):
        for mutate in [lambda p: p.update(extra=True), lambda p: p["scenes"][0].update(extra=True),
            lambda p: p["scenes"][0]["segments"][0].update(extra=True),
            lambda p: p["scenes"][0]["items"][0].update(extra=True),
            lambda p: p["chapters"][0].update(extra=True)]:
            value = plan(); mutate(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                DRIVER.validate_plan(value)

    def test_four_chapters_once_in_order_and_all_used(self):
        for mutate in [lambda p: p.update(chapters=p["chapters"][:3]),
            lambda p: p["chapters"].reverse(),
            lambda p: p["scenes"][1].update(chapterId="missing"),
            lambda p: p["scenes"][2].update(chapterId="concept"),
            lambda p: p["scenes"].pop()]:
            value = plan(); mutate(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                DRIVER.validate_plan(value)

    def test_unsafe_sentence_duplicate_or_unknown_layout_rejected(self):
        mutations = [lambda p: p["scenes"][0]["segments"][0].update(text="字" * 29),
            lambda p: p["scenes"][0]["segments"][0].update(text="坏\n文字"),
            lambda p: p["scenes"][0]["segments"][0].update(text=""),
            lambda p: p["scenes"][1]["segments"][0].update(id="s0"),
            lambda p: p["scenes"][1].update(id="S0"),
            lambda p: p["scenes"][0].update(layout="html")]
        for mutate in mutations:
            value = plan(); mutate(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                DRIVER.validate_plan(value)

    def test_visual_focus_and_reveal_are_bounded(self):
        for patch in [{"focusIndex": 1}, {"focusIndex": True}, {"focusIndex": -2},
            {"revealCount": 0}, {"revealCount": 2}, {"revealCount": True}]:
            value = plan(); value["scenes"][0]["segments"][0].update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                DRIVER.validate_plan(value)
        value = plan(); value["scenes"][0]["segments"][0]["focusIndex"] = -1
        self.assertEqual(DRIVER.validate_plan(value)[0]["focusIndex"], -1)

    def test_readable_visual_limits_match_full_scene_contract(self):
        for mutate in [lambda p: p["scenes"][0].update(title="字" * 33),
            lambda p: p["scenes"][0].update(note="字" * 66),
            lambda p: p["scenes"][0]["items"][0].update(title="字" * 19),
            lambda p: p["scenes"][0]["items"][0].update(body="字" * 56),
            lambda p: p["scenes"][0].update(items=p["scenes"][0]["items"] * 5),
            lambda p: p["scenes"][0].update(layout="sources", items=[{"title": "来源", "body": "字" * 23}])]:
            value = plan(); mutate(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                DRIVER.validate_plan(value)

    def test_all_text_rejects_edge_whitespace_and_unicode_controls_like_js(self):
        for text in [" 文字", "文字 ", "\ufeff文字", "文字\ufeff", "文\x7f字", "文\x85字", "文\x9f字"]:
            value = plan(); value["scenes"][0]["segments"][0]["text"] = text
            with self.subTest(text=repr(text)), self.assertRaises(ValueError):
                DRIVER.validate_plan(value)
        value = plan(); value["chapters"][0]["label"] = "字" * 41
        with self.assertRaises(ValueError):
            DRIVER.validate_plan(value)

    def test_per_scene_limit_and_aggregate_limit_are_independent(self):
        value = plan(); first = value["scenes"][0]["segments"][0]
        value["scenes"][0]["segments"] = [{**first, "id": "x" + str(i)} for i in range(65)]
        with self.assertRaises(ValueError):
            DRIVER.validate_plan(value)
        value = plan()
        for scene in value["scenes"]:
            first = scene["segments"][0]
            scene["segments"] = [{**first, "id": first["id"] + "x" + str(i),
                "pauseAfterMs": 0 if scene is value["scenes"][-1] and i == 63 else 120} for i in range(64)]
        self.assertEqual(len(DRIVER.validate_plan(value)), 256)
        extra = copy.deepcopy(value["scenes"][0]); extra["id"] = "extra"
        extra["segments"] = [{**first, "id": "extra" + str(i), "pauseAfterMs": 120} for i in range(5)]
        value["scenes"].insert(0, extra)
        with self.assertRaises(ValueError):
            DRIVER.validate_plan(value)

    def test_reveal_cannot_reverse(self):
        value = plan(); scene = value["scenes"][0]
        scene["items"].append({"title": "输出", "body": "合成结果"})
        scene["segments"][0]["revealCount"] = 2
        scene["segments"].append({**scene["segments"][0], "id": "next", "revealCount": 1})
        with self.assertRaises(ValueError):
            DRIVER.validate_plan(value)

    def test_pause_is_explicit_integer_bounded_and_final_zero(self):
        for pause in [-1, True, 1001, 1.5]:
            value = plan(); value["scenes"][0]["segments"][0]["pauseAfterMs"] = pause
            with self.subTest(pause=pause), self.assertRaises(ValueError):
                DRIVER.validate_plan(value)
        value = plan(); value["scenes"][-1]["segments"][-1]["pauseAfterMs"] = 1
        with self.assertRaises(ValueError):
            DRIVER.validate_plan(value)
        value = plan(); value["scenes"][0]["segments"][0]["pauseAfterMs"] = 99
        with self.assertRaises(ValueError):
            DRIVER.validate_plan(value)

    def test_64_scenes_and_260_sentences_are_hard_caps(self):
        value = plan()
        for i in range(61):
            scene = copy.deepcopy(value["scenes"][0]); scene["id"] = "x" + str(i)
            scene["segments"][0]["id"] = "z" + str(i); value["scenes"].insert(0, scene)
        with self.assertRaises(ValueError):
            DRIVER.validate_plan(value)
        value = plan(); sentence = value["scenes"][0]["segments"][0]
        value["scenes"][0]["segments"] = [{**sentence, "id": "x" + str(i)} for i in range(258)]
        with self.assertRaises(ValueError):
            DRIVER.validate_plan(value)

    def test_new_900_second_cap_does_not_change_old_150_second_cap(self):
        self.assertEqual(DRIVER.aligned_sample_count(21_599_999), (21_600_000, 1))
        self.assertEqual(DRIVER.aligned_sample_count(21_600_000), (21_600_000, 0))
        for n in [0, -1, True, 21_600_001]:
            with self.subTest(n=n), self.assertRaises(ValueError):
                DRIVER.aligned_sample_count(n)
        helper = DRIVER.load_pure_helpers()
        self.assertEqual(helper.MAX_SAMPLES, 3_600_000)
        with self.assertRaises(ValueError):
            helper.aligned_sample_count(3_600_001)

    def test_pcm_assembly_is_contiguous_with_only_declared_pauses_and_final_pad(self):
        with tempfile.TemporaryDirectory(prefix="full-voice-synthetic-") as directory:
            dest = Path(directory); records = []; expected = b""; helper = DRIVER.load_pure_helpers()
            for i, row in enumerate(DRIVER.validate_plan(plan())):
                data = pcm(7201 + i); raw = DRIVER.write_pcm(dest / (row["id"] + ".raw.wav"), data)
                kept, evidence = helper.trim_pcm_edges(data)
                trimmed = DRIVER.write_pcm(dest / (row["id"] + ".trimmed.wav"), kept)
                records.append({**row, "raw": raw, "trimmed": trimmed, "trimEvidence": evidence})
                expected += kept + bytes(row["pauseAfterMs"] * 24 * 2)
            voice, rows, assembly = DRIVER.assemble_candidate(dest, records, helper)
            self.assertEqual(rows[0]["startSample"], 0)
            for previous, following in zip(rows, rows[1:]):
                self.assertEqual(following["startSample"], previous["endSample"] + previous["pauseAfterSamples"])
            self.assertEqual(rows[-1]["pauseAfterSamples"], 0)
            self.assertEqual(assembly["speechAndPauseSamples"], len(expected) // 2)
            self.assertEqual(voice["sampleCount"] % 800, 0)
            with wave.open(str(dest / "voice.wav")) as reader:
                self.assertEqual(reader.readframes(reader.getnframes()), expected + bytes(assembly["tailPaddingSamples"] * 2))
            with self.assertRaises(FileExistsError):
                DRIVER.assemble_candidate(dest, records, helper)

    def test_changed_raw_and_forged_trim_fail_before_full_assembly(self):
        with tempfile.TemporaryDirectory(prefix="full-voice-evidence-") as directory:
            dest = Path(directory); helper = DRIVER.load_pure_helpers(); data = pcm(7201, 9600)
            raw = DRIVER.write_pcm(dest / "a.raw.wav", data)
            kept, evidence = helper.trim_pcm_edges(data)
            trimmed = DRIVER.write_pcm(dest / "a.trimmed.wav", kept)
            row = DRIVER.validate_plan(plan())[-1]
            record = {**row, "raw": raw, "trimmed": trimmed, "trimEvidence": evidence}
            record["trimEvidence"]["headRemovedSamples"] += 1
            with self.assertRaises(ValueError):
                DRIVER.assemble_candidate(dest, [record], helper)
            (dest / raw["file"]).write_bytes(b"changed")
            with self.assertRaises(ValueError):
                DRIVER.assemble_candidate(dest, [record], helper)
            self.assertFalse((dest / "voice.wav").exists())

    def test_closed_request_and_pin_binding_fail_before_inference_import(self):
        with self.assertRaises(ValueError):
            DRIVER.validate_request({"plan": plan()})

    def test_request_rejects_duplicate_nonfinite_changed_and_oversized_json(self):
        with tempfile.TemporaryDirectory(prefix="full-voice-request-") as directory:
            path = Path(directory) / "request.json"
            for content in [b'{"x":1,"x":2}', b'{"x":NaN}', b" " * (512 * 1024 + 1)]:
                path.write_bytes(content)
                with self.assertRaises(ValueError):
                    DRIVER.read_request(path, hashlib.sha256(content).hexdigest())
            path.write_bytes(b'{"fixture":true}')
            with self.assertRaises(ValueError):
                DRIVER.read_request(path, "0" * 64)


if __name__ == "__main__":
    unittest.main()
