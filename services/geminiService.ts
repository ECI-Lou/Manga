
import { GoogleGenAI, Type } from "@google/genai";
import { CastMember, AnalysisResult, DialogueLine, LLMSettings } from "../types";

export const analyzeMangaPages = async (
  images: string[], // Base64 strings
  cast: CastMember[],
  settings: LLMSettings
): Promise<AnalysisResult> => {
  
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
- Return the result as a raw JSON array of objects with 'role' and 'dialogue' properties. Do not wrap in markdown code blocks.
`;

  // --- BRANCH 1: GOOGLE GENAI (GEMINI) ---
  if (settings.provider === 'google') {
    // Always use {apiKey: process.env.API_KEY} for initialization as per strict guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const prompt = `Identify speakers and transcribe text from these manga pages using the cast description. Return as JSON.`;

    const imageParts = images.map(img => ({
      inlineData: {
        mimeType: 'image/png',
        data: img.split(',')[1] || img
      }
    }));

    try {
      const response = await ai.models.generateContent({
        model: settings.modelId,
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

      const rawText = response.text;
      if (!rawText) throw new Error("Empty response from model");
      
      const lines: DialogueLine[] = JSON.parse(rawText);
      
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
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      throw error;
    }
  }

  // --- BRANCH 2: CUSTOM / OPENROUTER (OpenAI Compatible) ---
  else {
    if (!settings.baseUrl || !settings.apiKey) {
      throw new Error("Base URL and API Key are required for OpenRouter/Custom models.");
    }

    // Construct OpenAI-compatible message format
    const contentPayload: any[] = [
      { type: "text", text: "Identify speakers and transcribe text. Return ONLY a raw JSON array." }
    ];

    images.forEach(img => {
      contentPayload.push({
        type: "image_url",
        image_url: {
          url: img // OpenRouter/OpenAI expects data URI
        }
      });
    });

    const messages = [
      { role: "system", content: systemInstruction },
      { role: "user", content: contentPayload }
    ];

    try {
      // Normalize Base URL
      // If it's just the host (e.g. openrouter.ai/api/v1), ensure it ends with /chat/completions
      let url = settings.baseUrl;
      if (!url.includes('/chat/completions')) {
         url = url.replace(/\/+$/, '') + '/chat/completions';
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`,
          // OpenRouter specific headers
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
          'X-Title': 'Manga Attribution Assistant'
        },
        body: JSON.stringify({
          model: settings.modelId,
          messages: messages,
          temperature: 0.1,
          // We removed response_format: { type: "json_object" } because openrouter/auto 
          // might select a model that doesn't support it. We rely on system prompt.
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Provider API Error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const rawContent = data.choices?.[0]?.message?.content;
      
      if (!rawContent) throw new Error("Empty response from custom provider");

      // Attempt to clean markdown code blocks if present (common with OpenRouter models)
      const cleanJson = rawContent.replace(/```json\n?|```/g, '').trim();
      
      let lines: DialogueLine[];
      // Handle potential wrapping object like { "lines": [...] } or raw array
      try {
        const parsed = JSON.parse(cleanJson);
        lines = Array.isArray(parsed) ? parsed : (parsed.lines || []);
      } catch (e) {
        console.error("Failed to parse JSON:", cleanJson);
        throw new Error("Failed to parse JSON response. The model might have returned unstructured text.");
      }

      return {
        lines,
        usage: {
          promptTokenCount: data.usage?.prompt_tokens || 0,
          candidatesTokenCount: data.usage?.completion_tokens || 0,
          totalTokenCount: data.usage?.total_tokens || 0
        }
      };

    } catch (error: any) {
      console.error("Custom/OpenRouter API Error:", error);
      throw error;
    }
  }
};
