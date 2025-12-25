
import { GoogleGenAI, Type } from "@google/genai";
import { CastMember, AnalysisResult, DialogueLine } from "../types";

export const analyzeMangaPages = async (
  images: string[], // Base64 strings
  cast: CastMember[]
): Promise<AnalysisResult> => {
  // Always use {apiKey: process.env.API_KEY} for initialization
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const castDescription = cast.map(c => `- ${c.name}: ${c.description}`).join('\n');
  
  const systemInstruction = `
You are a manga dialogue attribution assistant.
Given one or more manga page images and a fixed cast description, you must:
1) Identify which character is speaking for each dialogue balloon/text box based ONLY on visual evidence.
2) Transcribe the exact text from the image for each balloon/text box.
3) Output each line as: "Role: Dialogue" (one line per balloon/text box), in reading order.

Cast:
${castDescription}

Strict rules:
- Use ONLY the provided cast names or "UNKNOWN" if unsure.
- Do NOT rewrite or correct dialogue.
- Follow Japanese manga reading order (right-to-left, top-to-bottom).
- Use "SFX" for sound effects if included.
- Return the result as a JSON array of objects with 'role' and 'dialogue' properties.
`;

  const prompt = `Identify speakers and transcribe text from these manga pages using the cast description. Return as JSON.`;

  const imageParts = images.map(img => ({
    inlineData: {
      mimeType: 'image/png', // Assume PNG or similar compatible
      data: img.split(',')[1] || img // Strip data URL prefix if present
    }
  }));

  // Upgraded to gemini-3-pro-preview for complex OCR and character attribution reasoning
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        { text: prompt },
        ...imageParts
      ]
    },
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            role: { type: Type.STRING },
            dialogue: { type: Type.STRING }
          },
          required: ['role', 'dialogue']
        }
      }
    }
  });

  // Extract generated text directly from response.text property
  const rawText = response.text;
  const lines: DialogueLine[] = JSON.parse(rawText || "[]");
  
  // Extract token usage from usageMetadata property
  const usage = response.usageMetadata || {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0
  };

  return {
    lines,
    usage: {
      promptTokenCount: usage.promptTokenCount,
      candidatesTokenCount: usage.candidatesTokenCount,
      totalTokenCount: usage.totalTokenCount
    }
  };
};
