
import React from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';

interface RecordButtonProps {
  isListening: boolean;
  isProcessing: boolean;
  isConnecting?: boolean; // 新增：正在建立連線
  onClick: () => void;
  label: string; // Used for aria-label
  audioLevel?: number; // 新增：用於動態判斷閃爍
}

export const RecordButton: React.FC<RecordButtonProps> = ({ isListening, isProcessing, isConnecting, onClick, label, audioLevel = 0 }) => {
  // 當聲音大於指定閾值時啟動閃爍特效
  const isReceivingAudio = isListening && audioLevel > 30;

  return (
    <button
      onClick={onClick}
      disabled={(isProcessing || isConnecting) && !isListening}
      className={`
        relative group flex items-center justify-center w-20 h-20 rounded-full shadow-xl transition-all duration-300
        ${isListening && !isConnecting
          ? `bg-red-500 hover:bg-red-600 shadow-red-500/40 ${isReceivingAudio ? 'animate-pulse' : ''}`
          : isConnecting
            ? 'bg-amber-500 shadow-amber-500/40 animate-pulse cursor-wait'
            : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/40 hover:-translate-y-1'
        }
        ${isProcessing && !isListening ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}
      `}
      aria-label={label}
      title={label}
    >
      {/* Ripple Effect Ring (Dynamic based on audio) */}
      {isListening && !isConnecting && (
        <span className={`absolute inline-flex h-full w-full rounded-full border-2 border-red-400 opacity-50 ${isReceivingAudio ? 'animate-ping' : ''}`}></span>
      )}

      {/* Connection Glow */}
      {isConnecting && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-20 animate-ping"></span>
      )}

      <div className="relative z-10 text-white flex items-center justify-center">
        {isListening && !isConnecting ? (
          <Square size={32} fill="currentColor" />
        ) : (isProcessing || isConnecting) ? (
          <Loader2 size={32} className="animate-spin" />
        ) : (
          <Mic size={32} />
        )}
      </div>
    </button>
  );
};
