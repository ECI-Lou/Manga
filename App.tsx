
import React, { useState, useRef } from 'react';
import { CastMember, AnalysisResult } from './types';
import { INITIAL_CAST } from './constants';
import { analyzeMangaPages } from './services/geminiService';
import CastEditor from './components/CastEditor';
import TokenDisplay from './components/TokenDisplay';

// Global XLSX and AI Studio access
declare var XLSX: any;
declare var window: any;

interface LogEntry {
  timestamp: string;
  type: 'error' | 'info' | 'success' | 'warn';
  message: string;
}

const App: React.FC = () => {
  const [cast, setCast] = useState<CastMember[]>(INITIAL_CAST);
  const [images, setImages] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Ref to track the current abort controller for the active request
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = (message: string, type: 'error' | 'info' | 'success' | 'warn' = 'info') => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    };
    setLogs(prev => [entry, ...prev].slice(0, 50));
  };

  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel);
    setResult(null);
    setLogs([]);
    addLog(`Model switched to ${newModel}. Context cleared.`, 'info');
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
    if (!files) return;

    const fileArray = Array.from(files);
    addLog(`Loading ${fileArray.length} images...`, 'info');

    const readers = fileArray.map((file: File) => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readers).then(results => {
      setImages(results);
      setResult(null);
      addLog(`Images ready for ${selectedModel}.`, 'success');
    });
  };

  const runAnalysis = async () => {
    if (images.length === 0) return;
    
    setIsAnalyzing(true);
    setErrorState(null);
    setResult(null);
    
    // Setup new abort controller
    abortControllerRef.current = new AbortController();
    
    addLog(`Initiating request to ${selectedModel}...`, 'info');

    try {
      const data = await analyzeMangaPages(images, cast, selectedModel);
      setResult(data);
      addLog(`Success! Used ${data.usage.totalTokenCount} tokens.`, 'success');
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        // Logged already by stopAnalysis
      } else {
        const errorMsg = err.message || 'Unknown analysis error';
        addLog(`FAILED: ${errorMsg}`, 'error');
        if (errorMsg.includes('Requested entity was not found')) {
          addLog("Possible API Key issue. Please re-select your key.", "warn");
        }
      }
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  // State just for a simple error message above results if needed
  const [errorState, setErrorState] = useState<string | null>(null);

  const downloadXLSX = () => {
    if (!result) return;
    try {
      const ws = XLSX.utils.json_to_sheet(result.lines.map(line => ({
        Role: line.role,
        Dialogue: line.dialogue
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Transcription");
      XLSX.writeFile(wb, "manga_transcription.xlsx");
      addLog("Exported to Excel.", "success");
    } catch (err: any) {
      addLog(`Export failed: ${err.message}`, "error");
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <header className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Manga Dialogue Assistant</h1>
          <p className="text-gray-500">Visual attribution and transcription engine</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={openKeyManager}
            className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-bold py-2 px-4 rounded-lg shadow-sm transition flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
            Manage API Key
          </button>
          {result && (
            <button 
              onClick={downloadXLSX}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg shadow-sm transition flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
              Export XLSX
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-lg font-bold text-gray-800 mb-3">Configuration</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Active AI Model</label>
                <select 
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={isAnalyzing}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500 transition"
                >
                  <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast & Efficient)</option>
                  <option value="gemini-3-pro-preview">Gemini 3 Pro (Complex Reasoning)</option>
                  <option value="gemini-2.5-flash-lite-latest">Gemini 2.5 Flash Lite</option>
                </select>
                <p className="text-[10px] text-gray-400 mt-2 italic">
                  * Switching models clears current results.
                </p>
              </div>
            </div>
          </div>

          <CastEditor cast={cast} onUpdate={setCast} />
          
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Input Pages</h2>
            <div className="space-y-4">
              <label className="block w-full cursor-pointer">
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-indigo-400 transition bg-gray-50">
                  <span className="text-gray-500 text-sm">Click to select manga images</span>
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

              {images.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-4">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative aspect-[3/4] bg-gray-100 rounded overflow-hidden border border-gray-200 group">
                      <img src={img} className="w-full h-full object-cover" alt={`Page ${idx+1}`} />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button 
                  onClick={runAnalysis}
                  disabled={isAnalyzing || images.length === 0}
                  className={`flex-1 py-3 rounded-xl font-bold text-white transition shadow-md ${
                    isAnalyzing || images.length === 0 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {isAnalyzing ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      Analyzing...
                    </span>
                  ) : 'Run Analysis'}
                </button>
                {isAnalyzing && (
                  <button 
                    onClick={stopAnalysis}
                    className="px-4 py-3 bg-red-100 text-red-600 rounded-xl font-bold hover:bg-red-200 transition"
                    title="Stop Analysis"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Results Area */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 min-h-[450px] flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black text-gray-800">Transcription Result</h2>
              <TokenDisplay usage={result?.usage || null} />
            </div>

            {errorState && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
                {errorState}
              </div>
            )}

            {!result && !isAnalyzing && (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <p>Upload pages and click "Run Analysis" to begin.</p>
              </div>
            )}

            {isAnalyzing && (
              <div className="flex-1 space-y-4">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="h-10 bg-gray-50 rounded-lg w-full animate-pulse border border-gray-100"></div>
                ))}
                <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-white flex justify-center">
                  <div className="bg-indigo-50 text-indigo-700 text-xs px-4 py-2 rounded-full font-bold animate-bounce border border-indigo-100 shadow-sm">
                    AI is processing your pages...
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
                      className="group flex gap-3 py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50 px-2 rounded-lg transition"
                    >
                      <span className={`font-black shrink-0 w-24 text-sm ${
                        line.role === 'UNKNOWN' ? 'text-gray-400' : 
                        line.role === 'SFX' ? 'text-orange-500' : 'text-indigo-600'
                      }`}>
                        {line.role}:
                      </span>
                      <span className="text-gray-800 text-sm leading-relaxed">{line.dialogue}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Debug/Error Console */}
          <div className="bg-slate-900 rounded-2xl shadow-lg border border-slate-800 overflow-hidden flex flex-col h-[250px]">
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
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1.5 scrollbar-thin scrollbar-thumb-slate-700">
              {logs.length === 0 ? (
                <div className="text-slate-600 italic">Initializing console... system ready.</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                    <span className={
                      log.type === 'error' ? 'text-red-400 font-bold' : 
                      log.type === 'success' ? 'text-green-400' : 
                      log.type === 'warn' ? 'text-yellow-400' :
                      'text-indigo-300'
                    }>
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
