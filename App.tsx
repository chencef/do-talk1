
import React, { useState, useEffect, useRef } from 'react';
import { LanguageSelector } from './components/LanguageSelector';
import { RecordButton } from './components/RecordButton';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useTextToSpeech } from './hooks/useTextToSpeech';
import { translateText } from './services/groqService';
import { LanguageCode, TranslationRecord, AppLanguage } from './types';
import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG, UI_TRANSLATIONS, APP_LANGUAGES, SUPPORTED_LANGUAGES } from './constants';
import { Volume2, Trash2, History, ArrowRight, Menu, X, Settings, Headphones, Globe, CheckCircle2, AlertCircle, Ear, VolumeX, Volume1, Loader2, RefreshCw, Zap } from 'lucide-react';

const App: React.FC = () => {
  // App Settings State
  const [appLanguage, setAppLanguage] = useState<AppLanguage>('zh-TW'); // Default to Traditional Chinese
  const [volume, setVolume] = useState<number>(100); // 0-100
  
  // Translation State
  const [sourceLang, setSourceLang] = useState<LanguageCode>(DEFAULT_SOURCE_LANG);
  const [targetLang, setTargetLang] = useState<LanguageCode>(DEFAULT_TARGET_LANG);
  const [history, setHistory] = useState<TranslationRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isContinuousMode, setIsContinuousMode] = useState(false); // New State
  
  // Headphone / LE Audio State
  const [leAudioChecking, setLeAudioChecking] = useState(false);
  const [leAudioSupported, setLeAudioSupported] = useState<boolean | null>(null);
  
  // Playback Preferences (Right = Source, Left = Target)
  const [playSourceInRight, setPlaySourceInRight] = useState(false); // Default false for source (input)
  const [playTargetInLeft, setPlayTargetInLeft] = useState(true);   // Default true for target (translation)

  // Real-time translation state
  const [liveTranslation, setLiveTranslation] = useState<string>("");
  
  // Ref to track if we should ignore a pending translation result because user cleared history
  const ignorePendingUpdates = useRef(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  // Get current UI strings based on selected App Language
  const ui = UI_TRANSLATIONS[appLanguage];

  // Callback for Continuous Mode results
  const handleContinuousResult = async (text: string) => {
     if (!text || !text.trim()) return;
     // When continuous mode sends a chunk, we finalize it immediately
     await finalizeTranslation(text);
  };

  const { speak, isSpeaking, unlock } = useTextToSpeech();

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    abortListening,
    resetTranscript,
    error: sttError,
    isTranscribing, // New state from Whisper hook
    audioLevel // New state for visualizer
  } = useSpeechRecognition(sourceLang, targetLang, isContinuousMode, handleContinuousResult);

  // Refs to track latest state for async closures
  const liveTranslationRef = useRef(liveTranslation);

  useEffect(() => {
    liveTranslationRef.current = liveTranslation;
  }, [liveTranslation]);

  // Scroll to top when history updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [history, transcript, liveTranslation, isListening, isProcessing, isTranscribing]);

  // REMOVED: Feedback Loop Protection (abortListening when speaking)
  // Since user has headphones, we allow full duplex (record while speaking)

  // Auto-start listening when Continuous Mode is activated
  // Updated: Removed `!isSpeaking` check to allow recording while TTS is playing
  useEffect(() => {
    let mounted = true;
    const autoStart = async () => {
      // Allow start even if speaking (Full Duplex)
      if (isContinuousMode && !isListening && !isProcessing && !sttError) {
         try {
           ignorePendingUpdates.current = false;
           await startListening();
         } catch (e) {
           console.error("Auto start failed", e);
           if (mounted) setIsContinuousMode(false);
         }
      }
    };
    
    autoStart();
    return () => { mounted = false; };
  }, [isContinuousMode, isListening, isProcessing, sttError, startListening]); // Removed isSpeaking dependency

  // Determine audio panning based on language and LE Audio setting
  // Logic: Source Lang -> Right Ear (1), Target Lang -> Left Ear (-1)
  const getAudioPan = (lang: LanguageCode): number => {
    if (!leAudioSupported) return 0; // Center if LE Audio not active

    if (lang === sourceLang) return 1; // Right Ear for Source
    if (lang === targetLang) return -1; // Left Ear for Target
    
    return 0; // Other/Unknown languages center
  };

  const handleSpeak = (text: string, lang: LanguageCode) => {
    const pan = getAudioPan(lang);
    // Convert 0-100 to 0.0-1.0
    speak(text, lang, pan, volume / 100);
  };

  // Check LE Audio Support (Mock implementation)
  const checkLeAudioSupport = () => {
    setLeAudioChecking(true);
    setLeAudioSupported(null);

    // Simulate an async check
    setTimeout(() => {
        // Mock check
        const isSupported = 'bluetooth' in navigator || Math.random() > 0.1; 
        setLeAudioSupported(isSupported);
        setLeAudioChecking(false);
    }, 1500);
  };

  // Helper to get language label
  const getLangLabel = (code: LanguageCode) => {
    return SUPPORTED_LANGUAGES.find(l => l.code === code)?.label || code;
  };

  // Handle Volume Change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (!isNaN(val)) {
        setVolume(Math.min(100, Math.max(0, val)));
    }
  };

  // Finalize translation and add to history
  const finalizeTranslation = async (currentTranscript: string) => {
    if (!currentTranscript || !currentTranscript.trim()) return;

    setIsProcessing(true);
    try {
      // 1. Translate the Whisper result
      const translation = await translateText(currentTranscript, sourceLang, targetLang);
      
      if (ignorePendingUpdates.current) return;

      const newRecord: TranslationRecord = {
        id: Date.now().toString() + Math.random().toString().slice(2, 5), // Ensure unique ID
        sourceText: currentTranscript,
        translatedText: translation,
        sourceLang,
        targetLang,
        timestamp: Date.now(),
      };

      setHistory((prev) => [newRecord, ...prev]);
      
      // Auto-play logic based on Headphone Settings
      
      // NOTE: Per user request, we DO NOT play the source text (Original).
      // We ONLY play the translated text.
      
      // Play Target (Left Ear) if enabled OR if Continuous Mode is active
      if (playTargetInLeft || isContinuousMode) {
         handleSpeak(translation, targetLang);
      }

    } catch (err) {
      console.error("Translation error", err);
    } finally {
      setIsProcessing(false);
      if (!isContinuousMode) {
        resetTranscript();
      }
    }
  };

  // Manual Toggle (Right Button)
  const toggleRecording = async () => {
    // 修正：如果目前處於「連續翻譯」模式且正在聆聽
    // 用戶點擊右側按鈕代表想切換為「手動錄音」，所以先停止連續模式，再啟動手動錄音
    if (isContinuousMode && isListening) {
      setIsContinuousMode(false);
      await stopListening();
      
      // 立即啟動手動錄音
      ignorePendingUpdates.current = false;
      setLiveTranslation("");
      resetTranscript();
      unlock(); // UNLOCK iOS TTS
      await startListening();
      return;
    }

    if (isListening) {
      // 停止錄音 (手動模式)
      if (isContinuousMode) setIsContinuousMode(false);
      
      try {
        const finalTranscript = await stopListening();
        if (finalTranscript) {
          await finalizeTranslation(finalTranscript);
        }
      } catch (e) {
        console.error("Error processing audio:", e);
      }
    } else {
      // 開始錄音 (手動模式)
      setIsContinuousMode(false); // 確保連續模式關閉
      ignorePendingUpdates.current = false;
      setLiveTranslation("");
      resetTranscript();
      unlock(); // UNLOCK iOS TTS on initial click
      await startListening();
    }
  };

  // Continuous Mode Toggle (Left Button)
  const toggleContinuousMode = () => {
    if (isContinuousMode) {
        setIsContinuousMode(false);
        stopListening();
    } else {
        // If currently manual listening, the hook's useEffect dependency change 
        // will handle stop, then our auto-start effect will kick in.
        // But to be clean, we can just set state.
        unlock(); // UNLOCK iOS TTS on initial click
        setIsContinuousMode(true);
    }
  };

  const handleSwapLanguages = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    resetTranscript();
    setLiveTranslation("");
  };

  const clearHistory = () => {
    ignorePendingUpdates.current = true;
    abortListening();
    resetTranscript(); 
    setHistory([]);
    setLiveTranslation("");
    setIsProcessing(false);
    setIsContinuousMode(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center relative overflow-hidden">
      
      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar (Drawer) */}
      <div 
        className={`fixed top-0 left-0 h-full w-80 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-600" />
              {ui.settings}
            </h2>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X size={24} />
            </button>
          </div>
          
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            
            {/* Section 1: Translation Settings */}
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                <Globe size={16} className="text-indigo-500" />
                {ui.translationSettings}
              </h3>
              <LanguageSelector
                sourceLang={sourceLang}
                targetLang={targetLang}
                onSourceChange={setSourceLang}
                onTargetChange={setTargetLang}
                onSwap={handleSwapLanguages}
                variant="horizontal"
                compact={true}
              />
            </div>

            {/* Section 2: Headphone Settings */}
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                <Headphones size={16} className="text-indigo-500" />
                {ui.headphoneSettings}
              </h3>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-4">
                <button 
                  onClick={checkLeAudioSupport}
                  disabled={leAudioChecking}
                  className={`w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2
                    ${leAudioSupported 
                        ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                    }`}
                >
                  {leAudioChecking ? (
                     <span>{ui.checking}</span>
                  ) : leAudioSupported ? (
                     <><CheckCircle2 size={16} /> {ui.leSupported}</>
                  ) : (
                     <>{ui.checkLeAudio}</>
                  )}
                </button>

                {leAudioSupported === false && (
                    <div className="text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle size={12} /> {ui.leNotSupported}
                    </div>
                )}
                
                {leAudioSupported && (
                    <>
                    <div className="text-xs text-slate-600 bg-white p-2 rounded border border-slate-100 leading-relaxed mb-2">
                        {ui.leDescription}
                    </div>

                    <div className="space-y-3">
                        {/* Right Ear */}
                        <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-slate-200">
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                                    <Ear size={12} className="text-indigo-500" /> {ui.rightEar}
                                </span>
                                <span className="text-sm font-semibold text-slate-800">
                                    {getLangLabel(sourceLang)}
                                </span>
                            </div>
                            <label className="flex items-center cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={playSourceInRight}
                                    onChange={(e) => setPlaySourceInRight(e.target.checked)}
                                    className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                                />
                            </label>
                        </div>

                        {/* Left Ear */}
                        <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-slate-200">
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-500 flex items-center gap-1 transform scale-x-[-1]">
                                    <Ear size={12} className="text-violet-500" /> {ui.leftEar}
                                </span>
                                <span className="text-sm font-semibold text-slate-800">
                                    {getLangLabel(targetLang)}
                                </span>
                            </div>
                            <label className="flex items-center cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={playTargetInLeft}
                                    onChange={(e) => setPlayTargetInLeft(e.target.checked)}
                                    className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                                />
                            </label>
                        </div>
                        <p className="text-[10px] text-slate-400 text-center">{ui.enablePlayback}</p>
                    </div>
                    </>
                )}
              </div>
            </div>

            {/* Section 3: Volume Settings */}
             <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                <Volume1 size={16} className="text-indigo-500" />
                {ui.volumeSettings}
              </h3>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                 <div className="flex items-center gap-4">
                    <button 
                        onClick={() => setVolume(0)} 
                        className="text-slate-400 hover:text-slate-600"
                    >
                        {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </button>
                    <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={volume} 
                        onChange={handleVolumeChange}
                        className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                    <input 
                        type="number" 
                        min="0" 
                        max="100" 
                        value={volume} 
                        onChange={handleVolumeChange}
                        className="w-16 bg-white border border-slate-200 rounded-lg py-1 px-2 text-sm font-bold text-center text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                 </div>
              </div>
            </div>

            {/* Section 4: Version Settings */}
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                <Settings size={16} className="text-indigo-500" />
                {ui.versionSettings}
              </h3>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <label className="block text-xs font-medium text-slate-500 mb-2">{ui.appLanguage}</label>
                  <select
                    value={appLanguage}
                    onChange={(e) => setAppLanguage(e.target.value as AppLanguage)}
                    className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500"
                  >
                    {APP_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>{lang.label}</option>
                    ))}
                  </select>
              </div>
            </div>

            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100 mt-2">
                <p className="text-xs text-indigo-600 leading-relaxed">
                  {ui.hint}
                </p>
            </div>

          </div>
          <div className="p-6 border-t border-slate-100 bg-slate-50">
            <p className="text-xs text-center text-slate-400">
              {ui.appName} v1.2
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="w-full bg-white shadow-sm py-4 px-4 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-full transition-colors"
            title={ui.settings}
          >
            <Menu size={24} />
          </button>

          <h1 className="text-xl font-bold flex items-center justify-center gap-2">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              {ui.appName}
            </span>
            <span className="text-base font-semibold text-slate-500">
              ({sourceLang.split('-')[0].toUpperCase()}-{targetLang.split('-')[0].toUpperCase()})
            </span>
          </h1>
          
          <div className="w-10 flex justify-end">
            {(history.length > 0 || transcript || liveTranslation) ? (
              <button 
                type="button"
                onClick={clearHistory}
                className="text-slate-400 hover:text-red-500 transition-colors p-2 rounded-full hover:bg-slate-100 active:bg-slate-200"
                title={ui.clearHistory}
              >
                <Trash2 size={20} />
              </button>
            ) : (
              <div className="w-9"></div> 
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-2xl px-4 pt-6 pb-36 flex flex-col">
        {/* Error Message */}
        {sttError && (
          <div className="mb-4 bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-100 flex items-center justify-center">
            {sttError}
          </div>
        )}

        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-4 no-scrollbar"
          style={{ minHeight: '300px' }}
        >
          {/* Status Indicator */}
          {(isListening || isTranscribing || isProcessing || (isContinuousMode && isSpeaking)) && (
            <div className="bg-white/50 backdrop-blur-sm rounded-2xl p-5 border-2 border-indigo-100 border-dashed transition-all duration-300 mb-4 flex flex-col items-center justify-center min-h-[120px]">
               
               {isListening && !isSpeaking && (
                 <>
                   <div className="flex items-center gap-2 mb-2">
                     <span className="w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                     <p className="text-slate-600 font-medium">
                        {isContinuousMode ? ui.continuousMode : ui.listening}
                     </p>
                   </div>
                   
                   {/* Audio Visualizer */}
                   <div className="flex items-center gap-1 h-8 mt-2">
                        {/* Dynamic Bar based on audioLevel */}
                        <div 
                            className="h-2 rounded-full bg-slate-200 w-full overflow-hidden relative"
                            style={{ maxWidth: '200px' }}
                        >
                            <div 
                                className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-75 ease-out"
                                style={{ width: `${Math.min(100, Math.max(5, audioLevel))}%` }}
                            ></div>
                        </div>
                   </div>

                   {isContinuousMode && (
                       <p className="text-xs text-indigo-400 mt-3 text-center">
                          {audioLevel > 30 ? "偵測到聲音..." : "等待說話..."} <span className="opacity-50">({Math.round(audioLevel)})</span>
                       </p>
                   )}
                 </>
               )}

               {isContinuousMode && isSpeaking && (
                   <div className="flex flex-col items-center gap-3 animate-pulse">
                      <Volume2 className="w-8 h-8 text-indigo-600" />
                      <p className="text-slate-600 font-medium">
                          正在朗讀翻譯...
                      </p>
                   </div>
               )}

               {(isTranscribing || isProcessing) && !isListening && (
                 <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                    <p className="text-slate-600 font-medium">
                        {isTranscribing ? "正在轉錄語音..." : ui.processing}
                    </p>
                 </div>
               )}
            </div>
          )}

          {history.length === 0 && !isListening && !isTranscribing && !isProcessing && (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-4 py-20">
              <History size={48} strokeWidth={1.5} />
              <p className="text-sm font-medium">{ui.languagePref}</p>
            </div>
          )}

          {history.map((record) => (
            <div key={record.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 transition-all hover:shadow-md">
              
              {/* Source Section: Top Line */}
              <div className="mb-3">
                <p className="text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">{ui.sourceTextLabel}</p>
                <div className="text-lg text-slate-800 font-medium leading-relaxed break-words">
                  {record.sourceText}
                </div>
              </div>

              <div className="h-px bg-slate-100 my-2 w-full"></div>
              
              {/* Target Section: Bottom Line */}
              <div className="flex items-start justify-between gap-3">
                <div className="w-full">
                  <p className="text-xs font-bold text-indigo-400 mb-1 uppercase tracking-wider">{ui.translatedTextLabel}</p>
                  <div className="text-lg text-indigo-700 font-semibold leading-relaxed break-words">
                    {record.translatedText}
                  </div>
                </div>
                
                <div className="flex flex-col gap-2 shrink-0 mt-4">
                  <button 
                    onClick={() => handleSpeak(record.translatedText, record.targetLang)}
                    className="p-2 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                    title="Play"
                  >
                    <Volume2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Bottom Controls */}
      <footer className="fixed bottom-0 left-0 w-full bg-white/90 backdrop-blur-xl border-t border-slate-200 pb-safe pt-6 px-8 flex justify-center z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between w-full max-w-[320px] pb-4">
          
          {/* Left: Continuous Mode Button */}
          <button
            onClick={toggleContinuousMode}
            className={`
              w-20 h-20 rounded-2xl shadow-xl flex items-center justify-center transition-all duration-300 active:scale-95 border-2
              ${isContinuousMode 
                ? 'bg-violet-600 text-white border-violet-600 shadow-violet-500/40' 
                : 'bg-white text-violet-600 border-violet-200 shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:bg-violet-50 hover:border-violet-300 hover:-translate-y-1'
              }
            `}
            aria-label={ui.continuousMode}
            title={ui.continuousMode}
          >
             {isContinuousMode ? (
                <Zap size={32} className="fill-current animate-pulse" />
             ) : (
                <RefreshCw size={32} />
             )}
          </button>

          {/* Right: Record Button */}
          <RecordButton
              isListening={isListening && !isContinuousMode} // Only show active state if manually listening
              isProcessing={isProcessing || isTranscribing}
              onClick={toggleRecording}
              label={isListening && !isContinuousMode ? ui.stopRecord : ui.startRecord}
          />
        </div>
      </footer>
    </div>
  );
};

export default App;
