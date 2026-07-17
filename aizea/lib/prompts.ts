import { PromptManager } from "@/lib/domain/prompts/PromptManager";

const promptManager = new PromptManager();

export const buildOutlinePrompt = promptManager.buildOutlinePrompt.bind(promptManager);
export const buildBoxesPrompt = promptManager.buildBoxesPrompt.bind(promptManager);
export const buildHtmlDesignPrompt = promptManager.buildHtmlDesignPrompt.bind(promptManager);
