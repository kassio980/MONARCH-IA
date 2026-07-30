const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function gerarResposta(prompt, systemPrompt = "") {
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: `${systemPrompt}\n\n${prompt}`,
    });

    return response.text || "Não consegui gerar uma resposta.";
  } catch (error) {
    console.error("Erro Gemini:", error);
    return "Ocorreu um erro ao gerar a resposta.";
  }
}

module.exports = {
  gerarResposta,
};
