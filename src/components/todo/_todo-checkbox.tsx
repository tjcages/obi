import { motion } from "motion/react";
import { cn } from "../../lib";

/**
 * Shared todo checkbox styling. Change `todoCheckboxShape` to modify the shape
 * across all todo checkboxes (e.g. "rounded-full" for circle, "rounded-md" for rounded square).
 */
export const todoCheckboxShape = "rounded-md";

const sizeClasses = {
  default: "h-5 w-5 lg:h-[18px] lg:w-[18px]",
  sm: "h-4 w-4 lg:h-3.5 lg:w-3.5",
} as const;

const variantClasses = {
  empty: "border-foreground-300 hover:border-blue-400",
  completed: "border-green-400 bg-green-400 dark:border-green-500 dark:bg-green-500",
  muted: "border-foreground-300/40",
  acceptComplete: "border-foreground-300 transition-all hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-950/30",
} as const;

const checkIconSizes = {
  default: "h-3 w-3 lg:h-[10px] lg:w-[10px]",
  sm: "h-2.5 w-2.5 lg:h-2 lg:w-2",
} as const;

export interface TodoCheckboxProps {
  /** Whether the checkbox is checked/completed */
  completed?: boolean;
  /** Animate the check drawing in (for freshly-completed transitions) */
  animateIn?: boolean;
  /** Size variant */
  size?: keyof typeof sizeClasses;
  /** Visual variant */
  variant?: keyof typeof variantClasses;
  /** Disabled state */
  disabled?: boolean;
  /** Additional class names */
  className?: string;
  /** Content when completed (default: checkmark icon) */
  children?: React.ReactNode;
}

/**
 * Reusable todo checkbox. Use this component for consistent styling across
 * todo items, subtasks, suggestion cards, and add-todo placeholders.
 *
 * Pass `animateIn` to play a satisfying check-draw + scale-bounce when
 * transitioning from unchecked to checked.
 */
export function TodoCheckbox({
  completed = false,
  animateIn = false,
  size = "default",
  variant = completed ? "completed" : "empty",
  disabled = false,
  className,
  children,
}: TodoCheckboxProps) {
  const effectiveVariant = completed ? "completed" : variant;
  const iconW = size === "sm" ? 8 : 10;

  return (
    <motion.span
      className={cn(
        "flex items-center justify-center border-2 transition-colors",
        todoCheckboxShape,
        sizeClasses[size],
        variantClasses[effectiveVariant],
        disabled && "opacity-50",
        className,
      )}
      animate={animateIn ? { scale: [1, 1.2, 1] } : { scale: 1 }}
      transition={animateIn ? { duration: 0.3, ease: "easeOut" } : { duration: 0 }}
    >
      {completed &&
        (children ?? (
          animateIn ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={iconW}
              height={iconW}
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={checkIconSizes[size]}
            >
              <motion.path
                d="M20 6 L9 17 L4 12"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.25, delay: 0.05, ease: "easeOut" }}
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={iconW}
              height={iconW}
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={checkIconSizes[size]}
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )
        ))}
    </motion.span>
  );
}
