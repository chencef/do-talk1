import { useState, useRef, useCallback, useEffect } from 'react';
import { LanguageCode, ModelProvider } from '../types';
import { transcribeAudio } from '../services/groqService';
import { DEEPGRAM_API_KEY } from '../constants';

interface UseSpeechRecognitionReturn {
    isListening: boolean;
    transcript: string; // 用於存放 Thread A (過濾後的中文)
    liveTranslation: string; // 用於存放 Thread B (第二語)
    startListening: () => Promise<void>;
    stopListening: () => Promise<{ transcript: string; translation: string; audioBlob?: Blob; confidence?: number; words?: any[] }>;
    onTranscriptionResult?: (text: string, translation: string, audioBlob?: Blob, confidence?: number, words?: any[]) => void
    abortListening: () => void;
    resetTranscript: () => void;
    clearLiveText: () => void;
    error: string | null;
    sourceConfidence?: number;
    sourceWords?: any[];
    targetConfidence?: number;
    targetWords?: any[];
    hasBrowserSupport: boolean;
    audioLevel: number;
    isTranscribing: boolean; // 維持相容性
    isConnecting: boolean;   // 新增：連線中狀態
}

export const useSpeechRecognition = (
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    modelProvider: ModelProvider = 'groq',
    onTranscriptionResult?: (text: string, translation: string, audioBlob?: Blob, confidence?: number, words?: any[]) => void
): UseSpeechRecognitionReturn => {
    const [isListening, setIsListening] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false); // 新增：正在建立連線狀態
    const [transcript, setTranscript] = useState('');     // 對應 Thread A (中文)
    const [liveTranslation, setLiveTranslation] = useState(''); // 對應 Thread B (第二語)
    const [error, setError] = useState<string | null>(null);
    const [hasBrowserSupport, setHasBrowserSupport] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);
    const [sourceConfidence, setSourceConfidence] = useState<number | undefined>();
    const [sourceWords, setSourceWords] = useState<any[] | undefined>();
    const [targetConfidence, setTargetConfidence] = useState<number | undefined>();
    const [targetWords, setTargetWords] = useState<any[] | undefined>();

    // Refs
    const sourceLangRef = useRef(sourceLang);
    const targetLangRef = useRef(targetLang);

    // Media & Audio Context
    const streamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Deepgram Sockets (Parallel Threads)
    const socketZhRef = useRef<WebSocket | null>(null);
    const socketTargetRef = useRef<WebSocket | null>(null);

    // 累積字串，避免 React state 更新不及時
    const fullZhRef = useRef('');
    const fullTargetRef = useRef('');
    const latestConfRef = useRef<number | undefined>();
    const accumulatedWordsRef = useRef<any[]>([]);

    // VAD Refs & Audio Archive (Dual-Track)
    const onTranscriptionResultRef = useRef(onTranscriptionResult);
    const lastVoiceTimeRef = useRef<number>(Date.now());
    const hasSpokenRef = useRef<boolean>(false);
    const audioChunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        onTranscriptionResultRef.current = onTranscriptionResult;
    }, [onTranscriptionResult]);

    // 同步外部傳入的語言設定到 Ref，以便串流過程能拿到最新的語言
    useEffect(() => {
        sourceLangRef.current = sourceLang;
        targetLangRef.current = targetLang;
    }, [sourceLang, targetLang]);

    useEffect(() => {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            setHasBrowserSupport(true);
        } else {
            setHasBrowserSupport(false);
            setError("您的瀏覽器不支援錄音功能");
        }
        return cleanupAll;
    }, []);

    const cleanupAudioContext = () => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.disconnect(); } catch (e) { }
            sourceNodeRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close().catch(() => { });
            audioContextRef.current = null;
        }
    };

    const cleanupAll = useCallback(() => {
        cleanupAudioContext();

        if (keepAliveIntervalRef.current) {
            clearInterval(keepAliveIntervalRef.current);
            keepAliveIntervalRef.current = null;
        }

        if (socketZhRef.current) {
            if (socketZhRef.current.readyState === WebSocket.OPEN) socketZhRef.current.close();
            socketZhRef.current = null;
        }
        if (socketTargetRef.current) {
            if (socketTargetRef.current.readyState === WebSocket.OPEN) socketTargetRef.current.close();
            socketTargetRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setIsListening(false);
        setAudioLevel(0);
    }, []);

    // 建立語音波形分析 (VAD 視覺效果)
    const setupAudioVisualizer = (stream: MediaStream) => {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        sourceNodeRef.current = source;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const VOICE_THRESHOLD = 20; // 聲音音量閾值
        const SILENCE_DURATION = 1500; // 靜音持續時間(毫秒) 觸發自動切斷

        /**
         * [內部函式] 結算目前段落並拋給前端
         */
        const triggerFinalization = () => {
            if (!hasSpokenRef.current && !fullZhRef.current.trim() && !fullTargetRef.current.trim()) return;

            hasSpokenRef.current = false;
            const finalZh = fullZhRef.current.trim();
            const finalTargetTemp = fullTargetRef.current.trim();

            if ((finalZh || finalTargetTemp) && onTranscriptionResultRef.current) {
                // 稍微等候 Thread B 收尾 (如果 Deepgram 還有殘留)
                setTimeout(() => {
                    const finalTarget = fullTargetRef.current.trim();
                    const currentZh = fullZhRef.current.trim();

                    // 將累積的音訊塊打包成 Blob 供 Cloudflare 儲存
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

                    onTranscriptionResultRef.current!(currentZh, finalTarget, audioBlob, latestConfRef.current, accumulatedWordsRef.current);

                    // 重置狀態，準備下一段落
                    fullZhRef.current = '';
                    fullTargetRef.current = '';
                    latestConfRef.current = undefined;
                    accumulatedWordsRef.current = [];
                    audioChunksRef.current = [];
                    setTranscript('');
                    setLiveTranslation('');
                    setSourceConfidence(undefined);
                    setSourceWords(undefined);
                    setTargetConfidence(undefined);
                    setTargetWords(undefined);
                }, 300);
            }
        };

        // 將函式掛在 Ref 供外部（如 Socket OnMessage）調用
        (window as any).__triggerFinalization = triggerFinalization;
        const updateLevel = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const average = sum / dataArray.length;
            setAudioLevel(average);

            const now = Date.now();
            if (average > VOICE_THRESHOLD) {
                lastVoiceTimeRef.current = now;
                hasSpokenRef.current = true;
            }

            // 前端 VAD 強制斷句邏輯 (持續監聽，若達停頓秒數則結算一筆紀錄)
            if (hasSpokenRef.current && (now - lastVoiceTimeRef.current > SILENCE_DURATION)) {
                triggerFinalization();
            }

            animationFrameRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();
    };

    const startListening = useCallback(async () => {
        setError(null);
        setTranscript('');
        setLiveTranslation('');
        fullZhRef.current = '';
        fullTargetRef.current = '';
        audioChunksRef.current = [];
        hasSpokenRef.current = false;
        lastVoiceTimeRef.current = Date.now();
        cleanupAll();
        try {
            // ── 選擇麥克風輸入裝置 ────────────────────────────────────────────────
            // 關鍵：若使用藍牙耳機麥克風(HFP)，系統會把藍牙切換成單聲道電話模式，
            //        導致立體聲輸出被強制降為單聲道。
            // 解決方案：優先使用手機內建麥克風，讓藍牙保持 A2DP 立體聲播放模式。
            let micConstraints: MediaStreamConstraints = {
                audio: {
                    // 關閉回音消除和降噪，減少音訊處理干預
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            };

            // 嘗試列舉裝置，找出非藍牙的內建麥克風
            try {
                // 先取得一次臨時串流以解鎖裝置列舉
                await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(d => d.kind === 'audioinput');
                console.log('[Mic] 可用麥克風:', audioInputs.map(d => d.label));
                // 優先選擇「不含 bluetooth/HFP/hands-free」關鍵字的輸入裝置
                const builtIn = audioInputs.find(d =>
                    !/(bluetooth|hfp|hands.free|headset)/i.test(d.label) &&
                    /(default|built.in|internal|microphone|mic)/i.test(d.label)
                ) || audioInputs.find(d =>
                    !/(bluetooth|hfp|hands.free|headset)/i.test(d.label)
                );
                if (builtIn) {
                    console.log('[Mic] 選用內建麥克風:', builtIn.label);
                    micConstraints = {
                        audio: {
                            deviceId: { exact: builtIn.deviceId },
                            echoCancellation: false,
                            noiseSuppression: false,
                            autoGainControl: false
                        }
                    };
                } else {
                    console.warn('[Mic] 找不到非藍牙麥克風，使用預設裝置');
                }
            } catch (e) {
                console.warn('[Mic] 裝置列舉失敗，回退至預設麥克風:', e);
            }

            const stream = await navigator.mediaDevices.getUserMedia(micConstraints);

            streamRef.current = stream;

            setupAudioVisualizer(stream);

            // Thread A (中文擷取) - 移除 endpointing 交給前端控制
            const wsUrlZh = `wss://api.deepgram.com/v1/listen?model=nova-2&language=zh-TW&smart_format=true&punctuate=true&keepalive=true&words=true`;
            socketZhRef.current = new WebSocket(wsUrlZh, ['token', DEEPGRAM_API_KEY]);

            // Thread B (第二語擷取) 參數準備
            let deepgramLang = targetLangRef.current.split('-')[0];
            if (targetLangRef.current === 'en-PH') deepgramLang = 'en-PH';
            if (targetLangRef.current === 'th-TH') deepgramLang = 'th';
            if (targetLangRef.current === 'zh-TW') deepgramLang = 'zh-TW';
            if (targetLangRef.current === 'id-ID') deepgramLang = 'id';

            const wsUrlTarget = `wss://api.deepgram.com/v1/listen?model=nova-2&language=${deepgramLang}&smart_format=true&punctuate=true&keepalive=true`;
            socketTargetRef.current = new WebSocket(wsUrlTarget, ['token', DEEPGRAM_API_KEY]);

            // [關鍵優化] 等待兩個通道都連線成功
            // 避免使用者太快開始說話，導致前幾秒的語音遺失
            await Promise.all([
                new Promise((resolve, reject) => {
                    if (!socketZhRef.current) return resolve(null);
                    socketZhRef.current.onopen = resolve;
                    socketZhRef.current.onerror = (err) => {
                        console.error("Thread A Connection Failed", err);
                        reject(new Error("無法連線至中文辨識服務"));
                    };
                }),
                new Promise((resolve, reject) => {
                    if (!socketTargetRef.current) return resolve(null);
                    socketTargetRef.current.onopen = resolve;
                    socketTargetRef.current.onerror = (err) => {
                        console.error("Thread B Connection Failed", err);
                        reject(new Error("無法連線至目標語辨識服務"));
                    };
                })
            ]);

            console.log("🟢 All Deepgram Threads Connected!");

            socketZhRef.current.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'Results' && data.channel?.alternatives[0]) {
                        const alt = data.channel.alternatives[0];
                        if (data.is_final) {
                            if (alt.confidence >= 0.1 && alt.transcript.trim() !== '') {
                                const newText = alt.transcript.trim();
                                // 每個 Deepgram final result 以「，」分隔，呈現段落斷句感
                                fullZhRef.current = fullZhRef.current
                                    ? fullZhRef.current + '，' + newText
                                    : newText;
                                setTranscript(fullZhRef.current);
                                setSourceConfidence(alt.confidence);

                                // [Bug Fix] 累積單字數據，而非覆蓋，避免長句子顯示殘缺
                                if (alt.words) {
                                    accumulatedWordsRef.current = [...accumulatedWordsRef.current, ...alt.words];
                                }
                                setSourceWords([...accumulatedWordsRef.current]);

                                // [優化] 追蹤整段段落中的「最低」信心度
                                // 避免後面的高信心度句子（如「猴子去爬山」）掩蓋掉前面低信心度的內容
                                const currentMinConf = latestConfRef.current === undefined ? alt.confidence : Math.min(latestConfRef.current, alt.confidence);
                                setSourceConfidence(currentMinConf);
                                latestConfRef.current = currentMinConf;

                                // [關鍵優化] 如果辨識結果包含逗號「，」，立即觸發段落結算
                                if (newText.includes('，') || newText.includes('、') || newText.endsWith('，') || newText.endsWith(',')) {
                                    console.log("📍 Comma detected, triggering immediate finalization...");
                                    const trigger = (window as any).__triggerFinalization;
                                    if (trigger) trigger();
                                }
                            }
                        } else {
                            if (alt.confidence >= 0.05 && alt.transcript.trim() !== '') {
                                setTranscript(fullZhRef.current + alt.transcript);
                                setSourceConfidence(alt.confidence);
                                // Interim result doesn't modify accumulatedWordsRef, 
                                // but we show it combines for visual feedback
                                const combinedWords = [...accumulatedWordsRef.current, ...(alt.words || [])];
                                setSourceWords(combinedWords);
                                latestConfRef.current = alt.confidence;
                            }
                        }
                    }
                } catch (e) {
                    console.error("Thread A 解析失敗", e);
                }
            };

            // Thread A Error Handling
            socketZhRef.current.onerror = (error) => {
                console.error("Thread A WebSocket Error:", error);
                setError("中文辨識通訊錯誤");
            };
            socketZhRef.current.onclose = (event) => {
                console.log("Thread A WebSocket Closed:", event.code, event.reason);
                if (event.code !== 1000 && isListening) {
                    setError(`辨識服務已斷開 (${event.code})`);
                }
            };

            // Thread B (第二語擷取)
            const langMap: Record<string, string> = {
                [LanguageCode.Chinese]: "zh-TW",
                [LanguageCode.English]: "en-US", // 本專案介面選項可能是 en-PH，這裡如果對應不到需防錯
                [LanguageCode.Vietnamese]: "vi",
                [LanguageCode.Thai]: "th",
                [LanguageCode.Indonesian]: "id"
            };

            socketTargetRef.current.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'Results' && data.channel?.alternatives[0]) {
                        const alt = data.channel.alternatives[0];
                        // Debug: 印出每一筆回傳的信心度與文字
                        console.log(`📡 Thread B [${data.is_final ? 'FINAL' : 'interim'}] conf=${alt.confidence.toFixed(3)} text="${alt.transcript}"`);
                        if (data.is_final) {
                            if (alt.confidence >= 0.5 && alt.transcript.trim() !== '') {
                                setTargetConfidence(alt.confidence);
                                setTargetWords(alt.words);
                                // Thread B 同樣以「，」分隔各段
                                fullTargetRef.current = fullTargetRef.current
                                    ? fullTargetRef.current + '，' + alt.transcript.trim()
                                    : alt.transcript.trim();
                                setLiveTranslation(fullTargetRef.current);
                            }
                        } else {
                            if (alt.confidence >= 0.3 && alt.transcript.trim() !== '') {
                                setTargetConfidence(alt.confidence);
                                setLiveTranslation(fullTargetRef.current + alt.transcript);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Thread B 解析失敗", e);
                }
            };

            // Thread B Error Handling
            socketTargetRef.current.onerror = (error) => {
                console.error("Thread B WebSocket Error:", error);
            };
            socketTargetRef.current.onclose = (event) => {
                console.log("Thread B WebSocket Closed:", event.code, event.reason);
            };

            // Media Recorder setup
            const options = MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : {};
            const mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    // 保存給 Cloudflare 後端存擋
                    audioChunksRef.current.push(event.data);

                    if (socketZhRef.current?.readyState === WebSocket.OPEN) {
                        socketZhRef.current.send(event.data);
                    }
                    if (socketTargetRef.current?.readyState === WebSocket.OPEN) {
                        socketTargetRef.current.send(event.data);
                    }
                }
            };

            mediaRecorder.start(250);
            setIsListening(true);
            setIsConnecting(false); // 連線結束

            // 定期發送 KeepAlive 避免 Deepgram 因為短暫靜音而 1011 斷線
            keepAliveIntervalRef.current = setInterval(() => {
                const keepAliveMsg = JSON.stringify({ type: "KeepAlive" });
                if (socketZhRef.current?.readyState === WebSocket.OPEN) {
                    socketZhRef.current.send(keepAliveMsg);
                }
                if (socketTargetRef.current?.readyState === WebSocket.OPEN) {
                    socketTargetRef.current.send(keepAliveMsg);
                }
            }, 10000); // 10秒送一次

        } catch (err: any) {
            console.error("Error starting recording:", err);
            setError(err.message || "無法啟動錄音，請檢查麥克風權限");
            setIsListening(false);
            setIsConnecting(false);
            cleanupAll();
        }
    }, [cleanupAll, onTranscriptionResult]);

    const stopListening = useCallback(async (): Promise<{ transcript: string; translation: string; audioBlob?: Blob; confidence?: number; words?: any[] }> => {
        cleanupAll();
        // 將累積的中文與第二語作為物件回傳
        const audioBlob = audioChunksRef.current.length > 0 ? new Blob(audioChunksRef.current, { type: 'audio/webm' }) : undefined;
        return {
            transcript: fullZhRef.current.trim(),
            translation: fullTargetRef.current.trim(),
            audioBlob,
            confidence: latestConfRef.current,
            words: accumulatedWordsRef.current
        };
    }, [cleanupAll]);

    const abortListening = useCallback(() => {
        cleanupAll();
        setTranscript('');
        setLiveTranslation('');
    }, [cleanupAll]);

    const resetTranscript = useCallback(() => {
        setTranscript('');
        setLiveTranslation('');
        setSourceConfidence(undefined);
        setSourceWords(undefined);
        setTargetConfidence(undefined);
        setTargetWords(undefined);
    }, []);

    const clearLiveText = useCallback(() => {
        resetTranscript();
        fullZhRef.current = '';
        fullTargetRef.current = '';
        latestConfRef.current = undefined;
        accumulatedWordsRef.current = [];
        audioChunksRef.current = [];
    }, [resetTranscript]);

    return {
        isListening,
        transcript,
        liveTranslation, // 新增：導出第二語即時辨識結果
        startListening,
        stopListening,
        abortListening,
        resetTranscript,
        clearLiveText,
        error,
        sourceConfidence,
        sourceWords,
        targetConfidence,
        targetWords,
        hasBrowserSupport,
        audioLevel,
        isTranscribing: false,
        isConnecting
    };
};
