import httpx
from settings import settings

TAVILY_URL = "https://api.tavily.com/search"

STUB = {
    "answer": "Tavily not configured — add TAVILY_API_KEY to enable live web search.",
    "results": [],
    "stub": True,
}


async def tavily_search(query: str) -> dict:
    if not settings.TAVILY_API_KEY:
        return STUB

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                TAVILY_URL,
                json={
                    "api_key": settings.TAVILY_API_KEY,
                    "query": query,
                    "search_depth": "basic",
                    "max_results": 5,
                    "include_answer": True,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "answer": data.get("answer", ""),
                "results": [
                    {
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "content": r.get("content", "")[:300],
                    }
                    for r in data.get("results", [])
                ],
                "stub": False,
            }
    except Exception as exc:
        return {"answer": f"Tavily error: {exc}", "results": [], "stub": True}
