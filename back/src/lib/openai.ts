import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const useGemini = !!process.env.GEMINI_API_KEY;


export const openai = useGemini
  ? new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    })
  : new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

export const DEFAULT_MODEL = useGemini ? "gemini-2.5-flash" : "gpt-5.4-mini";

