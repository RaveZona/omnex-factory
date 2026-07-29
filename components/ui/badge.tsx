import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/core/ui-utils";

/** Badge — small status pill with cosmic-theme variants. */
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        cosmic: "border-transparent bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-200",
        glass: "border-white/15 bg-white/5 text-white/80 backdrop-blur-sm",
        success: "border-transparent bg-emerald-500/15 text-emerald-300",
        warning: "border-transparent bg-amber-500/15 text-amber-300",
        outline: "border-white/20 text-white/80",
      },
    },
    defaultVariants: { variant: "cosmic" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
