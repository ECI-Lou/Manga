
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

Cast Reference:
${castDescription}

Task:
Extract ONLY dialogue balloons and narration/caption text from a manga page image.
For each balloon/box, transcribe the text and output a normalized bounding box in [0..1000].
Identify the speaker (role) using the Cast Reference.

CRITICAL: bbox1000 MUST be normalized from ORIGINAL PIXEL coordinates of the INPUT IMAGE.

Normalization definition (MANDATORY):
- Let the original image size be W x H (the real pixel size of the input file).
- First, determine the tight pixel bbox around TEXT GLYPHS ONLY:
  pixel_bbox = (x1_px, y1_px, x2_px, y2_px) in the original image coordinate system.
- Then compute bbox1000 EXACTLY as:
  xmin = round(1000 * x1_px / W)
  xmax = round(1000 * x2_px / W)
  ymin = round(1000 * y1_px / H)
  ymax = round(1000 * y2_px / H)
- Output bbox1000 = [ymin, xmin, ymax, xmax] (integers 0..1000).

DO NOT:
- Do NOT normalize to any resized resolution (e.g., 1024, 768) or any padded/letterboxed canvas.
- Do NOT include padding margins in bbox1000.
- Do NOT use panel-level bounds; each bbox must be tight to its own balloon/box text.

Tightness rule (MANDATORY):
- bbox1000 must tightly enclose the text glyphs of THAT single balloon/box only.
- It must NOT be expanded to include the balloon outline, the panel border, or nearby balloons.
- If you are tempted to reuse the same ymin/ymax across multiple items, STOP and recompute per balloon.
Merge ONLY within the SAME balloon/box boundary.
Never merge two separate balloons even if they are close or in the same panel.

Balloon merging rule (MANDATORY):
- One speech balloon / one narration box = ONE record.
- If a balloon/box contains multiple separated text groups, MERGE into ONE record:
  - originalText contains all text in natural reading order within that balloon/box.

Inclusion / exclusion:
- Include: speech balloon text, narration/caption boxes, off-balloon dialogue that is part of narration/dialogue.
- Exclude: SFX/onomatopoeia, signage, page numbers, watermarks, UI overlays.

Transcription rules:
- Preserve original language exactly and punctuation/symbols.
- Preserve line breaks as displayed using "\\n".
- Do NOT translate.

Reading order & id:
- Output in Japanese manga reading order:
  1) top-to-bottom (smaller ymin first)
  2) within the same row/band, right-to-left (larger xmax first)
- Assign id starting from 1 after sorting.

Attribution (Role):
- Identify the speaker for each balloon based on visual evidence and the Cast Reference.
- Use ONLY the provided cast names. 
- Use "UNKNOWN" if the speaker is not in the cast list or cannot be determined.
- Use "NARRATION" for narration boxes.

Output format (STRICT):
- Return JSON ONLY in this exact schema:
{
  "data": [
    {
      "id": 1,
      "role": "...",
      "originalText": "...",
      "bbox1000": [ymin, xmin, ymax, xmax]
    }
  ]
}
`;

  // --- BRANCH 1: GOOGLE GENAI (GEMINI) ---
  if (settings.provider === 'google') {
    // Always use {apiKey: process.env.API_KEY} for initialization as per strict guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const prompt = `Extract dialogue, roles, and coordinates from these manga pages. Return JSON matching the schema.`;

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
            type: Type.OBJECT,
            properties: {
              data: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    role: { type: Type.STRING },
                    originalText: { type: Type.STRING },
                    bbox1000: {
                      type: Type.ARRAY,
                      items: { type: Type.INTEGER }
                    }
                  },
                  required: ['id', 'role', 'originalText', 'bbox1000']
                }
              }
            }
          }
        }
      });

      const rawText = response.text;
      if (!rawText) throw new Error("Empty response from model");
      
      const parsed = JSON.parse(rawText);
      const lines: DialogueLine[] = parsed.data || [];
      
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
      { type: "text", text: "Identify speakers, transcribe text, and extract coordinates. Return ONLY a raw JSON object with a 'data' array." }
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
      let url = settings.baseUrl;
      if (!url.includes('/chat/completions')) {
         url = url.replace(/\/+$/, '') + '/chat/completions';
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`,
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
          'X-Title': 'Manga Attribution Assistant'
        },
        body: JSON.stringify({
          model: settings.modelId,
          messages: messages,
          temperature: 0.1,
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Provider API Error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const rawContent = data.choices?.[0]?.message?.content;
      
      if (!rawContent) throw new Error("Empty response from custom provider");

      const cleanJson = rawContent.replace(/```json\n?|```/g, '').trim();
      
      let lines: DialogueLine[];
      try {
        const parsed = JSON.parse(cleanJson);
        lines = parsed.data || (Array.isArray(parsed) ? parsed : []);
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
