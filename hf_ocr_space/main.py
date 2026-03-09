"""
main.py - DoTalk OCR 後端服務（HuggingFace Spaces 版）
改自 camera_test/main.py，適配 HuggingFace Spaces 環境：
  - 使用 RapidOCR 預設模型（在 Dockerfile BUILD 期間已預先下載快取）
  - 呼叫時傳入 use_det=False、use_cls=False，與 camera_test 行為一致
  - CORS 全開，供前端 2talk.pages.dev 呼叫
  - 使用 port 7860（HuggingFace Spaces 標準）
"""

import os
import re
import base64
import datetime
import numpy as np
import cv2
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from rapidocr_onnxruntime import RapidOCR
from fastapi.middleware.cors import CORSMiddleware
from opencc import OpenCC

app = FastAPI(title="DoTalk OCR Service", version="1.0.0")

# ── CORS 設定（前端部署在 2talk.pages.dev，需跨域存取）──────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 初始化 RapidOCR（使用 BUILD 期間已快取的預設模型）────────────────────────
# 自定義 ppocrv5 模型因 git LFS 指標問題無法在容器內使用
# 改用 Dockerfile 預先下載的預設模型（PP-OCRv3，支援繁體中文）
print("初始化 RapidOCR...")
try:
    ocr = RapidOCR()
    # 停用文字偵測（det）與方向分類（cls）
    # 前端已將掃描框裁切後才送來，圖片即為辨識區域，無需偵測文字位置
    # 對應原 camera_test/main.py 的 ocr.all_config['Global']['use_det'] = False
    if hasattr(ocr, 'all_config'):
        ocr.all_config['Global']['use_det'] = False
        ocr.all_config['Global']['use_cls'] = False
        print("已設定 use_det=False, use_cls=False")
    print("RapidOCR 初始化成功！")
except Exception as e:
    print(f"RapidOCR 初始化錯誤：{e}")
    raise

# ── 初始化 OpenCC（簡轉繁模式：s2t.json） ──────────────────────────────────
try:
    converter = OpenCC('s2t')
    print("OpenCC 初始化成功！")
except Exception as e:
    print(f"OpenCC 初始化錯誤：{e}")
    converter = None

# ── 中文字元正則表達式 ─────────────────────────────────────────────────────
CHINESE_PATTERN = re.compile(r'[\u4e00-\u9fa5]')


class ImageRequest(BaseModel):
    image: str  # base64 格式圖片（可含 data:image/jpeg;base64, 前綴）


@app.get("/health")
async def health():
    """健康檢查端點，供前端狀態標籤與 UptimeRobot 保活使用"""
    return {"status": "ok", "time": str(datetime.datetime.now())}


@app.post("/ocr")
async def perform_ocr(request: ImageRequest, req: Request):
    """
    [非同步串流處理]
    接收前端傳來的 base64 圖片（已裁切至掃描框範圍），執行 OCR 辨識，回傳結果陣列。
    回傳格式與本機 camera_test/main.py 相同，前端無需任何修改：
    {
        "results": [
            { "text": "...", "bbox": [[x1,y1],...], "confidence": 0.95, "has_chinese": true }
        ]
    }
    """
    try:
        # 1. 解碼 base64 圖片
        img_str = request.image
        if "," in img_str:
            img_str = img_str.split(",", 1)[1]

        image_data = base64.b64decode(img_str)
        image_np = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(image_np, cv2.IMREAD_COLOR)

        if img is None:
            return JSONResponse(status_code=400, content={"detail": "Invalid image"})

        # 2. 執行 OCR 辨識
        # 傳入 use_det=False 確保不執行文字偵測（1.3+ 版本支援呼叫時傳入）
        try:
            result, elapse = ocr(img, use_det=False, use_cls=False)
        except TypeError:
            # 1.2.x 版本不支援呼叫時傳入，依賴 all_config 設定（已在初始化時設好）
            result, elapse = ocr(img)

        # 3. 解析並格式化辨識結果
        processed = []
        if result:
            # 統一轉為 list 格式處理（RapidOCR 回傳格式可能因版本不同而略有差異）
            if isinstance(result, tuple) and len(result) == 2 and isinstance(result[0], str):
                items = [result]
            elif isinstance(result, list):
                items = result
            else:
                items = []

            for item in items:
                if len(item) >= 3 and isinstance(item[0], list):
                    bbox, text, conf = item[0], item[1], float(item[2])
                elif len(item) >= 2:
                    text, conf = item[0], float(item[1])
                    h, w = img.shape[:2]
                    bbox = [[0, 0], [w, 0], [w, h], [0, h]]
                else:
                    continue

                has_chinese = bool(CHINESE_PATTERN.search(text))
                
                # 若含有中文，則進行繁體化轉換
                if has_chinese and converter:
                    original_text = text
                    text = converter.convert(text)
                    if text != original_text:
                        print(f"[OCR] Converted to Traditional: {original_text} -> {text}")

                processed.append({
                    "text": text,
                    "bbox": bbox,
                    "confidence": conf,
                    "has_chinese": has_chinese
                })

        return {"results": processed, "elapse": elapse}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    # HuggingFace Spaces 使用 0.0.0.0:7860
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=False)
