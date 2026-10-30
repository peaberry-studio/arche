# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy==2.5.4", "onnx==1.23.2", "tokenizers==0.23.3"]
#
# [tool.uv]
# exclude-newer = "2026-10-27T00:00:00Z"
# ///
"""Builds the Spanish/English KB search model from paraphrase-multilingual-MiniLM-L12-v2.

The multilingual vocabulary (250k tokens) is most of the model's memory once loaded. This keeps
only the tokens that Spanish and English words produce, plus Latin characters, digits and
punctuation, so any text still tokenizes. Kept tokens keep their order and weights, so a text
whose tokens are all kept embeds exactly as with the original model.

usage: uv run scripts/trim-kb-search-model.py <out_dir>
"""
import copy
import hashlib
import json
import pathlib
import sys
import unicodedata
import urllib.request

import numpy as np
import onnx
from onnx import numpy_helper
from tokenizers import Tokenizer

SOURCE_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
SOURCE_REVISION = "2c4055b12046f11709e9df2c122e59ffbdc2f900"
SOURCE_FILES = {
    "config.json": "05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7",
    "tokenizer.json": "b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441",
    "tokenizer_config.json": "3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2",
    "onnx/model_quantized.onnx": "66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc",
}
# Word frequencies from OpenSubtitles 2018 (hermitdave/FrequencyWords, CC-BY-SA-4.0).
WORD_LIST_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/{language}/{language}_full.txt"
WORD_LISTS = {
    "es": "b4794c425f3500c21a0ff9367175e36795a978c928a36670e9ad6ae206fb7728",
    "en": "7fea67ab954e2c01df6c608c9826e594cf36f8823b3243554f88245fb75dc506",
}
WORDS_PER_LANGUAGE = 200_000
SPECIAL_IDS = [0, 1, 2, 3]  # <s> <pad> </s> <unk> keep their ids
MASK_ID = 250_001
EMBEDDING_INITIALIZER = "embeddings.word_embeddings.weight_quantized"


def download(url: str, sha256: str) -> bytes:
    with urllib.request.urlopen(url) as response:
        content = response.read()
    digest = hashlib.sha256(content).hexdigest()
    if digest != sha256:
        raise ValueError(f"{url} has SHA-256 {digest}, expected {sha256}")
    return content


def common_words() -> list[str]:
    words: list[str] = []
    for language, sha256 in WORD_LISTS.items():
        lines = download(WORD_LIST_URL.format(language=language), sha256).decode("utf-8").splitlines()
        words.extend(line.split(" ")[0] for line in lines[:WORDS_PER_LANGUAGE])
    return words


def word_variants(word: str) -> list[str]:
    # Each casing on its own and glued after other text (CamelCase, paths, hyphenated words).
    cased = [word, word.capitalize(), word.upper()]
    return cased + [f"-{variant}" for variant in cased]


def is_kept_character(character: str) -> bool:
    return not character.isalpha() or unicodedata.name(character, "").startswith("LATIN")


def base_token_ids(vocab: list[list]) -> set[int]:
    kept = set(SPECIAL_IDS) | {MASK_ID}
    for token_id, (piece, _score) in enumerate(vocab):
        body = piece.removeprefix("▁")
        if len(body) <= 1 and all(is_kept_character(character) for character in body):
            kept.add(token_id)
        elif len(body) <= 4 and not any(character.isalpha() for character in body):
            kept.add(token_id)
    return kept


def kept_token_ids(tokenizer: Tokenizer, vocab: list[list], words: list[str]) -> list[int]:
    kept = base_token_ids(vocab)
    texts = [variant for word in words for variant in word_variants(word)]
    for start in range(0, len(texts), 20_000):
        for encoding in tokenizer.encode_batch(texts[start:start + 20_000], add_special_tokens=False):
            kept.update(encoding.ids)
    return sorted(kept)


def trimmed_tokenizer(tokenizer_json: dict, kept: list[int]) -> dict:
    new_ids = {old_id: new_id for new_id, old_id in enumerate(kept)}
    trimmed = copy.deepcopy(tokenizer_json)
    trimmed["model"]["vocab"] = [tokenizer_json["model"]["vocab"][old_id] for old_id in kept]
    for added in trimmed["added_tokens"]:
        added["id"] = new_ids[added["id"]]
    return trimmed


def trimmed_model(model_bytes: bytes, kept: list[int]) -> onnx.ModelProto:
    model = onnx.load_model_from_string(model_bytes)
    for initializer in model.graph.initializer:
        if initializer.name == EMBEDDING_INITIALIZER:
            rows = numpy_helper.to_array(initializer)[np.array(kept)]
            initializer.CopyFrom(numpy_helper.from_array(rows, initializer.name))
            return model
    raise ValueError(f"{EMBEDDING_INITIALIZER} not found in the source model")


def main(out_dir: pathlib.Path) -> None:
    base_url = f"https://huggingface.co/{SOURCE_MODEL}/resolve/{SOURCE_REVISION}"
    source = {path: download(f"{base_url}/{path}", sha256) for path, sha256 in SOURCE_FILES.items()}
    tokenizer_json = json.loads(source["tokenizer.json"])
    tokenizer = Tokenizer.from_str(source["tokenizer.json"].decode("utf-8"))
    kept = kept_token_ids(tokenizer, tokenizer_json["model"]["vocab"], common_words())
    if kept[: len(SPECIAL_IDS)] != SPECIAL_IDS:
        raise ValueError("special tokens must keep their ids")

    config = json.loads(source["config.json"])
    config["vocab_size"] = len(kept)
    outputs = {
        "config.json": json.dumps(config, indent=2).encode("utf-8"),
        "tokenizer.json": json.dumps(trimmed_tokenizer(tokenizer_json, kept), ensure_ascii=False).encode("utf-8"),
        "tokenizer_config.json": source["tokenizer_config.json"],
        "onnx/model_quantized.onnx": trimmed_model(source["onnx/model_quantized.onnx"], kept).SerializeToString(),
    }
    for path, content in outputs.items():
        target = out_dir / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        print(f"{hashlib.sha256(content).hexdigest()}  {path}")
    print(f"vocabulary {len(tokenizer_json['model']['vocab'])} -> {len(kept)} tokens")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(pathlib.Path(sys.argv[1]))
