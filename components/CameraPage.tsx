/**
 * CameraPage.tsx
 * 攝影翻譯頁面元件
 *
 * 移植自 camera_test/index.html，整合進主系統。
 * 功能：啟動相機 → 持續掃描指定框內文字 (OCR) → 透過 WebSocket 翻譯為印尼文
 *
 * 後端依賴：camera_test/main.py（FastAPI + RapidOCR）需另行啟動
 * 翻譯服務：HuggingFace WebSocket (wss://chencef-translate.hf.space/ws/translate)
 *      來源語言：zh-TW（中文）
 *      目標語言：id（印尼文）
 *
 * 控制方式：
 *   - 透過 ref 暴露 { toggleCamera, isStarted }，由外部（App.tsx 導覽按鈕）呼叫
 *   - onStateChange callback 用於通知外部 isStarted 狀態變化（以更新按鈕視覺）
 */

import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { OCR_BACKEND_URL, SUPPORTED_LANGUAGES, CLOUDFLARE_BACKEND_URL } from '../constants';
import { LanguageCode } from '../types';

/** LanguageCode → WebSocket 翻譯目標碼的轉換（WS 使用縮短格式，如 id-ID → id）*/
const toWsCode = (code: LanguageCode): string => {
  switch (code) {
    case LanguageCode.English:    return 'en';
    case LanguageCode.Indonesian: return 'id';
    case LanguageCode.Vietnamese: return 'vi';
    case LanguageCode.Thai:       return 'th';
    case LanguageCode.Chinese:    return 'zh-TW';
    default: return (code as string).split('-')[0];
  }
};

/** 透過 ref 暴露給外部的操作介面 */
export interface CameraPageHandle {
  /** 切換相機開/關 */
  toggleCamera: () => void;
  /** 當前是否已啟動相機 */
  isStarted: boolean;
}

/** 元件 Props */
interface CameraPageProps {
  /** 是否為當前活動頁面；切換離開時自動停止相機，節省資源 */
  isActive: boolean;
  /** 翻譯目標語言（從設定頁同步）；預設印尼文 */
  targetLang?: LanguageCode;
  /** 相機狀態變化回調，供外部（導覽按鈕）更新視覺狀態 */
  onStateChange?: (isStarted: boolean) => void;
}

