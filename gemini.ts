import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function translateText(text: string, from: string, to: string) {
  if (!text.trim()) return "";

  const prompt = `Translate the following text from ${from} to ${to}. 
  Provide only the translation. 
  Text: "${text}"`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  return response.text?.trim() || "";
}

function safeJsonParse<T>(text: string, defaultValue: T): T {
  try {
    // Try to find a JSON block if it's wrapped in markdown or has extra text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonToParse = jsonMatch ? jsonMatch[0] : text;
    return JSON.parse(jsonToParse.trim()) as T;
  } catch (e) {
    console.error("Failed to parse Gemini response as JSON:", e, "Original text:", text);
    return defaultValue;
  }
}

export async function translateImage(base64Image: string, mimeType: string, to: string) {
  const prompt = `Identify all text in this image.
  For each text block, provide the original text, its translation into ${to}, and its approximate normalized coordinates [ymin, xmin, ymax, xmax] (0-1000).
  
  Return the result EXACTLY in this JSON format:
  {
    "detectedText": "all detected text concatenated",
    "translation": "full translation concatenated",
    "blocks": [
      {
        "original": "text",
        "translated": "translated text",
        "box": [ymin, xmin, ymax, xmax]
      }
    ]
  }`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      { text: prompt },
      { inlineData: { data: base64Image, mimeType } }
    ],
    config: {
      responseMimeType: "application/json"
    }
  });

  const text = response.text?.trim() || "{}";
  return safeJsonParse(text, { detectedText: "", translation: "", blocks: [] });
}

export async function translateAudio(base64Audio: string, mimeType: string, to: string) {
  const prompt = `Perform the following tasks:
  1. Transcribe the audio precisely in its original language.
  2. Translate that transcription into ${to}.

  Return the result EXACTLY in this JSON format:
  {
    "transcription": "the transcription in original language",
    "translation": "the translation in ${to}"
  }`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      { text: prompt },
      { inlineData: { data: base64Audio, mimeType } }
    ],
    config: {
      responseMimeType: "application/json"
    }
  });

  const text = response.text?.trim() || "{}";
  return safeJsonParse(text, { transcription: "", translation: text });
}

export async function textToSpeech(text: string) {
  if (!text.trim()) return null;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text: `Say this: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (base64Audio) {
    return `data:audio/wav;base64,${base64Audio}`;
  }
  return null;
}
