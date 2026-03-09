import { useState, useEffect, useRef, useCallback } from 'react';

// 輔助函式：將 App 的語系代碼對映到後端 WebSocket 服務所需的格式
const mapTargetLang = (code: string) => {
    if (code === 'zh-TW') return 'zh-TW';
    // 預設擷取第一個部分 (例如 'id-ID' -> 'id')
    return code.split('-')[0];
};

interface UseTranslationSocketReturn {
    translatedText: string;
    isConnecting: boolean; // 新增：追蹤翻譯伺服器連線狀態
    sendText: (text: string) => void;
    clearTranslation: () => void;
}

export const useTranslationSocket = (
    sourceLang: string,
    targetLang: string
): UseTranslationSocketReturn => {
    const [translatedText, setTranslatedText] = useState('');
    const [isConnecting, setIsConnecting] = useState(false);
    const socketRef = useRef<WebSocket | null>(null);
    const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastTextRef = useRef(''); // 追蹤最新的待翻譯文字

    // 非同步連線與設定函式
    const connect = useCallback(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) return;

        console.log(`[WS Translate] Connecting for ${sourceLang} -> ${targetLang}...`);
        setIsConnecting(true);
        const ws = new WebSocket('wss://chencef-translate.hf.space/ws/translate');
        socketRef.current = ws;

        ws.onopen = () => {
            const mappedSource = mapTargetLang(sourceLang);
            const mappedTarget = mapTargetLang(targetLang);

            console.log(`[WS Translate] Connected! Setting config ${mappedSource} -> ${mappedTarget}`);
            ws.send(JSON.stringify({
                type: 'config',
                source: mappedSource,
                target: mappedTarget
            }));
            setIsConnecting(false); // 連線成功

            // 連線成功後，如果已經有待翻譯的文字，立刻補送
            if (lastTextRef.current) {
                console.log(`[WS Translate] Sending buffered text: ${lastTextRef.current.slice(0, 20)}...`);
                ws.send(JSON.stringify({
                    type: 'input',
                    text: lastTextRef.current
                }));
            }
        };

        // 處理接收到的非同步串流資料
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'result') {
                    // 若收到最新翻譯結果，即時更新元件狀態，讓畫面能同步顯示翻譯後的文字
                    setTranslatedText(data.text);
                }
            } catch (error) {
                console.error('[WS Translate] 訊息解析錯誤:', error);
            }
        };

        ws.onclose = () => {
            console.log(`[WS Translate] Disconnected (${sourceLang} -> ${targetLang})`);
            // 自動重連機制
            retryTimeoutRef.current = setTimeout(connect, 3000);
        };

        ws.onerror = (error) => {
            console.error('[WS Translate] WebSocket Error:', error);
            setIsConnecting(false);
        };
    }, [sourceLang, targetLang]);

    useEffect(() => {
        connect();
        return () => {
            if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
            if (socketRef.current) {
                socketRef.current.close();
                socketRef.current = null;
            }
        };
    }, [connect]);

    // 傳送輸入文字進行串流翻譯
    const sendText = useCallback((text: string) => {
        // 更新快取，確保重新連線後能補發最新的語句
        lastTextRef.current = text;

        if (!text || text.trim() === '') {
            // 當文字為空時，不立即清空 translatedText，保留最後一次翻譯結果直到下一次輸入或手動清除
            if (socketRef.current?.readyState === WebSocket.OPEN) {
                socketRef.current.send(JSON.stringify({
                    type: 'config',
                    source: mapTargetLang(sourceLang),
                    target: mapTargetLang(targetLang)
                }));
            }
            return;
        }

        // 確保 WebSocket 處於連線狀態後，透過非同步事件發送資料
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'input',
                text: text
            }));
        }
    }, [sourceLang, targetLang]);

    const clearTranslation = useCallback(() => {
        lastTextRef.current = '';
        setTranslatedText('');
    }, []);

    return {
        translatedText,
        isConnecting,
        sendText,
        clearTranslation
    };
};
