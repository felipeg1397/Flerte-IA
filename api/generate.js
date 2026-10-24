const hits = new Map();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const key = ip + new Date().toISOString().slice(0, 10);
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  const limit = Number(process.env.DAILY_LIMIT || 40);
  if (n > limit) return res.status(429).json({ error: "Limite diário atingido. Volte amanhã!" });

  const { prompt, images = [] } = req.body || {};
  if (typeof prompt !== "string" || !prompt || prompt.length > 8000 || !Array.isArray(images) || images.length > 3) {
    return res.status(400).json({ error: "Pedido inválido" });
  }

  const models = [process.env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
  const parts = [{ text: prompt }, ...images.map((d) => ({ inlineData: { mimeType: "image/jpeg", data: d } }))];
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", temperature: 1 },
  });

  let last = null;
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body,
      });
      const j = await r.json();
      if (r.ok) {
        const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
        if (text) return res.status(200).json({ text });
        last = { status: 502, msg: "A IA não devolveu resposta." };
        continue;
      }
      console.error("Gemini erro", model, r.status, JSON.stringify(j).slice(0, 400));
      last = { status: r.status, msg: String(j.error?.message || "").slice(0, 150) };
      if (![429, 500, 503, 404].includes(r.status)) break; // erro de chave ou pedido: não adianta trocar de modelo
    } catch (e) {
      console.error(e);
      last = { status: 500, msg: "Falha de conexão." };
    }
  }

  const busy = last && [429, 503].includes(last.status);
  res.status(502).json({
    error: busy
      ? "A IA gratuita está com muita procura agora. Tente de novo em alguns instantes."
      : "Erro ao falar com a IA (" + (last?.status || "?") + "): " + (last?.msg || ""),
  });
};
