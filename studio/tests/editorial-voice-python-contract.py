"""Synthetic-only driver contracts: no inference, model, audio or network access."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
import wave
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("editorial_voice_driver",
    Path(__file__).resolve().parents[1] / "scripts/generate-editorial-local-voice.py")
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def plan():
    texts = ["先检查合成数据，", "再保留完整原文。"]
    return {"schemaVersion": "editorial-voice-speech-plan-v1", "sampleRate": 24000,
        "voiceId": "zm_010", "speed": 1.1, "sourceTextSha256": digest("".join(texts)),
        "segments": [{"id": f"speech-{i + 1:04d}", "sceneId": "S01", "unitId": "hook",
            "text": text, "textSha256": digest(text), "pauseAfterSamples": 0}
            for i, text in enumerate(texts)]}


class Contracts(unittest.TestCase):
    def test_valid_plan(self):
        DRIVER.validate_plan(plan())

    def test_reject_mutated_text_hash_and_gaps(self):
        changes = [lambda p: p.update(speed=1.0), lambda p: p.update(sampleRate=48000),
            lambda p: p["segments"][0].update(text="改动了。"),
            lambda p: p["segments"][0].update(pauseAfterSamples=24000),
            lambda p: p["segments"][1].update(id="speech-0001"),
            lambda p: p.update(extra=True)]
        for change in changes:
            p = plan()
            change(p)
            with self.assertRaises(ValueError):
                DRIVER.validate_plan(p)

    def test_all_approved_english_terms_require_local_lexicon(self):
        lexicon = {"AI": "ai", "agent": "agent", "R": "r", "A": "a", "G": "g", "B": "b"}
        self.assertEqual(DRIVER.english_pronunciation("RAG", lexicon), "r a g")
        for word in ["AI", "Agent", "A", "B"]:
            self.assertTrue(DRIVER.english_pronunciation(word, lexicon))
        for word in ["download", "Agent AI", "unknown"]:
            with self.assertRaises(ValueError):
                DRIVER.english_pronunciation(word, lexicon)
        with self.assertRaises(ValueError):
            DRIVER.english_pronunciation("AI", {})

    def test_phoneme_limit_prevents_truncation_and_unknown_speech(self):
        for phonemes in ["", "a" * 511, "❓", "aZ"]:
            with self.assertRaises(ValueError):
                DRIVER.validate_phonemes("speech-0001", phonemes, {"a": 1})
        result = DRIVER.validate_phonemes("speech-0001", "a" * 510, {"a": 1})
        self.assertEqual(result["length"], 510)
        self.assertEqual(result["sha256"], digest("a" * 510))

    def test_closed_request_pins_and_bounds(self):
        p = plan()
        pin = {"path": "/synthetic/input", "realPath": "/synthetic/input",
            "bytes": 3, "sha256": "a" * 64}
        request = {"plan": p, "model": {"repoId": "hexgrad/Kokoro-82M-v1.1-zh", "languageCode": "z"},
            "pinnedFiles": {key: dict(pin) for key in DRIVER.PIN_KEYS}, "runtimeLock": {"schemaVersion": 1}}
        DRIVER.validate_request(request)
        for change in [lambda r: r.update(networkAllowed=True),
            lambda r: r["pinnedFiles"].pop("driver"),
            lambda r: r["pinnedFiles"]["driver"].update(path="relative.py"),
            lambda r: r["model"].update(repoId="unapproved/model")]:
            invalid = json.loads(json.dumps(request))
            change(invalid)
            with self.assertRaises(ValueError):
                DRIVER.validate_request(invalid)

    def test_pcm_assembly_preserves_bytes_and_explicit_gap_samples(self):
        p = plan()
        p["segments"][1]["unitId"] = "closing"
        p["segments"][0]["pauseAfterSamples"] = 2880
        DRIVER.validate_plan(p)
        with tempfile.TemporaryDirectory(prefix="editorial-voice-synthetic-") as directory:
            output = Path(directory)
            results = []
            payloads = [b"\x12\x00" * 6001, b"\x34\x00" * 7001]
            for index, payload in enumerate(payloads):
                source = output / f"speech-{index + 1:04d}.wav"
                with wave.open(str(source), "wb") as writer:
                    writer.setnchannels(1)
                    writer.setsampwidth(2)
                    writer.setframerate(24000)
                    writer.writeframes(payload)
                results.append({"file": source.name, "sha256": DRIVER.digest(source),
                    "sampleCount": len(payload) // 2})
            result = DRIVER.assemble_voice(output, results, p)
            self.assertEqual(result["sampleCount"], 6001 + 2880 + 7001)
            with wave.open(str(output / "voice.wav"), "rb") as reader:
                self.assertEqual(reader.getnframes(), result["sampleCount"])
                self.assertEqual(reader.readframes(reader.getnframes()),
                    payloads[0] + b"\0\0" * 2880 + payloads[1])
            with self.assertRaises(FileExistsError):
                DRIVER.assemble_voice(output, results, p)

    def test_pin_content_and_realpath_changes_fail(self):
        with tempfile.TemporaryDirectory(prefix="editorial-voice-pins-") as directory:
            path = Path(directory) / "synthetic.json"
            path.write_bytes(b"{}\n")
            pins = {"synthetic": {"path": str(path), "realPath": str(path.resolve()),
                "bytes": 3, "sha256": DRIVER.digest(path)}}
            DRIVER.verify_pins(pins)
            path.write_bytes(b"[]\n")
            with self.assertRaises(ValueError):
                DRIVER.verify_pins(pins)

    def test_loaded_frontends_must_be_the_pinned_files_not_lookalike_paths(self):
        with tempfile.TemporaryDirectory(prefix="editorial-voice-imports-") as directory:
            root = Path(directory)
            pipeline = root / "pipeline.py"
            frontend = root / "zh.py"
            lookalike = root / "other-pipeline.py"
            pipeline.write_bytes(b"synthetic pipeline\n")
            frontend.write_bytes(b"synthetic frontend\n")
            lookalike.write_bytes(pipeline.read_bytes())
            pins = {key: {"path": str(path), "realPath": str(path.resolve()),
                "bytes": path.stat().st_size, "sha256": DRIVER.digest(path)}
                for key, path in [("kokoroPipeline", pipeline), ("zhFrontend", frontend)]}
            DRIVER.verify_loaded_frontend_paths(pins, str(pipeline), str(frontend))
            with self.assertRaises(ValueError):
                DRIVER.verify_loaded_frontend_paths(pins, str(lookalike), str(frontend))
            frontend.write_bytes(b"changed frontend\n")
            with self.assertRaises(ValueError):
                DRIVER.verify_loaded_frontend_paths(pins, str(pipeline), str(frontend))


if __name__ == "__main__":
    unittest.main()
