
import React from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';

interface RecordButtonProps {
  isListening: boolean;
  isProcessing: boolean;
  onClick: () => void;
  label: string; // Used for aria-label
}

export const RecordButton: React.FC<RecordButtonProps> = ({ isListening, isProcessing, onClick, label }) => {
  return (
    <button
      onClick={onClick}
      disabled={isProcessing && !isListening}
      className={`
        relative group flex items-center justify-center w-20 h-20 rounded-full shadow-xl transition-all duration-300
        ${isListening 
          ? 'bg-red-500 hover:bg-red-600 shadow-red-500/40 animate-pulse' 
          : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/40 hover:-translate-y-1'
        }
        ${isProcessing && !isListening ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}
      `}
      aria-label={label}
      title={label}
    >
      {/* Ripple Effect Ring */}
      {isListening && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping"></span>
      )}

      <div className="relative z-10 text-white flex items-center justify-center">
        {isListening ? (
          <Square size={32} fill="currentColor" />
        ) : isProcessing ? (
          <Loader2 size={32} className="animate-spin" />
        ) : (
          <Mic size={32} />
        )}
      </div>
    </button>
  );
};
