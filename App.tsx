
import React, { useState, useEffect, useRef } from 'react';
import { LanguageSelector } from './components/LanguageSelector';
import { RecordButton } from './components/RecordButton';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useTextToSpeech } from './hooks/useTextToSpeech';
// import { translateText } from './services/groqService'; // [暫停] Groq 翻譯備援，目前改用 HuggingFace WebSocket
import { useTranslationSocket } from './hooks/useTranslationSocket';
import { LanguageCode, TranslationRecord, AppLanguage, ModelProvider } from './types';
import { CLOUDFLARE_BACKEND_URL, DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG, UI_TRANSLATIONS, APP_LANGUAGES, SUPPORTED_LANGUAGES, MODEL_OPTIONS, GROQ_API_KEY, GROQ_API_URL } from './constants';
import { Volume2, Trash2, History, ArrowRight, Menu, X, Settings, Headphones, Globe, CheckCircle2, AlertCircle, Ear, VolumeX, Volume1, Loader2, RefreshCw, Zap, Mic, Camera, ShoppingCart, BookOpen, Scale } from 'lucide-react';
import './App.css';
import { CameraPage, CameraPageHandle } from './components/CameraPage';

const App: React.FC = () => {
  // ── 1. Global States ──────────────────────────────────────────────────────
  const [appLanguage, setAppLanguage] = useState<AppLanguage>('zh-TW');
  const [volume, setVolume] = useState<number>(100);
  const [sourceLang, setSourceLang] = useState<LanguageCode>(DEFAULT_SOURCE_LANG);
  const [targetLang, setTargetLang] = useState<LanguageCode>(DEFAULT_TARGET_LANG);
  const [modelProvider, setModelProvider] = useState<ModelProvider>('deepgram');

  // ── 2. Draft States (for settings page) ───────────────────────────────────
  const [pendingSourceLang, setPendingSourceLang] = useState<LanguageCode>(DEFAULT_SOURCE_LANG);
  const [pendingTargetLang, setPendingTargetLang] = useState<LanguageCode>(DEFAULT_TARGET_LANG);
  const [pendingVolume, setPendingVolume] = useState<number>(100);
  const [pendingAppLanguage, setPendingAppLanguage] = useState<AppLanguage>('zh-TW');
  const [pendingModelProvider, setPendingModelProvider] = useState<ModelProvider>('deepgram');

  // ── 3. Other Core States ──────────────────────────────────────────────────
  const [history, setHistory] = useState<TranslationRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isContinuousMode, setIsContinuousMode] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isCameraStarted, setIsCameraStarted] = useState(false);
  const [activeTts, setActiveTts] = useState<'source' | 'target' | 'binaural' | null>(null);
  const [activeTopTts, setActiveTopTts] = useState<boolean>(false);
  const [activeBottomTts, setActiveBottomTts] = useState<boolean>(false);
  const [leAudioChecking, setLeAudioChecking] = useState(false);
  const [leAudioSupported, setLeAudioSupported] = useState<boolean | null>(null);
  const [playSourceInRight, setPlaySourceInRight] = useState(false);
  const [playTargetInLeft, setPlayTargetInLeft] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // ── 4. Refs ───────────────────────────────────────────────────────────────
  const ignorePendingUpdates = useRef(false);
  const sourcePlayCountRef = useRef({ text: "", count: 0 });
  const targetPlayCountRef = useRef({ text: "", count: 0 });
  const cameraPageRef = useRef<CameraPageHandle>(null);
  const topTtsRef = useRef<TTSState>({ active: false, ear: 'right', lang: 'en', queue: [], lastPlayed: '' });
  const bottomTtsRef = useRef<TTSState>({ active: false, ear: 'left', lang: 'zh-TW', queue: [], lastPlayed: '' });
  const sourceScrollRef = useRef<HTMLDivElement>(null);
  const targetScrollRef = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<any>(null);
  const binauralAudioRef = useRef<{ sourceNode?: AudioBufferSourceNode, targetNode?: AudioBufferSourceNode, audioCtx?: AudioContext }>({});
  const pageSliderRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ── 5. Helper Functions ──────────────────────────────────────────────────
  function finalizeTranslationPlaceholder(text: string, translation?: string, audioBlob?: Blob, currentS2T?: string, currentT2S?: string, confidence?: number, words?: any[]) {
     // This is just a label for the hoisted function below
  }

  // ── 6. Hook Initializations ───────────────────────────────────────────────
  const handleContinuousResult = async (text: string, translation?: string, audioBlob?: Blob, confidence?: number, words?: any[]) => {
    if (!text?.trim() && !translation?.trim()) return;
    await new Promise(resolve => setTimeout(resolve, 400));
    const currentS2T = sourceToTargetTransRef.current;
    const currentT2S = targetToSourceTransRef.current;
    await finalizeTranslation(text, translation, audioBlob, currentS2T, currentT2S, confidence, words);
  };

  // Sync Draft State
  useEffect(() => {
    setPendingSourceLang(sourceLang);
    setPendingTargetLang(targetLang);
  }, [sourceLang, targetLang]);
  useEffect(() => {
    setPendingVolume(volume);
  }, [volume]);
  useEffect(() => {
    setPendingAppLanguage(appLanguage);
  }, [appLanguage]);
  useEffect(() => {
    setPendingModelProvider(modelProvider);
  }, [modelProvider]);

  const hasUnsavedChanges =
    sourceLang !== pendingSourceLang ||
    targetLang !== pendingTargetLang ||
    volume !== pendingVolume ||
    appLanguage !== pendingAppLanguage ||
    modelProvider !== pendingModelProvider;


  const {
    isListening, transcript, liveTranslation, startListening, stopListening,
    abortListening, resetTranscript, clearLiveText, sourceConfidence, sourceWords,
    targetConfidence, targetWords, hasBrowserSupport, audioLevel, isTranscribing, isConnecting
  } = useSpeechRecognition(sourceLang, targetLang, modelProvider, handleContinuousResult);

  const { speak, isSpeaking, speakingType, unlock } = useTextToSpeech();

  const {
    translatedText: sourceToTargetTrans,
    sendText: sendSourceToTarget,
    clearTranslatedText: clearSourceTrans,
    isConnecting: isS2TConnecting,
    error: s2tError,
    translatedTextRef: sourceToTargetTransRef
  } = useTranslationSocket(sourceLang, targetLang, 'source-to-target');

  const {
    translatedText: targetToSourceTrans,
    sendText: sendTargetToSource,
    clearTranslatedText: clearTargetTrans,
    isConnecting: isT2SConnecting,
    error: t2sError,
    translatedTextRef: targetToSourceTransRef
  } = useTranslationSocket(targetLang, sourceLang, 'target-to-source');

  const liveTranslationRef = useRef(liveTranslation);
  useEffect(() => {
    liveTranslationRef.current = liveTranslation;
  }, [liveTranslation]);

  // ── 7. Hook-dependent Functions ───────────────────────────────────────────
  function clearHistory() {
    ignorePendingUpdates.current = true;
    if (activeTopTts) {
      topTtsRef.current.active = false;
      topTtsRef.current.resolve?.();
    }
    if (activeBottomTts) {
      bottomTtsRef.current.active = false;
      bottomTtsRef.current.resolve?.();
    }
    setActiveTopTts(false);
    setActiveBottomTts(false);
    setActiveTts(null);
    clearLiveText();
    clearSourceTrans();
    clearTargetTrans();
    setHistory([]);
    setIsProcessing(false);
  }

  const applySettings = () => {
    if (sourceLang !== pendingSourceLang || targetLang !== pendingTargetLang) {
      clearHistory();
      setSourceLang(pendingSourceLang);
      setTargetLang(pendingTargetLang);
    }
    setVolume(pendingVolume);
    setAppLanguage(pendingAppLanguage);
    setModelProvider(pendingModelProvider);
  };

  const ui = UI_TRANSLATIONS[appLanguage];

  // ── 8. TTS Execution Functions ────────────────────────────────────────────
  async function playCloudflareTTS(text: string, lang: string, type: 'source' | 'target') {
    if (!text?.trim()) return;
    const segments = text.split(/[，,]/).map(s => s.trim()).filter(s => s !== "");
    if (segments.length === 0) return;
    let targetSegment = "";
    if (text.endsWith(",") || text.endsWith("，")) {
      targetSegment = segments[segments.length - 1];
    } else if (segments.length >= 2) {
      targetSegment = segments[segments.length - 2];
    } else {
      targetSegment = segments[0];
    }
    if (!targetSegment) return;
    const tracker = type === 'source' ? sourcePlayCountRef.current : targetPlayCountRef.current;
    if (tracker.text === targetSegment) {
      if (tracker.count >= 3) return;
      tracker.count++;
    } else {
      tracker.text = targetSegment;
      tracker.count = 1;
    }
    try {
      setActiveTts(type);
      const url = `${CLOUDFLARE_BACKEND_URL}/tts?text=${encodeURIComponent(targetSegment)}&lang=${lang}`;
      const audio = new Audio(url);
      audio.onended = () => setActiveTts(null);
      audio.onerror = () => setActiveTts(null);
      if (leAudioSupported) {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(audio);
        const panner = audioCtx.createStereoPanner();
        panner.pan.value = type === 'source' ? -1 : 1;
        source.connect(panner);
        panner.connect(audioCtx.destination);
      }
      await audio.play();
    } catch (err) {
      console.error("Cloudflare TTS failed:", err);
      setActiveTts(null);
    }
  }

  /**
   * 持續監聽特定欄位的 TTS 模式，並指定聲道輸出。
   * - 上框 (Top)：播放英文翻譯 -> 輸出至右耳 (right)
   * - 下框 (Bottom)：播放中文翻譯 -> 輸出至左耳 (left)
   */
  const playContinuousTTS = async (
    boxId: 'top' | 'bottom',
    initText: string,
    ttsLang: string,
    ear: 'left' | 'right'
  ) => {
    const sanitize = (val: string) => (val || "").replace(/\.\.\./g, "").trim();

    // 依據傳入的 boxId 決定要操作哪一組 Ref 和 State
    const currentRef = boxId === 'top' ? topTtsRef : bottomTtsRef;
    const isActive = boxId === 'top' ? activeTopTts : activeBottomTts;
    const setActive = boxId === 'top' ? setActiveTopTts : setActiveBottomTts;

    // 再按一次同一顆按鈕：停止迴圈
    if (isActive) {
      currentRef.current.active = false;
      currentRef.current.resolve?.();
      if (currentRef.current.audioCtx) {
        currentRef.current.audioCtx.close().catch(() => { });
        currentRef.current.audioCtx = undefined;
      }
      currentRef.current = { active: false, ear, lang: 'en', queue: [], lastPlayed: '' };
      setActive(false);
      return;
    }

    const AudioCtxClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) { console.error("[Binaural] AudioContext 不支援"); return; }

    const audioCtx = new AudioCtxClass() as AudioContext;
    await audioCtx.resume();

    // 啟動模式，清空新狀態
    currentRef.current = {
      active: true,
      ear,
      lang: ttsLang,
      audioCtx,
      queue: [],
      lastPlayed: '',
    };
    setActive(true);

    const fetchAndDecode = async (text: string, lang: string): Promise<AudioBuffer | null> => {
      try {
        const url = `${CLOUDFLARE_BACKEND_URL}/tts?text=${encodeURIComponent(text)}&lang=${lang}`;
        const res = await fetch(url, { mode: 'cors', cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        return await new Promise<AudioBuffer>((resolve, reject) =>
          audioCtx.decodeAudioData(arrayBuf, resolve, reject)
        );
      } catch (e) {
        console.error("[Binaural] fetchAndDecode error:", e);
        return null;
      }
    };

    const playSegment = async (text: string): Promise<void> => {
      if (!currentRef.current.active) return;

      const audioBuf = await fetchAndDecode(text, currentRef.current.lang);
      if (!audioBuf) return;
      if (!currentRef.current.active) return;

      const sampleRate = audioCtx.sampleRate;
      const stereoBuffer = audioCtx.createBuffer(2, audioBuf.length, sampleRate);

      // 設定立體聲輸出聲道
      // channel 1 = 右耳, channel 0 = 左耳
      if (currentRef.current.ear === 'right') {
        stereoBuffer.getChannelData(1).set(audioBuf.getChannelData(0));
      } else {
        stereoBuffer.getChannelData(0).set(audioBuf.getChannelData(0));
      }

      return new Promise<void>(resolve => {
        if (!currentRef.current.active) { resolve(); return; }
        const source = audioCtx.createBufferSource();
        source.buffer = stereoBuffer;
        source.connect(audioCtx.destination);
        source.onended = () => resolve();
        source.start(0);
        console.log(`[Binaural] 播放完成 [${boxId}框 -> ${ear}耳]: "${text.slice(0, 10)}..."`);
      });
    };

    const waitForNext = (): Promise<void> =>
      new Promise<void>(resolve => {
        const ref = currentRef.current;
        if (ref.queue.length > 0 || !ref.active) {
          resolve();
        } else {
          ref.resolve = resolve;
        }
      });

    const loop = async () => {
      // 初始文字推入
      const initStr = sanitize(initText);
      if (initStr) {
        currentRef.current.queue.push(initStr);
        currentRef.current.lastPlayed = initStr;
      }

      while (currentRef.current.active) {
        const lRef = currentRef.current;
        if (lRef.queue.length === 0) {
          await waitForNext();
          continue;
        }

        const seg = lRef.queue.shift()!;
        await playSegment(seg);
      }

      console.log(`[Binaural] 監聽迴圈結束 [${boxId}框]`);
      setActive(false);
      setTimeout(() => {
        if (audioCtx.state !== 'closed') audioCtx.close().catch(() => { });
        // binauralAudioRef 此處不再需要
      }, 300);
    };

    loop().catch(err => {
      console.error("[Binaural] 迴圈錯誤:", err);
      setActiveTts((prev) => prev === `continuous-${boxId}` ? null : prev);
    });
  };

  // ---------------------------------------------------------------------------
  // [Confidence Visualization] 信心度視覺化渲染函數
  // 規則：
  //   - 逐字信心度 < 0.85 → 該單字顯示紅色
  //   - 整句不整體變紅，只有個別低信心度的字才變色
  //   - 原始文字的空格、逗號等一律保留（以 text 字串優先）
  // -----------------------------------------------------------------------
  const renderTextWithConfidence = (text: string, confidence?: number, words?: any[]) => {
    if (!text.trim()) return "\u00A0";

    // 如果沒有逐字信心度資料，直接回傳原始字串，空格與標點符號完整保留
    if (!words || words.length === 0) {
      return text;
    }

    // 找出所有「低信心度」的單字 (字面值 → 用 Set 儲存，方便查找)
    const lowConfWords = new Set<string>();
    for (const w of words) {
      if (w.confidence > 0 && w.confidence < 0.85) {
        lowConfWords.add(w.word);
      }
    }

    // 如果所有字都過關，直接回傳原始字串
    if (lowConfWords.size === 0) {
      return text;
    }

    // 有低信心度的字：把原始字串中出現的這些字用紅色 <span> 標記
    // 使用 regex 切割，保留空格與其他字元不變
    const allLowWords = Array.from(lowConfWords)
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // escape regex special chars
      .join('|');
    const pattern = new RegExp(`(${allLowWords})`, 'g');
    const parts = text.split(pattern);

    return (
      <>
        {parts.map((part, idx) =>
          lowConfWords.has(part)
            ? <span key={idx} className="text-red-500">{part}</span>
            : <span key={idx}>{part}</span>
        )}
      </>
    );
  };


  // ---------------------------------------------------------------------------
  // [單耳連續播放觸發器] 根據當前啟動的框，監聽對對應的翻譯文字

  // ---------------------------------------------------------------------------
  // [單耳連續播放觸發器] 根據當前啟動的框，監聽對應的翻譯文字
  // ---------------------------------------------------------------------------

  // 監聽【下框】的第二行：外文翻中文 (targetToSourceTrans)
  // 當下框的語音播放開啟時，只要這行有新翻譯，就推入佇列 (輸出至左耳)
  useEffect(() => {
    const loop = bottomTtsRef.current;
    if (!loop.active) return;
    if (!targetToSourceTrans) return;

    // 將整句按所有中英標點切分，取得最後一個有效片段
    const sSegments = targetToSourceTrans.split(/[,，。\.!？?\n]/).map(s => s.trim()).filter(Boolean);
    const newS = sSegments[sSegments.length - 1] || '';

    if (newS && newS !== loop.lastPlayed) {
      // 防抖機制：等 800ms，如果文字沒有再變長（講話暫停），才推入佇列播放
      const timer = setTimeout(() => {
        const currentSegments = targetToSourceTransRef.current.split(/[,，。\.!？?\n]/).map(s => s.trim()).filter(Boolean);
        const currentNewS = currentSegments[currentSegments.length - 1] || '';
        if (currentNewS === newS && newS !== loop.lastPlayed) {
          loop.lastPlayed = newS;
          loop.queue.push(newS);
          console.log(`[Binaural] 下框翻譯(左耳) 防抖後入佇列: "${newS.slice(0, 10)}..."`);
          loop.resolve?.();
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [targetToSourceTrans]);

  // 監聽【上框】的第二行：中文翻外文 (sourceToTargetTrans)
  // 當上框的語音播放開啟時，只要這行有新翻譯，就推入佇列 (輸出至右耳)
  useEffect(() => {
    const loop = topTtsRef.current;
    if (!loop.active) return;
    if (!sourceToTargetTrans) return;

    // 將整句按所有中英標點切分，取得最後一個有效片段
    const tSegments = sourceToTargetTrans.split(/[,，。\.!？?\n]/).map(t => t.trim()).filter(Boolean);
    const newT = tSegments[tSegments.length - 1] || '';

    if (newT && newT !== loop.lastPlayed) {
      // 防抖機制：等 800ms，如果文字沒有再變長（講話暫停），才推入佇列播放
      const timer = setTimeout(() => {
        const currentSegments = sourceToTargetTransRef.current.split(/[,，。\.!？?\n]/).map(t => t.trim()).filter(Boolean);
        const currentNewT = currentSegments[currentSegments.length - 1] || '';
        if (currentNewT === newT && newT !== loop.lastPlayed) {
          loop.lastPlayed = newT;
          loop.queue.push(newT);
          console.log(`[Binaural] 上框翻譯(右耳) 防抖後入佇列: "${newT.slice(0, 10)}..."`);
          loop.resolve?.();
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [sourceToTargetTrans]);

  // 水平滾動框模式：每次有新文字自動捲到最右邊
  useEffect(() => {
    if (sourceScrollRef.current) {
      sourceScrollRef.current.scrollLeft = sourceScrollRef.current.scrollWidth;
    }
    if (targetScrollRef.current) {
      targetScrollRef.current.scrollLeft = targetScrollRef.current.scrollWidth;
    }
  }, [history, transcript, liveTranslation, isListening, isProcessing, isTranscribing, sourceToTargetTrans, targetToSourceTrans]);

  // REMOVED: Feedback Loop Protection (abortListening when speaking)
  // Since user has headphones, we allow full duplex (record while speaking)

  // REMOVED: Auto-start listening loop that overrides manual toggle

  // Determine audio panning based on language and LE Audio setting
  // Logic: Source Lang -> Right Ear (1), Target Lang -> Left Ear (-1)
  const getAudioPan = (lang: LanguageCode): number => {
    if (!leAudioSupported) return 0; // Center if LE Audio not active

    if (lang === sourceLang) return 1; // Right Ear for Source
    if (lang === targetLang) return -1; // Left Ear for Target

    return 0; // Other/Unknown languages center
  };

  const handleSpeak = (text: string, lang: LanguageCode, type?: 'source' | 'target') => {
    const pan = getAudioPan(lang);
    // Convert 0-100 to 0.0-1.0
    speak(text, lang, pan, volume / 100, type);
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

  // Helper to get short localized name for dialogue boxes
  const getShortLangLabel = (code: LanguageCode) => {
    switch (code) {
      case LanguageCode.Chinese: return '中文';
      case LanguageCode.English: return '英文';
      case LanguageCode.Vietnamese: return '越南文';
      case LanguageCode.Thai: return '泰文';
      case LanguageCode.Indonesian: return '印尼文';
      default: return getLangLabel(code);
    }
  };

  // Helper to get localized placeholder for target language
  const getTargetPlaceholder = (code: LanguageCode) => {
    switch (code) {
      case LanguageCode.Chinese: return '等待語音輸入';
      case LanguageCode.English: return 'Waiting for English voice input';
      case LanguageCode.Vietnamese: return 'Đang chờ nhập giọng nói tiếng Việt';
      case LanguageCode.Thai: return 'กำลังรอการป้อนเสียงภาษาไทย';
      case LanguageCode.Indonesian: return 'Menunggu input suara bahasa Indonesia';
      default: return '等待語音輸入';
    }
  };

  // Handle Volume Change (Draft)
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (!isNaN(val)) {
      setPendingVolume(Math.min(100, Math.max(0, val)));
    }
  };

  // Finalize translation and add to history
  // 接收整理好的中文與外文，直接存入紀錄，並將音訊檔上傳至 Cloudflare Dual-Track 後端
  async function finalizeTranslation(
    currentTranscript: string,
    currentTranslation?: string,
    audioBlob?: Blob,
    s2tOverride?: string,
    t2sOverride?: string,
    scOverride?: number,
    swOverride?: any[]
  ) {
    if (!currentTranscript?.trim() && !currentTranslation?.trim()) return;
    setIsProcessing(true);
    try {
      if (ignorePendingUpdates.current) return;
      let finalSourceText = currentTranscript?.trim() || "";
      let finalTransText = currentTranslation?.trim() || "";

      let finalSourceConf = scOverride ?? sourceConfidence;
      let finalSourceWords = swOverride ?? sourceWords;

      // 避免 Deepgram 雜音單獨一個標點符號被當成有效輸入而覆蓋掉預期的星號
      if (finalSourceText.length === 1 && /^[.,?!。，？！]$/.test(finalSourceText)) finalSourceText = "";
      if (finalTransText.length === 1 && /^[.,?!。，？！]$/.test(finalTransText)) finalTransText = "";

      // 優先使用傳入的快照結果 (避開 Race Condition)
      let sourceTransText = s2tOverride || sourceToTargetTransRef.current?.trim() || "";
      let targetTransText = t2sOverride || targetToSourceTransRef.current?.trim() || "";

      // -----------------------------------------------------------------------
      // [除錯說明] UI 畫面佔位與對齊處理
      // 為了維持畫面上左右滑動的跑馬燈中，「辨識行」與「翻譯行」的精確對齊：
      // 只要有一方說話，即使另一方沒說話（或正處於尚未有翻譯結果的狀態），
      // 我們也必須強制放入一個空白字串 " " 來佔據原本該顯示文字的位置。
      // 才不會導致下一個段落的逗號錯位。
      // -----------------------------------------------------------------------
      if (!finalSourceText && finalTransText) {
        finalSourceText = " ";
        sourceTransText = " ";
      } else if (!finalTransText && finalSourceText) {
        finalTransText = " ";
        targetTransText = " ";
      } else if (!finalSourceText && !finalTransText) {
        // Fallback 極端情況
        finalSourceText = " ";
        finalTransText = " ";
      }

      const newRecord: TranslationRecord = {
        id: Date.now().toString() + Math.random().toString().slice(2, 5),
        sourceText: finalSourceText, // 中文 (辨識)
        sourceTranslatedText: sourceTransText || "...", // 預設值，稍候可能被 REST 翻譯更新
        targetText: finalTransText, // 外文 (辨識)
        targetTranslatedText: targetTransText || "...",
        sourceLang,
        targetLang,
        timestamp: Date.now(),
        sourceConfidence: finalSourceConf,
        sourceWords: finalSourceWords,
      };

      setHistory((prev) => [newRecord, ...prev]);

      // --- [同步加強] 如果快照到的翻譯為空，或是為了保證翻譯完整性，執行一次 REST 翻譯 ---
      const ensureTranslation = async () => {
        try {
          // 只有在信心度 >= 0.7 且沒有處於 SeaLLMs 模式時才需要這裡的補位
          // (因為 SeaLLMs 模式會在下面執行更複雜的併列翻譯)
          // 只有在信心度 >= 0.7 且沒有處於 SeaLLMs 模式時才需要這裡的補位
          /* [暫停] Groq 備援翻譯，目前主翻譯由 HuggingFace WebSocket 負責
          const [freshS2T, freshT2S] = await Promise.all([
            finalSourceText.trim() ? translateText(finalSourceText, sourceLang, targetLang) : Promise.resolve(""),
            finalTransText.trim() ? translateText(finalTransText, targetLang, sourceLang) : Promise.resolve("")
          ]);
  
          setHistory(prev => prev.map(rec =>
            rec.id === newRecord.id
              ? { ...rec, sourceTranslatedText: freshS2T || rec.sourceTranslatedText, targetTranslatedText: freshT2S || rec.targetTranslatedText }
              : rec
          ));
  
          // 執行資料庫上傳
          performUpload(
            finalSourceText,
            freshS2T || sourceTransText,
            finalTransText,
            freshT2S || targetTransText,
            finalSourceConf,
            finalSourceWords
          );
          */

          // 直接上傳 WebSocket 翻譯結果
          performUpload(
            finalSourceText,
            sourceTransText,
            finalTransText,
            targetTransText,
            finalSourceConf,
            finalSourceWords
          );
        } catch (e) {
          console.error("Ensuring translation failed:", e);
          performUpload(finalSourceText, sourceTransText, finalTransText, targetTransText, finalSourceConf, finalSourceWords);
        }
      };

      /**
       * 內部輔助函式：執行實際的資料庫上傳
       */
      const performUpload = async (
        sText: string,
        sTrans: string,
        tText: string,
        tTrans: string,
        conf?: number,
        words?: any[]
      ) => {
        if (!audioBlob || (!sText.trim() && !tText.trim())) {
          setIsProcessing(false);
          return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "audio.webm");
          formData.append("source_text", sText.trim());
          formData.append("source_translated_text", sTrans.trim());
          formData.append("target_text", tText.trim());
          formData.append("target_translated_text", tTrans.trim());
          formData.append("source_lang", sourceLang);
          formData.append("target_lang", targetLang);
          formData.append("sessionId", "do-talk-web-session");
          formData.append("userid", "user");

          if (conf !== undefined) formData.append("source_confidence", conf.toString());
          if (words) formData.append("source_words", JSON.stringify(words));

          console.log("🚀 Uploading to Cloudflare Worker...");
          const res = await fetch(`${CLOUDFLARE_BACKEND_URL}/upload`, {
            method: 'POST',
            body: formData,
            signal: controller.signal
          });

          if (res.ok) {
            console.log("✅ Cloudflare upload success!");
          } else {
            console.error("❌ Cloudflare upload HTTP Error:", res.status);
          }
        } catch (err: any) {
          if (err.name === 'AbortError') console.error("❌ Upload timed out");
          else console.error("❌ Cloudflare upload failed:", err);
        } finally {
          clearTimeout(timeoutId);
          setIsProcessing(false);
        }
      };

      // --- [AI Correction] 信心度過低時 (< 0.7)，呼叫 AI 進行修正 (採用 Llama-3.1) ---
      if (finalSourceConf !== undefined && finalSourceConf > 0 && finalSourceConf < 0.7 && finalSourceText.trim()) {
        console.log(`🧠 Confidence low (${finalSourceConf.toFixed(2)}), triggering SeaLLMs correction...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超時

        fetch(`${CLOUDFLARE_BACKEND_URL}/correct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: finalSourceText }),
          signal: controller.signal
        })
          .then(res => res.json())
          .then(async (data: any) => {
            clearTimeout(timeoutId);
            if (data.corrected) {
              const correctedText = data.corrected;
              console.log("✨ SeaLLMs Corrected:", correctedText);
              const displaySource = `${finalSourceText} (${correctedText})`;

              setHistory(prev => prev.map(rec =>
                rec.id === newRecord.id ? {
                  ...rec,
                  sourceCorrectedText: correctedText,
                  sourceText: displaySource
                } : rec
              ));

              try {
                /* [暫停] Groq 修正後翻譯，目前改由 HuggingFace WebSocket 處理
                const [transOrig, transCorr] = await Promise.all([
                  translateText(finalSourceText, sourceLang, targetLang),
                  translateText(correctedText, sourceLang, targetLang)
                ]);
  
                const cleanedO = (transOrig || "...").replace(/[。，,.!?！？]$/, "");
                const cleanedC = (transCorr || "...").replace(/[。，,.!?！？]$/, "");
                const combinedTrans = `${cleanedO}(${cleanedC})`;
  
                setHistory(prev => prev.map(rec =>
                  rec.id === newRecord.id ? { ...rec, sourceTranslatedText: combinedTrans } : rec
                ));
  
                performUpload(displaySource, combinedTrans, finalTransText, targetTransText, finalSourceConf, finalSourceWords);
                */
                performUpload(displaySource, sourceTransText, finalTransText, targetTransText, finalSourceConf, finalSourceWords);
              } catch (e) {
                performUpload(displaySource, sourceTransText, finalTransText, targetTransText, finalSourceConf, finalSourceWords);
              }
            } else {
              performUpload(finalSourceText, sourceTransText, finalTransText, targetTransText, finalSourceConf, finalSourceWords);
            }
          })
          .catch(err => {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') console.error("❌ Correction timed out");
            else console.error("❌ SeaLLMs Correction failed:", err);
            performUpload(finalSourceText, sourceTransText, finalTransText, targetTransText, finalSourceConf, finalSourceWords);
          });
      } else {
        // --- 正常情況 (信心度 OK): 執行加強翻譯並上傳 ---
        ensureTranslation();
      }

      // [同步優化] 在所有處理（包括 AI 修正）完畢後，才清空翻譯佔位。
      // 這樣可以保證畫面上的翻譯文字在「轉移到歷史紀錄」之前都不會消失。
      clearSourceTrans();
      clearTargetTrans();
    } catch (err) {
      console.error("Record save error", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Manual Toggle (Center Button)
  const toggleRecording = async () => {
    if (isListening) {
      // 停止錄音
      releaseWakeLock();
      setIsProcessing(true);
      try {
        const finalResults = await stopListening();

        // [同步優化] 停止後也稍等一下，確保最後一小段譯文能從 Socket 跑完
        await new Promise(resolve => setTimeout(resolve, 400));

        if (finalResults && (finalResults.transcript?.trim() || finalResults.translation?.trim())) {
          await finalizeTranslation(
            finalResults.transcript,
            finalResults.translation,
            finalResults.audioBlob,
            undefined,
            undefined,
            finalResults.confidence,
            finalResults.words
          );
          resetTranscript(); // ✅ 存完歷史後清空第一行，避免重複顯示在第一行與第二行
          clearSourceTrans();
          clearTargetTrans();
        }
      } catch (e) {
        console.error("Error processing audio:", e);
      } finally {
        setIsProcessing(false);
      }
    } else {
      // 開始錄音
      ignorePendingUpdates.current = false;
      resetTranscript();
      unlock(); // UNLOCK iOS TTS on initial click
      await startListening();
      await requestWakeLock();
    }
  };
  // --- [Wake Lock Logic] 防止手機休眠 ---
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        // @ts-ignore
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('💡 Screen Wake Lock is active');
      } catch (err: any) {
        console.error(`${err.name}, ${err.message}`);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => {
        wakeLockRef.current = null;
        console.log('😴 Screen Wake Lock released');
      });
    }
  };

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (wakeLockRef.current !== null && document.visibilityState === 'visible' && isListening) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isListening]);

  // 導覽安全性：當切換離「語音翻譯」頁面 (index 0) 時，自動停止錄音
  useEffect(() => {
    if (currentIndex !== 0 && isListening) {
      console.log("Navigated away from voice page, stopping recording...");
      if (wakeLockRef.current) wakeLockRef.current.release().catch(console.error);
      setIsProcessing(true);
      stopListening().then(async (finalResults) => {
        setIsProcessing(false);
        // ... omitted final save to keep navigation smooth
      }).catch(e => {
        console.error("Error stopping audio on navigation:", e);
        setIsProcessing(false);
      });
    }
  }, [currentIndex, isListening, stopListening]);

  // --- Scroll-Wheel Navigation Logic ---
  const scrollToPage = (index: number) => {
    if (isSyncing) return;
    setIsSyncing(true);
    setCurrentIndex(index);

    if (pageSliderRef.current) {
      const pageWidth = pageSliderRef.current.clientWidth;
      pageSliderRef.current.scrollTo({ left: pageWidth * index, behavior: 'smooth' });
    }

    const btn = buttonRefs.current[index];
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

    setTimeout(() => setIsSyncing(false), 500);
  };

  const handlePageScroll = () => {
    if (isSyncing || !pageSliderRef.current) return;
    const slider = pageSliderRef.current;
    const scrollCenter = slider.scrollLeft + (slider.clientWidth / 2);
    const pageWidth = slider.clientWidth;
    const newIndex = Math.round(slider.scrollLeft / pageWidth);

    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < 6) {
      setCurrentIndex(newIndex);
      const btn = buttonRefs.current[newIndex];
      if (btn) {
        setIsSyncing(true);
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        setTimeout(() => setIsSyncing(false), 500);
      }
    }
  };

  const handleWheelScroll = () => {
    if (isSyncing || !wheelRef.current) return;
    const wheel = wheelRef.current;
    const containerCenter = wheel.scrollLeft + (wheel.clientWidth / 2);
    let closestIndex = 0;
    let minDistance = Infinity;

    buttonRefs.current.forEach((btn, index) => {
      if (!btn) return;
      const btnCenter = btn.offsetLeft + (btn.clientWidth / 2);
      const distance = Math.abs(containerCenter - btnCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });

    if (closestIndex !== currentIndex) {
      setCurrentIndex(closestIndex);
      if (pageSliderRef.current) {
        setIsSyncing(true);
        const pageWidth = pageSliderRef.current.clientWidth;
        pageSliderRef.current.scrollTo({ left: pageWidth * closestIndex, behavior: 'smooth' });
        setTimeout(() => setIsSyncing(false), 500);
      }
    }
  };

  const navItems = [
    { id: 'voice', label: '語音', icon: <Mic />, color: '#ffffff', title: '語音翻譯' },
    { id: 'camera', label: '攝影', icon: <Camera />, color: '#ec4899', title: '攝影翻譯' },
    { id: 'mall', label: '商城', icon: <ShoppingCart />, color: '#06b6d4', title: '電子商城' },
    { id: 'learning', label: '教學', icon: <BookOpen />, color: '#8b5cf6', title: '語言教學' },
    { id: 'regulations', label: '法規', icon: <Scale />, color: '#f59e0b', title: '法規新知' },
    { id: 'settings', label: '設定', icon: <Settings />, color: '#64748b', title: '系統設定' },
  ];

  return (
    <div className="app-container">
      {/* ------------------- 上方：頁面滑動區 ------------------- */}
      <div className="content-slider" ref={pageSliderRef} onScroll={handlePageScroll}>

        {/* Page 1: 語音翻譯 */}
        <div className="page" style={{ backgroundColor: '#fef08a' }}>

          {/* Header */}
          <header className="w-full bg-transparent shadow-none py-4 px-4 sticky top-0 z-20">
            <div className="max-w-2xl mx-auto flex items-center justify-between">
              <div className="w-10"></div>

              <h1 className="text-2xl font-black flex items-center justify-center gap-2" style={{ fontFamily: "'Outfit', sans-serif" }}>
                <span className="bg-clip-text text-transparent bg-gradient-to-br from-indigo-700 via-violet-600 to-indigo-500 drop-shadow-sm tracking-tight">
                  {ui.appName}
                </span>
                <span className="text-sm font-semibold text-slate-400 font-sans tracking-normal mt-1">
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

          {/* Main Content Area - Full Screen Split */}
          <main className="flex-1 w-full max-w-2xl px-4 pt-4 pb-4 flex flex-col gap-4 overflow-hidden">
            {/* Error Message */}
            {sttError && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-100 flex items-center justify-center shrink-0">
                {sttError}
              </div>
            )}

            {/* Top Half: Source Language (Chinese) */}
            <div className="flex-1 bg-white rounded-3xl p-6 shadow-sm border border-slate-200 flex flex-col relative overflow-hidden group">
              <div className="absolute top-4 right-4 flex items-center gap-2">
                <button
                  onClick={() => {
                    // 上框播放目標語翻譯，往右耳送出
                    const tText = sourceToTargetTrans || (history.length > 0 ? history[0].sourceTranslatedText : "");
                    playContinuousTTS('top', tText, targetLang, 'right');
                  }}
                  className={`p-2 rounded-full transition-all duration-300 shadow-sm ${activeTopTts
                    ? "bg-red-500 text-white animate-pulse"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  title="Play Binaural Translation"
                >
                  <Volume2 size={18} />
                </button>
              </div>
              <p className="text-sm font-bold text-slate-400 mb-2 tracking-wider flex items-center gap-2 uppercase">
                {sourceLang === 'zh-TW' ? '中文' : getLangLabel(sourceLang)} {"->"} {targetLang === 'zh-TW' ? '中文' : getLangLabel(targetLang)}
              </p>
              <div className="w-full flex-1 overflow-x-auto overflow-y-hidden no-scrollbar relative flex items-center" ref={sourceScrollRef}>
                {/* 
              [排版說明]跑馬燈設計 (橫向捲軸) 
              使用 `flex` 排列加上 `whitespace-nowrap` 確保文字不換行。
              `items-start` 讓「上方辨識行」跟「下方翻譯行」能夠對齊頂部，避免因為中文字與英文字母的高度差異造成位移。
            */}
                <div className="flex gap-2 items-start whitespace-nowrap min-w-max px-2 ml-auto">
                  {/* 歷史紀錄：以「，」為切割點，每個片語獨立成一栏並向右靠齊 */}
                  {history.slice().reverse().map((record) => {
                    // 將辨識和翻譯分別以「。」切割為片語陣列，實作句號對齊
                    const srcPhrases = record.sourceText.split(/[。.]/).map(p => p.trim()).filter(Boolean);
                    const transPhrases = record.sourceTranslatedText.split(/[。.]/).map(p => p.trim()).filter(Boolean);
                    const maxLen = Math.max(srcPhrases.length, transPhrases.length, 1);

                    return Array.from({ length: maxLen }, (_, i) => {
                      const srcPhrase = srcPhrases[i] || '';
                      const transPhrase = transPhrases[i] || '';
                      const isLastSrc = i === maxLen - 1;

                      return (
                        <div key={`${record.id}-${i}`} className="flex flex-col items-end text-right opacity-80 opacity-transition">
                          {/* 第一行：辨識片語 */}
                          <div className="text-3xl text-slate-800 font-bold tracking-normal leading-tight min-h-[2.5rem] flex items-end">
                            {srcPhrase
                              ? renderTextWithConfidence(srcPhrase, record.sourceConfidence, record.sourceWords)
                              : <span className="opacity-0">&#12288;</span>}
                            {/* 最後一片語展示 AI 修正 */}
                            {isLastSrc && record.sourceCorrectedText && (
                              <span className="text-indigo-600">({record.sourceCorrectedText})</span>
                            )}
                            {/* 最後一片語結尾加「。」，中間片語結尾加「，」 */}
                            {srcPhrase && <span>{isLastSrc ? '。' : '，'}</span>}
                          </div>
                          {/* 第二行：翻譯片語 */}
                          <div className="text-2xl text-slate-500 font-medium tracking-normal leading-tight mt-1 min-h-[2rem] flex items-start">
                            {transPhrase
                              ? `${transPhrase}${isLastSrc ? '。' : '。'}`
                              : '\u00A0'}
                          </div>
                        </div>
                      );
                    });
                  })}

                  {/* 當前即時辨識：只要在錄音中或有文字，就保持區塊存在，防止閃爍 */}
                  {(isListening || transcript?.trim() || liveTranslation?.trim() || history.length === 0) && (
                    <div className="flex flex-col items-end text-right">
                      <div className={`text-3xl font-bold tracking-normal leading-tight flex items-end min-h-[2.5rem] ${transcript?.trim() ? 'text-slate-800' : 'text-slate-300'}`}>
                        <span>{transcript?.trim() ? renderTextWithConfidence(transcript, sourceConfidence, sourceWords) : (isListening ? "..." : (liveTranslation?.trim() ? " \u00A0 \u00A0 " : "等待語音輸入"))} </span>
                        {transcript?.trim() && <span className="inline-block w-2.5 h-7 ml-2 bg-indigo-500 animate-pulse rounded-sm"></span>}
                      </div>
                      <div className="text-2xl text-slate-500 font-medium tracking-normal leading-tight mt-1 min-h-[2rem] animate-fade-in flex items-start">
                        {transcript?.trim() ? (
                          sourceToTargetTrans ? `${sourceToTargetTrans} ` : (
                            isS2TConnecting ? (
                              <span className="flex items-center gap-2 text-amber-500 italic text-sm">
                                <Loader2 size={14} className="animate-spin" />
                                連線中...
                              </span>
                            ) : (
                              <span className="flex items-center gap-2 text-slate-300 italic text-sm">
                                <Loader2 size={14} className="animate-spin" />
                                翻譯中...
                              </span>
                            )
                          )
                        ) : "\u00A0"}
                      </div>
                    </div>
                  )}
                </div>
                <div ref={sourceScrollRef} className="w-1 h-full shrink-0"></div>
              </div>
            </div>

            {/* Bottom Half: Target Language (Other) */}
            <div className="flex-1 bg-gradient-to-br from-indigo-50 to-violet-50 rounded-3xl p-6 shadow-sm border border-indigo-100 flex flex-col relative overflow-hidden group">
              <div className="absolute top-4 right-4 flex items-center gap-2">
                <button
                  onClick={() => {
                    // 下框播放來源語翻譯（中文），往左耳送出
                    const textToPlay = targetToSourceTrans || (history.length > 0 ? history[0].targetTranslatedText : "");
                    playContinuousTTS('bottom', textToPlay, sourceLang, 'left');
                  }}
                  className={`p-2 rounded-full transition-all duration-300 shadow-sm ${activeBottomTts
                    ? "bg-red-500 text-white animate-pulse"
                    : "bg-white/50 text-indigo-600 hover:bg-white/80"
                    }`}
                  title="Play Translation"
                >
                  <Volume2 size={18} />
                </button>
              </div>
              <p className="text-sm font-bold text-indigo-500 mb-2 tracking-wider flex items-center gap-2 uppercase">
                {targetLang === 'zh-TW' ? '中文' : getLangLabel(targetLang)} {"->"} {sourceLang === 'zh-TW' ? '中文' : getLangLabel(sourceLang)}
              </p>
              <div className="w-full flex-1 overflow-x-auto overflow-y-hidden no-scrollbar relative flex items-center" ref={targetScrollRef}>
                <div className="flex gap-2 items-start whitespace-nowrap min-w-max px-2 ml-auto">
                  {/* 歷史紀錄：以「。」為切割點，每個片語獨立成一栏 */}
                  {history.slice().reverse().map((record) => {
                    const tgtPhrases = record.targetText.split(/[。.]/).map(p => p.trim()).filter(Boolean);
                    const tgtTransPhrases = record.targetTranslatedText.split(/[。.]/).map(p => p.trim()).filter(Boolean);
                    const maxLen = Math.max(tgtPhrases.length, tgtTransPhrases.length, 1);

                    return Array.from({ length: maxLen }, (_, i) => {
                      const tgtPhrase = tgtPhrases[i] || '';
                      const tgtTransPhrase = tgtTransPhrases[i] || '';
                      const isLastTgt = i === maxLen - 1;

                      return (
                        <div key={`${record.id}-${i}`} className="flex flex-col items-end text-right opacity-80 opacity-transition">
                          <div className="text-3xl text-indigo-900 font-bold tracking-normal leading-tight min-h-[2.5rem] flex items-end">
                            {tgtPhrase
                              ? renderTextWithConfidence(tgtPhrase, record.targetConfidence, record.targetWords)
                              : <span className="opacity-0">&#12288;</span>}
                            {isLastTgt && record.targetCorrectedText && (
                              <span className="text-indigo-600">({record.targetCorrectedText})</span>
                            )}
                            {tgtPhrase && <span>{isLastTgt ? '。' : '，'}</span>}
                          </div>
                          <div className="text-2xl text-indigo-500 font-medium tracking-normal leading-tight mt-1 min-h-[2rem] flex items-start">
                            {tgtTransPhrase
                              ? `${tgtTransPhrase}${isLastTgt ? '。' : '。'}`
                              : '\u00A0'}
                          </div>
                        </div>
                      );
                    });
                  })}

                  {/* 即時結果區：固定存在避免閃爍 */}
                  {(isListening || liveTranslation?.trim() || transcript?.trim() || history.length === 0) && (
                    <div className="flex flex-col items-end text-right">
                      <div className={`text-3xl font-bold tracking-normal leading-tight min-h-[2.5rem] flex items-end ${liveTranslation?.trim() ? 'text-indigo-900' : 'text-indigo-300/50'}`}>
                        {liveTranslation?.trim() ? renderTextWithConfidence(liveTranslation, targetConfidence, targetWords) : (isListening ? "..." : (transcript?.trim() ? " \u00A0 \u00A0 " : getTargetPlaceholder(targetLang)))}
                      </div>
                      <div className="text-2xl text-indigo-500 font-medium tracking-normal leading-tight mt-1 min-h-[2rem] animate-fade-in flex items-start">
                        {liveTranslation?.trim() ? (
                          targetToSourceTrans ? `${targetToSourceTrans} ` : (
                            isT2SConnecting ? (
                              <span className="flex items-center gap-2 text-amber-500 italic text-sm">
                                <Loader2 size={14} className="animate-spin" />
                                連線中...
                              </span>
                            ) : (
                              <span className="flex items-center gap-2 text-indigo-300 italic text-sm">
                                <Loader2 size={14} className="animate-spin" />
                                翻譯中...
                              </span>
                            )
                          )
                        ) : "\u00A0"}
                      </div>
                    </div>
                  )}
                </div>
                <div ref={targetScrollRef} className="w-1 h-full shrink-0"></div>
              </div>
            </div>
          </main>
        </div>

        {/* Page 2: 攝影翻譯 */}
        {/* 移植自 camera_test/index.html，以獨立元件形式整合，方便除錯 */}
        {/* 相機開關由底部導覽輪「攝影」按鈕控制，透過 ref 呼叫 toggleCamera */}
        <div className="page" style={{ backgroundColor: '#111111' }}>
          <CameraPage
            ref={cameraPageRef}
            isActive={currentIndex === 1}
            targetLang={targetLang}
            onStateChange={setIsCameraStarted}
          />
        </div>

        {/* Page 3: 電子商城 */}
        <div className="page" style={{ backgroundColor: '#81ecec' }}>
          <div className="flex flex-col items-center justify-center flex-1 text-slate-800 p-8 text-center">
            <ShoppingCart size={100} className="mb-6 opacity-30" />
            <h2 className="text-4xl font-black mb-4">🛒 電子商城</h2>
            <p className="text-xl opacity-80">探索最新上架的商品...</p>
          </div>
        </div>

        {/* Page 4: 語言教學 */}
        <div className="page" style={{ backgroundColor: '#74b9ff' }}>
          <div className="flex flex-col items-center justify-center flex-1 text-white p-8 text-center">
            <BookOpen size={100} className="mb-6 opacity-30" />
            <h2 className="text-4xl font-black mb-4">📚 語言教學</h2>
            <p className="text-xl opacity-80">每日一句，輕鬆學外語...</p>
          </div>
        </div>

        {/* Page 5: 法規新知 */}
        <div className="page" style={{ backgroundColor: '#a29bfe' }}>
          <div className="flex flex-col items-center justify-center flex-1 text-white p-8 text-center">
            <Scale size={100} className="mb-6 opacity-30" />
            <h2 className="text-4xl font-black mb-4">⚖️ 法規新知</h2>
            <p className="text-xl opacity-80">為您整理最新法規異動...</p>
          </div>
        </div>

        {/* Page 6: 系統設定 */}
        <div className="page" style={{ backgroundColor: '#f1f5f9' }}>
          <div className="flex flex-col h-full max-w-2xl mx-auto w-full">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-600" />
                {ui.settings}
              </h2>

            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-6">

              {/* Section 1: Translation Settings */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <Globe size={16} className="text-indigo-500" />
                  {ui.translationSettings}
                </h3>
                <LanguageSelector
                  sourceLang={pendingSourceLang}
                  targetLang={pendingTargetLang}
                  onSourceChange={(lang) => setPendingSourceLang(lang)}
                  onTargetChange={(lang) => setPendingTargetLang(lang)}
                  onSwap={() => {
                    const temp = pendingSourceLang;
                    setPendingSourceLang(pendingTargetLang);
                    setPendingTargetLang(temp);
                  }}
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

                      {/* REMOVED: Auto-playback toggles completely disabled as requested */}
                      {false && (
                        <div className="space-y-3">
                          {/* Right Ear */}
                          <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-slate-200">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                                <Ear size={12} className="text-indigo-500" /> {ui.rightEar}
                              </span>
                              <span className="text-sm font-semibold text-slate-800">
                                {getLangLabel(pendingSourceLang)}
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
                                {getLangLabel(pendingTargetLang)}
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
                      )}
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
                      onClick={() => setPendingVolume(0)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      {pendingVolume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={pendingVolume}
                      onChange={handleVolumeChange}
                      className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={pendingVolume}
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
                    value={pendingAppLanguage}
                    onChange={(e) => setPendingAppLanguage(e.target.value as AppLanguage)}
                    className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500"
                  >
                    {APP_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>{lang.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Section 5: Model Settings */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <Zap size={16} className="text-indigo-500" />
                  {ui.modelSettings}
                </h3>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <label className="block text-xs font-medium text-slate-500 mb-2">{ui.selectModel}</label>
                  <select
                    value={pendingModelProvider}
                    onChange={(e) => setPendingModelProvider(e.target.value as ModelProvider)}
                    className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500"
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
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
                {ui.appName} v1.2</p>
            </div>
          </div>
        </div>

      </div>

      {/* ------------------- 下方：圓形按鈕滑動區 ------------------- */}
      <div className="scroll-wheel-container">
        <div className="scroll-wheel" ref={wheelRef} onScroll={handleWheelScroll}>
          {navItems.map((item, index) => {
            // 計算語音按鈕的連線/載入狀態
            const isVoiceLoading = item.id === 'voice' && (isConnecting || isS2TConnecting || isT2SConnecting || isProcessing || isTranscribing);
            // 攝影按鈕：已在攝影頁且相機開啟時顯示 recording 動效
            const isCameraRecording = item.id === 'camera' && isCameraStarted;

            // 設定按鈕：有未儲存變更時顯示 recording 動效
            const isSettingsPending = item.id === 'settings' && hasUnsavedChanges;

            return (
              <div key={item.id} className="wheel-btn-wrapper">
                <div
                  ref={el => buttonRefs.current[index] = el}
                  className={`wheel-btn ${currentIndex === index ? 'active' : ''} ${item.id === 'voice' && isListening ? 'recording' : ''} ${isCameraRecording ? 'recording' : ''} ${isSettingsPending ? 'recording' : ''}`}
                  onClick={() => {
                    if (item.id === 'settings' && hasUnsavedChanges) {
                      // 若為設定按鈕且有未儲存變更，點擊時套用變更（不跳轉頁面，若已在該頁）
                      applySettings();
                      if (currentIndex !== index) scrollToPage(index);
                    } else if (item.id === 'voice' && currentIndex === index) {
                      // 語音頁：切換錄音
                      if (!isVoiceLoading) toggleRecording();
                    } else if (item.id === 'camera' && currentIndex === index) {
                      // 攝影頁：直接切換相機開/關（透過 ref 呼叫 CameraPage 的 toggleCamera）
                      cameraPageRef.current?.toggleCamera();
                    } else {
                      scrollToPage(index);
                    }
                  }}
                  style={
                    item.id === 'settings' && hasUnsavedChanges
                      ? { color: 'white', backgroundColor: '#ef4444', borderColor: '#dc2626' } // 有更動時變成明顯紅色
                      : currentIndex === index
                        ? { color: 'white' }
                        : { color: '#888' }
                  }
                >
                  {isVoiceLoading ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    item.icon
                  )}
                  <span className="text-xs mt-1 font-medium">
                    {item.id === 'voice' && isListening ? ui.stopRecord
                      : item.id === 'camera' && isCameraStarted ? '停止'
                      : item.id === 'settings' && hasUnsavedChanges ? '儲存'
                      : item.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default App;
