# Copyright (c) 2026, KQS
"""Pluggable vision/chat adapters: OpenAI, DeepSeek, Qwen (OpenAI-compatible)."""

from __future__ import annotations

import base64
import json
import re
from typing import Any

import frappe
from frappe import _

PROVIDERS = ("openai", "deepseek", "qwen")

DEFAULT_MODELS = {
	"openai": "gpt-4o",
	"deepseek": "deepseek-chat",
	"qwen": "qwen-vl-max",
}

DEFAULT_BASE_URLS = {
	"openai": "https://api.openai.com/v1",
	"deepseek": "https://api.deepseek.com",
	"qwen": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
}


def get_ai_config() -> dict[str, Any]:
	"""Resolve provider settings from KQS Retail Settings, then site_config."""
	provider = ""
	api_key = ""
	base_url = ""
	model = ""

	if frappe.db.exists("DocType", "KQS Retail Settings"):
		try:
			settings = frappe.get_single("KQS Retail Settings")
			provider = (settings.get("ai_provider") or "").strip().lower()
			base_url = (settings.get("ai_base_url") or "").strip()
			model = (settings.get("ai_model") or "").strip()
			try:
				api_key = (settings.get_password("ai_api_key", raise_exception=False) or "").strip()
			except Exception:
				api_key = ""
		except Exception:
			pass

	conf = frappe.conf or {}
	provider = provider or (conf.get("kqs_ai_provider") or "").strip().lower()
	api_key = api_key or (conf.get("kqs_ai_api_key") or conf.get("openai_api_key") or "").strip()
	base_url = base_url or (conf.get("kqs_ai_base_url") or "").strip()
	model = model or (conf.get("kqs_ai_model") or "").strip()

	if provider and provider not in PROVIDERS:
		frappe.throw(_("Unknown AI provider {0}. Use openai, deepseek, or qwen.").format(provider))

	if not provider and api_key:
		provider = "openai"

	return {
		"provider": provider,
		"api_key": api_key,
		"base_url": (base_url or DEFAULT_BASE_URLS.get(provider, "")).rstrip("/"),
		"model": model or DEFAULT_MODELS.get(provider, ""),
		"configured": bool(provider and api_key),
	}


def complete_vision(prompt: str, image_bytes_list: list[bytes], mime_types: list[str] | None = None) -> str:
	"""Send text + images to the configured provider; return assistant text."""
	cfg = get_ai_config()
	if not cfg["configured"]:
		frappe.throw(
			_("AI is not configured. Set provider and API key under KQS Retail Settings, or use CSV import.")
		)

	mime_types = mime_types or ["image/jpeg"] * len(image_bytes_list)
	content: list[dict] = [{"type": "text", "text": prompt}]
	for raw, mime in zip(image_bytes_list, mime_types, strict=False):
		b64 = base64.b64encode(raw).decode("ascii")
		content.append(
			{
				"type": "image_url",
				"image_url": {"url": f"data:{mime};base64,{b64}"},
			}
		)

	payload = {
		"model": cfg["model"],
		"messages": [
			{
				"role": "system",
				"content": (
					"You extract retail stock lists from photos of handwritten or printed pages. "
					"Return ONLY valid JSON matching the schema in the user message."
				),
			},
			{"role": "user", "content": content},
		],
		"temperature": 0.1,
	}

	return _chat_completions(cfg, payload)


def complete_chat(
	prompt: str,
	*,
	system: str = "",
	temperature: float = 0.1,
	timeout: int = 90,
) -> str:
	"""Text-only chat completion via the configured OpenAI-compatible provider."""
	cfg = get_ai_config()
	if not cfg["configured"]:
		frappe.throw(
			_("AI is not configured. Set provider and API key under KQS Retail Settings.")
		)

	messages = []
	if system:
		messages.append({"role": "system", "content": system})
	messages.append({"role": "user", "content": prompt})

	payload = {
		"model": cfg["model"],
		"messages": messages,
		"temperature": temperature,
	}
	return _chat_completions(cfg, payload, timeout=timeout)


def _chat_completions(cfg: dict[str, Any], payload: dict, timeout: int = 180) -> str:
	url = f"{cfg['base_url']}/chat/completions"
	headers = {
		"Authorization": f"Bearer {cfg['api_key']}",
		"Content-Type": "application/json",
	}

	try:
		import requests

		resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
		if resp.status_code >= 400:
			frappe.throw(
				_("AI provider error ({0}): {1}").format(resp.status_code, (resp.text or "")[:240])
			)
		response = resp.json()
	except frappe.ValidationError:
		raise
	except Exception as exc:
		frappe.throw(_("AI provider request failed: {0}").format(str(exc)[:200]))

	try:
		return response["choices"][0]["message"]["content"]
	except (KeyError, IndexError, TypeError):
		frappe.throw(_("AI provider returned an unexpected response."))


def parse_json_from_ai_text(text: str) -> Any:
	"""Extract JSON object/array from model output (handles markdown fences)."""
	text = (text or "").strip()
	if not text:
		frappe.throw(_("AI returned empty content."))

	fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
	if fence:
		text = fence.group(1).strip()

	try:
		return json.loads(text)
	except json.JSONDecodeError:
		start = text.find("{")
		end = text.rfind("}")
		if start >= 0 and end > start:
			return json.loads(text[start : end + 1])
		start = text.find("[")
		end = text.rfind("]")
		if start >= 0 and end > start:
			return json.loads(text[start : end + 1])
		frappe.throw(_("Could not parse JSON from AI response."))
