import { useState, useRef, useCallback, useEffect } from 'react';
import { DEEPGRAM_API_KEY } from '../constants';
import { LanguageCode } from '../types';

interface UseDeepgramSocketReturn {
    connect: (lang: LanguageCode) => Promise<void>;
    disconnect: () => void;
    sendAudio: (blob: Blob) => void;
    socketStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    realtimeTranscript: string;
    isModelDeepgram: boolean;
}

export const useDeepgramSocket = (): UseDeepgramSocketReturn => {
    const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
    const [realtimeTranscript, setRealtimeTranscript] = useState('');
    const socketRef = useRef<WebSocket | null>(null);
    const keepAliveInterval = useRef<NodeJS.Timeout | null>(null);

    // Map App Language Codes to Deepgram Language Codes
    const getDeepgramLang = (sourceLang: LanguageCode) => {
        const langMap: Record<string, string> = {
            [LanguageCode.Chinese]: "zh-TW",
            [LanguageCode.English]: "en-US",
            [LanguageCode.Vietnamese]: "vi",
            [LanguageCode.Thai]: "th",
            [LanguageCode.Indonesian]: "id"
        };
        return langMap[sourceLang] || "en-US";
    };

    const connect = useCallback(async (lang: LanguageCode) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            return;
        }

        setSocketStatus('connecting');
        const deepgramLang = getDeepgramLang(lang);

        // Model: Nova-3, Punctuation: true, Smart Format: false (for speed), Interim Results: true (for real-time feeling)
        const params = new URLSearchParams({
            model: "nova-3",
            punctuate: "true",
            language: deepgramLang,
            interim_results: "true",
            encoding: "linear16", // Sending raw WAV/Linear16 is safer but webm/opus works too. Let's try to infer or send opus.
            // Actually Opus is supported by default if container is sent. 
            // If we send raw blobs from MediaRecorder (webm/opus), we don't need encoding param usually.
        });

        const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

        try {
            const socket = new WebSocket(url, ['token', DEEPGRAM_API_KEY]);
            socketRef.current = socket;

            socket.onopen = () => {
                console.log("Deepgram WebSocket Connected");
                setSocketStatus('connected');
                setRealtimeTranscript('');

                // Keep Alive
                keepAliveInterval.current = setInterval(() => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: 'KeepAlive' }));
                    }
                }, 3000);
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'Metadata') {
                        // Initial metadata
                    }

                    if (data.channel && data.channel.alternatives && data.channel.alternatives[0]) {
                        const transcript = data.channel.alternatives[0].transcript;

                        // If it's final, we append? Or just show latest?
                        // Deepgram sends "is_final": true.
                        // For continuous streaming, we might want to just show the current "utterance".
                        // The outer hook handles the "final" text accumulation. 
                        // Here we just expose the current "live" text.

                        if (transcript) {
                            setRealtimeTranscript(transcript);
                        }
                    }
                } catch (e) {
                    console.error("Error parsing Deepgram message", e);
                }
            };

            socket.onclose = () => {
                console.log("Deepgram WebSocket Closed");
                setSocketStatus('disconnected');
                if (keepAliveInterval.current) clearInterval(keepAliveInterval.current);
            };

            socket.onerror = (error) => {
                console.error("Deepgram WebSocket Error", error);
                setSocketStatus('error');
            };

        } catch (e) {
            console.error("Failed to connect to Deepgram", e);
            setSocketStatus('error');
        }
    }, []);

    const disconnect = useCallback(() => {
        if (socketRef.current) {
            // Send CloseStream before closing
            if (socketRef.current.readyState === WebSocket.OPEN) {
                socketRef.current.send(JSON.stringify({ type: 'CloseStream' }));
                socketRef.current.close();
            }
            socketRef.current = null;
        }
        if (keepAliveInterval.current) {
            clearInterval(keepAliveInterval.current);
            keepAliveInterval.current = null;
        }
        setSocketStatus('disconnected');
        setRealtimeTranscript('');
    }, []);

    const sendAudio = useCallback((blob: Blob) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(blob);
        }
    }, []);

    useEffect(() => {
        return () => {
            disconnect();
        };
    }, [disconnect]);

    return {
        connect,
        disconnect,
        sendAudio,
        socketStatus,
        realtimeTranscript,
        isModelDeepgram: true
    };
};
