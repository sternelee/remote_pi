"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Dialog (new-york), vendored.
 *
 * Trimmed of the `animate-in`/`animate-out` utility classes: this project does
 * not install `tw-animate-css`, so the enter/exit motion lives in
 * `app/globals.css` under `[data-slot="dialog-overlay"]` /
 * `[data-slot="dialog-content"]`.
 */
function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/60", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  position = "center",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /**
   * `center` (default) floats in the middle of the viewport. `top` anchors to
   * the top edge — used by the command palette so an on-screen keyboard, which
   * shrinks the visual viewport from the bottom, cannot cover it.
   */
  position?: "center" | "top";
}) {
  // Rendered inline rather than through `DialogPortal` on purpose: this app has
  // no transformed ancestors that would trap a `fixed` layer, and rendering in
  // place keeps the dialog content in the server-rendered/static markup, which
  // this project's render tests rely on. `DialogPortal` stays exported for
  // callers that do want a portal.
  //
  // Centering lives in `app/globals.css` (`transform: translate(-50%,-50%)`,
  // keyed off `data-position`) rather than `translate-x/y-[-50%]` utilities:
  // Tailwind v4 emits those as the standalone `translate` property, which would
  // compose with the `transform` in the enter keyframes and make the dialog
  // drift.
  //
  // Sizing: `w-[calc(100%_-_2rem)]` (viewport minus a 1rem gutter each side)
  // instead of `w-full max-w-[calc(100%-2rem)]`. The latter is emitted verbatim
  // as `calc(100%-2rem)`, which is invalid CSS (calc needs whitespace around
  // `-`), so the cap was dropped and the dialog ran to the full viewport width
  // on phones. `max-w-lg` still caps it on wide screens, and the height cap
  // keeps tall dialogs inside the viewport.
  return (
    <>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-position={position}
        className={cn(
          "bg-background fixed left-[50%] z-50 grid max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg gap-4 overflow-y-auto rounded-lg border p-4 shadow-lg duration-200 sm:p-6",
          position === "top" ? "top-0" : "top-[50%]",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring absolute top-3 right-3 rounded-none opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-lg leading-none font-semibold", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
