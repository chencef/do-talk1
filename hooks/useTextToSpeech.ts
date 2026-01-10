
import { useState, useCallback, useEffect, useRef } from 'react';
import { LanguageCode } from '../types';

interface QueueItem {
  text: string;
  language: LanguageCode;
  pan: number; // Note: Panning is not supported by standard SpeechSynthesis API yet, but kept for interface compatibility
  volume: number;
}

export const useTextToSpeech = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  
  // Queue to hold pending utterances
  const queueRef = useRef<QueueItem[]>([]);
  const isProcessingQueueRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setSupported(true);
      
      // Initial voice load check
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        setVoicesLoaded(true);
      }

      // Handler for async voice loading (required for Chrome/Android)
      const handleVoicesChanged = () => {
        setVoicesLoaded(true);
      };

      window.speechSynthesis.onvoiceschanged = handleVoicesChanged;
      
      // Cleanup: Cancel any ongoing speech when unmounting
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
        window.speechSynthesis.cancel();
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
  }, []);

  const getBestVoice = (lang: string): SpeechSynthesisVoice | undefined => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return undefined;

    // 1. Exact Match (e.g., zh-TW)
    let voice = voices.find(v => v.lang === lang);
    if (voice) return voice;

    // 2. Base Language Match (e.g., zh-TW -> matches zh-CN or zh-HK if zh-TW missing, or just 'zh')
    const baseLang = lang.split('-')[0];
    voice = voices.find(v => v.lang.startsWith(baseLang));
    if (voice) return voice;

    // 3. Fallback to default (usually English, but better than nothing?)
    // Prefer not to speak partial nonsense, but maybe user wants to hear something.
    // For now, return undefined to let browser pick default or fail silent.
    return undefined;
  };

  const processQueue = useCallback(() => {
    if (!supported) return;
    
    // FIX: Chrome TTS often gets paused or stuck. Force resume.
    if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
    }

    if (queueRef.current.length === 0 || isProcessingQueueRef.current || window.speechSynthesis.speaking) {
      // If stuck in speaking state but not actually speaking, watchdog will handle it.
      return;
    }

    isProcessingQueueRef.current = true;
    const item = queueRef.current.shift();

    if (!item) {
        isProcessingQueueRef.current = false;
        return;
    }

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = item.language;
    utterance.rate = 1.0; 
    utterance.volume = item.volume;
    
    // Select Voice
    const voice = getBestVoice(item.language);
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onstart = () => {
        setIsSpeaking(true);
        // Clear safety timeout from previous if any
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        
        // Watchdog: If onend doesn't fire within 30s (long text) or bugs out, kill it.
        timeoutRef.current = window.setTimeout(() => {
            console.warn("TTS timed out (watchdog), resetting...");
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            isProcessingQueueRef.current = false;
            // Try next
            processQueue();
        }, 30000);
    };

    utterance.onend = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setIsSpeaking(false);
        isProcessingQueueRef.current = false;
        // Small delay for natural pacing
        setTimeout(() => {
            processQueue();
        }, 200);
    };

    utterance.onerror = (e) => {
        console.error("TTS Error Event:", e);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setIsSpeaking(false);
        isProcessingQueueRef.current = false;
        // Proceed to next
        processQueue();
    };

    try {
        window.speechSynthesis.speak(utterance);
    } catch (err) {
        console.error("speechSynthesis.speak threw error:", err);
        isProcessingQueueRef.current = false;
    }

  }, [supported]);

  const speak = useCallback((text: string, language: LanguageCode, pan: number = 0, volume: number = 1.0) => {
    if (!supported || !text) return;
    
    // Push to queue
    queueRef.current.push({ text, language, pan, volume });
    
    // Try to process immediately
    processQueue();
  }, [supported, processQueue]);

  const stop = useCallback(() => {
    if (supported) {
      queueRef.current = [];
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      isProcessingQueueRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [supported]);

  // Periodic check to ensure queue moves if voices loaded late or browser state changed
  useEffect(() => {
    const interval = setInterval(() => {
        if (queueRef.current.length > 0 && !isProcessingQueueRef.current && !window.speechSynthesis.speaking) {
            processQueue();
        }
    }, 1000);
    return () => clearInterval(interval);
  }, [processQueue]);

  return { speak, stop, isSpeaking, supported };
};
