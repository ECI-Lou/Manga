
import { GoogleGenAI, Type } from "@google/genai";
import { CastMember, AnalysisResult, DialogueLine, LLMSettings } from "../types";

function sortMangaLines(lines: DialogueLine[]): DialogueLine[] {
  // 1. Sort by ymin to prepare for row grouping
  lines.sort((a, b) => (a.bbox1000?.[0] || 0) - (b.bbox1000?.[0] || 0));

  // 2. Group into panel rows
  const groups: DialogueLine[][] = [];
  let currentGroup: DialogueLine[] = [];
  let currentYMax = -1;

  for (const line of lines) {
    if (!line.bbox1000) {
      currentGroup.push(line);
      continue;
    }
    const ymin = line.bbox1000[0];
    const ymax = line.bbox1000[2];
    
    if (currentGroup.length === 0) {
      currentGroup.push(line);
      currentYMax = ymax;
    } else {
      // If the vertical gap is larger than 6% of the page (60/1000), it's a new panel row
      if (ymin - currentYMax > 60) {
        groups.push(currentGroup);
        currentGroup = [line];
        currentYMax = ymax;
      } else {
        currentGroup.push(line);
        currentYMax = Math.max(currentYMax, ymax);
      }
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  // 3. Sort within each group and flatten
  let sortedLines: DialogueLine[] = [];
  for (const group of groups) {
    group.sort((a, b) => {
      if (!a.bbox1000 || !b.bbox1000) return 0;
      const xOverlap = Math.max(0, Math.min(a.bbox1000[3], b.bbox1000[3]) - Math.max(a.bbox1000[1], b.bbox1000[1]));
      const aWidth = a.bbox1000[3] - a.bbox1000[1];
      const bWidth = b.bbox1000[3] - b.bbox1000[1];
      
      // If they overlap horizontally by > 50%, sort top-to-bottom
      if (xOverlap > 0.5 * Math.min(aWidth, bWidth)) {
        return a.bbox1000[0] - b.bbox1000[0];
      }
      // Otherwise, sort right-to-left
      return b.bbox1000[3] - a.bbox1000[3];
    });
    sortedLines = sortedLines.concat(group);
  }

  // Reassign IDs after sorting
  sortedLines.forEach((line, index) => {
    line.id = index + 1;
  });

  return sortedLines;
}

export const analyzeMangaPage = async (
  image: string, // Base64 string
  cast: CastMember[],
  settings: LLMSettings
): Promise<AnalysisResult> => {
  
  const castDescription = cast.map(c => `- ${c.name}: ${c.description}`).join('\n');
  
  const systemInstruction = `
You are a manga dialogue attribution assistant.

Cast Reference:
${castDescription}

Task:
Extract ONLY dialogue balloons and narration/caption text from THIS manga page image.
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
- Do NOT include line breaks ("\\n"). Combine multi-line text into a single continuous string.
- Do NOT translate.

Reading order & id:
- Output in Japanese manga reading order:
  1) Group balloons by panels (rows) from top to bottom.
  2) Within each panel, order balloons from right to left.
  3) If balloons are in the same vertical column within a panel, order them top to bottom.
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
    // Compatible with both AI Studio environment and standard Vite environment
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
    const ai = new GoogleGenAI({ apiKey: apiKey });

    const prompt = `Extract dialogue, roles, and coordinates from this manga page. Return JSON matching the schema.`;

    const mimeTypeMatch = image.match(/^data:(image\/[a-zA-Z+]+);base64,/);
    const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';
    const base64Data = image.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');

    const imageParts = [{
      inlineData: {
        mimeType: mimeType,
        data: base64Data
      }
    }];

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
      let lines: DialogueLine[] = parsed.data || [];
      
      // Post-processing: Remove newlines and enforce manga sorting (Right-to-Left, Top-to-Bottom)
      lines = lines.map(line => ({
        ...line,
        originalText: line.originalText ? line.originalText.replace(/\n/g, '').trim() : ''
      }));

      lines = sortMangaLines(lines);
      
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
      { type: "text", text: "Identify speakers, transcribe text, and extract coordinates. Return ONLY a raw JSON object with a 'data' array." },
      {
        type: "image_url",
        image_url: {
          url: image // OpenRouter/OpenAI expects data URI
        }
      }
    ];

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
        
        // Post-processing: Remove newlines and enforce manga sorting (Right-to-Left, Top-to-Bottom)
        lines = lines.map(line => ({
          ...line,
          originalText: line.originalText ? line.originalText.replace(/\n/g, '').trim() : ''
        }));

        lines = sortMangaLines(lines);
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
