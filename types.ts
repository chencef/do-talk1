
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
  flag: string; // Emoji flag
}

export interface TranslationRecord {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  timestamp: number;
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
}
