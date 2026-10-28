#!/usr/bin/env python3
"""Export three real OmniHuMo recordings onto an approximate canonical skeleton.

Requires only NumPy. No SMPL model weights are downloaded or distributed.
The source uses joblib's numeric-array format. This reader accepts only its
numeric array wrapper and NumPy dtypes; it never calls pickle.load/joblib.load
and rejects external globals, arbitrary constructors, extensions and objects.

Reproduce (downloads ONLY the first 4 MiB of the pinned archive):
  python3 scripts/export_omnihumo_samples.py --download --prefix /tmp/omnihumo-prefix.bin
Or reuse a downloaded prefix:
  python3 scripts/export_omnihumo_samples.py --prefix /tmp/omnihumo-prefix.bin

The generated sample coordinates are a CC BY-NC-SA 4.0 derivative of OmniHuMo.
They preserve recorded axis-angle rotations and root translation but DO NOT
apply subject shape coefficients or reproduce exact SMPL/SMPL-X joint positions.
"""

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import pickle
import tarfile
import urllib.request
import zlib

import numpy as np


REVISION = "733452904b5cd98c459b810635692ff919e0c019"
DATASET_URL = "https://huggingface.co/datasets/L-yiheng/OmniHuMo"
ARCHIVE = "omnihumo_v0.tar.gz.part_aa"
ARCHIVE_URL = f"{DATASET_URL}/resolve/{REVISION}/{ARCHIVE}"
PREFIX_BYTES = 4 * 1024 * 1024
PREFIX_SHA256 = "be37a205661ff59615b68fa35f813f2b76c3fe1e429a2e2a39c12eeb8cdedb1d"
MAX_TAR_BYTES = 32 * 1024 * 1024
MAX_SAMPLE_BYTES = 1024 * 1024
PARENTS = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]
JOINT_NAMES = [
    "pelvis", "left_hip", "right_hip", "spine1", "left_knee", "right_knee",
    "spine2", "left_ankle", "right_ankle", "spine3", "left_foot", "right_foot",
    "neck", "left_collar", "right_collar", "head", "left_shoulder",
    "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
]
# Hand-authored illustrative proportions in metres. NOT SMPL model parameters.
# Names/order/parents follow the dataset's 22-joint body kinematic chain.
OFFSETS = np.array([
    [0, 0, 0], [0.095, -0.09, 0], [-0.095, -0.09, 0], [0, 0.11, 0],
    [0, -0.42, 0], [0, -0.42, 0], [0, 0.12, 0], [0, -0.41, 0],
    [0, -0.41, 0], [0, 0.12, 0], [0, -0.04, 0.14], [0, -0.04, 0.14],
    [0, 0.18, 0], [0.08, 0.10, 0], [-0.08, 0.10, 0], [0, 0.14, 0],
    [0.10, 0, 0], [-0.10, 0, 0], [0.28, 0, 0], [-0.28, 0, 0],
    [0.26, 0, 0], [-0.26, 0, 0],
], dtype=np.float64)
SELECTIONS = [
    ("73ef4470c69987c2705298feb994cf22_scene_0_0", 0,
     "stand-and-turn", "Stand & turn"),
    ("241ae9db6e5de4f0929da9fc8e6cdcf8_subtitle_cropped_cropped_scene_0_0", 0,
     "bend-and-gesture", "Bend & gesture"),
    ("78fae82e3a29f5798967fa143e4c86c0_subtitle_cropped_cropped_scene_0_0", 0,
     "walk-and-sit", "Walk & sit"),
]


class NumericArrayWrapper:
    """Local inert replacement for joblib's array-metadata wrapper."""


