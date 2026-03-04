import base64
import json as _json
import re
from settings import settings

STUB = {
    "items": [{"name": "Unknown meal", "confidence": 0.0}],
    "estimated_calories": None,
    "estimated_macros": None,
    "water_ml": None,
    "notes": "REKA not configured — add REKA_API_KEY to enable meal vision analysis.",
    "stub": True,
}

PROMPT = (
    "You are a professional nutritionist. Analyze this meal photo carefully.\n"
    "Return ONLY a valid JSON object (no markdown, no extra text) with exactly these fields:\n"
    "{\n"
    '  "items": [{"name": "food name", "confidence": 0.0-1.0, "portion": "estimated portion size"}],\n'
    '  "estimated_calories": <integer kcal>,\n'
    '  "estimated_macros": {"protein_g": <int>, "carbs_g": <int>, "fat_g": <int>, "fiber_g": <int>, "sugar_g": <int>},\n'
    '  "water_ml": <int if drink visible else null>,\n'
    '  "notes": "one-line nutrition insight"\n'
    "}\n"
    "Be specific with portion estimates (e.g. '1 cup', '200g', '1 medium bowl')."
)


def _parse_content(content: str) -> dict:
    """Extract JSON from model response, handling markdown fences."""
    text = content.strip()
    # Strip ```json ... ``` fences
    fenced = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if fenced:
        text = fenced.group(1).strip()
    # Find first {...} block
    brace = re.search(r"\{[\s\S]+\}", text)
    if brace:
        text = brace.group(0)
    return _json.loads(text)


async def analyze_food_image(image_bytes: bytes) -> dict:
    if not settings.REKA_API_KEY:
        return STUB

    try:
        from reka.client import AsyncReka

        b64 = base64.b64encode(image_bytes).decode()
        data_url = f"data:image/jpeg;base64,{b64}"

        client = AsyncReka(api_key=settings.REKA_API_KEY)
        resp = await client.chat.create(
            model="reka-flash",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": data_url},
                        {"type": "text", "text": PROMPT},
                    ],
                }
            ],
        )
        content = resp.responses[0].message.content
        parsed = _parse_content(content)
        parsed.setdefault("stub", False)
        parsed.setdefault("water_ml", None)
        # Ensure macros has all fields
        macros = parsed.get("estimated_macros") or {}
        macros.setdefault("fiber_g", 0)
        macros.setdefault("sugar_g", 0)
        parsed["estimated_macros"] = macros
        return parsed

    except Exception as exc:
        return {
            "items": [{"name": "Parse error", "confidence": 0.0}],
            "estimated_calories": None,
            "estimated_macros": None,
            "water_ml": None,
            "notes": f"Reka error: {exc}",
            "stub": True,
        }


async def analyze_food_text(description: str) -> dict:
    """Estimate nutrition from a text description of food (no image)."""
    if not settings.OPENAI_API_KEY and not settings.REKA_API_KEY:
        return STUB

    prompt = (
        f"A user ate: {description}\n\n"
        "You are a nutritionist. Estimate the nutrition for this food.\n"
        "Return ONLY valid JSON:\n"
        "{\n"
        '  "items": [{"name": "food name", "confidence": 0.85, "portion": "estimated portion"}],\n'
        '  "estimated_calories": <integer>,\n'
        '  "estimated_macros": {"protein_g": <int>, "carbs_g": <int>, "fat_g": <int>, "fiber_g": <int>, "sugar_g": <int>},\n'
        '  "water_ml": null,\n'
        '  "notes": "brief insight"\n'
        "}"
    )

    try:
        if settings.OPENAI_API_KEY:
            import openai
            client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
            r = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            parsed = _json.loads(r.choices[0].message.content)
        else:
            from reka.client import AsyncReka
            client = AsyncReka(api_key=settings.REKA_API_KEY)
            r = await client.chat.create(
                model="reka-flash",
                messages=[{"role": "user", "content": prompt}],
            )
            parsed = _parse_content(r.responses[0].message.content)

        parsed.setdefault("stub", False)
        parsed.setdefault("water_ml", None)
        macros = parsed.get("estimated_macros") or {}
        macros.setdefault("fiber_g", 0)
        macros.setdefault("sugar_g", 0)
        parsed["estimated_macros"] = macros
        return parsed
    except Exception as exc:
        return {
            "items": [{"name": description[:40], "confidence": 0.5}],
            "estimated_calories": None,
            "estimated_macros": None,
            "water_ml": None,
            "notes": f"Could not estimate: {exc}",
            "stub": True,
        }
