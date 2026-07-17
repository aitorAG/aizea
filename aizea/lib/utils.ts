import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { genId } from "@/lib/utils/gen-id";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return genId();
}
