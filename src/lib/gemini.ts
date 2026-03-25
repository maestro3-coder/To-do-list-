import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const getTaskSuggestions = async (taskTitle: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Suggest a brief description, a priority (low, medium, high), and a category (e.g., Work, Personal, Health, Finance) for a task titled: "${taskTitle}". Return as JSON with keys "description", "priority", and "category".`,
      config: {
        responseMimeType: "application/json",
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini error:", error);
    return null;
  }
};

export const getVoiceTaskParse = async (transcript: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Parse this voice transcript into a task object: "${transcript}". 
      Current date is ${new Date().toISOString()}.
      Extract: title, description, dueDate (YYYY-MM-DD), dueTime (HH:mm), priority (low, medium, high), category.
      Return as JSON.`,
      config: {
        responseMimeType: "application/json",
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini error:", error);
    return null;
  }
};
