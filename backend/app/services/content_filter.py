"""
Content filtering service: detects and masks sensitive words in AI-generated content.
"""
import re
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "sensitive_words.json"

_DEFAULT_PATTERNS = {
    "political": ["政治敏感", "某某党", "某某领导"],
    "violence": ["暴力", "恐怖", "血腥"],
    "adult": ["色情", "黄色"],
    "discrimination": ["歧视", "种族"],
}


class ContentFilter:
    def __init__(self):
        self.patterns: dict[str, list[str]] = {}
        self.enabled = True
        self._load_config()

    def _load_config(self):
        """Load sensitive word patterns from config file or use defaults."""
        if _CONFIG_PATH.exists():
            try:
                data = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
                self.patterns = data.get("patterns", _DEFAULT_PATTERNS)
                self.enabled = data.get("enabled", True)
                logger.info(f"Loaded content filter config: {len(self.patterns)} categories")
            except Exception as e:
                logger.warning(f"Failed to load filter config: {e}, using defaults")
                self.patterns = _DEFAULT_PATTERNS
        else:
            self.patterns = _DEFAULT_PATTERNS
            _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            _CONFIG_PATH.write_text(
                json.dumps(
                    {
                        "enabled": True,
                        "patterns": _DEFAULT_PATTERNS,
                        "description": "Add regex patterns for each category",
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

    def filter_text(self, text: str) -> tuple[str, list[str]]:
        """
        Filter sensitive content from text.

        Returns:
            (filtered_text, detected_words)
        """
        if not self.enabled:
            return text, []

        detected: list[str] = []
        filtered = text

        for category, keywords in self.patterns.items():
            for keyword in keywords:
                if keyword in filtered:
                    detected.append(f"{category}:{keyword}")
                    filtered = filtered.replace(keyword, "***")

        return filtered, detected

    def check_text(self, text: str) -> dict[str, Any]:
        """
        Check text for sensitive content without modifying it.

        Returns dict with:
          - has_sensitive: bool
          - detected: list of detected patterns
          - categories: list of affected categories
        """
        if not self.enabled:
            return {"has_sensitive": False, "detected": [], "categories": []}

        detected: list[str] = []
        categories: set[str] = set()

        for category, keywords in self.patterns.items():
            for keyword in keywords:
                if keyword in text:
                    detected.append(keyword)
                    categories.add(category)

        return {
            "has_sensitive": len(detected) > 0,
            "detected": detected,
            "categories": list(categories),
        }


content_filter = ContentFilter()
