
import { DEEPGRAM_API_KEY } from '../constants';
import { LanguageCode } from '../types';

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

export const transcribeAudioDeepgram = async (
    audioBlob: Blob,
    sourceLang: LanguageCode
): Promise<string> => {
    // Map App Language Codes to Deepgram Language Codes
    const langMap: Record<string, string> = {
        [LanguageCode.Chinese]: "zh-TW",
        [LanguageCode.English]: "en-US",
        [LanguageCode.Vietnamese]: "vi",
        [LanguageCode.Thai]: "th",
        [LanguageCode.Indonesian]: "id"
    };

    const deepgramLang = langMap[sourceLang] || "en-US";

    // Construct URL with query parameters
    const params = new URLSearchParams({
        model: "nova-2",
        smart_format: "true",
        language: deepgramLang,
    });

    const url = `${DEEPGRAM_URL}?${params.toString()}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Token ${DEEPGRAM_API_KEY}`,
                "Content-Type": audioBlob.type || "audio/webm",
            },
            body: audioBlob,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Deepgram API Error:", errorText);
            throw new Error(`Deepgram Transcription failed: ${response.status}`);
        }

        const data = await response.json();

        // Deepgram response structure: results.channels[0].alternatives[0].transcript
        const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
        return transcript.trim();
    } catch (error) {
        console.error("Deepgram Service Error:", error);
        throw error;
    }
};
