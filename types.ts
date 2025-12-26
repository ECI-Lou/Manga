
export interface CastMember {
  id: string;
  name: string;
  description: string;
}

export interface DialogueLine {
  role: string;
  dialogue: string;
}

export interface AnalysisResult {
  lines: DialogueLine[];
  usage: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export type LLMProvider = 'google' | 'custom';

export interface LLMSettings {
  provider: LLMProvider;
  modelId: string;
  // Custom settings
  baseUrl?: string;
  apiKey?: string;
}