class RestrictedNumericReader(pickle._Unpickler):
    """Read this release's numeric joblib format, rejecting executable objects."""

    dispatch = pickle._Unpickler.dispatch.copy()

    def __init__(self, handle):
        self.handle = handle
        super().__init__(handle)

    def find_class(self, module, name):
        allowed = {
            ("joblib.numpy_pickle", "NumpyArrayWrapper"): NumericArrayWrapper,
            ("numpy", "ndarray"): np.ndarray,
            ("numpy", "dtype"): np.dtype,
        }
        if (module, name) not in allowed:
            raise pickle.UnpicklingError(f"Forbidden global: {module}.{name}")
        return allowed[module, name]

    def load_reduce(self):
        args = self.stack.pop()
        function = self.stack[-1]
        if (function is not np.dtype or not isinstance(args, tuple)
                or not 1 <= len(args) <= 3 or not isinstance(args[0], str)
                or args[0] not in ("f4", "f8", "i4", "i8", "u4", "u8", "b1")
                or any(type(value) is not bool for value in args[1:])):
            raise pickle.UnpicklingError("Only basic numeric dtype construction is allowed")
        self.stack[-1] = function(*args)

    dispatch[pickle.REDUCE[0]] = load_reduce

    def load_newobj(self):
        args, cls = self.stack.pop(), self.stack.pop()
        if cls is not NumericArrayWrapper or args != ():
            raise pickle.UnpicklingError("Unsupported constructor")
        self.append(NumericArrayWrapper())

    dispatch[pickle.NEWOBJ[0]] = load_newobj

    def reject_opcode(self):
        raise pickle.UnpicklingError("Unsupported object opcode")

    for opcode in (pickle.EXT1, pickle.EXT2, pickle.EXT4, pickle.NEWOBJ_EX,
                   pickle.INST, pickle.OBJ, pickle.PERSID, pickle.BINPERSID):
        dispatch[opcode[0]] = reject_opcode

    def read_exact(self, count):
        data = self.handle.read(count)
        if len(data) != count:
            raise pickle.UnpicklingError("Truncated numeric array")
        return data

    def load_build(self):
        if not isinstance(self.stack[-2], (NumericArrayWrapper, np.dtype)):
            raise pickle.UnpicklingError("Unsupported object state")
        super().load_build()
        if not isinstance(self.stack[-1], NumericArrayWrapper):
            return
        wrapper = self.stack.pop()
        if (wrapper.subclass is not np.ndarray or not isinstance(wrapper.dtype, np.dtype)
                or wrapper.dtype.hasobject or wrapper.dtype.kind not in "fiub"
                or wrapper.order not in ("C", "F")):
            raise pickle.UnpicklingError("Only numeric ndarrays are allowed")
        shape = wrapper.shape
        if (not isinstance(shape, tuple) or len(shape) > 4
                or any(type(n) is not int or not 0 <= n <= 100000 for n in shape)):
            raise pickle.UnpicklingError("Invalid array shape")
        size = math.prod(shape) * wrapper.dtype.itemsize
        if size > MAX_SAMPLE_BYTES:
            raise pickle.UnpicklingError("Array exceeds sample size limit")
        if getattr(wrapper, "numpy_array_alignment_bytes", None) is not None:
            padding = self.read_exact(1)[0]
            if padding > 64:
                raise pickle.UnpicklingError("Invalid array alignment")
            self.read_exact(padding)
        array = np.frombuffer(self.read_exact(size), dtype=wrapper.dtype)
        self.append(array.reshape(shape, order=wrapper.order))

    dispatch[pickle.BUILD[0]] = load_build


