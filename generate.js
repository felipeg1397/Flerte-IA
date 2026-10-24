const hits = new Map();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  // Limite diário por visitante (simples; pode reiniciar quando o servidor reinicia)
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

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const parts = [{ text: prompt }, ...images.map((d) => ({ inlineData: { mimeType: "image/jpeg", data: d } }))];

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 1 },
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error("Gemini erro", r.status, JSON.stringify(j).slice(0, 500));
      return res.status(502).json({ error: r.status === 429 ? "A IA gratuita está no limite agora. Tente em instantes." : "Erro ao falar com a IA." });
    }
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (!text) return res.status(502).json({ error: "A IA não devolveu resposta. Tente de novo." });
    res.status(200).json({ text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro inesperado. Tente de novo." });
  }
};
