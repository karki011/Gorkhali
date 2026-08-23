#!/usr/bin/env python3
"""
Caveman Memory Compression Orchestrator

Usage:
    python scripts/compress.py <filepath>
"""

import os
import re
import subprocess
from pathlib import Path
from typing import List

OUTER_FENCE_REGEX = re.compile(
    r"\A\s*(`{3,}|~{3,})[^\n]*\n(.*)\n\1\s*\Z", re.DOTALL
)

# Filenames and paths that almost certainly hold secrets or PII. Compressing
# them ships raw bytes to the active provider's API (Anthropic by default,
# Moonshot/Kimi when GORKHALI_COMPRESS_PROVIDER=kimi) — a third-party data
# boundary that developers on sensitive codebases cannot cross. detect.py
# already skips .env by extension, but credentials.md / secrets.txt /
# ~/.aws/credentials would slip through the natural-language filter. This is a
# hard refuse before read.
SENSITIVE_BASENAME_REGEX = re.compile(
    r"(?ix)^("
    r"\.env(\..+)?"
    r"|\.netrc"
    r"|credentials(\..+)?"
    r"|secrets?(\..+)?"
    r"|passwords?(\..+)?"
    r"|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?"
    r"|authorized_keys"
    r"|known_hosts"
    r"|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg)"
    r")$"
)

SENSITIVE_PATH_COMPONENTS = frozenset({".ssh", ".aws", ".gnupg", ".kube", ".docker"})

SENSITIVE_NAME_TOKENS = (
    "secret", "credential", "password", "passwd",
    "apikey", "accesskey", "token", "privatekey",
)


def is_sensitive_path(filepath: Path) -> bool:
    """Heuristic denylist for files that must never be shipped to a third-party API."""
    name = filepath.name
    if SENSITIVE_BASENAME_REGEX.match(name):
        return True
    lowered_parts = {p.lower() for p in filepath.parts}
    if lowered_parts & SENSITIVE_PATH_COMPONENTS:
        return True
    # Normalize separators so "api-key" and "api_key" both match "apikey".
    lower = re.sub(r"[_\-\s.]", "", name.lower())
    return any(tok in lower for tok in SENSITIVE_NAME_TOKENS)


def strip_llm_wrapper(text: str) -> str:
    """Strip outer ```markdown ... ``` fence when it wraps the entire output."""
    m = OUTER_FENCE_REGEX.match(text)
    if m:
        return m.group(2)
    return text

from .detect import should_compress
from .validate import validate

MAX_RETRIES = 2

# ---------- Provider selection ----------
#
# GORKHALI_COMPRESS_PROVIDER picks the LLM backend: "claude" (default — the
# original behavior below) or "kimi" (Moonshot AI's Kimi, OpenAI-compatible
# API). When "kimi" is selected the Anthropic SDK is never imported and the
# claude CLI is never spawned: no request may leave for Anthropic or OpenAI
# on that path.
COMPRESS_PROVIDER = os.environ.get("GORKHALI_COMPRESS_PROVIDER", "claude")
PROVIDER_LABEL = {"claude": "Claude", "kimi": "Kimi"}.get(COMPRESS_PROVIDER, COMPRESS_PROVIDER)


# ---------- Claude Calls ----------


def call_claude(prompt: str) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            msg = client.messages.create(
                model=os.environ.get("CAVEMAN_MODEL", "claude-sonnet-4-5"),
                max_tokens=8192,
                messages=[{"role": "user", "content": prompt}],
            )
            return strip_llm_wrapper(msg.content[0].text.strip())
        except ImportError:
            pass  # anthropic not installed, fall back to CLI
    # Fallback: use claude CLI (handles desktop auth)
    try:
        result = subprocess.run(
            ["claude", "--print"],
            input=prompt,
            text=True,
            capture_output=True,
            check=True,
        )
        return strip_llm_wrapper(result.stdout.strip())
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Claude call failed:\n{e.stderr}")


# ---------- Kimi Calls ----------


