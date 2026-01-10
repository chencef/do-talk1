
import React from 'react';
import { LanguageCode } from '../types';
import { SUPPORTED_LANGUAGES } from '../constants';
import { ArrowRightLeft, ArrowDownUp, ArrowRight } from 'lucide-react';

interface LanguageSelectorProps {
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  onSourceChange: (lang: LanguageCode) => void;
  onTargetChange: (lang: LanguageCode) => void;
  onSwap: () => void;
  variant?: 'horizontal' | 'vertical';
  compact?: boolean;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  sourceLang,
  targetLang,
  onSourceChange,
  onTargetChange,
  onSwap,
  variant = 'horizontal',
  compact = false,
}) => {
  const isVertical = variant === 'vertical';

  // Render simplified compact horizontal version
  if (compact && !isVertical) {
    return (
      <div className="bg-white shadow-sm rounded-xl p-2 flex items-center justify-between gap-2 w-full border border-slate-100">
        {/* Source Language */}
        <div className="flex-1 min-w-0">
          <div className="relative">
            <select
              value={sourceLang}
              onChange={(e) => onSourceChange(e.target.value as LanguageCode)}
              className="w-full bg-slate-50 border-none rounded-md py-2 pl-2 pr-6 text-xs font-semibold text-slate-700 focus:ring-1 focus:ring-indigo-500 cursor-pointer appearance-none truncate"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={`source-${lang.code}`} value={lang.code}>
                   {lang.flag} {lang.label}
                </option>
              ))}
            </select>
             <div className="absolute inset-y-0 right-1 flex items-center pointer-events-none">
               <span className="text-slate-400 text-[10px]">▼</span>
            </div>
          </div>
        </div>

        {/* Swap Button (Small) */}
        <button
          onClick={onSwap}
          className="p-1.5 rounded-full hover:bg-slate-100 text-indigo-500 transition-colors duration-200 shrink-0 border border-slate-200"
          aria-label="交換語言"
        >
          <ArrowRightLeft size={14} />
        </button>

        {/* Target Language */}
        <div className="flex-1 min-w-0">
          <div className="relative">
            <select
              value={targetLang}
              onChange={(e) => onTargetChange(e.target.value as LanguageCode)}
              className="w-full bg-slate-50 border-none rounded-md py-2 pl-2 pr-6 text-xs font-semibold text-slate-700 focus:ring-1 focus:ring-indigo-500 cursor-pointer appearance-none truncate"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={`target-${lang.code}`} value={lang.code}>
                  {lang.flag} {lang.label}
                </option>
              ))}
            </select>
             <div className="absolute inset-y-0 right-1 flex items-center pointer-events-none">
               <span className="text-slate-400 text-[10px]">▼</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Standard Render
  return (
    <div className={`bg-white shadow-sm rounded-2xl p-4 flex ${isVertical ? 'flex-col space-y-4' : 'items-center justify-between gap-2 max-w-lg mx-auto'} w-full border border-slate-100 transition-all`}>
      
      {/* Source Language */}
      <div className="flex-1 w-full">
        {!compact && <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">來源語言</label>}
        <div className="relative">
          <select
            value={sourceLang}
            onChange={(e) => onSourceChange(e.target.value as LanguageCode)}
            className="w-full bg-slate-50 border-none rounded-lg py-3 pl-3 pr-8 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500 cursor-pointer appearance-none"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={`source-${lang.code}`} value={lang.code}>
                {lang.flag} {lang.label}
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
             <span className="text-slate-400 text-xs">▼</span>
          </div>
        </div>
      </div>

      {/* Swap Button */}
      <div className={`flex justify-center ${isVertical ? '' : 'mt-4'}`}>
        <button
          onClick={onSwap}
          className="p-2 rounded-full hover:bg-slate-100 text-indigo-500 transition-colors duration-200 active:scale-95 border border-slate-200"
          aria-label="交換語言"
        >
          {isVertical ? <ArrowDownUp size={18} /> : <ArrowRightLeft size={20} />}
        </button>
      </div>

      {/* Target Language */}
      <div className="flex-1 w-full">
        {!compact && <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">目標語言</label>}
        <div className="relative">
          <select
            value={targetLang}
            onChange={(e) => onTargetChange(e.target.value as LanguageCode)}
            className="w-full bg-slate-50 border-none rounded-lg py-3 pl-3 pr-8 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500 cursor-pointer appearance-none"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={`target-${lang.code}`} value={lang.code}>
                {lang.flag} {lang.label}
              </option>
            ))}
          </select>
           <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
             <span className="text-slate-400 text-xs">▼</span>
          </div>
        </div>
      </div>
    </div>
  );
};
