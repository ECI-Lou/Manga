
import React from 'react';

interface TokenDisplayProps {
  usage: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  } | null;
  time?: number;
}

const TokenDisplay: React.FC<TokenDisplayProps> = ({ usage, time }) => {
  if (!usage) return null;

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${Math.floor(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="mt-4 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-800 flex items-center gap-4">
      <div className="flex gap-4">
        <div><span className="font-bold">Input:</span> {usage.promptTokenCount} </div>
        <div><span className="font-bold">Output:</span> {usage.candidatesTokenCount} </div>
        <div><span className="font-bold">Total:</span> {usage.totalTokenCount}</div>
      </div>
      {time !== undefined && (
        <div className="pl-4 border-l border-indigo-200">
          <span className="font-bold">Time:</span> {formatTime(time)}
        </div>
      )}
    </div>
  );
};

export default TokenDisplay;