def download_prefix(path):
    request = urllib.request.Request(ARCHIVE_URL, headers={
        "Range": f"bytes=0-{PREFIX_BYTES - 1}", "Accept-Encoding": "identity",
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        expected_range = f"bytes 0-{PREFIX_BYTES - 1}/"
        if response.status != 206 or not response.headers.get("Content-Range", "").startswith(expected_range):
            raise ValueError("Server did not honor bounded Range request; stopped without reading body")
        data = response.read(PREFIX_BYTES + 1)
    if len(data) != PREFIX_BYTES:
        raise ValueError("Unexpected archive-prefix length")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def read_selected_records(prefix):
    if len(prefix) != PREFIX_BYTES or hashlib.sha256(prefix).hexdigest() != PREFIX_SHA256:
        raise ValueError("Prefix does not match the first 4 MiB of the pinned dataset release")
    decoder = zlib.decompressobj(wbits=31)
    raw = decoder.decompress(prefix, MAX_TAR_BYTES)
    if decoder.unconsumed_tail:
        raise ValueError("Decompression exceeded the bounded output limit")
    wanted = {f"OmniHuMo/omnihumo_v0/0602/{name}.pkl" for name, *_ in SELECTIONS}
    records = {}
    # Never extract filenames to disk. Only complete selected members are read.
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        for member in archive:
            if member.name not in wanted:
                continue
            if (not member.isfile() or member.size > MAX_SAMPLE_BYTES
                    or member.offset_data + member.size > len(raw)):
                raise ValueError(f"Invalid or incomplete sample: {member.name}")
            payload = archive.extractfile(member).read()
            records[member.name] = (
                RestrictedNumericReader(io.BytesIO(payload)).load(),
                hashlib.sha256(payload).hexdigest(),
            )
            if records.keys() == wanted:
                break
    if records.keys() != wanted:
        raise ValueError("Selected samples were not found in the archive prefix")
    return records


def axis_angle_matrix(vector):
    angle = float(np.linalg.norm(vector))
    if angle < 1e-12:
        return np.eye(3)
    x, y, z = vector / angle
    skew = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
    return np.eye(3) + math.sin(angle) * skew + (1 - math.cos(angle)) * (skew @ skew)


def forward_kinematics(rotations, translation):
    positions = np.empty((len(rotations), 22, 3), dtype=np.float64)
    for frame, frame_rotations in enumerate(rotations):
        world_rotations = np.empty((22, 3, 3), dtype=np.float64)
        for joint, parent in enumerate(PARENTS):
            local_rotation = axis_angle_matrix(frame_rotations[joint])
            if parent < 0:
                positions[frame, joint] = translation[frame]
                world_rotations[joint] = local_rotation
            else:
                positions[frame, joint] = positions[frame, parent] + world_rotations[parent] @ OFFSETS[joint]
                world_rotations[joint] = world_rotations[parent] @ local_rotation
    return positions


def export_sample(record, source_path, source_hash, tracking_id, sample_id, title):
    data = next(item for item in record["trackings"] if item["tracking_id"] == tracking_id)
    root = np.asarray(data["smpl_root_orient_wd"], dtype=np.float64)
    body = np.asarray(data["smpl_body_pose"], dtype=np.float64)
    translation = np.asarray(data["smpl_trans_wd"], dtype=np.float64)
    count = len(root)
    if root.shape != (count, 1, 3) or body.shape != (count, 21, 3) or translation.shape != (count, 3):
        raise ValueError("Unexpected recorded motion shape")
    if record["fps"] != 30 or not all(np.isfinite(array).all() for array in (root, body, translation)):
        raise ValueError("Unexpected frame rate or nonfinite motion values")
    rotations = np.concatenate([root, body], axis=1)
    positions = forward_kinematics(rotations, translation)
    # A single constant translation per clip preserves the recorded trajectory.
    shift = np.array([positions[0, 0, 0], positions[:, :, 1].min(), positions[0, 0, 2]])
    positions -= shift
    positions = positions[::2]  # Every other recorded frame: 30 -> 15 fps.
    return {
        "id": sample_id, "title": title, "caption": data["captions"][0],
        "sourcePath": source_path, "sourceSha256": source_hash,
        "trackingId": tracking_id, "sourceFps": 30, "fps": 15,
        "sourceFrameCount": count, "sourceDurationSeconds": round(count / 30, 4),
        "sourceFrameRange": data["frame_ids"], "frameStride": 2,
        "isDancing": data["is_dancing"], "isSpeaking": data["is_speaking"],
        "displayTranslation": np.round(-shift, 4).tolist(),
        "frames": np.round(positions, 4).tolist(),
        "rootPath": np.round(positions[:, 0], 4).tolist(),
    }


def make_bundle(prefix):
    records = read_selected_records(prefix)
    samples = []
    for name, tracking_id, sample_id, title in SELECTIONS:
        path = f"OmniHuMo/omnihumo_v0/0602/{name}.pkl"
        record, source_hash = records[path]
        samples.append(export_sample(record, path, source_hash, tracking_id, sample_id, title))
    return {
        "provenance": {
            "dataset": "OmniHuMo", "authors": "Yiheng Li et al.",
            "url": DATASET_URL, "revision": REVISION, "archive": ARCHIVE,
            "archiveUrl": ARCHIVE_URL, "compressedBytesRead": len(prefix),
            "archivePrefixSha256": hashlib.sha256(prefix).hexdigest(),
            "license": "CC BY-NC-SA 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
            "note": "Recorded joint rotations and root translations, visualized with approximate canonical skeleton proportions. Subject shape coefficients are not applied; this is not an exact SMPL mesh reconstruction.",
            "processing": "Rodrigues axis-angle (radians), 22-joint forward kinematics; one constant floor/origin translation per clip; 30 fps downsampled to 15 fps; coordinates rounded to 4 decimal places.",
            "selection": "Three illustrative recordings from the start of the first archive; not a random or representative dataset sample.",
            "coordinateSystem": "Y-up; X/Z ground plane; no per-frame recentering or orientation changes",
        },
        "jointNames": JOINT_NAMES,
        "bones": [[parent, joint] for joint, parent in enumerate(PARENTS) if parent >= 0],
        "skeleton": {"parents": PARENTS, "names": JOINT_NAMES, "offsets": OFFSETS.tolist(), "approximate": True},
        "samples": samples,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", type=Path, required=True, help="Local first-4-MiB gzip prefix")
    parser.add_argument("--download", action="store_true", help="Download the bounded prefix at the pinned revision")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "assets/data/omnihumo-samples.js")
    args = parser.parse_args()
    if args.download:
        download_prefix(args.prefix)
    if args.prefix.stat().st_size > PREFIX_BYTES:
        parser.error("Prefix must not exceed 4 MiB")
    bundle = make_bundle(args.prefix.read_bytes())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    header = "// Derived from OmniHuMo (Yiheng Li et al.), CC BY-NC-SA 4.0.\n// Recorded rotations; approximate canonical skeleton. See provenance below.\n"
    args.output.write_text(header + "window.OMNIHUMO_SAMPLES = " + json.dumps(bundle, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + ";\n", encoding="utf-8")
    print(f"Exported {len(bundle['samples'])} samples, {args.output.stat().st_size:,} bytes: {args.output}")


if __name__ == "__main__":
    main()
