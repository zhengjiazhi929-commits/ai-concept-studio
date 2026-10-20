"""Synthetic retake contracts; no ML imports or production media."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
import wave
from pathlib import Path

SPEC=importlib.util.spec_from_file_location("retake_driver",Path(__file__).resolve().parents[1]/"scripts/retake-editorial-local-voice.py")
D=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(D)
sha=lambda text:hashlib.sha256(text.encode()).hexdigest()

def plan():
    parent={"id":"speech-0001","sceneId":"S01","unitId":"one","text":"先检查资料，再整理证据。",
        "textSha256":sha("先检查资料，再整理证据。"),"pauseAfterSamples":0}
    base={"schemaVersion":"editorial-voice-speech-plan-v1","sampleRate":24000,"voiceId":"zm_010","speed":1.1,
        "sourceTextSha256":parent["textSha256"],"segments":[parent]}
    repair={"schemaVersion":"editorial-voice-repair-plan-v1","baseCandidate":{"path":"outputs/synthetic/voice-manifest.json","sha256":"a"*64},
        "repairs":[{"id":parent["id"],"parts":[{"text":text,"textSha256":sha(text)} for text in ["先检查资料，","再整理证据。"]]}]}
    derived={"schemaVersion":"editorial-voice-retake-plan-v1","sampleRate":24000,"voiceId":"zm_010","speed":1.1,
        "sourceTextSha256":base["sourceTextSha256"],"baseCandidate":repair["baseCandidate"],"parents":[{**parent,"mode":"retake",
        "parts":[{"id":f"speech-0001-part-{i+1:02d}",**p} for i,p in enumerate(repair["repairs"][0]["parts"])]}]}
    return base,repair,derived

def wav(path,count):
    with wave.open(str(path),"wb") as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(b"\x10\x01"*count)

class Contracts(unittest.TestCase):
    def test_derive_preserves_text_and_child_identity(self):
        base,repair,derived=plan()
        self.assertEqual(D.derive_retake_plan(base,repair),derived)
        for change in [lambda r:r["repairs"][0]["parts"][0].update(text="坏文字，"),
            lambda r:r["repairs"][0]["parts"].pop(),lambda r:r["baseCandidate"].update(path="outputs/../escape.json")]:
            bad=json.loads(json.dumps(repair));change(bad)
            with self.assertRaises(ValueError):D.derive_retake_plan(base,bad)

    def test_base_pcm_is_read_from_safe_regular_files_and_hashes(self):
        with tempfile.TemporaryDirectory(prefix="retake-base-synthetic-") as directory:
            root=Path(directory).resolve();media=root/"media";media.mkdir();source=media/"speech-0001.wav";wav(source,144000)
            base,_,_=plan()
            record={"id":"speech-0001","file":source.name,"bytes":source.stat().st_size,"sha256":D.digest(source),"sampleCount":144000}
            manifest={"path":str(media.resolve()),"files":[record]}
            self.assertEqual(D.verify_base_media(manifest,base),[source.resolve()])
            with source.open("ab") as stream:stream.write(b"bad")
            with self.assertRaises(ValueError):D.verify_base_media(manifest,base)
            source.unlink();outside=root/"other.wav";wav(outside,144000);source.symlink_to(outside)
            with self.assertRaises(ValueError):D.verify_base_media(manifest,base)

    def test_parent_pcm_is_exact_children_and_reuse_is_byte_identical(self):
        with tempfile.TemporaryDirectory(prefix="retake-join-synthetic-") as directory:
            root=Path(directory).resolve();a=root/"part1.wav";b=root/"part2.wav";wav(a,24001);wav(b,48002)
            output=root/"parent.wav"
            joined=D.join_pcm_files(output,[a,b],[24001,48002])
            self.assertEqual(joined["sampleCount"],72003)
            with wave.open(str(output),"rb") as reader:self.assertEqual(reader.readframes(72003),b"\x10\x01"*72003)
            copy=root/"reused.wav";D.copy_exclusive(output,copy)
            self.assertEqual(output.read_bytes(),copy.read_bytes())
            with self.assertRaises(FileExistsError):D.copy_exclusive(output,copy)

    def test_outliers_come_from_actual_base_sample_counts_not_declared_issues(self):
        base,repair,_=plan()
        timing={"schemaVersion":"editorial-voice-timing-v1","sampleRate":24000,"sourceTextSha256":base["sourceTextSha256"],
            "segments":[{"id":"speech-0001","sampleCount":144000,"startSample":0,"endSample":144000,"nextSample":144000}],
            "totalSamples":144000,"captionDurationIssues":[{"id":"speech-0001","durationSeconds":6.0,"code":"subtitle-duration-out-of-range"}]}
        request={"basePlan":base,"baseTiming":timing,"baseMedia":{"files":[{"sampleCount":144000}]},"repairPlan":repair}
        D.validate_measurement_contract(request)
        for change in [lambda r:r["baseTiming"].update(captionDurationIssues=[]),
            lambda r:r["baseTiming"]["segments"][0].update(startSample=1),
            lambda r:r["baseMedia"]["files"][0].update(sampleCount=144001),
            lambda r:r["repairPlan"].update(repairs=[])]:
            invalid=json.loads(json.dumps(request));change(invalid)
            with self.assertRaises(ValueError):D.validate_measurement_contract(invalid)

    def test_symlink_media_ancestor_fails_even_if_target_is_regular(self):
        with tempfile.TemporaryDirectory(prefix="retake-symlink-synthetic-") as directory:
            root=Path(directory).resolve();actual=root/"actual";actual.mkdir()
            file=actual/"speech-0001.wav";wav(file,24000)
            link=root/"linked";link.symlink_to(actual,target_is_directory=True)
            with self.assertRaises(ValueError):D.safe_regular(link/"speech-0001.wav")
            with self.assertRaises(ValueError):D.safe_regular(link,directory=True)

if __name__=="__main__":unittest.main()
