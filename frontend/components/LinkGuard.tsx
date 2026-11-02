"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

function appLink(target: EventTarget | null): HTMLAnchorElement | null {
  const link = target instanceof Element ? target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement) || link.origin !== window.location.origin) return null;
  return link;
}

export function LinkGuard() {
  const router = useRouter();

  useEffect(() => {
    // Solo en la ventana de la app: ahí abrir un enlace en otra pestaña o ventana la saca al navegador
    if (!window.__LETHA__) return;

    const openInPlace = (e: MouseEvent) => {
      const link = appLink(e.target);
      if (!link || !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return;
      e.preventDefault();
      e.stopPropagation();
      router.push(link.pathname + link.search + link.hash);
    };

    const blockOnLink = (e: Event) => {
      if (appLink(e.target)) e.preventDefault();
    };

    const blockMiddleButton = (e: MouseEvent) => {
      if (e.button === 1) blockOnLink(e);
    };

    document.addEventListener("click", openInPlace, true);
    document.addEventListener("mousedown", blockMiddleButton, true);
    document.addEventListener("auxclick", blockMiddleButton, true);
    document.addEventListener("dragstart", blockOnLink, true);
    document.addEventListener("contextmenu", blockOnLink, true);
    return () => {
      document.removeEventListener("click", openInPlace, true);
      document.removeEventListener("mousedown", blockMiddleButton, true);
      document.removeEventListener("auxclick", blockMiddleButton, true);
      document.removeEventListener("dragstart", blockOnLink, true);
      document.removeEventListener("contextmenu", blockOnLink, true);
    };
  }, [router]);

  return null;
}
