import { render as testingRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/components/LocaleProvider";

export function render(ui: ReactElement, options?: RenderOptions) {
  return testingRender(ui, {
    ...options,
    wrapper: ({ children }) => <LocaleProvider locale="es">{children}</LocaleProvider>,
  });
}
