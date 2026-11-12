import React, { useEffect, useRef, useState } from "react";

export function ActionMenu({
  label,
  className = "",
  trigger,
  children,
}: {
  label: string;
  className?: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <details
      ref={ref}
      className={"action-menu " + className}
      open={open}
      onClick={(event) => {
        const target = event.target as Element;
        const item = target.closest(".menu-popover button");
        if (item && !(item as HTMLButtonElement).disabled) setOpen(false);
      }}
    >
      <summary
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        {trigger}
      </summary>
      <div className="menu-popover" role="menu">
        {children}
      </div>
    </details>
  );
}