export const CameraPage = forwardRef<CameraPageHandle, CameraPageProps>(
  ({ isActive, targetLang = LanguageCode.Indonesian, onStateChange }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const scanBoxRef = useRef<HTMLDivElement>(null);

    const [isStarted, setIsStarted] = useState(false);
    const [debugMsg, setDebugMsg] = useState('初始化中...');
    // 新增狀態供 HTML 顯示辨識及翻譯文字
  const [detectedTextObj, setDetectedTextObj] = useState<{
    blocks: { text: string; isLowConf: boolean }[];
    text: string;
    hasChinese: boolean;
    isLowConf: boolean;
  } | null>(null);
  const [translatedText, setTranslatedText] = useState<string>('');

  const [scanCount, setScanCount] = useState(0);
    const [serverStatus, setServerStatus] = useState('checking...');

    // 用 Ref 追蹤「相機是否啟動」，讓非同步掃描迴圈能即時讀取，不受 React 閉包影響
    const isStartedRef = useRef(false);
    const isScanningRef = useRef(false);
    const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** 翻譯快取：已翻譯過的原文 → 譯文，避免重複請求 */
    const translationCacheRef = useRef<Record<string, string>>({});

    /** 持久化翻譯 WebSocket 連線參考 */
    const transSocketRef = useRef<WebSocket | null>(null);
    /** 最後送出的原文文字，用於匹配非同步回傳的譯文 */
    const lastSentTextRef = useRef('');
    /** 最後一次 OCR 掃描結果，供收到譯文後立刻重繪使用 */
    const lastResultsRef = useRef<any[]>([]);

    // 同步目標語言至 Ref，防止 WebSocket 重連閉包抓到舊值
    const targetLangRef = useRef(targetLang);
    useEffect(() => {
      targetLangRef.current = targetLang;
    }, [targetLang]);

    /** 用於「不要輕易消失」的容錯機制 */
    const lastTargetRef = useRef<{
      blocks: { text: string; isLowConf: boolean }[];
      text: string;
      hasChinese: boolean;
      isLowConfidence: boolean;
    } | null>(null);
    const missCountRef = useRef(0);

    // ─────────────────────────────────────────────
    // 暴露給外部（App.tsx 導覽按鈕）的操作介面
    // 透過 ref 提供 toggleCamera 與 isStarted，
    // 讓底部導覽輪「攝影」按鈕可直接控制相機開關
    // ─────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      toggleCamera: () => {
        if (isStartedRef.current) {
          stopCamera();
        } else {
          startCamera();
        }
      },
      get isStarted() {
        return isStartedRef.current;
      }
    }));

    // ─────────────────────────────────────────────
    // [非同步串流] OCR 伺服器健康狀態定時檢查
    // 每 5 秒向 /health 發送一次 GET 請求，更新 serverStatus
    // ─────────────────────────────────────────────
    useEffect(() => {
      const checkHealth = async () => {
      try {
        // 呼叫 HuggingFace Space 的健康檢查端點
        const res = await fetch(`${OCR_BACKEND_URL}/health`);
        if (res.ok) {
          setServerStatus('Online');
        } else {
          setServerStatus('Error: ' + res.status);
        }
      } catch (e: any) {
        setServerStatus('Offline');
      }
    };
      checkHealth();
      const timer = setInterval(checkHealth, 5000);
      return () => clearInterval(timer);
    }, []);

    // ─────────────────────────────────────────────
    // [非同步串流] 建立持久化翻譯 WebSocket 連線
    // 連線設定：來源 zh-TW（中文）→ 目標 id（印尼文）
    // 斷線時自動 3 秒後重連，確保翻譯服務不中斷
    // ─────────────────────────────────────────────
    useEffect(() => {
      const connectTrans = () => {
        const ws = new WebSocket('wss://chencef-translate.hf.space/ws/translate');
        transSocketRef.current = ws;

        ws.onopen = () => {
          console.log('[Camera Trans WS] Connected');
          // 初始化翻譯方向：使用 Ref 確保取得最新語言
          const lang = targetLangRef.current;
          console.log(`[Camera Trans WS] Configuring for: zh-TW → ${toWsCode(lang)} (${lang})`);
          ws.send(JSON.stringify({
            type: 'config',
            source: 'zh-TW',
            target: toWsCode(lang)
          }));
        };

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'result') {
              // 以原文作為快取鍵，儲存對應譯文
              const input = data.input || lastSentTextRef.current;
              let text = data.text;

              // [除錯] 過濾轉譯服務偶發的系統字元或幻覺字串 (例如 "tingshan case")
              if (text && (text.toLowerCase().includes('tingshan') || text.includes('听闪') || text.includes('Case'))) {
                console.warn('[Camera Trans WS] Detected potential hallucination/error, ignoring:', text);
                return;
              }

              if (input) {
                translationCacheRef.current[input] = text;
                setDebugMsg(`Trans: ${text ? text.slice(0, 15) : 'empty'}...`);
                // 更新 React 狀態，若為目前的句子則同步寫入譯文
                setDetectedTextObj(prev => {
                  if (prev && prev.text === input) {
                    setTranslatedText(text);
                  }
                  return prev;
                });
                // 收到譯文後立刻重繪，不等下一次掃描迴圈
                if (lastResultsRef.current.length > 0) {
                  processAndDraw(lastResultsRef.current);
                }
              }
            }
          } catch (err) {
            console.error('[Camera Trans WS] Parse Error:', err);
          }
        };

        // 斷線時自動重連
        ws.onclose = () => {
          console.log('[Camera Trans WS] Disconnected, retrying in 3s...');
          setTimeout(connectTrans, 3000);
        };
      };

      connectTrans();
      return () => {
        if (transSocketRef.current) transSocketRef.current.close();
      };
    }, []);

    // ─────────────────────────────────────────────
    // [非同步串流] 監聽 targetLang 變化，動態更新翻譯 WebSocket 設定
    // 使用者在設定頁更改目標語言時，立即重送 config 並清除舊翻譯快取，
    // 確保後續辨識結果以新語言翻譯顯示
    // ─────────────────────────────────────────────
    useEffect(() => {
      const ws = transSocketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        // 重置翻譯快取（舊語言的譯文不適用新語言）
        translationCacheRef.current = {};
        lastResultsRef.current = [];
        // 重送目標語言設定
        const wsCode = toWsCode(targetLang);
        ws.send(JSON.stringify({
          type: 'config',
          source: 'zh-TW',
          target: wsCode
        }));
        console.log(`[Camera Trans WS] Applied dynamic config: zh-TW → ${wsCode}`);
      }
    }, [targetLang]);

    // ─────────────────────────────────────────────
    // [非同步串流] 切換頁面時自動停止相機
    // 當 isActive 變為 false 時，停止所有相機資源與掃描迴圈
    // ─────────────────────────────────────────────
    useEffect(() => {
      if (!isActive && isStartedRef.current) {
        console.log('[CameraPage] 頁面切換，自動停止相機');
        stopCamera();
      }
    }, [isActive]);

    // ─────────────────────────────────────────────
    // 初始化 scan-box 位置與拖曳/縮放互動
    // 使用 Pointer Events API 支援滑鼠與觸控
    // ─────────────────────────────────────────────
    useEffect(() => {
      const box = scanBoxRef.current;
      if (!box) return;

      const parent = box.parentElement!;
      const pw = parent.clientWidth || window.innerWidth;
      const ph = parent.clientHeight || window.innerHeight;
      const initW = Math.min(pw * 0.8, 400);
      const initH = 200; // 總高度 200px (40+120+40)，中間辨識區為 120px
      const initX = (pw - initW) / 2;

      // 預設置中
      box.style.width = `${initW}px`;
      box.style.height = `${initH}px`;
      box.style.left = `${(pw - initW) / 2}px`;
      box.style.top = `${(ph - initH) / 2}px`;

      let isDragging = false;
      let isResizing = false;
      let resizeHandle: HTMLElement | null = null;
      let startX = 0, startY = 0;
      let startL = 0, startT = 0, startW = 0, startH = 0;

      const pointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('resize-handle')) {
          isResizing = true;
          resizeHandle = target;
        } else if (target === box || box.contains(target)) {
          isDragging = true;
        } else {
          return;
        }
        box.classList.add('dragging');
        try { box.setPointerCapture(e.pointerId); } catch (_) {}
        startX = e.clientX; startY = e.clientY;
        startL = parseFloat(box.style.left) || 0;
        startT = parseFloat(box.style.top) || 0;
        startW = parseFloat(box.style.width) || initW;
        startH = parseFloat(box.style.height) || initH;
        e.preventDefault();
        e.stopPropagation();
      };

      const pointerMove = (e: PointerEvent) => {
        if (!isDragging && !isResizing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const cw = parent.clientWidth || window.innerWidth;
        const ch = parent.clientHeight || window.innerHeight;

        if (isDragging) {
          let nL = Math.max(0, Math.min(startL + dx, cw - startW));
          let nT = Math.max(0, Math.min(startT + dy, ch - startH));
          box.style.left = `${nL}px`;
          box.style.top = `${nT}px`;
        } else if (isResizing && resizeHandle) {
          let nW = startW, nH = startH, nL = startL, nT = startT;
          if (resizeHandle.classList.contains('top-left')) {
            nW = startW - dx; nH = startH - dy; nL = startL + dx; nT = startT + dy;
          } else if (resizeHandle.classList.contains('top-right')) {
            nW = startW + dx; nH = startH - dy; nT = startT + dy;
          } else if (resizeHandle.classList.contains('bottom-left')) {
            nW = startW - dx; nH = startH + dy; nL = startL + dx;
          } else if (resizeHandle.classList.contains('bottom-right')) {
            nW = startW + dx; nH = startH + dy;
          }
          const minW = 100, minH = 60;
          if (nW < minW) {
            if (resizeHandle.classList.contains('top-left') || resizeHandle.classList.contains('bottom-left')) nL -= (minW - nW);
            nW = minW;
          }
          if (nH < minH) {
            if (resizeHandle.classList.contains('top-left') || resizeHandle.classList.contains('top-right')) nT -= (minH - nH);
            nH = minH;
          }
          if (nL < 0) { nW += nL; nL = 0; }
          if (nT < 0) { nH += nT; nT = 0; }
          if (nL + nW > cw) nW = cw - nL;
          if (nT + nH > ch) nH = ch - nT;
          box.style.width = `${nW}px`; box.style.height = `${nH}px`;
          box.style.left = `${nL}px`; box.style.top = `${nT}px`;
        }
      };

      const pointerUp = (e: PointerEvent) => {
        isDragging = false; isResizing = false;
        box.classList.remove('dragging');
        try { box.releasePointerCapture(e.pointerId); } catch (_) {}
        resizeHandle = null;
      };

      box.addEventListener('pointerdown', pointerDown);
      window.addEventListener('pointermove', pointerMove);
      window.addEventListener('pointerup', pointerUp);
      window.addEventListener('pointercancel', pointerUp);
      return () => {
        box.removeEventListener('pointerdown', pointerDown);
        window.removeEventListener('pointermove', pointerMove);
        window.removeEventListener('pointerup', pointerUp);
        window.removeEventListener('pointercancel', pointerUp);
      };
    }, [isActive]);

    /** 內部輔助：更新 isStarted 狀態並通知外部 */
    const setStartedState = (val: boolean) => {
      isStartedRef.current = val;
      setIsStarted(val);
      onStateChange?.(val);
    };

    /** 啟動相機並開始掃描 */
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setStartedState(true);
          startScanning();
        }
      } catch (err: any) {
        alert('無法啟動相機：' + err.message);
      }
    };

    /** 停止相機並清除畫布，同步重置所有狀態（頁面切換時歸零） */
    const stopCamera = () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
      setStartedState(false);
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      // 重置所有狀態，確保返回攝影頁後從頭開始
      setScanCount(0);
      setDebugMsg('Idle');
      lastResultsRef.current = [];
      lastTargetRef.current = null;
      missCountRef.current = 0;
      translationCacheRef.current = {};
      setDetectedTextObj(null);
      setTranslatedText('');
    };


    // ─────────────────────────────────────────────
    // [非同步串流] 掃描迴圈主體
    // 每 500ms 截取 scan-box 範圍內的畫面，POST 至後端 /ocr API，
    // 解析結果後呼叫 processAndDraw 繪製辨識框與翻譯文字。
    // 無論成功或失敗都確保排程下一次掃描（finally 區塊），防止迴圈死結。
    // ─────────────────────────────────────────────
    const startScanning = () => {
      if (isScanningRef.current) return;
      isScanningRef.current = true;
      setDebugMsg('Scanning...');

      const scanLoop = async () => {
        // 若相機已停止則結束迴圈
        if (!isStartedRef.current) {
          isScanningRef.current = false;
          return;
        }

        const video = videoRef.current;
        if (video && video.videoWidth > 0 && !video.paused) {
          const startTime = performance.now();
          const tempCanvas = document.createElement('canvas');

          const scanBoxEl = scanBoxRef.current;
          const mainArea = scanBoxEl?.querySelector('.scan-main-area');
          if (!mainArea || video.videoWidth === 0) {
            if (isStartedRef.current) scanTimeoutRef.current = setTimeout(scanLoop, 500);
            else isScanningRef.current = false;
            return;
          }

          // 計算 scan-box 對應到視訊原始像素的座標（考量 object-fit: cover 裁切）
          const videoRect = video.getBoundingClientRect();
          const mainRect = (mainArea as HTMLElement).getBoundingClientRect();
          const boxX = mainRect.left - videoRect.left;
          const boxY = mainRect.top - videoRect.top;
          const boxW = mainRect.width;
          const boxH = mainRect.height;

          const vW = video.videoWidth, vH = video.videoHeight;
          const cW = video.clientWidth, cH = video.clientHeight;
          const vRatio = vW / vH, cRatio = cW / cH;
          let sW, sH, sX, sY;

          if (cRatio > vRatio) {
            sW = vW; sH = vW / cRatio; sX = 0; sY = (vH - sH) / 2;
          } else {
            sH = vH; sW = vH * cRatio; sX = (vW - sW) / 2; sY = 0;
          }

          const scale = sW / cW;
          tempCanvas.width = boxW;
          tempCanvas.height = boxH;
          tempCanvas.getContext('2d')!.drawImage(
            video,
            sX + boxX * scale, sY + boxY * scale, boxW * scale, boxH * scale,
            0, 0, boxW, boxH
          );
          setScanCount(c => c + 1);

          const base64 = tempCanvas.toDataURL('image/jpeg', 0.9);

          // 使用 HuggingFace Space 的 OCR 端點 (恢復方案 A)
          const ocrUrl = `${OCR_BACKEND_URL}/ocr`;

          try {
            console.log('[OCR] Post request to:', ocrUrl);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(ocrUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ image: base64 }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
              const data = await response.json();
              const elapse = performance.now() - startTime;
              setDebugMsg(`Results: ${data.results?.length || 0} (${Math.round(elapse)}ms)`);
              processAndDraw(data.results || []);
            } else {
              setDebugMsg(`Error: ${response.status}`);
            }
          } catch (err: any) {
            if (err.name === 'AbortError') {
              setDebugMsg('Timeout (>5s)');
            } else {
              setDebugMsg('Fetch Error: ' + err.message);
            }
          } finally {
            isScanningRef.current = false;
            // 確保無論成功/失敗且相機仍在啟動狀態時，都排程下一次掃描
            if (isStartedRef.current) {
              scanTimeoutRef.current = setTimeout(scanLoop, 500);
            }
          }
        } else {
          // 影片尚未就緒，稍後重試
          isScanningRef.current = false;
          if (isStartedRef.current) {
            scanTimeoutRef.current = setTimeout(scanLoop, 500);
          }
        }
      };

      scanLoop();
    };

    /**
     * [非同步串流] 發送文字至 WebSocket 翻譯服務
     * 若快取中已有譯文則直接跳過，避免重複請求
     */
    const translateText = (text: string) => {
      if (!text || !transSocketRef.current) return;
      if (transSocketRef.current.readyState !== WebSocket.OPEN) return;
      if (translationCacheRef.current[text]) return;

      console.log('[Camera Trans WS] Sending:', text);
      lastSentTextRef.current = text;
      transSocketRef.current.send(JSON.stringify({
        type: 'input',
        text: text
      }));
    };

    /** 在 Canvas 上繪製 OCR 結果框與翻譯文字 */
    const processAndDraw = (results: any[]) => {
      lastResultsRef.current = results;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const scanBoxEl = scanBoxRef.current;
      if (!canvas || !video || !scanBoxEl || video.videoWidth === 0) return;

      const ctx = canvas.getContext('2d')!;
      const canvasRect = canvas.getBoundingClientRect();
      canvas.width = canvasRect.width;
      canvas.height = canvasRect.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const topArea = scanBoxEl.querySelector('.scan-label-area.top') as HTMLElement;
      const bottomArea = scanBoxEl.querySelector('.scan-label-area.bottom') as HTMLElement;
      const mainArea = scanBoxEl.querySelector('.scan-main-area') as HTMLElement;
      if (!mainArea || !topArea || !bottomArea) return;

      // 使用 offset 來取得相對於 parent 的座標，這也是 scanBox 正在被設定的 top/left
      const boxW = scanBoxEl.offsetWidth;
      const boxH = scanBoxEl.offsetHeight;
      const boxX = scanBoxEl.offsetLeft;
      const boxY = scanBoxEl.offsetTop + topArea.offsetHeight; // 動態加上頂部標籤高度，得到正中間辨識區的 top

      // 取得上下標籤區域的實際高度
      const topHeight = topArea.offsetHeight;
      const bottomHeight = bottomArea.offsetHeight;

      // 標籤框的相對於 Canvas 的繪製座標
      const relTop = { top: scanBoxEl.offsetTop, height: topHeight };
      const relBottom = { top: scanBoxEl.offsetTop + boxH - bottomHeight, height: bottomHeight };

      // 1. 繪製辨識框與紅點（除錯顯示）
      results.forEach((item: any) => {
        const bx1 = item.bbox[0][0] + boxX, by1 = item.bbox[0][1] + boxY;
        const bx2 = item.bbox[2][0] + boxX, by2 = item.bbox[2][1] + boxY;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
        ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);
        const bcX = (bx1 + bx2) / 2, bcY = (by1 + by2) / 2;
        ctx.fillStyle = 'red';
        ctx.beginPath(); ctx.arc(bcX, bcY, 3, 0, Math.PI * 2); ctx.fill();
      });

      // 2. 單行加速辨識邏輯：找出面積最大的文字方塊
      let bestBlock = null;
      let maxArea = 0;
      results.forEach((r: any) => {
        const width = Math.abs(r.bbox[2][0] - r.bbox[0][0]);
        const height = Math.abs(r.bbox[2][1] - r.bbox[0][1]);
        const area = width * height;
        if (area > maxArea) {
          maxArea = area;
          bestBlock = r;
        }
      });

      const currentText = bestBlock ? bestBlock.text.trim() : '';
      let displayText = '', hasChinese = false, isLowConfidence = false;
      let displayBlocks: { text: string; isLowConf: boolean }[] = [];

      if (currentText && bestBlock) {
        hasChinese = bestBlock.has_chinese;
        displayBlocks = [{
          text: currentText,
          isLowConf: bestBlock.confidence < 0.85
        }];
        // 整體是否含有紅字的判斷（影響消失速度）
        isLowConfidence = displayBlocks.some(b => b.isLowConf);
        
        lastTargetRef.current = { 
          blocks: displayBlocks,
          text: currentText, 
          hasChinese, 
          isLowConfidence 
        };
        missCountRef.current = 0;
        displayText = currentText;
      } else if (lastTargetRef.current) {
        // 分層容錯邏輯
        const maxMiss = lastTargetRef.current.isLowConfidence ? 3 : 15;
        
        if (missCountRef.current < maxMiss) {
          displayText = lastTargetRef.current.text;
          displayBlocks = lastTargetRef.current.blocks;
          hasChinese = lastTargetRef.current.hasChinese;
          isLowConfidence = lastTargetRef.current.isLowConfidence || false;
          missCountRef.current++;
        } else {
          lastTargetRef.current = null;
        }
      } else {
        lastTargetRef.current = null;
      }

      if (displayText) {
        setDetectedTextObj({ 
          blocks: displayBlocks,
          text: displayText, 
          hasChinese, 
          isLowConf: isLowConfidence 
        });
        // 譯文標籤（下方）：黃色顯示印尼文翻譯結果
        const translated = translationCacheRef.current[displayText];
        if (translated) {
          setTranslatedText(translated);
        } else {
          // 快取中無譯文，發送翻譯請求
          // 注意：此處不立即 setTranslatedText('')，保留上一次結果以防止閃爍
          translateText(displayText);
        }
      } else {
        setDetectedTextObj(null);
        setTranslatedText('');
      }
    };

    // ─────────────────────────────────────────────
    // 畫面渲染：相機視訊、Canvas 疊圖層、掃描框、狀態標籤
    // （無「點擊識別」按鈕，改由 App.tsx 底部「攝影」導覽按鈕控制）
    // ─────────────────────────────────────────────
    return (
      <div className="camera-page-container">
        {/* 狀態標籤與除錯資訊 */}
        <div className="camera-status-badge">
          <div className="camera-status-row">
            <div className={`camera-status-dot ${isStarted ? 'active' : ''}`}></div>
            <span className="camera-status-title">{isStarted ? 'OCR Scanning' : 'Scanner Idle'}</span>
          </div>
          <span className="camera-status-text">
            OCR Server: <b className={serverStatus === 'Online' ? 'camera-online' : 'camera-offline'}>{serverStatus}</b>
          </span>
          <span className="camera-status-divider">|</span>
          <span className="camera-status-text">Scans: {scanCount}</span>
          <span className="camera-status-divider">|</span>
          <span className="camera-status-text">{debugMsg}</span>
        </div>

        {/* 相機畫面區：撐滿頁面，因按鈕已移至導覽輪 */}
        <div className="camera-wrapper">
          <video ref={videoRef} autoPlay playsInline />
          <canvas ref={canvasRef} />

          {/* 持續性遮罩：四角紅色框線 + 可拖曳掃描框 */}
          <div className="camera-mask">
            <div className="mask-corner t-l"></div>
            <div className="mask-corner t-r"></div>
            <div className="mask-corner b-l"></div>
            <div className="mask-corner b-r"></div>

            {/* 可拖曳＋縮放的掃描框 */}
            <div className="scan-box" ref={scanBoxRef}>
              <div className="scan-label-area top" style={{
                backgroundColor: 'rgba(0,0,0,0.8)',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'flex',
                justifyContent: 'center',
                gap: '8px',
                padding: '0 10px'
              }}>
                {detectedTextObj ? (
                  detectedTextObj.blocks.map((block, idx) => (
                    <span key={idx} style={{ color: block.isLowConf ? '#FF0000' : 'white' }}>
                      {block.text}
                    </span>
                  ))
                ) : '辨識原文'}
              </div>
              <div className="scan-main-area">
                <div className="resize-handle top-left"></div>
                <div className="resize-handle top-right"></div>
                <div className="resize-handle bottom-left"></div>
                <div className="resize-handle bottom-right"></div>
              </div>
              <div className="scan-label-area bottom" style={{
                backgroundColor: 'rgba(0,0,0,0.8)',
                color: 'white',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {translatedText || `翻譯結果（${SUPPORTED_LANGUAGES.find(l => l.code === targetLang)?.label ?? targetLang}）`}
              </div>
            </div>

            {/* 相機待機提示 */}
            {!isStarted && <div className="standby-text">Camera Standby</div>}
          </div>
        </div>
      </div>
    );
  }
);

CameraPage.displayName = 'CameraPage';
