"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
export const Dialog = DialogPrimitive.Root;
export function DialogContent({
  children,
  title,
  description,
}: {
  children: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy/60 backdrop-blur-sm" />
      <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-navy/30">
        <DialogPrimitive.Title className="font-display text-xl font-semibold">
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
          {description ||
            "Fill out the details below. Required fields are marked with an asterisk."}
        </DialogPrimitive.Description>
        <DialogPrimitive.Close
          aria-label="Close dialog"
          className="absolute right-5 top-5 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={18} />
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
