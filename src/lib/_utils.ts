import { type ClassValue, clsx } from "clsx";
import type { CSSProperties } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface CategoryColor {
  bg: string;
  text: string;
  hex: string;
  style?: CSSProperties;
}

const CATEGORY_COLORS: readonly CategoryColor[] = [
  { bg: "bg-blue-100 dark:bg-blue-500/15", text: "text-blue-700 dark:text-blue-400", hex: "#3b82f6" },
  { bg: "bg-amber-100 dark:bg-amber-500/15", text: "text-amber-700 dark:text-amber-400", hex: "#f59e0b" },
  { bg: "bg-emerald-100 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-400", hex: "#10b981" },
  { bg: "bg-violet-100 dark:bg-violet-500/15", text: "text-violet-700 dark:text-violet-400", hex: "#8b5cf6" },
  { bg: "bg-rose-100 dark:bg-rose-500/15", text: "text-rose-600 dark:text-rose-400", hex: "#f43f5e" },
  { bg: "bg-cyan-100 dark:bg-cyan-500/15", text: "text-cyan-700 dark:text-cyan-400", hex: "#06b6d4" },
  { bg: "bg-orange-100 dark:bg-orange-500/15", text: "text-orange-700 dark:text-orange-400", hex: "#f97316" },
  { bg: "bg-teal-100 dark:bg-teal-500/15", text: "text-teal-700 dark:text-teal-400", hex: "#14b8a6" },
];

export { CATEGORY_COLORS };

let _customCategoryColors: Record<string, string> = {};

export function setCustomCategoryColors(colors: Record<string, string>) {
  _customCategoryColors = colors;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function stableHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getCategoryColor(cat: string, _allCategories?: string[]): CategoryColor {
  const customHex = _customCategoryColors[cat];
  if (customHex) {
    return {
      bg: "",
      text: "",
      hex: customHex,
      style: { backgroundColor: hexToRgba(customHex, 0.12), color: customHex },
    };
  }
  return CATEGORY_COLORS[stableHash(cat) % CATEGORY_COLORS.length];
}
