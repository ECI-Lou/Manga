
import React, { useState, useCallback } from 'react';
import { CastMember, DialogueLine, AnalysisResult } from './types';
import { INITIAL_CAST } from './constants';
import { analyzeMangaPages } from './services/geminiService';
import CastEditor from './components/CastEditor';
import TokenDisplay from './components/TokenDisplay';

// Global XLSX access from index.html script tag
declare var XLSX: any;

const App: React.FC = () => {
  const [cast, setCast] = useState<CastMember[]>(INITIAL_CAST);
  const [images, setImages] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const fileArray = Array.from(files);
    // Explicitly type file as File to avoid 'unknown' inference and fix Blob assignment error on line 28
    const readers = fileArray.map((file: File) => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readers).then(results => {
      setImages(results);
      setResult(null); // Clear previous results when new images are selected
    });
  };

  const runAnalysis = async () => {
    if (images.length === 0) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const data = await analyzeMangaPages(images, cast);
      setResult(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const downloadXLSX = () => {
    if (!result) return;
    
    const ws = XLSX.utils.json_to_sheet(result.lines.map(line => ({
      Role: line.role,
      Dialogue: line.dialogue
    })));
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transcription");
    
    XLSX.writeFile(wb, "manga_transcription.xlsx");
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Manga Dialogue Assistant</h1>
          <p className="text-gray-500">Visual attribution and transcription for manga pages</p>
        </div>
        <div className="flex gap-4">
          {result && (
            <button 
              onClick={downloadXLSX}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg shadow-sm transition flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
              Download .xlsx
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-6">
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
                  />
                </div>
              </label>

              {images.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-4">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative aspect-[3/4] bg-gray-100 rounded overflow-hidden border border-gray-200">
                      <img src={img} className="w-full h-full object-cover" alt={`Page ${idx+1}`} />
                    </div>
                  ))}
                </div>
              )}

              <button 
                onClick={runAnalysis}
                disabled={isAnalyzing || images.length === 0}
                className={`w-full py-3 rounded-xl font-bold text-white transition shadow-md ${
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
              
              {error && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-xs font-medium">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Results Area */}
        <div className="lg:col-span-8">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 min-h-[600px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black text-gray-800">Transcription Result</h2>
              <TokenDisplay usage={result?.usage || null} />
            </div>

            {!result && !isAnalyzing && (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <p>Upload pages and click "Run Analysis" to begin.</p>
              </div>
            )}

            {isAnalyzing && (
              <div className="flex-1 space-y-4 animate-pulse">
                {[1,2,3,4,5,6].map(i => (
                  <div key={i} className="h-10 bg-gray-100 rounded-lg w-full"></div>
                ))}
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
        </div>
      </div>
    </div>
  );
};

export default App;
