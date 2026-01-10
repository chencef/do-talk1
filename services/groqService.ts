
import { GROQ_API_KEY } from '../constants';
import { LanguageCode, GroqResponse } from '../types';

// Endpoint for Audio Transcriptions
const GROQ_AUDIO_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Translates text using Groq API (Llama3 model)
 * Now supports bidirectional automatic translation.
 */
export const translateText = async (
  text: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): Promise<string> => {
  if (!text.trim()) return "";

  // Mapping codes to readable names for the prompt
  const langMap: Record<string, string> = {
    [LanguageCode.Chinese]: "Traditional Chinese (Taiwan)",
    [LanguageCode.English]: "English",
    [LanguageCode.Vietnamese]: "Vietnamese",
    [LanguageCode.Thai]: "Thai",
    [LanguageCode.Indonesian]: "Indonesian"
  };

  const sourceName = langMap[sourceLang];
  const targetName = langMap[targetLang];

  // Updated Prompt: stronger enforcement of Traditional Chinese and better mixed input handling
  const systemPrompt = `You are a professional interpreter bridging ${sourceName} and ${targetName}.
  
  TASK:
  Translate the [User Input] accurately.

  LOGIC:
  1. Analyze the [User Input] language.
  2. If the text is primarily in ${sourceName}, translate it to ${targetName}.
  3. If the text is primarily in ${targetName}, translate it to ${sourceName}.
  4. If the text contains BOTH languages (mixed):
     - Translate the ${sourceName} segment to ${targetName}.
     - Translate the ${targetName} segment to ${sourceName}.
     - Output the combined results separated by a space.

  STRICT OUTPUT RULES:
  - OUTPUT ONLY THE TRANSLATED TEXT. NO EXPLANATIONS, NO NOTES.
  - IF THE TARGET OUTPUT LANGUAGE IS CHINESE: YOU MUST USE TRADITIONAL CHINESE (繁體中文).
  - DO NOT USE SIMPLIFIED CHINESE (简体中文).
  - If the input is Simplified Chinese, treat it as Chinese and translate to ${targetName} (unless target is Chinese, then convert to Traditional).`;

  try {
    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", 
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ],
        temperature: 0.1, 
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Groq API Error Body:", errorText);
      throw new Error(`Translation failed: ${response.status} - ${errorText}`);
    }

    const data: GroqResponse = await response.json();
    return data.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error("Translation Service Error:", error);
    throw error;
  }
};

/**
 * Transcribes audio using Groq Whisper API (whisper-large-v3)
 * Supports mixed language input by prompting the model.
 */
export const transcribeAudio = async (
  audioBlob: Blob,
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): Promise<string> => {
  const formData = new FormData();
  // Groq requires a file with a valid extension
  formData.append("file", audioBlob, "recording.webm");
  formData.append("model", "whisper-large-v3");
  
  const langMap: Record<string, string> = {
    [LanguageCode.Chinese]: "Traditional Chinese",
    [LanguageCode.English]: "English",
    [LanguageCode.Vietnamese]: "Vietnamese",
    [LanguageCode.Thai]: "Thai",
    [LanguageCode.Indonesian]: "Indonesian"
  };
  
  // PROMPT ENGINEERING FOR WHISPER:
  // To force Traditional Chinese, we inject Traditional Chinese text into the prompt.
  // This acts as a "previous context" that biases the model to continue in Traditional script.
  const prompt = `以下是繁體中文的句子。The audio contains ${langMap[sourceLang]} or ${langMap[targetLang]}.`;
  formData.append("prompt", prompt);

  // We set response format to json
  formData.append("response_format", "json");

  try {
    const response = await fetch(GROQ_AUDIO_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Groq Whisper API Error:", errorText);
      throw new Error(`Transcription failed: ${response.status}`);
    }

    const data = await response.json();
    return data.text ? data.text.trim() : "";
  } catch (error) {
    console.error("Transcription Service Error:", error);
    throw error;
  }
};