def call_kimi(prompt: str) -> str:
    """Kimi backend: plain HTTPS to the OpenAI-compatible chat/completions API.

    urllib only, so no new pip dependency is introduced. Base URL overridable
    via KIMI_BASE_URL (default https://api.moonshot.ai/v1, the Kimi Platform
    pay-per-token API; the CN region uses https://api.moonshot.cn/v1), bearer
    from MOONSHOT_API_KEY or KIMI_API_KEY, model from KIMI_MODEL (default
    kimi-k3). A Kimi Code console key instead pairs with
    KIMI_BASE_URL=https://api.kimi.com/coding/v1 and KIMI_MODEL=k3-256k.

    Note the two Kimi identifier spaces: this backend targets the platform
    APIs, whose model IDs are `kimi-k3` etc. The Kimi Code CLI product
    (host preset in skills/gorkhali/references/model-presets.json) uses `k3`,
    `k3-256k`, and `kimi-for-coding` instead — do not mix them.
    """
    api_key = os.environ.get("MOONSHOT_API_KEY") or os.environ.get("KIMI_API_KEY")
    if api_key:
        import json
        import urllib.request

        base = os.environ.get("KIMI_BASE_URL", "https://api.moonshot.ai/v1").rstrip("/")
        req = urllib.request.Request(
            f"{base}/chat/completions",
            data=json.dumps({
                "model": os.environ.get("KIMI_MODEL", "kimi-k3"),
                "max_tokens": 8192,
                "messages": [{"role": "user", "content": prompt}],
            }).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return strip_llm_wrapper(payload["choices"][0]["message"]["content"].strip())
    # Fallback: the kimi CLI's headless print mode, `kimi -p <prompt>` (flags
    # verified against `kimi --help`, kimi-code 0.38.0). If kimi is not
    # installed this raises FileNotFoundError — set MOONSHOT_API_KEY or
    # KIMI_API_KEY instead. There is intentionally no claude fallback here:
    # provider=kimi must never route a request to Anthropic or OpenAI.
    try:
        result = subprocess.run(
            ["kimi", "-p", prompt],
            text=True,
            capture_output=True,
            check=True,
        )
        return strip_llm_wrapper(result.stdout.strip())
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Kimi call failed:\n{e.stderr}")


def call_llm(prompt: str) -> str:
    """Dispatch to the backend named by GORKHALI_COMPRESS_PROVIDER."""
    if COMPRESS_PROVIDER == "kimi":
        return call_kimi(prompt)
    if COMPRESS_PROVIDER == "claude":
        return call_claude(prompt)
    raise ValueError(
        f"Unknown GORKHALI_COMPRESS_PROVIDER: {COMPRESS_PROVIDER!r} "
        "(expected 'claude' or 'kimi')"
    )


def build_compress_prompt(original: str) -> str:
    return f"""
Compress this markdown into caveman format.

STRICT RULES:
- Do NOT modify anything inside ``` code blocks
- Do NOT modify anything inside inline backticks
- Preserve ALL URLs exactly
- Preserve ALL headings exactly
- Preserve file paths and commands
- Return ONLY the compressed markdown body — do NOT wrap the entire output in a ```markdown fence or any other fence. Inner code blocks from the original stay as-is; do not add a new outer fence around the whole file.

Only compress natural language.

TEXT:
{original}
"""


def build_fix_prompt(original: str, compressed: str, errors: List[str]) -> str:
    errors_str = "\n".join(f"- {e}" for e in errors)
    return f"""You are fixing a caveman-compressed markdown file. Specific validation errors were found.

CRITICAL RULES:
- DO NOT recompress or rephrase the file
- ONLY fix the listed errors — leave everything else exactly as-is
- The ORIGINAL is provided as reference only (to restore missing content)
- Preserve caveman style in all untouched sections

ERRORS TO FIX:
{errors_str}

HOW TO FIX:
- Missing URL: find it in ORIGINAL, restore it exactly where it belongs in COMPRESSED
- Code block mismatch: find the exact code block in ORIGINAL, restore it in COMPRESSED
- Heading mismatch: restore the exact heading text from ORIGINAL into COMPRESSED
- Do not touch any section not mentioned in the errors

ORIGINAL (reference only):
{original}

COMPRESSED (fix this):
{compressed}

Return ONLY the fixed compressed file. No explanation.
"""


# ---------- Core Logic ----------


def compress_file(filepath: Path) -> bool:
    # Resolve and validate path
    filepath = filepath.resolve()
    MAX_FILE_SIZE = 500_000  # 500KB
    if not filepath.exists():
        raise FileNotFoundError(f"File not found: {filepath}")
    if filepath.stat().st_size > MAX_FILE_SIZE:
        raise ValueError(f"File too large to compress safely (max 500KB): {filepath}")

    # Refuse files that look like they contain secrets or PII. Compressing ships
    # the raw bytes to the active provider's API — a third-party boundary — so we
    # fail loudly rather than silently exfiltrate credentials or keys. Override is
    # intentional: the user must rename the file if the heuristic is wrong.
    if is_sensitive_path(filepath):
        raise ValueError(
            f"Refusing to compress {filepath}: filename looks sensitive "
            "(credentials, keys, secrets, or known private paths). "
            f"Compression sends file contents to the {PROVIDER_LABEL} API. "
            "Rename the file if this is a false positive."
        )

    print(f"Processing: {filepath}")

    if not should_compress(filepath):
        print("Skipping (not natural language)")
        return False

    original_text = filepath.read_text(errors="ignore")
    backup_path = filepath.with_name(filepath.stem + ".original.md")

    if not original_text.strip():
        print("❌ Refusing to compress: file is empty or whitespace-only.")
        return False

    # Check if backup already exists to prevent accidental overwriting
    if backup_path.exists():
        print(f"⚠️ Backup file already exists: {backup_path}")
        print("The original backup may contain important content.")
        print("Aborting to prevent data loss. Please remove or rename the backup file if you want to proceed.")
        return False

    # Step 1: Compress
    print(f"Compressing with {PROVIDER_LABEL}...")
    compressed = call_llm(build_compress_prompt(original_text))

    if compressed is None or not compressed.strip():
        print(f"❌ Compression aborted: {PROVIDER_LABEL} returned an empty response.")
        print("   Original file is untouched (no backup created).")
        return False

    if compressed.strip() == original_text.strip():
        print("❌ Compression aborted: output is identical to input.")
        print(f"   Likely causes: {PROVIDER_LABEL} refused, returned the prompt verbatim, or the file is")
        print("   already in caveman form. Original file is untouched (no backup created).")
        return False

    # Save original as backup, then verify the backup readback before
    # touching the input file. If the filesystem dropped bytes (encoding,
    # antivirus, disk full), unlink the bad backup and abort instead of
    # leaving the user with a corrupt backup + compressed primary.
    backup_path.write_text(original_text)
    backup_readback = backup_path.read_text(errors="ignore")
    if backup_readback != original_text:
        print(f"❌ Backup write verification failed: {backup_path}")
        print("   In-memory original differs from on-disk backup. Aborting before touching the input file.")
        try:
            backup_path.unlink()
        except OSError:
            pass
        return False
    filepath.write_text(compressed)

    # Step 2: Validate + Retry
    for attempt in range(MAX_RETRIES):
        print(f"\nValidation attempt {attempt + 1}")

        result = validate(backup_path, filepath)

        if result.is_valid:
            print("Validation passed")
            break

        print("❌ Validation failed:")
        for err in result.errors:
            print(f"   - {err}")

        if attempt == MAX_RETRIES - 1:
            # Restore original on failure
            filepath.write_text(original_text)
            backup_path.unlink(missing_ok=True)
            print("❌ Failed after retries — original restored")
            return False

        print(f"Fixing with {PROVIDER_LABEL}...")
        try:
            compressed = call_llm(
                build_fix_prompt(original_text, compressed, result.errors)
            )
        except Exception:
            # A provider error mid-retry must not strand the source file in an
            # invalid compressed state: restore the original before raising.
            filepath.write_text(original_text)
            backup_path.unlink(missing_ok=True)
            print("❌ Retry call failed — original restored")
            raise
        filepath.write_text(compressed)

    return True
