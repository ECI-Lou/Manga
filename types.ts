
export interface CastMember {
  id: string;
  name: string;
  description: string;
}

export interface DialogueLine {
  id: number;
  role: string;
  originalText: string;
  bbox1000: number[]; // [ymin, xmin, ymax, xmax]
}

export interface AnalysisResult {
  lines: DialogueLine[];
  usage: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  executionTimeMs?: number;
}

export type LLMProvider = 'google' | 'custom';

export interface LLMSettings {
  provider: LLMProvider;
  modelId: string;
  // Custom settings
  baseUrl?: string;
  apiKey?: string;
}
