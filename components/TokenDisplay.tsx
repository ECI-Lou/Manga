
import React from 'react';

interface TokenDisplayProps {
  usage: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  } | null;
}

const TokenDisplay: React.FC<TokenDisplayProps> = ({ usage }) => {
  if (!usage) return null;

  return (
    <div className="mt-4 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-800 flex justify-around">
      <div><span className="font-bold">Input:</span> {usage.promptTokenCount} </div>
      <div><span className="font-bold">Output:</span> {usage.candidatesTokenCount} </div>
      <div><span className="font-bold">Total:</span> {usage.totalTokenCount}</div>
    </div>
  );
};

export default TokenDisplay;
