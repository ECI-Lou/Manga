
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CastMember, AnalysisResult, LLMSettings } from './types';
import { INITIAL_CAST } from './constants';
import { analyzeMangaPage } from './services/geminiService';
import CastEditor from './components/CastEditor';

const compressImage = (file: File, maxSize = 2048): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height *= maxSize / width;
          width = maxSize;
        } else if (height > maxSize) {
          width *= maxSize / height;
          height = maxSize;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};
import TokenDisplay from './components/TokenDisplay';

import * as XLSX from 'xlsx';

// Global AI Studio access
declare var window: any;

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'error' | 'info' | 'success' | 'warn';
  message: string;
}

const App: React.FC = () => {
  const [cast, setCast] = useState<CastMember[]>(INITIAL_CAST);
  const [images, setImages] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{current: number, total: number} | null>(null);
  
  // Initialize with system ready message to ensure console isn't empty on load
  const [logs, setLogs] = useState<LogEntry[]>([{
    id: 'init',
    timestamp: new Date().toLocaleTimeString(),
    type: 'info',
    message: "System initialized. Ready to process manga pages."
  }]);
  
  // Model Configuration State
  const [llmSettings, setLlmSettings] = useState<LLMSettings>({
    provider: 'google',
    modelId: 'gemini-3-flash-preview',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: ''
  });
  
  // Ref to track the current abort controller for the active request
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = useCallback((message: string, type: 'error' | 'info' | 'success' | 'warn' = 'info') => {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    };
    setLogs(prev => [entry, ...prev].slice(100));
  }, []);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    
    if (val === 'openrouter_auto') {
      setLlmSettings(prev => ({ 
        ...prev, 
        provider: 'custom', 
        modelId: 'openrouter/auto',
        baseUrl: 'https://openrouter.ai/api/v1' 
      }));
    } else if (val === 'openrouter_custom') {
      setLlmSettings(prev => ({ 
        ...prev, 
        provider: 'custom', 
        modelId: '', // User must enter
        baseUrl: 'https://openrouter.ai/api/v1' 
      }));
    } else {
      setLlmSettings(prev => ({ ...prev, provider: 'google', modelId: val }));
    }
    setResult(null);
    // Don't clear logs here to preserve history
    addLog(`Switched provider to: ${val}`, 'info');
  };

  const handleCustomSettingChange = (field: keyof LLMSettings, value: string) => {
    setLlmSettings(prev => ({ ...prev, [field]: value }));
  };

  const openKeyManager = async () => {
    if (window.aistudio?.openSelectKey) {
      addLog("Opening API Key Selector...", "info");
      await window.aistudio.openSelectKey();
      addLog("API Key updated via Platform Dialog.", "success");
    } else {
      addLog("Key selection utility not available in this environment.", "error");
    }
  };

  const stopAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsAnalyzing(false);
      addLog("Analysis cancelled by user.", "warn");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    addLog(`Processing ${fileArray.length} file(s)...`, 'info');

    const readers = fileArray.map((file: File) => compressImage(file));

    Promise.all(readers).then(results => {
      setImages(prev => [...prev, ...results]);
      setResult(null);
      addLog(`Added ${results.length} new image(s). Total: ${images.length + results.length}`, 'success');
    });
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    addLog("Removed image from selection.", "info");
  };

  const runAnalysis = async () => {
    if (images.length === 0) return;
    
    // Validation for custom models
    if (llmSettings.provider === 'custom') {
      if (!llmSettings.apiKey) {
        addLog("API Key is required for OpenRouter.", "error");
        return;
      }
      if (!llmSettings.modelId) {
        addLog("Model ID is required.", "error");
        return;
      }
    }
    
    setIsAnalyzing(true);
    setErrorState(null);
    setResult(null);
    setAnalyzeProgress({ current: 0, total: images.length });
    
    // Setup new abort controller
    abortControllerRef.current = new AbortController();
    
    addLog(`Initiating analysis using ${llmSettings.modelId}...`, 'info');
    const startTime = performance.now();
    
    let totalUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
    let allLines: DialogueLine[] = [];
    let hasErrors = false;

    for (let i = 0; i < images.length; i++) {
      if (abortControllerRef.current?.signal.aborted) {
        addLog("Analysis aborted by user.", "warn");
        break;
      }
      
      setAnalyzeProgress({ current: i + 1, total: images.length });
      addLog(`Analyzing page ${i + 1} of ${images.length}...`, 'info');
      
      try {
        const data = await analyzeMangaPage(images[i], cast, llmSettings);
        const linesWithPage = data.lines.map(line => ({ ...line, pageIndex: i + 1 }));
        allLines = [...allLines, ...linesWithPage];
        
        totalUsage.promptTokenCount += data.usage.promptTokenCount;
        totalUsage.candidatesTokenCount += data.usage.candidatesTokenCount;
        totalUsage.totalTokenCount += data.usage.totalTokenCount;
        
        addLog(`Page ${i + 1} analyzed successfully. Found ${data.lines.length} lines.`, 'success');
      } catch (err: any) {
        hasErrors = true;
        const errorMsg = err.message || 'Unknown analysis error';
        addLog(`FAILED on page ${i + 1}: ${errorMsg}`, 'error');
        if (errorMsg.includes('Requested entity was not found') && llmSettings.provider === 'google') {
          addLog("Possible API Key issue. Please re-select your key.", "warn");
          break; // Stop further processing if it's an auth error
        }
      }
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    if (allLines.length > 0 || !hasErrors) {
      setResult({
        lines: allLines,
        usage: totalUsage,
        executionTimeMs: duration
      });
      addLog(`Analysis complete! Total tokens: ${totalUsage.totalTokenCount} in ${(duration/1000).toFixed(2)}s.`, 'success');
    } else if (hasErrors && allLines.length === 0) {
      setErrorState("Analysis failed for all pages. Check logs for details.");
    }

    setIsAnalyzing(false);
    setAnalyzeProgress(null);
    abortControllerRef.current = null;
  };

  // State just for a simple error message above results if needed
  const [errorState, setErrorState] = useState<string | null>(null);

  const downloadXLSX = () => {
    if (!result) return;
    try {
      const ws = XLSX.utils.json_to_sheet(result.lines.map((line: any) => ({
        Page: line.pageIndex || 1,
        ID: line.id,
        Role: line.role,
        Text: line.originalText,
        ymin: line.bbox1000?.[0],
        xmin: line.bbox1000?.[1],
        ymax: line.bbox1000?.[2],
        xmax: line.bbox1000?.[3]
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Transcription");
      XLSX.writeFile(wb, "manga_transcription.xlsx");
      addLog("Exported to Excel.", "success");
    } catch (err: any) {
      addLog(`Export failed: ${err.message}`, "error");
    }
  };

  const downloadJSON = () => {
    if (!result) return;
    try {
      const dataStr = JSON.stringify({ data: result.lines }, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "manga_transcription.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog("Exported to JSON.", "success");
    } catch (err: any) {
      addLog(`JSON Export failed: ${err.message}`, "error");
    }
  };

  return (
    <div className="max-w-[1920px] mx-auto px-6 py-6 h-screen flex flex-col box-border">
      <header className="shrink-0 mb-6 flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Manga Dialogue Assistant</h1>
          <p className="text-gray-500 text-sm">Visual attribution and transcription engine</p>
        </div>
        <div className="flex gap-3">
          {llmSettings.provider === 'google' && (
            <button 
              onClick={openKeyManager}
              className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-bold py-2 px-4 rounded-lg shadow-sm transition flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
              Google API Key
            </button>
          )}
          {result && (
            <div className="flex gap-2">
              <button 
                onClick={downloadJSON}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition flex items-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                JSON
              </button>
              <button 
                onClick={downloadXLSX}
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition flex items-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                XLSX
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Grid Layout: 1:2:3 Ratio using 6 columns */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-6 gap-6 items-start min-h-0">
        
        {/* COLUMN 1 (1/6): Setup & Cast */}
        <div className="lg:col-span-1 flex flex-col gap-6 h-full overflow-y-auto pr-2">
          
          {/* Model Setup */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 shrink-0">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
              Model Setup
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">Provider & Model</label>
                <select 
                  value={
                    llmSettings.provider === 'google' ? llmSettings.modelId : 
                    llmSettings.modelId === 'openrouter/auto' ? 'openrouter_auto' : 'openrouter_custom'
                  }
                  onChange={handleProviderChange}
                  disabled={isAnalyzing}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500 transition font-medium text-gray-700"
                >
                  <optgroup label="Google Gemini">
                    <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                    <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
                    <option value="gemini-2.5-flash-lite-latest">Gemini 2.5 Flash Lite</option>
                  </optgroup>
                  <optgroup label="OpenRouter">
                    <option value="openrouter_auto">Auto (Best for Vision)</option>
                    <option value="openrouter_custom">Custom Model ID...</option>
                  </optgroup>
                </select>
              </div>

              {llmSettings.provider === 'custom' && (
                <div className="space-y-3 pt-2 border-t border-gray-100 animate-in fade-in slide-in-from-top-2">
                  <div className="bg-blue-50 p-2 rounded text-[10px] text-blue-700">
                    Get key from <strong>openrouter.ai/keys</strong>
                  </div>
                  
                  {llmSettings.modelId !== 'openrouter/auto' && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Model ID</label>
                      <input 
                        type="text" 
                        value={llmSettings.modelId}
                        onChange={(e) => handleCustomSettingChange('modelId', e.target.value)}
                        placeholder="e.g. anthropic/claude-3.5-sonnet"
                        className="w-full bg-white border border-gray-200 rounded p-1.5 text-xs"
                      />
                    </div>
                  )}
                  
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">OpenRouter API Key</label>
                    <input 
                      type="password" 
                      value={llmSettings.apiKey}
                      onChange={(e) => handleCustomSettingChange('apiKey', e.target.value)}
                      placeholder="sk-or-..."
                      className="w-full bg-white border border-gray-200 rounded p-1.5 text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button 
                  onClick={runAnalysis}
                  disabled={isAnalyzing || images.length === 0}
                  className={`w-full py-3 rounded-xl font-bold text-white transition shadow-md text-sm ${
                    isAnalyzing || images.length === 0 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
                </button>
                {isAnalyzing && (
                  <button 
                    onClick={stopAnalysis}
                    className="w-full mt-2 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition border border-red-100"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Cast Editor */}
          <CastEditor cast={cast} onUpdate={setCast} />
        </div>

        {/* COLUMN 2 (2/6): Inputs */}
        <div className="lg:col-span-2 h-full flex flex-col">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col h-full">
            <h2 className="text-sm font-black text-gray-800 mb-3 flex justify-between items-center shrink-0">
              <span>Input Pages</span>
              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-500">{images.length}</span>
            </h2>
            
            <label className="block w-full cursor-pointer mb-4 shrink-0">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-indigo-400 transition bg-gray-50">
                <span className="text-gray-500 text-sm block font-medium">+ Add Manga Pages</span>
                <input 
                  type="file" 
                  multiple 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleFileChange} 
                  disabled={isAnalyzing}
                />
              </div>
            </label>

            {images.length > 0 ? (
              <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-200 space-y-4">
                {images.map((img, idx) => (
                  <div key={idx} className="relative group rounded-lg overflow-hidden border border-gray-200 shadow-sm">
                    <img src={img} className="w-full h-auto object-cover" alt={`Page ${idx+1}`} />
                    <button 
                      onClick={() => removeImage(idx)}
                      disabled={isAnalyzing}
                      className="absolute top-2 right-2 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-md hover:bg-red-700 z-10"
                      title="Remove image"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-xs p-1.5 text-center opacity-0 group-hover:opacity-100 transition backdrop-blur-sm">
                      Page {idx + 1}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-300 flex-col gap-2 border border-gray-100 rounded-lg bg-gray-50/50">
                <svg className="w-10 h-10 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                <span className="text-xs font-medium">No images uploaded</span>
              </div>
            )}
          </div>
        </div>

        {/* COLUMN 3 (3/6): Results */}
        <div className="lg:col-span-3 h-full flex flex-col gap-6 overflow-hidden">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex-1 flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h2 className="text-xl font-black text-gray-800">Transcription Result</h2>
              <TokenDisplay usage={result?.usage || null} time={result?.executionTimeMs} />
            </div>

            {errorState && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100 shrink-0">
                {errorState}
              </div>
            )}

            {!result && !isAnalyzing && (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                <p className="font-medium">Ready to analyze.</p>
                <p className="text-sm mt-1 text-gray-300">Configure model and upload pages to start.</p>
              </div>
            )}

            {isAnalyzing && (
              <div className="flex-1 space-y-4">
                {[1,2,3,4,5,6,7].map(i => (
                  <div key={i} className="h-12 bg-gray-50 rounded-lg w-full animate-pulse border border-gray-100"></div>
                ))}
                <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-white flex justify-center">
                  <div className="bg-indigo-50 text-indigo-700 text-xs px-4 py-2 rounded-full font-bold animate-bounce border border-indigo-100 shadow-sm">
                    {analyzeProgress ? `Reading manga page ${analyzeProgress.current} of ${analyzeProgress.total}...` : 'Reading manga pages...'}
                  </div>
                </div>
              </div>
            )}

            {result && (
              <div className="flex-1 overflow-y-auto pr-2 space-y-1">
                {result.lines.length === 0 ? (
                  <p className="text-gray-500 italic">No dialogue detected.</p>
                ) : (
                  result.lines.map((line, idx) => (
                    <div 
                      key={idx} 
                      className="group flex gap-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 px-3 rounded-lg transition"
                    >
                      <div className="shrink-0 w-8 text-center pt-1 flex flex-col items-center">
                        <span className="text-[10px] font-bold text-gray-300">#{line.id || idx + 1}</span>
                        {line.pageIndex && <span className="text-[9px] text-indigo-400 font-medium mt-1">P{line.pageIndex}</span>}
                      </div>
                      <div className="shrink-0 w-24 text-right">
                         <span className={`font-black text-xs uppercase tracking-wide px-2 py-1 rounded-md ${
                          line.role === 'UNKNOWN' ? 'bg-gray-100 text-gray-500' : 
                          line.role === 'SFX' ? 'bg-orange-100 text-orange-600' : 
                          line.role === 'NARRATION' ? 'bg-blue-100 text-blue-700' : 'bg-indigo-100 text-indigo-700'
                        }`}>
                          {line.role}
                        </span>
                        <div className="mt-1 text-[9px] text-gray-400 font-mono">
                           [{line.bbox1000?.join(', ')}]
                        </div>
                      </div>
                      <div className="flex-1 text-gray-800 text-sm leading-relaxed whitespace-pre-wrap font-serif">
                        {line.originalText}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Debug/Error Console */}
          <div className="bg-slate-900 rounded-2xl shadow-lg border border-slate-800 overflow-hidden flex flex-col h-[180px] shrink-0">
            <div className="bg-slate-800 px-4 py-2 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                <span className="text-slate-400 text-[10px] font-mono ml-2 tracking-widest uppercase">system_logs</span>
              </div>
              <button 
                onClick={() => setLogs([])}
                className="text-slate-500 hover:text-white text-[10px] uppercase font-bold transition px-2"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1.5 scrollbar-thin scrollbar-thumb-slate-700">
              {logs.length === 0 ? (
                <div className="text-slate-600 italic">Initializing console...</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-2 items-start">
                    <span className="text-slate-500 shrink-0 select-none">[{log.timestamp}]</span>
                    <span className={`select-none ${
                      log.type === 'error' ? 'text-red-400 font-bold' : 
                      log.type === 'success' ? 'text-green-400' : 
                      log.type === 'warn' ? 'text-yellow-400' :
                      'text-indigo-300'
                    }`}>
                      {log.type.toUpperCase()}:
                    </span>
                    <span className="text-slate-300 break-words leading-tight">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
