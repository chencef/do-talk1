
export enum LanguageCode {
  Chinese = 'zh-TW',
  English = 'en-US',
  Vietnamese = 'vi-VN',
  Thai = 'th-TH',
  Indonesian = 'id-ID'
}

export type AppLanguage = 'zh-TW' | 'en-US' | 'vi-VN' | 'th-TH' | 'id-ID';

export interface LanguageOption {
  code: LanguageCode;
  label: string;
  flag: string;
}

export interface WordInfo {
  word: string;
  confidence: number;
}

export interface TranslationRecord {
  id: string;
  sourceText: string;
  sourceTranslatedText: string; // Translation of sourceText
  sourceCorrectedText?: string;  // AI-corrected sourceText
  targetText: string;
  targetTranslatedText: string; // Translation of targetText
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  timestamp: number;
  sourceConfidence?: number; // Overall confidence for sourceText
  sourceWords?: WordInfo[];   // Word-level confidence for sourceText
  isAudioPlaying?: boolean;
}

export interface GroqResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

export interface UITranslation {
  settings: string;
  translationSettings: string;
  headphoneSettings: string;
  versionSettings: string;
  volumeSettings: string;
  languagePref: string;
  checkLeAudio: string;
  checking: string;
  leSupported: string;
  leNotSupported: string;
  leDescription: string;
  appLanguage: string;
  hint: string;
  clearHistory: string;
  listening: string;
  processing: string;
  liveTranslation: string;
  startRecord: string;
  stopRecord: string;
  confirmClear: string;
  appName: string;
  rightEar: string;
  leftEar: string;
  enablePlayback: string;
  continuousMode: string;
  sourceTextLabel: string;
  translatedTextLabel: string;
  modelSettings: string;
  selectModel: string;
}

export type ModelProvider = 'groq' | 'deepgram';
