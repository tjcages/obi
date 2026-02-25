import { type ComponentProps, type ReactNode } from "react";
import { Drawer as VaulDrawer } from "vaul";
import { cn } from "../../lib";

function DrawerRoot({
  shouldScaleBackground = true,
  ...props
}: ComponentProps<typeof VaulDrawer.Root>) {
  return (
    <VaulDrawer.Root shouldScaleBackground={shouldScaleBackground} {...props} />
  );
}

function DrawerTrigger(props: ComponentProps<typeof VaulDrawer.Trigger>) {
  return <VaulDrawer.Trigger {...props} />;
}

function DrawerClose(props: ComponentProps<typeof VaulDrawer.Close>) {
  return <VaulDrawer.Close {...props} />;
}

function DrawerPortal(props: ComponentProps<typeof VaulDrawer.Portal>) {
  return <VaulDrawer.Portal {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: ComponentProps<typeof VaulDrawer.Overlay>) {
  return (
    <VaulDrawer.Overlay
      className={cn("fixed inset-0 z-50 bg-black/40 backdrop-blur-sm", className)}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  ...props
}: ComponentProps<typeof VaulDrawer.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <VaulDrawer.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[96dvh] flex-col rounded-t-2xl border-t border-border-100 bg-background-100",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-3 mb-2 h-1.5 w-12 shrink-0 rounded-full bg-foreground-300/30" />
        {children}
      </VaulDrawer.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border-100/60 px-4 py-2.5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DrawerBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function DrawerFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-border-100/60 px-4 py-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DrawerTitle(props: ComponentProps<typeof VaulDrawer.Title>) {
  return <VaulDrawer.Title {...props} />;
}

function DrawerDescription(props: ComponentProps<typeof VaulDrawer.Description>) {
  return <VaulDrawer.Description {...props} />;
}

export const Drawer = Object.assign(DrawerRoot, {
  Trigger: DrawerTrigger,
  Close: DrawerClose,
  Portal: DrawerPortal,
  Overlay: DrawerOverlay,
  Content: DrawerContent,
  Header: DrawerHeader,
  Body: DrawerBody,
  Footer: DrawerFooter,
  Title: DrawerTitle,
  Description: DrawerDescription,
});

/**
 * Renders children inside a vaul Drawer on mobile, or passes through
 * on desktop so the caller can render its own modal/overlay.
 */
export function ResponsiveDrawer({
  open,
  onOpenChange,
  isMobile,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isMobile: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!isMobile) {
    return open ? <>{children}</> : null;
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content className={className}>{children}</Drawer.Content>
    </Drawer>
  );
}
