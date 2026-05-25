import { createIcons, icons } from 'lucide';

export type LucideIconName = string;

/** Inicializa todos los iconos Lucide del DOM. */
export function initLucideIcons(
  root: Document | Element | DocumentFragment = document
): void {
  createIcons({ icons, root });
}

/** Renderiza o actualiza un icono Lucide en un elemento específico. */
export function setLucideIcon(
  element: Element | null,
  iconName: LucideIconName
): void {
  if (!element) return;
  element.setAttribute('data-lucide', String(iconName));
  const scope = element.parentElement ?? document;
  createIcons({ icons, root: scope });
}
