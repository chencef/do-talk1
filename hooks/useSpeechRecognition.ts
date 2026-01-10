
import { useState, useRef, useCallback, useEffect } from 'react';
import { LanguageCode } from '../types';
import { transcribeAudio } from '../services/groqService';

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  startListening: () => Promise<void>;
  stopListening: () => Promise<string>;
  abortListening: () => void;
  resetTranscript: () => void;
  error: string | null;
  hasBrowserSupport: boolean;
  isTranscribing: boolean;
  audioLevel: number;
}

export const useSpeechRecognition = (
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  isContinuous: boolean = false,
  onContinuousResult?: (text: string) => void
): UseSpeechRecognitionReturn => {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasBrowserSupport, setHasBrowserSupport] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // Refs
  const isListeningRef = useRef(false);
  const isContinuousRef = useRef(isContinuous);
  const sourceLangRef = useRef(sourceLang);
  const targetLangRef = useRef(targetLang);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  
  // VAD Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Timestamps
  const lastVoiceTimestamp = useRef<number>(0);
  const segmentStartTime = useRef<number>(0);
  const hasSpokenInCurrentSegment = useRef<boolean>(false);

  useEffect(() => {
    isContinuousRef.current = isContinuous;
  }, [isContinuous]);

  useEffect(() => {
    sourceLangRef.current = sourceLang;
    targetLangRef.current = targetLang;
  }, [sourceLang, targetLang]);

  useEffect(() => {
    isListeningRef.current = isListening;
    if (!isListening) setAudioLevel(0);
  }, [isListening]);

  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      setHasBrowserSupport(true);
    } else {
      setHasBrowserSupport(false);
      setError("您的瀏覽器不支援錄音功能");
    }

    return () => {
      cleanupAudioContext();
    };
  }, []);

  const cleanupAudioContext = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Only close context on full stop
    if (!isListeningRef.current) {
        if (sourceRef.current) {
            try { sourceRef.current.disconnect(); } catch (e) {}
            sourceRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
    }
  };

  const processContinuousSegment = async (blob: Blob) => {
    if (blob.size < 1000) return; 
    
    try {
      const text = await transcribeAudio(blob, sourceLangRef.current, targetLangRef.current);
      if (text && onContinuousResult) {
        onContinuousResult(text);
      }
    } catch (err: any) {
      console.error("Continuous segment transcription failed:", err);
      if (err.message === "GROQ_RATE_LIMIT") {
          setError("API 使用量已達上限 (429)，請稍後再試");
      }
    }
  };

  // Define VAD Setup as a Callback so it can be reused in onstop
  const setupVAD = useCallback(async (stream: MediaStream, mediaRecorder: MediaRecorder) => {
    if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
    }

    const ctx = audioContextRef.current;
    
    if (!sourceRef.current) {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256; 
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        
        analyserRef.current = analyser;
        sourceRef.current = source;
    }

    const analyser = analyserRef.current!;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    // Parameters
    const VOICE_THRESHOLD = 25;    
    const SILENCE_DURATION = 1000; // 1.0s silence to cut
    const HARD_LIMIT = 5000;       // 5.0s max duration

    // Ensure no previous loop is running
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
    }

    const checkVolume = () => {
        if (!isListeningRef.current) return; 

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        setAudioLevel(average);

        const now = Date.now();

        // 1. Voice Detection
        if (average > VOICE_THRESHOLD) {
            lastVoiceTimestamp.current = now;
            hasSpokenInCurrentSegment.current = true;
        }

        const silenceDuration = now - lastVoiceTimestamp.current;
        const segmentDuration = now - segmentStartTime.current;
        
        let shouldCut = false;

        if (hasSpokenInCurrentSegment.current) {
            if (silenceDuration > SILENCE_DURATION) {
                shouldCut = true;
            } else if (segmentDuration > HARD_LIMIT) {
                shouldCut = true;
            }
        } else {
             // Flush empty noise if too long
             if (segmentDuration > 8000) {
                 audioChunksRef.current = []; 
                 segmentStartTime.current = now; 
             }
        }

        // CRITICAL FIX: Only auto-cut in Continuous Mode.
        // In Manual Mode, we wait for the user to click Stop.
        if (shouldCut && isContinuousRef.current) {
             if (mediaRecorder.state === 'recording') {
                 // Stop creates the file -> triggers onstop -> restart
                 mediaRecorder.stop(); 
                 // Loop ends here. It will be restarted in onstop.
             }
        } else {
            animationFrameRef.current = requestAnimationFrame(checkVolume);
        }
    };

    animationFrameRef.current = requestAnimationFrame(checkVolume);
  }, []); // Stable callback

  const startListening = useCallback(async () => {
    setError(null);
    setTranscript('');
    audioChunksRef.current = [];
    hasSpokenInCurrentSegment.current = false;
    lastVoiceTimestamp.current = Date.now();
    segmentStartTime.current = Date.now();

    try {
      let stream = streamRef.current;
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      }

      const supportedTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/wav'
      ];
      let selectedMimeType = '';
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedMimeType = type;
          break;
        }
      }

      const options: MediaRecorderOptions = selectedMimeType ? { mimeType: selectedMimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Default onstop for Continuous Mode
      mediaRecorder.onstop = () => {
        // Continuous Logic
        if (isContinuousRef.current && isListeningRef.current) {
           const finalType = mediaRecorder.mimeType || selectedMimeType;
           const blob = new Blob(audioChunksRef.current, { type: finalType });
           
           // MEMORY CLEANUP: Clear buffer immediately after creating Blob
           audioChunksRef.current = []; 

           processContinuousSegment(blob);

           if (mediaRecorder.state === 'inactive') {
              try {
                mediaRecorder.start();
                
                // Reset State
                hasSpokenInCurrentSegment.current = false; 
                lastVoiceTimestamp.current = Date.now();
                segmentStartTime.current = Date.now();

                // Restart VAD Loop
                setupVAD(stream!, mediaRecorder);

              } catch (e) {
                console.error("Failed to restart recorder:", e);
                setIsListening(false);
              }
           }
        }
      };

      mediaRecorder.start(); 
      setIsListening(true);
      isListeningRef.current = true;

      setupVAD(stream, mediaRecorder);

    } catch (err: any) {
      console.error("Error starting recording:", err);
      setError("無法啟動錄音，請檢查麥克風權限");
      setIsListening(false);
    }
  }, [setupVAD]); 

  const stopListening = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const mediaRecorder = mediaRecorderRef.current;
      
      setIsListening(false);
      isListeningRef.current = false; 
      setAudioLevel(0);

      // Handle case where recorder is missing or already stopped
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        cleanupAudioContext();
        // If we have data chunks even if inactive (rare case in manual), try to process
        if (audioChunksRef.current.length > 0) {
             // Fall through to manual processing below...
             // But usually onstop would have fired. 
             // To be safe, we just resolve empty if it's already dead.
        }
        resolve("");
        return;
      }

      // Override onstop for Manual Mode to capture the result
      mediaRecorder.onstop = async () => {
        cleanupAudioContext();
        setIsTranscribing(true);
        
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        const finalType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: finalType });
        
        // MEMORY CLEANUP: Explicitly clear the buffer after use in manual mode as well
        audioChunksRef.current = [];
        
        if (audioBlob.size > 1000) {
            try {
              const text = await transcribeAudio(audioBlob, sourceLangRef.current, targetLangRef.current);
              setTranscript(text);
              resolve(text);
            } catch (err: any) {
              if (err.message !== "GROQ_RATE_LIMIT") {
                  setError("轉錄失敗，請重試");
              }
              reject(err);
            } finally {
              setIsTranscribing(false);
            }
        } else {
            setIsTranscribing(false);
            resolve("");
        }
      };

      mediaRecorder.stop();
    });
  }, []);

  const abortListening = useCallback(() => {
    setIsListening(false);
    isListeningRef.current = false;
    setAudioLevel(0);
    cleanupAudioContext();
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setTranscript('');
    audioChunksRef.current = []; // Clear buffer
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    abortListening,
    resetTranscript,
    error,
    hasBrowserSupport,
    isTranscribing,
    audioLevel
  };
};
